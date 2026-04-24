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
// Mission-47 W2/W4/W5: GcsIdeaStore + GcsMissionStore + GcsTaskStore +
// GcsProposalStore deleted — their concurrency is now exercised via
// the storage-provider conformance suite (CAS primitive) plus the
// Repository-class casUpdate loops. Obsolete reproduction blocks
// removed. GcsTurnStore reproduction stays (W7 — only entity not yet migrated).
const { GcsTurnStore } = await import("../../src/entities/gcs/gcs-turn.js");

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


// Mission-47 W5/W6: GcsTaskStore + GcsProposalStore + GcsThreadStore
// sections removed — now TaskRepository + ProposalRepository +
// ThreadRepository, exercised via the @ois/storage-provider conformance
// suite + Repository casUpdate loops.

