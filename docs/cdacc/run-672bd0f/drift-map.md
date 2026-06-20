# CDACC Run-1 — Spec↔Reality Drift-Map

**Run:** `run-672bd0f` · **Date:** 2026-06-20 · **Status:** CONVERGED (P0–P9 complete; P10 Director gate = this artifact)
**Instrument:** Calibrated Dual-Altitude Conformance Council ([design](../../methodology/cdacc-dual-altitude-conformance-council.md))
**Principals:** Lily (architect / spec altitude — the MAP) · Greg (engineer / code altitude — the TERRITORY)
**Council venue:** `thread-664` (converged round 10/10)

> **One-line verdict:** *Precision-trustworthy, recall-blind* — what either altitude flagged is real (0/27 over-claims); what neither flagged is **not** cleared. Run-1 found real spec↔reality drift **and** honestly measured its own blind spots, naming the four fixes that make run-2 trustworthy.

---

## 1. Run frame

- **Frozen snapshot:** `672bd0f109efc740e0bd85ff1df65cd98b229361` (the canary-instantiated 4-tuple: code-SHA + tele-data + canary-plant-diff + holder gate-logic). All audits cited `git show 672bd0f:<path>`.
- **Altitudes:** spec = intent/ratified-clause conformance (cited-obligation tier); code = behavioral reproduction (reproduced tier). Each principal owned their fan-out *construction* (sovereign, per B.4.1); the canary measured construction quality.
- **Fan-outs:** spec `wf_916e26f8-54b` (40 agents) · code `wf_c9ab07a9-5df` (27 agents). Blind commit-reveal seal; council on `thread-664`.

### 1.1 Seal disposition (Director-ruled exception — path b)

The code altitude is **cryptographically verified**. The spec altitude rides the **git-timestamp provenance seal** under a Director ruling, because the spec hash-binding failed:

```
committed (commit-spec.json)            0ed94c62…
computeCommitment(verdictVector,nonce)  6db1dc28…   ← published bytes
sha256(reveal-spec.json file)           2163eee8…
```

The reveal hashed a **transient in-memory string**, not the published artifact; the exact committed preimage was never persisted and is **unrecoverable** (forensically exhausted: saved V, native fan-out output, whole-object, whole-file, every plausible field-projection — none reproduce `0ed94c62…`). This is a **binding defect, not a breach**: independence is proven by git timestamps interlocking **both directions** —

```
code commitment 06:20:21Z  <  spec freeze 07:00:11Z  <  code reveal 07:27:54Z
```

— so neither altitude could have seen the other's verdicts. The Director accepted the provenance attestation for run-1 and recorded the binding failure as run-1's **headline instrument-calibration finding** (§7.1).

---

## 2. The scorecard — the headline of run-1

The canary (two-sided planted false-positive traps + reproduced-real drift plants) measured both principals:

| Axis | Result | Read |
|---|---|---|
| **Precision** | **CLEAN, both altitudes** — 0/10 fp-traps over-claimed + 0/17 known-clean cells falsely flagged (0/27 total) | **Dispositive trust number — SOUND.** Every planted "looks-violated-but-sanctioned" trap was resisted; the spec fan-out logged considering and declining each woven trap, the code fan-out resisted all five code-side over-claim traps. |
| **Recall** | **BROKEN** — code 0/6 reproduced-real plants found; spec 1/1 but via the normative layer only (n=1) | **Blind spot, named.** The 6 code plants all sat in surfaces the per-tele fan-out never reached (§7.2). Spec-real recall is unfalsifiable at n=1 (§7.3). |

**Trust contract for this run:** the 6 DISAGREE cells (§4) are trustworthy; the 7 AGREE-PASS cells are **not certified-clean** — recall-blindness means absence of a flag is not evidence of conformance.

---

## 3. The cell grid (13 teles)

| Class | Teles | Count |
|---|---|---|
| **AGREE-PASS** (uncertified — see §2) | tele-0, 1, 3, 6, 7, 8, 11 | 7 |
| **DISAGREE** (drift-map §4) | tele-2, 4, 5, 9, 10, 12 | 6 |
| **Off-grid / UNAUDITED** | tele-13 (ratified at HEAD, absent from frozen snapshot) | 1 |

