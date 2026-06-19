/**
 * Shape-helpers — the envelope→flat DECODE-LAYER (below the repo membrane).
 *
 * mission-90 W8 (idea-320 / idea-327, Director END-STATE-2 + architect (A)):
 * the substrate is envelope-ONLY at the STORAGE layer, and every repo decodes
 * envelope→flat at its read + CAS boundary (decodeEnvelopeToFlat / the bespoke
 * per-kind decoders). So ABOVE the membrane there is ONE flat domain shape —
 * policy + consumers read fields directly (the W3-era fieldFromEntity /
 * tagsFromEntity / arrayFieldFromEntity dual-layer readers are RETIRED).
 *
 * What remains here is the membrane MECHANISM, not an above-membrane reader:
 *  - `phaseFromEntity` — the status-extractor the decoders call to map an
 *    envelope `status.{phase}` bucket → the flat top-level `status` string. It
 *    is load-bearing decode-machinery (decodeEnvelopeToFlat + the kept bespoke
 *    normalizers normalizeThreadShape/normalizeTele/normalizeAgentShape call it),
 *    NOT a dual-shape recurrence surface — once policy reads flat, it never sees
 *    envelope. It survives BELOW the membrane by design (architect ruling (A)).
 *  - `decodeEnvelopeToFlat` — the generic renameMap+partition reverse the repos
 *    apply on the read boundary.
 *
 * READ-PATH graceful-degrade (W8 review lens-2): a stray/malformed row returns a
 * safe default (null), NEVER a throw — a single bad row must not crash a
 * list/read. Bare-row DETECTION is the separate 0-bare anomaly-monitor follow-on
 * (loud, out-of-band), not a read-path concern.
 */

/**
 * Coerce the FSM phase string from an entity. Reads `status.phase` (envelope
 * storage shape) OR a top-level `status` string (decoded-flat domain shape).
 * Graceful-degrade: non-object / no readable status → `null` (never throws);
 * callers handle null explicitly.
 *
 * This is the decode-layer status-extractor: decodeEnvelopeToFlat + the bespoke
 * normalizers call it to project the envelope `{phase,...}` bucket to the flat
 * top-level `status` string. (Above the membrane, entities are already flat, so
 * `entity.status` is the string directly — phaseFromEntity reads it gracefully
 * either way.)
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
 * exact only for the 5 leaf-preserving-except-status kinds; the idea/bug repos
 * derive `tags` from the metadata.labels map inline at their decode boundary
 * (cloneIdea/cloneBug — the cluster-1 array↔map asymmetry the generic flatten
 * can't reverse).
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
