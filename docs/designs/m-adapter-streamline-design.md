# M-Adapter-Streamline — Design v1.0 (bilateral ratified; thread-405 round-7 close)

**Status:** v1.0 — bilateral ratified architect (lily) + engineer (greg) on thread-405 (converged 2026-04-28T07:34:09.132Z; action-1 close_no_action committed at round-7). Round-1 audit + round-2 ratify cycle complete; 2 minor adds (ADR-023 sealed companion + CLI-contract regression test) folded at status-flip per architect discretion.
**Mission name:** M-Adapter-Streamline (final naming ratified at Manifest)
**Mission class:** structural-inflection (M sizing; ~2-3 engineer-days; thin bundle + split scope; W0 publish-flow spike gates M-vs-L upsizing per R2)
**Source Idea:** idea-217 (Streamline adapter compile/update/re-install for consumers)
**Companion Idea:** idea-221 (Pass 10 cross-§ orchestration; operator-side; out-of-scope this mission per Q5 C split-scope)
**Survey:** `docs/surveys/m-adapter-streamline-survey.md` (v1.0; Director-ratified 2026-04-28 ~07:00Z)
**Authors:** lily / architect (v0.1, v0.2); greg / engineer (round-1 audit thread-405 round-4); bilateral round-2 ratify expected on thread-405
**Lifecycle phase:** 4 Design (architect+engineer-led; Director-out per autonomous-arc-driving)

---

## §1 Goal + intent (echo Survey envelope)

**Goal:** ship a **consumer-receipt-friendly streamline** for adapter compile/update/re-install across local-dev + external + future-agent-pool audiences (NOT operator-runbook surface), driven by 3 orthogonal pressures (consumer friction reduction + Pass 10 §B/§D mechanisation + adapter distribution channel) — delivered as a single big-bang structural-inflection-class mission.

