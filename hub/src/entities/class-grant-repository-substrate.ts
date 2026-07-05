/**
 * class-grant-repository-substrate.ts — mission-102 P3-B3: the ClassGrant store
 * + the pure Hub-side evaluator (design §1.2).
 *
 * evaluateGrant is a PURE function over (grant, decision, nowISO): every check is
 * a typed-field comparison, loud on failure — the class-spoof (contract test 1)
 * and grant-drift (contract test 3) rejections all originate here or in the
 * gate's state re-read. authorityMode=class-grant is stamped ONLY by the
 * DirectorProofGate after this evaluator passes; resolutions store `id@vN` so
 * history survives revocation/supersession (row-per-version immutability).
 */
import type { ClassGrant, ClassGrantState, IClassGrantStore } from "./class-grant.js";
import type { Decision } from "./decision.js";
import { DecisionTransitionRejected } from "./decision-repository-substrate.js";
import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import { SubstrateCounter } from "./substrate-counter.js";
import { decodeEnvelopeToFlat } from "./shape-helpers.js";
import { withAdvisoryLock, LOCK_CLASS } from "../storage-substrate/advisory-lock.js";
import { createHash } from "node:crypto";

const KIND = "ClassGrant";
const LIST_CAP = 500;
const MAX_CAS_RETRIES = 20;

/** Mirrors the v1 execution registry (director-proof REVERSIBLE_V1_ACTIONS) —
 *  duplicated as a named const here so the grant layer's reversibility check
 *  cannot silently drift from the plan-confirmation check (both are pinned by
 *  the cross-layer agreement test). */
export const GRANT_REVERSIBLE_ACTIONS: readonly string[] = ["unblock", "approve"];

/** PR #488 finding 1: the canonical grant-spec hash — the mechanical binding
 *  between the ratification decision the Director confirmed and the exact grant
 *  fields being minted. The RAISE embeds `grant-spec-hash:<hex>` in the
 *  ratification decision's context (which the B4 Confirmation promptHash covers,
 *  so the Director's confirmation binds THIS hash); mint recomputes from the
 *  supplied fields and rejects on divergence. Arrays are sorted — field ORDER is
 *  not spec content. */
