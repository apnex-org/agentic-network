# Changelog — @apnex/opencode-plugin

All notable changes to the OpenCode host plugin are documented here.

## 0.2.3 — fix live-load: depend on network-adapter with NotificationCoalescer (bug-215)

### Fixed
- Requires `@apnex/network-adapter@^0.1.7`, the first published network-adapter that
  exports `NotificationCoalescer`. The 0.2.2 release resolved `^0.1.6`, whose published
  build lacked that export, so a real npm install threw at module load
  (`SyntaxError: does not provide an export named 'NotificationCoalescer'`) and the
  plugin silently failed to activate in a live OpenCode session (no Hub handshake).
  No source change in the plugin itself — the fix is the corrected published dependency.
  Surfaced bringing greg online for mission-101 work-110 live cert. See bug-215.

## 0.2.2 — mission-101 refactor shipped to npm (release)

First npm publish of the mission-101 sovereign-adapter refactor. Bumps the version so the shipped `src/` (runtime factory + network-adapter facade routing landed in mission-101 W3/W4) is honestly reflected past the prior `0.2.1` version bump — required by the version-assert gate before publish.

### Changed
- `src/runtime.ts` `createOpenCodeRuntime(...)` is the production/test runtime seam (mission-101 W3, #467).
- Runtime routes through the `@apnex/network-adapter` facade only; no direct cognitive-layer/message-router imports from production source (mission-101 W4, #468).
- Distribution standardized to the graph-published npm shape (mission-101 W6, #470); offline conformance (#471) and package integrity (#472) gates added and green.

### Certification boundary
- This release covers **offline / package / runtime / distribution** conformance only (verifier VALID audit-7652). Live OpenCode/GPT-5.5 certification is captured separately by work-110 and is validated against this published artifact.

## 0.2.1 — npm graph-publish shape prepared (mission-101 W6)

This workspace is now shaped as a first-class `@apnex/*` npm-family member, pending the later mission-101 release decision/publish gate.

### Changed
- Canonical package entry is `dist/plugin-entry.js`, which exports only `HubPlugin` for OpenCode loader compatibility.
- `dist/shim.js` and `dist/runtime.js` remain available through explicit subpath exports (`./shim`, `./runtime`) for tests/dev tooling.
- Direct runtime dependency shape is graph-published: `@apnex/network-adapter` plus `@modelcontextprotocol/sdk`; internal cognitive/message-router packages are consumed only through the network-adapter facade.
- npm package files are explicitly whitelisted (`dist/`, `src/`, `QUICKSTART.md`, `CHANGELOG.md`, `AGENTS.md`, `tsconfig.json`).
- The legacy self-contained esbuild bundle remains as a documented compatibility bridge for existing GitHub/source users until npm cutover completes.

### Notes
- W6 does **not** publish a release. Final version bump, npm publish, and live release decision remain gated by the later mission-101 release node.
