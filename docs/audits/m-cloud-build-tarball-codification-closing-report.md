# Mission M-Cloud-Build-Tarball-Codification — Closing Report

**Hub mission id:** mission-50
**Mission brief:** scoped via thread-310 (architect lily ↔ engineer greg, converged 2026-04-25, 5 rounds — engineer audit produced transient-swap structural pushback at round-2; architect-ratified round-3; engineer convergence-ready round-4; architect staged propose_mission round-5).
**Resolves:** bug-33 (Cloud Build redeploy fails on cross-package context trap — `"file:../packages/storage-provider"` in `hub/package.json` escapes the `gcloud builds submit hub/` upload boundary). Codifies the ad-hoc tarball-staging workaround that surfaced during the post-mission-49 redeploy attempt.
**Source idea:** idea-198 — filed post-bug-33 as the codification ideation seed.
**Dates:** Scoped + activated 2026-04-25 (post-bug-35 fix); T1 + T2 both shipped 2026-04-25 in a single uninterrupted engineer-side session.
**Scope:** 2-task decomposition — T1 codification (build-hub.sh transient swap + Dockerfile + .gitignore), T2 closing hygiene (deploy/README documentation + ADR-024 boundary statement + this report + work trace).
**Tele alignment:** tele-3 Sovereign Composition TERTIARY play — preserves the `@ois/storage-provider` sovereign-package contract while operationalizing it for Cloud Build. Build pipeline adapts around the contract; package contract unchanged.

---

## 1. Deliverable scorecard

| Task | Source directive | Status | Branch artifact | PR | Test count delta |
|---|---|---|---|---|---|
| T1 | `build-hub.sh` transient-swap codification + `hub/Dockerfile` COPY lines + `hub/.gitignore` exclusion + SIGINT smoke test | ✅ Merged | `188719e` | #33 | 0 (shell + Dockerfile only; existing tests untouched) |
| T2 | Closing hygiene — `deploy/README` tarball-staging section (rationale + sunset + CI parity + ADR-024 boundary) + closing audit (this file) + work-trace | ⏳ This PR | (pending merge) | (this PR) | 0 (docs-only) |

**Aggregate:**
- 1 of 2 PRs merged; T2 in-flight.
- Hub test baseline: 52 files / 760 passing / 5 skipped at T1 → unchanged through T2 (no source changes; T2 docs-only).
- Cumulative diff (T1 + T2) — three permanent committed files + three docs files. Ship-discipline: small, focused PRs each landing a single architectural unit.

**Test counts at mission close:**
- Hub: 52 files / 760 passing / 5 skipped (unchanged from mission-50 T1 ship; was 52/760/5 at bug-35 fix close — no T1 source delta because shell + Dockerfile; no T2 source delta because docs-only).
- `@ois/storage-provider`: unchanged (no contract delta; the 6-primitive surface held).
- Build + typecheck: clean throughout.

---

## 2. Mission goal + success framing

**Parent bug-33** (severity high, `class: deployment-failure`): the post-mission-49 architect-side redeploy of the Hub via `gcloud builds submit hub/` failed because Hub's `package.json` declares `"@ois/storage-provider": "file:../packages/storage-provider"` and the `..` ref escapes the upload boundary that `gcloud builds submit` enforces around the `hub/` build context. Architect manually staged a tarball locally as an ad-hoc unblock; the codification-need was filed as idea-198 → mission-50.

**Mission-50 goal:** ship the smallest-scope codification of the tarball-staging pattern that survives Cloud Build's cross-package context trap, with permanent committed state minimal enough to sunset cleanly when idea-186 (npm workspaces adoption) lands. Local-dev `cd hub && npm install` against the existing `file:../packages/storage-provider` ref MUST keep working unchanged.

