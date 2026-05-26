/**
 * Shape-helpers for envelope-aware entity reads.
 *
 * mission-88 W9 (bug-125 fix): downstream repository code reads legacy-flat
 * field paths (e.g., `idea.tags`) but post-W6.1-envelope-migration the
 * substrate returns envelope-shape rows where those fields moved to nested
 * paths (e.g., `idea.metadata.labels`). The TOLERANT env-var governs only
 * substrate-write tolerance; the read-side repository layer needs its own
 * shape-defensive coercion until idea-320 (M-Substrate-TOLERANT-Read-
 * Normalization) lands as the systemic fix post-mission-88.
 *
 * These helpers are the minimal-required interim per thread-652 R5
 * Director-ratified (D) TOLERANT-bridge disposition.
 */

interface EntityWithMaybeTags {
  readonly tags?: readonly string[];
  readonly metadata?: {
    readonly labels?: Record<string, string>;
  };
}

/**
 * Coerce tags from an entity that may be in either legacy-flat or envelope
 * shape.
 *
 * - Legacy-flat: `entity.tags` is `string[]` at the top level. Returns a copy.
 * - Envelope:    `entity.metadata.labels` is `Record<string,string>` (per
 *                cluster-1 K8s-style array-to-map migration). Returns
 *                `Object.keys(labels)`.
 * - Missing both: returns `[]` (historically tags was present-but-empty array;
 *                 missing-both is a safe-default; never throws).
 *
 * **CONSTRAINT (W9 Q2 engineer-add):** this helper returns label-KEYS only.
 * Cluster-1 migration stored `labels.<tag> = ""` (empty-string values) per
 * K8s convention — existence is the signal; value is metadata-for-future-use.
 * If label-VALUES become semantically meaningful, this helper becomes lossy
 * (round-trip drops the value side) and callers must migrate to direct
 * `entity.metadata.labels` access. At that point, idea-320 substrate-read
 * normalization or idea-318 repository envelope-native rewrite is mandatory.
 *
 * **W9 Q4 keep-legacy-branch refinement:** the legacy-flat branch stays
 * indefinitely (defense-in-depth). Stripping post-W11-strict-flip introduces
 * fragility for future substrate operations that don't go through envelope
 * encoding (hot-fix direct substrate.put with legacy-flat payload during
 * incident response, etc.). Cost is ~3 lines; benefit is non-trivial
 * resilience.
 *
 * Defensive: never throws. Any input (including `null`/`undefined`/non-object)
 * coerces to `[]`.
 */
export function tagsFromEntity(entity: unknown): string[] {
  if (entity === null || entity === undefined || typeof entity !== "object") {
    return [];
  }
  const e = entity as EntityWithMaybeTags;
  // Legacy-flat: tags at top-level (pre-W6.1 production shape).
  if (Array.isArray(e.tags)) {
    return [...e.tags];
  }
  // Envelope-shape: tags moved to metadata.labels keys (post-W6.1 cluster-1
  // migration; see hub/src/storage-substrate/migrations/v2-envelope/kinds/
  // Idea.ts + Bug.ts for the canonical transformation).
  if (e.metadata && typeof e.metadata === "object" && e.metadata.labels && typeof e.metadata.labels === "object") {
    return Object.keys(e.metadata.labels);
  }
  return [];
}

