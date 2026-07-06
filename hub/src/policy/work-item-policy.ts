/**
 * work-item-policy.ts — C1-R2 (mission-94) sub-PR-3b: the WorkItem work-queue MCP
 * verb surface (PolicyRouter tools). The repo (WorkItemRepositorySubstrate) owns the
 * mechanism (advisory-lock WIP cap, per-row CAS, FSM guards, lease-token fence,
 * eligibility/dependency enforcement, the evidence predicate); this layer is the thin
 * authenticated seam: it resolves the SPOOF-PROOF caller identity (agentId + role from
 * the session, NOT args), passes the caller-presented leaseToken, and maps repo errors
 * to structured PolicyResults with an `errorKind` for programmatic consumers.
 *
 * RBAC: tagged [Any] at the tool level — the per-item roleEligibility + holder+token +
 * creator guards in the repo are the fine-grained authority (claim_work re-enforces
 * eligibility fail-closed; a direct claim-by-ID can't bypass it). Exact tool STRINGS +
 * the precise RBAC tags DEFER to idea-121 (working names here).
 */
import { z } from "zod";
import type { IPolicyContext, PolicyResult } from "./types.js";
import type { PolicyRouter } from "./router.js";
import { resolveCreatedBy } from "./caller-identity.js";
// work-54 (idea-357 pts 1-2): push-native FSM-transition events. Best-effort +
// never-throws — the store transition is the source of truth; the event is
// enhancement (the mission-policy runTriggers posture).
import { emitWorkTransition, emitDependencyUnblocks, emitWorkUpdated } from "./work-item-events.js";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, LIST_PAGINATION_SCHEMA, paginate } from "./list-filters.js";
import {
  TransitionRejected,
  ClaimRejected,
  WipCapExceeded,
  EvidencePredicateFailed,
  CompletionGateRejected,
} from "../entities/work-item-repository-substrate.js";
import { LockAcquisitionTimeoutError } from "../storage-substrate/advisory-lock.js";
import type {
  WorkItem,
  WorkItemBlockedOn,
  EvidenceItem,
  EvidenceKind,
  EvidenceRequirement,
  WorkItemReference,
  WorkItemType,
  WorkItemPriority,
  WorkItemPhase,
  ReadyEmptyReason,
} from "../entities/work-item.js";

// ── work-94 (cold-start spine): the NON-DARK empty-digest reasons ────────────────────
// An empty caller-scoped claimable digest must explain ITSELF — never a silent/dark zero (a
// cold agent must know whether it's blocked (quarantine), maxed (WIP cap), or simply has no
// work, so it knows the next move). Codes are set by listReadyForRole (wip_capped /
// no_claimable_ready) + the policy quarantine gate (quarantined).
const EMPTY_REASON_MESSAGE: Record<ReadyEmptyReason, string> = {
  wip_capped: "you hold the maximum in-flight items (WIP cap) — complete_work or release_work on one to free a claim slot",
  no_claimable_ready: "no WorkItem is claimable by your role right now (none that is ready AND role-eligible AND dependency-met)",
  quarantined: "you are claim-thrash quarantined — an admin clear_work_quarantine is required before you can claim again",
};
/** Spread the non-dark empty-reason fields when the digest is empty (no-op when claimable). */
function emptyDigestFields(reason: ReadyEmptyReason | undefined): Record<string, unknown> {
  return reason ? { emptyReason: reason, emptyReasonMessage: EMPTY_REASON_MESSAGE[reason] } : {};
}

function ok(obj: unknown): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}
function err(errorKind: string, message: string): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message, errorKind }) }], isError: true };
}
function notFound(workId: string): PolicyResult {
  return err("not_found", `WorkItem not found: ${workId}`);
}

/** Map a repo verb error to a structured PolicyResult. Re-throws anything unexpected
 *  (a genuine fault should surface, not be swallowed as a tool error). */
function mapVerbError(e: unknown): PolicyResult {
  if (e instanceof WipCapExceeded) return err("wip_cap_exceeded", e.message);
  if (e instanceof ClaimRejected) return err("claim_rejected", e.message);
  if (e instanceof EvidencePredicateFailed) return err("evidence_predicate_failed", e.message);
  if (e instanceof CompletionGateRejected) return err("completion_gate_unmet", e.message);
  if (e instanceof LockAcquisitionTimeoutError) return err("lock_timeout", e.message);
  if (e instanceof TransitionRejected) return err("transition_rejected", e.message);
  throw e;
}

/** The verb result projection — the flat WorkItem plus the lease token surfaced at the
 *  top level on claim (the caller must capture it to drive subsequent lease-bound verbs). */
function workItemResult(w: WorkItem): PolicyResult {
  return ok({ workItem: w, leaseToken: w.lease?.token ?? null });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function claimWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  // 4b-ii: a claim-thrash-quarantined agent is locked OUT of claiming (the wedged-agent
  // guard; the C2 supervisor actuates on the same flag). Cleared via clear_work_quarantine.
  const agent = await ctx.stores.engineerRegistry.getAgent(caller.agentId);
  if (agent?.quarantined) {
    return err("quarantined", `agent ${caller.agentId} is claim-thrash quarantined; an admin clear_work_quarantine is required (R2 interim — C2 auto-recovery deferred)`);
  }
  try {
    const w = await store.claimWorkItem(args.workId as string, caller.agentId, caller.role);
    if (!w) return notFound(args.workId as string);
    await emitWorkTransition(ctx, { item: w, verb: "claim_work", fromStatus: "ready", actor: caller });
    return workItemResult(w);
  } catch (e) { return mapVerbError(e); }
}

async function listReadyWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  // role: explicit arg overrides; else the caller's own role (the "work for me" view).
  // A "system" caller with no explicit role lists ALL ready items (no role filter).
  const role = (args.role as string | undefined) ?? (caller.role !== "system" ? caller.role : undefined);
  const limit = Math.min(MAX_LIST_LIMIT, (args.limit as number | undefined) ?? DEFAULT_LIST_LIMIT);
  const truncationNote = (truncated: boolean) =>
    truncated ? { truncationNote: `ready-scan hit the ${MAX_LIST_LIMIT}-row cap — result is INCOMPLETE; refine by role or treat as a backlog-pressure signal` } : {};

  // idea-353 WI-2.1 (AC5 strict parity / audit-4265): opt-in agent-scoped projection.
  // The claimable DIGEST must count only what THIS caller can actually claim, so it
  // applies the FULL claim_work predicate — deps + role (substrate) + WIP-cap
  // (substrate, via the agent-scoped listReadyForRole) + quarantine (HERE, the same
  // gate + store claimWork uses). A WIP-capped or quarantined caller gets count 0,
  // so the digest cannot over-report. Default (flag absent) preserves the
  // non-agent-scoped role view + the D-1 R1 no-touch seam — unchanged.
  if (args.scopeToCaller === true) {
    const agent = await ctx.stores.engineerRegistry.getAgent(caller.agentId);
    if (agent?.quarantined) {
      // work-94 (non-dark digest): a quarantined caller's empty digest says WHY, not a dark zero.
      return ok({ items: [], count: 0, role: role ?? null, truncated: false, scopedToCaller: true, ...emptyDigestFields("quarantined") });
    }
    const { items, truncated, emptyReason } = await store.listReadyForRole(role, limit, caller.agentId);
    // work-94: an empty scoped digest carries the non-dark reason (wip_capped / no_claimable_ready).
    return ok({ items, count: items.length, role: role ?? null, truncated, scopedToCaller: true, ...truncationNote(truncated), ...emptyDigestFields(emptyReason) });
  }

  const { items, truncated, emptyReason } = await store.listReadyForRole(role, limit);
  return ok({ items, count: items.length, role: role ?? null, truncated, ...truncationNote(truncated), ...emptyDigestFields(emptyReason) });
}

