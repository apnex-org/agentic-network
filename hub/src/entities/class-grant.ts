/**
 * class-grant.ts — mission-102 P3-B3: the ClassGrant entity (design.md v1.0 §1.2,
 * RATIFIED at G2; canonical git 64de1bf).
 *
 * A ClassGrant is a TYPED-CONSTRAINT-FIELD delegation (the evidenceRequirements
 * precedent — not prose, not a predicate language): the Hub evaluates the fields
 * and only then stamps authorityMode=class-grant. The caller never supplies the
 * mode (S1.2/CL-3); classification alone is never authority (the verifier's
 * lean-laundering attack — contract test 1).
 *
 * Immutability model: constraint fields NEVER mutate after mint — there is no
 * update verb, only the state transitions revoke/supersede. A new version is a
 * NEW row (fresh id, version+1, linked via supersedes/supersededBy), so
 * resolutions storing `id@vN` retain their exact historical content forever
 * (contract test 3: grant-drift).
 *
 * Ratification: the architect DRAFTS the grant packet (a doc); the Director
 * ratifies it AS A DECISION through the rail (dogfood — the grant is the rail's
 * first cargo). mint_class_grant fail-closed REQUIRES ratificationRef to resolve
 * to a resolved/executed Decision: an unratified grant row cannot exist.
 */

export type ClassGrantState = "active" | "revoked" | "superseded";

export interface ClassGrant {
  id: string;
  /** Monotonic across the supersession chain; immutable on a row. */
  version: number;
  /** Ontology class this grant covers — EXACT match at evaluation (S1.3). */
  class: string;
  /** Registry actions the grant may authorize — composes with the CL-1 registry:
   *  a grant literally cannot authorize an action v1 cannot execute. */
  allowedActions: string[];
  /** When true, any plan action outside the reversible registry rejects. */
  reversibleOnly: boolean;
  /** Optional allowlist for the decision's parentRef.kind. */
  parentKinds: string[] | null;
  /** Machine-checkable forbidden boundary rows: refs the grant may never touch
   *  (matched against parentRef.id and every plan targetRef). */
  excludedRefs: string[];
  /** Classes the grant explicitly never covers (belt against reclassification). */
  excludedClasses: string[];
  /** Grants are Director-issued by construction (the ratification decision). */
  issuer: "director";
  /** The resolved Decision that ratified this grant — resolvable, fail-closed at mint. */
  ratificationRef: string;
  state: ClassGrantState;
  /** Past this date the grant must be re-presented to the Director; evaluation
   *  REJECTS past-due grants (computed at evaluation time — no timer ever
   *  transitions state, per L1; re-presentation is an authored re-ratification). */
  representationDue: string;
  /** Supersession chain links (null at the ends). */
  supersedes: string | null;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IClassGrantStore {
  /** Mint an ACTIVE grant. Fail-closed: ratificationRef must resolve to a
   *  Decision in resolved|executed state (the caller passes a resolver so the
   *  store stays decision-store-agnostic). */
  mintGrant(input: {
    class: string;
    allowedActions: string[];
    reversibleOnly: boolean;
    parentKinds?: string[] | null;
    excludedRefs?: string[];
    excludedClasses?: string[];
    ratificationRef: string;
    /** Re-presentation POLICY in days (hashable at raise time — the instant is
     *  computed at mint: now + days). Part of the canonical spec hash. */
    representationDays: number;
    supersedes?: string | null;
  }, ratificationResolved: boolean): Promise<ClassGrant>;
  getGrant(id: string): Promise<ClassGrant | null>;
  listGrants(filter?: { state?: ClassGrantState; class?: string }): Promise<{ items: ClassGrant[]; truncated: boolean }>;
  /** active → revoked (terminal). CAS-guarded; already-terminal rejects. */
  revokeGrant(id: string, reason: string): Promise<ClassGrant | null>;
  /** Marks the PRIOR row superseded and links it to the successor (called by
   *  the mint of the successor version). */
  markSuperseded(id: string, successorId: string): Promise<ClassGrant | null>;
  /** PR #488 finding 2: the grant-use SERIALIZATION barrier (advisory lock keyed
   *  on grantId). A class-grant-backed resolve runs its gate-read + decision CAS
   *  inside this barrier; revoke/supersede take the same barrier — so a revoke
   *  committed first is ALWAYS seen by the resolve's fresh read, and a resolve
   *  holding the barrier completes before the revoke proceeds. */
  withGrantBarrier<T>(grantId: string, fn: () => Promise<T>): Promise<T>;
}
