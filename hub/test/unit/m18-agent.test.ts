/**
 * M18 — Agent-as-First-Class-Entity unit tests.
 *
 * Covers: fingerprint determinism, first-contact creation, role mismatch,
 * displacement with epoch increment, thrashing circuit breaker, and
 * migrate_agent_queue admin entry.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  MemoryEngineerRegistry,
  computeFingerprint,
  shortHash,
  recordDisplacementAndCheck,
  THRASHING_THRESHOLD,
  THRASHING_WINDOW_MS,
  type RegisterAgentPayload,
  type AgentClientMetadata,
} from "../../src/state.js";

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

describe("MemoryEngineerRegistry.registerAgent", () => {
  let reg: MemoryEngineerRegistry;
  beforeEach(() => {
    reg = new MemoryEngineerRegistry();
  });

  it("first-contact creates a new Agent with epoch=1 and wasCreated=true", async () => {
    const result = await reg.registerAgent("sess-1", "engineer", payload("uuid-a"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wasCreated).toBe(true);
    expect(result.sessionEpoch).toBe(1);
    expect(result.engineerId).toBe(`eng-${shortHash(computeFingerprint("uuid-a"))}`);
  });

  it("same globalInstanceId maps to the same engineerId across calls", async () => {
    const a = await reg.registerAgent("sess-1", "engineer", payload("uuid-a"));
    const b = await reg.registerAgent("sess-2", "engineer", payload("uuid-a"));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.engineerId).toBe(b.engineerId);
    expect(b.wasCreated).toBe(false);
    expect(b.sessionEpoch).toBe(2); // displacement incremented
  });

  it("different globalInstanceIds produce distinct Agents even with the same token/role", async () => {
    const a = await reg.registerAgent("sess-1", "engineer", payload("uuid-a"));
    const b = await reg.registerAgent("sess-2", "engineer", payload("uuid-b"));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.engineerId).not.toBe(b.engineerId);
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
    const stored = await reg.getAgent(second.engineerId);
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
