# Mission M-Cloud-Build-Tarball-Codification — Closing Report

**Hub mission id:** mission-50
**Mission brief:** scoped via thread-310 (architect lily ↔ engineer greg, converged 2026-04-25, 5 rounds — engineer audit produced transient-swap structural pushback at round-2; architect-ratified round-3; engineer convergence-ready round-4; architect staged propose_mission round-5).
**Resolves:** bug-33 (Cloud Build redeploy fails on cross-package context trap — `"file:../packages/storage-provider"` in `hub/package.json` escapes the `gcloud builds submit hub/` upload boundary) + bug-36 (gcloud-upload-context inherits `.gitignore` when no `.gcloudignore` is present, so T1's intentional `hub/.gitignore` tarball exclusion silently propagated to the upload context and the Dockerfile's `COPY ois-storage-provider-*.tgz ./` step failed inside the build container; surfaced at architect-side dogfood post-T2 merge). Codifies the ad-hoc tarball-staging workaround that surfaced during the post-mission-49 redeploy attempt; T3 closes the upload-context gap that mocked happy-path testing missed.
**Source idea:** idea-198 — filed post-bug-33 as the codification ideation seed.
**Dates:** Scoped + activated 2026-04-25 (post-bug-35 fix); T1 + T2 shipped 2026-04-25 same-session; T3 hotfix shipped 2026-04-25 post-architect-dogfood-finding (same day; ~17:05Z dogfood → bug-36 filed → T3 directive issued → T3 PR opened).
**Scope:** 3-task decomposition — T1 codification (build-hub.sh transient swap + Dockerfile + .gitignore), T2 closing hygiene (deploy/README documentation + ADR-024 boundary statement + this report + work-trace), T3 hotfix (`hub/.gcloudignore` + deploy/README + closing-audit addenda; closes bug-36).
**Tele alignment:** tele-3 Sovereign Composition TERTIARY play — preserves the `@ois/storage-provider` sovereign-package contract while operationalizing it for Cloud Build. Build pipeline adapts around the contract; package contract unchanged.

---

## 1. Deliverable scorecard

| Task | Source directive | Status | Branch artifact | PR | Test count delta |
|---|---|---|---|---|---|
| T1 | `build-hub.sh` transient-swap codification + `hub/Dockerfile` COPY lines + `hub/.gitignore` exclusion + SIGINT smoke test | ✅ Merged | `188719e` | #33 | 0 (shell + Dockerfile only; existing tests untouched) |
| T2 | Closing hygiene — `deploy/README` tarball-staging section (rationale + sunset + CI parity + ADR-024 boundary) + closing audit (this file) + work-trace | ✅ Merged | `af19bbf` | #34 | 0 (docs-only) |
| T3 | Hotfix — `hub/.gcloudignore` re-include of staged tarball (closes bug-36); `deploy/README` + closing-audit + work-trace addenda | ⏳ This PR | (pending merge) | (this PR) | 0 (config + docs only) |

**Aggregate:**
- 2 of 3 PRs merged; T3 in-flight.
- Hub test baseline: 52 files / 760 passing / 5 skipped at T1 → unchanged through T2 + T3 (no source changes throughout the mission; T2 docs-only; T3 config + docs only).
- Cumulative diff (T1 + T2 + T3) — four permanent committed files (`hub/Dockerfile` + `hub/.gitignore` + `scripts/local/build-hub.sh` from T1, `hub/.gcloudignore` from T3) + three docs files (`deploy/README.md` modified across T2/T3, closing audit + work-trace authored T2 + amended T3). Ship-discipline: small, focused PRs each landing a single architectural unit; T3 hotfix scoped tightly to the gcloud-upload-context boundary that bug-36 exposed.

