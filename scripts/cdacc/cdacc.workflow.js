export const meta = {
  name: "cdacc-engineer-fanout",
  description:
    "CDACC engineer-altitude (code/reality) P2 fan-out + holder orchestration skeleton. PREFLIGHT mode = ~5-agent harness self-test; FULL mode = per-tele sweep (Director-spend-go gated).",
  phases: [
    { title: "Preflight" },
    { title: "P2a-classify" },
    { title: "P2b-evidence" },
    { title: "P2c-completeness" },
    { title: "P2d-seal" },
  ],
};

// ===========================================================================
// CDACC — engineer-altitude (code/reality = TERRITORY) fan-out.
//
// This is the ENGINEER's sovereign construction (doc §B.4.1 contract-vs-
// construction). The only thing it owes the council is the shared VERDICT
// schema below; everything else (decomposition, prompts, harness) is mine.
//
// What this script does (the agent orchestration):
//   - PREFLIGHT: self-seed a KNOWN probe, run the fan-out on it, prove the
//     harness can actually reach `reproduced` tier — BEFORE any real spend.
//     This is the "pre-flight doubles as a holder self-test" milestone
//     (thread-661); the SCORING half is proven separately + deterministically
//     by scripts/cdacc/holder/gate-logic.test.js.
//   - FULL: the ~100-160-agent per-tele sweep. HARD-GATED on args.spendGo ===
//     true (the Director's explicit spend-go, doc §B.11) — defense in depth so
//     the big spend cannot fire by accident.
//
// What this script does NOT do (deliberately — SoD, thread-661):
//   - It does NOT score recall/precision and it does NOT classify cells. Those
//     are the holder's deterministic, inspectable, unit-tested gate-logic
//     (scripts/cdacc/holder/gate-logic.js), run OUTSIDE the Workflow sandbox
//     over the returned verdict-vectors. Keeping the scorer out of the agent
//     orchestration is what makes "fixed/inspectable scoring arithmetic" true.
//   - It does NOT see the canary plant-diff. The fan-out queries the SNAPSHOT
//     only; the plant ground-truth lives with the holder and never enters here.
//
// args (JSON passed to Workflow):
//   { mode: "preflight" | "full",
//     sha: "a5af88a",                 // frozen code-SHA (4-tuple elem 1)
//     teleSet: ["tele-0", ...],       // frozen tele-data-dump (4-tuple elem 2)
//     spendGo: false,                 // Director spend-go (FULL only)
//     nonce: "<>=8 chars>" }          // commit-reveal nonce for the seal
// ===========================================================================

const FROZEN_SHA = (args && args.sha) || "a5af88a";
const MODE = (args && args.mode) || "preflight";
const TELE_SET = (args && args.teleSet) || [];
const NONCE = (args && args.nonce) || "cdacc-preflight-nonce";

// ── Shared contract: the per-cell verdict schema (doc §B.4 P0) ─────────────
// The ONE thing both altitudes must honor so two independent audits are
// comparable. Note `blastRadius` — the reachability trace the materiality dial
// consumes (doc §B.6), and `findings[]` — what the holder matches against the
// canary plant ground-truth to score recall/precision.
const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tele: { type: "string" },
    verdict: { enum: ["PASS", "PARTIAL", "FAIL", "UNAUDITED", "UNAUDITED-at-bar"] },
    evidenceTier: { enum: ["asserted", "traced", "tested", "reproduced"] },
    evidence: { type: "array", items: { type: "string" } },
    severity: { enum: ["none", "low", "medium", "high", "critical"] },
    blastRadius: {
      type: "string",
      description:
        "reachability trace: consumer-count / call-sites / entity-kinds touched (materiality input, NOT local symptom)",
    },
    remediation: { type: "string" },
    selfConfidence: { type: "number" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          site: { type: "string" }, // file:line — matched to plant sites by the holder
          kind: { type: "string" },
          reproduced: { type: "boolean" },
        },
        required: ["site", "kind"],
      },
    },
  },
  required: ["tele", "verdict", "evidenceTier", "evidence", "findings"],
};

const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tele: { type: "string" },
    teleClass: { enum: ["behavioral", "structural", "methodology"] },
    requiredTier: { enum: ["asserted", "traced", "tested", "reproduced"] },
    harness: { enum: ["schema-decode", "chaos-injection", "incident-replay", "metric-observation", "none"] },
    inWindow: { type: "boolean" },
    candidateSurfaces: { type: "array", items: { type: "string" } },
  },
  required: ["tele", "teleClass", "requiredTier", "candidateSurfaces"],
};

