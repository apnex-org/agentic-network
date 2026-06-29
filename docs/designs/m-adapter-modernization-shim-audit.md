# Shim + kernel ground-truth audit — existing claude+opencode adapters (2026-06-29)

**Method:** delegated spec-level audit (agent a06e7b9, 169k tokens, 25 tool-uses) of the EXISTING per-harness shims + shared kernel, mapped to the M-Adapter-Modernization target decomposition. INSPIRATION/ground-truth for the brainstorm — companion to `m-adapter-modernization-brainstorm.DRAFT.md`.

## 1. Package layout — 3 shared packages + 2 shims (5 npm packages, one monorepo)
The Director's "TWO LAYERS, ONE PACKAGE PER HARNESS" framing is the CONCEPTUAL view; physically the kernel-layer is three packages.
- **Kernel:** `@apnex/network-adapter` v0.1.4 (`packages/network-adapter/`) — wire (`src/wire/`), session/kernel FSM (`src/kernel/`), tool-manager (`src/tool-manager/`).
- **Shared #2:** `@apnex/message-router` v0.1.2 (`packages/message-router/`) — kind/subkind dispatch, `SeenIdCache` LRU push+poll dedup, `NotificationCoalescer`, the `AgentEvent/SessionState` payload union (relocated here per bug-160 to break the L2↔L4 cycle; kernel re-exports).
- **Shared #3:** `@apnex/cognitive-layer` v0.1.2 (`packages/cognitive-layer/`) — ADR-018 opt-in middleware chain (cache/dedup/circuit-breaker/error-normalize/telemetry).
- **Claude shim:** `@apnex/claude-plugin` v0.1.9 (`adapters/claude-plugin/`).
- **OpenCode shim:** `@apnex/opencode-plugin` v0.2.1 (`adapters/opencode-plugin/`).
- (`packages/repo-event-bridge` + `packages/storage-provider` are Hub-side, not adapter.) Stale `ois-*-{2.0.0,1.0.0,0.1.0}.tgz` tarballs in the adapter dirs = legacy `@ois`-namespace artifacts, not the live path.

## 2. Last-mile injection per harness (the PUSH membrane) — CONFIRMED
Both shims receive Hub pushes identically via the kernel SSE leg; they diverge ONLY in the final native landing — exactly the "last hop" the invariant confines.
- **Claude-code:** shim is an **stdio MCP server** (`.mcp.json` → `node dist/shim.js`; server `proxy` under plugin `agent-adapter` → hence `mcp__plugin_agent-adapter_proxy__*`). Injection into the live turn = a **custom MCP server→client notification** `notifications/claude/channel` (declared as server capability `experimental:{"claude/channel":{}}`; `adapters/claude-plugin/src/notification-surface.ts:70`, `shim.ts:487`). NOT a literal plugin, NOT tmux/stdin. Director's "SSE+runtime-flag" read was half-right: kernel↔Hub leg is SSE; the adapter→claude landing is the MCP server-notification. **Resolves the pilot lead-unknown; confirms claude needs NO literal plugin (heavier/optional, not universal).**
- **OpenCode:** IS a literal OpenCode plugin (`export const HubPlugin: Plugin` from `@opencode-ai/plugin`; `plugin-entry.ts` → `shim.ts:701`). Inject API = OpenCode SDK **`session.promptAsync`** in two flavors (`shim.ts:262-298`): `promptLLM` (text part = actionable wake) + `injectContext` (`noReply:true` = silent informational), plus `tui.showToast`. NOT literally named `injectLLM`. Tool surface = a **separate** local HTTP MCP server (`Bun.serve` + streamable-HTTP at `127.0.0.1:<port>/mcp`, registered via `sdkClient.mcp.add`).
- **Asymmetry:** claude folds tool-surface AND injection through ONE MCP channel; opencode SPLITS them (HTTP-MCP for tools, SDK promptAsync for injection). OpenCode paces via `NotificationCoalescer`; claude wires hooks directly, no coalescer.
- **Capability-matrix seed:** `injection-mechanism: { mcp-server-notification (claude) | plugin-hook/session.promptAsync (opencode) | tmux-fallback }`.

## 3. Kernel vs shim split + the L1 resilience question (HEADLINE)
**Split today:** kernel holds the ENTIRE connection — `McpAgentClient` (`src/kernel/mcp-agent-client.ts`) owns the session FSM (`disconnected→connecting→synchronizing→streaming→reconnecting`), handshake, state-sync, dedup, event classification/routing; `McpTransport` (`src/wire/mcp-transport.ts`) owns the wire (MCP SDK `Client` + `StreamableHTTPClientTransport`), SSE liveness, heartbeat. Shims hold only host glue (stdio vs Bun.serve, config injection, the last-hop landing, telemetry sinks). **Already close to fat-kernel/thin-shim.**

