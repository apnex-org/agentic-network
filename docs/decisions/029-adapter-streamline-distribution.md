# ADR-029 — Adapter update is consumer-self-serve via npm-published packages + script-driven local install

**Status:** SCAFFOLD — drafted at mission-64 Phase 6 Preflight 2026-04-28; final ratification at mission-64 W4 closing wave (bilateral architect+engineer ratify; mission-63 ADR-028 precedent).
**Mission:** mission-64 M-Adapter-Streamline
**Date drafted:** 2026-04-28
**Authors:** lily / architect (scaffold); bilateral ratify pending W4

---

## Status flow

| Phase | State | Target |
|---|---|---|
| Scaffold | SCAFFOLD (this commit; W0 bundle PR) | Provides ADR number assignment + initial decision framing |
| W1+W2 | (no change; npm package family + update script + namespace migration ship; ADR text stable) | — |
| W3 | (no change; substrate-self-dogfood verifies; ADR text stable) | — |
| W4 | RATIFIED (bilateral architect+engineer at W4 closing) | Final text incorporates W3 evidence + any in-flight refinements |

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
- **Calibrations addressed:**
  - **#25** (mission-63 W4) — Pass 10 §B SDK rebuild gap; **closed structurally** by §2.4 `workspace:^` publish flow + §2.7 version visibility
  - **#28 (NEW)** — round-1 audit thread opened pre-push (engineer-side blind audit anti-pattern); captured in W4 closing audit Pass 10 protocol-extension PR forward-pointer

---

## Status flow at W4 — RATIFIED protocol

At W4 closing, this ADR scaffold becomes bilaterally ratified by architect+engineer:
1. W3 dogfood-gate evidence captured in `docs/audits/m-adapter-streamline-closing-audit.md` referenced
2. Implementation refinements surfaced during W1+W2 + W3 folded into the ADR text
3. Status flips from SCAFFOLD → RATIFIED
4. Ratification thread (similar to mission-63's thread-403/404 pattern) bilateral seal

---

*Scaffold drafted at mission-64 Phase 6 Preflight 2026-04-28 ~07:35Z; final ratification pending W4 closing wave.*
