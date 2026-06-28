# Autonomous-Stint Friction Backlog

**Status:** LIVING (v1, opened 2026-06-22 during stint-2 at Director direction) — a documented, triaged backlog of friction encountered while running the **self-autonomous-stint operating model** (architect-as-acting-Director driving greg + Steve autonomously under a Director AuthorityGrant). Companion to the DR-ledger (`docs/decisions/autonomous-stint-*-log.md`, the *decision*-trace) — this is the *friction*-trace.

**Why this exists:** the autonomous-stint is a novel operating model (C4 governed-autonomy). It works — but it surfaces recurring friction in the Hub primitives, tooling, substrate, harness, and the architect-runtime methodology itself. Capturing + triaging that friction is how the model improves (tele-10 autopoietic-evolution; tele-13 less-Director-attention). Left in narration/memory it drifts; documented it compounds.

**Disposition legend:**
- `FIX-NOW` — small, unambiguous; fix in-flight.
- `IDEA` — filed as a backlog idea/mission (id noted); rides its own lifecycle.
- `DOCUMENT` — a known gotcha; the fix is a playbook/memory note, not code.
- `COUNCIL` — needs the deferred **adversarial council** (below): non-obvious, design-level, or trade-off-laden.
- `ACCEPT` — inherent cost of the model; not worth fixing.

---

## A. Hub coordination-mechanism friction

### FR-1 — Pulse satisfied only by `ack_message`, not by a status-note → false-escalation on a *hyperactive* agent
**Evidence (stint-2):** mission-94 `engineerPulse` hit `missed_threshold_escalation` while greg was the most engaged he could be — sub-PRs landing every few minutes, threading constantly — because he replies via `kind=note` status messages, which do NOT satisfy the pulse (only `ack_message` on the pulse Message does). missedCount climbed to 3 → escalation → pulse paused. Repeats every `threshold × interval` regardless of how active the agent is.
**Workaround:** leave the pulse paused/dormant during tight active coordination; rely on the visible note-stream + the architect's own pulse. (`feedback_pulse_response_is_ack_not_note` is the banked discipline; but it asks the *agent* to change, which the acting-Director can't force.)
**Disposition:** `COUNCIL`. Candidate fixes to stress-test: (a) pulse-satisfaction should count *any* recent authored Message from the silent role (note/thread/commit) within the window, not only an ack on the pulse Message — "silent" should mean *actually silent*, not "didn't ack this specific Message"; (b) the escalation predicate should factor recent-activity (commits/threads) before declaring an agent silent; (c) keep ack-only but make adapters auto-ack the pulse when the agent authors a status-shaped reply. This is the friction that prompted this whole backlog (Director, 2026-06-22).

### FR-2 — `update_mission(pulses=...)` MERGES, does not replace
**Evidence (stint-2):** to remove the `engineerPulse` I called `update_mission` with `pulses={architectPulse}` only; the engineerPulse persisted (merged). The tool description says "Replace the mission's pulses config" — the behavior is merge. So a pulse cannot be *removed* via this surface (only added/edited); removal requires force-pausing or a different path.
**Workaround:** leave the unwanted pulse paused (dormant) instead of removing it.
**Disposition:** `FIX-NOW`-class (small) but **needs an engineer** — either fix the merge→replace semantics, or document it + add a pulse-disable/remove affordance. Provisionally `DOCUMENT` until an owning mission picks it up.

### FR-3 — `kind=note` peer-delivery contract is ambiguous
**Evidence:** `feedback_kind_note_is_silent` says `kind=note` is silent to the peer LLM (thread-open is the working primitive). Empirically THIS stint, greg's and Steve's notes DID surface to me as actionable notifications, and mine to them appeared received. So either the gap closed, or delivery is conditional/unreliable. The ambiguity forces defensive thread-opening for response-needing comms (heavier than a note).
**Disposition:** `COUNCIL` / verify — establish the actual note-delivery contract (when does a note surface vs not?) so the note-vs-thread primitive choice is principled, not superstitious.

## B. Tooling / CLI friction

### FR-4 — `list_available_peers` deprecated but still advertised
**Evidence:** it appears in the deferred-tool name list, but calling it returns `Tool list_available_peers not found` (Director confirmed deprecated). Wasted a call + a tool-load. Banked as `reference_list_available_peers_deprecated`.
**Disposition:** `FIX-NOW`-class — remove it from the advertised deferred-tool registry. `DOCUMENT` meanwhile (use `get_engineer_status` / `list_messages` for agentIds).

### FR-5 — Loaded MCP tools require the FULL `mcp__plugin_..._<name>` prefix
**Evidence:** after `ToolSearch`-loading, calling `claim_message` (short name) returned `No such tool available`; the full `mcp__plugin_agent-adapter_proxy__claim_message` worked. Easy to trip on.
**Disposition:** `DOCUMENT` (operator note).

