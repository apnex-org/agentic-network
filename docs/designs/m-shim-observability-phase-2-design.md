# M-Shim-Observability-Phase-2 — Design v0.1 (architect-draft pre-Director-review)

**Status:** v0.1 architect-draft (pre-Director-review per mission-65 cadence precedent: Director Phase 4 review pre-engineer-audit; non-standard cadence for substantive missions). Following Director ratification, opens engineer round-1 audit thread for v0.2 → v1.0 ratification.
**Mission name:** M-Shim-Observability-Phase-2 (mission-66 candidate; idea-220 Phase 2)
**Mission-class:** structural-inflection + substrate-introduction sub-class (ADR-031 event taxonomy) + tooling-introduction sub-class (CLI script); L mid-scope (~3-4 eng-days)
**Source idea:** idea-220 Phase 2 (Shim Observability — Structured Telemetry Sinks; composite scope per `reference_idea_219_220_post_mission_62.md`)
**Survey:** `docs/surveys/m-shim-observability-phase-2-survey.md` (Round 1 + Round 2 ratified 2026-04-29; composite intent envelope §14)
**Tele primaries (ratified Round 1 Q1=B,C):** tele-7 Resilient Operations + tele-2 Frictionless Agentic Collaboration; tele-3 + tele-6 are secondary/tertiary mechanisms riding along
**Authors:** lily / architect (v0.1); bilateral round-1 audit with greg / engineer pending Director Phase 4 review
**Lifecycle phase:** 4 Design (architect-led; Director Phase 4 review pre-engineer-audit per mission-65 cadence precedent)

---

## §1 Goal + intent (echo Survey envelope §14)

