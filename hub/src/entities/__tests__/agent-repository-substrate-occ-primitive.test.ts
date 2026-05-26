/**
 * mission-89 Phase 2 (bug-127 systemic-close) — assertIdentity OCC primitive
 * migration tests.
 *
 * Replaces mission-88 W10-ext retry-budget test surface (agent-repository-
 * substrate-w10-ext-occ.test.ts). Per Design v1.0 §3 Phase 2:
 *   - Lock-serialized lookup + mutate path (no retry-loop)
 *   - createOnly path on first-contact (lock held; succeeds)
 *   - Defensive occ_contention_exhausted path on createOnly conflict under
 *     advisory-lock (hash-collision; transient)
 *   - role_mismatch + name_collision security boundaries preserved
 *
 * Mock-substrate covers the per-callsite shape + branch coverage. Real-pg
 * contention serialization is verified at the testcontainer integration
 * suite (agent-repository-substrate-occ-integration.test.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentRepositorySubstrate } from "../agent-repository-substrate.js";
import type { HubStorageSubstrate } from "../../storage-substrate/index.js";
import type { Agent } from "../../state.js";

interface MockSubstrate {
  substrate: HubStorageSubstrate;
  withAdvisoryLockCalls: Array<{ lockClass: number; lockKey: number }>;
  putIfMatchOutcomes: { ok: boolean }[];
  createOnlyOk: boolean;
}

function makeMockSubstrate(opts: {
  putIfMatchOk?: boolean;
  createOnlyOk?: boolean;
  hasExistingAgent?: boolean;
}): MockSubstrate {
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

  const out: MockSubstrate = {
    substrate: undefined as unknown as HubStorageSubstrate,
    withAdvisoryLockCalls: [],
    putIfMatchOutcomes: [],
    createOnlyOk: opts.createOnlyOk ?? true,
  };

  out.substrate = {
    withAdvisoryLock: vi.fn().mockImplementation(
      async <T,>(lockClass: number, lockKey: number, fn: () => Promise<T>) => {
        out.withAdvisoryLockCalls.push({ lockClass, lockKey });
        return fn();
      },
    ),
    list: vi.fn().mockResolvedValue({
      items: opts.hasExistingAgent ? [mockAgent] : [],
    }),
    getWithRevision: vi.fn().mockResolvedValue(
      opts.hasExistingAgent ? { entity: mockAgent, resourceVersion: 1 } : null,
    ),
    createOnly: vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: out.createOnlyOk }),
    ),
    putIfMatch: vi.fn().mockResolvedValue({ ok: opts.putIfMatchOk ?? true }),
  } as unknown as HubStorageSubstrate;

  return out;
}

describe("assertIdentity — primitive migration (bug-127 systemic close)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("invokes substrate.withAdvisoryLock with LOCK_CLASS.assertIdentity (=1) + hashed fingerprint", async () => {
    const mock = makeMockSubstrate({ hasExistingAgent: false, createOnlyOk: true });
    const repo = new AgentRepositorySubstrate(mock.substrate);

    await repo.assertIdentity({
      role: "engineer",
      name: "test",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
    });

    expect(mock.withAdvisoryLockCalls).toHaveLength(1);
    expect(mock.withAdvisoryLockCalls[0].lockClass).toBe(1);
    // hashed fingerprint must be int32 range
    const hashedKey = mock.withAdvisoryLockCalls[0].lockKey;
    expect(Number.isInteger(hashedKey)).toBe(true);
    expect(hashedKey).toBeGreaterThanOrEqual(-(2 ** 31));
    expect(hashedKey).toBeLessThanOrEqual(2 ** 31 - 1);
  });

  it("creates Agent on first-contact (no existing; createOnly succeeds under lock)", async () => {
    const mock = makeMockSubstrate({ hasExistingAgent: false, createOnlyOk: true });
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
  });

  it("refreshes existing Agent on second-contact (getWithRevision + putIfMatch succeed under lock)", async () => {
    const mock = makeMockSubstrate({ hasExistingAgent: true, putIfMatchOk: true });
    const repo = new AgentRepositorySubstrate(mock.substrate);

    const result = await repo.assertIdentity({
      role: "engineer",
      name: "test",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.wasCreated).toBe(false);
    }
  });

  it("returns occ_contention_exhausted (NOT role_mismatch) when createOnly conflicts under lock (defensive)", async () => {
    // Lock-serialized but createOnly returns conflict — possible via hash-
    // collision across distinct fingerprints; surface as transient.
    const mock = makeMockSubstrate({ hasExistingAgent: false, createOnlyOk: false });
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
      expect(result.message).toMatch(/hash-collision/);
    }
  });

  it("returns occ_contention_exhausted when putIfMatch conflicts under lock (non-assertIdentity concurrent writer)", async () => {
    const mock = makeMockSubstrate({ hasExistingAgent: true, putIfMatchOk: false });
    const repo = new AgentRepositorySubstrate(mock.substrate);

    const result = await repo.assertIdentity({
      role: "engineer",
      name: "test",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("occ_contention_exhausted");
      expect(result.message).toMatch(/non-assertIdentity concurrent writer/);
    }
  });

  it("preserves role_mismatch security boundary (lock does not bypass FATAL_CODES discipline)", async () => {
    const mock = makeMockSubstrate({ hasExistingAgent: true });
    const repo = new AgentRepositorySubstrate(mock.substrate);

    // Existing agent has role=engineer; payload says architect → mismatch
    const result = await repo.assertIdentity({
      role: "architect",
      name: "test",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("role_mismatch");
    }
  });

  it("no retry-loop side-effects (substrate.list called exactly once per assertIdentity)", async () => {
    const mock = makeMockSubstrate({ hasExistingAgent: true, putIfMatchOk: true });
    const repo = new AgentRepositorySubstrate(mock.substrate);

    await repo.assertIdentity({
      role: "engineer",
      name: "test",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
    });

    // Lock-serialized → no W10-ext-style retry-loop iterations
    expect(mock.substrate.list).toHaveBeenCalledTimes(1);
    expect(mock.substrate.putIfMatch).toHaveBeenCalledTimes(1);
  });
});
