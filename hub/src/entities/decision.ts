/**
 * decision.ts — mission-102 P3-B1: the Decision entity (design.md v1.0 §1.1, RATIFIED
 * at G2, canonical git 64de1bf).
 *
 * A Decision is a SOVEREIGN authority-resolution node — the T4 formulation ("a decision
 * is a sub-work-item that requires resolution") with exactly ONE concern: capturing a
 * raised question, its curation, its routing, and its resolution as durable state.
 *
 * What a Decision is NOT (design §1.1, the A2 lesson):
 *  - it has NO lease and NO liveness: a decision pending for days must not depend on any
 *    agent renewing a heartbeat (bug-185/work-111 — parked states were not lease-durable);
 *  - it has NO timer transitions: state moves ONLY by authored, role-gated verbs; timers
 *    EMIT (aging nudges, B6) but never transition (contract test 9);
 *  - it has NO WIP interaction: decisions are authority, not work.
 *
 * FSM: raised → curated → routed → resolved → executed, plus the curation-window exits
 * merged(intoRef) / disposed(reason) / withdrawn. Every raise terminates in exactly one
 * of {resolved, merged, disposed, withdrawn} (contract test 10 — exit totality; resolved
 * continues to executed when the B5 execution slice lands).
 *
 * Slice fences (B1): grants = B3, proof path (DirectorSignal/Confirmation) = B4,
 * execution = B5, arrival surface/snapshots = B6. The resolve verb ships with a
 * fail-closed proof seam (IDecisionProofGate) that B4 fills; production wires the
 * always-reject gate so nothing can resolve without proof machinery.
 */

/** FSM phases. Terminal: executed, merged, disposed, withdrawn. `resolved` is
 *  completion-with-execution-pending (B5 executes; async plans park here with an
 *  explicit executorBinding). */
export type DecisionPhase =
  | "raised" | "curated" | "routed" | "resolved" | "executed"
  | "merged" | "disposed" | "withdrawn";

/** Hub-stamped actor identity (design §1.1: never caller-supplied — the L2 law;
 *  sessionId optional in v1 per the A11 grounding roadmap but IN the schema now). */
export interface DecisionActor {
  agentId: string;
  role: string;
  sessionId?: string;
}

/** One presented option. Plain-text payloads only — the same object must render
 *  inline AND in a dumb CLI (constraint C4, presentation-agnostic). */
export interface DecisionOption {
  id: string;
  label: string;
  description: string;
  preview?: string;
  consequences?: string;
}

/** Typed context reference — the WorkItem references[] shape reused verbatim
 *  (design §1.1: required refs fail-closed validate at raise). */
export interface DecisionContextRef {
  kind: string;
  ref: string;
  storage: "inline" | "git" | "hub-doc" | "entity";
  mode: "read" | "triangulate-against";
  required: boolean;
}

/** Routing target. V1-B1 supports the director queue; the selfDisposal leg is
 *  schema-present but REJECTS at the verb until ClassGrant machinery lands (B3) —
 *  fail-closed, never a silent stub. */
export interface DecisionRoute {
  target: "director" | "self-disposal";
  selfDisposal?: { t5RuleRef?: string; classGrantRef?: string };
}

/** Authority modes (design §1.1). Hub-DERIVED at resolve — never caller-supplied,
 *  no default, no inferred member (S1.2). `verifier-mandate` is reserved-REJECTED
 *  in v1 (deferred list): the schema knows it so migration is data movement, but
 *  resolve refuses it. */
export type AuthorityMode =
  | "director-direct" | "director-via-proxy" | "architect-t5" | "class-grant"
  | "verifier-mandate";

export interface DecisionResolution {
  authorityMode: AuthorityMode;
  /** Grant/directive/signal/confirmation ref — REQUIRED for every mode except
   *  director-direct; must substrate-resolve (the L3 law) — enforced by the proof
   *  gate (B4) and re-checked in the authoritative CAS. */
  authorityRef?: string;
  executor: DecisionActor;
  answer: { chosenOptionId: string } | { customAnswer: string };
  rationale?: string;
  resolvedAt: string;
}

/** Declared-at-route execution plan entry (design §3). B1 stores + ref-validates;
 *  B5 executes. Registry v1: unblock | approve. */
export interface DecisionPlanAction {
  action: "unblock" | "approve";
  targetRef: string;
}

