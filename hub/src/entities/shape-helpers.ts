/**
 * Shape-helpers — canonical LAYER-SPANNING readers for entity fields.
 *
 * mission-90 W8 (idea-320 / idea-327): the substrate is envelope-ONLY at the
 * STORAGE layer (no legacy-flat rows; the dual-shape STORAGE tolerance —
 * SUBSTRATE_ENVELOPE_TOLERANT flag, cascade bare-fallbacks, matchesFilter
 * bare-path, listMissions legacy UNION, counter legacy branch — is RETIRED).
 *
 * But there are now TWO live shapes at DIFFERENT layers, both current (NOT a
 * legacy straddle): the STORAGE shape (envelope: {metadata,spec,status:{phase}})
 * read on raw rows (CAS via getWithRevision), and the DECODED DOMAIN shape (flat:
 * {status:"open",...}) produced by decodeEnvelopeToFlat on the repo read boundary
 * (idea-327 → decode-to-flat). These helpers read a field correctly from EITHER
 * layer, so a caller need not know which it holds.
 *
 * READ-PATH graceful-degrade (W8 review lens-2): a stray/malformed row returns a
 * safe default (null / undefined / []), NEVER a throw — a single bad row must not
 * crash a list/read. Bare-row DETECTION is the separate 0-bare anomaly-monitor
 * follow-on (loud, out-of-band), not a read-path concern.
 */

interface EntityWithMaybeTags {
  readonly tags?: readonly string[];
  readonly labels?: Record<string, string>;
  readonly metadata?: {
    readonly labels?: Record<string, string>;
  };
}

/**
 * Coerce tags from an entity. Reads, in order: an envelope `metadata.labels` map,
 * a decoded-flat top-level `labels` map (cluster-1 K8s array→map: existence is the
 * signal; returns the KEYS), or a legacy top-level `tags` array. Graceful-degrade:
 * none present → `[]` (never throws).
 *
 * Returns label-KEYS only; if label-VALUES become semantically meaningful this
 * becomes lossy and callers must read `entity.metadata.labels` directly.
 */
export function tagsFromEntity(entity: unknown): string[] {
  if (entity === null || entity === undefined || typeof entity !== "object") {
    return [];
  }
  const e = entity as EntityWithMaybeTags;
  // Envelope storage shape: metadata.labels map.
  if (e.metadata && typeof e.metadata === "object" && e.metadata.labels && typeof e.metadata.labels === "object") {
    return Object.keys(e.metadata.labels);
  }
  // Decoded-flat domain shape: top-level labels map (metadata.* flattened).
  if (e.labels && typeof e.labels === "object") {
    return Object.keys(e.labels);
  }
  // Legacy top-level tags array (defensive; storage is envelope-only).
  if (Array.isArray(e.tags)) {
    return [...e.tags];
  }
  return [];
}

/**
 * Coerce the FSM phase string from an entity. Reads `status.phase` (envelope
 * storage shape) OR a top-level `status` string (decoded-flat domain shape).
 * Graceful-degrade: non-object / no readable status → `null` (never throws);
 * callers handle null explicitly.
 *
 * Apply at every `entity.status === <enum>` / `current.status` comparison site —
 * an envelope `status` is the `{phase,...}` bucket object, so a raw
 * `status === <enum>` compare is always false (the bug-137 / bug-138 class).
 */
export function phaseFromEntity(entity: unknown): string | null {
  if (entity === null || entity === undefined || typeof entity !== "object") {
    return null;
  }
  const e = entity as Record<string, unknown>;
  // Envelope storage shape: status is the {phase,...} bucket object.
  if (e.status && typeof e.status === "object") {
    const status = e.status as Record<string, unknown>;
    if (typeof status.phase === "string") {
      return status.phase;
    }
  }
  // Decoded-flat domain shape: status is the phase string directly.
  if (typeof e.status === "string") {
    return e.status;
  }
  return null;
}

/**
 * Read a SCALAR/OBJECT field that may live in an envelope partition (metadata /
 * spec / status) OR at top-level (decoded-flat domain, envelope reserved fields
 * like id/name, or non-relocated fields). Probes partitions first (where relocated
 * fields live in the storage shape), then top-level. Graceful-degrade: absent /
 * non-object → `undefined` (never throws).
 *
 * Use for any moved filterable field EXCEPT `status` (use `phaseFromEntity` — a
 * top-level envelope `status` IS the `{phase,...}` bucket object).
 */
