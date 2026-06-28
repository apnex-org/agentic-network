# Autonomous Stint-3 Retrospective

> **This document is a VIEW over the durable homes, per ADR-030.** It does not store the learnings — it indexes where each one lands. The durable storage is the calibration ledger (`docs/calibrations.yaml`), the friction-backlog (`docs/methodology/autonomous-stint-friction-backlog.md`), the Idea + Bug entities in the Hub, the operating-model (`docs/methodology/autonomous-stint-operating-model.md`), and the director-profile. Read this doc for the gestalt; query those homes for ground truth. Authored at stint-3 close (2026-06-27).

---

### Headline

**Stint-3 was the org's strongest autonomy demonstration to date — and it proved the binding constraint is no longer generation or execution, but incorporation + observability.** In ~9h of fully-autonomous solo arc-driving (Director away, "see you tomorrow"), the org landed ~35 PRs (#364→#398), resolved ~20 bugs with **0 regressions**, closed a MEDIUM structural-inflection mission (mission-95) end-to-end across **both** agent lineages, and self-generated essentially all of its own work. The self-driving engine (work-19 driver-anchor + queue-as-event-loop) was not just designed but **validated live** — its stuck-idle backstop fired and self-recovered twice (`leaseExpiryCount=2`), and the work-queue self-woke greg AND steve off the claimable-digest with **zero manual pings**.

The single biggest drain was a **phantom**: a wrong watchtower-stall mental model persisted the entire back-half (prod was already current the whole time), shaping a multi-hour batch-and-hold and a moot CRITICAL Director-gate. The dominant friction *class* is **acting on stale-or-assumed state instead of ground truth** (52% stale ledger; phantom fork; phantom deploy-stall; design-from-assumption). The dominant generative *risk* is the **incorporation funnel**: ~14:1 generation:incorporation, 248 open ideas, zero triage tags on this stint's cohort.

### By the numbers

