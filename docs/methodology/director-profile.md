# Director Profile — revealed-preference profile (LIVING, ADVISORY)

**Status:** v1.0 (autonomous-stint-3 close, 2026-06-27). LIVING document — refresh at each retrospective from observed decisions.
**Tier:** 1 (methodology surface; advisory overlay, not normative).
**Scope:** a A13 (Director Intent Amplification) revealed-preference profile of the Director's operating mode, **observed from decisions, not assumed**. It exists to let agents anticipate likely Director preference when genuinely indifferent between options.
**Companion:** `docs/methodology/strategic-review.md` (evaluative ranking — tele-first, never preference-first) + `docs/calibrations.yaml` #86 (the architect defer-bias counter this profile pairs with).

---

## Purpose + binding (read this before using the profile)

This is a **revealed-preference** profile: every entry below is inferred from what the Director *did*, not from what the Director is *assumed* to want. It is **LIVING** (re-derived at each retro from fresh observation) and **ADVISORY, not decisional**.

**A13 binding — lean-as-tie-break ONLY:**

- The profile is a **tie-break lean** when an agent is *genuinely indifferent* between options after a tele-first evaluation. It is **never** used to re-rank candidates, never used to substitute for a tele-mapping, and **never** used to make a decision the Director would make.
- It does **not** pre-empt a Director gate. Where the Director reserves authority (the hard-lines below), the profile predicts nothing — surface the decision.
- Ranking is always **tele-first** (tele-mapping, never speed, never assumed-preference). The profile enters *after* the tele-evaluation, only to settle a real tie.
- Because it is revealed-from-behaviour, it is **falsifiable**: a contrary Director decision updates the profile, it does not get explained away.

This guards against the failure mode A13 is built to prevent — an agent *modelling* the Director instead of *amplifying* the Director — by keeping the profile strictly subordinate to the tele-ranking and to live Director judgment.

---

## Operating mode (stint-3 observation)

**Director mode = active-delegator-who-builds-the-loop.**

Not a hands-off absentee, and not a per-item approver. The Director delegates execution *fully* while investing scarce attention in the *machine* that does the executing — then steps back and lets the machine run.

Observed shape (autonomous-stint-3, ~9h fully-autonomous solo arc, "see you tomorrow"):