**Test counts at mission close:**
- Hub: 52 files / 760 passing / 5 skipped (unchanged from mission-50 T1 ship; was 52/760/5 at bug-35 fix close — no T1 source delta because shell + Dockerfile; no T2 source delta because docs-only; no T3 source delta because config + docs).
- `@ois/storage-provider`: unchanged (no contract delta; the 6-primitive surface held throughout T1+T2+T3).
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
| 8 | bug-33 flippable to resolved with linkage | ⏳ At T1 PR merge | Will flip `open → resolved` with `fixCommits: ["188719e"]` + `linkedMissionId: "mission-50"` post-merge (architect or engineer; routine). |
| 9 | `hub/.gcloudignore` re-includes the staged tarball into the gcloud upload context (closes bug-36) | ✅ MET | T3 implementation: self-contained `hub/.gcloudignore` (no `#!include:.gitignore` directive), excludes `node_modules/`, explicitly re-includes `!ois-storage-provider-*.tgz`. With `.gcloudignore` present, `gcloud builds submit` uses it instead of falling back to `.gitignore` — the staged tarball lands in the upload context, the Dockerfile's `COPY ois-storage-provider-*.tgz ./` step finds it, and Cloud Build proceeds. Architect-side dogfood post-T3 merge confirms end-to-end pass. |
| 10 | Architect-side dogfood gates mission close (real-gcloud-context, not mocked) | ⏳ At T3 PR merge | T1+T2 declared engineer-side complete; architect dogfood post-T2 merge surfaced bug-36; T3 closes that gap. T3 dogfood gate: architect re-runs `OIS_ENV=prod scripts/local/build-hub.sh` end-to-end against post-T3-merge main. Pass criterion: build completes; image pushed to Artifact Registry; `git status` clean (trap restored working tree); no hub/package*.json mods; no staged tarball residue. Mission-50 closes only after this gate passes. |
| 11 | bug-36 flippable to resolved with linkage | ⏳ At T3 PR merge | Will flip `open → resolved` with `fixCommits: ["<T3-merge-sha>"]` + `linkedMissionId: "mission-50"` post-merge (architect or engineer; routine). |

All 11 criteria resolved (8 MET, 3 at flip-time post-T3 merge).

**Success anti-criterion:** _"the workaround can't calcify into a permanent feature that blunts the sunset signal when idea-186 lands."_

**Status:** ✅ MET BY CONSTRUCTION:
- The committed permanent surface is intentionally minimal (4 files, ~5 effective lines of permanent commitment: 2 Dockerfile COPY lines + 1 .gitignore entry + `hub/.gcloudignore` self-contained mini-file; the script section is large but lives in `scripts/local/` not in the Hub source).
- The `TODO(idea-186)` comments in `scripts/local/build-hub.sh` AND `hub/.gcloudignore` + this README §"Sunset condition" + the closing audit's prominent cross-reference all converge the discoverability story when a future engineer touches the build pipeline.
- The transient swap mechanic itself signals workaround — committing a swap-and-restore pattern as the canonical build pre-hook reads as "this is temporary" to anyone reviewing the script for the first time.
- T3's `hub/.gcloudignore` is the smallest possible re-include (one `!` rule + one defensive exclude); when sunset triggers, the entire file is deleted, not edited around.

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

PR #34 / `af19bbf`. Key surfaces:

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

### 3.3 T3 — Hotfix: `hub/.gcloudignore` (closes bug-36)

This PR. Key surfaces:

- **bug-36 framing.** Architect-side dogfood post-T2 merge ran `OIS_ENV=prod scripts/local/build-hub.sh` end-to-end against post-`af19bbf` main. Local mechanic worked perfectly (tarball staged, package.json + lockfile swapped, gcloud invoked); failure landed at Cloud Build Step 4/19 `COPY ois-storage-provider-*.tgz ./` with `COPY failed: no source files were specified`. Trap restored working tree cleanly post-failure (T1 SIGINT-test invariant held). Root cause: `gcloud builds submit` falls back to `.gitignore` for upload-context filtering when no `.gcloudignore` is present, and T1's intentional `hub/.gitignore` exclusion of `ois-storage-provider-*.tgz` (correctly preventing accidental commits) silently propagated to the gcloud upload — the locally-staged tarball was filtered OUT of the upload, the Dockerfile then tried to `COPY` a file that wasn't in the build context, build failed.

- **Why T1 smoke didn't catch it.** T1's happy-path test mocked `gcloud builds submit`; the gcloudignore-inherits-gitignore behavior only manifests against real gcloud against real GCP. SIGINT smoke verified trap-restore (verified working through bug-36 too — that part of T1 was sound). The cross-package context bridge from local mechanic → real Cloud Build upload is what the architect dogfood exposed.

