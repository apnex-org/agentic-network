/**
 * decision-policy.ts — mission-102 P3-B1: the Decision verb surface
 * (design.md v1.0 §1.1 + §4, RATIFIED at G2; canonical git 64de1bf).
 *
 * Tools: raise_decision [Any] · get_decision/list_decisions [Any] ·
 * curate_decision/route_decision/merge_decision/dispose_decision [Architect] ·
 * resolve_decision [Architect|Director] (fail-closed pending B4) ·
 * withdraw_decision [Any] (raiser-only, enforced at the store).
 *
 * Every actor stamp is Hub-derived from the registered session (caller-identity +
 * ctx.sessionId — the L2 law; A11 session grounding). Every transition emits
 * `decision-transition-notification` through the shipped work-54 emitAndPush path
 * (design §4: the Director-gate class is a FILTER on this vocabulary, not a new
 * transport; F4 holds). Timers never transition (contract test 9) — there is no
 * sweeper registration for Decision anywhere in this file.
 */
import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { resolveCreatedBy } from "./caller-identity.js";
import { paginated } from "./list-filters.js";
import { LIST_CAP as DECISION_LIST_CAP } from "../entities/decision-repository-substrate.js";
import { emitAndPush } from "./message-policy.js";
import type {
  Decision,
  DecisionActor,
  DecisionContextRef,
  DecisionPhase,
  DecisionPlanAction,
} from "../entities/decision.js";
import { DecisionTransitionRejected, FailClosedProofGate } from "../entities/decision-repository-substrate.js";

/** The FSM-transition event name (payload.notificationEvent) — the work-54
 *  vocabulary extended by one member; receivers already parse this envelope shape. */
export const DECISION_TRANSITION_EVENT = "decision-transition-notification";

// ── Result helpers (the work-item-policy conventions) ────────────────────────

function ok(body: Record<string, unknown>): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(body) }] };
}
function err(errorKind: string, message: string): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message, errorKind }) }], isError: true };
}
function notFound(id: string): PolicyResult {
  return err("not_found", `Decision ${id} not found`);
}
function mapVerbError(e: unknown): PolicyResult {
  if (e instanceof DecisionTransitionRejected) return err("decision_transition_rejected", e.message);
  throw e;
}

/** Hub-stamped actor: authoritative registered role/agentId + the session id the
 *  call arrived on. NEVER caller-supplied (design §1.1). */
async function stampActor(ctx: IPolicyContext): Promise<DecisionActor> {
  const p = await resolveCreatedBy(ctx);
  return { agentId: p.agentId, role: p.role, sessionId: ctx.sessionId };
}

/** Best-effort transition event (observability, not authority — the work-54
 *  posture: never throws; the entity transition is the source of truth). */
