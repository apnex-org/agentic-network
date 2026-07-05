/**
 * curation.ts — mission-102 P3-B2: the append-only curation model (design §2,
 * RATIFIED at G2; work-116).
 *
 * The anti-laundering layer: what the Director is SHOWN is a derived view, and
 * the derivation is fully auditable —
 *
 *   RawDecisionRaised — the IMMUTABLE capture of exactly what was raised
 *   (minted atomically with the Decision, never updated, never deleted:
 *   disposal and merge remove nothing from the raw feed — contract test 8).
 *
 *   CurationRecord — one append-only row per curation act (reword, reclassify,
 *   merge, dispose, route-self-disposal): before→after of the touched fields,
 *   session-stamped curator, basis (incl. the B9 compound-value rationale),
 *   source raw ids, and the grant citation on self-disposal routes.
 *
 * The curated Decision row is the derived view; laundering is visible by
 * CONSTRUCTION via the §2 queries (raw-vs-presented diff, class-changed,
 * per-grant classifications, merge lineage, SLO breaches — contract test 2).
 */
import type { DecisionActor, DecisionContextRef, DecisionOption } from "./decision.js";

/** The immutable raise capture. Field-for-field what the raiser submitted —
 *  NOT a pointer to the (mutable) Decision row. */
export interface RawDecisionRaised {
  id: string;
  decisionId: string;
  title: string;
  context: string;
  class: string | null;
  options: DecisionOption[];
  contextRefs: DecisionContextRef[];
  raisedBy: DecisionActor;
  raisedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type CurationAct =
  | "curate"          // raised→curated, incl. any class/title/context change
  | "merge"           // this decision merged INTO another
  | "dispose"         // curation-window disposal
  | "route-self-disposal"; // routed under a grant citation (the §2 packet hook)

export interface CurationRecord {
  id: string;
  decisionId: string;
  act: CurationAct;
  /** The touched fields only: {field: {before, after}}. Empty for acts that
   *  change no presented content (a pure state move). */
  changes: Record<string, { before: unknown; after: unknown }>;
  curator: DecisionActor;
  /** Why — incl. the B9 compound-value rationale on merges/disposals. */
  basis: string;
  /** Every raw id this act draws from (merge target lists ALL constituents —
   *  minority claims stay reachable through their own raw rows). */
  sourceRawIds: string[];
  /** ClassGrant citation, REQUIRED on route-self-disposal (design §2). */
  grantCitation: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ICurationStore {
  /** Mint the immutable raw capture (called by raiseDecision — one per raise). */
  mintRaw(input: Omit<RawDecisionRaised, "id" | "createdAt" | "updatedAt">): Promise<RawDecisionRaised>;
  getRawForDecision(decisionId: string): Promise<RawDecisionRaised | null>;
  /** The raw FEED over a time interval — EXACT (paged, deterministic order),
   *  complete including decisions since disposed/merged (contract test 8). */
  listRawInterval(fromISO: string, toISO: string): Promise<RawDecisionRaised[]>;
  /** Append one curation record. Records are never updated or deleted. */
  record(input: Omit<CurationRecord, "id" | "createdAt" | "updatedAt">): Promise<CurationRecord>;
  listRecordsForDecision(decisionId: string): Promise<CurationRecord[]>;
  /** ALL records — exact paged scan; the query layer filters (presenter volume). */
  listAllRecords(): Promise<CurationRecord[]>;
  /** ALL raw captures — one exact scan so per-decision joins are O(n), not n scans. */
  listAllRaws(): Promise<RawDecisionRaised[]>;
}
