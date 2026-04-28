/**
 * M-Session-Claim-Separation (mission-40) T1 — split-helper contract tests.
 *
 * Pins the load-bearing T1 invariants:
 *   1. assertIdentity is idempotent: repeated calls with the same fingerprint
 *      do NOT increment sessionEpoch, do NOT touch currentSessionId, do NOT
 *      flip status to online. Only updates labels/metadata/lastSeenAt.
 *   2. assertIdentity respects the bug-16 C5 label-refresh contract:
 *      provided labels overwrite stored; omitted preserves stored.
 *   3. claimSession increments sessionEpoch, binds sessionId, marks online.
 *   4. claimSession returns displacedPriorSession when evicting a prior session.
 *   5. claimSession returns the trigger value unchanged for audit emission.
 *   6. registerAgent (T1's internal refactor) produces external behavior
 *      byte-identical to pre-T1: same sessionEpoch, same response shape.
 *
 * Audit-emission wiring is tested via the policy handler in a sibling test
 * (the registry layer doesn't take an audit store; emission is the caller's
 * responsibility). Here we pin the data-shape invariants only.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  type AgentClientMetadata,
  type AgentLabels,
  type AgentRole,
  type AssertIdentityPayload,
  type ClaimSessionTrigger,
} from "../../src/state.js";
import { AgentRepository } from "../../src/entities/agent-repository.js";
import { MemoryStorageProvider } from "@apnex/storage-provider";

const CLIENT: AgentClientMetadata = {
  clientName: "claude-code",
  clientVersion: "0.1.0",
  proxyName: "@apnex/claude-plugin",
  proxyVersion: "1.0.0",
};

function identityPayload(
  instanceId: string,
  role: AgentRole,
  labels?: AgentLabels,
): AssertIdentityPayload {
  return {
    globalInstanceId: instanceId,
    role,
    clientMetadata: CLIENT,
    labels,
  };
}

describe("M-Session-Claim-Separation T1 — assertIdentity (Memory)", () => {
  let reg: AgentRepository;
  beforeEach(() => {
    reg = new AgentRepository(new MemoryStorageProvider());
  });

  it("first-contact creates an Agent with sessionEpoch=0 and status=offline (no session bound)", async () => {
    const result = await reg.assertIdentity(identityPayload("inst-A", "engineer"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wasCreated).toBe(true);

    const agent = await reg.getAgent(result.agentId);
    expect(agent).toBeTruthy();
    expect(agent?.sessionEpoch).toBe(0);
    expect(agent?.currentSessionId).toBeNull();
    // computeLivenessState forces status=offline when livenessState=offline
    expect(agent?.status).toBe("offline");
  });

  it("idempotent: second call with the same fingerprint does NOT increment sessionEpoch or bind session", async () => {
    const first = await reg.assertIdentity(identityPayload("inst-A", "engineer"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await reg.assertIdentity(identityPayload("inst-A", "engineer"));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.agentId).toBe(first.agentId);
    expect(second.wasCreated).toBe(false);
    const agent = await reg.getAgent(first.agentId);
    expect(agent?.sessionEpoch).toBe(0); // unchanged
    expect(agent?.currentSessionId).toBeNull(); // unchanged
  });

  it("role mismatch returns the role_mismatch failure code (security boundary)", async () => {
    await reg.assertIdentity(identityPayload("inst-A", "engineer"));
    const wrong = await reg.assertIdentity(identityPayload("inst-A", "architect"));
    expect(wrong.ok).toBe(false);
    if (wrong.ok) return;
    expect(wrong.code).toBe("role_mismatch");
  });

  it("bug-16 C5 label-refresh: provided labels overwrite stored", async () => {
    const first = await reg.assertIdentity(identityPayload("inst-A", "engineer", { team: "platform" }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await reg.assertIdentity(identityPayload("inst-A", "engineer", { team: "infra", env: "prod" }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.changedFields).toEqual(["labels"]);
    expect(second.priorLabels).toEqual({ team: "platform" });
    expect(second.labels).toEqual({ team: "infra", env: "prod" });

    const agent = await reg.getAgent(first.agentId);
    expect(agent?.labels).toEqual({ team: "infra", env: "prod" });
  });

  it("bug-16 C5: omitted labels preserve stored set", async () => {
    await reg.assertIdentity(identityPayload("inst-A", "engineer", { team: "platform" }));
    const second = await reg.assertIdentity({
      globalInstanceId: "inst-A",
      role: "engineer",
      clientMetadata: CLIENT,
      // labels intentionally omitted
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.changedFields).toBeUndefined();
    expect(second.labels).toEqual({ team: "platform" });
  });
});

describe("M-Session-Claim-Separation T1 — claimSession (Memory)", () => {
  let reg: AgentRepository;
  let agentId: string;
  beforeEach(async () => {
    reg = new AgentRepository(new MemoryStorageProvider());
    const id = await reg.assertIdentity(identityPayload("inst-A", "engineer"));
    if (!id.ok) throw new Error("setup failed");
    agentId = id.agentId;
  });

  it("first claim increments sessionEpoch from 0 to 1, binds session, marks online", async () => {
    const claim = await reg.claimSession(agentId, "sess-1", "explicit");
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.sessionEpoch).toBe(1);
    expect(claim.trigger).toBe("explicit");
    expect(claim.displacedPriorSession).toBeUndefined();

    const agent = await reg.getAgent(agentId);
    expect(agent?.sessionEpoch).toBe(1);
    expect(agent?.currentSessionId).toBe("sess-1");
    expect(agent?.status).toBe("online");
  });

  it("second claim from a different sessionId returns displacedPriorSession", async () => {
    await reg.claimSession(agentId, "sess-1", "explicit");
    const second = await reg.claimSession(agentId, "sess-2", "sse_subscribe");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.sessionEpoch).toBe(2);
    expect(second.trigger).toBe("sse_subscribe");
    expect(second.displacedPriorSession).toEqual({ sessionId: "sess-1", epoch: 1 });
  });

  it("claim with same sessionId does NOT report displacement (no-op rebind preserves audit clarity)", async () => {
    await reg.claimSession(agentId, "sess-1", "explicit");
    const second = await reg.claimSession(agentId, "sess-1", "first_tool_call");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.displacedPriorSession).toBeUndefined();
    expect(second.trigger).toBe("first_tool_call");
  });

  it("trigger value preserved across all three legal values", async () => {
    const triggers: ClaimSessionTrigger[] = ["explicit", "sse_subscribe", "first_tool_call"];
    for (const trigger of triggers) {
      const reg2 = new AgentRepository(new MemoryStorageProvider());
      const id = await reg2.assertIdentity(identityPayload("inst-A", "engineer"));
      if (!id.ok) throw new Error("setup");
      const claim = await reg2.claimSession(id.agentId, `sess-${trigger}`, trigger);
      expect(claim.ok).toBe(true);
      if (!claim.ok) continue;
      expect(claim.trigger).toBe(trigger);
    }
  });

  it("claim on unknown agentId returns unknown_engineer failure", async () => {
    const result = await reg.claimSession("eng-does-not-exist", "sess-X", "explicit");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unknown_engineer");
  });
});

describe("M-Session-Claim-Separation T1 — registerAgent external behavior preservation", () => {
  // Load-bearing T1 invariant: registerAgent (now refactored to call
  // assertIdentity + claimSession internally) must produce externally-
  // identical responses to the pre-T1 implementation.
  let reg: AgentRepository;
  beforeEach(() => {
    reg = new AgentRepository(new MemoryStorageProvider());
  });

  it("first-contact registerAgent returns sessionEpoch=1, wasCreated=true, status online", async () => {
    const result = await reg.registerAgent("sess-1", "engineer", {
      globalInstanceId: "inst-A",
      role: "engineer",
      clientMetadata: CLIENT,
      labels: { team: "platform" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionEpoch).toBe(1);
    expect(result.wasCreated).toBe(true);
    expect(result.labels).toEqual({ team: "platform" });
    expect(result.changedFields).toBeUndefined();
    expect(result.displacedPriorSession).toBeUndefined();

    const agent = await reg.getAgent(result.agentId);
    expect(agent?.sessionEpoch).toBe(1);
    expect(agent?.currentSessionId).toBe("sess-1");
    expect(agent?.status).toBe("online");
  });

  it("reconnect registerAgent increments epoch + reports displacedPriorSession", async () => {
    const first = await reg.registerAgent("sess-1", "engineer", {
      globalInstanceId: "inst-A",
      role: "engineer",
      clientMetadata: CLIENT,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await reg.registerAgent("sess-2", "engineer", {
      globalInstanceId: "inst-A",
      role: "engineer",
      clientMetadata: CLIENT,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.sessionEpoch).toBe(2);
    expect(second.wasCreated).toBe(false);
    expect(second.displacedPriorSession).toEqual({ sessionId: "sess-1", epoch: 1 });
  });

  it("reconnect with refreshed labels still emits changedFields + priorLabels (bug-16 C5 preserved)", async () => {
    await reg.registerAgent("sess-1", "engineer", {
      globalInstanceId: "inst-A",
      role: "engineer",
      clientMetadata: CLIENT,
      labels: { team: "platform" },
    });
    const second = await reg.registerAgent("sess-2", "engineer", {
      globalInstanceId: "inst-A",
      role: "engineer",
      clientMetadata: CLIENT,
      labels: { team: "infra", env: "prod" },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.changedFields).toEqual(["labels"]);
    expect(second.priorLabels).toEqual({ team: "platform" });
    expect(second.labels).toEqual({ team: "infra", env: "prod" });
  });

  it("role mismatch on reconnect surfaces the same role_mismatch code as pre-T1", async () => {
    await reg.registerAgent("sess-1", "engineer", {
      globalInstanceId: "inst-A",
      role: "engineer",
      clientMetadata: CLIENT,
    });
    const wrong = await reg.registerAgent("sess-2", "architect", {
      globalInstanceId: "inst-A",
      role: "architect",
      clientMetadata: CLIENT,
    });
    expect(wrong.ok).toBe(false);
    if (wrong.ok) return;
    expect(wrong.code).toBe("role_mismatch");
  });
});
