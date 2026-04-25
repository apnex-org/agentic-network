# M-Cloud-Build-Tarball-Codification — Work Trace (live state)

**Mission scope.** Tracks all in-flight, queued, and recently-completed work under mission-50 (M-Cloud-Build-Tarball-Codification). Goal: close bug-33 (Cloud Build cross-package context trap) + bug-36 (gcloud-upload-context inherits .gitignore when no .gcloudignore is present, surfaced at architect dogfood post-T2). Permanent committed state stays minimal (4 files, ~5 effective lines: 2 Dockerfile COPY lines + 1 .gitignore entry + a small self-contained `hub/.gcloudignore`); the `hub/package.json` + `hub/package-lock.json` swap is fully transient — applied in `scripts/local/build-hub.sh` right before `gcloud builds submit`, restored by trap on `EXIT INT TERM HUP`. S-class; 3-task mission (T1 codification + T2 closing hygiene + T3 hotfix) ratified at thread-310 round-3 with T3 scope-extension issued direct post-architect-dogfood-finding.

**Hub mission id:** mission-50.
**Source idea:** idea-198 (codification ideation seed, filed post-bug-33).
**Source bugs:**
- bug-33 (Cloud Build cross-package context trap; resolves at T1 merge `188719e`).
- bug-36 (gcloud-upload-context inherits .gitignore; resolves at T3 merge).
**Architect coordination thread:** thread-310 — architect lily + engineer greg, 5 rounds, converged 2026-04-25 (round-2 transient-swap structural pushback; round-3 architect ratification; round-5 propose_mission staging).
**How to read + update this file:** `docs/traces/trace-management.md`.

**Status legend:** ▶ in-flight · ✅ done this session · ○ queued / filed · ⏸ deferred

---

## Resumption pointer (cold-session brief)

If you're picking up cold:

