# DIRECTOR HAND-BACK — Extended Autonomous Dark Run Finalisation

**Architect:** lily · **Run:** extended autonomous (Director dark, 2026-06-29) · **Status:** closing
**origin/main tip:** `17b54b2` (PR #429, 2026-06-28T20:22:59Z)

---

## 1. HEADLINE

- **stint-5 / M-Stint-Lifecycle (mission-96, idea-380) — build COMPLETE + stake-converted.** All build slices merged (S1 deploy-floor + merge-queue, S2 WorkItem node-contract + seed_blueprint expander + arc-node completion-gate + cold-start spine, S3 calibrations write-verb). Retro shipped (#425, summary-review); stint-5 retro calibrations banked (#426). The staked instrument the prior two BANKED stints were building toward is now delivered. **Formal close awaits Director ratification** — work-72 driver-anchor holds the `stint-5-closed` evidence-gate; mission-96 still `active`.
- **Arc-A (observability) core landed — idea-384 CLOSED.** Per-FSM-state wall-clock timers (work-98 / #427) + recursive arc-subtree rollup (work-99 / #428). Both parts shipped; idea-384 incorporated and closed.
- **Arc-B (PR/event/orchestration) started — work-44 (bug-190).** PR-1 merged (#429): repo-event-bridge de-dups the two poll sources into `BasePollSource`, behavior-preserving. PR-2 (coupling redesign) NOT yet on remote (see §5).

---

## 2. ARC LEDGER

### Merged PRs (#412 → #429, contiguous; all to main)

| PR | Title | Work / Idea | Status |
|----|-------|-------------|--------|
| #412 | M-Stint-Lifecycle design v0.1 (council pre-read) | mission-96 / idea-380 | merged |
| #413 | bug-195 deploy-hub CD hardening (S1 deploy-floor) | bug-195 | merged |
| #414 | S1-MERGEQ merge-queue config | idea-380 | merged |
| #415 | reconcile.py `--apply` safe additive apply-set | work-84 / idea-379 | merged |
| #416 | WorkItem node-contract | work-86 / idea-380 | merged |
| #417 | arc-node completion-gate + transitive-heartbeat | work-88 / idea-380 | merged |
| #418 | seed_blueprint expander (S2) | work-87 / idea-380 | merged |
| #419 | cold-start spine 1/3 — get_next + digest | work-94 | merged |
| #420 | cold-start spine 2/3 — get_current_stint | work-94 | merged |
| #421 | calibrations #95–97 + cross-lineage pattern (rescues #342) | cals | merged |
| #422 | cold-start spine 3/3 — legal-moves (CLOSES spine) | work-94 | merged |
| #423 | legal_moves affordance-fidelity hardening | work-96 | merged |
| #424 | calibrations.py WRITE-verb add+validate (S3) | work-97 / idea-356 | merged |
| #425 | autonomous stint-5 retrospective (summary-review) | retro | merged |
| #426 | stint-5 retro calibrations #98–103 (dogfood add verb) | cals | merged |
| #427 | idea-384 Part A — per-FSM-state wall-clock timers (Arc-A slice 1) | work-98 / idea-384 | merged |
| #428 | idea-384 Part B — recursive arc-subtree rollup (Arc-A slice 2) | work-99 / idea-384 | merged |
| #429 | work-44 PR-1 — repo-event-bridge de-dup poll sources → BasePollSource | work-44 / bug-190 | merged |

**Gap in the run:** #406 (work-57 / bug-196 `list_*` COMPACT projection — the 429-storm root-cause) is **CLOSED, NOT merged** (reviewDecision=CHANGES_REQUESTED). No #430 exists. The 429-storm root fix is therefore still unlanded.

### Work-item statuses

| Work | Scope | Status |
|------|-------|--------|
| work-72 | stint-5 driver-anchor (idea-380) | **in_progress** (lily) — lease EXPIRED 20:47:23Z; `stint-5-closed` gate held; completes at retro/ratify |
| work-77 | S0-RECON reconcile `--apply` | done (audit-4925; footgun → bug-202) |
| work-84 | reconcile `--apply` apply-set | done (#415) |
| work-86 | WorkItem node-contract | done (#416) |
| work-87 | seed_blueprint expander | done (#418) |
| work-88 | arc-node completion-gate + transitive-heartbeat | done (#417) |
| work-94 | S2 cold-start spine (4 verbs) | done (#419/#420/#422; da5f761) |
| work-95 | bug-180 follow-up root-cause | done — verdict (ii) host-side; residual → bug-203 |
| work-96 | legal_moves affordance-fidelity hardening | done (#423) |
| work-97 | calibrations.py add+validate (idea-356 part-1) | done (#424; 1c81061) |
| work-98 | idea-384 Part A per-state timers | done (#427; 05e5c99; leaseExpiryCount=1) |
| work-99 | idea-384 Part B recursive rollup | done (#428; dd38af3; closes idea-384) |
| work-44 | bug-190 poll+deliver coupling redesign | **in_progress** (greg) — lease EXPIRED 20:51:42Z; PR-1 merged; no evidence yet |

**Ready work unclaimed (architect queue):** work-83 (S1-PILOT merge-queue stacked-batch, high), work-5 (bug-180 AC1 live connected-claude smoke, high), work-76 (S0-TELE tele-0 refresh + glossary v1.1, high), work-81 (S0-TRIAGE mechanical triage-tag pass, normal).

---

## 3. CALIBRATIONS BANKED (#95–#103)

**#95–97** (PR #421 — methodology, architect-solo-fileable; landed on main):
- **#95** — Cross-lineage cutover without a runtime acceptance gate (same-lineage suite-green ≠ completeness for a cross-lineage deliverable; mission-92). `closed-folded`; rescued from stale PR #342.
- **#96** — AGREEMENT-PIN every load-bearing invariant: the test must FAIL when the target breaks; pin "by construction" parallel paths. `closed-structurally`.
- **#97** — RECONCILE ancestry must be checked against a FRESH upstream main (stale local main inverts `--is-ancestor`; corollary to #93). `closed-folded`.

**#98–103** (PR #426 — stint-5 retro batch, **filed by dogfooding the new `calibrations.py add` verb** from work-97/#424; merged to main 2026-06-28T18:07Z). Includes **cal #98** (verification-model stand-in — see §7).

> ⚠️ **Verification flag:** a calibration-ledger read taken during the run still showed `max id 97` (88 entries) and reported #98–103 as not-yet-existing. PR #426 merged to origin/main *after* that read, so this is almost certainly a **stale-local-main read — the exact bug-202 / cal-97 footgun**. The detailed text of #98–103 was not in the gathered read-set; confirm against a freshly-fetched `docs/calibrations.yaml` on hand-back.

---

## 4. FINDINGS

- **bug-202** [drift, minor] — **OPEN.** `reconcile.py` defaults `--main` to LOCAL main; on a stale worktree (observed 90 commits behind) the ancestry check silently mis-reconciles (37 false "fixed-but-not-in-main" + 2 wrong auto-backfills, vs 2+0 against origin/main). Fix: fetch-first / default origin/main / warn-if-behind. Tags: cal-85, idea-364, S0-RECON. *(This is the same footgun flagged in §3.)*
- **bug-203** [host-conformance, major] — **OPEN.** claude-code 2.1.195 MCP host does NOT re-enumerate tools on `notifications/tools/list_changed`; mid-run Hub-verb additions are unreachable to a running claude-code session until full restart. This is the **bug-180 residual root-cause**, NOT adapter-fixable (opencode/steve honors it correctly on the same adapter). Fix dir: (a) upstream report to Anthropic, (b) break-glass `rm tool-catalog.json` + full restart, (c) follow-on periodic-re-poll / cron-restart protocol. Tags: work-95, upstream, restart-only.
- **bug-180** [cache-invalidation, major] — **RESOLVED.** claude-plugin proxy served a stale on-disk tool-catalog across a Hub redeploy. Adapter fix CORRECT + COMPLETE via `ade10cf` (#362 — L1 identityReady + L2 heartbeat reconciler). In-life staleness residual spun out to bug-203 (host-side). Tag: `resolved-adapter-fixed-as-designed`.

---

## 5. IN-FLIGHT

**work-44 PR-2 (coupling redesign) — NOT YET ON REMOTE.**
- work-44 PR-1 (#429) is merged. The work-44 **work-item remains `in_progress`** (holder greg/engineer), lease **EXPIRED** (expiresAt 20:51:42Z, last heartbeat 20:36:42Z), no evidence yet.
- No PR-2 exists on origin and the branch `agent-greg/work-44-pr2-*` is **not pushed** — PR-2 is not in flight on the remote despite the work-item being open.
- **Operational note:** both held in_progress anchors (work-72 architect, work-44 engineer) have **lapsed leases** and are eligible for sweeper requeue; no further heartbeat after ~20:32–20:36Z.

---

## 6. DECISION-QUEUE FOR THE DIRECTOR

1. **Ratify stint-5 close.** Build complete, retro (#425) + calibrations (#426) shipped; work-72 holds the `stint-5-closed` gate and mission-96 stays `active` until you ratify. On ratify → formally close stint-5 / mission-96.
2. **Authorize bulk-close of 7 superseded lily PRs** — #284, #285, #286, #287, #288, #299, #357. Classifier-blocked (audit-4934); all content superseded by completed missions 88/89/90/92; reopenable. (greg already self-closed his own #334/#336.)
3. **Clear the HOLD cluster (9 PRs)** gated on you: Vision Synthesis #327 (ratify), tele-13 constitution #332 (ratify), CDACC P10 #329/#330 + scaffold #328 (P10 gate), Steve onboarding #333 (idea-329 standup), #344 idea-336 design (charter-first decision), #345 R3 acceptance-gate (APPROVED, doc-only CI flake — mergeable), #393 C2 survey (awaiting your picks).
4. **bug-203 (host re-enumerate) — upstream + interim protocol.** Major; structurally bounds mid-run Hub-verb availability for the *dominant* (claude-code) adapter. Needs an upstream report to Anthropic + an interim restart protocol. **Gates the seed_blueprint live-expansion + observability programs for claude-code** (#7 below).
5. **#406 / bug-196 rework decision.** The `list_*` COMPACT projection (429-storm root-cause fix) is CLOSED-not-merged (CHANGES_REQUESTED) — the storm root remains unlanded; decide rework vs re-open.
6. **idea-356 part-2 (robust-recall / trigger-gap).** Part-1 write-verb shipped (work-97); part-2 still open/deferred — surfacing for prioritization (no ledger detail gathered).
7. **seed_blueprint live-EXPANSION dogfood — restart-gated.** Blocked precisely by the bug-203 host re-enumerate gap (cannot reach new verbs mid-run without a full client restart).
8. **Dirty SHARED worktree** `/home/apnex/taceng/agentic-network` (audit-4968) — needs a cleanup decision (shared tree, not lily's per-PR worktree).
9. **APPROVED-mergeable triage:** #342 → recommend-close (content rescued into #95); #344/#345 → APPROVED but gated per #3.

---

## 7. VERIFICATION MODEL NOTE

During the dark run, **steve (OpenCode / GPT-5.5) — the peer adversarial-verifier — was offline.** Adversarial-verify was therefore performed by **spawned adversarial-verify sub-agents** as a stand-in, captured as **cal #98** in the stint-5 retro batch (#426). This stand-in is **revertible now that steve is back online** — the peer-verifier model can resume, retiring the sub-agent substitute.

Corroborating signal: bug-203 confirms **opencode/steve honors `notifications/tools/list_changed` correctly** on the same adapter where claude-code does not — so steve is also the conformant host for mid-run verb-availability verification, an additional reason to restore the peer-verifier path.

---

## Completeness-critic (adversarial pass)

Adversarial sweep against fresh ground-truth (fetched origin/main = `17b54b2`; `gh pr list` = 18 open; `git show origin/main:docs/calibrations.yaml`). Six gaps; two HIGH.

**G1 [HIGH · untriaged straggler · crit b/d/f] — PR #331 is DROPPED from the decision-queue.**
18 PRs are open; §6 triages only **17** — 7 superseded-close (#2) + 9 HOLD (#3) + #342 (#9). **#331** ([CDACC run-1] calibrations #86+#87, REVIEW_REQUIRED, `agent-lily/cdacc-run1-calibrations`) appears in NEITHER the deferred-close NOR the HOLD bucket. The underlying triage already had a disposition for it (HOLD-CDACC: "disposes WITH the CDACC cluster 327/328/329/330 at P10; its cals #86/#87 cross-ref the drift-map in #329"). It was simply not carried into the final report. **Compounding:** #331 was originally NEEDS-REBASE-(renumber); now that #98–103 exist on main, the #86/#87 IDs in #331 must be re-verified for collision before it lands. **Fix:** add #331 to the §6 #3 HOLD cluster (10 PRs, not 9) + flag the cal-ID-renumber check.

**G2 [HIGH · in-flight risk + missing disposition · crit c/e] — work-44 PR-2 mid-flight + bug-190 left undispositioned.**
The report flags the lapsed lease + absent PR-2 but not the *consequence*: work-44 is `in_progress`/lease-EXPIRED → sweeper-requeue-eligible. On requeue it returns to `ready` and a fresh claimant inherits an item whose **PR-1 is already merged** but whose **PR-2 design lives only in greg's local worktree (not pushed → loss-at-risk)**. Risk: (i) PR-1 re-litigated by a context-less re-claimant, or (ii) the coupling-redesign half is silently lost; the work-44 evidence-gate spans the *whole* redesign, so merged PR-1 alone won't satisfy it. Separately, **bug-190 itself has no stated disposition** — PR-1 is behavior-preserving and does NOT fix the coupling, so **bug-190 remains OPEN/unfixed**; the report should say so. **Fix:** annotate work-44 (PR-1 done / PR-2 outstanding + where the WIP lives) or `block_work` BEFORE the lease requeues; state bug-190 = OPEN.

**G3 [MEDIUM · limbo + cleanup · crit a] — work-57 (behind closed #406) disposition unstated; branch lingers.**
§2/§6#5 correctly surface #406 (CLOSED, CHANGES_REQUESTED, 429-storm root unlanded) and ask rework-vs-reopen. But the **work-57 work-ITEM status is never stated** (absent from both the work-list and the report) — if still `in_progress`/`blocked` with its PR closed, it is an orphaned/claimed-not-done item. Verified: the head branch `agent-greg/work-57-list-compact` is **still on origin**. **Fix:** confirm work-57 status (done/blocked/abandoned) + branch-cleanup decision.

**G4 [MEDIUM · decision-queue omission · crit f] — Arc-B forward-plan ideas absent.**
**idea-383** (PR/GH↔work-queue auto-close-out signal — "design with bug-190") and **idea-387** (blueprint orchestration evolution — "future arc; design with idea-383 + bug-190") are OPEN and explicitly coupled to bug-190 / Arc-B, the in-flight arc that just opened (work-44 PR-1). They are missing from §6. The Director closing Arc-B needs its named follow-ons surfaced as the forward plan. (idea-343 D-3 agent-telemetry is also open but gated on the C2-W0 spike — lower urgency; one-line mention.)

**G5 [LOW · report-vs-ground-truth, now RESOLVABLE · crit d] — calibrations #98–103 ARE banked; the §3 doubt is stale.**
Fresh `origin/main:docs/calibrations.yaml` carries ids **through 103**. The run-time "max id 97 / #98–103 do not exist" read was a STALE-LOCAL-MAIN read — exactly the bug-202/cal-97 footgun §3 hypothesized. Substantively the cals exist (no gap); but the report still presents this as unverified in the headline + §3 and tells the Director to re-check something already true. **Fix:** mark §3 flag CONFIRMED-resolved (#98–103 banked on main).

**G6 [LOW-MEDIUM · framing · crit f] — Arc-C unnamed + run halted short of "continuous-until-return".**
The ratified run had 3 arcs incl **Arc-C** (cleanup/hardening/hygiene/review/audit — the "never-idle floor, CONTINUOUS until return"). The report headlines only Arc-A + Arc-B; Arc-C is never named, though the PR-backlog triage (audit-4934), reconcile hygiene (work-77), and the S0 tail were Arc-C work. More importantly: the run ended with **both** holder leases EXPIRED **and 4 ready items unclaimed** (work-83/work-5/work-76/work-81) — the never-idle floor was NOT sustained to Director return; agents went dark ~20:32–20:36Z. The report lists the unclaimed work (§2) but doesn't flag that the run **STOPPED short of mandate** (quota/context exhaustion?) rather than completed-and-idled-by-design. Worth one explicit line so the Director reads "halted," not "parked."

**Not gaps (verified clean):** merged ledger #412→#429 contiguous + correctly attributed; #406/no-#430 gap surfaced; the 3 APPROVED-mergeable PRs (#342/#344/#345) all addressed; both expired in_progress anchors (work-72/work-44) surfaced; bug-202/bug-203/bug-180 all dispositioned; work-44 PR-2 branch confirmed absent from origin; READY-work list (4 items) matches.