**Auto-reconnect/self-heal EXISTS in source — contrary to the lived "wedge":**
- Wire: `McpTransport.reconnectWire()` rebuilds the SDK client on SSE-watchdog gap (90s), missed first-keepalive, heartbeat-POST failure, peer-close, or transport error; exponential backoff (`computeReconnectBackoff`, base 5s cap 60s) that **retries FOREVER** (only `close()` stops it) — no permanent give-up in code.
- Session: on transport `reconnected`, `McpAgentClient` re-runs `runSynchronizingPhase()` (re-handshake + state-sync) (`:454-457`); plus `session_invalid` retry-once on `call()`, a SyncBuffer so half-bound sessions don't leak events, bug-108 reconnect-drain of pending actions.
- Backups: `PollBackstop` (5-min `list_messages` catch-up for notes missed offline) + 30s `transport_heartbeat` (mission-75 TTL liveness); opencode adds `session.idle → if !isConnected → start()` reconnect cue.

**So why did the proxy wedge (no auto-reconnect → manual kill+restart)?** Evidence points AWAY from "missing code" toward **stale-deployed-build + provenance**: running adapter was directory-source and could lag HEAD (bug-203 report documents a parallel "deployed build 11 commits behind, missing reconciler #375"); both `mcp-agent-client.ts:30-33` and `mcp-transport.ts:5-10` still carry **stale "no consumer uses this yet / McpConnectionManager stays intact" comments** even though `McpConnectionManager` is **DELETED** and both shims construct `McpAgentClient` at runtime. **Spec-level finding: connection-resilience is substantially IMPLEMENTED but neither chaos-validated nor provenance-guaranteed — the wedge is most plausibly a stale/dirty build (or an uncovered edge like keepalives-flowing-but-session-dead), NOT absent reconnect logic.** "Build L1 from scratch" would over-scope; the real work is "harden + verify + GUARANTEE-the-deployed-version" — which is exactly the reproducible-image + L2-supervision framing.

## 4. Creds / token sourcing today
- **Hub token + URL + role + labels:** `loadConfig` (`src/kernel/adapter-config.ts`) reads `<dir>/.ois/adapter-config.json` then env overrides `OIS_HUB_URL/OIS_HUB_TOKEN/OIS_HUB_ROLE/OIS_HUB_LABELS` (precedence defaults < file < env). Token lives in a FILE (`.ois/adapter-config.json`) and/or an ENV var (exposure window). (NOT `hub-config.json`.)
- **Identity:** `OIS_AGENT_NAME` env, REQUIRED (`handshake.ts:263`); operators set it in `~/.config/apnex-agents/{name}.env`.
- **LLM API creds + git creds:** **NOT an adapter concern today at all.** Adapter sources only Hub token + agent name + labels; LLM auth is the host's own (Claude Code / OpenCode), git is shell-env. → The entire 4-stage cred pipeline + OAuth-refresh-in-kernel + pull-creds-over-channel is **NET-NEW target**, not current state.

## 5. Distribution / install today
- **Directory-source in practice** (npm workspaces, `@apnex/*:"*"`) = the `sdkDirty` provenance-impurity.
- **npm-publish path EXISTS but under-exercised:** `scripts/publish-packages.sh` (topological) + `scripts/version-rewrite.js` (`"*"`→`"^X.Y.Z"` at pack-time, since npm lacks `workspace:^`) + root `prepublishOnly/postpublish` hooks.
- **`update-adapter.sh` exists (mission-64):** `scripts/local/update-adapter.sh` — `npm install -g @apnex/claude-plugin@latest` + legacy `@ois/*` cleanup + bundled `install.sh` + a `result=…version=…source=…elapsed_ms=…` summary. **Claude-only — no opencode equivalent.**
- **Version-honesty / sdkDirty mechanism BUILT (bug-184/idea-256):** `write-build-info.js` (prepack) → `dist/build-info.json` (`commitSha/dirty/branch/buildTime`); `build-identity.ts`; forwarded via handshake `clientMetadata` → Hub `deriveAdvisoryTags` → `get_agents` (`SHIM_COMMIT`/`ADAPTER_COMMIT` + `sdkVersion`/`shimVersion`). opencode inlines `__NETWORK_ADAPTER_VERSION__` at esbuild-bundle (bug-183 fix). **Signal is honest; the dev WORKFLOW still produces dirty/unpinned builds — that's the gap.**