/**
 * Coerce an array-valued field from an entity that may be in either legacy-flat
 * or envelope shape. Probes the top-level field name AND each envelope partition
 * section (`metadata`/`spec`/`status`); returns a copy of the first matching
 * array, else `[]`.
 *
 * mission-88 W9.1 (bug-134 fix; engineer-side scope-extension of bug-125):
 * Cluster-1/2/3/4/5 envelope migrations move array fields to different envelope
 * partition sections per kind-Design. Hub repository code that spreads these
 * arrays (`[...entity.X]`) crashes on envelope-shape rows where the field has
 * been relocated. Examples:
 *   - `bug.linkedTaskIds` → `bug.status.linkedTaskIds` (per cluster-1 Bug.ts §6)
 *   - `bug.fixCommits` → `bug.status.fixCommits` (per cluster-1 Bug.ts §6)
 *   - `turn.tele` → `turn.spec.tele` (per cluster-2 Turn.ts §6)
 *
 * Probe order: top-level → metadata.X → spec.X → status.X → []. Returns first
 * matching `Array.isArray` value as a shallow copy. Defensive: never throws.
 *
 * **Generalized companion to `tagsFromEntity`** — tags has a special K8s map-
 * vs-array shape mismatch (`labels{}` vs `tags[]`); this helper handles plain
 * array-to-array migrations. Both helpers stay around indefinitely per W9 Q4
 * keep-legacy-branch refinement (defense-in-depth post-W11-strict-flip).
 *
 * Scope-extension methodology calibration: future repository-class audits
 * should grep ALL `[...entity.X]` spreads, not just one named field, to catch
 * sibling-pattern cases sitting adjacent in cloneEntity bodies.
 */
/**
 * Coerce the FSM phase string from an entity that may be in either legacy-flat
 * or envelope shape. Reads:
 *
 * - Legacy-flat: `entity.status` is a string (e.g., `"resolved"`, `"active"`).
 *   Returns it as-is.
 * - Envelope:    `entity.status` is `{phase: "resolved", ...}` (post-W7 K8s-
 *                style `status.phase` per cluster-3 ConfigMap-precedent Design).
 *                Returns `entity.status.phase`.
 * - Missing/non-string/null entity: returns `null`.
 *
 * mission-89 Phase 4 (bug-137 closure surface): Hub policy update_* handlers
 * compare `current.status !== input.status` to gate FSM transitions. Pre-fix,
 * envelope-shape entities returned `current.status` as `{phase, ...}` object;
 * `{...} !== "resolved"` is always true → "Invalid state transition" error
 * blocks legitimate updates (required psql workaround at mission-88 W11 close).
 *
 * Apply at every `entity.status === <enum>` / `entity.status !== <enum>` /
 * `current.status` comparison site in policy/* + entities/*. Sibling pattern
 * of `tagsFromEntity` / `arrayFieldFromEntity` (W9/W9.1; defense-in-depth
 * read-coerce indefinitely per W9 Q4 keep-legacy-branch refinement).
 *
 * Defensive: never throws. Returns `null` for any non-object input or any
 * object without a readable status — callers should handle null explicitly
 * (typically: if null, reject with "entity has unreadable status; envelope
 * shape may be malformed" rather than silently fall-through).
 */
export function phaseFromEntity(entity: unknown): string | null {
  if (entity === null || entity === undefined || typeof entity !== "object") {
    return null;
  }
  const e = entity as Record<string, unknown>;
  // Legacy-flat: status is a string at top-level.
  if (typeof e.status === "string") {
    return e.status;
  }
  // Envelope-shape: status is {phase, ...} object (cluster-3 ConfigMap precedent).
  if (e.status && typeof e.status === "object") {
    const status = e.status as Record<string, unknown>;
    if (typeof status.phase === "string") {
      return status.phase;
    }
  }
  return null;
}

export function arrayFieldFromEntity(entity: unknown, fieldName: string): unknown[] {
  if (entity === null || entity === undefined || typeof entity !== "object") {
    return [];
  }
  const e = entity as Record<string, unknown>;
  // Legacy-flat: field at top-level.
  if (Array.isArray(e[fieldName])) {
    return [...e[fieldName]];
  }
  // Envelope-shape: field moved into one of the partition sections. Probe
  // in canonical-Design order (metadata for provenance, spec for declared,
  // status for FSM-mutated).
  for (const section of ["metadata", "spec", "status"] as const) {
    const sec = e[section];
    if (sec && typeof sec === "object" && Array.isArray((sec as Record<string, unknown>)[fieldName])) {
      return [...((sec as Record<string, unknown>)[fieldName] as unknown[])];
    }
  }
  return [];
}
