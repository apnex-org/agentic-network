# piuplift0 backport candidates and deferred items

Arc: `piuplift0` / `idea-534`  
Date: 2026-07-15

## Purpose

`idea-534` explicitly required the PI uplift to emit two closeout lists:

1. **Backport-to-Claude candidates** — PI-first improvements worth pulling back to Claude and/or OpenCode.
2. **Deferred items** — improvements that failed the small+related gate, each routed to a follow-up so the value is not lost.

The governing principle was *improve, do not photocopy*: the PI migration was a forcing function to de-fossilize shared harness assumptions, improve robustness, and then decide what should flow back to other harnesses.

## Backport-to-Claude / OpenCode candidates

### 1. Neutral harness manifest naming and raw-tool prefix semantics

**PI-first outcome:** P0 removed the `architect-hub_` fossil by making tool prefix semantics explicit in `agent-adapter.manifest.json` and `loadHarnessManifest`. PI registers raw tool names, so `toolPrefix: ""` is a first-class/valid manifest state.

**Backport value:** Claude and OpenCode should not rely on implicit historical names. Their manifests should explicitly encode whether they use prefixed or raw tool names, so wake prompts, tool registration, and tests all read from the same substrate.

**Suggested target:** shared harness manifest/parser tests plus Claude/OpenCode manifest audit.

### 2. Generalized skill seeding/export shape

**PI-first outcome:** P1 generalized seed-skills behavior for PI (`ois pi_seed`, `PI_CODING_AGENT_DIR`, exported `skills/`) while preserving the universal ResourceActuatorPort contract.

**Backport value:** Claude/OpenCode should consume the generalized shape rather than carrying one-off seed logic. This reduces adapter drift and lets future skills ship through a common capability path.

**Suggested target:** ClaudeSkillActuator/shared SkillActuator base extraction if the commonality remains crisp; otherwise manifest the PI-specific last-mile separately while sharing the contract and tests.

### 3. HCAP Controller/Actuator discipline as the default adapter pattern

**PI-first outcome:** PI is already the origin of the Controller/Actuator split, and piuplift0 verified that the shared kernel + PI last-mile can preserve the universal ResourceActuatorPort boundary.

**Backport value:** Treat PI’s split as the reference architecture for future Claude/OpenCode cleanup: host-specific actuators at the edge, shared control-plane reconciliation in the kernel.

**Suggested target:** document adapter modernization guidance and use it when touching Claude/OpenCode HCAP work.

### 4. Facade-boundary and cognitive-pipeline coverage for harness adapters

**PI-first outcome:** P2 added/verified PI facade-boundary and cognitive-pipeline coverage.

**Backport value:** Claude/OpenCode should carry the same class of tests: adapter package metadata, dependency boundary, native tool-bridge behavior, probe/cache behavior, and end-to-end cognitive path. The exact host mechanics can differ, but the invariant class should not.

**Suggested target:** test matrix parity document or harness-template test fixtures.

### 5. Package-integrity guard for adapter npm artifacts

**PI-first outcome:** P3 added `adapters/pi-plugin/test/package-integrity.test.ts`, verifying package metadata, manifest presence, publish family wiring, changelog/quickstart anchors, and `npm pack --dry-run` contents.

**Backport value:** Claude/OpenCode should have equivalent integrity tests so published npm artifacts do not silently drift from runtime assumptions.

**Suggested target:** factor a shared package-integrity helper or template; keep per-harness assertions for host-specific metadata.

### 6. CI-tag npm publish evidence as a release closeout habit

**PI-first outcome:** P3 republish was correctly completed via `npm-v0.1.7` -> `publish-npm.yml`, with evidence: tag peeled to `ed0c7bb2954dc1b8e9b80ea5bba496b794efc051`, run `29390741964` success, registry `@apnex/pi-plugin@0.1.7`.

**Backport value:** Package-release WorkItems for all harnesses should name the CI tag path and bind evidence from tag/workflow/registry, not local `npm publish` assumptions.

**Follow-up:** `idea-536` mechanizes this release affordance.

## Deferred items

### D1. Full PI npm-distribution north-star

**Why deferred:** PI’s runtime distribution differs from Claude’s marketplace install stack. PI currently uses OIS config (`config/harnesses/pi.json`), per-seat config rendering, and `pi -e npm:@apnex/pi-plugin@...`. Copying Claude mechanics would be overreach.

**Follow-up:** `idea-535` — design a dedicated PI distribution north-star covering install/bootstrap expectations, pin/provenance flow into OIS config, and registry clean-install verification.

### D2. npm publish-path mechanization beyond this arc

**Why deferred:** The current arc corrected the immediate publish via `npm-v0.1.7`, but the structural fix is a reusable affordance: dry-run default, explicit tag push, workflow watch, registry verification, and evidence emission.

**Follow-up:** `idea-536`; seed plan stored at `docs/planning/npm-publish-mechanization-plan.md`.

### D3. Container-supervisor LivenessWatchdog redesign

**Why deferred:** P2 only needed narrow PI LivenessWatchdog/eager-claim robustness. A broader redesign crosses into container lifecycle, restart policy, cross-harness health semantics, and estate-wide supervision.

**Follow-up:** `idea-539`.

### D4. OpenCode harness overhaul

**Why deferred:** Neutral naming, skill seeding, package integrity, and HCAP coverage likely apply to OpenCode, but a full OpenCode uplift is larger than PI parity closeout.

**Follow-up:** `idea-537`, related to existing OpenCode/GPT-5.5 uplift `idea-329`.

### D5. Git-push cadence / release-path hook

**Why deferred:** The publish-path miss exposed a broader class: post-merge operations need mechanized push/tag/watch/evidence loops. This is adjacent to release mechanics, not core PI parity.

**Follow-up:** `idea-538`, related to `idea-536`.

### D6. PI footer model-affordance cleanup

**Why deferred:** `bug-270` remains separate. The PI footer/status work reached the required dark/blue/footer and tmux viewport artifact parity, but model-affordance polish is not necessary for arc closeout.

**Follow-up:** existing `bug-270`.

## Closeout summary

The PI uplift produced reusable value in three classes:

- **Shared substrate clarity:** manifest-driven naming, HCAP Controller/Actuator boundaries, skill seeding shape.
- **Adapter robustness:** liveness/eager-claim wiring, facade/cognitive tests, package-integrity tests.
- **Release discipline:** npm publish via CI tag path with auditable evidence.

Items that were too broad were routed to follow-ups rather than hidden in prose. This satisfies the `idea-534` directive while keeping piuplift0 bounded for closeout.
