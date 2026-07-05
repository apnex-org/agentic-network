/**
 * director-proof-repository-substrate.ts — mission-102 P3-B4: the DirectorSignal /
 * DirectorConfirmation store + the REAL DecisionProofGate (design §1.3).
 *
 * Replaces the B1 FailClosedProofGate for the signal/confirmation proof paths.
 * The ClassGrant proof path stays fenced to B3 (a grant-shaped claimedAuthorityRef
 * REJECTS here with the fence message, never a silent fall-through).
 *
 * Consume-exactly-once mechanics: consumeConfirmation is CAS-guarded (putIfMatch
 * on the fresh revision) — expired / consumed / decision-mismatch / hash-mismatch
 * all REJECT loudly. The gate VALIDATES the confirmation pre-CAS and the policy
 * layer consumes post-resolve-commit; the race residual (crash between commit and
 * consume) is bounded by the confirmation's decision-binding: the FSM's
 * routed→resolved edge is already spent, so a stale unconsumed confirmation
 * cannot authorize anything else (hash + decisionId bind it to the spent edge).
 */
import { createHash, randomUUID } from "node:crypto";
import type {
  DirectorConfirmation,
  DirectorSignal,
  DirectorSignalConfidence,
  IDirectorProofStore,
} from "./director-proof.js";
import type { Decision, DecisionActor, DecisionResolution, IDecisionProofGate, AuthorityMode } from "./decision.js";
import { DecisionTransitionRejected } from "./decision-repository-substrate.js";
import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import { SubstrateCounter } from "./substrate-counter.js";
import { decodeEnvelopeToFlat } from "./shape-helpers.js";

const SIGNAL_KIND = "DirectorSignal";
const CONFIRMATION_KIND = "DirectorConfirmation";
const MAX_CAS_RETRIES = 20;

/** V1 registry actions that flow on Signal-grade proof. ANYTHING else in a plan
 *  requires a consumed Confirmation — fail-closed for unknown/future actions. */
const REVERSIBLE_V1_ACTIONS: readonly string[] = ["unblock", "approve"];

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Canonical hash of a decision resolution answer (the proposed-resolution hash
 *  contract: surface and gate MUST hash the same canonical form). */
export function hashProposedResolution(answer: DecisionResolution["answer"]): string {
  return sha256Hex(JSON.stringify(answer));
}

/** Canonical hash of a stored execution plan; null for an empty plan. */
export function hashExecutionPlan(plan: Decision["executionPlan"]): string | null {
  if (!plan || plan.length === 0) return null;
  return sha256Hex(JSON.stringify(plan));
}

/** The canonical prompt is a deterministic render of the DECISION ITSELF —
 *  mint and gate compute it from the same row, so a decision mutated between
 *  prompt render and resolve diverges the hash and the consume REJECTS
 *  (tamper-evidence for free; no prompt text is stored or trusted). */
export function canonicalPromptHash(decision: Pick<Decision, "id" | "title" | "context" | "options">): string {
  return sha256Hex(JSON.stringify({ id: decision.id, title: decision.title, context: decision.context, options: decision.options }));
}

function cloneFlat<T>(row: T, kind: string): T {
  return decodeEnvelopeToFlat(row as unknown as Record<string, unknown>, kind) as unknown as T;
}