async function startWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  try {
    const w = await store.startWork(args.workId as string, caller.agentId, args.leaseToken as string);
    if (!w) return notFound(args.workId as string);
    await emitWorkTransition(ctx, { item: w, verb: "start_work", fromStatus: "claimed", actor: caller });
    return workItemResult(w);
  } catch (e) { return mapVerbError(e); }
}

async function blockWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  const blockedOn = args.blockedOn as WorkItemBlockedOn;
  try {
    const w = await store.blockWork(args.workId as string, caller.agentId, args.leaseToken as string, blockedOn);
    if (!w) return notFound(args.workId as string);
    await emitWorkTransition(ctx, { item: w, verb: "block_work", fromStatus: "in_progress", actor: caller });
    return workItemResult(w);
  } catch (e) { return mapVerbError(e); }
}

async function resumeWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  try {
    const w = await store.resumeWork(args.workId as string, caller.agentId, args.leaseToken as string);
    if (!w) return notFound(args.workId as string);
    await emitWorkTransition(ctx, { item: w, verb: "resume_work", fromStatus: "blocked", actor: caller });
    return workItemResult(w);
  } catch (e) { return mapVerbError(e); }
}

async function renewLease(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  try {
    const w = await store.renewLease(args.workId as string, caller.agentId, args.leaseToken as string);
    return w ? workItemResult(w) : notFound(args.workId as string);
  } catch (e) { return mapVerbError(e); }
}

async function releaseWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  // release can come from claimed|in_progress|blocked — pre-read for the event's
  // from_status (non-atomic; observability-only, the CAS transition stays authoritative).
  const before = await store.getWorkItem(args.workId as string);
  try {
    const w = await store.releaseWork(args.workId as string, caller.agentId, args.leaseToken as string);
    if (!w) return notFound(args.workId as string);
    await emitWorkTransition(ctx, { item: w, verb: "release_work", fromStatus: before?.status ?? null, actor: caller });
    return workItemResult(w);
  } catch (e) { return mapVerbError(e); }
}

async function abandonWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  // abandon can come from claimed|in_progress|blocked (creator also from ready, bug-219) —
  // pre-read for the event's from_status.
  const before = await store.getWorkItem(args.workId as string);
  try {
    const w = await store.abandonWork(args.workId as string, caller.agentId, {
      reason: args.reason as string | undefined,
      leaseToken: args.leaseToken as string | undefined,
    });
    if (!w) return notFound(args.workId as string);
    await emitWorkTransition(ctx, { item: w, verb: "abandon_work", fromStatus: before?.status ?? null, actor: caller });
    return workItemResult(w);
  } catch (e) { return mapVerbError(e); }
}

async function completeWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  const evidence = (args.evidence as EvidenceItem[] | undefined) ?? [];
  // complete can come from in_progress|review — pre-read for the event's from_status.
  const before = await store.getWorkItem(args.workId as string);
  try {
    const w = await store.completeWork(args.workId as string, caller.agentId, args.leaseToken as string, evidence);
    if (!w) return notFound(args.workId as string);
    await emitWorkTransition(ctx, { item: w, verb: "complete_work", fromStatus: before?.status ?? null, actor: caller });
    // idea-357 pt-2 keystone: a →done may clear a dependent's LAST unmet dependency —
    // wake the eligible agents push-natively (the idea-353 digest stays as fallback).
    if (w.status === "done") await emitDependencyUnblocks(ctx, w);
    // 4b-ii: a successful complete (evidence attached → review|done) is demonstrated
    // progress → reset the agent's claim-thrash counter (leaves quarantine to manual clear).
    const priorThrash = await ctx.stores.engineerRegistry.resetWorkItemThrash(caller.agentId);
    // audit-4133: audit a NON-NOOP reset (forensic symmetry with the quarantine SET + clear
    // paths; low-volume since most completes have thrashCount=0).
    if (priorThrash > 0) {
      try {
        await ctx.stores.audit.logEntry("hub", "agent_workitem_thrash_reset",
          `Agent ${caller.agentId} claim-thrash counter reset ${priorThrash}->0 on a successful complete_work (${args.workId})`, caller.agentId);
      } catch (auditErr) {
        console.warn(`[work-item-policy] thrash-reset audit write failed for ${caller.agentId}:`, auditErr);
      }
    }
    return workItemResult(w);
  } catch (e) { return mapVerbError(e); }
}

async function clearWorkQuarantine(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  // 4b-ii R2 interim manual quarantine escape (admin-gated at the tool level). Clears the
  // agent's claim-thrash quarantine + counter. C2 supervisor-restart auto-recovery deferred.
  const agentId = args.agentId as string;
  await ctx.stores.engineerRegistry.clearWorkItemQuarantine(agentId);
  // audit-4103 (LOW): forensic symmetry with the sweeper's quarantine-SET audit — record
  // WHO cleared the quarantine (the SET path is audited; the clear path was not).
  const caller = await resolveCreatedBy(ctx);
  try {
    await ctx.stores.audit.logEntry("hub", "agent_workitem_quarantine_cleared",
      `Agent ${agentId} claim-thrash quarantine cleared by ${caller.role}/${caller.agentId} (manual R2 escape)`, agentId);
  } catch (auditErr) {
    console.warn(`[work-item-policy] quarantine-clear audit write failed for ${agentId}:`, auditErr);
  }
  const agent = await ctx.stores.engineerRegistry.getAgent(agentId);
  return ok({ agentId, quarantined: agent?.quarantined ?? false, thrashCount: agent?.thrashCount ?? 0 });
}

// ── On-ramp: create_work + get_work (C1 NARROW adoption) ────────────────────────
//
// createWorkItem (repo) is test-callers-only; this is the agent-reachable creation seam —
// the queue's own bootstrap. createWorkItem stores dependsOn + targetRef OPAQUELY (it does
// zero existence-checking), so the "unresolvable internal refs → reject, no silent coercion"
// fail-closed posture (bug-175) lives HERE, in the policy tool:
//   - dependsOn → existence-checked (a dangling dep = a permanently-unclaimable item, a
//     silent claim-trap; tele-4 → loud reject at authoring).
//   - evidenceRequirement ids → unique within the item (complete_work binds by requirementId;
//     a dup makes the bind ambiguous + could weaken no-double-count).
//   - targetRef → opaque + shape-validated only (thread-709 (b)): it's advisory "this work is
//     ABOUT entity X", not a claim-gate, so a dangling targetRef is not a trap; cross-kind
//     create-time resolution belongs in the D-1 / idea-121 uniform resolver, not here.

// ── work-86 (idea-380): the node-contract validation (references + runbook) ──────────
// The node-contract = dependsOn(when) + references(consume) + evidenceRequirements(produce).

/** A node is a blueprint/cold-start node — and so REQUIRES a runbook — when it's a gate
 *  (type=verifier-gate) OR it consumes references[]. The SINGLE predicate + call-site: the
 *  seed_blueprint expander slice can later swap in a first-class discriminator without
 *  touching the createWork call-site. (No nodeKind enum yet — thin/non-platform.) */
function nodeRequiresRunbook(item: { type?: WorkItemType; references?: WorkItemReference[] }): boolean {
  return item.type === "verifier-gate" || (item.references?.length ?? 0) > 0;
}

// A PINNED immutable git ref — a 40-hex commit sha, optionally :path. The Hub is git-LESS
// (it cannot dereference), so for a required git ref it can only REQUIRE a pinned/immutable
// locator (reject a mutable branch/tag); resolution stays the agent's/CI's job. FR-36 at the
// reference layer (pinned-head-SHA realized for node inputs).
const PINNED_GIT_REF = /^[0-9a-f]{40}(:.+)?$/;

// semantic ref-kind → SchemaDef kind, for storage=entity existence checks (the substrate is kind-cased).
const SEMANTIC_KIND_TO_SCHEMA: Record<string, string> = {
  bug: "Bug", idea: "Idea", mission: "Mission", task: "Task",
  proposal: "Proposal", thread: "Thread", workitem: "WorkItem", "work-item": "WorkItem",
  document: "Document", doc: "Document", audit: "Audit", agent: "Agent", turn: "Turn",
};