## 6. Tool-surface registration + bug-203
- **Discovery:** claude — host MCP `initialize`/`tools/list` against the stdio server; catalog persisted to `.ois/tool-catalog.json`. opencode — host enumerates the local HTTP MCP server; NO persistent catalog cache.
- **Mid-session drift handling BUILT kernel-side:** `ToolSurfaceReconciler` (`src/tool-manager/tool-surface-reconciler.ts`, #375) compares Hub `/health` `toolSurfaceRevision` vs applied, emits `notifications/tools/list_changed` on drift (driven by identityReady + heartbeat tick).
- **bug-203 REAL + claude-code-SPECIFIC (host/upstream, NOT adapter-fixable):** claude-code `2.1.195` does NOT act on mid-session `tools/list_changed` (never re-fetches `tools/list`); the adapter correctly emits, the host ignores. **OpenCode honors it correctly on the same adapter.** Workaround = clear `.ois/tool-catalog.json` + `~/.claude/plugins/cache/...` + restart (startup-bootstrap path the host DOES honor). → VALIDATES the Director decision: solve at the harness-container layer (cheap clean restart re-bootstraps); de-scope idea-391/392 from the critical path.

## Delta-map — existing vs target decomposition

**Per-harness package = (1) MANIFEST + (2) kernel-loaded HOOKS + (3) literal native INJECTION-PLUGIN**
| Target | Exists? | Delta |
|---|---|---|
| (1) Declarative manifest (command/env/capability-matrix/auth-order/injection-flags/dialect) | **No** — config is hardcoded TS per shim (claude `.mcp.json`+`stdio-mcp-proxy`; opencode `defaults`+`bun-serve-proxy`); no capability-matrix, no dialect, no auth-order data | **Biggest structural gap.** `loadConfig` already proves the seam (host injects dir/warn/defaults). Extract to a data manifest + 3-valued capability matrix; injection-mechanism field seeds from the 2 known values |
| (2) Kernel-loaded hooks (translateConfig/parseStatus) | **Partial/implicit** — host injects closures today (`getClientInfo`, `onFatalHalt`, `onHeartbeatTick`, warn sink, `loadConfig` defaults), not named/loaded-from-manifest | Formalize the injected closures into a named kernel-loaded hook contract. Mechanism exists; the discipline doesn't |
| (3) Literal injection-plugin (conditional) | **Yes opencode** (`HubPlugin`); **claude needs none** (MCP `notifications/claude/channel`) | Already matches target. Capture as capability-matrix `injection-mechanism` |

**Kernel = uniform resilient transport + auth-resolution + MCP↔Hub translation framework**
| Target | Exists? | Delta |
|---|---|---|
| Uniform resilient transport (reconnect/ack/retry/order) | **Largely yes** — reconnect+forever-backoff, re-handshake-on-reconnect, session_invalid retry-once, SyncBuffer ordering, dedup, Last-Event-ID replay (mission-56 W1b), bug-171 in-flight gate | Gaps: (a) NO explicit consumption-ACK on injected messages (best-effort render — scion-audit net-new); (b) not chaos-validated/guaranteed (the wedge); (c) stale "not-wired-yet" comments misrepresent maturity; (d) L2 process-supervision absent (container/watchtower layer) |
| Auth-resolution | **Minimal** — Hub token only, file-or-env, no refresh, no LLM/git creds | Build the 4-stage resolver (gather→overlay→resolve→fail-closed), token-from-file (0600), optional pull-over-channel — all net-new |
| MCP↔Hub translation framework | **Yes** — `dispatcher.ts` (Initialize/ListTools/CallTool), tier-filter, catalog cache, `ToolSurfaceReconciler`, internal-tier marker | Solid; carry-forward |

**Biggest gaps ranked:**
1. **Declarative manifest + capability-matrix + dialect** — the one genuinely-missing structural piece; everything else is "formalize what's injected."
2. **Distribution/provenance** — directory-source → pinned reproducible (npm-as-source baked into image); kill sdkDirty. Mechanism (publish + version-honesty) exists; reproducible-build discipline + deployed-version-guarantee don't. **This, not missing reconnect code, is the most likely true cause of the "wedge."**
3. **Resilience GUARANTEE not implementation** — L1 reconnect mostly exists; needs chaos-validation + a consumption-ack/ordered-queue on injection + stale-comment cleanup + the L2 supervisor it relies on.
4. **Auth pipeline** — net-new (file-tokens, refresh, LLM/git creds currently entirely outside the adapter).

**Load-bearing files:** resilience `packages/network-adapter/src/wire/mcp-transport.ts` + `src/kernel/mcp-agent-client.ts`; creds `src/kernel/adapter-config.ts` + `src/kernel/handshake.ts`; injection `adapters/claude-plugin/src/notification-surface.ts` + `adapters/opencode-plugin/src/shim.ts`; tool-surface `src/tool-manager/tool-surface-reconciler.ts`; distribution `scripts/local/update-adapter.sh` + `adapters/claude-plugin/install.sh` + `src/kernel/build-identity.ts`.
