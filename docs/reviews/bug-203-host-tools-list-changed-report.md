# bug-203 — claude-code MCP host does not honor mid-session `notifications/tools/list_changed`

**Status:** OPEN · major · host-side (upstream Anthropic), NOT adapter-fixable.
**Confirmed:** 2026-06-29, both claude-code sessions (lily + greg), claude-code `2.1.195`, network-adapter `0.1.4` / claude-plugin `0.1.10` (`567ccd6`, with the ToolSurfaceReconciler #375).
**Author:** lily (architect). Companion to `docs/reviews/bug-180-rootcause-tool-surface-host-reenumerate-gap.md` (bug-180 = the adapter-side cache, RESOLVED; bug-203 = the residual host-side gap).

## Symptom
New Hub MCP verbs (registered Hub-side) are unreachable to a *running* claude-code session — even with the adapter rebuilt to re-enumerate them — until a full client restart **with the startup caches cleared**.

## Root cause
The claude-code MCP host does not act on `notifications/tools/list_changed`. The adapter's tool-surface reconciler (#375) correctly **detects** Hub tool-surface drift and **emits** `tools/list_changed`, but the host ignores it mid-session — it never re-fetches `tools/list`. Tools added after the host's one-shot connection-time enumeration therefore never surface in that session.

## Evidence (this session, end-to-end)
- Reconciler fired + emitted `list_changed` on identityReady — drift `f96c6bd56a1a0f32` (stale) → `6aaaf3e8a90ccee4` (live, blueprint-bearing) — on BOTH sessions @~02:05Z.
- Neither claude-code session re-enumerated at the next turn boundary; exact-name lookup of `seed_blueprint` / `get_current_stint` / `legal_moves` returned **empty** *after* the emit, on both sessions.
- The verbs surfaced **only** via the startup-bootstrap path: clear the adapter `.ois/tool-catalog.json` (pinned at the stale `f96c6bd`) + the plugin marketplace cache (`~/.claude/plugins/cache/agentic-network`, build `8556b99`) → full restart → startup enumeration bootstrapped the live surface (greg's shim log: `[ListTools] no cache (bootstrapping cache from Hub) → bootstrap completed: 84 tools surfaced` @02:18Z) → verbs present + `seed_blueprint` dryRun = `valid:true`.
- **Contrast:** the OpenCode host (steve, opencode-plugin `0.2.1`) honors `list_changed` correctly on the same adapter generation — confirming this is **host-specific to claude-code**, not an adapter defect.

## Impact
Mid-run Hub-verb additions (e.g. the stint-5 `seed_blueprint` + cold-start spine) are invisible to a running claude-code session. Activation requires a disruptive dance: rebuild/stage adapter → swap → restart → clear `.ois/tool-catalog.json` + plugin cache → restart again. This cost ~2 restart cycles to realise blueprints for the idea-389 autonomous-review seed.

## Workaround (confirmed reliable)
Startup-bootstrap-fresh: clear `.ois/tool-catalog.json` + the plugin marketplace cache, then restart. The startup enumeration (which the host *does* honor) bootstraps the live Hub surface. (`scripts/local/swap-staged-adapter.sh` handles the dir-swap; the cache-clears are manual today.)

## Upstream ask (Anthropic)
Have the claude-code MCP host honor `notifications/tools/list_changed` mid-session (re-fetch `tools/list` on the notification) so dynamically-added MCP tools surface without a restart.

## Fix-by-construction (our side, parked)
- **idea-392** — marketplace-plugin live auto-refresh / sovereign-consumer / no-stale-caches (opencode-parity).
- **idea-391** — system CLI → Hub REST seed-path that sidesteps the MCP tool-surface entirely (the durable seed-channel; the MCP-tool path is host-fragile).
