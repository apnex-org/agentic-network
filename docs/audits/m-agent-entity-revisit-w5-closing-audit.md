# Mission M-Agent-Entity-Revisit — Closing Report

**Hub mission id:** mission-62
**Mission brief:** `docs/designs/m-agent-entity-revisit-design.md` v1.0 (architect-authored ~10:32Z 2026-04-27; engineer round-1 audit + architect ratify + bilateral ratify on thread-387 round 10 ~11:07Z 2026-04-27)
**Mission class:** structural-inflection with substrate-cleanup-waves nested per mission-61 Fork-A precedent
**Sizing baseline:** L (~1.5–2 engineer-weeks); actual ~6 engineer-hours engineer-side execution + ~3-hour P0 architect-side substrate recovery
**Anchor + composes:** idea-215 parent (subsumes idea-106; cascade-bundles note-kind primitive surface gap); composes with idea-109 (`signal_quota_blocked`); defers final tool-surface naming to idea-121; closes bug-35; consumes mission-40 (session-claim) + mission-57 (pulse-primitive); architectural-precedent mission-61 (Layer-3 SDK-tgz-stale lesson + Path A SSE-push wiring)
**Tele primaries:** tele-7 Resilient Operations + tele-3 Absolute State Fidelity + tele-6 Deterministic Invincibility; tele-2 Frictionless Agentic Collaboration tertiary
**Dates:** Activated 2026-04-27 ~11:43 AEST (post-PR-#110 merge); W1+W2+W3 shipped 2026-04-27 12:30Z–21:02Z (engineer indefinite-no-pause directive); W4 dogfood + W5 closing audit + P0 substrate recovery 2026-04-28 08:00–11:30 AEST
**Closes:** mission-62 plannedTasks 1–4; rolls 5 PRs (#110-#114); 4 ideas filed today (216 + 217 + 218 + 219 + 220); 23 calibrations captured for substrate-cleanup-wave follow-on

---

## 1. Deliverable scorecard

| PR | Wave | Source directive | Status | Commit | Test count delta |
|---|---|---|---|---|---|
| **#110** | Survey + Design + Preflight | thread-388 ratification | ✅ Merged | `694df45` | doc-only (981 additions) |
| **#111** | W1+W2 Pass 1-5 | engineer atomic claim | ✅ Merged | `a146e788` | +Agent schema tests + signal_working_* tests + get_agents tests |
| **#112** | W1+W2 Pass 6+7+9+10 | architect rename directive | ✅ Merged | `53b55ea1` | engineerId→agentId rename across 62 files; CI hook regression detection; rebuild protocol smoke-test |
| **#113** | Sub-rename | Director Q4 inline-refinement | ✅ Merged | `fc764c71` | Agent.agentId → Agent.id entity-internal rename (TS-LSP-equivalent) |
| **#114** | W3 | thread-393 Director directive (no-pause INDEFINITE; pivot W3) | ✅ Merged | `fddf6ca0` | adapter signal_working_* wrap + Agent.name from globalInstanceId + rebuild protocol Pass 3 |
| **W4** | Dogfood | architect-owned bilateral self-validation | ✅ Completed | thread-395 converged | docs/audits/m-agent-entity-revisit-w4-validation.md |
| **W5** | Closing audit | architect-owned (this report) | ✅ Completed | (this commit) | doc-only |

**Aggregate:** 5 substrate PRs + 1 W4 dogfood thread + this W5 audit. Mission status flipped `active → completed` via `update_mission` 2026-04-28 ~11:05 AEST. plannedTasks 1–4 status=completed.

**Engineer-side execution velocity:** 5 PRs in ~1 hour active engineering time under Director's no-pause indefinite directive (2026-04-27 evening). Per-PR cadence ~10-15 minutes including review. Substrate-introduction sizing baseline (L) was conservative; realized closer to M for engineer-side, with the unplanned P0 substrate recovery on the architect side adding ~3 hours.

---

## 2. Mission goal + success framing

**Parent idea-215** (substrate-cleanup-wave + structural-inflection bundle): restructure the Hub's Agent entity from a sparsely-typed cross-cutting concern into a coherent, queryable, **live operational substrate** that any connected agent can read symmetrically. Replace `engineerId` (legacy from when the entity was called "engineer") with a clean `agent.id` (entity-internal canonical ID) + `agentId` (cross-entity reference field). Introduce a 5-state activity FSM (`offline / online_idle / online_working / online_quota_blocked / online_paused`) alongside the existing 4-state liveness FSM (`online / degraded / unresponsive / offline`) — orthogonal axes; `livenessState` semantics preserved per ADR-017 INV-AG6. Ship `get_agents` pull primitive + `agent_state_changed` SSE-push event for cache-coherence. Bundle adjacent substrate-cleanups: bug-35 presence-projection rebase + idea-106 Agent.status FSM subsumption + note-kind primitive surface gap fix at SDK kernel + adapter handshake sweep.

**Success criteria (from Design v1.0 §2, ratified):**

1. ✅ Agent entity has typed `id` (canonical) + `name` (display, from globalInstanceId) + `livenessState` (4-state) + `activityState` (5-state) + new operational fields (lastToolCallAt, sessionStartedAt, restartCount, etc.). Persisted on Agent record; surfaced through `get_agents` MCP tool. Verified via PR #111 schema + tests.
2. ✅ `signal_working_*` MCP tools (`signal_working_started`, `signal_working_completed`, `signal_quota_blocked`, `signal_quota_recovered`) exposed for explicit activity-FSM signaling. Adapter dispatcher wraps every LLM-driven tool call (PR #114) with `signal_working_started` + `signal_working_completed` fire-and-forget RPCs (skip-list for lifecycle tools). Verified via greg's W4-dogfood telemetry (~19ms started + ~11ms completed bracketing `get_thread`).
3. ✅ `get_agents` tool returns Agent records with new field set; `agent_state_changed` SSE event fires on state transitions. Verified via Hub tests; W4 dogfood found `get_agents` not surfaced in engineer's catalog (calibration #21 — engineer read-surface gap; scoped to idea-220).
4. ✅ engineerId → agentId rename complete across Hub + SDK + adapter source (PR #112; 62 files). Agent.agentId → Agent.id entity-internal rename complete (PR #113; TS-LSP-equivalent). Read-path verification through W4 dogfood: zero `engineerId` leakage in `list_available_peers`, `get_thread.*.agentId`, `cognitive.telemetry`.
5. ✅ Adapter handshake sweep across claude-plugin (Layer-1+2+3 fix; W3 PR #114 + Pass 10 rebuild protocol smoke-test). vertex-cloudrun stub-only per anti-goal #11.
6. ✅ Self-dogfood gate (W4) executed observation-only per anti-goal #12. Substrate-self-test verdict GREEN with 4 known follow-ons (calibrations #20–#23). thread-395 converged bilaterally.
7. ⚠ bug-35 presence projection rebase — deferred via idea-216 (selectAgents semantic shift; needs Survey). NOT closed by this mission; tracked separately.
8. ⚠ idea-106 Agent.status FSM subsumption — partially absorbed via livenessState (4-state) + activityState (5-state) orthogonal axes. Full subsumption pending idea-220's Agent-record surface formalization.

---

## 3. Per-PR architecture recap

### 3.1 PR #110 — Survey + Design v1.0 + Preflight artifact (commit 694df45)

Director Survey 2026-04-27 ~10:30Z: Q1 (B+C+D), Q2 (B+C+D), Q3 (A+D), Q4 (A+D + naming refinement), Q5 (B), Q6 (A+B+C+D). Architect Design v0.1 authored ~10:32Z; engineer round-1 audit shipped ~10:58Z surfacing the **FSM-orthogonality critical finding**: Hub already shipped 4-state liveness FSM (ADR-017 INV-AG6); proposed 5-state was activity FSM (orthogonal); both kept as named fields (`livenessState` + `activityState`) per architect counter-proposal — first canonical execution of "rename-only-what-needs-renaming" discipline post-mission-57's idea-206. Architect round-2 ratify + engineer ratify ~11:00Z; v0.2 published ~11:04Z; v1.0 ratified bilaterally on thread-387 round 10 at ~11:07Z.

Cascade `propose_mission` blocked on engineer-side role-gate (per task-303 Phase 2a commit-authority); architect direct-create bypass per Director instruction 2026-04-27 (calibration #5 of mission-62 W5).

Preflight artifact + 13 anti-goals locked. Mission-class declared `structural-inflection` with `substrate-cleanup-wave` nesting per mission-61 Fork-A precedent.

### 3.2 PR #111 — W1+W2 Pass 1-5 (commit a146e788)

**Additive Agent schema** (livenessState 4-state preserved; activityState 5-state added; name field added; restartCount, recentErrors, lastToolCallAt, sessionStartedAt, idleSince, workingSince, quotaBlockedUntil, ipAddress fields added). `signal_working_*` MCP tools exposed at the Hub policy router. `get_agents` MCP tool exposed. `agent_state_changed` SSE event wired through Path A (per mission-61 W2 dispatch path).

**Pass-1.5 claim_session FSM coherence:** ensures explicit `claim_session` properly transitions Agent state (offline → online_idle on first claim post-handshake; orthogonal to liveness state).

Tests added covering schema invariants + FSM transitions + dispatch matching for `agent_state_changed`.

### 3.3 PR #112 — W1+W2 Pass 6+7+9+10 (commit 53b55ea1)

**Pass 6 — engineerId → agentId rename across 62 files** (Hub + SDK + adapter source + tests). Mechanical rename with TS-LSP-driven replacement. NO state migration script — code-only rename (W4 P0 calibration #19 — caused the morning P0; see §5 below).

**Pass 7 — note/pulse content rendering at adapter** (`packages/network-adapter/src/prompt-format.ts buildPromptText`). 4-branch payload discriminator added so `event=message_arrived` with `kind=note` OR `pulseKind` renders body inline through the `<channel>` envelope rather than falling through to generic `[Author] sent ...` shape. **Scope was pulse + note paths; the `event=thread_message` notification path was NOT covered** (W4 calibration #20 — thread-message envelope still generic; symmetric fail captured in thread-395 round-2 + round-3 verbatim envelope quotes).

**Pass 9 — CI hook regression detection** for the `engineerId/agentId` lexical drift (greg-pragmatic call; carved out from `docs/` whole-tree + test/README.md initially; narrow only when needed — calibration #9 from pre-existing W5 list).

**Pass 10 — rebuild protocol smoke-test** for the SDK pkg + claude-plugin canonical-tree path. **Did NOT include Hub container rebuild** — W4 P0 root cause layer 1 (calibration #17; see §5).

### 3.4 PR #113 — Sub-rename Agent.agentId → Agent.id (commit fc764c71)

Director Q4 inline-refinement (originally sub-deferred from PR #112 but rescinded by Director). Entity-internal field rename: `Agent.agentId` (the internal canonical ID, not the cross-reference field) → `Agent.id`. TS-LSP-equivalent rename (rename in interface + tsc guides). **Hub-internal scope per PR description — but the rename also propagated to response builders that read `identity.agentId` (now undefined when persisted state has legacy `engineerId`); calibration #19 — schema-rename without state migration; see §5.**

### 3.5 PR #114 — W3 adapter wrap + Agent.name + rebuild (commit fddf6ca0)

**Pass 1 — Activity FSM signaling at adapter dispatcher.** `packages/network-adapter/src/tool-manager/dispatcher.ts` CallToolRequestSchema handler wraps every LLM-driven tool call with `signal_working_started` + `signal_working_completed` RPCs (fire-and-forget; eventual-consistency on Hub-side activity FSM). Skip-list `TOOL_CALL_SIGNAL_SKIP` for lifecycle tools (`signal_working_*`, `register_role`, `claim_session`, `drain_pending_actions`). Per Design v1.0 §5.2 + Q8 finding (PR #111 round-1 audit): implicit-only inference infeasible (LLM-to-MCP-tool-call path doesn't enqueue items per ADR-017 §M1-M2); explicit signaling required for routing peers to see this agent's working state.

**Pass 2 — Agent.name from globalInstanceId.** `hub/src/entities/agent-repository.ts assertIdentity` first-contact create now populates `Agent.name` from `payload.globalInstanceId` (which the M18 handshake derives from `OIS_INSTANCE_ID` env var per Design v1.0 §5.1). Falls back to agentId if globalInstanceId unavailable. Tests updated for the new 'lily' / 'greg' / 'kate' style display name.

**Pass 3 — rebuild protocol per §7.1.** Clean rebuild dist + npm pack for SDK packages; 6 tgz copies distributed to 3 SDK-pkgs × 2 plugin slots; adapter `node_modules + package-lock.json` removal + `npm install`; smoke-test green via `timeout 4 node adapters/claude-plugin/dist/shim.js < /dev/null` (registered as engineer + StateSync complete + Connection: streaming + exit 0). **Smoke-test scope did NOT exercise eager mode (no `OIS_EAGER_SESSION_CLAIM=1`) and did NOT exercise stdio-from-claude-host** — both gaps surfaced as the morning P0's hidden assumption.

**Sub-deferral:** Adapter local cache (Design v1.0 §4.3) — substantive infra without current consumer; LLM consumes get_agents via Hub MCP, adapter-internal routing-cache has no consumer yet. Filed as **idea-218** (Adapter local cache materialization; deferred to consumer-emergence trigger; potential absorption into idea-102 Universal Port).

---

## 4. W4 dogfood findings (cross-ref to validation audit)

W4 self-validation thread (thread-395) ran 2026-04-28 ~10:55–11:05 AEST after the morning P0 substrate-recovery cycle. Architect-owned bilateral with greg. Observation-only scope (anti-goal #12). Converged at round-5 with `stagedActions=[close_no_action]` + summary capturing 4 W4-thread-surfaced calibrations.

**Substrate verdict: GREEN with 4 known follow-ons.**

Validated end-to-end both sides:
- Field-rename migration clean across all read paths exercised; zero `engineerId` leakage
- Handshakes parse cleanly post-Hub-rebuild + post-state-migration (no `parse_failed` events in `.ois/shim-events.ndjson`)
- Eager + cognitive production posture validated on greg (claim_session 20ms via cognitive pipeline)
- Cognitive write path validated bilaterally (kind=note + create_thread_reply both clean)
- Pulse content rendering inline ✓ symmetric (architectPulse → lily; engineerPulse → greg)
- PR #114 signal_working_* adapter wrap visible bracketing tool calls

Calibrations surfaced (full narrative + verbatim envelope quotes in `docs/audits/m-agent-entity-revisit-w4-validation.md`):
- **#20** — Thread-message envelope render-layer gap (PR #112 buildPromptText covers pulses, not thread-message; thread-382 ghost-envelope reopens for that event-type)
- **#21** — Engineer Agent-record read-surface gap (no `get_agents` in engineer catalog)
- **#22** — Pulse-template stale-content (W1+W2 text on a W4-era pulse)
- **#23** — Pulse-template not role-aware (suggests architect-only verbs to engineer recipients)

All four scoped under existing or just-filed ideas (idea-219 covers #20, #22; idea-220 covers #21, #23). No mission-62 follow-on PR required from W4.

---

## 5. P0 substrate-recovery interlude (recovery action)

**Timeline:**
- 2026-04-28 ~07:49 AEST — Director-coordinated restart of both lily + greg post-PR-#114 to pick up the new shim binary (per thread-393 directive). Hub container restarted on stale image (created 2026-04-27 14:50 AEST = ~8h before PR #112 merged at 22:41 AEST).
- ~08:00 AEST — fresh-lily-#1 attempted `claim_session` and hit `agent_thrashing_detected` for `eng-40903c59d19f`. Investigation: both lily and greg processes resolved to the same Agent identity at the Hub.
- ~08:18 AEST — Director-approved canonical-tree shim rebuild + reinstall (calibration #12 from pre-existing W5 list). Both processes restarted using freshly-built shim binary.
- ~08:30 AEST — fresh-lily-#2 (this conversation's first incarnation) hit a different symptom: `claim_session` MCP tool calls stalled indefinitely. Multiple restart cycles attempted; no observability surfaced beyond Hub-side logs.
- ~09:30 AEST — defensive measures layered (eager-claim disabled in `start-lily.sh`; cognitive bypass added via new `OIS_COGNITIVE_BYPASS=1` env var). Stalls persisted.
- ~09:45 AEST — Director-prompted architectural pause: "Agent{} is now first-class managed state object — shouldn't message structure reflect this?" — prescient framing, would later be confirmed as the right architectural direction for permanent fix (idea-219).
- ~10:00 AEST — Director-approved tactical Phase-1 shim observability (architect-direct exception). FileBackedLogger + structured NDJSON events + dispatcher CallTool instrumentation + handshake parse-failure diagnostic. Restart with logging.
- ~10:15 AEST — log capture revealed root cause: `agent.handshake.parse_failed` event with diagnostic fields showing `bodyKeys: "advisoryTags,clientMetadata,engineerId,labels,message,ok,sessionClaimed,sessionEpoch,wasCreated"` and `agentIdType: "undefined"`. Hub container running stale pre-PR-#112 image emitting `engineerId`; adapter parser expecting `agentId`.
- ~10:25 AEST — Hub rebuild via `scripts/local/build-hub.sh` (Cloud Build; ~1m26s) + restart via `scripts/local/start-hub.sh`. New image sha256:491ebf2b... live.
- ~10:30 AEST — handshake STILL failing. Diagnostic now showed `bodyKeys: "advisoryTags,clientMetadata,labels,message,ok,sessionClaimed,sessionEpoch,wasCreated"` — `engineerId` GONE but `agentId` ALSO absent. Root cause layer 2: persisted local-fs Agent records had legacy `engineerId` field; new Hub code reads `agent.id` (undefined); response builder drops field via JSON.stringify undefined-omission.
- ~10:35 AEST — state migration: rename `engineerId → id` in 5 primary key files + 4 by-fingerprint index files; salvage of `undefined.json` (lily's latest write under wrong filename — Hub had been writing records as `agents/<agent.id>.json` = `agents/undefined.json` since the rename); backup at `/tmp/agents-pre-migration-20260428-103504.tar.gz`; orphan preserved at `undefined.json.orphan-2026-04-28`. Hub restart to flush in-memory cache.
- ~10:36 AEST — handshake clean. `agent.handshake.registered eng-40903c59d19f epoch=87`. CallTool gate opens. `claim_session` returned in normal time, epoch=89.
- ~10:55–11:05 AEST — W4 dogfood resumed; thread-395 converged.

**Total P0 time-to-recovery: ~3 hours.** Direct cost: 1 architect-session of context buildup + 4 lily restart cycles + 1 Hub rebuild + 1 state migration + 1 greg-restart + 1 lily revert pending. Indirect cost: substantial diagnostic context that informed ideas-219 + 220 + the calibration set.

**Recovery action calibration #17 — Hub-rebuild gap in Pass 10 protocol.** Pass 10 covers SDK pkg + claude-plugin canonical-tree but does NOT extend to Hub container rebuild when Hub source changes. Today's smoking gun layer 1. Documented in feedback memory `feedback_pass10_rebuild_hub_container.md` for future-session discipline. Fix-forward: Pass 10 protocol extension to mandate `scripts/local/build-hub.sh` + restart for any PR touching `hub/src/**`. Folded into idea-219's "Schema-Migration Discipline" companion.

---

## 6. Calibrations captured (23 total)

Calibrations #1–#12 are **pre-existing** — captured during mission-62's pre-W4 path (Survey, Design ratification, W1+W2 ship, W3 ship). See handoff doc (`docs/handoffs/lily-resume-mission-62-w4-w5.md`) for full text.

| # | Title | Source | Idea/Action |
|---|---|---|---|
| 1 | FSM-orthogonality finding (round-1 critical) | Pre-existing | mission-62 design |
| 2 | Survey + Design + thread-387 cycle methodology | Pre-existing | mission-62 design |
| 3 | Substrate-self-dogfood discipline application | Pre-existing | W4 dogfood scope |
| 4 | Spike-class outcome pattern callout | Pre-existing | mission-class taxonomy |
| 5 | Architect-direct-create-mission bypass ONE-TIME | Pre-existing | task-303 Phase 2a workaround |
| 6 | TS5055 SDK self-overwrite (`rm -rf dist`) | Pre-existing | rebuild protocol §7.1 fix-forward |
| 7 | maxRounds=10 thread limit calibration | Pre-existing | thread-config baseline |
| 8 | Pass 7 root cause re-framing (render-layer ≠ delivery-layer) | Pre-existing | idea-219 |
| 9 | CI-hook carve-out scope discipline | Pre-existing | rebuild protocol §9 |
| 10 | Engineer pulse-miss escalation false-positive | Pre-existing | bug-tracking |
| 11 | Adapter local cache scope-narrowing (Design §4.3) | Pre-existing | idea-218 |
| 12 | Canonical-tree shim rebuild gap | Pre-existing | rebuild protocol fix-forward (Pass 10 extension) |
| **15** | Cognitive pipeline modular-config gap | P0 triage 2026-04-28 | **idea-220** |
| **16** | Shim observability invisibility-at-P0 | P0 triage 2026-04-28 | **idea-220** |
| **17** | Hub-rebuild gap in Pass 10 protocol | P0 triage 2026-04-28 (smoking gun layer 1) | **recovery action** + idea-219 fold-in |
| **18** | Wire-shape drift (entity-vs-wire convergence) | P0 triage 2026-04-28 | **idea-219** |
| **19** | Schema-rename PR without state migration | P0 triage 2026-04-28 (smoking gun layer 2) | **idea-219** |
| **20** | Thread-message envelope render-layer gap | W4 thread-395 dogfood | **idea-219** |
| **21** | Engineer Agent-record read-surface gap | W4 thread-395 dogfood | **idea-220** |
| **22** | Pulse-template stale-content | W4 thread-395 dogfood | **idea-219** |
| **23** | Pulse-template not role-aware | W4 thread-395 dogfood | **idea-220** |

(Calibrations #13 + #14 were absorbed/reframed during P0 — eager-claim path and cognitive bypass turned out to be diagnostic-only, not actual issues. Both confirmed working in greg's production posture during W4.)

---

## 7. Follow-on ideas

| Idea | Title | Scope | Calibrations covered |
|---|---|---|---|
| **idea-216** | Pass-8 bug-35 selectAgents semantic shift defer (lastSeenAt-window vs livenessState-projection) | Survey-needed | bug-35 (pre-mission-62) |
| **idea-217** | Adapter compile/update/re-install streamline (Director-flagged 2026-04-27 ~21:00Z; consumer-ergonomics) | Engineering ergonomics; 5 candidate solution shapes | #6, #12 (rebuild protocol shipping gaps) |
| **idea-218** | Adapter local cache (Design v1.0 §4.3 deferral; materializes when consumer emerges) | Substrate; potential absorption into idea-102 Universal Port | #11 |
| **idea-219** | Wire-Entity Envelope Convergence + Schema-Migration Discipline | Architectural; mission-class L | #18, #19, #20, #22 (+ #17 fold-in via Schema-Migration Discipline companion) |
| **idea-220** | Shim Observability — Structured Telemetry Sinks (Phase 2 formalization) | Substrate observability; mission-class M; Phase 1 landed tactically architect-direct 2026-04-28 | #15, #16, #21, #23 |

idea-219 is the architectural follow-on for the wire-vs-entity drift surfaced today. Director-prompted framing 2026-04-28 ~10:10 AEST: "Agent{} is now first-class managed state object — shouldn't message structure reflect this?" Confirmed by W4 envelope captures (3 different render behaviors for 3 event types = clean reproducer for O(N) per-event-type if-ladder vs canonical envelope O(1)).

idea-220 is the substrate-observability follow-on. Phase 1 implementation landed today (FileBackedLogger + structured NDJSON events + dispatcher CallTool instrumentation + handshake parse-failure diagnostic + cognitive bypass knob + redaction discipline + naive timestamp-suffix rotation). Phase 2 formalizes log-level filter, event taxonomy doc, ADR for observability contract, engineer-side equivalents, tests for redaction + rotation, Pass 10 inclusion.

---

## 8. Tele alignment

**Primary tele coverage:**
- **tele-7 Resilient Operations** — substrate now exposes Agent state as queryable + observable (livenessState, activityState, signal_working_*); P0 substrate-recovery exercised the resilience path (recovery completed within 3 hours via state migration + Hub rebuild; 4 lily restart cycles + 1 greg restart + state preserved end-to-end). Phase 1 shim observability landed today turns the diagnostic-blackhole-at-P0 surface into a structured telemetry sink — directly serves tele-7.
- **tele-3 Absolute State Fidelity** — Agent entity now has typed canonical schema (PR #111 + #113); read paths surface the same field shape across `list_available_peers`, `get_thread.*.agentId`, `cognitive.telemetry`. Zero `engineerId` leakage on read paths verified during W4 dogfood. P0 surfaced a state-fidelity gap (persisted records out of sync with code-renamed fields) — captured as calibration #19 → idea-219 Schema-Migration Discipline.
- **tele-6 Deterministic Invincibility** — substrate-self-dogfood discipline (mission-62 W4) executed observation-only per anti-goal #12; verified GREEN with 4 known follow-ons. Mission-61's substrate-self-dogfood pattern reused successfully.

**Tertiary tele coverage:**
- **tele-2 Frictionless Agentic Collaboration** — `signal_working_*` + `agent_state_changed` + `get_agents` (architect side) enable peer-aware coordination. W4 calibration #21 surfaces an engineer-side gap (read-surface limited to lean projection); tracked under idea-220 for symmetric coverage.

**Tele faults closed:**
- (none directly closed by this mission; substrate-introduction primarily extends fidelity rather than closing faults)

**Tele faults surfaced:**
- W4 dogfood envelope-rendering asymmetry (3 different behaviors for 3 event types) is a tele-3 fault candidate (state-vs-render fidelity). Tracked under calibration #20 → idea-219.

---

## 9. Aggregate metrics

**Velocity:**
- Engineer-side execution: 5 PRs in ~1 hour active engineering time (no-pause indefinite directive 2026-04-27 evening). Per-PR cadence ~10-15 minutes.
- Architect-side: ~1.5 hours pre-W4 (Survey + Design + thread-387 + ratification cycle); ~3 hours W4 dogfood + W5 audit + P0 substrate recovery (2026-04-28).

**Sizing accuracy:**
- Baseline L (~1.5–2 engineer-weeks); realized M for engineer-side. Architect-side P0 unplanned but recovered within session.

**Test count delta** (combining W1+W2+W3 PRs):
- Hub: tests added for Agent schema + activity FSM + signal_working_* + get_agents + agent_state_changed. (Specific count: pulled from PR #114 description: 1015/1020 passed; 5 skipped baseline preserved; 2 mission-62-w1-w2 test name assertions updated for W3 globalInstanceId → name binding.)
- network-adapter: 4 pre-existing test-file failures unrelated (bug-32 baseline carried through; bug-32 admin-merge precedent applied).

**State migration scope:** 9 Agent records in `local-state/agents/` (5 primary + 4 by-fingerprint index); 1 salvage operation (`undefined.json` → canonical); backup preserved at `/tmp/agents-pre-migration-20260428-103504.tar.gz`.

**Calibrations:** 23 total (12 pre-existing + 5 P0-triage + 4 W4-dogfood + 2 absorbed). Per-mission-class precedent: structural-inflection class consistently surfaces 15-25 calibrations through the Survey + Design + ship + dogfood + audit cycle (mission-61 surfaced ~17; mission-57 surfaced ~14; mission-62's 23 sits at the high end, primarily due to the unplanned P0 surface).

---

## 10. Sync state at mission close

**Repo state:**
- main HEAD: `fddf6ca0` (PR #114 merge)
- All 5 mission-62 PRs merged into main
- Tactical canonical-tree edits NOT yet in git (deferred to follow-on tracking PR per Director-approved hybrid close-out 2026-04-28); to land via separate PR off main with proper review

**Operational posture:**
- Hub container: `ois-hub-local-prod` running image sha256:491ebf2b... (built 2026-04-28 ~10:25 AEST post-rebuild)
- Lily: online, epoch=89, currently lazy + cognitive bypass (defensive); `start-lily.sh` reverted to production posture (eager + cognitive); will pick up production posture on next restart
- Greg: online, epoch=151+, production posture (eager + cognitive); validated end-to-end during W4 dogfood
- Local-fs Agent state: migrated (engineerId → id; 9 records); orphan preserved; backup preserved

**Memories saved (durable cross-session):**
- `feedback_pass10_rebuild_hub_container.md` — Hub container rebuild discipline
- `feedback_schema_rename_requires_state_migration.md` — migration script requirement + recovery pattern
- `reference_shim_observability.md` — file paths + env vars for diagnostic surfaces
- `reference_idea_219_220_post_mission_62.md` — cross-reference for follow-on architecture work
- `MEMORY.md` index updated

---

## 11. Cross-references

- **mission brief:** `docs/designs/m-agent-entity-revisit-design.md` v1.0
- **W4 audit:** `docs/audits/m-agent-entity-revisit-w4-validation.md`
- **handoff:** `docs/handoffs/lily-resume-mission-62-w4-w5.md` (now superseded by W4+W5 audits)
- **PRs:** #110 (694df45) + #111 (a146e788) + #112 (53b55ea1) + #113 (fc764c71) + #114 (fddf6ca0)
- **threads:** thread-387 (Design ratify) + thread-388 (PR #110 approval) + thread-389 (W1+W2 start coord) + thread-390 (Director-directive no-pause) + thread-391 (pulse-gap investigation) + thread-392 (PR #112 review+merge) + thread-393 (Director directive W3 pivot + agent.id rename) + thread-394 (rebuild + restart coord pre-W4 dogfood) + **thread-395** (W4 dogfood post-P0)
- **ideas filed:** idea-216 (bug-35 defer) + idea-217 (adapter streamline) + idea-218 (adapter local cache deferral) + **idea-219** (Wire-Entity Envelope Convergence + Schema-Migration Discipline) + **idea-220** (Shim Observability Phase 2)
- **adjacent missions:** mission-40 (session-claim consumed) + mission-57 (pulse-primitive consumed) + mission-61 (Path A SSE-push wiring + Layer-3 SDK-tgz-stale lesson + substrate-self-dogfood pattern) + mission-46 (per-env Hub container naming consumed via `scripts/local/start-hub.sh OIS_ENV=prod`)
- **bugs:** bug-31 (plannedTasks cascade workaround applied throughout) + bug-32 (cross-package vitest baseline; admin-merge precedent applied) + bug-35 (deferred via idea-216)
- **ADRs referenced:** ADR-017 INV-AG6 (4-state liveness FSM preserved) + ADR-018 (cognitive pipeline modular contract)

---

## 12. Mission close

mission-62 plannedTasks 1–4 status=completed via `update_mission(mission-62, plannedTasks=[...all completed])` 2026-04-28 ~11:05 AEST. mission status flipped `active → completed` in the same call. bug-35 NOT closed by this mission (deferred via idea-216).

Substrate is healthy. Both agents online (lily defensive but functional; greg production posture validated). Mission-62 closes clean with 23 calibrations + 5 follow-on ideas + 1 W4 audit doc + 1 W5 closing audit doc (this report).

Next-architect-pickup: idea-219 + idea-220 + tracking PR for tactical canonical-tree edits. The architectural direction surfaced today (wire = projection of entity; schema rename → state migration script; shim observability as durable telemetry surface) is the substrate-cleanup-wave forward path.
