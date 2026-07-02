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
 * What remains here is the membrane MECHANISM, not a dual-shape reader:
 *  - `phaseFromEntity` — the status-extractor the decoders call to map an
 *    envelope `status.{phase}` bucket → the flat top-level `status` string. It
 *    is load-bearing decode-machinery (decodeEnvelopeToFlat + the kept bespoke
 *    normalizers normalizeThreadShape/normalizeTele/normalizeAgentShape call it
 *    below the membrane). It is ALSO reused above the membrane in the policy
 *    status-accessors + a handful of CAS callbacks for a graceful status read —
 *    safe per architect ruling (A): there the entity is already flat (it reads
 *    the top-level string), and it is graceful on a stray {phase} object, so it
 *    is NOT a dual-shape recurrence surface even where reused. Kept, not deleted.
 *  - `decodeEnvelopeToFlat` — the generic renameMap+partition reverse the repos
 *    apply on the read boundary.
 *
 * READ-PATH graceful-degrade for BAD DATA (W8 review lens-2): a stray/malformed/
 * corrupt row returns a safe default (null) — a single bad DATA row must not
 * crash a list/read.
 *
 * SUPERSEDED for the SKIPPED/BROKEN-DECODE case (C3-R4b piece 2; cal-84 +
 * thread-689 — REFINES, does not flip, the W8 framing): W8 originally scoped the
 * 0-bare detector as a separate out-of-band anomaly-monitor and made the read
 * path never-throw. Post-W8-STRICT a fully-intact UNDECODED envelope above the
 * membrane is ALWAYS a code defect (a decode was skipped or a decoder regressed),
 * never a legitimate row — so it is now an IN-BAND fail-loud throw
 * (BareEnvelopeError; storage-substrate/bare-envelope-error.ts) via the OPTIONAL
 * `kind` arg to decodeEnvelopeToFlat + the bespoke normalizers. The distinction
 * that preserves W8's good property: the NARROW co-present signature
 * (apiVersion + spec-object + status-{phase}-object) fires ONLY on the
 * code-defect case; a genuinely malformed/corrupt row does NOT match it and
 * still graceful-degrades to null (bad data). The throw is production-armed-only
 * (armBareEnvelopeDetector, wired in index.ts) — inert in tests/standalone.
 */

import { assertDecodedFlat } from "../storage-substrate/bare-envelope-error.js";

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
 * Graceful-degrade for BAD DATA: a non-object input returns as-is; a malformed/
 * corrupt row passes through unchanged (does NOT match the narrow full-envelope
 * signature → never throws on bad data).
 *
 * INTEGRITY ASSERT (C3-R4b piece 2): pass the entity `kind` to arm the
 * production-only 0-bare detector — if the decoded result is STILL a full
 * envelope (a skipped/broken decode, never a legit row post-W8-STRICT) it throws
 * BareEnvelopeError. Omit `kind` (or run unarmed, e.g. tests) → pure pass-through,
 * identical to the pre-R4b behavior.
 *
 * NOTE (layering): Agent/Thread/Tele keep their BESPOKE normalizers — extra
 * leaf-renames (agent firstSeenAt↔metadata.createdAt) or extra domain logic
 * (thread convergenceActions/proposer-shape/participants). This generic base is
 * exact only for the 5 leaf-preserving-except-status kinds; the idea/bug repos
 * derive `tags` from the metadata.labels map inline at their decode boundary
 * (cloneIdea/cloneBug — the cluster-1 array↔map asymmetry the generic flatten
 * can't reverse).
 */
export function decodeEnvelopeToFlat<T>(raw: T, kind?: string): T {
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
  // mission-90 W8 (audit m2): the K8s annotations map is an envelope metadata
  // artifact, not a flat domain field — strip it after lifting sourceThreadSummary
  // so it doesn't leak onto the decoded shape. (Only consumer of annotations is the
  // encode path; nothing above the membrane reads flat.annotations.)
  delete flat.annotations;
  // C3-R4b piece 2: armed-only 0-bare integrity assert at the decode boundary
  // (inert unless `kind` given AND the detector is armed in production).
  return kind !== undefined ? assertDecodedFlat(flat as T, kind) : (flat as T);
}
