export const meta = {
  name: "cdacc-canary-orchestrator",
  description:
    "CDACC P1 canary injection (plant-wiring orchestrator). Neutral instantiation of co-authored trap patterns at sites NEITHER principal sees + holder verify-reproduce → the sealed plant-diff (4-tuple elem 3) + knownCleanCells. Director-spend-gated to RUN; re-clears architect neutrality review before any real canary run.",
  phases: [
    { title: "P1a-instantiate" },
    { title: "P1b-verify" },
    { title: "P1c-clean-cells" },
  ],
};

// ===========================================================================
// CDACC — P1 CANARY INJECTION (the plant-wiring orchestrator). Concern (B) from
// the thread-661 neutrality review. This is the ONE place plant-sites are
// created, so its neutrality contract is the strictest in the build.
//
// NEUTRALITY CONTRACT (the architect's review checks every line of this):
//   1. BLINDNESS IS BY LOCATION, NOT PATTERN. The principals co-author trap
//      PATTERNS/INTENTS (below); a NEUTRAL instantiation agent with NO AUDIT
//      ROLE places each at a site neither principal pinned + generates variants
//      of BOTH sides so neither can pattern-match its own articulations.
//   2. PLANT-DIFF IS HOLDER-SEALED, NEVER REACHES A FAN-OUT. The plant-diff
//      (the {plantId, site, kind, expectedVerdict} records WITH sites) is THIS
//      script's RETURN — it is handed to the holder's sealed store and is NEVER
//      passed to cdacc.workflow.js. That fan-out's args are {sha, teleSet, mode,
//      spendGo, nonce} — no plant-diff field exists. So plant SITES cannot
//      structurally reach any auditor's prompt.
//   3. GROUND-TRUTH IS HOLDER-VERIFIED. The holder verify-reproduces each plant
//      at plant-time (real → reproduces FAIL; fp → runs-correct-despite-looking-
//      broken) before recording its expected verdict — an unverified plant is
//      dropped, never trusted (this is the same reproduced-tier discipline the
//      audit owes, applied to the canary itself).
//   4. NON-GREPPABLE. Every instantiated plant + variant must be non-greppable
//      so pattern-knowledge cannot collapse into location-knowledge.
//
// RUN-GATE: running this (it spawns the instantiator + verify agents) is part of
// the Director-spend-gated full-sweep sequence — args.spendGo === true required,
// same as cdacc.workflow.js runFull(). Building it (this file) needs no spawn.
//
// args: { sha, spendGo, variantsPerPattern?, patterns? (override the catalog) }
// ===========================================================================

const FROZEN_SHA = (args && args.sha) || "a5af88a";
const VARIANTS_PER_PATTERN = (args && args.variantsPerPattern) || 1;

// Reproduced-tier fidelity guard (mirrors cdacc.workflow.js; pre-flight finding
// wf_cb495375-9bd) — the holder's verify-reproduce MUST be production-faithful.
const HARNESS_FIDELITY =
  "REPRODUCED-TIER FIDELITY (mandatory): stand up a postgres testcontainer from the frozen SHA and wire substrate.setWriteEncoder(buildEnvelopeWriteEncoder()) exactly as hub/src/index.ts:158 + start the SchemaDef reconciler for the kinds under test. A substrate WITHOUT the encoder silently stores FLAT rows — verification built that way is a false negative. Confirm the raw row is a genuine envelope before trusting a reproduced result.";

