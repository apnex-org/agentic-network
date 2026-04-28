# ADR-029 — Adapter update is consumer-self-serve via npm-published packages + script-driven local install

**Status:** RATIFIED — drafted at mission-64 Phase 6 Preflight 2026-04-28; bilateral architect+engineer ratification at mission-64 W4 closing wave 2026-04-29 (mission-63 ADR-028 precedent).
**Mission:** mission-64 M-Adapter-Streamline
**Date drafted:** 2026-04-28
**Date ratified:** 2026-04-29 (W4 closing; bilateral architect lily + engineer greg)
**Authors:** lily / architect; bilateral ratify with greg / engineer at W4 close

---

## Status flow

| Phase | State | Target |
|---|---|---|
| Scaffold | SCAFFOLD (PR #121 W0 bundle) | Provided ADR number assignment + initial decision framing |
| W1+W2 | substrate-introduction (PR #122 atomic) | npm package family + update script + namespace migration α→β shipped; first publish at `0.1.0` |
| W1+W2-fix | 0.1.1 patch (PR #123) | marketplace.json bundling defect surfaced + closed (calibration #33); install-from-registry test surface added |
| W1+W2-fix-2 | 0.1.2 patch (PR #124) | marketplace source format `"./"` + version-rewrite hoist (calibrations #35 + #36 closed structurally); full-end-to-end-install test added (calibration #37) |
| W3 dogfood gate (cycles 1-3) | **collapsed into W1+W2-fix-N retry** per calibration #34 | 0.1.0 → 0.1.1 → 0.1.2 active-session 6-step retries IS the W3 execution; lily-side Step 2-3 install-time GREEN at 2026-04-28 20:28Z (post-restart isolated shim test) |
| **W1+W2-fix-3** | 0.1.3 patch (PR #125) | post-Director-coord-restart 2026-04-29 surfaced .mcp.json missing from publish (Calibration #38 NEW; gitignore-root-anchor-leakage); explicit `files` whitelist + Section 6/7 test retrofit catches class going forward |
| **W1+W2-fix-4** | 0.1.4 patch (PR #126) | greg-side 0.1.3 publish bash session hit cwd-persistence bug → version-rewrite silent `MODULE_NOT_FOUND` → un-rewritten `*` deps shipped (Calibration #39 NEW); 0.1.4 fix-forward republished from repo-root cwd; deps `^0.1.2` registry-pinned restored |
| W3 dogfood gate (cycles 4-5) | **extended W3 collapse pattern** per calibration #34 | 0.1.3 install-time GREEN; post-restart RED (#38 surfaced); 0.1.4 install-time + post-Director-coord-restart-2 GREEN bilaterally; lily-side adapterVersion="0.1.4" verified epoch=97; greg-side functional verification GREEN |
| **W4** | **RATIFIED** (this commit; bilateral architect lily + engineer greg post-restart-2 2026-04-29 22:13Z via thread-410 round 5; action-1 close_no_action committed) | Final text incorporates W1+W2 + 4 fix-PR evidence + W3 5-cycle collapse note + 12 NEW calibrations + 1 bonus retire (#6 from mission-62 full) + 1 carryover closed (#25 from mission-63) |

---

## Context

Pre-mission-64 adapter-update flow leaks substantial implementation detail to consumers:

- Adapter SDK source lives in `packages/{network-adapter,cognitive-layer,message-router}/src/`
- Adapter dirs (`adapters/{claude,opencode}-plugin/`) bundle SDKs as `file:*.tgz` deps
- After any SDK source change: build dist (tsc) → `npm pack` each SDK → distribute tgzs to all 6 adapter dirs (3 worktrees × 2 plugins) → clean reinstall in each adapter dir → plugin cache reinstall → session restart
- Layer-1 (SDK-stale tgz; mission-62 W4 P0 origin) / Layer-2 (plugin cache stale) / Layer-3 (`file:../sibling` deps don't survive `npm pack`; mission-61 lesson) — **the consumer should never have to know about these**

Pass 10 protocol (codified at mission-63 W5 PR #120 in `multi-agent-pr-workflow.md`) currently splits into:
- §A Hub container rebuild (operator-side)
- §B SDK rebuild + tgz repack + reinstall (consumer-side; calibration #25 root-cause class)
- §C state-migration script (operator-side)
- §D claude-plugin reinstall (consumer-side)

Calibration #25 (mission-63 W4-surfaced; Pass 10 §B SDK rebuild gap; manual-recipe step-skip-class regression) flagged §B as the most-frequently-skipped step. Manual recipe = fail-points; mechanisation = single-command consumer-self-serve.

idea-217 Survey envelope (Director-ratified Phase 3 of mission-64): Q1=A+B+C (consumer friction + Pass-10 mechanisation + distribution channel); Q2=A+B+D (developer-equivalent audiences; NOT operators); Q3=A (single big-bang); Q4=A (thin bundle: script + npm-publish); Q5=C (§B+§D scope split; §A+§C → idea-221); Q6=B+C+D (3 anti-goals locked; Q6 NOT-A namespace decision in-scope → resolved at v0.2 §2.3 = β `@apnex/*` clean cutover).

---

## Decision

**Adapter update is a consumer-self-serve operation delivered via two coupled artifacts:**

### 1. npm-published adapter package family (artifact distribution)

A family of npm packages encapsulating SDK source + pre-built dist + plugin shim binaries:
- `@apnex/network-adapter` — SDK kernel
- `@apnex/cognitive-layer` — cognitive pipeline
- `@apnex/message-router` — message-routing primitives
- `@apnex/claude-plugin` — claude-plugin shim packaging (consumes SDKs + ships install.sh)

**Cross-package deps:** declared via yarn-style `workspace:^` protocol; rewritten to registry-pinned semver at publish-time via `npm publish --workspaces` (npm 8+). Closes mission-61 Layer-3 root-cause class structurally — `file:` refs eliminated from publish chain.

**First-publish bootstrap:** explicit topological `scripts/publish-packages.sh` — leaves first (network-adapter, cognitive-layer, message-router), then dependents (claude-plugin). Subsequent publishes use `npm publish --workspaces` once registry has all packages.

### 2. Local update script (script-driven §D mechanisation)

`scripts/local/update-adapter.sh` is the ergonomic frontend:
- Conditional cleanup of legacy `@apnex/*` namespace (per migration sequence)
- `npm install -g @apnex/claude-plugin@latest` for artifact pull
- Explicit invocation of `"$(npm prefix -g)/lib/node_modules/@apnex/claude-plugin/install.sh"` for system-side install action
- Restart-required notice + version self-report

**§D mechanisation is script-driven, NOT postinstall-driven.** Anti-goal #7 (NO npm postinstall hook for install.sh) avoids npm postinstall security/idempotency/scope concerns:
- Security defaults (`--ignore-scripts` policy)
- Idempotency (postinstall cwd assumptions)
- Scope coupling to npm install lifecycle (double-rebuild on dep-change vs registry-fetch)

### CLI contract (idea-221 forward-consequence)

The update script's exit codes + stdout shape are a **public interface** consumed downstream by idea-221's Pass 10 cross-§ orchestration runner:

- **Exit codes:** 0=success; 1=registry/install error; 2=restart-required-but-not-attempted; 3=unrecoverable
- **Stdout format:** human-readable lines + final structured `key=value` summary line
- **Flags:** `--pin <version>` for version-pinned coordinated rollout; `--dry-run` for orchestration pre-flight
- **No interactive prompts** — CI/operator-runner-friendly

CLI-contract regression test surface (`scripts/test/update-adapter-cli.test.sh`) protects this contract — independent of integration tests; idea-221's runner ratifies against it.

### Namespace decision: β (`@apnex/*` clean cutover)

Move from current internal `@apnex/*` namespace to public `@apnex/*` per Director-prior-preference signal (`project_npm_namespace_apnex.md`).

**Migration sequence:**
1. Code-side: TS-LSP bulk-rename `@apnex/*` → `@apnex/*` across hub/, packages/, adapters/, scripts/
2. Update script: conditional cleanup `npm uninstall -g @apnex/{claude-plugin,network-adapter,cognitive-layer,message-router}` (skipped on fresh-install consumers)
3. PR description operator-runbook: first-time vs existing-consumer instructions

**γ hybrid (`@apnex/*` deprecated alias) rejected** — co-existence overhead conflicts with mission-63 clean-cutover precedent (anti-goal #8).

### Version visibility (closes calibration #25 root-cause class structurally)

Adapter version-stamp visible at multiple surfaces:
- Handshake-side: `agent.advisoryTags.adapterVersion = "<package.json:version>"` in canonical envelope
- npm-installed: `npm ls -g @apnex/claude-plugin --depth=0` shows version chain
- Runtime-stamped: adapter.log emits version on handshake
- Update-script self-report: final stdout line reports installed version

Silent SDK staleness (calibration #25's root cause) becomes detectable end-to-end.

---

## Consequences

### Positive

- Pass 10 §B + §D step-skip-class regression (calibration #25) closed structurally — manual recipe deprecated; consumer can't skip steps because there are no manual steps to skip
- mission-61 Layer-3 root-cause class closed structurally via `workspace:^` rewrite — `file:` refs eliminated from publish chain
- Distribution channel established (npm-publish) — external + future-pool consumers serve themselves with same mechanism as local-dev
- Version-coherence detectable end-to-end via §2.7 visibility surfaces
- Clean separation of concerns: npm package = artifact distribution; script = §D system-side install action
- CLI contract pre-anchored for idea-221's downstream consumption (composability built-in)

### Negative / trade-offs

- Director-coordinated `@apnex` org claim + NPM_TOKEN credentials posture required at Release-gate (~30min Director-time; R1 mitigation)
- W0 publish-flow dry-run spike is a hard gate for M-vs-L sizing — if `workspace:^` rewrite fails empirically, fallback to explicit `version-rewrite.sh` script (~2h add)
- Active-session 6-step coordination protocol during W1+W2 ship adds operational overhead (Q11 mitigation; symmetric with mission-63 §6.3 9-step pattern)
- Engineer-side adapter (vertex-cloudrun) stub-only this mission per anti-goal §4.2 #5 — full parity in dedicated future mission
- `@apnex/*` → `@apnex/*` namespace migration is one-time but touches ~10 places (package.json files, install.sh refs, file:tgz refs, doc references)

### Forward consequences

- Future adapter updates ride the same single-command flow — no new operator-walkthrough required
- idea-221 Pass 10 cross-§ orchestration runner consumes mission-64's CLI contract; idea-221 doesn't re-implement §B/§D primitives
- npm-publish channel enables future external-consumer adoption without per-consumer custom install instructions
- Pass 10 protocol-extension at W4 amends `multi-agent-pr-workflow.md` Pass 10 §B+§D references — manual recipe deprecated to "Removed; npm package + script is canonical" (Fold 4 lock; mission-63 clean-cutover precedent)
- Future SDK source changes ride the publish flow — operator runs `update-adapter.sh` post-merge; no manual rebuild recipe needed

---

## Sealed companions

- **Pass 10 protocol** (mission-63 W5 PR #120; this ADR extends §B + §D to point at npm package + script as canonical mechanism) — W4 closing wave amends `multi-agent-pr-workflow.md`
- **ADR-023** (multi-agent-pr-workflow) — underlying ADR covering the workflow doc territory; W4 deliverable amends ADR-023's substrate
- **ADR-028** (canonical envelope) — orthogonal: wire-shape contract vs distribution-shape contract; advisoryTags.adapterVersion rides ADR-028's canonical envelope
- **mission-61 Layer-3 lesson** — sealed companion; this ADR closes Layer-3 root-cause class structurally via `workspace:^` rewrite
- **idea-186** (npm workspaces) — foundational dependency; workspace-protocol publish flow rides idea-186
- **idea-221 forward-consequence** — CLI contract pre-anchoring at Design v1.0 §2.1.B + §2.10; idea-221's runner consumes mission-64's script via this contract

---

## Cross-references

- **Mission:** mission-64 M-Adapter-Streamline (this ADR ratifies at W4)
- **Source idea:** idea-217 (Streamline adapter compile/update/re-install for consumers; incorporated → mission-64)
- **Companion idea:** idea-221 (Pass 10 cross-§ orchestration; CLI contract consumer)
- **Design v1.0:** `docs/designs/m-adapter-streamline-design.md` (npm package family + update script + namespace migration + version visibility + CLI contract pre-anchoring)
- **Survey envelope:** `docs/surveys/m-adapter-streamline-survey.md` (Director-ratified composite intent)
- **Preflight:** `docs/missions/m-adapter-streamline-preflight.md` (verdict GREEN; Director Phase 7 Release-gate pending)
- **Architectural precedents:** mission-63 (M-Wire-Entity-Convergence; structural-inflection M-class precedent + clean-cutover discipline + tight-cycle merge cadence); mission-62 (Pass 10 §A discipline + state-migration discipline); mission-61 (Layer-3 SDK-tgz-stale lesson source); mission-57 (coordination-primitive-shipment class precedent)
- **Calibrations addressed (W4 final):**
  - **#25** (mission-63 W4) — Pass 10 §B SDK rebuild gap; **CLOSED STRUCTURALLY** by §2.4 `workspace:*` placeholder + version-rewrite-at-publish-time + §2.7 version visibility + §B/§D deprecation in `multi-agent-pr-workflow.md` (W4) + `.mcp.json` bundling (PR #125)
  - **#6** (mission-62) TS5055 SDK self-overwrite — **BONUS RETIRE (full)** via tsconfig `"exclude": ["dist"]` pattern landed in W1+W2 (PR #122); upgrades mission-62's partial-retire
  - **#29 NEW** — npm 11.6.2 EUNSUPPORTEDPROTOCOL on `workspace:^/*`; folded into Pass 10 §B doc note (use `workspace:*` placeholder + `version-rewrite.js`); methodology-class
  - **#30 NEW** — In-arc sizing-recalibration on-same-scope = architect autonomous-ratify + Director-notify-for-visibility (NOT block-on-Director); mission-lifecycle.md housekeeping (deferred follow-on); methodology-class
  - **#31 NEW** — Thread maxRounds=10 hit during W1+W2 + no auto-rollover; folded into Pass 10 protocol mid-mission note (push artifacts before opening round-1 audit thread; budget maxRounds proportional to fix-PR cycles); methodology-class
  - **#32 NEW** — Active-session 6-step verification-restart wrinkle (Step 3 verification needs full restart but breaks coord); split-verification design refinement deferred to future substrate-introduction mission; methodology-class
  - **#33 NEW** → **CLOSED via #37** — Consumer-install-from-registry test surface missing; PR #123 ships file-presence layer; PR #124's e2e test supersedes; substrate-class
  - **#34 NEW** — W3 dogfood-gate collapse into W1+W2-fix when active-session 6-step surfaces substrate defect; folded into Pass 10 protocol substrate-introduction mission-class signature note; **extended in mission-64 to 5-cycle iteration** (cycles 4 + 5 from #38 + #39 fix-forward chain); methodology-class
  - **#35 NEW** — version-rewrite mechanism not running at workspace publish (`npm publish --workspace=X` uses workspace's OWN lifecycle, not root's `prepublishOnly`); **CLOSED STRUCTURALLY** via `scripts/publish-packages.sh` hoisted version-rewrite call with trap-based revert (PR #124); substrate-class
  - **#36 NEW** — marketplace.json source format requires `"./"` trailing-slash; `"."` or `".."` rejected as source-type-not-supported; **CLOSED STRUCTURALLY** via PR #124; substrate-class
  - **#37 NEW** — install-from-registry test surface must exercise actual `claude plugin install` end-to-end, not just file presence; **CLOSED STRUCTURALLY** via `scripts/test/full-end-to-end-install.test.sh` (PR #124); **+ Section 6 retrofit (PR #125)** asserts post-install `.mcp.json` delivery (catches #38 class without requiring Claude Code restart); substrate-class
  - **#38 NEW** — gitignore-root-anchor-leakage into npm-pack of workspace children (root `.gitignore` rule `/<filename>` re-anchored by `npm-packlist` to each workspace's root, silently excluding files in workspace packages that share the name); **CLOSED STRUCTURALLY** via explicit `files` whitelist in `adapters/claude-plugin/package.json` (PR #125; bypasses gitignore-fallback path entirely) + Section 6/7 test retrofit; substrate-class
  - **#39 NEW** — publish bash-session cwd-persistence into `version-rewrite.js` invocation (script resolves REPO_ROOT via `path.resolve(__dirname, "..")` which depends on caller's cwd; `MODULE_NOT_FOUND` silently swallowed by publish flow; un-rewritten `*` deps proceed to npm); **CLOSED for 0.1.4 cycle** via repo-root cwd discipline (PR #126 fix-forward); **structural closure DEFERRED** (option 2: `git rev-parse --show-toplevel` resolution in `version-rewrite.js`; closes class regardless of caller cwd); substrate-class
  - **#40 NEW (composite)** — Post-restart shim observability + projection-fidelity gaps surfaced by greg in thread-410 round 4: (a) FileBackedLogger fds not open on fresh shim post-restart; (b) `get_engineer_status` advisoryTags missing `adapterVersion` projection; (c) version-source-of-truth divergence (`package.json:0.1.4` ≠ `.claude-plugin/plugin.json:1.0.0` ≠ `clientMetadata.proxyVersion:1.2.0`); + stale `pid` in projection across restarts; **OPEN — fold to idea-220 Phase 2** (shim observability formalization + engineer-side parity); methodology-class

  **Aggregate:** 12 NEW (7 substrate-class — 5 structurally closed by PRs #124 + #125 + #126; 2 with structural closure deferred for #39 + observability composite #40; 5 methodology-class folded into W4 docs + future-mission deferrals) + 1 bonus retire (#6 full from mission-62) + 1 carryover closed (#25 from mission-63).

---

## Status flow at W4 — RATIFIED

W4 closing wave (2026-04-29) bilaterally ratifies this ADR per the SCAFFOLD → RATIFIED protocol scaffolded above. Final state:

1. **W3 dogfood-gate evidence** captured in `docs/audits/m-adapter-streamline-closing-audit.md` §3.5 + §4 (W3 5-cycle collapse pattern: cycles 1-3 across 0.1.0 → 0.1.1 → 0.1.2 install-time; cycles 4-5 across 0.1.3 → 0.1.4 fix-forward post-Director-coord-restart-1 + post-Director-coord-restart-2; lily-side adapterVersion="0.1.4" verified epoch=97; greg-side functional verification GREEN bilaterally on thread-410 round 4)
2. **Implementation refinements** surfaced during W1+W2 + 4 fix-PRs folded into the ADR text:
   - Calibrations #29 + #35 reframe `workspace:^` → `workspace:*` placeholder + version-rewrite hoist into orchestration script (PR #124)
   - Calibration #36 closes marketplace source format defect (PR #124)
   - Calibration #37 closes install-from-registry test surface gap + Section 6 retrofit catches #38 class (PR #124 + PR #125)
   - **Calibration #38** closes `.mcp.json` bundling defect via explicit `files` whitelist (PR #125)
   - **Calibration #39** closes for 0.1.4 cycle via repo-root cwd discipline (PR #126); structural closure deferred to follow-up
   - **Calibration #40 composite** captures shim observability + projection-fidelity gaps; folded to idea-220 Phase 2
3. **Status flipped** SCAFFOLD → RATIFIED at W4 close (this commit)
4. **Ratification thread**: thread-410 closed status=converged 2026-04-29 22:13Z bilateral seal (architect lily + engineer greg; round 5/10; action-1 close_no_action committed); analogous to mission-63 thread-403/404 pattern + extends across two Director-coord-restarts

**5-publish-iteration learning-curve note (revised from initial 3-publish framing):** mission-64's 0.1.0 → 0.1.1 → 0.1.2 → 0.1.3 → 0.1.4 cycle reflects the substrate-introduction-class signature for first-canonical-publish to a **fresh public registry namespace + Claude Code plugin-specific files-discovery friction**. Five iterations resolved 5 distinct packaging defects:
- **0.1.1** — `marketplace.json` bundling (calibration #33)
- **0.1.2** — marketplace source format `"./"` + version-rewrite hoist (calibrations #36 + #35)
- **0.1.3** — `.mcp.json` bundling (calibration #38; surfaced ONLY post-Director-coord-restart — install-time tests had been blind to MCP server registration)
- **0.1.4** — dep-spec recovery from `*` placeholder back to `^0.1.2` registry-pinned (calibration #39; cwd-persistence in publish bash session)

This learning-curve cost is **expected** for substrate-introduction first-canonical-publish per `feedback_substrate_introduction_publish_iteration.md` (revised 4-5 iteration norm). Would **NOT** recur for routine patches given the install-from-registry-end-to-end test surface PLUS Section 6/7 retrofit (Calibrations #37 + #38 close) now in place — the test surface explicitly asserts post-install `.mcp.json` delivery + `mcpServers.proxy` declaration, catching the `.mcp.json`-class defect without requiring Claude Code restart. Future publish flows (idea-221 cross-§ orchestration; future package additions; engineer-side opencode-plugin parity) ride the same channel without re-incurring the learning-curve cost — except for #39 structural closure which is a small follow-up cleanup PR (option 2: `git rev-parse --show-toplevel` resolution in `version-rewrite.js`).

---

*Scaffold drafted at mission-64 Phase 6 Preflight 2026-04-28 ~07:35Z; bilateral W4 ratification 2026-04-29 post-Director-coord-restart-2 22:13Z via thread-410 round 5.*