async function emitDecisionTransition(
  ctx: IPolicyContext,
  input: { decision: Decision; verb: string; fromStatus: DecisionPhase | null; actor: DecisionActor },
): Promise<void> {
  try {
    // work-124 flood stopgap: decision events are scoped per their routedTo —
    // the architect (curator-operator) always hears them; the director
    // ADDITIONALLY hears decisions routed to the director target. Engineers/
    // verifiers query on demand (F4: the gate is a filter, not transport).
    const targets: Array<{ role: string } | null> = [{ role: "architect" }];
    if (input.decision.routedTo?.target === "director") targets.push({ role: "director" });
    for (const target of targets)
    await emitAndPush(ctx, {
      kind: "external-injection",
      authorRole: "system",
      authorAgentId: "hub",
      target: target as import("../entities/message.js").MessageTarget | null,
      delivery: "push-immediate",
      intent: input.verb,
      payload: {
        notificationEvent: DECISION_TRANSITION_EVENT,
        verb: input.verb,
        decision_id: input.decision.id,
        title: input.decision.title,
        class: input.decision.class,
        from_status: input.fromStatus,
        to_status: input.decision.status,
        routed_target: input.decision.routedTo?.target ?? null,
        parent_ref: input.decision.parentRef,
        actor_role: input.actor.role,
        actor_agent_id: input.actor.agentId,
        body: `${input.decision.id} ${input.fromStatus ?? "·"}→${input.decision.status} (${input.verb}) by ${input.actor.role}/${input.actor.agentId} — "${input.decision.title}"`,
      },
    });
  } catch (e) {
    console.error(`[decision-policy] transition emit failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function raiseDecision(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.decision;
  if (!store) return err("not_wired", "Decision store is not available");
  // bug-227 (A): the plan is declared at ROUTE, never at raise. Reject LOUDLY at
  // the handler (transport-independent — schema layers may strip unknown keys
  // silently, which cost the grant-1 live test a full cycle).
  if (args.executionPlan !== undefined) {
    return err("invalid_arguments", "executionPlan is declared at ROUTE (route_decision), not at raise — remove it here and pass it to route_decision with the self-disposal citation (bug-227)");
  }
  const actor = await stampActor(ctx);
  const contextRefs = (args.contextRefs as DecisionContextRef[] | undefined) ?? [];
  // Fail-closed: a REQUIRED entity-storage context ref must resolve at raise (the L3
  // law, the create_work posture). Non-entity storages are format-carried in v1-B1;
  // the B2 curation slice owns richer resolution.
  const workStore = ctx.stores.workItem;
  for (const ref of contextRefs) {
    if (!ref.required || ref.storage !== "entity") continue;
    if (!workStore) return err("not_wired", "entity-ref validation requires the WorkItem store's substrate check");
    const kind = ref.kind.charAt(0).toUpperCase() + ref.kind.slice(1);
    const exists = (await workStore.entityExists(kind, ref.ref)) || (await workStore.entityExists(ref.kind, ref.ref));
    if (!exists) return err("unresolvable_ref", `required contextRef ${ref.kind}/${ref.ref} does not resolve — a raise with a dangling required input is a cold-start trap`);
  }
  try {
    const d = await store.raiseDecision({
      parentRef: (args.parentRef as { kind: string; id: string } | null | undefined) ?? null,
      class: (args.class as string | undefined) ?? null,
      title: args.title as string,
      context: args.context as string,
      contextRefs,
      options: (args.options as Decision["options"] | undefined) ?? [],
      raisedBy: actor,
    });
    await emitDecisionTransition(ctx, { decision: d, verb: "raise_decision", fromStatus: null, actor });
    return ok({ decision: d });
  } catch (e) { return mapVerbError(e); }
}

async function getDecision(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.decision;
  if (!store) return err("not_wired", "Decision store is not available");
  const d = await store.getDecision(args.decisionId as string);
  return d ? ok({ decision: d }) : notFound(args.decisionId as string);
}

async function listDecisions(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.decision;
  if (!store) return err("not_wired", "Decision store is not available");
  const { items, truncated } = await store.listDecisions({
    status: args.status as DecisionPhase | undefined,
    class: args.class as string | undefined,
    routedTarget: args.routedTarget as string | undefined,
  });
  // kernel0: the repository ALREADY computed `truncated` (items.length >= LIST_CAP)
  // and this handler forwarded that one flag while discarding everything else —
  // no `total`, no `complete`, no offset/limit, and NO note telling the caller what
  // to do about it. The scan-capped signal was present and under-used; the kernel
  // turns it into a full disclosure. Note `total` becomes null when capped: that is
  // the point — a floor must not masquerade as a count.
  // 🔴 §9c DIVERGENCE FIX — found only because the engineer named the class, NOT by
  // review of my own work: the author of N parallel implementations of ONE spec is
  // structurally unable to see their divergence, because one mental model produced
  // all of them. Three adoptions, three differences, and I had described one of them
  // as a virtue. This handler hardcoded `scanCap: 500` in the SAME COMMIT that
  // exported the other two caps precisely to avoid a duplicated literal; and it
  // passed NO `narrowBy` while this repository genuinely DOES push
  // status/class/routedTarget to the substrate — so the note withheld advice that is
  // TRUE here, which is bug-518's defect running in the opposite direction.
  const envelope = paginated(items, args, {
    // the repository computes this directly (items.length >= LIST_CAP) — it needs no
    // pre-filter length comparison, and THAT divergence from the other two is correct.
    scanCapped: truncated,
    scanCap: DECISION_LIST_CAP,
    // 🔴 `routedTarget` IS DELIBERATELY OMITTED FROM THIS ADVICE, AND THE REASON IS NOT
    // THAT IT FAILS — IT IS THAT NOTHING IN THIS REPO CAN TELL YOU WHETHER IT WORKS.
    // The repository pushes three fields; two of them (`status`, `class`) are in the
    // filterable-keys registry and are watched by Gate A. The third maps to the
    // BUCKET-PREFIXED path `status.routedTo.target`, which the registry EXCLUDES by
    // design and which Gate A (filterable-keys-drift-gate.test.ts:49-52) explicitly
    // SKIPS — deferring, in its own inline comment, to a round-trip oracle that does
    // not exist. That is bug-511.
    //
    // ⚠⚠ AND THE OBVIOUS REMEDY IS UNAVAILABLE, NOT MERELY UNRUN: measuring pushdown
    // requires a scan that HITS THE CAP. There are 36 decisions against a cap of 500,
    // so a filter that pushes down and one that post-filters return byte-identical
    // results. The `truncated` flag on this surface has, on that evidence, never fired.
    //
    // ⭐ THE ARCHITECT AND THE ENGINEER BOTH FRAMED THIS AS BINARY — NAME IT (over-license,
    // unbounded) vs OMIT IT (under-license, bounded) — argued opposite sides, and MISSED
    // THE THIRD OPTION THAT DOMINATES BOTH, WHICH IS THIS ARC'S OWN CHARTER WORD FOR WORD:
    // A QUERY STATES WHAT IT DOES NOT KNOW.
    //
    // Naming a filter WITH ITS UNCERTAINTY DISCLOSED does not over-license, because a
    // caller told "may, unverified" who then finds the scan unchanged HAS NOT BEEN MISLED.
    // ONLY AN UNQUALIFIED PRESCRIPTION OVER-LICENSES. And it does not under-license either,
    // because a possibly-true filter is no longer withheld.
    //
    // 🔴 WHY BOTH OF US MISSED IT: we inherited bug-518's frame, where the defect was an
    // UNQUALIFIED FALSE remedy — so we argued about WHETHER to prescribe and never about
    // HOW. A DEFECT'S REMEDY CARRIES THE DEFECT'S FRAME, AND THE FRAME OUTLIVES THE FIX.
    //
    // ⚠️ THE ERGONOMIC OBJECTION (a truncation note is read by someone in trouble; this is
    // 100 chars of epistemics) IS ANSWERED BY A RATIO AT THE MOMENT OF RENDER, NOT BY A
    // RENDER COUNT. A caller reading this note is ALREADY IN TROUBLE and already about to
    // spend a query; 100 characters of disclosed uncertainty against the cost of ACTING ON
    // A FALSE REMEDY is not close — and bug-518 is the measured price of the other side: a
    // filter that read entirely plausible, did not push down, and bought a wrong belief.
    //
    // 🔴 THE ARGUMENT I FIRST WROTE HERE WAS "it has rendered ZERO times, so the verbosity
    // is free" — TRUE AND IRRELEVANT. Zero renders means the verbosity cost is zero AND THE
    // HONESTY GAIN IS ZERO, in lockstep; the ratio, which is the whole question, is
    // untouched by the count. Worse, it would INVERT the moment this collection passed the
    // cap — exactly when the note starts mattering. AN ARGUMENT THAT FAILS PRECISELY WHEN
    // ITS SUBJECT BECOMES RELEVANT IS WORSE THAN NO ARGUMENT. (Caught by the engineer; it
    // is his own "zero consumers" error in my hands — a true measurement cited for a
    // conclusion it does not bear on, same shape, opposite seat, four hours apart.)
    //
    // 🔴 THE STRING BELOW ONCE ENDED "...and unmeasurable while the collection sits below
    // the cap". THAT CLAUSE WAS FALSE IN THE ONLY STATE THAT RENDERS IT: the truncationNote
    // is emitted IFF scanCapped, and scanCapped is `items.length >= LIST_CAP` — so a reader
    // meets that sentence ONLY when the collection is AT OR ABOVE the cap. Invisible at 36
    // rows; WRONG THE FIRST TIME IT IS EVER READ. bug-497's family, FIFTH instance, inside
    // the fix for the fourth. The qualifier was reasoned in TODAY's state and written into
    // a string that only ever speaks in the FUTURE state — the join class in a wire string.
    //
    // FIXED BY SUBTRACTION. What remains is a fact about the REGISTRY and the GATE, not
    // about collection size, so it cannot rot. The removed clause was the only part that
    // could, and it did nothing for the caller: knowing WHY a filter is unverified does not
    // change what they do about it. Guarded by kernel0-envelope-adoption-e2e.test.ts.
    //
    // REVIVAL: if decisions ever approach the cap, measure it — one observation would be
    // the first bucket-prefixed pushdown measurement in the repo and would let this string
    // drop its qualifier in EITHER direction.
    narrowBy: "status/class — registry-verified and drift-gated, both genuinely pushed to the substrate scan (routedTarget MAY also narrow but is UNVERIFIED: it is bucket-prefixed and outside the conformance registry)",
  });
  // this surface names its rows `decisions`, not `items`
  const { items: pageItems, ...rest } = envelope;
  return ok({ decisions: pageItems, ...rest });
}

function transitionHandler(
  verb: string,
  run: (store: NonNullable<IPolicyContext["stores"]["decision"]>, args: Record<string, unknown>, actor: DecisionActor) => Promise<Decision | null>,
) {
  return async (args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> => {
    const store = ctx.stores.decision;
    if (!store) return err("not_wired", "Decision store is not available");
    const actor = await stampActor(ctx);
    const before = await store.getDecision(args.decisionId as string);
    try {
      const d = await run(store, args, actor);
      if (!d) return notFound(args.decisionId as string);
      await emitDecisionTransition(ctx, { decision: d, verb, fromStatus: before?.status ?? null, actor });
      return ok({ decision: d });
    } catch (e) { return mapVerbError(e); }
  };
}

const curateDecision = transitionHandler("curate_decision", (store, args, actor) =>
  store.curateDecision(args.decisionId as string, actor, {
    curationRecordRef: args.curationRecordRef as string | undefined,
    class: args.class as string | undefined,
    basis: args.basis as string | undefined, // B2: lands in the CurationRecord
  }));

// route: the self-disposal leg fail-closed validates its citation at ROUTE time
// (design §1.1: grant refs resolve or route rejects; PR #488 finding 2). The verb
// needs ctx for the grant store, so it doesn't use the generic transitionHandler.
async function routeDecisionHandler(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.decision;
  if (!store) return err("not_wired", "Decision store is not available");
  const actor = await stampActor(ctx);
  // work-128 (B8-R1): the verifier seat is dryRun-only — the SAME validation
  // code runs in collect-mode (every check reported, none skipped, no
  // transition, no emit); the authority fence is unchanged for real routes.
  const dryRun = args.dryRun === true;
  if (actor.role !== "architect" && !dryRun) {
    return err("authorization_denied", `route_decision requires the architect seat — the ${actor.role} seat may only probe with dryRun:true`);
  }
  const checks: Array<{ check: string; ok: boolean; rejection?: string }> = [];
  const fail = (kind: string, msg: string, check: string): PolicyResult | null => {
    checks.push({ check, ok: false, rejection: msg });
    return dryRun ? null : err(kind, msg);
  };
  const pass = (check: string) => checks.push({ check, ok: true });
  const route = { target: args.target as "director" | "self-disposal", selfDisposal: args.selfDisposal as { t5RuleRef?: string; classGrantRef?: string } | undefined };
  if (route.target === "self-disposal") {
    const grantRef = route.selfDisposal?.classGrantRef;
    if (route.selfDisposal?.t5RuleRef && !grantRef) {
      const r = fail("decision_transition_rejected", "route rejected: the t5-rule self-disposal leg awaits the T5 rule registry — cite a classGrantRef (fail-closed, never silent)", "citation");
      if (r) return r;
    } else if (!grantRef) {
      const r = fail("decision_transition_rejected", "route rejected: a self-disposal route must cite selfDisposal.classGrantRef", "citation");
      if (r) return r;
    } else {
      const grants = ctx.stores.classGrant;
      if (!grants) return err("not_wired", "self-disposal routing requires the ClassGrant store");
      const grant = await grants.getGrant(grantRef);
      if (!grant) {
        const r = fail("unresolvable_ref", `route rejected: cited grant ${grantRef} does not resolve`, "citation");
        if (r) return r;
      } else if (grant.state !== "active") {
        const r = fail("decision_transition_rejected", `route rejected: cited grant ${grantRef} is ${grant.state}, not active`, "citation");
        if (r) return r;
      } else {
        const decision = await store.getDecision(args.decisionId as string);
        if (decision && decision.class !== grant.class) {
          const r = fail("decision_transition_rejected", `route rejected: cited grant covers class '${grant.class}', not '${decision.class ?? "(unclassified)"}' — routing cannot launder a class onto a grant`, "citation");
          if (r) return r;
        } else {
          pass("citation");
        }
      }
    }
  }
  // B5: plan validation at ROUTE (design §3) — every action is in-registry
  // (zod-enforced) and every target RESOLVES; fail-closed before the transition.
  // The blocked-ON-this-decision check runs again at resolve (the target may
  // legitimately block on the decision after routing).
  const plan = (args.executionPlan as DecisionPlanAction[] | undefined) ?? [];
  let planOk = true;
  for (const step of plan) {
    if (step.action === "unblock") {
      if (!ctx.stores.workItem) return err("not_wired", "unblock plan validation requires the WorkItem store");
      if (!(await ctx.stores.workItem.getWorkItem(step.targetRef))) {
        planOk = false;
        const r = fail("unresolvable_ref", `route rejected: plan target ${step.targetRef} does not resolve`, "plan");
        if (r) return r;
      }
    }
    if (step.action === "approve") {
      if (!ctx.stores.proposal) return err("not_wired", "approve plan validation requires the Proposal store");
      if (!(await ctx.stores.proposal.getProposal(step.targetRef))) {
        planOk = false;
        const r = fail("unresolvable_ref", `route rejected: plan target ${step.targetRef} does not resolve`, "plan");
        if (r) return r;
      }
    }
  }
  if (plan.length > 0 && planOk) pass("plan");
  const before = await store.getDecision(args.decisionId as string);
  if (dryRun) {
    const routable = before ? (before.status === "curated") : false;
    checks.push({ check: "phase", ok: routable, ...(routable ? {} : { rejection: before ? `route requires curated, was ${before.status}` : "decision not found" }) });
    return ok({ dryRun: true, effects: "none", checks, wouldSucceed: checks.every((c) => c.ok) });
  }
  try {
    const d = await store.routeDecision(args.decisionId as string, actor, route, args.executionPlan as DecisionPlanAction[] | undefined);
    if (!d) return notFound(args.decisionId as string);
    await emitDecisionTransition(ctx, { decision: d, verb: "route_decision", fromStatus: before?.status ?? null, actor });
    return ok({ decision: d });
  } catch (e) { return mapVerbError(e); }
}
const routeDecision = routeDecisionHandler;

const resolveDecision = transitionHandler("resolve_decision", (store, args, actor) =>
  // B1 wires the FAIL-CLOSED gate: every resolve rejects until the B4 proof
  // machinery (DirectorSignal/Confirmation) or the B3 grant evaluator replaces it.
  // authorityMode is Hub-derived INSIDE the gate — there is no schema field for a
  // caller to supply one (S1.2: no default, no inferred member).
  store.resolveDecision(
    args.decisionId as string,
    actor,
    (args.chosenOptionId ? { chosenOptionId: args.chosenOptionId as string } : { customAnswer: args.customAnswer as string }),
    FailClosedProofGate,
    { rationale: args.rationale as string | undefined, claimedAuthorityRef: args.authorityRef as string | undefined },
  ));

const mergeDecision = transitionHandler("merge_decision", (store, args, actor) =>
  store.mergeDecision(args.decisionId as string, actor, args.intoRef as string, args.basis as string | undefined));

const disposeDecision = transitionHandler("dispose_decision", (store, args, actor) =>
  store.disposeDecision(args.decisionId as string, actor, args.reason as string));

const withdrawDecision = transitionHandler("withdraw_decision", (store, args, actor) =>
  store.withdrawDecision(args.decisionId as string, actor));

// ── Schemas + registration ───────────────────────────────────────────────────

const decisionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  preview: z.string().optional(),
  consequences: z.string().optional(),
}).strict();

const contextRefSchema = z.object({
  kind: z.string().min(1),
  ref: z.string().min(1),
  storage: z.enum(["inline", "git", "hub-doc", "entity"]),
  mode: z.enum(["read", "triangulate-against"]),
  required: z.boolean(),
}).strict();

const planActionSchema = z.object({
  action: z.enum(["unblock", "approve", "bind_axiom", "amend_charter"]),
  targetRef: z.string().min(1),
  // mission-103 S1: typed cargo for the charter actions — inside the plan,
  // therefore covered by executionPlanHash (the confirmation binds it exactly).
  params: z.record(z.string(), z.unknown()).optional(),
}).strict();

const DECISION_PHASE = z.enum(["raised", "curated", "routed", "resolved", "executed", "merged", "disposed", "withdrawn"]);

export function registerDecisionPolicy(router: PolicyRouter): void {
  router.register(
    "raise_decision",
    "[Any] Raise a Decision (·→raised) — file-free admission (T4): any agent surfaces a decision needing authority resolution; the architect curates what reaches the Director. Single-topic BY SCHEMA (one options array, no question groups — idea-416 is a type here, not a review rule). freeAnswerPolicy is a constant: the Director can always answer outside the options. Required entity contextRefs fail-closed validate at raise.",
    {
      title: z.string().min(1).describe("Single-topic decision title"),
      context: z.string().describe("The decomposed walkthrough framing (B5 rule: never 'go read the doc')"),
      options: z.array(decisionOptionSchema).optional().describe("Presented options (plain-text payloads — must render inline AND in a dumb CLI)"),
      parentRef: z.object({ kind: z.string().min(1), id: z.string().min(1) }).strict().nullable().optional().describe("The work/mission/proposal context this decision belongs to"),
      class: z.string().optional().describe("Ontology class (S1.3 seed); omitted = unclassified → fails closed to director-direct routing"),
      contextRefs: z.array(contextRefSchema).optional().describe("Typed inputs (the WorkItem references[] shape); required:true entity refs are existence-checked"),
    },
    raiseDecision,
  );

  router.register(
    "get_decision",
    "[Any] Read a Decision by id (any phase).",
    { decisionId: z.string() },
    getDecision,
  );

  router.register(
    "list_decisions",
    "[Any] List Decisions with optional status/class/routedTarget filters. routedTarget=director + status=routed is the arrival-surface pull (a PURE function of queue state — complete with every push channel dead; delivery is B6's snapshot machinery).",
    {
      status: DECISION_PHASE.optional(),
      class: z.string().optional(),
      routedTarget: z.string().optional().describe("Filter by routing target (e.g. 'director')"),
    },
    listDecisions,
  );

  router.register(
    "curate_decision",
    "[Architect] Curate a raised Decision (raised→curated): framing/class/priority stewardship. The 24h curation SLO (S3.2) measures dwell-in-raised; the curation CONTENT record is slice B2 — this verb stamps the transition + optional record ref.",
    {
      decisionId: z.string(),
      class: z.string().optional().describe("Assign/refine the ontology class"),
      curationRecordRef: z.string().optional().describe("Ref to the B2 curation record (framing edits, merge lineage, priority basis)"),
      basis: z.string().optional().describe("B2: why — stored in the append-only CurationRecord"),
    },
    curateDecision,
  );

  router.register(
    "route_decision",
    "[Architect|Verifier] Route a curated Decision (curated→routed) — VERIFIER SEAT IS dryRun-ONLY (work-128 rejection-path probing). The self-disposal leg is LIVE (B3): it must cite selfDisposal.classGrantRef, which fail-closed resolves at route (active grant, class match) — and the grant gate at resolve rejects any grant proof the route does not cite (route↔proof tie). Unclassified decisions fail closed to the director. An execution plan declared here is stored; execution is B5.",
    {
      decisionId: z.string(),
      target: z.enum(["director", "self-disposal"]),
      selfDisposal: z.object({ t5RuleRef: z.string().optional(), classGrantRef: z.string().optional() }).strict().optional(),
      executionPlan: z.array(planActionSchema).optional().describe("Declared-at-route plan (v1 registry: unblock | approve); executes atomically at resolve once B5 lands"),
      dryRun: z.boolean().optional().describe("work-128: run the SAME citation/plan/phase validators in collect-mode and report every verdict WITHOUT routing or emitting (required for the verifier seat)"),
    },
    routeDecision,
  );

  router.register(
    "resolve_decision",
    "[Architect|Director] Resolve a routed Decision (routed→resolved). B1 SHIPS FAIL-CLOSED: every resolve rejects until the proof machinery lands (DirectorSignal/Confirmation = B4; ClassGrant evaluator = B3) — authorityMode is Hub-derived from proof, never caller-supplied, and without proof there is no authority (S1.2/CL-2). The schema deliberately has NO authorityMode parameter.",
    {
      decisionId: z.string(),
      chosenOptionId: z.string().optional().describe("The picked option id (exactly one of chosenOptionId | customAnswer)"),
      customAnswer: z.string().optional().describe("Free-text answer — first-class, highest-signal (B2)"),
      rationale: z.string().optional(),
      authorityRef: z.string().optional().describe("Claimed proof ref (DirectorSignal/Confirmation/grant) — VALIDATED by the proof gate, never trusted"),
    },
    resolveDecision,
  );

  router.register(
    "merge_decision",
    "[Architect] Merge a raised/curated Decision into another (→merged, terminal). Lineage preserved via mergedInto — the raw item stays queryable (C4: merge must never erase minority claims; the full merge record is B2).",
    { decisionId: z.string(), intoRef: z.string().describe("The surviving Decision id"), basis: z.string().optional().describe("B2: the compound-value rationale (B9) — stored in the merge CurationRecord") },
    mergeDecision,
  );

  router.register(
    "dispose_decision",
    "[Architect] Dispose a raised/curated/ROUTED Decision (→disposed, terminal) with a REQUIRED reason. routed-disposal exists for MISROUTES (bug-227: immutable-destination over un-route — the misroute stays on the record) and is Director-visible in the digest like every disposal. Nothing dropped silently (SC2).",
    { decisionId: z.string(), reason: z.string().min(1) },
    disposeDecision,
  );

  router.register(
    "withdraw_decision",
    "[Any] Withdraw your own raised/curated Decision (→withdrawn, terminal). RAISER-ONLY — enforced against the Hub-stamped raisedBy identity, not caller input.",
    { decisionId: z.string() },
    withdrawDecision,
  );
}