// ── The co-authored trap catalog (thread-660/661) ──────────────────────────
// Patterns/INTENTS only — NO sites. Sites are chosen by the neutral instantiator
// at run-time and never recorded here. ~60/40 real:fp across the instantiated
// set (variants balance the ratio; the holder confirms the final mix).
const PATTERN_CATALOG = [
  // engineer-authored real-bug signatures (reproduced-tier)
  { id: "R-relocated-read", kind: "real", altitude: "code", intent: "a fresh consumer reads a relocated field directly off a raw envelope row (bypassing decodeEnvelopeToFlat) → undefined / {phase} object at runtime (bug-138 shape). Reproduced-tier only." },
  { id: "R-missing-renameMap", kind: "real", altitude: "code", intent: "a relocated field with NO renameMap filter-translate entry → a list-filter on it silently returns empty/wrong; traces fine, reproduces empty." },
  { id: "R-cas-stale-reenvelope", kind: "real", altitude: "code", intent: "a CAS transform mutates the flat shape but the write-encoder re-envelopes a stale field → round-trip drift; only write-then-read reproduction catches it." },
  // engineer-authored false-positive trap (precision, not recall)
  { id: "FP-reads-broken-runs-correct", kind: "fp", altitude: "code", intent: "code that READS broken on a static read (asserted-FAIL) but is correct at runtime (reproduced-PASS). Flagging it = a measured over-claim." },
  // architect-authored spec-interpretation FP intents (each tests a cross-tele composition)
  { id: "FP-sanctioned-derived-cache", kind: "fp", altitude: "spec", intent: "tele-1: an in-process cache that strict-reads as private/transient truth (tele-1 FAIL) but is a rebuildable non-authoritative projection (authoritative state is in the backplane; cache is a tele-11/12 hydration optimization)." },
  { id: "FP-genuine-judgment", kind: "fp", altitude: "spec", intent: "tele-11: an LLM invocation that strict-reads as LLM-as-calculator (tele-11 FAIL) but is irreducible judgment/ambiguity (correctly on the cognitive side of the boundary)." },
  { id: "FP-documented-forward-spec", kind: "fp", altitude: "spec", intent: "tele-2: a spec describing a ratified-but-not-yet-built capability, marked planned, that strict-reads as doc↔code drift (tele-2 FAIL) but is intentional spec-leads-code (manifest-is-master), not drift." },
  { id: "FP-precision-projection", kind: "fp", altitude: "spec", intent: "tele-4: an LLM-facing artifact that strict-reads as summarization=loss (tele-4 FAIL) but is a tele-12 precision-engineered projection of a full zero-loss source." },
  // pre-existing live plant (architect-planted in the snapshot; instantiator SKIPS it,
  // holder includes it in ground-truth for recall scoring).
  { id: "R-tele0-umbrella-staleness", kind: "real", altitude: "spec", preExisting: true, intent: "tele-0 umbrella enumerates its constituents as 'tele-1 through tele-10', omitting tele-11/12 — a real spec-internal drift already live in the frozen tele-data-dump." },
];

const INSTANTIATOR_GUARD =
  "You are the NEUTRAL canary INSTANTIATOR. You have NO AUDIT ROLE — you will never audit this snapshot and your placements are revealed to NEITHER principal. Choose a plausible site at the frozen SHA that is NOT an obvious/pinned location; make the plant NON-GREPPABLE (no marker comments, no telltale identifiers). For a REAL plant, wire it into a live runtime path so it genuinely reproduces its failure. For an FP plant, make it look violated on a strict read but actually correct at runtime. Return placements with sites — these go ONLY to the holder.";

const PLACEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    patternId: { type: "string" },
    placements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          plantId: { type: "string" },
          kind: { enum: ["real", "fp"] },
          altitude: { enum: ["code", "spec"] },
          site: { type: "string" },
          expectedVerdict: { enum: ["FAIL", "PASS", "PARTIAL"] },
          howWired: { type: "string" },
          greppableRisk: { type: "string" },
        },
        required: ["plantId", "kind", "site", "expectedVerdict", "howWired"],
      },
    },
  },
  required: ["patternId", "placements"],
};

const VERIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    plantId: { type: "string" },
    verified: { type: "boolean" },
    observedVerdict: { enum: ["FAIL", "PASS", "PARTIAL", "INCONCLUSIVE"] },
    expectedVerdict: { enum: ["FAIL", "PASS", "PARTIAL"] },
    evidence: { type: "array", items: { type: "string" } },
  },
  required: ["plantId", "verified", "observedVerdict", "expectedVerdict"],
};

