# Changelog — @apnex/opencode-plugin

All notable changes to the OpenCode host plugin are documented here.

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
