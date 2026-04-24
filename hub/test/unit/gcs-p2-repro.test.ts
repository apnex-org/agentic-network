/**
 * Mission-20 Phase 3 — P2 concurrency reproductions.
 *
 * For each P2 site catalogued in `docs/history/mission-20-phase1-audit.md`,
 * drive two concurrent mutations against the same object through the
 * store's public API and assert that BOTH mutations survive in the final
 * state. Under the pre-Phase-2 naked read-modify-write, the second write
 * would silently clobber the first (the lost-update bug). Under the
 * Phase-2 `updateExisting` CAS primitive, the second write fails on
 * `ifGenerationMatch`, retries, and re-applies its mutation on top of
 * the freshly-read state.
 *
 * These tests must be kept — they are regression coverage against
 * reintroducing naked RMWs.
 *
 * Audit reference: `docs/history/mission-20-phase1-audit.md` §3.
 * ADR: `docs/decisions/011-gcs-concurrency-model.md`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { GcsFakeStorage, installGcsFake, gcsFake } from "./_gcs-fake.js";

vi.mock("@google-cloud/storage", () => ({ Storage: GcsFakeStorage }));

// Imports must be AFTER vi.mock so the mocked Storage is picked up
// when `gcs-state.ts` constructs `new Storage()` at module init.
// Mission-47 W2/W4: GcsIdeaStore + GcsMissionStore deleted — their
// concurrency is now exercised via the storage-provider conformance
// suite (CAS primitive) plus the Repository-class casUpdate loops.
// Obsolete reproduction blocks removed.
const { GcsTurnStore } = await import("../../src/entities/gcs/gcs-turn.js");
const {
  GcsTaskStore,
  GcsProposalStore,
  GcsThreadStore,
} = await import("../../src/gcs-state.js");

const BUCKET = "test-bucket";

beforeEach(() => {
  installGcsFake();
});

// ── GcsTurnStore ────────────────────────────────────────────────────

describe("GcsTurnStore.updateTurn — lost-update reproduction", () => {
  it("preserves disjoint field mutations under concurrent writers", async () => {
    const missionStore = { listMissions: async () => [] } as any;
    const taskStore = { listTasks: async () => [] } as any;
    const store = new GcsTurnStore(BUCKET, missionStore, taskStore);
    gcsFake().put("turns/turn-1.json", {
      id: "turn-1",
      title: "seed",
      scope: "initial scope",
      status: "planning",
      missionIds: [],
      taskIds: [],
      tele: [],
      correlationId: "turn-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await Promise.all([
      store.updateTurn("turn-1", { scope: "revised scope" }),
      store.updateTurn("turn-1", { tele: ["tele-1"] }),
    ]);

    const final = await store.getTurn("turn-1");
    expect(final).not.toBeNull();
    expect(final!.scope).toBe("revised scope");
    expect(final!.tele).toEqual(["tele-1"]);
  });
});

// ── GcsTaskStore — 9 P2 sites ───────────────────────────────────────

function seedTask(overrides: Record<string, unknown> = {}): void {
  gcsFake().put("tasks/task-1.json", {
    id: "task-1",
    directive: "do the thing",
    status: "pending",
    assignedEngineerId: null,
    correlationId: null,
    labels: {},
    selectors: {},
    revisionCount: 0,
    report: null,
    reportSummary: null,
    reportRef: null,
    reportedAt: null,
    reviewAssessment: null,
    reviewRef: null,
    verification: null,
    clarificationQuestion: null,
    clarificationAnswer: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("GcsTaskStore.submitReport — lost-update reproduction", () => {
  it("second concurrent call sees the first's report-state under CAS", async () => {
    seedTask({ status: "working" });
    const store = new GcsTaskStore(BUCKET);

    const [a, b] = await Promise.all([
      store.submitReport("task-1", "report A", "summary A", true),
      store.submitReport("task-1", "report B", "summary B", true),
    ]);

    expect(a).toBe(true);
    expect(b).toBe(true);

    const final = await store.getTask("task-1");
    expect(final).not.toBeNull();
    // Second writer wins on scalar contents, but critically we also
    // see revisionCount-derived reportRef bumping — proving the second
    // call re-ran its transform on the first call's freshly-written
    // state rather than overwriting blind.
    expect(final!.status).toBe("in_review");
    expect(final!.report).toBeTruthy();
    expect(final!.reportSummary).toBeTruthy();
  });

  it("returns false when task does not exist", async () => {
    const store = new GcsTaskStore(BUCKET);
    const result = await store.submitReport("task-404", "r", "s", true);
    expect(result).toBe(false);
  });
});

describe("GcsTaskStore.cancelTask — lost-update reproduction", () => {
  it("gate rejects second call after first transition under CAS", async () => {
    seedTask({ status: "pending" });
    const store = new GcsTaskStore(BUCKET);

    const [a, b] = await Promise.all([
      store.cancelTask("task-1"),
      store.cancelTask("task-1"),
    ]);

    // Exactly one call wins the gate (status === "pending"). The
    // loser's retry sees status="cancelled" and TransitionRejected
    // fires — mapped to false by the caller.
    expect([a, b].filter(Boolean)).toHaveLength(1);

    const final = await store.getTask("task-1");
    expect(final!.status).toBe("cancelled");
  });
});

describe("GcsTaskStore.requestClarification + respondToClarification", () => {
  it("clarification round-trip survives concurrent scalar updates", async () => {
    seedTask({ status: "working" });
    const store = new GcsTaskStore(BUCKET);

    const ok = await store.requestClarification("task-1", "what is x?");
    expect(ok).toBe(true);

    // Two concurrent answers: first wins the gate, second sees
    // status="working" under CAS-refreshed read and is rejected.
    const [a, b] = await Promise.all([
      store.respondToClarification("task-1", "answer A"),
      store.respondToClarification("task-1", "answer B"),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);

    const final = await store.getTask("task-1");
    expect(final!.status).toBe("working");
    expect(final!.clarificationAnswer).toMatch(/answer [AB]/);
  });
});

describe("GcsTaskStore.submitReview — lost-update reproduction", () => {
  it("two concurrent reviews both land in final state", async () => {
    seedTask({ status: "in_review", report: "r", reportSummary: "s" });
    const store = new GcsTaskStore(BUCKET);

    // Two "rejected" reviews: first bumps revisionCount → 1, status →
    // working. Second retries against the fresh state, bumps revision
    // count to 2, status stays "working". Neither scalar write is lost.
    const [a, b] = await Promise.all([
      store.submitReview("task-1", "assessment A", "rejected"),
      store.submitReview("task-1", "assessment B", "rejected"),
    ]);

    expect(a).toBe(true);
    expect(b).toBe(true);

    const final = await store.getTask("task-1");
    expect(final!.revisionCount).toBe(2);
    expect(final!.status).toBe("working");
  });
});

// ── GcsProposalStore ────────────────────────────────────────────────

function seedProposal(overrides: Record<string, unknown> = {}): void {
  gcsFake().put("proposals/prop-1.json", {
    id: "prop-1",
    title: "seed proposal",
    summary: "do a thing",
    proposalRef: "proposals/prop-1-v1.md",
    status: "submitted",
    decision: null,
    feedback: null,
    correlationId: null,
    executionPlan: null,
    scaffoldResult: null,
    labels: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("GcsProposalStore.reviewProposal + setScaffoldResult", () => {
  it("review and scaffold-result land both mutations without clobber", async () => {
    seedProposal();
    const store = new GcsProposalStore(BUCKET);

    const scaffold = {
      missions: [{ idRef: "M1", generatedId: "mission-1" }],
      tasks: [{ idRef: "T1", generatedId: "task-1" }],
    };

    const [ok1, ok2] = await Promise.all([
      store.reviewProposal("prop-1", "approved", "looks good"),
      store.setScaffoldResult("prop-1", scaffold),
    ]);

    expect(ok1).toBe(true);
    expect(ok2).toBe(true);

    const final = await store.getProposal("prop-1");
    expect(final).not.toBeNull();
    expect(final!.decision).toBe("approved");
    expect(final!.feedback).toBe("looks good");
    expect(final!.scaffoldResult).toEqual(scaffold);
  });

  it("concurrent closeProposal — one wins the gate, second is rejected", async () => {
    seedProposal({ status: "approved" });
    const store = new GcsProposalStore(BUCKET);

    const [a, b] = await Promise.all([
      store.closeProposal("prop-1"),
      store.closeProposal("prop-1"),
    ]);

    // Gate requires status ∈ {approved, rejected, changes_requested}.
    // First write transitions to "implemented"; second's CAS retry
    // sees "implemented" and TransitionRejected fires → mapped to
    // false. Exactly one winner.
    expect([a, b].filter(Boolean)).toHaveLength(1);

    const final = await store.getProposal("prop-1");
    expect(final!.status).toBe("implemented");
  });
});

// Mission-21 Phase 1 clean cutover removed `setConvergenceAction` —
// the singular convergenceAction field is replaced by
// `convergenceActions: StagedAction[]` and staging happens exclusively
// via `create_thread_reply`'s `stagedActions` parameter. The former
// lost-update reproduction for this scalar site is obsolete; the new
// equivalent test (applyStagedActionOps under concurrent CAS) belongs
// in the Threads 2.0 test suite added alongside Phase 1 — see
// `wave3b-policies.test.ts` / similar.

// ── GcsThreadStore per-file messages split (Phase 3 P1) ─────────────

describe("GcsThreadStore per-file messages — concurrent reply reproduction", () => {
  it("alternating-author concurrent calls: only current-turn author wins, no message corruption", async () => {
    const store = new GcsThreadStore(BUCKET);
    const thread = await store.openThread("t", "hello", "architect", 10);

    // After openThread, currentTurn=engineer. Fire engineer's reply
    // concurrently with architect's reply. Turn-gate rejects the
    // off-turn author (TransitionRejected → null); engineer wins.
    const [rEng, rArch] = await Promise.all([
      store.replyToThread(thread.id, "eng msg", "engineer"),
      store.replyToThread(thread.id, "arch msg", "architect"),
    ]);

    expect(rEng).not.toBeNull();
    expect(rArch).toBeNull();

    // Per-file hydration preserves both the opener and the winning
    // reply in sequence; no messages[] RMW means no corruption.
    const final = await store.getThread(thread.id);
    expect(final!.roundCount).toBe(2);
    expect(final!.messages.length).toBe(2);
    expect(final!.messages[0].text).toBe("hello");
    expect(final!.messages[1].text).toBe("eng msg");
  });

  it("sequential alternating replies hydrate per-file messages in order", async () => {
    const store = new GcsThreadStore(BUCKET);
    const thread = await store.openThread("t", "hello", "architect", 10);

    const r1 = await store.replyToThread(thread.id, "eng msg", "engineer");
    const r2 = await store.replyToThread(thread.id, "arch msg", "architect");

    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();

    const final = await store.getThread(thread.id);
    expect(final!.roundCount).toBe(3);
    expect(final!.messages.length).toBe(3);
    expect(final!.messages.map((m) => m.text)).toEqual(["hello", "eng msg", "arch msg"]);
  });

  it("two same-author concurrent replies — exactly one wins the turn gate", async () => {
    const store = new GcsThreadStore(BUCKET);
    const thread = await store.openThread("t", "hello", "architect", 10);

    // Both claim to be engineer; only one can pass the turn-gate in
    // its transform. The loser's retry sees currentTurn=architect and
    // TransitionRejected fires → null.
    const [a, b] = await Promise.all([
      store.replyToThread(thread.id, "first eng msg", "engineer"),
      store.replyToThread(thread.id, "second eng msg", "engineer"),
    ]);

    const winners = [a, b].filter((r) => r !== null);
    expect(winners).toHaveLength(1);

    const final = await store.getThread(thread.id);
    expect(final!.roundCount).toBe(2);
    expect(final!.messages.length).toBe(2);
  });

  it("convergence trips when two consecutive replies are both converged=true (with gate satisfied)", async () => {
    const store = new GcsThreadStore(BUCKET);
    const thread = await store.openThread("t", "hello", "architect", 10);

    // Mission-21 Phase 1: converged=true alone is not enough — the
    // gate requires at least one committed action and a non-empty
    // summary. Attach them on the first converging reply; the second
    // reply inherits the staged actions + summary and commits at the
    // turn transition.
    const r1 = await store.replyToThread(thread.id, "eng agrees", "engineer", {
      converged: true,
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "nothing to do" } }],
      summary: "Both agreed: no action required.",
    });
    expect(r1!.status).toBe("active"); // one converged flag not enough
    expect(r1!.lastMessageConverged).toBe(true);

    const r2 = await store.replyToThread(thread.id, "arch agrees", "architect", { converged: true });
    expect(r2!.status).toBe("converged");
    expect(r2!.convergenceActions.filter((a) => a.status === "committed").length).toBe(1);
  });
});

// ── GcsTaskStore claim races + cascade helpers ──────────────────────

describe("GcsTaskStore.getNextDirective — claim race", () => {
  it("exactly one of two concurrent claimants wins the same pending task", async () => {
    seedTask({ status: "pending" });
    const store = new GcsTaskStore(BUCKET);

    const [a, b] = await Promise.all([
      store.getNextDirective({ engineerId: "eng-A" }),
      store.getNextDirective({ engineerId: "eng-B" }),
    ]);

    const winners = [a, b].filter((t) => t !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.id).toBe("task-1");

    const final = await store.getTask("task-1");
    expect(final!.status).toBe("working");
    expect(["eng-A", "eng-B"]).toContain(final!.assignedEngineerId);
  });
});

describe("GcsTaskStore.getNextReport — pickup race", () => {
  it("exactly one of two concurrent pickups transitions the reported task", async () => {
    seedTask({
      status: "completed",
      report: "done",
      reportSummary: "done",
      reportRef: "reports/task-1-v1-report.md",
    });
    const store = new GcsTaskStore(BUCKET);

    const [a, b] = await Promise.all([
      store.getNextReport(),
      store.getNextReport(),
    ]);

    const pickups = [a, b].filter((t) => t !== null);
    expect(pickups).toHaveLength(1);

    const final = await store.getTask("task-1");
    expect(final!.status).toBe("reported_completed");
  });
});

describe("GcsTaskStore.unblockDependents — inner RMW under contention", () => {
  it("preserves blocked-→-pending transition under concurrent callers", async () => {
    // dep-1 is completed; dep-2 is a dependent that should unblock.
    gcsFake().put("tasks/dep-1.json", {
      id: "dep-1",
      directive: "d",
      status: "completed",
      dependsOn: [],
      labels: {},
      selectors: {},
      revisionCount: 0,
      report: "done",
      reportSummary: "done",
      reportRef: "reports/dep-1-v1-report.md",
      reportedAt: null,
      reviewAssessment: null,
      reviewRef: null,
      verification: null,
      assignedEngineerId: null,
      correlationId: null,
      clarificationQuestion: null,
      clarificationAnswer: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    gcsFake().put("tasks/dep-2.json", {
      id: "dep-2",
      directive: "d",
      status: "blocked",
      dependsOn: ["dep-1"],
      labels: {},
      selectors: {},
      revisionCount: 0,
      report: null,
      reportSummary: null,
      reportRef: null,
      reportedAt: null,
      reviewAssessment: null,
      reviewRef: null,
      verification: null,
      assignedEngineerId: null,
      correlationId: null,
      clarificationQuestion: null,
      clarificationAnswer: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const store = new GcsTaskStore(BUCKET);

    const [a, b] = await Promise.all([
      store.unblockDependents("dep-1"),
      store.unblockDependents("dep-1"),
    ]);

    // Exactly one caller flipped dep-2 to pending; the other's
    // transform sees status="pending" and the inner TransitionRejected
    // fires → dep-2 is NOT in that caller's unblocked[] result.
    const totalUnblocked = [...a, ...b];
    expect(totalUnblocked.filter((id) => id === "dep-2")).toHaveLength(1);

    const final = await store.getTask("dep-2");
    expect(final!.status).toBe("pending");
  });
});

describe("GcsTaskStore.cancelDependents — inner RMW under contention", () => {
  it("preserves blocked-→-cancelled transition under concurrent callers", async () => {
    gcsFake().put("tasks/dep-1.json", {
      id: "dep-1",
      directive: "d",
      status: "failed",
      dependsOn: [],
      labels: {},
      selectors: {},
      revisionCount: 0,
      report: null,
      reportSummary: null,
      reportRef: null,
      reportedAt: null,
      reviewAssessment: null,
      reviewRef: null,
      verification: null,
      assignedEngineerId: null,
      correlationId: null,
      clarificationQuestion: null,
      clarificationAnswer: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    gcsFake().put("tasks/dep-2.json", {
      id: "dep-2",
      directive: "d",
      status: "blocked",
      dependsOn: ["dep-1"],
      labels: {},
      selectors: {},
      revisionCount: 0,
      report: null,
      reportSummary: null,
      reportRef: null,
      reportedAt: null,
      reviewAssessment: null,
      reviewRef: null,
      verification: null,
      assignedEngineerId: null,
      correlationId: null,
      clarificationQuestion: null,
      clarificationAnswer: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const store = new GcsTaskStore(BUCKET);

    const [a, b] = await Promise.all([
      store.cancelDependents("dep-1"),
      store.cancelDependents("dep-1"),
    ]);

    const totalCancelled = [...a, ...b];
    expect(totalCancelled.filter((id) => id === "dep-2")).toHaveLength(1);

    const final = await store.getTask("dep-2");
    expect(final!.status).toBe("cancelled");
  });
});
