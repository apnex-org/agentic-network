/**
 * director-proof.ts — mission-102 P3-B4: the Director proof-path entities
 * (design.md v1.0 §1.3, RATIFIED at G2; canonical git 64de1bf).
 *
 * Two proof objects close CL-2 ("architect assertion is not proof"):
 *
 * DirectorSignal — a Hub-stamped capture of Director intent at a REGISTERED
 * ingress (the ois-say channel registers a director messaging identity — the
 * bug-224 fix; identity only, NOT a seat: no claims, no lifecycle). Immutable
 * once minted; the raw content hash makes the capture tamper-evident.
 * Confidence tiers are an ENUM ONLY in v1 (stored, never branched on — the
 * tier-logic design is deferred per the G2 deferred list).
 *
 * DirectorConfirmation — Hub-minted at prompt render, bound to the EXACT
 * prompt + proposed-resolution (+ execution-plan) hashes with a nonce and an
 * expiry; consumed exactly once. The consume is CAS-guarded: expired,
 * already-consumed, or hash-mismatched consumes REJECT.
 *
 * Proof rules (enforced by DirectorProofGate in the repository module):
 * a resolution flows on Signal (→ director-via-proxy) or consumed
 * Confirmation (→ director-direct); a plan requiring confirmation (any action
 * outside the v1 reversible registry — fail-closed on unknowns) does NOT flow
 * on Signal alone; assertion-class refs (audits, messages, anything that is
 * not a proof object) are NOT proof; no ref is NOT proof.
 */

export type DirectorSignalConfidence = "authenticated" | "session-bound" | "side-channel-low";

export interface DirectorSignal {
  id: string;
  /** Optional link to the Confirmation this signal answers (round-trip lineage). */
  confirmationId: string | null;
  /** Ingress channel, e.g. "ois-say" | "session" | "side-channel". */
  channel: string;
  /** The Message/entity id the raw ingress landed as, when relayed. */
  rawIngressRef: string | null;
  /** sha256 of the verbatim answer — computed SERVER-side at capture. */
  rawContentHash: string;
  /** The verbatim Director utterance. */
  answer: string;
  capturedAt: string;
  /** Hub-stamped capturing identity (the registered director-role session). */
  capturedBy: { agentId: string; role: string; sessionId?: string };
  capturedBySurface: string;
  confidence: DirectorSignalConfidence;
  replyable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DirectorConfirmation {
  id: string;
  decisionId: string;
  /** sha256 of the rendered prompt text (Hub-computed at mint). */
  promptHash: string;
  /** sha256 of the canonical proposed-resolution payload (Hub-computed at mint). */
  proposedResolutionHash: string;
  /** audit-10069: the proposed answer in PLAINTEXT beside its hash — the hash
   *  stays the binding authority; this is the RENDER (the Director must see
   *  WHICH option the token proposes, not an opaque digest). The read verb's
   *  answerCurrent flag re-derives the hash from this so plaintext tampering
   *  is visible. */
  proposedAnswer: { chosenOptionId: string } | { customAnswer: string };
  /** sha256 of the decision's stored execution plan at mint; null when no plan. */
  executionPlanHash: string | null;
  nonce: string;
  createdAt: string;
  expiresAt: string;
  /** The Director-origin capture that ANSWERED this confirmation (audit-9443
   *  successor finding, PR #486 review: an unanswered confirmation is a
   *  self-issued render token, NOT proof — the gate rejects it. Set exactly
   *  once by capture_director_signal(confirmationId=...), which is RBAC
   *  director-only, so this field can only ever hold a Director-origin id). */
  answeredBySignalId: string | null;
  consumedAt: string | null;
  /** Set at consume: the resolving actor's agentId (observability). */
  consumedBy: string | null;
  updatedAt: string;
}

export interface IDirectorProofStore {
  /** Mint an immutable DirectorSignal. capturedBy is Hub-stamped by the policy
   *  layer from the registered director-role session; the content hash is
   *  computed server-side from `answer`. When `confirmationId` is supplied the
   *  mint ALSO binds the signal as that confirmation's answer (first answer
   *  wins; an already-answered confirmation REJECTS the bind). */
  mintSignal(input: {
    channel: string;
    answer: string;
    capturedBySurface: string;
    confidence: DirectorSignalConfidence;
    replyable: boolean;
    rawIngressRef?: string | null;
    confirmationId?: string | null;
    capturedBy: { agentId: string; role: string; sessionId?: string };
  }): Promise<DirectorSignal>;
  getSignal(id: string): Promise<DirectorSignal | null>;

  /** Mint a Confirmation bound to exact hashes; expires after ttlMs. */
  mintConfirmation(input: {
    decisionId: string;
    promptHash: string;
    proposedResolutionHash: string;
    proposedAnswer: { chosenOptionId: string } | { customAnswer: string };
    executionPlanHash: string | null;
    ttlMs: number;
  }): Promise<DirectorConfirmation>;
  getConfirmation(id: string): Promise<DirectorConfirmation | null>;
  /** B10 two-id-space fix: the OPEN (unconsumed, unexpired, unanswered)
   *  confirmations for a decision — lets the Director answer by DECISION id;
   *  dconf plumbing stays presenter-internal. Low-volume in-memory filter. */
  findOpenConfirmationsForDecision(decisionId: string): Promise<DirectorConfirmation[]>;

  /** Consume exactly once, CAS-guarded. REJECTS (throws) when: not found,
   *  expired, already consumed, decision mismatch, or ANY hash mismatch.
   *  Returns the consumed row. */
  consumeConfirmation(id: string, expect: {
    decisionId: string;
    promptHash: string;
    proposedResolutionHash: string;
    executionPlanHash: string | null;
    consumedBy: string;
  }): Promise<DirectorConfirmation>;
}