export class DirectorProofRepositorySubstrate implements IDirectorProofStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
  ) {}

  async mintSignal(input: {
    channel: string;
    answer: string;
    capturedBySurface: string;
    confidence: DirectorSignalConfidence;
    replyable: boolean;
    rawIngressRef?: string | null;
    confirmationId?: string | null;
    capturedBy: { agentId: string; role: string; sessionId?: string };
  }): Promise<DirectorSignal> {
    const num = await this.counter.next("directorSignalCounter");
    const id = `dsig-${num}`;
    const now = new Date().toISOString();
    const s: DirectorSignal = {
      id,
      confirmationId: input.confirmationId ?? null,
      channel: input.channel,
      rawIngressRef: input.rawIngressRef ?? null,
      rawContentHash: sha256Hex(input.answer),
      answer: input.answer,
      capturedAt: now,
      capturedBy: input.capturedBy,
      capturedBySurface: input.capturedBySurface,
      confidence: input.confidence,
      replyable: input.replyable,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.substrate.createOnly(SIGNAL_KIND, s);
    if (!result.ok) throw new Error(`[DirectorProofRepository] mintSignal: counter issued existing ID ${id}`);
    console.log(`[DirectorProofRepository] DirectorSignal minted: ${id} (channel=${input.channel}, confidence=${input.confidence})`);
    // PR #486 review (audit-9821): a capture answering a confirmation BINDS it —
    // this is the only writer of answeredBySignalId, and it sits behind the
    // director-RBAC capture verb, so the field is Director-origin by construction.
    if (input.confirmationId) {
      await this.bindAnswerToConfirmation(input.confirmationId, id);
    }
    return cloneFlat(s, SIGNAL_KIND);
  }

  /** First answer wins: an already-answered confirmation REJECTS a second bind
   *  (a re-answer would let a later capture silently repoint the proof). */
  private async bindAnswerToConfirmation(confirmationId: string, signalId: string): Promise<void> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<DirectorConfirmation>(CONFIRMATION_KIND, confirmationId);
      if (!existing) throw new DecisionTransitionRejected(`signal bind rejected: confirmation ${confirmationId} does not resolve`);
      const c = cloneFlat(existing.entity, CONFIRMATION_KIND);
      if (c.answeredBySignalId !== null) {
        throw new DecisionTransitionRejected(`signal bind rejected: confirmation ${confirmationId} was already answered by ${c.answeredBySignalId} (first answer wins)`);
      }
      if (c.consumedAt !== null) {
        throw new DecisionTransitionRejected(`signal bind rejected: confirmation ${confirmationId} was already consumed`);
      }
      const nowISO = new Date().toISOString();
      const next: DirectorConfirmation = { ...c, answeredBySignalId: signalId, updatedAt: nowISO };
      const result = await this.substrate.putIfMatch(CONFIRMATION_KIND, next, existing.resourceVersion);
      if (result.ok) {
        console.log(`[DirectorProofRepository] DirectorConfirmation ${confirmationId} answered by ${signalId}`);
        return;
      }
    }
    throw new Error(`[DirectorProofRepository] bindAnswerToConfirmation exhausted ${MAX_CAS_RETRIES} retries on ${confirmationId}`);
  }

  async getSignal(id: string): Promise<DirectorSignal | null> {
    const s = await this.substrate.get<DirectorSignal>(SIGNAL_KIND, id);
    return s ? cloneFlat(s, SIGNAL_KIND) : null;
  }

  async findOpenConfirmationsForDecision(decisionId: string): Promise<DirectorConfirmation[]> {
    // Confirmations are ephemeral 30-minute tokens — a full-kind list (cap 500)
    // with in-memory filtering is honest at this volume; no filter-translation
    // machinery for a presenter-internal kind.
    const { items } = await this.substrate.list<DirectorConfirmation>(CONFIRMATION_KIND, { limit: 500 });
    // audit-10069 (2): a capped scan can HIDE open confirmations beyond the page,
    // making zero/ambiguity detection wrong — fail LOUD on truncation (500
    // ephemeral 30-min tokens alive at once is itself an anomaly) rather than
    // silently mis-resolve; the by-confirmationId path remains available.
    if (items.length >= 500) {
      throw new DecisionTransitionRejected("confirmation scan truncated at 500 rows — cannot guarantee zero/ambiguity detection for answer-by-decisionId; answer by confirmationId (and investigate the token pileup)");
    }
    const now = Date.now();
    return items.map((c) => cloneFlat(c, CONFIRMATION_KIND)).filter((c) =>
      c.decisionId === decisionId && c.consumedAt === null && c.answeredBySignalId === null && Date.parse(c.expiresAt) >= now);
  }

  async findAnsweredUnconsumedForMinter(agentId: string): Promise<DirectorConfirmation[]> {
    // bug-231 (work-144): the arrival-backstop query. Same full-kind scan +
    // loud-truncation posture as findOpenConfirmationsForDecision — a capped
    // scan that silently hides rows would make the backstop's recovery claim
    // a lie (the audit-10069 completeness rule). No expiry filter: an answered
    // confirmation carries a bound Director answer even past its TTL, and the
    // policy layer decides what an expired-but-answered row means.
    const { items } = await this.substrate.list<DirectorConfirmation>(CONFIRMATION_KIND, { limit: 500 });
    if (items.length >= 500) {
      throw new DecisionTransitionRejected("confirmation scan truncated at 500 rows — the arrival backstop cannot guarantee completeness (investigate the token pileup)");
    }
    return items.map((c) => cloneFlat(c, CONFIRMATION_KIND)).filter((c) =>
      c.mintedBy?.agentId === agentId && c.answeredBySignalId !== null && c.consumedAt === null);
  }

  async mintConfirmation(input: {
    decisionId: string;
    promptHash: string;
    proposedResolutionHash: string;
    proposedAnswer: { chosenOptionId: string } | { customAnswer: string };
    executionPlanHash: string | null;
    ttlMs: number;
    mintedBy?: { agentId: string; role: string; sessionId?: string } | null;
  }): Promise<DirectorConfirmation> {
    const num = await this.counter.next("directorConfirmationCounter");
    const id = `dconf-${num}`;
    const now = Date.now();
    const nowISO = new Date(now).toISOString();
    const c: DirectorConfirmation = {
      id,
      decisionId: input.decisionId,
      promptHash: input.promptHash,
      proposedResolutionHash: input.proposedResolutionHash,
      proposedAnswer: input.proposedAnswer,
      executionPlanHash: input.executionPlanHash,
      mintedBy: input.mintedBy ?? null,
      nonce: randomUUID(),
      createdAt: nowISO,
      expiresAt: new Date(now + input.ttlMs).toISOString(),
      answeredBySignalId: null, // a render token is NOT proof until a Director-origin capture answers it
      consumedAt: null,
      consumedBy: null,
      updatedAt: nowISO,
    };
    const result = await this.substrate.createOnly(CONFIRMATION_KIND, c);
    if (!result.ok) throw new Error(`[DirectorProofRepository] mintConfirmation: counter issued existing ID ${id}`);
    console.log(`[DirectorProofRepository] DirectorConfirmation minted: ${id} (decision=${input.decisionId}, expires=${c.expiresAt})`);
    return cloneFlat(c, CONFIRMATION_KIND);
  }

  async getConfirmation(id: string): Promise<DirectorConfirmation | null> {
    const c = await this.substrate.get<DirectorConfirmation>(CONFIRMATION_KIND, id);
    return c ? cloneFlat(c, CONFIRMATION_KIND) : null;
  }

  async consumeConfirmation(id: string, expect: {
    decisionId: string;
    promptHash: string;
    proposedResolutionHash: string;
    executionPlanHash: string | null;
    consumedBy: string;
  }): Promise<DirectorConfirmation> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<DirectorConfirmation>(CONFIRMATION_KIND, id);
      if (!existing) throw new DecisionTransitionRejected(`confirmation ${id} does not resolve`);
      const c = cloneFlat(existing.entity, CONFIRMATION_KIND);
      assertConsumable(c, expect);
      const nowISO = new Date().toISOString();
      const next: DirectorConfirmation = { ...c, consumedAt: nowISO, consumedBy: expect.consumedBy, updatedAt: nowISO };
      const result = await this.substrate.putIfMatch(CONFIRMATION_KIND, next, existing.resourceVersion);
      if (result.ok) {
        console.log(`[DirectorProofRepository] DirectorConfirmation consumed: ${id} by ${expect.consumedBy}`);
        return cloneFlat(next, CONFIRMATION_KIND);
      }
      // revision race → refetch; the re-read assertConsumable rejects a concurrent consume.
    }
    throw new Error(`[DirectorProofRepository] consumeConfirmation exhausted ${MAX_CAS_RETRIES} retries on ${id}`);
  }
}