/** Fail-closed-validate a REQUIRED reference resolves at seed-time. Returns the reason it
 *  can't resolve, or null when resolvable. (Only required:true refs are validated — advisory
 *  refs are stored opaquely, like targetRef.) */
async function validateRequiredReference(
  ref: WorkItemReference,
  store: { entityExists(kind: string, id: string): Promise<boolean> },
  ctx: IPolicyContext,
): Promise<string | null> {
  switch (ref.storage) {
    case "inline":
      return ref.ref && ref.ref.trim() !== "" ? null
        : `required inline reference (kind=${ref.kind}) carries no inline content`;
    case "git":
      return PINNED_GIT_REF.test(ref.ref) ? null
        : `required git reference (kind=${ref.kind}) must be a PINNED 40-hex commit sha[:path], not a mutable branch/tag: "${ref.ref}" (the Hub is git-less + cannot dereference — resolution is the agent's/CI's job)`;
    case "hub-doc": {
      if (!ctx.stores.document) return `cannot verify required hub-doc reference "${ref.ref}": the Document store is not wired`;
      const doc = await ctx.stores.document.get(ref.ref);
      return doc ? null : `required hub-doc reference path does not resolve: "${ref.ref}"`;
    }
    case "entity": {
      const schemaKind = SEMANTIC_KIND_TO_SCHEMA[ref.kind.toLowerCase()];
      if (!schemaKind) return `required entity reference has an unverifiable kind "${ref.kind}" — cannot confirm existence at seed-time (fail-closed)`;
      return (await store.entityExists(schemaKind, ref.ref)) ? null
        : `required entity reference does not resolve: ${schemaKind} "${ref.ref}"`;
    }
    default:
      return `required reference has an unknown storage "${(ref as { storage?: string }).storage}"`;
  }
}

// work-87 (seed_blueprint, F2): the #416 per-node INTRINSIC validation — the node-contract
// checks that are about the NODE itself (evidence-id uniqueness + runbook requirement +
// required-reference resolution), NOT the dependency graph. ONE source of truth shared by
// create_work AND the seed_blueprint expander (anti-drift): the graph-level dependsOn/
// completionDependsOn checks DIFFER by caller — create_work existence-checks them against the
// STORE (targets pre-exist); the expander validates them against the TEMPLATE's localId set +
// the union cycle-check — so those stay at the call-site. Returns the first failure or null.
async function validateNodeIntrinsics(
  node: { type?: WorkItemType; evidenceRequirements?: EvidenceRequirement[]; runbook?: string; references?: WorkItemReference[] },
  store: { entityExists(kind: string, id: string): Promise<boolean> },
  ctx: IPolicyContext,
): Promise<{ errorKind: string; message: string } | null> {
  const evidenceRequirements = node.evidenceRequirements ?? [];
  // Fail-closed: a duplicate requirement id makes complete_work's bind-by-requirementId
  // ambiguous (and could weaken no-double-count) — reject, never coerce.
  const reqIds = evidenceRequirements.map((r) => r.id);
  const dupId = reqIds.find((id, i) => reqIds.indexOf(id) !== i);
  if (dupId !== undefined) {
    return { errorKind: "invalid_evidence_requirements", message: `duplicate evidenceRequirement id "${dupId}" — requirement ids must be unique within a WorkItem (complete_work binds by requirementId)` };
  }
  // bug-220 (c): fail-closed producer-path check — a demanded kind nobody can produce is an
  // item that can never close (the zod enum blocks unknown kinds at the tool boundary; this
  // tripwire catches a future enum kind added without a producer path).
  const unmintable = evidenceRequirements.find((r) => !(r.kind in EVIDENCE_PRODUCER_PATHS));
  if (unmintable) {
    return { errorKind: "invalid_evidence_requirements", message: `evidenceRequirement "${unmintable.id}" demands kind "${unmintable.kind}", which has no mintable producer path — every demanded evidence kind must be producible (bug-220)` };
  }
  // work-86 (idea-380): the node-contract — runbook + references as first-class spec fields.
  const references = node.references ?? [];
  const runbook = node.runbook;
  // Fail-closed: a blueprint/gate node MUST carry a runbook (the cold-start instruction the
  // claimant executes) — a process-naive agent needs it; reject at authoring, never silent.
  if (nodeRequiresRunbook({ type: node.type, references }) && !(runbook && runbook.trim() !== "")) {
    return { errorKind: "missing_runbook", message: "a blueprint/gate node (type=verifier-gate or carrying references[]) requires a non-empty runbook — the just-in-time cold-start instruction the claimant executes" };
  }
  // Fail-closed: a REQUIRED reference that can't resolve at seed-time is a cold-start trap
  // (the claimant can't find its input) — reject at authoring, the dangling-dependsOn posture.
  for (const ref of references) {
    if (!ref.required) continue;
    const problem = await validateRequiredReference(ref, store, ctx);
    if (problem) return { errorKind: "unresolvable_ref", message: problem };
  }
  return null;
}


// ── work-136 (idea-419): update_work — the ratified WorkItem mutation verb ──

/** Cycle guard for edge APPENDS: walk the chosen edge kind from each appended
 *  target; if the item under mutation is reachable, the append closes a cycle.
 *  (create_work is acyclic by construction — a fresh node has no incoming
 *  edges; an UPDATE is the first verb that can bend the graph back.) */
async function appendWouldCycle(
  store: NonNullable<IPolicyContext["stores"]["workItem"]>,
  workId: string,
  appended: string[],
  edge: "dependsOn" | "completionDependsOn",
): Promise<string | null> {
  const visited = new Set<string>();
  const frontier = [...appended];
  while (frontier.length > 0) {
    const id = frontier.pop()!;
    if (id === workId) return id;
    if (visited.has(id)) continue;
    visited.add(id);
    const row = await store.getWorkItem(id);
    if (row) frontier.push(...(edge === "dependsOn" ? row.dependsOn : row.completionDependsOn));
  }
  return null;
}

