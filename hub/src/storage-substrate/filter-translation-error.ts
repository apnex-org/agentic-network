/**
 * filter-translation-error.ts — C3-R4b (M-Shape-Conformance), piece 1.
 *
 * FilterTranslationGapError: thrown at the FILTER-TRANSLATE path (the substrate's
 * translateKey) when a known envelope-partitioned kind is filtered/sorted by a
 * domain key that the encoder buckets (spec/metadata by default — see
 * encodeEnvelope/pickPartition) but renameMap does NOT cover. A bare-path JSONB
 * query for such a key would silently MISS rows (the bug-138 / bug-170
 * silent-filter-miss class). Fail-loud at TRANSLATE, not at decode: decode's
 * flat-spread recovers same-name relocations, so the gap is invisible at decode;
 * the miss is at filter-translate (wrong JSONB path).
 *
 * The R4a drift-gate catches this STATICALLY at CI; this is the runtime
 * belt-and-suspenders. It is wired in production only (index.ts wires
 * setPartitionedKindCheck) — left inert in tests/standalone (no partitioned-kind
 * oracle wired → no throw), so it can never false-positive on an ad-hoc kind.
 */
export class FilterTranslationGapError extends Error {
  readonly kind: string;
  readonly bareKey: string;
  constructor(kind: string, bareKey: string) {
    super(
      `[substrate] filter-translation gap: kind='${kind}' field='${bareKey}' is an ` +
        `envelope-partitioned domain field with NO renameMap entry — a bare-path query ` +
        `would silently miss. Add '${bareKey}' to ${kind}'s renameMap (all-schemas.ts) ` +
        `+ conformance/filterable-keys.ts (C3-R4 renameMap-governor).`,
    );
    this.name = "FilterTranslationGapError";
    this.kind = kind;
    this.bareKey = bareKey;
  }
}

/** Envelope top-level reserved fields (legitimately queryable at the bare path). */
const RESERVED_TOP_LEVEL = new Set(["id", "name", "kind", "apiVersion"]);
/** Already-translated envelope JSONB path prefixes (a caller-supplied dotted path). */
const BUCKET_PREFIXES = ["metadata.", "spec.", "status."];

/**
 * True for a key that is legitimately queryable WITHOUT a renameMap entry: an
 * envelope top-level reserved field, or an already-translated (bucket-prefixed)
 * path. Any OTHER key on a partitioned kind is a domain field the encoder
 * bucketed → it MUST have a renameMap entry, else the query mis-paths.
 */
export function isReservedOrBucketKey(key: string): boolean {
  return RESERVED_TOP_LEVEL.has(key) || BUCKET_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Translate a flat filter/sort key to its envelope JSONB path, throwing
 * FilterTranslationGapError when a known-partitioned kind's domain key has no
 * translation (the silent-miss gap). `lookup` returns the renameMap target or
 * null. `isPartitionedKind` reports whether the kind is a known envelope-
 * partitioned domain kind — only then is a null translation a gap (an unknown /
 * ad-hoc kind is left inert: the bare key passes through unchanged, as before).
 */
export function translateKeyOrThrow(
  kind: string,
  bareKey: string,
  lookup: (kind: string, bareKey: string) => string | null,
  isPartitionedKind: (kind: string) => boolean,
): string {
  const translated = lookup(kind, bareKey);
  if (translated != null) return translated;
  if (isPartitionedKind(kind) && !isReservedOrBucketKey(bareKey)) {
    throw new FilterTranslationGapError(kind, bareKey);
  }
  return bareKey;
}
