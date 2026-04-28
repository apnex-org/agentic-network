# Mission M-Wire-Entity-Convergence — Pre-Design Intent Survey

**Source Idea:** idea-219 (Wire-Entity Envelope Convergence + Schema-Migration Discipline)
**Survey conducted:** 2026-04-28 ~12:00 AEST (architect lily; Director-ratified)
**Per:** `docs/methodology/idea-survey.md` v1.0 (canonical Idea→Design triage methodology)
**Lifecycle phase:** 3 Survey (between Idea triage + Design v0.1 architect draft)
**Status:** v1.0 — bilateral interpretation complete; composite intent envelope below bounds Phase 4 Design phase

---

## Source Idea description (carry-forward context)

idea-219 captures two related architectural gaps surfaced during mission-62 W4 dogfood + post-P0 substrate recovery cycle 2026-04-28:

**(A) Wire-shape vs entity-shape divergence:** register_role response and similar Agent-state-bearing responses use flat fields (`agentId`, `sessionEpoch`, `sessionClaimed`, etc.) rather than mirroring the canonical Agent entity shape. Director-flagged: *"Agent{} is now a first-class managed state object — shouldn't message structure reflect this?"*

**(B) Schema-rename PRs without state migration:** PRs #112 (engineerId → agentId, 62 files) and #113 (Agent.agentId → Agent.id, "TS-LSP-equivalent rename") changed code but never migrated persisted local-fs Agent records. Result: stale records had legacy field name; new Hub code read `agent.id` → undefined; response builder dropped the field via `JSON.stringify({agentId: undefined})`; adapter parser failed; CallTool gate stalled forever; LLM-driven MCP tool calls all hung. Five agent records had stale `engineerId`. One was literally written to `undefined.json`.

idea-219's proposal A: canonical wire envelope mirroring entity (`{ok, agent: {id, name, role, ...}, session: {epoch, claimed, ...}, wasCreated}` for register_role/claim_session; same shape across Agent-state-bearing surfaces; adapter parser reads `body.agent.id`).

idea-219's proposal B: schema-migration discipline (Pass 10 protocol extension; mandatory migration script + `build-hub.sh` for hub/src changes).

---

## Round 1 — Director picks + architect interpretation

### Q1 — WHY: dominant driving pressure?

**Picks:** A + B (Calibration retire + Substrate fidelity)

**Aggregate signal:** Director rejected C (API v2.0 absorption — defer-only path) and D (migration discipline as standalone policy). The combination of A+B says: **envelope conversion IS the calibration-retire mechanism** — the architectural fidelity work is the lever that retires the calibrations as a side effect, not as add-on policy.

**Tele alignment (Round 1):** tele-3 Absolute State Fidelity primary (wire mirrors entity → fidelity preserved across renames-by-construction); tele-7 Resilient Operations secondary (calibration-retire reduces P0-recovery cycles structurally).

**Interpretation:** A alone would suggest fragmented per-calibration patches; B alone would suggest envelope conversion in isolation. Together: structural fidelity AS the calibration close path. Migration script is part of mission deliverables (per Q3=A), but it's not the dominant pressure — fidelity is.

### Q2 — WHO: wire-surface scope?

**Picks:** D (Full sweep across all Agent-state-bearing wire surfaces)

**Aggregate signal:** Director rejected the containment hierarchy A→B→C (handshake-only / + read / + push). **Half-sweep is worse than either fully-old or fully-new.** A handshake-on-canonical-envelope but get_agents-still-flat state would create worse architectural inconsistency than today's all-flat baseline.

