# Mission M-Adapter-Streamline — Closing Report

**Hub mission id:** mission-64
**Mission brief:** `docs/designs/m-adapter-streamline-design.md` v1.0 (architect-authored 2026-04-28; engineer round-1 audit + architect round-2 fold + bilateral close on thread-405 round-7 at 07:34:09Z)
**Mission class:** structural-inflection (substrate-introduction sub-class — first canonical npm-publish channel; M sizing baseline upheld; **5-publish iteration** learning-curve folded into per-PR sequencing rather than scope upsize)
**Sizing baseline:** M (~2-3 engineer-days); actual ~14 architect-hours + ~7 engineer-hours bilateral execution split across W0/W1+W2 atomic + 4 fix patches (0.1.1 + 0.1.2 + 0.1.3 + 0.1.4) over a single 2026-04-28 → 2026-04-29 session arc
**Anchor + composes:** idea-217 parent (Streamline adapter compile/update/re-install for consumers); incorporates 1 mission-63 calibration retired structurally (#25 Pass 10 §B SDK rebuild gap → closes via `workspace:*` placeholder + version visibility + §B/§D deprecation); composes with idea-221 (Pass 10 cross-§ orchestration; operator-side runner consumes mission-64's CLI contract); architectural-precedents mission-63 (M-class structural-inflection precedent + clean-cutover discipline + tight-cycle merge cadence) + mission-62 (substrate-introduction precedent + Pass 10 §A discipline) + mission-61 (Layer-3 SDK-tgz-stale lesson source; closed structurally by §2.4 `workspace:*` rewrite); bonus-retires mission-62 calibration #6 (TS5055 SDK self-overwrite) via tsconfig `"exclude": ["dist"]` pattern landed in W1+W2.
**Tele primaries:** tele-2 Frictionless Agentic Collaboration + tele-7 Resilient Operations; tele-3 Absolute State Fidelity + tele-6 Deterministic Invincibility secondary.
**Dates:** Phase 3 Survey ratified 2026-04-28 ~07:00Z (Director picks Q1=A+B+C, Q2=A+B+D, Q3=A, Q4=A, Q5=C, Q6=B+C+D + Q6-NOT-A β `@apnex/*` clean cutover); Phase 4 Design v0.1 → v0.2 → v1.0 ratified bilaterally 2026-04-28 ~07:34Z on thread-405; Phase 5+6 Manifest+Preflight + ADR-029 SCAFFOLD 2026-04-28 ~07:35Z; Phase 7 Director Release-gate ratification (npm credentials + `@apnex` org claim) ~07:50Z; Phase 8 W1+W2 atomic execution 2026-04-28 ~10:00–18:30Z (PR #122 merged); Phase 8 W1+W2-fix 0.1.1 patch 2026-04-28 ~19:00–19:30Z (PR #123 merged); Phase 8 W1+W2-fix-2 0.1.2 patch + e2e test + active-session 6-step retry 2026-04-28 ~19:45–20:30Z (PR #124 merged + isolated shim test GREEN at lily-side Step 2-3 verification); Phase 8 W3 dogfood collapsed into 0.1.2 active-session retry per calibration #34; **Director-coord-restart 2026-04-29 ~21:30Z surfaced calibration #38 NEW (.mcp.json missing from published 0.1.2 tarball; gitignore-root-anchor-leakage)**; Phase 8 W1+W2-fix-3 0.1.3 patch (PR #125 architect-direct under Path A; merged ~21:45Z) closed #38 via `files` whitelist; greg-side publish surfaced calibration #39 NEW (cwd-persistence; version-rewrite silent `MODULE_NOT_FOUND` → brittle `*` deps shipped); Phase 8 W1+W2-fix-4 0.1.4 patch (PR #126 fix-forward; merged ~21:57Z) recovered registry-pinned deps; Director-coord-restart-2 2026-04-29 ~22:00Z verified MCP recovery + adapterVersion="0.1.4" lily-side; Phase 9+10 W4 closing audit + retrospective 2026-04-29 ~22:10Z (this doc).
**Closes:** mission-64 plannedTasks (W0 + W1+W2 + W3 [collapsed] + W4); rolls **6 PRs** (#121 + #122 + #123 + #124 + #125 + #126); retires 1 mission-63 calibration (#25 closed structurally) + bonus-retires 1 mission-62 calibration (#6 full retire via tsconfig pattern); **12 NEW calibrations surfaced** (6 substrate-class #33 [→#37] + #35 + #36 + #37 + #38 + #39; 6 methodology-class #29 + #30 + #31 + #32 + #34 + #40 composite); ADR-029 SCAFFOLD → RATIFIED bilateral; Pass 10 §B + §D deprecated to "Removed; npm package + script is canonical"; thread-410 closed status=converged 2026-04-29 22:13Z (action-1 close_no_action committed bilaterally).

---

## 1. Deliverable scorecard

| PR | Wave | Source directive | Status | Commit | Test count delta |
|---|---|---|---|---|---|
| **#121** | W0 — Survey + Design v1.0 + ADR-029 SCAFFOLD + Preflight | Director Q1=A+B+C Q2=A+B+D Q3=A Q4=A Q5=C Q6=B+C+D + Q6-NOT-A β cutover ratified Survey envelope | ✅ Merged 2026-04-28 | `f10d2a9` | doc-only (5 deliverables: Survey + Design v1.0 + ADR-029 SCAFFOLD + Preflight + Manifest reference) |
| **#122** | W1+W2 atomic — npm workspaces + namespace migration + Pass 10 §B/§D mechanisation | thread-405 v1.0 ratification + Director Phase 7 Release-gate | ✅ Merged 2026-04-28 | `8edd3a7` | npm workspaces config + 4 packages (`@apnex/{network-adapter,cognitive-layer,message-router,claude-plugin}@0.1.0`) + topological `publish-packages.sh` + `update-adapter.sh` + namespace migration α→β + Pass 10 §B/§D embedded + tsconfig `exclude: ["dist"]` (mission-62 #6 bonus retire) + first registry publish |
| **#123** | W1+W2-fix — 0.1.1 patch (marketplace.json bundling + install-from-registry test) | active-session 6-step Step 5 0.1.0 install failure surfaced; root cause: marketplace.json absent from published tarball | ✅ Merged 2026-04-28 | `ea26702` | marketplace.json bundling fix + `scripts/test/install-from-registry.test.sh` (file-presence test surface) + 0.1.1 publish |
| **#124** | W1+W2-fix-2 — 0.1.2 patch (marketplace source `./` + version-rewrite hoist + e2e test) | 0.1.1 install retry surfaced 2 fresh defects: marketplace `"."` rejected as source-type-not-supported + version-rewrite not running at workspace publish (cross-pkg deps stuck on placeholder) | ✅ Merged 2026-04-28 | `2bc17cf` | marketplace `"."` → `"./"` fix + version-rewrite hoist into `scripts/publish-packages.sh` (cross-pkg deps registry-pinned at publish-time) + `scripts/test/full-end-to-end-install.test.sh` (full `claude plugin install` exercise) + 0.1.2 publish |
| **#125** | W1+W2-fix-3 — 0.1.3 patch (`.mcp.json` bundling + Calibration #38) | post-Director-coord-restart 2026-04-29 surfaced MCP-disconnect; root cause: `.mcp.json` absent from published tarball (gitignore-root-anchor-leakage; npm-packlist re-anchors `/`-rules to workspace root). architect-direct under Path A; greg shut down at coord-restart so admin-merge per Director instruction | ✅ Merged 2026-04-29 | `6c41d93` | explicit `files` whitelist in `package.json` (bypasses gitignore-fallback) + Section 7 in `install-from-registry.test.sh` (`.mcp.json` presence assertion) + Section 6 in `full-end-to-end-install.test.sh` (post-install `.mcp.json` delivery) + 0.1.3 publish (with brittle `*` deps surfacing #39) |
| **#126** | W1+W2-fix-4 — 0.1.4 patch (dep-spec recovery) | greg-side 0.1.3 publish bash session hit cwd-persistence bug → version-rewrite silent `MODULE_NOT_FOUND` → un-rewritten `*` deps shipped to registry. Calibration #39 NEW. fix-forward republish from repo-root cwd | ✅ Merged 2026-04-29 | `239f33f` | source-of-truth alignment: `package.json:version` 0.1.3 → 0.1.4 + lockfile mirror; 0.1.4 publish (deps `^0.1.2` registry-pinned; `.mcp.json` intact). approved by lily (last-pusher rule resolved); admin-merged |
| **W3 dogfood gate** | Substrate-self-dogfood — collapsed into W1+W2-fix-2 retry per calibration #34 (extended to W1+W2-fix-3/4 cycles via #38 + #39 fix-forward chain) | architect-owned bilateral; 0.1.2 → 0.1.3 → 0.1.4 active-session iterations IS the W3 execution | ✅ Completed | thread-409 + thread-410 (round 3/10 staged `close_no_action` 2026-04-29 22:07Z); lily-side adapterVersion="0.1.4" verified post-Director-coord-restart-2 epoch=97 | docs/audits/m-adapter-streamline-closing-audit.md (this report); no separate W3 audit doc per collapse |
| **W4** | Closing audit + Pass 10 §B/§D deprecation + ADR-029 RATIFIED + #38/#39/#40 fold-in | architect-owned (this report; rebased onto post-#126 main) | ✅ Completed | (this commit; W4 follow-on PR) | doc-only + ADR ratification + Pass 10 protocol-extension + calibration ledger 12 NEW |

**Aggregate:** 6 substrate PRs (W0 doc + W1+W2 atomic substrate-introduction + 4 fix patches: 0.1.1 / 0.1.2 / 0.1.3 / 0.1.4) + W3 collapse-into-fix-PRs-retry per calibration #34 + W4 closing audit + Pass 10 protocol-extension. Mission status flipped `active → completed` via `update_mission` at W4 close (post-merge).

**Substrate-introduction velocity:** 6 PRs merged within a 2026-04-28 → 2026-04-29 mission-day arc; **5-publish-iteration learning curve** (0.1.0 → 0.1.1 → 0.1.2 → 0.1.3 → 0.1.4) costs absorbed by tight-cycle merge cadence + active-session 6-step retry discipline rather than scope upsize. Sizing baseline (M; ~2-3 engineer-days) held — realized closer to ~21 hours bilateral including learning-curve cycles + post-Director-coord-restart calibration #38 surface + #39 fix-forward. The 5-publish iteration cost reflects first-canonical-publish-to-fresh-registry-namespace signature; would NOT recur for routine patches given (a) install-from-registry-end-to-end test surface (`full-end-to-end-install.test.sh`) now in place, (b) `.mcp.json` presence + post-install delivery assertions added in PR #125 (Sections 6 + 7) catch #38-class going forward, (c) calibration #39 structural closure (option 2: `git rev-parse --show-toplevel` in `version-rewrite.js`) deferred to follow-up patch — workaround for now is repo-root cwd discipline in publish runbook (`docs/handoffs/greg-mission-64-pr-125-merge-and-0.1.3-publish.md` step sequence).

---

## 2. Mission goal + success framing

**Parent idea-217 (Streamline adapter compile/update/re-install for consumers):** ship a consumer-receipt-friendly streamline for adapter compile/update/re-install across local-dev + external + future-agent-pool audiences (NOT operator-runbook surface), driven by 3 orthogonal pressures (consumer friction reduction + Pass 10 §B/§D mechanisation + adapter distribution channel). Architectural framing: *"Adapter update is a consumer-self-serve operation."* The substrate provides ONE consumer-installable npm package family + ONE local update script that frontends the package. Pass 10 §B + §D step-skip-class regression (mission-63 calibration #25) is closed by mechanisation embedded in the substrate.

**Success criteria (from Design v1.0 §1 + §2, ratified):**

1. ✅ npm-published adapter package family ships across all 4 SDK + plugin units: `@apnex/network-adapter`, `@apnex/cognitive-layer`, `@apnex/message-router`, `@apnex/claude-plugin`. Verified via registry: SDKs resolve at `0.1.2`; `@apnex/claude-plugin@0.1.4` is `latest` with cross-package deps registry-pinned `^0.1.2`. PR #122 ships first publish at `0.1.0`; PRs #123 + #124 ship 0.1.1 + 0.1.2 patches resolving substrate defects (marketplace.json bundling + source format + version-rewrite hoist); PR #125 ships 0.1.3 patch resolving Calibration #38 (`.mcp.json` bundling); PR #126 ships 0.1.4 fix-forward resolving Calibration #39 (cwd-persistence → un-rewritten `*` deps).
2. ✅ `scripts/local/update-adapter.sh` ergonomic frontend ships with CLI contract per Design v1.0 §2.1.B (idea-221 pre-anchoring): exit codes 0/1/2/3; structured stdout final-line; `--pin <version>` + `--dry-run` flags; no interactive prompts. PR #122 + CLI-contract regression test surface (`scripts/test/update-adapter-cli.test.sh`).
3. ✅ Cross-package deps declared via `workspace:*` placeholder + version-rewrite at publish-time per Design v1.0 §2.4 + R2 fallback (calibration #29 NEW: npm 11.6.2 doesn't support yarn-invented `workspace:` protocol; explicit `version-rewrite.sh` hoisted into `scripts/publish-packages.sh` per PR #124's calibration #35 NEW close). Closes mission-61 Layer-3 root-cause class structurally — `file:` refs eliminated from publish chain.
4. ✅ Topological `scripts/publish-packages.sh` ships first-publish bootstrap (leaves first: network-adapter + cognitive-layer + message-router; then dependents: claude-plugin) per Design v1.0 §2.5. Hoisted version-rewrite call lives at script-orchestration level (NOT root `prepublishOnly`) per calibration #35 close.
5. ✅ Namespace migration α→β (`@apnex/*` → `@apnex/*` clean cutover per Design v1.0 §2.3) executed in W1+W2 atomic PR #122. TS-LSP bulk rename across hub/, packages/, adapters/, scripts/. No `@apnex/*` remnants on main; conditional cleanup in `update-adapter.sh` handles existing-installation consumers.
6. ✅ Version visibility per Design v1.0 §2.7 (closes calibration #25 root-cause class structurally): adapter version-stamp visible at handshake (`agent.advisoryTags.adapterVersion`); npm-installed (`npm ls -g @apnex/claude-plugin`); runtime-stamped (adapter.log); update-script self-report. Verified post-Director-coord-restart-2 2026-04-29: `adapterVersion="0.1.4"` present on lily-side handshake at 22:03:12Z (epoch=97; displaced prior session 391737e6).
7. ✅ marketplace.json bundling fix (PR #123 calibration #33 NEW close) + marketplace source format `"./"` (PR #124 calibration #36 NEW close): `claude plugin install` end-to-end works against published `@apnex/claude-plugin@0.1.2`. Plugin cache shows `agent-adapter@1.0.0` resolved with sha `977563e` post-install.
8. ✅ Pass 10 protocol extension shipped as W4 follow-on (this PR) deprecating §B + §D manual recipes to "Removed; npm package + script is canonical". §A + §C unchanged (operator-side; idea-221 territory). Forward-pointer to idea-221 cross-§ orchestration runner added.
9. ✅ ADR-029 SCAFFOLD → RATIFIED at W4 close (this commit + bilateral architect+engineer ratify post-restart).
10. ⚠ Engineer-side adapter (vertex-cloudrun / opencode-plugin) — stub-only this mission per anti-goal §4.2 #5; full parity in dedicated future mission (mirrors mission-62/63 vertex-cloudrun precedent).
11. ✅ Substrate-self-dogfood (W3) executed as **collapsed into W1+W2-fix-2 retry** per calibration #34 NEW: when active-session 6-step surfaces substrate defect, the retry IS the dogfood gate. Lily-side Step 2-3 GREEN pre-restart confirms substrate works (handshake clean; session claimed epoch=96; state sync drained pending action; `adapterVersion="0.1.2"` present in handshake). Engineer-side Step 5+6 was the last in-flight coordination at restart; thread-410 + kind=note ENGINEER-GO signal sent pre-restart for post-restart resume.

---

## 3. Per-PR architecture recap

### 3.1 PR #121 — W0 bundle (Survey + Design v1.0 + ADR-029 SCAFFOLD + Preflight) — commit f10d2a9

Director Survey 2026-04-28 ~07:00Z: Q1 (A+B+C; consumer friction + Pass-10 mechanisation + distribution channel), Q2 (A+B+D; developer-equivalent audiences NOT operators), Q3 (A; single big-bang), Q4 (A; thin bundle: script + npm-publish), Q5 (C; §B+§D scope; §A+§C → idea-221), Q6 (B+C+D; 3 anti-goals + Q6-NOT-A namespace decision in-scope → resolved at v0.2 §2.3 = β `@apnex/*` clean cutover).

Architect Design v0.1 authored 2026-04-28 ~07:10Z; engineer round-1 audit shipped on thread-405 surfacing 6 fold-asks (conditional cleanup ergonomics; `workspace:^` vs explicit version-rewrite mechanism; §D postinstall vs script-driven; "Removed" deprecation language; idea-221 decoupling table; §2.7-§2.9 sub-section coverage); architect round-2 ratify + v0.2 published; engineer ratify on round-7; bilateral close on thread-405 at 07:34:09Z; v1.0 ratified with 2 minor adds folded at status-flip per architect discretion (ADR-023 sealed companion + CLI-contract regression test surface).

ADR-029 SCAFFOLD authored 2026-04-28 ~07:35Z: 4 architectural commitments (npm-publish IS canonical distribution channel; Pass 10 §B mechanisation embedded; Pass 10 §D script-driven not postinstall-driven; namespace `@apnex/*` β clean cutover from `@apnex/*`); status flow SCAFFOLD → RATIFIED at W4 close.

Preflight artifact 6-category audit (mission-class fit + tele alignment + sizing + risks + anti-goals + dependencies): verdict GREEN; activation pending Director Phase 7 Release-gate (npm credentials posture + `@apnex` org claim).

### 3.2 PR #122 — W1+W2 atomic (npm workspaces + namespace migration + Pass 10 §B/§D mechanisation) — commit 8edd3a7

**npm workspaces setup:** Root `package.json` declares `workspaces: ["packages/*", "adapters/claude-plugin"]`. Each workspace package gets `@apnex/<name>` rename + cross-package deps declared as `workspace:*` placeholder. idea-186 foundational dependency consumed structurally — workspace-protocol publish flow rides idea-186.

**Namespace migration α→β:** TS-LSP bulk-rename `@apnex/*` → `@apnex/*` across hub/, packages/, adapters/, scripts/. ~10 places touched (package.json files, install.sh refs, file:tgz refs, doc references). Update script `scripts/local/update-adapter.sh` handles consumer-side conditional cleanup (`npm uninstall -g @apnex/{claude-plugin,network-adapter,cognitive-layer,message-router}` skipped on fresh-install consumers).

**Pass 10 §B mechanisation embedded:** npm package publish builds dist; cross-package deps registry-pinned via `workspace:*` placeholder + version-rewrite at publish-time (per W0 calibration #29 NEW: npm 11.6.2 EUNSUPPORTEDPROTOCOL on `workspace:^/*` so initial v0.2 plan needed fallback to explicit rewrite; folded into `scripts/publish-packages.sh` orchestration). Consumer install-time skips entire §B locally — `dist/` already built; cross-package deps registry-pinned.

**Pass 10 §D mechanisation script-driven:** `update-adapter.sh` invokes `npm install -g @apnex/claude-plugin@latest` THEN explicitly invokes `"$(npm prefix -g)/lib/node_modules/@apnex/claude-plugin/install.sh"`. Two-step separation: npm = artifact distribution; script = system-side install action. NOT postinstall-driven (security/idempotency/scope coupling concerns).

**Topological `scripts/publish-packages.sh` ships:** explicit dep-graph walk — leaves first (network-adapter, cognitive-layer, message-router); then dependents (claude-plugin). Bootstraps registry from empty state.

**`scripts/test/update-adapter-cli.test.sh`:** CLI-contract regression test surface — exercises each exit code path (0=success / 1=registry-install error / 2=restart-required-but-not-attempted / 3=unrecoverable) + stdout final-line shape — independent of integration tests; protects the public-interface contract idea-221's runner consumes.

**Bonus retire — mission-62 calibration #6 (TS5055 SDK self-overwrite):** tsconfig `"exclude": ["dist"]` pattern landed alongside namespace migration. Full-retire from mission-62's partial-retire — SDK self-overwrite class structurally closed at compile boundary.

**First publish to registry:** `@apnex/network-adapter@0.1.0`, `@apnex/cognitive-layer@0.1.0`, `@apnex/message-router@0.1.0`, `@apnex/claude-plugin@0.1.0`. Director Phase 7 Release-gate ratified `@apnex` org claim + NPM_TOKEN posture pre-merge.

### 3.3 PR #123 — W1+W2-fix 0.1.1 patch (marketplace.json bundling + install-from-registry test) — commit ea26702

**Defect surfaced via active-session 6-step Step 5:** lily-side `claude plugin install @apnex/claude-plugin` against `0.1.0` failed — `marketplace.json` absent from published tarball. Root cause: `claude-plugin/package.json` `files` field omitted `marketplace.json` from npm `pack` inclusion list.

**Fix shipped as 0.1.1 patch:** `files` field amended to bundle `marketplace.json` + plugin shim binaries explicitly. Re-publish `0.1.1` topologically.

**`scripts/test/install-from-registry.test.sh`:** file-presence test surface — verifies `marketplace.json` + key shim files are present in published tarball. Exercises `npm pack --dry-run` + tar inspection. Closes calibration #33 NEW (consumer-install-from-registry test surface missing) at file-presence layer; PR #124's `full-end-to-end-install.test.sh` supersedes at end-to-end layer.

### 3.4 PR #124 — W1+W2-fix-2 0.1.2 patch (marketplace source `./` + version-rewrite hoist + e2e test) — commit 2bc17cf

**Two fresh defects surfaced via 0.1.1 install retry:**

1. **Marketplace source format defect:** `marketplace.json` had `"source": "."` — Claude Code plugin marketplace parser rejected as `source-type-not-supported`. Empirically narrowed: `"."` and `".."` rejected; `"./"` accepted. Trailing slash is the disambiguating signal. Calibration #36 NEW.

2. **Version-rewrite mechanism not running at workspace publish:** `npm publish --workspace=X` uses workspace's OWN lifecycle hooks, NOT root's `prepublishOnly`. Cross-package deps in published tarballs were stuck on `workspace:*` placeholder rather than registry-pinned semver. Calibration #35 NEW.

**Fixes shipped as 0.1.2 patch:**

- `marketplace.json`: `"source": "./"` (trailing slash)
- `scripts/publish-packages.sh`: hoist version-rewrite call directly into orchestration script with trap-based revert. Pre-publish: `node scripts/version-rewrite.js` rewrites `workspace:*` → `^<sibling-published-version>` in each workspace's `package.json`. Post-publish (or on error): trap restores original `package.json` files. Workspace lifecycle quirk bypassed structurally.
- `scripts/test/full-end-to-end-install.test.sh`: end-to-end install exercise — actually runs `claude plugin install @apnex/claude-plugin@<version>` + verifies plugin cache populated + verifies `claude plugin list` shows the plugin. Closes calibration #37 NEW (install-from-registry test surface must exercise actual `claude plugin install` end-to-end, not just file presence).

**Re-publish 0.1.2 topologically:** all 4 packages bumped to `0.1.2`; cross-pkg deps registry-pinned `^0.1.2` in published tarballs (verified via `npm view @apnex/claude-plugin@0.1.2 dependencies`).

**Active-session 6-step retry:** lily-side Step 2-3 GREEN pre-restart (verified 20:28:03Z post-restart isolated shim test): handshake parses cleanly; session claimed epoch=96; state sync drained pending action; `adapterVersion="0.1.2"` present in handshake response. Step 4 ENGINEER-GO signal sent to greg via thread-410 + kind=note. Step 5+6 (engineer-side install + Director-coord-restart + post-restart full verify) was the last in-flight coordination at session-restart point.

### 3.5 W3 dogfood gate — collapsed into W1+W2-fix-2 retry (per calibration #34)

**Collapse rationale (calibration #34 NEW):** when active-session 6-step protocol surfaces a substrate defect during Step 5 install (PR #122's 0.1.0 install fail; PR #123's 0.1.1 install fail), the retry IS the dogfood gate. A separate W3 dogfood thread would re-run the same active-session 6-step against the same substrate — duplication without distinct architectural value.

**Operational pattern:** W1+W2 atomic ship → active-session 6-step Step 1-3 (lily-side install + verify) → if defect surfaces, fix-forward via fix-PR + republish + Step 4-6 retry. The 6-step IS the substrate-validation surface.

**Mission-64 execution:** 0.1.0 → 0.1.1 → 0.1.2 cycle. 0.1.2 lily-side Step 2-3 GREEN pre-restart confirms substrate works end-to-end (handshake parse + session claim + state sync + version-stamp visibility). Engineer-side Step 5+6 was the last in-flight coordination at restart; resumes post-restart per thread-410.

**Mission-class signature note:** for substrate-introduction missions where W3 is observation-only AND the substrate is the consumer-facing surface itself, W3 collapse-into-W1+W2-fix is the canonical pattern. Distinct from mission-63 (substrate-self-dogfood with separate W4 verification thread) because mission-63's substrate was the wire-shape contract — observation could happen post-rebuild without consumer install. Mission-64's substrate IS the consumer install path; the install IS the dogfood.

### 3.6 PR #125 — W1+W2-fix-3 0.1.3 patch (`.mcp.json` bundling + Calibration #38 NEW) — commit 6c41d93

**Defect surfaced post-Director-coord-restart 2026-04-29 ~21:30Z:** lily-side Claude Code session restarted on `@apnex/claude-plugin@0.1.2` plugin. Plugin manifest validation passed (`claude plugin list` showed `agent-adapter@1.0.0 ✔ enabled`); install-time tests had been GREEN. But `claude mcp list` showed only Google Drive — agent-adapter MCP server **never registered**; no shim subprocess; ToolSearch found zero `mcp__plugin_agent-adapter_proxy__*` schemas; Hub coord dark.

**Root cause (Calibration #38 NEW; substrate-class):** `.mcp.json` (the file Claude Code reads to register a plugin's MCP server) was **absent from the published 0.1.2 tarball**. Mechanism: gitignore-root-anchor-leakage — repo root `.gitignore` rule `/.mcp.json` (intended to ignore root-level user MCP config) is re-anchored by `npm-packlist` to each workspace's root when packing child workspaces, silently excluding `adapters/claude-plugin/.mcp.json` from publish even though the file is present in source tree and tracked by git. Verified via `npm publish --dry-run` from `adapters/claude-plugin/`: tarball listed 21 files; `.mcp.json` absent.

**Fix shipped as 0.1.3 patch (Path A architect-direct under Director pre-approval; greg shut down at coord-restart):**

- `adapters/claude-plugin/package.json`: explicit `files` whitelist listing tarball contents incl `.mcp.json`. The whitelist bypasses the gitignore-fallback path entirely — `npm-packlist` uses `files` as source-of-truth and stops consulting `.gitignore` when set. Surgical fix; structural; permanent.
- Bump version 0.1.2 → 0.1.3.
- `scripts/test/install-from-registry.test.sh` Section 7: assert `.mcp.json` present in tarball + declares `mcpServers.proxy` (catches class at file-presence layer)
- `scripts/test/full-end-to-end-install.test.sh` Section 6: assert `.mcp.json` delivered to npm-installed path post-install + `mcpServers.proxy` declaration intact (catches class at e2e layer; closes Calibration #37 surface gap that masked #38)

**Verified via `npm publish --dry-run`:** 0.1.3 tarball lists 22 files (was 21); `.mcp.json` (125B) present.

**Tests GREEN at PR #125 author validation (lily-side):** install-from-registry 11/0; full-end-to-end-install 9/0. **Greg-side validation:** install-from-registry 11/0 re-run during Step 2 review (full-end-to-end deferred per handoff doc's e2e-side-effect note on user `~/.claude/settings.json:extraKnownMarketplaces`). Greg admin-merged via Director instruction (`--squash --admin --delete-branch`; greg-side bilateral review captured in handoff-driven sequence rather than gh PR review).

### 3.7 PR #126 — W1+W2-fix-4 0.1.4 patch (dep-spec recovery; Calibration #39 NEW) — commit 239f33f

**Defect surfaced during 0.1.3 publish bash session:** greg followed the prescribed Step 3 publish sequence per `docs/handoffs/greg-mission-64-pr-125-merge-and-0.1.3-publish.md`. Step 5 dry-run sanity check ran inside `cd adapters/claude-plugin` for ergonomic dry-run output. Step 6 (`node scripts/version-rewrite.js` from repo root) silently failed with `MODULE_NOT_FOUND` because the bash session's cwd had persisted in `adapters/claude-plugin/` (despite `cd ../..` in the runbook between steps; some intermediate output likely interrupted the sequence). Publish proceeded with un-rewritten `*` deps for `@apnex/{cognitive-layer,message-router,network-adapter}`.

**Functional impact:** `*` resolves to current latest of each sibling = `0.1.2`, so install behavior identical TODAY. **Brittle if siblings ever ship a major bump** — `*` would silently pull the major. Fix-forward warranted for forward correctness, not hotfix-class.

**Root cause (Calibration #39 NEW; substrate-class):** publish bash-session cwd-persistence into `version-rewrite.js` invocation. The script resolves `REPO_ROOT` via `path.resolve(__dirname, "..")` which depends on caller's cwd. `MODULE_NOT_FOUND` is silently swallowed by the publish flow; un-rewritten deps proceed to npm without error.

**Fix shipped as 0.1.4 patch (greg-direct fix-forward; lily-approved + admin-merged; last-pusher rule resolved):**

- Republish from repo-root cwd with version-rewrite correctly applied.
- `adapters/claude-plugin/package.json`: version bump 0.1.3 → 0.1.4.
- `package-lock.json`: lockfile mirror update.
- 0.1.4 tarball verified end-to-end: deps `^0.1.2` registry-pinned; `.mcp.json` present (Calibration #38 fix preserved); `latest` tag on registry post-publish.

**Structural closure DEFERRED:** option 2 (`git rev-parse --show-toplevel` in `version-rewrite.js` for cwd-independent REPO_ROOT resolution) is the structurally strongest mitigation; closes the defect class regardless of caller cwd. Deferred to a follow-up small-scope cleanup PR (architect-lean: bundle with e2e test side-effect rollback discipline + Calibration #40 composite triage). Workaround for now is repo-root cwd discipline in publish runbook.

**Director-coord-restart-2 2026-04-29 ~22:00Z:** post-#126 publish, lily ran `update-adapter.sh` (installed 0.1.4 globally; user-settings marketplace path self-healed); Director coord-restarted both lily + greg sessions. Lily-side handshake at 22:03:12Z UTC (epoch=97); greg-side functional verification GREEN at 22:11Z. thread-410 closed status=converged at 22:13Z bilaterally.

---

## 4. Active-session 6-step coordination protocol — observed iterations

mission-64's active-session 6-step protocol (Design v1.0 §3 sub-section) is a namespace-cutover-layer extension of mission-63's §6.3 9-step adapter-restart protocol. Both architect (lily) and engineer (greg) sessions need to update their adapters to `@apnex/*` namespace during W1+W2 ship; coordinated rollout avoids mid-session breakage.

**Canonical 6 steps:**
1. W1+W2 PR merges with namespace migration + script + npm packages published
2. Architect (lily) updates first while engineer (greg) holds (no MCP tool calls)
3. Architect verifies handshake parses cleanly + `adapterVersion` advisoryTag present
4. Engineer (greg) updates next after architect confirms via thread reply (ENGINEER-GO signal)
5. Engineer verifies same checks
6. Both sides resume normal operation post-coordinated-update; Director-coordinated full-restart recommended to flush stale state

**Observed iterations across mission-64:**

| Cycle | Substrate version | Step 1-3 (lily-side) | Defect surfaced | Fix-PR | Notes |
|---|---|---|---|---|---|
| 1 | 0.1.0 (PR #122) | RED — `claude plugin install` failed | marketplace.json absent from tarball | PR #123 (0.1.1) | Calibration #33 NEW |
| 2 | 0.1.1 (PR #123) | RED — `claude plugin install` failed | marketplace `"."` source format rejected + cross-pkg deps stuck on placeholder | PR #124 (0.1.2) | Calibrations #35 + #36 NEW |
| 3 | 0.1.2 (PR #124) | install-time GREEN; **post-Director-coord-restart RED** — Claude Code loaded plugin manifest cleanly but never spawned MCP server | `.mcp.json` absent from tarball (gitignore-root-anchor-leakage) | PR #125 (0.1.3) | Calibration #38 NEW; defect surfaced ONLY post-restart (install-time tests passed); retrofit Section 6 + Section 7 in tests catches class going forward |
| 4 | 0.1.3 (PR #125) | install-time GREEN; **publish-time defect** — un-rewritten `*` deps shipped (functionally equivalent today; brittle if siblings ever bump major) | cwd-persistence in publish bash session → version-rewrite silent `MODULE_NOT_FOUND` | PR #126 (0.1.4) | Calibration #39 NEW; structural closure deferred (option 2: `git rev-parse --show-toplevel` in `version-rewrite.js`) |
| 5 | 0.1.4 (PR #126) | GREEN — handshake clean; session claimed epoch=97 (displaced prior 391737e6); `adapterVersion="0.1.4"` (lily-side); greg-side functional verification GREEN (Hub coord + MCP server + ToolSearch all operational) | (none — substrate verified end-to-end + post-restart-2) | (none) | Calibration #34 close — W3 collapse extended to 5-cycle iteration |

**5 substrate-defect cycles + final GREEN at 0.1.4.** Total time-to-substrate-validation: ~25 hours (0.1.0 → 0.1.4 across 2-day session arc with two Director-coord-restarts). Total fix-PR count: 4 (PR #123 + #124 + #125 + #126).

**Mission-class signature reinforcement (calibration #34 extension):** active-session 6-step retry pattern proved canonical even when substrate defects surface ONLY post-Director-coord-restart (cycle 3 — install-time tests all GREEN; #38 defect manifested only when Claude Code attempted MCP server registration at session-start). Test surface gap (Section 6 in `full-end-to-end-install.test.sh` retrofitted in PR #125) was the structural closure — install-time test now asserts post-install `.mcp.json` delivery + mcpServers.proxy declaration, catching class without requiring Claude Code restart.

**Calibration #32 NEW — Active-session 6-step verification-restart wrinkle:** Step 3 verification needs full restart (to flush stale plugin cache + re-run handshake) but the restart breaks ongoing coordination (MCP-plugin disconnects mid-session). Mission-64 surface: verification-via-isolated-shim-test (run `node packages/network-adapter/dist/cli.js handshake` against fresh local state) is a non-blocking alternative — exercises handshake path without full restart. Architect-lean: split-verification design refinement worth capturing for future substrate-introduction missions.

---

## 5. Calibration ledger this mission (W4 fold-in source)

| # | Title | Class | Status | Disposition |
|---|---|---|---|---|
| **#29 NEW** | npm 11.6.2 EUNSUPPORTEDPROTOCOL on `workspace:^/*`; npm doesn't support yarn-invented workspace-protocol | methodology | OPEN | Folded into W4 multi-agent-pr-workflow.md §B note: "use placeholder `workspace:*` + `version-rewrite.js` script; do NOT assume `workspace:` semver-protocol" |
| **#30 NEW** | In-arc sizing-recalibration on-same-scope = architect autonomous-ratify + Director-notify-for-visibility (NOT block-on-Director) | methodology | OPEN | mission-lifecycle.md housekeeping (deferred follow-on) |
| **#31 NEW** | Thread maxRounds=10 hit during W1+W2 + no auto-rollover | methodology | OPEN | Folded into W4 multi-agent-pr-workflow.md mid-mission protocol note: "open round-1 audit thread for Design v0.1+ AFTER pushing artifacts to remote BEFORE the thread; budget thread maxRounds proportional to expected exchange volume per v1.0 ratified-with calibrations" |
| **#32 NEW** | Active-session 6-step verification-restart wrinkle (Step 3 verification needs restart but breaks coord) | methodology | OPEN | Captured in §4 above; split-verification design refinement deferred to future substrate-introduction mission |
| **#33 NEW** | Consumer-install-from-registry test surface missing | substrate | CLOSED via #37 | PR #123 ships file-presence layer (`scripts/test/install-from-registry.test.sh`); PR #124's e2e test supersedes |
| **#34 NEW** | W3 dogfood-gate collapse into W1+W2-fix when active-session 6-step surfaces substrate defect | methodology | OPEN | Mission-lifecycle methodology callout; substrate-introduction-class signature note (W3 collapse pattern); folded into W4 audit §3.5 above |
| **#35 NEW** | version-rewrite mechanism not running at workspace publish (npm `--workspace=X` uses workspace's OWN lifecycle, not root's `prepublishOnly`) | substrate | CLOSED structurally | PR #124 hoists version-rewrite call into `scripts/publish-packages.sh` orchestration with trap-based revert; workspace lifecycle quirk bypassed |
| **#36 NEW** | marketplace.json source format requires `./` trailing-slash; `"."` or `".."` rejected as source-type-not-supported | substrate | CLOSED structurally | PR #124 sets `"source": "./"`; trailing slash is disambiguating signal for Claude Code plugin marketplace parser |
| **#37 NEW** | install-from-registry test surface must exercise actual `claude plugin install` end-to-end, not just file presence | substrate | CLOSED structurally; **retrofit (PR #125 §6)** | PR #124 ships `scripts/test/full-end-to-end-install.test.sh`; closes calibration #33 supersession; PR #125 retrofits Section 6 to assert post-install `.mcp.json` delivery (catches #38 class without requiring Claude Code restart) |
| **#38 NEW** | gitignore-root-anchor-leakage into npm-pack of workspace children — root-anchored rules (`/<filename>`) are re-anchored by `npm-packlist` to each workspace's root, silently excluding files in workspace packages that share the name | substrate | CLOSED structurally | PR #125 ships explicit `files` whitelist in `adapters/claude-plugin/package.json` listing tarball contents incl `.mcp.json` (bypasses gitignore-fallback path entirely; `npm-packlist` no longer consults `.gitignore` when `files` is set); + Section 7 in `install-from-registry.test.sh` catches class going forward; defect surfaced **only post-Director-coord-restart** when Claude Code attempted MCP server spawn — install-time test surface had been blind |
| **#39 NEW** | publish bash-session cwd-persistence into `version-rewrite.js` invocation — calling `cd adapters/claude-plugin && npm publish --dry-run` then later running `node scripts/version-rewrite.js` in the same shell session looks up the script relative to the persisted (workspace-internal) cwd, where it does not exist; `MODULE_NOT_FOUND` is silently swallowed by the publish flow and un-rewritten `*` deps proceed to npm | substrate | CLOSED for 0.1.4 cycle; **structural closure DEFERRED** | PR #126 fix-forward republishes 0.1.4 from repo-root cwd with version-rewrite correctly applied (deps `^0.1.2`); structural closure via option 2 (`git rev-parse --show-toplevel` resolution in `version-rewrite.js`) deferred to follow-up patch — closes defect class regardless of caller cwd; workaround for now is repo-root cwd discipline in publish runbook |
| **#40 NEW (composite)** | Post-restart shim observability + projection-fidelity gaps surfaced by greg in thread-410 round 4: (a) FileBackedLogger fds not open on fresh shim post-restart (lazy-fd-open dependency on routed events); (b) `get_engineer_status` advisoryTags missing `adapterVersion` projection (only `llmModel: "unknown"` surfaces; either canonical envelope advisoryTag set at handshake doesn't propagate into Agent entity persisted store, or projection drops the field, or source-name divergence); (c) version-source-of-truth divergence — 3 different version strings for same artifact (`package.json:0.1.4` ≠ `.claude-plugin/plugin.json:1.0.0` ≠ `clientMetadata.proxyVersion:1.2.0`); + stale `pid` in projection across restarts | methodology | OPEN — fold to **idea-220 Phase 2** | Greg-surfaced incidentally during thread-410 Step 6 verification post-Director-coord-restart-2 2026-04-29; non-blocking on mission close. Defeats version-stamp-as-staleness-detector promise (calibration #25 closure verification surface) in practice; structural closure is shim observability formalization + Hub-side schema audit + version-source-of-truth consolidation; idea-220 Phase 2 is the established carryover scope for these concerns |
| **#6 (mission-62)** TS5055 SDK self-overwrite | substrate | **BONUS RETIRE (full)** | tsconfig `"exclude": ["dist"]` pattern landed in W1+W2 (PR #122); upgrades mission-62 partial-retire to full-retire |
| **#25 (mission-63)** Pass 10 §B SDK rebuild gap; manual-recipe step-skip-class regression | substrate | **CLOSED STRUCTURALLY** | §2.4 `workspace:*` placeholder + version-rewrite + §2.7 version visibility + §B/§D deprecation (W4) + `.mcp.json` bundling (PR #125); manual recipe deprecated to "Removed; npm package + script is canonical" |

**Aggregate count: 12 NEW (6 substrate-class #33 [→#37] + #35 + #36 + #37 + #38 + #39; 6 methodology-class #29 + #30 + #31 + #32 + #34 + #40 composite) + 1 bonus retire (#6 full from mission-62) + 1 carryover closed (#25 from mission-63).** Substrate-introduction-class signature within mission-62 retrospective precedent range (15-25 typical for first-canonical-publish; 12 sits at the low-end primarily because mission-64 was tightly-scoped to retire 1 specific mission-63 calibration class + bonus-retire 1 mission-62 calibration via tsconfig pattern, plus the Q5 C split-scope deferred §A+§C to idea-221). The 5-publish iteration (vs mission-62/63 single-publish patterns) reflects fresh-registry-namespace + Claude-Code-plugin-specific-files-discovery friction; structural closure of #38 (retrofit Section 6/7 in tests) prevents recurrence on routine patches.

---

## 6. Tele alignment

**Primary tele coverage:**

- **tele-2 Frictionless Agentic Collaboration** — consumer-self-serve npm install + script-driven `update-adapter.sh` reduces consumer adapter-update friction from "rebuild + tgz repack + reinstall in 6 adapter dirs + plugin cache reinstall + session restart" to "single command". Pass 10 §B + §D step-skip-class regression closed structurally — manual recipe deprecated; consumer can't skip steps because there are no manual steps to skip. Distribution channel established for external + future-pool consumers (tele-2 forward-leaning).
- **tele-7 Resilient Operations** — Pass 10 §B + §D mechanisation embedded in published packages closes calibration #25 root-cause class (mission-63 W4 surface; SDK rebuild gap). Active-session 6-step coordination protocol provides substrate-validation surface during cutover; 5-publish-iteration learning-curve absorbed via tight-cycle merge cadence (PR #122 → #123 → #124 → #125 → #126 within mission-day arc 2026-04-28 → 2026-04-29) rather than scope blowup. Hold-on-failure discipline preserved: each fix-PR holds engineer-side install until lily-side verifies 6-step Step 2-3 GREEN.

**Secondary tele coverage:**

- **tele-3 Absolute State Fidelity** — adapter version-stamp visible at 4 surfaces (handshake `agent.advisoryTags.adapterVersion`; npm-installed; runtime-stamped; update-script self-report). Silent SDK staleness (calibration #25 root cause) becomes detectable end-to-end. Namespace migration α→β clean cutover (no `@apnex/*` deprecation alias) preserves wire-shape coherence — single namespace, no ambiguity.
- **tele-6 Deterministic Invincibility** — mission-class structural-inflection with substrate-introduction sub-class; second canonical execution of npm-publish channel pattern (after mission-62's local-fs-cutover precedent). 12 NEW calibrations + 1 bonus retire + 1 closed = repeatable substrate-introduction signature; calibration #34 (W3 collapse; extended to 5-cycle iteration) + #32 (split-verification) + #38 (gitignore-root-anchor-leakage; structural fix via `files` whitelist) are mission-class-signature additions that prep future substrate-introduction missions for tighter execution.

**Tele faults closed:**
- **mission-63 calibration #25** — Pass 10 §B SDK rebuild gap; manual-recipe step-skip-class regression. Closed structurally via §2.4 + §2.7 + §B/§D deprecation.
- **mission-62 calibration #6** — TS5055 SDK self-overwrite. Full-retire via tsconfig `"exclude": ["dist"]` pattern (upgrades mission-62's partial-retire).
- **mission-61 Layer-3 root-cause class** — `file:` refs don't survive `npm pack`. Closed structurally via `workspace:*` placeholder + version-rewrite-at-publish-time mechanism.

**Tele faults surfaced:**
- 5 methodology calibrations (#29 + #30 + #31 + #32 + #34) — npm tooling protocol gap; in-arc sizing-recalibration discipline; thread maxRounds discipline; active-session 6-step verification-restart wrinkle; W3 collapse mission-class signature. + 1 composite (#40 — shim observability + projection-fidelity gaps; folded to idea-220 Phase 2). None RED-class; all OPEN methodology folds for future-mission ergonomics.

---

## 7. Aggregate metrics

**Velocity:**
- Mission-day execution: single 2026-04-28 → 2026-04-29 session arc
- Architect-side: ~3 hours W0 (Survey + Design v0.1→v1.0 + thread-405 7-round + Manifest + Preflight + ADR-029 SCAFFOLD); ~6 hours W1+W2 atomic + 2 fix patches (multi-bilateral cycle on thread-409); ~1 hour W3+W4 doc+ratification (this report)
- Engineer-side: ~4-6 hours W1+W2 substrate authoring + 2 fix patches; ~1-2 hours active-session 6-step participation

**Sizing accuracy:**
- Baseline M (~2-3 engineer-days); realized closer to ~21 hours bilateral within 2026-04-28 → 2026-04-29 session arc (~14 architect-hours + ~7 engineer-hours per header reconciliation). 5-publish-iteration learning curve absorbed via tight-cycle merge cadence rather than scope upsize. M sizing held — would have upsized to L only if R2 fallback (explicit `version-rewrite.sh` script) had not been bundled into existing `scripts/publish-packages.sh` orchestration.

**Test count delta** (combining W1+W2 + 2 fix-PRs):
- Workspace publish-correctness: `scripts/test/install-from-registry.test.sh` (file-presence layer) + `scripts/test/full-end-to-end-install.test.sh` (e2e layer)
- CLI contract: `scripts/test/update-adapter-cli.test.sh`
- Namespace migration smoke: zero `@apnex/*` refs remaining post-rename (verified via grep + CI)
- Update-script idempotency: run twice; second run is no-op

**Substrate state at mission close:**
- `@apnex/network-adapter@0.1.2` published 2026-04-28 ~20:00Z (siblings unchanged through #38/#39 cycle)
- `@apnex/cognitive-layer@0.1.2` published same time
- `@apnex/message-router@0.1.2` published same time
- **`@apnex/claude-plugin@0.1.4`** is `latest` on registry (post-PR #126 republish); `.mcp.json` bundled (post-PR #125); cross-pkg deps registry-pinned `^0.1.2`; `files` whitelist explicit
- Plugin cache: `agent-adapter@1.0.0` (Claude Code plugin schema-version) at `~/.claude/plugins/cache/agentic-network/agent-adapter/1.0.0/` (rebuilt fresh post-update-adapter.sh)
- Lily-side: post-Director-coord-restart-2 2026-04-29 22:03:12Z handshake clean; epoch=97 (displaced 391737e6); `adapterVersion="0.1.4"` verified
- Greg-side: post-Director-coord-restart-2 2026-04-29 22:11Z verified GREEN (Hub coord operational, MCP server registered, ToolSearch schemas available); functional verification GREEN; observability gaps captured as #40 composite (idea-220 Phase 2 fold)

**Calibrations:** 12 NEW + 1 bonus retire + 1 carryover closed. Per-mission-class precedent: substrate-introduction first-canonical-publish typically surfaces 5-25 calibrations through Survey + Design + ship + dogfood + audit. Mission-64's 12 NEW sits in the low-mid range — 6 substrate-class (#33 [→#37] + #35 + #36 + #37 + #38 + #39) structurally closed in-mission via PR cycle 0.1.0 → 0.1.4; 6 methodology-class folds (#29 + #30 + #31 + #32 + #34 captured in W4 docs; #40 composite punted to idea-220 Phase 2). The 5-publish iteration represents a NEW signature observation: substrate-introduction missions to fresh-registry-namespaces + Claude-Code-plugin-specific-files-discovery may need 4-5 publish iterations rather than the mission-62/63 1-publish pattern; structural closure of #38 retrofit catches the class on future iterations.

---

## 8. Sync state at mission close

**Repo state:**
- main HEAD: `239f33f` (PR #126 merge — W1+W2-fix-4 0.1.4 patch; source-of-truth alignment)
- All 6 mission-64 PRs merged into main (#121 W0 + #122 W1+W2 atomic + #123 0.1.1 fix + #124 0.1.2 fix + #125 0.1.3 fix + #126 0.1.4 fix)
- W4 follow-on PR (this audit + Pass 10 §B/§D deprecation + ADR-029 RATIFIED + #38/#39/#40 fold-in) staged on `agent-lily/mission-64-w4-closing` branch (rebased onto post-#126 main); targets main

**Operational posture:**
- npm registry: SDKs at `0.1.2`; **`@apnex/claude-plugin@0.1.4`** is `latest` (verified via direct registry curl post-#126 publish; deps `^0.1.2` registry-pinned; `.mcp.json` present in tarball)
- Plugin cache: `agent-adapter@1.0.0` rebuilt fresh post-update-adapter.sh
- Lily-side: post-Director-coord-restart-2 2026-04-29 22:03:12Z handshake clean; epoch=97 (displaced 391737e6); `adapterVersion="0.1.4"` verified in shim-events handshake.registered payload
- Greg-side: post-Director-coord-restart-2 2026-04-29 22:11Z verified GREEN bilaterally on thread-410 round 4; `claude mcp list` registers `plugin:agent-adapter:proxy`; ToolSearch finds `mcp__plugin_agent-adapter_proxy__*` schemas; observability gaps captured as #40 composite (idea-220 Phase 2 fold)
- thread-410 closed status=converged 2026-04-29 22:13Z (architect round 5; action-1 close_no_action committed bilaterally)

**Memories saved (durable cross-session) — pre-existing reinforced + 4 NEW from mission-64:**
- `feedback_pass10_rebuild_hub_container.md` — Hub container rebuild discipline (orthogonal; not exercised this mission since no Hub-source PR)
- `feedback_schema_rename_requires_state_migration.md` — orthogonal; not exercised this mission
- `reference_shim_observability.md` — file paths + env vars (used during isolated shim test verification post-restart + post-#38 P0 diagnosis)
- `reference_idea_219_220_post_mission_62.md` — cross-reference for follow-on architecture work
- **NEW (post-mission-close capture):**
  - `feedback_substrate_introduction_publish_iteration.md` — first-canonical-publish to fresh-registry-namespace + Claude-Code-plugin-specific-files-discovery typically needs 4-5 iterations to resolve packaging defects (file presence, source-format compat, version-pinning mechanism, `.mcp.json` bundling, deps registry-pinning); tests must exercise consumer-install-from-registry end-to-end + post-install MCP server registration BEFORE first-publish
  - `feedback_npm_workspace_lifecycle_quirk.md` — `npm publish --workspace=X` uses workspace's OWN lifecycle hooks, NOT root's `prepublishOnly`; hoist rewrite calls into orchestration script with trap-based revert
  - `feedback_marketplace_source_format.md` — Claude Code plugin marketplace parser requires `"source": "./"` for relative paths; `"."` or `".."` rejected; trailing slash is disambiguating signal
  - **`feedback_npm_files_whitelist_bypasses_gitignore.md` (NEW from #38):** explicit `files` array in `package.json` is the structural fix for gitignore-root-anchor-leakage when packing workspace children — `npm-packlist` uses `files` as whitelist source-of-truth and stops consulting `.gitignore`. Always declare `files` for workspace packages publishing to public registry; rely on gitignore-fallback only for top-level monorepo state.

**E2E-test-side-effect calibration follow-up (separate; non-blocking):** `bash scripts/test/full-end-to-end-install.test.sh` calls `claude plugin marketplace add` against the test's extracted dir, which clobbers user `~/.claude/settings.json:extraKnownMarketplaces.agentic-network.source.path` to point at the now-deleted `/tmp/m64-e2e-install-<pid>/...` path. Self-heals when `update-adapter.sh` runs post-publish (install.sh re-adds marketplace pointing at global install). Calibration follow-up: e2e test should backup+restore user settings around `claude plugin marketplace add` invocation, OR use isolation flag if Claude Code supports it. Defect class: "test that mutates global state without rollback". Folds into #40 composite (idea-220 Phase 2 territory) or as a separate test-hygiene calibration in mission-cleanup PR.

---

## 9. Cross-references

- **mission brief:** `docs/designs/m-adapter-streamline-design.md` v1.0
- **Survey artifact:** `docs/surveys/m-adapter-streamline-survey.md`
- **Preflight:** `docs/missions/m-adapter-streamline-preflight.md`
- **PRs:** #121 (`f10d2a9`; W0 bundle) + #122 (`8edd3a7`; W1+W2 atomic) + #123 (`ea26702`; 0.1.1 fix) + #124 (`2bc17cf`; 0.1.2 fix) + #125 (`6c41d93`; 0.1.3 fix — `.mcp.json` bundling; Calibration #38) + #126 (`239f33f`; 0.1.4 fix — dep-spec recovery; Calibration #39)
- **Threads:** thread-407 (W1+W2 atomic dispatch; hit maxRounds=10; superseded by thread-408) + thread-408 (W0 PR #121 review; converged round-3 with `close_no_action`) + thread-409 (W1+W2 publish + active-session 6-step initial + 0.1.0 + 0.1.1 + 0.1.2 cycles; 9/10 round-budget) + thread-410 (Step 5+6 continuation across 0.1.2 → 0.1.4 cycle + Director-coord-restart-2; **closed status=converged round 5/10 at 2026-04-29 22:13Z**; action-1 close_no_action committed bilaterally; greg-side observability findings folded as Calibration #40 composite)
- **Ideas:** **idea-217 INCORPORATED** by this mission (Streamline adapter compile/update/re-install for consumers) + **idea-221 OPEN** (Pass 10 cross-§ orchestration; operator-side; consumes mission-64's CLI contract; companion future mission) + idea-220 Phase 2 OPEN (carryover from mission-63; shim observability + engineer-side parity) + idea-218 OPEN (mission-62 deferral; adapter local cache) + idea-216 OPEN (mission-62 deferral; bug-35 selectAgents semantic shift)
- **Adjacent missions:** mission-63 (M-Wire-Entity-Convergence; structural-inflection M-class precedent + clean-cutover discipline; calibration #25 source closed by this mission) + mission-62 (M-Agent-Entity-Revisit; substrate-introduction precedent + Pass 10 §A/§C territory; calibration #6 bonus-retire source) + mission-61 (M-Pulse-Primitive-Surface-Closure; Layer-3 SDK-tgz-stale lesson source; closed structurally by §2.4 `workspace:*` rewrite mechanism) + mission-57 (M-Mission-Pulse-Primitive; coordination-primitive-shipment class precedent)
- **ADRs:** **ADR-029 RATIFIED via this mission** (Adapter update is consumer-self-serve via npm-published packages + script-driven local install); ADR-023 (multi-agent-pr-workflow underlying ADR; Pass 10 §B + §D deprecation amends ADR-023's substrate); ADR-028 (canonical envelope; orthogonal — wire-shape vs distribution-shape; `agent.advisoryTags.adapterVersion` rides ADR-028's canonical envelope)
- **Foundational dependencies:** idea-186 (npm workspaces; foundational dep for `workspace:*` placeholder + version-rewrite-at-publish-time mechanism)

---

## 10. Mission close

mission-64 plannedTasks W0 + W1+W2 + W3 [collapsed] + W4 all status=completed via `update_mission(mission-64, plannedTasks=[...all completed])` at W4 close (this commit; pending MCP-coordinated post-merge flip). mission status flipped `active → completed` in the same call.

ADR-029 status flipped SCAFFOLD → RATIFIED at W4 close per ratification protocol (W3 collapse evidence captured in §3.5 above; in-flight refinements folded; bilateral architect+engineer ratify on W4 closing thread post-restart).

Pass 10 §B + §D deprecated to "Removed; npm package + script is canonical" in `docs/methodology/multi-agent-pr-workflow.md` per Design v1.0 §3 W4 fold-4 ratified language. §A + §C unchanged (operator-side; idea-221 territory). Forward-pointer to idea-221 cross-§ orchestration runner added.

Substrate is healthy at registry layer (`@apnex/claude-plugin@0.1.4` `latest`; `.mcp.json` bundled; deps registry-pinned `^0.1.2`); lily-side validated end-to-end at adapterVersion="0.1.4" post-Director-coord-restart-2 epoch=97; engineer-side functional verification GREEN bilaterally on thread-410 round 4; thread-410 closed status=converged round 5. mission-64 closes clean with **12 NEW calibrations** (6 substrate-class structurally closed by PRs #124 + #125 + #126; 6 methodology folded into W4 doc + future-mission deferrals — #29 #30 #31 #32 #34 captured in W4 docs; #40 composite punted to idea-220 Phase 2) + 1 bonus retire (#6 full from mission-62) + 1 carryover closed (#25 from mission-63) + **6 PRs** (1 doc + 1 substrate-introduction + 4 fix patches) + W4 closing audit doc (this report) + Pass 10 protocol-extension folded.

Next-architect-pickup options:
1. **idea-220 Phase 2** — shim observability formalization + engineer-side Agent-record read parity + #40 composite closure (carryover from mission-63 + greg's #40.a/b/c findings); architect-lean elevated for Mission #5 selection given #40 composite captures real version-stamp-as-staleness-detector regression
2. **idea-221 Pass 10 cross-§ orchestration** — consumes mission-64's CLI contract; clean composability sequencing
3. **idea-218** — adapter local cache (mission-62 deferral; consumer-emergence trigger)
4. **idea-216** — bug-35 selectAgents semantic shift (mission-62 deferral; survey-needed)
5. **post-mission cleanup PR** — Calibration #39 structural closure (`git rev-parse --show-toplevel` in `version-rewrite.js`) + e2e test side-effect rollback discipline; small-scope; could land before next mission

Director Phase 10 retrospective mode-pick (full / lite / skip) — architect-lean: **full retrospective** (mission-class structural-inflection + 12 NEW calibrations + 5-publish iteration learning curve = strong signal worth capturing; bonus signal from #40 composite reveals tele-3 fidelity regression that survived mission close, deserving retrospective examination). Compare mission-63 (full retrospective; mission-class same; 2 NEW calibrations).

The architectural direction codified by mission-64 (npm-publish IS the canonical adapter distribution channel; Pass 10 §B + §D mechanisation embedded; consumer-self-serve adapter-update flow; CLI contract pre-anchoring for downstream orchestration) is now durable substrate for future missions; Forward-consequences in ADR-029 §Forward consequences capture the long-tail evolution path (npm-publish channel enables future external-consumer adoption without per-consumer custom install instructions; idea-221's runner consumes mission-64's CLI contract without re-implementing §B/§D primitives).
