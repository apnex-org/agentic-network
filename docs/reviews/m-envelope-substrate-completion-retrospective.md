# Mission-90 M-Envelope-Substrate-Completion — Architect Retrospective

**Status:** Phase 8 Execution complete; all 8 waves merged to `main` (W8 `7550cfd`, PR #323); W8 code-only redeploy in flight at authoring. Phase 9 Close pending the post-deploy live-audit (see release-gate §6).
**Mode:** **Walkthrough** (Director-paced, section-by-section) per `feedback_retrospective_modes` — saga-substrate-completion / structural-inflection class. Architect-prepared full doc; Director engages section-by-section.
**Authored:** 2026-06-20 / lily (architect; agent-40903c59).
**Scope:** architect's reflection on mission-90 shipping outcomes, the methodology + architectural learnings, and calibration-ledger filing candidates. Companion to the W8 validation report (`docs/reviews/m90-w8-decode-to-flat-validation.md`) and the release-gate (`docs/missions/m-envelope-substrate-completion-release-gate.md`).

---

## §1 What shipped (one-paragraph)

mission-90 completed the envelope-substrate maturity saga (mission-88 K8s-envelope → mission-89 OCC → this). It promoted `renameMap` from a migration-only artifact to the **single runtime field-translation authority** (write-encode + filter-translate + read-decode all derive from it), swept every envelope-blind consumer, re-migrated residual legacy rows under shadow-validated parity, flipped the production Hub to envelope-only STRICT (W6 cutover, 2026-06-19), and retired the dual-shape tolerance entirely (W8). The structural result: storage is envelope; repos decode at the read + CAS boundary; **one flat domain shape above the membrane, with no dual-shape recurrence surface**. Along the way the faithful test-harness migration exposed — and the decode-before-transform fix closed — a class of **live production state-machine defects** (review circuit-breaker, mission auto-advance, proposal-close, PendingAction watchdog, message-sequencing) that had been silently degraded since the original envelope migration, plus the dispatch-half of bug-146. 8 internally-gated waves + a Director-mandated deep adversarial audit. Net signature: large read-path refactor (~9 repos) + a substantial dead-code + dual-shape deletion.

---

## §2 What worked (wins)

### §2.1 `renameMap` as the single declarative authority — the load-bearing abstraction
Promoting one declarative contract to drive encode + translate + decode (bidirectional symmetry) is what made the close *complete* rather than a pile of point-fixes. A new relocated field now needs only its renameMap entry. The generic `decodeEnvelopeToFlat` (renameMap+partition reverse) handled all but the leaf-rename kinds, which layered bespoke decoders on the generic base — a clean two-tier pattern.

### §2.2 The faithful test-harness migration was the highest-leverage move
Making the test substrate store envelope like prod (`setWriteEncoder` in the harnesses + the memory factory default) took the suite from **green-but-lying to red-and-honest** (193 failures). That single fidelity change is what surfaced the entire latent prod-defect class. Test-substrate fidelity to prod is non-negotiable; a harness that stores a different shape than production is a false-green generator.

### §2.3 The Director-mandated deep adversarial audit delivered
A 9-agent refute-not-confirm audit (silent-miss sweep, CAS-fix positive-proof, false-green hunt, completeness-critic) on the merge-candidate found **two real gaps the engineer self-report had glossed** — an overstated "consumers always see flat" claim with latent landmine skeletons, and a postgres-path decode coverage hole for 4 kinds — both fixed before merge. Zero correctness blockers, but the gaps were genuine. Independent adversarial audit + a completeness-critic ("what is UNverified?") catches what self-certification and green-CI miss.

### §2.4 Empirical-before-irreversible (W6-prep) caught 131 rows of silent data-loss
Running the migration against a real prod snapshot *before* the strict-flip caught two latent silent-data-loss classes (bug-154 dirty-cursor trap, bug-155 offset-skip) — 131 rows that would have gone unreadable at the irreversible flip. The shadow-read parity harness + cursor discipline were load-bearing.

### §2.5 greg's surface-gaps-before-the-window discipline held throughout
Every authorization / mechanism / rollback-target gap was surfaced *before* the relevant window, never improvised mid-window: the runbook-mechanism-mismatch before the cutover, the `f02a9bb`-vs-`dd61d96` rollback-target correction before the bug-158 redeploy, and the prod-write authorization gate before the W8 redeploy (which caught my own plan glossing it). This is the discipline that makes comms-dark windows survivable.

### §2.6 Architect-driving with category-fit Director gates
Multiple genuine forks surfaced to the Director (shape-helpers retire; decode-in-W8; END-STATE-2 full close; the deep-audit mandate; the deploy authorization). High Director engagement was a feature, not a failure — each was a category-fit decision (a reshape of the final wave or a prod-mutating gate), and the cadence kept the mission's hardest calls in the right hands.

---

## §3 What was hard / the learnings

### §3.1 "bug-138 fully closed" was claimed prematurely THREE times
- After the W6 cutover (filter-side closed live) — but `list_missions` was still envelope-blind (bug-158).
- After bug-158 (8/9 filter tools) — but the returned-entity **decode** was missing for ~9 repos (the read-side was never closed).
- The deep audit then found the postgres-path coverage hole for 4 kinds.

Each claim extrapolated structural-closure from a verified *subset*. The lesson is sharp: **a structural-elimination claim requires full-surface verification** (every kind, every read path, every consumer), not extrapolation. The architect (me) over-claimed each time; the corrections came from greg's validation and the audit, not from my assertion.

### §3.2 The silent-failure class had two surfaces — filter AND decode
bug-138 was conceived as "filter translation" (W2/W3 fixed it there). But envelope-blindness spans the **filter path** (does the query match?) *and* the **returned-entity read path** (does a consumer reading a top-level field get the value?). Closing the filter half is not closing the class. The decode half hid for the whole mission because the filter-parity checks (counts match) passed while the returned entities were still raw envelope.

### §3.3 False-green-at-scale: the defect class invisible to BOTH test and prod
The headline learning. Two mechanisms compounded:
1. **Test:** legacy-flat fixtures stored the wrong shape, so tests exercised flat→flat passthrough and never ran the real envelope decode — green CI while the decode was broken.
2. **Prod:** the cascade `try/catch` swallowed the read-crashes (degrade-then-poll-recover) — no error surfaced in prod monitoring either.

Combined, a class of broken state-machine transitions was invisible everywhere. A test fixture that stores a non-production shape, plus a try/catch that degrades silently, will hide the very defects they sit on top of. The fix that exposed it all was fidelity (§2.2); the durable mitigation is fail-loud or an anomaly monitor instead of silent-degrade.

### §3.4 Scope-growth-via-discovery in the final wave
W8 kept revealing deeper completion-gaps: dual-shape removal → read-decode → CAS-path + helper-deletion → 9-repo width (not 5). Each looked like "the true complete close." It terminated cleanly only because of explicit guardrails: the **anti-infinite-regress stop** (surface if a 3rd deeper layer appears) and the **END-STATE-1 safety-fallback**. For "complete the X" missions, the completion surface is often larger than scoped; manage it with termination criteria + fallbacks, not open-ended "make it perfect."

### §3.5 Comms-dark is structural, not incidental
Stopping `ois-hub-prod` kills the coordination relay (the Hub *is* the channel, bug-157), so an in-window human-GO is impossible by construction. In-window authority must be the automated guards + the operator's judgment; the human gate belongs at the **pre-window**. The protocol gap (a watch-protocol PING-for-GO that can't be delivered mid-window) is architect-side and is folded into the runbook.

