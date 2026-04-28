# Mission Brief: Lift M18 + Observability into the Shared Hub-Connection Package

**Status:** Proposed (revised 2026-04-15 — single-author delivery via LAN file share)
**Author:** Claude Code (engineer-claude-1, `eng-6889bc8b6932`)
**Date:** 2026-04-14, revised 2026-04-15
**Intended audience:** Architect, for tracking; execution is single-author
**Origin:** Investigation triggered by suspected engineer-connection hallucinations on 2026-04-14 UTC evening session

---

## Rubric: Goals of the Universal Adapter

This refactor is measured against the six goals defined in the canonical architecture reference: **Modular, Portable, Resilient, Authoritative, Verifiable, Efficient** — in that order. They are anchored in concrete production scars (M18 leaked into one shim only, L4/L7 coupling, SSE partition / displacement / zombies / OCC contention, `ConnectedEngineer` dual-store divergence, missing projection fields, `touchAgent` GCS thrash) and are the rubric by which any adapter change must justify itself.

**Canonical source:** [`docs/network/00-network-adapter-architecture.md#1-goals-of-the-universal-adapter`](docs/network/00-network-adapter-architecture.md). That doc is the single source of truth; this mission brief references it rather than duplicating it.

---

## 1. Why this document exists

Tonight's debugging session exposed a class of bug that we will not find by running more probes, issuing more tasks, or trusting architect's verbal diagnoses. The bug is structural: the client-side code that implements our multi-agent protocol (M18) lives in the wrong place. It was added to one engineer's local shim instead of the shared adapter package that both engineers consume. As a result, one engineer has M18 behavior and the other does not, and neither the Hub nor architect has any way to tell that from the outside.

This document captures what we verified tonight, what we inferred, what the correct target state is, and a step-by-step plan to get there. It is intended to be read cold — you should not need the session transcript to act on it.

### 1.1 Delivery model (revised 2026-04-15)

There is no shared git for the engineers yet. The original draft of this brief assumed architect would decompose the work into three parallel engineer-assigned tasks (shared refactor + Claude migration + OpenCode migration), with each engineer independently implementing matching changes. That is high-drift: two engineers typing near-identical code against a single shared API is exactly the class of mistake that got us here in the first place (M18 was added to one shim only).

On 2026-04-15 we established an interim distribution mechanism: a plain Python HTTP server (`python3 -m http.server 8000 --bind 0.0.0.0`) on the Claude machine serves the entire `agentic-network` working tree read-only over the LAN at `http://192.168.1.241:8000/`. OpenCode can `wget -r` any path.

This changes the execution model:

- **I (Claude-engineer) am sole author of all code changes.** That includes the shared `packages/hub-connection/` refactor, the Claude-engineer `hub-proxy.ts` rewrite, AND the OpenCode `.opencode/plugins/hub-notifications.ts` rewrite. All three live in the same working tree on the Claude machine and I can edit any of them directly.
- **OpenCode's role is to mirror, install, restart, and smoke test.** Specifically: `wget -r` the affected paths, `bun install`, restart the OpenCode CLI, confirm the new `[M18] Registered as ...` line appears in the log, report back.
- **Architect's role shrinks.** Architect tracks the mission and runs the empirical isolation test at the end (Task D below). Architect does not decompose into three engineer tasks.

This eliminates dual-implementation drift entirely. It is strictly an interim until shared git lands.

---

## 2. Summary of the finding

**M18 client-side code (`globalInstanceId` bootstrap, enriched `register_role` handshake, epoch tracking, fatal-halt handling, structured notification logging) lives only in `claude-engineer/src/hub-proxy.ts`. It is not in `packages/hub-connection/`. Therefore OpenCode, which consumes `@apnex/hub-connection` via the shared `UniversalClientAdapter`, has none of it.**

Consequences observed tonight:

1. Claude-engineer (me) registers with a globalInstanceId, receives a deterministic fingerprint-derived `engineerId` (`eng-6889bc8b6932`), and tracks `sessionEpoch` for displacement detection across reconnects.
2. OpenCode registers with the pre-M18 generic `register_role({ role: "engineer" })` call. The Hub assigned it `eng-10` on its first connection on 2026-04-11 and has kept that identity ever since.
3. The two engineers are running against the same Hub on two different identity schemes. This is an un-designed-for state, and the Hub's targeted push-routing appears to fall back to legacy behavior for the pre-M18 engineer.
4. OpenCode's log (`hub-plugin.log`) is too coarse to answer routing questions — it does not record task IDs on inbound events, channel push decisions, or handshake fields.
5. The "shared sessionId" narrative that architect gave earlier in the session is either a misreading of a Hub projection field or outright confabulation. The actual MCP transport sessions are different (`c428e592-...` vs `ses_2720...`), but architect reported them as identical.