export interface Decision {
  id: string;
  schemaVersion: 1;
  parentRef: { kind: string; id: string } | null;
  /** Ontology class (S1.3 seed). null = unclassified → routing fails closed to
   *  director-direct (design §1.1). */
  class: string | null;
  title: string;
  context: string;
  contextRefs: DecisionContextRef[];
  options: DecisionOption[];
  /** Schema CONSTANT (design §1.1, B2 law): the free-text escape is load-bearing;
   *  the type cannot express a trapped option set. */
  freeAnswerPolicy: "always";
  raisedBy: DecisionActor;
  curatedBy: DecisionActor | null;
  /** Curation content record ref (B2's schema); B1 stamps the transition only. */
  curationRecordRef: string | null;
  routedTo: DecisionRoute | null;
  routedBy: DecisionActor | null;
  resolution: DecisionResolution | null;
  executionPlan: DecisionPlanAction[];
  mergedInto: string | null;
  disposedReason: string | null;
  /** B5: set when a resolved decision's plan execution completed or failed —
   *  {executor, boundAt, ok, results}. A resolved decision with ok=false is the
   *  visible failure-park the aging sweep surfaces (never silent). */
  executorBinding: { executor: DecisionActor; boundAt: string; ok: boolean; results: Array<{ action: string; targetRef: string; ok: boolean; detail: string }> } | null;
  status: DecisionPhase;
  enteredCurrentStateAt: string;
  /** Per-state wall-clock dwell (the WorkItem pattern) — the curation SLO (S3.2)
   *  reads dwell-in-raised; SC3 reads dwell-in-routed. Terminals never dwell. */
  stateDurations: { raised: number; curated: number; routed: number; resolved: number };
  createdAt: string;
  updatedAt: string;
}

/** The B4 proof seam. resolveDecision consults this gate BEFORE the CAS commit;
 *  the gate returns the Hub-DERIVED authority mode + validated ref, or throws.
 *  Production (B1) wires FailClosedProofGate — every call rejects — so no
 *  resolution can exist until the DirectorSignal/Confirmation machinery (B4)
 *  and/or ClassGrant evaluator (B3) supply a real gate. Tests inject a
 *  permissive gate to exercise the FSM. */
export interface IDecisionProofGate {
  evaluate(input: {
    decision: Decision;
    executor: DecisionActor;
    answer: DecisionResolution["answer"];
    claimedAuthorityRef?: string;
  }): Promise<{ authorityMode: AuthorityMode; authorityRef?: string }>;
}

export interface IDecisionStore {
  /** [Any] Mint a Decision in `raised`. Required contextRefs fail-closed validate
   *  (caller passes a resolver); raisedBy is Hub-stamped by the policy layer. */
  raiseDecision(input: {
    parentRef?: { kind: string; id: string } | null;
    class?: string | null;
    title: string;
    context: string;
    contextRefs?: DecisionContextRef[];
    options: DecisionOption[];
    raisedBy: DecisionActor;
  }): Promise<Decision>;
  getDecision(id: string): Promise<Decision | null>;
  listDecisions(filter?: { status?: DecisionPhase; class?: string; routedTarget?: string }): Promise<{ items: Decision[]; truncated: boolean }>;
  /** raised → curated (architect). Stamps curatedBy + optional record ref (B2). */
  curateDecision(id: string, curator: DecisionActor, opts?: { curationRecordRef?: string; class?: string }): Promise<Decision | null>;
  /** curated → routed. B1: target=director only (selfDisposal rejects pending B3).
   *  Unclassified decisions fail closed to the director target. Stores the
   *  execution plan (refs validated by the policy layer). */
  routeDecision(id: string, router: DecisionActor, route: DecisionRoute, executionPlan?: DecisionPlanAction[]): Promise<Decision | null>;
  /** routed → resolved. authorityMode/authorityRef come ONLY from the proof gate
   *  (Hub-derived, L2/L4); verifier-mandate reserved-rejected here regardless of gate. */
  resolveDecision(id: string, executor: DecisionActor, answer: DecisionResolution["answer"], gate: IDecisionProofGate, opts?: { rationale?: string; claimedAuthorityRef?: string }): Promise<Decision | null>;
  /** resolved → executed (B5 drives this; the transition exists for FSM closure). */
  markExecuted(id: string, executor: DecisionActor): Promise<Decision | null>;
  /** B5: record the plan-execution outcome on a RESOLVED decision (the failure-
   *  park record; also written on success just before markExecuted). */
  recordExecutorBinding(id: string, binding: NonNullable<Decision["executorBinding"]>): Promise<Decision | null>;
  /** raised|curated → merged(intoRef). intoRef must resolve to another Decision. */
  mergeDecision(id: string, curator: DecisionActor, intoRef: string): Promise<Decision | null>;
  /** raised|curated → disposed(reason). Auditable curation-window disposal. */
  disposeDecision(id: string, curator: DecisionActor, reason: string): Promise<Decision | null>;
  /** raised|curated → withdrawn. RAISER ONLY (identity check, the bug-219 (c) lesson:
   *  the authoring party gets a sanctioned exit, native from day one). */
  withdrawDecision(id: string, caller: DecisionActor): Promise<Decision | null>;
  /** READ-ONLY aging view for the B6 emit-only sweep (dwell vs thresholds).
   *  Deliberately returns data, never transitions (contract test 9). */
  listAging(nowISO: string, thresholdMs: number): Promise<Decision[]>;
}
