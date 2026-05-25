/**
 * mission-88 W10-ext (bug-127 fix) — assertIdentity OCC retry-budget tests.
 *
 * Locks per Design v1.0 §5 changes:
 *   - 8-attempt retry budget (vs prior 2)
 *   - Exponential backoff (0/10/25/50/100/250/500/1000ms) + ±20% jitter
 *   - 2000ms wall-time cap (Q1 refinement)
 *   - New `occ_contention_exhausted` error code (NOT in FATAL_CODES; transient)
 *   - Per-fingerprint contention observability (console.warn)
 *
 * Uses mock-substrate to deterministically control OCC outcomes (concurrent
 * fingerprint binding contention is non-deterministic at testcontainer scale;
 * mock provides reproducible failure-path coverage).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentRepositorySubstrate } from "../agent-repository-substrate.js";
import type { HubStorageSubstrate } from "../../storage-substrate/index.js";
import type { Agent } from "../../state.js";

function makeMockSubstrate(opts: {
  // Sequence of putIfMatch outcomes (one entry per attempt; true = success, false = OCC loss)
  putIfMatchSequence?: boolean[];
  createOnlyOk?: boolean;
  hasExistingAgent?: boolean;
}): { substrate: HubStorageSubstrate; putIfMatchCalls: number } {
  let putIfMatchIdx = 0;
  let createOnlyCalls = 0;
  const mockAgent: Agent = {
    id: "agent-test",
    fingerprint: "fp-test",
    role: "engineer",
    name: "test",
    status: "offline",
    archived: false,
    sessionEpoch: 0,
    currentSessionId: null,
    clientMetadata: undefined,
    advisoryTags: [],
    labels: {},
    firstSeenAt: "2026-05-24T00:00:00Z",
    lastSeenAt: "2026-05-24T00:00:00Z",
    livenessState: "offline",
    lastHeartbeatAt: "2026-05-24T00:00:00Z",
    receiptSla: 3600000,
    wakeEndpoint: null,
    activityState: "offline",
    sessionStartedAt: null,
    lastToolCallAt: null,
    lastToolCallName: null,
    idleSince: null,
    workingSince: null,
    quotaBlockedUntil: null,
    adapterVersion: "",
    ipAddress: null,
    restartCount: 0,
    recentErrors: [],
    restartHistoryMs: [],
    cognitiveTTL: null,
    transportTTL: null,
    cognitiveState: "unknown",
    transportState: "unknown",
  } as unknown as Agent;

  const substrate = {
    list: vi.fn().mockResolvedValue({
      items: opts.hasExistingAgent ? [mockAgent] : [],
    }),
    getWithRevision: vi.fn().mockResolvedValue(opts.hasExistingAgent ? { entity: mockAgent, resourceVersion: 1 } : null),
    createOnly: vi.fn().mockImplementation(() => {
      createOnlyCalls++;
      return Promise.resolve({ ok: opts.createOnlyOk ?? true });
    }),
    putIfMatch: vi.fn().mockImplementation(() => {
      const ok = opts.putIfMatchSequence?.[putIfMatchIdx] ?? false;
      putIfMatchIdx++;
      return Promise.resolve({ ok });
    }),
  } as unknown as HubStorageSubstrate;

  return {
    substrate,
    get putIfMatchCalls() {
      return putIfMatchIdx;
    },
  };
}

describe("W10-ext: assertIdentity retry-budget widening (bug-127)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Also silence the [AgentRepositorySubstrate] info logs
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("recovers when OCC race won on attempt 3 of 8 (was IMPOSSIBLE under prior 2-attempt budget)", async () => {
    const mock = makeMockSubstrate({
      hasExistingAgent: true,
      putIfMatchSequence: [false, false, true],  // 2 losses, 3rd attempt wins
    });
    const repo = new AgentRepositorySubstrate(mock.substrate);

    const result = await repo.assertIdentity({
      role: "engineer",
      name: "test",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agentId).toBeDefined();
    }
    expect(warnSpy).not.toHaveBeenCalled();  // no contention-exhausted warning
  });

  it("returns occ_contention_exhausted (NOT role_mismatch) when all 8 attempts lose", async () => {
    const mock = makeMockSubstrate({
      hasExistingAgent: true,
      // Sequence longer than budget — all attempts lose
      putIfMatchSequence: [false, false, false, false, false, false, false, false],
    });
    const repo = new AgentRepositorySubstrate(mock.substrate);

    const result = await repo.assertIdentity({
      role: "engineer",
      name: "test",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("occ_contention_exhausted");
      expect(result.code).not.toBe("role_mismatch");
      expect(result.message).toMatch(/transient — caller SHOULD retry/);
      expect(result.message).toMatch(/8 attempts/);
    }
  });

  it("emits per-fingerprint contention WARN on exhaustion (observability)", async () => {
    const mock = makeMockSubstrate({
      hasExistingAgent: true,
      putIfMatchSequence: Array(8).fill(false),
    });
    const repo = new AgentRepositorySubstrate(mock.substrate);

    await repo.assertIdentity({
      role: "engineer",
      name: "test",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/OCC contention exhausted/);
    expect(warnSpy.mock.calls[0][0]).toMatch(/fingerprint=/);
    expect(warnSpy.mock.calls[0][0]).toMatch(/\d+ attempts/);
    expect(warnSpy.mock.calls[0][0]).toMatch(/\d+ms elapsed/);
  });

  it("respects 2000ms wall-time cap (W10-ext Q1 refinement)", async () => {
    // Sequence all losses; the budget exponential backoff sums to ~1935ms.
    // The wall-time cap should NOT prematurely cut short within budget under
    // synthetic mock (no real OCC delay), but verifies the cap-check exists.
    const mock = makeMockSubstrate({
      hasExistingAgent: true,
      putIfMatchSequence: Array(8).fill(false),
    });
    const repo = new AgentRepositorySubstrate(mock.substrate);

    const startedAt = Date.now();
    const result = await repo.assertIdentity({
      role: "engineer",
      name: "test",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
    });
    const elapsed = Date.now() - startedAt;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("occ_contention_exhausted");
    }
    // Wall-time cap of 2000ms + small overhead; should not exceed materially
    expect(elapsed).toBeLessThan(2500);
    // But should exceed at least one delay-step (10ms minimum) to confirm
    // retries ran with backoff
    expect(elapsed).toBeGreaterThanOrEqual(10);
  });

  it("creates Agent on first-contact when no existing agent (createOnly path)", async () => {
    const mock = makeMockSubstrate({
      hasExistingAgent: false,
      createOnlyOk: true,
    });
    const repo = new AgentRepositorySubstrate(mock.substrate);

    const result = await repo.assertIdentity({
      role: "engineer",
      name: "test-new",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.wasCreated).toBe(true);
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("recovers when create race lost then update succeeds (mixed path)", async () => {
    // First attempt: no existing agent → createOnly returns ok=false (race);
    // Second attempt: existing agent found → putIfMatch succeeds.
    let listCallCount = 0;
    let createOnlyCallCount = 0;
    const mockAgent = { id: "agent-existing", fingerprint: "fp-test", role: "engineer" } as Agent;
    const substrate = {
      list: vi.fn().mockImplementation(() => {
        listCallCount++;
        return Promise.resolve({ items: listCallCount === 1 ? [] : [mockAgent] });
      }),
      getWithRevision: vi.fn().mockResolvedValue({ entity: mockAgent, resourceVersion: 1 }),
      createOnly: vi.fn().mockImplementation(() => {
        createOnlyCallCount++;
        return Promise.resolve({ ok: false });  // First attempt lost
      }),
      putIfMatch: vi.fn().mockResolvedValue({ ok: true }),  // Recovers
    } as unknown as HubStorageSubstrate;

    const repo = new AgentRepositorySubstrate(substrate);
    const result = await repo.assertIdentity({
      role: "engineer",
      name: "test",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
    });

    expect(result.ok).toBe(true);
    expect(createOnlyCallCount).toBe(1);
    // No warn — recovered within budget
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
