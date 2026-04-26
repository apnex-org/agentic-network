# M-Push-Foundation Mission Retrospective

**Status:** Draft v0.1 (architect-authored 2026-04-26 ~19:10 AEST; collaborative walkthrough with Director)
**Scope:** Mission-56 (M-Push-Foundation) execution — from W0 spike dispatch through mission status flip to completed
**Window:** 2026-04-26 ~05:32Z → ~09:05Z (~3h 33min real-time including dogfood gate + Director-paced cross-approvals)
**Author:** lily / architect
**Walkthrough:** Director-paced; one section per chat round; doc updated per Director feedback inline (same shape as `m-push-foundation-pre-mission-arc-retrospective.md`)

---

## §1 Context + scope

### Why this retrospective exists

Director directive 2026-04-26 ~19:09 AEST: *"Commence retrospective"* — issued post mission-56 status-flip to `completed` per the autonomous-arc-driving pattern's binding HOLD point ("HOLD for Director retrospective per autonomous-arc-driving pattern" — `feedback_complete_mission_scope_methodically`).

This is the post-mission retrospective the pattern scheduled. It captures what the mission-56 execution arc surfaced: which patterns held under live execution, which calibrations were earned mid-flight, what mechanise+declare retirement events landed, and what's queued for strategic-review post-retrospective.

### What the mission execution covered

5 wave-clusters across 13 deliverables in 13 PRs:

1. **W0** — spike report + read-path grep audit + structural decisions for W1–W4
2. **W1a + W1b** — Hub-side push-on-Message-create + Last-Event-ID SSE protocol + cold-start replay
3. **W2.1 + W2.2 + W2.3** — `@ois/message-router` sovereign-package #6 + adapter SSE handler integration + claude-plugin source-attribute taxonomy
4. **W3.1 + W3.2 + W3.3** — `list_messages.since` cursor + `claim_message`/`ack_message` MCP verbs + Message status FSM + adapter hybrid poll backstop
5. **W4.1 + W4.2 + W4.3** — DirectorNotification sunset + Notification sunset + PendingActionItem **scope correction** (doc-only; Option C deferral to idea-207)
6. **W5** — closing audit + ADR-026 + entity-store removal cleanup

