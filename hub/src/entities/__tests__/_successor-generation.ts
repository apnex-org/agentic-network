// 🔴 idea-640 — THE AFFORDANCE THE SUITE LOST WHEN `revise_work` WAS RETIRED.
//
// WHY THIS FILE EXISTS. Retiring `revise_work` removed no BEHAVIOUR — supersession, generation heads
// and successor resolution all still work. What it removed was **the only repo-API route to CREATE a
// successor generation**. Three independent test files, none of them about revision, reached for that
// verb purely because nothing else could produce a gen-2 to test against:
//
//   legacy-projection-per-row-v4    subject: getCurrentWork returns the SUCCESSOR, not the predecessor
//   work-revision-storage-pg        subject: recommitRevisionSet + restart across a real PostgreSQL
//   d3-revision-authority-matrix    subject: recommitRevisionSet authority (architect/Director only)
//
// Every one of those properties SURVIVES the retirement. Only their scaffolding died. Deleting them
// because their setup got harder is how coverage quietly leaves with a verb — the same trap as
// deleting a verb that has a guard hidden inside it, one layer up.
//
// So the storage-layer construction is paid ONCE here rather than three times inline, and any future
// test of supersession has somewhere to reach. This is a TEST-ONLY helper: it drives the same
// `buildWorkRevisionStorageV4` → persist → activate sequence the production revision path used, with
// no authority checks, because authority is the SUBJECT of the tests that call it and must not be
// pre-satisfied by their own fixture.
import type { WorkItem } from "../work-item.js";
import {
  WorkRevisionStorageRepositoryV4,
  buildWorkRevisionStorageV4,
  type WorkRevisionFamilyRowV4,
  type FamilyScopeV4,
} from "../work-revision-storage-v4.js";

export interface SuccessorGenerationArgs {
  storage: WorkRevisionStorageRepositoryV4;
  /** The rows AS THEY SHOULD EXIST in the new generation (successors included, by physical id). */
  workItems: WorkItem[];
  generation: number;
  previousGeneration: number;
  operationId: string;
  createdAt: string;
  /** Families carried forward from the prior generation, keyed by LOGICAL id. */
  existingFamiliesByLogicalId?: Record<string, WorkRevisionFamilyRowV4>;
  /** Defaults to one mission scope for every row — override only when scope is the subject. */
  familyScope?: FamilyScopeV4;
  /**
   * Logical ids left PENDING RECOMMIT on the operation. `reviseWork` populated this when it
   * published a generation, and `recommitRevisionSet` refuses to act without it: with an empty
   * pending set it falls into its REPLAY branch and throws "no matching pending recommit set".
   * Each named row must bind a PAUSED, UNLEASED successor (enforced by the builder).
   */
  recommitSet?: readonly string[];
}

/**
 * Build, persist and ACTIVATE one generation containing `workItems`.
 *
 * Returns the built storage so a caller can read `families` / bindings for the next generation —
 * the successor chain is explicit rather than hidden, which is the property most of these tests are
 * actually about.
 */
export async function buildSuccessorGeneration(args: SuccessorGenerationArgs) {
  const scope: FamilyScopeV4 = args.familyScope ?? { kind: "mission", id: "mission-140" };
  // 🔴 REVISION ALLOCATION — the step `reviseWork` performed that is easy to miss when hand-rolling a
  // successor. A carried-forward family refuses any row whose `revision` exceeds its
  // `latestAllocatedRevision` (`storage.integrity: <id> disagrees with immutable family`). The verb
  // allocated the revision BEFORE building; a caller reconstructing a generation must do the same.
  // Doing it HERE is the whole point of the helper: this is precisely the knowledge that died with
  // the verb, and leaving it to each call site would rebuild the trap three times.
  const families = args.existingFamiliesByLogicalId
    ? Object.fromEntries(Object.entries(args.existingFamiliesByLogicalId).map(([logicalId, family]) => {
        const highest = Math.max(
          family.latestAllocatedRevision,
          ...args.workItems
            .filter((i) => ((i as { logicalId?: string }).logicalId ?? i.id) === logicalId)
            .map((i) => (i as { revision?: number }).revision ?? 1),
        );
        return [logicalId, { ...family, latestAllocatedRevision: highest }];
      }))
    : undefined;
  const built = buildWorkRevisionStorageV4({
    workItems: args.workItems,
    boundReferencesByPhysicalId: Object.fromEntries(args.workItems.map((i) => [i.id, i.boundReferences ?? []])),
    familyScopesByPhysicalId: Object.fromEntries(args.workItems.map((i) => [i.id, scope])),
    ...(families ? { existingFamiliesByLogicalId: families } : {}),
    ...(args.recommitSet ? { recommitSet: args.recommitSet } : {}),
    generation: args.generation,
    previousGeneration: args.previousGeneration,
    operationId: args.operationId,
    createdAt: args.createdAt,
  });
  await args.storage.persistPrepared(built);
  await args.storage.persistProjectedWorkItems(built);
  await args.storage.activateGeneration(args.generation, args.operationId, args.createdAt);
  return built;
}