**Goal:** Operationalize the diagnostic surface introduced tactically in Phase 1 (mission-62-W4-followon) + close 4 carryover calibrations (#21 + #26 + #40 + #41) + ship a first-class CLI script (`get-agents.sh`) that gives operators a no-MCP-required terminal surface for Hub Agent state inspection.

**Architectural framing:** *"Shim observability becomes a formal contract (event taxonomy + ADR + log-level filter + tests + Pass 10 inclusion); engineer-side tool-surface symmetry restores collaboration substrate (#21 get_agents parity + #41 bilateral-blind closure + #26 render-fidelity at truncation); Hub-side projection-fidelity audit closes #40 composite divergence; CLI script provides ergonomic operator frontend that ALSO surfaces #40 projection gaps to operator visibility immediately."*

**Tele primaries (Round 1 Director Q1=B,C — primaries; Q1 NOT A and NOT D — secondary/tertiary):**
- **tele-7 Resilient Operations** PRIMARY — shim observability formalization; future-P0 diagnostic surface; defeat-recurrence-class for diagnostic-blackhole-at-P0
- **tele-2 Frictionless Agentic Collaboration** PRIMARY — engineer get_agents read parity (#21); bilateral-blind closure (#41); multi-role read-surface symmetry across architect/engineer/Director
- tele-3 Absolute State Fidelity — secondary; sub-scope mechanism (projection audit + render-fidelity at truncation)
- tele-6 Deterministic Invincibility — tertiary; #41 schema-validate is implementation-domain mechanism (Q6 NOT A)

**Phase composition (Survey §14 ratified):**
- **Phase 2 (this mission #6):** scope per Q4=C — comprehensive internal-pool idea-220 Phase 2 scope
- **Phase 3 (deferred future mission):** vertex-cloudrun engineer-side observability parity (Q4 D explicitly excluded)

---

## §2 Architecture

### §2.1 Substrate carryover closures (4 calibrations)

#### §2.1.1 Calibration #21 closure — engineer get_agents read parity (tele-2)

**Surface:** `get_agents` MCP tool currently architect-pool-only; engineer cannot call it for substrate-self-check workflows.

**Closure path:** Hub MCP tool registry exposes `get_agents` to engineer role-pool with same read-only semantics architect has today. No new tool-surface verbs (idea-121 deferral preserved); existing `get_agents` is the surface — only authority-boundary changes.

**Scope:**
- Hub-side: extend role-filter on `get_agents` MCP tool to allow engineer role
- Engineer-side: dispatcher inclusion in engineer's tool catalog; cognitive-layer authority-check passes
- Test surface: engineer-pool integration test exercising `get_agents` from engineer adapter
- No state migration needed (read-only; no persisted state changes)

**Risk:** none material; symmetric extension of existing tool-surface authority pattern.

#### §2.1.2 Calibration #26 closure — thread_message marker-protocol (tele-3 sub-scope)

**Surface:** `thread_message` event-type-specific silent ~250-char body truncation at Hub envelope-builder; render-template at adapter side has no marker-protocol awareness.

**Closure path:** Phase 4 Design RATIFIES marker-protocol per Q6=C (3 sketched options; architect-lean to be ratified):
- **(a) Hub embeds marker token at truncation boundary** — token like `[…TRUNCATED N bytes]` inline at body cutoff; render-template parses inline. Pro: simple; in-band. Con: token-in-body breaks render-template parsing simplicity if body legitimately contains the token sequence.
- **(b) `<channel>` attribute `truncated="true" fullBytes="<n>"`** — out-of-band metadata via XML attribute on the `<channel>` envelope element; render-template-registry consumes; full body remains as inner content with no inline marker. Pro: out-of-band; render-template-registry can render or omit per consumer preference; preserves body. Con: requires render-template-registry update; metadata-in-attribute pattern not yet established for thread_message.
- **(c) Sidecar event** — Hub emits separate `thread_message_truncated` event on truncation; render-template consumes either thread_message OR thread_message_truncated. Pro: maximally explicit. Con: doubles event-stream surface; ordering-coordination needed.

**Architect-lean closure path:** **(b) `<channel>` attribute** — out-of-band metadata is consistent with envelope-as-projection-of-state principle (ADR-028 mission-63 lineage); render-template-registry update is well-scoped (single-template extension); preserves body content for full-byte recovery (`fullBytes` attribute enables future re-render with full body if surfaced via separate fetch). Phase 4 Design ratifies (b) pending bilateral concur.

**Scope (post-ratify):**
- Hub-side: envelope-builder for `thread_message` event-type adds `truncated="true" fullBytes="<n>"` attributes to `<channel>` element when body byte-length exceeds truncation threshold
- Adapter render-template-registry: `thread_message` template extended to read `<channel>` attributes + render `[…<N> bytes truncated; query thread for full content]` suffix when `truncated="true"`
- Test surface: deliberately-truncated thread_message integration test; verify marker rendered + full byte-count exposed

**Coordinated upgrade scope (per anti-goal #8):**
- BOTH architect-side AND engineer-side adapter `thread_message` render-templates upgraded in same W1+W2 atomic PR (single `@apnex/network-adapter` SDK package; both adapters consume same render-template-registry; coordinated upgrade automatic via single-package shipment)
- Vertex-cloudrun adapter (Phase 3 mission) adopts marker-protocol at Phase 3 with stable v1 contract — Hub-side always emits marker; consumers ignore unknown `<channel>` attributes if not yet upgraded (forward-compat preserved at Hub-side)
- No interim state where Hub emits marker but adapter doesn't render — single-PR W1+W2 atomic ships both

**Risk:** R2 in §5 risk register.

#### §2.1.3 Calibration #40 closure — Hub-side projection audit + version-source-of-truth consolidation (tele-3 sub-scope)

**Surface:** 4 known divergence symptoms (per `reference_idea_219_220_post_mission_62.md` 2026-04-29):
- (a) FileBackedLogger fds not open on fresh shim post-restart (lazy-fd dependency on routed events)
- (b) `get_engineer_status` advisoryTags missing `adapterVersion` projection (only `llmModel: "unknown"` surfaces)
- (c) Version-source-of-truth divergence — 3 different version strings for same artifact:
  - `package.json: 0.1.4` (npm package version)
  - `.claude-plugin/plugin.json: 1.0.0` (claude-plugin manifest)
  - `clientMetadata.proxyVersion: 1.2.0` (handshake projection; pre-mission-64 hardcoded)
  - `clientMetadata.sdkVersion: @apnex/network-adapter@2.1.0` (also pre-mission-64 hardcoded)
- (d) Stale `pid` in projection across restarts (Agent record retains old pid post-shim-restart)

**Closure path per Q6=B (Phase 4 Design ratifies audit-scope):**

**Audit-scope decision (Q6=B explicit Phase 4 Design surface):**
- **(α) Narrow** — fix only the 4 known symptoms; fast-close; mid-scope iteration. Risk: leaves sister-divergences in Hub projection class unsurfaced; #40 sister symptoms may surface in Phase 3 mission as "we missed X".
- **(β) Comprehensive** — systematic audit of Hub projection class (every field that flows from agent record → wire envelope → operator-visible state); fix all surfaced divergences. Higher scope; substrate-cleanup-wave class signature.

**Architect-lean closure path:** **(β) Comprehensive but bounded by methodology** — systematic audit DOES happen (Hub projection-fidelity is foundational substrate); but bounded by:
- Audit scope = Hub `get_agents` MCP tool projection + `agent_state_changed` SSE event + `list_available_peers` projection + handshake response. NOT every Hub MCP tool surface; just the Agent-state-bearing projections.
- Audit produces (i) divergence inventory + (ii) fix plan per divergence + (iii) test surface per fix
- Phase 4 Design ratifies the audit-scope-boundary list above; W1+W2 atomic ships fixes with test surface

**Scope (post-ratify):**
- Hub schema audit pass: enumerate fields in scoped projections; cross-reference Agent record schema; flag divergences (target: 4 known + any sister-divergences surfaced)
- Version-source-of-truth consolidation: pick canonical source (architect-lean: `package.json` for npm package version + `clientMetadata` projection derived from it via build-time stamp); deprecate hardcoded `proxyVersion`/`sdkVersion` from `clientMetadata`; runtime `clientMetadata.proxyVersion` reads from package.json or build-stamp
- FileBackedLogger fd lifecycle: eager-open on shim startup (no lazy-fd dependency on routed events); idempotent re-open if fds get closed externally
- advisoryTags `adapterVersion` projection: derive from `clientMetadata.proxyVersion` (post-consolidation); render in `get_engineer_status` output
- `pid` projection: refresh on Agent register / handshake (per shim-instance lifecycle); never reuse old pid after restart
- Test surface: schema audit baseline test (run audit pass, assert zero divergences in scoped projections); restart-cycle test (verify pid + advisoryTags + clientMetadata refresh)

**Coordinated upgrade scope (per anti-goal #8):**
- All Hub projection consumers see new canonical version-source values atomically post-W1+W2 ship: architect adapter + engineer adapter (both consume `get_agents` + `agent_state_changed` SSE + `list_available_peers` from same `@apnex/network-adapter` SDK) + Director CLI script (consumes Hub HTTP read endpoint introduced in §2.3)
- No version-string-parsing compat layer; consumers receive new values + use directly
- `clientMetadata.proxyVersion` going from pre-M64 hardcoded `"1.2.0"` to package.json-derived `"0.1.4"` (or whatever current package.json version) is a SEMANTIC change consumers see post-ship; this IS the intended fix
- No interim state where Hub emits new values but consumers parse old format

**Risk:** R1 in §5 risk register.

#### §2.1.4 Calibration #41 closure — kind=note bilateral-blind defect (tele-2 + tele-6 mechanism; Q6 NOT A)

**Surface:** `kind=note` payload-rendering at Hub expects flat-body shape; structured payload silently degrades to `(empty note body)` with no caller-side feedback (bilateral-blind class).

**Closure path:** Architect-lean **option (b) — schema-validate at `create_message` entry-point** so caller gets immediate feedback on render-incompatible payload (per `reference_idea_219_220_post_mission_62.md` 2026-04-29 architect-lean ratification + mission-64 PR #130 §2c.X anti-pattern fold).

**Architectural commitments:**
- Hub-side `create_message` MCP tool entry-point applies schema-validation per `kind` value
- For `kind=note`: validate payload conforms to flat-body schema (whatever the canonical shape is — to be specified by Hub team in `hub/src/policy/note-schema.ts` or similar)
- On validation failure: return error response to caller (architect-side `create_message` returns nack instead of clean messageId)
- **Reject-mode default ratified by Director Phase 4 review 2026-04-29:** no warn-then-reject grace period; bilateral-blind class is structural-defect class; reject-mode is canonical
- **Coordinated upgrade scope (per anti-goal #8 + Director ratification 2026-04-29):**
  - ALL `kind=note` callers upgraded to canonical flat-body schema in same W1+W2 atomic PR
  - Caller pool to enumerate (engineer round-1 audit Q8): primary caller is architect-side LLM via `create_message` (per multi-agent-pr-workflow.md §2c.X anti-pattern fold mission-64 PR #130); engineer-side does not call `create_message` (authority-boundary role-filter); Director-side does not call directly
  - If any architect-side `kind=note` call sites use non-flat payload, they ship corrected payload alongside Hub-validate commit in W1+W2
  - No interim state where Hub has reject-mode but architect-side still emits old payload structures

**Scope:**
- Hub-side: `create_message` entry-point dispatches to per-kind schema-validate function; reject-mode for `kind=note` non-flat payload
- Architect-side: any `kind=note` call sites in agentic-network-lily/ + agentic-network-greg/ + canonical-tree adapter shipped in same PR with corrected payload structure (engineer round-1 audit Q8 enumerates caller pool)
- Test surface: deliberately-malformed kind=note payload integration test; verify caller receives error nack with diagnostic message
- **Bilateral PR review surface:** engineer round-1 audit Q8 confirms ALL `kind=note` callers enumerated + upgraded; coordinated-upgrade discipline structurally enforced via single-PR W1+W2 atomic merge

**Risk:** R4 in §5 risk register **RESOLVED** by Director ratification 2026-04-29 (coordinated upgrade discipline closes the class).

### §2.2 Observability formalization

#### §2.2.1 Event taxonomy doc (NEW; canonical per Q6=D)

**Path:** `docs/specs/shim-observability-events.md` (NEW)

**Content per Q6=D Phase 4 Design ratification:**
- **Canonical event names** — list every emitted event with stable name; namespace convention `shim.<domain>.<event>` (e.g., `shim.handshake.parse_failure`, `shim.dispatcher.call_tool`, `shim.cognitive.bypass`)
- **Event field schema per event** — required fields + optional fields + redaction rules per field (e.g., `tokens` redacted; `timestamp` always present; `agentId` always present; `eventName` always present)
- **Stability commitments** — event names + field schemas are versioned; namespace `v1` shipped this mission; backward-incompat changes bump namespace
- **Deprecation policy** — deprecated events mark `_deprecated: true` field for one minor-version cycle; consumers warned via deprecation event-name suffix
- **Adding new events** — process: file PR with new event spec in this doc; bilateral architect+engineer review; Hub OR adapter team implements; one-cycle dogfood before consumer-broadcast

**Anti-goal locked:** NO LLM-side autonomous shim-config (config knobs architect-authored; LLMs read-only at observability layer).

#### §2.2.2 Log-level filter env var

**Path:** `OIS_SHIM_LOG_LEVEL` env var per `reference_shim_observability.md` lineage (`OIS_SHIM_LOG_FILE` + `OIS_SHIM_EVENTS_FILE` + `OIS_SHIM_LOG_ROTATE_BYTES` already shipped Phase 1).

**Levels:** `DEBUG` < `INFO` < `WARN` < `ERROR`. Default `INFO`. Filter applied at FileBackedLogger emit boundary; below-level events suppressed.

**Scope:**
- Adapter-side: FileBackedLogger reads `OIS_SHIM_LOG_LEVEL` at init; all event-emit calls check level before write; no-op below threshold
- Test surface: env-var-controlled test exercising each level + verifying suppression boundary

#### §2.2.3 ADR-031 SCAFFOLD

**ADR-031 (candidate; ratify at W4 closing wave):** *"Shim observability is a formal versioned event taxonomy with canonical naming + stability commitments + deprecation policy; consumers (vertex-cloudrun parity in Phase 3 mission; future operator surfaces) bind to the v1 namespace."*

**Architectural commitments:**
- Event taxonomy lives at `docs/specs/shim-observability-events.md` (canonical doc; NEW per §2.2.1)
- Namespace convention `shim.<domain>.<event>` ratified
- v1 namespace shipped this mission; future namespaces (v2+) require new ADR or amendment
- Log-level filter as standard observability hygiene
- Redaction discipline preserved from Phase 1 (token + secret redaction at FileBackedLogger emit boundary)
- Backward-incompat event-name changes require bumped namespace; in-namespace field additions are permissive (consumers ignore unknown fields)
- Deprecation policy: `_deprecated: true` field flag for one minor cycle; deprecation announced via event-name suffix

**Forward-consequences:**
- **Coordinated upgrade pattern is the substrate-introduction class default for controlled-substrate deployments** (per anti-goal #8 + Director ratification 2026-04-29). Future substrate-introduction missions inherit by default — when all consumers are within the controlled deployment substrate (no external/uncontrolled consumers), prefer ship-right-solution + atomic-upgrade-all-consumers over warn-then-reject grace-period patterns
- Phase 3 mission (vertex-cloudrun engineer-side observability parity) adopts v1 namespace + marker-protocol contracts unchanged at the consumer-binding boundary (forward-compat preserved at Hub-side; consumers bind to stable v1)
- Future Hub MCP HTTP read endpoints (CLI script consumer + future operator surfaces) bind to the same projection canonical values landed by #40 closure

#### §2.2.4 Tests for redaction + rotation

**Scope:**
- Redaction test: emit event with token + secret fields; verify FileBackedLogger output has redacted markers (`***REDACTED***` or similar)
- Rotation test: emit events past `OIS_SHIM_LOG_ROTATE_BYTES` threshold; verify naive timestamp-suffix rotation produces correctly-named rotated files
- Both tests run in adapter package CI; engineer-led code

#### §2.2.5 Pass 10 §F inclusion

**Path:** `docs/methodology/multi-agent-pr-workflow.md` Pass 10 protocol gets new §F:

> **§F Shim observability dirty-state regeneration** — when adapter-source PRs touch `packages/network-adapter/src/observability/**` OR `adapters/claude-plugin/src/shim.ts` event-emit paths, run `npm test --workspace=packages/network-adapter -- observability/` to regenerate redaction/rotation test fixtures + commit fixture diffs alongside PR.

Architect-led doc commit; mirror Pass 10 §A/§C/§E precedent.

### §2.3 CLI script — `scripts/local/get-agents.sh`

#### §2.3.1 Reference pattern

Implementation pattern per **prism.sh reference at `/home/apnex/taceng/table/prism.sh`** (saved as `reference_prism_table_pattern.md`). Reusable patterns:
- **`buildTable()` function** (heredoc'd jq filter; auto-derives headers from first object's keys; column -t pipe; cyan-color header)
- **Color constants** (CYAN/GREEN/YELLOW/RED/NC ANSI)
- **Template-jq pattern** (entity-specific `tpl/<entity>.jq` for custom column projection)
- **`--json` flag** (bypass table; raw `jq .` output)
- **Error-handling** (check `.error` in API response; exit 1 with red message)

#### §2.3.2 Script architecture

**Path:** `scripts/local/get-agents.sh` (executable bash; `chmod +x`)

**Companion files:**
- `scripts/local/tpl/agents.jq` — verbose Agent projection template (clientMetadata + advisoryTags + labels + lastSeenAt + status columns)
- `scripts/local/tpl/agents-lean.jq` — lean projection (id + role + status; for terse view)
- `~/.config/apnex-agents/<role>.env` (NOT committed; per-operator credential file with `HUB_TOKEN=...`)

**API target:** `http://localhost:8080/api/agents` (Hub MCP read endpoint; final URL TBD at engineer round-1 audit since Hub MCP HTTP surface naming is engineer-domain)

**Architectural commitments:**
- Auth via env file source: `source "${HOME}/.config/apnex-agents/${ROLE}.env"` → `HUB_TOKEN` available; `Authorization: Bearer ${HUB_TOKEN}` curl header
- Multi-role: `--role architect|engineer|director` flag (default `director` since Director is primary CLI consumer)
- Output: defaults to `buildTable()` rendering with `tpl/agents.jq` template; `--json` flag bypasses to raw `jq .`
- `--lean` flag uses `tpl/agents-lean.jq` for terse output
- `--host <url>` flag overrides default `http://localhost:8080` (e.g., `--host https://prod-hub.apnex.io`)
- Exit codes: 0 success / 1 API error / 2 auth missing / 3 invalid args
- Error rendering: red `[ ERROR ]` prefix per prism.sh pattern

**Anti-goal locked:** NO new MCP tool-surface verbs (CLI script consumes existing Hub MCP read API; doesn't introduce new verbs).

#### §2.3.3 Bilateral co-execution

Per Q5=C bilateral co-execution + Director RACI note:
- **Architect commits:** script skeleton (argparse + auth env-source + `--json`/`--lean`/`--role`/`--host` flags + error-handling); `tpl/agents.jq` + `tpl/agents-lean.jq` templates; usage doc inline
- **Engineer commits:** `buildTable()` function adaptation per prism.sh; curl invocation + Hub MCP HTTP endpoint binding; integration test exercising script against local Hub
- Bilateral PR review: both sides audit each other's commits

### §2.4 Wave plan

| Wave | Scope | PR | Sizing |
|---|---|---|---|
| **W0** | Survey + Design v1.0 + Preflight (GREEN) + ADR-031 SCAFFOLD bundle | 1 PR; doc-only | ~30min architect-time + Director Phase 4 review + bilateral round-1 audit thread |
| **W1+W2 atomic** | (1) ADR-031 SCAFFOLD + event taxonomy doc + Pass 10 §F (architect docs) + (2) Hub-side projection audit + version-source-of-truth consolidation (engineer code; closes #40) + (3) engineer get_agents tool surface (engineer code; closes #21) + (4) adapter logger event-taxonomy alignment + log-level filter + redaction/rotation tests (engineer code) + (5) Hub schema-validate at create_message (engineer code; closes #41) + (6) thread_message marker-protocol (engineer code; closes #26) + (7) CLI script + tpl/agents.jq + auth env file template (bilateral co-author) | 1 PR; substrate-introduction class | ~2.5-3 eng-days bilateral (substrate fixes + formalization + CLI; multiple ordered commits per R8 mitigation) |
| **W3 dogfood gate** | Substrate-self-dogfood verification: schema audit baseline test passes; #21 engineer get_agents callable; #26 marker rendering at adapter-side; #41 caller-side feedback on malformed payload; CLI script renders Director-side cleanly | 1 architect-bilateral thread; observation-only | ~30-45min architect-time + ~30min greg dogfood |
| **W4 closing** | Closing audit + ADR-031 RATIFIED + Phase 10 retrospective + W4-origin calibrations filed | 1 PR; doc-only + ADR ratification | ~1 engineer-hour architect-time |

**Aggregate sizing:** ~3-4 engineer-days bilateral (L mid-scope baseline holds; no upper-bound flag from Q4 since D excluded). Mission-class L matches mission-64 sizing; W1+W2 atomic execution is substantial but bounded.

**Substrate-self-dogfood discipline:** W3 dogfood gate exercises all 4 substrate-fix surfaces + observability formalization + CLI script. Calibration #34 (W3-collapse-into-W1+W2-fix retry pattern) likely activates if W1+W2 substrate fixes surface defects via dogfood.

### §2.5 Calibration ledger discipline (M65 substrate landing operationally)

Per CLAUDE.md `Calibration ledger discipline` (mission-65 ADR-030 substrate): all M6 calibrations file directly into `docs/calibrations.yaml` rather than as prose-in-retrospective + retroactive migration. Forward-pointer: M6-origin calibrations surface in W4 closing audit (filed in same PR cycle).

**Calibrations addressed (closure events ship with W1+W2):**
- **#21** Engineer Agent-record read-surface gap → status: open → closed-structurally; closure_pr (TBD W1+W2 PR #)
- **#26** Silent thread_message body truncation marker missing → status: open → closed-structurally; closure_pr (TBD)
- **#40** Composite shim observability + projection-fidelity gaps → status: open → closed-structurally; closure_pr (TBD)
- **#41** kind=note bilateral-blind defect → status: open → closed-structurally; closure_pr (TBD)

**Calibrations LIKELY-NEW at W4 closing audit (anticipated; TBD-W4):**
- **Methodology-class #48 (planned filing):** "Coordinated upgrade discipline — controlled-substrate substrate-introduction class default; partial-upgrade is anti-goal; backward-compat is W1+W2 upgrade-discipline not Design-time commitment" — surfaced via Director Phase 4 review 2026-04-29; closure_path = methodology-doc fold to `docs/methodology/mission-lifecycle.md` OR new methodology subsection on substrate-introduction-class upgrade discipline (TBD W4 closing fold); tele_alignment [tele-3, tele-7]; this is the load-bearing M6-origin methodology nugget worth durable codification beyond just M6 ADR
- Methodology-class: Q5-RACI-redundancy nugget (idea-survey.md Q5-class questions defer to mission-lifecycle.md RACI rather than re-asking; surfaced via Director Q5 note)
- Methodology/substrate-class: any partial-upgrade misses surfaced during W1+W2 (#41 caller-pool incompletely enumerated; #40 audit-scope-bounded missed sister-divergences); these would be substrate-class
- Methodology-class: review-loop-as-calibration-surface pattern application (substantive PR review surfaces typically yield 1-3 review-loop calibrations)

---

## §3 Anti-goals (locked from Survey §14)

1. **NO scope creep into vertex-cloudrun engineer-side parity** (Q4 D explicitly excluded; Phase 3 mission scope; deployment-substrate symmetry deferred)
2. **NO new tool-surface MCP verbs without idea-121 ratification** (CLI script consumes existing Hub `get_agents` MCP read API; no new MCP verbs introduced)
3. **NO replacement of irreducible methodology prose** (event taxonomy doc + Pass 10 §F inclusion are NEW prose; not replacement of existing)
4. **NO LLM-side autonomous shim-config** (config knobs architect-authored; LLMs read-only at observability layer)
5. **NO fidelity-first framing in Phase 4 Design** (Q1=B,C primaries; tele-7 + tele-2 front-and-center; tele-3 fixes ride-along as substrate-of-the-mission)
6. **NO Phase 4 Design treatment of #41 schema-validate backward-compat** (Q6 NOT A; runtime/implementation discretion during W1+W2; engineer-domain)
7. **NO retroactive earlier-mission migration** of unaddressed open calibrations (#10 #15 #23 #30 #32 #44 #47 stay open; M6 closes ONLY #21 #26 #40 #41 plus M6-origin calibrations surfaced)
8. **NO partial-upgrade scope across consumers** — W1+W2 atomic ships ALL consumer upgrades alongside Hub-side substrate changes. Backward-compat is upgrade-discipline at W1+W2, not Design-time architectural commitment. (Per Director ratification 2026-04-29: controlled-substrate substrate-introduction class default — when all consumers are within the controlled deployment substrate, prefer ship-right-solution + atomic-upgrade-all-consumers over warn-then-reject grace-period patterns. Single-PR W1+W2 atomic structurally enforces this — Hub-side change + ALL adapter-side consumer changes go to main together; no interim state where Hub has new contract but adapters don't.)

---

## §4 Risks + open questions

### §4.1 Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| **R1 (Q6=B)** | Hub-side projection-fidelity audit-scope decision (narrow vs comprehensive) — narrow path leaves sister-divergences unsurfaced; comprehensive path expands W1+W2 scope mid-mission | Medium | Architect-lean **(β) Comprehensive but bounded by methodology** — audit-scope-boundary list ratified at Phase 4 Design (Hub `get_agents` + `agent_state_changed` SSE + `list_available_peers` + handshake response); audit produces inventory + fix plan + test surface; in-arc-sizing-recalibration discipline (calibration #30) applies if audit surfaces > expected scope |
| **R2 (Q6=C)** | thread_message marker-protocol design (token-in-body vs channel-attribute vs out-of-band) — choice cascades to render-template-registry update + envelope-builder + consumer compat | Low-Medium | Architect-lean **(b) `<channel>` attribute `truncated="true" fullBytes="<n>"`** — out-of-band metadata consistent with envelope-as-projection-of-state principle; render-template-registry update is well-scoped; preserves body content; Phase 4 Design ratifies (b) pending bilateral concur |
| **R3 (Q6=D)** | Shim observability event-taxonomy boundary — namespace stability commitments + backward-compat semantics for existing event consumers (vertex-cloudrun deferred but vertex-cloudrun event consumers exist) | Medium | ADR-031 commits to v1 namespace + permissive in-namespace evolution (consumers ignore unknown fields) + namespace bump for backward-incompat; deprecation policy (_deprecated: true field flag for one minor cycle) preserves vertex-cloudrun engineer-side parity Phase 3 mission consumer surface |
| **R4** ~~Q6 NOT A — backward-compat~~ | ~~#41 schema-validate at create_message backward-compat~~ | **RESOLVED** | **Resolved 2026-04-29 by Director Phase 4 review:** coordinated upgrade discipline (anti-goal #8) closes the class structurally — ALL `kind=note` callers upgraded to canonical schema in same W1+W2 atomic; no warn-mode grace period; reject-mode default canonical. Engineer round-1 audit Q8 verifies caller-pool enumeration. |
| **R5** | W1+W2 atomic execution scope blowup — 7-commit substrate-introduction with multiple substrate seams may surface fix-forward chain similar to mission-64 W1+W2-fix-N pattern | Medium | Calibration #34 W3-dogfood-gate-collapse-into-W1+W2-fix retry pattern applies; bilateral PR review surface tighter at substrate-introduction class signature; in-arc-sizing-recalibration discipline (calibration #30) applies if W1+W2 reveals > expected scope mid-execution |
| **R6** | CLI script Hub MCP HTTP endpoint naming TBD at Phase 4 (engineer-domain) | Low | Engineer round-1 audit ratifies endpoint naming; default placeholder `/api/agents` with `--host` override flag; if Hub MCP doesn't yet have HTTP read surface, W1+W2 includes adding it (Hub team scope) |

### §4.2 Open questions for engineer round-1 audit

(Round-1 questions for greg; opens AFTER Director Phase 4 review per mission-65 cadence precedent)

1. **#21 closure scope** — extend role-filter on `get_agents` MCP tool to engineer role; does this introduce any authority-boundary risk that needs explicit Phase 4 Design treatment? Read-only semantics preserved; symmetric with architect.
2. **#26 marker-protocol architect-lean (b) `<channel>` attribute** — concur on (b) over (a) token-in-body or (c) sidecar event? render-template-registry update scope manageable?
3. **#40 audit-scope-boundary list** — Hub `get_agents` + `agent_state_changed` SSE + `list_available_peers` + handshake response. Anything missing from your engineer-side perspective? Anything in this list that should be DEFERRED to Phase 3 mission?
4. **#41 architect-lean reject-mode default** — concur on reject (no grace period) vs warn-then-reject vs other? Any callers materially affected backward-compat?
5. **CLI script Hub MCP HTTP endpoint** — what's the canonical Hub MCP read surface name? `/api/agents`? `/api/v1/agents`? Does Hub MCP currently expose HTTP (vs MCP-only)? If MCP-only, scope adds Hub HTTP read endpoint to W1+W2 (your call on whether that's in this mission or Phase 3 deferred).
6. **W1+W2 commit sequencing** — proposed order:
   - (1) docs (ADR-031 + event taxonomy + Pass 10 §F) — architect
   - (2) Hub projection audit + version-source-of-truth — engineer
   - (3) engineer get_agents tool surface — engineer
   - (4) adapter logger formalization (event-taxonomy + log-level + tests) — engineer
   - (5) Hub schema-validate at create_message — engineer
   - (6) thread_message marker-protocol — engineer
   - (7) CLI script + templates — bilateral co-author
   Sensible? Reorder if dependencies favor different sequence.
7. **Sizing baseline** — L mid-scope (~3-4 eng-days) holds, or surface tension during round-1 audit?
8. **Consumer-pool enumeration (per anti-goal #8 coordinated upgrade discipline)** — have we enumerated ALL `kind=note` callers (architect-side LLM call sites in lily/greg/canonical-tree adapter), ALL `thread_message` render-template instances (both adapters via single SDK package), ALL Hub projection consumers (architect adapter + engineer adapter + Director CLI script — via #40 audit-scoped surfaces)? Anything we might miss in the controlled-substrate scope? **Load-bearing audit ask under coordinated-upgrade discipline — partial-upgrade is anti-goal #8.**

---

## §5 Mission-class declaration + ADR-031 SCAFFOLD

### §5.1 Mission-class

**Structural-inflection + substrate-introduction sub-class (ADR-031 event taxonomy) + tooling-introduction sub-class (CLI script).** L mid-scope baseline (~3-4 eng-days bilateral).

Multi-class blend signature similar to mission-65 (which was structural-inflection + tooling-introduction sub-class for Skill scaffolding) but more pronounced — M6 ships THREE sub-class artifacts:
- ADR-031 (substrate-introduction sub-class)
- Event taxonomy doc (sub-class)
- CLI script (tooling-introduction sub-class)

**Architectural-precedents:**
- mission-64 (M-Adapter-Streamline; structural-inflection + substrate-introduction sub-class; tight-cycle merge cadence + Director Phase 4 review pre-engineer-audit pattern)
- mission-63 (M-Wire-Entity-Convergence; structural-inflection M-class precedent + ADR-RATIFIED protocol)
- mission-65 (M-Calibration-Codification; structural-inflection + tooling-introduction sub-class precedent for the Skill scaffolding shape; M6 inherits the mechanized calibration ledger from outset)

### §5.2 ADR-031 SCAFFOLD

See §2.2.3 for architectural commitments + §6 for sealed companions. ADR-031 SCAFFOLD ships in W0 bundle PR; RATIFIED at W4 closing wave per mission-63 ADR-028 + mission-64 ADR-029 + mission-65 ADR-030 precedent.

### §5.3 Substrate-self-dogfood discipline

W3 dogfood-gate scope: **observation-only** (Survey §14 ratified; substrate-introduction class signature). Architect-bilateral with greg. Concrete verification:

1. **Schema-fidelity** — Hub schema audit baseline test passes (zero divergences in scoped projections post-fix); restart-cycle test verifies pid + advisoryTags + clientMetadata refresh
2. **#21 round-trip** — engineer `get_agents` tool callable from engineer adapter; returns Agent records with same shape architect sees
3. **#26 render-fidelity** — deliberately-truncated thread_message renders with `[…<N> bytes truncated]` marker per ratified protocol
4. **#41 caller-side feedback** — deliberately-malformed kind=note payload surfaces error nack with diagnostic message at architect-side caller
5. **CLI script render** — `scripts/local/get-agents.sh` runs from Director-side terminal; renders verbose Agent projection table; `--json` flag bypasses cleanly; auth env file source works; `--host` override functional
6. **Observability formalization** — log-level filter env var honored; redaction/rotation tests pass; event-taxonomy doc accurately reflects emitted events
7. **Consumer-upgrade verification (per anti-goal #8 coordinated upgrade discipline)** — verify ALL consumers see new contracts post-W1+W2: architect-side adapter renders new `<channel>` marker on truncated thread_message + handles new `clientMetadata.proxyVersion` derived value + emits canonical-schema kind=note payloads; engineer-side adapter mirrors; Director CLI script consumes new Hub HTTP read endpoint values + renders correctly. Spot-check each consumer; confirm no consumer using old contracts.

**Hold-on-failure:** any verification gate failure halts W3; investigate via direct event-log inspection + adapter log; fix-forward; re-run dogfood. **W3 dogfood-gate collapse-into-W1+W2-fix retry pattern** (Calibration #34) applies.

---

## §6 Engineer audit ask (round-1 questions)

(Per `idea-survey.md` autonomous-arc-driving + bilateral architect+engineer round-1 audit pattern; opens AFTER Director Phase 4 review ratifies v0.1.)

Opens via thread to greg (unicast; semanticIntent: seek_rigorous_critique; correlationId: mission-66-candidate; maxRounds: 10) with the 7 open questions in §4.2 + a request for any structural concerns architect missed.

If GREEN-with-folds, engineer ratifies on round-N thread close → Design v1.0 → Manifest+Preflight bundle + ADR-031 SCAFFOLD ships in W0 PR → Phase 7 Director Release-gate.

---

## §7 Cross-references

- **Source Idea:** idea-220 Phase 2 (Shim Observability — Structured Telemetry Sinks; composite scope per `reference_idea_219_220_post_mission_62.md`)
- **Survey:** `docs/surveys/m-shim-observability-phase-2-survey.md` (Round 1 + Round 2 ratified 2026-04-29; composite intent envelope §14)
- **Methodology:**
  - `docs/methodology/idea-survey.md` v1.0 (Survey methodology; canonical input)
  - `docs/methodology/multi-agent-pr-workflow.md` v1.0 (PR workflow; W1+W2 PR ships Pass 10 §F update)
  - `docs/methodology/mission-lifecycle.md` (Phase 4 Design + Phase 9+10 retrospective + standing RACI for Q5)
  - `docs/methodology/mission-preflight.md` (Preflight artifact)
- **Architectural-precedents:**
  - mission-65 (M-Calibration-Codification; ADR-030 RATIFIED + ledger-as-VIEW substrate landing; M6 inherits mechanized ledger from outset)
  - mission-64 (M-Adapter-Streamline; ADR-029 RATIFIED + tight-cycle merge cadence + 5-cycle iteration W1+W2 pattern reference)
  - mission-63 (M-Wire-Entity-Convergence; ADR-028 RATIFIED + canonical envelope substrate; #26 thread_message marker-protocol extends this lineage)
  - mission-62 (M-Agent-Entity-Revisit; #21 engineer get_agents read-surface gap origin + Phase 1 shim observability tactical landing)
- **ADRs (sealed companions):**
  - ADR-031 (this mission's ADR; ratify at W4 close)
  - ADR-028 (canonical envelope; mission-63 RATIFIED; #26 marker-protocol extends)
  - ADR-030 (calibration ledger; mission-65 RATIFIED; M6 inherits mechanized surface)
- **Foundational dependencies:**
  - `docs/methodology/idea-survey.md` v1.0 (Survey methodology mandates this Survey + composite intent envelope as Design input)
  - `reference_shim_observability.md` memory (Phase 1 file paths + env vars; M6 extends with `OIS_SHIM_LOG_LEVEL`)
  - `reference_prism_table_pattern.md` memory (canonical buildTable + jq pattern for CLI script implementation)
- **Memory referenced:**
  - `reference_idea_219_220_post_mission_62.md` (mission sequencing post-mission-65; idea-220 Phase 2 = Mission #6)
  - `reference_shim_observability.md` (Phase 1 paths + env vars)
  - `reference_prism_table_pattern.md` (CLI script implementation pattern)
- **Calibrations addressed (per §2.1 + §2.5):**
  - **#21** (mission-62-W4) — Engineer Agent-record read-surface gap; closed-structurally by W1+W2 atomic
  - **#26** (mission-63-W4) — Silent thread_message body truncation marker missing; closed-structurally per Q6=C ratification
  - **#40** (mission-64-W3) — Composite shim observability + projection-fidelity gaps; closed-structurally per Q6=B audit-scope ratification
  - **#41** (mission-64-W4-followon) — kind=note bilateral-blind defect; closed-structurally via schema-validate at create_message entry-point per architect-lean closure path b

---

## §8 Status

- **v0.1** architect-draft (pre-Director-review per mission-65 cadence precedent: Director Phase 4 review pre-engineer-audit)
- **v0.1+** architect-revision (this commit; Director Phase 4 review 2026-04-29 feedback applied — coordinated upgrade discipline ratified):
  1. §3 Anti-goal #8 NEW (coordinated upgrade discipline; controlled-substrate substrate-introduction class default)
  2. §2.1.2 #26 marker-protocol — coordinated upgrade scope line added (both adapters upgraded in same atomic; vertex-cloudrun adopts at Phase 3 with stable v1)
  3. §2.1.3 #40 Hub projection — coordinated upgrade scope line added (all consumers see new canonical version-source values atomically)
  4. §2.1.4 #41 schema-validate — reject-mode default ratified by Director; coordinated upgrade scope line added (caller-pool enumerated; no warn-mode grace period); R4 RESOLVED
  5. §2.2.3 ADR-031 forward-consequences extended (coordinated upgrade pattern as substrate-introduction class default; Phase 3 mission inherits)
  6. §4.1 R4 RESOLVED entry replaces R4 risk register
  7. §4.2 Engineer audit Q8 added (consumer-pool enumeration ask; load-bearing under coordinated-upgrade discipline)
  8. §5.3 W3 dogfood Gate-7 added (consumer-upgrade verification)
  9. §2.5 Calibration ledger discipline — #48 NEW planned filing for coordinated upgrade discipline methodology nugget at W4 closing audit
- **v0.2** architect-revision (post-engineer round-1 audit folds; structural concerns absorbed)
- **v1.0** BILATERAL RATIFIED (engineer + architect ratify on round-1 audit thread close; Manifest+Preflight bundle PR follows)
- **W0 bundle PR** opens (Survey + Design v1.0 + ADR-031 SCAFFOLD + Preflight artifact)

---

*Design v0.1 architect-draft 2026-04-29 lily / architect; awaiting Director Phase 4 review (4-item-class precedent per mission-65 cadence). Composite intent envelope §14 of Survey ratified bilaterally; this Design v0.1 is the architectural translation. Tele primaries tele-7 + tele-2 front-and-center per Q1=B,C ratified weight (anti-fidelity-first-framing anti-goal #5 held).*
