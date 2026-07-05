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
import { DecisionTransitionRejected } from "../entities/decision-repository-substrate.js";
import {
  DirectorProofGate,
  canonicalPromptHash,
  hashProposedResolution,
  hashExecutionPlan,
} from "../entities/director-proof-repository-substrate.js";

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

async function captureDirectorSignal(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const proofs = ctx.stores.directorProof;
  if (!proofs) return err("not_wired", "DirectorProof store is not available");
  const capturedBy = await stampActor(ctx);
  const signal = await proofs.mintSignal({
    channel: args.channel as string,
    answer: args.answer as string,
    capturedBySurface: args.capturedBySurface as string,
    confidence: args.confidence as "authenticated" | "session-bound" | "side-channel-low",
    replyable: (args.replyable as boolean | undefined) ?? true,
    rawIngressRef: args.rawIngressRef as string | undefined,
    confirmationId: args.confirmationId as string | undefined,
    capturedBy,
  });
  return ok({ signal });
}

async function getDirectorSignal(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const proofs = ctx.stores.directorProof;
  if (!proofs) return err("not_wired", "DirectorProof store is not available");
  const signal = await proofs.getSignal(args.signalId as string);
  return signal ? ok({ signal }) : err("not_found", `DirectorSignal ${args.signalId} not found`);
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
  const before = await decisions.getDecision(args.decisionId as string);
  if (!before) return err("not_found", `Decision ${args.decisionId} not found`);
  const answer = (args.chosenOptionId
    ? { chosenOptionId: args.chosenOptionId as string }
    : { customAnswer: args.customAnswer as string }) as DecisionResolution["answer"];
  if (!args.chosenOptionId && typeof args.customAnswer !== "string") {
    return err("invalid_arguments", "exactly one of chosenOptionId | customAnswer is required");
  }
  const gate = new DirectorProofGate(proofs);
  try {
    const resolved = await decisions.resolveDecision(
      args.decisionId as string,
      executor,
      answer,
      gate,
      { rationale: args.rationale as string | undefined, claimedAuthorityRef: args.proofRef as string | undefined },
    );
    if (!resolved) return err("not_found", `Decision ${args.decisionId} not found`);
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
      await emitAndPush(ctx, {
        kind: "external-injection",
        authorRole: "system",
        authorAgentId: "hub",
        target: null,
        delivery: "push-immediate",
        intent: "resolve_as_director",
        payload: {
          notificationEvent: DECISION_TRANSITION_EVENT,
          verb: "resolve_as_director",
          decision_id: resolved.id,
          title: resolved.title,
          class: resolved.class,
          from_status: before.status,
          to_status: resolved.status,
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
    return ok({ decision: resolved });
  } catch (e) { return mapVerbError(e); }
}

export function registerDirectorProofPolicy(router: PolicyRouter): void {
  router.register(
    "capture_director_signal",
    "[Director] Capture a Director utterance as a Hub-stamped DirectorSignal at a REGISTERED ingress (the bug-224 fix: the ois-say session registers a director messaging identity — provenance only, NOT a seat). The content hash is computed server-side; confidence is stored as an enum with NO tier logic in v1. Signals are immutable and are the Signal-grade proof object for resolve_as_director.",
    {
      channel: z.string().min(1).describe("Ingress channel, e.g. 'ois-say' | 'session' | 'side-channel'"),
      answer: z.string().min(1).describe("The VERBATIM Director utterance"),
      capturedBySurface: z.string().min(1).describe("The capturing surface identifier"),
      confidence: z.enum(["authenticated", "session-bound", "side-channel-low"]),
      replyable: z.boolean().optional().describe("Whether the ingress supports a reply leg (default true — registered ingress fixes bug-224)"),
      rawIngressRef: z.string().optional().describe("The Message/entity id the raw ingress landed as, when relayed"),
      confirmationId: z.string().optional().describe("The DirectorConfirmation this signal answers (round-trip lineage)"),
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
    "[Architect] The sanctioned proxy resolve (S2.1): routed→resolved with authority Hub-DERIVED from the proof object behind proofRef — a DirectorSignal → director-via-proxy; a Director-ANSWERED, unexpired, hash-bound DirectorConfirmation → director-direct (consumed exactly once). REJECTS (never parks): no proofRef; an assertion-class ref (audit/message); an UNANSWERED confirmation (self-issued render token, audit-9821); a plan requiring confirmation on Signal proof alone; expired/consumed/mismatched confirmations; grant refs (slice B3). Dual identity stamped: authority from the proof, executor from YOUR session.",
    {
      decisionId: z.string(),
      proofRef: z.string().optional().describe("The proof object id (dsig-N | dconf-N). Omitting it REJECTS — kept optional so the reject is a policy error, not a schema error (contract test 7)"),
      chosenOptionId: z.string().optional(),
      customAnswer: z.string().optional(),
      rationale: z.string().optional(),
    },
    resolveAsDirector,
  );
}
