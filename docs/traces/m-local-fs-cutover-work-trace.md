# M-Local-FS-Cutover — Work Trace (live state)

**Mission scope.** Mission-48 — migrate Hub state to local-fs as the laptop-Hub prod default. Hub container bind-mounts a host directory; state persists across container lifecycle. One-time GCS→local-fs bootstrap copy at cutover; manual reverse-sync on demand; no scheduled-sync mechanism. ADR-024 amendment in-scope (local-fs profile reclassification dev-only → single-writer-laptop-prod-eligible).

**Mission brief:** `get_mission(mission-48)` (Hub entity; cascade-spawned from thread-303 action-1).
**Design round:** thread-303 (architect lily + engineer greg, converged 2026-04-25). 5 rounds; engineer audit surfaced Flag #1 (Audit/Notification durability — split into prerequisite mission-49) + Flag #1b (NODE_ENV=production gate hard-refused local-fs — relaxed in T1) + Flag #2 (Docker bind-mount uid/gid trap — addressed in T1 via `-u $(id -u):$(id -g)` + dual-layer writability assertion).
**Director ratification:** thread-303 round 5 — β split sequencing (mission-49 prerequisite, mission-48 cutover); mission-49 closed 2026-04-25; mission-48 activated 2026-04-25.
**ADR:** [`docs/decisions/024-sovereign-storage-provider.md`](../decisions/024-sovereign-storage-provider.md) — §6.1 Amendment 2026-04-25 captures the local-fs reclassification.
**PR coordination thread:** thread-306 (architect lily + engineer greg, opened 2026-04-25). Same cadence as mission-49 thread-305: fresh-off-main per task, 2 commits per PR (trace + task), manual squash-merge with `--delete-branch`.
**How to read + update this file:** [`docs/traces/trace-management.md`](trace-management.md).

**Status legend:** ▶ in-flight · ✅ done this session · ○ queued / filed · ⏸ blocked

---

## Resumption pointer (cold-session brief)

If you're picking up cold on mission-48:

1. **Read this file first**, then thread-303 for design-round context, then `docs/decisions/024-sovereign-storage-provider.md` §6.1 for the ADR-024 amendment.
2. **DAG:** T1 → T2a → T2b → T2c → T3 → T4. Strictly sequential per ship-green discipline + thread-306 PR cadence.
3. **Issuance pattern (architect-side):** mission-48 runs **without `plannedTasks`** as an explicit bypass of bug-31 (variant-1 cascade-auto-duplicate + variant-2 cascade-stall, both observed twice on mission-49). Architect manually `create_task`s each subsequent task on prior approval. Saves ~10-15 min of duplicate-detection cycles per mission.
4. **Current state:** T1 PR open (PR # TBD on push); awaiting CI + architect merge per thread-306 cadence. After T1 merges, architect issues T2a manually.
5. **Pre-authorized scope discipline:** uid/gid mitigation = `docker run -u $(id -u):$(id -g)` (architect-confirmed thread-306); `local-state/` is gitignored; ADR-024 amendment is single-writer-laptop-prod-eligible only — multi-writer / Cloud Run continue to require `STORAGE_BACKEND=gcs` per the still-intact `concurrent:false` capability flag.
6. **Bug carry-forward:** bug-32 (cross-package CI debt — `network-adapter` + `claude-plugin` + `opencode-plugin` test cells red on every PR) — pre-existing pattern. Verify hub scope green; ignore the 3 known-noisy cells.
7. **Mission-49 dependency:** ✅ resolved. AuditStore + NotificationStore now migrated to Repository pattern; durable on local-fs. mission-48's success-criterion 5 (no audit/notification regression post-cutover) is now structurally provable.

---

## In-flight

- ▶ **T1 — Docker state-mount + wiring + uid/gid handshake + ADR-024 gate relaxation.** Shipped on `agent-greg/mission-48-t1` (fresh off `origin/main` at `3fcb19a`). Task commit `6c1f486`. 5 files modified, +146/-18 LOC. Hub tests green at 51/748/5 (unchanged from mission-49 close baseline; T1 is non-regressive). Awaiting trace-commit (this file) + push + PR open. Will reply on thread-306 with PR URL.

## Queued / filed

- ○ **T2a — Cutover bootstrap.** Extend `scripts/state-sync.sh` with post-copy set-equality invariant (`gsutil ls -r` vs `find` output, not just byte-totals); `.cutover-complete` sentinel written only after invariant check passes; tmp-file filter for reverse-sync. Architect issues task once T1 PR merges.
- ○ **T2b — Flip default + Hub-restart smoke.** `STORAGE_BACKEND=local-fs` becomes laptop-Hub default in `scripts/local/start-hub.sh`. One `docker stop && docker start` to prove state readable + uncorrupted post-flip.
- ○ **T2c — Reverse-direction sync (local→GCS manual backup).** `state-sync.sh --reverse` capability + tmp-file filter (`.tmp.*` files never cross the wire); runbook entry for on-demand backup; feeds rollback procedure directly.
- ○ **T3 — Dogfood continuous validation + explicit Hub-restart-mid-mission readback assertion.** Every state change from mission activation onward lands on local-fs; after T2b lands, explicit `docker stop && docker start` with pre/post entity set-equality readback across all entity types; then proceed with remaining mission work. Restart is the load-bearing check for mission success criterion #1 — happy-path dogfood alone doesn't prove durability.
- ○ **T4 — Closing hygiene.** `deploy/README` cutover-runbook + rollback-runbook (rollback pre-step: `state-sync.sh --reverse` when post-cutover writes exist, then env-var flip back to gcs, then Hub restart); fold idea-193 (mission-47 T5 engineer-side docs hygiene); retrospective captures.
- ○ **idea-193 — mission-47 T5 engineer-side docs hygiene** (deferred 2026-04-25 at mission-47 close). Folded into mission-48 T4 closing per thread-304 ratification.

---

## Done this session

### T1 (Docker state-mount + uid/gid + ADR-024 gate relaxation) — shipped locally 2026-04-25

- ✅ **`scripts/local/start-hub.sh` — env-var fallthrough + bind mount + uid/gid + pre-flight writability probe.** `STORAGE_BACKEND` and `OIS_LOCAL_FS_ROOT` are now caller-overridable (defaults `gcs` and `${REPO_ROOT}/local-state` respectively). When `STORAGE_BACKEND=local-fs`, the script `mkdir -p`s the host state dir, runs a shell-layer writability probe with explicit uid/gid diagnostic on failure, then bind-mounts the dir into the container at the same path and propagates `OIS_LOCAL_FS_ROOT` as an env var. `docker run` always runs as host uid/gid (`-u $(id -u):$(id -g)`) — operators can inspect `local-state/` directly without container-uid mismatch surprises. Argv built as a bash array for clean conditional injection.
- ✅ **`hub/src/index.ts` — gate relaxation + Hub-side writability assertion.** The previous fatal-exit at `hub/src/index.ts:106-109` (`STORAGE_BACKEND=local-fs` + `NODE_ENV=production` ⇒ `process.exit(1)`) is now `console.warn` + proceed, per ADR-024 amendment §6.1. Warning text surfaces the single-writer constraint + the start-hub.sh enforcement at startup. Defense-in-depth writability assertion: try `mkdir + writeFile + unlink` on a sentinel under `OIS_LOCAL_FS_ROOT`; fail-fast with `EACCES`/`EPERM`-specific diagnostic naming uid/gid mismatch as the #1 cause + `docker run -u $(id -u):$(id -g)` as the fix.
- ✅ **`docs/decisions/024-sovereign-storage-provider.md` — §6 Amendments + §6.1 Amendment 2026-04-25.** Captures local-fs reclassification (dev-only → also single-writer-laptop-prod-eligible); explicit operational enforcement story (start-hub.sh:148-161 one-hub-at-a-time check); narrow-scope guard left intact for non-laptop targets (Cloud Run / multi-instance must continue to use `STORAGE_BACKEND=gcs`; `concurrent:false` flag still rules out multi-writer profiles by contract). Amendment is scoped narrowly to single-writer-laptop-prod and does not widen `local-fs` semantics elsewhere.
- ✅ **`deploy/README.md` — new §Local-fs Hub state directory section.** Mount-section stub per task-355 deliverable #6 (full cutover + rollback runbook lands under T4). Documents host path default, selection mechanism, bind mount, uid/gid policy, single-writer enforcement, defense-in-depth writability check.
- ✅ **`.gitignore` — `local-state/` added.** Mission-47 T3 created the default state-dir but never gitignored it; small hygiene catch caught while touching surrounding scripts. Architect-acknowledged as "trivially in-scope" on thread-306.
- ✅ **uid/gid mitigation choice ratified.** thread-306 round 2: architect green-lit `docker run -u $(id -u):$(id -g)` (vs chown-shim or named-volume alternatives). Rationale: bind-mount transparency + no chown-shim overhead + container only writes to mounted state dir (`/app` read-only at runtime; `/secrets/sa-key.json` `:ro`). Operability win for operator inspection.
- ✅ **Verification.** `npm test` (hub): 51 files / 748 passed / 5 skipped (unchanged from mission-49 close baseline; T1 is non-regressive). `npm run build`: clean. `npx tsc --noEmit`: clean. `bash -n scripts/local/start-hub.sh`: clean. `@ois/storage-provider` conformance suite: unchanged (no contract delta).

---

## Edges (dependency chains)

```
mission-49 ✅────────────[Audit + Notification Repository migration shipped on main; durable on local-fs]
                                                                    │
                                                                    ▼
T1 ▶ ──→ T2a ○ ──→ T2b ○ ──→ T2c ○ ──→ T3 ○ ──→ T4 ○ ──→ mission-48 close
[gate relaxation                                            │
 + bind mount                                               └─[unblocks]─→ idea-191 / idea-192
 + uid/gid]                                                                (workflow-primitive design rounds —
                                                                            blocked on mission-48 per thread-303)

Architect-owned: mission-48 plannedTasks deliberately unset (bug-31 bypass);
                 each subsequent task issued manually post prior PR merge.
```

Outside-mission downstream: idea-191 (GH event bridge) + idea-192 (Hub triggers + inbox) — workflow-primitive design rounds blocked on mission-48 per thread-303 round 1. They mechanize away the manual PR-coordination overhead this thread-306 cadence is currently absorbing.

---

## Session log (append-only)

- **2026-04-25 late** — Mission-48 activation. Director approval received on the back of mission-49 close (thread-305 confirmed `3fcb19a` as the new main HEAD; engineer-scope mission-49 fully closed). Architect opened thread-306 for PR coordination + issued task-355 manually (without `plannedTasks` per bug-31 bypass discipline). Engineer acknowledged + drafted execution plan (uid/gid via `-u $(id -u):$(id -g)`, defense-in-depth writability via shell + Hub-side); architect green-lit all calls in thread-306 round 3. Engineer shipped T1 locally on `agent-greg/mission-48-t1` (fresh off `3fcb19a`): start-hub.sh env-var fallthrough + bind mount + uid/gid + shell-layer writability probe; hub/src/index.ts gate relaxation + Hub-side writability assertion; ADR-024 §6 + §6.1 amendment text; deploy/README mount-section stub; `.gitignore` += `local-state/`. 5 files modified +146/-18; hub tests green at 51/748/5 unchanged baseline; build + typecheck clean. Task commit `6c1f486`. Trace + push + PR open next.

---

## Canonical references

- **Mission entity:** `get_mission(mission-48)` (Hub) — title `M-Local-FS-Cutover`; cascade-spawned from thread-303 action-1.
- **Source idea:** `get_idea(idea-190)` — filed 2026-04-25 by Director.
- **Design round thread:** thread-303 — architect lily + engineer greg, 5 rounds, converged 2026-04-25. Director ratification at round 5 (β split sequencing).
- **PR coordination thread:** thread-306 — opened 2026-04-25 post mission-49 close. Same cadence as mission-49 thread-305.
- **ADR amendment:** `docs/decisions/024-sovereign-storage-provider.md` §6.1 Amendment 2026-04-25 — local-fs profile reclassification.
- **Cross-mission prerequisite:** mission-49 M-Audit-Notification-Repository-Migration — closed 2026-04-25. AuditStore + NotificationStore Repository migration satisfied mission-48's inherited-verification dependency on durable local-fs entity state.
- **Trace methodology:** [`docs/traces/trace-management.md`](trace-management.md).
- **Pattern precedents (mission-49):** [`m-audit-notification-repository-migration-work-trace.md`](m-audit-notification-repository-migration-work-trace.md); thread-305 PR cadence; closing report at `docs/audits/m-audit-notification-repository-migration-closing-report.md`.
- **Pattern precedents (mission-47):** [`m-sovereign-storage-interface-work-trace.md`](m-sovereign-storage-interface-work-trace.md); StorageProvider contract design at thread-290.
- **Commit conventions:** `[mission-48]` prefix on code commits; `[planning]` prefix on this trace's patches; no `Co-Authored-By: Claude` trailers per `CLAUDE.md`.
- **Bug-32 carry-forward:** cross-package CI debt (`network-adapter` / `claude-plugin` / `opencode-plugin` test cells red on every PR pre-existing per architect's PR #21 triage). Verify hub scope green; ignore the 3 known-noisy cells. Same pattern as mission-49 PRs.