async function updateWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  const workId = args.workId as string;
  const set = (args.set ?? {}) as { priority?: WorkItemPriority; targetRef?: { kind: string; id: string } | null; runbook?: string; payload?: unknown; roleEligibility?: string[] };
  // Handler-level strictness (the bug-227 lesson: router.handle does not run
  // zod — the schema's .strict() only guards the MCP boundary). An unknown
  // set-key is the contract's own rejection row: status/evidence/type must
  // never be reachable through this verb.
  const ALLOWED_SET = ["priority", "targetRef", "runbook", "payload", "roleEligibility"];
  const unknownKey = Object.keys(set).find((k) => !ALLOWED_SET.includes(k));
  if (unknownKey !== undefined) {
    return err("invalid_arguments", `update rejected: unknown set field "${unknownKey}" — mutable via set: ${ALLOWED_SET.join("/")}; structural edges are explicit append params; type/evidenceRequirements/status are immutable via this verb`);
  }
  // Handler-level VALUE validation (audit-10445, same bug-227 rationale as the
  // key check above): the router doesn't run zod, so an internal caller could
  // persist an out-of-domain priority.
  const PRIORITIES = ["low", "normal", "high", "critical"];
  if (set.priority !== undefined && !PRIORITIES.includes(set.priority as string)) {
    return err("invalid_arguments", `update rejected: priority "${String(set.priority)}" is not in the domain ${PRIORITIES.join("/")}`);
  }
  const appendDependsOn = (args.appendDependsOn as string[] | undefined) ?? [];
  const appendCompletionDependsOn = (args.appendCompletionDependsOn as string[] | undefined) ?? [];
  const appendReferences = (args.appendReferences as WorkItemReference[] | undefined) ?? [];

  // Orphan guard (contract: "resulting set must be non-empty-claimable"): in
  // this queue an EMPTY roleEligibility means any-role (claimable by all), so
  // the orphan risk is a set naming roles nobody holds — reject unknown roles.
  if (set.roleEligibility) {
    const KNOWN = ["engineer", "architect", "verifier", "director"];
    const bad = set.roleEligibility.find((r) => !KNOWN.includes(r));
    if (bad !== undefined) return err("invalid_arguments", `update rejected: roleEligibility entry "${bad}" is not a claimable role (${KNOWN.join("/")}) — the resulting set must be claimable-by-someone (empty = any-role is allowed)`);
  }
  // Dangling posture (mirrors create_work): every appended edge target exists.
  for (const depId of [...appendDependsOn, ...appendCompletionDependsOn]) {
    if (!(await store.getWorkItem(depId))) {
      return err("unresolvable_ref", `update rejected: appended edge references a non-existent WorkItem: ${depId}`);
    }
  }
  // Cycle guard across the appended edges (the update-specific hazard).
  if (appendDependsOn.length) {
    const via = await appendWouldCycle(store, workId, appendDependsOn, "dependsOn");
    if (via) return err("invalid_arguments", `update rejected: appending dependsOn [${appendDependsOn.join(",")}] closes a cycle back to ${workId} — the queue graph stays a DAG`);
  }
  if (appendCompletionDependsOn.length) {
    const via = await appendWouldCycle(store, workId, appendCompletionDependsOn, "completionDependsOn");
    if (via) return err("invalid_arguments", `update rejected: appending completionDependsOn [${appendCompletionDependsOn.join(",")}] closes a cycle back to ${workId}`);
  }
  // Appended REQUIRED references fail-closed resolve (the create_work seed rule).
  for (const ref of appendReferences) {
    if (!ref.required) continue;
    const problem = await validateRequiredReference(ref, store, ctx);
    if (problem) return err("unresolvable_ref", `update rejected: ${problem}`);
  }

  try {
    const { before, after } = await store.updateWorkItem(workId, { agentId: caller.agentId, role: caller.role }, {
      set: Object.keys(set).length ? set : undefined,
      appendDependsOn: appendDependsOn.length ? appendDependsOn : undefined,
      appendCompletionDependsOn: appendCompletionDependsOn.length ? appendCompletionDependsOn : undefined,
      appendReferences: appendReferences.length ? appendReferences : undefined,
    });
    // The contract's loudness: one audit entry per accepted call, before→after
    // per touched field...
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const k of Object.keys(set)) changes[k] = { before: (before as unknown as Record<string, unknown>)[k], after: (after as unknown as Record<string, unknown>)[k] };
    if (appendDependsOn.length) changes.dependsOn = { before: before.dependsOn, after: after.dependsOn };
    if (appendCompletionDependsOn.length) changes.completionDependsOn = { before: before.completionDependsOn, after: after.completionDependsOn };
    if (appendReferences.length) changes.references = { before: (before.references ?? []).length, after: (after.references ?? []).length };
    try {
      await ctx.stores.audit.logEntry(
        caller.role as "architect" | "engineer" | "verifier" | "hub",
        "work_updated",
        `update_work ${workId} by ${caller.role}/${caller.agentId}: ${JSON.stringify(changes)}`,
        workId,
      );
    } catch (e) {
      console.error(`[work-item-policy] update_work audit failed (non-fatal; the mutation stands): ${e instanceof Error ? e.message : e}`);
    }
    // ...and one work-updated event on the work-124 role-targeted path.
    await emitWorkUpdated(ctx, after, { agentId: caller.agentId, role: caller.role }, Object.keys(changes));
    return ok({ workItem: after, changed: Object.keys(changes) });
  } catch (e) {
    if (e instanceof TransitionRejected) return err("update_rejected", e.message);
    throw e;
  }
}

async function createWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);

  const roleEligibility = (args.roleEligibility as string[] | undefined) ?? [];
  const dependsOn = (args.dependsOn as string[] | undefined) ?? [];
  const completionDependsOn = (args.completionDependsOn as string[] | undefined) ?? [];
  const evidenceRequirements = (args.evidenceRequirements as EvidenceRequirement[] | undefined) ?? [];
  const runbook = args.runbook as string | undefined;
  const references = (args.references as WorkItemReference[] | undefined) ?? [];

  // The #416 per-node intrinsic validation (evidence-dup + runbook + required-refs) — shared
  // with the seed_blueprint expander (F2, one source of truth).
  const intrinsic = await validateNodeIntrinsics({ type: args.type as WorkItemType, evidenceRequirements, runbook, references }, store, ctx);
  if (intrinsic) return err(intrinsic.errorKind, intrinsic.message);

  // Fail-closed: a dangling dependsOn is a permanently-unclaimable item (claim-time
  // dependency-readiness never resolves) — reject at authoring rather than silently store it.
  for (const depId of dependsOn) {
    const dep = await store.getWorkItem(depId);
    if (!dep) return err("unresolvable_ref", `dependsOn references a non-existent WorkItem: ${depId}`);
  }

  // work-88 (arc-node): the COMPLETION-gate edge. Fail-closed existence-check — a dangling
  // completionDependsOn is a completion-gate that can NEVER close (the arc-holder would be
  // permanently blocked at complete_work) — reject at authoring, the dependsOn posture.
  // This existence-loop IS the single-node cycle-validation: a freshly-created node has no
  // incoming edges (nothing references it yet), so as long as its targets pre-exist the graph
  // stays acyclic-by-construction (F5). The whole-graph cross-edge DFS lives in the work-87
  // expander, where a batch of forward-referencing nodes is materialized atomically.
  for (const depId of completionDependsOn) {
    const dep = await store.getWorkItem(depId);
    if (!dep) return err("unresolvable_ref", `completionDependsOn references a non-existent WorkItem: ${depId}`);
  }

  try {
    const w = await store.createWorkItem({
      type: args.type as WorkItemType,
      priority: args.priority as WorkItemPriority | undefined,
      roleEligibility,
      dependsOn,
      completionDependsOn,
      evidenceRequirements,
      runbook,
      references,
      targetRef: (args.targetRef as { kind: string; id: string } | null | undefined) ?? null,
      payload: args.payload,
      createdBy: caller,
    });
    // A new ready item IS the claimable signal — emit it (create has no "from" status).
    // (seed_blueprint expansion creates via the repo directly and intentionally does NOT
    // per-node-emit — a 100-node blueprint would broadcast-storm; its claimability lands
    // via the idea-353 digest until a batch-level event is warranted.)
    await emitWorkTransition(ctx, { item: w, verb: "create_work", fromStatus: null, actor: caller });
    return workItemResult(w);
  } catch (e) { return mapVerbError(e); }
}

// ── work-87 (seed_blueprint): the declarative WorkItem-graph expander ────────────────
// A FINITE DAG expander (NOT a workflow platform — no loops/conditionals/streaming): takes a
// declarative blueprint (nodes[] with localId-keyed dependsOn + completionDependsOn) and
// materializes it onto the queue. VALIDATE-WHOLE-GRAPH-FIRST + a deterministic run-key =
// all-or-nothing WITHOUT a transaction (the substrate has none): any VALIDATION failure creates
// ZERO; a post-validation INFRA failure mid-create is rolled back by a compensating-delete of
// THIS run's creates (loud trail) AND recoverable by idempotent re-run (node id =
// work-bp-{runId}-{localId}, so createOnly dedups — kubectl-apply semantics).

/** Blueprint node-cap (finite-DAG safety, design §0.5 T1). Generous; a blueprint is a council/
 *  close-out graph, not a platform. */
const MAX_BLUEPRINT_NODES = 100;

/** localId + runId charset — alphanumeric + underscore ONLY (NO dash), so the composite id
 *  `work-bp-{runId}-{localId}` uses dash as its SOLE separator and is collision-free. */
const BLUEPRINT_ID_TOKEN = /^[A-Za-z0-9_]+$/;