1. **Names a FOCUS + a secondary cleanup clause.** Sets direction in one stroke — e.g. "Autonomous. Let's consolidate the substrate. Consider cleanup of conflicting tooling also." The primary clause is the arc; the secondary clause is a bounded scope-extension, not a mandate.
2. **Grants full authority + steps away.** Delegates execution authority for the whole window and physically departs — the org self-drives. No between-commit check-ins solicited.
3. **Reserves only genuine hard-lines.** The autonomy boundary is narrow and explicit: **backplane / storage deploys remain Director-gated** (honored cleanly stint-3 — the 7-PR backplane batch was *queued, not flowed*). Reversible + cross-approved + verifier-advisory work flows autonomously with a DR-record and post-hoc surface.
4. **Curates — does not gate — calibrations.** The Director relaxed the calibration filing-gate (architect-files when evidence-anchored + peer-verified; Director curates / retires / re-classes). Removes the Director-as-minting-bottleneck so the org self-records its learning (A13: amplify Director attention, don't gate on it).
5. **Harvests ideas live during work** (~7 of 14 stint ideas Director-lodged). The Director generates candidate arcs *in-flight*, as a live participant, rather than only at gate-points.
6. **INVESTS IN THE MACHINE.** The highest-leverage Director moves were *meta*: designed the work-19 driver-anchor (the self-drive engine), shaped the strategic-review workflow, and relaxed the calibration gate. The Director builds the loop that does the work, not just the work.

---

## Revealed preferences (tie-break leans)

- **Minimize operator touches.** Prefers fewer manual harness/lifecycle interventions — e.g. 1 restart chosen over 2. When two paths are otherwise equal, lean toward the one with the smaller operator footprint. (Ties to FR-23 operator-as-lifecycle-bottleneck + the C2 Agent-Lifecycle arc.)
- **Ground-truth over narrative.** Repeatedly corrects reasoning-from-assumption — sizing, seeding, audit-promotion, and deploy-diagnosis should all verify from code/prod, not from a remembered story. When indifferent, lean toward the option that establishes ground truth first. (Pairs with calibration #85 ground-truth-over-assumption.)
- **Defer-bias counter (pair with calibration #86).** The Director **repeatedly corrects the architect's reflexive scope-minimization defer** ("fold it later" to keep a mission small). When the architect's instinct is to defer a *bounded* divergence as a follow-on, the revealed Director lean is the opposite: **close the asymmetry now** for clean symmetry, after pressure-testing the *real* cost (frequently cheap once adjacent work lands — the stint-3 SLICE-1T "migration" was a delete). This is the single most load-bearing entry: it is an explicit *counter* to a known architect bias, so it overrides the architect default when the two conflict at a genuine tie. See `docs/calibrations.yaml` #86 (deferred-divergence-becomes-drift) + `feedback_close_divergence_over_defer.md`.

---

## Stint-4 deltas (2026-06-28 — "Bank-the-Base")

Three new revealed signals, all consistent with and sharpening the v1.0 profile:

- **Delegates OWNERSHIP of operational layers, not just tasks.** Mid-stint the Director corrected an under-read ("I approved gcloud/ssh" → *"Hold up — I meant that you — Lily — **own** infra"* → *"you can drive missions on infra, greg can assist"*) and granted prod gcloud + SSH. The lean: the architect **owns** an operational layer end-to-end (infra: VM / deploy pipeline / watchtower / hardening), the Director is **not** the operator, and the Director engages at gate-points. Don't punt an owned-layer fix to the Director or assume the Director owns it. Generalizes #1 "minimize operator touches" from *fewer touches* to *the architect absorbs the operator role outright*. (See `feedback_lily_owns_infra_and_prod_access.md`; ties FR-23 operator-as-lifecycle-bottleneck → the architect IS the operator now.)
- **"Invests in the machine" escalates to PROCESS-FORMALIZATION altitude.** v1.0 #6 was building the driver-anchor (one mechanism). Stint-4 the Director directed formalizing + mechanizing the **entire stint lifecycle** — *"formalise this stint lifecycle / operational process, and mechanise the workflow for Lily to operate. Much in the same way we mechanise and formalise the Arc / Mission process."* The Director now directs building the **operating system for the autonomous role itself**, explicitly analogized to the Arc/Mission formalization. → M-Stint-Lifecycle (idea-380), staked as the stint-5 FOCUS. This is the highest-altitude expression of "build the loop that does the work."
- **Delegates the META-PROCESS design + flips the close-out RACI to Lily-guides / Director-ratifies.** *"continue driving closure, review and retrospective… learn from previous stints and improve on that close out process. **You are to guide the Director.**"* The Director hands the close-out *method* (not just the content) to the architect and inverts the usual gate posture: the architect leads the process design + walkthrough, the Director ratifies. The right response is to LEAD (bring a structured walkthrough with a small number of crisp ratification decisions), not to ask permission step-by-step. (Stint-4 close-out method captured in `docs/methodology/autonomous-stint-close-out-protocol.md`.)

---

## How to use (and not use)

- **DO** use a lean to settle a genuine tie after tele-ranking; record that you did so.
- **DO** treat a contrary Director decision as an update to this profile (re-derive at retro).
- **DO NOT** re-rank candidates by predicted preference, skip a tele-mapping, or pre-empt a reserved Director gate.
- **DO NOT** cite this profile as the *reason* for a decision the Director would make — surface it instead.

---

## Provenance

- v1.0 derived at autonomous-stint-3 retrospective (2026-06-27) from the stint's decision record (`docs/decisions/autonomous-stint-3-2026-06-27-log.md`) + the retro synthesis route_map (`director-profile-stint3` RECORD action; "Director mode" + "Director deploy-posture" routing-index rows).
- Stint-4 deltas added at the autonomous-stint-4 retrospective (2026-06-28; `docs/reviews/autonomous-stint-4-retrospective.md` §Verification Log gap #3): infra-ownership delegation, process-formalization-altitude "invests in the machine," and the close-out-RACI flip (Lily-guides / Director-ratifies).
- Cross-refs: `docs/calibrations.yaml` #85 (ground-truth-over-assumption), #86 (defer-bias counter); `docs/methodology/autonomous-stint-operating-model.md` §6 (deploy autonomy boundary); CLAUDE.md "Calibration ledger discipline" (Director-curates-not-gates relaxation).