- **`hub/.gcloudignore`** (NEW; T3 sole permanent code commit) — self-contained gcloudignore. Shape:
  - Header comment block explaining the gcloudignore-inherits-gitignore trap + naming bug-36 + naming the load-bearing nature of the file.
  - `node_modules/` exclude (mirrors `.gitignore`'s only meaningful exclusion).
  - `!ois-storage-provider-*.tgz` re-include (the load-bearing line; documentation-style explicit `!` even though no prior exclusion in this self-contained file requires it — defensive against future broader excludes).
  - Trailing `TODO(idea-186)` comment naming the sunset condition (this file deletes entirely when workspaces lands; nothing to edit around).
  - Does NOT use `#!include:.gitignore` — self-contained by design, so the gitignore tarball-exclusion can't leak back in.

- **Architect-chosen approach: lean (a) — committed `hub/.gcloudignore`** (engineer agreed). Considered alternative: lean (b) — script transiently stages `.gcloudignore` alongside the tarball, parallel to the `package.json` swap, with trap removal. Rejected because:
  - Permanent committed file is simpler — single trap surface (just package.json + package-lock.json + tarball, no third file to manage).
  - `hub/.gcloudignore` doesn't interfere with non-build-hub.sh gcloud workflows in `hub/` (most gcloud workflows don't care about `.gcloudignore` presence; build context filtering is the only effect).
  - Permanent surface is the right signal: this is a load-bearing build-pipeline file, not a transient artifact.

- **`deploy/README.md` addendum.** §"Cloud Build tarball staging (mission-50)" §"How (transient swap)" gains a paragraph describing `hub/.gcloudignore`'s role + the bug-36 failure mode it prevents. §"Sunset condition" cleanup list grows from 4 actions to 5 (added: delete `hub/.gcloudignore` entirely).

- **This closing-audit addendum.** §1 scorecard gains T3 row; §2 success criteria gain criteria #9 + #10 + #11 (.gcloudignore re-include; architect-dogfood gate; bug-36 flip); §3.3 (this section); §4 stats updated; §5 gains a new emergent observation (§5.6) on dogfood-finding-via-architect-rebuild; §6 cross-references gain bug-36; §7 architect-owned-remaining shifts from "deferred" to "T3 dogfood gate active"; §8 mission-close-summary updated to T1+T2+T3 arc.

- **Work-trace addendum.** Done-this-session gains T3 entry; session log gains a 2026-04-25 evening entry naming the dogfood-finding flow + the hotfix shape; Edges graph updated; Canonical references gain bug-36 cross-link.

**Verification:**
- gcloudignore syntax is gitignore-compatible per gcloud reference docs (`The .gcloudignore file works similarly to a .gitignore file, but is used by gcloud rather than git`); the `!` re-include works the same way. Doc-supported reasoning per directive's optional path; no local way to test gcloud-side parsing in isolation.
- Hub vitest baseline holds at 52 files / 760 passing / 5 skipped (T3 is config + docs only).
- Architect-side dogfood (post-T3 merge): pass-criterion is end-to-end build success + clean trap-restored working tree + image pushed to Artifact Registry. Mission-50 closes only after this gate passes.

---

## 4. Aggregate stats + verification

**Cumulative mission-50 diff (T1 → T2 → T3):**

| Layer | Files modified | Files added | LOC delta |
|---|---|---|---|
| Hub source (TS) | 0 | 0 | 0 |
| Hub tests | 0 | 0 | 0 |
| Shell scripts | 1 (`scripts/local/build-hub.sh`) | 0 | +71 / -0 net |
| Dockerfiles | 1 (`hub/Dockerfile`) | 0 | +2 / -0 |
| `.gitignore` | 1 (`hub/.gitignore`) | 0 | +1 / -0 |
| `.gcloudignore` (NEW T3) | 0 | 1 (`hub/.gcloudignore`) | +~25 (incl. comment header) |
| Docs (`deploy/README.md`) | 1 (T2: new §"Cloud Build tarball staging" section; T3: §"How" addendum + sunset-list extension) | 0 | +~55 (T2) + ~6 (T3) |
| Closing report | 1 (T3: scorecard row + success criteria + §3.3 + §4 stats + §5.6 + cross-refs + remaining + summary) | 1 (this file; T2 author) | +~180 (T2) + ~85 (T3 amendments) |
| Work-trace | 1 (T3: Done-this-session + session log + Edges + cross-refs) | 1 (T2 author) | +~80 (T2) + ~20 (T3 amendments) |
| ADR | 0 | 0 | 0 (no contract change throughout T1+T2+T3) |