### FR-6 — Stacked-merge / branch-protection dance
**Evidence:** each merge re-puts sibling PRs BEHIND main (require-up-to-date); `gh pr update-branch` is NOT a valid subcommand in this `gh`; the REST `PUT .../update-branch` RETAINS the approval, but a local `merge main + push` DISMISSES it (dismiss-stale-reviews); `--admin` can't bypass an `expected` required-check. A multi-PR batch becomes an update→re-approve→merge→(siblings now behind)→repeat loop.
**Disposition:** `DOCUMENT` (the playbook is banked in `project_autonomous_stint_2_state`); partially `ACCEPT` (branch-protection is doing its job). Council could consider an integration-branch default for multi-PR work (as C1-R2 adopted) to collapse N deploys→1.

## C. Substrate friction (surfaced by building, not by the model per se)

### FR-7 — renameMap is DUAL-SOURCE (write-encode `kinds/*.ts` vs read/filter `all-schemas`)
**Evidence:** WorkItem (first new kind since the substrate matured) was read-declared in all-schemas but had no `kinds/WorkItem.ts` write-module → the encoder default-encoded it FLAT → rows landed at wrong paths → list + oracle empty. Contradicts the CLAUDE.md-stated single-authority. Caught pre-ship by the C3-R4 governor (the win).
**Disposition:** `IDEA` — **idea-346** (unify write-encode onto all-schemas). Cluster with **idea-344** (renameMap filter-only entry-class). idea-345 (generalize shadow-parity) was DISMISSED (W6 path-sentinel already covers object/array).

