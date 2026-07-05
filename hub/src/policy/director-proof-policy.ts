/**
 * director-proof-policy.ts — mission-102 P3-B4: the Director proof-path verbs
 * (design.md v1.0 §1.3, RATIFIED at G2; canonical git 64de1bf).
 *
 * Tools: capture_director_signal [Director] · mint_director_confirmation
 * [Architect|Director] · get_director_signal [Any] · resolve_as_director [Architect].
 *
 * capture_director_signal is the bug-224 fix's substrate half: the ois-say
 * ingress session registers a director messaging identity via the EXISTING
 * register_role machinery (identity for provenance only — NOT a seat: no
 * claims, no work-queue lifecycle), and this verb Hub-stamps every capture
 * from that registered session. The verb is RBAC director-gated, so an
 * unregistered/other-role caller cannot mint Director-origin proof.
 *
 * resolve_as_director enforces the ratified proof rules through the REAL
 * DirectorProofGate (replacing B1's fail-closed stub on this path):
 * Signal → director-via-proxy; consumed hash-bound Confirmation →
 * director-direct; plan-requiring-confirmation on Signal alone / assertion
 * refs / no ref → REJECT (contract test 7). The Confirmation is consumed
 * AFTER the decision CAS commits (race analysis in the repository header).
 */
import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { resolveCreatedBy } from "./caller-identity.js";
import { emitAndPush } from "./message-policy.js";
import { DECISION_TRANSITION_EVENT } from "./decision-policy.js";
import type { DecisionActor, DecisionResolution } from "../entities/decision.js";
import { DECISION_TRANSITIONS } from "../entities/decision-repository-substrate.js";
import { DecisionTransitionRejected } from "../entities/decision-repository-substrate.js";
import {
  DirectorProofGate,
  canonicalPromptHash,
  hashProposedResolution,
  hashExecutionPlan,
} from "../entities/director-proof-repository-substrate.js";
import { validatePlan, executePlan } from "../entities/decision-executor.js";
import { createProposalReview } from "./proposal-policy.js";

/** Confirmation TTL: 30 minutes — long enough for a live decision walkthrough,
 *  short enough that a stale prompt cannot authorize much later (design §1.3). */
const CONFIRMATION_TTL_MS = 30 * 60_000;

function ok(body: Record<string, unknown>): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(body) }] };
}
function err(errorKind: string, message: string): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message, errorKind }) }], isError: true };
}
function mapVerbError(e: unknown): PolicyResult {
  if (e instanceof DecisionTransitionRejected) return err("decision_proof_rejected", e.message);
  throw e;
}

async function stampActor(ctx: IPolicyContext): Promise<DecisionActor> {
  const p = await resolveCreatedBy(ctx);
  return { agentId: p.agentId, role: p.role, sessionId: ctx.sessionId };
}


/** audit-10122: proven Director activity must flip presence — a Director who
 *  answers a signal while declared away is BACK for nudge purposes (S3.1
 *  "first activity flips present"). Best-effort: delivery accounting must
 *  never break the authority path. */
