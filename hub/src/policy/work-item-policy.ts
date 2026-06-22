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
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "./list-filters.js";
import {
  TransitionRejected,
  ClaimRejected,
  WipCapExceeded,
  EvidencePredicateFailed,
} from "../entities/work-item-repository-substrate.js";
import { LockAcquisitionTimeoutError } from "../storage-substrate/advisory-lock.js";
import type { WorkItem, WorkItemBlockedOn, EvidenceItem } from "../entities/work-item.js";

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
    return w ? workItemResult(w) : notFound(args.workId as string);
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
  const { items, truncated } = await store.listReadyForRole(role, limit);
  return ok({
    items, count: items.length, role: role ?? null, truncated,
    ...(truncated ? { truncationNote: `ready-scan hit the ${MAX_LIST_LIMIT}-row cap — result is INCOMPLETE; refine by role or treat as a backlog-pressure signal` } : {}),
  });
}

async function startWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  try {
    const w = await store.startWork(args.workId as string, caller.agentId, args.leaseToken as string);
    return w ? workItemResult(w) : notFound(args.workId as string);
  } catch (e) { return mapVerbError(e); }
}

async function blockWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  const blockedOn = args.blockedOn as WorkItemBlockedOn;
  try {
    const w = await store.blockWork(args.workId as string, caller.agentId, args.leaseToken as string, blockedOn);
    return w ? workItemResult(w) : notFound(args.workId as string);
  } catch (e) { return mapVerbError(e); }
}

async function resumeWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  try {
    const w = await store.resumeWork(args.workId as string, caller.agentId, args.leaseToken as string);
    return w ? workItemResult(w) : notFound(args.workId as string);
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
  try {
    const w = await store.releaseWork(args.workId as string, caller.agentId, args.leaseToken as string);
    return w ? workItemResult(w) : notFound(args.workId as string);
  } catch (e) { return mapVerbError(e); }
}

async function abandonWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  try {
    const w = await store.abandonWork(args.workId as string, caller.agentId, {
      reason: args.reason as string | undefined,
      leaseToken: args.leaseToken as string | undefined,
    });
    return w ? workItemResult(w) : notFound(args.workId as string);
  } catch (e) { return mapVerbError(e); }
}

async function completeWork(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.workItem;
  if (!store) return err("not_wired", "WorkItem store is not available");
  const caller = await resolveCreatedBy(ctx);
  const evidence = (args.evidence as EvidenceItem[] | undefined) ?? [];
  try {
    const w = await store.completeWork(args.workId as string, caller.agentId, args.leaseToken as string, evidence);
    if (!w) return notFound(args.workId as string);
    // 4b-ii: a successful complete (evidence attached → review|done) is demonstrated
    // progress → reset the agent's claim-thrash counter (leaves quarantine to manual clear).
    await ctx.stores.engineerRegistry.resetWorkItemThrash(caller.agentId);
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

// ── Schemas ─────────────────────────────────────────────────────────────────

const EVIDENCE_KIND = z.enum(["commit", "pr", "audit", "review", "test-run", "doc", "freeform"]);
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

// ── Registration ──────────────────────────────────────────────────────────────

export function registerWorkItemPolicy(router: PolicyRouter): void {
  router.register(
    "claim_work",
    "[Any] Claim a ready WorkItem (ready → claimed). Enforces role-eligibility + dependency-readiness + the per-agent WIP cap fail-closed; mints a lease token returned as `leaseToken` — capture it for every subsequent lease-bound verb. C1-R2 (working name; idea-121 finalizes the tool surface).",
    { workId: z.string().describe("The WorkItem id to claim") },
    claimWork,
  );

  router.register(
    "list_ready_work",
    "[Any] List ready WorkItems claimable by a role (empty roleEligibility = any-role, OR'd in). Defaults to the caller's role; pass `role` to view another queue. truncation-HONEST: a capped scan sets `truncated` + a note (never a silent cap).",
    {
      role: z.string().optional().describe("Role to project for (default: the caller's role)"),
      limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional().describe(`Max items (default ${DEFAULT_LIST_LIMIT}, cap ${MAX_LIST_LIMIT})`),
    },
    listReadyWork,
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
    "[Any] Terminally abandon work ({claimed|in_progress|blocked} → abandoned). The lease-holder (with leaseToken) OR the item creator (no token — override authority) may abandon.",
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
