# Autonomous-Stint Close-Out Protocol

**Status:** v1 (first formalization artifact of M-Stint-Lifecycle / idea-380). Authored at the stint-4 close-out (2026-06-28), where the Director directed: *"continue driving closure, review and retrospective… learn from previous stints and improve on that close-out process. You are to guide the Director,"* and then *"formalise this stint lifecycle / operational process, and mechanise the workflow for Lily to operate."*

**What this is:** the Close-Out PHASE of the autonomous-stint lifecycle, formalized — the peer, at the stint altitude, of `docs/methodology/mission-lifecycle.md` at the mission altitude. It is the *durable engine* for closing a stint, distinct from any single stint's retro (which is a VIEW per ADR-030). The full three-phase lifecycle (Launch → Drive → Close-Out) + the Stint entity + the mechanized workflows are the scope of **M-Stint-Lifecycle (idea-380)**; this doc is its down-payment — the Close-Out phase, executed twice (stint-3, stint-4) and now codified.

**Why a protocol, not just "write a retro":** two stints showed close-out is where banked learning is *lost* if not disciplined — calibrations banked-but-not-filed (FR-34), one-sided architect retros (FR-20), and retros that carry unverified claims forward. The protocol makes close-out a gated, repeatable, *improvable* process so the org reliably converts a stint's experience into durable substrate.

---

## 1. Close-Out gates (ALL must hold before a stint is declared closed)

| Gate | Requirement | Origin |
|---|---|---|
| **G1 — Retro persisted + ground-truthed** | The retrospective doc exists, and every claim was verified against ground truth (git/Hub/prod) before persist — no claim carried from the harvest unverified. | stint-4 improvement |
| **G2 — Completeness-critic resolved** | An adversarial completeness-critic pass ran; every flagged gap is RESOLVED / ROUTED / CARRIED / NOTED with evidence (a Verification Log), not left open. | stint-4 improvement |
| **G3 — FR-20 tri-seat intake discharged** | Engineer + verifier first-person intakes solicited and folded (not third-person described). An architect-only retro is the exact defect FR-20 names. | stint-3 (FR-20) |
| **G4 — Calibrations FILED (FR-34)** | Every "banked for retro" calibration is filed into `docs/calibrations.yaml` (new + amendments), the ledger parses, and **the filing PR MUST merge before the stint is declared closed**. Banked-not-filed is a cross-stint loss vector. | stint-3 (FR-34) |
| **G5 — Durable-home routing complete** | Each learning is written to its ADR-030 home (calibrations / friction-backlog / director-profile / Idea+Bug entities / operating-model), not only to the retro narrative. | ADR-030 |
| **G6 — Director walkthrough delivered** | The architect guides the Director through a structured walkthrough with a small number of crisp ratification decisions (NOT a step-by-step approval crawl). RACI: Lily-guides / Director-ratifies. | stint-4 (Director RACI flip) |
| **G7 — Stint anchor completed** | Only after G1–G6, the stint-driver anchor WorkItem (work-45 class) is `complete_work`'d — its evidence requirement is "stint closed." Until then it is held + lease-renewed as the self-drive heartbeat. | operating-model §0 |

---

## 2. Close-Out method (the repeatable pipeline)

Executed at stint-4 as a parallel-harvest **Workflow** (the mechanization vehicle). The phases:

1. **Harvest (fan-out).** One reader per retro surface — shipped+tele-coverage · incident(s) · curation/reconcile · generation/incorporation · verifier-gate+process · frictions+calibration-candidates. Each reads from ground truth (Hub entities, git, prod), returns structured findings. Parallel; no barrier needed between harvesters.
2. **Synthesize.** One agent folds the harvests into the retro doc, matching the prior stint's retro format (continuity of structure aids cross-stint comparison). Output is plain markdown (a large-markdown synthesis must NOT be forced through a rigid output schema — that hits the retry-cap; lesson from stint-4).
3. **Completeness-critic (adversarial).** A final pass asks: what's missing, unverified, or un-routed? — modality not run, claim taken from a harvest not independently confirmed, a durable home (esp. director-profile) not written, a prior-stint OPEN obligation silently dropped. Its output is a gap list.
4. **Ground-truth-before-persist (G1/G2).** Resolve EVERY completeness-critic gap against ground truth *before* the doc lands: `git log origin/main` for PR/merge claims; `get_idea`/`get_bug`/`get_work` for entity claims; a throughput baseline from commit timestamps. Convert the critic's open questions into a closed **Verification Log** in the retro. This is the single highest-leverage close-out improvement — it makes the retro self-proving.
5. **Multi-seat intake (G3).** Open a first-person intake thread to each peer seat (engineer, verifier) in parallel at close — framed "async, parallel queue, not a blocker." Fold their frictions / calibration concurrence / read-corrections / one next-stint improvement. Both seats replied within ~2 min at stint-4 (the parallel-queue framing works).
6. **Durable-home routing (G4/G5).** Write each learning to its home (see §3). File calibrations (manual yaml edit until idea-356 ships the write-verb); validate the ledger parses (`calibrations.py status`). Append frictions to the backlog. Route Director signals to the director-profile.
7. **Director walkthrough (G6).** Guide the Director through the gestalt + a small, explicit decision set (see §4).
8. **Close the anchor (G7).** `complete_work` the stint-driver anchor.

