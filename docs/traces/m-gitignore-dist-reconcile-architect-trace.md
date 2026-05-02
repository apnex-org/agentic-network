# M-Gitignore-Dist-Reconcile — Architect-side work-trace (mission-70)

**Mission:** mission-70 (status: active → pending mission-flip post-PR-merge)
**Engineer-side trace:** N/A — architect-Responsible execution per Phase 6 preflight §B3 (no plannedTasks; outside cascade per mission-68 §4.3 + mission-69 precedent)
**Architect-side trace:** this doc; covers Phase 8 investigation + reconciliation + Phase 9 closing audit + Phase 10 retrospective (single document for compressed-lifecycle micro-mission)
**Author:** lily (architect)

---

## Purpose

Sovereign work-trace for compressed-lifecycle architect-Responsible micro-mission. Captures investigation findings + reconciliation outcome + retrospective reflective surface in one artifact (per mission-69 architect-trace precedent for architect-only post-mission cleanup).

---

## Phase 8 — Investigation execution

Per Design v1.0 §2 procedure. Compressed: §2.2 simulated (no gcloud submit; verified pre-install hook reads as correct); §2.3 + §2.5 fully executed.

### §2.3 (local-dev `npm install` cold-start) — RESULT: FAILED

Clean state: `rm -rf node_modules` + `find packages adapters -name dist -type d -exec rm -rf {} \;` + `find . -name node_modules -type d -prune -exec rm -rf {} \;` (workspace + sub-package level).

Then `npm install` at root:
```
src/cursor-store.ts(33,8): error TS2307: Cannot find module '@apnex/storage-provider' or its corresponding type declarations.
npm error workspace @apnex/repo-event-bridge@1.0.0
```

Root cause: npm workspaces install lifecycle does NOT topologically sort prepare-hook execution by dep graph. `repo-event-bridge`'s `prepare: tsc` ran before `storage-provider`'s prepare completed (or before its dist/ was reachable in resolved node_modules), so the cross-package import failed.

### Bootstrap workaround test — RESULT: SUCCEEDED

Per-package install + build in explicit dep order:
```sh
for pkg in storage-provider repo-event-bridge message-router; do
  ( cd "packages/$pkg" && npm install --ignore-scripts --no-audit --no-fund --silent )
done
for pkg in storage-provider repo-event-bridge message-router; do
  ( cd "packages/$pkg" && npm run build )
done
npm install   # at root, succeeds
```

Verification: storage-provider/dist/ (15 files), repo-event-bridge/dist/ (21 files), message-router/dist/ (12 files) all present. Hub install succeeds: `hub/node_modules/@apnex/{storage-provider,repo-event-bridge}/dist/index.js` resolves via workspace symlinks.

### §2.5 (downstream consumer grep) — Findings

`message-router` consumed by:
- `adapters/claude-plugin/package.json` (version "*")
- `adapters/opencode-plugin/package.json` (version "*")
- `packages/network-adapter/package.json` (version "*")