**Success criteria (per thread-310 round-3 ratified design):**

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `build-hub.sh` performs transient tarball swap + restores cleanly on every exit path | ✅ MET | T1 implementation: `npm pack --pack-destination "$HUB_DIR"` + sed-substituted `file:./<tarball>` ref + `npm install --package-lock-only` regen; trap on `EXIT INT TERM HUP` restores both files + removes staged tarball. Verified happy-path (mocked gcloud + docker; working tree clean post-run) AND SIGINT-mid-flight smoke test (signal-aware mock; rc=130; tarball cleaned; `package.json` restored to `file:../packages/storage-provider`; no stray `.bak`/`.sedbak` residue). |
| 2 | `hub/package.json` + `hub/package-lock.json` stay clean in git | ✅ MET | Local-dev source-of-truth ref `file:../packages/storage-provider` retained byte-identically; `package-lock.json` stays at file: resolution. Git diffs across both T1 happy-path + SIGINT smoke runs show zero residue in `hub/package*.json`. `cd hub && npm install` behavior unchanged (verified by package shape audit; no actual `npm install` re-run needed since the ref is byte-identical). |
| 3 | `hub/Dockerfile` `COPY ois-storage-provider-*.tgz ./` lines stable across version bumps | ✅ MET | Wildcard match (`ois-storage-provider-*.tgz`) added before each `RUN npm ci` in BOTH builder + production stages. Storage-provider version-bump (e.g. `1.0.0` → `1.1.0`) requires zero Dockerfile coordination — only build-hub.sh's auto-detection flips. |
| 4 | `hub/.gitignore` excludes the staged tarball without false-positive matches | ✅ MET | Pattern `ois-storage-provider-*.tgz` added; verified strict match against `ois-storage-provider-1.0.0.tgz` + `ois-storage-provider-2.5.7.tgz` and explicit non-match against `other-package.tgz` (which still matches the repo-root `*.tgz` rule, so this hub-level entry is more specific, not load-bearing on top of it; explicit-intent over relying on the broader rule). |
| 5 | Sunset trigger documented (idea-186 workspaces adoption) with cleanup steps inline | ✅ MET | `TODO(idea-186)` block in `scripts/local/build-hub.sh` names the trigger + the three cleanup actions (delete the script section, delete the Dockerfile COPY lines, delete the .gitignore entry). T2 `deploy/README` §"Cloud Build tarball staging" §"Sunset condition" repeats the cleanup list with one addition: delete that README section too. |
| 6 | CI parity preserved — auto-redeploy mechanisms must inherit the script's behavior | ✅ MET (forward-look captured) | T2 `deploy/README` §"CI parity note" makes explicit that `scripts/local/build-hub.sh` is canonical until idea-186 lands; idea-197 / M-Auto-Redeploy-on-Merge (when filed/ratified) MUST invoke this script (or a workspaces-aware successor) rather than calling `gcloud builds submit hub/` directly. Bypassing would silently regress bug-33. |
| 7 | ADR-024 boundary preserved — this is build-pipeline, not contract | ✅ MET | T2 `deploy/README` §"ADR-024 boundary statement" makes the boundary explicit. The `@ois/storage-provider` 6-primitive contract is unchanged; the `capabilities.concurrent` flag is unchanged; both `LocalFsStorageProvider` + `GcsStorageProvider` implementations untouched. ADR-024 §6.1 (mission-48 amendment) was the last contract-touching event; mission-50 leaves the contract untouched. |
| 8 | bug-33 flippable to resolved with linkage | ⏳ At T2 PR merge | Will flip `open → resolved` with `fixCommits: ["188719e"]` + `linkedMissionId: "mission-50"` post-merge (architect or engineer; routine). |

All 8 criteria resolved (7 MET, 1 at flip-time post-T2 merge).

**Success anti-criterion:** _"the workaround can't calcify into a permanent feature that blunts the sunset signal when idea-186 lands."_

**Status:** ✅ MET BY CONSTRUCTION:
- The committed permanent surface is intentionally minimal (3 lines: 2 Dockerfile COPY lines + 1 .gitignore entry; the script section is large but lives in `scripts/local/` not in the Hub source).
- The `TODO(idea-186)` comment + this README §"Sunset condition" + the closing audit's prominent cross-reference all converge the discoverability story when a future engineer touches the build pipeline.
- The transient swap mechanic itself signals workaround — committing a swap-and-restore pattern as the canonical build pre-hook reads as "this is temporary" to anyone reviewing the script for the first time.

---

## 3. Per-task architecture recap

### 3.1 T1 — `build-hub.sh` transient-swap codification + `hub/Dockerfile` + `hub/.gitignore`

Full detail in PR #33 / `188719e`. Key surfaces:

- **`scripts/local/build-hub.sh` §"Storage-provider tarball staging (mission-50 T1)" section** (~70 lines added between env-validation and the existing `gcloud builds submit` call). Shape:
  - Variables (`HUB_DIR`, `SP_DIR`, `BACKUP_DIR`, `STAGED_TARBALL`, `SWAP_APPLIED`).
  - `cleanup_tarball_swap()` function — restores `package.json` + `package-lock.json` from `BACKUP_DIR/` (a `mktemp -d` outside `hub/`), removes `STAGED_TARBALL`, removes `BACKUP_DIR`. First action: `trap - EXIT INT TERM HUP` to prevent double-firing.
  - `trap cleanup_tarball_swap EXIT INT TERM HUP` registered before any state mutation.
  - `npm pack --pack-destination "$HUB_DIR" --silent` against `packages/storage-provider/`; filename captured from stdout (npm writes filename to stdout, notices to stderr).
  - `cp` originals to `BACKUP_DIR/` ; flip `SWAP_APPLIED=1` (single guard so cleanup is no-op until past this point).
  - `sed -i.sedbak "s|file:../packages/storage-provider|file:./<tarball>|"` on `hub/package.json`; `rm -f *.sedbak`.
  - Post-substitution `grep -q` invariant verifies the swap landed; fails loud if not.
  - `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --silent` regenerates lockfile.
- **`hub/Dockerfile`** — `COPY ois-storage-provider-*.tgz ./` line added before each `RUN npm ci` line in BOTH builder + production stages (2 lines, 4 affected lines counting context). Wildcard keeps the Dockerfile stable across version bumps.
- **`hub/.gitignore`** — `ois-storage-provider-*.tgz` exclusion (1 line). Path-anchored to hub/ via file location; strict-match verified.
- **Inline `TODO(idea-186)` comment** at the top of the new section names the sunset condition + the three cleanup actions inline.

**Verification:**
- Happy-path test (mocked gcloud + docker, real `npm pack` + `sed` + `npm install --package-lock-only`): tarball staged, swap applied, lockfile regenerated, mocks called with expected args, EXIT trap fires, working tree fully clean of `hub/package*.json` mods + zero stray tarball + zero `.bak`/`.sedbak` residue.
- SIGINT-mid-flight smoke (signal-aware mock gcloud that traps INT/TERM and exits 130 mid-sleep): mid-flight inspection confirmed tarball staged + both package files swapped; `kill -INT` to bash + `pkill -INT -P $BUILD_PID` for child propagation; script exited rc=130; trap fired; working tree restored cleanly with only the 3 intended T1 deltas (`hub/.gitignore`, `hub/Dockerfile`, `scripts/local/build-hub.sh`) and no `hub/package*.json` mods.
- Hub vitest: **760 passed | 5 skipped** (52 files); unchanged from pre-T1 baseline. No TS source touched (shell + Dockerfile only).

### 3.2 T2 — Closing hygiene (deploy/README + closing report + work-trace)

This PR. Key surfaces:

- **`deploy/README.md` §"Cloud Build tarball staging (mission-50)"** — new section inserted after §"Local Docker Hub (scripts/local/)", before §"Backends". Subsections:
  - **Why** — bug-33 framing; the cross-package context trap.
  - **How (transient swap)** — 5-step mechanic + the permanent-state Dockerfile/`gitignore` notes.
  - **Stays clean in git** — local-dev contract preservation.
  - **CI parity note (forward-look)** — script-canonical-until-idea-186; idea-197 inheritance requirement; bypass-regresses-bug-33 warning.
  - **Sunset condition** — idea-186 trigger + 4-action cleanup list (3 from T1 + this README section).
  - **ADR-024 boundary statement** — explicit non-amendment per methodology v1.0 §ADR-amendment-scope-discipline.
- **`docs/audits/m-cloud-build-tarball-codification-closing-report.md`** — this file. Standard 8-section closing-audit shape per mission-43/46/47/49 precedent.
- **`docs/traces/m-cloud-build-tarball-codification-work-trace.md`** — concise 7-section work-trace per `docs/traces/trace-management.md`. Captures resumption pointer + In-flight (empty post-T2) + Done-this-session (T1 + T2) + Edges + Session log + Canonical references + Status legend.

**Verification:**
- No source changes; Hub vitest baseline holds at 52 files / 760 passing / 5 skipped.
- `markdown-lint`-style sanity: section anchors, link refs, glyph legend — all consistent with prior closing audits.

---

## 4. Aggregate stats + verification

**Cumulative mission-50 diff (T1 → T2):**