---

## 3. Durable-home routing map (ADR-030)

The retro is a VIEW; these are the SOURCES OF TRUTH. Every close-out routes:

| Learning type | Durable home |
|---|---|
| Named architectural-pathology / discipline | `docs/calibrations.yaml` (calibrations[] + patterns[]) — file new, amend recurrences |
| Process/coordination friction | `docs/methodology/autonomous-stint-friction-backlog.md` (append a dated Section + triage + provenance) |
| Director revealed-preference signal | `docs/methodology/director-profile.md` (deltas section + provenance) |
| Candidate future work | Hub Idea / Bug entities (the backlog) — verify each referenced entity exists |
| Engine/discipline change | `docs/methodology/autonomous-stint-operating-model.md` (the durable engine) |
| The stint's gestalt + cross-references | the retro doc (the VIEW) |

---

## 4. Director walkthrough format (RACI: Lily-guides / Director-ratifies)

The Director delegates the close-out *method* and inverts the gate posture: the architect LEADS, the Director ratifies. So the walkthrough is a guided lead, not a permission crawl:

- **Lead with the gestalt** (the headline verdict + the one honest asymmetry), not a wall of detail.
- **Bring a SMALL, explicit ratification set** — ideally 2 decisions: (a) curate the calibration set (retire/downgrade/re-class — note: under the relaxed gate the architect already FILED them; the Director curates, does not gate the filing), and (b) confirm the next-stint FOCUS.
- **Surface, don't pre-empt, reserved Director gates** (e.g. genuine hard-lines: backplane/storage deploys; a contrary call updates the director-profile).
- **State the sequencing** so the Director sees the path, not just the asks.

---

## 5. Mechanization status (what M-Stint-Lifecycle will automate)

The close-out is currently a hand-driven Workflow + manual durable-home edits. M-Stint-Lifecycle (idea-380) mechanizes:

- **Saved close-out Workflow** (`.claude/workflows/`) — the harvest→synthesize→critic pipeline as a parameterized, re-runnable workflow (stint-4 ran it ad-hoc; save it).
- **idea-369 (M-Stint-Report-Schema)** — a codified per-item classification + per-stint rollup schema + a mechanized emit (verb/workflow), replacing the hand-assembled generation/incorporation analysis (§4 of the retro).
- **idea-368 (close-packet)** — the stint-close bundle as a first-class artifact.
- **idea-356 (M-Calibration-Mechanization-Phase-2)** — `calibrations.py add/validate` write-verb (retires the FR-34 manual-filing loss-risk that this very close-out hit) + robust recall.
- **A Stint Hub-entity** — promote the work-45 driver-anchor convention into a tracked entity with FSM + close-out gate-checklist, so G1–G7 are Hub-enforced, not a documented convention.

---

## 6. Improvement log (each stint's close-out should improve the last — the Director's standing directive)

| Stint | Close-out improvement introduced |
|---|---|
| stint-3 | First formal retro as an ADR-030 VIEW; FR-20 multi-seat intake discharged (engineer + verifier first-person); FR-34 named (banked-not-filed loss vector) + made a tracked stint-close obligation. |
| stint-4 | **Ground-truth-before-persist** (every claim verified vs git/Hub/prod; the completeness-critic's 10 gaps converted to a closed Verification Log); **adversarial completeness-critic** as a standard close-out pass; **parallel-queue multi-seat intake** (both seats replied in ~2 min); **director-profile routing made a G5 gate** (stint-3 nearly dropped it); calibration filing validated via `calibrations.py status` before PR. This protocol doc itself (formalizing close-out as a repeatable, gated process). |
| stint-5 (M-Stint-Lifecycle) | _Target:_ mechanize the pipeline (saved Workflow), ship the stint-report schema (idea-369) + calibration write-verb (idea-356), and promote the gates G1–G7 to a Hub-enforced Stint entity. |

---

## Provenance

- v1 authored at the autonomous-stint-4 retrospective (2026-06-28) as the down-payment + design-input for **M-Stint-Lifecycle (idea-380)**, at Director direction to formalize the stint lifecycle peer to the Arc/Mission lifecycle.
- Companion docs: `docs/methodology/mission-lifecycle.md` (the mission-altitude peer), `docs/methodology/autonomous-stint-operating-model.md` (the Drive-phase engine), `docs/reviews/autonomous-stint-4-retrospective.md` (the first retro produced under this protocol), `docs/methodology/autonomous-stint-friction-backlog.md` + `docs/calibrations.yaml` + `docs/methodology/director-profile.md` (the durable homes).