// The falsifier discipline, stated once and injected into every evidence agent.
const FALSIFIER_BAR = [
  "PROOF-BAR (code altitude, doc §B.6): tier ladder asserted < traced < tested < reproduced.",
  "A behavioral verdict CANNOT exceed traced-confidence without REPRODUCTION (probe vs a testcontainer built from the frozen SHA).",
  "A behavioral PASS at asserted/traced => downgrade to PARTIAL(tier-flagged). A behavioral FAIL at asserted => it is a HYPOTHESIS (route to tie-break), never a sealed FAIL.",
  "A verdict that cannot reach its required tier is UNAUDITED-at-bar, NOT FAIL. Never conflate 'couldn't reproduce' with 'fails' — that poisons canary precision.",
  "For every finding, record blastRadius as a REACHABILITY trace (consumers/call-sites/kinds), not the local symptom.",
].join(" ");

// ── P2 fan-out for ONE tele (the engineer pipeline P2a -> P2d) ─────────────
async function auditTele(tele, phasePrefix) {
  // P2a — classify (cheap): class + required-tier + harness + candidate surfaces.
  const cls = await agent(
    `CDACC engineer-altitude P2a. Frozen SHA ${FROZEN_SHA}. Classify ${tele} for the CODE/reality audit: ` +
      `is it behavioral (a runtime guard/transform/filter), structural (a code-shape invariant), or methodology (a practice)? ` +
      `State its required evidence tier and the reproducing harness {schema-decode|chaos-injection|incident-replay|metric-observation|none} ` +
      `and whether that harness is reachable in-window. List candidate code surfaces (files/functions/tests) to inspect.`,
    { schema: CLASSIFY_SCHEMA, phase: `${phasePrefix}a-classify`, effort: "low" }
  );
  if (!cls) return null;

  // P2b — gather evidence, climbing the tier ladder until the bar is hit or
  // exhausted, then adversarial-verify (breaker, default-to-refuted).
  const verdict = await agent(
    `CDACC engineer-altitude P2b. Frozen SHA ${FROZEN_SHA}. Audit ${tele} (class=${cls.teleClass}, required-tier=${cls.requiredTier}, harness=${cls.harness || "n/a"}). ` +
      `Candidate surfaces: ${(cls.candidateSurfaces || []).join(", ")}. ` +
      `Climb the evidence ladder only as far as the required tier: read -> trace the call-path/data-flow -> run/cite a test -> reproduce via the harness. ` +
      `Then adversarially self-verify: try to REFUTE your own verdict; default to refuted if uncertain. ` +
      FALSIFIER_BAR +
      ` Emit the verdict-vector for ${tele}.`,
    { schema: VERDICT_SCHEMA, phase: `${phasePrefix}b-evidence`, effort: "high" }
  );
  return verdict;
}

