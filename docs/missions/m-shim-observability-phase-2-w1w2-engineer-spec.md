# M-Shim-Observability-Phase-2 — W1+W2 engineer-side SPEC (architect-shipped per option-3 cadence)

**Mission:** mission-66 (M-Shim-Observability-Phase-2 = idea-220 Phase 2)
**Status:** Architect-side ratified-with-Director option-3 cadence (architect ships SPEC; engineer implements against it). Director-ratified 2026-04-29 ~07:50Z UTC ("proceed with mission. approved").
**Date authored:** 2026-04-29T~07:55Z UTC
**Author:** lily / architect
**Engineer-target:** greg

---

## §1 Cadence + thread-comms discipline (per Calibration #55)

**Engineer-side autonomous-stop ONLY when thread-engaged with architect on a surfaced action** (Director directive 2026-04-29 ~07:50Z; calibration #55 NEW filed at `8d017ec`).

Operational shape:
- After each commit-N push, engineer pings active coord-thread (thread-425) with: *"commit N pushed at `<sha>`; commit N+1 starting"* (1-line heartbeat sufficient)
- Cadence-decision-points (e.g., context-budget assessment): engineer pings thread with explicit cadence-question; awaits architect-side response
- Silent between-commit pauses are anti-pattern; either ping the thread OR keep moving

This SPEC supports the option-3 cadence: engineer pings on commit-pushes; architect tracks via thread + branch state; mission progresses without architect-cross-domain delegation.

---

## §2 Per-commit specifications (3, 4, 5, 6, 7b)

Each commit's SPEC includes:
- **Hub source-locator** — files/lines to touch (architect-domain reference; engineer implements)
- **Architectural commitments** — what the change must achieve
- **Test surface contract** — test cases that MUST pass
- **Coordinated-upgrade anchor** — anti-goal #8 commit-message line
- **Acceptance criteria** — verification criteria for self + architect-review

### §2.1 Commit 3/N — engineer-adapter dispatcher inclusion + e2e for `get_agents` (closes #21)

**Hub source-locator (already verified `[Any]`-callable):** `hub/src/policy/session-policy.ts:684` declares `get_agents` as `[Any]` role-callable. No Hub-side change expected unless implementation surfaces a quiet role-gate (Design §2.1.1 conditional Hub-side change).

**Engineer-adapter source-locator (where you ship):**
- `packages/network-adapter/src/dispatcher/` (or wherever engineer's adapter dispatcher catalog lives)
- `adapters/claude-plugin/src/shim.ts` (cognitive-layer authority-check; if needed)
- `adapters/opencode-plugin/src/` mirror if engineer-side parity exists
- Test: `packages/network-adapter/test/integration/get-agents-engineer.test.ts` (engineer-pool exercising `get_agents`)

**Architectural commitments:**
- Engineer adapter dispatcher catalog includes `get_agents` MCP tool
- Cognitive-layer authority-check passes for engineer-pool calling `get_agents`
- Engineer-pool integration test exercises `get_agents` end-to-end (handshake → tools/list reveals get_agents → tools/call get_agents → response shape matches architect-side projection)
- No state migration (read-only)
- Hub-side change: NONE expected (per source-check)

**Test surface contract:**
- Test 1: engineer adapter handshake → `tools/list` includes `get_agents` ✓
- Test 2: engineer adapter `tools/call get_agents` → 200-class response with `result.content[0].text` containing JSON-stringified Agent projection
- Test 3: engineer-side projection shape matches architect-side projection shape (symmetric `[Any]`-callable semantic)

**Coordinated-upgrade anchor (commit-message line):**
> `Coordinated-upgrade anchor (anti-goal #8): symmetric extension of existing tool-surface authority pattern. No compat concern (purely additive for engineer-pool); architect-side unchanged.`

**Acceptance criteria:**
- 3 tests above pass ✓
- Engineer-side `get_agents` returns Agent records with same shape architect-side gets
- No new MCP verbs introduced (anti-goal #2 preserved)
- Sizing estimate: ~0.25 eng-day per your thread-424 round-2 plan

**Heartbeat ping after push:** *"commit 3 pushed at `<sha>`; commit 4 starting"*.

---

### §2.2 Commit 4/N — adapter logger formalization (event-taxonomy v1 alignment + `OIS_SHIM_LOG_LEVEL` + redaction/rotation tests)

**Architect docs reference:**
- `docs/specs/shim-observability-events.md` (commit 1; canonical event taxonomy v1; 7 events specified)
- `docs/methodology/multi-agent-pr-workflow.md` Pass 10 §F (commit 1; fixture regeneration discipline)
- ADR-031 SCAFFOLD §1-§5 (architectural commitments)

**Engineer source-locator:**
- `packages/network-adapter/src/observability/file-backed-logger.ts` (or wherever Phase 1 FileBackedLogger lives)
- `packages/network-adapter/src/observability/event-taxonomy.ts` (NEW; codifies v1 namespace + per-event field validation)
- `packages/network-adapter/src/observability/log-level-filter.ts` (NEW; OIS_SHIM_LOG_LEVEL env var honoring)
- `adapters/claude-plugin/src/shim.ts` event-emit sites (align to canonical event names per spec)
- Tests at `packages/network-adapter/test/observability/`

**Architectural commitments:**
- Adapter event-emit paths align with v1 taxonomy per `docs/specs/shim-observability-events.md`:
  - Phase 1 ad-hoc `handshake_parse_failure` → canonical `shim.handshake.parse_failure`
  - Phase 1 ad-hoc `dispatcher_call_tool` → canonical `shim.dispatcher.call_tool` + `shim.dispatcher.call_tool_result` pair
  - Phase 1 ad-hoc `cognitive_bypass` → canonical `shim.cognitive.bypass`
  - NEW `shim.kernel.handshake_started` (per spec §4.5)
  - NEW `shim.lifecycle.shim_started` + `shim.lifecycle.shim_stopping` (per spec §4.6 + §4.7)
- `OIS_SHIM_LOG_LEVEL` env var read at FileBackedLogger init; filter applied at emit boundary
  - DEBUG / INFO / WARN / ERROR levels
  - Default INFO
  - No-op for events below threshold
- FileBackedLogger fd lifecycle: eager-open on shim startup (composes with #40 closure from commit 2)

**Test surface contract:**
- Test 1: redaction — emit event with `tokens` + `secrets` fields → FileBackedLogger output contains `***REDACTED***` markers
- Test 2: rotation — emit events past `OIS_SHIM_LOG_ROTATE_BYTES` threshold → naive timestamp-suffix rotation produces correctly-named files
- Test 3: log-level — set `OIS_SHIM_LOG_LEVEL=WARN` → emit DEBUG/INFO/WARN/ERROR events → only WARN + ERROR appear in output
- Test 4: event-taxonomy alignment — emit each canonical event from spec §4 → output matches expected event-name + required fields

**Pass 10 §F fixture regeneration:** run `npm test --workspace=packages/network-adapter -- observability/` to regenerate fixture diffs; commit alongside source change.

**Coordinated-upgrade anchor (commit-message line):**
> `Coordinated-upgrade anchor (anti-goal #8): event-taxonomy v1 stable contract; Phase 1 ad-hoc event names migrate to canonical names (renames within v1 namespace ride-along; no consumer impact since no inter-process consumers existed Phase 1). FileBackedLogger fd lifecycle eager-open composes with commit 2 #40 closure.`

**Acceptance criteria:**
- 4 tests above pass ✓
- Event taxonomy v1 documented at `docs/specs/shim-observability-events.md` matches actual emitted events ✓
- Pass 10 §F fixture regeneration test passes ✓
- Sizing estimate: ~0.5 eng-day per your thread-424 round-2 plan

**Heartbeat ping after push:** *"commit 4 pushed at `<sha>`; commit 5 starting (STRUCTURAL ANCHOR — large; ~1 day)"*.

---

### §2.3 Commit 5/N — Hub schema-validate at canonical repository write-path (closes #41 STRUCTURAL ANCHOR)

**Architect docs reference:** Design §2.1.4 + ADR-031 §7 (coordinated-upgrade + structural-anchor disciplines).

**Engineer source-locator:**
- `hub/src/policy/note-schema.ts` (NEW; canonical kind=note payload schema)
- `hub/src/repositories/message-repository.ts` (or canonical write-path; `messageRepository.create()`)
- `hub/src/policy/director-notification-helpers.ts:79` (Hub-internal emitter site #1)
- `hub/src/policy/downstream-actors.ts:59,70,81` (Hub-internal emitter sites #2 + #3 + #4 — mission_activation_inbox + mission_completion_director_inbox + review_submitted_inbox)
- `hub/src/policy/notification-helpers.ts` (Hub-internal emitter site #5)
- `hub/src/policy/message-policy.ts` (Hub-internal write-path; if separate from repository layer)
- Tests at `hub/test/policy/note-schema.test.ts` + `hub/test/repositories/message-repository.test.ts` + `hub/test/integration/kind-note-validate.test.ts`

**Architectural commitments:**
- Define canonical kind=note payload schema at `hub/src/policy/note-schema.ts`:
  - Required fields: `body` (string) — at minimum; specific fields TBD per Hub team's domain knowledge of `kind=note` semantics
  - Validate function exposed: `validateNotePayload(payload: unknown): { valid: boolean, errors?: string[] }`
- Schema-validate dispatched at canonical write-path (`messageRepository.create()`):
  - Per `kind` value, dispatch to per-kind validate function
  - For `kind=note`: call `validateNotePayload(payload)`
  - On invalid: throw / reject (NO warn-mode grace per Director ratification + anti-goal #8 coordinated-upgrade)
- LLM-caller failure mode: error nack via `create_message` MCP entry-point (validation error propagates through MCP layer with diagnostic message)
- Hub-internal-emitter failure mode: throw / log-and-skip at the canonical write-path (correct invincibility-class behavior; defective Hub-internal emitter does NOT silently degrade)
- 4 Hub-internal emitter sites ship canonical-payload corrections in same commit (LLM-caller pool pre-staged grep-empty per architect thread-424 round-5 grep-findings)

**Test surface contract (3 cases per Design §2.1.4):**
- Test 1: deliberately-malformed kind=note via MCP entry-point → `create_message` returns error nack with diagnostic message
- Test 2: deliberately-malformed kind=note via Hub-internal emitter → emitter throws OR log-and-skips (correct invincibility behavior)
- Test 3: canonical-shape integration tests for all 4 Hub-internal emit sites (each emits canonical kind=note payload that passes validation)

**Architect-side post-commit-5 fixup (commit 5b/9):** prompt-template at `packages/network-adapter/src/prompt-format.ts:201,224` has TBD markers awaiting your canonical schema landing. Architect ships 5b-final replacing TBD with concrete canonical-payload-shape example referencing `hub/src/policy/note-schema.ts`. Architect-side completes within ~10min after your commit 5 lands.

**Coordinated-upgrade anchor (commit-message line):**
> `Coordinated-upgrade anchor (anti-goal #8): ALL kind=note callers (LLM + Hub-internal) ship canonical-payload corrections atomically; reject-mode default canonical (no warn-grace per Director ratification 2026-04-29). LLM-caller pool: architect-side LLM via create_message MCP entry-point (architect commits 5b-final post-this-commit landing canonical schema). Hub-internal-emitter pool: 4 sites enumerated above ship corrections same commit. STRUCTURAL ANCHOR closure of bilateral-blind class for ALL emitters.`

**Acceptance criteria:**
- 3 tests above pass ✓
- All 4 Hub-internal emitter sites use canonical-payload shape per new note-schema.ts ✓
- `messageRepository.create()` (or canonical write-path) dispatches per-kind schema-validate ✓
- Sizing estimate: ~1 eng-day per your thread-424 round-2 plan (largest commit; STRUCTURAL ANCHOR)

**Heartbeat ping after push:** *"commit 5 pushed at `<sha>`; canonical schema at hub/src/policy/note-schema.ts exposes `validateNotePayload`; ready for architect 5b-final"*.

---

### §2.4 Commit 6/N — thread_message marker-protocol (closes #26)

**Architect docs reference:** Design §2.1.2 (architect-lean (b) `<channel>` attribute approach) + spec §6.3 coordinated-upgrade.

**Engineer source-locator:**
- `hub/src/envelope/thread-message-builder.ts` (or wherever thread_message envelope-builder lives; emits `<channel>` element)
- `packages/network-adapter/src/render-template-registry.ts` (or wherever render-template-registry consumes envelopes)
- `packages/network-adapter/src/render-templates/thread-message.ts` (or specific render template)
- Tests at `hub/test/envelope/thread-message-truncation.test.ts` + `packages/network-adapter/test/render-templates/thread-message.test.ts`

**Architectural commitments:**
- Hub envelope-builder for `thread_message` event-type:
  - When body byte-length > truncation threshold (constant ~250 chars per #26 origin; documented in event-taxonomy doc)
  - Add `truncated="true" fullBytes="<n>"` attributes to `<channel>` element
  - Body content remains as inner content (truncated to threshold for transport efficiency)
- Adapter render-template-registry `thread_message` template:
  - Read `<channel>` attributes
  - When `truncated="true"`: render body + suffix `[…<N> bytes truncated; query thread for full content]`
  - When not truncated: render body unchanged
- Truncation threshold: constant in Hub envelope-builder (Phase 2 stable; configurable via env var ONLY if Phase 3 surfaces need)
- BOTH architect-side AND engineer-side adapter `thread_message` render-templates upgraded in same commit (single SDK package; both adapters consume same render-template-registry; coordinated upgrade automatic)

**Test surface contract:**
- Test 1: deliberately-truncated thread_message → Hub emits `<channel>` with `truncated="true" fullBytes="<n>"` attributes
- Test 2: render-template consumes attributes → renders body + truncation marker suffix
- Test 3: non-truncated thread_message → body rendered unchanged + no marker suffix
- Test 4: backward-compat — old client (Phase 1; no marker awareness) ignores unknown `<channel>` attributes (forward-compat preserved)

**Coordinated-upgrade anchor (commit-message line):**
> `Coordinated-upgrade anchor (anti-goal #8): BOTH architect-side AND engineer-side adapter thread_message render-templates upgraded atomically (single @apnex/network-adapter SDK package; both adapters consume same render-template-registry; coordinated upgrade automatic via single-package shipment). Vertex-cloudrun adapter (Phase 3) adopts marker-protocol at Phase 3 with stable v1 contract — Hub-side always emits marker; consumers ignore unknown <channel> attributes if not yet upgraded (forward-compat preserved).`

**Acceptance criteria:**
- 4 tests above pass ✓
- Truncation threshold documented in event-taxonomy doc ✓ (architect commit 1 placeholder; you can extend if marker-protocol section needed)
- Sizing estimate: ~0.5 eng-day per your thread-424 round-2 plan

**Heartbeat ping after push:** *"commit 6 pushed at `<sha>`; commit 7b (bilateral CLI script fill) starting"*.

---

### §2.5 Commit 7b/N — bilateral CLI script (engineer-portion fill)

**Architect commit 7a:** `394f1d6` — `scripts/local/get-agents.sh` skeleton + `tpl/agents.jq` (verbose) + `tpl/agents-lean.jq` (lean) staged with 2 STUBs marked.

**Engineer-portion deliverables (commit 7b):**
- Implement `buildTable()` function per `/home/apnex/taceng/table/prism.sh:74-99` reference (heredoc'd jq filter + column -t pipe + cyan-color header)
- Implement `call_get_agents()` function per `hub/src/hub-networking.ts:681-905` `/mcp` JSON-RPC envelope:
  ```bash
  curl -sS -X POST "${HOST}/mcp" \
      -H "Authorization: Bearer ${HUB_TOKEN}" \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_agents","arguments":{}}}'
  ```
- Response unwrap via jq: `.result.content[0].text` → JSON-stringified Agent projection (template consumes post-unwrap)
  - **Note:** `tpl/agents.jq` + `tpl/agents-lean.jq` currently expect post-unwrap array as input; you may need to adjust either template OR script to apply `fromjson` on `.result.content[0].text` before piping to template
- Integration test at `scripts/test/get-agents-cli.test.sh` (or wherever CLI tests live) exercising:
  - Auth env file present + HUB_TOKEN set → script connects + renders
  - Auth env file missing → exit 2 with diagnostic
  - `--json` flag bypasses table → raw jq output
  - `--lean` flag uses lean template → terse output
  - `--host` override targets different Hub URL
- Remove the `[STUB]` warning lines from `buildTable()` + `call_get_agents()` once implementations land

**Coordinated-upgrade anchor (commit-message line):**
> `Coordinated-upgrade anchor (anti-goal #8): bilateral commit 7 second-half (architect 7a/394f1d6 staged skeleton; engineer 7b fills runtime binding). New operator-facing surface; no upstream consumers to break; bilateral co-author tests across architect + engineer + Director-side terminal usage.`

**Acceptance criteria:**
- Script runs successfully against local Hub on `localhost:8080` ✓
- Renders verbose Agent projection table by default ✓
- `--json` / `--lean` / `--host` / `--role` flags all functional ✓
- Auth env file source works ✓
- Integration test passes ✓
- Sizing estimate: ~0.25 eng-day per your thread-424 round-2 plan (shared with architect)

**Heartbeat ping after push:** *"commit 7b pushed at `<sha>`; W1+W2 commit-stream complete; ready for W1+W2 PR open + bilateral round-1 audit"*.

---

## §3 W1+W2 closing sequence

After commit 7b lands:
1. Architect opens W1+W2 PR consolidating ~9 commits (commits 1 + 2 + 32f7a6b + 7a + 5b-placeholder + 8d017ec + your 3 + 4 + 5 + 6 + 7b)
2. Bilateral round-1 audit thread (calibration #24 dual-surface)
3. Architect 5b-final landing post-engineer-commit-5 + canonical-schema reference
4. Admin-merge per bug-32 baseline
5. W3 substrate-self-dogfood gate (7 verification gates per Design §5.3)
6. W4 closing wave (closing audit + ADR-031 RATIFIED + Phase 10 retrospective + #48-#56 calibration filings consolidated; mission-66-origin total = 9 calibrations as of this writing)

---

## §4 Cadence reminder (Calibration #55)

Per Director directive 2026-04-29 ~07:50Z + Calibration #55:
- **Engineer-side autonomous-stop ONLY when thread-engaged with architect on a surfaced action**
- Heartbeat ping on each commit-push (1-line; SHA + next-commit-starting)
- Cadence-decision-points: ping thread with explicit cadence-question; await architect-side response

This SPEC is your unblock. Architect tracks via thread-425 + branch state. Mission progresses without architect-cross-domain delegation; option (3) cadence operationalized.

---

*Engineer-side SPEC authored 2026-04-29T~07:55Z UTC by lily / architect per option-3 cadence ratification (Director 2026-04-29 ~07:50Z UTC). Engineer-target: greg. Per anti-goal #8 coordinated-upgrade discipline + calibration #55 engineer-stop discipline + calibration #56 pulse-simplification forward-pointer.*
