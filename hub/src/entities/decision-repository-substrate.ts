/**
 * decision-repository-substrate.ts — mission-102 P3-B1: the Decision store
 * (design.md v1.0 §1.1, RATIFIED at G2; canonical git 64de1bf).
 *
 * FSM authority layer for the Decision entity. Every transition is an authored,
 * role-gated verb under per-row CAS; there is NO lease, NO sweeper write-path, and
 * NO timer-driven transition (contract test 9) — the A2/bug-185 lesson made law.
 * The single TRANSITIONS table below drives every verb's phase guard, so exit
 * totality (contract test 10) is checkable against one source of truth.
 *
 * Slice fences honored here:
 *  - selfDisposal routing REJECTS pending ClassGrant machinery (B3);
 *  - resolveDecision consults an injected IDecisionProofGate (B4 fills it;
 *    production wires FailClosedProofGate — always rejects);
 *  - markExecuted exists for FSM closure; the atomic execute path is B5;
 *  - listAging is READ-ONLY (the B6 sweep emits, never transitions).
 */
import type {
  Decision,
  DecisionActor,
  DecisionContextRef,
  DecisionOption,
  DecisionPhase,
  DecisionPlanAction,
  DecisionResolution,
  DecisionRoute,
  IDecisionProofGate,
  IDecisionStore,
} from "./decision.js";
import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import { SubstrateCounter } from "./substrate-counter.js";
import { decodeEnvelopeToFlat } from "./shape-helpers.js";

const KIND = "Decision";
const LIST_CAP = 500;
const MAX_CAS_RETRIES = 50;

/** Thrown on any illegal transition, identity failure, or fence rejection. */
export class DecisionTransitionRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionTransitionRejected";
  }
}

/** The single FSM source of truth: state → the set of states it may move to.
 *  Terminals map to the empty set. Contract test 10 (exit totality) asserts every
 *  walk of this table ends in a terminal and every terminal ∈ the ratified set. */
export const DECISION_TRANSITIONS: Readonly<Record<DecisionPhase, readonly DecisionPhase[]>> = {
  raised: ["curated", "merged", "disposed", "withdrawn"],
  curated: ["routed", "merged", "disposed", "withdrawn"],
  // bug-227 (C): routed ALSO exits to disposed — a MISROUTED decision must not
  // pollute the Director queue until someone resolves a mistake (decision-3 was
  // the live specimen). Immutable-destination over un-route (architect-ratified
  // anti-laundering instinct): the misroute stays on the record; the disposal is
  // reason-carrying, audited, and Director-visible in the digest.
  routed: ["resolved", "disposed"],
  resolved: ["executed"],
  executed: [],
  merged: [],
  disposed: [],
  withdrawn: [],
};

/** Terminal states per the ratified design: every raise ends in exactly one of
 *  these (executed is the post-resolution completion; resolved itself is terminal
 *  for totality purposes only while an async plan awaits B5 execution). */
export const DECISION_TERMINALS: readonly DecisionPhase[] = ["executed", "merged", "disposed", "withdrawn"];

const DEFAULT_DWELL = { raised: 0, curated: 0, routed: 0, resolved: 0 };

/** B1 production proof gate: fail-closed. NOTHING resolves until the B4 proof
 *  machinery (DirectorSignal/Confirmation) and/or the B3 grant evaluator supply a
 *  real gate — no assertion-class authority, no default mode (L2/L4 + S1.2). */
export const FailClosedProofGate: IDecisionProofGate = {
  async evaluate(): Promise<never> {
    throw new DecisionTransitionRejected(
      "resolve rejected: authority proof machinery is not yet available (DirectorSignal/Confirmation = slice B4; ClassGrant evaluator = slice B3) — no resolution flows without proof",
    );
  },
};