No AGREE-FAIL cells; no GAP cells. The single normative-real finding (tele-0 umbrella staleness) surfaced through the completeness layer, **not** a verdict cell — see §5.

---

## 4. The drift-map — 6 contested cells

Each cell carries the spec verdict, the code verdict, the ratified architect **obligation-tier ruling** (concurred by the engineer at the code altitude), and the disposition.

| Tele | Spec | Code | Disposition | Obligation-tier ruling |
|---|---|---|---|---|
| **tele-2** Isomorphic-Spec | PASS | FAIL(high) | **drift-latent(high), SCOPED to the asymptotic half** | The substrate-layer isomorphism **is a shipped-MUST and CONFORMS** — mission-83 SchemaDef-reconciler + mission-90 envelope make storage-schema ↔ `entity-kinds.json` isomorphic and boot-reconciled. The drift is the FSM-in-TS + zero-runtime-consumer `workflow-registry.md` half, for which **no clause makes runtime-isomorphism a current obligation**. The flat FAIL was split; only the asymptotic half is drift. |
| **tele-4** Zero-Loss | PARTIAL | PASS | **→ PASS** | Pure interpretation. The spec PARTIAL was a strict-literal read of the Mechanics *template*; no clause makes the literal gap a violation. Cause = Mechanics read as a normative checklist when authored as illustrative → tele-language fix. |
| **tele-5** Perceptual-Parity | PASS* | PARTIAL | **→ PARTIAL** | The spec PASS was under-supported (architect's own adversarial-verify set `verifyUpheld=false`); the <1% perception delta is uninstrumented anywhere. Reconciles to the code PARTIAL. |
| **tele-9** Chaos-Validated | PASS | FAIL(med) | **drift-latent (North-Star)** | Chaos Ledger / Reality-Mirror / Level-9 are unbuilt — **and self-deferred**: the CDACC design itself split the chaos harness (substrate-crash-recovery = v1; deploy-self-heal + partition = v2). The spec certified the MAP; the territory is mostly-unbuilt. Material but **roadmap, not regression**. |
| **tele-10** Autopoietic | PARTIAL | FAIL(high) | **PARTIAL (under obligation-tier)** | The autopoietic *structure* is shipped — Bug/Idea/Mission entities + the mission-lifecycle + the calibration ledger form a self-referential improvement loop; Idea→Mission chains exist. *Automation* is absent (auto-bug-on-failure, Concept registry, automated Bug→post-mortem→Mission). Recorded as **code-FAIL-on-literal-SC / PARTIAL-under-obligation-tier**; drift = "manual today, autopoietic by design." |
| **tele-12** Precision-Context | PASS | PARTIAL(med) | **scope-gap (not a Hub FAIL)** | The token-economy / precision-context obligation lives in the **adapter context-assembly layer**, which was EXCLUDED from the Hub-only frozen snapshot. The code PARTIAL is "invisible-from-Hub," not a shortfall → snapshot-coverage gap (the corpus must include the adapter for tele-12 next run). |

All six scored MATERIAL on blast-radius.

---

## 5. Root finding — the aspiration/obligation conflation

**5 of the 6 DISAGREE cells are the same defect, and it is a tele-*language* defect, not a conformance gap.** The teles conflate *aspiration* and *obligation* in their own text: a tele's successCriteria read as **shipped-MUSTs** while being authored as **North-Star asymptotes**. The map (spec) read them as direction-of-travel and PASSed; the territory (code) read them literally and FAILed. The disagreement *is* the finding.

This is precisely the **normative-vs-mechanical drift class** the spec completeness-critic flagged independently: a cited-obligation grid **structurally cannot represent** "spec==state parity holds, yet the pair is jointly stale/normatively wrong." The worked example is on the constitution itself — **tele-0 omits tele-11/12/13 in *both* the Hub entity and `teles.md`**, so mechanical parity (tele-2) passes clean while a normative read catches the staleness. The instrument demonstrated its own thesis on its own charter.

---

## 6. Tele-improvement — headline normative output

**Per-successCriterion obligation-status tag.** Annotate every tele successCriterion with one of:

- `shipped-MUST` — a current, ratified obligation; a code-FAIL here is real conformance drift.
- `North-Star-asymptote` — a directional ideal; a code-FAIL is expected distance-to-go, routed to the backlog, not the drift-map.
- `directional-target` — an in-flight obligation with a known partial-completion bar.

This **dissolves all five obligation-bar DISAGREEs at the source** (tele-2, 9, 10 explicitly; tele-4, 5 as interpretation clarifications) and gives every future run a deterministic rule for FAIL-vs-drift-latent. **Owner: architect/Director** (tele-text changes are Director-direct).

---

## 7. Instrument-calibration targets for run-2

The four fixes that move the instrument from precision-trustworthy/recall-blind to trustworthy on both axes:

### 7.1 Hash-binding fix (run-1's headline calibration finding)
Content-hash the **exact published bytes** — write the lean verdict-vector to disk, then `sha256(file)`; commit-reveal binds the published artifact, never a transient in-memory string. Pin the reveal as a git-blob at commit and **promote the git-timestamp provenance seal to a first-class** independence mechanism alongside the cryptographic one. (Carry the hash-then-publish discipline into `gate-logic.js` + both fan-out scripts.)

### 7.2 Recall-surface expansion (code altitude)
The 6 missed plants sat in surfaces the per-tele fan-out never reached. The code checklist must reach: **boot-path sweeps** (`index.ts` reapers reading `substrate.list` raw), **every filter key vs `SUBSTRATE_FILTERABLE_KEYS` + `renameMap`/partition** (the W1 contract is the natural guard — the plants used keys *not* in it), and **every CAS / read-modify-write that must decode-before-transform**. This is the bug-137/138 class; the fan-out PASSed tele-1/6/7 at reproduced-tier confidence while the drift lived in exactly these call-sites.

### 7.3 Richer spec-real plant set
Spec-real plants were **n=1** (tele-0 staleness only) → spec precision-cleanliness is currently **unfalsifiable**. Plant **n≥3–4** spec-real drifts next run, both altitudes.

### 7.4 Normative pass as a first-class grid dimension
The cited-obligation grid can't represent "parity-clean but jointly stale." Promote the normative/completeness layer (which caught tele-0) from a side-channel to a first-class verdict dimension.

---

## 8. Off-grid findings (no single tele cell)

Surfaced by the spec completeness-critic; none maps to one tele, all are coverage gaps for run-2's corpus:

- **The gestalt layer** — `docs/specs/vision-synthesis.md` (the durable synthesis above the atomic teles) was excluded from the frozen corpus → entirely unaudited.
- **Cross-tele seam composition** — how teles compose (the four-strata reading) has no cell.
- **Meta-property / structural-dogfood claims** — the autopoietic/self-conformance meta-claims.
- **tele-13** Director Intent Amplification — ratified at HEAD, absent from the frozen snapshot → UNAUDITED.

---

## 9. P10 — Director gate

The council's product is this drift-map. Per RACI, **dispositioning findings into ideas/calibrations is Director-direct** — the council does not Hub-cascade-spawn them. Recommended dispositions, batched for the single Director gate:

1. **Obligation-status tag (§6)** — the most actionable normative output; a focused tele-language pass (architect-drafted, Director-ratified). Resolves 5 of 6 drift cells structurally.
2. **Instrument hardening (§7.1–7.2)** — ship the hash-then-publish fix + the recall-surface checklist to `gate-logic.js` and the fan-out scripts before run-2.
3. **Calibration candidates** — (a) the hash-binding defect (hash-the-published-bytes discipline); (b) the precision-trustworthy/recall-blind diagnostic pattern as the run-1→run-2 calibration baseline. *Filing + ID assignment are Director-direct.*
4. **Constitution-refresh** — instantiate tele-13 + fold tele-11/12/13 into the tele-0 umbrella enumeration (closes the tele-0 staleness this run found on itself).
5. **Run-2 corpus** — include the gestalt layer (`vision-synthesis.md`) + the adapter layer (for tele-12) + n≥3–4 spec-real plants.

---

*Sealed by the CDACC council on `thread-664`, 2026-06-20. Spec altitude: Lily (architect). Code altitude: Greg (engineer). Run-1 of the instrument.*
