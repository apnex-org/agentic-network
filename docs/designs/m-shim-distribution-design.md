# M-Shim-Distribution — Design v0.2

**Status:** v0.2 — REWRITTEN after discovering ADR-029. Plan-before-code: no
implementation until this rewrite is ratified. (v0.1 is superseded; see §13 for
what changed and why — the v0.1 premises were factually wrong.)
**Mission class:** CI automation of an already-ratified publish path + one new
family member (pi).
**Author context:** pi-plugin native binding shipped + validated live
(`m-pi-plugin-adapter-design.md`, e2e 2026-07-01). The distribution question was
initially reasoned toward a self-contained bundle — until investigation surfaced
**ADR-029** (RATIFIED mission-64): the network ALREADY publishes an `@apnex/*`
npm package family, and `@apnex/{network-adapter,cognitive-layer,message-router,
claude-plugin}` are ALREADY live on the public registry. This mission does NOT
re-litigate that; it **fills the one real gap: publish is run manually, and pi is
not yet a family member.**
**Axioms in force:** A11 Cognitive Minimalism (Deterministic Primitive — a manual
publish ritual is Substrate Leakage into human toil), A6 Frictionless (one atomic
trigger), A8 Gated Recursive Integrity (release gate + version assert), A4
Zero-Loss (this rewrite corrects a doc that justified a decision on false premises),
A3 Sovereign Composition (reuse the earned primitive; don't build a parallel one).
**Governing prior decision:** **ADR-029** (`docs/decisions/029-adapter-streamline-distribution.md`).
**Related:** `m-pi-plugin-adapter-design.md`, `m-sovereign-tool-manager-design.md`
(§9 build-info backlog), `m-claude-opencode-foldin-design.md` (facade fold-in).

---

## §1 Ground truth (verified 2026-07-01)

**Mechanics (what actually exists).**

1. **The `@apnex/*` npm family is live** (ADR-029 / mission-64):
   - PUBLISHED to public npm: `@apnex/network-adapter@0.1.2`,
     `@apnex/cognitive-layer`, `@apnex/message-router`, `@apnex/claude-plugin@0.1.4`.
   - NOT published: `@apnex/opencode-plugin` (private/stub this-mission per ADR-029),
     `@apnex/pi-plugin` (doesn't exist on registry — this mission adds it).
2. **Consumer model = graph install.** Published `@apnex/claude-plugin@0.1.4`
   declares real registry deps (`@apnex/network-adapter@^0.1.2`, `-message-router@^0.1.2`,
   `-cognitive-layer@^0.1.2`, `@modelcontextprotocol/sdk@1.29.0`). Installing it pulls
   the graph. This is the ratified distribution shape.
3. **Publish infra exists and is CI-friendly by design:**
   - `@apnex` npm org claimed; `NPM_TOKEN` exists (`~/.config/apnex-agents/greg.env`).
   - `scripts/publish-packages.sh` — **first-publish topological bootstrap**
     (leaves before dependents on a virgin registry); CLI-contract-clean (exit
     codes, `--dry-run`, "No interactive prompts — CI/operator-runner-friendly").
   - `scripts/version-rewrite.js` — swaps cross-`@apnex` deps `*` ↔ `^X.Y.Z`
     around publish (npm 11.6.2 rejects `workspace:^`; `*` isn't rewritten at
     pack-time; so this bridges). Wired via root `prepublishOnly`/`postpublish`.
     Already has the cwd-independent `git rev-parse` fix (calibration #39 closed).
4. **pi is already family-shaped.** `adapters/pi-plugin/package.json` declares
   `@apnex/network-adapter = "*"` — the same placeholder style `version-rewrite.js`
   expects. No dep-shape change needed to join the family.

**The one real gap.**

5. **npm publish is MANUAL.** No GitHub workflow publishes the npm family. The only
   release workflow (`release-plugin.yml`, tag `v*`) builds the **claude-plugin
   GitHub-Release tarball** (a Claude-Code-plugin artifact with nested `@apnex/*.tgz`
   + skills + `install.sh`) — a *separate channel*, NOT an npm publish. The npm
   family (0.1.0→0.1.4) was published by hand from a bash session (calibration #39
   was literally a publish-bash-session cwd bug — direct evidence of manual runs).
6. **The registry is stale.** npm has `@apnex/network-adapter@0.1.2`; the local tree
   is `0.1.4`. Manual publish → drift. A consumer `pi install`-ing today gets a
   two-patch-old kernel. This is the concrete cost of #5.

**Rationale.** ADR-029 deliberately built the publish primitives CLI-clean *so
automation could drive them* ("external + future-pool consumers serve themselves
with the same mechanism as local-dev"; CLI contract pre-anchored for idea-221's
orchestration runner). The intent was always automatable publish; the manual
state is unfinished, not by-design.

**Consequence averted by closing the gap.** Manual publish = step-skip regressions
(the calibration #25/#39 class), registry staleness (§1.6), and human-time toil per
release (A11 Substrate Leakage; A6 friction). CI-triggered publish closes the class
structurally.

---

## §2 Decision

**pi joins the ratified `@apnex/*` npm family (ADR-029 graph-publish model), and
npm publish for the whole family is automated via a CI workflow reusing the
existing token + primitives.**

Three coupled commitments:

### D1 — pi is a published family member (graph model, uniform with claude)
- **Mechanics:** add `@apnex/pi-plugin` to the published family. It ships as an npm
  package declaring real registry deps (`@apnex/network-adapter@^X.Y.Z` +
  `@modelcontextprotocol/sdk`) + `peerDependencies` for pi-provided libs (`typebox`,
  `@earendil-works/pi-coding-agent`). Consumer: `pi install npm:@apnex/pi-plugin`
  → npm resolves the graph. Add `pi` manifest (`pi.extensions`) + `keywords:
  ["pi-package"]` so pi's loader finds the entry.
- **Rationale:** the graph-publish model is RATIFIED and in production for claude;
  putting pi on it is uniform, reuses all existing infra, and adds NOTHING new to
  npm's surface (network-adapter et al. are already public). The A3
  "Speculative-Surface" objection to graph-publish (raised in v0.1) is MOOT — those
  surfaces already exist with a consumer (claude).
- **Consequence averted:** a parallel bundle pipeline duplicating publish infra
  (v0.1's mistake); pi diverging from claude's distribution shape.

### D2 — CI-triggered publish for the whole family (the mission centerpiece)
- **Mechanics:** a new GitHub workflow publishes the npm family on a deliberate
  trigger (tag), reusing `scripts/version-rewrite.js` (via root lifecycle hooks) +
  `npm publish --workspaces --access public`, authenticated by `NPM_TOKEN` added as
  a **GitHub repo secret** (the SAME token value already in `greg.env`). Gated per
  §5. `publish-packages.sh` remains the documented **first-publish bootstrap** for a
  brand-new package's first appearance on a virgin registry; steady-state
  publishing is `npm publish --workspaces` in CI (exactly the transition ADR-029
  describes: "subsequent publishes can use `npm publish --workspaces`").
- **Rationale:** A11 (mechanize the deterministic ritual), A6 (one atomic trigger,
  no bash-session cwd bugs), A8 (gated). Fixes the §1.6 staleness class for ALL
  shims at once, not just pi.
- **Consequence averted:** manual-publish step-skip + staleness class (calibrations
  #25/#39); per-release human toil.

### D3 — trigger model: continuous test + deliberate publish (two triggers)
- **Mechanics:**
  - **Continuous (push/PR/merge_group):** pi is added to `test.yml`'s
    `vitest-non-hub` matrix so every commit builds + tests it (it is in ZERO
    workflows today). No publish.
  - **Deliberate (tag):** the publish workflow (D2) runs only on a release tag →
    build + gate + `npm publish`.
- **Rationale:** publishing on every push would spam the registry + violate A8's
  version-assert discipline. Continuous *build/test* catches breakage early;
  *publish* stays deliberate. Mirrors the existing `test.yml` (push) vs
  `release-plugin.yml` (tag) split — a proven pattern in this repo.
- **Consequence averted:** un-deliberate version churn; un-tested bundles reaching
  the registry.

---

## §3 What we are NOT doing (scope discipline + reversed v1 decisions)

- **NOT building a self-contained esbuild bundle for pi** (v0.1's Option A). The
  graph-publish path already exists and is ratified; a bundle would duplicate infra
  and diverge from claude. (The bundle's only real edge — zero-runtime-dep artifact,
  no version-skew — is outweighed by reuse + uniformity. Recorded as a
  never-say-never in §11, not adopted.)
- **NOT publishing the `@apnex/*` graph** — it's ALREADY published. Nothing to do
  there except add pi + keep it fresh via D2.
- **NOT touching claude's GitHub-Release tarball channel** (`release-plugin.yml`).
  That is claude's *Claude-Code-plugin* artifact — a distinct consumer surface from
  the npm family. It stays. (claude is published to BOTH: npm family member AND a
  Claude-Code plugin tarball. Do not conflate.)
- **NOT fixing bug-116** (the `network-adapter ↔ message-router` source cycle). It
  bites `.d.ts` emission but the family publishes through it today; out of scope.

---

## §4 Target-state artifact + consumer contract

The published `@apnex/pi-plugin`:
- `pi` manifest (`pi.extensions: ["dist/index.js"]`) + `keywords: ["pi-package"]`.
- `dist/` from `tsc` (same as claude — NOT a bundle); `dependencies`:
  `@apnex/network-adapter` (rewritten `*`→`^X.Y.Z` at publish) + `@modelcontextprotocol/sdk`.
- `peerDependencies`: `typebox`, `@earendil-works/pi-coding-agent` (pi provides).
- build-info sha inlined/emitted (closes tool-manager §9 backlog item 12 for pi;
  see §6).
- Consumer: `pi install npm:@apnex/pi-plugin` → npm pulls the graph → works with no
  source access.
- Dev unchanged: `pi -e adapters/pi-plugin/src/index.ts` via workspace symlink →
  live hot source. One source of truth; the npm artifact is a `tsc` projection of it.

---

## §5 Release gate (A8 — runs in the publish workflow)

1. **version-bump assert** — `write-build-info.js --assert` (the `prepack` gate
   claude already uses) ensures no un-bumped ship. Prevents the §1.6 "publish same
   version" no-op / overwrite class.
2. **version-rewrite integrity** — after `prepublishOnly` rewrite, assert NO `*`
   remains in any published `@apnex/*` dep (calibration #39 class — un-rewritten `*`
   shipped). Grep the staged package.json set.
3. **build present** — `dist/` + build-info emitted; sha non-UNKNOWN.
4. **`files` whitelist honored** — the published tarball contains expected entries
   (calibration #38 class — gitignore-anchor leakage). Reuse the structural-tarball
   check pattern from `release-plugin.yml`.
5. **cross-lineage runtime acceptance** where triggered
   (`docs/specs/cross-lineage-runtime-acceptance-gate.md`) — for artifacts a
   cross-lineage peer runs (e.g. steve on opencode).

---

## §6 build-info for pi (closes a carried backlog item)

pi currently reports `@apnex/network-adapter@0.1.4` (package version) at handshake,
NOT the git sha — tool-manager §9 backlog item 12 (phantom-version / bug-183 class).
`write-build-info.js` runs at pi's prebuild + emits `dist/build-info.json`, but
`shim.ts` doesn't read it back. In the graph-publish (non-bundle) model, the fix is
the SAME as claude's: read the emitted `dist/build-info.json` at runtime (claude's
`readBuildInfo` pattern), not the bundle-inline path. Fold this into Phase 1.

---

## §7 claude + opencode distribution — DEFERRED to the claude/opencode refactor

**This mission scopes to pi + the CI publish automation.** claude's and opencode's
distribution changes are DEFERRED into the committed claude/opencode refactor
mission (`m-claude-opencode-foldin-design.md`), NOT done here. Rationale: both are
live-agent cutovers entangled with the facade fix + an artifact-shape decision
(below), and belong in ONE coherent, regression-gated fold-in rather than a
standalone distribution one-off.

| Shim | Today | Deferred change (folds into the refactor mission) |
|---|---|---|
| pi | none | **THIS mission:** D1 (add to family) + D2 (CI publish) + §6 build-info |
| claude | npm family member (manual publish) + Claude-Code Release tarball | bring its npm publish under D2 CI (tarball channel `release-plugin.yml` untouched) |
| opencode | `github:apnex/opencode-hub-plugin` (steve + lily live) | **move to npm family** (Director-decided), retiring `github:` |

**The opencode artifact-shape decision (to resolve in the refactor mission, NOT
now).** opencode's `github:` artifact is a **self-contained esbuild bundle** (zero
`@apnex` deps, one `dist/shim.js` from `bundle-opencode.js`). The npm family model
(D1) is **graph-publish** (declare `@apnex/*` deps, npm resolves them). "Move
opencode to npm" therefore forces a sub-choice: publish the **bundle** to npm (npm
as just a different fetch channel for the single file) vs re-shape opencode to
**graph-publish** like claude/pi (drop the bundle). Open until the refactor mission;
must verify OpenCode's npm-plugin dep-resolution before choosing graph.

**Live-cutover facts the refactor mission must honor:** BOTH `../steve/opencode.json`
AND `../lily/opencode.json` pin `"plugin": ["github:apnex/opencode-hub-plugin"]`.
The cutover changes both launch configs + triggers the cross-lineage runtime
acceptance gate (§5.5) for steve. Coordinated, not incremental.

**Prerequisite (from `m-claude-opencode-foldin-design.md`):** the *facade* drift fix
(claude+opencode importing `@apnex/cognitive-layer`/`-message-router` directly). In
the graph-publish model this matters MORE — the published package's declared
`dependencies` must match what src imports; the facade rule keeps that honest.
Sequence within the refactor mission: facade fold-in → then CI-publish fold-in.

---

## §8 Execution phases (gated slices — plan-before-code; PAUSED for ratification)

- **Phase 0 (this doc v0.2)** — design corrected + ratified. ← we are here.
- **Phase 1 — pi as family member (local):** add `pi` manifest + `keywords`; split
  `peerDependencies` (`typebox`, pi-core) out of `dependencies`; wire build-info
  runtime read (§6). Gate: `pi -e dist/index.js` loads; `npm publish --dry-run
  --workspace=@apnex/pi-plugin` renders `^X.Y.Z` deps (no `*`); re-run live e2e.
- **Phase 2 — pi in continuous CI:** add `adapters/pi-plugin` to `test.yml`
  `vitest-non-hub` matrix + the topological build step. Gate: green on a PR.
- **Phase 3 — CI publish workflow:** new tag-triggered workflow; `NPM_TOKEN` repo
  secret (reuse existing value — Director/owner pastes it once); `version-rewrite`
  via lifecycle + `npm publish --workspaces --access public`; gates §5. Gate:
  `--dry-run` publish in CI; then a real tagged publish of `@apnex/pi-plugin`;
  `pi install npm:@apnex/pi-plugin` on a clean container connects. Also republishes
  the stale family (network-adapter 0.1.2→0.1.4) — closes §1.6.
- **Phase 4 — QUICKSTART rewrite:** real `pi install npm:@apnex/pi-plugin` +
  verify-build-identity (A4) + dev-against-source instructions.
- **Phase 5 — DEFERRED (§7):** claude npm publish under CI + opencode npm cutover
  fold into the claude/opencode refactor mission, not this one. This mission ends
  at Phase 4 (pi shipped + CI publish automated for the family).

---

## §9 Prerequisites needing owner action (can't self-serve)

1. **`NPM_TOKEN` as a GitHub repo secret** — the token VALUE already exists in
   `greg.env`; it must be added to GitHub Secrets for CI to authenticate. One-time
   paste by the repo owner (mirrors how `GCP_SA_KEY` is set for `deploy-hub`). No
   new credential creation — reusing the existing `@apnex`-org token.
2. **Confirm `@apnex/pi-plugin` first-publish** — a brand-new package's first
   registry appearance may want the topological `publish-packages.sh` bootstrap once
   (add `@apnex/pi-plugin` to its `PACKAGES` list), THEN steady-state CI
   `--workspaces` publishing. Decide: bootstrap pi manually once, or let the CI
   workflow handle first-publish too (it can, since the leaves already exist on the
   registry — pi's only `@apnex` dep, network-adapter, is already published).

---

## §10 Tag / version scheme (open — needs a ruling)

`release-plugin.yml` already claims `v*` for the claude tarball. If the npm-publish
workflow also triggers on tags, we need a non-colliding scheme:
- **Option per-shim** (`pi-plugin-v*`, `opencode-plugin-v*`) — independent cadence.
- **Option family `v*`** — one tag publishes the whole `@apnex/*` family (npm
  `--workspaces` already publishes all at once); simpler, but couples versions AND
  collides with claude's existing tarball `v*` trigger.
- **Option `npm-v*`** — a dedicated tag namespace for the npm-publish workflow,
  distinct from claude's tarball `v*`.
My lean: **`npm-v*`** for the family npm publish (distinct from claude's tarball
`v*`), with per-package versions in each package.json (npm publishes each at its own
version regardless of the tag string). Discuss at §12 Q1.

---

## §11 Deferred / earned-by-demand

1. **Self-contained bundle** (v0.1's Option A) — NOT adopted for pi; recorded as an
   option IF a future consumer needs a zero-dep artifact (e.g. an air-gapped host).
   NOTE: opencode's `github:` artifact IS a bundle today — its npm cutover (§7)
   revisits bundle-vs-graph in the refactor mission.
2. **claude + opencode CI-publish fold-in** — DEFERRED to the claude/opencode
   refactor mission (§7): claude npm publish under CI; opencode npm cutover +
   `github:` retirement + steve/lily launch-config change + cross-lineage gate.
3. **bug-116** (source cycle) — publishes through it today; fix earned when `.d.ts`
   consumers appear.
4. **Byte-reproducible builds** — `tsc` output is already deterministic-ish;
   provenance is the git sha + build-info. Harden only if a consumer needs
   bit-exact rebuild.

---

## §12 Open questions for ratification

1. **Tag scheme** (§10) — **RESOLVED: `npm-v*`** (distinct from claude's tarball
   `v*`); per-package versions in each package.json.
2. **pi first-publish** (§9.2) — **RESOLVED: CI handles it** (pi's only `@apnex` dep,
   network-adapter, is already on the registry — no manual bootstrap needed).
3. **opencode endpoint** — **RESOLVED: move to npm family, DEFERRED to the
   claude/opencode refactor mission** (§7). Retire `github:`. Not done in this
   mission (live steve+lily cutover belongs with the facade fold-in).

## §13 What changed from v0.1 (A4 — correcting the record)

v0.1 chose a self-contained esbuild bundle (Option A) on three premises that
investigation proved FALSE:
- "Publishing the `@apnex/*` graph is a future, Speculative-Surface, bug-116-blocked
  option." **Wrong:** it's RATIFIED (ADR-029), LIVE on npm, and claude ships that
  way. Publishing pi's graph adds nothing new.
- "There is no npm-publish infra / no creds." **Wrong:** `publish-packages.sh` +
  `version-rewrite.js` + `@apnex` org + `NPM_TOKEN` all exist.
- "The circular dep blocks publish." **Wrong:** it blocks `.d.ts` emission only; the
  family publishes through it.
The real gap was never "how to publish" — it was "publish is manual + pi isn't a
member." v0.2 targets that. Recording this per A4: a design must not justify a
decision on false premises; the reversal is the honest correction.

## §14 Provenance

v0.1 reasoned toward a bundle before ADR-029 was found. v0.2 rewritten 2026-07-01
after verifying the live npm family + manual-publish gap. Director ratified the
corrected proposal: (a) put pi on the ratified graph-publish family, (b) automate
publish via CI reusing the existing token/primitives, (c) fold in the stale-registry
fix. Grounded in A11 (mechanize the ritual), A6 (atomic trigger), A8 (gated), A4
(correct the false-premise record), A3 (reuse the earned primitive, don't duplicate).
Paused before code for design ratification per plan-before-code discipline.