function cloneDecision(d: Decision): Decision {
  const flat = decodeEnvelopeToFlat(d as unknown as Record<string, unknown>, KIND) as Record<string, unknown>;
  flat.contextRefs = (flat.contextRefs as DecisionContextRef[] | undefined) ?? [];
  flat.options = (flat.options as DecisionOption[] | undefined) ?? [];
  flat.executionPlan = (flat.executionPlan as DecisionPlanAction[] | undefined) ?? [];
  flat.freeAnswerPolicy = "always"; // schema constant — re-asserted at every read boundary
  flat.parentRef = (flat.parentRef as Decision["parentRef"] | undefined) ?? null;
  flat.class = (flat.class as string | null | undefined) ?? null;
  flat.curatedBy = (flat.curatedBy as DecisionActor | null | undefined) ?? null;
  flat.curationRecordRef = (flat.curationRecordRef as string | null | undefined) ?? null;
  flat.routedTo = (flat.routedTo as DecisionRoute | null | undefined) ?? null;
  flat.routedBy = (flat.routedBy as DecisionActor | null | undefined) ?? null;
  flat.resolution = (flat.resolution as DecisionResolution | null | undefined) ?? null;
  flat.mergedInto = (flat.mergedInto as string | null | undefined) ?? null;
  flat.executorBinding = (flat.executorBinding as Decision["executorBinding"] | undefined) ?? null;
  flat.disposedReason = (flat.disposedReason as string | null | undefined) ?? null;
  flat.enteredCurrentStateAt = (flat.enteredCurrentStateAt as string | undefined) ?? (flat.updatedAt as string);
  flat.stateDurations = (flat.stateDurations as Decision["stateDurations"] | undefined) ?? { ...DEFAULT_DWELL };
  return flat as unknown as Decision;
}

/** The WorkItem dwell-accrual pattern, reused: accumulate the exiting state's
 *  wall-clock into its bucket; terminals have no bucket (defensive no-op). The
 *  curation SLO (S3.2) reads the `raised` bucket; SC3 reads `routed`. */
function accrueExiting(d: Decision, nowISO: string): { stateDurations: Decision["stateDurations"]; enteredCurrentStateAt: string } {
  const elapsed = Math.max(0, Date.parse(nowISO) - Date.parse(d.enteredCurrentStateAt ?? d.updatedAt));
  const durations = { ...DEFAULT_DWELL, ...d.stateDurations };
  if (Object.prototype.hasOwnProperty.call(durations, d.status)) {
    (durations as unknown as Record<string, number>)[d.status] += elapsed;
  }
  return { stateDurations: durations, enteredCurrentStateAt: nowISO };
}