async function run() {
  if (!(args && args.spendGo === true)) {
    log("Canary orchestrator BLOCKED: args.spendGo !== true. Instantiation spawns agents (instantiator + holder verify) and is part of the Director-spend-gated full-sweep sequence. Aborting without spend.");
    return { blocked: true, reason: "no Director spend-go", patternsReady: PATTERN_CATALOG.length };
  }

  const toPlant = PATTERN_CATALOG.filter((p) => !p.preExisting);
  log(`P1 canary injection — ${toPlant.length} patterns to instantiate (+${VARIANTS_PER_PATTERN} variant(s) each) on frozen SHA ${FROZEN_SHA}. tele-0 umbrella-staleness is pre-existing (not re-planted).`);

  // P1a — neutral instantiation (pipeline; each pattern instantiated + verified
  // independently). The instantiator NEVER sees a principal's audit; the holder
  // verify NEVER reveals sites back to a principal.
  const plantDiff = await pipeline(
    toPlant,
    // P1a: instantiate pattern -> placements (with sites)
    (pattern) =>
      agent(
        `${INSTANTIATOR_GUARD} Pattern ${pattern.id} (${pattern.kind}/${pattern.altitude}): ${pattern.intent} ` +
          `Instantiate it once + ${VARIANTS_PER_PATTERN} variant(s) at DIFFERENT sites/kinds with the same over-claim/degradation shape (so neither principal can pattern-match their own articulation).`,
        { schema: PLACEMENT_SCHEMA, phase: "P1a-instantiate", label: `plant:${pattern.id}`, effort: "high" }
      ),
    // P1b: holder verify-reproduce each placement; drop the unverified.
    (placed, pattern) => {
      if (!placed || !placed.placements) return null;
      return parallel(
        placed.placements.map((pl) => () =>
          agent(
            `HOLDER verify-reproduce (NO audit role). Plant ${pl.plantId} at ${pl.site}, expected ${pl.expectedVerdict} (${pl.kind}). ` +
              `Confirm by reproduction: a REAL plant must reproduce FAIL; an FP plant must run-correct despite looking violated. ${HARNESS_FIDELITY} ` +
              `Return verified=false if you cannot reproduce the expected verdict — an unverified plant is dropped, never trusted.`,
            { schema: VERIFY_SCHEMA, phase: "P1b-verify", label: `verify:${pl.plantId}`, effort: "high" }
          ).then((v) => (v ? { ...pl, patternId: pattern.id, verify: v } : null))
        )
      );
    }
  );

  const verified = plantDiff
    .filter(Boolean)
    .flat()
    .filter(Boolean)
    .filter((p) => p.verify && p.verify.verified === true);

  // P1c — knownCleanCells: holder derives a set of sites known to carry NO plant
  // AND to be correctly clean, for mechanical precision scoring (SoD invariant
  // iv). Derived by the holder, never principal-sourced.
  phase("P1c-clean-cells");
  const plantSites = verified.map((p) => p.site);
  const cleanCells = await agent(
    `HOLDER (no audit role): derive ~${Math.max(4, verified.length)} knownCleanCells — sites at the frozen SHA that carry NO canary plant AND are correctly clean (a flag on one is a mechanical false-positive). EXCLUDE these plant sites: ${JSON.stringify(plantSites)}. Verify each is genuinely clean. Return {knownCleanCells: string[]}.`,
    { schema: { type: "object", additionalProperties: false, properties: { knownCleanCells: { type: "array", items: { type: "string" } } }, required: ["knownCleanCells"] }, phase: "P1c-clean-cells", effort: "medium" }
  );

  // RETURN = the sealed plant-diff + knownCleanCells. Handed to the holder store.
  // NEVER passed to cdacc.workflow.js (the fan-out). See neutrality contract #2.
  const realCount = verified.filter((p) => p.kind === "real").length;
  const fpCount = verified.filter((p) => p.kind === "fp").length;
  log(`P1 complete: ${verified.length} verified plants (${realCount} real / ${fpCount} fp) + tele-0 pre-existing real. Ratio ~${Math.round((realCount + 1) / (verified.length + 1) * 100)}/${Math.round(fpCount / (verified.length + 1) * 100)} real:fp.`);
  return {
    sha: FROZEN_SHA,
    sealedTo: "holder-store (NEVER to cdacc.workflow.js)",
    plantDiff: verified, // includes sites — holder-held ground truth
    preExistingPlants: PATTERN_CATALOG.filter((p) => p.preExisting),
    knownCleanCells: (cleanCells && cleanCells.knownCleanCells) || [],
    droppedUnverified: plantDiff.filter(Boolean).flat().filter((p) => p && (!p.verify || !p.verify.verified)).map((p) => p && p.plantId),
  };
}

const out = await run();
log("CDACC canary orchestrator complete.");
return out;
