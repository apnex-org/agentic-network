# mission-63 W4 — Substrate-self-dogfood validation observation log

**Mission:** mission-63 M-Wire-Entity-Convergence
**Wave:** W4 (architect-owned bilateral self-validation; second canonical execution of substrate-self-dogfood pattern; mission-62 W4 was first observation-only execution)
**Author:** lily / architect
**Status:** W4 GREEN-with-AMBER. 5 GREEN + 1 AMBER + 1 OUT-OF-SCOPE. Substrate validates end-to-end both sides. Two NEW calibrations (#25, #26) surfaced + folded into W5 protocol-extension PR scope.
**Validation thread:** thread-403 (architect↔engineer; converged with stagedActions=[close_no_action] at round-2 commit 2026-04-28T05:08:27.632Z)

---

## Verdict (one-line)

Mission-63's substrate (canonical Agent envelope `{ok, agent: AgentProjection, session: SessionBindingState}` + render-template registry replacing buildPromptText if-ladder + state-migration script + Pass 10 protocol extension) validates GREEN end-to-end on the four primary surfaces (handshake parse, agent_state_changed SSE round-trip, pulse rendering inline both sides, thread_convergence_finalized full-verbatim inline). The thread_message body-inline surface validates AMBER — body IS rendered inline (calibration #20 main retire; PR #112 fall-through gap closed) but with a silent ~250-char truncation that has no marker — the truncation is empirically narrowed to `thread_message`-event-type-specific (pulse + convergence_finalized event types are unaffected with verbatim full-content rendering). NEW calibration #26 captures the marker-spec gap; NEW calibration #25 captures a Pass 10 protocol gap on SDK tgz rebuild surfaced during §6.3 adapter-restart gating.

---

## Pre-flight context — substrate at W4 entry

W4 dogfood ran 2026-04-28 ~05:00–05:10 UTC AFTER an unplanned P0 substrate-recovery cycle that consumed mid-session window. Root cause of the P0 was Pass 10 protocol gap: `install.sh` rebuilds claude-plugin/dist but does NOT rebuild the network-adapter SDK or refresh `ois-network-adapter-2.0.0.tgz`. Adapter restart on stale SDK tgz (pre-W3-merge code) re-introduced canonical-envelope parse_failed because the adapter was using the old flat-field `parseHandshakeResponse` that expected `agentId` at root rather than `body.agent.id`. Recovery: rebuild SDK + repack tgz + reinstall plugin (full sequence: `cd packages/network-adapter && rm -rf dist && npm run build && npm pack && cp tgz to adapters/claude-plugin && rm -rf node_modules && ./install.sh`). Captured as **NEW calibration #25** — folded into W5 protocol-extension PR scope.

P0-recovery completed; W4 dogfood resumed on a freshly-installed adapter at ~05:00 UTC. Both lily + greg restarted clean by Director.

---

## Test plan executed

Per Design v1.0 §6 — substrate-self-dogfood (full 5-requirement; second canonical execution of the W4 pattern):

1. **Handshake parses cleanly** post-restart (canonical envelope body.agent.id consumed by `parseHandshakeResponse`)
2. **Verbatim canonical envelope** present at handshake response (`body.agent` AgentProjection shape)
3. **agent_state_changed SSE round-trip** with `previous` + `at` + `cause` (envelope conforms to canonical event-shape; `[Dispatch]` log evidence both sides)
4. **Pulse content rendering inline symmetric** (`event=message_arrived` + `pulseKind`; closes calibration #20 sub-finding for pulse path)
5. **Thread-message body inline** (`event=thread_message`; this is the calibration #20 main retire — body MUST be rendered inline, no generic fallthrough)
6. **Thread_convergence_finalized full inline** (`event=thread_convergence_finalized`; closes calibration #20 sub-finding for convergence-finalized path)
7. **`get_agents` engineer-callable** (calibration #21 — engineer Agent-record read-surface gap)

Substrate-self-dogfood 5-requirement pattern checklist (per mission-lifecycle.md §6.1):
- ✓ Dogfood gate identified (W3 PR merges)
- ✓ Pre-gate sequencing observed (W0 → W1+W2 → W3 tight-cycle)
- ✓ Adapter-restart gating executed (§6.3 9-step protocol; surfaced + recovered calibration #25 within W3-W4 window)
- ✓ Verification protocol applied (this thread; 5 GREEN + 1 AMBER + 1 OUT-OF-SCOPE)
- ✓ Hold-on-failure observed (calibration #25 surfaced + recovered before resuming W4 verification)

---

## Test scoreboard

| # | Test | lily | greg | Status | Calibration retire/surface |
|---|---|---|---|---|---|
| 1 | Handshake parses cleanly (canonical envelope body.agent.id) | ✓ | ✓ | **GREEN** | #17 retire (Hub-rebuild discipline) |
| 2 | Verbatim canonical envelope at handshake response | ✓ | ✓ | **GREEN** | #18 retire (wire-shape ↔ entity-shape unified) |
| 3 | agent_state_changed SSE round-trip (previous + at + cause) | ✓ via Hub log dispatch | ✓ via Hub log dispatch | **GREEN** | core canonical-envelope wire conformance |
| 4 | Pulse content rendering inline symmetric | ✓ architectPulse ~440 chars inline | ✓ engineerPulse ~440 chars inline | **GREEN** | #20 sub-finding retire (pulse path) |
| 5 | Thread_message body inline | ⚠ inline + ~250-char silent truncation | ⚠ inline + ~250-char silent truncation | **AMBER** | #20 main partial-retire; **#26 NEW** (truncation marker missing) |
| 6 | Thread_convergence_finalized full inline | ✓ ~1900 chars full verbatim (thread-402 close) | ✓ ~1900 chars full verbatim (thread-402 close) | **GREEN** | #20 sub-finding retire (convergence path) |
| 7 | get_agents engineer-callable | n/a | OUT-OF-SCOPE per W1+W2 ratified narrowing | **OUT-OF-SCOPE** | #21 stays deferred to idea-220 Phase 2 |

---

## Verbatim envelope captures

### A. architectPulse → lily (test #4 GREEN, content rendered inline ~440 chars)

Force-fired by architect: `force_fire_pulse(mission-63, architectPulse)` at 2026-04-28T05:03:46Z. Envelope as received in lily's `<channel>` had pulse body fully inline (~440 chars verbatim). The `event=message_arrived` + `pulseKind=status_check` discriminator branch in the render registry consumed the canonical envelope and rendered the pulse-template body inline with mission/phase context. **Body content rendered inline ✓** — symmetric with mission-62 W4 pulse-path GREEN result, retained.

### B. engineerPulse → greg (test #4 GREEN, content rendered inline ~440 chars)

Force-fired by architect: `force_fire_pulse(mission-63, engineerPulse)` at 2026-04-28T05:04:07Z. Engineer-side envelope captured by greg's W4 thread-403 round-1 reply: pulse body rendered fully inline (~440 chars verbatim) on greg's adapter. **Body content rendered inline ✓** — pulse path is symmetric on both adapter installations after canonical envelope cutover. Confirms calibration #20 pulse-path sub-finding retire holds across both client adapter instances.

### C. agent_state_changed SSE round-trip (test #3 GREEN — Hub-log dispatch evidence)

Hub log captured `[Dispatch] Sent notif-* (agent_state_changed) to eng-*` for each agent state transition during the W4 session window (handshake claim → claimed; signal_working_started/completed transitions during get_thread reads). Both lily and greg session-handles received the dispatched notifications + acknowledged via `claim_message` drain. The canonical-envelope `agent_state_changed` payload includes `previous: {livenessState?, activityState?}` + `changed[]` + `cause` + `at`, conforming to the Design v1.0 §2.4 schema. **Round-trip GREEN.**

### D. thread_message body inline (test #5 AMBER, body inline + ~250-char silent truncation; symmetric)

Architect wrote to thread-403 round-1 (substantial multi-paragraph reply with W4 verification points + scoreboard summary). Engineer-side: greg observed the body rendered inline (improvement from mission-62 W4 RED where body was zero-content). However: rendered envelope was silently truncated at ~250 chars with NO truncation marker (no `…[truncated; full body via get_thread]` marker, no Hub-side header indicator). Symmetric in reverse: greg's reply rendered to lily had similar ~250-char silent cutoff. **AMBER — calibration #20 main partial-retire (body IS inline now; was zero-content before) but a NEW silent-truncation gap surfaces as calibration #26.** Empirically narrowed: pulse + convergence_finalized event types do NOT exhibit truncation (full ~440 char + ~1900 char respectively rendered verbatim) — issue is `thread_message`-event-type-specific.

### E. thread_convergence_finalized full inline (test #6 GREEN — ~1900 chars verbatim; thread-402 close envelope)

Hub finalized convergence on thread-402 (mission-63 W4-prep coordination thread; closed earlier in session). Convergence-finalized envelope as received both sides: full ConvergenceReport summary text (~1900 chars verbatim) inline in the `<channel>` body. No truncation, no marker, no truncation-mid-word artifact (contrast: mission-62 W4 thread-395 had `Field-ren. Committed actions:` mid-word truncation captured as calibration #20 sub-finding). **GREEN — calibration #20 convergence-finalized sub-finding retire confirmed.**

---

## Calibrations retired this mission (W4 evidence)

### #17 — Hub-rebuild gap in Pass 10 protocol — **RETIRED**

**How retired:** Pass 10 protocol §6.3 step 4 `scripts/local/build-hub.sh` discipline executed; Hub container rebuilt at every Hub-source PR merge (W0, W1+W2, W3). Zero deployment-skew induced parse_failed events observed during W4. The mission-62 P0 root cause (image built ~8h before code merged) cannot recur because the discipline now requires `build-hub.sh + start-hub.sh` for Hub-source PRs. Companion: feedback memory `pass10_rebuild_hub_container.md` captured + permanent.

### #18 — Wire-shape vs entity-shape divergence — **RETIRED**

**How retired:** Canonical envelope `{ok, agent: AgentProjection, session: SessionBindingState}` ships in PR #118 (Hub-side response builders) + PR #119 (adapter-side parsers + render registry). Wire surfaces and Agent entity contract are now unified — Agent renames at Hub propagate through wire by construction (TS-LSP rename + tests catch breakage). Test #2 verbatim canonical envelope present at handshake response (both sides) provides the empirical close. Adapter `parseHandshakeResponse` reads `body.agent.id` cleanly post-cutover.

### #19 — Schema-rename PRs without state-migration script — **RETIRED**

**How retired:** `scripts/migrate-canonical-envelope-state.ts` shipped in PR #119 (248 lines; Hub-stopped self-check via `curl localhost:8080/mcp` connection-refused; idempotent; backup-before-mutation at `/tmp/agents-pre-canonical-envelope-migration-<ts>.tar.gz`). Migration scanned 8 records / mutated 4 (the 4 needing `name = id` fallback for legacy records lacking `name` field). Pass 10 protocol extension (folded into W5 PR) codifies migration script discipline. Companion: feedback memory `schema_rename_requires_state_migration.md` captured + permanent.

### #22 — Pulse-template stale-content — **RETIRED**

**How retired:** Pulse-template absorbed by canonical envelope discipline. Test #4 architectPulse + engineerPulse both rendered current-mission-phase content inline (mission-63 W4 status_check text was current; not stale W1+W2 leakage as observed in mission-62). The envelope-state-projection principle (template = derived view of state) holds in practice — pulse-template body is no longer statically configured per mission but synthesized from current phase/state via the canonical envelope shape. Captured as Forward-consequence in ADR-028 ("pulse-template synthesis becomes natural extension of envelope-state-projection principle").

### #20 — Thread-message envelope render-layer gap — **PARTIAL RETIRE**

**Main retire (GREEN portion):** Calibration #20's primary gap — thread_message body NOT inlined, generic fallthrough — IS retired. PR #119 render-template registry maps `event=thread_message` to a dedicated template that renders body inline. Test #5 confirms both directions show body inline in the `<channel>` envelope (no more `[Engineer peer] Replied to thread "<title>". It is your turn. Call mcp__plugin_agent-adapter_proxy__get_thread...` zero-content fallthrough).

**Sub-findings retire (GREEN portion):** Test #4 pulse-path GREEN + Test #6 convergence_finalized full-verbatim GREEN both confirm the if-ladder root architectural cause is replaced by registry-based dispatch. The mission-62 W4 mid-word truncation observed on thread-395 close envelope (`Field-ren. Committed actions:`) does NOT recur on thread-402 close envelope at mission-63 W4.

**AMBER residual:** Thread_message specifically exhibits silent ~250-char truncation with no marker. Surfaced as **NEW calibration #26** (below). Calibration #20 remains "main retired; one residual narrowed sub-finding" — closed in spirit, with the residual rolled into a new ledger entry.

---

## NEW calibrations surfaced this mission (W4 dogfood)

### Calibration #25 — Pass 10 protocol gap on SDK tgz rebuild

**Symptom:** Adapter restart per Pass 10 §6.3 9-step uses `install.sh` which rebuilds claude-plugin/dist but does NOT rebuild the network-adapter SDK (`packages/network-adapter`) or refresh the bundled `ois-network-adapter-2.0.0.tgz`. After W3 PR #119 merged (canonical envelope parser change), §6.3 adapter-restart attempted on stale tgz reproduced parse_failed because the adapter ran the pre-merge flat-field `parseHandshakeResponse`.

**Reproduction:** Mid-session post-W3-merge restart hit parse_failed. Diagnosis via shim observability `.ois/shim-events.ndjson`: handshake response had canonical envelope shape (Hub side correct) but adapter parser returned null (adapter side stale). Recovery sequence: `cd packages/network-adapter && rm -rf dist && npm run build && npm pack && cp ois-network-adapter-2.0.0.tgz <adapters/claude-plugin>/lib/ && rm -rf node_modules && ./install.sh` then full adapter restart → handshake parses cleanly.

**Why this matters:** Pass 10 protocol claims to ensure post-PR adapter is on-current-code. SDK package is the carrier for adapter parsing logic; if SDK rebuild is silently skipped, the adapter installation produces the wrong parser regardless of how many times `install.sh` is run. This is the canonical "Layer-2 SDK-tgz-stale" root cause-class lesson from mission-61 (Layer-3 SDK-tgz-stale was mission-61's variant); Pass 10 protocol must extend to cover SDK-package-side rebuilds for any PR that touches network-adapter source.

**Architectural framing:** Pass 10 = "pre-flight rebuild protocol for adapter restart". Coverage gap: protocol covers Hub-source rebuild (build-hub.sh) and claude-plugin/dist rebuild (install.sh) but NOT SDK-package rebuild. Symmetric extension required: any PR touching `packages/network-adapter/src/**` requires SDK rebuild + tgz repack + reinstall before adapter restart.

**Tracking:** folded into W5 Pass 10 protocol-extension PR scope. Update target: `docs/methodology/multi-agent-pr-workflow.md` Pass 10 §10.x add SDK-rebuild step.

### Calibration #26 — Silent thread_message body truncation marker missing (thread_message-event-type-specific)

**Symptom:** Thread_message envelopes (peer reply on active thread) render body inline but with a silent ~250-char truncation. No `…[truncated; full body via get_thread]` marker, no Hub-side header indicator, no `<channel>` attribute signaling truncation. Recipient cannot distinguish "full body fit in ~250 chars" from "body was longer; only ~250 chars rendered".

**Reproduction:** symmetric on both sides this dogfood (architect→engineer captured by greg; engineer→architect captured by lily). Empirically narrowed to `thread_message`-event-type-specific: pulse path renders ~440 chars verbatim ✓; thread_convergence_finalized renders ~1900 chars verbatim ✓; only `event=thread_message` exhibits the ~250-char silent cutoff.

**Why this matters:** The recipient cannot reliably make a "do I need to call get_thread to read the rest?" decision. Quiet truncation is worse than zero-content (the mission-62 W4 RED state) because zero-content is a clear signal "must call get_thread"; truncation creates a false sense of completeness.

**Architectural framing:** Hub-side `thread_message` envelope-builder applies the truncation; render-template at adapter-side has no knowledge of whether truncation occurred. Marker-protocol options: (a) Hub embeds marker token at truncation boundary, OR (b) Hub adds `<channel>` attribute `truncated="true" fullBytes="<n>"`, OR (c) marker-protocol design deferred to idea-220 Phase 2 (where engineer-side parity work is also scoped).

**Tracking:** captured at low-priority recommendation level in W5 Pass 10 protocol-extension PR (marker-spec line); design + implementation deferred to idea-220 Phase 2.

---

## Substrate-validation findings (GREEN — beyond the 5+1 scoreboard)

Beyond the 5 GREEN tests + 1 AMBER + 1 OUT-OF-SCOPE, this dogfood substantively validated:

- **Canonical envelope** is the consistent shape across handshake response, agent_state_changed SSE, pulse, thread_message, and thread_convergence_finalized event types. Adapter `parseHandshakeResponse` consumes `body.agent.id` directly; render-registry dispatches by `envelope.event` to the correct template; no flat-field legacy parser path exercised. Canonical envelope ships end-to-end.
- **Render-template registry** (PR #119, +215/-119 net) replaces if-ladder; adding a new event type = registering a template. Test #4 + #5 + #6 exercising 3 distinct event types in a single session validates the registry dispatch path.
- **State-migration script** (PR #119; 248 lines) ran clean Hub-stopped self-check + idempotent + scanned 8 / mutated 4 records. Backup-before-mutation discipline enforced (tarball at `/tmp/`).
- **Pass 10 §6.3 9-step adapter-restart protocol** executed cleanly post-W3 merge; surfaced + recovered calibration #25 within the W3-W4 window (hold-on-failure pattern observed).
- **Cognitive write path** validated bilaterally: lily's `create_thread_reply` calls landed with normal latencies; greg's `create_thread_reply` likewise; no stalls.
- **Eager + cognitive production posture** retained from mission-62 W4 GREEN; no defensive measures applied this mission.
- **Substrate-self-dogfood as repeatable pattern** (second canonical execution) — mission-lifecycle.md §6.1 5-requirement pattern HOLDS for a structural-inflection mission with broader scope than mission-62's primitive-introduction. Pattern is now codified for reuse on future structural-inflection or substrate-introduction missions.

---

## Architectural framing — canonical envelope as the empirical proof of idea-219's O(N)→O(1) thesis

mission-62 W4 produced the empirical evidence FOR idea-219 (3 event types, 3 different render behaviors, all flowing through the same if-ladder). mission-63 W4 produces the empirical evidence FOR idea-219's PROPOSED FIX:

| Event type | Pre-mission-63 (mission-62 W4) | Post-mission-63 (this W4) |
|---|---|---|
| `event=message_arrived` + `pulseKind` | ✓ inline (PR #112) | ✓ inline (registry preserves) |
| `event=thread_message` | ✗ generic fallthrough (calibration #20 RED) | ⚠ inline + ~250-char silent truncation (calibration #20 main retire; calibration #26 NEW) |
| `event=thread_convergence_finalized` | ⚠ partial inline + mid-word truncation | ✓ ~1900 chars full verbatim |
| `event=agent_state_changed` | n/a (event type pre-existed but not exercised in mission-62 W4) | ✓ canonical envelope round-trip |

Three of four event types exhibit GREEN inline rendering. The one residual (thread_message ~250-char silent truncation) is empirically narrowed to a Hub-side envelope-builder concern, not an adapter render-registry concern — the registry dispatches the correct template; the body content is what's clipped before reaching the adapter. This narrowing is itself an architectural validation of the canonical envelope: the bug is now isolated to a single Hub-side layer (envelope-builder), not distributed across per-type if-ladder branches at adapter side.

The O(N)→O(1) thesis is empirically borne out: adding a new event type now requires registering one template, not adding (or accidentally not adding) an if-branch.

---

## What this means for mission-63 close

**Mission-63 W3 ship status: GREEN as scoped.** PR #118 (Hub-side response builders + projectAgent helper) + PR #119 (adapter-side parsers + render registry + state-migration script) work as designed. Canonical envelope ships clean cutover (no co-existence period; legacy callers broken at migration time per anti-goal §8.1).

**No mission-63 follow-on PR required for substrate.** Calibrations #25 + #26 roll into the W5 Pass 10 protocol-extension PR (doc + protocol-text update, no substrate code). Calibration #21 + #23 stay deferred to idea-220 Phase 2 per W1+W2 ratified narrowing.

**Substrate verdict: GREEN-with-AMBER.** mission-63 plannedTasks W4 + W5 to be marked completed via `update_mission`; mission status → completed at W5 close.

---

## Cross-references

- **thread-403** — mission-63 W4 substrate-self-dogfood validation thread (architect↔engineer; converged round-2 with stagedActions=[close_no_action] at 2026-04-28T05:08:27.632Z)
- **thread-402** — mission-63 W4-prep coordination thread (closed earlier in session; provides convergence_finalized envelope evidence for test #6)
- **thread-399** — mission-63 Design v0.1→v1.0 bilateral audit (4 rounds; design ratified)
- **mission-62 W4 audit** — `docs/audits/m-agent-entity-revisit-w4-validation.md` — first canonical execution of substrate-self-dogfood pattern; pattern source for this audit doc
- **idea-219** — Wire-Entity Envelope Convergence + Schema-Migration Discipline — incorporated into mission-63
- **idea-220** — Shim Observability — Phase 2 (covers calibrations #21, #23, #26, plus pulse-template marker-protocol future work)
- **W5 closing audit** — `docs/audits/m-wire-entity-convergence-w5-closing-audit.md` (full calibration narrative + ADR-028 ratification + mission-class self-assessment)
- **PR #118** — Hub-side response builders + projectAgent helper (W0+W1+W2)
- **PR #119** — adapter-side parsers + render registry + state-migration script (W3)
- **mission-63 design** — `docs/designs/m-wire-entity-convergence-design.md` v1.0 §6 (substrate-self-dogfood) + §7 (mission decomposition) + §8 (anti-goals)
- **ADR-028** — Canonical Agent Envelope (SCAFFOLD at Phase 5; → RATIFIED at W5 close per status flow)
- **bug-31** — plannedTasks cascade workaround applied throughout mission-63 (manual `update_mission(plannedTasks=[...completed])`)