export class DecisionRepositorySubstrate implements IDecisionStore {
  /** The B2 curation trail is an OPTIONAL collaborator wired at construction —
   *  when present, every raise mints the immutable RawDecisionRaised capture
   *  and every curation act appends its CurationRecord AT THE REPO LAYER, so
   *  no caller (policy or otherwise) can transition without leaving trail.
   *  Trail writes happen after the committed transition and FAIL LOUD: a
   *  gap surfaces as a verb error, never silently. */
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
    private readonly curation?: import("./curation.js").ICurationStore,
  ) {}

  private async trail(decisionId: string, entry: Omit<import("./curation.js").CurationRecord, "id" | "decisionId" | "sourceRawIds" | "createdAt" | "updatedAt"> & { extraRawIds?: string[] }): Promise<void> {
    if (!this.curation) return;
    const raw = await this.curation.getRawForDecision(decisionId);
    const { extraRawIds, ...rest } = entry;
    await this.curation.record({
      ...rest,
      decisionId,
      sourceRawIds: [...(raw ? [raw.id] : []), ...(extraRawIds ?? [])],
    });
  }

  async raiseDecision(input: {
    parentRef?: { kind: string; id: string } | null;
    class?: string | null;
    title: string;
    context: string;
    contextRefs?: DecisionContextRef[];
    options: DecisionOption[];
    raisedBy: DecisionActor;
  }): Promise<Decision> {
    const num = await this.counter.next("decisionCounter");
    const id = `decision-${num}`;
    const now = new Date().toISOString();
    const d: Decision = {
      id,
      schemaVersion: 1,
      parentRef: input.parentRef ?? null,
      class: input.class ?? null,
      title: input.title,
      context: input.context,
      contextRefs: input.contextRefs ?? [],
      options: input.options,
      freeAnswerPolicy: "always",
      raisedBy: input.raisedBy,
      curatedBy: null,
      curationRecordRef: null,
      routedTo: null,
      routedBy: null,
      resolution: null,
      executionPlan: [],
      mergedInto: null,
      disposedReason: null,
      executorBinding: null,
      status: "raised",
      enteredCurrentStateAt: now,
      stateDurations: { ...DEFAULT_DWELL },
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.substrate.createOnly(KIND, d);
    if (!result.ok) {
      throw new Error(`[DecisionRepositorySubstrate] raiseDecision: counter issued existing ID ${id}; refusing to clobber`);
    }
    console.log(`[DecisionRepositorySubstrate] Decision raised: ${id} ("${input.title}") by ${input.raisedBy.agentId}`);
    if (this.curation) {
      // The immutable raise capture (design §2) — field-for-field what the
      // raiser submitted, minted with the Decision, never touched again.
      await this.curation.mintRaw({
        decisionId: id,
        title: d.title,
        context: d.context,
        class: d.class,
        options: d.options,
        contextRefs: d.contextRefs,
        raisedBy: d.raisedBy,
        raisedAt: now,
      });
    }
    return cloneDecision(d);
  }

  async getDecision(id: string): Promise<Decision | null> {
    const d = await this.substrate.get<Decision>(KIND, id);
    return d ? cloneDecision(d) : null;
  }

  async listDecisions(filter?: { status?: DecisionPhase; class?: string; routedTarget?: string }): Promise<{ items: Decision[]; truncated: boolean }> {
    const substrateFilter: Record<string, unknown> = {};
    if (filter?.status) substrateFilter.status = filter.status;
    if (filter?.class) substrateFilter.class = filter.class;
    if (filter?.routedTarget) substrateFilter["status.routedTo.target"] = filter.routedTarget;
    const { items } = await this.substrate.list<Decision>(KIND, { filter: substrateFilter as never, limit: LIST_CAP });
    return { items: items.map(cloneDecision), truncated: items.length >= LIST_CAP };
  }

  async curateDecision(id: string, curator: DecisionActor, opts?: { curationRecordRef?: string; class?: string; basis?: string }): Promise<Decision | null> {
    const before = await this.getDecision(id);
    const result = await this.tryCasUpdate(id, (d) => {
      this.assertEdge(d, "curated", "curate");
      const nowISO = new Date().toISOString();
      return {
        ...d,
        status: "curated",
        curatedBy: curator,
        curationRecordRef: opts?.curationRecordRef ?? d.curationRecordRef,
        class: opts?.class ?? d.class,
        ...accrueExiting(d, nowISO),
        updatedAt: nowISO,
      };
    });
    if (result && before) {
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      if (opts?.class !== undefined && opts.class !== before.class) changes.class = { before: before.class, after: opts.class };
      await this.trail(id, { act: "curate", changes, curator, basis: opts?.basis ?? "curated", grantCitation: null });
    }
    return result;
  }

  async routeDecision(id: string, router: DecisionActor, route: DecisionRoute, executionPlan?: DecisionPlanAction[]): Promise<Decision | null> {
    const routed = await this.tryCasUpdate(id, (d) => {
      this.assertEdge(d, "routed", "route");
      // B3 (PR #488 finding 2): the selfDisposal leg is live — it MUST cite its
      // authority (classGrantRef or t5RuleRef); the policy layer fail-closed
      // resolves the citation at route time, and the grant gate at resolve time
      // rejects any grant proof the route does not cite (route↔proof tie).
      if (route.target === "self-disposal" && !route.selfDisposal?.classGrantRef && !route.selfDisposal?.t5RuleRef) {
        throw new DecisionTransitionRejected("route rejected: a self-disposal route must cite its authority (selfDisposal.classGrantRef or t5RuleRef)");
      }
      // Unclassified fails closed to the director target (design §1.1).
      if (route.target === "self-disposal" && d.class === null) {
        throw new DecisionTransitionRejected("route rejected: an unclassified decision fails closed to the director — it cannot be self-disposed");
      }
      const nowISO = new Date().toISOString();
      return {
        ...d,
        status: "routed",
        routedTo: route,
        routedBy: router,
        executionPlan: executionPlan ?? [],
        ...accrueExiting(d, nowISO),
        updatedAt: nowISO,
      };
    });
    if (routed && route.target === "self-disposal") {
      // The §2 disposal-packet hook: every self-disposal route leaves a record
      // CITING its grant/rule — per-grant classification queries key off this.
      await this.trail(id, {
        act: "route-self-disposal",
        changes: { routedTo: { before: null, after: route } },
        curator: router,
        basis: "routed for self-disposal under cited authority",
        grantCitation: route.selfDisposal?.classGrantRef ?? route.selfDisposal?.t5RuleRef ?? null,
      });
    }
    return routed;
  }

  async resolveDecision(
    id: string,
    executor: DecisionActor,
    answer: DecisionResolution["answer"],
    gate: IDecisionProofGate,
    opts?: { rationale?: string; claimedAuthorityRef?: string },
  ): Promise<Decision | null> {
    // The proof gate runs OUTSIDE the CAS (it may do async substrate reads), then
    // the CAS re-checks the phase guard authoritatively. The gate's verdict is the
    // ONLY source of authorityMode — the Hub-derived law (S1.2): there is no code
    // path from a caller-supplied mode to the stored resolution.
    const pre = await this.getDecision(id);
    if (!pre) return null;
    this.assertEdge(pre, "resolved", "resolve");
    const proof = await gate.evaluate({ decision: pre, executor, answer, claimedAuthorityRef: opts?.claimedAuthorityRef });
    // verifier-mandate is schema-reserved, verb-REJECTED in v1 (deferred list) —
    // enforced here regardless of what a (test-injected) gate returns.
    if (proof.authorityMode === "verifier-mandate") {
      throw new DecisionTransitionRejected("resolve rejected: authorityMode 'verifier-mandate' is reserved and not a sanctioned v1 mode (deferred: native verifier verdicts)");
    }
    // Every mode except director-direct carries a proof ref (design §1.1).
    if (proof.authorityMode !== "director-direct" && !proof.authorityRef) {
      throw new DecisionTransitionRejected(`resolve rejected: authorityMode '${proof.authorityMode}' requires an authorityRef (proof object) — none supplied by the gate`);
    }
    return this.tryCasUpdate(id, (d) => {
      this.assertEdge(d, "resolved", "resolve");
      const nowISO = new Date().toISOString();
      const resolution: DecisionResolution = {
        authorityMode: proof.authorityMode,
        authorityRef: proof.authorityRef,
        executor,
        answer,
        rationale: opts?.rationale,
        resolvedAt: nowISO,
      };
      return { ...d, status: "resolved", resolution, ...accrueExiting(d, nowISO), updatedAt: nowISO };
    });
  }

  async markExecuted(id: string, executor: DecisionActor): Promise<Decision | null> {
    return this.tryCasUpdate(id, (d) => {
      this.assertEdge(d, "executed", "execute");
      const nowISO = new Date().toISOString();
      return {
        ...d,
        status: "executed",
        resolution: d.resolution ? { ...d.resolution } : null,
        ...accrueExiting(d, nowISO),
        updatedAt: nowISO,
      };
    });
  }

  async recordExecutorBinding(id: string, binding: NonNullable<Decision["executorBinding"]>): Promise<Decision | null> {
    return this.tryCasUpdate(id, (d) => {
      if (d.status !== "resolved") {
        throw new DecisionTransitionRejected(`executor binding requires resolved, was ${d.status}`);
      }
      const nowISO = new Date().toISOString();
      return { ...d, executorBinding: binding, updatedAt: nowISO };
    });
  }

  async mergeDecision(id: string, curator: DecisionActor, intoRef: string, basis?: string): Promise<Decision | null> {
    // The merge target must exist and be a different decision (lineage edge, C4).
    if (intoRef === id) throw new DecisionTransitionRejected("merge rejected: a decision cannot merge into itself");
    const target = await this.substrate.get(KIND, intoRef);
    if (!target) throw new DecisionTransitionRejected(`merge rejected: target ${intoRef} does not resolve to a Decision`);
    const merged = await this.tryCasUpdate(id, (d) => {
      this.assertEdge(d, "merged", "merge");
      const nowISO = new Date().toISOString();
      return { ...d, status: "merged", mergedInto: intoRef, curatedBy: d.curatedBy ?? curator, ...accrueExiting(d, nowISO), updatedAt: nowISO };
    });
    if (merged && this.curation) {
      // Lineage preserves EVERY constituent raw id — the minority claim stays
      // reachable through its own immutable raw row (design §2).
      const targetRaw = await this.curation.getRawForDecision(intoRef);
      await this.trail(id, {
        act: "merge",
        changes: { mergedInto: { before: null, after: intoRef } },
        curator,
        basis: basis ?? `merged into ${intoRef}`,
        grantCitation: null,
        extraRawIds: targetRaw ? [targetRaw.id] : [],
      });
    }
    return merged;
  }

  async disposeDecision(id: string, curator: DecisionActor, reason: string): Promise<Decision | null> {
    if (!reason || reason.trim() === "") {
      throw new DecisionTransitionRejected("dispose rejected: a disposal reason is required (SC2 — nothing dropped silently)");
    }
    const disposed = await this.tryCasUpdate(id, (d) => {
      this.assertEdge(d, "disposed", "dispose");
      const nowISO = new Date().toISOString();
      return { ...d, status: "disposed", disposedReason: reason, curatedBy: d.curatedBy ?? curator, ...accrueExiting(d, nowISO), updatedAt: nowISO };
    });
    if (disposed) {
      await this.trail(id, {
        act: "dispose",
        changes: { status: { before: "raised|curated", after: "disposed" } },
        curator,
        basis: reason,
        grantCitation: null,
      });
    }
    return disposed;
  }

  async withdrawDecision(id: string, caller: DecisionActor): Promise<Decision | null> {
    return this.tryCasUpdate(id, (d) => {
      // RAISER-ONLY identity check (the bug-219 (c) lesson, native from day one).
      if (d.raisedBy?.agentId !== caller.agentId) {
        throw new DecisionTransitionRejected(`withdraw rejected: only the raiser (${d.raisedBy?.agentId}) may withdraw, not ${caller.agentId}`);
      }
      this.assertEdge(d, "withdrawn", "withdraw");
      const nowISO = new Date().toISOString();
      return { ...d, status: "withdrawn", ...accrueExiting(d, nowISO), updatedAt: nowISO };
    });
  }

  async listAging(nowISO: string, thresholdMs: number): Promise<Decision[]> {
    // READ-ONLY by contract (test 9): the B6 sweep reads this and EMITS; there is
    // deliberately no write-path in this store that takes time as a trigger.
    const { items } = await this.substrate.list<Decision>(KIND, { filter: { status: "routed" } as never, limit: LIST_CAP });
    const cutoff = Date.parse(nowISO) - thresholdMs;
    return items.map(cloneDecision).filter((d) => Date.parse(d.enteredCurrentStateAt) <= cutoff);
  }

  /** Phase guard off the single TRANSITIONS table — every verb funnels through
   *  here, so the table IS the FSM (contract test 10 checks the table; the verbs
   *  cannot drift from it). */
  private assertEdge(d: Decision, to: DecisionPhase, verb: string): void {
    const legal = DECISION_TRANSITIONS[d.status] ?? [];
    if (!legal.includes(to)) {
      throw new DecisionTransitionRejected(`${verb} rejected: no ${d.status}→${to} edge (legal from ${d.status}: [${legal.join(", ")}] — a terminal decision is immutable)`);
    }
  }

  private async tryCasUpdate(id: string, transform: (current: Decision) => Decision): Promise<Decision | null> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<Decision>(KIND, id);
      if (!existing) return null;
      const next = transform(cloneDecision(existing.entity));
      const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
      if (result.ok) {
        console.log(`[DecisionRepositorySubstrate] Decision ${id} → ${next.status}`);
        return cloneDecision(next);
      }
      // revision-mismatch → another writer won; refetch + retry
    }
    throw new Error(`[DecisionRepositorySubstrate] tryCasUpdate exhausted ${MAX_CAS_RETRIES} retries on ${id}`);
  }
}
