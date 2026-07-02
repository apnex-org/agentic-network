/**
 * filterable-keys-drift-gate.test.ts — C3-R4a (M-Shape-Conformance), the
 * renameMap-governor's STATIC half.
 *
 * Derives the substrate-filterable keys from the LIVE call-sites
 * (derive-filterable-keys.ts, a ts-morph scan of hub/src) and asserts the
 * committed reviewed map (conformance/filterable-keys.ts) agrees — so a new
 * filter on a partition-relocated field can NEVER silently skip its renameMap
 * entry (the bug-138 / bug-170 silent-filter-miss class). This replaces the
 * hand-curated bound with a code-derived, drift-gated one.
 *
 *   Gate A — no silent new INLINE key: every statically-derived flat
 *     (non-bucket-prefixed) key is in SUBSTRATE_FILTERABLE_KEYS.
 *   Gate B — no silent new DYNAMIC site: every scanner-flagged call-site (a
 *     helper-built / spread / parametric filter, or a generic kind arg) is
 *     acknowledged in ANNOTATED_FILTER_SITES — closing the static-scan
 *     false-negative the design names (flag, never silently drop).
 *   Gate C — annotations are honest: every key an annotated site claims to
 *     contribute is itself in SUBSTRATE_FILTERABLE_KEYS.
 *
 * W1.1c (renamemap-contract-w1.test.ts) then proves each committed key is
 * renameMap-covered / documented-excluded / unmoved; the testcontainers
 * value-round-trip oracle (filter-roundtrip-oracle.test.ts) is the BEHAVIORAL
 * backstop for keys the static scan cannot reach (helper-built / parametric).
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { scanFilterableKeys } from "../conformance/derive-filterable-keys.js";
import {
  SUBSTRATE_FILTERABLE_KEYS,
  ANNOTATED_FILTER_SITES,
  isBucketPrefixed,
} from "../conformance/filterable-keys.js";

// __dirname = hub/src/storage-substrate/__tests__ → hub/ is three up.
const HUB_ROOT = join(__dirname, "..", "..", "..");
const scan = scanFilterableKeys(HUB_ROOT);
const baseName = (p: string): string => p.split("/").pop() ?? p;

describe("C3-R4a renameMap-governor — filterable-keys drift-gate (static call-site scan)", () => {
  it("the scan is actually wired (found filter call-sites across multiple kinds)", () => {
    expect(Object.keys(scan.keys).length).toBeGreaterThan(5);
  });

  it("Gate A: every statically-derived inline flat key is in SUBSTRATE_FILTERABLE_KEYS", () => {
    const violations: string[] = [];
    for (const [kind, keys] of Object.entries(scan.keys)) {
      for (const key of keys) {
        // Bucket-prefixed (metadata./spec./status.) = an already-translated
        // envelope path (envelope-first dotted query) — filter-safe by
        // construction; the round-trip oracle verifies it behaviorally.
        if (isBucketPrefixed(key)) continue;
        if (!(SUBSTRATE_FILTERABLE_KEYS[kind] ?? []).includes(key)) {
          violations.push(`${kind}.${key}`);
        }
      }
    }
    expect(
      violations,
      `call-sites filter/sort by these keys but they are NOT in SUBSTRATE_FILTERABLE_KEYS — add them to conformance/filterable-keys.ts (and ensure renameMap coverage; W1.1c will check): ${violations.join(", ")}`,
    ).toEqual([]);
  });

  it("Gate B: every dynamic (un-derivable) call-site is acknowledged in ANNOTATED_FILTER_SITES", () => {
    const unacknowledged = scan.dynamicSites
      .filter(
        (s) =>
          !ANNOTATED_FILTER_SITES.some(
            (a) => a.file === baseName(s.file) && a.kind === s.kind && a.reason === s.reason,
          ),
      )
      .map((s) => `${baseName(s.file)} | kind=${s.kind} | ${s.reason}  (${s.detail})`);
    expect(
      unacknowledged,
      "NEW dynamic filter call-site(s) the scanner cannot enumerate statically — acknowledge each in ANNOTATED_FILTER_SITES (conformance/filterable-keys.ts) with the keys it contributes, so a helper/spread/parametric filter can never hide a relocated key",
    ).toEqual([]);
  });

  it("Gate C: every key an annotated dynamic site claims is in SUBSTRATE_FILTERABLE_KEYS", () => {
    const orphans: string[] = [];
    for (const site of ANNOTATED_FILTER_SITES) {
      if (site.kind === null) continue; // generic/infra site — contributes no domain keys
      for (const key of site.keys) {
        if (!(SUBSTRATE_FILTERABLE_KEYS[site.kind] ?? []).includes(key)) {
          orphans.push(`${site.file}:${site.kind}.${key}`);
        }
      }
    }
    expect(
      orphans,
      `ANNOTATED_FILTER_SITES claim keys absent from SUBSTRATE_FILTERABLE_KEYS (annotation drift): ${orphans.join(", ")}`,
    ).toEqual([]);
  });
});
