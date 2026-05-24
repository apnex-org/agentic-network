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
