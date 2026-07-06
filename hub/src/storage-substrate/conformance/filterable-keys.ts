/**
 * filterable-keys.ts — C3-R4a (M-Shape-Conformance), the renameMap-governor's
 * reviewed source-of-truth.
 *
 * The substrate-FILTERABLE flat keys per kind (every key passed into a
 * `substrate.list(KIND, {filter|sort})` call), the documented exclusions, and
 * the registry of dynamic call-sites the static scanner cannot enumerate.
 *
 * Moved out of renamemap-contract-w1.test.ts (W1.1c consumed inline copies) so
 * the W1 contract test AND the R4a drift-gate (filterable-keys-drift-gate.test.ts)
 * share ONE reviewed artifact. The drift-gate asserts the live call-site SCAN
 * (derive-filterable-keys.ts) agrees with this map, so a new filter on a
 * partition-relocated field can never silently skip its renameMap entry — the
 * bug-138 / bug-170 silent-filter-miss class.
 */

/**
 * The substrate-SIDE filter/sort keys per kind, curated from the call-site sweep
 * (W2 finding-A) and now drift-gated against the static scanner. This is the
 * completeness BOUND: W1.1c asserts each is renameMap-covered OR documented-
 * excluded OR unmoved; the drift-gate asserts the scanner finds nothing outside
 * it. A new filter adds its key here; if untranslatable it fails W1.1c.
 */
export const SUBSTRATE_FILTERABLE_KEYS: Record<string, string[]> = {
  Agent: ["fingerprint"],
  Audit: ["actor"],
  Bug: ["status", "severity", "class", "sourceThreadId", "sourceActionId", "sourceIdeaId"],
  Idea: ["status", "missionId", "sourceThreadId", "sourceActionId"],
  Message: ["kind", "status", "threadId", "migrationSourceId", "authorAgentId", "delivery", "scheduledState", "target.role", "target.agentId", "id"],
  Mission: ["status", "sourceThreadId", "sourceActionId"],
  PendingAction: ["state", "naturalKey", "targetAgentId", "dispatchType", "entityRef"],
  Proposal: ["status", "sourceThreadId", "sourceActionId"],
  Thread: ["status", "cascadePending", "currentTurnAgentId", "recipientAgentId"],
  Document: ["category"],
  ReviewHistoryEntry: ["taskId"],
  ThreadHistoryEntry: ["threadId"],
  Notification: ["recipientAgentId"],
  // C1-R2 (mission-94): status (→status.phase, equality) + roleEligibility (the
  // $contains array-membership key, → spec.roleEligibility; see ARRAY_FILTERABLE_KEYS).
  // work-88 (arc-node): + completionDependsOn (the second $contains array-membership key,
  // → spec.completionDependsOn; the renewLease transitive-heartbeat reverse-ancestor
  // lookup). The hot lease sub-fields are filtered via the bucket-prefixed dotted path
  // (status.lease.holder / status.lease.expiresAt — isBucketPrefixed, no renameMap
  // entry, sub-PR-3), NOT listed here.
  WorkItem: ["status", "roleEligibility", "completionDependsOn"],
  // mission-102 P3-B1: Decision queue views filter by phase + ontology class. The
  // arrival-surface routedTo.target filter uses the bucket-prefixed dotted path
  // (status.routedTo.target — isBucketPrefixed, no renameMap entry), NOT listed here.
  // "id" = the listAllDecisions exact-scan SORT key (audit-10199; universal PK,
  // no renameMap needed — W1 exempts id).
  Decision: ["status", "class", "id"],
  // mission-102 P3-B3: active-grant lookups + per-class drift audits.
  ClassGrant: ["state", "class"],
};

/**
 * Substrate-side FILTERABLE keys deliberately NOT given a renameMap entry, with a
 * reason. 'phantom': field absent from real rows (bug-148). 'structural-transform':
 * value shape changes → JSONB path-equality meaningless.
 *
 * C3-R4b COLLAPSED the former 'cascade-dual-path' exclusions: the cascade keys
 * (sourceThreadId / sourceActionId / sourceIdeaId on Bug/Idea/Mission/Proposal/
 * Task) now carry renameMap entries (flat→metadata.*) and the repos filter by the
 * flat key, so they are COVERED, not excluded — renameMap is their single
 * field-path authority now.
 */
export const EXCLUDED_FILTERABLE_KEYS: Record<string, Record<string, string>> = {
  Notification: { recipientAgentId: "phantom (bug-148: repo interface diverges from SchemaDef; field in no row)" },
};

/**
 * C1-R2 (mission-94): substrate-filterable keys queried by `$contains` ARRAY-
 * MEMBERSHIP (not scalar equality) — the value-round-trip oracle exercises these
 * via `{key:{$contains:v}}` against a seeded ARRAY, not an equality filter. The
 * first such key is WorkItem.roleEligibility (role ∈ spec.roleEligibility[]); work-88
 * (arc-node) adds completionDependsOn (childId ∈ spec.completionDependsOn[] — the
 * transitive-heartbeat reverse-ancestor lookup). Every key here MUST also appear in
 * SUBSTRATE_FILTERABLE_KEYS.
 */
