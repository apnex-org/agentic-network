# OpenCode Mirror + Smoke Test Handoff

**Author:** Claude-engineer (`eng-6889bc8b6932`)
**Date:** 2026-04-15
**Refers to:** `mission-brief-shared-adapter-refactor.md`
**Precondition:** Task AUTHORING complete (shared adapter refactor + both engineer rewrites).

---

## What changed on the Claude machine

The single working tree at `/home/apnex/taceng/agentic-network/` on the Claude machine now contains:

1. **`packages/hub-connection/` — version 1.4.0** (was 1.3.0)
   - Five new source files:
     `src/instance.ts`, `src/m18-handshake.ts`, `src/state-sync.ts`, `src/prompt-format.ts`, `src/notification-log.ts`
   - Updated: `src/client-shim.ts` (extended `AdapterConfig` with optional `m18` config block; adapter now auto-invokes M18 handshake + state sync on entry to `synchronizing`)
   - Updated: `src/index.ts` (re-exports all new primitives)
   - Updated: `package.json` version → `1.4.0`
   - Built artefacts in `dist/`
   - Tarball at `packages/hub-connection/ois-hub-connection-1.4.0.tgz`
   - New tests: `test/unit/m18-handshake.test.ts`, `test/unit/instance.test.ts` (25 new + 19 existing passing = 44/44 on quick suite)

2. **`claude-engineer/src/hub-proxy.ts`** — rewritten from 681 → 287 lines. All M18/identity/state-sync/observability lifted to shared package. Package.json updated to reference `ois-hub-connection-1.4.0.tgz`. Built clean.

3. **`.opencode/plugins/hub-notifications.ts`** — rewritten from 803 → 586 lines. Shared adapter now owns: M18 handshake, state sync, notification logging, prompt formatting. Plugin retains: rate limiter, deferred backlog, Bun.serve proxy, tool discovery sync, OpenCode session event hooks. **`onFatalHalt` does NOT call `process.exit`** — exiting would kill the whole OpenCode TUI. Instead it logs + toasts; the plugin goes inert until OpenCode restarts.

4. **`.opencode/package.json`** — **unchanged.** OpenCode uses a directory-path install (`"@apnex/hub-connection": "file:../packages/hub-connection"`), so mirroring the directory and re-running `bun install` will automatically pick up 1.4.0.

---

## OpenCode mirror commands

**LAN HTTP server** is running on Claude machine at `http://192.168.1.241:8000/` (read-only mirror of the entire `agentic-network/` tree).

From the OpenCode machine, in its local `agentic-network/` checkout:

```bash
# 1. Backup current plugin + package state (rollback safety).
cp .opencode/plugins/hub-notifications.ts .opencode/plugins/hub-notifications.ts.bak
cp .opencode/package.json .opencode/package.json.bak
cp -r packages/hub-connection packages/hub-connection.bak

# 2. Mirror the updated shared package (including built dist/).
rm -rf packages/hub-connection
wget -r -np -nH -R "index.html*" \
  -P packages/hub-connection/ \
  --cut-dirs=2 \
  http://192.168.1.241:8000/packages/hub-connection/

# If your wget version does not support --cut-dirs semantics you need, the
# simpler alternative is:
#
#   rm -rf packages/hub-connection
#   mkdir -p packages/hub-connection
#   cd packages/hub-connection
#   wget -r -np -nH -R "index.html*" --cut-dirs=2 \
#     http://192.168.1.241:8000/packages/hub-connection/
#   cd ../..
#
# Verify afterwards:
ls packages/hub-connection/dist/index.js    # must exist
ls packages/hub-connection/package.json     # version should be 1.4.0
ls packages/hub-connection/ois-hub-connection-1.4.0.tgz

# 3. Mirror the updated plugin source.
wget -O .opencode/plugins/hub-notifications.ts \
  http://192.168.1.241:8000/.opencode/plugins/hub-notifications.ts

# 4. Re-install dependencies (bun will relink the directory path and pick up 1.4.0).
cd .opencode
bun install
cd ..

# 5. Restart OpenCode.
#    Exit OpenCode fully, then relaunch it from the project root.
```

**Do NOT wget the `node_modules/` directory** from the Claude machine. Each machine's `bun install` resolves its own native binaries. Mirror the source only.

---

## Expected log lines after restart

Tail `.opencode/hub-plugin.log` on the OpenCode machine:

```bash
tail -f .opencode/hub-plugin.log
```

You should see, in order (timing approximate):