None of this was discoverable without auditing both the shared package and both engineer shims side-by-side.

---

## 3. Evidence

### 3.1 What I verified from my own environment

- My identity: `eng-6889bc8b6932`. Source: `.ois/claude-notifications.log` line `[M18] Registered as eng-6889bc8b6932 (epoch=4)`.
- My `globalInstanceId`: `7145d1c9-a796-4a01-b380-94762864e8bf`. Source: `[M18] globalInstanceId=...` line at proxy start.
- My transport session: `c428e592-a6bb-4289-9edc-f1e6485ca551` (as returned to architect via `get_engineer_status`).
- OpenCode's transport session (fresh restart): `ses_2720...`. Source: user observation on the OpenCode machine, file `hub-plugin.log` line `Tracking session: ses_2720...`.
- OpenCode's log contains zero `[M18]` lines, zero `globalInstanceId` references, zero `wasCreated`/`sessionEpoch` references, and zero task IDs on `Hub event: directive_issued` lines.
- The two engineers share the same `hubToken` in `.opencode/adapter-config.json` (Director-approved MVP shortcut documented in thread-78 / task-140 onboarding brief).

### 3.2 Isolation probes

Two test rounds issued by architect via `create_task`:

**Probe round 1 (burst, 300ms apart):**
- task-155 → targeted at `eng-10` (OpenCode)
- task-156 → targeted at `eng-6889bc8b6932` (Claude)
- Result on Claude side: BOTH `DIRECTIVE_ISSUED` events received, both promoted to channel push (`.ois/claude-notifications.log` lines 912-921, 21:41:35 UTC)
- Result on OpenCode side: unknown (log granularity insufficient to distinguish)

**Probe round 2 (single probe):**
- task-157 → targeted exclusively at `eng-10`
- Result on Claude side: `DIRECTIVE_ISSUED` for task-157 received and channel-pushed to me. I am not eng-10 (`.ois/claude-notifications.log` line 936, 21:44:14 UTC).
- Result on OpenCode side: unknown (log granularity insufficient)

**Correct initial interpretation:** Hub SSE push path broadcasts by transport session pool rather than filtering by `assignedEngineerId`, because M18's pull-path hardening (`get_task` filters) was never paralleled by push-path hardening.

**Corrected interpretation after code audit (§ 4):** Hub push path may or may not have a broadcast bug — we cannot tell yet, because one of the two "engineers" (OpenCode) does not even participate in the M18 identity scheme. Any test run with a pre-M18 engineer and a post-M18 engineer is measuring an asymmetric configuration that was never designed or tested. The routing question can only be answered once both engineers are on the same scheme.

### 3.3 Confabulations caught during the session

Architect reported three specific facts that turned out to be wrong or un-verifiable:

1. **"Both engineers share the exact sessionId `c428e592-...`"** — the `get_engineer_status` projection did return this value for both records, but OpenCode's actual MCP transport session is `ses_2720...`. The Hub's `sessionId` field in that projection is not the transport session. It is either a token-derived value, a default for pre-M18 records, or something else; architect cannot explain which because it was working from memory of the pre-M18 code path.
2. **"Thread-78 is currently waiting for director_input"** — thread-78 is `converged` status, not `active`. Its `outstandingIntent` is `director_input` as a historical artifact of when it converged days ago. Mission-17 closed, Mission-18 was planned and executed.
3. **"It is a mathematical certainty that eng-10 also received both events"** — this was a deduction dressed as telemetry. Architect had no access to OpenCode's local log and should have said so.

Additionally, architect quoted a specific task issuance timestamp (`2026-04-14T21:48:12.123Z`) for task-157 that was four minutes later than the timestamp in my local log (`21:44:14.967Z`). One of them is fabricated — I trust my log because it is written by the receiving proxy with no motive to mis-stamp.

**Lesson for the mission brief:** architect-side narratives about the Hub's internal state must not be trusted without a corresponding code or log citation. Any work that follows from this investigation should verify claims against the actual source files in `mcp-relay-hub/` and `packages/hub-connection/`, not against architect's recall.

---

## 4. Code audit: what lives where today

### 4.1 Shared package `packages/hub-connection/src/`