| Layer | Files modified | Files added | LOC delta |
|---|---|---|---|
| Hub source (TS) | 0 | 0 | 0 |
| Hub tests | 0 | 0 | 0 |
| Shell scripts | 1 (`scripts/local/build-hub.sh`) | 0 | +71 / -0 net |
| Dockerfiles | 1 (`hub/Dockerfile`) | 0 | +2 / -0 |
| `.gitignore` | 1 (`hub/.gitignore`) | 0 | +1 / -0 |
| Docs (`deploy/README.md`) | 1 (new §"Cloud Build tarball staging" section) | 0 | +~55 |
| Closing report | 0 | 1 (this file) | +~180 |
| Work-trace | 0 | 1 | +~80 |
| ADR | 0 | 0 | 0 (no contract change) |

Net: 4 modified files (3 permanent + 1 README); 2 new docs files (closing report + work-trace).

**Test counts (hub package):**

| Wave | Files | Passing | Skipped | Delta vs prior |
|---|---|---|---|---|
| Pre-mission-50 baseline (post-bug-35 fix close) | 52 | 760 | 5 | — |
| Post-T1 | 52 | 760 | 5 | 0 (shell + Dockerfile only) |
| Post-T2 (this PR) | 52 | 760 | 5 | 0 (docs-only) |

**Cross-package verification:**
- `@ois/storage-provider`: contract unchanged throughout — 6-primitive surface held; `capabilities.concurrent` flag held; both `LocalFsStorageProvider` + `GcsStorageProvider` untouched.
- `npm run build` (hub): clean throughout.
- `npx tsc --noEmit` (hub): clean throughout.
- `bash -n scripts/local/build-hub.sh`: clean.

**Per-task effort (estimate vs actual):**

Mission-50 was sized S-class in thread-310 round-3 (single ratified design + closing hygiene). Actual: ~1.5 hours within a single uninterrupted engineer-side session (T1 ~50min including SIGINT smoke setup + signal-aware mock crafting; T2 ~40min for README + closing report + work-trace). Aligns with S-class sizing.

This continues the pattern from memory `feedback_pattern_replication_sizing.md`: "Pattern-replication missions size to lower edge — Continuation missions ship faster than estimate; mission-48+49 hit ~13h combined vs M-band per mission". mission-50 is not pattern-replication but is a small-scope codification mission with a tight design ratification — the sub-2-hour delivery is consistent with S-class missions that have a clean ratified shape.

---

## 5. Emergent observations + side findings

### 5.1 Engineer-audit-produced structural pushback ROI on Tier 0 fixes

The architect's initial design (thread-310 round-1) proposed permanent commits to `hub/package.json` + `hub/package-lock.json` with the file: ref pointing at the staged tarball. The engineer's round-2 audit flagged three structural problems:

1. `hub/package.json`'s `file:../packages/storage-provider` ref is the local-dev source-of-truth — committing the tarball form breaks `cd hub && npm install` (the canonical local-dev entry-point).
2. Every storage-provider version bump would require synchronized commits across both `hub/package.json` (ref update) AND `hub/package-lock.json` (lockfile regen) — coordination cost rising with every storage-provider change.
3. The "permanent commit" framing would calcify the workaround over time, blunting the sunset signal when idea-186 (npm workspaces) lands.

Engineer counter-proposed the transient-swap pattern with `EXIT/INT/TERM/HUP` trap. Architect ratified at round-3 with no further structural pushback; rounds 4-5 were convergence-ready + propose_mission staging.

**Pattern captured:** engineer audit on small-mission designs has ROI even on Tier 0 (bug-fix codification) work, not just on architectural plays. The thread-310 round-2 pushback shifted the mission shape from "permanent-commit hack with a TODO" to "build-pipeline pattern with a clean transient surface and a discoverable sunset trigger." The marginal effort (one round of thread back-and-forth) was small relative to the structural improvement.

This validates the design-round discipline at the small-mission scale: even when the architect's initial framing is reasonable, an engineer audit pass before code starts has positive expected value.

### 5.2 Methodology v1.0 design-round-then-direct-issue hybrid validated

Mission-50 was issued via the "design round → direct-issue" hybrid (no `plannedTasks`; T2 issued direct after T1 PR approval; per methodology v1.0 multi-agent-pr-workflow + bug-31 bypass). The engineer-side experience:

- thread-310 design round produced a ratified shape over 5 rounds (round-2 was the load-bearing pushback round).
- T1 was direct-issued post-convergence with mission-scope captured in mission description.
- T1 shipped exactly the structure ratified at round-3; no mid-mission revision.
- T2 was direct-issued post-T1 PR approval with deliverable list verbatim from the mission description.

Mission scope held at S throughout; the design-round didn't bloat to mid-mission revision. The hybrid worked as intended: clean ratified shape upstream, low-coordination cascade downstream.

**Pattern captured:** when the design round produces a clean ratified shape, direct-issue cascade is structurally cheaper than the `plannedTasks` variant. The `plannedTasks` machinery adds value when scope is uncertain or task-dependencies are non-obvious; for a 2-task mission with the second task being closing hygiene of the first, direct-issue is right-sized.

### 5.3 ADR-024 amendment NOT warranted — build-pipeline vs contract boundary

Mission-50 preserves the `@ois/storage-provider` sovereign-package contract byte-identically. The 6-primitive surface from ADR-024 §2 is unchanged; the `capabilities.concurrent` flag is unchanged; both `LocalFsStorageProvider` and `GcsStorageProvider` implementations are untouched. Hub's dependency on `@ois/storage-provider` continues via the local file: ref for dev; the Cloud Build pipeline adapts around the contract via tarball staging.

ADR-024 §6.1 (mission-48 amendment) was the last contract-touching event for the StorageProvider sovereign package. Mission-48's amendment reclassified the `local-fs` profile as single-writer-laptop-prod-eligible — a deployment-context reclassification, not a contract surface change. Mission-50 doesn't even touch deployment-context classification; it's purely a build-pipeline pattern.

**What this captures:** build-pipeline patterns are a separate methodology surface from sovereign-package contracts. Mission-50 is the empirical proof that a workaround for a deployment-config problem can stay out of the contract layer. Per methodology v1.0 §ADR-amendment-scope-discipline, ADR amendments are reserved for contract changes; deployment-pattern adaptations live in build-pipeline + runbook docs (i.e., `deploy/README.md`).

The boundary statement appears in two places (T2 `deploy/README` §"ADR-024 boundary statement" + this §5.3 closing-audit recap) so future readers don't assume the workaround signals contract evolution. Both pointers are linked from the closing audit's §6 cross-references.

### 5.4 Sovereign-package boundary preservation as tele-3 tertiary play

Tele-3 (Sovereign Composition) had three primary plays this period: mission-47 (network-adapter sovereign extraction), mission-49 (audit + notification migration to `*Repository` over `StorageProvider`), and the upcoming mission-51 M-Message-Primitive (in design at thread-311). Mission-50 is a tertiary play — not a new sovereign-package extraction, but a build-pipeline accommodation that preserves the existing `@ois/storage-provider` boundary cleanly under operational stress.

**What this captures:** tele-3 progress isn't only about new packages or new contracts. Preservation of an existing contract under operational stress (Cloud Build cross-package context trap) is itself a tele-3 reinforcement — it demonstrates that the sovereign-package contract is robust enough to survive deployment-pipeline adaptation without amendment. That robustness is part of the tele's substantive value.

### 5.5 Local-dev path validation discipline

T1's smoke-test scope verified happy-path + SIGINT mid-flight. It did NOT re-run `cd hub && npm install` against the post-T1 `hub/package.json` to verify local-dev resolution still works. The reasoning: `hub/package.json`'s `"@ois/storage-provider": "file:../packages/storage-provider"` ref is byte-identical pre-T1 and post-T1 + post-trap-cleanup; `npm install` behavior is determined by package.json + package-lock.json content, both of which are byte-identical. The verification is by audit, not by re-execution.

**Risk note for future readers:** if a future modification to `build-hub.sh` changes the swap target paths or the trap restoration logic, re-running `cd hub && npm install` to verify local-dev resolution is the right verification step. The byte-identical-ref argument is only valid while the trap restoration is provably complete.

---

## 6. Cross-references