// ===========================================================================
// PREFLIGHT — ~5-agent harness self-test (the spend-gate's left half).
// Self-seed a KNOWN probe (engineer-authored, NOT the neutral canary) and
// confirm the fan-out can actually reach `reproduced` tier on this codebase.
// If it can't, the full sweep is broken BEFORE we spend — fail fast.
// ===========================================================================
async function runPreflight() {
  phase("Preflight");
  log(`CDACC PREFLIGHT — harness self-test on frozen SHA ${FROZEN_SHA} (no canary, no real teles).`);

  // A self-seeded probe of the bug-138 signature: does the fan-out reproduce a
  // relocated-field-read-off-a-raw-envelope returning undefined at runtime?
  const PROBE =
    "SELF-SEEDED PROBE (not a real tele, not the canary). In a scratch testcontainer built from the frozen SHA, " +
    "construct a minimal consumer that reads a relocated field directly off a RAW envelope row (bypassing decodeEnvelopeToFlat) " +
    "and prove by REPRODUCTION whether it returns undefined / a {phase} object at runtime. " +
    "Report evidenceTier honestly: you only earn 'reproduced' if you actually ran it.";

  const results = await parallel([
    () => agent(`${PROBE} ${FALSIFIER_BAR}`, { schema: VERDICT_SCHEMA, phase: "Preflight", label: "probe:reproduce", effort: "high" }),
    () => agent(`${PROBE} Take the SKEPTIC stance — attempt to show the probe does NOT reproduce. ${FALSIFIER_BAR}`, { schema: VERDICT_SCHEMA, phase: "Preflight", label: "probe:refute", effort: "high" }),
    () => agent(
      "CDACC PREFLIGHT harness check: confirm the testcontainers integration harness is reachable from the frozen SHA " +
        "(hub/src/storage-substrate/__tests__) and report whether a fresh ephemeral-postgres probe can be stood up. Tier = reproduced only if you stood one up.",
      { schema: VERDICT_SCHEMA, phase: "Preflight", label: "probe:harness", effort: "medium" }
    ),
  ]);

  const got = results.filter(Boolean);
  const anyReproduced = got.some((r) => r.evidenceTier === "reproduced");
  log(`PREFLIGHT: ${got.length}/3 probe agents returned; reproduced-tier reached = ${anyReproduced}.`);

  // The verdict on the harness itself (NOT an audit verdict) — does the fan-out
  // reach reproduced tier? The holder self-test (gate-logic.test.js) proves the
  // SCORING half separately and deterministically.
  return {
    mode: "preflight",
    sha: FROZEN_SHA,
    harnessReachesReproduced: anyReproduced,
    probeResults: got,
    note:
      "Scoring half of the holder self-test = `node --test scripts/cdacc/holder/*.test.js` (deterministic, zero spend).",
  };
}

// ===========================================================================
// FULL — the per-tele sweep. HARD-GATED on the Director's explicit spend-go.
// ===========================================================================
async function runFull() {
  if (!(args && args.spendGo === true)) {
    log("FULL sweep BLOCKED: args.spendGo !== true. The full ~100-160-agent sweep requires the Director's explicit spend-go (doc §B.11). Aborting without spend.");
    return { mode: "full", blocked: true, reason: "no Director spend-go" };
  }
  if (!TELE_SET.length) {
    log("FULL sweep BLOCKED: empty teleSet (the frozen tele-data-dump must be passed in). Aborting.");
    return { mode: "full", blocked: true, reason: "empty teleSet" };
  }

  log(`CDACC FULL engineer-altitude sweep — ${TELE_SET.length} teles on frozen SHA ${FROZEN_SHA}. Spend-go confirmed.`);
  // pipeline: each tele flows P2a->P2b independently (no barrier); P2c/P2d below.
  const verdicts = await pipeline(
    TELE_SET,
    (tele) => auditTele(tele, "P2")
  );

  // P2c — completeness-critic over the whole sweep (one barrier here is correct:
  // "what tele×component cells did we not reach?" needs all verdicts at once).
  phase("P2c-completeness");
  const reached = verdicts.filter(Boolean);
  const completeness = await agent(
    `CDACC P2c completeness-critic. Frozen SHA ${FROZEN_SHA}. Here are ${reached.length}/${TELE_SET.length} engineer-altitude verdicts: ` +
      `${JSON.stringify(reached.map((v) => ({ tele: v.tele, verdict: v.verdict, tier: v.evidenceTier })))}. ` +
      `Name every tele that is missing or under-reached (below its required tier). Output the UNAUDITED ledger — never a silent blank.`,
    { schema: { type: "object", additionalProperties: true, properties: { unaudited: { type: "array", items: { type: "string" } }, underReached: { type: "array", items: { type: "string" } } }, required: ["unaudited"] }, phase: "P2c-completeness", effort: "medium" }
  );

  // P2d — seal: the verdict-vectors are returned for the holder to commit-reveal
  // + integrity-pin (gate-logic.js) and for a seal sub-agent to create_document.
  // (Cross-principal commit-reveal coordination is mediated by the holder across
  // BOTH principals' runs — see scripts/cdacc/README.md.)
  phase("P2d-seal");
  return {
    mode: "full",
    sha: FROZEN_SHA,
    nonce: NONCE,
    verdicts: reached,
    completeness,
    sealNote:
      "Holder (gate-logic.js) computes the content-free commitment per verdict-vector, registers it, and only reveals after BOTH principals' commitments exist; then pins (hash, resourceVersion, updatedAt).",
  };
}

// ── entry ──────────────────────────────────────────────────────────────────
const out = MODE === "full" ? await runFull() : await runPreflight();
log(`CDACC engineer-fanout (${MODE}) complete.`);
return out;
