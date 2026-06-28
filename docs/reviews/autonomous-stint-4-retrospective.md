# Autonomous Stint-4 Retrospective — "Bank-the-Base"

> **This document is a VIEW over the durable homes, per ADR-030.** It does not store the learnings — it indexes where each one lands. The durable storage is the calibration ledger (`docs/calibrations.yaml`), the friction-backlog (`docs/methodology/autonomous-stint-friction-backlog.md`), the Idea + Bug entities in the Hub, the operating-model (`docs/methodology/autonomous-stint-operating-model.md`), and the director-profile. Read this doc for the gestalt; query those homes for ground truth. Authored at stint-4 close (2026-06-28).
>
> **Close-out method (stint-4 improvement):** this retro was produced by a parallel harvest workflow (6 surface-harvesters → synthesize) followed by an **adversarial completeness-critic pass whose every flagged gap was ground-truthed before this doc was persisted** (see §Verification Log). No claim in this doc is carried from the harvest unverified. This is the down-payment artifact for **M-Stint-Lifecycle (idea-380)** — the formalization+mechanization of the stint lifecycle the Director directed at close.

---

### Headline

**Stint-4 was a second consecutive strong BANKED stint — the org built the instruments to attack its two binding constraints (observability + selection/incorporation), and for the first time NAMED the summits the base is banked FOR.** It shipped the observability/selection toolchain live (prod `80075f1`, PRs #400–410): the `list_work` org-state snapshot, a git-aware reconcile CLI cross-validated against an independent hand-audit, and `get_backlog_health` + triage-tag stamping. Mid-stint, the org's own healthy parallel load detonated a **429 coordination-plane storm** — which it decomposed into orthogonal roots and banked as durable substrate rather than band-aiding the rate limit. The verifier gate went **5-for-5 on real pre-merge catches** (no false positives — a precision step up from stint-3's ~43% over-call), and the self-drive backstop **self-recovered a second consecutive stint** (work-45, `leaseExpiryCount=1`).

The honest asymmetry: this stint banked the **instruments**, not the **relief**. Observability is HALF-banked (the PULL/read half shipped; the PUSH/event half — idea-357 parts 1-2 — is unbuilt). Selection is banked-the-tool, not-relieved-the-bottleneck (still 265 open / 56 incorporated; generation outpaces incorporation ~14:1). And the dominant cross-cutting irony: **the stint shipped to FIX observability, yet discovered its own observability gaps by tripping over them in production** (the 429 storm's roots were the very list_bugs usability gaps the stint existed to close; `get_backlog_health` shipped uncallable from its author's session). **Two consecutive banked stints means the staking-decay clock now runs: C2 (+1) and D-1 (+2) MUST stake next stint or the banked base re-prices as dead capital.**

### By the numbers

| Metric | Value |
|---|---|
| FOCUS | **"Bank-the-Base"** (observability + selection/incorporation) — first stint to also NAME its staked summits (C2 +1; D-1 +2) |
| Prod HEAD | `80075f1` (all merged to main 2026-06-28; verified vs `git log origin/main`) |
| PRs merged | #400–410 (op-model v2 #400; R1 #401; R2 #402/#403/#408; deploy-spine #404; 429 fix-chain #405/#407/#410; R5 #409) |
| Throughput baseline | **11 PRs in ~5.5h ≈ 1 PR / 30 min** (#400 11:24 → #410 16:58 AEST), with a ~3h 429 incident concurrent — comparable to stint-3's ~1 PR/15-20min, slower-by-design given the incident + heavier per-PR verify |
| Bugs surfaced | 7 (bug-195–201) — 5 major, 2 minor; by origin: verifier 3, architect 2, engineer 2 |
| Bugs banked (resolved+live) | 5 (bug-196/197/198/200/201); STAKED open: 2 (bug-195 deploy-CD, bug-199 tool-catalog) |
| Ideas surfaced | 6 (idea-374–379), ALL `open`, none with a missionId |
| Ideas incorporated this stint | 1 (idea-363 → #409); idea-364 reconcile CLI **banked as working substrate** |
| Bugs curated (reconcile R2) | 30 mutated (18 fixCommit backfills + 6 squash-sha corrections + 6 cross-repo→missioncraft) + ~34 long-tail recorded |
| Verifier gate | **5-for-5 real catches, 0 false-positives**; 3 spawned calibration candidates |
| Self-drive backstop | self-recovered (work-45, `leaseExpiryCount=1`) — twice-validated across consecutive stints (see §5 caveat) |
| Coordination pings | 0 in the normal path; ONE incident-driven Director-relay fallback during the 429 storm |
| Funnel (lifetime) | 379 total / 265 open / 56 incorporated / 25 triaged / 33 dismissed; incorporation rate 14.8%; per-stint generation:incorporation ≈ 14:1 |

**Retrospective mode:** observability/selection-substrate hybrid → this document is the summary-review; the engine-adherence + calibration fold is the structural output.

---

## 1. FOCUS + Outcome Verdict

**FOCUS (ratified): "Bank-the-Base"** — bank the observability substrate (make org-state legible) + the selection/incorporation substrate (make backlog curation legible and cheap). First explicit ratified FOCUS to also name its staked summits, curing the stint-3 "banked-with-no-named-stake" anti-pattern at the framing level.

**VERDICT: ACHIEVED, with one honest asymmetry — a strong BANKED stint that satisfied §1(c) (it named what the base is banked FOR).**

- **SELECTION/incorporation substrate: BANKED.** reconcile CLI (idea-364) validated end-to-end + cross-validated vs an independent hand-audit; backlog-health + triage tags (idea-363) live; 30 bugs curated + ~34 long-tail recorded. The INSTRUMENT to attack the incorporation constraint is banked — but **the constraint itself is NOT relieved** (still 265 open / 56 incorporated; ~14:1 generation:incorporation). Banked-the-tool, not yet relieved-the-bottleneck.
- **OBSERVABILITY substrate: HALF-BANKED.** The PULL/read half (list_work snapshot, lease-as-first-class-column) is banked. The PUSH/event half (idea-357 parts 1-2 — the part that makes the queue self-wake push-native, the tele-13 payoff) is **unbuilt and carried**.
- **SubstrateBanked rung honored (stronger than scoped):** the ship-integrity base got banked via the bug-107 watchtower AR-token-race fix-live-and-codified (#404) + concurrency-cancel (#405) — the real fix, stronger than the originally-scoped bug-195 gate-widening. This DISPROVED the stint-3 "watchtower-functional/gate-too-tight" read: the #401 deploy genuinely never rolled for 14+ min — it was bug-107's real token-race, not a tight gate. **bug-195 itself stays OPEN.**
- **Banked-vs-staked outcome:** the §3 observability-multiplier **cashed** — the 429 incident concretely proved observability rungs raise every other rung's reliability. But **near-zero summit in-degree was created this stint** → the staking-decay clock runs (see §8).

---

## 2. What Shipped + Tele-Coverage

**SHIPPED + LIVE (prod `80075f1`):**

- **R1 — `list_work` org-state-snapshot verb (#401, idea-357 part-3a/3b).** Observability PULL keystone: filter by status/role/mission/holder/lease-state; lease as a first-class projected column; truncation-honest. **PULL half only** — the PUSH half (parts 1-2: WI-transition + CI/deploy events) was NOT built; idea-357 stays `open`.
- **R2 — Bug `repo` scope-field (#402) + git-aware reconcile CLI (#403, idea-364) + cross-validation vs steve's hand-audit (#408).** merge-base main-ancestry checks + squash-sha recording + repo-scope; 3 disposition buckets (needs-backfill / claims-fixed-not-in-main / fixed-but-still-open); auto-backfills only the safe additive bucket. idea-364 stays `open` (full mission scope remains).
- **R5 — `get_backlog_health` + `update_idea` addTags + triage-vocab (#409, idea-363).** Selection instrument: backlog count + age histogram + triage-tag stamping. idea-363 INCORPORATED.
- **429 fix-chain (all live, smoke-validated):** #405 proxy concurrency 1→80 (bug-197), #407 filter-optionality empty-optional→UNSET + compact projection (bug-198/196), #410 scan-cap honesty + update_bug addTags (bug-200/201). See §3.
- **Deploy-spine (#404, work-55):** bug-107 watchtower AR-token-race fixed live + codified in terraform; concurrency-cancel for deploy-hub batch-churn (#405).

**TELE-COVERAGE (per-rung):**

- **Served strongly:** **tele-1** (Sovereign State Transparency — list_work honest snapshot + reconcile ground-truth ledger + backlog-health); **tele-4** (Zero-Loss / no-silent-failure — scan-cap honesty, filter-optionality fail-usable, reconcile stale-detection, the whole anti-silent-blindspot theme); **tele-7** (Resilient Ops — concurrency fix, deploy-spine self-healing token-refresh, fail-loud refresh.sh); **tele-13** (amplify Director attention / org self-drives — backlog-triage, reconcile-zero-cost-gate, list_work as the controller's ground-truth read).
- **Touched:** **tele-3** (codify deploy drift into terraform; repo-scope stops cross-repo accretion); **tele-6** (substrate must not collapse under the org's own coordination load); **tele-11/12** (list_bugs compact payloads).
- **GAP/violation surfaced — tele-5 (Perceptual Parity):** the tool-catalog-staleness incident (bug-199/bug-180) — `get_backlog_health` deployed but uncallable from the architect's running session — is a literal perceptual-parity failure: the architect's session perceived a different tool surface than prod. Ironic on an observability-FOCUS stint; named as a tele-5 follow-on.
- **Untouched (acceptable — out of FOCUS):** tele-2 (isomorphic spec), tele-8 (formal layer-cert; verifier-gate adjacent), tele-9 (chaos-validated deploy — deploy-spine touches, no chaos-path), tele-10 (autopoietic — reconcile is a step toward self-correction, not the auto-spawn loop).

---

## 3. The 429 Incident (root + response + lessons)

**Symptom:** during a prod Bug-ledger survey to re-gate the #403 reconcile CLI, steve's `list_bugs` queries failed from his adapter surface → he fell back to many individual `get_bug` ID-sweeps → bursts overran the hub-api Cloud-Run relay → 429 ("Rate exceeded") → adapter "Hub not connected" → reconnect-retry → more load (self-amplifying). The whole coordination plane intermittently degraded for ~3h, concurrent with R2/R5 work.

**Root-cause chain (one line):** verifier needs ledger survey → can't list (bug-198 adapter-shape filter gap) → even if he could, list is too fat (bug-196) → falls back to get_bug ID-sweeps → burst overruns concurrency=1 relay (bug-197) → 429 storm, self-amplified by reconnect-retries.

**3-root decomposition + 2 latent siblings (the org split the symptom across the stack rather than bumping the rate limit):**

1. **bug-198 — ACUTE/trigger root (filter-optionality gap):** empty/unset optional filters were AND'd as exact-empty matches instead of OMITTED → status-only query returned `_ois_query_unmatched`. **Adapter-shape divergence made it surface-specific** — opencode (steve) serializes unset optionals as empty-string/array; claude (lily) omits them → identical call WORKED for lily, FAILED for steve. Fixed #407.
2. **bug-196 — behavioral root (no compact projection):** ~200KB for 100 bugs → even a WORKING list is unconsumable → sweep incentive persists. Fixed #407 (compact on list_bugs + list_ideas/list_missions/list_audit_entries).
3. **bug-197 — infra root (concurrency=1):** `proxy_cpu=0.5` IMPLICITLY pinned Cloud-Run containerConcurrency to 1; MCP adapters hold long-lived SSE streams (one per agent), so steady-state was already near budget; steve's burst exhausted it. **Live-applied first** (rev hub-api-00002-5td) to stop the bleed, **THEN codified** in terraform (cpu→1, concurrency=80) so an apply can't silently revert.
4. **bug-200 — latent sibling (silent 100-cap):** listBugs passed no limit → capped page AND total at 100 with no flag (total:100 lied vs psql:198) — a tele-4 fail-loud violation. Found DURING fix-verify. Fixed #410 (limit:500 + truncated flag; whole-class grep confirmed listBugs was the lone outlier).
5. **bug-201 — latent sibling (update_bug tag-clobber):** replace-only tag write would wipe tags on an incremental stamp; mattered because reconcile.py --apply does exactly that. Fixed #410 (addTags via the mergeTags helper #409 shipped).

**Response — done WELL:** correct layered decomposition (resisted "just bump the limit"); stop-the-bleed-then-codify (infra-as-truth); verifier paid for itself inside the fixes (#407 missionClass drop, #410 cousin-bug); whole-class hygiene (compact→4 handlers, filter→3, grep-proved the cap outlier); mutation-proven tests (revert→red); adapter-aware diagnosis (lily diagnosed the opencode/claude serialization divergence rather than "works on my surface").

**Slow/avoidable:** self-amplification (no client-side backoff/circuit-breaker — a transient burst became sustained degradation); the trigger was self-inflicted by the very missing observability primitives the stint existed to ship; concurrency=1 was an accidental config (nobody chose 1 for an SSE relay); the honesty-fix-introduces-adjacent-dishonesty blast radius (#410 cousin) was caught by re-gate, not by the author.

**Durable lessons (all routed in §6/§7):** faithful-to-input-SHAPE (adapter-divergence is a first-class test axis); emit-null-not-omit in projections; whole-class scope = every signal the FIX's code path touches; silent caps are tele-4 violations (mirror the honest primitive, list_ready_work); decompose-don't-bandaid; reuse-the-primitive (mergeTags); live-apply-then-codify; the verifier gate is load-bearing under speed (don't skip re-gate on fast fix-chains — that's where cousin-bugs hide).

**Prevention banked:** bulk-survey primitive (compact + correct filter-optionality + honest caps) now live across list_bugs/list_ideas/list_missions/list_audit_entries → the get_bug-sweep incentive is structurally removed; infra fix codified so concurrency=1 can't recur on apply. **Still OPEN:** client-side backoff/circuit-breaker for the 429→reconnect self-amplification (strategic exits: idea-357 push-events, idea-377 k8s deprecates the relay entirely).

---

## 4. Generation / Incorporation Analysis

**Generation:** 13 backlog items — 7 bugs (195-201) + 6 ideas (374-379).
- Bugs by class: observability/list_bugs usability trilogy (196/198/200, all major); coordination-plane infra (197 + 195); tool-surface/cache (199); Hub primitive gap (201).
- Ideas by cluster: reconciliation family (374 PR-ledger reconcile / 375 Bug FSM walk-back / 379 reconcile.py --apply mechanization); deploy-spine/infra (376 bug-107 follow-ups / 377 k3s-deprecate-watchtower, Director-surfaced, structural-inflection); calibration/methodology (378 faithful-to-input-shape).

**Banked-vs-staked split:** bugs **5:2** (71% banked; both stakes VM/structural-gated, not deferrable-cheap); ideas **0:6** (100% staked — generation lands as backlog by design of the funnel).

**Incorporation-constraint readout:** lifetime incorporation = 56/379 = **14.8%**; open = 69.9%; standing open:incorporated ≈ 4.7:1; per-stint ≈ **14:1** generation:incorporation. **Generation is NOT the scarce resource** — the org out-generates its ability to select-and-incorporate by ~14:1 and carries 265 un-incorporated open ideas. The 265-pool is not a backlog to "clear" by generating less; it is a **selection problem** (which ~14% to pull through). This stint invested in the **measurement layer** (the instruments that make selection legible) before the throughput layer — attacking the constraint where it's cheapest to attack first.

**Forward-investment assessment:** the staked items are deliberately the **structural-elimination bets** that retire the very constraint-classes that bit this stint, not the cheap patches (which were banked):
- **idea-377 (k3s)** SUBSUMES bug-107 + bug-195 + idea-376 — Workload-Identity auto-refresh kills the token-race by construction; `kubectl rollout status/undo` retires the roll-gate. Largest infra forward-bet.
- **D-1 (REST control-plane, +2)** is the structural answer to THIS stint's acute incident (the concurrency=1 → 429 fragility is a symptom of the MCP-proxy relay; D-1 replaces it, doesn't patch its knob). Highest-magnitude staked summit.
- **C2 (agent-lifecycle, +1, Survey #393)** — nearest-to-pull summit.
- **Reconciliation cluster (374/375/379)** — forward-investment in the OTHER constraint: keep the ledger trustworthy as generation outpaces incorporation (defend the selection surface itself).

---

## 5. Verifier-Gate + Process

**5-for-5 real catches, 0 false-positives** (precision step up from stint-3's ~43% LLM-auditor over-call):

| # | PR | Catch | Class | Ship-silent? |
|---|---|---|---|---|
| 1 | (state) | bug-181 fixed-but-open | ledger-reconciliation / projection-honesty | Not a code regression, but perpetuates a dishonest/stale ledger entry (phantom open work-candidate) + a live tele-4 honesty defect on the work-queue. Real, low-criticality |
| 2 | #403 | envelope-misclassification (decode-omission) | shape-faithfulness | **YES — self-defeatingly:** the CLI built to FIX the stale ledger would have silently mis-curated it (resolved→open). HIGHEST-VALUE. → idea-378 |
| 3 | #403 | substring-backfill (false fix-attribution) | matching-precision (squash-sha-trap) | **YES** — would stamp wrong fixCommits, corrupt provenance, no error |
| 4 | #407 | missionClass undefined-drop | projection shape-consistency (emit-null-not-omit) | **YES** — consumer hits a missing key (not null), breaks field-access silently |
| 5 | #410 | `_ois_query_unmatched` cousin-bug | whole-class-scope (fix-introduces-adjacent-instance) | **YES** — sibling path still returns misleading certainty / silent under-report. Sharpest discipline catch |

**Cross-pattern:** 4/5 catches were ON the very PRs delivering the FOCUS (the observability fixes had their own observability bugs); 3/5 are SHAPE/HONESTY-class (exactly the tele-4 faithful-shape/fail-loud class being banked); 3/5 generated calibration candidates. The gate was not just a net — it mined the stint's highest-signal architectural learnings. The same adversarial seat (steve) also surfaced the incident's deepest root (bug-198) during the work-50 audit.

**Gate-discipline verdict: HIGH and rising.** Advisory-in-authority held cleanly (verdicts informed; architect-approve remained the merge gate). **Net recommendation: EXTEND the §5 "mandatory verifier-gate on backplane/deploy slices" mandate to projection-honesty / observability slices too** (4/5 catches were on projection PRs, not backplane PRs).

**Backstop validation: twice-validated across consecutive stints — promotion to "load-bearing" is GATED, not yet earned.** work-45 anchor lease expired once → requeue → idea-353 claimable-digest re-wake → clean re-claim (`leaseExpiryCount=1`), zero manual intervention. Combined with stint-3 (`leaseExpiryCount=2`), that is **3 clean recoveries total across 2 stints, all on the SAME anchor mechanism** — strong evidence the convention works, but a small per-event sample on one mechanism. **Promotion from "validated convention" to "load-bearing proven primitive" is deferred until the refResolvable Hub-enforcement hardening lands** (the thing that makes it a Hub-enforced lock rather than a documented convention). The lease-expiry-race itself is a residual (FR-38).

**Engine-adherence (operating-model v2): STRONG.** First explicit ratified FOCUS, all banked rungs shipped+live. SubstrateBanked honored (deploy-spine fixed-live-and-codified). §3 observability-multiplier cashed (the 429 incident proved it). NO-AGENT-IDLE held (three-role parallel; steve's parallel ledger-survey surfaced bug-196/198/200 while greg built the fix-chain — adherence high enough that healthy parallel load stress-tested + exposed the concurrency=1 fragility). NO-MANUAL-PINGS held in the normal path with ONE incident-driven Director-relay exception (coordination plane degraded mid-storm — fallback, not a discipline lapse; restored once #405 bumped concurrency).

---

## 5a. Multi-Seat Intake (FR-20 discharge)

Stint-3's retro established that an architect-only third-person retro is the exact defect FR-20 was filed to prevent. This stint solicited first-person intake from both peer seats before close (thread-738 greg, thread-739 steve; both replied within ~2 min — the parallel-queue, not-a-blocker framing worked). **FR-20 status: tri-seat DISCHARGED.**

**Engineer (greg) — first-person:**
- _Frictions:_ concurs merge-churn (FR-35) + lease-race (FR-38). Adds **FR-39 work-item-lifecycle-opacity** (held work-59 in `claimed`, renewed ~90 min, then `complete_work` REJECTED — "requires in_progress, was claimed"; the stall-prompt only ever offers renew/block/abandon, never surfaces "you haven't started this"; claim→start→complete is invisible until it bites at completion). Re-confirms tool-catalog-staleness (FR-37) from the sharpest angle: _"I ship a verb I then can't call from the seat that built it."_
- _Read-corrections (folded into §3):_ (a) the 429 root is **compound** — fat payload (bug-196) + concurrency=1 (bug-197) + empty-filter (bug-198); filter-optionality was the **trigger**, not the root. (b) the reconcile cross-val divergence (greg-134 vs steve-100) was **NOT a logic gap** — steve's hand-audit hit the list_bugs cap (= bug-200); the cross-val validated the instrument AND surfaced the cap as a finding.
- _Calibration adds (→ §6):_ **truncation-honesty-as-list-contract** + **per-status-accurate-aggregate**; strengthens **fix-time-same-handler-sweep** with the bug-200 evidence ("fix the class includes the path your own fix sits next to").
- _Process improvement (→ M-Stint-Lifecycle):_ formalize **scope-first design-review keyed off rung-concreteness** — concrete rung → build direct; fuzzy rung → engineer surfaces shape+size+cal-88 path-enum → architect design-reviews → THEN build. idea-363/R5's clean one-pass is the proof case (it was under-specified; the design-review-first produced a one-pass build instead of building blind).

**Verifier (steve) — first-person (thread converged, close_no_action committed):**
- _Highest-value catch:_ **#410 cousin-bug** — "a second-order correctness regression inside the fix … it would have replaced silent under-reporting with false certainty." _Near-miss:_ the stale-checkout on #410 (gated against a scratch checkout not advanced to the PR head SHA; re-gate corrected it). → FR-36.
- _Frictions:_ concurs FR-36 + the gate-vs-merge authority split ("my GitHub approve is not the branch-protection authority; the WorkItem verdict is the quality gate, architect approval is the merge gate"). Adds: **WorkItem-before-PR-verdict ordering** — a WorkItem appearing AFTER a PR review forces a duplicate review artifact; create the WorkItem before requesting the verdict.
- _429 read:_ concurs the compound-stack read; confirms the prevention works for his seat — _"I can bulk-scan compact, narrow with filters, and treat `truncated:true` as an explicit floor instead of spawning get_bug sweeps."_ The ID-sweep incentive is materially removed.
- _Process improvement (→ op-model §5 + M-Stint-Lifecycle verifier-gate spec):_ **SHA-pinned verifier preflight** — fetch PR head → assert local `HEAD == headRefOid` → inspect CI/merge state → run the positive probe + one negative/mutation probe → post the verdict AFTER the WorkItem claim (so the evidence is fresh and single-artifact). This becomes the canonical verifier-gate preflight.

**Tri-seat convergence:** all three seats agree on the 429 compound-stack read, the verifier-gate value, and the calibration set. No seat raised a material disagreement with the architect synthesis — the corrections were refinements (trigger-vs-root, cap-vs-logic), now folded.

---

## 6. Calibrations to File (at stint-close, per FR-34 banked-loss obligation)

> **Filing is STILL MANUAL.** idea-356 (M-Calibration-Mechanization-Phase-2, the `calibrations.py add/validate` write-verb) is verified `open` (unshipped) — so the FR-34 banked-loss risk stint-3 hit is LIVE this stint too. The id-92/93 + amendment edits below are hand-authored into `docs/calibrations.yaml` in this same PR; **the PR MUST merge before stint-4 is declared closed** (FR-34 process rule). Next-monotonic IDs verified against the current ledger before assignment.

| Pattern-name | Evidence | Disposition |
|---|---|---|
| **FAITHFUL-TO-INPUT-SHAPE** — a data-processing tool must be validated against the REAL production INPUT shape, not merely that its mechanism executes | idea-378; #403 reconcile.py envelope-misclassification + substring-backfill; verifier catch #2/#3. The #79 false-green failure mode, but on INPUT DATA shape not TEST-fixture shape | **AMEND #79 + #82** with a stint-4 extension note generalizing faithfulness beyond test harnesses to any production-data-processing/reconciliation tool. Xref idea-378 + #403 |
| **EMIT-NULL-NOT-OMIT** — a projection must emit explicit null for an absent field, never omit it (JSON.stringify drops undefined → shape-inconsistent key-sets) | #407 missionClass undefined-drop in list_bugs compact projection; verifier catch #4. Same mechanism as the RETIRED #19, on a new surface | **NEW — next id, class=substrate.** Xref #19 (storage-side ancestor) + #407. Peer-verified by steve's catch |
| **FIX-TIME SAME-HANDLER SWEEP** — a fix for a class defect (misleading-certainty / silent-truncation) must sweep every ADJACENT signal in the same handler the fix touches | #410 `_ois_query_unmatched` cousin; verifier catch #5. Sibling of #88 + #80 | **AMEND #88** with a THIRD face (FIX-TIME-adjacent-signal-in-same-handler). #88 OPEN → in-place. Xref #410 + #80 |
| **SQUASH-SHA RECONCILIATION** — reconcile fix-SHAs against main-ancestry (`git merge-base --is-ancestor`) and record the SQUASH SHA, not the branch SHA; substring-matching a SHA is a trap | R2 curation: 6 squash-sha corrections (bug-24/93/167/168/169/170) + 18 backfills; #403 substring trap; bug-181 (branch 9ec45ee squashed, real fix 5c64f58); cross-validated vs steve hand-audit | **NEW — next id, class=methodology.** Mechanized in reconcile.py (idea-364). Xref idea-364 + #403. Peer-cross-validated |
| **TRUNCATION-HONESTY-AS-LIST-CONTRACT** (engineer-seat, greg) — any bulk-list/aggregate that can hit a scan-cap MUST emit `truncated`; ANY certainty derived from a capped scan (count, total, "zero matches", "definitively none") is a lie unless guarded by it | bug-200 (listBugs total:100 lied vs psql:198) + bug-201-adjacent `_ois_query_unmatched` over a truncated scan (steve catch #5) + get_backlog_health; positive contract behind the #410 fix | **NEW — next id, class=substrate.** tele-4 fail-loud for list surfaces. The positive design-contract peer of FIX-TIME-SAME-HANDLER-SWEEP. Xref #410 + #88. Peer-surfaced (greg) |
| **PER-STATUS-ACCURATE-AGGREGATE** (engineer-seat, greg) — to get an accurate aggregate over a cap-limited substrate, query per-partition (each < cap) and sum, rather than one capped list | get_backlog_health funnel total (per-status listIdeas ≤500 → accurate 379-total despite the single-list cap) | **CANDIDATE — class=methodology; possibly FOLD into TRUNCATION-HONESTY-AS-LIST-CONTRACT** as its constructive corollary. Director-curate. Xref #409 |
| **GATE-THE-HEAD-SHA** — a verifier's PASS must pin + RECORD the exact HEAD SHA it verified (verified-SHA ≠ head ⇒ verdict void) | FR-36 — steve re-gated #410 on a stale local checkout | **WORKFLOW-FIX + FRICTION (FR-36)**, NOT yet a calibration (first occurrence). Fold into op-model §5 verify-discipline (fetch + rev-parse + record-SHA); calibrate on recurrence |
| **GATE-vs-MERGE AUTHORITY SPLIT** — the verifier's PASS is an advisory RELEASE-gate, not a branch-protection APPROVAL; the architect's review IS the merge-gate | stint-4 merge-churn — verifier-approve doesn't satisfy required-approval. Sharpens steve's stint-3 verifier-intake friction-2 + FR-31 | **WORKFLOW-FIX / DOCUMENT** — codify the two-authority split in op-model + the FR-31 cross-approval matrix. Not a calibration (authority clarification, not a pathology) |

**Recurrence escalation:** cal **#91** (tool-catalog cache) += stint-4 bug-199. **Precision note (verified):** bug-180's structural fix `ade10cf` is **merged but smoke-PENDING** (bug-180 status `investigating`, tag `fix-merged-smoke-pending`, work-5 AC1 live smoke unrun) — and bug-199 is the **schema-granularity facet** of the same root (a stale per-tool inputSchema, not just a stale verb-list). So #91 escalates to **"fix-merged-but-not-yet-smoke-verified AND already recurred as a new facet"** — NOT "fix shipped but recurred." Recommendation rider: extend the work-5 AC1 smoke to assert schema-level refresh (a changed inputSchema on an existing tool propagates), not only new-verb appearance.

_Final id assignment (92/93) is pinned against the live ledger tail at filing time in this PR; the table uses "next id" to avoid an ID-race against any concurrent filing._

---

## 7. Frictions (append as FR-35+; backlog ends at FR-34)

| Friction | Recurrence | Mechanization-fix |
|---|---|---|
| **FR-35 — MERGE-CHURN** (stacked-PR + require-up-to-date + dismiss-stale-reviews + async-message-crossing → repeated update-branch→re-CI→re-approve loops; ran many times this code-heavy stint) | **3rd+ stint** (= FR-6 + FR-31). Mechanization overdue | Enable GitHub **merge-queue / auto-merge** (collapses N cycles into one, removes BEHIND-thrash) — the not-yet-shipped code-PR half of FR-31. Pairs with the cross-approval matrix for the dismiss-stale leg; async-crossing = FR-29 class. **COUNCIL-or-FIX-NOW** |
| **FR-36 — STALE-CHECKOUT-GATING** (steve gated #410 against a local checkout missing the PR head SHA → certified non-merge-candidate code) | **NEW** (sibling of FR-15 read-projection lag, but the verifier's working tree is the stale surface) | Verifier must `git fetch` + assert `rev-parse HEAD == <PR head SHA>` BEFORE a verdict, AND record the verified SHA (stale re-gate mechanically detectable). **FIX-NOW** (op-model §5) |
| **FR-37 — TOOL-CATALOG-STALENESS** (bug-199/bug-180 — get_backlog_health deployed but uncallable from the architect's running session; the just-shipped verb was uninvocable from the session that shipped it) | **3rd recurrence AND post-structural-fix-merge** (= FR-21 + cal #91; note the #362/ade10cf fix is merged but smoke-PENDING) | Make the #362 invalidation path DEFAULT — block first ListTools on a /health revision-check OR emit `notifications/tools/list_changed` on revision-drift. Single-home consolidation (mission-95) kills the adjacent stale-kernel family. **COUNCIL/IDEA — high priority** (it directly undercuts the FOCUS) |
| **FR-38 — LEASE-EXPIRY-RACE on an active anchor item** (work-45 lease expired once mid-work → requeue → digest re-wake → clean re-claim; **backstop WORKED**) | **NEW as active-anchor** (same lease-regime-doesn't-fit-long-work CLASS as FR-27) | Auto-renew/heartbeat the lease during active anchor work (`renew_lease` exists — wire to active progress; this stint I renewed each turn but still tripped once), OR an anchor-class longer lease. **ACCEPT-leaning** (backstop worked, low-priority); candidate IDEA if leaseExpiryCount climbs |
| **FR-39 — WORK-ITEM-LIFECYCLE-OPACITY** (engineer-seat, greg — held work-59 in `claimed`, renewed ~90 min, then `complete_work` REJECTED: "requires in_progress, was claimed"; the stall-prompt only offers renew/block/abandon, never "you haven't started this" → claim→start→complete is invisible until completion bites) | **NEW** (sibling of FR-37 perceptual-parity class, on the WorkItem FSM rather than the tool surface) | Auto-`start_work` on first `renew_lease` of a `claimed` item, OR surface the claim→start gap in the stall prompt (offer start alongside renew/block/abandon). **FIX-NOW** (small adapter/Hub change) |
| **(verifier-seat add, folds into FR-36) — WORKITEM-BEFORE-PR-VERDICT ordering** (steve — a WorkItem appearing after a PR review forces a duplicate review artifact) | refines FR-36 | Create the verifier-gate WorkItem BEFORE requesting the PR verdict, so the SHA-pinned preflight + verdict are a single fresh artifact. Folds into the op-model §5 verifier-gate preflight mechanization |

---

## 8. Carry-Forward / Next-Stint Inputs

**THE BINDING OBLIGATION — STAKING-DECAY CLOCK IS RUNNING.** Two consecutive textbook BANKED stints (stint-3 + stint-4) with near-zero summit in-degree created. Per operating-model §3 refinement 4 / §8: **the next stint MUST convert at least one staked summit or the banked base re-prices as dead capital. Do not bank a third consecutive stint.**

> **Director-directed next FOCUS (stint-5): M-Stint-Lifecycle (idea-380)** — formalize + mechanize the autonomous-STINT lifecycle, peer to the Arc/Mission lifecycle. This is a deliberate, Director-set choice that itself STAKES a summit: it converts the operating-model engine (a banked convention) into a formalized+mechanized control-plane (the staking move). It absorbs idea-369 (stint-report schema) + idea-368 (close-packet) + idea-356 (calibration write-verb, which would retire the FR-34 manual-filing loss-risk this very retro hit) as mechanization rungs. **C2 / D-1 remain the named technical stakes**, to be sequenced against / within M-Stint-Lifecycle at the stint-5 launch survey.

**Staked summits (the named stakes this stint cured the framing for):**
- **C2 — Agent-Lifecycle (+1, Survey #393)** — nearest-to-pull; retires the FR-23/FR-37 operator + tool-catalog bottleneck class.
- **D-1 — REST control-plane (+2)** — highest-magnitude; the structural answer to the 429 coordination-plane fragility (replaces the MCP-proxy relay rather than patching its concurrency knob).
- **idea-377 — k3s / deprecate watchtower** (Director-surfaced, structural-inflection) — subsumes bug-107 + bug-195 + idea-376; correctly staked to Survey→Design.

**Carried unbuilt / residual:**
- **Observability PUSH half** — idea-357 parts 1-2 (WI-transition + CI/deploy events): the tele-13 payoff that makes the queue push-native. UNBUILT.
- **Incorporation-funnel relief** — the 265-open selection bottleneck is measured-but-not-relieved; reconcile cluster (374/375/379) defends the selection surface; idea-379 (`reconcile.py --apply` behind a confirm gate) makes future stint-open reconciliation zero-touch on the safe bucket.
- **Mechanization rungs for M-Stint-Lifecycle (verified open):** idea-369 (M-Stint-Report-Schema, Director-requested, classify+quantify every generated item) · idea-368 (close-packet) · idea-356 (calibration write-verb + robust recall). All three are direct inputs to stint-5.
- **Residual curation tail (~34, REPORT-ONLY, needs human disposition):** 9 zero-candidate (bug-5/42/48/95/121/140/149/163/186), 23 multi-candidate (ambiguous, need a human pick), 2 needs-human (bug-166/139). Separately tracked: bug-180 fixed-but-still-open (fix ade10cf in main, legitimately open pending AC1 live smoke, work-5).
- **bug-195 (deploy-CD hardening, OPEN)** carries bug-107's real systemd token-refresh fix, VM-side; subsumed by idea-377.
- **Client-side resilience gap (OPEN):** no backoff/circuit-breaker for the 429→reconnect self-amplification.
- **CDACC standing obligation (CARRIED from stint-3, still OPEN):** run-672bd0f — both fan-outs sealed+revealed; awaiting greg's holder-unseal → council P4-P9 (thread-664) → drift-map → **PING DIRECTOR** (dark until that lands). My spec reveal is on branch `agent-lily/cdacc-run-672bd0f-reveal`@d49d66e. Plus the tele-0 staleness finding (tele-0 still says "1-10"). **Explicitly carried, not dropped** — a build-lull standing action.

**Open Director-decisions (staged):** ratify the stint-4 calibration set (the 2-new + 3-amend) · confirm M-Stint-Lifecycle (idea-380) as stint-5 FOCUS · C2 Survey #393 go · D-1 REST control-plane prioritization (sequence vs/within M-Stint-Lifecycle) · idea-377 k3s Survey→Design · bug-195 disposition (likely fold into idea-377) · the residual-curation-tail human-disposition pass · whether to ship the merge-queue (FR-35 third recurrence).

---

## Verification Log (close-out improvement — adversarial completeness-critic, all 10 gaps resolved before persist)

The retro-synthesis workflow ran a final completeness-critic that flagged 10 unverified-or-unrouted gaps. **Per the Director's "improve the close-out process" directive, each was ground-truthed before this doc was persisted** — converting open questions into closed evidence. This log is itself a formalization artifact for M-Stint-Lifecycle (the close-out's verify-before-persist gate).

| # | Critic gap | Resolution |
|---|---|---|
| 1 | idea-369 a phantom in carry-forward? | **RESOLVED — real + open.** `get_idea 369` = *M-Stint-Report-Schema* (Director-requested, stint-3 retro). Reclassified as a verified M-Stint-Lifecycle mechanization rung (§8), not a bare ID. |
| 2 | PR-merge ground-truth unverified | **RESOLVED.** `git log origin/main` confirms #400–410 all squash-merged 2026-06-28; prod HEAD `80075f1`. Shas in §2/by-the-numbers. |
| 3 | director-profile home unrouted | **ROUTED (this PR).** Stint-4 Director signals — infra-ownership clarification ("you—Lily—own infra") + prod gcloud/SSH grant, named-FOCUS-with-stakes framing, incident-driven Director-relay, and the formalize-the-stint-lifecycle directive — folded into the director-profile in this same PR. |
| 4 | No first-person greg/steve intake (FR-20) | **IN PROGRESS — §5a.** thread-738 (greg) + thread-739 (steve) opened; FR-20 discharged when both fold. Not silently skipped. |
| 5 | Cross-validation provenance asymmetry | **NOTED (durability risk).** steve's hand-audit (audit-4744 / work-50 doc) is a Hub Audit-entity working artifact, NOT in git — only the comparison doc (#408) landed. If the Audit entity is pruned the cross-validation is unreproducible. Flagged for the curation cluster. |
| 6 | "twice-validated → load-bearing" overclaim | **CORRECTED — §5.** Softened to "twice-validated convention; promotion to load-bearing GATED on the refResolvable Hub-enforcement hardening." 3 recoveries on one mechanism = strong-but-small sample. |
| 7 | No throughput baseline | **RESOLVED.** ~11 PRs in ~5.5h ≈ 1 PR/30min (#400 11:24 → #410 16:58 AEST), incident-concurrent. In by-the-numbers. |
| 8 | idea-356 (calibration write-verb) status | **RESOLVED — open (unshipped).** So §6 filing is MANUAL with live FR-34 loss-risk; called out at §6 head + the filing PR is the gate to declaring close. idea-356 added as a stint-5 mechanization rung. |
| 9 | bug-199 vs bug-180 relationship asserted | **RESOLVED — confirmed same root.** bug-199 is the schema-granularity facet of bug-180 (both stale on-disk tool-catalog cache). #91 escalation wording corrected (§6): bug-180 fix merged-but-smoke-PENDING, not shipped. |
| 10 | CDACC drift-map / PING-DIRECTOR obligation absent | **CARRIED — §8.** stint-3's still-OPEN CDACC run-672bd0f + tele-0 staleness explicitly carried forward, not dropped. |

---

_Stint-4 close-out executed under the improved close-out method (parallel harvest → synthesize → adversarial completeness-critic → ground-truth-before-persist → multi-seat intake → durable-home routing). That method is the prototype for the M-Stint-Lifecycle (idea-380) close-out phase._