| File | Lines | Contents |
|---|---|---|
| `interface.ts` | 113 | `IConnectionManager` interface, `ConnectionConfig`, `ConnectionState` (`disconnected`/`connecting`/`synchronizing`/`streaming`/`reconnecting`), `ReconnectReason`, `NotificationHandler`, `StateChangeHandler` |
| `mcp-connection.ts` | 607 | `McpConnectionManager` class — state machine, `connect`, `close`, `executeTool` with session-invalidation retry, `listTools`, atomic `teardown`, `reconnect`, `scheduleReconnect` with exponential backoff, heartbeat (POST `list_tools`), SSE watchdog with suspension detection, first-keepalive deadline, sync buffer, `completeSync` with flush |
| `event-router.ts` | 185 | `HubEventType` union, `HubEvent` envelope, engineer/architect classification tables, `classifyEvent`, `parseHubEvent`, `createDedupFilter` (content-hash based, LRU) |
| `client-shim.ts` | 214 | `IClientShim` interface (`onActionableEvent`/`onInformationalEvent`/`onConnectionStateChange`), `AdapterConfig`, `UniversalClientAdapter` singleton wrapper with dedup + classification + state-change routing |
| `index.ts` | 25 | Public re-exports |

**Critical line in `mcp-connection.ts` around line 306:**

```ts
await this.callToolOnClient("register_role", {
  role: this.config.role,
});
this.log(`Registered as ${this.config.role}`);
```

That is the ENTIRE handshake the shared adapter performs. No `globalInstanceId`, no `clientMetadata`, no `advisoryTags`, no response parsing, no epoch tracking, no fatal-error handling. This is pre-M18 contract.

### 4.2 Claude-engineer `claude-engineer/src/hub-proxy.ts` (681 lines)

Section-by-section classification:

| Lines | Section | Where it should live |
|---|---|---|
| 38-80 | Config loader reading `.opencode/adapter-config.json` + env overrides | Per-engineer (file path is local) or shared helper with path parameter |
| 85-127 | File logger + structured `logNotification` that extracts `taskId`, `threadId`, `proposalId`, `assessment`, `decision`, `intent`, `revisionCount`, `previousReportRef` | **Shared** — OpenCode has no equivalent; this is the root cause of tonight's "no task IDs in OpenCode log" telemetry gap |
| 129-175 | M18 `globalInstanceId` bootstrap — reads/writes `~/.ois/instance.json` (0600, owner-private, `homedir()`-scoped) | **Shared** — zero Claude-specifics |
| 177-187 | `capturedClientInfo` module-scoped mutable from the MCP `initialize` request | Per-engineer capture hook, but the payload shape is shared |
| 189-213 | `getActionText` — short action hint per event type | **Shared** — no Claude-specifics |
| 215-265 | `buildPromptText` — detailed wakeup prompt per event type | **Shared** — OpenCode has a byte-near-identical copy, differing only in the tool-name prefix |
| 267-320 | M18 fatal-halt helpers: `FATAL_CODES` (`agent_thrashing_detected`, `role_mismatch`), `FatalTerminator.halt()`, `parseM18Error` | **Shared** — Hub protocol, not Claude-specific. Includes the 100ms stdio drain delay correction from thread-79. |
| 322-354 | `ProxyShim.onActionableEvent`/`onInformationalEvent` routing to `logNotification` + channel push | Per-engineer delivery (channel push is Claude-only); formatting is shared |
| 356-393 | `pushChannelNotification` — emits `notifications/claude/channel` MCP notification | **Per-engineer** — `claude/channel` is a Claude Code research-preview feature that does not exist in OpenCode |
| 395-405 | `onConnectionStateChange` — calls `performStateSync` on `synchronizing` | **Shared** pattern — OpenCode has the same control flow |
| 407-470 | `performM18Handshake` — constructs enriched `register_role` payload with `globalInstanceId`, `clientMetadata` (`clientName`, `clientVersion`, `proxyName`, `proxyVersion`, `transport`, `sdkVersion`, `hostname`, `platform`, `pid`), `advisoryTags` (`llmModel`), parses response for `engineerId`/`sessionEpoch`/`wasCreated`, handles fatal codes, tracks epoch displacement | **Shared — this is the entire point of the refactor** |
| 472-517 | `performStateSync` — calls M18 handshake first, then parallel `get_task` + `get_pending_actions`, logs pending directive, calls `completeSync()` | **Shared** — OpenCode has an almost identical version |
| 520-546 | Graceful shutdown with 3s timeout | **Shared** helper (or per-engineer boilerplate, it's small) |
| 548-676 | Main: bootstrap, create shim + adapter, connect, build MCP `Server` with `claude/channel` capability, `InitializeRequestSchema` hook for `clientInfo` capture, `ListToolsRequestSchema` + `CallToolRequestSchema` dynamic proxy, `StdioServerTransport` wire-up, signal handlers | **Per-engineer** — entirely last-mile Claude Code stdio integration |

**Target per-engineer size after refactor:** ~150 lines.

### 4.3 OpenCode `.opencode/plugins/hub-notifications.ts` (803 lines)

| Lines | Section | Where it should live |
|---|---|---|
| 27-48 | File logger — **minimal**, just `${new Date().toISOString()} ${msg}`. No structured notification extraction. | **Shared** structured logger. This is why OpenCode's log has no taskIds. |
| 56-90 | Config loader reading `.opencode/adapter-config.json` + env overrides | Per-engineer (file path is local) or shared helper |
| 94-100 | Module-scope state: `hubAdapter`, `proxyPort`, `sdkClient`, `currentSessionId`, `sessionActive`, `config`, `pluginDirectory` | Per-engineer (OpenCode plugin lifecycle) |
| 117-131 | 30-second rate limiter (`RATE_LIMIT_MS`, `lastPromptTime`, `isRateLimited`) | **Per-engineer** — OpenCode's `promptAsync` is expensive; Claude's channel push is cheap. Do not lift. |
| 133-146 | `notificationQueue` + `deferredBacklog` for rate-limited follow-up | **Per-engineer** |
| 150-154 | `classifyEvent` wrapper around shared `classifyEvent` that maps `unhandled` → `informational` | Stays local; calls shared |
| 156-175 | `buildToastMessage` — TUI toast strings | **Per-engineer** — toast is an OpenCode TUI concept |
| 177-220 | `buildPromptText` — **near-duplicate of Claude's, differs only in tool-name prefix** (`architect-hub_*` vs `mcp__hub-proxy__*`) | **Shared** with `toolPrefix` as a config parameter |
| 222-266 | `buildBacklogSuffix`, `drainBacklog`, `flushBacklog` | **Per-engineer** — rate-limit-specific |
| 270-309 | `showToast`, `promptLLM`, `injectContext` — OpenCode SDK calls | **Per-engineer** — OpenCode SDK-specific |
| 311-370 | `processNotification`, `flushQueue` — rate-limited queue processing | **Per-engineer** |
| 378-439 | Tool discovery sync — caches tool hash, notifies OpenCode on change via `sendToolListChanged` | **Per-engineer** — OpenCode caches tool list in its Bun.serve proxy. Claude-engineer proxies `ListTools` dynamically on every request (line 634-637) and does not need this. |
| 447-486 | `PluginShim implements IClientShim` — routes events into the queue | **Per-engineer** delivery; formatting delegates to shared |
| 488-502 | `connectToHub` — creates adapter, starts, logs `Connected to remote Hub` | Per-engineer bootstrap, small |
| 510-552 | `performStateSync` — parallel `get_task` + `get_pending_actions`, `completeSync()` | **Shared** — nearly identical to Claude's version, modulo logging verbosity |
| 554-672 | Local MCP proxy server (Bun.serve, `WebStandardStreamableHTTPServerTransport`, `sdkClient.mcp.add({ name: "architect-hub" })`) | **Per-engineer** — OpenCode architecture requires a local HTTP proxy server; Claude-engineer uses stdio transport instead |
| 677-802 | `HubPlugin` export — plugin init (`setTimeout`-deferred non-blocking), session event handlers (`session.created`, `session.updated`, `session.status`, `session.idle`) | **Per-engineer** — OpenCode plugin lifecycle |

**Target per-engineer size after refactor:** ~300 lines.

### 4.4 What OpenCode is missing entirely today

- `[M18] globalInstanceId` bootstrap
- Enriched `register_role` handshake payload
- `engineerId`/`sessionEpoch`/`wasCreated` response parsing
- Epoch-displacement detection on reconnect
- Fatal-halt handling for `agent_thrashing_detected` / `role_mismatch` (an `agent_thrashing_detected` response from the Hub would be silently ignored and the plugin would keep reconnecting, which is exactly the behavior the fatal-halt was added to prevent)
- `clientInfo` capture (OpenCode CLI version never flows to the Hub)
- Structured notification logging (the root cause of tonight's telemetry gap)

---

## 5. Target architecture

### 5.1 Design principle

> The shared adapter carries all common network protocol, identity, observability, and state-sync behavior. Per-engineer shims are strictly last-mile: they exist only to bridge the adapter to the specific host's delivery channel (Claude Code `notifications/claude/channel`, OpenCode `sdkClient.session.promptAsync`) and to perform host-specific bootstrap (Claude's stdio `Server`, OpenCode's Bun.serve proxy).

If a piece of code could be written once and consumed by both engineers, it **must** live in `@apnex/hub-connection`. Engineer-specific means "the code physically cannot run in the other host" — not "the code was written while working on Claude."

### 5.2 New files in `packages/hub-connection/src/`

```
instance.ts          ~60  lines  globalInstanceId bootstrap (~/.ois/instance.json, 0600)
m18-handshake.ts     ~140 lines  performM18Handshake, parseM18Error, FATAL_CODES, FatalTerminator, epoch tracking state
state-sync.ts        ~80  lines  performStateSync(adapter, callbacks) — parallel get_task + get_pending_actions, completeSync
prompt-format.ts     ~120 lines  getActionText, buildPromptText, buildToastMessage — all take a { toolPrefix } config
notification-log.ts  ~70  lines  structured appendNotification(path, event, data, action) that extracts known fields
```

### 5.3 Modifications to existing shared files

**`mcp-connection.ts`:**
- Keep the bare `register_role({ role })` call in `createConnection()` as a first handshake (proves the transport works).
- Expose a post-connect hook on `IConnectionManager` so the adapter can invoke M18 enrichment as part of the `connecting → synchronizing` transition.
- Alternative: move the M18 handshake invocation into `client-shim.ts` and keep `mcp-connection.ts` unaware of it. This is cleaner — the connection manager stays transport-only, and the adapter owns the application-level protocol.
- Expose `config.clientInfo`, `config.clientMetadata`, `config.globalInstanceId` as optional fields on `ConnectionConfig` or a new `AdapterConfig` that extends it.

**`client-shim.ts`:**
- Extend `AdapterConfig` with:
  ```ts
  globalInstanceId?: string
  clientInfo?: { name: string; version: string }
  clientMetadata?: Record<string, unknown>
  advisoryTags?: Record<string, unknown>
  toolPrefix?: string               // for prompt-format
  notificationLogPath?: string      // for notification-log
  onHandshakeComplete?: (body: { engineerId: string; sessionEpoch: number; wasCreated: boolean }) => void
  onFatalHalt?: (code: string, message: string) => void
  ```
- `UniversalClientAdapter` invokes `performM18Handshake` automatically on state transition into `synchronizing`, before the per-engineer `onConnectionStateChange` callback runs.
- Adapter calls `onHandshakeComplete` with parsed response so per-engineer shims can log `[M18] Registered as ...` in their preferred format, or update local state (e.g., Claude's `ProxyShim.lastSessionEpoch`).
- Fatal halt default behavior: if `onFatalHalt` is not provided, the adapter logs and does nothing. If provided, the per-engineer shim handles the halt (Claude uses stdio drain + `process.exit(2)`; OpenCode would use its own shutdown path).

**`index.ts`:**
- Re-export all new public API:
  ```ts
  export { loadOrCreateGlobalInstanceId } from "./instance.js"
  export { performM18Handshake, FATAL_CODES, parseM18Error } from "./m18-handshake.js"
  export type { M18HandshakeResponse, FatalTerminator } from "./m18-handshake.js"
  export { performStateSync } from "./state-sync.js"
  export { getActionText, buildPromptText, buildToastMessage } from "./prompt-format.js"
  export { appendNotification } from "./notification-log.js"
  ```

### 5.4 Target Claude-engineer `hub-proxy.ts` (~150 lines)

Contents:

1. Config load (file path local)
2. `loadOrCreateGlobalInstanceId()` from shared
3. Capture `clientInfo` via `InitializeRequestSchema` handler on the MCP `Server` (the only way to read it from Claude Code)
4. Construct `AdapterConfig` with all M18 fields populated + `toolPrefix: "mcp__hub-proxy__"` + `notificationLogPath: ".ois/claude-notifications.log"`
5. Create `UniversalClientAdapter.getInstance(config, shim, log)` — adapter handles the rest
6. `ProxyShim implements IClientShim`:
   - `onActionableEvent(event)` → `appendNotification` (shared) + `pushChannelNotification` (local, emits `notifications/claude/channel`)
   - `onInformationalEvent(event)` → `appendNotification` only
   - `onConnectionStateChange(state, prev, reason)` → just logs; state sync is handled by adapter automatically
7. MCP `Server` with `claude/channel` capability + dynamic `ListTools`/`CallTool` proxy
8. `StdioServerTransport` wire-up
9. Signal handlers + graceful shutdown

### 5.5 Target OpenCode `hub-notifications.ts` (~300 lines)

Contents:

1. Config load (file path local via `ctx.directory`)
2. `HubPlugin` export with `setTimeout`-deferred init
3. `loadOrCreateGlobalInstanceId()` from shared
4. Capture `clientInfo` from OpenCode SDK (OpenCode CLI version, SDK version)
5. Construct `AdapterConfig` with all M18 fields populated + `toolPrefix: "architect-hub_"` + `notificationLogPath: ".opencode/hub-plugin-notifications.log"` (new structured log file alongside the existing minimal one)
6. `PluginShim implements IClientShim`:
   - `onActionableEvent(event)` → `appendNotification` (shared) + enqueue to local rate-limited queue → eventually `promptLLM` or `deferredBacklog`
   - `onInformationalEvent(event)` → `appendNotification` + `injectContext`
   - `onConnectionStateChange(state, prev, reason)` → on `streaming`, trigger `syncTools`
7. `sdkClient.mcp.add` registration for the Bun.serve proxy
8. Local Bun.serve MCP proxy server — unchanged from current implementation
9. Tool discovery sync — unchanged from current implementation
10. Rate limiter + `deferredBacklog` + `flushQueue` — unchanged from current implementation
11. OpenCode session event handlers (`session.created`, `session.updated`, `session.status`, `session.idle`) — unchanged

---

## 6. Deployment sequence

All authoring steps (1–6) are performed by Claude-engineer in the single working tree at `/home/apnex/taceng/agentic-network/`. The LAN HTTP server at `http://192.168.1.241:8000/` makes the entire tree visible to OpenCode, read-only.

1. **Implement** the five new shared modules and adapter changes directly in `packages/hub-connection/src/`.
2. **Unit tests** for `m18-handshake.ts` (happy path, fatal code, malformed response, transport error) and `instance.ts` (first create, load existing, corrupted file regeneration, missing directory).
3. **Integration test** in `mcp-relay-hub/test/unit/m18-agent.test.ts` (or a new file) mounting the shared adapter against a mock Hub, verifying bare→enriched `register_role` sequence, response parsing, fatal-code callback, and epoch displacement logging.
4. **Version bump** `@apnex/hub-connection` to `1.4.0`. Whether this is a workspace-path import or a published package determines whether step 4 is just a rebuild or an actual `npm publish`. See risk § 7.6 — I must resolve this before step 5.
5. **Claude-engineer rewrite** — rewrite `claude-engineer/src/hub-proxy.ts` to the ~150-line target, install new adapter, build, smoke test locally (reconnect, verify `[M18] Registered as ...` appears in log with new structured format, verify channel push still works).
6. **OpenCode rewrite (authored by me)** — rewrite `.opencode/plugins/hub-notifications.ts` to the ~300-line target in the local tree. I do not run it — I just produce the file. I also stage any required adjacent changes (e.g. updated `.opencode/plugins/package.json` if the adapter import path changes).
7. **OpenCode mirror** — OpenCode machine pulls the updated files over the LAN:
   ```bash
   # From the OpenCode machine, in its local agentic-network checkout:
   wget -r -np -nH -R "index.html*" \
     http://192.168.1.241:8000/packages/hub-connection/ \
     http://192.168.1.241:8000/.opencode/plugins/
   ```
   OpenCode then runs `bun install` in the plugin directory (or wherever the adapter resolves from), restarts the OpenCode CLI, and tails its notification log.
8. **OpenCode smoke test** — confirm `[M18] Registered as eng-XXXX (epoch=1, newly created)` appears in the new structured log file; confirm `promptAsync` still wakes the session on an actionable event; confirm the local Bun.serve proxy + `sendToolListChanged` still work.
9. **Hub verification** — architect calls `get_engineer_status`, expects to see a new OpenCode engineer ID distinct from both `eng-10` (legacy) and my `eng-6889bc8b6932`. The old `eng-10` should be marked disconnected and reaped by the Hub session TTL (if the reaper is working; see risk § 7.1).
10. **Re-run isolation probes** (Task D) — two targeted directives, one to each engineer's current M18 engineerId. Verify each engineer receives exactly its own directive, cross-checked in both structured notification logs via taskId.
11. **Success criterion:** the empirical isolation test passes with both engineers running identical shared-adapter code.

---

## 7. Open questions and risks

### 7.1 Is the Hub session TTL reaper working?

Thread-52 was titled *"Critical Bug: Hub Session TTL Reaper Failure"* and appears `closed`, but I have not verified the fix is deployed. If the reaper is broken, the legacy `eng-10` pre-M18 record will persist indefinitely alongside OpenCode's new M18 record, polluting `get_engineer_status`. Before declaring the refactor done, confirm by reading `mcp-relay-hub/src/state.ts` or `gcs-state.ts` for the reaper logic and check its last-modified timestamp. If broken, that's a separate fix that must land first or in parallel.

### 7.2 Will the Hub reject an M18 handshake for a token that already has a pre-M18 record?

Inspect `mcp-relay-hub/src/policy/session-policy.ts` before deploy. Candidate failure modes:

- Hub sees two registrations under the same token and returns `role_mismatch` → the new OpenCode registration fatal-halts. Mitigation: reap `eng-10` manually first, or loosen the policy to allow one pre-M18 + one M18 coexistence during migration.
- Hub accepts both and silently keeps the pre-M18 record warm → no error, but `eng-10` becomes a zombie. Mitigation: deploy the reaper fix in parallel.
- Hub auto-migrates the old record to the new fingerprint → best case, no zombie. Unlikely without explicit migration code.

### 7.3 Will the `get_engineer_status` projection still return a confusing `sessionId` field?

Even after the refactor, the Hub's projection may still surface a misleading `sessionId` value. This caused tonight's confabulation chain. I recommend a separate Hub-side cleanup task: either remove the field from the projection or rename it to reflect what it actually represents (e.g., `authTokenSession`, `initialSessionId`, etc.). Not blocking the refactor, but worth a follow-up.

### 7.4 Does the `classifyEvent` wrapper in OpenCode still make sense?

OpenCode currently maps `unhandled` → `informational` to avoid dropping events. Claude-engineer does not. This is a policy difference. Preserve OpenCode's behavior by keeping the wrapper local, or lift it to shared with a `classifyMode: "strict" | "permissive"` config option. Minor — not blocking.

### 7.5 Does `InitializeRequestSchema` override in Claude's `hub-proxy.ts` break MCP handshake correctness?

The current code (lines 611-631) overrides the default `initialize` handler to capture `clientInfo`. The comment acknowledges this is subtle: the SDK's low-level `Server` normally handles `initialize` internally. The override returns a handcrafted response. If the SDK is updated, this may break. Safer approach: add an SDK-level hook or use a request-interception middleware pattern. Not blocking — the current implementation works against the current SDK version.

### 7.6 Workspace vs published package resolution for `@apnex/hub-connection`

The import `from "@apnex/hub-connection"` could resolve via npm registry, local workspace, or path-based `node_modules` link. Determine which by reading the root `package.json` or workspace config. This is the **single most important open question for the revised single-author delivery model**, because it decides what OpenCode has to mirror:

- **If workspace-path** (`"@apnex/hub-connection": "workspace:*"` or `"file:../packages/hub-connection"`): OpenCode must mirror the entire `packages/hub-connection/` directory (including its built `dist/`) plus the plugin file. OpenCode's `bun install` will then relink the local path.
- **If published**: I publish `@apnex/hub-connection@1.4.0` to whatever registry the project uses; OpenCode only needs the plugin file and runs `bun install` to pull the new adapter version from the registry. No `packages/` mirror required.
- **If pre-built `node_modules` commit**: neither — both engineers would need the `node_modules/@apnex/hub-connection/` directory mirrored. Unlikely but possible.

I must resolve this in step 4 before I can give OpenCode a correct `wget` command list in step 7.

### 7.7 Test harness readiness

Does `mcp-relay-hub/test/` have a mock Hub harness suitable for testing the shared adapter's M18 handshake in isolation? I saw `mcp-relay-hub/test/unit/m18-agent.test.ts` exists, which is promising, but I did not audit it. If the harness is Hub-side only, we may need to add a client-side test file in `packages/hub-connection/test/` or equivalent.

### 7.8 Rollback plan

If the refactor breaks in production, rollback is: revert `@apnex/hub-connection` to `1.3.0`, revert both engineer shims. The downside is that Claude-engineer's current M18 code in `hub-proxy.ts` is working today — reverting it means temporarily losing M18 on Claude. Mitigation: keep the Claude-local M18 code in a feature-flagged branch until the shared version is proven stable, then delete.

---

## 8. What is explicitly out of scope

- Fixing any real or imagined bug in the Hub's SSE push-path routing. We do not have evidence that such a bug exists on a symmetric two-M18-engineer configuration. The refactor should establish that symmetric configuration first; only then can routing bugs be tested for.
- Renaming the `sessionId` field in `get_engineer_status`. Follow-up.
- Fixing the Hub session TTL reaper (unless § 7.1 investigation reveals it's broken, in which case handle in parallel).
- Extracting the adapter as a standalone npm-published SDK (`@apnex/claude-engineer-proxy` or similar). That was discussed in thread-78 and deferred — still deferred.
- Adding `revision_required` actionable-payload inspection in the proxy as a defensive belt-and-braces against Hub FSM violations (discussed in thread-78). Follow-up.
- Any ADR writing. The refactor is faithful to existing ADR-008 (shared adapter decoupling); no new ADR is required unless the M18 payload shape changes.

---

## 9. Mission decomposition (single-author revised)

Two tasks. The first is mine end-to-end. The second is architect-driven.

**Task AUTHORING — Shared refactor + both engineer rewrites (~4-5 hours, assigned to me)**

Pre-requisite: resolve § 7.6 (workspace vs published) before step 4.

Subphases, executed serially in one working tree:

1. Shared package: create the five new files in `packages/hub-connection/src/`, modify `client-shim.ts` + `index.ts`, add unit + integration tests, bump version to `1.4.0`, rebuild (and publish iff § 7.6 says so).
2. Claude-engineer: rewrite `claude-engineer/src/hub-proxy.ts` to ~150 lines, install, build, smoke test locally. Verify `[M18] Registered as ...` in the new structured format and that channel push still works. Report this as interim evidence before touching OpenCode code.
3. OpenCode authoring: rewrite `.opencode/plugins/hub-notifications.ts` to ~300 lines against the same adapter version. Do not run it — I have no OpenCode runtime. Produce the file, cross-check it against the freshly-working Claude version for API consistency, and stage any adjacent changes (plugin `package.json`, etc.).
4. Produce the exact `wget` command list OpenCode needs for the mirror, derived from § 7.6 resolution.
5. Report completion with: commit/hash (if applicable), the `wget` command list, expected log lines OpenCode should see post-mirror, and rollback steps.

**Task MIRROR+VERIFY — OpenCode pull + empirical isolation test (~1 hour, OpenCode + architect)**

Pre-requisite: Task AUTHORING reported complete.

1. OpenCode runs the supplied `wget` mirror, `bun install`, restarts the CLI, tails its new structured notification log.
2. OpenCode reports its new `engineerId` and `globalInstanceId` from the first `[M18] Registered as ...` line; confirms the Bun.serve proxy + tool sync still work.
3. Architect calls `get_engineer_status` and confirms two engineers with distinct M18 engineerIds and distinct `globalInstanceId`s. Legacy `eng-10` should be disconnected/reaped.
4. Architect issues two targeted directives, one to each M18 engineerId.
5. Each engineer reports receipt in its structured notification log. Success criterion: each engineer received exactly its own directive with matching taskId, verifiable in both logs.
6. Architect closes the mission.

**Why not parallelize?** Not applicable under single-author delivery — the authoring phase is serial by construction, and OpenCode cannot begin its mirror until I have produced the authored files.

---

## 10. Items architect should NOT do

Some things from tonight's session that architect offered to do and should specifically **not** do without Director authorization:

1. **Do not issue a "Hub hotfix" task modifying `mcp-relay-hub/src/policy/session-policy.ts` or `mcp-relay-hub/src/notifyConnectedAgents`** based on the "push-path broadcast bug" theory. That theory was a conclusion architect and I jumped to before auditing the code. We do not yet know there is a push-path bug at all, because we never ran the test with two symmetric M18 engineers.
2. **Do not trust the `sessionId` field from `get_engineer_status` as evidence of connection sharing.** OpenCode's real transport session is `ses_2720...`, not the `c428e592-...` UUID that the Hub projection returns. That field means something else.
3. **Do not quote specific numeric values (timestamps, engineer IDs, sessionEpochs) in responses without a fresh tool call.** Every numeric hallucination in tonight's session was a memory-recall of a plausible-sounding value rather than a live query. If the value matters, verify it.
4. **Do not re-open thread-78 or reuse any task IDs from the 145/146/147/150/155/156/157 series.** Start fresh — new thread, new task numbers — to avoid contaminating this work with stale context from the earlier confabulation chain.
5. **Do not assign parallel engineer tasks for authoring.** Under the revised single-author delivery model (§ 1.1), all code is authored by me in one working tree and mirrored to OpenCode via LAN HTTP. Architect should create **two** tracking artifacts only: one for AUTHORING (owner: me) and one for MIRROR+VERIFY (owner: OpenCode + architect). Creating separate Claude/OpenCode authoring tasks re-introduces the dual-implementation drift risk the new delivery model exists to eliminate.

---

## 11. Appendix: minimal reproduction of tonight's finding

For anyone picking this up cold who wants to verify the core finding themselves:

```bash
# 1. Confirm M18 code is not in the shared adapter
grep -rn "M18\|globalInstanceId\|fingerprint" packages/hub-connection/src/
# Expected: no matches

# 2. Confirm M18 code IS in Claude-engineer
grep -c "M18\|globalInstanceId" claude-engineer/src/hub-proxy.ts
# Expected: double-digit matches

# 3. Confirm OpenCode has no M18 code
grep -c "M18\|globalInstanceId" .opencode/plugins/hub-notifications.ts
# Expected: zero

# 4. Confirm the shared adapter's only handshake is the bare role registration
grep -n "register_role" packages/hub-connection/src/mcp-connection.ts
# Expected: one match, calling register_role with only { role } — no other fields
```

If all four expectations hold, the finding is confirmed and this mission brief is actionable.

---

*End of mission brief.*
