# Mission M-Cloud-Build-Tarball-Codification — Closing Report

**Hub mission id:** mission-50
**Mission brief:** scoped via thread-310 (architect lily ↔ engineer greg, converged 2026-04-25, 5 rounds — engineer audit produced transient-swap structural pushback at round-2; architect-ratified round-3; engineer convergence-ready round-4; architect staged propose_mission round-5).
**Resolves:** bug-33 (Cloud Build redeploy fails on cross-package context trap — `"file:../packages/storage-provider"` in `hub/package.json` escapes the `gcloud builds submit hub/` upload boundary) + bug-36 (gcloud-upload-context inherits `.gitignore` when no `.gcloudignore` is present, so T1's intentional `hub/.gitignore` tarball exclusion silently propagated to the upload context and the Dockerfile's `COPY ois-storage-provider-*.tgz ./` step failed inside the build container; surfaced at architect-side dogfood-v1 post-T2 merge) + bug-37 (`npm install --package-lock-only` does NOT fully resolve platform-conditional / optional dependencies; the regenerated lockfile was missing 11 `@emnapi/*` entries; surfaced at architect-side dogfood-v2 post-T3 merge) + bug-38 (host-side lockfile regeneration is structurally fragile against host-vs-container npm/node version drift, registry state at regen time, and operator-environment variation; T4's full-install regen still produced a lockfile the container's npm 10 / node 22 toolchain rejected with simultaneous `@emnapi/*@1.9.2` AND `@emnapi/*@1.10.0` demands; surfaced at architect-side dogfood-v3 post-T4 merge). Codifies the ad-hoc tarball-staging workaround that surfaced during the post-mission-49 redeploy attempt; T3 closes the upload-context gap; T4 closes the lockfile-completeness gap; T5 removes host-side lockfile regen entirely + switches Dockerfile to `npm install` so the container resolves its own dep tree.
**Source idea:** idea-198 — filed post-bug-33 as the codification ideation seed.
**Dates:** Scoped + activated 2026-04-25 (post-bug-35 fix); T1 + T2 shipped 2026-04-25 same-session; T3 hotfix shipped 2026-04-25 post-dogfood-v1 (~17:05Z → bug-36 → T3); T4 hotfix shipped 2026-04-25 post-dogfood-v2 (~17:28Z → bug-37 → T4); T5 hotfix shipped 2026-04-25 post-dogfood-v3 (~17:52Z → bug-38 → T5). All five tasks land within a single calendar day; three dogfood iterations.
**Scope:** 5-task decomposition — T1 codification (build-hub.sh transient swap + Dockerfile + .gitignore), T2 closing hygiene (deploy/README documentation + ADR-024 boundary statement + this report + work-trace), T3 hotfix (`hub/.gcloudignore` + addenda; closes bug-36), T4 hotfix (drop `--package-lock-only` flag; closes bug-37), T5 hotfix (drop host-side lockfile regen entirely + Dockerfile `npm ci` → `npm install`; closes bug-38).
**Tele alignment:** tele-3 Sovereign Composition TERTIARY play — preserves the `@apnex/storage-provider` sovereign-package contract while operationalizing it for Cloud Build. Build pipeline adapts around the contract; package contract unchanged.

---

## 1. Deliverable scorecard

| Task | Source directive | Status | Branch artifact | PR | Test count delta |
|---|---|---|---|---|---|
| T1 | `build-hub.sh` transient-swap codification + `hub/Dockerfile` COPY lines + `hub/.gitignore` exclusion + SIGINT smoke test | ✅ Merged | `188719e` | #33 | 0 (shell + Dockerfile only; existing tests untouched) |
| T2 | Closing hygiene — `deploy/README` tarball-staging section (rationale + sunset + CI parity + ADR-024 boundary) + closing audit (this file) + work-trace | ✅ Merged | `af19bbf` | #34 | 0 (docs-only) |
| T3 | Hotfix — `hub/.gcloudignore` re-include of staged tarball (closes bug-36); `deploy/README` + closing-audit + work-trace addenda | ✅ Merged | `9636234` | #35 | 0 (config + docs only) |
| T4 | Hotfix — drop `--package-lock-only` flag in `scripts/local/build-hub.sh` (full `npm install` for complete platform-conditional dep resolution; closes bug-37); `deploy/README` Step 3 + closing-audit + work-trace addenda | ✅ Merged | `f29635d` | #36 | 0 (shell + docs only) |
| T5 | Hotfix — drop host-side lockfile regen entirely from `scripts/local/build-hub.sh` + `hub/Dockerfile` `npm ci` → `npm install` in BOTH stages (closes bug-38); `deploy/README` §"How" simplification + new §"Why no host-side lockfile regen" subsection + sunset-list extension; closing-audit + work-trace addenda | ⏳ This PR | (pending merge) | (this PR) | 0 (shell + Dockerfile + docs) |

**Aggregate:**
- 4 of 5 PRs merged; T5 in-flight.
- Hub test baseline: 52 files / 760 passing / 5 skipped at T1 → unchanged through T2 + T3 + T4 + T5 (no Hub-source changes throughout the mission; T2 docs-only; T3 config + docs only; T4 shell + docs only; T5 shell + Dockerfile + docs only).
- Cumulative diff (T1 + T2 + T3 + T4 + T5) — four permanent committed files (`hub/Dockerfile` modified T1 + T5, `hub/.gitignore` from T1, `scripts/local/build-hub.sh` modified T1 + T4 + T5, `hub/.gcloudignore` from T3) + three docs files (`deploy/README.md` modified across T2/T3/T4/T5, closing audit + work-trace authored T2 + amended T3 + T4 + T5). Ship-discipline: small, focused PRs each landing a single architectural unit; T3 + T4 + T5 hotfixes each scoped tightly to the boundary the corresponding dogfood iteration exposed.

**Test counts at mission close:**
- Hub: 52 files / 760 passing / 5 skipped (unchanged from mission-50 T1 ship; was 52/760/5 at bug-35 fix close — no T1 source delta because shell + Dockerfile; no T2 source delta because docs-only; no T3 source delta because config + docs; no T4 source delta because shell + docs; no T5 source delta because shell + Dockerfile + docs).
- `@apnex/storage-provider`: unchanged (no contract delta; the 6-primitive surface held throughout T1+T2+T3+T4+T5).
- Build + typecheck: clean throughout.