**Cumulative ship:** 13 PRs (#70–#82) merged 2026-04-26; ~3h 33min real-time end-to-end (mission-active 05:32Z → mission-completed 09:05Z); +19 net hub vitest cases + 45 adapter cases; new sovereign-package #6 + 2 new MCP verbs + 9 production call-sites migrated.

### Predecessor context

This retrospective is the **second** of two retrospectives on the M-Push-Foundation mission lineage:

- **Pre-mission-arc retrospective** (`docs/reviews/m-push-foundation-pre-mission-arc-retrospective.md`; PR #66) — covered the lead-up arc (mission-54 recon + mission-55 cleanup + Design v1.2 authoring + round-2 audit); codified the **autonomous-arc-driving pattern** + **communication mediation invariant** + **methodology calibration #23** (formal-Design-phase-per-idea + tele-pre-check) as binding doctrine before mission-56 activation.
- **This retrospective** (mission-56 execution) — covers what those binding patterns produced under live execution; codifies new calibrations earned mid-flight; documents the first end-to-end mission shipped under the autonomous-arc-driving pattern.

The pre-mission retro was the *ratification* moment; this retro is the *first canonical execution example* of the patterns operating under load.

### What's complete

- **mission-56 status:** `completed` (flipped 2026-04-26 ~09:05Z post W5 PR merge)
- **All 13 deliverables shipped:** 12 substantive + 1 closing wave; cleanly across 13 PRs (one PR per sub-deliverable + W5 closer)
- **Engineer-authored closing audit:** `docs/audits/m-push-foundation-closing-audit.md` (W5 PR #82) — 8-section deliverable-scorecard + per-wave architecture recap + side findings; engineer-perspective
- **ADR-026 ratified:** `docs/decisions/026-push-pipeline-and-message-router.md` (W5 PR #82) — Universal Adapter 3-layer Phase 1 push-pipeline architecture; companions ADR-024 (StorageProvider) + ADR-025 (Message primitive)
- **Mechanise+declare retirements landed:** DirectorNotification entity, Notification entity, calibration #4 architect manual ping discipline (push pipeline structurally closes via W2.x adapter SSE handler)
- **Tier 2 follow-ons filed:** idea-206 M-Mission-Pulse-Primitive (Director-proposed declarative per-mission Hub-scheduled-Message pulse), idea-207 M-PAI-Saga-On-Messages (W4.3 deferred work; saga rewrite onto Message-store), M-Adapter-Distribution (npm publish under @apnex/* — staged pre-W5)

### What this retrospective is for (vs the audit)

The closing audit catalogues *what shipped* (deliverable scorecard, per-wave architecture, success criteria scoring, code stats) — engineer-authored, engineer-perspective, ships in W5 PR for repo-permanent record.

This retrospective captures *what we learned* — methodology insights, pattern outcomes, calibrations earned, sequencing decisions, and what the autonomous-arc-driving + mediation invariant patterns produced under live execution. Architect-authored, collaborative with Director, methodology-doctrine-bound.

The two complement each other:

| Question | Audit answers | Retrospective answers |
|---|---|---|
| What shipped? | Yes (per-wave scorecard) | Brief recap; not the focus |
| Why this scope? | Yes (success criteria → Design v1.2 commitments) | Briefly; not the focus |
| What broke? | Yes (cross-package vitest baseline; W0 D1 grep undercount) | What we learned about catching it |
| What patterns held? | No | **Yes (this retro's primary lens)** |
| What patterns we'd retire? | No | **Yes** |
| What new calibrations? | Brief mention | **Yes (full unpack with binding language)** |
| What sequencing for next mission? | Pointer to ideas | **Yes (recommendation)** |
| Who authored? | Engineer | Architect, collaborative with Director |

### Methodology framing

This retrospective is the **first execution-level retrospective** under the post-pre-mission-arc methodology stack:

- **Calibration #23** (formal-Design-phase-per-idea + tele-pre-check) — mission-56 is the **third canonical execution example** following mission-54 (recon-as-spike) + mission-55 (cleanup against ratified Design)
- **Autonomous-arc-driving pattern** — first canonical EXECUTION example (the pre-mission arc was the codification moment, but mission-54 + mission-55 were Director-paced; mission-56 was the first full-mission autonomous-arc execution post-codification)
- **Communication mediation invariant** (Director ↔ Engineer through Architect; binding) — held throughout; no direct Director↔Engineer surfaces required despite long execution arc
- **Mechanise+declare principle** (`feedback_mechanise_declare_all_coordination`) — surfaced mid-mission as binding tele principle by Director; W4 retired the first three coordination patterns; pulse primitive (idea-206) names the next mechanise+declare horizon

### What's at HOLD post this retrospective

- **Strategic-review triage** of Tier 2 ideas (idea-206 / idea-207 / M-Adapter-Distribution) — sequencing decision for next mission selection
- **Methodology doc updates** — `mission-lifecycle.md` v1.0 ratification (codifies pulse semantics + autonomous-arc-driving pattern); `multi-agent-pr-workflow.md` v1.1 (cross-approval pattern formalization with declarative routing)
- **idea-206 design phase** if pulse primitive selected as next mission

---

## §2 Timeline + Director-engagement categorisation

### §2.1 Mission execution timeline (wave-granularity)

Mission-56 ran continuously from activation gate to mission-status flip; ~3h 33min real-time. Wave transitions were marked by PR-merge events; cross-approval cycles were architect-immediate post-engineer-PR-open.

| Time (Z) | Phase / event | Wave | Notes |
|---|---|---|---|
| 05:32 | mission-56 status flipped to `active` (Director release-gate) | — | Architect autonomous-arc-driving begins; categorised concerns only |
| ~05:33 | W0 dispatch via thread-326 → greg | W0 | Spike directive issued; architect-autonomous |
| ~05:48 | PR #70 W0 spike report opened + cross-approved + admin-merged | W0 | Standard cross-approval cycle (engineer-pool ✓ on architect-content / vice versa) |
| ~05:54 | thread-330 W1b T1 dispatch (Last-Event-ID protocol) | W1b | After W1a self-launched in same wave |
| ~06:10 | PR #71 W1a + PR #72 W1b merged | W1a/b | First substantive ship; push-on-create + Last-Event-ID live in Hub source |
| ~06:18 | thread-331 fresh-context re-onboarding for W2 cascade | W2 | Engineer context-budget surface; full-state re-onboarding thread |
| ~06:38 | PR #73 W2.1 (`@ois/message-router` sovereign-package #6) merged | W2.1 | New package; calibration #20 file:-ref dist/-commit pattern |
| ~06:55 | PR #74 W2.2 adapter SSE handler integration merged | W2.2 | **Push pipeline NOT YET LIVE in adapter** (greg's running adapter still loaded pre-W2.2 code) |
| ~07:00 | Director: "I will restart greg" → context-reset gate | W2/W3 boundary | Director operational support (architect lacks restart capability per bug-34) |
| ~07:05 | thread-333 fresh-context re-onboarding post-restart | W2 | Architect translated W2.2 ratified state for fresh-context greg |
| ~07:10 | **Hub redeploy + greg adapter restart cycle** | dogfood gate | Architect-ran build via Cloud Build; Director-approved redeploy; both adapters auto-reconnected on new code |
| ~07:20 | PR #75 W2.3 source-attribute taxonomy merged | W2.3 | Closes W2 cascade |
| ~07:23 | **Dogfood verification: thread-336 dispatch → greg response in ~2.5min** | post-W2.x | Push pipeline e2e verified; bug-34 closes structurally |
| ~07:30 | PR #76 W3.1 list_messages.since cursor merged | W3.1 | |
| ~07:37 | PR #77 W3.2 claim/ack + Message FSM merged | W3.2 | Two-step semantics live |
| ~07:54 | PR #78 W3.3 hybrid poll backstop + claim/ack wiring merged | W3.3 | Closes W3 cascade |
| ~07:58 | thread-340 W4 T1 dispatch (legacy entity sunset cascade) | W4 | Engineer surfaced sub-PR shape proposal + context-budget concern |
| ~08:00 | Director ratifies Option A (context-reset for fresh W4.x session) | W4 boundary | |
| ~08:04 | thread-341 W4 RE-ONBOARDING for fresh-context greg | W4.1 | |
| ~08:14 | PR #79 W4.1 DirectorNotification sunset merged | W4.1 | First mechanise+declare retirement |
| ~08:18 | thread-343 W4.2 RE-ONBOARDING (second context-reset for W4.2/W4.3 budget) | W4.2 | |
| ~08:27 | PR #80 W4.2 Notification sunset merged | W4.2 | Second mechanise+declare retirement; no-double-send analysis load-bearing |
| ~08:33 | **thread-345 W4.3 SCOPE-FLEX surfaced by greg** | W4.3 | Re-grep showed 16 sites (vs W0 D1 estimate of 7); structural difference (saga vs notification record) |
| ~08:37 | Architect Option C recommendation + idea-207 file in parallel | W4.3 | |
| ~08:38 | idea-207 M-PAI-Saga-On-Messages filed | W4.3 | |
| ~08:40 | Director ratifies Option C ("Approved for autonomous execution") | W4.3 | |
| ~08:43 | PR #81 W4.3 doc-only scope correction merged | W4.3 | Closes W4 cascade (3/3) |
| ~08:43 | task-388 W5 directive dispatched | W5 | Closing wave; ~½d sizing |
| ~09:02 | PR #82 W5 closing wave merged (closing audit + ADR-026 + entity cleanup) | W5 | Mission-56 W5 lands |
| ~09:05 | mission-56 status flipped to `completed` (architect-direct) | close | Cascade did not auto-flip; manual update_mission |
| ~09:09 | "Commence retrospective" — Director gate | post-mission | This document |

**Cadence pattern observation:** post-W2.2 adapter restart, the architect-engineer round-trip latency dropped from ~20-30min (architect-poll-driven) to ~2-5min (push-driven via thread_message events). Wave-cadence accelerated visibly after the dogfood gate; W3.1 → W3.2 → W3.3 + W4.1 → W4.2 cascade shipped in ~50min vs the earlier W1a → W1b → W2.1 cascade taking ~70min on the same scope-density.

### §2.2 Director-engagement categorisation

Per the pre-mission-arc retrospective's categorised-concerns table (§1.1), the autonomous-arc-driving pattern measures success by *architect→Director surface frequency* + *category-fit of those surfaces*, not by total Director-engagement volume. Director may engage proactively (queries, ratifications, tele-surfaces) without violating the pattern; what matters is whether the *architect surfaces routine-mechanics concerns that should have stayed architect-owned*.

**Architect → Director surfaces during mission-56 execution (categorised):**

| # | Surface | Category | Warranted per table? |
|---|---|---|---|
| 1 | "Approved to Proceed for redeploy" — Hub redeploy ask | Out-of-scope risks (deployment-affecting) | YES |
| 2 | bug-40 file ask ("Log hub issue as a bug") — Hub presence-projection drift | Director was the surfacer; architect filed | YES (filed bug; not surface-blocked) |
| 3 | W4.3 scope-flex Option C escalation — saga vs notification structural difference | Strategic/architectural + mission-scope decision | YES |

**Three architect-surfaces across ~3.5h execution.** All three category-fit per the table; none were day-to-day mechanics. Architect-surface density: **~1 every 70min** — substantially lower than the pre-mission arc's ~1 every 20min (which itself was acceptable for active co-design).

**Director-initiated engagement during mission-56 (NOT architect-surfaces):**

| # | Engagement | Type |
|---|---|---|
| D1 | "Greg has gone idle, and has flagged that context should be refreshed" | Operational support (Director sees what architect can't — engineer-side context-state) |
| D2 | "Stay focused on advancing. Closing the PR coordination gap is already handled in a future mission" | Scope discipline correction (mid-arc) |
| D3 | "I will restart greg" + "I have fully reset greg's context" | Operational support (architect lacks restart capability per bug-34) |
| D4 | "Lower your schedule to 15 minutes. What you have is too long" | Methodology calibration (cadence cap) |
| D5 | "Yes flag, and log as a follow on mission" — pulse idea ratification | Tier 2 follow-on filing trigger |
| D6 | "As per Tele, all coordination, low-value logic and execution to be mechanised, and declarative" | **Binding tele principle ratification** |
| D7 | "What just happened? Does this mean now that a PR will trigger SSE notifications?" | Clarification query (about own mission outputs) |
| D8 | "Lets not rush ahead. Let's make sure we carefully complete current mission scope" | Methodology calibration (methodical-pacing) |
| D9 | "Dut you're saying our new MessageRouter logic and Message primitives are functional?" | Clarification query |
| D10 | "What is the steps to upgrade your adapter now?" | Clarification query |
| D11 | "I restarted lily's client already - is our new adapter good?" | Verification query |
| D12 | "While greg is working - I noticed PR merges showed errors saying 'branch could not be deleted'" | Clarification query (resolved as cross-worktree pattern) |
| D13 | "Agree on mission pulse idea. Let's make sure it is lodged as an idea for triage and design" | Tier 2 follow-on confirmation |
| D14 | "Greg is restarted and currently working - is it correct?" | Verification query |
| D15 | "The 'M-Architect-Scheduled-Wakeup-Adoption' is probably superceded by our configurable 'Mission Pulse' idea - correct?" | Architectural-supersession ratification |
| D16 | "The hub is local. We are not deploying to Cloud" / "But the build is via cloud build" | Clarification (Hub-deployment confusion correction) |
| D17 | "Couldn't we simple schedule wakeups driven via the hub?" | Architectural seed (became idea-206) |
| D18 | "Commence retrospective" | HOLD gate (this document) |

**18 Director-initiated engagements; 0 architect-surface violations (no day-to-day mechanics surfaced).**

The Director-side engagement profile breaks down as:

| Type | Count | Implication |
|---|---|---|
| Operational support (greg restart, context-reset) | 2 | bug-34 architectural gap that mission-56 closes structurally |
| Methodology calibrations | 2 | New binding calibrations earned mid-mission (saved as `feedback_*` memories) |
| Tele/architectural ratifications | 4 | Mechanise+declare principle; pulse architectural seed; supersession; Option C |
| Tier 2 follow-on filing triggers | 2 | idea-206 + idea-207 + (M-Adapter-Distribution staged elsewhere) |
| Clarification + verification queries | 7 | Director engaging-as-collaborator with own substrate / mission outputs |
| Scope-discipline correction (mid-arc) | 1 | "Stay focused on advancing" + "Don't rush ahead" |
| HOLD gate | 1 | This retrospective |

**Read:** the autonomous-arc-driving pattern held cleanly. Architect surfaced exactly what the categorised-concerns table predicts (deployment risk + strategic scope-flex + bug discovery). Director-side engagement was high but in the *Director-as-active-collaborator* mode, not *Director-as-watchdog* mode — querying outputs, ratifying tele surfaces, providing operational support around bug-34, surfacing methodology calibrations.

The right metric isn't engagement-volume; it's **whether architect held the gate on routine mechanics**. Architect did. Cross-approval, PR-merge, branch-delete failures, T1+ dispatch, bilateral seals, mission status flip — all architect-autonomous.

### §2.3 Comparison to pre-mission arc

| Dimension | Pre-mission arc | Mission-56 execution |
|---|---|---|
| Real-time window | ~110 min | ~213 min (~3h 33min) |
| Architect→Director surfaces | ~9 (all categorised) | 3 (all categorised) |
| Surface density | ~1 / 20min | ~1 / 70min |
| Director-initiated engagement | (not separately counted) | 18 (mostly clarifications + tele/operational) |
| Coordination latency profile | Architect-poll-driven (15min cap calibration earned MID-mission) | Mixed: architect-poll pre-W2.2; push-driven post-W2.2 dogfood |
| Wave count | 4 (mission-54 + Design v1.2 + mission-55 + audit) | 5 (W0 → W5) + 13 deliverables |
| Director-as-watchdog moments | 0 | 0 |
| Pattern violations | 0 | 0 |

**Surface-density dropped 3.5×** between pre-mission arc and mission-56 execution. Two reinforcing factors:

1. **Pattern codification was load-bearing.** The pre-mission arc EARNED the autonomous-arc-driving codification through nine intentional surfaces; mission-56 EXECUTED against the codified pattern with crisp filtering. Architect knew exactly which categories warranted Director surface vs which were architect-owned.
2. **Push pipeline going live mid-mission compressed the inner loop.** Post-W2.2 dogfood, architect-engineer coordination dropped from ~20-30min round-trip to ~2-5min. Less standing-around-time meant fewer "should I surface this?" deliberation moments; the architect just acted within the categorised-concerns frame.

The third factor that COULD have raised surface-density (didn't):

3. **W4.3 scope-flex was a textbook strategic-architectural surface.** Architect could have over-surfaced (e.g., asking Director after every sub-PR ship) or under-surfaced (e.g., shipping all 16 PAI sites via Option A without escalating). Architect chose the categorised-concerns-table-perfect path: surface the structural difference + 3 options + recommendation; let Director decide. Director ratified Option C in one round.

**Observation worth carrying forward:** the autonomous-arc-driving pattern's success metric should be **architect→Director surface frequency conditional on category-fit**, not raw engagement volume. Director-as-active-collaborator is a *feature*, not a *pattern violation*.

---

## §3 Architectural commitments — what landed, what deferred

This section reads commitments at the *design-intent* level (vs the audit's per-wave deliverable scoring). The lens: **what does each commitment's outcome say about Design v1.2's design-time framing vs execution-time reality?**

### §3.1 Commitment outcomes (intent-level)

Design v1.2 §"Architectural commitments" locked 7 commitments before mission activation. Outcomes:

| # | Commitment (intent) | Landed? | Shape vs design-time | Notes |
|---|---|---|---|---|
| 1 | **Push-on-Message-create** — SSE event fires synchronously after Message commit | ✅ as designed | No drift | message-policy.ts:188-221; non-fatal on dispatch failure |
| 2 | **Last-Event-ID SSE protocol + cold-start replay** | ✅ as designed | No drift | Hub-internal `replayFromCursor`; soft-cap synthetic event at 1000 |
| 3 | **`@ois/message-router` sovereign-package #6** | ✅ as designed | No drift | Layer-2 router; seen-id LRU N=1000; kind/subkind routing skeleton |
| 4 | **Per-host source-attribute taxonomy at Layer-3** | ✅ as designed | No drift | claude-plugin shim; 4-kind taxonomy + per-subkind discrimination |
| 5 | **Hybrid push+poll backstop with `since` cursor** | ✅ as designed | No drift | 5min default; OIS_ADAPTER_POLL_BACKSTOP_S env override; 60s floor |
| 6 | **claim/ack two-step semantics + Message status FSM** | ✅ as designed | No drift | `new → received → acked` linear monotonic CAS; multi-agent winner-takes-all |
| 7 | **Legacy entity sunset (DirectorNotification + Notification + PendingActionItem)** | 🟡 **partial — re-scoped mid-mission** | Substantive drift | 2/3 sunset + 1/3 properly deferred to idea-207 (Tier 2) |

**6 of 7 commitments landed exactly as designed.** Commitment #7 split: 2/3 entities retired (DirectorNotification + Notification → Message-store projection) + 1/3 (PendingActionItem) deferred via Director-ratified Option C to idea-207.

The commitment-#7 split is the headline architectural-outcome of mission-56. The rest of this section unpacks why that's a *first-class success outcome*, not a half-ship.

### §3.2 The W4.3 Option C deferral — a first-class outcome

**Design v1.2 framing (commitment #7):** *"Three legacy notification entities collapsed into Message-store projection."* Treats DirectorNotification + Notification + PendingActionItem as homogeneous notification records.

**Execution-time reality (re-grep at start of W4.3):** PendingActionItem is a **saga FSM primitive**, structurally distinct from notification records:

| Dimension | DirectorNotification + Notification (W4.1 + W4.2) | PendingActionItem |
|---|---|---|
| Substrate | Append-only notification record | Saga FSM with explicit lifecycle |
| State model | None (entity exists or doesn't) | `enqueued → receipt_acked → completion_acked / escalated / errored / continuation_required` |
| Watchdog primitives | None | `attemptCount`, `receiptDeadline`, `naturalKey`, `continuationState` |
| ADR ratification | None (entity-level) | ADR-017 (binding saga semantics) |
| Migration shape | Helper-pattern wrap; kind/payload encoding fits | Full saga rewrite (Message FSM `new→received→acked` doesn't cover escalated/errored/continuation states) |
| Sizing if migrated | ~1.5d (W4.1) / ~½d (W4.2) | 3-5 eng-days |

**Design-time framing carried two errors:**

1. **W0 §D1 read-path grep undercount** — said "7 read-paths"; actual was 16 sites (6 reads + 8 FSM mutations + 2 enqueues across watchdog + dispatch + drain + threading saga)
2. **Categorical mis-grouping** — treated PAI as a notification record alongside DirectorNotification + Notification; missed that ADR-017 makes it a saga primitive

**Execution-time correction discipline that caught it:**

1. `feedback_w4_subpr_regrep` — re-grep at the start of each W4 sub-PR (calibration earned post-W4.1 W0-undercount surface)
2. `feedback_proactive_context_budget_surface` — surface scope-flex BEFORE coding, not mid-implementation
3. `feedback_complete_mission_scope_methodically` — defer extensions to downstream missions; don't scope-creep mid-flight
4. Architect Option C tele-evaluation — recommended defer; categorised as strategic/architectural surface to Director
5. Director Option C ratification + idea-207 file in parallel — captures the deferred work as a properly-scoped Tier 2 mission

**Outcome:** ~3-5 eng-days of saga-rewrite work properly deferred + idea-207 captures it + W4.3 collapsed to a doc-only +2/-0 footnote correction; tele-7 (COMMS reliability) preserved by avoiding watchdog-escalation-ladder regression risk.

**Why this is a first-class outcome, not a failure:**

- Half-shipping commitment #7 against the over-aggressive design-time framing would have produced one of: (a) a saga-rewrite that landed but introduced regression risk, (b) a partial migration that violated the no-dual-write anti-goal, or (c) a deferred-merge that left the mission incomplete
- Honest scope-acknowledgment with proper deferral is the *correct* outcome when execution-time analysis reveals a design-time categorical error
- The discipline-stack that caught it is reproducible — re-grep + structural-difference analysis as default sub-PR opening pattern works for any "migrate legacy entity X" mission going forward
- The deferred work is now *properly scoped* (idea-207 has a real sizing estimate + saga-vs-notification framing + ADR-017 invariant preservation requirements + 16-site enumeration ready for design phase)

### §3.3 Side architectural outcomes worth recording

Three architectural outcomes landed that weren't on the Design v1.2 commitment list but are load-bearing for future work:

#### §3.3.1 messageStore graduated optional → required (W5)

W1b initially carried `messageStore` as **optional** on the HubNetworking constructor with a graceful-degradation fallback (`messageStore ? emitLegacyNotification : notificationStore.persist`). The fallback was rollout-period scaffolding while W4.x removed legacy stores.

W5 cleanup made the fallback structurally unreachable (notificationStore deleted) → messageStore graduated to **required** on the constructor. Production wires it at `index.ts:200`; test rigs (`policy/test-utils.ts` + `test/e2e/orchestrator.ts`) wire it.

This is a small but crisp **rollout-pattern** — optional-then-required graduation tied to legacy-store sunset. Worth carrying forward as a default pattern for future "introduce-then-replace" surfaces.

#### §3.3.2 Bug-34 structural closure mid-mission (post-W2.2)

Bug-34 was the architect manual coordination ping pattern observed in mission-55 retrospective: post-PR-merge, architect had to explicitly thread-message engineer to dispatch the next wave. The architect adapter lacked the SSE-event-handling capability to wake on engineer activity (PR open, thread reply, etc.).

**W2.2 adapter SSE handler integration** (PR #74) ships the missing capability. **Greg's adapter restart at ~07:10Z** loaded the W2.2 code. **Thread-336 dispatch ~07:23Z** verified the new path: architect-side dispatch → SSE event → greg's adapter shim → claim notification → response in ~2.5min.

bug-34 closes structurally (not just ergonomically) — the manual ping discipline is no longer architecturally required. It still has a role as a **declarative coordination pattern** that idea-206 (M-Mission-Pulse-Primitive) will codify properly.

#### §3.3.3 Mission-51 W6 deferral retired

mission-51 W6 (the canonical SSE push transport on the unified Message store) was an **explicit anti-goal** of mission-51 — captured as "deferred to a future mission." Mission-56 is that future mission. Push transport landed; the mission-51 deferral retires.

Worth flagging because the explicit-anti-goal-as-future-mission-handoff pattern worked cleanly — mission-51 was able to ship its core (Message primitive ADR-025) without scope-creeping push transport, and mission-56 inherited a clean substrate. This is a reproducible pattern for substantive feature work: **explicit deferral with named-future-mission handoff** lets the predecessor mission ship cleanly.

### §3.3 ADR-026 — what's settled vs what's open

ADR-026 (`docs/decisions/026-push-pipeline-and-message-router.md`; W5 PR #82) ratifies the **Universal Adapter Phase 1 push-pipeline architecture**:

- **Settled (Phase 1):** Hub-side push-on-create + Last-Event-ID protocol + cold-start replay; Layer-2 MessageRouter sovereign-package-#6; Layer-3 per-host shim render-surface; claim/ack two-step semantics; hybrid push+poll backstop; source-attribute taxonomy
- **Acknowledged-open (Phase 2/3):** MessageRouter inversion-of-control / handler-registration ergonomics (Layer-2 enrichment surface; future mission); npm publish under @apnex/* (M-Adapter-Distribution); Cognitive-Layer extraction (idea-198)
- **Acknowledged-deferred:** PAI saga rewrite (idea-207); pulse primitive (idea-206); workflow-FSM-completeness (idea-199)

ADR-026's §2.7 explicitly maps the W3.2 Message FSM to ADR-017's PAI saga happy path; §2.8 documents the Option C deferral as a known boundary, not a hidden gap. Future readers can compose against ADR-026 with full visibility into what's in-scope vs out-of-scope.

### §3.4 What the commitment outcomes say about Design v1.2's design-time framing

**Net read:** Design v1.2 was load-bearing and largely accurate, but carried *two narrow framing errors* that execution-time discipline caught:

| Framing error | Where caught | Cost-if-missed | Cost-actually-paid |
|---|---|---|---|
| W0 D1 read-path grep scoped to .list/.get only | W4.1 surfaced 5 write + 2 read (vs design's 2+1) | Sub-PR re-budget | One sub-PR slightly larger than estimated |
| PAI categorised as notification record (vs saga FSM) | W4.3 re-grep + structural-difference analysis | 3-5 eng-days saga-rewrite + tele-7 regression risk | Doc-only +2/-0 footnote + idea-207 file |

The two errors share a root: **Design v1.2 prioritized engineer-spec-level commitments over per-entity structural-difference analysis.** That's the right tradeoff at design time (otherwise design becomes implementation), but it places the burden on **execution-time re-grep + structural-difference discipline** to catch what design-time abstraction necessarily glosses over.

The discipline-stack that caught both errors (re-grep at sub-PR open + structural-difference analysis + proactive scope-flex surface + complete-mission-scope-methodically) is therefore *complementary* to calibration #23 (formal-Design-phase-per-idea + tele-pre-check), not a replacement. Calibration #23 raises Design quality; the execution-time discipline-stack catches what survives.

**Carrying forward:** future mission Designs that include "migrate legacy entity X" should explicitly require *structural-difference analysis at sub-PR open*, not just at Design time. The Design v1.2 §"Architectural commitments" template gains a new sub-clause: "for each entity migration, sub-PR opening must include re-grep + structural-difference analysis vs notification-record / saga-FSM / state-machine-primitive baselines."

---

## §4 Calibrations earned during execution

Mission-56 surfaced **8 new calibrations** worth carrying forward, plus 1 superseded calibration. Organized by source — Director-issued, Architect-side learned, Engineer-side learned (relevant to future Designs), and Cross-cutting (architectural-correctness patterns).

### §4.1 Director-issued calibrations (binding)

#### §4.1.1 Mechanise + declare all coordination, low-value logic, and execution

**Source:** Director ratification 2026-04-26 mid-mission (~D6 in §2.2 timeline): *"As per Tele, all coordination, low-value logic and execution to be mechanised, and declarative."*

**Memory:** `feedback_mechanise_declare_all_coordination.md`

**Strength:** Binding tele principle. Default architectural-design question for ALL future work: *"Can this coordination / logic / execution be declared as Hub state and driven by Hub primitives, instead of imperative code or manual cycles?"*

**Why earned now:** mission-56 W2.x dogfood verification surfaced that the push pipeline mechanises coord-handoff structurally; Director extracted the underlying principle and ratified it as binding for future design work. The principle aligns with 4 binding tele (tele-3 sovereign composition, tele-9 frictionless coordination, tele-10 Hub-as-single-source-of-truth, tele-2 isomorphic specification).

**Forward implications:**
- M-Mission-Pulse-Primitive (idea-206) is the next direct application — pulse declared as mission-entity state, driven by Hub-scheduled-Message sweeper
- mission-lifecycle.md v1.0 ratification (post-mission-56) should codify "mechanise + declare" as the default design discipline
- Future workflow primitives (idea-199 FSM-completeness; idea-197 auto-redeploy; etc.) all default to declarative shape
- Anti-pattern retire list: imperative coord paths, manual coordination pings between known-pattern events, hand-written cascade-equivalent logic

#### §4.1.2 Wakeup cadence cap at 15min for active autonomous-arc

**Source:** Director ratification 2026-04-26 mid-mission (~D4 in §2.2 timeline): *"Lower your schedule to 15 minutes. What you have is too long."*

**Memory:** `feedback_wakeup_cadence_15min_max.md`

**Strength:** Cadence-cap calibration; binding for active autonomous-arc execution.

**Why earned now:** architect's `ScheduleWakeup` defaults during mid-arc were 1500s/1800s/2400s/3600s (informed by Anthropic prompt cache 5min TTL). Director observed this missed the responsiveness window — greg ships PRs in 4-25min; longer wakeups stranded the architect-side check-in beyond the typical engineer-PR-cycle.

**Forward implications:**
- Default `ScheduleWakeup` ≤900s during active mission waves
- Channel notifications still wake earlier on signal; the cap is the *upper bound* for proactive checks
- Edge cases for shorter caps documented (greg session restart 600s, plan ratification 270s)
- Eventually retired by idea-206 pulse primitive (declarative cadence per mission class) — but cap discipline holds in the interim

#### §4.1.3 Complete current mission scope methodically; don't rush ahead

**Source:** Director ratification 2026-04-26 mid-mission (~D8 in §2.2 timeline): *"Lets not rush ahead. Let's make sure we carefully complete current mission scope and be methodical about next steps."*

**Memory:** `feedback_complete_mission_scope_methodically.md`

**Strength:** Mission-execution-discipline calibration; binding for active autonomous-arc.

**Why earned now:** post-W2.x dogfood, architect floated enabling the GH bridge for PR-driven push verification — outside mission-56 scope (mission-52 enable-bridge is its own concern). Director surfaced the calibration: stay on ratified scope; defer extensions/verifications to downstream missions; file as Ideas, not scope-flex.

**Forward implications:**
- During active mission execution: only surface scope-flex if load-bearing for current wave (engineer-side scope-flex flags are different — those are within-scope adjustments)
- Architect-side ideas/extensions DURING active mission: capture as Hub Idea entities for triage, NOT immediate-action proposals
- "We could also test X / verify Y / enable Z" — file as follow-on Ideas, not mid-mission Director ratification asks
- This calibration is *complementary* to autonomous-arc-driving (which says "drive autonomously"); together they say "drive autonomously WITHIN the ratified scope; file extensions for downstream missions"

### §4.2 Architect-side learned calibrations

#### §4.2.1 Pulse-primitive seed → idea-206 (declarative per-mission coord pulse)

**Source:** Director-architect dialogue mid-mission (~D17 in §2.2 timeline): *"Couldn't we simple schedule wakeups driven via the hub?"*

**Memory:** `project_mission_pulse_primitive.md`

**Strength:** Tier 2 follow-on mission concept; filed as idea-206 for strategic-review triage.

**Why earned now:** the mechanise+declare principle (§4.1.1) immediately suggested the architect-tooling-shift framing — replace local `ScheduleWakeup` with Hub-scheduled-Messages. Architect filed `project_hub_scheduled_wakeup_followon.md` as initial framing. ~30min later Director surfaced the broader pulse concept (declarative per-mission, with role-defaults, stop-conditions, sane cadence-per-role) which **subsumed** the architect-side framing.

**Architect-side calibration captured:** *"When filing follow-on missions DURING active execution, watch for redundancy with later-proposed broader missions. Director's pulse proposal absorbed the architect-scheduled-wakeup scope cleanly. The architect-tooling-shift framing was too narrow."*

**Forward implications:**
- `project_hub_scheduled_wakeup_followon.md` SUPERSEDED — explicitly noted in memory + redirects to idea-206
- idea-206 carries the broader concept (pulse with role-defaults; replaces calibration #4 manual ping discipline; mission-class-aware cadence; declarative coordination state)
- The supersession discipline (mark superseded; redirect downstream artifacts) avoids stale architect-side framings cluttering future strategic-review

#### §4.2.2 Director-as-active-collaborator vs Director-as-watchdog distinction

**Source:** §2.2 categorisation analysis surfaced the distinction; not pre-meditated.

**Memory:** Not yet filed; potential candidate for `feedback_director_engagement_modes.md` (TBD if worth memoizing).

**Strength:** Observational calibration on autonomous-arc-driving pattern measurement.

**Why earned now:** mission-56 had high Director-engagement (18 surfaces) but zero pattern violations. The naive read would be "pattern broke" — wrong. The right read: Director engaged proactively (queries, ratifications, tele surfaces, operational support) while architect held the routine-mechanics gate. The pattern's success metric is *architect→Director surface frequency conditional on category-fit*, not *Director-engagement volume*.

**Forward implications:**
- Future autonomous-arc-driving retrospectives should count architect→Director surfaces (categorised), not raw engagement volume
- Director-as-active-collaborator engagement is a feature: provides operational support, surfaces tele principles, ratifies follow-on ideas, validates outputs
- If architect surface-density rises without category-fit (e.g., surfacing PR cross-approvals to Director), pattern violation; correct
- If Director engagement is high but architect held the gate, pattern healthy

#### §4.2.3 Cross-worktree branch-deletion failure pattern

**Source:** Director observation mid-mission (~D12 in §2.2 timeline): *"some of the previous PR merges showed errors saying that the 'branch could not be deleted' - is this an issue?"*

**Memory:** Not filed (recoverable from git workflow); just architecturally noted.

**Strength:** Operational-pattern calibration; informational not corrective.

**Why earned now:** PR-merge with `--delete-branch` from architect's worktree fails to delete the local branch in greg's sibling worktree (greg's worktree has it checked out). Remote-side merge succeeds; local-side cleanup is a no-op-with-warning. Pattern is *cross-worktree harmless*, not a regression.

**Forward implications:**
- Document as a known pattern in worktree-setup notes (not a memory; lives in setup docs)
- No code change; just expectation-setting
- Worktree convention preserved (lily/greg sibling worktrees; main tree separate)

### §4.3 Engineer-side calibrations relevant to architect Design

These were earned by greg during mission-56 execution. Architect should reference them when authoring future mission Designs that involve "migrate legacy entity X" or "multi-sub-PR cascade":

#### §4.3.1 Re-grep-at-start-of-each-sub-PR discipline (`feedback_w4_subpr_regrep`)

**Source:** Engineer pre-existing; first canonical execution example post-W4.1 (W0 §D1 grep undercount surfaced; re-grep discipline applied + paid off).

**Why earned (originally):** Design-time grep estimates are necessarily approximate; sub-PR opening is the right moment to re-validate against current main.

**Architect-side relevance:** Future Designs that include "sunset / migrate / refactor entity X" should explicitly require re-grep + structural-difference analysis at each sub-PR open, not just at Design time. Add to mission-design template post-mission-lifecycle.md v1.0.

#### §4.3.2 Proactive context-budget surface (`feedback_proactive_context_budget_surface`)

**Source:** Engineer pre-existing (architect-flagged at thread-332 2026-04-26 pre-mission-56); first canonical execution example during mission-56 W4.3 scope-flex via thread-345.

**Why earned (originally):** Surface scope-flex with full ratified state at the start of substantive new work, not mid-implementation. Caught W4.3 scope-flex BEFORE any saga-rewrite damage.

**Architect-side relevance:** Future autonomous-arc-driving missions should expect engineer-side proactive surfaces; architect's role is to recognize them as legitimate (not "noise") and translate to Director-categorisation when warranted.

#### §4.3.3 Defer-calibration (explicit thread flag rather than unilateral pause)

**Source:** Engineer pre-existing; first canonical execution example during mission-56 W4.3 scope-flex.

**Why earned (originally):** Explicit thread flag preserves coordination; unilateral pause strands the architect waiting + risks pattern violation (architect surface to Director "engineer is silent" rather than engineer surfacing the actual scope concern).

**Architect-side relevance:** Future mission Designs should explicitly anticipate scope-flex moments and document the thread-flag-not-pause discipline as expected behavior.

### §4.4 Cross-cutting architectural-correctness calibrations

#### §4.4.1 No-double-send analysis as load-bearing PR practice

**Source:** W4.2 architectural-correctness analysis (Notification sunset + W1a push-on-create coexistence).

**Pattern:** When a new entity (Message-store push pipeline) coexists with a legacy entity migration (Notification sunset), the PR description should explicitly analyze and document the "no-double-send" guarantee — which code path fires which event under what circumstances.

**W4.2 specific:** `messageStore.createMessage` (helper-invoked directly) skips W1a push-on-create (which lives in the `create_message` MCP tool handler). Existing `notifyConnectedAgents` continues SSE delivery using `Message.id` as event-id (forward-compatible with W1b Last-Event-ID).

**Why earned:** subtle architectural-correctness detail easy to miss at Design-time; surfacing it explicitly in PR description + architect's seal flagged it as "W5 closing-audit-worthy correctness analysis."

**Forward implications:**
- Future PRs that introduce coexistence between new + legacy event-emission paths should include explicit no-double-send analysis in the PR description
- Reviewers verify the claim against code; future maintainers learn the boundary
- Calibration #23's tele-pre-check should flag coexistence scenarios as needing this analysis at Design time when possible

#### §4.4.2 Optional→required graduation pattern (introduce-then-replace)

**Source:** W1b shipped `messageStore` as optional with graceful-degradation fallback; W5 graduated to required after legacy stores deleted.

**Pattern:** When introducing a new substrate alongside a legacy one, ship as optional during rollout period; graduate to required once legacy is removed.

**Why earned:** The fallback was rollout scaffolding, not permanent design. Graduating it cleanly closed the rollout cycle.

**Forward implications:**
- Default pattern for "introduce-then-replace" surfaces
- Worth codifying in mission-lifecycle.md or a methodology doc as canonical rollout shape
- Avoids the anti-pattern of leaving optional/fallback parameters as permanent ergonomics noise

#### §4.4.3 Structural-difference analysis as default sub-PR opening

**Source:** W4.3 caught PAI-as-saga-FSM categorical mis-grouping vs notification-record W4.1/W4.2.

**Pattern:** When migrating "legacy entity X," sub-PR opening should explicitly compare X against baseline categories — notification record? saga FSM? state-machine primitive? identity primitive? — and surface any structural difference BEFORE any code lands.

**Why earned:** see §3.2; properly deferred 3-5 eng-days of saga-rewrite work + idea-207 captures it.

**Forward implications:**
- Add to Design template post-mission-lifecycle.md v1.0 (per §3.4 carrying-forward proposal)
- Future "migrate legacy entity X" missions should expect this analysis at sub-PR open; budget time for it
- Composable with re-grep discipline (§4.3.1) — re-grep produces the call-site enumeration; structural-difference analysis categorises the entity

### §4.5 Calibration cadence as mission-quality signal

**Mission-56 calibration count:** 8 new + 1 superseded across ~3.5h execution. Roughly **1 calibration earned per 25min**.

For comparison, mission-55 retrospective surfaced ~5-7 calibrations across a similar window. Mission-56's higher cadence reflects:

1. **First full autonomous-arc execution** — many calibrations were *latent in the pre-mission-arc retro* and crystallized under live execution (e.g., Director-as-active-collaborator distinction)
2. **Mid-mission tele principle ratification** (mechanise+declare) — Director surfaced a binding principle that immediately spawned downstream calibrations (pulse seed → idea-206; supersession of scheduled-wakeup framing)
3. **Mission-56's substrate-self-dogfood at W2.2** — exposed bug-34 closure + the inner-loop compression observation, triggering operational calibrations
4. **Multiple context-resets** (greg twice) — surfaced calibrations around proactive context-budget surface + re-onboarding-thread shape

**Read:** high calibration cadence isn't a defect signal — it's a *learning-density* signal. Mission-56 was a high-learning mission because it shipped the substrate that retires multiple imperative coordination patterns; the calibration surface is proportional to the structural change.

**Future check:** if a substantive mission ships with *low* calibration count, it might mean the methodology stack is mature enough to not need new calibration (good); or it might mean execution lacked discipline-stack rigor and missed catches (bad). Calibration cadence is a forward-looking quality signal worth tracking per-mission.

---

## §5 Patterns operationalized + retired

This section catalogues the patterns that mission-56 either *operationalized* (made routine through repeated cleanly-executed application) or *retired* (closed structurally via shipped substrate). It also tracks patterns *positioned for retirement* in the next 1-2 missions.

### §5.1 Patterns operationalized through mission-56 execution

#### §5.1.1 Autonomous-arc-driving pattern (first canonical execution)

**Status before mission-56:** Codified at the pre-mission-arc retrospective (§1.1) as binding doctrine.
**Status after mission-56:** First canonical full-mission execution example. 3 architect→Director surfaces in ~3.5h; all categorised; zero pattern violations. Pattern held under load.

**What "operationalized" means here:** the pattern moved from "codified-but-untested-at-execution-scale" to "executed-end-to-end-with-empirical-data-on-surface-density." Mission-56 produced the empirical baseline (~1 surface/70min) that future mission retrospectives can compare against.

#### §5.1.2 Communication mediation invariant

**Status before mission-56:** Codified at the pre-mission-arc retrospective (§1.2) as BINDING structural design invariant.
**Status after mission-56:** Held throughout. Zero direct Director↔Engineer surfaces required despite long execution arc + 2 engineer context-resets + multiple Director ratifications. All Director-engineer information flow routed through architect translation.

**Specific pressure points where it could have broken (didn't):**

| Pressure | Could-have-violated | What held |
|---|---|---|
| greg context-reset (×2) | Director directly re-onboarding greg | Architect authored re-onboarding threads (thread-331, thread-333, thread-341, thread-343); Director provided context-reset capability + ratifications only |
| Mid-mission tele principle (mechanise+declare) | Director directly re-scoping engineer work | Architect translated principle into design forward-implications; engineer continued ratified scope |
| W4.3 scope-flex | Director directly negotiating with engineer on Option A/B/C | Architect surfaced 3 options + recommendation; Director ratified Option C via architect; architect translated to engineer via thread-345 reply |
| Bug-40 surfacing | Director directly asking engineer about Hub presence-projection drift | Architect filed bug entity from Director's prompt; engineer was not consulted (bug is Hub-side, architect-owned filing) |

#### §5.1.3 Cross-approval pattern (engineer-pool ✓ + architect-pool ✓)

**Status before mission-56:** Stabilized informally during mission-55 (PR #60-#62 lineage); operational interpretation captured in PR #62 architect comment.
**Status after mission-56:** Extended to **23-PR consecutive uninterrupted lineage** (PR #60-#82). Pattern executed cleanly across all 13 mission-56 PRs (12 sub-deliverables + W5 closer). Bug-32 admin-merge baseline held throughout.

**Forward implication:** ratification-for-codification-in-`multi-agent-pr-workflow.md`-v1.1 (post-mission-56 methodology doc update) is well-supported. The pattern has 23-PR empirical evidence + zero violations.

#### §5.1.4 Sub-PR cascade pattern

**Status before mission-56:** Used opportunistically (e.g., mission-55 PR #63/#64/#65 for 10 deliverables in 3 PRs).
**Status after mission-56:** Operationalized at finer granularity — **one sub-deliverable per PR** when sub-deliverables are structurally separable (W2.1/2.2/2.3, W3.1/3.2/3.3, W4.1/4.2/4.3). 12 sub-deliverable PRs across W0-W4 + 1 closer = 13 PRs.

**Why finer-granularity worked:** push pipeline made cross-approval round-trip ~2-5min post-W2.2 → bundling sub-PRs no longer saved coordination cost. Granular PRs gave clearer per-deliverable review surface + cleaner per-deliverable git history.

**Forward implication:** future substantive missions should default to one-sub-PR-per-sub-deliverable when sub-deliverables are structurally separable + the push pipeline keeps round-trips compressed. Bundled PRs become the exception (e.g., when multiple deliverables share test-rebuild work).

#### §5.1.5 Re-onboarding-thread pattern (full-state context-reset)

**Status before mission-56:** Used opportunistically during long mission-55 execution.
**Status after mission-56:** Used 4× during mission-56 (thread-331 fresh-context for W2; thread-333 post-restart for W2; thread-341 fresh-context for W4.1; thread-343 fresh-context for W4.2/W4.3). Pattern stabilized: full ratified-state package + identity carry-forward + ratifications + cascade carry-forward + next-action specification.

**Forward implication:** worth codifying as part of the `feedback_proactive_context_budget_surface` engineer calibration's architect-side counterpart. Future mission Designs that anticipate long execution arcs should explicitly budget for re-onboarding threads.

#### §5.1.6 Helper-pattern for entity migrations

**Status before mission-56:** mission-51 W2 `message-helpers.ts` was the inaugural shape.
**Status after mission-56:** Replicated cleanly in W4.1 (`director-notification-helpers.ts` ~190 lines + 14 unit tests) and W4.2 (`notification-helpers.ts` ~80 lines + 5 unit tests). Pattern: helper module wraps Message-store with entity-semantic API surface (emit + projection + filtered-list + admin operations); legacy MCP tool surfaces preserved via the helper for backward compatibility.

**Forward implication:** standard pattern for "migrate legacy entity X" missions. idea-207 (M-PAI-Saga-On-Messages) will need a saga-shaped variant — the helper pattern composes with saga primitives but isn't a drop-in.

### §5.2 Patterns retired by mission-56 substrate

#### §5.2.1 Calibration #4 architect manual ping discipline (structural closure)

**Pattern (pre-mission-56):** post-PR-merge, architect explicitly thread-messages engineer to dispatch the next wave; required because architect adapter lacked SSE event-handling capability.

**What retired it:** W2.2 adapter SSE handler integration (PR #74) + greg's adapter restart (~07:10Z) + thread-336 dogfood verification (~07:23Z; ~2.5min round-trip).

**Verification:** post-W2.2, mission-56's W3 + W4 cascade ran without explicit pings. Engineer responded to architect-side dispatches via push-driven SSE notifications; architect responded to engineer-side PR opens via push-driven thread_message events.

**Status:** **Structurally retired.** Pattern is no longer architecturally required. It still exists as a *declarative coordination concept* that idea-206 (M-Mission-Pulse-Primitive) will codify properly.

#### §5.2.2 DirectorNotification entity write-paths

**Pattern (pre-mission-56):** Hub policy emits DirectorNotification entities directly via `directorNotificationStore.persist`; consumed via `list_director_notifications` + `acknowledge_director_notification` MCP tools.

**What retired it:** W4.1 (PR #79) cut over 5 write + 2 read call-sites to `director-notification-helpers.ts` which routes through `messageStore.createMessage` with `kind: "note"` + `target.role: "director"` + `payload.{severity, source, sourceRef, title, details}`.

**Status:** **Retired.** MCP tool surfaces preserved verbatim (backward-compat); response shape preserved; Director never sees the under-the-hood substrate change. W5 cleanup (PR #82) deleted the entity definitions + repository + 18 unit tests for the deleted repo.

#### §5.2.3 Notification entity write-paths

**Pattern (pre-mission-56):** Hub policy emits Notification entities via `notificationStore.persist`; consumed via SSE delivery + `notifyConnectedAgents` + `cleanup` timer.

**What retired it:** W4.2 (PR #80) cut over 2 prod call-sites to `notification-helpers.ts` which routes through `messageStore.createMessage` with `kind: "external-injection"` + `payload.event` discriminator. SSE event-id swap (notification.id → Message.id) forward-compatible per W1b Last-Event-ID protocol. No-double-send analysis (§4.4.1) load-bearing.

**Status:** **Retired.** Helper preserves emission shape; existing `notifyConnectedAgents` continues SSE delivery using Message.id as event-id. W5 cleanup deleted entity + repository + 4 e2e store-verifying tests.

#### §5.2.4 W1b optional-messageStore graceful-degradation fallback

**Pattern (rollout-period):** HubNetworking constructor accepted `messageStore?` as optional with a fallback (`messageStore ? emitLegacyNotification : notificationStore.persist`).

**What retired it:** W5 (PR #82) deleted notificationStore → fallback structurally unreachable → messageStore graduated to required.

**Status:** **Retired** as the rollout-pattern conclusion. See §3.3.1 + §4.4.2 for the optional→required graduation pattern formalization.

#### §5.2.5 "Architect tooling shift for scheduled-wakeup adoption" framing

**Pattern (interim architect-side):** initial follow-on framing — replace local `ScheduleWakeup` calls with Hub-scheduled-Messages.

**What retired it:** Director's pulse-primitive proposal (~30min after architect filed the framing) subsumed it cleanly. idea-206 absorbed the architect-tooling-shift scope into the broader declarative-per-mission-pulse concept.

**Status:** **Superseded** (not "retired-by-substrate"; retired-by-better-framing). `project_hub_scheduled_wakeup_followon.md` memory marked SUPERSEDED with redirect to idea-206. See §4.2.1.

### §5.3 Patterns positioned for retirement in next 1-2 missions

#### §5.3.1 Local imperative `ScheduleWakeup` during autonomous-arc

**Current pattern:** architect uses local `ScheduleWakeup` (with 15min cap per `feedback_wakeup_cadence_15min_max`) during active mission execution.

**Retirement vehicle:** idea-206 (M-Mission-Pulse-Primitive) — declarative per-mission Hub-scheduled-Message pulse with role-defaults; replaces local `ScheduleWakeup` for recurring cases. Mission-51 W4 Scheduled-Message primitive (one-off) + push pipeline (mission-56) provide the substrate.

**Sequencing:** post-idea-206 ratification + ship.

#### §5.3.2 PendingActionItem saga FSM (legacy substrate)

**Current pattern:** PAI saga lives on its own `PendingActionItemRepository` with watchdog + dispatch + drain + threading-saga code paths.

**Retirement vehicle:** idea-207 (M-PAI-Saga-On-Messages) — proper saga rewrite onto Message-store. Either Option A (extend Message envelope with payload.pendingAction.{state, attemptCount, receiptDeadline, naturalKey, continuationState}) or Option B (unify SSE delivery; saga as a kind of Message). Engineer-side audit at design phase.

**Sequencing:** Tier 2 follow-on; pending strategic-review triage. L-firm baseline (~3-5 eng-days; touches watchdog + dispatch + drain + threading saga).

#### §5.3.3 Cross-package vitest bug-32 baseline

**Current pattern:** PolicyLoopbackHub depends on un-exported MemoryStores from hub/src; cross-package vitest fails for network-adapter / claude-plugin / opencode-plugin; admin-merge baseline since mission-50 lineage (now 23-PR consecutive admin-merge).

**Retirement vehicle:** dedicated bug-32 fix mission (NOT scoped into delivery missions per `feedback_pattern_replication_sizing`). Could be folded into idea-198 (Cognitive-Layer extraction) or idea-186 (npm workspaces migration) as part of a substrate-cleanup wave.

**Sequencing:** when admin-merge friction becomes meaningful, OR when a substrate-cleanup mission is otherwise warranted. Not gating any current work.

#### §5.3.4 file:-ref dist/-commit pattern for sovereign packages

**Current pattern:** new sovereign-packages (mission-56 W2.1 `@ois/message-router` is the latest) ship dist/ committed for file:-ref consumption. Calibration #20 (mission-50 lineage) codifies this.

**Retirement vehicle:** M-Adapter-Distribution mission — npm publish under @apnex/* namespace. Package-specific publish stories; replaces file:-ref + dist/-commit with semver pull from registry.

**Sequencing:** Tier 2 follow-on; pre-W5 staged. Pairs with idea-186 (npm workspaces) which sunsets the file:-ref dance. Rename @ois/* → @apnex/* internal namespaces is part of this work.

### §5.4 What the operationalize/retire balance says about mission-56 as a structural inflection

Mission-56 operationalized **6 patterns** + retired **5 patterns** + positioned **4 more for next-1-2-mission retirement**.

This is a **substantive structural inflection**, not an incremental shipment. The ratio of operationalize:retire (6:5, with 4 queued) reflects mission-56's role as the *push-pipeline + Layer-2 router* substrate that:

- Closes the manual-coord pattern (calibration #4) **structurally** rather than ergonomically
- Closes 2/3 legacy notification entities + sets up the 3rd for proper deferred sunset (idea-207)
- Enables the next wave of declarative-coordination primitives (idea-206 pulse; idea-199 FSM-completeness; idea-194 mid-thread-amend)
- Operationalizes the autonomous-arc-driving pattern at full execution scale

**Comparison to prior missions:**

| Mission | Patterns operationalized | Patterns retired | Inflection class |
|---|---|---|---|
| mission-51 (Message primitive) | 1-2 | 0 | Substrate-introduction |
| mission-54 (recon) | 1-2 | 0 | Spike (informed downstream) |
| mission-55 (cleanup) | 3 | 0 | Pre-substrate cleanup |
| **mission-56** | **6** | **5** | **Structural inflection** |
| (idea-206 forecast) | 1-2 | 1-2 | Coordination-primitive shipment |
| (idea-207 forecast) | 1-2 | 1 | Saga-substrate completion |

**Read:** mission-56 was the high-leverage delivery in the M-Push-Foundation lineage. mission-54 (recon) + mission-55 (cleanup) prepared the ground; mission-56 shipped the structural change. Future missions in the lineage (idea-206, idea-207, M-Adapter-Distribution) will be smaller-scope completions against the substrate mission-56 ratified.

**Calibration cadence and operationalize/retire ratio together** suggest a heuristic: substantive structural-inflection missions earn high calibration counts AND high operationalize/retire ratios. Predictive use: future missions claiming "structural inflection" scope should be expected to surface 5+ calibrations + retire 3+ patterns. Lower numbers than that = mission was probably scoped as substantive but executed as incremental (worth examining).

#### §5.4.1 Mission-class taxonomy (formalized vocabulary)

Director ratified at retrospective walkthrough §5: *"Worth formalising language."*

The mission classes surfaced in the §5.4 comparison table become a formal taxonomy for mission-shape characterization. Definitions:

| Class | Definition | Operationalize/Retire signature | Calibration cadence |
|---|---|---|---|
| **Spike (informs downstream)** | Recon / discovery / scoping mission; produces analysis for downstream missions; minimal substrate change | 1-2 ops / 0 retire | Low (1-3) |
| **Substrate-introduction** | Ships a new primitive / substrate / sovereign-package; creates the foundation downstream missions consume | 1-2 ops / 0 retire | Medium (3-5) |
| **Pre-substrate cleanup** | Prepares baseline for substantive substrate mission; refactors / deletes / consolidates without new substrate | 2-4 ops / 0-2 retire | Medium (3-5) |
| **Structural inflection** | Ships substrate that retires existing imperative patterns at structural (not just ergonomic) level; mid-mission self-dogfood often present | 5+ ops / 3+ retire | High (6+) |
| **Coordination-primitive shipment** | Ships a single coordination primitive (pulse, mid-thread-amend, FSM-completeness fragment); composable atop existing substrate | 1-2 ops / 1-2 retire | Medium (3-5) |
| **Saga-substrate completion** | Migrates an existing saga primitive onto a newer substrate; preserves saga semantics; closes a deferred sunset | 1-2 ops / 1 retire | Medium (3-5) |
| **Substrate-cleanup wave** | Retires deprecated patterns / fixes accumulated technical debt / sunsets superseded surfaces | 0-1 ops / 3+ retire | Low-Medium (2-4) |
| **Distribution / packaging** | Publishing / distribution / integration work; minimal new substrate; ergonomics-focused | 1-2 ops / 0-1 retire | Low (1-3) |

**Use of taxonomy:**

1. **Mission preflight:** mission entity carries declared class; preflight checks operationalize/retire/calibration forecasts against actual scope claim; mismatch = scope-flex signal at preflight time
2. **Mission retrospective:** retrospective compares realized operationalize/retire/calibration counts against declared-class signature; mismatch = either misclassification (rename class) or execution-discipline-gap (defect signal)
3. **Strategic-review prioritization:** Director-paced triage uses class to balance the active-mission portfolio (e.g., avoid stacking 3 structural-inflection missions in series; alternate substrate-introduction → cleanup → inflection to manage execution-arc risk)

**Carrying forward:** add to `mission-lifecycle.md` v1.0 ratification (post-mission-56 methodology doc update). Mission entity schema gains optional `missionClass: <enum>` field; preflight + retrospective templates reference the class signature.

---

## §6 Mid-mission inflection: dogfooding own substrate at W2.2

Mission-56's most distinctive structural moment was **dogfooding the coordination substrate it shipped, mid-mission, against itself**. Pre-W2.2, architect-engineer coordination ran on poll-driven cadence (architect `ScheduleWakeup` at 15min cap; engineer threads visible only at next wakeup). Post-W2.2 dogfood verification, coordination ran on push-driven cadence via the very SSE pipeline + Layer-2 router that mission-56 was shipping.

This section unpacks the mechanics, the inner-loop compression observation, the bug-34 structural closure that fell out of it, and codifies *self-dogfooding as mission-quality discipline* for future substrate missions.

### §6.1 The dogfood gate sequence

| Time (Z) | Action | Owner |
|---|---|---|
| ~06:55 | PR #74 W2.2 adapter SSE handler integration merged | Architect cross-approval + admin-merge |
| ~07:00 | Director: "I will restart greg" — operational support | Director |
| ~07:05 | thread-333 fresh-context re-onboarding for restarted greg | Architect (translates W2.2 ratified state) |
| ~07:08 | Architect: build-hub.sh via Cloud Build (lily worktree; symlinked tfvars from main tree) | Architect |
| ~07:09 | Architect: ask Director "Approved to Proceed for redeploy" | Architect surface (categorised: out-of-scope risk deployment-affecting) |
| ~07:10 | Director ratifies | Director |
| ~07:10 | Architect: start-hub.sh from main tree (where local-fs cutover sentinel lives) | Architect |
| ~07:11 | Both adapters auto-reconnect via SSE | (mechanical) |
| ~07:12-22 | Background: greg's restarted adapter loads W2.2 SSE handler integration | Engineer-side |
| ~07:23 | **Architect: thread-336 dispatch → greg response in ~2.5min** | **Dogfood verification** |
| ~07:30 | PR #76 W3.1 ships under push-driven cadence (no manual coord ping) | Engineer |

**The verification moment was thread-336 ~07:23Z.** Architect dispatched a coord ping; greg's adapter received the SSE notification via the new W2.2 handler; greg responded within 2.5 minutes. Pre-W2.2, the same dispatch would have stranded until greg's next architect-poll wakeup or his own arc-loop fire — typically 15-30min.

**Why the dogfood gate was load-bearing:** without verification, downstream waves (W3 + W4) would have been executed under poll-mode "to be safe" — wasting the very substrate mission-56 was shipping. Architect explicitly held the gate before resuming wave dispatch; only after verification did W3 cascade dispatch resume.

### §6.2 Inner-loop compression observation

| Phase | Coord round-trip latency | Wave cadence (sub-PR ship rate) |
|---|---|---|
| Pre-W2.2 (W0 + W1a + W1b + W2.1) | ~15-30min (architect-poll-driven) | ~1 sub-PR per 20-30min |
| Post-W2.2 dogfood (W2.3 + W3.1 + W3.2 + W3.3) | ~2-5min (push-driven) | ~1 sub-PR per 7-10min |
| W4 cascade (W4.1 + W4.2 + W4.3) | ~2-5min + ~5min context-reset overhead | ~1 sub-PR per 10-15min |

**Speedup:** ~3-10× on coord round-trip; ~2-3× on aggregate sub-PR ship rate. The cadence speedup wasn't purely round-trip compression — it also reduced the architect's context-switch cost (no need to re-load mental state at each wakeup; push-driven means architect responds while context is hot).

**Subjective observation worth recording:** the qualitative experience changed too. Pre-W2.2, coord felt like *async-correspondence* (write something, wait, come back to read response, write next). Post-W2.2, coord felt like *interactive-pairing* (architect-engineer turn-taking with sub-5min round-trips). The latency floor change shifted the *kind of coordination* possible.

This is consistent with the standard observation that ~5min round-trip is roughly the cognitive-context-retention threshold — below 5min, humans/agents can hold the working context across a turn; above 5min, working context must be reconstructed each time.

### §6.3 Bug-34 structural closure (correlated outcome)

Bug-34 (mission-55 retrospective calibration #4) was the architect manual coordination ping pattern: post-PR-merge, architect explicitly thread-messages engineer to dispatch the next wave. Required because architect adapter lacked SSE event-handling capability.

**W2.2 dogfood verification = bug-34 structural closure.** The capability gap that made the manual ping necessary closed; the ping discipline became architecturally optional.

**What "structural closure" means here:** bug-34 isn't *fixed by adding error-handling* or *worked-around with retry-loops*. The architectural condition that *required* the manual ping (no SSE event handling on architect adapter) no longer holds. The pattern dissolves; it doesn't get patched.

**This is the mechanise+declare principle (§4.1.1) operating at mission-substrate scale.** The manual coord ping was an imperative coordination path; the push pipeline declares the wake condition + lets Hub primitives drive it. Bug-34's "fix" is the architectural change, not the workaround.

**Forward implication:** future "bug" filings that describe imperative-coord-discipline gaps (e.g., "architect must remember to X after Y happens") should be examined for *structural retire by upcoming substrate*, not just *workaround patching*. Many such bugs will dissolve when the right substrate ships; patching them mid-flight wastes effort.

### §6.4 Self-dogfooding as mission-quality discipline (codifiable pattern)

Mission-56 dogfooded its own coordination substrate mid-mission. This is *rare* — most missions ship for downstream consumers; the mission's own execution doesn't depend on the substrate it ships. Mission-56's self-dogfood was structurally enabled by:

- Architect + engineer adapters are themselves consumers of the Hub coordination substrate
- Mission-56 ships substrate that those adapters consume
- Therefore mission-56 ships substrate that *changes how mission-56 itself executes*

**The codifiable pattern: "substrate-self-dogfood" mission discipline.**

For substrate missions where the mission's own coordination consumes its shipped artifact, the mission Design should explicitly include:

1. **Dogfood gate identification:** which sub-PR's merge unlocks the new coordination behavior? (mission-56 W2.2)
2. **Pre-gate sub-PR sequencing:** ensure all sub-PRs that come AFTER the gate can use the new behavior; sub-PRs BEFORE the gate still use legacy
3. **Adapter-restart / Hub-redeploy gating:** explicit step in the wave plan; not a post-hoc decision
4. **Verification protocol:** a specific architect-engineer interaction post-gate that demonstrates the new behavior (mission-56's thread-336 ~2.5min round-trip)
5. **Hold-on-failure clause:** if verification fails, downstream waves resume in legacy-mode + the substrate change is investigated; don't barrel forward assuming the dogfood worked

**Why this matters:** substrate-self-dogfood missions can either ship cleanly (compounding leverage — every subsequent wave benefits from the new substrate) OR catastrophically (silent breakage cascades into mid-mission stall). The dogfood gate makes the ship-vs-fail outcome *visible at a known checkpoint*, before downstream waves invest in the new substrate.

**Composition with existing patterns:**

- **calibration #23 tele-pre-check:** dogfood gate is an explicit tele-pre-check artifact for mission Designs that include substrate-self-dogfood
- **autonomous-arc-driving pattern:** the dogfood gate is a category-fit Director surface (deployment-affecting + verification-protocol); architect should always surface the redeploy approval ask before crossing the gate
- **mechanise+declare principle:** substrate-self-dogfood IS the mechanise+declare principle in concrete operational form — declare the wake condition, let primitives drive

**Carrying forward:** add to `mission-lifecycle.md` v1.0 ratification (post-mission-56) as a discipline applicable to "substrate-introduction" + "structural-inflection" mission classes per §5.4.1 taxonomy.

### §6.5 Risks the dogfood gate mitigated (counterfactual)

What if mission-56 had skipped the dogfood gate?

| Skip-mode | Counterfactual outcome | Cost-if-skipped |
|---|---|---|
| Skip Hub redeploy ("ship code; assume it works") | Adapters continue running pre-W2.2 code; downstream waves dispatch via push API but consume via legacy-mode poll → silent partial-functionality | Mid-mission stall when the discrepancy surfaces; full re-investigation cost |
| Skip greg adapter restart (Hub redeployed; greg adapter not restarted) | Architect adapter receives push events; greg adapter doesn't; asymmetric coord = architect waits forever for greg "response" via push | Coord-stall ladder + Director surface to "greg is silent" + bug-misfile |
| Skip verification protocol (Hub + adapters all updated; no thread-336-style test) | Downstream waves dispatch under push assumption; if push silently broken (e.g., MessageRouter not registering handler properly) → push-fires-but-nobody-handles | Mid-mission stall + re-build + re-verify cost; arc continuity broken |
| Defer dogfood to W5 (push to end-of-mission) | Subsequent W3 + W4 waves run in poll-mode wasting the substrate; same wave-execution-cost as if mission-56 had not shipped W2.2 | ~50% of mission-56's coord-velocity gains forfeit; mission still ships, just slower |

**Lowest-cost skip is the last** (defer dogfood to W5). Costs are velocity, not correctness.
**Highest-cost skip is the third** (no verification protocol). Correctness silently fails.
**Middle skips** cause coord-stalls but eventually surface.

**Architect chose the highest-mitigation path: full Hub redeploy + greg adapter restart + thread-336 verification protocol + Director-approved redeploy gate.** Time-cost was ~25min from PR #74 merge to thread-336 verification. Velocity gain post-gate was ~3-10× on coord round-trip + ~2-3× on aggregate sub-PR ship rate; ROI realized within 1-2 subsequent sub-PRs.

**Forward implication:** for substrate-self-dogfood missions, **the dogfood gate is mandatory, not optional**. Velocity gains compound across downstream waves; verification-protocol cost is bounded; counterfactual costs (especially silent-correctness-failure) dominate any time-savings from skipping.

---

## §7 Tele alignment retrospective

Design v1.2 declared mission-56 tele alignment as **Primary tele-3 + tele-9; Secondary tele-7 + tele-10 + tele-4; Tertiary tele-2**. This section retrospectively scores those tele claims against shipped outcomes, identifies new tele evidence, and frames the next tele-9 advance.

### §7.1 Primary tele outcomes

#### tele-3 Sovereign Composition

**Pre-mission state:** Coordination substrate spanned 3 parallel mechanisms — Hub Notification entity (SSE-injection path), DirectorNotification entity (admin-acknowledge path), PendingActionItem saga (queue-item-with-watchdog path). Each mechanism carried its own MCP tool surface, persistence layer, and consumer integration.

**Post-mission state:** 2/3 mechanisms collapsed into Message-store projection (DirectorNotification + Notification → `kind`-discriminated payload on the unified Message primitive). PendingActionItem retained as the saga primitive (per Option C structural-difference recognition); idea-207 captures its proper migration as a Tier 2 follow-on.

**Sovereign-package count:** mission-56 added `@ois/message-router` as sovereign-package #6 — a new Layer-2 router primitive that composes with mission-51's Message primitive (sovereign-package #5) + mission-48's StorageProvider (sovereign-package boundary).

**Tele-3 advance:** **substantial.** Two notification entities collapsed; Layer-2 router becomes the single composable routing primitive consumed by future workflow primitives (idea-199 FSM-completeness; idea-194 mid-thread-amend; idea-206 pulse). Sovereign composition now operates via Message+Router substrate; mechanise+declare principle (extracted this mission; see §7.4) is the binding tele-3 design discipline going forward.

#### tele-9 Frictionless Director Coordination

**Pre-mission state:** Director coord occurred via direct chat (out-of-band; not Hub-state-tracked); manual ping discipline (architect-side calibration #4); operational support (greg restart) was Director-only capability per bug-34. Director-engagement was high-touch; no declarative coordination state surface for Director to query.

**Post-mission state:** Push pipeline + Layer-2 router make coord-handoffs structurally observable in Hub state (Message status FSM `new → received → acked`; thread convergence events; PR-event SSE). Bug-34 structural closure means architect-engineer manual ping pattern dissolves. Mechanise+declare principle (extracted) targets ALL coordination, low-value logic, and execution for declarative Hub-state representation.

**Tele-9 advance:** **substantial structural; partial ergonomic.** The substrate shipped; the ergonomic adoption is in-flight (idea-206 pulse primitive will codify per-mission declarative coordination; M-Adapter-Distribution will broaden Director observability via standard adapter integration). Mission-56 ships *the foundation* for tele-9 advances; subsequent missions will realize the ergonomic fruits.

**Empirical evidence:** §6.2 inner-loop compression observation (~3-10× coord round-trip speedup; ~2-3× sub-PR ship rate) is direct tele-9 evidence — Director's surface to mission state is 10× richer post-W2.2 dogfood gate.

### §7.2 Secondary tele outcomes

#### tele-7 Confidence-Through-Coverage

**Pre-mission state:** Hub vitest 968/5; mission-55 added cross-package vitest job pattern (bug-32 baseline). Adapter-side test coverage limited; SSE-event-handler unverified at integration scale.

**Post-mission state:** Hub vitest 965/5 (post-W5 cleanup; -22 = deleted notification-repository tests + e2e store-verifying tests; new helper unit tests +19 net positive); 45 new adapter-side tests (W3.3 poll-backstop + dispatcher); thread-336 dogfood verification provides integration-scale push-pipeline evidence.

**Tele-7 advance:** **adequate.** Net positive on hub-side helper coverage (+19); substantial adapter-side coverage gain (+45); dogfood verification compensates for the lack of mission-internal e2e push-pipeline tests (which would require Hub-redeploy + adapter-restart in CI — out of scope this mission). Cross-package bug-32 baseline persists; admin-merge baseline now 23-PR consecutive lineage.

**Tension noted:** dogfood verification is a *human-paced* coverage signal (architect-engineer interaction); reproducible-by-CI dogfood automation would be a tele-7 maturity step. **Filed as idea-208 M-Dogfood-CI-Automation** (Director-ratified 2026-04-26 during retrospective §7 walkthrough; Tier 2 follow-on; M-firm baseline ~2-3 eng-days).

#### tele-10 Hub-as-Single-Source-of-Truth

**Pre-mission state:** Coordination state lived in 3 parallel substrates (Notification + DirectorNotification + PendingActionItem); architect-side coord state lived in local `ScheduleWakeup` calls (out-of-band).

**Post-mission state:** 2/3 notification substrates collapsed into Message-store; architect-side ScheduleWakeup positioned for retirement (idea-206 pulse primitive); push pipeline ensures Hub events propagate as primary signal source.

**Tele-10 advance:** **substantial directional; idea-206 completes it.** Mission-56 establishes Hub-as-single-substrate for the notification surface; pulse primitive (idea-206) closes the remaining out-of-band coordination cycle (architect ScheduleWakeup → Hub-scheduled-Message). Together, mission-56 + idea-206 realize the full tele-10 advance for coordination state.

#### tele-4 Zero-Loss Knowledge

**Pre-mission state:** Notification entity SSE delivery had at-most-once semantics in some failure modes (delivered-but-not-stored; stored-but-not-delivered); no retry / replay mechanism.

**Post-mission state:** W1b Last-Event-ID protocol provides cold-start replay with `replay-truncated` synthetic event at soft-cap. W3.3 hybrid push+poll backstop provides at-least-once redundancy via cursor-driven poll catch-up. W3.2 claim/ack two-step + status FSM provides per-Message proof-of-consumer-receipt. Multi-agent claim winner-takes-all CAS prevents lost work in race scenarios.

**Tele-4 advance:** **substantial.** At-least-once delivery semantics with cursor-replay; consumer-tied ack with FSM status; multi-agent race-resolution. Zero-loss extends to mission-state via push-pipeline-driven coord (no architect-misses-engineer-PR-open scenario possible).

**Forward note:** PAI saga (idea-207) carries its own zero-loss requirements (escalated/errored/continuation_required states); proper migration onto Message-store must preserve those.

### §7.3 Tertiary tele outcome

#### tele-2 Isomorphic Specification

**Pre-mission state:** Notification + DirectorNotification + PendingActionItem each had ad-hoc schema with bespoke MCP tool surface; cross-entity composition required tool-bridging.

**Post-mission state:** 2/3 entities collapse to schema-driven Message payload + `kind` discriminator; helper-pattern preserves backward-compat MCP surfaces while routing through unified Message store. Source-attribute taxonomy at Layer-3 render-surface is per-subkind discriminated; declarative not imperative.

**Tele-2 advance:** **directional; partial.** Mission-56 demonstrates schema-driven payload as the canonical entity-encoding pattern; idea-207 (PAI saga rewrite) extends this to saga primitives; idea-199 (FSM-completeness) generalizes further. Tertiary tele claim was correctly-sized — tele-2 maturity is multi-mission work.

### §7.4 New tele evidence: mechanise+declare as binding design discipline (extracted, not new tele)

**Important framing:** Director's mid-mission ratification *"all coordination, low-value logic and execution to be mechanised, and declarative"* is **NOT a new tele** — it's a **binding design discipline that operationalizes the existing tele-3 + tele-9 + tele-10 + tele-2 composition**. The tele framework didn't gain a new entry; mission-56 surfaced a discipline that helps EXECUTE against the existing tele.

**Composition map:**

| Tele | What mechanise+declare contributes |
|---|---|
| tele-3 Sovereign Composition | Single coordination mechanism (Hub primitives) instead of many bespoke ones |
| tele-9 Frictionless Director Coordination | Director sees declarative state, not procedural side-effects |
| tele-10 Hub-as-Single-Source-of-Truth | Hub holds the declarative state; no out-of-band coordination surfaces |
| tele-2 Isomorphic Specification | Declarative = schema-driven; replaces ad-hoc imperative paths |

**Default question for ALL future design work** (per `feedback_mechanise_declare_all_coordination.md`): *"Can this coordination / logic / execution be declared as Hub state and driven by Hub primitives, instead of imperative code or manual cycles?"*

**Why "extracted" not "new":** the principle was implicit in the tele composition pre-mission-56; mission-56's W2.x dogfood + bug-34 structural closure made the principle *visible enough to ratify as a binding design discipline*. The principle now sits as **doctrine layer between tele and design** — concretely answerable design-time question; if "no" → redesign before shipping.

**Forward implications:**
- mission-lifecycle.md v1.0 codifies "mechanise + declare" as default design discipline
- multi-agent-pr-workflow.md v1.1 cross-approval pattern formalization treats declarative routing as default
- Future workflow primitives (idea-199; idea-197; idea-194) inherit declarative shape requirement

**Methodology placement:** mechanise+declare is **doctrine** (specific, actionable, binding) vs **tele** (foundational, composable, multi-instantiable). Doctrine is the layer between tele and design; mission-56 produced one doctrine (mechanise+declare); future missions may produce more.

### §7.5 Forward tele-9 advance: pulse primitive (idea-206)

**Pulse primitive concept** (per `project_mission_pulse_primitive.md`): per-mission recurring Hub-scheduled-Message bound to active mission, with declarative sane defaults per agent role + short specific request to check in / report back. Drives autonomous-arc coordination without architect-manual proactive pings.

**Tele alignment of idea-206:**

| Tele | How pulse primitive advances |
|---|---|
| **Primary tele-9 Frictionless Director Coordination** | Replaces manual coord with declarative pulse config; Director sees per-mission heartbeat as Hub state |
| **Secondary tele-3 Sovereign Composition** | Single coordination mechanism (pulse on mission entity) replaces ad-hoc per-mission ritual |
| **Secondary tele-10 Hub-as-Single-Source-of-Truth** | Pulse cadence + last-fire + missed-response state lives on mission entity; no out-of-band tracking |
| **Tertiary tele-2 Isomorphic Specification** | Sane defaults per role declared schema-driven; pulse fires via existing Scheduled-Message primitive |
| **Tertiary tele-7 Confidence-Through-Coverage** | Pulse-as-watchdog provides confidence signal without manual surveillance |

**Operational outcomes pulse retires** (per `project_mission_pulse_primitive.md`):
- Architect proactive ping discipline (current calibration #4 interim post-PR-merge ping pattern) — declarative pulse replaces
- Director-as-watchdog pattern ("greg has gone idle" observations) — pulse missed-response surfaces via mission state instead
- Bespoke per-mission coord rituals — standard pulse template per mission class
- Manual mid-mission status check-ins — pulse prompts; engineer decides ack-only vs full status

**Sequencing as Tier 2:** post-mission-56 merge (push pipeline must exist; ✅); post-architect-tooling baseline cleanup. L-class (~1-2 eng-weeks; new primitive + Hub sweeper + per-role defaults + mission-entity schema + tests + observability).

### §7.6 Tele alignment as mission-quality signal

Composing §4.5 (calibration cadence) + §5.4.1 (mission-class taxonomy) + §7 tele alignment:

**Mission-56 tele scorecard:**

| Tele | Declared (Design v1.2) | Realized | Gap |
|---|---|---|---|
| tele-3 Sovereign Composition | Primary | Substantial advance | None |
| tele-9 Frictionless Director Coordination | Primary | Substantial structural; partial ergonomic | Idea-206 closes ergonomic gap |
| tele-7 Confidence-Through-Coverage | Secondary | Adequate; net-positive | Reproducible-CI-dogfood opportunity |
| tele-10 Hub-as-Single-Source-of-Truth | Secondary | Substantial directional | Idea-206 closes |
| tele-4 Zero-Loss Knowledge | Secondary | Substantial | Idea-207 extends to saga primitives |
| tele-2 Isomorphic Specification | Tertiary | Directional partial | Multi-mission maturity work |

**Read:** mission-56's primary tele claims (tele-3 + tele-9) realized substantively at structural level; ergonomic completion sits in idea-206. Secondary tele all advanced per declared scope. Tertiary tele advance correctly-sized as multi-mission work.

**No tele over-claim or under-claim** — Design v1.2 tele alignment was accurate; mission-56 executed against it. This is a calibration signal: Design-time tele claims aligned with realized outcomes => Design-discipline maturity is high (calibration #23 working as designed).

**Mission-quality composite signal** (combining §4.5 + §5.4.1 + §7):

| Dimension | Mission-56 | Implication |
|---|---|---|
| Calibration cadence | High (~1/25min; 8 new + 1 superseded) | High learning-density |
| Operationalize/Retire ratio | 6/5 + 4 queued | Structural inflection (per §5.4.1 taxonomy) |
| Tele realization vs declared | All tele advanced as declared; no over/under | Design-discipline maturity high |
| Architect→Director surface density | 3 in 3.5h (~1/70min) | Autonomous-arc-driving pattern held under load |
| Pattern violations | 0 | Methodology stack mature |

**Composite read:** mission-56 was a high-quality structural-inflection mission with mature methodology execution. The composite signal (high learning + structural inflection + tele-realized + low surface-density + zero violations) defines a positive baseline that future structural-inflection missions can be measured against.

---

## §8 Tier 2 follow-ons + strategic sequencing

This section enumerates the Tier 2 follow-ons filed during mission-56 + lineage, classifies each per §5.4.1 mission-class taxonomy, surfaces dependency and sequencing analysis, and recommends strategic-review preparation. Director-paced strategic-review triage is the actionable next step; this section provides architect-side input.

### §8.1 Tier 2 follow-ons enumeration

| Idea ID | Mission concept | Class (per §5.4.1) | Sizing | Dependencies | Filed |
|---|---|---|---|---|---|
| idea-206 | **M-Mission-Pulse-Primitive** — declarative per-mission Hub-scheduled-Message pulse with role-defaults; replaces calibration #4 manual ping discipline | Coordination-primitive shipment | L (~1-2 eng-weeks) | Push pipeline ✅; Scheduled-Message primitive ✅ (mission-51 W4) | 2026-04-26 (mission-56 W2.x dispatch window) |
| idea-207 | **M-PAI-Saga-On-Messages** — proper PendingActionItem saga rewrite onto Message-store; preserves ADR-017 saga semantics | Saga-substrate completion | L (~3-5 eng-days) | Push pipeline ✅; Message status FSM ✅ (mission-56 W3.2) | 2026-04-26 (mission-56 W4.3 scope-flex) |
| idea-208 | **M-Dogfood-CI-Automation** — reproducible-by-CI dogfood verification for substrate-self-dogfood missions; closes tele-7 maturity gap | Substrate-cleanup wave / Distribution-packaging hybrid | M (~2-3 eng-days) | None; orthogonal | 2026-04-26 (this retrospective §7) |
| M-Adapter-Distribution | npm publish under @apnex/* namespace; sunsets file:-ref dist/-commit pattern (calibration #20) | Distribution / packaging | M-L (~3-5 eng-days est.) | idea-186 npm workspaces (composable) | Pre-W5 staged; not yet a formal Idea entity |

**Plus existing Tier 1 ideas worth noting in sequencing context:**

| Idea ID | Concept | Class | Status |
|---|---|---|---|
| idea-186 | npm workspaces migration; sunsets file:-ref + dist/-commit pattern | Substrate-cleanup wave | Open; composes with M-Adapter-Distribution |
| idea-191 | M-Repo-Event-Bridge consumer side; consumes push pipeline (mission-52 was producer) | Coordination-primitive shipment | Open; dependency satisfied post-mission-56 |
| idea-194 | mid-thread-amend primitive | Coordination-primitive shipment | Open; dependency satisfied post-mission-56 |
| idea-198 | Cognitive-Layer extraction; separable from network-adapter | Substrate-introduction | Open; orthogonal to push pipeline |
| idea-199 | FSM-completeness primitives | Coordination-primitive shipment | Open; dependency satisfied post-mission-56 |
| bug-32 | Cross-package vitest baseline retire | Substrate-cleanup wave | Open; admin-merge baseline 23-PR consecutive |
| bug-40 | Hub presence-projection drift (filed during mission-56) | Bug fix (substrate-cleanup) | Open |

### §8.2 Sequencing analysis

#### Dependency satisfaction post-mission-56

**Newly unblocked by mission-56's substrate:**
- idea-206 (push pipeline + scheduled-Message both present)
- idea-207 (push pipeline + Message FSM both present)
- idea-191 (push pipeline consumer side)
- idea-194 (Message + thread substrate)
- idea-199 (Message + status FSM substrate)

**Independent of mission-56:**
- idea-208 (CI infrastructure; orthogonal)
- M-Adapter-Distribution (packaging; orthogonal)
- idea-186 (npm workspaces; orthogonal)
- idea-198 (cognitive layer; orthogonal)
- bug-32 retire (CI infrastructure; orthogonal)

#### Mission-class portfolio balance

Mission-56 was **structural inflection class** (high learning + high operationalize/retire). Post-mission cognitive load + execution-arc rest argue for *not* stacking another structural-inflection mission immediately.

**Recommended class alternation:** structural-inflection → coordination-primitive shipment (medium load) → substrate-cleanup wave (low load) → next inflection. Mission-56 → ? → ? → next-inflection.

**Strategic-review options for mission #2 in lineage post-mission-56:**

| Option | Mission concept | Class | Why now? | Why later? |
|---|---|---|---|---|
| A | idea-206 M-Mission-Pulse-Primitive | Coordination-primitive shipment | Closes calibration #4 ergonomic gap; realizes mechanise+declare doctrine for coord; highest tele-9 lift | Sizing larger than M-Adapter-Distribution; touches mission entity schema |
| B | idea-208 M-Dogfood-CI-Automation | Substrate-cleanup wave / Distribution-packaging | Tele-7 maturity; closes substrate-self-dogfood-mission verification gap; orthogonal to other work | Mid-priority; no other substrate-self-dogfood mission in immediate queue |
| C | M-Adapter-Distribution | Distribution / packaging | @apnex namespace migration aligns with public-distribution intent; closes calibration #20 file:-ref pattern | Requires idea-186 npm workspaces companion work |
| D | idea-191 M-Repo-Event-Bridge consumer | Coordination-primitive shipment | Realizes the producer-consumer pair (mission-52 + this); tests push pipeline downstream | Mid-priority; doesn't unlock blocked-on-it work |
| E | idea-207 M-PAI-Saga-On-Messages | Saga-substrate completion | Closes mission-56 W4.3 deferred work; finishes the 3/3 legacy notification entity sunset | Larger sizing (~3-5 eng-days); touches watchdog escalation ladder + adapter pendingActionMap |

**Architect recommendation: A (idea-206 M-Mission-Pulse-Primitive)** — highest tele-9 leverage; realizes mechanise+declare doctrine for coordination at architectural scale; closes calibration #4 ergonomic gap which is the most-felt residual issue post-mission-56. Composes with mission entity schema work that future workflow primitives will touch.

**Architect alternative: B (idea-208 M-Dogfood-CI-Automation)** — if Director prefers smaller-class mission for execution-arc rest before A; orthogonal so doesn't block A; M-firm sizing.

**Defer to later:** C (depends on companion work); D (mid-priority; no urgency); E (larger sizing; better as mission #3 in lineage where execution-arc is rested).

#### Sequencing scenarios (architect-side speculation)

**Scenario 1: A → B → C/D/E** (pulse-first)
- Mission #2 = idea-206 M-Mission-Pulse-Primitive (~1-2 eng-weeks)
- Mission #3 = idea-208 M-Dogfood-CI-Automation (~2-3 eng-days; substrate-cleanup rest)
- Mission #4 = idea-207 / M-Adapter-Distribution / idea-191 (depending on next priority)

**Scenario 2: B → A → C/D/E** (CI-dogfood-first)
- Mission #2 = idea-208 M-Dogfood-CI-Automation (~2-3 eng-days; lighter execution-arc)
- Mission #3 = idea-206 M-Mission-Pulse-Primitive (~1-2 eng-weeks; substrate-self-dogfood test for new CI automation)
- Mission #4 = idea-207 / M-Adapter-Distribution / idea-191

**Scenario 3: E → A → B → C/D** (close-deferred-work first)
- Mission #2 = idea-207 M-PAI-Saga-On-Messages (~3-5 eng-days; closes mission-56 W4.3 deferred work)
- Mission #3 = idea-206 M-Mission-Pulse-Primitive (~1-2 eng-weeks)
- Mission #4 = idea-208 / M-Adapter-Distribution / idea-191

**Architect preference: Scenario 1 (pulse-first).** Reasoning:
- Mechanise+declare doctrine is fresh from mission-56; pulse primitive is the canonical expression of that doctrine; ship while doctrine is salient
- idea-206 unblocks downstream coordination primitives (idea-194; idea-199) by establishing pulse-as-pattern
- idea-207 deferred-work closure is *honestly deferred* (not urgently outstanding); idea-206 has higher leverage now
- idea-208 (CI dogfood) has natural substrate-self-dogfood test in idea-206 ship; pairs well as #3

### §8.3 Strategic-review preparation

When Director conducts strategic-review post-this-retrospective:

**Architect input ready:**
- §8.1 enumeration with class + sizing + dependency status
- §8.2 sequencing analysis with 5 options + 3 scenarios + recommended preference
- §5.4.1 mission-class taxonomy for portfolio balance reasoning
- §4.5 calibration-cadence-as-quality-signal heuristic for forecasting next-mission learning-density

**Open Director-only decisions:**
- Mission selection from §8.2 options
- Sequencing scenario from §8.2 scenarios
- Activation timing (immediate vs deferred-rest period)
- Whether to bundle (e.g., M-Adapter-Distribution + idea-186 npm workspaces in one mission, or separate)

**Architect-side preparatory work pending strategic-review:**
- mission-lifecycle.md v1.0 ratification (codifies pulse semantics + autonomous-arc-driving + substrate-self-dogfood discipline + missionClass field)
- multi-agent-pr-workflow.md v1.1 (cross-approval pattern formalization)
- ADR-026 already merged (W5 PR #82) — Universal Adapter Phase 1 push-pipeline architecture as foundation for future Phase 2/3 ADRs

Once mission #2 is selected, architect will:
1. File preflight per `docs/methodology/mission-preflight.md`
2. Author Design v0.1 → vN (collaborative with Director per calibration #23 formal-Design-phase-per-idea)
3. Stage propose_mission cascade
4. Await Director release-gate signal
5. Execute end-to-end per autonomous-arc-driving pattern

### §8.4 Mission lineage close-out summary

**M-Push-Foundation lineage closes at mission-56:**

```
mission-50 (Storage-Provider; foundation) — 2026-04-15
        │
        ▼
mission-51 (Message primitive; ADR-025) — 2026-04-21
        │  W6 push transport explicitly deferred
        ▼
mission-52 (Repo-Event-Bridge producer side) — 2026-04-23
        │
        ▼
mission-53 (absorbed into Design v1.2)
        │
        ▼
mission-54 (M-Push-Foundational-Adapter-Recon; pre-mission-arc) — 2026-04-26 ~01:33Z
        │  surfaces Q1/Q2/Q10 architect-tele-evaluation outcomes
        ▼
mission-55 (M-Pre-Push-Adapter-Cleanup; pre-mission-arc) — 2026-04-26 ~03:10Z
        │  ships 3-layer adapter sub-organization + Universal Adapter notification contract
        ▼
[pre-mission-arc retrospective; codifies autonomous-arc-driving + mediation invariant + calibration #23]
        │
        ▼
mission-56 (M-Push-Foundation; structural inflection) — 2026-04-26 ~09:05Z
        │  ships push pipeline + Layer-2 router + claim/ack + 2/3 legacy notification sunset
        │  bug-34 closes structurally; calibration #4 manual ping retired
        │  mechanise+declare doctrine surfaced + ratified
        │  PAI deferred to idea-207
        ▼
[this retrospective; codifies §5.4.1 mission-class taxonomy + §6.4 substrate-self-dogfood discipline + §7.4 mechanise+declare doctrine layer]
        │
        ▼
[strategic-review triage — architect recommends Scenario 1 (idea-206 pulse-first)]
        │
        ▼
mission #2: TBD per Director strategic-review (architect default: idea-206 M-Mission-Pulse-Primitive)
```

**Substrate state at lineage close:**
- ✅ Storage primitive (ADR-024)
- ✅ Message primitive (ADR-025)
- ✅ Push pipeline + Layer-2 router (ADR-026; this mission)
- ✅ Universal Adapter 3-layer architecture (Design v1.2; mission-55 + mission-56)
- ✅ Mechanise+declare doctrine ratified
- ⏳ Pulse primitive (idea-206)
- ⏳ PAI saga on Messages (idea-207)
- ⏳ CI dogfood automation (idea-208)
- ⏳ Adapter distribution (M-Adapter-Distribution)
- ⏳ Mission-lifecycle.md v1.0 ratification

The substrate is sufficient to support the next 4-6 missions in the workflow-primitive lineage (idea-194 mid-thread-amend; idea-199 FSM-completeness; idea-191 repo-event-bridge consumer; etc.) without new substrate work. Mission-56 effectively *closed the substrate-introduction phase* of the M-Push-Foundation lineage; subsequent missions operationalize against the substrate.

---

## Closing

This retrospective captures mission-56 as the **first canonical full-execution example of the autonomous-arc-driving pattern**, the **first canonical structural-inflection mission** per the §5.4.1 taxonomy, and the **substrate that closes the M-Push-Foundation lineage's substrate-introduction phase**.

Methodology stack maturity is high (calibration #23 working; autonomous-arc-driving held under load; mediation invariant uncompromised; 6 patterns operationalized + 5 retired + 4 queued; mechanise+declare doctrine surfaced + ratified; 8 calibrations earned). The composite mission-quality signal (§7.6) defines a positive baseline for future structural-inflection missions.

Forward queue is well-defined: 4 Tier 2 follow-ons enumerated + classified + dependency-resolved (idea-206, idea-207, idea-208, M-Adapter-Distribution); sequencing analysis with architect-recommended Scenario 1; strategic-review preparation listed.

**Status:** retrospective draft v1.0 ready for Director ratification. Post-ratification: methodology-doc updates (`mission-lifecycle.md` v1.0 + `multi-agent-pr-workflow.md` v1.1 + `feedback_*.md` memory writes) + strategic-review trigger.

— lily / architect / 2026-04-26