export function canonicalGrantSpecHash(spec: {
  class: string;
  allowedActions: string[];
  reversibleOnly: boolean;
  parentKinds?: string[] | null;
  excludedRefs?: string[];
  excludedClasses?: string[];
  representationDays: number;
}): string {
  const canonical = {
    class: spec.class,
    allowedActions: [...spec.allowedActions].sort(),
    reversibleOnly: spec.reversibleOnly,
    parentKinds: spec.parentKinds ? [...spec.parentKinds].sort() : null,
    excludedRefs: [...(spec.excludedRefs ?? [])].sort(),
    excludedClasses: [...(spec.excludedClasses ?? [])].sort(),
    representationDays: spec.representationDays,
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

/** The context marker the ratification raise embeds. */
export const GRANT_SPEC_HASH_MARKER = "grant-spec-hash:";

function cloneGrant(g: ClassGrant): ClassGrant {
  const flat = decodeEnvelopeToFlat(g as unknown as Record<string, unknown>, KIND) as Record<string, unknown>;
  flat.parentKinds = (flat.parentKinds as string[] | null | undefined) ?? null;
  flat.excludedRefs = (flat.excludedRefs as string[] | undefined) ?? [];
  flat.excludedClasses = (flat.excludedClasses as string[] | undefined) ?? [];
  flat.supersedes = (flat.supersedes as string | null | undefined) ?? null;
  flat.supersededBy = (flat.supersededBy as string | null | undefined) ?? null;
  return flat as unknown as ClassGrant;
}

export class ClassGrantRepositorySubstrate implements IClassGrantStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
  ) {}

  async mintGrant(input: {
    class: string;
    allowedActions: string[];
    reversibleOnly: boolean;
    parentKinds?: string[] | null;
    excludedRefs?: string[];
    excludedClasses?: string[];
    ratificationRef: string;
    representationDays: number;
    supersedes?: string | null;
  }, ratification: { resolved: boolean; resolvedAt: string | null }): Promise<ClassGrant> {
    // Fail-closed at authoring (the A3/bug-220(c) law): an unratified grant row
    // cannot exist — the policy layer resolves the ratification Decision and
    // passes the verdict; a false here is a loud reject, never a draft state.
    if (!ratification.resolved || !ratification.resolvedAt) {
      throw new DecisionTransitionRejected(`mint rejected: ratificationRef ${input.ratificationRef} does not resolve to a resolved/executed Decision — a grant exists only as ratified cargo of the rail`);
    }
    // A grant must not authorize actions the reversibleOnly flag forbids — reject
    // the contradiction at mint rather than dead-lettering it at evaluation.
    if (input.reversibleOnly && input.allowedActions.some((a) => !GRANT_REVERSIBLE_ACTIONS.includes(a))) {
      throw new DecisionTransitionRejected(`mint rejected: reversibleOnly grant lists non-reversible action(s) [${input.allowedActions.filter((a) => !GRANT_REVERSIBLE_ACTIONS.includes(a)).join(", ")}] — self-contradictory constraint set`);
    }
    // PR #488 re-review finding 1: a ratification is SINGLE-USE — one Director act
    // mints at most one grant row. Replay (any existing row already citing this
    // ratificationRef) rejects; a superseding version needs a FRESH ratification.
    const { items: existingGrants } = await this.listGrants();
    const replay = existingGrants.find((g) => g.ratificationRef === input.ratificationRef);
    if (replay) {
      throw new DecisionTransitionRejected(`mint rejected: ratification ${input.ratificationRef} was already consumed by ${replay.id}@v${replay.version} — one Director ratification mints exactly one grant (re-ratify for a new version)`);
    }
    let priorVersion = 0;
    if (input.supersedes) {
      const prior = await this.getGrant(input.supersedes);
      if (!prior) throw new DecisionTransitionRejected(`mint rejected: supersedes ${input.supersedes} does not resolve`);
      priorVersion = prior.version;
    }
    const num = await this.counter.next("classGrantCounter");
    const id = `grant-${num}`;
    const now = new Date().toISOString();
    const g: ClassGrant = {
      id,
      version: priorVersion + 1,
      class: input.class,
      allowedActions: input.allowedActions,
      reversibleOnly: input.reversibleOnly,
      parentKinds: input.parentKinds ?? null,
      excludedRefs: input.excludedRefs ?? [],
      excludedClasses: input.excludedClasses ?? [],
      issuer: "director",
      ratificationRef: input.ratificationRef,
      state: "active",
      // Anchored to the DIRECTOR'S ratification instant, not mint time (PR #488
      // re-review finding 1): a delayed mint cannot extend the delegation window.
      representationDue: new Date(Date.parse(ratification.resolvedAt) + input.representationDays * 24 * 3600_000).toISOString(),
      supersedes: input.supersedes ?? null,
      supersededBy: null,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.substrate.createOnly(KIND, g);
    if (!result.ok) throw new Error(`[ClassGrantRepository] mintGrant: counter issued existing ID ${id}`);
    if (input.supersedes) await this.markSuperseded(input.supersedes, id);
    console.log(`[ClassGrantRepository] ClassGrant minted: ${id} v${g.version} (class=${input.class}, ratified by ${input.ratificationRef})`);
    return cloneGrant(g);
  }

  async getGrant(id: string): Promise<ClassGrant | null> {
    const g = await this.substrate.get<ClassGrant>(KIND, id);
    return g ? cloneGrant(g) : null;
  }

  async listGrants(filter?: { state?: ClassGrantState; class?: string }): Promise<{ items: ClassGrant[]; truncated: boolean }> {
    const substrateFilter: Record<string, unknown> = {};
    if (filter?.state) substrateFilter.state = filter.state;
    if (filter?.class) substrateFilter.class = filter.class;
    const { items } = await this.substrate.list<ClassGrant>(KIND, { filter: substrateFilter as never, limit: LIST_CAP });
    return { items: items.map(cloneGrant), truncated: items.length >= LIST_CAP };
  }

  async revokeGrant(id: string, reason: string): Promise<ClassGrant | null> {
    if (!reason || reason.trim() === "") {
      throw new DecisionTransitionRejected("revoke rejected: a revocation reason is required");
    }
    // PR #488 finding 2: revoke serializes with grant-backed resolves (same barrier).
    return this.withGrantBarrier(id, () => this.transitionState(id, "revoked", (g) => {
      if (g.state !== "active") throw new DecisionTransitionRejected(`revoke rejected: grant ${id} is ${g.state}, not active`);
    }));
  }

  async markSuperseded(id: string, successorId: string): Promise<ClassGrant | null> {
    return this.withGrantBarrier(id, () => this.transitionState(id, "superseded", (g) => {
      if (g.state !== "active") throw new DecisionTransitionRejected(`supersede rejected: grant ${id} is ${g.state}, not active`);
    }, successorId));
  }

  async withGrantBarrier<T>(grantId: string, fn: () => Promise<T>): Promise<T> {
    return withAdvisoryLock(this.substrate, LOCK_CLASS.classGrant, grantId, fn);
  }

  private async transitionState(id: string, to: ClassGrantState, guard: (g: ClassGrant) => void, successorId?: string): Promise<ClassGrant | null> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<ClassGrant>(KIND, id);
      if (!existing) return null;
      const g = cloneGrant(existing.entity);
      guard(g);
      const nowISO = new Date().toISOString();
      const next: ClassGrant = { ...g, state: to, supersededBy: successorId ?? g.supersededBy, updatedAt: nowISO };
      const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
      if (result.ok) {
        console.log(`[ClassGrantRepository] ClassGrant ${id} → ${to}`);
        return cloneGrant(next);
      }
    }
    throw new Error(`[ClassGrantRepository] transitionState exhausted ${MAX_CAS_RETRIES} retries on ${id}`);
  }
}