/** The deterministic per-node WorkItem id — the idempotency key (createOnly dedups a re-run).
 *  Exported for the collision-safety proof: dash is the SOLE separator, so it is ONLY
 *  collision-free while runId+localId exclude dash (BLUEPRINT_ID_TOKEN) — else
 *  blueprintNodeId('a-b','c') === blueprintNodeId('a','b-c'). */
export function blueprintNodeId(runId: string, localId: string): string {
  return `work-bp-${runId}-${localId}`;
}

interface BlueprintNode {
  localId: string;
  label?: string;
  type: WorkItemType;
  priority?: WorkItemPriority;
  roleEligibility?: string[];
  dependsOn?: string[];
  completionDependsOn?: string[];
  references?: WorkItemReference[];
  evidenceRequirements?: EvidenceRequirement[];
  runbook?: string;
  targetRef?: { kind: string; id: string } | null;
  payload?: unknown;
}

/** F3: Kahn topological sort over the UNION of dependsOn + completionDependsOn edges. Both
 *  edges impose the SAME create-ordering — a node references its targets' minted ids at create,
 *  so every target must precede its source — so one union sort gives the creation order for both
 *  AND the cycle-check spans the union (a cross-edge cycle is uncreatable). Returns the localIds
 *  in creation order (targets first), or null if the union graph has a cycle (incl. a self-loop).
 *  Precondition: every edge target is a known localId (the dangling-check runs first). */
function unionTopoSort(nodes: BlueprintNode[]): string[] | null {
  const ids = nodes.map((n) => n.localId);
  const inDegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const dependents = new Map<string, string[]>(ids.map((id) => [id, []])); // target -> sources depending on it
  for (const n of nodes) {
    // a target listed on BOTH edges counts ONCE toward ordering (Set dedup)
    const targets = new Set([...(n.dependsOn ?? []), ...(n.completionDependsOn ?? [])]);
    for (const t of targets) {
      inDegree.set(n.localId, (inDegree.get(n.localId) ?? 0) + 1); // n depends on t
      dependents.get(t)!.push(n.localId);
    }
  }
  const queue = ids.filter((id) => (inDegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const dep of dependents.get(id) ?? []) {
      const d = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, d);
      if (d === 0) queue.push(dep);
    }
  }
  return order.length === ids.length ? order : null; // fewer than all => a cycle remains
}

async function seedBlueprint(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);

  const runId = args.runId as string;
  const nodes = (args.nodes as BlueprintNode[] | undefined) ?? [];
  const dryRun = args.dryRun === true;

  // ── Validate the WHOLE graph fail-closed BEFORE creating anything (all-or-nothing) ──
  // 0) run-key + non-empty + node-cap (F5; finite-DAG safety, design §0.5 T1)
  if (!runId || !BLUEPRINT_ID_TOKEN.test(runId)) {
    return err("invalid_blueprint", `runId must be non-empty alphanumeric/underscore (it keys the deterministic node ids work-bp-{runId}-{localId})`);
  }
  if (nodes.length === 0) return err("invalid_blueprint", "blueprint has no nodes");
  if (nodes.length > MAX_BLUEPRINT_NODES) {
    return err("invalid_blueprint", `blueprint has ${nodes.length} nodes (cap ${MAX_BLUEPRINT_NODES}) — seed_blueprint is a finite DAG expander, not a platform`);
  }

  // 1) localId integrity: present + charset + UNIQUE (it keys the deterministic id + the graph)
  const localIds = nodes.map((n) => n.localId);
  for (const lid of localIds) {
    if (!lid || !BLUEPRINT_ID_TOKEN.test(lid)) {
      return err("invalid_blueprint", `localId "${lid}" must be non-empty alphanumeric/underscore`);
    }
  }
  const dupLocal = localIds.find((id, i) => localIds.indexOf(id) !== i);
  if (dupLocal !== undefined) return err("invalid_blueprint", `duplicate localId "${dupLocal}" — localIds must be unique within a blueprint`);
  const idSet = new Set(localIds);

  // 2) dangling check across BOTH edges — every edge target must be a known localId
  for (const n of nodes) {
    for (const dep of n.dependsOn ?? []) {
      if (!idSet.has(dep)) return err("unresolvable_ref", `node "${n.localId}" dependsOn unknown localId "${dep}"`);
    }
    for (const dep of n.completionDependsOn ?? []) {
      if (!idSet.has(dep)) return err("unresolvable_ref", `node "${n.localId}" completionDependsOn unknown localId "${dep}"`);
    }
  }

  // 3) cycle check via the union topo-sort (also yields the creation order, F4)
  const order = unionTopoSort(nodes);
  if (order === null) {
    return err("cycle_detected", "blueprint has a dependency cycle across the dependsOn+completionDependsOn union — a finite DAG is required");
  }

  // 4) per-node #416 intrinsic validation (evidence-dup + runbook + required-refs) — ALL upfront
  for (const n of nodes) {
    const intrinsic = await validateNodeIntrinsics(n, store, ctx);
    if (intrinsic) return err(intrinsic.errorKind, `node "${n.localId}": ${intrinsic.message}`);
  }

  // The deterministic localId -> work-id map (derivable purely from runId+localId; identical for
  // the dry-run preview AND the real expansion).
  const localToWork = new Map<string, string>(localIds.map((lid) => [lid, blueprintNodeId(runId, lid)]));
  const byLocalId = new Map(nodes.map((n) => [n.localId, n]));

  // 5) DRY-RUN: validation passed — return the PLAN (create-order + the would-be work-ids) and
  //    create ZERO (design §0.5 T1: dry-run required — a true preview + ids for pre-create cleanup).
  if (dryRun) {
    return ok({
      dryRun: true,
      valid: true,
      runId,
      nodeCount: nodes.length,
      creationOrder: order,
      localIdToWorkId: Object.fromEntries(localToWork),
    });
  }

  // 6) EXPAND in topo order (targets-first) via the deterministic-id createOnly. Translate both
  //    edges' localIds -> deterministic work-ids. Track THIS invocation's NEW creates for the
  //    compensating-delete (created:true only — prior-run nodes are left for re-run-completion).
  const createdThisRun: string[] = [];
  let reusedCount = 0;
  try {
    for (const localId of order) {
      const n = byLocalId.get(localId)!;
      const { created } = await store.createBlueprintNode({
        id: localToWork.get(localId)!,
        blueprintRunId: runId,
        type: n.type,
        priority: n.priority,
        roleEligibility: n.roleEligibility ?? [],
        dependsOn: (n.dependsOn ?? []).map((l) => localToWork.get(l)!),
        completionDependsOn: (n.completionDependsOn ?? []).map((l) => localToWork.get(l)!),
        evidenceRequirements: n.evidenceRequirements,
        runbook: n.runbook,
        references: n.references,
        targetRef: n.targetRef ?? null,
        payload: n.payload,
        createdBy: caller,
      });
      if (created) createdThisRun.push(localToWork.get(localId)!);
      else reusedCount++;
    }
  } catch (e) {
    // F1a fast-path rollback: compensating-delete THIS run's NEW creates (leaving any prior-run
    // nodes intact for re-run-completion). The error ALWAYS lists the trail — even if a delete
    // itself fails (those ids may be orphans needing manual cleanup); the run-key makes the
    // partial completable-by-re-run regardless.
    const rollbackFailures: string[] = [];
    for (const id of createdThisRun) {
      try { await store.deleteWorkItem(id); } catch { rollbackFailures.push(id); }
    }
    return { content: [{ type: "text" as const, text: JSON.stringify({
      errorKind: "expansion_failed",
      error: "seed_blueprint expansion failed mid-create after whole-graph validation passed (infra fault); rolled back this run's creates via compensating-delete",
      cause: e instanceof Error ? e.message : String(e),
      runId,
      createdAndRolledBack: createdThisRun,
      rollbackFailures, // non-empty => possible ORPHANS (manual cleanup); re-running the same runId also completes/cleans
    }) }], isError: true };
  }

  // 7) return the expanded graph: localId -> deterministic work-id + the wired order
  return ok({
    runId,
    nodeCount: nodes.length,
    created: createdThisRun, // newly minted THIS invocation
    reused: reusedCount,     // already present from a prior run (idempotent re-run)
    creationOrder: order,
    localIdToWorkId: Object.fromEntries(localToWork),
  });
}

