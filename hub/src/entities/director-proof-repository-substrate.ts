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
    return cloneFlat(s, SIGNAL_KIND);
  }

  async getSignal(id: string): Promise<DirectorSignal | null> {
    const s = await this.substrate.get<DirectorSignal>(SIGNAL_KIND, id);
    return s ? cloneFlat(s, SIGNAL_KIND) : null;
  }

  async mintConfirmation(input: {
    decisionId: string;
    promptHash: string;
    proposedResolutionHash: string;
    executionPlanHash: string | null;
    ttlMs: number;
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
      executionPlanHash: input.executionPlanHash,
      nonce: randomUUID(),
      createdAt: nowISO,
      expiresAt: new Date(now + input.ttlMs).toISOString(),
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
  constructor(private readonly proofs: IDirectorProofStore) {}

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
      throw new DecisionTransitionRejected("resolve-as-director rejected: ClassGrant proof is slice B3 — the grant evaluator is not yet available (fail-closed, never a silent fall-through)");
    }
    throw new DecisionTransitionRejected(`resolve-as-director rejected: ref ${ref} is not a proof object (DirectorSignal/DirectorConfirmation) — an assertion-class ref (audit/message/doc) is NOT proof (CL-2)`);
  }
}