### FR-8 — Filter-operator taxonomy gaps (silent no-op + fail-open) surfaced incrementally
**Evidence:** the `$contains` build surfaced (a) a watch/policy/memory cross-surface parity hole (some surfaces silently no-op'd), and (b) after the fail-loud guard, `matchField` returned `true` (match-EVERYTHING / fail-OPEN) for a no-implemented-operator predicate — a forbidden op bypassing Zod would have leaked all rows. All fixed in R2 (`assertKnownFilterOps` + `hasImplementedFilterOp` fail-closed, 3-class taxonomy: implemented/forbidden/unknown).
**Disposition:** `FIX-NOW` (done in R2). Lesson → substrate principle: **unevaluable filter predicates fail-CLOSED (match-nothing), never fail-open.** Worth a calibration (Director-direct).

## D. Harness / worktree friction

### FR-9 — Branch-checkout blocked by an untracked file that differs from the target branch
**Evidence:** the C1 refined-design draft sat untracked in the worktree; differed from main's committed copy → blocked branch checkouts. Required stash/backup-then-checkout. (Turned out to be my own prior-session candidate, not an anomaly.)
**Disposition:** `DOCUMENT` (stash-then-checkout; back up the bytes first).

### FR-10 — Harness file-state resets on branch switch → `Edit` fails "File has not been read yet"
**Evidence:** after a `git checkout`, editing a file the harness "read" pre-switch fails until re-Read. Hit repeatedly.
**Disposition:** `DOCUMENT` (re-Read the target region after any branch switch before Edit).

## E. Methodology / architect-runtime friction (the meta-layer)

### FR-11 — Memory-update cadence: per-exchange churn
**Evidence:** the resume-state memory was edited ~15× this stint (≈ after every peer exchange). High edit-overhead + churn; risks the cold-pickup surface being a moving target.
**Disposition:** `COUNCIL` / methodology — define a memory-update cadence: update at **meaningful checkpoints** (sub-PR boundary, DR, gate) not every message. The DR-ledger + the per-mission entities already capture fine-grained state; the resume-memory is a *pickup* surface, not a live log.

### FR-12 — "Parallel-load-self" over-promised, under-delivered
**Evidence:** I declared "I'll do the D-1 R1 design in the gap" ~6× without doing it — the gaps between greg's (fast) deltas were too short to context-switch into a major design. The repeated promise-without-action is itself a friction (inconsistency + self-noise).
**Disposition:** `ACCEPT` + methodology-correct — be honest that during an *active tight-coordination build* the review/contract-shape cadence IS the architect's work-stream; reserve major parallel design-work for a genuine sustained lull or explicit Director steer. (This very directive — the friction backlog — is the right *kind* of gap-work: bounded, Director-blessed, resumable.)

### FR-13 — Verifier loaded REACTIVELY, idling between deliverables
**Evidence:** Director nudged TWICE in one stint that Steve was idle. I was dispatching Steve per-deliverable (early-read, then idle, then gate) instead of maintaining a standing forward-queue.
**Disposition:** `DOCUMENT` (banked + reinforced in `feedback_parallel_load_waiting_peers`: maintain a PROACTIVE standing verifier-queue — forward-prep like the R3 emission-matrix + the verbs threat-model — queue the NEXT task before the current finishes). Working well since the correction (Steve's standing-queue caught 4 real issues).

### FR-14 — Director-reporting cadence: status-close nearly every turn
**Evidence:** ~20+ end-of-turn status syntheses this stint. Useful for a monitoring Director, but likely over-reporting at steady-state; risks signal-dilution.
**Disposition:** `COUNCIL` / methodology — calibrate the Director-facing cadence: full synthesis at milestones/gates + on-request; terse or silent at routine steady-state. (Tension with tele-13 "Director sees the org at a glance" — the *right* glance-surface may be a dashboard/pulse, not prose every turn.)

---

## F. Stint-2 C1-R2-arc-execution addendum (appended 2026-06-22, post-arc-seal)

*Frictions + one positive pattern surfaced while driving the C1-R2 arc to seal (keystone #356 + hardening #358 + RBAC fail-CLOSED #359, all merged + deployed). Also durable in entities (bug-177, bug-178) + the DR-ledger (DR-S2-020..022); folded here for council completeness.*

### FR-15 — Thread read-projection lag: recently-written thread state invisible to readers
`get_thread` is authoritative, but `list_threads` + per-reader projections lag the write-commit. Twice this arc: thread-702 (active) was absent from `list_threads` ~6min post-create; thread-706's architect reply + turn-flip were not projected to the verifier (OpenCode adapter) ~17s post-write → the verifier flagged a possibly-lost decision and asked for re-dispatch (false alarm — the message was canonical). Hazard: a reader falsely concludes "stuck / no new message." Filed **bug-177** (minor). → **COUNCIL** (coordination-ergonomics class; a candidate the C1/C2 substrate-coordination may dissolve).

### FR-16 — Recurring CI flake: pg-57P01 substrate-watch teardown unhandled rejection
`vitest(hub)` exits FAILURE on an unhandled postgres `57P01` from a substrate-watch LISTEN client at testcontainer teardown, DESPITE every test passing (174 files / 2091 tests, 0 assertion failures). Blocked merge on #358 e1438a7 + #359 → needed manual re-runs. Risk: a real failure dismissed as "the flake." Filed **bug-178** (minor; eng teardown-hygiene). → **FIX-NOW**.

### FR-17 — MCP write returns connection-error AFTER succeeding → duplicate-on-retry
A `create_bug` returned `MCP error -32000: Connection closed` but had already written server-side; the naive retry created a duplicate (bug-178 + bug-179; deduped by hand). Entity-create tools carry no idempotency key, so a transient drop-after-write + retry silently double-writes. → **DOCUMENT** (retry discipline: on a write that errors, verify-before-recreate) + **IDEA** (idempotency-key / client-token on entity-create).

### FR-18 — Thread round-cap + strict turn-lock fragments long architect-driven coordination
One logical coordination on #358 hit two thread limits at once: `maxRounds=10` (thread-703 reached 9/10) AND strict turn-alternation (could not reply to 703 while it was the engineer's turn). Together they forced sibling threads — thread-705 (fix-shape catches, opened because 703 was turn-locked) + thread-707 (to continue #358 after the round-lock) — fragmenting one topic across three. → **COUNCIL** (the thread primitive fits bilateral request-response, not a long architect-orchestrated multi-step; another dissolve-candidate for the work-queue/supervisor).

### FR-19 — Pulse auto-generated text goes stale across mission phases
The mission-94 `status_check` pulse still read *"paused-for-Steve (dormant on #356)"* long after the keystone deployed + hardened — stale framing on every fire. Refreshing needs `update_mission(pulses)` (MERGE-semantics, FR-2) + force_fire re-anchoring — fiddly enough that it was left as-is and just ack'd. → **FIX-NOW-small** (eng: template pulse text from live mission status at phase transitions); relates to FR-2.

### FR-20 — No designed council PROCESS / agenda; friction-intake is architect-only (META — Director-flagged)
This backlog (FR-1..19) is entirely **architect-observed**. greg (engineer) + Steve (verifier) have NOT yet surfaced *their own* lived frictions — and the autonomous-stint looks different from each seat (engineer: fold-cadence, re-verify round-trips, work-trace discipline, CI flakes, the bigger-than-spec migration surprise; verifier: dispatch latency, the advisory-not-gating boundary, oracle-before-artifact ordering, cross-adapter read-lag, the CONDITIONAL-PASS-vs-deploy-gate ownership seam). AND there is no designed PROCESS for running the council itself: how friction is gathered from all three roles, the deliberation format (CDACC dual-altitude vs Workflow panel vs live multi-agent), the agenda, and the output→ratification flow. **To be DESIGNED later** (Director, 2026-06-22). → **DESIGN-FIRST** — a prerequisite the convening depends on; the council can't run well on one-sided intake + an ad-hoc format.

### FR-21 — No agent-self-service tool-surface refresh (Director-flagged 2026-06-27)
After a Hub tool-registration change (deploying `create_work` + `get_work`), connected agents do NOT see the new verbs — the MCP proxy keeps its **cached pre-deploy tool catalog across the Hub-restart reconnect**. The reconnect re-projects events but does NOT re-fetch `tools/list` (confirmed: only a fresh dispatcher bootstrap, or a *reacted-to* `tools/list_changed`, re-fetches; the claude host caches from MCP-server init). Surfacing the verbs needs a **manual, human-triggered `/reload-plugins` per agent session** — an operator in the loop, not agent-self-serviceable; the C1 on-ramp go-live required it in all 3 sessions (lily/greg/Steve). → **Direction (Director):** a local adapter hook/API the agent can call to force a `tools/list` re-fetch, OR a Hub-registration-driven push (`tools/list_changed` the host actually re-fetches on). **Largely ALLEVIATED by idea-121** (verb-collapse): a DERIVED, uniform tool/REST surface (GET/PUT/PATCH + named actions) changes far less often than per-kind verbs added one-by-one, so there are far fewer new-verb-registration events that need a resurface at all. → **IDEA / DESIGN**; relates idea-121, bug-177, FR-22.

### FR-22 — Hub-restart → event-bridge backlog replay storm (Director-flagged 2026-06-27)
When the Hub container rolls (watchtower deploy), the repo-event-bridge reconnects and **replays/re-projects its PR-event backlog to all connected sessions at once** — the `create_work` deploy roll delivered the whole stint's PR-events (#349–361) as a burst of stale bilateral notifications. Benign (drain came back empty; nothing escalating) but real noise that can mask a genuinely-actionable event + costs attention to triage. The `RepoEventBridgeCursor`/`RepoEventBridgeDedupe` infra exists but evidently doesn't suppress the restart-reconnect replay. → **Direction:** cursor/dedupe should not re-deliver already-projected events on reconnect, OR mark restart-replay notifications as visibly historical. → **FIX-NOW-small / IDEA**; relates bug-177 (read-lag/projection family), FR-15, FR-21 (both Hub-restart-reconnect-surface issues).

## Section G — Stint-2 C1-adoption GO-LIVE + dogfood-2 + adapter-hygiene (FR-23..FR-30, 2026-06-27)

### FR-23 — OPERATOR-AS-LIFECYCLE-BOTTLENECK (HEADLINE — Director-emphasized for council)
This stint, **every agent-lifecycle + prod-write action routed through the Director as manual operator.** The org cannot self-drive (tele-13) while a human is the restart/deploy/wake operator. Facets:
- **Adapter hop = manual client restart.** Loading new proxy/adapter CODE needs a full Claude Code exit+relaunch (a stdio code-swap can't hot-reload; the bug-180 "bootstrap caveat" — the live-refresh can't deliver the fix that enables live-refresh). Director-executed for lily+greg this stint.
- **Plugin update = manual build+stage.** No consumer/producer auto-refresh subscription; the operator hand-stages the marketplace dir + installs (→ idea-354). The `update-claude-plugin.sh` one-command script (#365) compressed this but still requires the operator to run it + restart.
- **Hub deploys = Director-coordinated** prod-write (each watchtower roll).
- **Queue handoffs = manual nudges.** Every dogfood handoff needed a thread-nudge until idea-353 shipped — and STILL does for opencode/Steve (forked adapter, → idea-355).
→ The dominant friction class + the strongest signal for the **C2/D-2 supervisor arc** (agent lifecycle restartable/upgradable from outside the LLM) + idea-353/354/355. **Council charge:** which operator actions are intrinsically human (genuine hard-lines) vs mechanizable by C2/D-2?

### FR-24 — Forked shared-adapter → kernel features don't reach all hosts (→ idea-355)
The "shared" `@apnex/network-adapter` is on two divergent version lines (claude `0.1.4` vs opencode `2.1.0`) + suspected code drift. idea-353's wake/stall (kernel code) reached claude only; opencode/Steve stays wake-gapped. Violates tele-3 (one shared kernel). → **idea-355** (deep shim/adapter audit + converge to one kernel + thin shims); cluster bug-182/183/184. **This is the now-prioritized consolidation focus.**

### FR-25 — adapterVersion telemetry mis-reports the shim, not the kernel (→ bug-183)
`get_agents` `advisoryTags.adapterVersion` == the proxy/SHIM version, not `@apnex/network-adapter` (the kernel) → it MASKED the kernel drift (FR-24). tele-1/tele-4 (sovereign-state-transparency) violation. → bug-183.

### FR-26 — Deprecated tool still live + reached-for (→ bug-184)
`get_engineer_status` (deprecated long ago; superseded by `get_agents`, mission-63/ADR-028) is still exposed + was used repeatedly this stint before the Director's correction. A deprecated-but-live tool invites drift. → bug-184. (Same class as FR-4.)

### FR-27 — block_work is not a durable park; blocked items still lease-reaped (→ bug-185)
The idea-353 W2 stall-prompt routed greg to `block_work` on work-5 (parking on an external trigger), but block RETAINED the lease clock → the sweeper reaped the blocked item back to `ready` + the idle-digest false-re-fired. No durable "armed/waiting-on-external" state. → bug-185 (idea-353 queue-semantics). **Council:** does the queue FSM need a park state outside the lease regime, or should the sweeper skip `blocked`?

### FR-28 — AC1 prod-smoke needs a deliberate surface-changing deploy
bug-180's literal AC1 proof (work-5) can't be captured without an actual Hub tool-set change — no cheap way to manufacture a surface change for a smoke. Forced a choice between a gratuitous deploy (Route B) and an indeterminate wait (Route A, chosen — riding the next natural change). Test-affordance gap; relates tele-9 (prove-it-in-prod). → minor.

### FR-29 — Async-thread coordination can cross (decision vs reply race)
greg's "B is the right call" reply crossed my Route-A steer in flight (he was answering my earlier lean-B; the Director had since picked A). Resolved cleanly (he'd deferred to the Director's pick), but the async thread model lets a reply + a superseding decision race. Coordination-ergonomics; relates FR-15/FR-18. **Council:** does queue-native coordination (vs threads) reduce this class?

### FR-30 — Terminology drift (adapter vs shim) caused a mis-diagnosis
I initially conflated "adapter" (shared kernel) with "shim" (per-host bridge), framing Steve's wake-gap as "missing shim wiring" when the root was kernel-version drift (FR-24). The Director's terminology correction fixed it + is now an operating axiom ("thin shim / shared kernel"). Clarity/comms friction — precise shared vocabulary is load-bearing for correct diagnosis. → DOCUMENT (now in roadmap axioms + [[reference_get_agents_not_engineer_status]]).

### (reinforces FR-3) note round-trip overhead recurred heavily
The `kind=note` response loop (peer's note → claim → ack → reply-note, 2-3 calls each, "silent" delivery that doesn't wake the peer) was the dominant engineer↔architect channel this arc. Another data point that note is a heavyweight, ambiguous response channel vs a thread turn.

### ✅ What WORKED — positive patterns for the council to weigh formalizing
**(a) Ultracode adversarial Workflow panel as a deploy-gate complement.** For the real-live-effect bug-175 deploy (#2, repo-wide RBAC fail-CLOSED), an 8-agent panel (wf_98785060) ran in parallel with the single verifier (Steve) — independently TRIPLE-confirming the Director-lockout was moot + sweeping the caller-path breadth + the ~50-test migration fidelity a single verifier might not exhaustively cover; converged with the verifier on DEPLOY-READY. **(b) Verifier-authored acceptance-oracle BEFORE the engineer builds the fix** (audit-4120) caught two weak fix-shapes pre-implementation, saving re-verify rounds. Candidates: formalize "verifier + adversarial panel" for repo-wide / real-live-effect deploys (verifier-only for narrow/dormant), and "oracle-before-artifact" as standard for non-trivial fixes.

---

## Section H — Stint-3 idea-355 dogfood-3 (FR-31, 2026-06-27)

### FR-31 — PR merge/approval workflow is one-size-fits-all; doesn't fit the scenario (Director-flagged 2026-06-27)
Every PR this dogfood-3 stint (#369 SLICE-0, #370 calibration-governance, #371 SLICE-1-part-1) hit the same multi-step merge cycle: **BEHIND → `gh api` update-branch (retains approval; a local rebase+push dismisses it) → ~3min CI re-run → merge.** Compounding factors:
- Repo **requires up-to-date-before-merge** + main advances as each PR lands → every later PR goes BEHIND → forced update-branch + re-CI. Multi-PR missions pay this per-PR.
- **auto-merge is DISABLED** (`enablePullRequestAutoMerge` not allowed) → no merge-when-ready; manual `--watch` + merge each time.
- **`--admin` does NOT override** — blocked by the BEHIND-state "required check expected" interaction (the up-to-date requirement re-requires the checks). Validates memory `feedback_pr_approvals_peer_to_peer`.
- **Author can't self-approve** → the architect's own PRs (e.g. #370, docs-only governance) need a peer (greg) cross-approval round-trip.
- No passive **CI-green / merge-ready signal** → architect sets a manual `gh pr checks --watch` per merge (the merge-leg analog of FR-23; the idea-357 gap).

**Director framing (2026-06-27):** *"consider merge workflows and approves that make sense for each scenario."* The friction is a uniform merge/approval policy where the scenario varies. Design distinct policies per scenario:
- **Docs/yaml-only governance** (calibrations, CLAUDE.md, design docs): low-risk non-code — relax up-to-date / lighter approval / architect-mergeable.
- **Code PRs** (adapter/kernel/hub): keep up-to-date + peer-verify + full CI.
- **Dogfood-increment PRs** (stacked on one branch): merge-queue / batch to avoid per-increment BEHIND-churn.
- **Author-can't-self-approve**: a defined cross-approver matrix (or a governance-PR exemption path).
- **High-churn main**: a GitHub **merge-queue** (or enabling auto-merge) eliminates the update-branch + re-CI thrash.

**Concrete fix — docs-only merge fast-path (stint-3 retro 2026-06-28):** the first scenario above is now CONCRETE and shippable independent of the rest. PRs whose diff is **confined to `docs/**`** (incl. `docs/calibrations.yaml`, `CLAUDE.md`, design docs, this backlog) SKIP the BEHIND → update-branch → re-CI up-to-date-formality entirely — there is no code/test surface for the up-to-date check to protect, so requiring it is pure churn. Evidence: PR #370 (docs-only calibration-governance) was admin-merged *solely* to satisfy the formality; under the relaxed governance model (architect-fileable calibrations, PR #370) architect-filed calibration + doc PRs are now FREQUENT, so this fast-path pays off every stint. Mechanizations: a `docs/**`-path branch-protection ruleset that drops require-up-to-date for doc-only diffs, OR an architect-mergeable governance-PR path. (The remaining scenarios — code PRs, dogfood-increment batches, the cross-approval matrix, merge-queue — stay as designed above.)

**Disposition:** COUNCIL + idea-357 (the CI-green/merge-ready event is the same gap). Candidate outputs: enable auto-merge or a merge-queue; per-path branch-protection policy; a cross-approval matrix. Refs: idea-357, FR-23 (operator-bottleneck class). Surfaced live across #369/#370/#371; Director-flagged "add to backlog."

---

## Section I — Stint-3 retrospective harvest (FR-32..FR-34 + multi-seat intake, 2026-06-28)

*Frictions surfaced by the zero-loss stint-3 retro harvest, plus the first discharge of FR-20's multi-party intake (engineer half). Verifier (steve) first-person intake is **PENDING** — FR-20 stays open until both non-architect seats are in.*

### FR-32 — Verifier worktree cannot run the test suite (deps/testcontainers/docker absent)
**Evidence (stint-3):** steve's scratch-clone has no installed deps, no testcontainers, and no docker daemon → adversarial depth on the highest-blast-radius substrate fixes (work-33/36/43; bug-100/187 gap-free SchemaDef watch across reconnect) was limited to **code-inspection + CI-trust** — he could not run the real-pg gap test locally. The cost is concrete: #385's MOCK harness hid two real-pg-only seams (non-monotonic cursor + iterator-settle hang) caught only by steve's real-pg probing; without a runnable substrate harness on the verifier's seat, that probing isn't repeatable round-to-round.
**Greg's handoff detail (for standing up the verifier's real-substrate harness):**
- (a) **COPY-FROM-TEMPLATE, not greenfield:** `hub/src/storage-substrate/__tests__/write-encoder-and-watch-w4.test.ts` is a working real-`PostgreSqlContainer` + `substrate.watch` e2e harness to clone — start from it rather than building a substrate test cell from scratch.
- (b) **PRE-WARN the 57P01 teardown flake:** a postgres `57P01` *"terminating connection due to administrator command"* at container shutdown is the known teardown race (= FR-16 / bug-178) — **ignore + re-run, NOT a real failure**; don't let it read as a broken harness.
- (c) **Confirm a working docker daemon on steve's seat FIRST** — testcontainers needs docker; verify it before wiring the harness.
**Disposition:** FIX-NOW / IDEA — provision the verifier worktree with deps + docker/testcontainers (or a runnable CI cell). **Acceptance:** steve can run the bug-100/187 pg-gap test locally. Refs: FR-16 / bug-178 (the 57P01 flake), F6 + cal #79/#82 (faithful-harness recurrence class).

### FR-33 — Thread maxRounds=10 overruns long operational handshakes
**Evidence (stint-3):** thread-709 hit the round cap **10/10** mid-deploy-coordination, forcing the rest of one logical operational sequence to spill into thread-712 + direct notes. Same primitive-fit class as FR-18 (the thread round-cap fragments long architect-orchestrated multi-step coordination) — here it recurred on an **operational (deploy) handshake** rather than a build one, confirming the cap is mis-sized for sequencing, not just bilateral request-response.
**Disposition:** COUNCIL — either a coordination-thread mode with a higher cap for operational handshakes, OR prefer direct acks / queue-native push for operational sequencing (the work-queue dissolves the thread-round-cap fit problem). Refs: FR-18, FR-15 (thread-primitive coordination-ergonomics class).

### FR-34 — Banked-only calibrations are a recurring cross-stint loss vector
**Evidence (stint-3):** the relaxed (manual yaml-edit) calibration model has no write-verb and no banked-tracker, so "banked for retro" lived only as a DR note + a pending task — three round-2 calibrations (#89 never-bypass-ship-path / #80-sort tri-surface extension / #79-82 faithful-harness recurrence) were the **highest loss-risk on the calibration surface** this stint. A banked entry that isn't tracked as an obligation silently drops across the stint boundary (the same loss class recurs cross-stint).
**Disposition:** FIX-NOW (process rule) → **any calibration "banked for retro" becomes a TRACKED stint-close obligation**: it lands on the stint-close checklist and the round-2 calibration PR MUST merge before the stint is declared closed. Stint-3 obligation: #89 / #80-sort / #79-82. Mechanization → idea-356 (write-verb + validate + banked-guard makes "banked" a tracked entity, not a convention).

### ENGINEER-INTAKE (greg) — FR-20 first-person frictions (engineer half; verifier/steve intake PENDING)
This discharges the **ENGINEER half of FR-20** (multi-party friction intake — friction looks different from each seat). The **VERIFIER (steve) first-person intake is PENDING**; FR-20 stays open until it lands (one-sided intake is the exact defect FR-20 was filed to prevent).

**greg's 3 lived frictions:**

1. **PRE-GATE PATH-COMPLETENESS.** gate-submitted #385 **before** enumerating the distinct code-paths the change introduced (one test each). steve's 3 verifier rounds were each a *distinct path in greg's OWN fix* — the clean-RETURN reconnect branch was the **PRIMARY** path, unpinned until round 3. Each round-trip also cost a context-reload (warm mental-model loss). **Fix:** a pre-gate path-enumeration pass ("what distinct paths does this change introduce, one test each") collapses 3 rounds → 1.

2. **CLAIM-TIME SCOPING UNDER-COUNT.** the scoping grep scoped to the *surfacing SYMBOL* systematically under-counts the defect-class blast-radius → a size estimate gets committed at claim-time on too-narrow a grep (bug-190 looked contained, was a ~1000-line atomic redesign). **RECURRING** (W4 re-grep, bug-178, bug-190). This is **calibration #88 with a CLAIM-TIME SIZING corollary**.

3. **TRUST-CRITICAL AC-FORK SURFACING LATENCY.** shipped idea-353 AC5 on a narrow strict-vs-narrow AC reading that let a self-driving signal over-report; a **PR-BODY NOTE is NOT surfacing** (same silent-channel class as `kind=note`, FR-3) → cost a re-verify round. **Fix:** an explicit decision-flag to the architect BEFORE shipping, not a post-hoc note.

**greg's AMPLIFY (top productivity):** **mutation-proof every test** (prove non-vacuous) + **real-substrate testcontainers locally, BEFORE the gate** → makes the verifier's green rounds FAST + trustable; converted the marquee watch fix from "I think" to "I proved it." Front-loads cost into provable confidence instead of round-trips. (Pairs with the retro's P4/P11 amplify lessons + FR-32 — the verifier needs the same local real-substrate harness greg used.)

**Disposition:** friction 1 → DOCUMENT (engineer pre-gate path-enumeration discipline; calibration candidate); friction 2 → calibration **#88 CLAIM-TIME SIZING corollary** (recurring → mechanize the value-bar); friction 3 → DOCUMENT (explicit decision-flag-before-ship; same silent-channel class as FR-3); AMPLIFY → operating-model §5 (mutation-verify + real-substrate-before-gate as standard).

---

## Triage summary

| Disposition | Frictions |
|---|---|
| `COUNCIL` (deferred adversarial review) | FR-1 (pulse ack-vs-activity), FR-3 (note-delivery contract), FR-11 (memory cadence), FR-14 (reporting cadence), FR-15 (thread read-projection lag), FR-18 (thread round-cap/turn-lock fragmentation), FR-33 (thread round-cap on operational handshakes) |
| `IDEA` (filed) | FR-7 (idea-346 + idea-344 cluster), FR-17 (idempotency-key on entity-create — candidate), FR-21 (self-service tool refresh — idea-121-alleviated; adapter-hook/Hub-push candidate), FR-32 (verifier real-substrate harness — provision the verifier worktree) |
| `FIX-NOW` (done or small-owned) | FR-2 (pulse merge — needs eng), FR-4 (deprecated tool), FR-8 (fail-closed filter — done in R2), FR-16 (bug-178 CI teardown flake), FR-19 (pulse stale-text), FR-22 (event-bridge restart-replay dedupe), FR-31 (docs-only merge fast-path — concretized), FR-34 (banked-calibration → stint-close obligation) |
| `DOCUMENT` (playbook/memory) | FR-5 (tool prefix), FR-6 (stacked-merge), FR-9 (checkout/untracked), FR-10 (file-state reset), FR-13 (verifier queue — banked), FR-17 (write-retry verify-before-recreate) |
| `ACCEPT` | FR-12 (parallel-load-self honesty) |
| `DESIGN-FIRST` (council prerequisite) | FR-20 (council process + agenda + multi-party friction intake — design before convening) |

**Pattern observation:** the `COUNCIL` cluster (FR-1/3/11/14) is mostly **coordination-mechanism + architect-runtime cadence** — i.e. the autonomous-stint model's *coordination ergonomics*, not its correctness. The model is sound; its friction is in the human-replacing-coordination loop (pulses, notes, reporting cadence, self-pacing). That is exactly the C1 work-control-plane + C2 supervisor + D-3 telemetry territory — several of these frictions likely DISSOLVE once coordination runs through the sovereign work-queue + a supervisor-controller rather than ad-hoc pulses/notes. The council should test that hypothesis: **how many of FR-1/2/3/11/13/14 are artifacts of pre-C1 manual coordination that the keystone retires?**

## The adversarial council (DEFERRED — convene at a genuine build-lull)

Per Director direction (2026-06-22): *"adversarially convene the real council when you have appropriate time and focus."* NOT now (mid-C1-R2-build, tight greg+Steve coordination). When the C1-R2 build reaches a lull (e.g. between sub-PR-3 and sub-PR-4, or post-assembly):

- **Vehicle:** an adversarial multi-agent panel (the CDACC dual-altitude pattern — `docs/methodology/cdacc-dual-altitude-conformance-council.md` — or a Workflow adversarial panel), NOT a solo architect pass. The whole point is independent perspectives stress-testing each friction + the proposed fixes.
- **Charge:** for each `COUNCIL` friction — is the proposed fix right, or does it paper over a deeper model flaw? + the pattern-observation hypothesis (which frictions does C1/C2/D-3 dissolve vs which are intrinsic?). + surface frictions this v1 missed (a completeness critic).
- **Output:** ratified fixes (→ ideas/missions/calibrations) + a sharper autonomous-stint operating model. Calibration filings are architect-fileable as of 2026-06-27 (PR #370) — council-output calibrations file directly (evidence-anchored + peer-verified) with the Director curating, NOT Director-direct-gated.

**Status (2026-06-22, post-C1-R2-arc-seal):** the build-lull trigger has ARRIVED (keystone + hardening + RBAC all sealed), and the backlog was refreshed to FR-20 + positive patterns (Section F). **Director-deferred** — *"We will not proceed with council now."* The council remains a STANDING convene-on-Director-signal action.

**Prerequisite before convening (FR-20, Director-flagged):** the council PROCESS itself is undesigned. Design it first — (a) **multi-party friction intake**: greg (engineer) + Steve (verifier) each surface their role's lived frictions, not just architect-observed; (b) the **deliberation format + agenda + output→ratification flow**. The Vehicle/Charge/Output above is a sketch, not a designed process. This design is itself a "to be designed later" item, not part of this stint.

---

## Provenance
Opened 2026-06-22 (stint-2) at Director direction after the FR-1 pulse false-escalation. Frictions FR-1..14 are from stint-1 + stint-2 lived experience. Living doc — append as new friction surfaces; re-triage at each council convening.

Updated 2026-06-22 (post-C1-R2-arc-seal): +Section F (FR-15..19 + positive patterns) from the keystone/hardening/RBAC arc-execution; council-trigger lull arrived but Director-deferred ("We will not proceed with council now").

Updated 2026-06-27 (C1-adoption go-live): +FR-21 (no agent-self-service tool-surface refresh — manual `/reload-plugins` per session; idea-121-alleviated) +FR-22 (Hub-restart → event-bridge backlog replay storm), both Director-flagged during the `create_work` on-ramp deploy + 3-agent resurface.

Updated 2026-06-27 (post-dogfood-2, pre-compaction handover): +Section G (FR-23..FR-30) — **FR-23 OPERATOR-AS-LIFECYCLE-BOTTLENECK is the Director-emphasized headline** (manual restarts/hops/deploys/nudges all stint) + dogfood-2 & adapter-hygiene frictions (forked adapter, adapterVersion-mis-report, deprecated-tool, block_work-not-durable-park, AC1-needs-deploy, async-thread-race, adapter/shim terminology). Refs idea-353/354/355, bug-182/183/184/185. Next-arc focus SET (Director): consolidate the substrate via **idea-355**.

Updated 2026-06-27 (stint-3, idea-355 dogfood-3 in flight): +Section H (FR-31) — PR merge/approval workflow is one-size-fits-all (every PR: BEHIND→update-branch→re-CI→merge; auto-merge disabled; `--admin` no-override; author-can't-self-approve; no CI-green/merge-ready signal). Director-flagged: design scenario-appropriate merge workflows + approval policies. Refs idea-357 (event/merge-ready signal), FR-23 (operator-bottleneck class). Calibration filing-gate relaxed this stint (architect-fileable, Director-curates; PR #370) — so council-output calibrations are no longer Director-direct-only.

Updated 2026-06-28 (stint-3 retrospective harvest): +Section I (FR-32 verifier-can't-run-tests + greg's copy-from-template / 57P01-pre-warn / docker-check handoff detail; FR-33 thread round-cap on operational handshakes [thread-709 10/10]; FR-34 banked-only-calibrations are a cross-stint loss vector → "banked for retro" becomes a tracked stint-close obligation) + CONCRETIZED FR-31 (docs-only merge fast-path: `docs/**`-confined diffs skip the BEHIND→update-branch→re-CI formality) + **ENGINEER-INTAKE (greg)** discharging the engineer half of FR-20 (3 first-person frictions — pre-gate path-completeness, claim-time scoping under-count [cal #88 sizing corollary], trust-critical AC-fork surfacing latency — plus the mutation-proof + real-substrate-before-gate amplify). **VERIFIER (steve) first-person intake remains PENDING** — FR-20 stays open until it lands.
