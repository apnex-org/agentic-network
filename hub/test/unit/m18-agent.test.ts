/**
 * M18 — Agent-as-First-Class-Entity unit tests.
 *
 * Covers: fingerprint determinism, first-contact creation, role mismatch,
 * displacement with epoch increment, thrashing circuit breaker, and
 * migrate_agent_queue admin entry.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  computeFingerprint,
  shortHash,
  recordDisplacementAndCheck,
  THRASHING_THRESHOLD,
  THRASHING_WINDOW_MS,
  type RegisterAgentPayload,
  type AgentClientMetadata,
} from "../../src/state.js";
import { AgentRepository } from "../../src/entities/agent-repository.js";
import { MemoryStorageProvider } from "@ois/storage-provider";

const CLIENT: AgentClientMetadata = {
  clientName: "claude-code",
  clientVersion: "0.1.0",
  proxyName: "@ois/claude-plugin",
  proxyVersion: "1.0.0",
  transport: "stdio-mcp-proxy",
};

function payload(instanceId: string): RegisterAgentPayload {
  return {
    globalInstanceId: instanceId,
    role: "engineer",
    clientMetadata: CLIENT,
    advisoryTags: { llmModel: "claude-opus-4-6" },
  };
}

describe("M18 Agent fingerprint", () => {
  it("sha256 over globalInstanceId is deterministic", () => {
    const a = computeFingerprint("uuid-1234");
    const b = computeFingerprint("uuid-1234");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("different instanceIds produce different fingerprints", () => {
    expect(computeFingerprint("uuid-a")).not.toBe(computeFingerprint("uuid-b"));
  });

  it("fingerprint does NOT mix token (verified by signature of helper)", () => {
    // Regression guard for the thread-79 correction: token MUST NOT be in the hash.
    // computeFingerprint only accepts one argument.
    expect(computeFingerprint.length).toBe(1);
  });
});

describe("M18 thrashing detector", () => {
  it("trips only AFTER the threshold+1 sample in the window", () => {
    const hist: number[] = [];
    const t0 = 1_000_000;
    for (let i = 0; i < THRASHING_THRESHOLD; i++) {
      expect(recordDisplacementAndCheck(hist, t0 + i)).toBe(false);
    }
    // The (THRESHOLD+1)-th record trips.
    expect(recordDisplacementAndCheck(hist, t0 + THRASHING_THRESHOLD)).toBe(true);
  });

  it("evicts samples older than the window", () => {
    const hist: number[] = [];
    const t0 = 1_000_000;
    // Pack the history with stale entries all at exactly t0.
    for (let i = 0; i < 10; i++) recordDisplacementAndCheck(hist, t0);
    // Jump forward past the window so every stale entry is evicted.
    const later = t0 + THRASHING_WINDOW_MS + 1;
    expect(recordDisplacementAndCheck(hist, later)).toBe(false);
    // Only the new entry should remain.
    expect(hist).toEqual([later]);
  });
});

describe("AgentRepository.registerAgent", () => {
  let reg: AgentRepository;
  beforeEach(() => {
    reg = new AgentRepository(new MemoryStorageProvider());
  });

  it("first-contact creates a new Agent with epoch=1 and wasCreated=true", async () => {
    const result = await reg.registerAgent("sess-1", "engineer", payload("uuid-a"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wasCreated).toBe(true);
    expect(result.sessionEpoch).toBe(1);
    expect(result.agentId).toBe(`eng-${shortHash(computeFingerprint("uuid-a"))}`);
  });

  it("same globalInstanceId maps to the same agentId across calls", async () => {
    const a = await reg.registerAgent("sess-1", "engineer", payload("uuid-a"));
    const b = await reg.registerAgent("sess-2", "engineer", payload("uuid-a"));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.agentId).toBe(b.agentId);
    expect(b.wasCreated).toBe(false);
    expect(b.sessionEpoch).toBe(2); // displacement incremented
  });

  it("different globalInstanceIds produce distinct Agents even with the same token/role", async () => {
    const a = await reg.registerAgent("sess-1", "engineer", payload("uuid-a"));
    const b = await reg.registerAgent("sess-2", "engineer", payload("uuid-b"));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.agentId).not.toBe(b.agentId);
    // This is the exact task-140 fix: two agents under a shared token stay separate.
  });

  it("rejects with role_mismatch when token role differs from persisted agent role", async () => {
    const created = await reg.registerAgent("sess-1", "engineer", payload("uuid-a"));
    expect(created.ok).toBe(true);
    const mismatched = await reg.registerAgent("sess-2", "architect", payload("uuid-a"));
    expect(mismatched.ok).toBe(false);
    if (mismatched.ok) return;
    expect(mismatched.code).toBe("role_mismatch");
  });

  it("trips the thrashing circuit breaker after THRESHOLD displacements in the window", async () => {
    // First call creates the agent — does NOT count as a displacement.
    await reg.registerAgent("sess-0", "engineer", payload("uuid-a"));
    // Each subsequent call is a live displacement.
    for (let i = 0; i < THRASHING_THRESHOLD; i++) {
      const r = await reg.registerAgent(`sess-${i + 1}`, "engineer", payload("uuid-a"));
      expect(r.ok).toBe(true);
    }
    // The (THRESHOLD+1)-th displacement trips.
    const tripped = await reg.registerAgent("sess-tripped", "engineer", payload("uuid-a"));
    expect(tripped.ok).toBe(false);
    if (tripped.ok) return;
    expect(tripped.code).toBe("agent_thrashing_detected");
  });

  it("displacement updates clientMetadata and advisoryTags on the persisted Agent", async () => {
    await reg.registerAgent("sess-1", "engineer", payload("uuid-a"));
    const second = await reg.registerAgent("sess-2", "engineer", {
      ...payload("uuid-a"),
      clientMetadata: { ...CLIENT, proxyVersion: "1.0.1" },
      advisoryTags: { llmModel: "claude-sonnet-4-6" },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.clientMetadata.proxyVersion).toBe("1.0.1");
    expect(second.advisoryTags.llmModel).toBe("claude-sonnet-4-6");
  });

  // CP3 C5 (bug-16): labels refresh on reconnect when the handshake payload supplies them.
  it("reconnect with new labels overwrites stored labels and reports changedFields", async () => {
    await reg.registerAgent("sess-1", "engineer", { ...payload("uuid-a"), labels: { env: "prod" } });
    const second = await reg.registerAgent("sess-2", "engineer", { ...payload("uuid-a"), labels: { env: "dev" } });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.labels).toEqual({ env: "dev" });
    expect(second.changedFields).toContain("labels");
    expect(second.priorLabels).toEqual({ env: "prod" });
    const stored = await reg.getAgent(second.agentId);
    expect(stored?.labels).toEqual({ env: "dev" });
  });

  it("reconnect omitting labels preserves stored labels and reports no changedFields", async () => {
    await reg.registerAgent("sess-1", "engineer", { ...payload("uuid-a"), labels: { env: "prod" } });
    const p = payload("uuid-a");
    delete p.labels; // caller omitted
    const second = await reg.registerAgent("sess-2", "engineer", p);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.labels).toEqual({ env: "prod" });
    expect(second.changedFields).toBeUndefined();
    expect(second.priorLabels).toBeUndefined();
  });

  it("reconnect with identical labels is a no-op (no changedFields)", async () => {
    await reg.registerAgent("sess-1", "engineer", { ...payload("uuid-a"), labels: { env: "prod", team: "billing" } });
    const second = await reg.registerAgent("sess-2", "engineer", { ...payload("uuid-a"), labels: { env: "prod", team: "billing" } });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.changedFields).toBeUndefined();
  });

  it("reconnect with explicit empty labels clears stored labels and reports change", async () => {
    await reg.registerAgent("sess-1", "engineer", { ...payload("uuid-a"), labels: { env: "prod" } });
    const second = await reg.registerAgent("sess-2", "engineer", { ...payload("uuid-a"), labels: {} });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.labels).toEqual({});
    expect(second.changedFields).toContain("labels");
    expect(second.priorLabels).toEqual({ env: "prod" });
  });

  it("migrateAgentQueue reports a move count (memory stub seeds no queue)", async () => {
    const result = await reg.migrateAgentQueue("eng-src", "eng-tgt");
    expect(result.moved).toBeGreaterThanOrEqual(0);
  });
});

// CP3 C4 (bug-16 part 1): agent reaper — listOfflineAgentsOlderThan + deleteAgent.
describe("AgentRepository agent reaper (CP3 C4)", () => {
  let reg: AgentRepository;
  let provider: MemoryStorageProvider;
  beforeEach(() => {
    provider = new MemoryStorageProvider();
    reg = new AgentRepository(provider);
  });

  async function offlineAgentSeenAt(instanceId: string, lastSeenIsoOverride?: string): Promise<string> {
    const first = await reg.registerAgent(`sess-${instanceId}`, "engineer", payload(instanceId));
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("seed failed");
    // Flip to offline and (optionally) rewind lastSeenAt to force a stale window.
    await reg.markAgentOffline(`sess-${instanceId}`);
    if (lastSeenIsoOverride) {
      // Direct write into the storage provider for test fixtures — the
      // public API has no "set lastSeenAt to an arbitrary past time"
      // tool, which is fine: only the reaper cares about this, and the
      // test is what proves the reaper's threshold math.
      const agent = await reg.getAgent(first.agentId);
      expect(agent).not.toBeNull();
      const path = `agents/${first.agentId}.json`;
      const raw = await provider.get(path);
      if (!raw) throw new Error("agent blob not found in provider");
      const blob = JSON.parse(new TextDecoder().decode(raw));
      blob.lastSeenAt = lastSeenIsoOverride;
      await provider.put(path, new TextEncoder().encode(JSON.stringify(blob, null, 2)));
    }
    return first.agentId;
  }

  it("listOfflineAgentsOlderThan returns only stale-and-offline records", async () => {
    const now = Date.now();
    const oldIso = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
    const recentIso = new Date(now - 60 * 60 * 1000).toISOString();        // 1 hour ago
    const staleId = await offlineAgentSeenAt("stale-inst", oldIso);
    await offlineAgentSeenAt("fresh-inst", recentIso);
    // A third agent that's online (handshake left status=online).
    const onlineResult = await reg.registerAgent("sess-online", "engineer", payload("online-inst"));
    expect(onlineResult.ok).toBe(true);

    const stale = await reg.listOfflineAgentsOlderThan(7 * 24 * 60 * 60 * 1000);
    expect(stale.map((a) => a.agentId)).toEqual([staleId]);
  });

  it("deleteAgent removes the record so subsequent getAgent returns null", async () => {
    const id = await offlineAgentSeenAt("to-delete-inst", new Date(Date.now() - 1000).toISOString());
    expect(await reg.getAgent(id)).not.toBeNull();
    const deleted = await reg.deleteAgent(id);
    expect(deleted).toBe(true);
    expect(await reg.getAgent(id)).toBeNull();
  });

  it("deleteAgent on a missing agentId returns false without error", async () => {
    const deleted = await reg.deleteAgent("eng-never-existed");
    expect(deleted).toBe(false);
  });

  it("after deleteAgent, the fingerprint is reusable (reconnect mints a fresh Agent)", async () => {
    const id = await offlineAgentSeenAt("reusable-inst", new Date(Date.now() - 1000).toISOString());
    await reg.deleteAgent(id);
    const next = await reg.registerAgent("sess-2", "engineer", payload("reusable-inst"));
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    // Same fingerprint → same derived agentId; wasCreated=true proves
    // the old record did not survive.
    expect(next.agentId).toBe(id);
    expect(next.wasCreated).toBe(true);
    expect(next.sessionEpoch).toBe(1);
  });
});
