# ADR-026 — Push Pipeline + MessageRouter (Universal Adapter Phase 1)

**Status:** Accepted — 2026-04-26. Ratified via mission-56 (M-Push-Foundation); landed across PRs #70 (W0 spike) / #71 (W1a) / #72 (W1b) / #73 (W2.1) / #74 (W2.2) / #75 (W2.3) / #76 (W3.1) / #77 (W3.2) / #78 (W3.3) / #79 (W4.1) / #80 (W4.2) / #81 (W4.3 doc-only) / [W5 PR — this PR]. Authored during design rounds thread-313 / thread-325 (architect lily + engineer greg) per Design v1.2 ratification.

**Context window:** mission-56 — the third sovereign-architectural-surface ADR in the substrate→primitive→delivery lineage:
- **ADR-024** ratified the storage substrate (single-entity atomic CAS).
- **ADR-025** ratified the workflow primitive that runs on top (multi-membership Message + saga + triggers + scheduled-message + retry interlock).
- **ADR-026** ratifies the canonical event-delivery layer that transports Messages from Hub to Layer-3 host shims (push pipeline + Layer-2 sovereign router + adapter render surface).

Together the three ADRs establish the full sovereign-architectural-surface stack: storage → primitive → delivery. No legacy entities in the new write-paths; no bolt-on transports; every future Message-emitter (idea-199 FSM-completeness, idea-191/mission-52 repo-event-bridge, idea-206 M-Mission-Pulse-Primitive, idea-194 mid-thread-amend) consumes the same push primitive.

---

## 1. Context

Pre-mission-56, the Hub's SSE event-delivery surface was fragmented:

- **Notification entity** (mission-49 W9 NotificationStore) carried legacy SSE-fanout records with a separate ULID namespace. Per-event persist-first; reads via `listSince(afterId)` but production callers never used the read-path (W0 §D1 grep confirmed dead code).
- **DirectorNotification entity** carried Director-specific terminal-escalation alerts. Persist-only (no SSE replay).
- **PendingActionItem entity** carried the dispatch-ack saga FSM (`enqueued → receipt_acked → completion_acked` per ADR-017). Indirectly drove SSE delivery via the watchdog escalation ladder.
- **No structural push-on-Message-create primitive** — `messageStore.createMessage` committed the entity but didn't fire SSE; downstream consumers had to poll via `list_messages` or rely on legacy notification-fanout paths.
- **No SSE Last-Event-ID replay over Messages** — clients reconnected via state-based-reconnect (`get_pending_actions` + `completeSync`); message-state replay was deferred per mission-51 W6.
- **No Layer-2 router** — the adapter Layer-1c MCP-boundary dispatcher emitted notifications via host-specific bindings without a kind/subkind-routed transformation layer.
- **No claim+ack two-step semantics** — Message status was `new | acked` (per mission-51 W1); multi-agent same-role consumer races resolved ad-hoc; "received but not yet acted" wasn't representable.

