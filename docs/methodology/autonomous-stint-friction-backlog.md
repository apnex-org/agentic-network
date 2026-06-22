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

### (reinforces FR-3) note round-trip overhead recurred heavily
The `kind=note` response loop (peer's note → claim → ack → reply-note, 2-3 calls each, "silent" delivery that doesn't wake the peer) was the dominant engineer↔architect channel this arc. Another data point that note is a heavyweight, ambiguous response channel vs a thread turn.

### ✅ What WORKED — positive patterns for the council to weigh formalizing
**(a) Ultracode adversarial Workflow panel as a deploy-gate complement.** For the real-live-effect bug-175 deploy (#2, repo-wide RBAC fail-CLOSED), an 8-agent panel (wf_98785060) ran in parallel with the single verifier (Steve) — independently TRIPLE-confirming the Director-lockout was moot + sweeping the caller-path breadth + the ~50-test migration fidelity a single verifier might not exhaustively cover; converged with the verifier on DEPLOY-READY. **(b) Verifier-authored acceptance-oracle BEFORE the engineer builds the fix** (audit-4120) caught two weak fix-shapes pre-implementation, saving re-verify rounds. Candidates: formalize "verifier + adversarial panel" for repo-wide / real-live-effect deploys (verifier-only for narrow/dormant), and "oracle-before-artifact" as standard for non-trivial fixes.

---

## Triage summary

| Disposition | Frictions |
|---|---|
| `COUNCIL` (deferred adversarial review) | FR-1 (pulse ack-vs-activity), FR-3 (note-delivery contract), FR-11 (memory cadence), FR-14 (reporting cadence), FR-15 (thread read-projection lag), FR-18 (thread round-cap/turn-lock fragmentation) |
| `IDEA` (filed) | FR-7 (idea-346 + idea-344 cluster), FR-17 (idempotency-key on entity-create — candidate) |
| `FIX-NOW` (done or small-owned) | FR-2 (pulse merge — needs eng), FR-4 (deprecated tool), FR-8 (fail-closed filter — done in R2), FR-16 (bug-178 CI teardown flake), FR-19 (pulse stale-text) |
| `DOCUMENT` (playbook/memory) | FR-5 (tool prefix), FR-6 (stacked-merge), FR-9 (checkout/untracked), FR-10 (file-state reset), FR-13 (verifier queue — banked), FR-17 (write-retry verify-before-recreate) |
| `ACCEPT` | FR-12 (parallel-load-self honesty) |
| `DESIGN-FIRST` (council prerequisite) | FR-20 (council process + agenda + multi-party friction intake — design before convening) |

**Pattern observation:** the `COUNCIL` cluster (FR-1/3/11/14) is mostly **coordination-mechanism + architect-runtime cadence** — i.e. the autonomous-stint model's *coordination ergonomics*, not its correctness. The model is sound; its friction is in the human-replacing-coordination loop (pulses, notes, reporting cadence, self-pacing). That is exactly the C1 work-control-plane + C2 supervisor + D-3 telemetry territory — several of these frictions likely DISSOLVE once coordination runs through the sovereign work-queue + a supervisor-controller rather than ad-hoc pulses/notes. The council should test that hypothesis: **how many of FR-1/2/3/11/13/14 are artifacts of pre-C1 manual coordination that the keystone retires?**

## The adversarial council (DEFERRED — convene at a genuine build-lull)

Per Director direction (2026-06-22): *"adversarially convene the real council when you have appropriate time and focus."* NOT now (mid-C1-R2-build, tight greg+Steve coordination). When the C1-R2 build reaches a lull (e.g. between sub-PR-3 and sub-PR-4, or post-assembly):

- **Vehicle:** an adversarial multi-agent panel (the CDACC dual-altitude pattern — `docs/methodology/cdacc-dual-altitude-conformance-council.md` — or a Workflow adversarial panel), NOT a solo architect pass. The whole point is independent perspectives stress-testing each friction + the proposed fixes.
- **Charge:** for each `COUNCIL` friction — is the proposed fix right, or does it paper over a deeper model flaw? + the pattern-observation hypothesis (which frictions does C1/C2/D-3 dissolve vs which are intrinsic?). + surface frictions this v1 missed (a completeness critic).
- **Output:** ratified fixes (→ ideas/missions/calibrations) + a sharper autonomous-stint operating model. Calibration filings stay Director-direct/bilateral.

**Status (2026-06-22, post-C1-R2-arc-seal):** the build-lull trigger has ARRIVED (keystone + hardening + RBAC all sealed), and the backlog was refreshed to FR-20 + positive patterns (Section F). **Director-deferred** — *"We will not proceed with council now."* The council remains a STANDING convene-on-Director-signal action.

**Prerequisite before convening (FR-20, Director-flagged):** the council PROCESS itself is undesigned. Design it first — (a) **multi-party friction intake**: greg (engineer) + Steve (verifier) each surface their role's lived frictions, not just architect-observed; (b) the **deliberation format + agenda + output→ratification flow**. The Vehicle/Charge/Output above is a sketch, not a designed process. This design is itself a "to be designed later" item, not part of this stint.

---

## Provenance
Opened 2026-06-22 (stint-2) at Director direction after the FR-1 pulse false-escalation. Frictions FR-1..14 are from stint-1 + stint-2 lived experience. Living doc — append as new friction surfaces; re-triage at each council convening.

Updated 2026-06-22 (post-C1-R2-arc-seal): +Section F (FR-15..19 + positive patterns) from the keystone/hardening/RBAC arc-execution; council-trigger lull arrived but Director-deferred ("We will not proceed with council now").