**Architectural framing:** *"Adapter update is a consumer-self-serve operation."* The substrate provides ONE consumer-installable package family + ONE local update script that frontends the package. Pass 10 §B + §D step-skip-class regression (calibration #25) is closed by mechanisation embedded in the substrate.

**§D mechanisation reframe (v0.2; per round-1 audit Fold 3):** §D is **script-driven**, not postinstall-driven. The npm package's job is "ship pre-built artifacts"; the script's job is "drive install.sh" — clean separation of "artifact distribution" from "system-side install action" avoids npm postinstall security/idempotency/scope concerns.

**Tele primaries (Survey-confirmed):**
- tele-2 Frictionless Agentic Collaboration (primary)
- tele-7 Resilient Operations (primary)
- tele-3 Absolute State Fidelity (secondary, elevated by namespace-coherence concern from Q6 NOT-A)
- tele-6 Deterministic Invincibility (secondary)

**Anti-goals (locked at Survey Q6 B+C+D):**
- NO Universal Adapter / ACP redesign integration
- NO idea-102 Universal Port absorption
- NO Hub-served adapter shape (option 5 from idea-217 ruled out)

**Q6 NOT-A resolved at Design v0.2:** namespace decision **β (`@apnex/*` clean cutover)** with conditional `@ois/*` cleanup step in update script (per §2.3 below).

---

## §2 Architecture

### §2.1 Output shape (the minimum-viable bundle)

Two artifacts ship in this mission:

#### A. npm-published adapter package family

A family of npm packages encapsulating SDK source + pre-built dist + plugin shim binaries:

- **`@apnex/network-adapter`** — the SDK (handshake parsing, prompt-format, tool-manager, kernel)
- **`@apnex/cognitive-layer`** — the cognitive pipeline (telemetry, circuit-breaker, write-call-dedup, tool-result-cache)
- **`@apnex/message-router`** — message-routing primitives
- **`@apnex/claude-plugin`** — claude-plugin shim packaging (consumes the SDKs as deps; ships shim binaries + `install.sh`)
- **(future)** `@apnex/opencode-plugin` — opencode-plugin variant; **stub-only this mission per anti-goal §4**

**Publishing target:** npm public registry. Director ratifies `@apnex` org claim/access + NPM_TOKEN credentials posture at Phase 7 Release-gate (per §3 W0 prerequisites).

**Consumer install flow (recommended):**
```bash
./scripts/local/update-adapter.sh
```

**Consumer install flow (manual; for external/future-pool consumers without local checkout):**
```bash
npm install -g @apnex/claude-plugin@latest
"$(npm prefix -g)/lib/node_modules/@apnex/claude-plugin/install.sh"
# Two-step: npm install delivers artifact; install.sh wires it into the system
```

#### B. Local update script — `scripts/local/update-adapter.sh`

Single-command ergonomic frontend for local-dev consumers. Drives both npm install + system-side install.sh:

```bash
#!/bin/bash
# scripts/local/update-adapter.sh
# Single-command adapter update for local-dev consumers
# Drives npm install + post-install system wiring (script-driven §D mechanisation)

set -euo pipefail

# 0. (optional) Update local checkout — informational; not required for npm flow
if [ -d .git ]; then
  echo "Pulling latest main (informational; npm flow drives the install)..."
  git pull origin main || true
fi

# 1. Cleanup legacy @ois/* installs (conditional; skips on fresh-install consumers)
if npm ls -g @ois/claude-plugin >/dev/null 2>&1; then
  echo "Removing legacy @ois/* installation..."
  npm uninstall -g @ois/claude-plugin @ois/network-adapter @ois/cognitive-layer @ois/message-router
fi

# 2. Install latest @apnex/* package
echo "Installing latest @apnex/claude-plugin..."
npm install -g @apnex/claude-plugin@latest

# 3. Drive system-side install.sh (script-driven §D)
INSTALL_SH="$(npm prefix -g)/lib/node_modules/@apnex/claude-plugin/install.sh"
if [ ! -x "$INSTALL_SH" ]; then
  echo "ERROR: install.sh not found at $INSTALL_SH" >&2
  exit 1
fi
"$INSTALL_SH"

# 4. Inform consumer of restart requirement
echo ""
echo "✓ Adapter updated. Installed version:"
npm ls -g @apnex/claude-plugin --depth=0 2>/dev/null | grep '@apnex/claude-plugin' || true
echo ""
echo "  Restart your Claude session to pick up the new shim."

exit 0
```

**CLI contract (idea-221 pre-anchoring; per round-1 audit Fold 5):**
- **Exit codes:** 0=success; 1=registry/install error; 2=restart-required-but-not-attempted; 3=unrecoverable
- **Stdout format:** human-readable lines (idea-221's runner can grep) + final structured `key=value` summary line for machine parsing
- **Flags:** `--pin <version>` for version-pinned coordinated rollout (per R7); `--dry-run` for idea-221 orchestration pre-flight
- **No interactive prompts** — CI/operator-runner-friendly (no `y/n` confirmations)

### §2.2 Pass 10 §B + §D mechanisation

Per Survey Q5 C narrow scope, this mission mechanises Pass 10 §B + §D ONLY (consumer-side rebuild + reinstall). §A + §C stay manual operator-side; idea-221 captures the cross-§ orchestration scope as separate future mission.

**§B mechanisation (publish-time):**
- npm package publish: build dist; resolve cross-package deps via `workspace:^` protocol (see §2.4); pack tgz; publish to registry
- npm package install-time: `dist/` already built; cross-package deps registry-pinned; consumer skips entire §B step locally

**§D mechanisation (script-driven; v0.2 reframe per Fold 3):**
- npm package ships `install.sh` as bundled file (not as postinstall hook)
- `update-adapter.sh` invokes `npm install -g @apnex/claude-plugin@latest` THEN explicitly invokes `"$(npm prefix -g)/lib/node_modules/@apnex/claude-plugin/install.sh"`
- Two-step separation: npm = artifact distribution; script = system-side install action
- Avoids npm postinstall concerns: security defaults (`--ignore-scripts`), idempotency (cwd assumptions), scope coupling to npm install lifecycle

**Out of scope (per Q5 C; deferred to idea-221):**
- §A Hub container rebuild — operator-side; remains manual `scripts/local/build-hub.sh`
- §C state-migration script — operator-side; per-PR migration scripts remain operator-runs
- Cross-§ orchestration runner (auto-detect + sequence §A→§B→§C→§D) — operator-side runner consumes mission-64's CLI contract

### §2.3 Namespace decision + migration sequence (Q6 NOT-A resolved)

**Decision: β (`@apnex/*` clean cutover).** Move from current internal `@ois/*` namespace to public `@apnex/*` per Director-prior-preference signal (`project_npm_namespace_apnex.md`).

**Reasoning:**
1. Director-prior-preference signal
2. Recognizable namespace = lower friction for external consumers (tele-2)
3. Aligns with mission-63 clean-cutover precedent (γ hybrid co-existence retired)
4. Namespace migration cost is small one-time (~10 places: package.json files, install.sh scripts, file:tgz refs, doc references) amortized over future external-consumer surface

**Migration sequence (covers existing-installation cleanup; per round-1 audit Fold 1):**
1. Code-side rename: TS-LSP-bulk-rename of every `import` from `@ois/*` to `@apnex/*` across hub/, packages/, adapters/, scripts/
2. Update script handles consumer-side cleanup conditionally (per §2.1.B): skips uninstall on fresh-install consumers; runs explicit `npm uninstall -g @ois/{claude-plugin,network-adapter,cognitive-layer,message-router}` on existing-installation consumers
3. Operator-runbook in W1+W2 PR description includes:
   - "First-time consumers: skip uninstall; script handles automatically"
   - "Existing consumers: run `update-adapter.sh` once; cleanup is conditional"
   - "Coordinated rollout across active sessions: see §3 active-session coordination protocol"

**No shell-glob risk:** `@ois/*` is npm-scope-syntax (not shell-glob). Update script uses explicit package list, not wildcards.

### §2.4 Workspace publish flow (workspace:^ + W0 dry-run gate)

**Publish mechanism: yarn-style `workspace:^` protocol** (per round-1 audit Fold 2; reference idea-186 npm workspaces foundation).

**Cross-package dep declaration (in source-tree `package.json` files):**
```json
{
  "name": "@apnex/claude-plugin",
  "dependencies": {
    "@apnex/network-adapter": "workspace:^",
    "@apnex/cognitive-layer": "workspace:^",
    "@apnex/message-router": "workspace:^"
  }
}
```

**At publish-time:** `npm publish --workspaces` (npm 8+) rewrites `workspace:^` → `^<current-published-version>` of the sibling package in the published tarball's `package.json`. Registry-pinned semver; NOT `file:` refs (mission-61 Layer-3 lesson — `file:` refs don't survive `npm pack`).

**W0 spike gate (per round-1 audit Fold 2; R2 mitigation):**
- W0 step: `npm publish --workspaces --dry-run --access public` against placeholder version
- Verify: rendered published `package.json` has registry-pinned semver (NOT `workspace:^`)
- IF rewrite-correctness FAIL: fallback path = explicit pre-publish `version-rewrite.sh` script that walks workspaces and rewrites `workspace:` → semver before `npm publish` (~2h scope add; flags M→L upsize)
- This is **THE gate** for M-vs-L sizing per §6.1

### §2.5 First-publish bootstrap order

`npm publish --workspaces` default behavior is alphabetical workspace-name order — fragile for dep-order. Bootstrap requires explicit topological dep-graph walk:

**`scripts/publish-packages.sh`** (W1+W2 deliverable):
```bash
#!/bin/bash
# Topological publish: leaf packages first, then dependents
set -euo pipefail

# Leaf packages (no @apnex/* deps)
npm publish --workspace=@apnex/network-adapter --access public
npm publish --workspace=@apnex/cognitive-layer --access public
npm publish --workspace=@apnex/message-router --access public

# Dependent packages (depend on leaves above)
npm publish --workspace=@apnex/claude-plugin --access public
```

**Subsequent publishes** (post-bootstrap; all packages exist on registry): `npm publish --workspaces` is safe (alphabetical-vs-topological doesn't matter when registry-resolution finds existing versions).

### §2.6 install.sh location post-cutover

**Architect pick: option (a) bundled at `$(npm prefix -g)/lib/node_modules/@apnex/claude-plugin/install.sh`.** Simpler than option (b) `bin` entrypoint (`npx @apnex/claude-plugin install`); preserves existing `install.sh` shape; consistent with script-driven §D mechanisation.

Future evolution path: option (b) bin-entrypoint can be added in a follow-on idea WITHOUT breaking option (a) — backward-compatible enhancement.

### §2.7 Version visibility (closes calibration #25 root-cause class structurally)

Per round-1 audit Fold 6 — adapter version-stamp visible at multiple surfaces:

- **Handshake-side (canonical envelope):** `agent.advisoryTags.adapterVersion = "<package.json:version>"` — surfaced via `@apnex/network-adapter` `version-stamp.ts` that reads `package.json:version` at module-load
- **npm-installed:** `npm ls -g @apnex/claude-plugin --depth=0` shows installed version
- **Runtime-stamped:** `cat ~/.claude/.../adapter.log | grep adapterVersion` for last-handshake stamp
- **Update script self-report:** `update-adapter.sh` final stdout line reports installed version

**Closes calibration #25 root-cause class structurally:** silent SDK staleness becomes detectable — operator can verify version end-to-end before proceeding.

### §2.8 Cache invalidation surfaces

Per round-1 audit Fold 6:

- **`~/.claude/plugins/`** plugin-manifest cache → `install.sh` handles
- **`~/.npm/_cacache/`** npm registry cache → `update-adapter.sh` does NOT explicitly invalidate (npm default `--prefer-online` handles for fresh install); operator can manually run `npm cache verify` if registry-update timing concerns
- **Adapter dir `node_modules/`** → `install.sh` handles via `rm -rf` + reinstall
- **Other consumer worktrees** → out-of-scope for the script; documented in W1+W2 PR description: "Run `update-adapter.sh` in each worktree separately if multiple."

### §2.9 Telemetry surface preservation

Per round-1 audit Fold 6:

- shim observability surface (`.ois/shim.log` + `.ois/shim-events.ndjson`) **preserved** post-npm-cutover. The npm package ships the same shim-logger code path as the current `file:` SDK; install.sh wires the same env-var bindings (`OIS_SHIM_LOG_FILE`, `OIS_SHIM_EVENTS_FILE`).
- No telemetry pipeline migration required; existing observability tooling continues to work.
- idea-220 Phase 2 (post-mission-63 follow-on) still applies for upgrading observability further; orthogonal to this mission.

### §2.10 idea-221 decoupling table + CLI contract pre-anchoring

Per round-1 audit Fold 5 — explicit decoupling at Pass 10-§ granularity:

| Concern | mission-64 (this) | idea-221 (companion) |
|---|---|---|
| §A Hub rebuild | NOT scope | IN scope (delegates to existing `scripts/local/build-hub.sh`) |
| §B SDK rebuild + tgz repack | IN scope (npm publish flow handles) | NOT (consumes mission-64's npm package) |
| §C state-migration | NOT scope | IN scope (runs per-PR migration scripts) |
| §D claude-plugin reinstall | IN scope (script invokes install.sh) | NOT (consumes mission-64's script) |
| Cross-§ orchestration runner | NOT scope | IN scope (THE deliverable) |
| **Public CLI / exit-code / stdout contract** | **IN scope (script must be idea-221-runner-consumable)** | **IN scope (runner consumes the contract)** |

**Critical pre-anchoring:** mission-64's `update-adapter.sh` MUST be designed for downstream consumption by idea-221's runner. Contract specified at §2.1.B; ratified in ADR-029 forward-consequences (§6.2).

This decoupling captures: (a) deprecation language at W4 closing wave doesn't preempt §A/§C territory; (b) §B/§D mechanisation doesn't accidentally encode §A/§C operator-action assumptions.

---

## §3 Wave plan

| Wave | Scope | PR | Sizing |
|---|---|---|---|
| **W0** | Survey + Design v1.0 + ADR-029 SCAFFOLD + Preflight artifact bundle PR + **npm publish dry-run spike** (per §2.4 R2 gate) + **Director ratifies `@apnex` org claim + NPM_TOKEN credentials posture** at Release-gate | 1 PR; doc + spike-only | ~30min architect-time + ~30min Director-time at Release-gate |
| **W1+W2 atomic** | npm package family setup (workspaces config + `workspace:^` deps) + topological `publish-packages.sh` (per §2.5) + update-adapter.sh (per §2.1.B) + namespace migration α→β (per §2.3) + Pass 10 §B mechanisation embedded + tests + active-session coordination protocol (per §3 sub-section below) | 1 PR; substrate-introduction | ~1-1.5 engineer-days (M baseline holds if W0 spike GREEN) |
| **W3 DOGFOOD GATE** | Substrate-self-dogfood verification — concrete dummy-bump (per §6.3): `@apnex/network-adapter` 2.0.0 → 2.0.1 (patch; no source change); run `update-adapter.sh`; verify shim-events.ndjson `parse_failed`=0 + `npm ls` shows updated version + canonical-envelope `agent.advisoryTags.adapterVersion` reflects bump | 1 architect-bilateral thread; observation-only | ~30min architect-time |
| **W4** | Closing audit + Pass 10 protocol-extension PR (update §B+§D references in `multi-agent-pr-workflow.md` to point at npm package + script as canonical mechanism; deprecation language: **"Removed; npm package + script is canonical"** per round-1 audit Fold 4) + ADR-029 RATIFIED + calibration #28 capture (round-1 audit pre-push anti-pattern) | 1 PR; doc-only | ~30min architect-time |

**Aggregate sizing:** ~2-3 engineer-days (M class) — IF W0 publish-flow spike GREEN. Upsize to L if R2 falls back to explicit version-rewrite script (~2h scope add).

### Active-session coordination protocol (per round-1 audit Q11; W1+W2 sub-protocol)

Both architect (lily) and engineer (greg) sessions need to update their adapters to `@apnex/*` namespace during W1+W2 ship. Coordinated rollout to avoid mid-session breakage:

1. **W1+W2 PR merges** with namespace migration + script + npm packages published
2. **Architect (lily) updates first** while engineer (greg) holds (no MCP tool calls)
3. **Architect verifies** handshake parses cleanly + `adapterVersion` advisoryTag present
4. **Engineer (greg) updates next** after architect confirms via thread reply
5. **Engineer verifies** same checks
6. **Both sides resume normal operation** post-coordinated-update

This is symmetric with mission-63 §6.3 9-step protocol but at the namespace-cutover layer. Director-coordinated full-restart after both updates is recommended (matches mission-62/63 precedent).

### Wave-coherence operational sequence (ratified at Manifest)

- W0: Director ratifies npm credentials at Release-gate (Phase 7) before W1+W2 dispatch
- W0 publish-flow dry-run spike validates `workspace:^` rewrite-correctness (R2 gate)
- W1+W2 atomic ship: namespace migration + npm package family + update script + first publish to registry — all coupled in single PR (mission-63 tight-cycle merge precedent)
- W3 dogfood gate: dummy-bump verification (concrete; per §6.3)
- W4 closing audit + Pass 10 protocol-extension PR

**Per-PR coherence requirement:** No partial-state on main during execution — namespace migration α→β must be coupled with package publish flow + script wiring in the same PR.

---

## §4 Anti-goals

### §4.1 Locked anti-goals (Survey Q6 B + C + D)

1. **NO Universal Adapter / ACP redesign integration** (orthogonal future-mission territory)
2. **NO idea-102 Universal Port absorption** (orthogonal contract layer; complementary)
3. **NO Hub-served adapter shape** (option 5 ruled out by Survey Q1 D rejection)

### §4.2 Architect-derived implicit anti-goals

4. **NO §A Hub rebuild + §C state-migration mechanisation** (per Survey Q5 C split-scope; deferred to idea-221)
5. **NO opencode-plugin full parity** (stub-only; mirrors mission-62/63 vertex-cloudrun precedent)
6. **NO CLI middleware** (per Survey Q4 A thin bundle; CLI-as-frontend-to-npm rejected; script + npm install suffices)
7. **NO npm postinstall hook for install.sh** (v0.2 reframe per round-1 audit Fold 3; script-driven §D mechanisation)
8. **NO `@ois/*` deprecation alias** (γ hybrid rejected; clean cutover per Q6 β architect-pick)

### §4.3 Q6 NOT-A resolved at v0.2

`@ois/*` → `@apnex/*` namespace migration **IS in-scope** this mission (Survey Q6 NOT-A signal); v0.2 §2.3 specifies migration sequence + conditional cleanup.

---

## §5 Risks + open questions

### §5.1 Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | npm publish account / `@apnex` org ownership unresolved | Medium | **Director ratifies at W0 Release-gate (Phase 7);** ~30min Director-time. NPM_TOKEN credentials posture documented at Manifest. |
| R2 | `workspace:^` → semver rewrite at publish-time may surface npm tooling edge cases | Medium | **W0 dry-run spike** is the gate (per §2.4): `npm publish --workspaces --dry-run --access public` validates rewrite-correctness BEFORE W1+W2 ships. Fallback: explicit `version-rewrite.sh` script (~2h add; flags M→L). |
| R3 | Postinstall hook security/idempotency concerns | RESOLVED v0.2 | §D reframed as script-driven (per Fold 3); install.sh stays explicit operator step; npm package = artifact distribution only. R3 retired. |
| R4 | Namespace migration α→β coupling with package publish — partial state on main if migration touches refs but publish flow not yet live | Medium | Coupled in single PR (W1+W2 atomic); pre-merge dry-run validates end-to-end (mission-63 §9.1 ratified operational sequence). |
| R5 | Calibration #25 root-cause class re-emergence if consumer skips the script + does manual recipe wrong | Low | W4 closing wave deprecates manual recipe in `multi-agent-pr-workflow.md` Pass 10 §B + §D (deprecation language: "Removed; npm package + script is canonical" per Fold 4). |
| **R6 (NEW)** | First-publish bootstrap order — `npm publish --workspaces` alphabetical-vs-topological | Low-Medium | Explicit `scripts/publish-packages.sh` topological dep-walk (per §2.5); ~1h scope add; bundled in W1+W2 atomic. |
| **R7 (NEW)** | Version-drift between concurrent consumers — A pulls 2.1.0; B pulls 2.1.1 after publish-burst | Low | `update-adapter.sh` supports `--pin <version>` flag for version-pinned coordinated rollout (per §2.1.B). `latest` default for free-running; `--pin` for coordinated. |
| **R8 (NEW)** | `~/.claude` config stomping during install.sh run | Low | install.sh has idempotency-checks (mission-62/63 lessons) + don't-clobber pattern for known-user-config files; document local-config conventions in W1+W2 PR description. |

### §5.2 Open questions for engineer round-2 audit

(Most round-1 questions resolved at v0.2; remaining open:)

1. **Q11 (NEW):** Active-session coordination protocol concrete enough at §3 sub-section? OR needs sub-thread protocol like mission-63 §6.3 9-step? Engineer-side ergonomics-check.
2. **Tests scope (W1+W2 PR includes):**
   - Namespace-migration smoke (zero `@ois/*` refs remaining post-rename)
   - Workspace-protocol publish-correctness (registry-pinned semver in published `package.json`; NOT `workspace:^`)
   - Update-script idempotency (run twice; second run is no-op)
   - install.sh post-npm-cutover correctness (handshake parses cleanly post-update)
   - CLI contract conformance (integration test: each exit code path + stdout shape)
   - **CLI-contract regression test (separate test surface):** `scripts/test/update-adapter-cli.test.sh` (or equivalent) exercising each exit code (0=success / 1=registry-install error / 2=restart-required-but-not-attempted / 3=unrecoverable) + stdout final-line shape — independent of integration tests; protects the public-interface contract idea-221's runner consumes; regression-test surface that downstream-runner ratifies against

---

## §6 Mission-class declaration + ADR-029 SCAFFOLD

### §6.1 Mission-class

**structural-inflection** (introduces consumer-receipt mechanism that future adapter-update flows ride). M sizing baseline (~2-3 engineer-days). Upsize to L if W0 publish-flow spike falls back to explicit version-rewrite script (R2 fallback path).

### §6.2 ADR-029 SCAFFOLD

**ADR-029 (candidate; ratify at Manifest):** *"Adapter update is consumer-self-serve via npm-published packages + script-driven local install."*

**Architectural commitments:**
- npm-publish IS the canonical adapter distribution channel (not git checkout + manual rebuild)
- Pass 10 §B mechanisation embedded in published packages; §D mechanisation script-driven (not postinstall-driven; v0.2 reframe)
- Local script invokes install.sh; npm package ships clean artifacts (separation of artifact-distribution from system-side install action)
- Namespace decision: `@apnex/*` (β; clean cutover from `@ois/*`)
- CLI contract: exit codes 0/1/2/3; structured stdout final-line; `--pin <version>` + `--dry-run` flags; no interactive prompts (idea-221 pre-anchoring)

**Sealed companions:**
- Pass 10 protocol (mission-63 W5 PR #120; this ADR extends §B + §D to point at npm package + script as canonical mechanism)
- **ADR-023** (multi-agent-pr-workflow; W4 closing wave amends `multi-agent-pr-workflow.md` Pass 10 §B+§D deprecation language; ADR-023 is the underlying ADR covering the workflow doc territory)
- ADR-028 (canonical envelope; orthogonal — wire-shape vs distribution-shape)
- mission-61 Layer-3 lesson (sealed companion; this ADR closes Layer-3 root-cause class structurally via `workspace:^` rewrite)
- **idea-186 (npm workspaces)** (foundational dependency; workspace-protocol publish flow rides idea-186)
- **idea-221 forward-consequence** (CLI contract pre-anchoring at §2.1.B + §2.10; idea-221's runner consumes mission-64's script via this contract)

### §6.3 Substrate-self-dogfood discipline

**W3 dogfood-gate scope: observation-only** (per Survey Q5 architect-lean + greg round-1 audit concur).

**Concrete dummy-bump proposal (per round-1 audit §6.3 ask):**
1. Bump `@apnex/network-adapter` 2.0.0 → 2.0.1 (patch-level; no source change; just version bump)
2. Run `npm publish --workspace=@apnex/network-adapter --access public` (or via topological publish script)
3. Run `update-adapter.sh` on lily-side
4. Verify (must be GREEN):
   - `.ois/shim-events.ndjson` shows `agent.handshake.parse_failed` count = 0 post-update
   - `npm ls -g @apnex/claude-plugin` shows updated version chain
   - Canonical envelope `agent.advisoryTags.adapterVersion = "2.0.1"` (mismatch indicates §2.7 stamp not propagating)
5. Engineer-side same protocol post-architect-verify (per §3 active-session coordination)

**Hold-on-failure:** any verification gate failure halts W3; investigate via shim observability + `npm ls` chain; fix-forward; re-run dummy-bump.

---

## §7 Engineer audit ask (round-2 questions)

(Carried + new from round-1 v0.2 fold cycle)

1. **Folds 1-6 GREEN?** Concrete refinements per round-1 audit (conditional cleanup; `workspace:^`; §D script-driven reframe; Removed deprecation; idea-221 decoupling table; §2.7-§2.9 sub-sections) all incorporated. Ratify or surface gaps.
2. **NEW §2 sub-sections accurate?** §2.4 publish flow + §2.5 bootstrap order + §2.6 install.sh location + §2.7 version visibility + §2.8 cache invalidation + §2.9 telemetry preservation + §2.10 idea-221 decoupling. Engineer review for completeness + technical correctness.
3. **§3 wave plan** with W0 npm-credentials prereq + W0 dry-run spike + active-session coordination protocol — adequate or needs more granularity?
4. **§5.1 R6 + R7 + R8** — risk severity assessments accurate? Mitigations adequate?
5. **§6.2 ADR-029 sealed companions** — idea-186 + idea-221 forward-consequence captured; anything else?
6. **§6.3 dogfood-gate concrete proposal** — operationally sound?
7. **Q11 NEW (round-2)** — active-session coordination protocol concrete enough at §3 sub-section? Or needs sub-thread protocol?
8. **Tests scope (round-2)** — what test surfaces should W1+W2 PR include? Architect-lean above (§5.2 #2); engineer concur or alternative?
9. **Sizing recalibration (round-2)** — M baseline holds (W0 spike GREEN expected) or upsize-to-L flag if R2 fallback?
10. **Architectural surfaces missing (round-2)** — anything v0.2 still doesn't cover that v0.1 audit surfaced?

If GREEN-with-folds, engineer ratifies on round-2 thread-405 close → Design v1.0 → Manifest+Preflight bundle PR → Director Phase 7 Release-gate.

---

## §8 Cross-references

- **Source Idea:** idea-217 (Streamline adapter compile/update/re-install for consumers)
- **Companion Idea:** idea-221 (Pass 10 cross-§ orchestration; operator-side; out-of-scope this mission)
- **Survey:** `docs/surveys/m-adapter-streamline-survey.md` v1.0
- **Methodology:**
  - `docs/methodology/idea-survey.md` v1.0
  - `docs/methodology/multi-agent-pr-workflow.md` (Pass 10 protocol; mission-63 W5 PR #120)
  - `docs/methodology/mission-lifecycle.md`
  - `docs/methodology/mission-preflight.md`
- **Architectural-precedents:**
  - mission-63 (M-Wire-Entity-Convergence; clean-cutover discipline; tight-cycle merge cadence; structural-inflection M-class precedent)
  - mission-62 (M-Agent-Entity-Revisit; Pass 10 §A discipline + state-migration discipline)
  - mission-61 (M-Pulse-Primitive-Surface-Closure; Layer-1+2+3 SDK-tgz-stale lesson source; closed structurally by §2.4 `workspace:^` rewrite)
  - mission-57 (M-Mission-Pulse-Primitive; coordination-primitive-shipment class precedent)
- **ADRs (sealed companions):**
  - ADR-029 (this mission's ADR; ratify at Manifest)
  - ADR-028 (canonical envelope; orthogonal)
- **Foundational dependencies:**
  - **idea-186** (npm workspaces; foundational dep for `workspace:^` publish flow)
- **Memory referenced:**
  - `project_npm_namespace_apnex.md` (Director-prior-preference; Q6 β decision)
  - `feedback_substrate_self_dogfood_discipline.md` (W3 dogfood observation-only framing)
  - `feedback_complete_mission_scope_methodically.md` (split-scope discipline per Q5 C)
  - `feedback_thread_vs_github_approval_decoupled.md` (calibration #24 dual-surface)
- **Calibrations addressed:**
  - **#25** (mission-63 W4) — Pass 10 §B SDK rebuild gap; **closed structurally** by §2.4 `workspace:^` publish flow + §2.7 version visibility
  - **#28 (NEW)** — round-1 audit thread opened pre-push (engineer-side blind audit anti-pattern); captured in W4 closing audit Pass 10 protocol-extension PR forward-pointer

---

## §9 Status

- v0.1 architect-draft (commit 8936e2c)
- v0.2 architect-revision (commit 05893c8; round-1 audit folded)
- **v1.0 BILATERAL RATIFIED** (this commit; thread-405 round-7 close 2026-04-28T07:34:09.132Z; action-1 close_no_action committed; 2 minor adds folded: ADR-023 sealed companion + CLI-contract regression test surface)
- Ships in W0 bundle PR with Survey + Preflight + ADR-029 SCAFFOLD

---

*Design v1.0 bilateral ratified 2026-04-28 ~07:34Z. Architect: lily; Engineer: greg. thread-405 round-7 close.*
