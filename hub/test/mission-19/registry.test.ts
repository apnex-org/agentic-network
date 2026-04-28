/**
 * Mission-19 — Agent registry label lifecycle.
 *
 * Covers: first-create persists labels, displacement preserves labels
 * (incoming ignored), legacy agents default to empty labels, P2P via
 * agentId stable across reconnects.
 *
 * Registry invariants: INV-AG1, INV-AG2, INV-AG4, INV-AG5.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  type RegisterAgentPayload,
  type AgentClientMetadata,
  type AgentLabels,
  type AgentRole,
} from "../../src/state.js";
import { AgentRepository } from "../../src/entities/agent-repository.js";
import { MemoryStorageProvider } from "@apnex/storage-provider";

const CLIENT: AgentClientMetadata = {
  clientName: "claude-code",
  clientVersion: "0.1.0",
  proxyName: "@apnex/claude-plugin",
  proxyVersion: "1.0.0",
};

function payload(instanceId: string, role: AgentRole, labels?: AgentLabels): RegisterAgentPayload {
  return {
    globalInstanceId: instanceId,
    role,
    clientMetadata: CLIENT,
    labels,
  };
}

describe("Mission-19 Registry — label persistence", () => {
  let reg: AgentRepository;

  beforeEach(() => {
    reg = new AgentRepository(new MemoryStorageProvider());
  });

  it("first registration persists the declared labels (INV-AG5)", async () => {
    const result = await reg.registerAgent("sess-1", "engineer",
      payload("inst-1", "engineer", { team: "platform", env: "prod" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const agent = await reg.getAgent(result.agentId);
    expect(agent?.labels).toEqual({ team: "platform", env: "prod" });
  });

  it("displacement with new labels refreshes stored labels (CP3 C5 / bug-16; supersedes old INV-AG1)", async () => {
    // First contact with labels X.
    const first = await reg.registerAgent("sess-1", "engineer",
      payload("inst-1", "engineer", { team: "platform", env: "prod" }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Displacement: same fingerprint, caller sends different labels.
    // Prior INV-AG1 treated labels as immutable; bug-16 surfaced this as a
    // real dispatch-routing hazard for cross-env reconnects. CP3 C5 flips
    // the semantics: the handshake payload is authoritative on every reconnect.
    const second = await reg.registerAgent("sess-2", "engineer",
      payload("inst-1", "engineer", { team: "network", env: "staging" }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const agent = await reg.getAgent(first.agentId);
    expect(agent?.labels).toEqual({ team: "network", env: "staging" });
  });

  it("displacement with missing labels payload preserves originals", async () => {
    const first = await reg.registerAgent("sess-1", "engineer",
      payload("inst-1", "engineer", { team: "platform" }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Displacement omits labels entirely.
    await reg.registerAgent("sess-2", "engineer",
      payload("inst-1", "engineer", undefined));

    const agent = await reg.getAgent(first.agentId);
    expect(agent?.labels).toEqual({ team: "platform" });
  });

  it("agent without labels in payload defaults to empty map (INV-AG4)", async () => {
    const result = await reg.registerAgent("sess-1", "engineer",
      payload("inst-1", "engineer", undefined));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const agent = await reg.getAgent(result.agentId);
    expect(agent?.labels).toEqual({});
  });

  it("sessionEpoch increments on displacement but agentId stays stable (INV-AG2)", async () => {
    const first = await reg.registerAgent("sess-1", "engineer", payload("inst-1", "engineer"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const agentId = first.agentId;
    const firstEpoch = first.sessionEpoch;

    const second = await reg.registerAgent("sess-2", "engineer", payload("inst-1", "engineer"));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.agentId).toBe(agentId); // stable identity
    expect(second.sessionEpoch).toBe(firstEpoch + 1);
  });
});

describe("Mission-19 Registry — session resolution for P2P routing", () => {
  let reg: AgentRepository;

  beforeEach(() => {
    reg = new AgentRepository(new MemoryStorageProvider());
  });

  it("getAgentForSession returns the Agent bound to the current session", async () => {
    const result = await reg.registerAgent("sess-1", "engineer",
      payload("inst-1", "engineer", { team: "platform" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const agent = await reg.getAgentForSession("sess-1");
    expect(agent?.id).toBe(result.agentId);
    expect(agent?.labels).toEqual({ team: "platform" });
  });

  it("getAgentForSession returns null for unknown session", async () => {
    const agent = await reg.getAgentForSession("unregistered");
    expect(agent).toBeNull();
  });

  it("after transport-driven offline + displacement, only the new session resolves", async () => {
    await reg.registerAgent("sess-1", "engineer", payload("inst-1", "engineer"));
    // Transport detects the old connection died and calls markAgentOffline for sess-1,
    // which unbinds sess-1 from the agent.
    await reg.markAgentOffline("sess-1");

    await reg.registerAgent("sess-2", "engineer", payload("inst-1", "engineer"));

    const agentOnOld = await reg.getAgentForSession("sess-1");
    expect(agentOnOld).toBeNull();

    const agentOnNew = await reg.getAgentForSession("sess-2");
    expect(agentOnNew).not.toBeNull();
  });

  it("P2P routing via agentId survives reconnection (INV-AG2)", async () => {
    const first = await reg.registerAgent("sess-1", "engineer",
      payload("inst-1", "engineer", { team: "platform" }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Simulate reconnect.
    await reg.markAgentOffline("sess-1");
    const second = await reg.registerAgent("sess-2", "engineer",
      payload("inst-1", "engineer", { team: "platform" }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // The agentId is unchanged; a P2P selector pinned to it resolves.
    expect(second.agentId).toBe(first.agentId);
    const matched = await reg.selectAgents({ agentId: first.agentId });
    expect(matched).toHaveLength(1);
    expect(matched[0].currentSessionId).toBe("sess-2");
  });
});