```
<iso> Phase 15 — Shared-adapter refactor (@apnex/hub-connection@1.4.0)
<iso> Auto-prompt: enabled
<iso> Tracking session: ses_xxxx...
<iso> [M18] globalInstanceId=<new-uuid>                     ← NEW (never appeared in old logs)
<iso> ConnectionManager instance created [<8-char-id>]
<iso> State: disconnected → connecting
<iso> Connection: disconnected → connecting
<iso> MCP session initialized
<iso> Registered as engineer                                ← bare handshake (adapter layer)
<iso> State: connecting → synchronizing
<iso> Connection: connecting → synchronizing
<iso> [M18] Registered as eng-<fingerprint> (epoch=1, newly created)   ← NEW (M18 handshake)
<iso> [StateSync] Starting state sync...
<iso> [StateSync] Pending actions: 0
<iso> [StateSync] Sync complete — now streaming
<iso> State: synchronizing → streaming
<iso> [ToolSync] Initial tool hash: <hash> (44 tools)
<iso> [ToolSync] Sent tools/list_changed to proxy server
<iso> Local proxy server listening on 127.0.0.1:<port>
<iso> Registered proxy as 'architect-hub' MCP server
<iso> Fully initialized
<iso> SSE stream verified (first keepalive received)
```

**Also tail the new structured notification log:**

```bash
tail -f .opencode/hub-plugin-notifications.log
```

This file is NEW — it didn't exist before. It will start empty but populate with structured multi-line blocks every time a Hub event arrives, including task IDs:

```
[YYYY-MM-DD HH:MM:SS] DIRECTIVE_ISSUED
  Task: task-XXX "Task title here"
  Action: Pick up with get_task

```

This closes the telemetry gap from 2026-04-14.

---

## Smoke test checklist

After restart, confirm:

- [ ] `[M18] globalInstanceId=<uuid>` line present in `hub-plugin.log`
- [ ] `[M18] Registered as eng-<fingerprint> (epoch=<n>...)` line present
- [ ] `[ToolSync]` runs and reports tool count ≥ 1
- [ ] `Local proxy server listening on 127.0.0.1:<port>` (Bun.serve unchanged)
- [ ] `Registered proxy as 'architect-hub' MCP server` (OpenCode MCP registration unchanged)
- [ ] The new file `.opencode/hub-plugin-notifications.log` exists (may be empty)
- [ ] In the OpenCode TUI, running a tool like `architect-hub_list_tasks` or similar still works end-to-end

**Report the new `engineerId` and `globalInstanceId` values back** — architect needs them to issue the empirical isolation probes in Task MIRROR+VERIFY step 4 of the mission brief.

---

## Rollback

If anything is broken:

```bash
rm -rf packages/hub-connection
mv packages/hub-connection.bak packages/hub-connection
mv .opencode/plugins/hub-notifications.ts.bak .opencode/plugins/hub-notifications.ts
mv .opencode/package.json.bak .opencode/package.json
cd .opencode && bun install && cd ..
# Restart OpenCode
```

On the Claude machine, rollback is:

```bash
cd claude-engineer
# revert package.json dep to ois-hub-connection-1.3.0.tgz
# restore src/hub-proxy.ts from a backup or the bytecode in dist/
npm install
npm run build
```

(Claude-engineer does not currently have an automatic backup; the 1.3.0 tarball is still present alongside 1.4.0.)

---

## Architect-side steps (after OpenCode confirms)

Per mission brief § 9 Task MIRROR+VERIFY, once OpenCode reports the new identifiers:

1. Architect calls `get_engineer_status` → expect to see:
   - `eng-6889bc8b6932` (Claude, unchanged) with its globalInstanceId `7145d1c9-a796-4a01-b380-94762864e8bf`
   - A NEW OpenCode engineerId (e.g. `eng-XXXXXXXX`) with its NEW globalInstanceId
   - `eng-10` (legacy, pre-M18) should be disconnected and ideally reaped by the Hub's session TTL
2. Architect issues two targeted directives, one `engineerId` each.
3. Each engineer reports receipt in its structured notification log (`.ois/claude-notifications.log` on Claude; `.opencode/hub-plugin-notifications.log` on OpenCode). Each must see ONLY its own taskId.
4. If both engineers each receive exactly their own directive → mission success, close the mission.
5. If either engineer receives the other's directive → genuine routing bug in the Hub push path. That is a separate Hub-side mission (see brief § 7.2, § 10 item 1).

---

## Known risks (from mission brief § 7)

- **§ 7.1** Hub session TTL reaper may not have been fixed. If `eng-10` doesn't disappear within the expected TTL, do NOT assume the new M18 OpenCode engineer is broken — investigate reaper separately.
- **§ 7.2** Hub may return `role_mismatch` when the OpenCode M18 handshake hits a token that already has a pre-M18 record. If that happens, the `onFatalHalt` path in the new plugin will log `[FATAL:role_mismatch]` and toast — investigate Hub-side policy before retrying.
- **§ 7.5** Claude's `InitializeRequestSchema` override is preserved verbatim from the old code. If `clientInfo` capture breaks, `[M18] Captured clientInfo: unknown@0.0.0` will appear instead of the real values.

---

## Version reference

- Shared: `@apnex/hub-connection@1.4.0`
- Claude proxy: `@apnex/claude-engineer@1.0.0` (hub-proxy.ts self-reports `PROXY_VERSION = 1.1.0`)
- OpenCode plugin: `@apnex/opencode-plugin` (self-reports `PROXY_VERSION = 4.1.0`)

End of handoff.
