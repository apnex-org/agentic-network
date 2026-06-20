# CDACC — engineer-altitude build (first run)

Construction artifacts for **CDACC** (Calibrated Dual-Altitude Conformance
Council) — see the methodology doc `docs/methodology/cdacc-dual-altitude-conformance-council.md`.
This directory is the **engineer altitude's sovereign construction** (doc §B.4.1):
the code/reality fan-out + the holder. It owes the council only the shared
**verdict schema**; everything else (decomposition, prompts, harness) is ours.

Frozen snapshot for the first run (4-tuple, doc §B.5):
1. **code-SHA** = `a5af88a` (merged main HEAD; CDACC design is on main).
2. **tele-data-dump** = `tele-0 .. tele-12` (13 teles; tele-13 ratified-but-not-
   instantiated → out of this run's set). Held artifact, architect-pinned.
3. **canary-plant-diff** — held by the holder (co-authored; see below).
4. **holder-gate-logic** — `holder/gate-logic.js` (this dir), pinned so a later
   run can diff it and confirm the instrument didn't change.

## Layout

| Path | What | Trust role |
|---|---|---|
| `holder/gate-logic.js` | Deterministic holder gates: commit-reveal, integrity-pin, cell-classify (P4), canary recall/precision (P5), resolved/forwarded ratio (P7), quality-floor policy. | **The inspectable core** (4-tuple elem 4). Pure, no Hub/FS/net. |
| `holder/gate-logic.test.js` | Holder self-test (scoring half). Deterministic, **zero spend**. | Proves the scorer is correct on KNOWN probes before it scores the real canary. |
| `cdacc.workflow.js` | Engineer-altitude P2 fan-out + holder orchestration (Workflow script). PREFLIGHT + FULL modes. | The agent orchestration. |

## Holder neutrality — the three SoD invariants (architect reviews these)

The holder is the only component that knows the canary plant-locations **and**
runs the orchestration. That concentration is acceptable for v1 **iff** all three
hold (thread-661). The architect's neutrality review checks them here:

1. **No audit verdict.** `gate-logic.js` decides no tele's PASS/FAIL. It only runs
   mechanical gates + arithmetic; the audit verdicts are produced by the two
   fan-outs and consumed here as data. (Inspect: there is no model call, no
   verdict assignment, anywhere in `gate-logic.js`.)
2. **Plant-diff sealed from the fan-outs.** The canary ground-truth is an argument
   to `scoreCanary()` only — it never enters `cdacc.workflow.js`. The fan-out
   sub-agents query the **snapshot**, never the holder. (Inspect: `cdacc.workflow.js`
   never imports or references the plant-diff.)
3. **Fixed / inspectable scoring.** The arithmetic is pure + deterministic + unit-
   tested — it cannot selectively credit one principal. (Inspect: `gate-logic.test.js`
   pins exact recall/precision on a known probe set.)
4. **Precision ground-truth is holder-held** (added thread-661 concern C). `scoreCanary`'s
   known-clean-cell set — the basis on which a non-plant flag counts as a false-positive —
   MUST come from the holder / a neutral adjudication source, **never a principal-aligned
   party**. So **recall is fully mechanical; precision is mechanical only over the
   adjudicated set** (plants ∪ known-clean). A flag on any other cell is an
   `unadjudicatedFlag` and sets `precisionProvisional` — reported, never silently scored.
   For run-1 (diagnostic floors) precision ships flagged-provisional; the cross-principal
   orchestrator that supplies the known-clean set lands on its own branch and re-clears
   this same neutrality review before the real canary run.

Temporal separation reinforces it: instantiation = **P1** (pre-pin), scoring =
**P5** (post-seal) — different phases of the same deterministic logic.

## Running it

**Holder self-test (scoring) — deterministic, no spend, run anytime:**
```
node --test 'scripts/cdacc/holder/*.test.js'
```

**Fan-out pre-flight (the spend-gate's left half) — ~5 agents, harness self-test:**
Run via the Workflow tool (engineer-driven):
```
Workflow({ scriptPath: "scripts/cdacc/cdacc.workflow.js",
           args: { mode: "preflight", sha: "a5af88a", nonce: "<>=8 chars>" } })
```
Proves the fan-out can actually reach `reproduced` tier (testcontainer-from-SHA)
before any real spend. Pairs with the deterministic scorer self-test above.

**Full sweep — ~100-160 agents — HARD-GATED:**
```
Workflow({ scriptPath: "scripts/cdacc/cdacc.workflow.js",
           args: { mode: "full", sha: "a5af88a", teleSet: [...], spendGo: true, nonce: "..." } })
```
`runFull()` aborts without spend unless `args.spendGo === true` — the Director's
explicit spend-go (doc §B.11). Defense in depth: the gate is in the script, not
just the process.

## The verdict-schema contract (the one shared interface)

`VERDICT_SCHEMA` in `cdacc.workflow.js` is the bit-perfect interface that makes
two independent audits comparable. Note two load-bearing fields:
- **`evidenceTier`** ∈ asserted < traced < tested < reproduced — the code-side
  proof-bar (doc §B.6). Behavioral PASS below `reproduced` → PARTIAL; behavioral
  FAIL below `reproduced` → hypothesis (tie-break), never sealed FAIL; can't-reach-
  tier → UNAUDITED-at-bar, NOT FAIL.
- **`blastRadius`** — the reachability trace (consumers / call-sites / kinds), the
  materiality-dial input. Materiality is scored on reach, **not** the local symptom
  (doc §B.6) — bug-138 was "one field returns undefined" locally but catastrophic
  by reach.

## Canary co-authorship (engineer half)

Blindness lives in **LOCATION, not PATTERN** (thread-661): principals author trap
**patterns/intents**; a neutral instantiation sub-agent places them at sites
neither principal can see and wires them into a live runtime path; the holder
verify-reproduces each plant and records the expected verdict.

Engineer-authored patterns for the neutral instantiator (~60/40 real:fp, doc §B.11):
- **real-bug:** relocated-field read off a raw envelope in a fresh consumer
  (bug-138 shape — reads fine, undefined at runtime; reproduced-tier only).
- **real-bug:** a missing `renameMap` filter-translate entry (list-filter silently
  wrong; traces fine, reproduces empty).
- **real-bug:** a CAS transform that re-envelopes a stale field (round-trip drift;
  only write-then-read reproduction catches it).
- **fp-trap:** code that READS broken (asserted-FAIL) but is correct at runtime
  (reproduced-PASS) — punishes over-claiming; measures precision, not just recall.

Discipline: every pattern must be **non-greppable** so pattern-knowledge can't
collapse into location-knowledge. (The architect brings the spec-interpretation-FP
intents.)