/**
 * The PURE evaluator (design §1.2): typed-field checks only, every rejection
 * loud and specific. The gate re-reads grant state fresh immediately before the
 * decision CAS (the revocation-recheck posture; residual documented there).
 */
export function evaluateGrant(grant: ClassGrant, decision: Decision, nowISO: string): void {
  if (grant.state !== "active") {
    throw new DecisionTransitionRejected(`grant ${grant.id}@v${grant.version} is ${grant.state} — a non-active grant authorizes nothing (contract test 3)`);
  }
  if (Date.parse(grant.representationDue) < Date.parse(nowISO)) {
    throw new DecisionTransitionRejected(`grant ${grant.id}@v${grant.version} is past its re-presentation due date (${grant.representationDue}) — the Director must re-ratify before it authorizes again (fail-closed)`);
  }
  // Class: EXACT match; unclassified NEVER matches (fail-closed to director-direct
  // routing per §1.1 — an unclassified decision cannot ride any grant).
  if (decision.class === null || decision.class !== grant.class) {
    throw new DecisionTransitionRejected(`grant ${grant.id}@v${grant.version} covers class '${grant.class}', not '${decision.class ?? "(unclassified)"}' — classification is never authority (contract test 1)`);
  }
  if (grant.excludedClasses.includes(decision.class)) {
    throw new DecisionTransitionRejected(`grant ${grant.id}@v${grant.version} explicitly excludes class '${decision.class}'`);
  }
  if (grant.parentKinds !== null && (decision.parentRef === null || !grant.parentKinds.includes(decision.parentRef.kind))) {
    throw new DecisionTransitionRejected(`grant ${grant.id}@v${grant.version} covers parent kinds [${grant.parentKinds.join(", ")}], not '${decision.parentRef?.kind ?? "(none)"}'`);
  }
  const touchedRefs = [decision.parentRef?.id, ...(decision.executionPlan ?? []).map((a) => a.targetRef)].filter(Boolean) as string[];
  const excluded = touchedRefs.find((r) => grant.excludedRefs.includes(r));
  if (excluded) {
    throw new DecisionTransitionRejected(`grant ${grant.id}@v${grant.version} excludes ref '${excluded}' (forbidden boundary row)`);
  }
  for (const action of decision.executionPlan ?? []) {
    if (!grant.allowedActions.includes(action.action)) {
      throw new DecisionTransitionRejected(`grant ${grant.id}@v${grant.version} does not allow action '${action.action}' (allowed: [${grant.allowedActions.join(", ")}])`);
    }
    if (grant.reversibleOnly && !GRANT_REVERSIBLE_ACTIONS.includes(action.action)) {
      throw new DecisionTransitionRejected(`grant ${grant.id}@v${grant.version} is reversibleOnly and '${action.action}' is not in the reversible registry`);
    }
  }
}