`network-adapter` ↔ `message-router` have **circular type imports** (each `src/*.ts` references the other's types). Both packages lack `prepare` hooks, so neither auto-builds on install — manual bootstrap requires breaking the circle.

`storage-provider` + `repo-event-bridge` only consumed by Hub (via `file:../packages/<pkg>` refs). Both have `prepare: tsc` hooks.

### Three substantive corrections to `.gitignore` cross-references

1. **"calibration #20"** in repo-event-bridge + message-router blocks — actual #20 is `Thread-message envelope render-layer gap` (mission-62-W4; substrate class), retired by mission-63 PR #119. Unrelated to gitignore/workspaces. Cross-reference is just wrong (numbering confusion or pre-retirement copy-paste).

2. **"idea-186 npm workspaces migration lands"** framing — workspaces SHIPPED via mission-64 PR #122 (commit `8edd3a7`, 2026-04-29). The "until idea-186 lands" deferral is stale.

3. **"workspaces will fix install-order"** implicit promise — workspaces did NOT fix it. The prepare-hook execution order issue persists; workspaces only added symlink-resolution for `file:` refs, not topological lifecycle-script sequencing.

### Origin/main consistency-state

`.gitignore` rules express commit-intent for `dist/` via negation patterns. Origin/main has zero committed dist/ files for any of the 3 packages. Rules are passive (un-ignore IF committed, doesn't enforce commit). Actual workflow:
- Hub container build → `scripts/local/build-hub.sh` does explicit dep-order install + npm pack (sidesteps issue)
- Local dev cold-start → manual per-package bootstrap (workaround undocumented in any README)
- Existing dist/ in dev worktrees → side effect of prior `npm install` runs that happened to bootstrap successfully (post per-package install)

---

## Phase 8 — Reconciliation outcome (Director-approved option α)

Director directive 2026-05-02 ("Approved for a") narrowed scope to comment-tightening + follow-on idea filing. Per Design §6 anti-goals AG-1 (don't migrate workspaces; already shipped) + AG-5 (don't refactor build-hub.sh).

### Action 1 — `.gitignore` edit (~33 lines → ~24 lines)

Replaced 3 multi-paragraph blocks (mission-47/52/56 + #20 commentary) with single tightened block documenting:
- Passive-permission nature of the negation rules (not enforcement)
- Current workflow per investigation: Hub via build-hub.sh; local-dev via manual per-package bootstrap
- Substrate-fix tracker: idea-233
- Acknowledgement of stale-cite removal

Negation rules themselves preserved unchanged — they remain passive permission for future commit-dist/ workflow if needed.

### Action 2 — idea-233 filed

`M-Workspace-Install-Bootstrap` (status=open). Substrate-class follow-on: tsc project references OR topological-bootstrap script OR build-orchestrator. Route-(b) triage-thread candidate per Idea Triage Protocol given substrate scope. Sister-Idea candidate: circular dep elimination between message-router ↔ network-adapter.

### Action 3 — calibration ledger NOT touched

Original Design §4.1 anticipated Outcome A would close calibration #20 closure-folded. Investigation revealed #20 is unrelated retired thread-message-render calibration. No calibration-flip needed. Note: there may be a calibration-class pattern emerging ("stale cross-reference in governance docs after entity-renumbering / mission-supersession") — single instance; doesn't yet warrant pathology codification per AG-4.

---

## Phase 9 — Closing audit (architect-direct)

Compressed inline per mission-69 precedent.

| # | Check | Result | Notes |
|---|---|---|---|
| F1 | Design §2 investigation procedure executed | ✅ PARTIAL | §2.3 + §2.5 fully executed; §2.2 read-validated only (no gcloud submit). Director-approved compression accepts simulation-via-static-analysis for CI path |
| F2 | Outcome path matches Decision Tree §3 | ✅ ADAPTED | Outcome was not in §3 row coverage; Director surfaced new Outcome (α=narrow / β=expand / γ=abandon); approved α. Design §3 row coverage was incomplete — noted as μ-finding-1 below |
| F3 | Reconciliation per Design §4 rules | ✅ PASS | §4 didn't anticipate "stale cross-reference correction" sub-action; Director-approved scope expansion to include the 3 stale-cite corrections in same edit. Aligned with comment-tightening spirit of §4.2 (B-local) |
| F4 | Anti-goals respected | ✅ PASS | AG-1 (workspaces migration): N/A — already shipped pre-mission. AG-2 (commit-enforcement tooling): respected — no new tooling. AG-3 (prepare-hook touches): respected — package.json untouched. AG-4 (calibration class codification): respected — single instance, no class filing. AG-5 (build-hub.sh refactor): respected — read-only inspection |
| F5 | Cross-references stable | ✅ PASS | idea-232 status=incorporated; idea-233 filed open; mission-70 active → completed-pending; calibration #20 unchanged (correctly identified as unrelated); thread-463 already converged |
| F6 | Design v1.0 still accurate as historical record | ⚠️ PARTIAL | Design §1 hypothesis (Outcome A clean) was incorrect. Design §3 decision tree had blind spot (no row for "rules-aspirational-and-rules-misleading-but-rules-still-useful-passive-permission"). Design preserves as Phase-4-time historical state; investigation-time update captured in this work-trace |

**Verdict: GREEN-with-μ-findings.** Mission deliverables shipped; Design quality issues caught at Phase 8 investigation surfaced for retrospective consumption.

---

## Phase 10 — Retrospective (compressed; embedded)

**Mode pick:** Skip — per `mission-lifecycle.md` §Phase 10 three-mode taxonomy. Rationale: governance-doc-reconcile is bug-fix-as-mission-class equivalent; no structural inflection; ~30-60min architect-side; no substrate introduction.

**μ-findings for future mission consumption:**

- **μ1 (Design quality):** §3 decision tree was hypothesis-anchored rather than diagnostic-discovery-anchored. For investigate-then-reconcile missions, decision trees should include an "investigation reveals unanticipated finding" row that triggers Director-surface. Design future-iteration: add row 6 to §3 template = "any cell mismatch → SURFACE, do not auto-pick outcome".

- **μ2 (Anti-goal calibration):** AG-1 said "don't migrate to workspaces; idea-186 owns that scope". Investigation revealed workspaces SHIPPED 2 missions ago. Anti-goals reference idea-state should be verified-current at Phase 4 ratify-direct compression (when there's no engineer-audit to catch it). Future ratify-direct missions: include "anti-goal reference currency check" in preflight §C3.

- **μ3 (Stale cross-reference pathology):** `.gitignore` cited a calibration that's about a different topic and was retired 2 missions ago. Pattern observed before in CLAUDE.md (pre-mission-67 hardening). Single-instance — not yet pathology-class — but worth tracking. Mechanization candidate: doc-graph linting per idea-227 hook scope (architect-runtime concern).

- **μ4 (Compressed-lifecycle precedent extension):** mission-70 = first-canonical "governance-doc-reconcile" sub-class of compressed-lifecycle. Differs from mission-67/68/69 substrate-introduction class: investigation-discovery shape rather than implementation-of-Designed-substrate shape. Sub-class may warrant explicit recognition in mission-class taxonomy if 2nd-canonical instance occurs.

**Methodology-fold candidates (parking; carry-forward to architect strategic-review):**

None new — all 4 μ-findings are sub-finding-tier; not yet calibration candidates. Carrying forward as awareness for future mission Phase 4 + Phase 6 quality-gate refinement.

---

## Cross-references

- **Mission entity:** mission-70 (status: active → completed pending mission-flip post-merge)
- **Source idea:** idea-232 (status: incorporated; missionId=mission-70)
- **Follow-on idea:** idea-233 (M-Workspace-Install-Bootstrap; status: open; substrate-class)
- **Design v1.0:** `docs/designs/m-gitignore-dist-reconcile-design.md` (commit `e225473`)
- **Phase 6 preflight:** `docs/missions/m-gitignore-dist-reconcile-preflight.md` (commit `e225473`)
- **Surfacing thread:** thread-463 (converged 2026-05-02)
- **Lifecycle compression precedents:** mission-67/68/69 (substrate-introduction sub-class)
- **Stale-cite calibration verification:** `docs/calibrations.yaml` #20 (retired thread-message envelope render-layer gap; unrelated to workspaces)
- **Workspaces migration origin:** mission-64 PR #122 (commit `8edd3a7`)

---

— Architect: lily / 2026-05-02 (mission-70 architect-side trace; compressed-lifecycle micro-mission single-doc artifact per mission-69 precedent)
