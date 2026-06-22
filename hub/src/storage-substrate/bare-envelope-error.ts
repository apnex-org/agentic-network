/**
 * bare-envelope-error.ts — C3-R4b (M-Shape-Conformance), piece 2.
 *
 * BareEnvelopeError: the DECODE-side fail-loud twin of piece-1's
 * FilterTranslationGapError (filter-translation-error.ts). Thrown at the repo
 * decode-to-flat RETURN boundary when a decoded result is STILL a full envelope
 * (apiVersion + spec-object + status-{phase}-object co-present) — i.e. a read
 * path reached a consumer with an UNDECODED row.
 *
 * Post-mission-90-W8 STRICT, the substrate is envelope-only at storage and
 * exactly ONE flat shape above the membrane, so a bare envelope above the
 * membrane is ALWAYS a skipped/broken-decode code defect, never a legitimate
 * row — a throw is the honest signal (cal-84: the "0-bare detector"; thread-689).
 *
 * REFINES (not flips) the W8 read-path-never-throw invariant: the NARROW
 * co-present signature fires ONLY on a fully-intact undecoded envelope (the
 * code-defect case). A genuinely malformed/corrupt row still graceful-degrades
 * to null at the decoders (the bad-data case) — so W8's "one bad row must not
 * crash a list/read" is preserved for bad data; fail-loud is added ONLY for the
 * skipped/broken-decode defect. (The W8 decode-layer comments in
 * entities/shape-helpers.ts + entities/agent-envelope-shape.ts record this
 * supersession, citing cal-84 + thread-689.)
 *
 * Production-armed-only (mirrors piece-1 EXACTLY): the throw ARMS only when the
 * partitioned-kind oracle is wired (armBareEnvelopeDetector, set once at Hub
 * bootstrap from reconciler.hasTranslations — index.ts). Inert in tests /
 * standalone / ad-hoc kinds (no oracle → no throw), so it can never
 * false-positive on a fixture.
 *
 * Its STRUCTURAL nature (a permanent, retry-won't-fix defect) is what the
 * isolation-catch sites (cascade-replay + message/scheduled sweepers) key on to
 * ESCALATE — ERROR + a queryable `0-bare-violation` alarm (audit + metric) +
 * terminal-quarantine the offending marker — rather than silently
 * isolate-and-retry. Killing that silent-infinite-retry is the cal-84 closure
 * (bug-22 pattern: permanent failure → terminal state, not infinite re-dispatch).
 */
export class BareEnvelopeError extends Error {
  readonly kind: string;
  readonly entityId: string | undefined;
  constructor(kind: string, entityId?: string) {
    super(
      `[substrate] bare-envelope above the membrane: a '${kind}' row reached a ` +
        `consumer STILL enveloped (apiVersion + spec + status.phase co-present) — ` +
        `a decode was skipped or a decoder regressed (cal-84 0-bare detector). ` +
        `entityId=${entityId ?? "(unknown)"}.`,
    );
    this.name = "BareEnvelopeError";
    this.kind = kind;
    this.entityId = entityId;
  }
}

/**
 * The UNAMBIGUOUS full-envelope signature: `apiVersion` present (non-empty
 * string) + `spec` an object + `status` a {phase}-shaped object, ALL co-present.
 *
 * A correctly decoded flat object never has all three: decode strips
 * `apiVersion`, hoists `spec.*` to top-level (deleting the bucket), and projects
 * `status.phase` → a flat top-level `status` STRING. Keying on the CO-PRESENCE
 * (not any single key) avoids false-positives — a flat domain field
 * coincidentally named `kind`, or a flat string `status`, does NOT match.
 */
export function isFullEnvelopeShape(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const hasApiVersion = typeof v.apiVersion === "string" && v.apiVersion.length > 0;
  if (!hasApiVersion) return false;
  const spec = v.spec;
  const hasSpecObject = spec !== null && typeof spec === "object" && !Array.isArray(spec);
  if (!hasSpecObject) return false;
  const status = v.status;
  const hasStatusPhaseObject =
    status !== null &&
    typeof status === "object" &&
    !Array.isArray(status) &&
    typeof (status as Record<string, unknown>).phase === "string";
  return hasStatusPhaseObject;
}

/**
 * Module-level arming — set once at Hub bootstrap (index.ts) from
 * reconciler.hasTranslations. Unset (null) ⇒ the detector is INERT
 * (tests / standalone). Mirror of piece-1's substrate.setPartitionedKindCheck
 * injection, but module-level here because the decode boundary lives in the
 * pure repo decoders (clone* / bespoke normalizers), not on the substrate
 * instance.
 */
let armedKindCheck: ((kind: string) => boolean) | null = null;

/**
 * Arm the bare-envelope detector for production. `check(kind)` reports whether a
 * kind is a known envelope-partitioned domain kind (reconciler.hasTranslations)
 * — only armed kinds throw; everything else (ad-hoc / test kinds) stays inert.
 */
export function armBareEnvelopeDetector(check: (kind: string) => boolean): void {
  armedKindCheck = check;
}

/** Test affordance: restore the inert default (disarm). */
export function disarmBareEnvelopeDetector(): void {
  armedKindCheck = null;
}

/** True when the detector is armed for `kind` (production-wired + partitioned). */
export function isBareEnvelopeDetectorArmed(kind: string): boolean {
  return armedKindCheck !== null && armedKindCheck(kind);
}

/**
 * Assert a decoded repo result is flat (not a bare envelope), throwing
 * BareEnvelopeError when ARMED for `kind` AND the result is a full undecoded
 * envelope. Returns the result UNCHANGED otherwise — inert when unarmed, so it
 * is a transparent pass-through on the test/standalone path. Handles a single
 * object or an array (asserts per element). Non-envelope values pass through
 * (a malformed/corrupt partial row does NOT match the narrow signature → no
 * throw → the decoders' graceful-degrade-to-null still governs bad data).
 */
export function assertDecodedFlat<T>(result: T, kind: string): T {
  if (armedKindCheck === null || !armedKindCheck(kind)) return result;
  if (Array.isArray(result)) {
    for (const el of result) {
      if (isFullEnvelopeShape(el)) {
        throw new BareEnvelopeError(kind, idOf(el));
      }
    }
    return result;
  }
  if (isFullEnvelopeShape(result)) {
    throw new BareEnvelopeError(kind, idOf(result));
  }
  return result;
}

function idOf(value: unknown): string | undefined {
  if (value !== null && typeof value === "object") {
    const id = (value as Record<string, unknown>).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}
