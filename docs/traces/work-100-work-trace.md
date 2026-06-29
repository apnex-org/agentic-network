# work-100 work-trace — adapter rebuild + STAGE (stint-6 prep, Phase-A A3)

**Owner:** greg (engineer). **Target:** idea-389 (autonomous strategic-review as a live blueprint). **Gate:** lily ack.
**Constraint:** STAGE ONLY — do NOT restart (Phase B = the client restart; restarting now ends the live Director session).

## Root cause (confirmed)
Deployed adapter = `8556b99` (= release v0.1.9; the running proxies + cache both at 8556b99). It is **11 adapter/plugin commits behind main**, missing the kernel **ToolSurfaceReconciler** (`#375` db8248f) + bug-160/171/173. The adapter tool surface is **DYNAMIC** (Hub-driven; no baked catalog — `dist/` is just shim.js + hooks). The verbs are Hub-side (`hub/src/policy/work-item-policy.ts`). Without the reconciler, the dispatcher serves a stale on-disk tool-catalog-cache on the pre-identity probe path and never re-enumerates on `toolSurfaceRevision` drift → a Hub-added verb (seed_blueprint) stays invisible **even post-restart** (lily's symptom). Rebuild from main = adds the reconciler = the fix.

## Build + stage (DONE)
- No newer release exists (latest = v0.1.9 = 8556b99), so **local build from current main**.
- Isolated worktree `/home/apnex/taceng/cp-build-main` @ `db2e64e`. Built via `scripts/build/lib/prepack-claude-plugin.sh`.
- **Version-honesty gate** (idea-355 SLICE-3 / bug-182) blocked the pack: claude-plugin src advanced past the 0.1.9 bump. Bumped `0.1.9 → 0.1.10` on branch `agent-greg/claude-plugin-vbump-stint6` (`567ccd6`, pushed). Skip-gate (`OIS_SKIP_VERSION_ASSERT=1`) would've shipped a dishonest 0.1.9 — rejected.
- Tarball `apnex-claude-plugin-0.1.10.tgz` → **staged ADJACENT** at `/home/apnex/apnex-claude-plugin/package-staged-567ccd6` (npm `--no-save` resolved; runnable). build-info `567ccd6` / v0.1.10. Reconciler present in bundled network-adapter.

## Verification (build-verified; surface is dynamic so no live list-tools)
- Provenance: build-info `commitSha 567ccd6` (db2e64e + bump). Reconciler in `node_modules/@apnex/network-adapter/dist/tool-manager/tool-surface-reconciler.js`.
- Hub registry (db2e64e `work-item-policy.ts`): `seed_blueprint` (743) ✓, `get_current_stint` (764) ✓, `legal_moves` (773) ✓. **`get_next` NOT a Hub MCP tool on current main** — flagged to lily (intended name?).
- Did NOT run a live list-tools (would need a 2nd proxy under greg's identity → risks the live session). Verbs materialize empirically at the Phase-B restart.

## CRITICAL staging-mechanics finding
The running proxies (PID 4727 = this session, 4853 = the other live session) execute **directly from the marketplace dir** `/home/apnex/apnex-claude-plugin/package//dist/shim.js`, NOT the cache (cache is vestigial for a directory-source plugin). So an in-place swap/`rm` of `/package` during Phase A risks disrupting the live sessions (lazy-load) = the catastrophe. → staged ADJACENT, live `/package` 100% untouched (still 8556b99). The in-place swap is **restart-adjacent (Phase B)**.

## Phase-B activation (turnkey; operator, at the client-pair restart)
```
mv /home/apnex/apnex-claude-plugin/package /home/apnex/apnex-claude-plugin/package-old-8556b99
mv /home/apnex/apnex-claude-plugin/package-staged-567ccd6 /home/apnex/apnex-claude-plugin/package
# relaunch the client pair (full Claude Code exit+relaunch; bug-203 no hot-reload)
```
(cache-clear optional — proxy runs from the dir.) Rollback = reverse the mv.

## Status
Phase-A complete + reported to lily (3 findings: get_next, version-bump PR, adjacent-stage/Phase-B-swap). Holding work-100 in_progress + lease for her ack → then complete_work. Branch pushed; cp-build-main worktree retained until completion (in case of rework).