1. **Read this file first**, then the closing audit at `docs/audits/m-cloud-build-tarball-codification-closing-report.md` (single source of truth for mission shape + criteria + verification + ADR-024 boundary + §5.6 dogfood-finding pattern).
2. **Hub mission id:** mission-50 (status=active until architect flips to `completed` post-T3 merge + T3 dogfood-pass + retrospective).
3. **Current in-flight:** nothing — **ENGINEER-SIDE MISSION-50 100% DELIVERED** at T3 PR. T1 merged at `188719e` (PR #33); T2 merged at `af19bbf` (PR #34); T3 hotfix is the in-flight PR carrying these trace amendments.
4. **Ratified scope inputs (do NOT re-litigate):** transient-swap pattern (round-2 engineer pushback ratified round-3); permanent committed state minimal (~5 effective lines across 4 files post-T3); `hub/.gcloudignore` permanent committed lean (a) per architect's T3 directive (rejected lean (b) transient-stage approach for trap-simplicity); ADR-024 NOT amended; sunset trigger = idea-186 (npm workspaces); dogfood-gate is load-bearing per §5.6.
5. **Anti-goals (hold firm):** no permanent commits to `hub/package.json` or `hub/package-lock.json` (the round-2 pushback core); no contract-layer changes to `@ois/storage-provider`; no absorption of bug-32 / idea-186 / idea-197 scope (separate methodology surfaces); no `#!include:.gitignore` in `hub/.gcloudignore` (self-contained by design — the gitignore tarball-exclusion can't leak back in).
6. **Deploy gate:** Hub ships via local Docker container (`ois-hub:local`) per `project_local_docker_testing.md` memory. Cloud Build is the IMAGE-build path; the resulting image is pulled + tagged + run locally. Architect owns the post-merge dogfood redeploy per Director direction 2026-04-25.
7. **Forward-look:** idea-197 (M-Auto-Redeploy-on-Merge) when filed MUST invoke `scripts/local/build-hub.sh` to inherit tarball staging (or invoke a workspaces-aware successor post-idea-186). Bypassing would silently regress bug-33 + bug-36.
8. **T3 hotfix lesson:** bug-36 surfaced because mocked happy-path tests can't verify the bridge from "tarball staged in `hub/`" to "tarball lands in Cloud Build container" — that bridge crosses the `gcloud builds submit` upload-context-filter boundary, which only manifests against real gcloud. §5.6 of the closing audit formalizes this. For future deployment-pipeline missions: real-deploy dogfood gate is binding, not ceremonial.

---

## In-flight

_(nothing claimed — **ENGINEER-SIDE MISSION-50 100% DELIVERED**. T1 codification shipped at `188719e` (PR #33). T2 closing hygiene shipped at `af19bbf` (PR #34). T3 hotfix shipping in this PR. Closing audit + work-trace amended this commit. Mission-status flip + T3 architect dogfood + retrospective pending architect side per Director direction.)_

---

## Queued / filed

- ○ **PR open on `agent-greg/mission-50-t3-gcloudignore-hotfix` → main** — push branch + `gh pr create` referencing T1 PR #33 + T2 PR #34 + bug-36 framing + architect-side T3 dogfood-gate retrigger note. Per `docs/methodology/multi-agent-pr-workflow.md` v1.0.
- ○ **Mission-status flip** — architect-gated RBAC; engineer cannot call `update_mission`. Architect performs `update_mission({missionId: "mission-50", status: "completed"})` post-T3 merge + T3 dogfood-pass + retrospective.
- ○ **bug-33 resolved-flip** — `update_bug({id: "bug-33", status: "resolved", fixCommits: ["188719e"], linkedMissionId: "mission-50"})`. Routine; either side post-T1 merge (overdue — T1 already merged at `188719e`).
- ○ **bug-36 resolved-flip** — `update_bug({id: "bug-36", status: "resolved", fixCommits: ["<T3-merge-sha>"], linkedMissionId: "mission-50"})`. Routine; either side at T3 merge.
- ○ **Architect-side T3 dogfood:** re-run `OIS_ENV=prod scripts/local/build-hub.sh` end-to-end against post-T3-merge main; pass criterion is build-completes + image-pushed + clean trap-restored working tree. Per Director direction 2026-04-25 (architect owns Hub builds + redeploys).
- ○ **Architect retrospective** at `docs/reviews/m-cloud-build-tarball-codification-retrospective.md` — architect-side; engineer not authoring. Now covers T1+T2+T3 + the dogfood-finding pattern (closing audit §5.6).

---

## Done this session

- ✅ **thread-310 convergence (design round)** — 5 rounds, converged 2026-04-25. Round-1 architect framed permanent-commit shape; round-2 engineer audit produced transient-swap structural pushback (3 flags: hub/package.json is local-dev source-of-truth; version-bump coordination cost; calcification risk vs sunset signal); round-3 architect ratified transient-swap; round-4 engineer convergence-ready; round-5 architect staged propose_mission. Mission cascade fired creating mission-50; Director activation approval implied by 2026-04-25 autonomous-mode direction.
- ✅ **T1 — `build-hub.sh` transient-swap codification + `hub/Dockerfile` + `hub/.gitignore`.** Shipped at PR #33 / `188719e` (single commit `ff415b3` on branch `agent-greg/mission-50-tarball-codification`; merged at `188719e`). `scripts/local/build-hub.sh`: ~70-line §"Storage-provider tarball staging (mission-50 T1)" section added between env-validation and `gcloud builds submit`. Pre-build hook: `npm pack --pack-destination "$HUB_DIR"` against `packages/storage-provider/`, sed-substituted `file:./<tarball>` ref in transient `hub/package.json` swap, regenerated `hub/package-lock.json` via `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`. Trap on `EXIT INT TERM HUP` restores both files + removes staged tarball; backups land in `mktemp -d` outside hub/. `TODO(idea-186)` sunset comment names trigger + 3-action cleanup. `hub/Dockerfile`: `COPY ois-storage-provider-*.tgz ./` before each `RUN npm ci` in BOTH builder + production stages. `hub/.gitignore`: `ois-storage-provider-*.tgz` exclusion. Verified happy-path (mocked gcloud + docker; working tree clean post-run) + SIGINT-mid-flight smoke (signal-aware mock; rc=130; tarball cleaned; package.json restored; no stray .bak/.sedbak). Hub vitest baseline 760/5 holds (shell + Dockerfile only; no TS source touched).
- ✅ **T2 — Closing hygiene: deploy/README + closing audit + this trace.** Shipped at PR #34 / `af19bbf`. `deploy/README.md` §"Cloud Build tarball staging (mission-50)" inserted after §"Local Docker Hub" with subsections: Why / How (transient swap) / Stays clean in git / CI parity note (forward-look) / Sunset condition / ADR-024 boundary statement. `docs/audits/m-cloud-build-tarball-codification-closing-report.md` authored — standard 8-section closing-audit shape per mission-43/46/47/49 precedent (deliverable scorecard, mission goal + 8 success criteria, per-task architecture recap, aggregate stats + verification, 5 emergent observations, cross-references, architect-owned remaining, mission close summary). This trace authored to canonical 7-section shape. No source changes; baseline 760/5 holds.
- ✅ **T3 — Hotfix: hub/.gcloudignore (closes bug-36) + addenda.** Shipping in this PR. Architect-side dogfood post-T2-merge ran `OIS_ENV=prod scripts/local/build-hub.sh` end-to-end and hit Cloud Build Step 4/19 `COPY ois-storage-provider-*.tgz ./` failure (`COPY failed: no source files were specified`). Root cause: `gcloud builds submit` falls back to `.gitignore` when no `.gcloudignore` is present — T1's intentional `hub/.gitignore` tarball-exclusion silently propagated to the upload context, so the locally-staged tarball was filtered out of the upload, and the Dockerfile's COPY step failed inside the build container. T1's mocked happy-path tests couldn't see this bridge (gcloud was mocked); local trap-restore worked correctly throughout (T1 SIGINT-test invariant held even through the bug-36 failure path). T3 (task-364) issued direct per bug-31 bypass within ~1h of dogfood-finding. Hotfix: new permanent committed `hub/.gcloudignore` (self-contained, NOT inheriting `.gitignore` via `#!include:`; `node_modules/` exclude + `!ois-storage-provider-*.tgz` re-include + TODO(idea-186) sunset comment) + `deploy/README.md` §"How" addendum explaining the gcloudignore-inherits-gitignore trap + §"Sunset condition" cleanup-list extension (4 → 5 actions) + closing-audit amendments (T3 row in scorecard, criteria #9-#11, §3.3 T3 recap, §4 stats update, §5.6 emergent observation on architect-dogfood-via-real-rebuild surfacing real-gcloud-context bugs that mocks cannot, §6 cross-refs gain bug-36, §7+§8 update). No source changes; baseline 760/5 holds. Architect-chosen lean (a) approach (committed file) over lean (b) (transient stage in build-hub.sh) — engineer agreed; permanent surface = right signal for load-bearing build-pipeline file.

---

## Edges (dependency chains)

```
thread-310 (design round) ✅
   ↓
T1 (PR #33 / 188719e) ✅ MERGED
   ↓
T2 (PR #34 / af19bbf) ✅ MERGED
   ↓
[architect-side dogfood post-T2] ✅ RAN — surfaced bug-36
   ↓
T3 (this PR) ▶ in-flight at PR open; transitions to ✅ on merge
   ↓
[architect side post-T3 merge]:
  - architect T3 dogfood (re-run build-hub.sh end-to-end; pass = build completes + image pushed + clean trap-restored working tree)
  - architect retrospective (now covers T1+T2+T3 + dogfood-finding pattern)
  - mission-status flip mission-50 → completed
  - bug-33 status flip → resolved (overdue; T1 already merged)
  - bug-36 status flip → resolved (at T3 merge)
   ↓
mission close (engineer scope ends at T3 merge + dogfood-pass)

[forward-look, separate scope]:
  - idea-186 (npm workspaces) → triggers cleanup at sunset (now 5 actions, including delete hub/.gcloudignore)
  - idea-197 (M-Auto-Redeploy-on-Merge) → must invoke build-hub.sh (closes bug-33 + bug-36 by inheriting both fixes)
```

---

## Session log (append-only)

- **2026-04-25 evening (AEST)** — mission-50 design + delivery in single session. thread-310 design round (5 rounds) converged on transient-swap pattern after engineer round-2 structural pushback; T1 (task-362) issued post-convergence. T1 codification shipped at PR #33 / `188719e`: `scripts/local/build-hub.sh` §"Storage-provider tarball staging" section + `hub/Dockerfile` COPY lines + `hub/.gitignore` exclusion + happy-path + SIGINT-mid-flight smoke tests. Hub vitest 760/5 baseline held. T2 (task-363) issued post-T1 merge; closing hygiene delivered at PR #34 / `af19bbf`: `deploy/README` §"Cloud Build tarball staging (mission-50)" with 6 subsections (Why / How / Stays clean / CI parity / Sunset / ADR-024 boundary) + closing audit at `docs/audits/m-cloud-build-tarball-codification-closing-report.md` (standard 8-section shape per mission-43/46/47/49 precedent) + this work-trace.
- **2026-04-25 evening (AEST, continuation)** — architect-side dogfood post-T2 merge (~17:05Z) ran `OIS_ENV=prod scripts/local/build-hub.sh` and hit Cloud Build Step 4/19 COPY failure: `COPY failed: no source files were specified`. Local mechanic worked correctly (tarball staged, package.json + lockfile swapped, gcloud invoked); failure landed at the gcloud-upload-context boundary because `gcloud builds submit` falls back to `.gitignore` for upload filtering when no `.gcloudignore` is present, and T1's intentional `hub/.gitignore` tarball-exclusion silently filtered the staged tarball OUT of the Cloud Build upload. Trap restored working tree cleanly post-failure (T1 SIGINT-test invariant held). bug-36 filed; T3 (task-364) issued direct per bug-31 bypass within ~1h. T3 hotfix: new permanent committed `hub/.gcloudignore` (self-contained, re-includes the staged tarball) + `deploy/README` addendum (§"How" paragraph + §"Sunset condition" 4→5 actions) + closing-audit amendments (criteria #9-#11, §3.3 T3 recap, §4 stats, §5.6 emergent observation on dogfood-finding pattern, §6+§7+§8 updates) + this trace amendment. T3 architect-side dogfood retrigger reserved for post-T3-merge architect side. Engineer-side mission-50 100% delivered at T3 PR open. Pattern reinforced: real-deploy dogfood gate is load-bearing for any mission whose scope crosses the local-mechanic → real-cloud-API boundary; mocked happy-path tests verify the mechanic in isolation but cannot verify the AS-COMPOSED deployment-pipeline behavior.

---

## Canonical references

- **Mission entity:** `get_mission(mission-50)` (Hub).
- **Source idea:** `get_idea(idea-198)`.
- **Source bugs:** `get_bug(bug-33)` + `get_bug(bug-36)`.
- **Design round thread:** thread-310 (5 rounds, converged 2026-04-25).
- **Closing audit:** `docs/audits/m-cloud-build-tarball-codification-closing-report.md` — single source of truth for mission shape + criteria + verification + §5.6 dogfood-finding pattern.
- **Operator-facing runbook:** `deploy/README.md` §"Cloud Build tarball staging (mission-50)".
- **ADR boundary:** `docs/decisions/024-sovereign-storage-provider.md` — NOT amended by mission-50.
- **Sunset trigger reference:** idea-186 (npm workspaces adoption) — drives 5-action cleanup list when ratified.
- **Forward-look CI dependency:** idea-197 (M-Auto-Redeploy-on-Merge) — when filed/ratified, MUST invoke `scripts/local/build-hub.sh` or successor (inherits bug-33 + bug-36 fixes by composition).
- **Sibling sovereign-package precedents:** `docs/audits/m-local-fs-cutover-closing-report.md` (mission-48 §5.3 ADR amendment scope discipline); `docs/audits/m-audit-notification-repository-migration-closing-report.md` (mission-49); `docs/audits/m-sovereign-storage-interface-...-retrospective.md` (mission-47 architect-authored retrospective; engineer report skipped per idea-193 scope).
- **Methodology references:** `docs/methodology/multi-agent-pr-workflow.md` v1.0 (per-PR integration gate); `docs/methodology/mission-preflight.md` (activation gate; not invoked for mission-50 due to bug-31 bypass active); methodology v1.0 §dogfood-gate-discipline (load-bearing real-deploy gate, reinforced by closing audit §5.6).
- **Trace mechanics:** `docs/traces/trace-management.md`.