async function getWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const w = await store.getWorkItem(args.workId as string);
  if (!w) return notFound(args.workId as string);
  // A read: return the full item (incl. lease, for the org-state snapshot's observability),
  // but do NOT hoist leaseToken to the top level — that hoist is a claim-affordance for the
  // HOLDER and is misleading on a read (a non-holder who reads the token still can't use it;
  // every lease-bound verb also fences on holder===caller.agentId).
  // work-88 (arc-node): opt-in k/N completion-gate projection — surfaces how much of an
  // arc's subtree is finalised (feeds the cold-start get_current_stint). Off by default so
  // the common point-read pays no per-child fan-out; only computed when explicitly asked.
  if (args.includeCompletionProgress === true) {
    const completionProgress = await store.getCompletionProgress(args.workId as string);
    return ok({ workItem: w, completionProgress });
  }
  return ok({ workItem: w });
}

// work-94 (cold-start spine): the "where are we" projection over an arc-node's subtree.
async function getCurrentStint(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const stint = await store.getStintProjection(args.workId as string);
  return stint ? ok({ stint }) : notFound(args.workId as string);
}

// work-94 (cold-start spine): the "what can I do from here" projection — the legal FSM moves
// for the SPOOF-PROOF caller (resolved from the session, not args) given the item's state.
async function legalMoves(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  const moves = await store.getLegalMoves(args.workId as string, { agentId: caller.agentId, role: caller.role });
  return moves ? ok({ legalMoves: moves }) : notFound(args.workId as string);
}

async function listWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  // The org-state snapshot (stint-4 R1 / idea-357-pt3): ALL matching items, NOT a claimable
  // projection. Lease + dependency-blocked state are COLUMNS, not filters — the deps/WIP
  // readiness gate is list_ready_work's job (bug-181); list_work is the observability surface
  // (shows blocked/leased/done items too). Filters AND across status/role/holder. The lease
  // column rides on each flat item (holder/expiry/state) — the get_work shape, for many.
  const { items, truncated } = await store.listWorkItems({
    status: args.status as WorkItemPhase | undefined,
    role: args.role as string | undefined,
    holder: args.holder as string | undefined,
  });
  const page = paginate(items, args);
  // truncation-HONEST (A4): `truncated` = the 500-row substrate scan was capped (there
  // may be MORE matches we never saw) — distinct from pagination (limit/offset over what we DID see).
  const truncationNote = truncated
    ? { truncationNote: `the WorkItem scan hit the ${MAX_LIST_LIMIT}-row cap — result is INCOMPLETE; narrow by status/role/holder (or treat as a backlog-pressure signal)` }
    : {};
  return ok({ ...page, truncated, ...truncationNote });
}

// ── Schemas ─────────────────────────────────────────────────────────────────

// Exported for the bug-220 (c) completeness test — the test iterates .options so the pin
// is MECHANICAL (audit-9443 verifier finding #2), never a hand-mirrored list.
export const EVIDENCE_KIND = z.enum(["commit", "pr", "audit", "review", "test-run", "doc", "freeform"]);

/** bug-220 (c): every evidence kind a contract can DEMAND must have a MINTABLE producer
 *  path — otherwise the item parks in review/incompletable forever (work-111 was the live
 *  case: review-kind refResolvable demanded a gate no role could mint). Authoring-side
 *  fail-closed tripwire: validateNodeIntrinsics rejects a requirement whose kind is absent
 *  here. DOUBLY pinned (audit-9443 #2): the Record<EvidenceKind, string> type makes a new
 *  TS-union kind without a producer entry a COMPILE error, and the policy test iterates the
 *  exported zod enum's .options — no hand-mirrored list anywhere. Values are human-readable
 *  producer descriptions (error text). */
export const EVIDENCE_PRODUCER_PATHS: Readonly<Record<EvidenceKind, string>> = {
  commit: "a git commit (external ref, format-validated)",
  pr: "a GitHub PR (external ref, format-validated)",
  "test-run": "a CI/test run (external ref, format-validated)",
  doc: "a document (external ref, format-validated)",
  freeform: "any freeform artifact",
  audit: "create_audit_entry ([Any])",
  review: "a verifier-authored verdict audit via create_audit_entry (bug-220 (b); create_review is DEPRECATED, audit-9429) or an architect-seeded verifier-gate WorkItem",
};
const evidenceItemSchema = z.object({
  requirementId: z.string().describe("The evidenceRequirements[].id this evidence binds to"),
  kind: EVIDENCE_KIND,
  ref: z.string().optional().describe("The artifact ref (commit sha / PR url / OIS-internal entity id)"),
  producedAt: z.string().describe("ISO-8601 timestamp the evidence was produced"),
  note: z.string().optional(),
  producedBy: z.string().optional().describe("Authoring agent id — REQUIRED for review-kind evidence (must resolve to a verifier-role agent before review→done)"),
}).strict();
const blockedOnSchema = z.object({
  blockerKind: z.string().describe("Blocker category, e.g. WorkItem | Task | external | dependency"),
  blockerIds: z.array(z.string()).optional().describe("Referenced blocker entity ids"),
  reason: z.string().describe("Human-readable why"),
}).strict();

const WORK_TYPE = z.enum(["task", "bug", "review", "verifier-gate", "freeform"]);
const WORK_PRIORITY = z.enum(["critical", "high", "normal", "low"]);
// Canonical phase set = WorkItemPhase (entities/work-item.ts) — mirrored here for the
// list_work filter schema (same local duplication pattern as WORK_TYPE/WORK_PRIORITY +
// the all-schemas storage-validation copy). Keep in sync with WorkItemPhase.
const WORK_PHASE = z.enum(["ready", "claimed", "in_progress", "blocked", "review", "done", "abandoned"]);
const evidenceRequirementSchema = z.object({
  id: z.string().min(1).describe("Author-supplied requirement id — complete_work binds evidence to it by requirementId (unique within the item)"),
  kind: EVIDENCE_KIND,
  description: z.string().optional(),
  refResolvable: z.boolean().optional().describe("When set, an OIS-internal bound ref (audit/review) must existence-resolve at complete; external refs (commit/pr/...) are format-validated only"),
  allowPreClaim: z.boolean().optional().describe("When set, freshness (producedAt >= claimedAt) is NOT required — permits a pre-claim artifact"),
}).strict();
const targetRefSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
}).strict();

// work-86 (idea-380): a typed node REFERENCE the node consumes (the references(consume) leg).
const referenceSchema = z.object({
  kind: z.string().min(1).describe("semantic kind: doc | bug | idea | mission | workitem | calibration | ..."),
  ref: z.string().min(1).describe("the locator: inline content | pinned sha[:path] | doc path | entity id"),
  storage: z.enum(["inline", "git", "hub-doc", "entity"]).describe("where it lives + how seed-time validation resolves it"),
  mode: z.enum(["read", "triangulate-against"]).describe("how the claimant uses it"),
  required: z.boolean().describe("required:true → create_work fail-closed-validates resolvability at seed-time"),
}).strict();