---

## §4 Calibration-ledger filing candidates

Surfaced for Director-direct / architect-Director-bilateral ratification (filing + ID assignment is never LLM-autonomous, per CLAUDE.md). Candidates:

1. **False-green-at-scale via unfaithful test fixtures** — test fixtures seeding a non-production shape mask the bug class they sit on; compounds with silent-degrade `try/catch` to make a defect class invisible to both the suite and prod monitoring. (Mission-scale manifestation / extension of calibration-#19 schema-rename-without-state-migration.)
2. **Filter-vs-decode dual-surface of envelope-blindness** — closing the filter-translation path is not closing the read-decode path; the silent-failure class spans both; filter-parity (count) checks can pass while returned entities are still raw.
3. **Premature structural-closure claim from partial verification** — claiming "class eliminated" from a verified subset; structural-elimination requires full-surface verification across all kinds / read paths / consumers.
4. **Faithful-harness-as-exposure** — making the test substrate store the production shape is the single highest-leverage exposure mechanism for shape-migration missions; fidelity is non-negotiable.
5. **Deep-adversarial-audit value at structural-elimination gates** — an independent refute-not-confirm audit with a completeness-critic catches self-certification + green-CI gaps; warranted whenever a high-stakes "class eliminated" claim is about to ship.
6. **Code-only-redeploy class** (operational) — a reader/code-only fix found post-cutover redeploys without the data machinery (no migration / reset / shadow-gate; build → recreate → live-verify; rollback = re-tag the prior image). Distinct from the data-migration cutover; rollback target is the *current* image, never the pre-cutover one (unsafe alone vs migrated data).
7. **Comms-dark = Hub-is-the-channel** (bug-157) — in-window human-GO is impossible by construction; in-window authority = automated guards + operator judgment; pre-window is where the human gate lives; in-window guard-robustness is therefore load-bearing (bug-156 portability).
8. **Silent-degrade `try/catch` hides defects** — a catch that degrades-and-recovers silently masks the underlying defect; prefer fail-loud or a 0-bare / anomaly monitor (the proposed defense-in-depth replacement when the dual-shape tolerant read was retired).
9. **Watchtower-functional / `:latest`-push-is-a-deploy** (operational; W8 near-miss) — the cutover runbook AND the architect's session-long mental model held "watchtower non-functional / deploy is MANUAL IAP-SSH," while the Design's own §4 cadence note recorded the opposite (bug-140 watchtower auto-deploy). The contradiction went unreconciled until a live deploy proved watchtower functional (W8 auto-deployed ~40s after the `:latest` push). Consequence: a `build-hub.sh` push to `:latest` IS a ~5-min auto-deploy, so a "non-prod-mutating pre-build" is actually a deploy — a near-miss when that pre-build was architect-authorized during a Director deploy-HOLD. Lesson: reconcile contradictory operational docs against ground-truth before relying on either; treat any `:latest` push as a prod-mutating deploy. (Runbook B.3 + Design §4 corrected in this PR.)

---

## §5 Forward-architecture observations

- **The 0-bare anomaly-monitor (proposed follow-on).** Retiring the dual-shape tolerant read removed a silent accommodation; the principled replacement is a loud detector (assert/monitor that a bare row never appears above the membrane), not a silent tolerance. Candidate follow-on idea (tele-1, fail-loud).
- **idea-300 (FS-retirement) interaction.** The 4 deleted `*-sweeper-substrate` spikes were never wired (prod uses the FS-version decoding facades). A future substrate-native sweeper must be built envelope-aware from scratch, not resurrected from the stubs.
- **bug-149** (non-hot JSONB index parity) and **bug-148** (Notification phantom) remain as scoped follow-ons.
- **bug-146 caller-login-labeling** — the dispatch-half is fixed; the caller-login axis is distinct and tracked at the live-audit. If the dispatch fix makes formal FSM task-claim work end-to-end live, the thread-dispatch-equivalence workaround retires.
- **Consumer output contract (idea-327, incorporated).** The decode-to-flat decision is now the uniform read-tool output contract; any future entity kind must decode at its repo membrane to honor it.

---

## §6 Closing summary (Director walkthrough anchor)

mission-90 closed the envelope-substrate saga: `renameMap` is the single field-translation authority, the production Hub is envelope-strict with one flat shape above the membrane, the dual-shape tolerance is gone, and bug-138 is structurally eliminated across both its filter and decode surfaces. The mission over-delivered against its charter — it discovered and repaired a class of silently-degraded live production state-machine defects that no one knew existed, surfaced only because the test harness was finally made faithful to production. The hardest lessons are about *verification discipline*: structural-closure claims must be full-surface, test fixtures must store the production shape, and silent-degrade error handling hides exactly the defects it sits on. The Director-mandated deep audit was vindicated — it caught real gaps a green suite and a self-report had missed. Pending the post-deploy live-audit, the mission is ready for Phase 9 Close.