export function fieldFromEntity(entity: unknown, fieldName: string): unknown {
  if (entity === null || entity === undefined || typeof entity !== "object") {
    return undefined;
  }
  const e = entity as Record<string, unknown>;
  for (const section of ["metadata", "spec", "status"] as const) {
    const sec = e[section];
    if (sec && typeof sec === "object" && Object.prototype.hasOwnProperty.call(sec as object, fieldName)) {
      return (sec as Record<string, unknown>)[fieldName];
    }
  }
  // Decoded-flat / reserved / non-relocated top-level field.
  return e[fieldName];
}

/**
 * Read an ARRAY field that may live in an envelope partition (metadata / spec /
 * status) OR at top-level (decoded-flat domain). Probes partitions first, then
 * top-level. Returns a shallow copy. Graceful-degrade: absent / non-object → `[]`
 * (never throws).
 *
 * Per-kind envelope migrations relocate array fields to different sections (e.g.
 * `bug.linkedTaskIds`/`bug.fixCommits` → status; `turn.tele` → spec).
 */
export function arrayFieldFromEntity(entity: unknown, fieldName: string): unknown[] {
  if (entity === null || entity === undefined || typeof entity !== "object") {
    return [];
  }
  const e = entity as Record<string, unknown>;
  for (const section of ["metadata", "spec", "status"] as const) {
    const sec = e[section];
    if (sec && typeof sec === "object" && Array.isArray((sec as Record<string, unknown>)[fieldName])) {
      return [...((sec as Record<string, unknown>)[fieldName] as unknown[])];
    }
  }
  if (Array.isArray(e[fieldName])) {
    return [...e[fieldName]];
  }
  return [];
}

/**
 * Decode an envelope-shape entity row (metadata/spec/status partitions) into the
 * flat domain shape that consumers + the entity TS types expect. mission-90 W8
 * (idea-327 resolved → decode-to-flat; Director-confirmed (A)): the substrate
 * repos apply this on the get()/list()/findBy* return boundary, AFTER the
 * substrate filter-translate — so the verified 9/9 filter-parity is untouched;
 * only the RETURNED shape is flattened. This closes the read-side half of bug-138
 * for the repos that returned raw envelope (Task/Proposal/Mission/Idea/Bug) — the
 * gap the legacy-flat test fixtures masked mission-wide.
 *
 * GENERIC renameMap+partition reverse (architect-preferred — completes the
 * renameMap-as-universal-authority thesis: write-ENCODE + filter-TRANSLATE +
 * read-DECODE from one declarative contract). Flattens the partition buckets to
 * top-level (every relocation is leaf-preserving EXCEPT `status`, whose `phase`
 * becomes the top-level `status` string — verified exact against the 5 kinds'
 * all-schemas renameMaps), and strips the envelope artifacts (bucket objects +
 * apiVersion / kind / phase). Reserved top-level fields (id, name) preserved.
 *
 * Graceful-degrade: a non-object input returns as-is; a bare (already legacy-flat)
 * row has no buckets → passes through unchanged. Never throws.
 *
 * NOTE (layering): Agent/Thread/Tele keep their BESPOKE normalizers — extra
 * leaf-renames (agent firstSeenAt↔metadata.createdAt) or extra domain logic
 * (thread convergenceActions/proposer-shape/participants). This generic base is
 * exact only for the 5 leaf-preserving-except-status kinds; tags are derived via
 * tagsFromEntity (the cluster-1 array↔map asymmetry the generic flatten can't
 * reverse), so consumers read tags through that helper, not a flat `tags` array.
 */
export function decodeEnvelopeToFlat<T>(raw: T): T {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return raw;
  }
  const r = raw as Record<string, unknown>;
  const asObj = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const flat: Record<string, unknown> = {
    ...r,
    ...asObj(r.metadata),
    ...asObj(r.spec),
    ...asObj(r.status),
  };
  delete flat.metadata;
  delete flat.spec;
  delete flat.status;
  delete flat.phase;
  delete flat.apiVersion;
  delete flat.kind;
  delete flat.name; // envelope reserved artifact (= id); not a flat domain field
                    // (bespoke decoders that map metadata.name→a domain field, e.g.
                    //  Turn.title, must capture it BEFORE calling this generic base)
  const phase = phaseFromEntity(raw);
  if (phase !== null) {
    flat.status = phase;
  }
  // mission-90 W8: the cascade back-link summary lives in the K8s annotations map
  // (metadata.annotations["ois.io/sourceThreadSummary"]); surface it as the flat
  // domain field for spawned Task/Proposal/Idea (the flatten put `annotations` at
  // top-level). Cross-kind cascade convention — harmless for kinds without it.
  const annotations = flat.annotations as Record<string, unknown> | undefined;
  if (annotations && typeof annotations === "object" && annotations["ois.io/sourceThreadSummary"] !== undefined) {
    flat.sourceThreadSummary = annotations["ois.io/sourceThreadSummary"];
  }
  return flat as T;
}
