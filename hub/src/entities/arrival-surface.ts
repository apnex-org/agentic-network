/**
 * arrival-surface.ts — mission-102 P3-B6: the Director arrival-surface entities
 * (design.md v1.0 §1.4 + §4, RATIFIED at G2; canonical git 64de1bf).
 *
 * The delivery-correctness layer — the anti-bug-225 design made law:
 *
 *   DELIVERED = PRESENTED (snapshot membership); ACTED = resolved;
 *   EMITTED counts for nothing.
 *
 * The routed queue is a PURE PULL PROJECTION: the render verb's output is a
 * function of queue state alone, complete with every push channel dead
 * (contract test 4). ArrivalSnapshot is the server-side receipt of a render —
 * recorded BY the pull verb, so no client cooperation or honesty is required
 * (a client cannot fake having rendered; the verb it called wrote the record).
 *
 * NudgeReceipt exists ONLY on the aging-nudge path (D-A1): nudges are the one
 * flow where emission-without-receipt is an SC2 hole at maximum stakes;
 * critical nudges get bounded retry + side-channel escalation.
 *
 * Presence (S3.1): DECLARED away-stints suppress non-critical nudge EMISSION;
 * inference only ever SUPPRESSES, never unsuppresses or reroutes; the first
 * Director activity flips present instantly. Away-mode changes interruption
 * policy, NOT existence or age — backlog accounting is queue state and
 * survives untouched.
 */
import type { DecisionActor } from "./decision.js";

/** One rendered decision row inside a snapshot: the id + the hashes that pin
 *  WHAT was shown (a decision mutated after render is detectable). */
export interface SnapshotEntry {
  decisionId: string;
  promptHash: string;
  status: string;
}

export interface ArrivalSnapshot {
  id: string;
  /** The rendering surface (e.g. "ois-cli", "inline-architect"). */
  surface: string;
  /** Hub-stamped renderer identity (the pulling session). */
  renderedFor: DecisionActor;
  /** The prior snapshot this render advanced from (cursor chain; null = cold start). */
  sinceSnapshotId: string | null;
  /** What the queue held at render: every routed director-target decision. */
  entries: SnapshotEntry[];
  /** Digest counts frozen at render (observability; the digest CONTENT is
   *  recomputed from queue state on every pull — never stored as truth). */
  digest: {
    routedCount: number;
    selfDisposalsSinceCursor: number;
    disposalsSinceCursor: number;
    suppressedNudges: number;
    failureParks: number;
  };
  /** Director markers, set post-render via acknowledge_arrival: ack = seen,
   *  defer = consciously postponed. ACT is never a marker — it is the decision's
   *  own resolved/executed state. */
  ackDecisionIds: string[];
  deferDecisionIds: string[];
  renderedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** "slo" = the B2 curation-SLO breach receipt (rides the same receipt
 *  machinery; never suppressed by presence — an exception, not a nudge). */
export type NudgeLevel = "normal" | "critical" | "slo";

export interface NudgeReceipt {
  id: string;
  decisionId: string;
  level: NudgeLevel;
  /** The emitted message id (the work-54 envelope) — EMISSION evidence only. */
  emittedRef: string | null;
  emittedAt: string;
  /** Set when a subsequent snapshot PRESENTED the decision (delivery = receipt). */
  presentedInSnapshotId: string | null;
  /** Critical path (D-A1): bounded retry count + the side-channel escalation stamp. */
  retryCount: number;
  escalatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Singleton presence row (id = "director-presence"). */
export interface DirectorPresence {
  id: "director-presence";
  state: "present" | "away";
  /** How the current state was entered: declared (a Director/architect verb) or
   *  inferred (inactivity — SUPPRESS-ONLY per S3.1). */
  basis: "declared" | "inferred";
  declaredAt: string;
  expectedReturn: string | null;
  /** The last Director activity the Hub observed (any director-stamped verb). */
  lastDirectorActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IArrivalSurfaceStore {
  /** Record the server-side receipt of a render (called BY the pull verb). */
  recordSnapshot(input: {
    surface: string;
    renderedFor: DecisionActor;
    sinceSnapshotId: string | null;
    entries: SnapshotEntry[];
    digest: ArrivalSnapshot["digest"];
  }): Promise<ArrivalSnapshot>;
  getSnapshot(id: string): Promise<ArrivalSnapshot | null>;
  /** The most recent snapshot for a surface (the cold-start cursor). */
  latestSnapshot(surface: string): Promise<ArrivalSnapshot | null>;
  /** Set ack/defer markers on an existing snapshot (post-render). */
  markSnapshot(id: string, marks: { ack?: string[]; defer?: string[] }): Promise<ArrivalSnapshot | null>;

  mintNudgeReceipt(input: { decisionId: string; level: NudgeLevel; emittedRef: string | null }): Promise<NudgeReceipt>;
  /** Open receipts (not yet presented) for the sweep's retry/escalation pass. */
  openNudgeReceipts(): Promise<NudgeReceipt[]>;
  /** Mark receipts presented when a snapshot renders their decisions. */
  markNudgesPresented(decisionIds: string[], snapshotId: string): Promise<number>;
  /** Bump a critical receipt's retry count / stamp its escalation. */
  bumpNudge(id: string, update: { retryCount?: number; escalatedAt?: string }): Promise<NudgeReceipt | null>;

  getPresence(): Promise<DirectorPresence>;
  /** Declared transitions (verbs). Inferred away is SUPPRESS-ONLY and never
   *  overrides a declared state (S3.1). */
  setPresence(state: "present" | "away", basis: "declared" | "inferred", expectedReturn?: string | null): Promise<DirectorPresence>;
  /** Stamp Director activity (any director-stamped verb); flips away→present
   *  instantly when the away state was INFERRED (a declared away survives until
   *  declared back or activity — per S3.1 the first activity flips present). */
  touchDirectorActivity(): Promise<DirectorPresence>;
}
