# CDACC run-2 — code-real canary plants (engineer half, DRAFT)

My half of the joint canary (#3 / drift-map §7.3). PATTERNS/INTENTS only — **no sites**
(the neutral instantiator picks sites neither principal sees + generates variants; blindness
lives in LOCATION not PATTERN). All are the **bug-137/138 silently-wrong-read class**: a
consumer touches a relocated field without the proper decode/encode/translate, compiles via
an inline flat type, and degrades only at runtime — so each is **reproduced-tier** and
**non-greppable** (no marker comments / telltale identifiers).

Run-1 had 3 code-real patterns (all missed — a *reach* failure). Run-2 widens to 8 across
the full consumer surface, to validate the #2 structural sweep's **generality** (not just
the run-1 three). Each pattern names the structural-sweep category that must catch it.

| id | mechanism (bug-138 class) | sweep category that must catch it |
|---|---|---|
| `R2-relocated-read-fresh-consumer` | a fresh consumer reads a relocated field off a RAW `substrate.get/list` row (bypassing decodeEnvelopeToFlat) → `undefined` / `{phase}` object at runtime | raw-read |
| `R2-bootpath-reaper-raw-filter` | an `index.ts` boot-path sweeper/reaper filters `substrate.list(...)` rows on a relocated field (status/assignedAgentId) → guard never fires (run-1 reaper class, generalized) | raw-read (boot-path) |
| `R2-getWithRevision-no-decode` | a CAS read-path uses `getWithRevision` + reads a relocated leaf without decode → stale/undefined feeds the CAS precondition | raw-read |
| `R2-missing-renameMap-new-filter-key` | a new `substrate.list` filter key relocated by the encoder but absent from the kind's `renameMap` (and `SUBSTRATE_FILTERABLE_KEYS`) → SQL `data->>'key'` resolves null → silently-empty filter | filter-key-gap |
| `R2-filter-key-wrong-partition` | a filter key mapped to the WRONG partition path in `renameMap` (e.g. `spec.x` when the encoder wrote `status.x`) → filter matches nothing | filter-key-gap |
| `R2-cas-transform-before-decode` | `casUpdate/tryCasUpdate` mutates the entity BEFORE decoding the raw envelope → the transform sees `{phase}`/undefined, writes a corrupted flat shape | cas-decode |
| `R2-cas-reenvelope-stale-leaf` | the CAS write-encoder re-envelopes a STALE relocated leaf (read pre-decode) → round-trip drift, caught only write-then-read | cas-decode |
| `R2-bespoke-decoder-leaf-gap` | a kind with a bespoke decoder (Message/Turn/Audit/…) gains a NEW relocated leaf the bespoke decoder doesn't lift → top-level `undefined` despite "decoded" | raw-read (bespoke-decoder) |

**FP-trap (precision, mirror of run-1):** `R2-fp-reads-broken-runs-correct` — code that
reads broken on a strict static read (looks like a raw-envelope access) but is correct at
runtime (the field genuinely isn't relocated / is decoded upstream) → flagging it = a measured
over-claim. Punishes the structural sweep over-firing on the SUBSTRATE_FILTERABLE_KEYS heuristic.

**Coverage rationale:** run-2 recall is gated ≥0.80, so the sweep must find ≥7/8 real plants.
The 8 span raw-read (×4 incl. boot-path + bespoke), filter-key (×2), cas (×2) — every category
the #2 sweep audits, so a clean pre-flight proves the sweep generalizes beyond the run-1 three.

*Architect drafts the n≥3-4 spec-real plants (the spec-recall thinness fix); both sets +
variants go to the neutral instantiator for the joint run-2 canary.*