The Universal Adapter notification contract (mission-55 PR #64, `docs/specs/universal-adapter-notification-contract.md`) codified the Layer-1c → Layer-3 hooks shape but explicitly deferred Layer-2 routing + claim/ack to mission-56.

mission-56 design (Design v1.2; commit `cc90174`) ratified the 7 architectural commitments + 3-layer push-pipeline architecture. This ADR captures the design that mission-56 ratified across W0–W5 (5 wave-clusters of mechanical implementation).

---

## 2. Decision

### 2.1 3-layer push-pipeline architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│ HUB (`hub/`)                                                            │
│                                                                         │
│   write-path:  ctx.dispatch("message_arrived", {message}, selector)    │
│                  ↓                                                      │
│                Notification → SSE via                                  │
│                StreamableHTTPServerTransport.sendLoggingMessage         │
│                                                                         │
│   read-path: SSE GET handler                                           │
│              ↓                                                          │
│              messageStore.replayFromCursor(opts) [W1b]                  │
│              ↓                                                          │
│              sendLoggingMessage with Message ULID as `id:`              │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ SSE (`text/event-stream`)
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 1 — `@apnex/network-adapter`                                        │
│   src/wire/        — TCP/SSE conn lifecycle; reconnect; backoff [1a]   │
│   src/session/     — handshake; session FSM; agent identity     [1b]   │
│   src/mcp-boundary/ — Initialize/ListTools/CallTool factory     [1c]   │
│       dispatcher.ts (createSharedDispatcher)                           │
│       tool-catalog-cache.ts (schema-versioned + atomic-write)          │
│       SharedDispatcherOptions.notificationHooks                        │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ notificationHooks callbacks
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 2 — `@apnex/message-router` (sovereign-package #6; this mission)   │
│   kind/subkind routing skeleton; seen-id LRU N=1000 dedup              │
│   adapter dispatcher consumes via dispatcher↔router wiring             │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ shim-injection contract
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 3 — Per-host shims (`adapters/<host>-plugin/src/shim.ts`)        │
│   claude-plugin: stdio + `<channel>` source-attribute taxonomy [W2.3]  │
│   opencode-plugin: Bun-HTTP + promptAsync                              │
│   future hosts: terminal-direct / ACP / Slack / web                    │
└─────────────────────────────────────────────────────────────────────────┘
```

Layer-1c (`@apnex/network-adapter`) emits via the `notificationHooks` callback bag (mission-55 PR #63) — generic shim-injection contract. Layer-2 (`@apnex/message-router`; this mission) lives between Layer-1c and Layer-3, adding kind/subkind routing + seen-id dedup. Layer-3 implements host-binding render decisions (host-specific render-surface freedom; spec preserves no host-mechanism mandate per Universal Adapter notification contract).

### 2.2 Push-on-Message-create (commitment #1)

`message-policy.ts:188-221` — after successful `messageStore.createMessage` commit, fire `ctx.dispatch("message_arrived", {message}, pushSelector(target))`. Subscriber resolution maps `MessageTarget → Selector`:

- `target.role` → `selector.roles = [target.role]`
- `target.agentId` → `selector.engineerId = target.agentId`
- `target == null` → empty selector (broadcast to all online)
- `delivery !== "push-immediate"` → no fire (queued + scheduled land on poll backstop / sweeper)

Event payload: inline Message envelope (sub-1KB typical). Event ID semantic: Message ULID — forward-compatible with W1b Last-Event-ID protocol.

**Failure semantic:** dispatch failure logged non-fatal — Message commits regardless of push delivery success. Adapter recovers via cold reconnect-replay (W1b) or poll backstop (W3.3). This matches the persist-first invariant from ADR-005 (and ADR-017 for pending-action saga).

### 2.3 Last-Event-ID SSE protocol + cold-start replay (commitment #2)

Hub-internal `replayFromCursor(opts: {since?, targetRole?, targetAgentId?, status?, limit})` query on `IMessageStore`. Returns Messages with `id > since` (or all if `since` undefined), filtered by target/status, ordered by `id` ASC (ULID time-monotonic), limited to `limit`.

SSE GET handler intercepts `Last-Event-ID` header before delegating to `StreamableHTTPServerTransport.handleRequest`:
- `Last-Event-ID` present → `replayFromCursor({since: lastEventId, limit: REPLAY_SOFT_CAP})` + emit each Message via `sendLoggingMessage` with Message ULID as the SSE `id:` field
- `Last-Event-ID` absent → cold-start: `replayFromCursor({limit: REPLAY_SOFT_CAP})` (full retention window)
- Result count `=== limit` → emit synthetic `replay-truncated` SSE event + close connection; adapter reconnects with `lastStreamedId` as next `Last-Event-ID` for the subsequent batch

`REPLAY_SOFT_CAP = 1000` chosen to match the adapter-side seen-id LRU N=1000 (per round-2 audit answer #4).

**Coexists with state-based-reconnect:** when the Hub is wired without a Message store (test rigs that don't supply it), the SSE GET handler degrades to existing state-based-reconnect behavior — no replay, clients call `get_pending_actions()` + `completeSync()` per the legacy path.

### 2.4 `@apnex/message-router` sovereign-package #6 (commitment #3)

New package `packages/message-router/` (file:-ref via `dist/`-commit per calibration #20). Layer-2 between Layer-1c MCP-boundary dispatcher and Layer-3 host-shim render-surface.

**Boundary discipline (per recon Q1+Q2 + Design v1.2 §"M-Pre-Push-Adapter-Cleanup"):** `@apnex/message-router` is structurally distinct from the foreign engineer's recon-time "dispatcher" naming. Architect's disambiguation at recon Q2:
- **MCP-boundary dispatcher** (Layer 1c; `@apnex/network-adapter/src/mcp-boundary/dispatcher.ts`) — Initialize/ListTools/CallTool handler factory; pendingActionMap; tool-catalog cache
- **Message-router** (Layer 2; `@apnex/message-router`; this ADR) — Message kind/subkind router; seen-id LRU dedup; adapter↔shim contract

The two layers have distinct concerns and live in distinct packages. Future foreign-tree ports of "dispatcher" should explicitly qualify which layer they target.

**Seen-id LRU N=1000 dedup** primitive in the router. Adapter receives Messages via two paths (SSE inline + poll-backstop drain); both paths converge on the same seen-id key. Prevents double-handling of the same Message under reconnect-replay + concurrent poll-tick.

### 2.5 Per-host source-attribute taxonomy (commitment #4)

Layer-3 host-shim render-surface decisions are host-specific (Universal Adapter notification contract spec mandates no host-mechanism). For the claude-plugin shim (W2.3 PR #75): `<channel>` source-attribute taxonomy per Design v1.2 §4 — `plugin:agent-adapter:repo-event` / `:directive` / `:notification` / `:proxy` fallback. Per-subkind source attribution is the shim's contract obligation.

For opencode-plugin: `client.session.promptAsync` push-to-LLM with 30s rate-limit + deferred backlog for actionable events; `injectContext` (system prompt, no-reply) for informational; tool-discovery sync on `streaming` transition.

Future hosts (terminal-direct, ACP, Slack, web) extend additively per the Universal Adapter notification contract spec §"Future-host extension points."

### 2.6 Hybrid push+poll backstop with `since` cursor (commitment #5)

W3.1 (`list_messages.since` cursor extension; PR #76): ULID-strict cursor (`id > since`) on `IMessageStore.listMessages` + the MCP tool surface. Foundation for the adapter-side hybrid poll backstop.

W3.3 (adapter-side `kernel/poll-backstop.ts`; PR #78): opt-in module with 5min default cadence, `OIS_ADAPTER_POLL_BACKSTOP_S` env override, 60s floor anti-pattern guard. Polled flow goes through the same MessageRouter as the SSE inline path (seen-id LRU dedup parity ensures no double-render).

**Opt-in by construction:** omitting `pollBackstop` from the dispatcher options preserves existing push-only behavior. The W1a push pipeline + W1b Last-Event-ID replay are sufficient for happy-path delivery; the poll backstop closes the long-tail window where SSE reconnect storms or Cloud Run proxy buffering could lose events. Adapter dogfood verified the push pipeline e2e in-flight (mission-56 thread-336 dispatch reached engineer's session in ~2.5min via SSE).

### 2.7 Two-step claim+ack semantics + Message status FSM (commitment #6)

Mission-51 W1 ratified Message status `new | acked`. Mission-56 W3.2 extends to **3-state linear FSM** `new → received → acked`:

- `new` — Message created; not yet rendered to a host
- `received` — `claimMessage(id, claimerAgentId)` flipped status; the Message has been rendered to a specific consumer (`claimedBy` records the winning agent)
- `acked` — `ackMessage(id)` flipped status; the consumer (LLM) acted on or actively-deferred the Message

**Linear, monotonic transitions:** each transition is an atomic CAS via `putIfMatch` (winner-takes-all under concurrent claim). Subsequent claim attempts (same or different agent) return the existing state — loser observes `claimedBy !== myAgentId` and silently drops.

**Director-confirmed at thread-325 round-2:** ack tied to consumer-action (Option (i) explicit-ack-on-action), not auto-on-render. Adapter-side hybrid poll backstop + reconnect-replay queries filter `status === "new"` to exclude both `received` + `acked`.

**MCP verbs:**
- `claim_message(id, claimerAgentId)` — claim a Message (atomic CAS `new → received` + stamp `claimedBy`)
- `ack_message(id)` — ack a Message (atomic CAS `received → acked`)

Adapter-side `SharedDispatcher.ackMessage(id)` helper for Option (i) explicit-ack-on-action — fire-and-forget; rejection-tolerant.

**Mirrors ADR-017 saga FSM:** the `new → received → acked` shape mirrors PendingActionItem's `enqueued → receipt_acked → completion_acked` per Design v1.2 §"Architectural commitments #6". The two FSMs are now structurally aligned at the happy path; PAI's non-happy-path states (escalated / errored / continuation_required) remain on the saga primitive (idea-207 deferred future work).

### 2.8 Legacy entity sunset — 2/3 retired; PAI deferred (commitment #7)

Sequential per-entity for blast-radius isolation:

1. **DirectorNotification** (W4.1 PR #79) — 7 call-sites cut over (5 write + 2 read). Wire format: `kind: "note"` + `target.role: "director"` + `payload: {severity, source, sourceRef, title, details}`. Entity store retained for W5 cleanup; no dual-write; no backfill. Backward-compat MCP tool surfaces preserved (`list_director_notifications`, `acknowledge_director_notification`).

2. **Notification** (W4.2 PR #80) — 2 prod call-sites cut over (`hub-networking.ts:notifyEvent` + `dispatchEvent`). Wire format: `kind: "external-injection"` + `target: null` (broadcast — multi-role targetRoles preserved in payload) + `payload: {event, data, targetRoles}`. **Kind divergence from W4.1** ratified at thread-343 r3: kinds reflect entity semantics (DirectorNotification = inbox-routed alerts → `note`; Notification = Hub-event-bus → SSE injection → `external-injection`), not cross-W4 stylistic consistency. **No-double-send** preserved by invoking `messageStore.createMessage` directly (skipping the W1a push-on-create that lives in the `create_message` MCP tool handler); existing `notifyConnectedAgents` continues SSE delivery using `Message.id` as event-id.

3. **PendingActionItem** (W4.3 PR #81; doc-only scope correction) — engineer re-grep + structural-difference analysis at the start of W4.3 revealed PAI is a saga FSM primitive structurally distinct from notification records. States Messages don't model (`escalated`, `errored`, `continuation_required`); primitives Messages don't track (`attemptCount`, `receiptDeadline`, `naturalKey`, `continuationState`). Full migration would have been 3-5 eng-days of saga-rewrite touching watchdog escalation ladder + adapter pendingActionMap + ADR-017 invariants — outside W4 scope. **Director ratified Option C** (thread-345 r2): defer to **idea-207 M-PAI-Saga-On-Messages** Tier 2 future mission. Mission-56 closes 2/3 of the legacy notification entities; PAI properly retained as the saga primitive.

### 2.9 ADR-024 + ADR-025 boundaries preserved

Mission-56 uses ONLY existing single-entity atomic primitives from the StorageProvider contract (`createOnly`, `putIfMatch`, `getWithToken`). No new contract surface beyond the W3.2 status FSM extension on `IMessageStore`. The 6-primitive contract from ADR-024 §2 is unchanged; ADR-025's Message entity gained `claimedBy` field + extended `MessageStatus` enum (additive; pre-W3.2 persisted state parses against the extended enum unchanged).

---

## 3. Companion to ADR-024 + ADR-025

ADR-024 ratifies the storage substrate (single-entity atomic CAS). ADR-025 ratifies the workflow primitive that runs on top. ADR-026 ratifies the canonical event-delivery layer that transports the primitive from Hub to Layer-3 host shims.

| ADR | Surface | Single-source-of-truth |
|---|---|---|
| ADR-024 | StorageProvider 6-primitive contract | `packages/storage-provider/src/contract.ts` |
| ADR-025 | Message + workflow primitives + registries | `hub/src/entities/message.ts` + `hub/src/policy/{triggers, downstream-actors, preconditions, scheduled-message-sweeper, cascade-replay-sweeper, message-projection-sweeper, message-helpers, message-policy}.ts` |
| ADR-026 | Push pipeline + Layer-2 MessageRouter + adapter render surface | `hub/src/policy/message-policy.ts:188-221` (push-on-create) + `hub/src/hub-networking.ts` (SSE wrapper + replay) + `packages/message-router/` (Layer-2 sovereign) + `packages/network-adapter/src/{wire,session,mcp-boundary}/` (Layer-1) + `adapters/<host>-plugin/src/shim.ts` (Layer-3) |

The three ADRs are companion sovereign surfaces. Mission-56 W0 spike characterized Layer-2 as separable from Layer-1 (recon Q1) and ratified the 3-layer decomposition; ADR-026 formalizes that architecture.

---

## 4. Consequences

### 4.1 Future workflow primitives consume the canonical push pipeline

idea-199 (M-Workflow-FSM-Completeness), idea-191/mission-52 (M-Repo-Event-Bridge), idea-194 (mid-thread-amend), idea-206 (M-Mission-Pulse-Primitive), and other future Message-emitters consume the same push primitive. No new transports, no bolt-on SSE paths.

### 4.2 Universal Adapter notification contract realized

The mission-55 D6 spec (`docs/specs/universal-adapter-notification-contract.md`) is now operationally backed by the 3-layer architecture. v1.0 covers Layer-1c → Layer-3 emission (mission-55 baseline); v1.1 extends to claim+ack two-step semantics (this ADR; mission-56 W3.2). Future hosts (terminal-direct, ACP, Slack, web) extend additively per the spec's §"Future-host extension points."

### 4.3 Legacy notification entity stores → Message-store projection (2/3 retired)

DirectorNotification + Notification stores retain their disk artifacts (`director-notifications/v1/` + `notifications/v2/` namespaces) until their reads drain — but no production code writes them post-W4.1+W4.2. W5 (this ADR's accompanying PR) removes the storage definitions, indexes, persistence stubs, types, counter fields. PendingActionItem is exempt per Director's Option C — proper sunset deferred to idea-207.

### 4.4 PendingActionItem deferred to Tier 2 (idea-207)

PAI saga FSM continues to drive the ADR-017 dispatch lifecycle untouched. The W3.2 Message status FSM (`new → received → acked`) MIRRORS PAI's happy-path saga but is structurally distinct (see §2.8 above). Future mission **idea-207 M-PAI-Saga-On-Messages** is the proper deferral target for migrating PAI's saga onto the Message store.

### 4.5 Test surface

Mission-56 lands +19 net hub-side tests (W4.1 +14 helper unit tests + W4.2 +5 helper unit tests) + 45 adapter-side tests in W3.3. Per-axis enforcement of the W3.2 FSM (claim+ack idempotency; multi-agent winner-takes-all CAS); per-helper wire-shape canonicality (W4.1 + W4.2); per-poll-backstop happy/empty/disconnected/cursor-regression-guard cases; per-dispatcher claim-fire + ack-helper integration. ADR-026 is empirically grounded.

---

## 5. Provenance

- **Director ratification:** Design v1.2 §"M-Push-Foundation" via mission-55 retrospective gate; Option (i) explicit-ack-on-action at thread-325 round-2; Option A (post-W3.3 context-budget) at thread-340; Option C (W4.3 scope correction) at thread-345 r2.
- **Design rounds:** thread-313 (initial design); thread-325 (Director-ratified W3.2 + W4 sub-PR cascade); various PR-review threads (337/338/339/342/344/346) for per-wave cross-approval.
- **W0 spike:** PR #70 / `09452f5` — read-path grep audit + spike-level structural decisions.
- **W1a push-on-create:** PR #71 / `3f15057` — `message-policy.ts:188-221` dispatch shape.
- **W1b Last-Event-ID:** PR #72 / `c6bcf56` — `replayFromCursor` + SSE GET wrapper + soft-cap.
- **W2.1 sovereign-package #6:** PR #73 / `f5dacfd` — `@apnex/message-router` Layer-2 router.
- **W2.2 dispatcher↔router:** PR #74 / `15f1405` — adapter consumes the router via `notificationHooks`.
- **W2.3 source-attribute:** PR #75 / `0a403fc` — claude-plugin `<channel>` taxonomy.
- **W3.1 since cursor:** PR #76 / `eb1ee2b` — `list_messages.since` cursor extension.
- **W3.2 claim/ack + FSM:** PR #77 / `c215f6c` — Message status FSM `new → received → acked` + MCP verbs.
- **W3.3 adapter wiring:** PR #78 / `f7bd1db` — adapter-side hybrid poll backstop + claim/ack wiring.
- **W4.1 DirectorNotification sunset:** PR #79 / `4395079` — 7 call-sites cut over.
- **W4.2 Notification sunset:** PR #80 / `18934d4` — 2 prod call-sites cut over.
- **W4.3 PAI scope correction:** PR #81 / `719c0bf` — doc-only Design v1.2 footnote (Option C).
- **W5 (this ADR + closing audit + cleanup):** [W5 PR — this PR].
- **Companion ADRs:** ADR-024 (StorageProvider) + ADR-025 (Message primitive).
- **Closing audit:** `docs/audits/m-push-foundation-closing-audit.md`.
- **Universal Adapter notification contract spec:** `docs/specs/universal-adapter-notification-contract.md` (mission-55 D6).
- **Predecessor missions:** mission-51 (Message primitive); mission-54 (Adapter recon); mission-55 (Adapter cleanup).
- **Tier 2 deferred:** idea-206 (M-Mission-Pulse-Primitive); idea-207 (M-PAI-Saga-On-Messages); M-Adapter-Distribution.

---

## 6. Decision authors

- **Architect:** lily (eng-40903c59d19f) — Design v1.2 author; thread-313 / thread-325 design rounds; W0–W5 directives; Option C ratification at thread-345 r2.
- **Engineer:** greg (eng-0d2c690e7dd5) — W0 spike; W1–W4 wave implementation; W4.3 scope-correction analysis; ADR-026 draft + closing audit (this W5 PR).
- **Director:** ratified Design v1.2 propose_mission cascade post-mission-55 retrospective; ratified Option (i) explicit-ack-on-action at thread-325; ratified Option A context-budget reset at thread-340; ratified Option C W4.3 scope correction at thread-345 r2.