function assertConsumable(c: DirectorConfirmation, expect: {
  decisionId: string;
  promptHash: string;
  proposedResolutionHash: string;
  executionPlanHash: string | null;
}): void {
  if (c.consumedAt !== null) {
    throw new DecisionTransitionRejected(`confirmation ${c.id} was already consumed at ${c.consumedAt} — a confirmation authorizes exactly one resolution`);
  }
  if (Date.parse(c.expiresAt) < Date.now()) {
    throw new DecisionTransitionRejected(`confirmation ${c.id} expired at ${c.expiresAt} — re-render the prompt to mint a fresh one`);
  }
  if (c.decisionId !== expect.decisionId) {
    throw new DecisionTransitionRejected(`confirmation ${c.id} is bound to ${c.decisionId}, not ${expect.decisionId}`);
  }
  if (c.promptHash !== expect.promptHash || c.proposedResolutionHash !== expect.proposedResolutionHash || (c.executionPlanHash ?? null) !== (expect.executionPlanHash ?? null)) {
    throw new DecisionTransitionRejected(`confirmation ${c.id} hash mismatch — the Director confirmed a DIFFERENT prompt/resolution/plan than the one being resolved (exact-binding rule)`);
  }
}

/** Does this plan require a consumed Confirmation regardless of Signal proof?
 *  Fail-closed: any action outside the v1 reversible registry requires one. */
