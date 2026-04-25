# M-Cloud-Build-Tarball-Codification — Work Trace (live state)

**Mission scope.** Tracks all in-flight, queued, and recently-completed work under mission-50 (M-Cloud-Build-Tarball-Codification). Goal: close bug-33 (Cloud Build cross-package context trap) + bug-36 (gcloud-upload-context inherits .gitignore when no .gcloudignore is present; surfaced at architect dogfood-v1 post-T2) + bug-37 (`npm install --package-lock-only` doesn't fully resolve platform-conditional / optional deps; surfaced at architect dogfood-v2 post-T3). Permanent committed state stays minimal (4 files: `hub/Dockerfile` + `hub/.gitignore` + `hub/.gcloudignore` + `scripts/local/build-hub.sh`); the `hub/package.json` + `hub/package-lock.json` swap is fully transient — applied in `scripts/local/build-hub.sh` right before `gcloud builds submit`, restored by trap on `EXIT INT TERM HUP`. S-class; 4-task mission (T1 codification + T2 closing hygiene + T3 hotfix-1 for bug-36 + T4 hotfix-2 for bug-37) ratified at thread-310 round-3 with T3+T4 scope-extensions issued direct post-architect-dogfood-findings.

**Hub mission id:** mission-50.
**Source idea:** idea-198 (codification ideation seed, filed post-bug-33).
**Source bugs:**
- bug-33 (Cloud Build cross-package context trap; resolves at T1 merge `188719e`).
- bug-36 (gcloud-upload-context inherits .gitignore; resolves at T3 merge `9636234`).
- bug-37 (`npm install --package-lock-only` lockfile incomplete; resolves at T4 merge).
**Architect coordination thread:** thread-310 — architect lily + engineer greg, 5 rounds, converged 2026-04-25 (round-2 transient-swap structural pushback; round-3 architect ratification; round-5 propose_mission staging).
**How to read + update this file:** `docs/traces/trace-management.md`.

**Status legend:** ▶ in-flight · ✅ done this session · ○ queued / filed · ⏸ deferred

---

## Resumption pointer (cold-session brief)

If you're picking up cold:

1. **Read this file first**, then the closing audit at `docs/audits/m-cloud-build-tarball-codification-closing-report.md` (single source of truth for mission shape + criteria + verification + ADR-024 boundary + §5.6 iterative-dogfood-finding pattern).
2. **Hub mission id:** mission-50 (status=active until architect flips to `completed` post-T4 merge + T4 dogfood-v3 pass + retrospective).
3. **Current in-flight:** nothing — **ENGINEER-SIDE MISSION-50 100% DELIVERED** at T4 PR. T1 merged at `188719e` (PR #33); T2 merged at `af19bbf` (PR #34); T3 merged at `9636234` (PR #35); T4 hotfix is the in-flight PR carrying these trace amendments.
4. **Ratified scope inputs (do NOT re-litigate):** transient-swap pattern (round-2 engineer pushback ratified round-3); permanent committed state minimal (4 files); `hub/.gcloudignore` permanent committed lean (a) per architect's T3 directive; T4 full `npm install` (NOT `--package-lock-only`) per architect's T4 directive lean (matches Director's working manual workaround); leave `hub/node_modules/` in place (lean (a) — already gitignored + gcloudignored); ADR-024 NOT amended; sunset trigger = idea-186 (npm workspaces); dogfood-gate is load-bearing AND iterative per §5.6.
5. **Anti-goals (hold firm):** no permanent commits to `hub/package.json` or `hub/package-lock.json` (the round-2 pushback core); no contract-layer changes to `@ois/storage-provider`; no absorption of bug-32 / idea-186 / idea-197 scope (separate methodology surfaces); no `#!include:.gitignore` in `hub/.gcloudignore` (self-contained by design); no return to `--package-lock-only` (was the bug-37 trap; full install is the verified-correct path).
6. **Deploy gate:** Hub ships via local Docker container (`ois-hub:local`) per `project_local_docker_testing.md` memory. Cloud Build is the IMAGE-build path; the resulting image is pulled + tagged + run locally. Architect owns the post-merge dogfood redeploy per Director direction 2026-04-25.
7. **Forward-look:** idea-197 (M-Auto-Redeploy-on-Merge) when filed MUST invoke `scripts/local/build-hub.sh` to inherit ALL THREE codified fixes (tarball staging from T1 + .gcloudignore upload-context fix from T3 + full-install lockfile-completeness from T4). Or invoke a workspaces-aware successor post-idea-186. Bypassing would silently regress bug-33 + bug-36 + bug-37.
8. **T3 + T4 hotfix lessons:** Two dogfood-found bugs in same mission. bug-36 surfaced because mocked tests can't see the gcloud upload-context-filter boundary; bug-37 surfaced because mocked tests can't see the `npm ci` strict-validation boundary inside the Cloud Build container. Each iteration of the dogfood gate surfaces the next downstream-pipeline failure mode. §5.6 formalizes this as iterative-dogfood-discipline. For future deployment-pipeline missions: expect multiple dogfood iterations; size mission-close-cost accordingly.

---

## In-flight

_(nothing claimed — **ENGINEER-SIDE MISSION-50 100% DELIVERED**. T1 codification shipped at `188719e` (PR #33). T2 closing hygiene shipped at `af19bbf` (PR #34). T3 hotfix shipped at `9636234` (PR #35). T4 hotfix shipping in this PR. Closing audit + work-trace amended this commit. Mission-status flip + T4 architect dogfood-v3 + retrospective pending architect side per Director direction.)_

---

## Queued / filed

- ○ **PR open on `agent-greg/mission-50-t4-full-install-hotfix` → main** — push branch + `gh pr create` referencing T1+T2+T3 PRs + bug-37 framing + architect-side T4 dogfood-v3 retrigger note. Per `docs/methodology/multi-agent-pr-workflow.md` v1.0.
- ○ **Mission-status flip** — architect-gated RBAC; engineer cannot call `update_mission`. Architect performs `update_mission({missionId: "mission-50", status: "completed"})` post-T4 merge + T4 dogfood-v3-pass + retrospective.
- ○ **bug-33 resolved-flip** — `update_bug({id: "bug-33", status: "resolved", fixCommits: ["188719e"], linkedMissionId: "mission-50"})`. Routine; either side post-T1 merge (overdue — T1 already merged at `188719e`).
- ○ **bug-36 resolved-flip** — `update_bug({id: "bug-36", status: "resolved", fixCommits: ["9636234"], linkedMissionId: "mission-50"})`. Routine; either side post-T3 merge (overdue — T3 already merged at `9636234`).
- ○ **bug-37 resolved-flip** — `update_bug({id: "bug-37", status: "resolved", fixCommits: ["<T4-merge-sha>"], linkedMissionId: "mission-50"})`. Routine; either side at T4 merge.
- ○ **Architect-side T4 dogfood-v3:** re-run `OIS_ENV=prod scripts/local/build-hub.sh` end-to-end against post-T4-merge main; pass criterion is build-completes including `RUN npm ci` + image-pushed + clean trap-restored working tree (`hub/node_modules/` acceptable per lean (a)). Per Director direction 2026-04-25 (architect owns Hub builds + redeploys).
- ○ **Architect retrospective** at `docs/reviews/m-cloud-build-tarball-codification-retrospective.md` — architect-side; engineer not authoring. Now covers T1+T2+T3+T4 + the iterative-dogfood-finding pattern (closing audit §5.6 — two dogfood-found bugs in same mission).
- ○ **Drop bug-33-manual-workaround stash** — per task-365 directive: `git stash drop` the stash labelled `'bug-33 manual workaround pre-mission-50 codification'` once mission-50 is functionally complete (codification covers the workaround end-to-end now). Architect-side post-mission-close.

---

## Done this session

- ✅ **thread-310 convergence (design round)** — 5 rounds, converged 2026-04-25. Round-1 architect framed permanent-commit shape; round-2 engineer audit produced transient-swap structural pushback (3 flags: hub/package.json is local-dev source-of-truth; version-bump coordination cost; calcification risk vs sunset signal); round-3 architect ratified transient-swap; round-4 engineer convergence-ready; round-5 architect staged propose_mission. Mission cascade fired creating mission-50; Director activation approval implied by 2026-04-25 autonomous-mode direction.
- ✅ **T1 — `build-hub.sh` transient-swap codification + `hub/Dockerfile` + `hub/.gitignore`.** Shipped at PR #33 / `188719e` (single commit `ff415b3` on branch `agent-greg/mission-50-tarball-codification`; merged at `188719e`). `scripts/local/build-hub.sh`: ~70-line §"Storage-provider tarball staging (mission-50 T1)" section added between env-validation and `gcloud builds submit`. Pre-build hook: `npm pack --pack-destination "$HUB_DIR"` against `packages/storage-provider/`, sed-substituted `file:./<tarball>` ref in transient `hub/package.json` swap, regenerated `hub/package-lock.json` via `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`. Trap on `EXIT INT TERM HUP` restores both files + removes staged tarball; backups land in `mktemp -d` outside hub/. `TODO(idea-186)` sunset comment names trigger + 3-action cleanup. `hub/Dockerfile`: `COPY ois-storage-provider-*.tgz ./` before each `RUN npm ci` in BOTH builder + production stages. `hub/.gitignore`: `ois-storage-provider-*.tgz` exclusion. Verified happy-path (mocked gcloud + docker; working tree clean post-run) + SIGINT-mid-flight smoke (signal-aware mock; rc=130; tarball cleaned; package.json restored; no stray .bak/.sedbak). Hub vitest baseline 760/5 holds (shell + Dockerfile only; no TS source touched).
- ✅ **T2 — Closing hygiene: deploy/README + closing audit + this trace.** Shipped at PR #34 / `af19bbf`. `deploy/README.md` §"Cloud Build tarball staging (mission-50)" inserted after §"Local Docker Hub" with subsections: Why / How (transient swap) / Stays clean in git / CI parity note (forward-look) / Sunset condition / ADR-024 boundary statement. `docs/audits/m-cloud-build-tarball-codification-closing-report.md` authored — standard 8-section closing-audit shape per mission-43/46/47/49 precedent (deliverable scorecard, mission goal + 8 success criteria, per-task architecture recap, aggregate stats + verification, 5 emergent observations, cross-references, architect-owned remaining, mission close summary). This trace authored to canonical 7-section shape. No source changes; baseline 760/5 holds.
- ✅ **T3 — Hotfix: hub/.gcloudignore (closes bug-36) + addenda.** Shipped at PR #35 / `9636234`. Architect-side dogfood-v1 post-T2-merge ran `OIS_ENV=prod scripts/local/build-hub.sh` end-to-end and hit Cloud Build Step 4/19 `COPY ois-storage-provider-*.tgz ./` failure (`COPY failed: no source files were specified`). Root cause: `gcloud builds submit` falls back to `.gitignore` when no `.gcloudignore` is present — T1's intentional `hub/.gitignore` tarball-exclusion silently propagated to the upload context, so the locally-staged tarball was filtered out of the upload, and the Dockerfile's COPY step failed inside the build container. T1's mocked happy-path tests couldn't see this bridge (gcloud was mocked); local trap-restore worked correctly throughout (T1 SIGINT-test invariant held even through the bug-36 failure path). T3 (task-364) issued direct per bug-31 bypass within ~1h of dogfood-finding-1. Hotfix: new permanent committed `hub/.gcloudignore` (self-contained, NOT inheriting `.gitignore` via `#!include:`; `node_modules/` exclude + `!ois-storage-provider-*.tgz` re-include + TODO(idea-186) sunset comment) + `deploy/README.md` §"How" addendum explaining the gcloudignore-inherits-gitignore trap + §"Sunset condition" cleanup-list extension (4 → 5 actions) + closing-audit amendments. No source changes; baseline 760/5 holds. Architect-chosen lean (a) approach (committed file) over lean (b) (transient stage in build-hub.sh) — engineer agreed.
- ✅ **T4 — Hotfix: drop --package-lock-only flag in build-hub.sh (closes bug-37) + addenda.** Shipping in this PR. Architect-side dogfood-v2 post-T3-merge advanced past T3's upload + COPY fixes (T3 held cleanly), then hit `RUN npm ci` failure inside the Cloud Build container with `Missing: @emnapi/runtime@1.9.2 from lock file` (and 10 sibling `@emnapi/*` entries). Root cause: T1's lockfile-regen step used `npm install --package-lock-only` which does NOT fully resolve platform-conditional / optional dependencies — npm in this mode skips actual installation, so platform-specific native bindings (the `@emnapi/*` family, transitively pulled via `@google-cloud/storage` chain) don't get evaluated and don't land in the regenerated lockfile. `npm ci` is strict; the missing entries failed the strict-validation. T4 (task-365) issued direct per bug-31 bypass within ~30 min of dogfood-finding-2. Hotfix: drop `--package-lock-only` flag in `scripts/local/build-hub.sh`'s lockfile-regen step (full `npm install --ignore-scripts --no-audit --no-fund --silent` instead) + ~9-line in-script rationale comment naming bug-37 + the `--package-lock-only` failure mode + the node_modules side-effect note + `deploy/README.md` Step 3 update + closing-audit amendments (T4 scorecard row + criteria #12-#14 + §3.4 T4 recap + §4 stats + §5.6 reinforcement on iterative-dogfood-discipline + §6/§7/§8 updates) + this work-trace amendment. Side-effect: `hub/node_modules/` accumulates as cached dev install (already excluded from .gitignore + .gcloudignore; trap does NOT clean it per architect's lean (a) choice). Ground-truth corroboration: Director's manual workaround stash (`'bug-33 manual workaround pre-mission-50 codification'`) used full `npm install` and produced a complete lockfile with all 11 `@emnapi/*` entries; T1's `--package-lock-only` "optimization" was the regression; T4 reverts to the ground-truth approach. No Hub source changes; baseline 760/5 holds.

---

## Edges (dependency chains)

```
thread-310 (design round) ✅
   ↓
T1 (PR #33 / 188719e) ✅ MERGED
   ↓
T2 (PR #34 / af19bbf) ✅ MERGED
   ↓
[architect-side dogfood-v1 post-T2] ✅ RAN — surfaced bug-36
   ↓
T3 (PR #35 / 9636234) ✅ MERGED
   ↓
[architect-side dogfood-v2 post-T3] ✅ RAN — T3 fix held; surfaced bug-37 at next downstream stage (npm ci)
   ↓
T4 (this PR) ▶ in-flight at PR open; transitions to ✅ on merge
   ↓
[architect side post-T4 merge]:
  - architect dogfood-v3 (re-run build-hub.sh end-to-end; pass = build completes through npm ci + image pushed + clean trap-restored working tree)
  - architect retrospective (now covers T1+T2+T3+T4 + iterative-dogfood-finding pattern: two bugs, same mission)
  - mission-status flip mission-50 → completed
  - bug-33 status flip → resolved (overdue; T1 already merged)
  - bug-36 status flip → resolved (overdue; T3 already merged)
  - bug-37 status flip → resolved (at T4 merge)
  - drop bug-33-manual-workaround stash
   ↓
mission close (engineer scope ends at T4 merge + dogfood-v3-pass)

[forward-look, separate scope]:
  - idea-186 (npm workspaces) → triggers cleanup at sunset (still 5 actions: script section + Dockerfile COPY lines + .gitignore entry + .gcloudignore file + README section; T4's full-install reverts to natural workspaces resolution)
  - idea-197 (M-Auto-Redeploy-on-Merge) → must invoke build-hub.sh (closes bug-33 + bug-36 + bug-37 by inheriting all three fixes by composition)
```

---

## Session log (append-only)

- **2026-04-25 evening (AEST)** — mission-50 design + delivery in single session. thread-310 design round (5 rounds) converged on transient-swap pattern after engineer round-2 structural pushback; T1 (task-362) issued post-convergence. T1 codification shipped at PR #33 / `188719e`: `scripts/local/build-hub.sh` §"Storage-provider tarball staging" section + `hub/Dockerfile` COPY lines + `hub/.gitignore` exclusion + happy-path + SIGINT-mid-flight smoke tests. Hub vitest 760/5 baseline held. T2 (task-363) issued post-T1 merge; closing hygiene delivered at PR #34 / `af19bbf`: `deploy/README` §"Cloud Build tarball staging (mission-50)" with 6 subsections (Why / How / Stays clean / CI parity / Sunset / ADR-024 boundary) + closing audit at `docs/audits/m-cloud-build-tarball-codification-closing-report.md` (standard 8-section shape per mission-43/46/47/49 precedent) + this work-trace.
- **2026-04-25 evening (AEST, continuation)** — architect-side dogfood-v1 post-T2 merge (~17:05Z) ran `OIS_ENV=prod scripts/local/build-hub.sh` and hit Cloud Build Step 4/19 COPY failure: `COPY failed: no source files were specified`. Local mechanic worked correctly (tarball staged, package.json + lockfile swapped, gcloud invoked); failure landed at the gcloud-upload-context boundary because `gcloud builds submit` falls back to `.gitignore` for upload filtering when no `.gcloudignore` is present, and T1's intentional `hub/.gitignore` tarball-exclusion silently filtered the staged tarball OUT of the Cloud Build upload. Trap restored working tree cleanly post-failure (T1 SIGINT-test invariant held). bug-36 filed; T3 (task-364) issued direct per bug-31 bypass within ~1h. T3 hotfix: new permanent committed `hub/.gcloudignore` (self-contained, re-includes the staged tarball) + `deploy/README` addendum (§"How" paragraph + §"Sunset condition" 4→5 actions) + closing-audit amendments (criteria #9-#11, §3.3 T3 recap, §4 stats, §5.6 emergent observation on dogfood-finding pattern, §6+§7+§8 updates) + this trace amendment. Engineer-side T3 100% delivered at PR #35; merged at `9636234`.
- **2026-04-25 evening (AEST, continuation 2)** — architect-side dogfood-v2 post-T3 merge (~17:28Z) advanced past T3's upload + COPY fixes (T3 held cleanly), then hit `RUN npm ci` failure inside the Cloud Build container with `Missing: @emnapi/runtime@1.9.2 from lock file` and 10 sibling `@emnapi/*` entries. Root cause: T1's lockfile-regen step `npm install --package-lock-only` does NOT fully resolve platform-conditional / optional dependencies — npm in this mode skips actual installation, so platform-specific native bindings (the `@emnapi/*` family transitively pulled via `@google-cloud/storage` chain) don't get evaluated and don't land in the regenerated lockfile. `npm ci` is strict; missing entries failed validation. Trap again restored working tree cleanly post-failure (T1 SIGINT-test invariant continues to hold across both dogfood-found bugs). bug-37 filed; T4 (task-365) issued direct per bug-31 bypass within ~30 min of dogfood-finding-2. Director's manual workaround stash (`'bug-33 manual workaround pre-mission-50 codification'`) used full `npm install` (not `--package-lock-only`) and produced a complete lockfile with all 11 `@emnapi/*` entries — T1's "optimization" to `--package-lock-only` was the regression; T4 reverts to ground-truth. T4 hotfix: drop `--package-lock-only` flag in `scripts/local/build-hub.sh` (full `npm install --ignore-scripts --no-audit --no-fund --silent`) + ~9-line in-script rationale comment naming bug-37 + the platform-conditional-deps failure mode + the `hub/node_modules/` side-effect (accumulates as cached dev install; already gitignored + gcloudignored) + `deploy/README` Step 3 update + closing-audit amendments (T4 scorecard row, criteria #12-#14, §3.4 T4 recap, §4 stats, §5.6 reinforcement on iterative-dogfood-discipline — two dogfood-found bugs in same mission, the gate is iterative not single-shot for deeply-pipelined missions, §6/§7/§8 updates). Architect-chosen lean (a): leave node_modules in place (no trap cleanup); rejected lean (b) trap-removal because permanent gitignore + gcloudignore handles the visibility concerns and trap-cleanup adds 30-60s overhead for no functional benefit. T4 architect-side dogfood-v3 retrigger reserved for post-T4-merge architect side. Engineer-side mission-50 100% delivered at T4 PR open. Pattern formalized in §5.6: real-deploy dogfood is BOTH load-bearing AND iterative; deeply-pipelined missions can need multiple dogfood iterations to converge to a clean end-to-end pass; that's the gate working as designed. The corollary for sizing: dogfood-bug-surfacing time is part of mission cost — mission-50's S-class mechanics estimate held; close timeline extended by ~2 hours due to the dogfood loop running three times.

---

## Canonical references

- **Mission entity:** `get_mission(mission-50)` (Hub).
- **Source idea:** `get_idea(idea-198)`.
- **Source bugs:** `get_bug(bug-33)` + `get_bug(bug-36)` + `get_bug(bug-37)`.
- **Design round thread:** thread-310 (5 rounds, converged 2026-04-25).
- **Closing audit:** `docs/audits/m-cloud-build-tarball-codification-closing-report.md` — single source of truth for mission shape + criteria + verification + §5.6 dogfood-finding pattern.
- **Operator-facing runbook:** `deploy/README.md` §"Cloud Build tarball staging (mission-50)".
- **ADR boundary:** `docs/decisions/024-sovereign-storage-provider.md` — NOT amended by mission-50.
- **Sunset trigger reference:** idea-186 (npm workspaces adoption) — drives 5-action cleanup list when ratified.
- **Forward-look CI dependency:** idea-197 (M-Auto-Redeploy-on-Merge) — when filed/ratified, MUST invoke `scripts/local/build-hub.sh` or successor (inherits bug-33 + bug-36 fixes by composition).
- **Sibling sovereign-package precedents:** `docs/audits/m-local-fs-cutover-closing-report.md` (mission-48 §5.3 ADR amendment scope discipline); `docs/audits/m-audit-notification-repository-migration-closing-report.md` (mission-49); `docs/audits/m-sovereign-storage-interface-...-retrospective.md` (mission-47 architect-authored retrospective; engineer report skipped per idea-193 scope).
- **Methodology references:** `docs/methodology/multi-agent-pr-workflow.md` v1.0 (per-PR integration gate); `docs/methodology/mission-preflight.md` (activation gate; not invoked for mission-50 due to bug-31 bypass active); methodology v1.0 §dogfood-gate-discipline (load-bearing real-deploy gate, reinforced by closing audit §5.6).
- **Trace mechanics:** `docs/traces/trace-management.md`.