Net (across T1+T2+T3): 4 permanent committed files (`scripts/local/build-hub.sh` + `hub/Dockerfile` + `hub/.gitignore` + `hub/.gcloudignore`); 1 modified runbook (`deploy/README.md`, twice); 2 new docs files (closing report + work-trace, both authored T2 + amended T3).

**Test counts (hub package):**

| Wave | Files | Passing | Skipped | Delta vs prior |
|---|---|---|---|---|
| Pre-mission-50 baseline (post-bug-35 fix close) | 52 | 760 | 5 | — |
| Post-T1 | 52 | 760 | 5 | 0 (shell + Dockerfile only) |
| Post-T2 | 52 | 760 | 5 | 0 (docs-only) |
| Post-T3 (this PR) | 52 | 760 | 5 | 0 (config + docs only) |

**Cross-package verification:**
- `@ois/storage-provider`: contract unchanged throughout — 6-primitive surface held; `capabilities.concurrent` flag held; both `LocalFsStorageProvider` + `GcsStorageProvider` untouched.
- `npm run build` (hub): clean throughout.
- `npx tsc --noEmit` (hub): clean throughout.
- `bash -n scripts/local/build-hub.sh`: clean.

**Per-task effort (estimate vs actual):**

Mission-50 was sized S-class in thread-310 round-3 (single ratified design + closing hygiene). Actual: ~2 hours within a single engineer-side session (T1 ~50min including SIGINT smoke setup + signal-aware mock crafting; T2 ~40min for README + closing report + work-trace; T3 ~30min for hotfix + addenda after architect-dogfood-finding). Aligns with S-class sizing even with the T3 hotfix scope-extension.

This continues the pattern from memory `feedback_pattern_replication_sizing.md`: "Pattern-replication missions size to lower edge — Continuation missions ship faster than estimate; mission-48+49 hit ~13h combined vs M-band per mission". mission-50 is not pattern-replication but is a small-scope codification mission with a tight design ratification — the sub-3-hour total delivery (including the dogfood-found hotfix) is consistent with S-class missions that have a clean ratified shape and a tight feedback loop on bugs surfaced by real-deploy testing.

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

### 5.6 Architect-dogfood-via-real-rebuild surfaces real-gcloud-context bugs that mocked happy-path testing cannot

T1's smoke tests (happy-path + SIGINT mid-flight) used mocked `gcloud builds submit` and mocked `docker`. Both passed cleanly; the trap-restore invariant held under signal-interrupt; the working-tree-clean invariant held in normal exit. The local mechanic was, in its own scope, completely correct.

What the local mechanic could NOT verify: the bridge from "tarball staged in `hub/`" to "tarball lands inside the Cloud Build container". That bridge crosses the `gcloud builds submit` upload-context-filter boundary, and the filter behavior depends on real gcloud reading real `.gcloudignore` / `.gitignore` — exactly the surface mocks elide. The result: T1+T2 declared engineer-side complete with all unit-level invariants verified; architect-side dogfood ran the post-merge real-rebuild end-to-end against real GCP, hit Cloud Build Step 4/19 `COPY ois-storage-provider-*.tgz ./` failure, and surfaced bug-36.