- **Mission entity:** `get_mission(mission-50)` (Hub) — `M-Cloud-Build-Tarball-Codification`.
- **Source idea:** `get_idea(idea-198)` — codification ideation seed filed post-bug-33.
- **Source bug:** `get_bug(bug-33)` — Cloud Build cross-package context trap; resolves at T2 merge with `fixCommits: ["188719e"]`.
- **Design round:** thread-310 — architect lily + engineer greg, 5 rounds, converged 2026-04-25. Round-2 transient-swap structural pushback; round-3 architect ratification; round-5 propose_mission staging.
- **PR T1:** #33, `188719e` — `[mission-50] T1 — build-hub.sh transient-swap codification + Dockerfile + .gitignore`.
- **PR T2:** this PR — `[mission-50] T2 — Closing hygiene: deploy/README + closing audit + work-trace`.
- **ADR boundary:** `docs/decisions/024-sovereign-storage-provider.md` — NOT amended by mission-50; the amendment record stops at §6.1 (mission-48). See §5.3 above + `deploy/README.md` §"ADR-024 boundary statement".
- **Deploy runbook:** `deploy/README.md` §"Cloud Build tarball staging (mission-50)" — the operator-facing canonical reference for the workaround mechanic + sunset condition + CI parity note.
- **Trace:** `docs/traces/m-cloud-build-tarball-codification-work-trace.md`.
- **Sunset trigger:** idea-186 (npm workspaces adoption) — when ratified, drives the cleanup actions enumerated in §"Sunset condition" of `deploy/README.md` and the inline `TODO(idea-186)` in `scripts/local/build-hub.sh`.
- **Forward-look CI dependency:** idea-197 (M-Auto-Redeploy-on-Merge — when filed/ratified) MUST invoke `scripts/local/build-hub.sh` (or its workspaces-aware successor) to inherit the tarball-staging behavior. See `deploy/README.md` §"CI parity note".
- **Bug carry-forward:** bug-32 (cross-package CI debt) — affects every PR; not blocking; pre-existing on main per architect's PR #21 triage. Mission-50 does NOT absorb bug-32; CI debt is separate methodology surface.
- **Sibling sovereign-package preservation:** mission-48 (`m-local-fs-cutover-closing-report.md`) §5.3 — ADR amendment scope discipline precedent that mission-50 §5.3 builds on.

---

## 7. Architect-owned remaining

Per task-363 explicit out-of-scope:

- **Architect retrospective** at `docs/reviews/m-cloud-build-tarball-codification-retrospective.md` (or equivalent) — owned by architect; not in engineer scope. Will likely capture the design-round-pushback ROI observation (§5.1) + the methodology hybrid validation (§5.2) at architect-level framing.
- **Architect-side dogfood** (post-T2 merge): re-run the redeploy that bug-33 hit; verify clean execution end-to-end. Per Director direction 2026-04-25 (architect owns Hub builds + redeploys). The post-T2 sequence: rebuild via `OIS_ENV=prod scripts/local/build-hub.sh` against post-T2 main → dogfoods the codified workaround end-to-end → redeploy via stop + `start-hub.sh` cycle.
- **Mission-status flip** mission-50 → `completed` — architect-gated; pending T2 merge + dogfood + retrospective.
- **bug-33 status flip** to `resolved` with `fixCommits: ["188719e"]` + `linkedMissionId: "mission-50"` — routine; either side at T2 merge.

---

## 8. Mission close summary

mission-50 (M-Cloud-Build-Tarball-Codification) closes the bug-33 codification arc opened by the post-mission-49 redeploy attempt. The mission preserves the `@ois/storage-provider` sovereign-package contract byte-identically while operationalizing a transient-swap pattern in `scripts/local/build-hub.sh` that survives Cloud Build's cross-package context trap. Permanent committed state stays minimal (3 lines: 2 Dockerfile COPY lines + 1 .gitignore entry), making the sunset clean when idea-186 (npm workspaces) lands and supersedes the workaround.

The mission shipped in a single uninterrupted engineer-side session 2026-04-25 (~1.5 hours total: T1 ~50min including SIGINT smoke setup + signal-aware mock crafting, T2 ~40min for documentation). T1 PR #33 + T2 PR (this) ship-green per the bug-32 CI pattern verified across mission-49 + mission-48 + bug-35 fix + mission-50 T1 PRs.

Engineer-side scope closes when this T2 PR merges. Mission status `completed` flip + retrospective + architect dogfood remain on architect side per Director direction 2026-04-25 (architect owns Hub builds + redeploys).

The ADR-024 boundary statement makes explicit that mission-50 is build-pipeline scope, not contract scope — preserving the methodology v1.0 §ADR-amendment-scope-discipline boundary cleanly. The `@ois/storage-provider` 6-primitive contract surface remains unchanged from its mission-47 origin + mission-48 §6.1 deployment-context-only amendment; mission-50 leaves it untouched.