export function planRequiresConfirmation(plan: Decision["executionPlan"]): boolean {
  return (plan ?? []).some((a) => !REVERSIBLE_V1_ACTIONS.includes(a.action));
}

/**
 * The REAL proof gate (design §1.3) — B4 replaces FailClosedProofGate on the
 * resolve-as-director path with this. Hub-derives authorityMode from the KIND
 * of proof object the ref resolves to:
 *   - DirectorConfirmation (validated; consumed post-commit by the policy layer)
 *     → director-direct (the Director confirmed THIS exact prompt+resolution+plan);
 *   - DirectorSignal → director-via-proxy (executor is the proxy; authority rides
 *     the captured signal) — UNLESS the plan requires confirmation (fail-closed);
 *   - anything else (audit / message / grant-shaped / missing) → REJECT.
 * No caller-supplied mode exists anywhere on this path (S1.2 / L2 / L4).
 */
export class DirectorProofGate implements IDecisionProofGate {
  /** `grants` lands with B3: absent (older test rigs) the grant branch keeps the
   *  fail-closed fence message. */
  constructor(
    private readonly proofs: IDirectorProofStore,
    private readonly grants?: import("./class-grant.js").IClassGrantStore,
  ) {}

  async evaluate(input: {
    decision: Decision;
    executor: DecisionActor;
    answer: DecisionResolution["answer"];
    claimedAuthorityRef?: string;
  }): Promise<{ authorityMode: AuthorityMode; authorityRef?: string }> {
    const ref = input.claimedAuthorityRef;
    if (!ref) {
      throw new DecisionTransitionRejected("resolve-as-director rejected: no proof ref supplied — proxy authority requires a DirectorSignal or a consumed DirectorConfirmation (assertion is not proof)");
    }
    if (ref.startsWith("dconf-")) {
      const c = await this.proofs.getConfirmation(ref);
      if (!c) throw new DecisionTransitionRejected(`resolve-as-director rejected: confirmation ${ref} does not resolve`);
      // PR #486 review (audit-9821, CL-2): an UNANSWERED confirmation is a
      // self-issued render token — the minter (architect) proving they resolved
      // the same prompt they minted proves nothing about the DIRECTOR. Proof
      // requires the Director-origin capture bound via the director-RBAC
      // capture verb (first answer wins).
      if (c.answeredBySignalId === null) {
        throw new DecisionTransitionRejected(`resolve-as-director rejected: confirmation ${ref} has not been answered by a Director-origin capture — a render token alone is not proof (mint → Director answers via capture_director_signal(confirmationId) → then resolve)`);
      }
      const answering = await this.proofs.getSignal(c.answeredBySignalId);
      if (!answering || answering.capturedBy?.role !== "director") {
        throw new DecisionTransitionRejected(`resolve-as-director rejected: confirmation ${ref}'s answering capture ${c.answeredBySignalId} does not resolve to a Director-stamped signal (defense-in-depth on the bind)`);
      }
      // VALIDATE here (reject loudly pre-CAS); the policy layer consumes after the
      // decision CAS commits (see the repository header for the race analysis).
      assertConsumable(c, {
        decisionId: input.decision.id,
        promptHash: canonicalPromptHash(input.decision),
        proposedResolutionHash: hashProposedResolution(input.answer),
        executionPlanHash: hashExecutionPlan(input.decision.executionPlan),
      });
      return { authorityMode: "director-direct", authorityRef: ref };
    }
    if (ref.startsWith("dsig-")) {
      const s = await this.proofs.getSignal(ref);
      if (!s) throw new DecisionTransitionRejected(`resolve-as-director rejected: signal ${ref} does not resolve`);
      if (planRequiresConfirmation(input.decision.executionPlan)) {
        throw new DecisionTransitionRejected("resolve-as-director rejected: this decision's execution plan requires a consumed DirectorConfirmation (an action outside the v1 reversible registry cannot flow on Signal proof alone — fail-closed)");
      }
      return { authorityMode: "director-via-proxy", authorityRef: ref };
    }
    if (ref.startsWith("grant-")) {
      if (!this.grants) {
        throw new DecisionTransitionRejected("resolve-as-director rejected: the ClassGrant evaluator is not wired in this context (fail-closed, never a silent fall-through)");
      }
      // Re-read FRESH immediately before evaluation (the revocation-recheck
      // posture): a revoke committed any time before this read rejects here.
      // Residual (revoke landing between this read and the decision CAS commit)
      // is milliseconds and observable — the resolution stores id@version, so a
      // drift audit can always join resolutions against revocation timestamps.
      // PR #488 finding 2 (route↔proof tie): grant authority exists ONLY on the
      // self-disposal path — a decision routed to the DIRECTOR cannot be resolved
      // under a grant (that would bypass the curation/arrival semantics), and the
      // route must cite exactly this grant.
      const cited = input.decision.routedTo?.target === "self-disposal" ? input.decision.routedTo.selfDisposal?.classGrantRef : undefined;
      if (cited !== ref) {
        throw new DecisionTransitionRejected(`resolve-as-director rejected: grant proof requires the decision to be ROUTED self-disposal citing this grant (routed: ${input.decision.routedTo?.target ?? "(none)"}, cited: ${cited ?? "(none)"}, proof: ${ref}) — the route is the authority path, not the proof alone`);
      }
      const grant = await this.grants.getGrant(ref);
      if (!grant) throw new DecisionTransitionRejected(`resolve-as-director rejected: grant ${ref} does not resolve`);
      const { evaluateGrant } = await import("./class-grant-repository-substrate.js");
      evaluateGrant(grant, input.decision, new Date().toISOString());
      // design §1.2: the resolution stores grant id+version (row-per-version
      // immutability — the historical constraint content survives revocation).
      return { authorityMode: "class-grant", authorityRef: `${grant.id}@v${grant.version}` };
    }
    throw new DecisionTransitionRejected(`resolve-as-director rejected: ref ${ref} is not a proof object (DirectorSignal/DirectorConfirmation) — an assertion-class ref (audit/message/doc) is NOT proof (CL-2)`);
  }
}
