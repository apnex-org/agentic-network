# M-Cloud-Build-Tarball-Codification — Work Trace (live state)

**Mission scope.** Tracks all in-flight, queued, and recently-completed work under mission-50 (M-Cloud-Build-Tarball-Codification). Goal: close bug-33 by codifying the storage-provider tarball staging that surfaced ad-hoc during the post-mission-49 Cloud Build redeploy. Permanent committed state stays minimal (3 lines: 2 Dockerfile COPY lines + 1 .gitignore entry); the `hub/package.json` + `hub/package-lock.json` swap is fully transient — applied in `scripts/local/build-hub.sh` right before `gcloud builds submit`, restored by trap on `EXIT INT TERM HUP`. S-class; 2-task mission (T1 codification + T2 closing hygiene) ratified at thread-310 round-3.

**Hub mission id:** mission-50.
**Source idea:** idea-198 (codification ideation seed, filed post-bug-33).
**Source bug:** bug-33 (Cloud Build cross-package context trap).
**Architect coordination thread:** thread-310 — architect lily + engineer greg, 5 rounds, converged 2026-04-25 (round-2 transient-swap structural pushback; round-3 architect ratification; round-5 propose_mission staging).
**How to read + update this file:** `docs/traces/trace-management.md`.

**Status legend:** ▶ in-flight · ✅ done this session · ○ queued / filed · ⏸ deferred

---

## Resumption pointer (cold-session brief)

If you're picking up cold:

1. **Read this file first**, then the closing audit at `docs/audits/m-cloud-build-tarball-codification-closing-report.md` (single source of truth for mission shape + criteria + verification + ADR-024 boundary).
2. **Hub mission id:** mission-50 (status=active until architect flips to `completed` post-T2 merge + dogfood).
3. **Current in-flight:** nothing — **ENGINEER-SIDE MISSION-50 100% DELIVERED** at T2 PR. T1 merged at `188719e` (PR #33); T2 closing hygiene is the in-flight PR carrying this trace.
4. **Ratified scope inputs (do NOT re-litigate):** transient-swap pattern (round-2 engineer pushback ratified round-3); permanent committed state ≤ 3 lines + script section; ADR-024 NOT amended; sunset trigger = idea-186 (npm workspaces).
5. **Anti-goals (hold firm):** no permanent commits to `hub/package.json` or `hub/package-lock.json` (the round-2 pushback core); no contract-layer changes to `@ois/storage-provider`; no absorption of bug-32 / idea-186 / idea-197 scope (separate methodology surfaces).
6. **Deploy gate:** Hub ships via local Docker container (`ois-hub:local`) per `project_local_docker_testing.md` memory. Cloud Build is the IMAGE-build path; the resulting image is pulled + tagged + run locally. Architect owns the post-merge dogfood redeploy per Director direction 2026-04-25.
7. **Forward-look:** idea-197 (M-Auto-Redeploy-on-Merge) when filed MUST invoke `scripts/local/build-hub.sh` to inherit tarball staging (or invoke a workspaces-aware successor post-idea-186). Bypassing would silently regress bug-33.

---

## In-flight

_(nothing claimed — **ENGINEER-SIDE MISSION-50 100% DELIVERED**. T1 codification shipped at `188719e` (PR #33). T2 closing hygiene shipping in this PR. Closing audit filed (this commit). Mission-status flip + architect dogfood + retrospective pending architect side per Director direction.)_

---

## Queued / filed

- ○ **PR open on `agent-greg/mission-50-t2-closing-hygiene` → main** — push branch + `gh pr create` referencing thread-310 design round + T1 PR #33 + closing audit + this trace. Per `docs/methodology/multi-agent-pr-workflow.md` v1.0.
- ○ **Mission-status flip** — architect-gated RBAC; engineer cannot call `update_mission`. Architect performs `update_mission({missionId: "mission-50", status: "completed"})` post-T2 merge + dogfood + retrospective.
- ○ **bug-33 resolved-flip** — `update_bug({id: "bug-33", status: "resolved", fixCommits: ["188719e"], linkedMissionId: "mission-50"})`. Routine; either side post-T2 merge.
- ○ **Architect-side dogfood (post-T2 merge):** re-run the redeploy that bug-33 hit; verify clean execution end-to-end. Per Director direction 2026-04-25 (architect owns Hub builds + redeploys).
- ○ **Architect retrospective** at `docs/reviews/m-cloud-build-tarball-codification-retrospective.md` — architect-side; engineer not authoring.

---

## Done this session

- ✅ **thread-310 convergence (design round)** — 5 rounds, converged 2026-04-25. Round-1 architect framed permanent-commit shape; round-2 engineer audit produced transient-swap structural pushback (3 flags: hub/package.json is local-dev source-of-truth; version-bump coordination cost; calcification risk vs sunset signal); round-3 architect ratified transient-swap; round-4 engineer convergence-ready; round-5 architect staged propose_mission. Mission cascade fired creating mission-50; Director activation approval implied by 2026-04-25 autonomous-mode direction.
- ✅ **T1 — `build-hub.sh` transient-swap codification + `hub/Dockerfile` + `hub/.gitignore`.** Shipped at PR #33 / `188719e` (single commit `ff415b3` on branch `agent-greg/mission-50-tarball-codification`; merged at `188719e`). `scripts/local/build-hub.sh`: ~70-line §"Storage-provider tarball staging (mission-50 T1)" section added between env-validation and `gcloud builds submit`. Pre-build hook: `npm pack --pack-destination "$HUB_DIR"` against `packages/storage-provider/`, sed-substituted `file:./<tarball>` ref in transient `hub/package.json` swap, regenerated `hub/package-lock.json` via `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`. Trap on `EXIT INT TERM HUP` restores both files + removes staged tarball; backups land in `mktemp -d` outside hub/. `TODO(idea-186)` sunset comment names trigger + 3-action cleanup. `hub/Dockerfile`: `COPY ois-storage-provider-*.tgz ./` before each `RUN npm ci` in BOTH builder + production stages. `hub/.gitignore`: `ois-storage-provider-*.tgz` exclusion. Verified happy-path (mocked gcloud + docker; working tree clean post-run) + SIGINT-mid-flight smoke (signal-aware mock; rc=130; tarball cleaned; package.json restored; no stray .bak/.sedbak). Hub vitest baseline 760/5 holds (shell + Dockerfile only; no TS source touched).
- ✅ **T2 — Closing hygiene: deploy/README + closing audit + this trace.** Shipping in this PR. `deploy/README.md` §"Cloud Build tarball staging (mission-50)" inserted after §"Local Docker Hub" with subsections: Why / How (transient swap) / Stays clean in git / CI parity note (forward-look) / Sunset condition / ADR-024 boundary statement. `docs/audits/m-cloud-build-tarball-codification-closing-report.md` authored — standard 8-section closing-audit shape per mission-43/46/47/49 precedent (deliverable scorecard, mission goal + 8 success criteria, per-task architecture recap, aggregate stats + verification, 5 emergent observations, cross-references, architect-owned remaining, mission close summary). This trace authored to canonical 7-section shape. No source changes; baseline 760/5 holds.

---

## Edges (dependency chains)

```
thread-310 (design round) ✅
   ↓
T1 (PR #33 / 188719e) ✅ MERGED
   ↓
T2 (this PR) ▶ in-flight at PR open; transitions to ✅ on merge
   ↓
[architect side]:
  - architect dogfood post-T2 merge (re-run bug-33 redeploy)
  - architect retrospective
  - mission-status flip mission-50 → completed
  - bug-33 status flip → resolved
   ↓
mission close (engineer scope ends at T2 merge)

[forward-look, separate scope]:
  - idea-186 (npm workspaces) → triggers cleanup at sunset
  - idea-197 (M-Auto-Redeploy-on-Merge) → must invoke build-hub.sh
```

---

## Session log (append-only)

- **2026-04-25 evening (AEST)** — mission-50 design + delivery in single session. thread-310 design round (5 rounds) converged on transient-swap pattern after engineer round-2 structural pushback; T1 (task-362) issued post-convergence. T1 codification shipped at PR #33 / `188719e`: `scripts/local/build-hub.sh` §"Storage-provider tarball staging" section + `hub/Dockerfile` COPY lines + `hub/.gitignore` exclusion + happy-path + SIGINT-mid-flight smoke tests. Hub vitest 760/5 baseline held. T2 (task-363) issued post-T1 merge; closing hygiene delivered: `deploy/README` §"Cloud Build tarball staging (mission-50)" with 6 subsections (Why / How / Stays clean / CI parity / Sunset / ADR-024 boundary) + closing audit at `docs/audits/m-cloud-build-tarball-codification-closing-report.md` (standard 8-section shape per mission-43/46/47/49 precedent) + this work-trace. Engineer-side mission-50 100% delivered at T2 PR open; architect-side dogfood + retrospective + mission-status flip pending.

---

## Canonical references

- **Mission entity:** `get_mission(mission-50)` (Hub).
- **Source idea:** `get_idea(idea-198)`.
- **Source bug:** `get_bug(bug-33)`.
- **Design round thread:** thread-310 (5 rounds, converged 2026-04-25).
- **Closing audit:** `docs/audits/m-cloud-build-tarball-codification-closing-report.md` — single source of truth for mission shape + criteria + verification.
- **Operator-facing runbook:** `deploy/README.md` §"Cloud Build tarball staging (mission-50)".
- **ADR boundary:** `docs/decisions/024-sovereign-storage-provider.md` — NOT amended by mission-50.
- **Sunset trigger reference:** idea-186 (npm workspaces adoption).
- **Forward-look CI dependency:** idea-197 (M-Auto-Redeploy-on-Merge) — when filed/ratified, MUST invoke `scripts/local/build-hub.sh` or successor.
- **Sibling sovereign-package precedents:** `docs/audits/m-local-fs-cutover-closing-report.md` (mission-48 §5.3 ADR amendment scope discipline); `docs/audits/m-audit-notification-repository-migration-closing-report.md` (mission-49); `docs/audits/m-sovereign-storage-interface-...-retrospective.md` (mission-47 architect-authored retrospective; engineer report skipped per idea-193 scope).
- **Methodology references:** `docs/methodology/multi-agent-pr-workflow.md` v1.0 (per-PR integration gate); `docs/methodology/mission-preflight.md` (activation gate; not invoked for mission-50 due to bug-31 bypass active).
- **Trace mechanics:** `docs/traces/trace-management.md`.
