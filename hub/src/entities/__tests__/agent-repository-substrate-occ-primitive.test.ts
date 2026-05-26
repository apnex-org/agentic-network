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
import type { Agent, AssertIdentityFailure } from "../../state.js";

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

  it("throws on createOnly conflict under lock (mission-89 P5: structurally unreachable; was occ_contention_exhausted)", async () => {
    // Pre-Phase 5 returned defensive { code: "occ_contention_exhausted" }; post-
    // Phase 5 throws because the path is structurally unreachable under the
    // per-fingerprint advisory lock + same-name→same-fingerprint→same-agentId
    // derivation. Reaching here means substrate-state anomaly or hash collision.
    const mock = makeMockSubstrate({ hasExistingAgent: false, createOnlyOk: false });
    const repo = new AgentRepositorySubstrate(mock.substrate);

    await expect(
      repo.assertIdentity({
        role: "engineer",
        name: "test",
        clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
      }),
    ).rejects.toThrow(/invariant violation: createOnly conflict/);
  });

  it("retries putIfMatch once under lock (mission-89 P5: heartbeat-path concurrent writer)", async () => {
    // Pre-Phase 5 returned defensive { code: "occ_contention_exhausted" } on
    // first putIfMatch failure. Post-Phase 5 does a single in-lock retry:
    // re-read agent + re-attempt putIfMatch. We model this by returning
    // putIfMatch=false then true; the test asserts the call succeeds via retry.
    let putIfMatchCallCount = 0;
    const mockAgent: Agent = {
      id: "agent-test", fingerprint: "fp-test", role: "engineer", name: "test",
      status: "offline", archived: false, sessionEpoch: 0, currentSessionId: null,
      clientMetadata: undefined, advisoryTags: [], labels: {},
      firstSeenAt: "2026-05-24T00:00:00Z", lastSeenAt: "2026-05-24T00:00:00Z",
      livenessState: "offline", lastHeartbeatAt: "2026-05-24T00:00:00Z",
      receiptSla: 3600000, wakeEndpoint: null, activityState: "offline",
      sessionStartedAt: null, lastToolCallAt: null, lastToolCallName: null,
      idleSince: null, workingSince: null, quotaBlockedUntil: null,
      adapterVersion: "", ipAddress: null, restartCount: 0, recentErrors: [],
      restartHistoryMs: [], cognitiveTTL: null, transportTTL: null,
      cognitiveState: "unknown", transportState: "unknown",
    } as unknown as Agent;
    const substrate = {
      withAdvisoryLock: vi.fn().mockImplementation(async <T,>(_c: number, _k: number, fn: () => Promise<T>) => fn()),
      list: vi.fn().mockResolvedValue({ items: [mockAgent] }),
      getWithRevision: vi.fn().mockResolvedValue({ entity: mockAgent, resourceVersion: 1 }),
      createOnly: vi.fn().mockResolvedValue({ ok: true }),
      putIfMatch: vi.fn().mockImplementation(() => {
        putIfMatchCallCount++;
        return Promise.resolve({ ok: putIfMatchCallCount >= 2 });  // fail-then-succeed
      }),
    } as unknown as HubStorageSubstrate;
    const repo = new AgentRepositorySubstrate(substrate);

    const result = await repo.assertIdentity({
      role: "engineer",
      name: "test",
      clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
    });

    expect(result.ok).toBe(true);
    expect(putIfMatchCallCount).toBe(2);  // first failed; retry succeeded
  });

  it("throws on persistent putIfMatch conflict (mission-89 P5: both attempts fail)", async () => {
    // Persistent putIfMatch failure across both attempts → throw rather than
    // emit the retired occ_contention_exhausted code. Signals a contention
    // storm worth investigating telemetry-side.
    const mock = makeMockSubstrate({ hasExistingAgent: true, putIfMatchOk: false });
    const repo = new AgentRepositorySubstrate(mock.substrate);

    await expect(
      repo.assertIdentity({
        role: "engineer",
        name: "test",
        clientMetadata: { clientName: "test", clientVersion: "1.0", proxyName: "test", proxyVersion: "1.0" },
      }),
    ).rejects.toThrow(/in-lock retry exhausted/);
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

  it("AssertIdentityFailure code enum-discriminator retains 'occ_contention_exhausted' (mission-89 P5 Obs-4: emit retired; enum value KEPT @deprecated for backward-compat + regression-grep)", () => {
    // Type-level discriminator coverage: the enum value is still in the union.
    // Pre-mission-89: production paths emitted this code. Post-mission-89 P5:
    // emit retired (paths throw on unreachable invariant violations); enum
    // value retained so legacy callers' discriminator branches still type-check.
    // Formal enum-removal deferred per Design v1.0 §3 Phase 5 Observation 4.
    const failure: AssertIdentityFailure = {
      ok: false,
      code: "occ_contention_exhausted",
      message: "constructed via discriminator-coverage test (no production emit)",
    };
    // Discriminator narrowing exercise — if the enum value were removed,
    // this assertion would fail to type-check (compile-time regression-grep).
    if (failure.code === "occ_contention_exhausted") {
      expect(failure.message).toMatch(/discriminator-coverage/);
    } else {
      expect.fail("type-narrowing did not select the deprecated discriminator branch");
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