async function touchPresenceIfDirector(ctx: IPolicyContext, actor: DecisionActor): Promise<void> {
  if (actor.role !== "director") return;
  try {
    await ctx.stores.arrivalSurface?.touchDirectorActivity();
  } catch (e) {
    console.error(`[director-proof] presence touch failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }
}

async function captureDirectorSignal(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const proofs = ctx.stores.directorProof;
  if (!proofs) return err("not_wired", "DirectorProof store is not available");
  const capturedBy = await stampActor(ctx);
  // work-128 (B8-R1): the verifier seat is dryRun-only — report what the
  // capture WOULD bind (open-confirmation resolution incl. the zero/ambiguous
  // rejections) without minting a signal or touching presence. The director-
  // origin fence is unchanged: a real capture still requires the director seat.
  const dryRun = args.dryRun === true;
  if (capturedBy.role !== "director" && !dryRun) {
    return err("authorization_denied", `capture_director_signal requires the director ingress — the ${capturedBy.role} seat may only probe with dryRun:true`);
  }
  // B10 (two-id-space trap, Director UX finding #2): the Director thinks in
  // DECISIONS — accept decisionId and resolve the open confirmation SERVER-side.
  // Zero open → loud reject; more than one → loud reject with the ids (never
  // ambiguity); exactly one → bind it. dconf-N stays presenter-internal.
  let confirmationId = args.confirmationId as string | undefined;
  if (args.decisionId !== undefined) {
    if (confirmationId) return err("invalid_arguments", "pass decisionId OR confirmationId, not both — decisionId resolves the open confirmation server-side");
    try {
      const open = await proofs.findOpenConfirmationsForDecision(args.decisionId as string);
      if (open.length === 0) return err("decision_proof_rejected", `no open confirmation for ${args.decisionId} — mint one at prompt render (mint_director_confirmation) before the Director answers`);
      if (open.length > 1) return err("decision_proof_rejected", `${open.length} open confirmations for ${args.decisionId} [${open.map((c) => c.id).join(", ")}] — ambiguous; answer by confirmationId or let the stale ones expire`);
      confirmationId = open[0].id;
    } catch (e) { return mapVerbError(e); } // the truncation guard maps to a policy error, never a 500
  }
  if (dryRun) {
    return ok({
      dryRun: true,
      effects: "none",
      wouldBindConfirmationId: confirmationId ?? null,
      note: confirmationId
        ? "a real director-seat capture would mint a signal answering this confirmation"
        : "a real capture would mint an unbound signal (no confirmationId/decisionId supplied)",
    });
  }
  const signal = await proofs.mintSignal({
    channel: args.channel as string,
    answer: args.answer as string,
    capturedBySurface: args.capturedBySurface as string,
    confidence: args.confidence as "authenticated" | "session-bound" | "side-channel-low",
    replyable: (args.replyable as boolean | undefined) ?? true,
    rawIngressRef: args.rawIngressRef as string | undefined,
    confirmationId,
    capturedBy,
  });
  await touchPresenceIfDirector(ctx, capturedBy);
  return ok({ signal, answeredConfirmationId: confirmationId ?? null });
}

async function getDirectorSignal(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const proofs = ctx.stores.directorProof;
  if (!proofs) return err("not_wired", "DirectorProof store is not available");
  const signal = await proofs.getSignal(args.signalId as string);
  return signal ? ok({ signal }) : err("not_found", `DirectorSignal ${args.signalId} not found`);
}

async function getDirectorConfirmation(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const proofs = ctx.stores.directorProof;
  const decisions = ctx.stores.decision;
  if (!proofs || !decisions) return err("not_wired", "DirectorProof/Decision stores are not available");
  const confirmation = await proofs.getConfirmation(args.confirmationId as string);
  if (!confirmation) return err("not_found", `DirectorConfirmation ${args.confirmationId} not found`);
  // R:B3 verify-cheaply (Director UX finding, 2026-07-05): render WHAT THE HASHES
  // BIND, recomputed HUB-SIDE from the decision row — never a caller-supplied
  // summary. The Director sees exactly what consuming this token authorizes;
  // binds.promptCurrent flags a decision mutated since render (hash divergence).
  const decision = await decisions.getDecision(confirmation.decisionId);
  const binds = decision ? {
    decisionId: decision.id,
    title: decision.title,
    context: decision.context,
    options: decision.options,
    // audit-10069 (1): WHICH answer the token proposes, in plaintext — with the
    // re-derived hash check so a tampered plaintext is visible (the hash stays
    // the binding authority; the plaintext is only the render). audit-10076:
    // LEGACY rows (minted before proposedAnswer existed) render null/false with
    // a note — never a throw; the hash fields remain the verification surface.
    proposedAnswer: confirmation.proposedAnswer ?? null,
    answerCurrent: confirmation.proposedAnswer !== undefined && confirmation.proposedAnswer !== null
      ? hashProposedResolution(confirmation.proposedAnswer) === confirmation.proposedResolutionHash
      : false,
    answerNote: confirmation.proposedAnswer === undefined || confirmation.proposedAnswer === null
      ? "legacy token (pre-render era): plaintext unavailable — verify against proposedResolutionHash"
      : undefined,
    executionPlan: decision.executionPlan,
    decisionStatus: decision.status,
    promptCurrent: canonicalPromptHash(decision) === confirmation.promptHash,
    planCurrent: (hashExecutionPlan(decision.executionPlan) ?? null) === (confirmation.executionPlanHash ?? null),
  } : null;
  const state = confirmation.consumedAt ? "consumed"
    : Date.parse(confirmation.expiresAt) < Date.now() ? "expired"
    : confirmation.answeredBySignalId ? "answered-unconsumed"
    : "awaiting-director-answer";
  return ok({ confirmation, binds, state });
}

async function mintDirectorConfirmation(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const proofs = ctx.stores.directorProof;
  const decisions = ctx.stores.decision;
  if (!proofs || !decisions) return err("not_wired", "DirectorProof/Decision stores are not available");
  const decision = await decisions.getDecision(args.decisionId as string);
  if (!decision) return err("not_found", `Decision ${args.decisionId} not found`);
  if (decision.status !== "routed") {
    return err("decision_proof_rejected", `mint rejected: a confirmation binds a ROUTED decision's prompt render, and ${decision.id} is ${decision.status}`);
  }
  // All three hashes are HUB-computed from server-side state + the proposed
  // answer — the caller supplies content, never hashes (L2/L4).
  const proposedAnswer = (args.chosenOptionId
    ? { chosenOptionId: args.chosenOptionId as string }
    : { customAnswer: args.customAnswer as string }) as DecisionResolution["answer"];
  if (!args.chosenOptionId && typeof args.customAnswer !== "string") {
    return err("invalid_arguments", "exactly one of chosenOptionId | customAnswer is required — the confirmation binds a CONCRETE proposed resolution");
  }
  const confirmation = await proofs.mintConfirmation({
    decisionId: decision.id,
    promptHash: canonicalPromptHash(decision),
    proposedResolutionHash: hashProposedResolution(proposedAnswer),
    proposedAnswer, // plaintext beside its hash (audit-10069: the render, never the authority)
    executionPlanHash: hashExecutionPlan(decision.executionPlan),
    ttlMs: CONFIRMATION_TTL_MS,
  });
  return ok({ confirmation });
}

async function resolveAsDirector(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const proofs = ctx.stores.directorProof;
  const decisions = ctx.stores.decision;
  if (!proofs || !decisions) return err("not_wired", "DirectorProof/Decision stores are not available");
  const executor = await stampActor(ctx);
  // work-128 (B8-R1): the verifier seat is admitted by router RBAC but may ONLY
  // dry-run — the authority fence is unchanged for real resolutions.
  const dryRun = args.dryRun === true;
  if (executor.role !== "architect" && !dryRun) {
    return err("authorization_denied", `resolve_as_director requires the architect seat — the ${executor.role} seat may only probe with dryRun:true`);
  }
  const before = await decisions.getDecision(args.decisionId as string);
  if (!before) return err("not_found", `Decision ${args.decisionId} not found`);
  const answer = (args.chosenOptionId
    ? { chosenOptionId: args.chosenOptionId as string }
    : { customAnswer: args.customAnswer as string }) as DecisionResolution["answer"];
  if (!args.chosenOptionId && typeof args.customAnswer !== "string") {
    return err("invalid_arguments", "exactly one of chosenOptionId | customAnswer is required");
  }
  const gate = new DirectorProofGate(proofs, ctx.stores.classGrant);
  const targets = {
    workItem: ctx.stores.workItem,
    proposal: ctx.stores.proposal,
    // The SHIPPED create_proposal_review semantics, closed over ctx (audit-9938):
    // submitted-only guard + auto-scaffold (revert on failure) + dispatches.
    approveViaPolicy: async (proposalRef: string, feedback: string) => {
      const res = await createProposalReview({ proposalId: proposalRef, decision: "approved", feedback }, ctx);
      const parsed = JSON.parse(res.content[0].text) as { success?: boolean; error?: string; scaffolded?: boolean };
      return { ok: !res.isError && parsed.success === true, detail: res.isError ? (parsed.error ?? "review failed") : `approved${parsed.scaffolded ? " + scaffolded" : ""}` };
    },
  };
  // work-128 dry-run: run the REAL validators — the same DirectorProofGate,
  // the same validatePlan (zero-effects by contract 11), the same FSM table —
  // in sequence, report EVERY verdict independently (an unrouted probe
  // decision still exercises the proof/evaluator paths), and stop before any
  // effect: no transition, no consume/mint, no emitted Message, no arrival or
  // presence touch. This is how the verifier live-executes the rejection
  // contracts (#1/#7/#11/#12) from his own seat (audit-10226).
  if (dryRun) {
    const report: Record<string, unknown> = { dryRun: true, effects: "none" };
    report.phase = {
      status: before.status,
      resolvable: (DECISION_TRANSITIONS[before.status] ?? []).includes("resolved"),
    };
    try {
      const verdict = await gate.evaluate({ decision: before, executor, answer, claimedAuthorityRef: args.proofRef as string | undefined });
      report.proof = { ok: true, authorityMode: verdict.authorityMode, authorityRef: verdict.authorityRef ?? null };
    } catch (e) {
      report.proof = { ok: false, errorKind: "decision_proof_rejected", rejection: e instanceof Error ? e.message : String(e) };
    }
    try {
      if ((before.executionPlan ?? []).length > 0) await validatePlan(before, targets);
      report.plan = { ok: true, actions: (before.executionPlan ?? []).length };
    } catch (e) {
      report.plan = { ok: false, rejection: e instanceof Error ? e.message : String(e) };
    }
    report.wouldSucceed =
      (report.phase as { resolvable: boolean }).resolvable &&
      (report.proof as { ok: boolean }).ok &&
      (report.plan as { ok: boolean }).ok;
    return ok(report);
  }
  try {
    // B5 contract 11 — the proof chain INCLUDES plan validation, all BEFORE any
    // effect and before the decision transitions: every action in-registry, every
    // target resolves, unblock targets are blocked ON this decision. Any failure
    // here (or in the gate) is a whole-transition reject with ZERO effects.
    if ((before.executionPlan ?? []).length > 0) {
      await validatePlan(before, targets);
    }
    // PR #488 finding 2: a grant-backed resolve runs ENTIRELY inside the grant's
    // serialization barrier (advisory lock keyed on grantId) — the gate's fresh
    // grant read and the decision CAS both happen under the lock revoke/supersede
    // also take, so a committed revoke is always seen and "a revoked grant
    // authorizes nothing new" is a hard invariant, not a TOCTOU claim.
    const proofRef = args.proofRef as string | undefined;
    const doResolve = () => decisions.resolveDecision(
      args.decisionId as string,
      executor,
      answer,
      gate,
      { rationale: args.rationale as string | undefined, claimedAuthorityRef: proofRef },
    );
    const resolved = proofRef?.startsWith("grant-") && ctx.stores.classGrant
      ? await ctx.stores.classGrant.withGrantBarrier(proofRef, doResolve)
      : await doResolve();
    if (!resolved) return err("not_found", `Decision ${args.decisionId} not found`);
    // B5: fire the plan AFTER the resolved commit; record the outcome either way.
    // All-ok → executed (the CL-1 no-transcription-seam close); any failure →
    // the decision PARKS in resolved with the binding visible to aging (never
    // silent). Re-validation inside executePlan's wrappers keeps effects tight.
    let finalDecision = resolved;
    // bug-227 (B): a PLAN-LESS resolution is vacuously executed — nothing is
    // pending, so it must not park in `resolved` forever (decision-4 was the
    // live specimen).
    if ((resolved.executionPlan ?? []).length === 0 && decisions.markExecuted) {
      finalDecision = (await decisions.markExecuted(resolved.id, executor)) ?? resolved;
    }
    if ((resolved.executionPlan ?? []).length > 0 && decisions.recordExecutorBinding && decisions.markExecuted) {
      const outcome = await executePlan(resolved, targets);
      const bound = await decisions.recordExecutorBinding(resolved.id, {
        executor, boundAt: new Date().toISOString(), ok: outcome.ok, results: outcome.results,
      });
      if (outcome.ok) {
        finalDecision = (await decisions.markExecuted(resolved.id, executor)) ?? bound ?? resolved;
      } else {
        console.error(`[director-proof-policy] plan execution FAILED for ${resolved.id} — parked in resolved with binding: ${JSON.stringify(outcome.results)}`);
        finalDecision = bound ?? resolved;
      }
    }
    // Consume-after-commit: a director-direct resolution burned its confirmation.
    // (Validated pre-CAS by the gate; the crash-window residual is inert — see the
    // repository header.) Failure here is LOUD but does not unwind the resolution.
    if (resolved.resolution?.authorityMode === "director-direct" && args.proofRef) {
      try {
        await proofs.consumeConfirmation(args.proofRef as string, {
          decisionId: resolved.id,
          promptHash: canonicalPromptHash(resolved),
          proposedResolutionHash: hashProposedResolution(answer),
          executionPlanHash: hashExecutionPlan(resolved.executionPlan),
          consumedBy: executor.agentId,
        });
      } catch (e) {
        console.error(`[director-proof-policy] post-commit confirmation consume failed (resolution stands; investigate): ${e instanceof Error ? e.message : e}`);
      }
    }
    // Emit through the same decision-transition vocabulary (observability, never throws).
    try {
      // work-124 flood stopgap (audit-10228): same scoping rule as
      // decision-policy — the architect always; the director ADDITIONALLY only
      // when the decision was ROUTED to the director. resolve_as_director also
      // lands grant-backed SELF-DISPOSAL resolutions (the B3 route-proof tie),
      // and those must never push a Director message (the mandate path exists
      // to keep them off his surface).
      const resolveTargets: Array<import("../entities/message.js").MessageTarget> = [{ role: "architect" }];
      if (resolved.routedTo?.target === "director") resolveTargets.push({ role: "director" });
      for (const target of resolveTargets)
      await emitAndPush(ctx, {
        kind: "external-injection",
        authorRole: "system",
        authorAgentId: "hub",
        target,
        delivery: "push-immediate",
        intent: "resolve_as_director",
        payload: {
          notificationEvent: DECISION_TRANSITION_EVENT,
          verb: "resolve_as_director",
          decision_id: resolved.id,
          title: resolved.title,
          class: resolved.class,
          from_status: before.status,
          to_status: finalDecision.status,
          authority_mode: resolved.resolution?.authorityMode ?? null,
          authority_ref: resolved.resolution?.authorityRef ?? null,
          actor_role: executor.role,
          actor_agent_id: executor.agentId,
          body: `${resolved.id} ${before.status}→${resolved.status} (resolve_as_director, ${resolved.resolution?.authorityMode}) by ${executor.role}/${executor.agentId} — "${resolved.title}"`,
        },
      });
    } catch (e) {
      console.error(`[director-proof-policy] transition emit failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    }
    await touchPresenceIfDirector(ctx, executor);
    return ok({ decision: finalDecision });
  } catch (e) { return mapVerbError(e); }
}

export function registerDirectorProofPolicy(router: PolicyRouter): void {
  router.register(
    "capture_director_signal",
    "[Director|Verifier] Capture a Director utterance — VERIFIER SEAT IS dryRun-ONLY (work-128: reports what a capture would bind without minting). as a Hub-stamped DirectorSignal at a REGISTERED ingress (the bug-224 fix: the ois-say session registers a director messaging identity — provenance only, NOT a seat). The content hash is computed server-side; confidence is stored as an enum with NO tier logic in v1. Signals are immutable and are the Signal-grade proof object for resolve_as_director.",
    {
      channel: z.string().min(1).describe("Ingress channel, e.g. 'ois-say' | 'session' | 'side-channel'"),
      answer: z.string().min(1).describe("The VERBATIM Director utterance"),
      capturedBySurface: z.string().min(1).describe("The capturing surface identifier"),
      confidence: z.enum(["authenticated", "session-bound", "side-channel-low"]),
      replyable: z.boolean().optional().describe("Whether the ingress supports a reply leg (default true — registered ingress fixes bug-224)"),
      rawIngressRef: z.string().optional().describe("The Message/entity id the raw ingress landed as, when relayed"),
      confirmationId: z.string().optional().describe("The DirectorConfirmation this signal answers (round-trip lineage; presenter-internal id-space)"),
      decisionId: z.string().optional().describe("B10: answer by DECISION id — the Hub resolves the single open confirmation server-side (rejects loud on zero or ambiguous). The Director's id-space is the decision; dconf plumbing stays out of his surface."),
      dryRun: z.boolean().optional().describe("work-128: report the open-confirmation resolution (incl. zero/ambiguous rejections) WITHOUT minting a signal or touching presence (required for the verifier seat)"),
    },
    captureDirectorSignal,
  );

  router.register(
    "get_director_signal",
    "[Any] Read a DirectorSignal by id (verification surface — B3 of the register: make verification cheap).",
    { signalId: z.string() },
    getDirectorSignal,
  );

  router.register(
    "get_director_confirmation",
    "[Any] Read a DirectorConfirmation WITH the Hub-side echo of what its hashes BIND (R:B3 verify-cheaply — the Director must never confirm blind): the bound decision's title/context/options/plan recomputed from the decision row (never caller-supplied), promptCurrent/planCurrent divergence flags, and the lifecycle state (awaiting-director-answer | answered-unconsumed | consumed | expired).",
    { confirmationId: z.string() },
    getDirectorConfirmation,
  );

  router.register(
    "mint_director_confirmation",
    "[Architect|Director] Mint a DirectorConfirmation at prompt render for a ROUTED decision: Hub-computes the prompt hash (canonical render of the decision itself — tamper-evident), the proposed-resolution hash, and the execution-plan hash; nonce + 30min expiry; consumable exactly once. The caller supplies CONTENT, never hashes. A freshly-minted confirmation is a RENDER TOKEN, not proof — it becomes proof only after the Director answers it via capture_director_signal(confirmationId) (audit-9821: a self-issued token can never be director-direct authority).",
    {
      decisionId: z.string(),
      chosenOptionId: z.string().optional().describe("The proposed pick the Director is confirming (exactly one of chosenOptionId | customAnswer)"),
      customAnswer: z.string().optional().describe("The proposed free-text resolution being confirmed"),
    },
    mintDirectorConfirmation,
  );

  router.register(
    "resolve_as_director",
    "[Architect|Verifier] The sanctioned proxy resolve (S2.1) — VERIFIER SEAT IS dryRun-ONLY (work-128: rejection-path probing; a verifier call without dryRun:true is denied): routed→resolved with authority Hub-DERIVED from the proof object behind proofRef — a DirectorSignal → director-via-proxy; a Director-ANSWERED, unexpired, hash-bound DirectorConfirmation → director-direct (consumed exactly once). REJECTS (never parks): no proofRef; an assertion-class ref (audit/message); an UNANSWERED confirmation (self-issued render token, audit-9821); a plan requiring confirmation on Signal proof alone; expired/consumed/mismatched confirmations; grant refs (slice B3). Dual identity stamped: authority from the proof, executor from YOUR session.",
    {
      decisionId: z.string(),
      proofRef: z.string().optional().describe("The proof object id (dsig-N | dconf-N). Omitting it REJECTS — kept optional so the reject is a policy error, not a schema error (contract test 7)"),
      chosenOptionId: z.string().optional(),
      customAnswer: z.string().optional(),
      rationale: z.string().optional(),
      dryRun: z.boolean().optional().describe("work-128: evaluate the REAL proof gate + plan validators and report every verdict WITHOUT transitioning, consuming, minting, or emitting — the verifier's live rejection probe (required for the verifier seat)"),
    },
    resolveAsDirector,
  );
}