export const ARRAY_FILTERABLE_KEYS: Record<string, string[]> = {
  WorkItem: ["roleEligibility", "completionDependsOn"],
};

/**
 * Envelope-bucket prefixes. A derived filter key that begins with one of these
 * is ALREADY a translated envelope JSONB path (the repo issued an envelope-first
 * dotted query, e.g. the cascade-dual-path `metadata.sourceThreadId` or Mission's
 * pre-translated `status.phase`), so it bypasses renameMap translation and is
 * filter-safe by construction. The drift-gate treats bucket-prefixed derived
 * keys as pre-translated (verified behaviorally by the round-trip oracle), not as
 * new flat keys requiring a renameMap entry.
 */
export const ENVELOPE_BUCKET_PREFIXES = ["metadata.", "spec.", "status."] as const;

/** A filter key is a pre-translated envelope path if it starts with a bucket prefix. */
export function isBucketPrefixed(key: string): boolean {
  return ENVELOPE_BUCKET_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Acknowledged dynamic filter call-sites — those whose keys the static scanner
 * CANNOT enumerate (a helper-built filter, an opts-spread, a param-sourced
 * filter, or a generic kind argument). The drift-gate asserts every scanner
 * `dynamicSite` matches one of these (by file basename + kind + reason), so a
 * NEW unresolvable filter site can never appear unacknowledged — closing the
 * static-scan false-negative the design names. `keys` lists the filterable keys
 * the site contributes (all of which must be in SUBSTRATE_FILTERABLE_KEYS); an
 * empty `keys` means the site contributes no domain-filter keys (infra/generic).
 */
export interface AnnotatedFilterSite {
  /** Source file basename (line-independent; survives edits). */
  file: string;
  /** Resolved kind, or null for a generic/infra call-site. */
  kind: string | null;
  /** The scanner reason this site is flagged. */
  reason: "spread" | "computed-key" | "unresolved-filter-var" | "unresolved-kind";
  /** Filterable keys this site contributes (must all be in SUBSTRATE_FILTERABLE_KEYS). */
  keys: string[];
  /** Why this site is dynamic + where its keys really come from. */
  note: string;
}

export const ANNOTATED_FILTER_SITES: AnnotatedFilterSite[] = [
  {
    file: "curation-repository-substrate.ts",
    kind: null,
    reason: "unresolved-kind",
    keys: ["id"],
    note: "listAll(kind) pages RawDecisionRaised/CurationRecord with sort id ASC — the deterministic ORDER BY that makes LIMIT/OFFSET pages partition exactly (audit-10127 pattern). No filter keys; `id` is the sort key only.",
  },
  {
    file: "arrival-surface-repository-substrate.ts",
    kind: null,
    reason: "unresolved-kind",
    keys: ["id"],
    note: "listAll(kind) pages ArrivalSnapshot/NudgeReceipt with sort id ASC — the deterministic ORDER BY that makes LIMIT/OFFSET pages partition exactly (audit-10127). No filter keys; `id` is the sort key only, universal across kinds.",
  },
  {
    file: "agent-repository-substrate.ts",
    kind: "Agent",
    reason: "spread",
    keys: ["fingerprint"],
    note: "listAgentsRaw spreads `...(envelopeFilter ? {filter} : {})`; envelopeFilter = agentFilterToEnvelope(opts.filter), which pre-translates the flat `fingerprint` → metadata.fingerprint. Keys are caller-determined.",
  },
  {
    file: "message-repository-substrate.ts",
    kind: "Message",
    reason: "unresolved-filter-var",
    keys: ["kind", "status", "threadId", "authorAgentId", "delivery", "scheduledState", "target.role", "target.agentId"],
    note: "filter built by the messageQueryToFilter(query) helper; the scanner cannot see into the helper. (id/migrationSourceId/threadId are also inline-derived elsewhere.)",
  },
  {
    file: "thread-repository-substrate.ts",
    kind: "Thread",
    reason: "spread",
    keys: ["recipientAgentId", "currentTurnAgentId"],
    note: "listThreads spreads `...(equalityFilter ?? {})`; the directed-discovery keys (recipientAgentId / currentTurnAgentId) are pushed in by thread-policy (bug-170). status/cascadePending are inline-derived.",
  },
  {
    file: "migration-runner.ts",
    kind: null,
    reason: "unresolved-kind",
    keys: [],
    note: "generic migration iteration: substrate.list(kind, …) where `kind` is a runtime loop variable over ALL kinds — not a domain-specific filter. Contributes no filterable keys.",
  },
];
