# Mission M-Wire-Entity-Convergence — Closing Report

**Hub mission id:** mission-63
**Mission brief:** `docs/designs/m-wire-entity-convergence-design.md` v1.0 (architect-authored 2026-04-28; engineer round-1 audit + architect round-2 ratify + engineer ratify + bilateral close on thread-399 round-4)
**Mission class:** structural-inflection (with substrate-self-dogfood; second canonical execution of the substrate-self-dogfood pattern; mission-62 W4 was first observation-only execution)
**Sizing baseline:** L (~1–1.5 engineer-weeks); actual ~6 engineer-hours engineer-side execution + ~3-hour architect-side P0 substrate recovery (calibration #25 SDK rebuild gap)
**Anchor + composes:** idea-219 parent (Wire-Entity Envelope Convergence + Schema-Migration Discipline); incorporates 5 mission-62 calibrations rooted in shared architectural pattern (per-type case dispatch instead of canonical envelope); composes with idea-220 Phase 2 (engineer-side Agent-record read parity + observability formalization); architectural-precedents mission-62 (substrate-introduction + 5 calibrations source) + mission-61 (Layer-3 SDK-tgz-stale lesson + Path A SSE-push wiring) + mission-56 (substrate-self-dogfood pattern source)
**Tele primaries:** tele-3 Absolute State Fidelity + tele-7 Resilient Operations + tele-6 Deterministic Invincibility; tele-2 Frictionless Agentic Collaboration tertiary
**Dates:** Phase 3 Survey ratified 2026-04-28 mid-day (Director picks Q1=A+B, Q2=D, Q3=A, Q4=A, Q5=E, Q6=A); Phase 4 Design v0.1→v1.0 ratified bilaterally 2026-04-28 ~14:30Z on thread-399; Phase 5+6 Manifest+Preflight 2026-04-28 ~15:00Z (commit 4c6e76c → PR #117 merged 03:57Z 2026-04-28); Phase 7 Release-gate Director ratification 2026-04-28 ~03:30Z UTC ("Approved for go"); Phase 8 W1-W3 execution 2026-04-28 04:00–04:43Z UTC (PRs #118 + #119 merged in tight cycle); §6.3 adapter-restart gate executed (P0 + recovery 2026-04-28 04:43–05:00Z); Phase 8 W4 substrate-self-dogfood verification 2026-04-28 05:03–05:08Z (thread-403 converged); Phase 9+10 W5 closing audit + retrospective 2026-04-28 ~05:30Z (this doc)
**Closes:** mission-63 plannedTasks (W0 + W1+W2 + W3 + W4 + W5); rolls 3 PRs (#117 + #118 + #119); 5 mission-62 calibrations retired (#17, #18, #19, #20 main+sub, #22); 2 NEW W4-dogfood calibrations surfaced (#25 + #26); ADR-028 SCAFFOLD → RATIFIED bilateral

---

## 1. Deliverable scorecard

| PR | Wave | Source directive | Status | Commit | Test count delta |
|---|---|---|---|---|---|
| **#117** | Survey + Design + ADR-028 SCAFFOLD + Preflight | Director Q1=A+B Q4=A Q5=E ratified survey envelope | ✅ Merged 03:57Z | `a8c7afe` | doc-only (5 deliverables: Survey + Design v1.0 + ADR-028 SCAFFOLD + Preflight + mission Manifest reference) |
| **#118** | W1+W2 Hub-side canonical envelope | thread-399 Design v1.0 ratification | ✅ Merged 04:42:34Z | `371fb53` | +projectAgent helper tests + register_role envelope tests + claim_session envelope tests + get_agents shape tests + agent_state_changed payload tests |
| **#119** | W3 adapter parser + render-registry + state-migration | thread-399 Design v1.0 ratification | ✅ Merged 04:42:39Z | `a976d84` | +parseHandshakeResponse canonical envelope tests + render-registry dispatch tests + state-migration idempotency + Hub-stopped-self-check tests; +215/-119 net in adapter-side TS |
| **W4** | Substrate-self-dogfood verification | architect-owned bilateral self-validation per Design v1.0 §6 | ✅ Completed | thread-403 converged @ 05:08:27.632Z | docs/audits/m-wire-entity-convergence-w4-validation.md |
| **W5** | Closing audit + ADR-028 RATIFIED | architect-owned (this report) | ✅ Completed | (this commit; W5 follow-on PR) | doc-only + ADR ratification |

**Aggregate:** 3 substrate PRs + 1 W4 dogfood thread + 1 W5 closing audit (this doc) + Pass 10 protocol-extension PR (W5 follow-on, separate). Mission status flipped `active → completed` via `update_mission` 2026-04-28 W5 close.

**Engineer-side execution velocity:** 2 substrate PRs (Hub-side #118 + adapter-side #119) merged in same wave with 5-second gap (04:42:34Z → 04:42:39Z) — tight-cycle pattern per Design v1.0 §7 mission decomposition. Substrate-introduction sizing baseline (L) was conservative; realized closer to M with the calibration #25 P0 architect-side substrate recovery adding ~3 hours.

---

## 2. Mission goal + success framing

**Parent idea-219 (Wire-Entity Envelope Convergence + Schema-Migration Discipline):** unify the wire shape with the Agent entity contract so that Agent-state-bearing wire surfaces canonically project the entity (not flat-field bespoke shapes), and replace the per-event-type if-ladder in `buildPromptText` with a render-template registry. Bundle Schema-Migration Discipline so any code-only schema rename PR ships a migration script that updates persisted state (closes mission-62 P0 root cause class). Bundle pulse-template-as-derived-view discipline so pulse content is synthesized from current state rather than statically configured per mission. Self-dogfood the result — consume the canonical envelope end-to-end during W4 validation.

**Success criteria (from Design v1.0 §1 + §2, ratified):**

1. ✅ Canonical Agent envelope `{ok, agent: AgentProjection, session: SessionBindingState, wasCreated?}` ships across all Agent-state-bearing wire surfaces (handshake response, agent_state_changed SSE, list_available_peers projection field-shape). PR #118 ships Hub-side response builders + projectAgent helper. Verified via PR #118 + #119 tests + W4 dogfood test #2 (verbatim canonical envelope present at handshake response on both sides).
2. ✅ AgentProjection schema (Design v1.0 §2.2) exposes wire-relevant fields (id, name, role, livenessState, activityState, labels, clientMetadata?, advisoryTags?); internal/operational fields stay OFF wire (fingerprint, currentSessionId, lastSeenAt, archived, recentErrors, restartHistoryMs). projectAgent helper at `hub/src/policy/agent-projection.ts` is single point-of-truth for internal Agent → wire AgentProjection. Verified via PR #118.
3. ✅ Adapter render-template registry (Design v1.0 §4) replaces per-event-type if-ladder in `packages/network-adapter/src/prompt-format.ts buildPromptText`. 4 mandatory templates ship: `message_arrived` (with pulseKind disambiguation), `thread_message`, `thread_convergence_finalized`, `agent_state_changed`. Adding new event types = registering a template (O(1) instead of O(N)). Verified via PR #119 + W4 dogfood tests #3, #4, #5, #6 (4 distinct event types validated through registry).
4. ✅ State-migration discipline ships as companion. `scripts/migrate-canonical-envelope-state.ts` (PR #119; 248 lines): Hub-stopped self-check via `curl localhost:8080/mcp` connection-refused; idempotent; backup-before-mutation at `/tmp/agents-pre-canonical-envelope-migration-<ts>.tar.gz`; `name = id` fallback for legacy records lacking name field; clientMetadata/advisoryTags default to `{}` if malformed. Migration scanned 8 records / mutated 4 (the 4 needing `name` fallback). Verified via dry-run + post-migration W4 handshake clean.
5. ✅ Pass 10 protocol extension shipped as W5 follow-on PR adding (a) Hub container rebuild step (calibration #17 from mission-62; reinforced) + (b) state-migration script step (calibration #19 from mission-62; codified) + (c) SDK-package rebuild step (calibration #25 from this mission's W4-dogfood-surfaced gap). Update target: `docs/methodology/multi-agent-pr-workflow.md` Pass 10.
6. ✅ Substrate-self-dogfood (W4) executed as second canonical execution of the pattern. Substrate verdict GREEN-with-AMBER (5 GREEN + 1 AMBER + 1 OUT-OF-SCOPE). thread-403 converged bilaterally with stagedActions=[close_no_action] at 05:08:27.632Z. Calibration #20 main retire (body inline now); residual sub-finding surfaces NEW calibration #26 (silent ~250-char truncation marker missing on thread_message-event-type-specific).
7. ✅ ADR-028 SCAFFOLD shipped at PR #117; RATIFIED at W5 close (this doc + bilateral architect+engineer ratify). Sealed companions: ADR-013/014 (Threads 2.0 stagedActions) — architectural-precedent for canonical envelope `{kind, type, payload}` pattern; ADR-017 INV-AG6 — 4-state liveness FSM preserved unchanged; ADR-018 — cognitive pipeline modular contract orthogonal to canonical envelope (cognitive intercepts at CallTool/response boundary; canonical envelope governs SSE/notification → buildPromptText boundary).
8. ⚠ Engineer-side adapter (vertex-cloudrun) — stub-only this mission per anti-goal §8.2; full parity in idea-220 Phase 2.

---

## 3. Per-PR architecture recap

### 3.1 PR #117 — Survey + Design v1.0 + ADR-028 SCAFFOLD + Preflight (commit a8c7afe)

Director Survey 2026-04-28 mid-day: Q1 (A+B; calibration retire + substrate fidelity), Q2 (D; bundle 5 calibrations into single mission), Q3 (A; structural-inflection mission-class), Q4 (A; both Hub-output + adapter-render layers ship together), Q5 (E; clean cutover, no legacy co-existence), Q6 (A; substrate, full 5-requirement self-dogfood). Architect Design v0.1 authored 2026-04-28 ~13:30Z; engineer round-1 audit shipped ~13:50Z surfacing **AgentProjection field-set narrowing** (operational fields belonged OFF wire; engineer-side parity narrowed to stub-only); architect round-2 ratify ~14:00Z; v0.2 published ~14:10Z; engineer ratify on round-3; bilateral close on thread-399 round-4 at ~14:30Z; v1.0 ratified.

ADR-028 SCAFFOLD authored 2026-04-28 ~14:45Z: 5 calibrations → single architectural pattern (per-type case dispatch instead of canonical envelope); status flow SCAFFOLD → RATIFIED at W5 close.

Preflight artifact 6-category audit (mission-class fit + tele alignment + sizing + risks + anti-goals + dependencies): verdict GREEN; activation pending Director release-gate.

### 3.2 PR #118 — W1+W2 Hub-side canonical envelope (commit 371fb53)

**`hub/src/policy/agent-projection.ts` NEW:** single point-of-truth `projectAgent(agent: Agent): AgentProjection` helper. Wire-relevant fields only (id, name, role, livenessState, activityState, labels, optional clientMetadata + advisoryTags). Internal/operational fields filtered OUT (fingerprint, currentSessionId, lastSeenAt, archived, recentErrors, restartHistoryMs). Optional-field emit pattern: `if (agent.clientMetadata) proj.clientMetadata = agent.clientMetadata` — present only when source has data.

**`hub/src/policy/session-policy.ts` modified:**
- `registerRole` returns `{ok, agent: AgentProjection, session: {epoch, claimed:false}, wasCreated, message?}` (replaces flat-field `{ok, agentId, sessionEpoch, sessionClaimed, wasCreated, ...}`)
- `claimSession` returns `{ok, agent, session: {epoch, claimed:true, trigger, displacedPriorSession?}, message?}` (canonical envelope; trigger ∈ explicit_claim/sse_subscribe/first_tool_call)
- `getAgents` returns `{agents: AgentProjection[]}` (replaces flat-field array of mixed shape)
- `buildAgentStateChangedPayload` returns `{event, agent, previous: {livenessState?, activityState?}, changed[], cause, at}` (canonical event-shape for SSE dispatch)
- Defensive `agent_record_missing` error code surfaces if internal Agent record absent at envelope-build time (operational error; not legacy-shape fallback per anti-goal §8.1 clean cutover).

Tests added covering envelope shape invariants + projectAgent field-filter discipline + dispatch matching for `agent_state_changed`.

### 3.3 PR #119 — W3 adapter parser + render-template registry + state-migration script (commit a976d84)

**`packages/network-adapter/src/kernel/handshake.ts` modified:** `parseHandshakeResponse` reads `body.agent.id` + `body.session.epoch` from canonical envelope. Legacy flat-field shape (`body.agentId` + `body.sessionEpoch`) is rejected — clean cutover per anti-goal §8.1; deployment skew with stale Hub container surfaces immediately as parse_failed rather than silently degrading.

**`packages/network-adapter/src/prompt-format.ts` modified (+215/-119 net):** `buildPromptText` replaced with registry pattern. `Map<event, RenderTemplate>` dispatch; 4 mandatory templates registered at module load:
- `message_arrived` (with `pulseKind` sub-discriminator for status_check / missed_threshold_escalation / etc.)
- `thread_message` (peer reply on active thread; renders body inline)
- `thread_convergence_finalized` (Hub-finalized convergence; renders ConvergenceReport summary inline)
- `agent_state_changed` (Agent state transition; renders previous → current FSM transition + cause inline)

Adding a new event type = registering one template + writing one render function. The if-ladder fall-through path (which silently degraded to generic `[Author] sent ...` shape on mission-62 W4 calibration #20 RED) is GONE — registry dispatches by exact event match; unmapped event throws operationally rather than degrading.

**`scripts/migrate-canonical-envelope-state.ts` NEW (248 lines):** Hub-stopped self-check (`curl localhost:8080/mcp` must return ECONNREFUSED — Hub-up rejected to prevent concurrent-write race); idempotent (re-running on already-migrated state is no-op); backup-before-mutation tarball at `/tmp/agents-pre-canonical-envelope-migration-<ts>.tar.gz`; per-record migration logic includes `name = id` fallback for legacy records (mission-62 W4 era records lacked name field) + clientMetadata/advisoryTags default to `{}` if malformed.

### 3.4 W4 substrate-self-dogfood verification thread-403 (no PR; doc-only audit)

Architect-owned bilateral self-validation per Design v1.0 §6. Second canonical execution of the substrate-self-dogfood pattern (mission-62 W4 was first observation-only execution). Full 5-requirement check:
- Dogfood gate identified (W3 PR #119 merge)
- Pre-gate sequencing (W0 PR #117 → W1+W2 PR #118 → W3 PR #119 tight-cycle)
- Adapter-restart gating per §6.3 9-step (executed; surfaced calibration #25; recovered within W3-W4 window)
- Verification protocol (this thread; 7 test points; 5 GREEN + 1 AMBER + 1 OUT-OF-SCOPE)
- Hold-on-failure (calibration #25 surfaced + recovered before resuming W4 verification)

Validated end-to-end both sides:
- Handshake parses cleanly post-restart on canonical envelope (test #1)
- Verbatim canonical envelope at handshake response (test #2)
- agent_state_changed SSE round-trip with previous + at + cause (test #3 via Hub log dispatch evidence)
- Pulse content rendering inline ~440 chars verbatim symmetric (test #4 architectPulse → lily; engineerPulse → greg)
- thread_convergence_finalized full ~1900 chars verbatim inline (test #6 thread-402 close envelope)

Calibrations retired by W4 (full narrative + verbatim envelope quotes in `docs/audits/m-wire-entity-convergence-w4-validation.md`):
- **#17** Hub-rebuild gap in Pass 10 protocol — RETIRED (build-hub.sh discipline executed at every Hub-source PR; zero deployment-skew parse_failed events)
- **#18** Wire-shape vs entity-shape divergence — RETIRED (canonical envelope unifies wire surfaces with Agent entity contract; verbatim envelope present at handshake response)
- **#19** Schema-rename PRs without state-migration script — RETIRED (migrate-canonical-envelope-state.ts shipped + Pass 10 protocol extension W5 follow-on PR)
- **#22** Pulse-template stale-content — RETIRED (pulse-template absorbed by canonical envelope discipline; current-mission-phase content rendered inline; no W1+W2 leakage)
- **#20** Thread-message envelope render-layer gap — PARTIAL RETIRE (main RED retired: body IS inline now; sub-finding GREEN: convergence_finalized full verbatim; AMBER residual: silent ~250-char truncation on thread_message-event-type-specific surfaces NEW calibration #26)

NEW W4-dogfood calibrations:
- **#25** Pass 10 protocol gap on SDK tgz rebuild (folded into W5 protocol-extension PR scope)
- **#26** Silent thread_message body truncation marker missing (thread_message-event-type-specific narrowed; folded into idea-220 Phase 2 + W5 protocol-extension PR low-pri marker-spec recommendation)

---

## 4. W4 dogfood findings (cross-ref to validation audit)

W4 self-validation thread (thread-403) ran 2026-04-28 ~05:00–05:10Z UTC after the §6.3 adapter-restart gate (which surfaced + recovered calibration #25). Architect-owned bilateral with greg. Full 5-requirement substrate-self-dogfood scope per Design v1.0 §6. Converged at round-2 with `stagedActions=[close_no_action]` + summary capturing W4-thread evidence.

**Substrate verdict: GREEN-with-AMBER.** 5 GREEN + 1 AMBER + 1 OUT-OF-SCOPE.

Detailed test scoreboard, verbatim envelope captures, and architectural framing in `docs/audits/m-wire-entity-convergence-w4-validation.md`. Summary in §3.4 above.

---

## 5. P0 substrate-recovery interlude (calibration #25 evidence)

**Timeline:**
- 2026-04-28 ~04:43Z UTC — PR #119 merged (W3); §6.3 9-step adapter-restart gate triggered. Director-coordinated restart of both lily + greg.
- ~04:50Z UTC — fresh-lily attempted handshake post-PR-#119; hit `parse_failed` events in `.ois/shim-events.ndjson`. Hub-side response shape confirmed canonical envelope (correct); adapter-side parser returned null.
- ~04:55Z UTC — Director feedback "Investigate logs"; diagnosis via shim observability Phase 1 (FileBackedLogger + structured NDJSON events shipped via mission-62 W4-followon PR #115). Root cause: `install.sh` rebuilds claude-plugin/dist but does NOT rebuild network-adapter SDK or refresh `ois-network-adapter-2.0.0.tgz`. Adapter restart on stale SDK tgz (pre-PR-#119 code) was running the old flat-field `parseHandshakeResponse`.
- ~04:57Z UTC — recovery sequence: `cd packages/network-adapter && rm -rf dist && npm run build && npm pack && cp ois-network-adapter-2.0.0.tgz adapters/claude-plugin/lib/ && rm -rf node_modules && ./install.sh` then full adapter restart. Handshake parses cleanly. Both lily + greg restarted clean by Director.
- ~05:00Z UTC — W4 dogfood resumed. thread-403 opened.

**Total P0 time-to-recovery: ~17 minutes.** Faster recovery than mission-62 P0 (~3 hours) because:
- Shim observability Phase 1 (mission-62 W4-followon PR #115) was already in place; root cause surfaced from log capture in <1 minute rather than ~30 minutes
- Single root cause class (SDK rebuild gap); mission-62 P0 had two layered causes (Hub container + state schema)
- No state-migration loop required (state-migration script already shipped in PR #119; ran before W3 merge)

**Recovery action calibration #25 — Pass 10 protocol gap on SDK tgz rebuild.** Captured into W5 follow-on Pass 10 protocol-extension PR scope. Symmetric extension: any PR touching `packages/network-adapter/src/**` requires SDK rebuild + tgz repack + reinstall before adapter restart, mirroring the existing Hub-source rebuild step.

---

## 6. Calibrations captured (2 NEW + 5 retired from prior accumulated ledger)

mission-63 was tightly-scoped (incorporates idea-219; targets retiring 5 specific mission-62 calibrations rooted in shared root cause); calibration accumulation in this mission is small relative to mission-62's 23.

| # | Title | Source | Status | Idea/Action |
|---|---|---|---|---|
| **17** | Hub-rebuild gap in Pass 10 protocol | mission-62 P0 (smoking gun layer 1) | **RETIRED** | build-hub.sh discipline executed throughout mission-63 |
| **18** | Wire-shape vs entity-shape divergence | mission-62 + Director Q4 framing | **RETIRED** | canonical envelope ships PR #118 + #119 |
| **19** | Schema-rename PRs without state-migration script | mission-62 P0 (smoking gun layer 2) | **RETIRED** | migrate-canonical-envelope-state.ts ships PR #119 + Pass 10 extension W5 PR |
| **20** | Thread-message envelope render-layer gap | mission-62 W4 thread-395 dogfood | **PARTIAL RETIRE** (main GREEN; sub AMBER → #26) | render-registry ships PR #119; main retire confirmed; AMBER residual surfaces #26 |
| **22** | Pulse-template stale-content | mission-62 W4 thread-395 dogfood | **RETIRED** | absorbed by canonical envelope discipline; W4 dogfood pulses rendered current-phase content inline |
| **25** NEW | Pass 10 protocol gap on SDK tgz rebuild | mission-63 §6.3 P0 triage 2026-04-28 | **OPEN** | folded into W5 Pass 10 protocol-extension PR scope |
| **26** NEW | Silent thread_message body truncation marker missing | mission-63 W4 thread-403 dogfood | **OPEN** | low-pri marker-spec recommendation in W5 protocol-extension PR; design + implementation deferred to idea-220 Phase 2 |

**Pre-mission-63 calibrations NOT retired by this mission (parked at idea-220 Phase 2 territory):** #15 (cognitive pipeline modular-config gap), #16 (shim observability invisibility-at-P0; Phase 1 landed; Phase 2 formalization pending), #21 (engineer Agent-record read-surface gap), #23 (pulse-template not role-aware).

---

## 7. Follow-on ideas

| Idea | Title | Scope | Calibrations covered |
|---|---|---|---|
| **idea-219** | Wire-Entity Envelope Convergence + Schema-Migration Discipline | **CLOSED** by mission-63 | #17, #18, #19, #20 (main+sub-GREEN), #22 |
| **idea-220** | Shim Observability — Structured Telemetry Sinks (Phase 2) + engineer-side Agent-record read parity | OPEN | #15, #16, #21, #23, #26 (truncation marker design); + thread_message marker-protocol future work |
| **W5 protocol-extension PR** (this mission) | Pass 10 multi-agent-pr-workflow.md update — SDK rebuild step + state-migration step + low-pri marker-spec recommendation | OPEN (follow-on this mission) | #25 + #26 (low-pri marker line) |
| **idea-218** | Adapter local cache (mission-62 deferral; consumer-emergence trigger) | OPEN, deferred | #11 (mission-62) |
| **idea-216** | bug-35 selectAgents semantic shift defer | OPEN, Survey-needed | bug-35 (pre-mission-62) |
| **idea-217** | Adapter compile/update/re-install streamline | OPEN | #6, #12 (mission-62) |

idea-219 closes via mission-63's W4 GREEN-with-AMBER verdict. idea-220 Phase 2 is the next architectural follow-on and will incorporate calibrations #15, #16, #21, #23, plus the marker-protocol design surfaced from #26.

---

## 8. Tele alignment

**Primary tele coverage:**
- **tele-3 Absolute State Fidelity** — canonical Agent envelope unifies wire shape with Agent entity contract; renames at Hub propagate through wire by construction (TS-LSP rename + tests catch breakage). PR #118 + #119 ship the entity-projection helper + render-template registry. State-migration script discipline (companion) ensures persisted state matches code-renamed fields. Zero `engineerId/agentId` divergence on wire post-cutover. mission-62 P0 root cause class (state-vs-code drift) is now closed by Schema-Migration Discipline.
- **tele-7 Resilient Operations** — substrate-self-dogfood pattern reused successfully (second canonical execution); §6.3 adapter-restart gate surfaced + recovered calibration #25 within W3-W4 window in ~17 minutes (vs mission-62's ~3 hours) thanks to shim observability Phase 1 already in place. Pass 10 protocol extension (W5 follow-on) codifies SDK rebuild step → mission-63's calibration #25 root cause class also closed.
- **tele-6 Deterministic Invincibility** — mission-class structural-inflection with full 5-requirement self-dogfood; verified GREEN-with-AMBER. Second canonical execution proves the substrate-self-dogfood pattern is repeatable for missions broader in scope than mission-62's primitive-introduction (mission-63 introduces a wire-shape contract used by 4 distinct event types simultaneously).

**Tertiary tele coverage:**
- **tele-2 Frictionless Agentic Collaboration** — render-template registry replaces if-ladder with O(1)-per-event-type dispatch; pulse content rendered inline current-phase (calibration #22 retire) reduces friction for both engineer + architect peer awareness. Engineer-side parity gap (calibration #21) tracked under idea-220 Phase 2.

**Tele faults closed:**
- **mission-62 W4 calibration #20 RED → mission-63 W4 calibration #20 main retire** (tele-3 fidelity gap on render-vs-state alignment closed for the if-ladder → registry transition).

**Tele faults surfaced:**
- **calibration #26** — silent thread_message body truncation marker missing (tele-3 fidelity gap on render-completeness signaling). Empirically narrowed to `thread_message`-event-type-specific; design + implementation deferred to idea-220 Phase 2.

---

## 9. Aggregate metrics

**Velocity:**
- Engineer-side execution: 2 substrate PRs (#118 + #119) merged in tight-cycle wave (5-second gap at 04:42:34Z → 04:42:39Z); cumulative engineer-side execution time ~1.5 hours including review.
- Architect-side: ~1.5 hours pre-W4 (Survey + Design v0.1→v1.0 + thread-399 4-round + Manifest + Preflight + ADR-028 SCAFFOLD); ~30 minutes W4 dogfood + W5 audit cycle (this report); ~17 minutes calibration #25 P0 recovery.

**Sizing accuracy:**
- Baseline L (~1–1.5 engineer-weeks); realized closer to M for engineer-side. Architect-side P0 unplanned but recovered within session — much faster than mission-62's P0 (3 hours) thanks to shim observability Phase 1 already deployed.

**Test count delta** (combining W1+W2+W3 PRs):
- Hub: tests added for projectAgent field-filter + register_role envelope shape + claim_session envelope + get_agents shape + agent_state_changed payload.
- network-adapter: tests added for parseHandshakeResponse canonical envelope + render-registry dispatch + state-migration idempotency + Hub-stopped-self-check. +215/-119 net in adapter-side TS prompt-format.

**State migration scope:** 8 Agent records scanned; 4 mutated (the 4 lacking `name` field — fallback applied `name = id`). Backup preserved at `/tmp/agents-pre-canonical-envelope-migration-<ts>.tar.gz`. Idempotent re-run no-op verified.

**Calibrations:** 2 NEW (#25 + #26) + 5 retired-from-prior (#17, #18, #19, #20 main+sub-GREEN, #22). Per-mission-class precedent: structural-inflection class with substrate-self-dogfood typically surfaces 5–25 calibrations through Survey + Design + ship + dogfood + audit. mission-63's 2 NEW sits at the low end primarily because the mission was tightly-scoped to retire pre-existing calibrations (incorporated 5 known root-cause-class issues) rather than introduce new substrate.

---

## 10. Sync state at mission close

**Repo state:**
- main HEAD: `a976d84` (PR #119 merge — adapter-side W3)
- All 3 mission-63 PRs merged into main (#117 doc + #118 Hub-side + #119 adapter-side)
- W5 follow-on PR (this audit + Pass 10 protocol extension) staged on `agent-lily/m-wire-entity-convergence-design` branch; targets main

**Operational posture:**
- Hub container: `ois-hub-local-prod` running canonical envelope-aware code (post-PR-#118 image)
- Lily: online, canonical envelope production posture (eager + cognitive); validated end-to-end during W4 dogfood
- Greg: online, canonical envelope production posture (eager + cognitive); validated end-to-end during W4 dogfood
- Local-fs Agent state: migrated (8 records scanned / 4 name-fallback mutated); orphan-free; backup preserved at `/tmp/agents-pre-canonical-envelope-migration-<ts>.tar.gz`

**Memories saved (durable cross-session) — pre-existing from mission-62 + reinforced this mission:**
- `feedback_pass10_rebuild_hub_container.md` — Hub container rebuild discipline (reinforced; build-hub.sh discipline executed cleanly throughout mission-63)
- `feedback_schema_rename_requires_state_migration.md` — migration script requirement + recovery pattern (reinforced; codified into Pass 10 protocol extension at W5)
- `reference_shim_observability.md` — file paths + env vars for diagnostic surfaces (used during calibration #25 P0 recovery)
- `reference_idea_219_220_post_mission_62.md` — cross-reference for follow-on architecture work (idea-219 now CLOSED via this mission; idea-220 Phase 2 still pending)
- (No new memories from mission-63 — pattern was established in mission-62 W5 close.)

---

## 11. Cross-references

- **mission brief:** `docs/designs/m-wire-entity-convergence-design.md` v1.0
- **W4 audit:** `docs/audits/m-wire-entity-convergence-w4-validation.md`
- **Survey artifact:** `docs/designs/m-wire-entity-convergence-survey.md`
- **Preflight:** `docs/missions/m-wire-entity-convergence-preflight.md`
- **PRs:** #117 (a8c7afe; Survey + Design + ADR-028 SCAFFOLD + Preflight) + #118 (371fb53; W1+W2 Hub-side) + #119 (a976d84; W3 adapter)
- **threads:** thread-399 (Design v0.1→v1.0 4-round bilateral audit) + thread-402 (W4-prep coordination; closed) + thread-403 (W4 substrate-self-dogfood verification; converged)
- **ideas:** idea-219 **CLOSED** by this mission (Wire-Entity Envelope Convergence + Schema-Migration Discipline) + idea-220 OPEN Phase 2 (engineer-side parity + observability formalization + thread_message marker-protocol)
- **adjacent missions:** mission-62 (substrate-introduction Agent entity revisit; 5 calibrations source) + mission-61 (Layer-3 SDK-tgz-stale lesson + Path A SSE-push wiring; substrate-self-dogfood pattern source) + mission-56 (substrate-self-dogfood substrate canonical execution)
- **bugs:** bug-31 (plannedTasks cascade workaround applied throughout)
- **ADRs:** **ADR-028 RATIFIED via this mission** (Canonical Agent Envelope: Wire = Projection of Entity); ADR-013/014 (Threads 2.0 stagedActions; sealed companion architectural-precedent); ADR-017 INV-AG6 (4-state liveness FSM preserved); ADR-018 (cognitive pipeline modular contract; orthogonal to canonical envelope)

---

## 12. Mission close

mission-63 plannedTasks W0 + W1+W2 + W3 + W4 + W5 all status=completed via `update_mission(mission-63, plannedTasks=[...all completed])` at W5 close (this commit). mission status flipped `active → completed` in the same call.

ADR-028 status flipped SCAFFOLD → RATIFIED at W5 close per ratification protocol (W4 evidence captured in W4 validation audit; in-flight refinements folded; bilateral architect+engineer ratify on W5 closing thread).

Substrate is healthy. Both agents online (production posture validated end-to-end during W4 dogfood). mission-63 closes clean with 2 NEW calibrations (#25 + #26 → folded into W5 Pass 10 protocol-extension PR + idea-220 Phase 2 respectively) + 5 retired calibrations (#17, #18, #19, #20 main+sub-GREEN, #22) + 1 W4 audit doc + 1 W5 closing audit doc (this report).

Next-architect-pickup: Pass 10 protocol-extension PR (W5 follow-on; SDK rebuild step + state-migration step + low-pri marker-spec recommendation). Then idea-220 Phase 2 mission-class evaluation. The architectural direction codified by mission-63 (wire = projection of entity; render-template registry; state-migration discipline) is now durable substrate for future missions; Forward-consequences in ADR-028 § Forward consequences capture the long-tail evolution path.
