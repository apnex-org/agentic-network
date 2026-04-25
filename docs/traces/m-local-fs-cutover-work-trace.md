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
4. **Current state:** T1/T2a/T2b/T2c ✅ all merged on main (PRs #24/#25/#26/#27 at `1e61226` / `bc5dbb6` / `34b225a` / `8c420c7`). T3 shipped locally on `agent-greg/mission-48-t3` — operator-side drill procedures documented at `docs/runbooks/m-local-fs-cutover-drills.md`. Live drill execution deferred to operator (Director α-path on thread-307 round 3) — engineer's MCP session is bound to the running Hub container, so engineer can't safely restart from this worktree. After T3 PR merges, architect issues T4 (closing hygiene). Mission-48 close: T4 merge + Director-signaled satisfactory drill outputs → architect flips mission-48 → `completed`.
5. **Pre-authorized scope discipline:** uid/gid mitigation = `docker run -u $(id -u):$(id -g)` (architect-confirmed thread-306); `local-state/` is gitignored; ADR-024 amendment is single-writer-laptop-prod-eligible only — multi-writer / Cloud Run continue to require `STORAGE_BACKEND=gcs` per the still-intact `concurrent:false` capability flag.
6. **Bug carry-forward:** bug-32 (cross-package CI debt — `network-adapter` + `claude-plugin` + `opencode-plugin` test cells red on every PR) — pre-existing pattern. Verify hub scope green; ignore the 3 known-noisy cells.
7. **Mission-49 dependency:** ✅ resolved. AuditStore + NotificationStore now migrated to Repository pattern; durable on local-fs. mission-48's success-criterion 5 (no audit/notification regression post-cutover) is now structurally provable.

---

## In-flight

- ▶ **T3 — Dogfood validation + Hub-restart-mid-mission readback assertion + live rollback drill.** Shipped on `agent-greg/mission-48-t3` (fresh off `origin/main` at `8c420c7`). New file `docs/runbooks/m-local-fs-cutover-drills.md` (~270 lines) — operator-side drill procedures + dogfood entity-type enumeration + container-rebuild verification. Hub tests untouched at 52/755/5 (no source changes — operational verification task). Engineer-side scope: documentation. Live drill execution: operator-side per Director α-path (thread-307 round 3); engineer can't safely restart the running Hub from this worktree because MCP session is bound to it.

## Queued / filed
- ○ **T2c — Reverse-direction sync (local→GCS manual backup).** `state-sync.sh --reverse` capability + tmp-file filter (`.tmp.*` files never cross the wire); runbook entry for on-demand backup; feeds rollback procedure directly.
- ○ **T3 — Dogfood continuous validation + explicit Hub-restart-mid-mission readback assertion.** Every state change from mission activation onward lands on local-fs; after T2b lands, explicit `docker stop && docker start` with pre/post entity set-equality readback across all entity types; then proceed with remaining mission work. Restart is the load-bearing check for mission success criterion #1 — happy-path dogfood alone doesn't prove durability.
- ○ **T4 — Closing hygiene.** `deploy/README` cutover-runbook + rollback-runbook (rollback pre-step: `state-sync.sh --reverse` when post-cutover writes exist, then env-var flip back to gcs, then Hub restart); fold idea-193 (mission-47 T5 engineer-side docs hygiene); retrospective captures.
- ○ **idea-193 — mission-47 T5 engineer-side docs hygiene** (deferred 2026-04-25 at mission-47 close). Folded into mission-48 T4 closing per thread-304 ratification.

---

## Done this session

### T3 (Dogfood + Hub-restart-mid-mission readback + live rollback drill) — shipped locally 2026-04-25

- ✅ **`docs/runbooks/m-local-fs-cutover-drills.md` — new operator-side runbook (~270 lines).** Establishes a new `docs/runbooks/` directory convention (T4 will reference; sister docs to `docs/onboarding/` but execution-focused). Sections: §0 Pre-flight container rebuild + bootstrap + start; §1 Dogfood entity-type enumeration (with explicit honesty: dogfood proved Hub data plane on GCS-deployed pre-mission-48 image, NOT the local-fs cutover specifically); §2 Hub-restart-mid-mission readback assertion (load-bearing — pre/post entity-type counts + ID-set equality across all entities); §3 Live rollback drill consuming T2c (post-cutover write → reverse-sync → flip env-var → restart on GCS → verify entity preserved); §4 Reporting-back semantics (thread-307 reply OR PR amendment OR retrospective inclusion); cross-references to mission entity / design round / ADR / trace / bugs.
- ✅ **Engineer-side container-rebuild verification.** `bash -n scripts/local/build-hub.sh` clean; `deploy/env/prod.tfvars` populated; gcloud SDK 512+ installed; build prerequisites verified locally without invoking real Cloud Build (cost discipline). Documented exact rebuild command for Director: `OIS_ENV=prod scripts/local/build-hub.sh`.
- ✅ **Deployment-state finding surfaced honestly on thread-307 (round 2):** running `ois-hub-local` container on pre-mission-48 image (SHA `7601261e8…`, 2026-04-24 02:46 UTC), `STORAGE_BACKEND=gcs`, no bind mount, no `-u` uid override, container started PRE-mission-48-activation. Mission-48 work merged to main but not redeployed; the dogfood claim "running this mission against the local-fs default" doesn't hold as stated. Director ratified α-path 2026-04-25 (round 3): operator runs live drill; engineer documents.
- ✅ **Side observation captured for architect retrospective:** "Hub redeploy is not gated on mission-merge events" — distinct from idea-191/idea-192 (CD-pipeline territory; benefits-from but its own scope). Architect ack'd; will file as discrete idea post-mission-48-close.
- ✅ **Verification.** `npm test` (hub): 52 files / 755 passed / 5 skipped (unchanged from T2c-merged baseline; T3 is docs-only — no source changes). `npm run build`: clean. `bash -n scripts/local/build-hub.sh`: clean. `bash -n scripts/local/start-hub.sh`: clean. `bash -n scripts/state-sync.sh`: clean. `@ois/storage-provider` conformance suite: unchanged.

### T2c (Reverse-direction sync with --yes safety) — shipped + merged 2026-04-25

- ✅ **PR #27 merged at `8c420c7`** (architect-merged 2026-04-25; bug-32 CI pattern matched).

- ✅ **`scripts/state-sync.sh` — bidirectional refactor.** New flags: `--reverse` (flip direction local-fs → GCS), `--yes` (required when --reverse), `-h/--help`. Without `--yes`, `--reverse` refuses with an explicit "rollback-path most-expensive-mistake" diagnostic + exit 1. Constants extracted: `TMP_FILE_EXCLUDE_REGEX` (T2a-preserved), `SCRIPT_ARTIFACT_REGEX` (T2a; loosened from `^\.` to unanchored `\.` so it matches in subdirs), `SYNC_EXCLUDE_REGEX` (composed; passed to gsutil rsync `-x` in both directions). Direction-specific source/target via a case block.
- ✅ **Sentinel handling — forward writes; reverse leaves alone.** Forward direction writes `.cutover-complete` after invariant green (T2a behavior preserved). Reverse direction explicitly does NOT touch the sentinel — it reflects the LAST FORWARD bootstrap, not the last reverse upload. Rewriting on reverse would mislead future cold-engineer pickup into thinking a fresh bootstrap occurred.
- ✅ **Symmetric invariant.** Same set-equality check (gsutil ls vs find), same normalization, same diff. Output customizes the failure-cause guidance per direction (forward: interrupted rsync / GCS modified during sync / local writes during sync / .tmp.* leak; reverse: interrupted rsync / local-fs modified during sync — Hub still running? / GCS write conflict; reverse explicitly notes sentinel-NOT-touched so rerun is safe).
- ✅ **`deploy/README.md` — Local-fs Hub state directory section.** New bullet for T2c (`--reverse --yes` flag, .tmp.* + sentinel exclusion, sentinel-stays-local). New "Operator rollback flow" code-block adjacent to "Operator first-launch flow" — three-step rollback procedure (stop hub / reverse-sync / restart with `STORAGE_BACKEND=gcs`). Full runbook still defers to T4.
- ✅ **5-test smoke matrix against fake-gsutil harness.** TEST 1: forward baseline → green, sentinel written, exit 0. TEST 2: `--reverse` without `--yes` → refuses with explicit error, exit 1, no rsync invoked. TEST 3: reverse with --yes after a post-cutover local write (new entity in local-fs) → invariant green, GCS gains the entity, sentinel did NOT cross to GCS (verified by listing fake-gcs after — no `.cutover-complete` file). TEST 4: reverse idempotent rerun → green, exit 0. TEST 5: `task-1.tmp.abc123` left in local-fs → reverse-sync excludes it via `-x SYNC_EXCLUDE_REGEX`; GCS unchanged. All matched expected behavior.
- ✅ **Live GCS smoke deferred to T3 dogfood** per task-358 scope. T2c ships the script + the fake-harness logic correctness.
- ✅ **Verification.** `bash -n scripts/state-sync.sh`: clean. `npm test` (hub): 52/755/5 unchanged (shell-only, no Hub source touched). `chmod +x` preserved.

### T2b (Flip default + bootstrap-required sentinel guard) — shipped + merged 2026-04-25

- ✅ **PR #26 merged at `34b225a`** (architect-merged 2026-04-25; bug-32 CI pattern matched).

- ✅ **`scripts/local/start-hub.sh` — laptop-Hub default flipped `gcs` → `local-fs`.** Comment updated to note the rollback path (`STORAGE_BACKEND=gcs`) + ADR-024 amendment §6.1 reference + T4 rollback runbook reference.
- ✅ **`hub/src/lib/cutover-sentinel.ts` — new helper.** `CUTOVER_SENTINEL_FILENAME = ".cutover-complete"` constant; `cutoverSentinelPath(root)` + `isCutoverComplete(root)`. Defensive: returns false on non-existent root, fs errors, and `.cutover-complete/` as a directory (sentinel contract is "regular file with provenance"). Extracted as a helper rather than inlined for testability.
- ✅ **`hub/src/index.ts` — bootstrap-required guard wired.** Inserted between the T1 writability assertion and LocalFsStorageProvider construction. Refuses to start if `isCutoverComplete(root)` returns false — emits FATAL with the missing path, the fix (`scripts/state-sync.sh`), and an explicit fresh-start note (state-sync.sh against an empty bucket trivially passes invariant + writes sentinel — supports the no-GCS-data-import scenario without bypass).
- ✅ **`hub/test/unit/cutover-sentinel.test.ts` — 7 tests.** Coverage: constant matches state-sync.sh filename; `cutoverSentinelPath()` joins correctly; `isCutoverComplete()` returns false on fresh empty dir; true when sentinel-as-file exists; false on `.cutover-complete/` directory; false on non-existent path; false on non-existent root. `mkdtemp`/`rm` per-test root.
- ✅ **`deploy/README.md` — Local-fs Hub state directory section updated.** Notes default flip + rollback path + bootstrap-required dependency + new "Operator first-launch flow" code-block. Full cutover + rollback runbook still defers to T4.
- ✅ **Manual smoke (best-effort; no live Docker in worktree).** GUARD CASE A: empty dir, no sentinel → FATAL would fire, exit 1. GUARD CASE B: empty dir + `touch .cutover-complete` → would proceed, exit 0. Both verified via `node -e` against compiled `dist/lib/cutover-sentinel.js`. Live Docker `start-hub.sh + state-sync.sh + restart` cycle deferred to T3 dogfood per task-357 scope.
- ✅ **Verification.** `npm test` (hub): 52 files / 755 passed / 5 skipped (was 51/748/5 — delta +1 file / +7 tests / 0 regressions; architect estimated +1 test). `npm run build`: clean. `npx tsc --noEmit`: clean. `bash -n scripts/local/start-hub.sh`: clean. `@ois/storage-provider`: unchanged.

### T2a (Cutover bootstrap: invariant + sentinel + tmp-file exclusion) — shipped + merged 2026-04-25

- ✅ **PR #25 merged at `bc5dbb6`** (architect-merged 2026-04-25 per thread-306; bug-32 CI pattern matched).

- ✅ **`scripts/state-sync.sh` — extended with mission-48 T2a discipline.** Adds `TMP_FILE_EXCLUDE_REGEX='.*\.tmp\..*'` constant for both forward direction (this T2a, defensive against future reverse-sync leaks) and T2c reverse-sync (which will reuse the same constant). `gsutil rsync` invocation gains `-x` to exclude tmp files at copy time. Post-rsync invariant: `gsutil ls -r` vs `find -type f` keyspace comparison with normalization (sed-strip-bucket-prefix, drop `:`-suffix directory markers, drop blanks, drop tmp files via regex, drop script artifacts via `SCRIPT_ARTIFACT_REGEX`). Diff-on-failure surfaces explicit `<` GCS-only / `>` local-only paths so operators can re-run in narrow scope. `.cutover-complete` sentinel is written ONLY after invariant green; contains timestamp_utc + gcs_source + local_root + script_commit (HEAD SHA) + script_invocation epoch.
- ✅ **Bootstrap idempotence verified.** Re-running after a successful bootstrap is a no-op: rsync detects matching files and skips; invariant re-passes; sentinel is rewritten with a fresh timestamp + epoch (provenance refresh).
- ✅ **Defensive normalizations.** `BUCKET="${BUCKET%/}"` strips trailing slash at top so the sed-prefix-strip is unambiguous regardless of caller formatting. `gsutil ls -r ... || true` survives empty-bucket non-zero exit. `SCRIPT_ARTIFACT_REGEX` drops `.cutover-complete` + `.hub-writability-*` + `.start-hub-writability-*` probes from both sides of the diff so they don't re-fail subsequent runs.
- ✅ **Header doc refresh.** Stale mission-47 caveat about AuditStore + NotificationStore in-memory on local-fs replaced with a mission-49-close-references-it-now-durable note. Mission-48 T2a context block added at the top.
- ✅ **Best-effort smoke against fake-gsutil harness.** No live GCS bucket in the engineer worktree, so direct operator smoke deferred to T2b/T3 per task-356 explicit scope. Logic-correctness verified across four scenarios via a stub gsutil that simulates `ls` + `rsync` against a local mock bucket: (1) RUN 1 bootstrap with matching keyspace → invariant green, sentinel written, exit 0; (2) RUN 2 divergence injection (no-op rsync stub + GCS-only file added + local file removed) → invariant red, diff output cleanly named both deltas, sentinel timestamp PRESERVED, exit 1; (3) RUN 3 real rsync restored, rerun → invariant green, sentinel timestamp UPDATED, exit 0; (4) RUN 4 idempotent immediate rerun → invariant green, exit 0.
- ✅ **Verification.** `bash -n scripts/state-sync.sh`: clean. `npm test` (hub): 51/748/5 unchanged (shell-only change, no Hub source touched). `chmod +x` preserved on the script.

### T1 (Docker state-mount + uid/gid + ADR-024 gate relaxation) — shipped + merged 2026-04-25

- ✅ **PR #24 merged at `1e61226`** (architect-merged 2026-04-25 per thread-306; bug-32 CI pattern matched, no surprises).

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
T1 ✅ ──→ T2a ✅ ──→ T2b ✅ ──→ T2c ✅ ──→ T3 ▶ ──→ T4 ○ ──→ mission-48 close
[merged    [merged    [merged    [merged                          │
 1e61226]   bc5dbb6]   34b225a]   8c420c7]                        └─[unblocks]─→ idea-191 / idea-192

Operator-side drill execution (§2 Hub-restart readback + §3 rollback drill) explicitly deferred per
Director α-path call on thread-307 round 3. Mission-48 status flip to `completed` gates on T4 merge
+ Director-signaled drill outputs (or close-without-drill signal).
                                                                              (workflow-primitive design rounds —
                                                                               blocked on mission-48 per thread-303)

Architect-owned: mission-48 plannedTasks deliberately unset (bug-31 bypass);
                 each subsequent task issued manually post prior PR merge.
```

Outside-mission downstream: idea-191 (GH event bridge) + idea-192 (Hub triggers + inbox) — workflow-primitive design rounds blocked on mission-48 per thread-303 round 1. They mechanize away the manual PR-coordination overhead this thread-306 cadence is currently absorbing.

---

## Session log (append-only)

- **2026-04-25 late (T3)** — T2c PR #27 merged at `8c420c7` (architect-merged; bug-32 CI pattern matched). thread-306 round-limited at PR #27 announce; architect opened thread-307 to continue PR coordination through T3 + T4. Architect issued task-359 (T3) on thread-307 round 1. Engineer inspected the running `ois-hub-local` container before committing to the live drill and surfaced a critical deployment-state finding: container is on pre-mission-48 image (SHA `7601261e8…`, started 2026-04-24 02:46 UTC, before mission-48 even activated), `STORAGE_BACKEND=gcs`, no bind mount, no `-u` uid override. The dogfood claim asserted in thread-303 + task-359 ("running this mission against the local-fs default") is therefore honestly inaccurate as stated — engineer's mission-48 MCP traffic exercised the Hub data plane on the GCS-deployed pre-mission-48 image, not the local-fs cutover path. Three paths (α/β/γ) surfaced for Director's call; Director ratified α (operator runs live drill; engineer documents) on thread-307 round 3 with explicit container-rebuild ask attached. Engineer shipped T3 as docs-only PR: `docs/runbooks/m-local-fs-cutover-drills.md` (~270-line operator-side runbook covering pre-flight container rebuild + bootstrap + start, dogfood entity-type enumeration, Hub-restart-mid-mission readback assertion, live rollback drill consuming T2c, reporting-back semantics) + container-rebuild verification (build-hub.sh syntax + tfvars + gcloud check; documented exact rebuild command for Director). Hub tests untouched at 52/755/5. Side observation ack'd for architect retrospective: "Hub redeploy is not gated on mission-merge events" (CD-pipeline scope; will file as discrete idea post-close). Mission-48 progress: 4/6 PRs merged; T3 docs PR open next; T4 closing hygiene remains; mission status flip to `completed` gates on T4 merge + Director-signaled drill outputs.

- **2026-04-25 late (T2c)** — T2b PR #26 merged at `34b225a` (architect-merged; bug-32 CI pattern matched, no triage). Architect issued task-358 (T2c) manually per bug-31 bypass. Engineer shipped T2c locally on `agent-greg/mission-48-t2c` (fresh off `34b225a`): scripts/state-sync.sh ~76% rewrite for bidirectional structure (forward + --reverse --yes flags, symmetric invariant, direction-specific failure-cause output, sentinel handling — forward writes, reverse leaves alone); deploy/README mount-section gains reverse-section + Operator rollback flow code-block. Smoke matrix (5 tests via fake-gsutil) all matched: forward baseline green / reverse-without-yes refused with exit 1 / reverse-with-yes succeeds + sentinel stays local-only / reverse idempotent rerun green / .tmp.* exclusion verified. Live GCS smoke deferred to T3 dogfood. Hub tests untouched at 52/755/5. Task commit `3745367`. Mission-48 progress: 4/6 PRs after this lands; T3 (dogfood + Hub-restart-mid-mission readback) is next; T4 (closing hygiene + fold idea-193) closes the mission.

- **2026-04-25 late (T2b)** — T2a PR #25 merged at `bc5dbb6` (architect-merged; bug-32 CI pattern matched, no triage). Architect issued task-357 (T2b) manually per bug-31 bypass. Engineer shipped T2b locally on `agent-greg/mission-48-t2b` (fresh off `bc5dbb6`): scripts/local/start-hub.sh STORAGE_BACKEND default flipped from `gcs` to `local-fs`; hub/src/lib/cutover-sentinel.ts new helper (`CUTOVER_SENTINEL_FILENAME` + `cutoverSentinelPath()` + `isCutoverComplete()`); hub/src/index.ts wired with bootstrap-required guard between the T1 writability assertion and LocalFsStorageProvider construction; hub/test/unit/cutover-sentinel.test.ts new test file with 7 unit tests covering both happy + edge cases (sentinel-as-directory defensiveness, non-existent root, non-existent path); deploy/README.md mount-section updated with default-flip + rollback + bootstrap-required dependency + first-launch-flow code-block. Manual smoke (best-effort; no live Docker): empty-dir guard fires FATAL exit 1; sentinel-touched proceeds — both verified via `node -e` against compiled dist. Live Docker restart cycle deferred to T3 dogfood per task-357 scope. Hub tests green at 52/755/5 (delta +1 file / +7 tests vs T2a baseline; architect estimated +1 test). Task commit `a02637e`. Trace + push + PR open next.

- **2026-04-25 late (continuation)** — T1 PR #24 merged at `1e61226` (architect-merged 2026-04-25; bug-32 CI pattern matched, no surprises). Architect issued task-356 (T2a) manually per bug-31 bypass. Engineer shipped T2a locally on `agent-greg/mission-48-t2a` (fresh off `1e61226`): scripts/state-sync.sh extended with TMP_FILE_EXCLUDE_REGEX (-x exclusion at rsync time + T2c-shared constant), post-copy set-equality invariant (gsutil ls -r vs find -type f, normalized + sorted + diffed), `.cutover-complete` sentinel (timestamp + bucket + commit + epoch, written only on invariant green), diagnostic-rich failure output with per-path GCS-only / local-only annotation. Verified across four smoke scenarios via a fake-gsutil harness (bootstrap green / divergence red / restore green / idempotent rerun); operator-side smoke against a real GCS bucket deferred to T2b/T3 per task-356 explicit scope. Hub tests untouched at 51/748/5. Task commit `b8c2257`. Trace + push + PR open next.

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
