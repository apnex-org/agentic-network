# Autonomous Stint-3 — Decision-Record Ledger (2026-06-27)

**Stint:** lily acting-architect under Director-delegated autonomous authority.
**Opened:** 2026-06-27. Director: *"Autonomous. Let's consolidate the substrate. Consider cleanup of conflicting tooling also."*
**FOCUS:** idea-355 — shared-adapter (network-adapter kernel) consolidation + conflicting-tooling cleanup.
**Peers:** greg=agent-0d2c690e (engineer, online), Steve=agent-f148389d (verifier/opencode, cognitively-unresponsive at open).

DR format: `DR-S3-NNN — <decision> — <rationale> — <provenance>`.

---

## DR-S3-001 — Stint-3 opened; FOCUS = consolidate the substrate (idea-355)
The Director re-delegated autonomous authority and SET the focus to idea-355 ("consolidate the substrate") with an explicit add: "Consider cleanup of conflicting tooling also." Carry-over context from stint-2 close (DR-S2-028): C1 work-queue proven by two dogfoods; idea-355 was the named next focus; platform-hygiene cluster filed (idea-354, bug-182/183/184/185).
**Provenance:** Director message 2026-06-27; memory project_autonomous_stint_2_state.md handover.

## DR-S3-002 — idea-355 SIZING: NO fork; "kernel 2.1.0" is a phantom; MEDIUM structural-cleanup
The idea-355 text's "claude 0.1.4 vs opencode kernel 2.1.0 = suspected fork" framing is WRONG. Triangulated via (a) architect repo ground-truth, (b) greg's authoritative audit (thread-727), (c) an Explore boundary-map, (d) Director pointer ("opencode-hub-plugin repo"):
- **No source fork.** Both shims already import the single `@apnex/network-adapter@0.1.4` kernel (workspace `*`). Source is already consolidated.
- **"4.3.0 / network-adapter@2.1.0" are HARDCODED phantom constants** in `adapters/opencode-plugin/src/shim.ts:43-44`. The claude shim had the identical hardcode, fixed in mission-66 #40 (`readPackageVersion`); the port to opencode never happened. = **bug-183**.
- **History reconciled:** network-adapter WAS on a 2.x line in April (mission-64 dogfood bumped 2.0.0→2.0.1); a later monorepo reorg reset it to 0.1.x. The deployed opencode bundle (`apnex/opencode-hub-plugin`, a dist artifact) froze on the old 2.1.0/4.3.0 line and was never rebuilt onto 0.1.x.
- **Real dedup surface confirmed:** each shim carries ~300–400 LOC of generic infra that drifted independently; genuinely host-unique = transport wiring only.
- **SIZE: MEDIUM, structural-cleanup class.** NOT merge-two-codebases.

**Architect correction (folded, greg-confirmed on ground truth):** the idea-353 wake/stall ORCHESTRATION (`runWakeStallReconcile`) + bug-180 live-refresh wiring live in the CLAUDE SHIM, not the kernel (only the trackers + seams are kernel-resident; opencode references NONE of them — zero hits, fully dormant). So redeploying opencode onto 0.1.4 alone ships dormant machinery. greg's refinement: SLICE-1 must hoist not just the FUNCTION but its INVOCATION onto the kernel PollBackstop heartbeat tick (kernel-driven), so every host gets wake/stall + live-refresh with zero per-shim wiring — else the drift re-opens. Same shape for bug-180.

**Agreed 5-slice decomposition (thread-727, converged implementation_ready):**
- SLICE-0 (trivial, independent): port mission-66 #40 version-fix to opencode shim — kill the 4.3.0/2.1.0 hardcodes → `readPackageVersion`. Closes bug-183 reported-half.
- SLICE-1 (structural ANCHOR): hoist duplicated generic infra shim→kernel + `runWakeStallReconcile` + its tick-drive + bug-180 live-refresh wiring. Shims reduce to transport-wiring only.
- SLICE-2 (functional WIN, deps SLICE-1): rebuild + redeploy opencode onto the current kernel → steve gets live-refresh + wake/stall for real.
- SLICE-3 (versioning hygiene): unify version scheme + auto-bump (bug-182) + port idea-256 commit-identity wire (SHIM_COMMIT/ADAPTER_COMMIT) to opencode.
- SLICE-4 (conflicting-tooling cleanup — Director-named): retire deprecated `get_engineer_status` (bug-184) + sweep the live tool surface for other deprecated-but-exposed verbs.