**Wire surfaces in scope:**
- `register_role` response (handshake)
- `claim_session` response (handshake)
- `get_agents` return (read-path; intersects #21 from idea-220)
- `agent_state_changed` SSE event payload (push-path; companion to #20)

**Surfaced for Round 2 — render-layer scope ambiguity:** Calibration #20 is about thread_message envelope render-layer gap in `buildPromptText`, distinct from Hub-output wire shape. Open: does this mission ALSO cover adapter-render envelope unification? → resolved in Round 2 Q4.

### Q3 — HOW-cadence: rollout strategy?

**Picks:** A (Single big-bang mission)

**Aggregate signal:** Director rejected B (spike-first — too gradual for full-sweep), C (feature-flagged — adds operational overhead vs clean cutover), D (defer to v2.0 — punts the calibration-retire). Picked A = structural-inflection class mission with all pieces in one ship.

**Implied wave shape:** W0 formalize envelope + ADR scaffold; W1+W2 Hub-side response builder conversion; W3 adapter-side parser + render + state-migration script; W4 substrate-self-dogfood verification; W5 closing audit + Pass 10 protocol extension PR + ADR final.

**Per-PR coherence requirement:** No partial-state on main during execution — each wave must be substrate-coherent (Hub + adapter changes coupled per wave).

### Round 1 cross-question coherence check

3 interpretations align internally — A+B / D / A forms a coherent intent envelope:
- This is structural-inflection class work (matches mission-class L sizing)
- Calibration retire IS architectural fidelity (Q1 A and B reinforce, not contradict)
- Full-sweep is the only coherent scope (Q2 D is the natural complement to Q1 A+B)
- Big-bang is the right cadence (Q3 A matches L-class)

No contradictions surfaced; no clarification candidates from internal coherence.

---

## Round 2 — Director picks + architect interpretation

**Round 2 strategy chosen** (per `idea-survey.md` §4): **anchor scope and architectural-coverage gaps** (Round 1 cleanly confirmed all 3 dimensions; Round 2 explores: render-layer scope, anti-goals slate, substrate-vs-enrichment classification).

**Round 2 tele mapping (refresh):** tele-3 Absolute State Fidelity (confirmed primary); tele-7 Resilient Operations (confirmed primary; reinforced by Q5 anti-goals); **tele-6 Deterministic Invincibility now primary** (Q6=A elevated tele-6 from secondary; full 5-requirement substrate-self-dogfood is its hallmark); tele-1 Sovereign State Transparency secondary.

### Q4 — Render-layer envelope scope?

**Picks:** A (Both layers ship together)

**Aggregate signal:** Director picked maximally-coherent architectural framing. The render-layer if-ladder in `buildPromptText` and the wire-shape flat-field problem at Hub-output are **the same architectural pattern** — per-type case dispatch instead of canonical envelope. Solving once at Hub-output but leaving render-layer if-ladder in place lands on architecturally inconsistent ground.

**Implication:** Phase 4 Design's W3-equivalent wave includes adapter-render unification as part of adapter-side conversion work. Single canonical envelope conforms at Hub-output, transits the wire, consumed by adapter's render pipeline (single function dispatching on `event` field, not 4-branch payload-discriminator). Calibration #20 retires fully in this mission.

This resolves the Round 1 Q2 cross-question ambiguity — render-layer is IN.

**Tele alignment:** tele-3 stronger (uniform pattern across layers); tele-7 stronger (no half-converted state at any layer).

### Q5 — Anti-goals (what's explicitly out-of-scope)?

**Picks:** E (All of A+B+C+D — lock all 4 anti-goals)

**Aggregate signal:** Maximally explicit out-of-scope locking. Mirrors mission-62's "13 anti-goals locked" precedent. Each anti-goal closes a scope-creep vector:

| Anti-goal | Rationale |
|---|---|
| **(A) NO legacy-flat-field deprecation runway** | Clean cutover; no co-existence period; state migration converts persisted records and adapter parsers convert wire-readers atomically. Eliminates the deprecation-runway-discipline overhead AND eliminates "is the legacy reader still working?" uncertainty during execution. |
| **(B) vertex-cloudrun stub-only** | Engineer-side adapter parity follows in idea-220 Phase 2 (separate mission); this mission ships claude-plugin only. Per mission-62 precedent (W3 anti-goal #11). Reduces wave count + dogfood scope. |
| **(C) idea-218 Adapter local cache stays deferred** | Still consumer-blocked; not relevant to envelope shape per se. Mention in Design as explicit non-goal so reviewers don't expect it. |
| **(D) idea-217 Adapter compile/update streamline stays separate** | This mission ships ONE migration script + Pass 10 protocol extension (operational tooling for THIS rename), but does NOT ship the broader rebuild-streamline. idea-217 remains its own future mission per Director's 2026-04-27 flagging. |

**Pairing with Q4=A:** Q4 expands architectural coverage (both layers); Q5 locks against further scope creep. Maximally ambitious WITHIN bounded scope.

**Tele alignment:** Anti-goals serve tele-7 (Resilient Operations — clean cutover means no recovery surface); tele-3 (Absolute State Fidelity — no co-existence ambiguity).

### Q6 — Substrate-self-dogfood discipline?

**Picks:** A (Substrate, full 5-requirement pattern)

**Aggregate signal:** Substrate-vs-enrichment classification confirmed as substrate. This mission ships substrate that the mission's own coordination consumes: handshake response that architect↔engineer threads use; `agent_state_changed` SSE events the substrate-self-dogfood-thread observes; `thread_message` envelope the dogfood thread itself sends/receives. Maximally circular dogfood — exactly the substrate-self-dogfood discipline test surface (mission-56 W2.2 push pipeline canonical example, mission-62 W4 second canonical).

**Full 5-requirement pattern execution:**

1. **Dogfood gate identification** — which sub-PR's merge unlocks canonical-envelope behavior end-to-end? Likely the wave that converts BOTH Hub register_role response AND adapter parser; wave coherence requirement from Q4=A means single sub-PR per wave.
2. **Pre-gate sub-PR sequencing** — pre-gate waves use legacy flat-fields; post-gate waves use canonical envelope. Architect↔engineer threading respects this.
3. **Adapter-restart / Hub-redeploy gating** — explicit wave step: at gate-PR merge, run `build-hub.sh` + state-migration script + `install.sh` + lily/greg restart. This is the Pass 10 protocol extension under live exercise.
4. **Verification protocol** — architect-engineer thread post-gate that captures verbatim envelope shape on both sides + tests render-layer inline rendering of both pulse + thread_message events through canonical envelope. mission-62 W4 thread-395 pattern reused.
5. **Hold-on-failure clause** — if verification fails → downstream waves resume legacy-mode + substrate change investigated.

mission-62 set first canonical execution of the pattern with observation-only scope; this mission will be the **second canonical** with full-coverage scope.

**Tele alignment:** tele-6 Deterministic Invincibility primary (substrate-self-dogfood is its core lever); tele-7 Resilient Operations primary (hold-on-failure clause); tele-3 Absolute State Fidelity primary (live verification of envelope fidelity end-to-end).

### Round 2 cross-question coherence check

A / E / A forms a tight coherent envelope:
- Maximum architectural coverage (Q4 A: both layers)
- WITHIN tightly bounded scope (Q5 E: 4 anti-goals locked)
- WITH maximally rigorous verification (Q6 A: full 5-requirement substrate-self-dogfood)

No contradictions. All 3 picks reinforce each other:
- Both layers (Q4) need clean cutover (Q5 A) to avoid half-state during dogfood
- Substrate-self-dogfood (Q6) requires bounded scope (Q5 E) to keep wave count manageable
- Clean cutover (Q5 A) needs full dogfood verification (Q6 A) to land safely

**No clarification candidates from internal coherence. Survey envelope ratifies cleanly.**

---

## Composite intent envelope (the "solved matrix" — Phase 4 Design input)

### Mission identity

**Working name:** M-Wire-Entity-Convergence (final naming Director-ratified at Phase 5 Manifest / `create_mission`)
**Mission class:** structural-inflection (per §3 taxonomy in `mission-lifecycle.md` v1.2)
**Sizing baseline:** L (~1.5–2 engineer-weeks)
**Tele primaries:** tele-3 Absolute State Fidelity + tele-7 Resilient Operations + tele-6 Deterministic Invincibility (substrate-self-dogfood). tele-1 Sovereign State Transparency tertiary.
**Anchor:** idea-219 (incorporates this mission); composes with idea-121 (API v2.0 — natural fold-in but mission ships standalone per Director Q3=A); related to idea-218 + idea-217 (anti-goals); architectural-precedent mission-62 (Layer-1+2+3 fix lineage; substrate-self-dogfood pattern; Pass 10 rebuild discipline).

### Scope (full sweep across Agent-state-bearing surfaces — Q2=D + Q4=A)

| Layer | Surface | Action |
|---|---|---|
| Hub-output | `register_role` response | Convert to `{ok, agent: {id, name, role, livenessState, activityState, labels, clientMetadata, advisoryTags}, session: {epoch, claimed, displacedPriorSession?}, wasCreated}` shape |
| Hub-output | `claim_session` response | Same envelope; `session.claimed=true`; `session.trigger="explicit_claim"` |
| Hub-output | `get_agents` return | Array of `agent: {...}` projections |
| Hub-output | `agent_state_changed` SSE event payload | `{agent: {...}, changed: [...fields], cause: ...}` shape |
| Adapter-render | `buildPromptText` (single canonical pipeline) | Consume canonical envelope `event` discriminator; retire per-event-type if-ladder; render inline for `event ∈ {message_arrived/pulseKind, thread_message, thread_convergence_finalized, agent_state_changed, ...}` uniformly |
| Adapter-parsers | `parseHandshakeResponse` + `parseClaimSessionResponse` | Read `body.agent.id`/`body.agent.*`; canonical envelope; remove `body.agentId`/flat-field paths |
| State migration | `local-state/agents/*.json` | Migrate persisted Agent records to match envelope (already done in mission-62 P0 recovery; verify clean during W3) |
| Pass 10 protocol | `docs/methodology/multi-agent-pr-workflow.md` extension OR new ADR | Schema-rename PRs MUST include migration script + `build-hub.sh` mandatory for hub/src changes |
| ADR | New ADR (`ADR-0??-canonical-agent-envelope.md`) | "Wire = projection of entity"; envelope contract; redaction discipline; sealed via ADR-018 (cognitive pipeline) + ADR-017 (queue lifecycle) companions |

### Anti-goals locked (Q5=E)

1. **NO legacy-flat-field deprecation runway** — clean cutover; no co-existence period
2. **vertex-cloudrun stub-only** — engineer-side parity in idea-220 Phase 2
3. **idea-218 Adapter local cache stays deferred** — no consumer; not envelope-shape-relevant
4. **idea-217 Adapter compile/update streamline stays separate** — this mission ships Pass 10 ext only, not broader streamline

### Substrate-self-dogfood (Q6=A)

Full 5-requirement pattern at W4 (substrate, not enrichment); see Q6 interpretation above for per-requirement detail.

### Calibrations retired (5 of 9 P0+W4 from mission-62)

- **#17** Hub-rebuild gap (Pass 10 ext)
- **#18** wire-shape drift (canonical envelope)
- **#19** schema-rename without migration (migration script + Pass 10 ext)
- **#20** thread-message render-layer gap (adapter-render unification)
- **#22** pulse-template-as-derived-view (envelope projection of state principle applied to pulse-content render)

### Calibrations NOT retired (stay scoped under idea-220 Phase 2)

- **#15** cognitive-pipeline modular-config gap
- **#16** shim-observability invisibility-at-P0
- **#21** engineer Agent-record read-surface gap
- **#23** pulse-template not role-aware

### Wave plan (preliminary; Design v1.0 will refine)

- **W0** — formalize canonical envelope shape; ADR scaffold
- **W1+W2** — Hub-side response builder conversion (atomic claim per mission-62 precedent; covers register_role + claim_session + get_agents + agent_state_changed SSE)
- **W3** — adapter-side parser + render conversion + state-migration script (atomic claim; gate-PR for substrate-self-dogfood)
- **W4** — substrate-self-dogfood verification (architect-bilateral; full 5-requirement pattern; verbatim envelope captures both sides)
- **W5** — closing audit + Pass 10 protocol extension PR + ADR final + retrospective mode-pick

---

## Director-engagement points (per `mission-lifecycle.md` §1)

- **Phase 3 Survey: COMPLETE** (this artifact; ~5min Director-time for 6 picks)
- **Phase 7 Release-gate** — preflight verdict ratification (next Director-engagement point post-Design)
- **Phase 10 Retrospective** — mode-pick + ratification per chosen mode (final Director-engagement)

All other phases (4 Design, 5 Manifest, 6 Preflight, 8 Execution, 9 Close) are architect+engineer scope per `mission-lifecycle.md` §1.5 RACI matrix.

Director **OUT of Design mechanics** until Phase 7 Release-gate.

---

## Cross-references

- **idea-219** — source idea (Wire-Entity Envelope Convergence + Schema-Migration Discipline)
- **mission-lifecycle.md** v1.2 — formal lifecycle methodology
- **idea-survey.md** v1.0 — canonical Idea→Design triage methodology (this Survey follows v1.0)
- **mission-62** — architectural-precedent mission (5 calibrations rolled up; substrate-self-dogfood W4 first canonical observation-only execution; Pass 10 rebuild discipline; W4 audit at `docs/audits/m-agent-entity-revisit-w4-validation.md`; W5 closing audit at `docs/audits/m-agent-entity-revisit-w5-closing-audit.md`)
- **mission-56** — substrate-self-dogfood W2.2 first canonical substrate execution (push pipeline)
- **mission-57** — substrate-self-dogfood enrichment-defer canonical (PulseSweeper)
- **idea-121** — API v2.0 tool-surface (composes; mission ships standalone but folds into v2.0 vocabulary when v2.0 mission emerges)
- **idea-218** — Adapter local cache (anti-goal: stays deferred)
- **idea-217** — Adapter compile/update streamline (anti-goal: separate mission)
- **idea-220** — Shim Observability Phase 2 (companion; covers calibrations not retired here)
- **ADR-017** INV-AG6 — 4-state liveness FSM preserved (predates this work; carry-forward)
- **ADR-018** — cognitive pipeline modular contract (companion; surfaces in calibration #15 / idea-220)