| Metric | Value |
|---|---|
| Duration | ~9h, fully-autonomous solo (Director delegated full authority, stepped away) |
| PRs merged | ~35 (#364→#398) |
| Bugs resolved | ~20, **0 regressions** (prod /health == main HEAD = dd5dd99) |
| Production waves | 4 — (1) 19-commit zero-loss parked-debt landing (#367/#368); (2) mission-95 7-slice (#369–378); (3) 9-bug queue build-loop @ ~1 PR/15–20min (#379–392); (4) 8-bug held backplane batch via CI-gated merge-train (#385/386/394–398 → dd5dd99) |
| Mission closed | mission-95 (M-Adapter-Substrate-Consolidation) — idea-355, end-to-end across claude+opencode lineages |
| Ideas generated | 14 (idea-349…362), from 5 mechanisms; **1 incorporated** (idea-355) |
| Bugs filed | ~10 (bug-187…195) |
| Calibrations filed | 4 (#85/#86/#87/#88) + **3 banked-not-filed** (#89, #80-sort, #79/#82-recurrence) — *loss-risk, see Open Decisions* |
| Self-drive backstop | fired + self-recovered **2×** live (work-19 leaseExpiryCount=2) |
| Coordination pings | **0** (queue self-wake across both lineages) |
| Operator deliverables | #364 (0.1.9 dogfood-2 hop) + #365 (`update-claude-plugin.sh` — partial fix for idea-354/FR-23) |

**Retrospective mode:** mission-95 is structural-inflection class → **walkthrough** (per retrospective-modes memory). The stint as a whole is a coordination-primitive + substrate-consolidation hybrid → this document serves as the summary-review; the §9→§0-§7 operating-model fold is the walkthrough's structural output.

---

### FOCUS A — FRICTION (ranked, root-caused, fix + routing)

> **Meta-pattern (dominates ~35 friction findings):** *acting on STALE-OR-ASSUMED STATE instead of ground truth* — recurs across four surfaces: the ledger (52% stale), the deploy spine (phantom stall), the tool-surface cache (bug-180), and architect cognition (defer-bias, fork-misframe, SLICE-1T design error). Second class: *silent-failure re-emergence in fire-and-forget async seams*. Third: *no durable park-state for built-but-blocked work*. **The cognitive loop (audit→bug→fix) was FAST and autonomous; friction is concentrated in OBSERVABILITY and HYGIENE substrates, not execution.**

**F1 — CRITICAL: Deploy/CD-spine blind spot — a WRONG watchtower-stall model shaped the entire back-half + spawned a moot Director gate.**
- *Root cause:* the controller had no way to ground-truth deploy state (CI/deploy/WI-transition completion is not a pushed Hub event). The "watchtower dead / prod stuck on bug-61" model went unchallenged a whole segment. Ground truth on return: prod was already current (gitSha=bdf1eab=#384, last hub/** change; every later merge non-Hub → no deploy trigger); watchtower rolls in ~1min. The "failures" were the roll-confirm GATE timing out on slow-but-successful rolls + per-PR churn (no concurrency-cancel) superseding `:latest` before the poll matched. Latent-real underneath: bug-107 AR-token credential race.
- *Cost:* an 8-bug batch held for hours; a moot CRITICAL director-gate (work-30) = a direct tele-13 waste of scarce Director attention; stint-long batch-and-hold.
- *Fix → routes to:* **bug-195** (deploy-hub concurrency:cancel-in-progress + roll-coalescing + widen roll-confirm to `gitSha>=expected`) + **bug-107** (token-refresh interval << TTL, fail-LOUD) + **idea-357** (PUSH deploy/CI/WI events) + **calibration #85** (ground-truth-the-deploy-state-from-/health before declaring a blocker). **These are C3 (Ship-Integrity Spine) arc rungs, not loose bugs.**

**F2 — HIGH (dominant by frequency, cheapest fix): Stale-ledger trap — 52% of the bug ledger stale; near-miss duplicate rebuilds 3–4×; strategic-review ran on stale data.**
- *Root cause:* no standing run-first reconciliation gate; ledgers rot; seeding/strategic-review ran on stale state. idea-325 reconciliation found 24/69 closed + 24 external = ~52% stale; most ranked bugs were already done. Waste: work-20 seeded off stale ledger then abandoned; bug-161/163 fixed-but-open; mission-92/93's 17–19 stranded commits nearly re-built.
- *Fix → routes to:* **methodology-doc** (ledger-reconciliation.md + operating-model §7) — make reconciliation a **MANDATORY stint-open pre-flight gate** before strategic-review/seeding; add a **repo-scope field on Bug** so cross-repo (missioncraft) items can't accumulate (idea-361 routes the one-time ~24-bug sweep). Zero build cost; deleted ~50 wasted seed-candidates this stint *after the fact* — running it first prevents the waste entirely.

**F3 — HIGH: Tool-surface + adapter staleness — bug-180 cache blocked the opening dogfood; stale-kernel family corrupted telemetry.**
- *Root cause:* a surface change delivered via REDEPLOY never invalidates an already-running host's on-disk tool cache; `/reload-plugins` reuses the same proxy process and is empirically insufficient — only cache-delete + FULL restart per worktree recovers. Same family: frozen opencode shim (4.3.0/2.1.0 phantom hardcodes) → bug-182 (silent version no-op), bug-183 (advisoryTag reports shim not kernel → masked drift), bug-186 (false-dead cognitiveState nearly mis-sequenced verifier work), bug-184 (deprecated `get_engineer_status` still live + mis-used).
- *Fix → routes to:* **calibration** (new: tool-surface-cache-stale-on-redeploy) + **bug-180** structural fix (kernel ToolSurfaceReconciler, #362, shipped) + **idea-359** (residual arg-deprecation sweep). Confirm mission-95 SLICE-2 closed bug-182/183/186 at root (it did — steve on kernel 0.1.4, cognitiveState=alive). Single-home consolidation is the structural kill.

**F4 — HIGH (biggest structural-debt finding): tele-7 silent-failure CLASS in fire-and-forget async seams; point-fixes RE-EMERGE.**
- *Root cause:* one debt class — cursor advances on ENQUEUE-not-delivery (bug-190 drainer fails dark, with a consumerless health() = observability theatre); unsupervised fire-and-forget poller (bug-190/191, the in-flight latch already shipped on lease+projection sweepers per audit-4103, watchdog was the laggard); createMessage WITHOUT ctx.dispatch (bug-192/194 — closed for pulses in mission-60/61, RE-EMERGED in triggers/notifications); catch-and-swallow infra fault (bug-193); swallowed-error-as-flake (bug-176). **The re-emergence signal (mission-60/61→bug-192; audit-4103→bug-191) proves per-site fixes don't hold — only shared helpers (emitAndPush) + class-scoped audits close it.**
- *Fix → routes to:* **calibration** (NEW named architectural-pathology pattern — see route_map) + **bug-194** (emitAndPush class-sweep, ~6 files) + **bug-190** collapse-to-one-loop redesign (work-44, correctly deferred to fresh effort, NOT started at marathon-tail).

**F5 — MEDIUM-HIGH: No durable park-state for built-but-blocked work (bug-185) — abandon-as-workaround + 7-day stranding.**
- *Root cause:* the work-queue has no first-class "built/awaiting-deploy" phase. `block_work` counts WIP + retains the lease (reaped back to ready, blockedOn lost → false idle-digest re-nudge); `abandon_work` frees WIP but loses the tracker→evidence binding. Surfaced 3× (watchtower-held batch, bug-185 dogfood, mission-92/93 7-day park).
- *Fix → routes to:* **bug-185** (durable parked/awaiting-deploy state outside the lease regime) + a **mid-stint-pivot discipline** (surface+disposition ALL in-flight missions at any new-focus framing → mission-lifecycle.md).

**F6 — HIGH: CI-flake gate + guard-scope false-green + faithful-harness gaps + verifier can't run tests locally.**
- *Root cause:* test substrate not production-faithful — pg 57P01 testcontainer teardown race (bug-178) flaked the hub vitest cell, **gating EVERY merge**, with misleading cross-file attribution. The re-introduction guard (#381, 2 dirs) under-scoped vs the ~42-file defect class → false-green → a SECOND PR (#384). On #385 a mock harness green-lit two real-pg-only seams only steve's real-pg probing caught. Compounding: the verifier's scratch-clone has no deps/testcontainers/docker → adversarial depth limited to code-inspection + CI-trust.
- *Fix → routes to:* **calibration** (#88 guard-scope + #79/#82 faithful-harness recurrence cross-refs — *banked, must file*) + **friction-backlog FR-32** (provision verifier worktree with deps + docker/testcontainers).

**F7 — MEDIUM-HIGH: Architect ground-truth-over-assumption deficit — defer-bias + design-from-assumption (recurring, Director/engineer-corrected).**
- *Root cause:* repeatedly reasons from narrative/assumption, corrected by steers/ground-truth — cal #86 defer-bias (SLICE-1T "migration" was a cheap DELETE); DR-S3-009 sync-gate caught the SLICE-1T design ERROR (assumed delete-in-bundle; syncTools was the SOLE load-bearing mechanism — a divergent bundle was nearly shipped); idea-355 "suspected fork" misframe (would have inflated MEDIUM→merge mission); watchtower model (cal #85). Symmetric on verifier side: ~43% LLM-auditor over-call (3 of 7 idea-362 findings).
- *Fix → routes to:* **calibration #85 generalize** to ground-truth-over-assumption (4 surfaces) + **director-profile** (defer-bias counter-pairing).

**F8 — MEDIUM: Calibration loss-risk + governance hygiene — banked-not-filed entries, off-enum data, fold-debt, promotion bottleneck.**
- *Root cause:* the relaxed (manual yaml-edit) model has no write-verb and no validate. 3 round-2 calibrations exist only as a DR note + pending task #7 (**highest loss-risk on the calibration surface**); #62 carries free-text status, #60 uses `class: process` (off-enum); 23/79 OPEN (fold-debt accreting); #62 promotion stuck ~7 weeks on a strategic-review gate the relaxation didn't cover.
- *Fix → routes to:* **friction-backlog FR-34** (banked-loss-obligation) + **calibration** (file #89/#80/#79; normalize #60/#62) + **idea-356** (write-verb + validate + auto-surface).

**F9 — MEDIUM: Merge-gate one-size-fits-all (FR-31) + version-gate 3× churn (cal #87) + thread round-limit on long handshakes (FR-33).**
- *Root cause:* undifferentiated gates — a doc-only calibration PR (#370) forced through BEHIND→update-branch→re-CI; version-gate fired 3× (correct each time, never bypassed — churn from splitting the bump from its final src PR); thread-709 hit round_limit 10/10 mid-deploy-handshake.
- *Fix → routes to:* **friction-backlog FR-31/FR-33** + **calibration #87** (mechanize co-commit into release-script preflight).

**F10 — MEDIUM (latent): Idea incorporation funnel — 248 open, 1/14 incorporated, no triage tags.** *Root cause:* generation (~14/stint, 5 mechanisms) outpaces incorporation (~1/stint); stint ideas carry no audit:* tags; parked items depend on Director memory. → **methodology-doc** (standing post-stint Idea Triage + backlog-health metric).

**F11 — MEDIUM: FR-23 OPERATOR-AS-LIFECYCLE-BOTTLENECK (Director-emphasized headline).** Restart-gating, minimize-restarts discipline, work-5 banked smoke all tie to one through-line the **C2 Agent-Lifecycle arc** is designed to retire. Partly mitigated this window by #365 (`update-claude-plugin.sh` scripts the manual stage toil; the irreducible restart remains). → **friction-backlog FR-23** + C2 prioritization (work-37/#393).

**F12 — LOW-MEDIUM: list_ready_work over-reports claimable work (bug-181)** — projection filters by phase+role, not dependsOn-readiness; SAFE (claim_work fail-closed) but DISHONEST, erodes the self-driving trust posture. → **bug-181** + fold into **idea-357** list_work.

#### Multi-seat intake

This retro discharges the FR-20 multi-seat-intake obligation (one-sided intake is the exact defect FR-20 was filed to prevent). Three seats:

- **ARCHITECT (lily):** the friction findings F1–F12 above (plus FOCUS B/C) are the architect's first-person intake.

- **ENGINEER (greg) — FR-20 first-person intake (folded to 3 frictions + amplify):**
  1. **Pre-gate path-completeness.** Gate-submitted #385 before enumerating the distinct code-paths the change introduced (one test each). steve's 3 verify rounds were each a distinct path in greg's OWN fix — the clean-RETURN reconnect branch was the PRIMARY path, unpinned until round 3; each round-trip also cost a context-reload (warm mental-model loss). *Fix:* a pre-gate path-enumeration pass ("what distinct paths does this change introduce, one test each") collapses 3 rounds → 1.
  2. **Claim-time scoping under-count.** The scoping grep scoped to the surfacing SYMBOL systematically under-counts the defect-class blast-radius → commits a size estimate at claim-time on too-narrow a grep (bug-190 looked contained, was a ~1000-line atomic redesign). RECURRING (W4 re-grep, bug-178, bug-190). This is calibration #88 with a CLAIM-TIME SIZING corollary.
  3. **Trust-critical AC-fork surfacing latency.** Shipped idea-353 AC5 on a narrow strict-vs-narrow AC reading that let a self-driving signal over-report; a PR-BODY NOTE is NOT surfacing (same silent-channel class as kind=note) → cost a re-verify round. *Fix:* an explicit decision-flag to the architect BEFORE shipping, not a post-hoc note.

  **Amplify (top productivity):** mutation-proof every test (prove non-vacuous) + real-substrate testcontainers locally, BEFORE the gate → makes the verifier's green rounds FAST + trustable; converted the marquee watch fix from "I think" to "I proved it". Front-loads cost into provable confidence instead of round-trips.

  **FR-32 handoff detail (for the verifier's real-substrate harness):** (a) copy-from-template `hub/src/storage-substrate/__tests__/write-encoder-and-watch-w4.test.ts` (real `PostgreSqlContainer` + `substrate.watch` e2e — not greenfield); (b) pre-warn the 57P01 teardown flake ("terminating connection due to administrator command" at container shutdown = ignore + re-run, NOT a real failure); (c) confirm a working docker daemon on steve's seat first.

- **VERIFIER (steve):** PENDING; to be folded before the council convenes.

---

### FOCUS B — PRODUCTIVITY (what worked + amplify + drains to cut)

**WHAT WORKED (amplify):**

- **P1 — Queue self-wake (dogfood-3) — the headline unlock.** The idea-353 claimable-digest hoisted onto the kernel tick made the queue self-waking: greg self-woke→#369, steve self-woke→work-17 post-restart, **zero pings, both lineages**. Removes the architect-as-hidden-scheduler load. → operating-model **NO-MANUAL-PINGS invariant**.
- **P2 — work-19 driver-anchor + lease-expiry backstop = the self-drive engine, validated live (leaseExpiryCount=2).** The controller is an event-driven loop with no external timer; the stuck-idle backstop fired+recovered twice for real. → operating-model §0 keystone.
- **P3 — Three-role parallel + controller-run-ahead (no agent idle).** greg build / steve verifier-advisory / lily controller, seeded 1–2 slices ahead. → **NO-AGENT-IDLE invariant**.
- **P4 — Advisory verifier-gate is load-bearing AND generative.** Caught a vacuous latch test + liveness-coupling regression (#371/372); turned a one-line reconnect patch into a substrate-correctness primitive fix (bug-100→bug-187) via the cal #88 class-audit; real-pg seams (#385) mocks hid. 0 regressions across the stint. → **MANDATORY on every Hub/backplane/deploy-gating slice + mutation-verify the critical invariant's own test.**
- **P5 — Run-first reconciliation deleted ~52% of seed-candidates before any waste** AND doubled as a seed-generator (~9 file:line-located tele-tagged bugs from one run). → standing pre-seed gate.
- **P6 — CI-gated background merge-train** landed the 7-PR backplane batch, each cumulative state CI-validated, riskiest PR last, no --admin, final roll /health-verified. → reusable operating-model primitive.
- **P7 — Ground-truth-over-narrative sizing** collapsed a feared fork-merge (XL) into a MEDIUM cleanup (the "fork" was a phantom hardcode). → cal #85 sizing corollary.
- **P8 — Vehicle-C (land parked debt code-only first, then only-new arc)** recovered 19 stranded commits zero-loss in one pass.
- **P9 — Deploy-path partitioning + pivot-not-pause** kept 5 non-Hub fixes shipping live during the (phantom) deploy hold.
- **P10 — Held-time → adversarial-verify** converted dead wait-time into the stint's deepest substrate fix (work-33 → bug-187).
- **P11 — Mutation-verified non-vacuous tests + fix-the-layer-by-construction** were the de-facto standard → 0 regressions, no re-opens.
- **P12 — Mechanism-subtraction:** mission-95 ran **pulse-free** (lease-expiry IS the native stall-detector; digest IS wake). One fewer mechanism to maintain.
- **P13 — Audit→idea→ground-truth→file pipeline** self-generated honest backlog, filtering ~43% LLM-auditor over-calls.
- **P14 — Deploy posture (flow reversible, gate only backplane)** let ~30 PRs ship without per-PR Director gating; exactly ONE hard-line reserved (the 7-PR backplane "Deploy all 7 now").
- **P15 — Operator deliverable #365** (`update-claude-plugin.sh`) shipped a partial structural fix for idea-354/FR-23 within the window — credit the friction-reduction.

**Throughput baseline (for future sizing):** ~1 PR / 15–20min sustained in the queue build-loop, with bilateral cross-approval + mutation-verified CI + 0 regressions.

**DRAINS TO CUT:**
- **D1 (biggest):** watchtower-stall phantom + per-PR roll churn (F1) → bug-195 + cal #85.
- **D2:** no durable park-state → held-PR lease-churn → abandon-as-workaround (F5) → bug-185.
- **D3:** gating agent blind to queue/CI/deploy (F1 root) → idea-357 (sequence list_work first).
- **D4:** bug-180 stale tool-catalog cache blocked the dogfood go-live (F3).
- **D5:** CI-flake gates whole engine (F6); version-gate 3× churn (F9); FR-31 re-CI churn on doc PRs.

---

### FOCUS C — SELF-GENERATE-WORK CAPABILITY (every generative loop + engine-v2)

**The defining signal: autopoiesis.** The org generated ~all of its own work — 14 ideas, ~10 bugs, 4+ calibrations, the full Director decision-agenda — almost none Director-assigned. **14 generative loops codified:**

| # | Loop | Mechanism | Evidence |
|---|---|---|---|
| G1 | **Master engine** | reconcile→instrument→seed→tele-rank→drive; work-19 anchor + queue-as-event-loop | operating-model §0-§9; work-19 payload |
| G2 | reconcile→seed | one idea-325 run → 9 file:line-located tele-tagged bugs | work-21/22/23/26/27/28/29/31/32 |
| G3 | **autopoietic tele-audit** | audit→idea→ground-truth→bug→fix→gate | work-40→idea-362→work-42→bug-187..195 |
| G4 | **verifier-finding→class-gen→primitive-fix** (marquee) | one CONCERN → substrate-correctness fix before merge | work-33/35/36→bug-187 |
| G5 | dogfood→live-findings; **stint-as-dogfood** | running real work IS the 3rd dogfood unblocking C1-widen | bug-180/181/185/182/186; work-38 |
| G6 | execution→recursive follow-on arcs | ideas generate ideas (super-linear) | idea-358/359/360 from mission-95; idea-357 from idea-353 |
| G7 | adversarial-review→idea | "local gap becomes kernel-wide" hunt | idea-358 from wf_9d2be7b3 |
| G8 | friction→idea/bug | every friction became a tracked arc | idea-357/361/353; bug-185/195 |
| G9 | Survey→Design on-ramp during build slack | C2 survey prepped Director-ready | work-37/#393 |
| G10 | Director as live-harvester + machine-designer | 7/14 ideas Director-lodged; designed the loop itself | idea-349..357; work-19, wf_29ee09e3 |
| G11 | **governance-relaxation→org-self-records** | calibration filing-gate relaxed (tele-13) | PR #370; cal #85-88 |
| G12 | stint-close→pre-seed-next + Director-gate staging | org self-generates the Director's agenda | work-30/37/38/39 |
| G13 | self-documentation | org wrote its own engine mid-stint | operating-model PR #380 |
| G14 | self-drive backstop validated LIVE | leaseExpiryCount=2 | work-19 |

**Engine-v2 improvements (second-order — the answer to "get BETTER at finding the most-valuable next work"):**

> **THE BOTTLENECK IS INCORPORATION, NOT GENERATION.** ~14:1 generation:incorporation; 248 open ideas; zero triage tags on the stint cohort; oldest "ready" ideas ~2.5 months old. The highest-leverage move is **NOT more generation but mechanizing triage + ranking + run-first reconciliation** so the org reliably surfaces and acts on its most-valuable next work. Concrete v2 moves (each → a new_idea below): close the idea funnel (S1), mechanize reconciliation as a verb (S2), calibration Phase-2 write-verb+validate+auto-surface (S3/idea-356), work-queue observability (S4/idea-357), friction→first-class entity (S5), merge-train→tool (S6), verifier-audit-as-standing-deliverable (S7), generative-health telemetry + tele-ranking (S8), stint-close-packet auto-assembly (S9), work-19 anchor hardening (S10).

**Two cross-cutting generative disciplines to codify as hard axioms:** *fix-the-class-not-the-instance* (tele-8, with cal #88's band-aid-files-its-class-residual corollary — makes generated work durable) and *ground-truth-over-narrative* across sizing/seeding/audit-promotion/deploy-diagnosis (protects every loop from phantom/duplicate output).

---

### DIMENSION-ROUTING INDEX (every harvested learning → durable home)

| Learning | Durable home | Status |
|---|---|---|
| Deploy-spine blind spot / phantom watchtower | bug-195 + bug-107 + idea-357 + cal #85 | bug-195/107 OPEN; cal #85 filed |
| Stale-ledger trap / reconcile-first | methodology (ledger-reconciliation.md) + op-model §7 | TO FOLD |
| Tool-surface cache stale-on-redeploy | **calibration (NEW)** + bug-180 | bug-180 fixed; cal TO FILE |
| tele-7 async-seam silent-failure class | **calibration (NEW named pattern)** + bug-194 + bug-190(work-44) | TO FILE |
| Park-state gap / built-but-blocked | bug-185 + mission-lifecycle pivot-discipline | OPEN |
| CI-flake / guard-scope / faithful-harness | cal #88 + cal #79/#82 recurrence + FR-32 | #88 filed; #79/#82 BANKED |
| Ground-truth-over-assumption (4 surfaces) | **calibration (#85 generalize)** + director-profile | TO FILE |
| Calibration loss-risk + hygiene | FR-34 + file #89/#80/#79 + normalize #60/#62 + idea-356 | BANKED — file now |
| Merge-gate one-size / version-gate / round-limit | FR-31 + FR-33 + cal #87 | #87 OPEN; FRs TO APPEND |
| Idea funnel / triage cadence | methodology (strategic-review.md) + new idea (S1) | TO FOLD |
| FR-23 operator-as-lifecycle-bottleneck | friction-backlog FR-23 + C2 arc (work-37) | partial fix #365 |
| Queue self-wake / NO-MANUAL-PINGS | operating-model §5 | TO FOLD |
| work-19 anchor + backstop live | operating-model §0 | TO FOLD |
| Verifier-gate mandatory + generative | operating-model §5 | TO FOLD |
| CI-gated merge-train / Vehicle-C / pivot-not-pause / held-time-verify | operating-model + multi-agent-pr-workflow.md | TO FOLD |
| Pulse-free default | operating-model §5 (bug-162) | TO FOLD |
| Fix-the-class + band-aid-residual (cal #88 corollary) | operating-model §7 axiom | TO FOLD |
| All 14 generative loops + §9 lessons | operating-model §0-§7 (fold from §9) | TO FOLD |
| Calibration governance relaxation (tele-13) | operating-model + director-profile | filed (CLAUDE.md) |
| Director mode (delegate+name-focus+curate+design-the-loop) | director-profile | TO RECORD |
| Director deploy-posture (gate backplane only) | director-profile + op-model §6 | TO RECORD |
| idea-356/357/358/359/360/361/362 | Idea entities | filed (verify existence) |
| bug-185/187/188/189/190/191/192/193/194/195 | Bug entities | filed (#190/194 await fresh effort) |
| Engineer + verifier first-person frictions | friction-backlog FR-20 | **NOT YET COLLECTED** |
| Deferred adversarial council | friction-backlog FR-20 | **DISPOSITION OWED** |
| CDACC run-672bd0f drift-map + PING-DIRECTOR | standing obligation | **OPEN** |
| tele-0 staleness (still says 1-10) | vision-synthesis | OPEN |

---

### OPEN DIRECTOR-DECISIONS (full list in Section 5)

1. **C1-widen go/no-go** (work-38) — 3 dogfoods proven incl. this stint's build-loop.
2. **C2 Agent-Lifecycle Survey** (work-37/#393) — 6 picks, retires FR-23 operator-bottleneck.
3. **Backplane/storage deploys** (e.g. bug-121 cluster) remain Director-gated hard-line.
4. **idea-121 focus + bug dispositions** (work-39: bugs 146/172/185/162).
5. **bug-107 disposition** — latent-real token race, MIS-APPLIED as the stint-3 explanation; reframed by DR-S3-013; likely superseded by bug-195. Director to confirm.
6. **Deferred adversarial council** — convene now (as part of this retro, with multi-seat intake) or re-defer explicitly.
7. **High-evidence calibration PROMOTION** — extend architect-driven (n≥20, peer-verified) to clear the #62 ~7-week bottleneck?
8. **CDACC run-672bd0f** — drift-map completion gates C3-R6/C4-R5; the PING-DIRECTOR obligation is still owed.