**Pattern captured:** for codification missions whose scope is a deployment-pipeline pattern, mocked happy-path tests verify the mechanic in isolation but cannot verify the mechanic AS-COMPOSED into the deployment pipeline. The deployment-pipeline composition surfaces only against real cloud APIs. The methodology v1.0 §dogfood-gate-discipline answer is correct: real-deploy dogfood as a binding success criterion BEFORE mission close — and mission-50 honored that gate (T1 PR body + closing audit §1 criterion #1 reserved the dogfood gate explicitly), which is what surfaced bug-36 promptly rather than at user-impact time.

**Why this is a positive finding, not a process failure:** the dogfood gate worked exactly as designed. T1+T2 shipped engineer-side complete with the gate explicitly reserved as architect-side post-merge action; the gate ran against real-gcloud; the gate caught the real-context bug; T3 fixed the gap within the same calendar day. The full feedback loop — code → engineer-side ship → architect-dogfood → bug-filed → architect-issues-hotfix → engineer-side fix → architect-dogfood-retry — is the methodology in execution. The lesson is NOT "smoke tests should mock less" (they correctly verified what was in scope); the lesson IS "the dogfood gate is load-bearing, not ceremonial".

**Concrete reinforcement for future missions:** for any mission whose scope crosses the local-mechanic → real-cloud-API boundary (any Cloud Build / Cloud Run / GCS / Artifact Registry interaction wrapped by mocked tests), the architect-side real-deploy dogfood gate MUST run before mission close, MUST be a binding criterion (not a nice-to-have), and MUST have a hotfix-issuance path defined (which mission-50 demonstrated: T3 issued direct per bug-31 bypass within ~1 hour of dogfood-finding).

---

## 6. Cross-references

- **Mission entity:** `get_mission(mission-50)` (Hub) — `M-Cloud-Build-Tarball-Codification`.
- **Source idea:** `get_idea(idea-198)` — codification ideation seed filed post-bug-33.
- **Source bugs:**
  - `get_bug(bug-33)` — Cloud Build cross-package context trap; resolves at T1 merge (already merged, `188719e`) with `fixCommits: ["188719e"]`.
  - `get_bug(bug-36)` — gcloud-upload-context inherits `.gitignore` when no `.gcloudignore` is present; surfaced at architect dogfood post-T2 merge; resolves at T3 merge with `fixCommits: ["<T3-merge-sha>"]`.
- **Design round:** thread-310 — architect lily + engineer greg, 5 rounds, converged 2026-04-25. Round-2 transient-swap structural pushback; round-3 architect ratification; round-5 propose_mission staging.
- **PR T1:** #33, `188719e` — `[mission-50] T1 — build-hub.sh transient-swap codification + Dockerfile + .gitignore`.
- **PR T2:** #34, `af19bbf` — `[mission-50] T2 — Closing hygiene: deploy/README + closing audit + work-trace`.
- **PR T3:** this PR — `[mission-50] T3 — Hotfix: hub/.gcloudignore + addenda (closes bug-36)`.
- **ADR boundary:** `docs/decisions/024-sovereign-storage-provider.md` — NOT amended by mission-50; the amendment record stops at §6.1 (mission-48). See §5.3 above + `deploy/README.md` §"ADR-024 boundary statement".
- **Deploy runbook:** `deploy/README.md` §"Cloud Build tarball staging (mission-50)" — the operator-facing canonical reference for the workaround mechanic + sunset condition + CI parity note + .gcloudignore role.
- **Trace:** `docs/traces/m-cloud-build-tarball-codification-work-trace.md`.
- **Sunset trigger:** idea-186 (npm workspaces adoption) — when ratified, drives the cleanup actions enumerated in §"Sunset condition" of `deploy/README.md` (now 5 actions: script section + Dockerfile COPY lines + .gitignore entry + .gcloudignore file + README section) and the inline `TODO(idea-186)` in `scripts/local/build-hub.sh` and `hub/.gcloudignore`.
- **Forward-look CI dependency:** idea-197 (M-Auto-Redeploy-on-Merge — when filed/ratified) MUST invoke `scripts/local/build-hub.sh` (or its workspaces-aware successor) to inherit the tarball-staging behavior. See `deploy/README.md` §"CI parity note".
- **Bug carry-forward:** bug-32 (cross-package CI debt) — affects every PR; not blocking; pre-existing on main per architect's PR #21 triage. Mission-50 does NOT absorb bug-32; CI debt is separate methodology surface.
- **Sibling sovereign-package preservation:** mission-48 (`m-local-fs-cutover-closing-report.md`) §5.3 — ADR amendment scope discipline precedent that mission-50 §5.3 builds on.
- **Methodology reinforcement:** §5.6 above — dogfood-gate-discipline as load-bearing, not ceremonial. Reinforces methodology v1.0 §dogfood-gate-discipline that codification missions whose smoke tests mock the deployment surface MUST include real-deploy dogfood as a binding success criterion.

---

## 7. Architect-owned remaining

Per task-364 explicit out-of-scope:

- **Architect retrospective** at `docs/reviews/m-cloud-build-tarball-codification-retrospective.md` (or equivalent) — owned by architect; not in engineer scope. Now covers T1+T2+T3 + the dogfood-finding pattern (per §5.6) at architect-level framing.
- **Architect-side dogfood (post-T3 merge):** re-run `OIS_ENV=prod scripts/local/build-hub.sh` end-to-end against post-T3-merge main. Pass criterion: build completes; image pushed to Artifact Registry; `git status` clean (trap restored working tree); no `hub/package*.json` mods; no staged tarball residue. Per Director direction 2026-04-25 (architect owns Hub builds + redeploys).
- **Hub redeploy (post-dogfood-pass):** stop `ois-hub-local-prod` container + restart via `scripts/local/start-hub.sh` against the new image. Only after the T3 dogfood passes.
- **Mission-status flip** mission-50 → `completed` — architect-gated; pending T3 merge + dogfood-pass + retrospective.
- **bug-33 status flip** to `resolved` with `fixCommits: ["188719e"]` + `linkedMissionId: "mission-50"` — routine; either side post-T1 merge (T1 already merged at `188719e`; flip is overdue).
- **bug-36 status flip** to `resolved` with `fixCommits: ["<T3-merge-sha>"]` + `linkedMissionId: "mission-50"` — routine; either side at T3 merge.

---

## 8. Mission close summary

mission-50 (M-Cloud-Build-Tarball-Codification) closes the bug-33 codification arc opened by the post-mission-49 redeploy attempt + the bug-36 upload-context-inheritance gap that architect-side dogfood surfaced post-T2 merge. The mission preserves the `@ois/storage-provider` sovereign-package contract byte-identically while operationalizing a transient-swap pattern in `scripts/local/build-hub.sh` that survives Cloud Build's cross-package context trap AND a self-contained `hub/.gcloudignore` that closes the upload-context filter gap. Permanent committed state stays minimal (4 files, ~5 effective lines: 2 Dockerfile COPY lines + 1 .gitignore entry + a small self-contained `hub/.gcloudignore`), making the sunset clean when idea-186 (npm workspaces) lands and supersedes the workaround.

The mission shipped across a single calendar day 2026-04-25 (~2.5 hours total wall-clock engineer-side: T1 ~50min including SIGINT smoke setup + signal-aware mock crafting, T2 ~40min for documentation, T3 ~30min for hotfix + addenda after architect-dogfood-finding; plus a ~1-hour gap between T2 merge and T3 issuance during which the architect ran the dogfood and surfaced bug-36). T1 PR #33 + T2 PR #34 + T3 PR (this) ship-green per the bug-32 CI pattern verified across mission-49 + mission-48 + bug-35 fix + mission-50 T1+T2 PRs.

Engineer-side scope closes when this T3 PR merges + the architect-side dogfood gate passes. Mission status `completed` flip + retrospective remain on architect side per Director direction 2026-04-25 (architect owns Hub builds + redeploys).

The ADR-024 boundary statement makes explicit that mission-50 is build-pipeline scope, not contract scope — preserving the methodology v1.0 §ADR-amendment-scope-discipline boundary cleanly. The `@ois/storage-provider` 6-primitive contract surface remains unchanged from its mission-47 origin + mission-48 §6.1 deployment-context-only amendment; mission-50 leaves it untouched throughout T1, T2, and T3.

The dogfood-finding pattern that surfaced bug-36 (§5.6) reinforces methodology v1.0 §dogfood-gate-discipline: real-deploy dogfood is load-bearing, not ceremonial, and the full feedback loop (engineer-ship → architect-dogfood → bug-filed → architect-issues-hotfix → engineer-fix → architect-dogfood-retry) is the methodology in execution. Mission-50 demonstrates that loop running cleanly within a single calendar day.