**Provenance:** thread-727 (converged 2026-06-27); Explore boundary-map; idea-355 updated text.

## DR-S3-003 — RECONCILIATION: idea-355 must LAND parked mission-92/93 work, not duplicate it
Ledger-reconciliation catch before proposing a mission. Two ACTIVE missions are parked with substantial unmerged work that overlaps idea-355's SLICE-1:
- **mission-92 (M-OpenCode-Shim-Sovereign-Deduplication, idea-331):** `origin/agent-greg/opencode-shim-dedup` = **17 commits ahead of main, unmerged** (#337). Step-2a hoist isPulseEvent→core, Step-2b hoist bug-108→core, Step-2c notificationHooks delegation + DELETE buildPluginCallbacks, de-any fence. = most of SLICE-1's generic-infra dedup, already BUILT.
- **mission-93 (M-Verifier-Role, idea-330):** `origin/agent-greg/opencode-shim-deany` = **19 commits ahead, unmerged**. Superset of the 92 work + mission-93 cutover hardening (verifier in classifyEvent, fail-loud register_role) + bug-161 completion.
Both parked ~2026-06-20 when the stint pivoted to C1 dogfooding. **mission-64 (M-Adapter-Streamline)** is DONE (npm-publish distribution) and is idea-354's lineage, distinct from idea-355.

**Decision:** idea-355 is NOT greenfield — it is "land the parked dedup + add what post-dates it." Vehicle reconciliation in flight with greg (thread-728); options weighed: (A) idea-355 umbrella completes+merges 92/93 as first slices then adds new work; (B) revive+expand mission-92 into the full consolidation; (C) land 92/93 as a quick merge+deploy first (clear parked debt), then idea-355 = clean follow-on for the new work only. Architect lean: **(A) or (C)** — both respect the built work (zero-loss / tele-4) + the Director's "idea-355" naming. Final vehicle pends greg's ground truth on branch state + 92/93 separability + rebase pain vs current main (the branches predate #362/#363).

**FRICTION observed (for the deferred council):** built work stranded by a mid-stint pivot — mission-92/93 carried 17–19 unmerged commits parked 7 days; near-miss duplicate because parked-active missions weren't surfaced at the new-focus framing. Reinforces the ledger-reconciliation-before-proposing discipline.

**Provenance:** list_missions (active/proposed) + get_mission mission-64/92/93; git branch forensics; thread-728 (open).

## DR-S3-004 — VEHICLE = (C): land parked work first (code-only), then idea-355 = only-new; ONE redeploy at SLICE-2
greg's branch audit (thread-728, converged) settled the vehicle with two corrections folded:
- **#337 merged = de-any/bug-161 TAIL only**; the core dedup stack (Step-1/2a/2b/2c + opencode esbuild release pipeline) was never PR'd — deprioritized for C1 ~06-20, not a failed merge. Build *looks* complete; confirm via rebase+build.
- **Branches DIVERGED, not nested** (shared 16-commit base, forked at c20a9a3). mission-93's unique delta = **2 adapter commits**; the dedup is **fully separable** from the verifier Hub deploy (Hub-side already merged #335/#338/#343/#346).
- **Rebase pain LOW:** exactly one trivial `index.ts` barrel collision with #362/#363; hoists live in files those PRs never touched. 92 already BUILT the opencode release pipeline (`release-opencode-plugin.sh` + esbuild bundle) → SLICE-2 de-risked.

**DECISION (C):** clear the parked debt first as a fast zero-loss CODE-ONLY merge (normal PR flow, NOT dogfood-queued), then idea-355 = crisp follow-on for genuinely-new work. Beats (A)/(B) because it doesn't drag an 06-20 build through a fresh design/preflight/dogfood lifecycle, and shrinks idea-355's design to only-new.

**REDEPLOY (architect call on greg's caveat): ONE redeploy, at SLICE-2.** Merge 92/93 code now with NO redeploy — redeploying opencode at 92-close would be WASTED (thinner shim but still dormant on wake/stall until SLICE-1 hoists the runWakeStallReconcile tick-drive). steve stays on the old 4.3.0 bundle (no regression — already lacks wake/stall) until SLICE-2's single republish picks up everything: 92 dedup + 93 hardening + SLICE-1 hoists + version-fix. The opencode shim republish is architect-publishable + reversible → flow at SLICE-2 autonomously, surface post-hoc ([[feedback_flow_verifier_gated_deploys]]).

**EXECUTION:**
- PHASE-1 (now): greg rebases dedup stack onto main + build-verify → PR → architect cross-approves + merges → close mission-92; then land mission-93's 2 remaining adapter commits → close mission-93. Code-only.
- PHASE-2: idea-355 mission = SLICE-0 (version-fix) + SLICE-1 remaining generic-infra hoists + runWakeStallReconcile/tick-drive/live-refresh kernel-drive + SLICE-2 (single redeploy) + SLICE-3 (versioning/bug-182 + idea-256 wire) + SLICE-4 (tooling: bug-184 + sweep). Architect writes the design on `agent-lily/idea-355-design` (parallel with greg's rebase), proposes + preflights, seeds dogfood-3.

**Provenance:** thread-728 (converged implementation_ready 2026-06-27).

## DR-S3-005 — PHASE-1 COMPLETE: both parked missions landed zero-loss
- **mission-92 CLOSED** — PR #367 squash-merged `a165d64` (Step-1/2a/2b/2c dedup + opencode esbuild release pipeline). Rebase clean (1 trivial `index.ts` barrel vs #362/#363); cross-approved per-delta; all CI green incl hub vitest.
- **mission-93 CLOSED** — PR #368 squash-merged `8568678` (verifier cutover hardening: register_role **fail-loud** replacing the silent engineer/offline degrade that masked Steve's cutover for an hour + verifier in classifyEvent; bug-161 R1 terminal session flush + bounded queue cap 50). Clean cherry-pick onto main-with-#367; cross-approved; CI green.
- **Code-only, NO redeploy** — both batch into idea-355 SLICE-2's single opencode republish (per DR-S3-004). steve stays on the old 4.3.0 bundle (no regression).
- 19 commits of built-but-stranded work (parked 7 days by the C1 pivot) landed inside one coordinated architect+engineer pass.

**Next:** idea-355 construction-design audit opened (thread-729) — greg audits design v0.1 (`docs/designs/idea-355-adapter-substrate-consolidation-design.md`; 5 load-bearing Qs Q2–Q6, Q1 resolved by the clean landing) → fold → propose the mission (M-Adapter-Substrate-Consolidation) + preflight → seed dogfood-3 WorkItems (WI-0..WI-4). Memory refreshed to `project_autonomous_stint_3_state.md` (compaction-safe).

**Provenance:** PR #367/#368 merged; mission-92/93 status=completed; thread-729 (open).

## DR-S3-006 — Design v1.0 RATIFIED + mission-95 launched + DOGFOOD-3 SELF-WAKE PROVEN + calibration governance relaxed
**Design v1.0 RATIFIED** (`agent-lily/idea-355-design` @`faf6e36`) — bilateral: greg construction-audit GREEN-with-flags + concur (thread-729); Director steer folded (tool-surface = SLICE-1T, "clean symmetry", greg-refined to a DELETE not a migration); both-shim dedup audit folded (wf_b116cc96, 9 agents, adversarially verified).

**The dedup answer (Director Q "does this dedupe BOTH shims further?"):** genuine both-shim dedup is SMALL (~4 items: config trio, file-logger, onPendingTask, readRequiredAgentName); the arc's primary value is SINGLE-HOME consolidation (kernel = one home → wake/stall + honest version + honest liveness reach all hosts). The audit adversarially REFUTED 2 false-positive hoists I'd have over-scoped (cognitive sink = host-unique; boot-wiring = already-hoisted substance + defer-to-3rd-host) — the workflow stopped me over-scoping. Honest dedup-vs-single-home framing folded into v1.0 §1.

**mission-95 (M-Adapter-Substrate-Consolidation) ACTIVE** — structural-inflection, MEDIUM. idea-355 incorporated. dogfood-3 queue SEEDED: work-12 SLICE-0, work-13 SLICE-1 anchor+tick-drive, work-14 SLICE-3 version, work-15 SLICE-4 tooling (all engineer/no-dep); work-16 SLICE-2 redeploy (architect, deps 12/13/14); work-17 verifier-gate (verifier/Steve, deps 16, advisory).

**🎯 DOGFOOD-3 SELF-WAKE VALIDATED (the payoff):** I did NOT ping greg. The queue's idea-353 claimable-digest self-woke greg → he claimed work-12 → built SLICE-0 → PR #369. The arc's "queue self-wakes everyone" thesis PROVEN LIVE (no manual nudge). **PR #369 MERGED `443f37b`** (opencode version-fix: 4.3.0/2.1.0 phantom DELETED → readPackageVersion + createRequire; honest 'unknown' until SLICE-3). bug-183 reported-half CLOSED. greg moving to work-13 (SLICE-1). Pulse note: mission-95 architect pulse fired + acked; the queue-digest is the primary dogfood-3 coordination (pulses now redundant/backstop — supports idea-349; relax if noisy).

**CALIBRATION GOVERNANCE (Director-directed):** Director "Yes file it" + "not sure the rule should remain." → **calibration #86 `deferred-divergence-becomes-drift`** filed + pattern registered (anchored on the SLICE-1T clean-symmetry steer: architect defer-recommendation overridden; greg's refinement showed it cheap) + **filing-gate RELAXED** (architect-fileable + evidence-anchored + peer-verified; Director CURATES not gates — removes the Director-as-minting-bottleneck, tele-13). **PR #370** (Director curates via the PR = the new model demonstrated). **idea-356** filed (Phase-2 calibration mechanization: write-verb + robust auto-surface recall — the "robust mechanised recall" the Director probed). 2 feedback memories captured ([[feedback_close_divergence_over_defer]] + [[feedback_capture_valuable_steers]]).

**Provenance:** thread-729 converged; mission-95 active; work-12..17 seeded; PR #369 merged `443f37b`; PR #370 open; idea-356 filed.

## DR-S3-007 — WI-1 LANDED (the load-bearing tick-drive) + calibration-gate merged + work-queue-observability folded + mission-95 PULSE-FREE
**🎯 WI-1 (SLICE-1 anchor + the TICK-DRIVE CONTRACT) MERGED** — the load-bearing piece. #371 part-1 (foundational hoists, `5a40dc868`) + #372 part-2 (tick-drive + observability/file-logger/coalescing hoists, `c343e95`). The kernel now drives wake/stall + live-refresh on the PollBackstop heartbeat for EVERY host → opencode inherits both for free at the SLICE-2 redeploy (zero shim code). work-13 completes on the pr_merged cue.

**Adversarial per-delta review** (wf_9d2be7b3, 4 agents, on commit 723b515) = **ship-with-nits**: contract + all 5 invariants correctly implemented + MUTATION-verified; payoff CONFIRMED. The review EARNED ITS KEEP — found (a) a VACUOUS latch test on the slice's most-critical invariant (false confidence; mutation-confirmed reset-out-of-finally left all 7 green), (b) a LIVENESS-COUPLING regression (the hoist gated transport_heartbeat behind the reconcile's Hub round-trip → could erode the mission-75 TTL margin + ironically cause a bug-186-class false-unresponsive, newly network-wide for opencode). Both fixed in-PR (`15decbb`): liveness DECOUPLED (transport_heartbeat fired independent of onHeartbeatTick + a 10s withTimeout read-race) + non-vacuous latch test (throw in the W2 emit path reaches the finally) + observe try/catch nit. **idea-358** filed: 2 pre-existing tracker gaps the hoist makes kernel-wide (expired-lease prune / W3 stuck-'holding' + memory; persistent-read-failure degraded-mode escalation per tele-4) — log-only today, post-SLICE-1.

**Calibration #86 + gate-relax MERGED** — PR #370 `d03a766` (admin-merge: greg-approved + CI-green + up-to-date-formality only; the BEHIND→update-branch→re-CI cycle = FR-31). Calibrations now **architect-fileable, Director-curates** (CLAUDE.md updated). #86 `deferred-divergence-becomes-drift` live in the ledger.

**Work-queue observability folded → idea-357** (Director-directed, two surfacings): (1) CI/deploy/WI-transition events not Hub-pushed (gating agent sits blind); (2) no 'list work by status' tool. idea-357 now 3 parts: PUSH events (CI/deploy/WI-transitions) + PULL `list_work` (filter by status/role/holder/lease-state) with **LEASE AS A DEDICATED COLUMN** + **REST/oisctl-CLI alignment** (one projection, two bindings — the work-queue = oisctl's first compelling `get`). idea-356 (calibration mechanization: write-verb + auto-surface recall).

**mission-95 PULSE-FREE** (Director challenge "make sure the pulse is necessary" → reassessed from ground truth): the **WorkItem lease-expiry IS the native stall-detector** (work-13 lease auto-requeues in 15min if greg stalls — faster + more precise than any pulse) + the digest is wake → pulses vestigial. Both neutered. The queue subsumes BOTH pulse functions (wake=digest, stall-detect=lease). 3 feedback memories captured this stint: [[feedback_close_divergence_over_defer]], [[feedback_capture_valuable_steers]], [[feedback_verify_necessity_before_retaining]]. FR-31 (merge-workflow one-size-fits-all) logged on the friction backlog (PR #357).

**DOGFOOD-3 STATUS:** SLICE-0 ✓ (#369) · SLICE-1 ✓ (#371+#372) · work-13 completing · work-14 (SLICE-3 version) + work-15 (SLICE-4 tooling) READY for greg · **work-16 (SLICE-2 redeploy, architect-owned) unblocks after work-13+14** → the SINGLE opencode redeploy + **operator-triggered steve-restart (the next Director touch-point — flag at the precise ready-moment)** → opencode gains wake/stall + honest version + honest liveness (closes bug-186) → work-17 verifier-gate (Steve advisory). SLICE-1T (opencode→kernel ToolSurfaceReconciler) rides SLICE-2's delete-in-bundle.

**Provenance:** PR #371 `5a40dc868` + #372 `c343e95` merged (WI-1); PR #370 `d03a766` merged (calibration #86 + gate-relax); wf_9d2be7b3 (tick-drive review); idea-356/357/358 filed; mission-95 pulses neutered; threads 729/730/731 converged.

## DR-S3-008 — SLICE-3 ROLL-CONFIRMED: the honest version surface is LIVE (bug-182/183 closed)
**SLICE-3 (version scheme) MERGED + ROLL-CONFIRMED** — PR #373 (`25d155d`), bilateral cross-approval, CI 9/9, Director-authed auto-deploy. `deriveAdvisoryTags` additively reports BOTH `sdkVersion` (kernel, from build-info) + `shimVersion` (top-level `Agent.adapterVersion` untouched = envelope byte-contract); bug-182 prepack auto-bump assert across all 6 hooks + opencode (decision-B `OIS_SKIP_VERSION_ASSERT` carve for consumer-publishes); idea-256 commit-identity ported to opencode (esbuild-inlined single-sha → fixes `@apnex/network-adapter@unknown`). 🎯 Roster confirm: lily/greg `sdkVersion=@apnex/network-adapter@0.1.4` + `shimVersion=0.1.9` (honest) — and the honest surface EXPOSED the drift it was built to reveal: steve `sdkVersion 2.1.0` + `shimVersion 4.3.0` (the stale frozen bundle). bug-183 true-half + bug-182 closed.

**Provenance:** PR #373 `25d155d` merged + roll-confirmed; get_agents roster.

## DR-S3-009 — Director CONSOLIDATE-FIRST + SLICE-1T RE-SIZED (the sync-gate caught a design error)
**Director sync-gate** ("check with greg first, make sure you're in sync") before opening the redeploy → thread-735 surfaced greg's ground-truth CORRECTION: the opencode→kernel-ToolSurfaceReconciler rewire NEVER landed in #372 (SLICE-1 = the tick-drive only); `syncTools`/`computeToolHash`/`lastToolHash` + the `void syncTools()` call at shim.ts:393 are the SOLE, load-bearing opencode tool-surface mechanism → SLICE-1T is a REAL rewire build (kernel reconciler heartbeat-hook + /health revision-fetch + served-revision + emitListChanged + the deletes + the bug-4 schema-fix), NOT a "delete-in-bundle." My design's framing was WRONG; the sync caught it before a divergent bundle. **LESSON:** sync-before-irreversible-coordination earns its keep mid-flight; verify build-state from ground truth, not the design's assumption.

**Director cadence call** (AskUserQuestion): **CONSOLIDATE-FIRST (1 steve-restart)** over unblock-now (2) — accept steve degraded until the rewire lands, in exchange for a single restart onto the fully-consolidated bundle (the restart = the Director's operator action → their call). → **work-18 seeded** (SLICE-1T rewire, engineer/HIGH) now GATES work-16. SLICE-1T design-input resolved on thread-736 (5 forks: HOIST `makeFetchLiveToolSurfaceRevision` to the kernel / `readServedRevision=() => null` as a bounded+DOCUMENTED divergence / streaming-trigger / KEEP the toast = host-unique shim UX / bug-4 = structural-class closure via the authoritative-ETag move, honest closure-note required).

**Provenance:** threads 735 + 736 converged; AskUserQuestion = consolidate-first; work-18 seeded.

## DR-S3-010 — SLICE-4 merged+roll-confirmed + the AUTONOMOUS-STINT engine stood up
**SLICE-4 (conflicting-tooling cleanup) MERGED + ROLL-CONFIRMED** — PR #374 (`b8b9051`), architect cross-approval (byte-contract verified safe: top-level `Agent.adapterVersion` untouched), CI 9/9, Director-authed Hub deploy. `get_engineer_status` HARD-REMOVED (bug-184) + `advisoryTags.adapterVersion` clean-removed (shimVersion carries the honest value). Roll-confirm: get_agents advisoryTags no longer carries `adapterVersion` on lily/greg → the deploy landed. `get-agents.sh` needed no repoint (grep-clean). idea-359 filed (arg-level deprecations: list_* `status:` scalar + create_review `rejected` enum). The 2 spec-doc get_engineer_status→get_agents sweeps (entities.md + verifier-role.md) fold into work-18.

**AUTONOMOUS-STINT SETUP (Director-directed):** Director prepping a fully-autonomous stint (formally begins after steve's restart). Stood up: (1) **strategic-review workflow** (`wf_29ee09e3`, 4-phase: ingest 6 readers → tele-rank → adversarial completeness/tele-honesty critique → finalize) → produces the ranked+seeded candidate-arc backlog + the greg/steve drive-plan; (2) **work-19 = the autonomous-stint DRIVER ANCHOR** (freeform/critical/architect-only; CLAIMED + lease-renewed each active turn = the self-drive heartbeat; NEVER completed until stint-end; lease-expiry → requeue → idea-353 claimable-digest = the stuck/idle backstop — Director-designed; the queue is now the architect's event-driven loop, no external timer); (3) the **prioritise/seed/rank ENGINE** (Director-approved): inputs (ideas/bugs/missions/roadmap/teles/calibrations) → instruments (strategic-review / tele-audit / code-audit / council / brainstorm = bounded ANALYSIS-RUNs) → rank by TELE-ALIGNMENT FIRST → seed across the 3 planes (entities/queue/comms) → drive greg+steve+controller. Captured in the work-19 payload + (pending) `docs/methodology/autonomous-stint-operating-model.md`. work-19's "never-complete" = a DOCUMENTED CONVENTION (payload `leaseDiscipline` + `stint-closed` evidenceReq + memory), not a Hub-enforced lock; Director chose to leave it as convention (hardening path = a `refResolvable` Director-gated completion, banked).

**Provenance:** PR #374 `b8b9051` merged + roll-confirmed; `wf_29ee09e3` kicked; work-19 claimed + renewed; idea-359 filed; first-cut ranked candidates = idea-355 close-out → C2 Survey → C1 widen → D-3 telemetry → idea-357/D-1 R1.