// work-87 (seed_blueprint): a declarative blueprint node. localId-keyed (template-internal);
// dependsOn/completionDependsOn reference OTHER localIds in the same blueprint (NOT real work-ids
// — the expander translates them to the minted ids). Mirrors the WorkItem node-contract.
const blueprintNodeSchema = z.object({
  localId: z.string().min(1).describe("Template-internal node key (alphanumeric/underscore); UNIQUE within the blueprint; referenced by other nodes' dependsOn/completionDependsOn."),
  label: z.string().optional().describe("Human label (advisory)"),
  type: WORK_TYPE.describe("WorkItem type"),
  priority: WORK_PRIORITY.optional().describe("Priority (default: normal)"),
  roleEligibility: z.array(z.string()).optional().describe("Roles that may claim; empty/omitted = any role"),
  dependsOn: z.array(z.string()).optional().describe("localIds of nodes that must complete before this is claimable (START-gate); each must be another localId in this blueprint"),
  completionDependsOn: z.array(z.string()).optional().describe("localIds whose completion gates this node's complete_work (COMPLETION-gate / arc-node); each must be another localId in this blueprint"),
  references: z.array(referenceSchema).optional().describe("Typed inputs the node consumes (#416); a required:true ref is resolvability-validated at seed-time"),
  evidenceRequirements: z.array(evidenceRequirementSchema).optional().describe("Anti-gameability evidence contract enforced by complete_work; requirement ids unique within the node"),
  runbook: z.string().optional().describe("Cold-start instruction; REQUIRED for a gate node (type=verifier-gate) or one carrying references[]"),
  targetRef: targetRefSchema.nullable().optional().describe("Pointer to the entity this node is about ({kind,id}); opaque/advisory"),
  payload: z.unknown().optional().describe("Freeform node payload (e.g. the brief)"),
}).strict();

// ── Registration ──────────────────────────────────────────────────────────────