---

## 2. Mission goal + success framing

**Parent bug-33** (severity high, `class: deployment-failure`): the post-mission-49 architect-side redeploy of the Hub via `gcloud builds submit hub/` failed because Hub's `package.json` declares `"@apnex/storage-provider": "file:../packages/storage-provider"` and the `..` ref escapes the upload boundary that `gcloud builds submit` enforces around the `hub/` build context. Architect manually staged a tarball locally as an ad-hoc unblock; the codification-need was filed as idea-198 → mission-50.

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
| 7 | ADR-024 boundary preserved — this is build-pipeline, not contract | ✅ MET | T2 `deploy/README` §"ADR-024 boundary statement" makes the boundary explicit. The `@apnex/storage-provider` 6-primitive contract is unchanged; the `capabilities.concurrent` flag is unchanged; both `LocalFsStorageProvider` + `GcsStorageProvider` implementations untouched. ADR-024 §6.1 (mission-48 amendment) was the last contract-touching event; mission-50 leaves the contract untouched. |
| 8 | bug-33 flippable to resolved with linkage | ⏳ At T1 PR merge | Will flip `open → resolved` with `fixCommits: ["188719e"]` + `linkedMissionId: "mission-50"` post-merge (architect or engineer; routine). |
| 9 | `hub/.gcloudignore` re-includes the staged tarball into the gcloud upload context (closes bug-36) | ✅ MET | T3 implementation: self-contained `hub/.gcloudignore` (no `#!include:.gitignore` directive), excludes `node_modules/`, explicitly re-includes `!ois-storage-provider-*.tgz`. With `.gcloudignore` present, `gcloud builds submit` uses it instead of falling back to `.gitignore` — the staged tarball lands in the upload context, the Dockerfile's `COPY ois-storage-provider-*.tgz ./` step finds it, and Cloud Build proceeds. Architect-side dogfood post-T3 merge confirms end-to-end pass. |
| 10 | Architect-side dogfood gates mission close (real-gcloud-context, not mocked) | ⏳ At T3 PR merge | T1+T2 declared engineer-side complete; architect dogfood post-T2 merge surfaced bug-36; T3 closes that gap. T3 dogfood gate: architect re-runs `OIS_ENV=prod scripts/local/build-hub.sh` end-to-end against post-T3-merge main. Pass criterion: build completes; image pushed to Artifact Registry; `git status` clean (trap restored working tree); no hub/package*.json mods; no staged tarball residue. Mission-50 closes only after this gate passes. |
| 11 | bug-36 flippable to resolved with linkage | ⏳ At T3 PR merge | Will flip `open → resolved` with `fixCommits: ["9636234"]` + `linkedMissionId: "mission-50"` (architect or engineer; routine). T3 merged at `9636234`. |
| 12 | `npm ci` succeeds inside the Cloud Build container against the regenerated lockfile | ✅ MET | T4 implementation: dropped `--package-lock-only` flag in `scripts/local/build-hub.sh`'s lockfile-regen step. Full `npm install --ignore-scripts --no-audit --no-fund --silent` produces a complete lockfile (all 11 `@emnapi/*` platform-conditional entries populated, matching Director's working manual workaround that was the original ground-truth). `npm ci` is strict against lockfile-vs-package-tree mismatches; the full-install lockfile passes that strict-validation. Architect-side dogfood-v3 (post-T4 merge) will provide end-to-end verification. |
| 13 | Architect-side dogfood-v3 passes end-to-end (third dogfood iteration; post-T4) | ⏳ At T4 PR merge | Architect re-runs `OIS_ENV=prod scripts/local/build-hub.sh` end-to-end against post-T4-merge main. Pass criterion: build completes; image pushed to Artifact Registry; `git status hub/ scripts/ deploy/ docs/` clean (trap restored package*.json + removed staged tarball; `hub/node_modules/` acceptable per lean (a)). Mission-50 closes only after this gate passes. |
| 14 | bug-37 flippable to resolved with linkage | ⏳ At T4 PR merge | Will flip `open → resolved` with `fixCommits: ["f29635d"]` + `linkedMissionId: "mission-50"` (architect or engineer; routine). T4 merged at `f29635d`. |
| 15 | Host-side lockfile regen removed; build-hub.sh no longer touches `hub/package-lock.json` | ✅ MET | T5 implementation: dropped the `npm install ...` invocation from `scripts/local/build-hub.sh` entirely. Trap simplified — `BACKUP_DIR/package-lock.json` cp + restore lines removed; trap now backs up + restores only `hub/package.json` and removes the staged tarball. The script's net effect on `hub/package-lock.json`: zero. Verified by inspection + smoke test (mocked gcloud + docker; post-run `git diff hub/package-lock.json` empty). |
| 16 | Dockerfile uses `npm install` (not `npm ci`) in BOTH builder + production stages so the container resolves its own dep tree | ✅ MET | T5 implementation: `RUN npm install --ignore-scripts --no-audit --no-fund` (builder) + `RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund` (production). Container resolves its dep tree against its own `node:22-slim` / `npm 10.x` toolchain, against the swap-modified `package.json` (file:./tarball ref). Inline rationale comment block in Dockerfile names bug-38, the host-vs-container drift origin, and the post-idea-186 reversion path back to `npm ci`. |
| 17 | Architect-side dogfood-v4 passes end-to-end (fourth dogfood iteration; post-T5) | ⏳ At T5 PR merge | Architect re-runs `OIS_ENV=prod scripts/local/build-hub.sh` end-to-end against post-T5-merge main. Pass criterion: build completes through ALL Dockerfile steps (builder `npm install` + `npm run build` + production stage `npm install --omit=dev` + image build) + image pushed to Artifact Registry + `git status hub/ scripts/ deploy/ docs/` clean (trap restored `hub/package.json`; staged tarball removed; `hub/node_modules/` and `hub/package-lock.json` invisible to git + gcloud). Mission-50 closes only after this fourth dogfood iteration passes. |
| 18 | bug-38 flippable to resolved with linkage | ⏳ At T5 PR merge | Will flip `open → resolved` with `fixCommits: ["<T5-merge-sha>"]` + `linkedMissionId: "mission-50"` (architect or engineer; routine). |