export function registerWorkItemPolicy(router: PolicyRouter): void {
  router.register(
    "create_work",
    "[Architect] Create a WorkItem on the queue (status=ready) — the C1 adoption on-ramp. Mirrors the WorkItem spec: type + role-eligibility (empty/omitted = any role) + dependsOn (existence-checked; a dangling dep is REJECTED — it would be permanently unclaimable) + evidenceRequirements (the anti-gameability contract complete_work enforces; requirement ids must be unique) + targetRef ({kind,id}; opaque/advisory at create) + priority + payload. Provenance is the spoof-proof session caller. NARROW adoption: the architect authors mission-level work; the [Any] lifecycle verbs let any eligible role claim→execute.",
    {
      type: WORK_TYPE.describe("WorkItem type"),
      roleEligibility: z.array(z.string()).optional().describe("Roles that may claim; empty/omitted = any role"),
      priority: WORK_PRIORITY.optional().describe("Priority (default: normal)"),
      dependsOn: z.array(z.string()).optional().describe("WorkItem ids that must complete before this is claimable; each must already exist (dangling → rejected)"),
      completionDependsOn: z.array(z.string()).optional().describe("work-88 (arc-node): WorkItem ids whose completion GATES this node's complete_work (the COMPLETION-gate edge, distinct from the dependsOn START-gate). Empty = a leaf (today's behavior); populated = an arc/umbrella node claimable immediately but completable only when ALL listed children are done. Each must already exist (dangling → rejected)."),
      evidenceRequirements: z.array(evidenceRequirementSchema).optional().describe("Anti-gameability evidence contract enforced by complete_work"),
      runbook: z.string().optional().describe("work-86: the cold-start instruction the claimant executes. REQUIRED for a blueprint/gate node (type=verifier-gate or carrying references[]); a process-naive agent learns the task from it (no prior context)."),
      references: z.array(referenceSchema).optional().describe("work-86: typed inputs the node CONSUMES (the references(consume) leg of the node-contract). A required:true reference is fail-closed-validated to resolve at seed-time (inline content present | pinned git sha | hub-doc exists | entity exists) — a dangling required input is a cold-start trap, rejected at authoring."),
      targetRef: targetRefSchema.nullable().optional().describe("Pointer to the entity this work is about ({kind,id}); opaque/advisory at create"),
      payload: z.unknown().optional().describe("Freeform work payload (e.g. the task brief)"),
    },
    createWork,
  );

  router.register(
    "update_work",
    "[Any] work-136 (idea-419, ratified contract v1.0 / decision-11): mutate a WorkItem per the field-mutability table. AUTHORITY: the item's AUTHOR or the ARCHITECT (Hub-derived from the session — no lease-holder writes in v1). set{} replaces priority/targetRef anytime pre-terminal; runbook/payload/roleEligibility PRE-CLAIM only (the claimant's contract freezes at claim). Structural edges are APPEND-ONLY explicit params (never via set): appendDependsOn (while ready; re-gating is the intended effect — the work-133 case), appendCompletionDependsOn (until done; arc accretion), appendReferences (pre-claim; required refs fail-closed resolve). Rejects: empty mutation, terminal item, phase violations, dangling/cyclic edges, unclaimable roleEligibility, stale CAS (re-read and re-decide). Every accepted call: one audit entry (actor + before→after) + one work-updated event, role-targeted per work-124. type + evidenceRequirements are IMMUTABLE FOREVER (the anti-gameability contract).",
    {
      workId: z.string(),
      set: z.object({
        priority: z.enum(["low", "normal", "high", "critical"]).optional(),
        targetRef: targetRefSchema.nullable().optional(),
        runbook: z.string().optional(),
        payload: z.unknown().optional(),
        roleEligibility: z.array(z.string()).optional(),
      }).strict().optional().describe("Replace-semantics fields, per-field phase rules; UNKNOWN KEYS REJECT (strict)"),
      appendDependsOn: z.array(z.string()).optional().describe("Append claim-gate deps (while ready; existence+cycle checked)"),
      appendCompletionDependsOn: z.array(z.string()).optional().describe("Append completion-gate children (until done; existence+cycle checked)"),
      appendReferences: z.array(referenceSchema).optional().describe("Append node-contract inputs (pre-claim; required refs must resolve)"),
    },
    updateWork,
  );

  router.register(
    "seed_blueprint",
    "[Architect] Expand a declarative blueprint (a WorkItem-graph template) onto the queue — the seed_blueprint primitive (idea-380 S2). A FINITE DAG expander (NOT a workflow platform): nodes[] keyed by localId, dependsOn + completionDependsOn referencing OTHER localIds. VALIDATES THE WHOLE GRAPH fail-closed BEFORE creating anything (dup/dangling localId; cycle across BOTH edges; per-node #416 runbook+required-refs; node-cap) → any validation failure creates ZERO. Deterministic + idempotent (kubectl-apply): each node id = work-bp-{runId}-{localId}, created via createOnly, so re-running the same runId+blueprint never double-creates AND completes a crash-partial. dryRun:true validates + returns the planned create-order + would-be work-ids, creating ZERO. A mid-create infra fault compensating-deletes THIS run's creates + returns a loud id-trail.",
    {
      runId: z.string().min(1).describe("Deterministic run-key (alphanumeric/underscore) — keys the per-node ids work-bp-{runId}-{localId}; re-running the same runId+blueprint is idempotent (no double-create)."),
      nodes: z.array(blueprintNodeSchema).describe("The blueprint nodes (≥1, ≤cap). Each localId-keyed; dependsOn/completionDependsOn reference other localIds in the SAME blueprint."),
      dryRun: z.boolean().optional().describe("When true: validate the whole graph + return the planned create-order + would-be work-ids, creating ZERO WorkItems (a true preview)."),
    },
    seedBlueprint,
  );

  router.register(
    "get_work",
    "[Any] Read a WorkItem by id (any phase — incl. non-ready items the org-state snapshot wants). Returns the flat item (incl. lease, for observability) or not_found. Pass includeCompletionProgress:true for the arc-node k/N completion-gate projection ({done,total,pending} over the item's completionDependsOn children — feeds the cold-start get_current_stint).",
    {
      workId: z.string().describe("The WorkItem id to read"),
      includeCompletionProgress: z.boolean().optional().describe("work-88 (arc-node): when true, also compute the k/N COMPLETION-gate progress — {done,total,pending} over completionDependsOn (children at phase=done). Opt-in: off by default so a plain read pays no per-child fan-out."),
    },
    getWork,
  );

  router.register(
    "get_current_stint",
    "[Any] THE COLD-START 'where are we' SURFACE (work-94 spine): project an arc-node's subtree — k/N completion-gate progress (done/total/pending) + per-child status + in-flight/blocked rollups + whether the completion-gate is OPEN (gateOpen = would complete_work pass). Works for ANY arc-node (an arc = a WorkItem carrying completionDependsOn children; the stint arc-node is the first consumer). The one-enforced-close surface — a process-naive agent sees the whole arc's state with NO prior context. A leaf (no children) projects total:0/gateOpen:false; a vanished child surfaces as status 'missing', never hidden. work-99 (idea-384 Part B) ALSO rolls up the SUBTREE EFFORT PROFILE: rolledUpDurations = per-state ms summed over the UNIQUE reachable LEAVES (leaves-only + DAG-deduped — a shared leaf counted once); ownActiveMs = the arc's OWN active wall-clock (its claimed+in_progress+blocked+review, EXCLUDING ready/queue-wait); parallelism = rolledUpDurations.in_progress / ownActiveMs (>1 ⇒ subtree concurrency achieved, <1 ⇒ serial/idle gaps, null when no active span). Read parallelism as concurrency-vs-ACTIVE-span, NOT vs total-elapsed.",
    {
      workId: z.string().describe("The arc-node WorkItem id to project (any item id)"),
    },
    getCurrentStint,
  );

  router.register(
    "legal_moves",
    "[Any] THE COLD-START 'what can I do from here' SURFACE (work-94 spine): the legal FSM transition verbs for an item given its state/lease/gates, FROM YOUR seat (the spoof-proof session caller). Each verb carries `legal` + (when illegal) a non-dark `reason` — so a process-naive agent knows its affordances AND why the rest are unavailable. Caller-aware (the lease-bound verbs — start/block/resume/complete/release/abandon/renew — require you to be the lease-holder; abandon also allows the creator) + gate-aware (an arc with an unmet completion-gate → complete is NOT legal; a leaf → complete IS). claim is legal from `ready` when role-eligible + dependency-met (WIP-cap + quarantine are re-checked at claim-time).",
    {
      workId: z.string().describe("The WorkItem id to compute the caller's legal moves for"),
    },
    legalMoves,
  );

  router.register(
    "claim_work",
    "[Any] Claim a ready WorkItem (ready → claimed). Enforces role-eligibility + dependency-readiness + the per-agent WIP cap fail-closed; mints a lease token returned as `leaseToken` — capture it for every subsequent lease-bound verb. C1-R2 (working name; idea-121 finalizes the tool surface).",
    { workId: z.string().describe("The WorkItem id to claim") },
    claimWork,
  );

  router.register(
    "list_ready_work",
    "[Any] THE COLD-START 'what do I do next' SURFACE (work-94 spine): the next WorkItem(s) you can claim, each already carrying its node-contract — runbook (the just-in-time how-to) + references (the inputs to read) — so a process-naive agent is self-sufficient with NO prior context. Lists ready WorkItems claimable by a role (empty roleEligibility = any-role, OR'd in); defaults to the caller's role, pass `role` to view another queue. Pass `scopeToCaller:true` for the CALLER-CLAIMABLE projection — applies claim_work's FULL eligibility predicate (deps + role + WIP-cap + quarantine), so the count never over-reports what you can actually claim (the idea-353 re-engagement digest). NON-DARK: an empty result carries `emptyReason` + `emptyReasonMessage` (wip_capped | no_claimable_ready | quarantined) — never a silent zero, so you always know the next move. truncation-HONEST: a capped scan sets `truncated` + a note (never a silent cap).",
    {
      role: z.string().optional().describe("Role to project for (default: the caller's role)"),
      limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional().describe(`Max items (default ${DEFAULT_LIST_LIMIT}, cap ${MAX_LIST_LIMIT})`),
      scopeToCaller: z.boolean().optional().describe("When true, project only items the CALLER can actually claim (full claim_work predicate incl. WIP-cap + quarantine); a maxed/quarantined caller gets count 0. Default false = the non-agent-scoped role view."),
    },
    listReadyWork,
  );

  router.register(
    "list_work",
    "[Any] Query WorkItems by status/role/holder — the org-state SNAPSHOT (the controller's ground-truth view, today hand-stitched from list_ready_work × roles × get_work). Returns FLAT items incl. the LEASE column (holder / expiry / state) for observability, UNFILTERED by claim-readiness: shows ALL matching items incl. dependency-blocked + leased + done (lease/blocked are COLUMNS, not filters — the deps/WIP readiness gate is list_ready_work's job, bug-181). Filters AND across status/role/holder. Paginated (limit/offset); truncation-HONEST — a 500-row scan-cap sets `truncated` + a note, never a silent cap (A4). idea-357-pt3.",
    {
      status: WORK_PHASE.optional().describe("Filter by FSM phase (ready|claimed|in_progress|blocked|review|done|abandoned)"),
      role: z.string().optional().describe("Filter by role-eligibility ($contains membership; empty-eligibility 'any-role' items won't match a specific role)"),
      holder: z.string().optional().describe("Filter by current lease holder (agentId) — items this agent holds a lease on"),
      ...LIST_PAGINATION_SCHEMA,
    },
    listWork,
  );

  router.register(
    "start_work",
    "[Any] Begin work on a claimed item (claimed → in_progress). Requires the lease-holder + matching leaseToken.",
    { workId: z.string(), leaseToken: z.string().describe("The token from claim_work") },
    startWork,
  );

  router.register(
    "block_work",
    "[Any] Mark in-progress work blocked (in_progress → blocked). Requires the lease-holder + matching leaseToken. The lease is RETAINED (blocked counts toward WIP).",
    { workId: z.string(), leaseToken: z.string(), blockedOn: blockedOnSchema },
    blockWork,
  );

  router.register(
    "resume_work",
    "[Any] Resume blocked work (blocked → in_progress); clears blockedOn. Requires the lease-holder + matching leaseToken.",
    { workId: z.string(), leaseToken: z.string() },
    resumeWork,
  );

  router.register(
    "renew_lease",
    "[Any] Heartbeat-extend the lease without changing phase (keeps a long task from being swept). Requires the lease-holder + matching leaseToken.",
    { workId: z.string(), leaseToken: z.string() },
    renewLease,
  );

  router.register(
    "release_work",
    "[Any] Voluntarily un-claim back to ready ({claimed|in_progress|blocked} → ready); clears the lease. Requires the lease-holder + matching leaseToken.",
    { workId: z.string(), leaseToken: z.string() },
    releaseWork,
  );

  router.register(
    "abandon_work",
    "[Any] Terminally abandon work ({claimed|in_progress|blocked} → abandoned). The lease-holder (with leaseToken) OR the item creator (no token — override authority) may abandon; the creator may also abandon from `ready` (bug-219: closes items whose roleEligibility has no registered seat).",
    {
      workId: z.string(),
      reason: z.string().optional().describe("Why the item is being abandoned"),
      leaseToken: z.string().optional().describe("Required for the holder path; omitted for the creator override"),
    },
    abandonWork,
  );

  router.register(
    "complete_work",
    "[Any] Complete work ({in_progress|review} → review|done), gated by the anti-gameability evidence predicate (coverage-by-binding, kind-match, freshness, refResolvable, no-double-count, empty-req floor). Parks in `review` while a review requirement is unmet; reaches `done` once all are covered. Requires the lease-holder + matching leaseToken.",
    { workId: z.string(), leaseToken: z.string(), evidence: z.array(evidenceItemSchema).describe("Supplied evidence, bound to requirements by requirementId") },
    completeWork,
  );

  router.register(
    "clear_work_quarantine",
    "[Architect|Director] Clear an agent's claim-thrash quarantine (R2 interim manual escape; C2 supervisor auto-recovery is deferred). Resets the thrash counter + un-quarantines so the agent can claim again.",
    { agentId: z.string().describe("The quarantined agent's id") },
    clearWorkQuarantine,
  );
}