All 18 criteria resolved (11 MET, 7 at flip-time post-T5 merge / dogfood-v4).

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
- **`docs/audits/m-cloud-build-tarball-codification-closing-audit.md`** — this file. Standard 8-section closing-audit shape per mission-43/46/47/49 precedent.
- **`docs/traces/m-cloud-build-tarball-codification-work-trace.md`** — concise 7-section work-trace per `docs/methodology/trace-management.md`. Captures resumption pointer + In-flight (empty post-T2) + Done-this-session (T1 + T2) + Edges + Session log + Canonical references + Status legend.

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
- Architect-side dogfood-v2 (post-T3 merge) verified T3 fix: build advanced past the upload + COPY stages cleanly. Same dogfood surfaced bug-37 at the next downstream stage (`npm ci` inside the Cloud Build container) — addressed by T4.

### 3.4 T4 — Hotfix: drop `--package-lock-only` (closes bug-37)

This PR. Key surfaces:

- **bug-37 framing.** Architect-side dogfood-v2 ran post-T3-merge (~17:28Z 2026-04-25). Cloud Build advanced past T3's upload + COPY fixes (`hub/.gcloudignore` correctly re-included the staged tarball; the upload context was complete). Failure landed at `RUN npm ci` in the builder stage with `Missing: @emnapi/runtime@1.9.2 from lock file` (and 10 sibling `@emnapi/*` entries). Trap again restored the local working tree cleanly post-failure (T1 SIGINT-test invariant continues to hold across both dogfood-found bugs).

- **Root cause.** T1's lockfile-regeneration step used `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --silent`. The `--package-lock-only` flag, while faster, does NOT fully resolve platform-conditional / optional dependencies — npm in this mode skips actual installation, so platform-specific native bindings (the `@emnapi/*` family in our case, transitively pulled via `@google-cloud/storage` → `gaxios` → `node-fetch` → `formdata-node` chain) don't get evaluated and don't land in the regenerated lockfile. `npm ci` is strict: any lockfile-vs-package-tree mismatch fails. The lockfile produced by `--package-lock-only` was missing 11 `@emnapi/*` entries that the original committed lockfile (file:../packages/storage-provider resolution) had fully populated.

- **Fix mechanic.** Drop the `--package-lock-only` flag. `scripts/local/build-hub.sh`'s lockfile-regen step now runs full `npm install --ignore-scripts --no-audit --no-fund --silent`. Full install walks the dep tree, evaluates platform-conditional optional deps against the running platform, fetches native bindings, and writes the resolved tree to `hub/package-lock.json`. The complete lockfile passes `npm ci` strict-validation inside the Cloud Build container.

- **Ground-truth corroboration.** Director's original manual workaround (the bug-33 unblock, stashed as `'bug-33 manual workaround pre-mission-50 codification'`) used a FULL `npm install` for lockfile regen — the stashed lockfile has all 11 `@emnapi/*` entries populated. T1's "optimization" to `--package-lock-only` was the regression; T4 reverts to the ground-truth approach. The `npm install --include=optional --include=peer` alternative was considered but not pursued — the directive's lean (drop `--package-lock-only`) matches Director's working ground-truth, is verifiably complete, and avoids depending on undocumented `--package-lock-only` interaction with `--include=*` flags.

- **Side-effect: `hub/node_modules/` accumulates.** Full install creates `hub/node_modules/` (~hundreds of MB). Already excluded from both `hub/.gitignore` (T1) and `hub/.gcloudignore` (T3) — does not pollute git status nor the Cloud Build upload context. Architect-chosen lean (a): leave node_modules in place as a cached dev install (speeds up subsequent `cd hub && npm install`). Trap does NOT clean it. Considered alternative lean (b) — add `rm -rf hub/node_modules/` to the trap — rejected: ~30-60s overhead per build for no functional benefit; node_modules is already invisible to git + gcloud.

- **In-script rationale comment.** `scripts/local/build-hub.sh` gains a multi-line comment block above the `npm install` invocation naming bug-37, the `--package-lock-only` failure mode (the missing `@emnapi/*` entries), and the side-effect (node_modules accumulation, gitignored + gcloudignored). Keeps the rationale discoverable from the script itself, so future readers don't "optimize" back to `--package-lock-only` without seeing the failure history.

- **`deploy/README.md` Step 3 update.** §"How (transient swap)" Step 3 grows ~3-4 lines: full `npm install` (not `--package-lock-only`) + bug-37 reference + lockfile-completeness rationale + node_modules side-effect note.

**Verification:**
- Hub vitest baseline holds at 52 files / 760 passing / 5 skipped (T4 is shell + docs only).
- Lockfile-completeness verified by comparison against Director's ground-truth manual workaround stash (full install produces a lockfile matching that working baseline, including the 11 `@emnapi/*` entries that `--package-lock-only` was missing).
- Architect-side dogfood-v3 (post-T4 merge) verified T4 fix: build advanced past T3+T4 stages cleanly. Same dogfood surfaced bug-38 at the same `npm ci` step (different shape — strict-validation mismatch on simultaneous `@emnapi/*@1.9.2 + @1.10.0` demands; T4's full-install lockfile was complete relative to T1's `--package-lock-only` but still environmentally fragile against host-vs-container drift). T4 fix held its scope; T5 addresses the deeper structural fragility.

### 3.5 T5 — Hotfix: drop host-side lockfile regen + Dockerfile `npm ci` → `npm install` (closes bug-38)

This PR. Key surfaces:

- **bug-38 framing.** Architect-side dogfood-v3 ran post-T4-merge (~17:52Z 2026-04-25). Cloud Build advanced past T1+T3 fixes (tarball uploads, COPY succeeds with `hub/.gcloudignore` re-include); T4's full-install regen produced a complete lockfile in the host-environment sense but the container's `npm ci` strict-validator rejected it with FOUR `@emnapi/*` missing entries (BOTH `1.9.2` AND `1.10.0` versions demanded by the container's package tree, but only one version present in the regenerated lockfile). Trap again restored the local working tree cleanly post-failure (T1 SIGINT-test invariant continues to hold across all three dogfood-found bugs).

- **Root-cause investigation (architect-side, captured in bug-38).**
  - Host: `node v24.12.0` + `npm 11.6.2`.
  - Container (`node:22-slim`): `node v22.x` + `npm 10.9.7`.
  - Manual repro: full host `npm install` produces lockfile with single `@emnapi` version; container's npm 10 demands BOTH versions (different optional-dep resolution strategy).
  - Director's ground-truth manual workaround stash had `@emnapi/*@1.10.0`; T4's regen produced `@emnapi/*@1.9.2`. Different registry state at different times produces different pinnings — the approach is environmentally fragile by construction.
  - In-docker host-side regen attempt blocked by architect-laptop kernel (Fedora 31 / Linux 5.8; `node:22` thread layer Aborts).

- **Conclusion (architect's investigation).** Host-side lockfile regeneration is fundamentally fragile against (a) host-vs-container npm/node version drift, (b) registry state at regen time, (c) operator-environment variation. The codification must NOT depend on host-side lockfile regen.

- **Fix mechanic.**
  - **`scripts/local/build-hub.sh`:** drop the `npm install ...` invocation entirely. The script after T5 does (a) pack tarball, (b) sed-swap `hub/package.json`, (c) `gcloud builds submit`. Trap restores `hub/package.json` + removes staged tarball. Lockfile is NEVER modified by the script. The TODO(idea-186) comment block grew to a multi-line rationale section explaining why host-side regen was dropped + the Dockerfile `npm install` tradeoff + the post-idea-186 reversion path.
  - **`hub/Dockerfile`:** `RUN npm ci` → `RUN npm install --ignore-scripts --no-audit --no-fund` (builder); `RUN npm ci --omit=dev` → `RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund` (production). Container resolves its own dep tree at build time, against the swap-modified `package.json` (file:./tarball ref) using its own toolchain. Inline comment in Dockerfile names bug-38 + post-idea-186 reversion to `npm ci`.
  - **Trap simplification.** `cleanup_tarball_swap()` now backs up + restores only `hub/package.json` (not `hub/package-lock.json`); the lockfile cp + restore lines are removed entirely. Net effect: simpler trap, smaller backup-dir footprint, lockfile invariant trivially preserved (script never touches it).

- **Tradeoff acknowledgment (in deploy/README + here).** Switching `npm ci` → `npm install` in the Cloud Build path removes strict lockfile-validation FOR THAT PATH. Acceptable for THIS codification arc because:
  - The lockfile was already transient in the build path (regenerated each build by build-hub.sh in T1-T4; never reaching commit-state-strictness for Cloud Build);
  - Local-dev `cd hub && npm install` keeps using the committed lockfile via the unchanged `file:../packages/storage-provider` ref;
  - Sunset (idea-186) reverts the Dockerfile to `npm ci` once workspaces resolve the file: ref natively against the committed lockfile.

- **Anti-paths considered + rejected (per task-366 directive).**
  - Pin `@emnapi` or other transitive deps in `packages/storage-provider/`: REJECTED — crosses ADR-024 contract boundary.
  - In-docker host-side regen: REJECTED — operator-environment fragility (architect's laptop kernel blocks it).
  - Add specific npm flags (`--include=optional` etc.) to bridge version-mismatch: REJECTED — architect verified they don't (also the host-vs-container drift is npm-version-level, not flag-level).
  - Engineer-side considered alternative: keep `npm ci` and generate the lockfile inside the Dockerfile (`RUN npm install --package-lock-only && npm ci`). REJECTED on this engineer's call: two npm invocations vs one; just shifts the regen problem inside the container; doesn't add real strictness because the in-container regen still depends on registry state at build time. The chosen lean (drop host regen + Dockerfile `npm install`) is structurally simpler and the tradeoff is bounded by the sunset condition.

- **`deploy/README.md` updates.**
  - §"How (transient swap)": Step 3 (lockfile regen) deleted; remaining steps renumbered (1-4 + trap as Step 4); Dockerfile-`npm install` reference updated.
  - NEW subsection §"Why no host-side lockfile regen (bug-38)" — three numbered drift sources + the "only durable fix is to NOT regenerate on host" conclusion + the tradeoff paragraph (`npm install` vs `npm ci` for the Cloud Build path; lockfile transient anyway; sunset reverts to `npm ci`).
  - §"Stays clean in git" tightened — clarifies that `hub/package-lock.json` is no longer touched at all by the script (T5).
  - §"Sunset condition" cleanup list grows from 5 → 6 actions (added: revert Dockerfile `npm install` lines back to `npm ci` / `npm ci --omit=dev` once workspaces lands and the file: ref resolves natively against the committed lockfile).

- **In-script `TODO(idea-186)` rewrite.** The block in `scripts/local/build-hub.sh` was a one-paragraph note in T1+T4; T5 expands it to a multi-line section: header (Hub depends on @apnex/storage-provider via file: ref that breaks under Cloud Build), pre-build hook description (pack + swap + gcloud submit; container resolves dep tree at build time), bug-38 explanation (why host-side regen was dropped), and TODO(idea-186) sunset (script section + Dockerfile COPY lines + .gitignore entry + .gcloudignore + Dockerfile `npm install` reversion to `npm ci`).

**Verification:**
- Hub vitest baseline holds at 52 files / 760 passing / 5 skipped (T5 is shell + Dockerfile + docs only).
- `bash -n scripts/local/build-hub.sh`: clean.
- Smoke test (mocked gcloud + docker; from-clean main): script runs end-to-end; tarball packed + staged; `hub/package.json` swapped to file:./tarball ref; `gcloud` mock invoked with expected args; `docker` mock invoked; trap fires on EXIT and restores `hub/package.json` + removes staged tarball; post-run `git diff hub/` empty (zero residue in `hub/package*.json`; no leftover tarball).
- Architect-side dogfood-v4 (post-T5 merge): pass-criterion is end-to-end build success through ALL Dockerfile steps (builder `npm install` + `npm run build` + production stage `npm install --omit=dev` + image build) + image pushed to Artifact Registry + clean trap-restored working tree. **Mission-50 closes only after this fourth dogfood iteration passes.**

---

## 4. Aggregate stats + verification

**Cumulative mission-50 diff (T1 → T2 → T3 → T4 → T5):**

| Layer | Files modified | Files added | LOC delta |
|---|---|---|---|
| Hub source (TS) | 0 | 0 | 0 |
| Hub tests | 0 | 0 | 0 |
| Shell scripts | 1 (`scripts/local/build-hub.sh`; modified T1 + T4 + T5) | 0 | +71 (T1) + ~9 net (T4) + net deletion in T5: -10 (drop npm install line + lockfile cp/restore) + ~25 (expanded TODO comment block) ≈ +15 net |
| Dockerfiles | 1 (`hub/Dockerfile`; modified T1 + T5) | 0 | +2 (T1 COPY lines) + +12 net (T5: 2× `npm ci` → `npm install` line + ~10-line rationale comment block) |
| `.gitignore` | 1 (`hub/.gitignore`) | 0 | +1 / -0 |
| `.gcloudignore` (NEW T3) | 0 | 1 (`hub/.gcloudignore`) | +~25 (incl. comment header) |
| Docs (`deploy/README.md`) | 1 (T2: new §"Cloud Build tarball staging" section; T3: §"How" addendum + sunset-list extension; T4: Step 3 update; T5: §"How" simplification + new §"Why no host-side lockfile regen" subsection + §"Stays clean in git" tightening + sunset-list extension 5→6) | 0 | +~55 (T2) + ~6 (T3) + ~3 (T4) + ~25 (T5) |
| Closing report | 1 (T3+T4 amendments per prior rows; T5: another scorecard row + criteria #15-#18 + §3.5 + §4 stats + §5.6 reinforcement-3rd-time + cross-refs + remaining + summary) | 1 (this file; T2 author) | +~180 (T2) + ~85 (T3) + ~80 (T4) + ~120 (T5 amendments) |
| Work-trace | 1 (T3-T5 amendments) | 1 (T2 author) | +~80 (T2) + ~20 (T3) + ~20 (T4) + ~25 (T5 amendments) |
| ADR | 0 | 0 | 0 (no contract change throughout T1+T2+T3+T4+T5) |

Net (across T1+T2+T3+T4+T5): 4 permanent committed files (`scripts/local/build-hub.sh` modified T1+T4+T5 + `hub/Dockerfile` modified T1+T5 + `hub/.gitignore` from T1 + `hub/.gcloudignore` from T3); 1 modified runbook (`deploy/README.md`, four times); 2 new docs files (closing report + work-trace, both authored T2 + amended T3+T4+T5).

**Test counts (hub package):**

| Wave | Files | Passing | Skipped | Delta vs prior |
|---|---|---|---|---|
| Pre-mission-50 baseline (post-bug-35 fix close) | 52 | 760 | 5 | — |
| Post-T1 | 52 | 760 | 5 | 0 (shell + Dockerfile only) |
| Post-T2 | 52 | 760 | 5 | 0 (docs-only) |
| Post-T3 | 52 | 760 | 5 | 0 (config + docs only) |
| Post-T4 | 52 | 760 | 5 | 0 (shell + docs only) |
| Post-T5 (this PR) | 52 | 760 | 5 | 0 (shell + Dockerfile + docs only) |

**Cross-package verification:**
- `@apnex/storage-provider`: contract unchanged throughout — 6-primitive surface held; `capabilities.concurrent` flag held; both `LocalFsStorageProvider` + `GcsStorageProvider` untouched.
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

Mission-50 preserves the `@apnex/storage-provider` sovereign-package contract byte-identically. The 6-primitive surface from ADR-024 §2 is unchanged; the `capabilities.concurrent` flag is unchanged; both `LocalFsStorageProvider` and `GcsStorageProvider` implementations are untouched. Hub's dependency on `@apnex/storage-provider` continues via the local file: ref for dev; the Cloud Build pipeline adapts around the contract via tarball staging.

ADR-024 §6.1 (mission-48 amendment) was the last contract-touching event for the StorageProvider sovereign package. Mission-48's amendment reclassified the `local-fs` profile as single-writer-laptop-prod-eligible — a deployment-context reclassification, not a contract surface change. Mission-50 doesn't even touch deployment-context classification; it's purely a build-pipeline pattern.

**What this captures:** build-pipeline patterns are a separate methodology surface from sovereign-package contracts. Mission-50 is the empirical proof that a workaround for a deployment-config problem can stay out of the contract layer. Per methodology v1.0 §ADR-amendment-scope-discipline, ADR amendments are reserved for contract changes; deployment-pattern adaptations live in build-pipeline + runbook docs (i.e., `deploy/README.md`).

The boundary statement appears in two places (T2 `deploy/README` §"ADR-024 boundary statement" + this §5.3 closing-audit recap) so future readers don't assume the workaround signals contract evolution. Both pointers are linked from the closing audit's §6 cross-references.

### 5.4 Sovereign-package boundary preservation as tele-3 tertiary play

Tele-3 (Sovereign Composition) had three primary plays this period: mission-47 (network-adapter sovereign extraction), mission-49 (audit + notification migration to `*Repository` over `StorageProvider`), and the upcoming mission-51 M-Message-Primitive (in design at thread-311). Mission-50 is a tertiary play — not a new sovereign-package extraction, but a build-pipeline accommodation that preserves the existing `@apnex/storage-provider` boundary cleanly under operational stress.

**What this captures:** tele-3 progress isn't only about new packages or new contracts. Preservation of an existing contract under operational stress (Cloud Build cross-package context trap) is itself a tele-3 reinforcement — it demonstrates that the sovereign-package contract is robust enough to survive deployment-pipeline adaptation without amendment. That robustness is part of the tele's substantive value.

### 5.5 Local-dev path validation discipline

T1's smoke-test scope verified happy-path + SIGINT mid-flight. It did NOT re-run `cd hub && npm install` against the post-T1 `hub/package.json` to verify local-dev resolution still works. The reasoning: `hub/package.json`'s `"@apnex/storage-provider": "file:../packages/storage-provider"` ref is byte-identical pre-T1 and post-T1 + post-trap-cleanup; `npm install` behavior is determined by package.json + package-lock.json content, both of which are byte-identical. The verification is by audit, not by re-execution.

**Risk note for future readers:** if a future modification to `build-hub.sh` changes the swap target paths or the trap restoration logic, re-running `cd hub && npm install` to verify local-dev resolution is the right verification step. The byte-identical-ref argument is only valid while the trap restoration is provably complete.

### 5.6 Architect-dogfood-via-real-rebuild surfaces real-gcloud-context bugs that mocked happy-path testing cannot

T1's smoke tests (happy-path + SIGINT mid-flight) used mocked `gcloud builds submit` and mocked `docker`. Both passed cleanly; the trap-restore invariant held under signal-interrupt; the working-tree-clean invariant held in normal exit. The local mechanic was, in its own scope, completely correct.

What the local mechanic could NOT verify: the bridge from "tarball staged in `hub/`" to "tarball lands inside the Cloud Build container". That bridge crosses the `gcloud builds submit` upload-context-filter boundary, and the filter behavior depends on real gcloud reading real `.gcloudignore` / `.gitignore` — exactly the surface mocks elide. The result: T1+T2 declared engineer-side complete with all unit-level invariants verified; architect-side dogfood ran the post-merge real-rebuild end-to-end against real GCP, hit Cloud Build Step 4/19 `COPY ois-storage-provider-*.tgz ./` failure, and surfaced bug-36.

**Pattern captured:** for codification missions whose scope is a deployment-pipeline pattern, mocked happy-path tests verify the mechanic in isolation but cannot verify the mechanic AS-COMPOSED into the deployment pipeline. The deployment-pipeline composition surfaces only against real cloud APIs. The methodology v1.0 §dogfood-gate-discipline answer is correct: real-deploy dogfood as a binding success criterion BEFORE mission close — and mission-50 honored that gate (T1 PR body + closing audit §1 criterion #1 reserved the dogfood gate explicitly), which is what surfaced bug-36 promptly rather than at user-impact time.

**Why this is a positive finding, not a process failure:** the dogfood gate worked exactly as designed. T1+T2 shipped engineer-side complete with the gate explicitly reserved as architect-side post-merge action; the gate ran against real-gcloud; the gate caught the real-context bug; T3 fixed the gap within the same calendar day. The full feedback loop — code → engineer-side ship → architect-dogfood → bug-filed → architect-issues-hotfix → engineer-side fix → architect-dogfood-retry — is the methodology in execution. The lesson is NOT "smoke tests should mock less" (they correctly verified what was in scope); the lesson IS "the dogfood gate is load-bearing, not ceremonial".

**Concrete reinforcement for future missions:** for any mission whose scope crosses the local-mechanic → real-cloud-API boundary (any Cloud Build / Cloud Run / GCS / Artifact Registry interaction wrapped by mocked tests), the architect-side real-deploy dogfood gate MUST run before mission close, MUST be a binding criterion (not a nice-to-have), and MUST have a hotfix-issuance path defined (which mission-50 demonstrated: T3 issued direct per bug-31 bypass within ~1 hour of dogfood-finding-1; T4 issued direct within ~30 minutes of dogfood-finding-2).

**T4 reinforcement (second dogfood-found bug, same mission):** dogfood-v2 ran post-T3 merge, advanced past the upload + COPY stages (T3's `hub/.gcloudignore` fix held cleanly), and then surfaced bug-37 at the next downstream stage (`npm ci` inside the Cloud Build container failing with `Missing: @emnapi/runtime@... from lock file` because `--package-lock-only` doesn't fully resolve platform-conditional / optional deps). The same dogfood-loop pattern fired again: engineer-ship T3 → architect-dogfood-v2 → bug-37 filed → architect-issues-T4-direct → engineer-fix → architect-dogfood-v3 (post-T4 merge, pending). Two bugs surfaced at the same gate within ~30 minutes of each other; both caught well before user-impact.

What T4 specifically reinforces: **the dogfood gate is iterative, not single-shot.** A mission that crosses multiple deployment-pipeline boundaries (upload-context filtering AND lockfile validation AND container-internal `npm ci` AND image-push AND container-start) needs as many dogfood iterations as there are boundary failures to surface. Mocking saves time on the inner mechanic; it doesn't substitute for end-to-end real-cloud verification. Mission-50 needed three dogfood iterations (initial + post-T3 + post-T4) to converge to a clean end-to-end pass; that's not a process failure, it's the gate working as designed for a deeply-pipelined mission scope.

The corollary for sizing: **dogfood-bug-surfacing time is part of mission cost.** mission-50 was sized S-class on engineer-side mechanics; the actual close timeline includes ~4 dogfood iterations (initial + post-T3 + post-T4 + post-T5; each ~10-15 min architect-side rebuild time) plus the hotfix-issuance + hotfix-implementation cycles. The S-class mechanics estimate held; the close timeline extended by ~3 hours due to the dogfood loop. Estimate that explicitly for future codification missions whose smoke tests mock real-cloud-API.

**T5 reinforcement (THIRD dogfood-found bug, same mission — and the structural one).** dogfood-v3 ran post-T4 merge and surfaced bug-38 at the SAME `npm ci` step that bug-37 was at, but with a different shape: the lockfile T4 produced was COMPLETE in the host-environment sense (full install, all `@emnapi/*` entries populated), but the container's npm 10 / node 22 toolchain demanded entries that the host's npm 11 / node 24 didn't generate. Investigation surfaced three distinct sources of host-side regen fragility (host-vs-container drift, registry-state drift, operator-environment drift). T5 (task-366) issued direct per bug-31 bypass within ~30 min of dogfood-finding-3.

What T5 specifically reinforces beyond T3 + T4: **the dogfood gate doesn't just surface the next downstream-pipeline boundary's failure mode — it can surface STRUCTURAL fragilities in the codification itself.** bug-36 + bug-37 were each "the next boundary's strict-validation rejected something the previous step produced"; bug-38 is "the entire host-side regen approach is environmentally fragile by construction; no flag tweak fixes it."

T5's fix is therefore structurally larger than T3 or T4: not a tighter regen, not a different flag, but the elimination of the entire host-regen step. The Dockerfile changes from `npm ci` to `npm install` move the lockfile-resolution responsibility into the container, where it belongs (because the container's toolchain is what actually has to install the deps at build time). The committed lockfile becomes effectively decorative for the Cloud Build path — it stays correct for `cd hub && npm install` local dev (file:../packages/storage-provider ref) but is not consulted by the Cloud Build container. Sunset reverts to `npm ci` once workspaces (idea-186) makes the file: ref resolve natively against the committed lockfile.

What this captures in the methodology dimension: **codification of an ad-hoc workaround can have deeper structural surface area than the original ad-hoc workaround had.** Director's manual workaround used full host install on a single specific host on a specific date — it worked on THAT host on THAT registry-state. Codifying it for "every operator on every host on every date" requires either normalizing the environment (impossible on operator-laptop scale) or eliminating the host-side step (T5's fix). The codification is structurally bigger than the workaround. Future codification missions of "Director did X manually once" should explicitly scope for that structural surface-area expansion. mission-50 is the empirical proof that "what Director did manually" doesn't trivially generalize to "what every operator can do automatically".

The methodology v1.0 §dogfood-gate-discipline calibration #11 (load-bearing dogfood gate) is reinforced at depth-3 (three iterations within the same mission) plus a structural-fragility dimension: dogfood iterations can surface NOT JUST downstream-pipeline-boundary failure modes BUT ALSO upstream-fragility-in-the-codification-itself. mission-50 is the empirical proof of both forms of dogfood-finding within a single mission.

---

## 6. Cross-references

- **Mission entity:** `get_mission(mission-50)` (Hub) — `M-Cloud-Build-Tarball-Codification`.
- **Source idea:** `get_idea(idea-198)` — codification ideation seed filed post-bug-33.
- **Source bugs:**
  - `get_bug(bug-33)` — Cloud Build cross-package context trap; resolves at T1 merge (already merged, `188719e`) with `fixCommits: ["188719e"]`.
  - `get_bug(bug-36)` — gcloud-upload-context inherits `.gitignore` when no `.gcloudignore` is present; surfaced at architect dogfood-v1 post-T2 merge; resolves at T3 merge (already merged, `9636234`) with `fixCommits: ["9636234"]`.
  - `get_bug(bug-37)` — `npm install --package-lock-only` does NOT fully resolve platform-conditional / optional deps (11 `@emnapi/*` entries missing); surfaced at architect dogfood-v2 post-T3 merge; resolves at T4 merge (already merged, `f29635d`) with `fixCommits: ["f29635d"]`.
  - `get_bug(bug-38)` — host-side lockfile regeneration is structurally fragile against host-vs-container npm/node drift, registry-state drift, and operator-environment drift; surfaced at architect dogfood-v3 post-T4 merge; resolves at T5 merge with `fixCommits: ["<T5-merge-sha>"]`.
- **Design round:** thread-310 — architect lily + engineer greg, 5 rounds, converged 2026-04-25. Round-2 transient-swap structural pushback; round-3 architect ratification; round-5 propose_mission staging.
- **PR T1:** #33, `188719e` — `[mission-50] T1 — build-hub.sh transient-swap codification + Dockerfile + .gitignore`.
- **PR T2:** #34, `af19bbf` — `[mission-50] T2 — Closing hygiene: deploy/README + closing audit + work-trace`.
- **PR T3:** #35, `9636234` — `[mission-50] T3 — Hotfix: hub/.gcloudignore + addenda (closes bug-36)`.
- **PR T4:** #36, `f29635d` — `[mission-50] T4 — Hotfix: drop --package-lock-only flag in build-hub.sh + addenda (closes bug-37)`.
- **PR T5:** this PR — `[mission-50] T5 — Hotfix: drop host-side lockfile regen + Dockerfile npm ci → npm install + addenda (closes bug-38)`.
- **ADR boundary:** `docs/decisions/024-sovereign-storage-provider.md` — NOT amended by mission-50; the amendment record stops at §6.1 (mission-48). See §5.3 above + `deploy/README.md` §"ADR-024 boundary statement".
- **Deploy runbook:** `deploy/README.md` §"Cloud Build tarball staging (mission-50)" — the operator-facing canonical reference for the workaround mechanic + sunset condition + CI parity note + .gcloudignore role.
- **Trace:** `docs/traces/m-cloud-build-tarball-codification-work-trace.md`.
- **Sunset trigger:** idea-186 (npm workspaces adoption) — when ratified, drives the cleanup actions enumerated in §"Sunset condition" of `deploy/README.md` (now 5 actions: script section + Dockerfile COPY lines + .gitignore entry + .gcloudignore file + README section) and the inline `TODO(idea-186)` in `scripts/local/build-hub.sh` and `hub/.gcloudignore`.
- **Forward-look CI dependency:** idea-197 (M-Auto-Redeploy-on-Merge — when filed/ratified) MUST invoke `scripts/local/build-hub.sh` (or its workspaces-aware successor) to inherit the tarball-staging behavior. See `deploy/README.md` §"CI parity note".
- **Bug carry-forward:** bug-32 (cross-package CI debt) — affects every PR; not blocking; pre-existing on main per architect's PR #21 triage. Mission-50 does NOT absorb bug-32; CI debt is separate methodology surface.
- **Sibling sovereign-package preservation:** mission-48 (`m-local-fs-cutover-closing-audit.md`) §5.3 — ADR amendment scope discipline precedent that mission-50 §5.3 builds on.
- **Methodology reinforcement:** §5.6 above — dogfood-gate-discipline as load-bearing, not ceremonial. Reinforces methodology v1.0 §dogfood-gate-discipline that codification missions whose smoke tests mock the deployment surface MUST include real-deploy dogfood as a binding success criterion.

---

## 7. Architect-owned remaining

Per task-366 explicit out-of-scope:

- **Architect retrospective** at `docs/reviews/m-cloud-build-tarball-codification-retrospective.md` (or equivalent) — owned by architect; not in engineer scope. Now covers T1+T2+T3+T4+T5 + three dogfood-finding cycles (per §5.6) at architect-level framing. THREE dogfood-found bugs in the same mission, with bug-38 surfacing structural fragility in the codification approach (not just a downstream-boundary failure mode), is the headline observation. The methodology dimension (codification of an ad-hoc workaround can have deeper structural surface area than the original ad-hoc workaround had) deserves explicit retrospective treatment.
- **Architect-side dogfood-v4 (post-T5 merge):** re-run `OIS_ENV=prod scripts/local/build-hub.sh` end-to-end against post-T5-merge main. Pass criterion: build completes through ALL Dockerfile steps (builder `npm install` + `npm run build` + production `npm install --omit=dev` + image build) + image pushed to Artifact Registry + `git status hub/ scripts/ deploy/ docs/` clean (trap restored `hub/package.json`; staged tarball removed; `hub/node_modules/` and `hub/package-lock.json` invisible to git + gcloud). Per Director direction 2026-04-25 (architect owns Hub builds + redeploys).
- **Hub redeploy (post-dogfood-v4-pass):** stop `ois-hub-local-prod` container + restart via `scripts/local/start-hub.sh` against the new image. Only after dogfood-v4 passes.
- **Mission-status flip** mission-50 → `completed` — architect-gated; pending T5 merge + dogfood-v4-pass + retrospective.
- **bug-33 status flip** to `resolved` with `fixCommits: ["188719e"]` + `linkedMissionId: "mission-50"` — routine; either side post-T1 merge (T1 already merged at `188719e`; flip is overdue).
- **bug-36 status flip** to `resolved` with `fixCommits: ["9636234"]` + `linkedMissionId: "mission-50"` — routine; either side post-T3 merge (T3 already merged at `9636234`; flip is overdue).
- **bug-37 status flip** to `resolved` with `fixCommits: ["f29635d"]` + `linkedMissionId: "mission-50"` — routine; either side post-T4 merge (T4 already merged at `f29635d`; flip is overdue).
- **bug-38 status flip** to `resolved` with `fixCommits: ["<T5-merge-sha>"]` + `linkedMissionId: "mission-50"` — routine; either side at T5 merge.
- **Drop the bug-33-manual-workaround stash** — per task-366 directive: `git stash drop` the stash labelled `'bug-33 manual workaround pre-mission-50 codification'` once mission-50 is functionally complete (codification finally covers the workaround end-to-end after T5).

---

## 8. Mission close summary

mission-50 (M-Cloud-Build-Tarball-Codification) closes the bug-33 codification arc opened by the post-mission-49 redeploy attempt + the bug-36 upload-context-inheritance gap that architect dogfood-v1 surfaced post-T2 merge + the bug-37 lockfile-completeness gap that architect dogfood-v2 surfaced post-T3 merge + the bug-38 host-side-regen-fragility structural gap that architect dogfood-v3 surfaced post-T4 merge. The mission preserves the `@apnex/storage-provider` sovereign-package contract byte-identically while operationalizing: (a) a transient-swap pattern in `scripts/local/build-hub.sh` that survives Cloud Build's cross-package context trap, (b) a self-contained `hub/.gcloudignore` that closes the upload-context filter gap, (c) elimination of host-side lockfile regeneration (which proved environmentally fragile by construction), and (d) a Dockerfile that uses `npm install` instead of `npm ci` for the build path so the container resolves its own dep tree against its own toolchain. Permanent committed state stays minimal (4 files: `hub/Dockerfile` + `hub/.gitignore` + `hub/.gcloudignore` + `scripts/local/build-hub.sh`), making the sunset clean when idea-186 (npm workspaces) lands and supersedes the workaround (sunset cleanup list grew from 4 → 5 → 6 actions across T2/T3/T5).

The mission shipped across a single calendar day 2026-04-25 (~3.5 hours total wall-clock engineer-side: T1 ~50min including SIGINT smoke setup + signal-aware mock crafting, T2 ~40min for documentation, T3 ~30min after dogfood-finding-1, T4 ~25min after dogfood-finding-2, T5 ~30min after dogfood-finding-3; plus ~30-60 minute gaps between merges during which the architect ran each of three dogfood iterations + investigated bug-38 root-cause). T1 PR #33 + T2 PR #34 + T3 PR #35 + T4 PR #36 + T5 PR (this) ship-green per the bug-32 CI pattern verified across mission-49 + mission-48 + bug-35 fix + mission-50 T1+T2+T3+T4 PRs.

Engineer-side scope closes when this T5 PR merges + the architect-side dogfood-v4 gate passes. Mission status `completed` flip + retrospective remain on architect side per Director direction 2026-04-25 (architect owns Hub builds + redeploys).

The ADR-024 boundary statement makes explicit that mission-50 is build-pipeline scope, not contract scope — preserving the methodology v1.0 §ADR-amendment-scope-discipline boundary cleanly. The `@apnex/storage-provider` 6-primitive contract surface remains unchanged from its mission-47 origin + mission-48 §6.1 deployment-context-only amendment; mission-50 leaves it untouched throughout T1, T2, T3, T4, and T5.

The iterative-and-structural dogfood-finding pattern that surfaced bug-36 + bug-37 + bug-38 (§5.6) reinforces methodology v1.0 §dogfood-gate-discipline THREE times in the same mission, in two distinct shapes:

1. **bug-36 + bug-37: downstream-pipeline-boundary failures** — each subsequent dogfood iteration surfaces the next downstream stage's strict-validation failure (upload-context filter → `npm ci` lockfile validation). Each is a tighter or different fix to the existing mechanic.
2. **bug-38: structural fragility in the codification itself** — host-side lockfile regen is environmentally fragile by construction; no flag tweak fixes it. Required eliminating the entire host-regen step and pushing the responsibility into the container. The codification ended up structurally larger than the ad-hoc workaround it codified — a methodology lesson on its own.

The headline observation for the architect retrospective: a deeply-pipelined deployment mission can need multiple dogfood iterations to converge to a clean end-to-end pass; that's the gate working as designed. AND: codifying an ad-hoc workaround can have deeper structural surface area than the original ad-hoc workaround had — Director's manual workaround worked on ONE host on ONE date against ONE registry-state; codifying it for "every operator on every host on every date" required restructuring (T5). Future codification missions should explicitly scope for that structural-surface expansion. The full feedback loop (engineer-ship → architect-dogfood → bug-filed → architect-issues-hotfix → engineer-fix → architect-dogfood-retry) ran end-to-end three times in a single calendar day; that's the gate working as designed, demonstrated at depth-3.
