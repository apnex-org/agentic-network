# Work-Trace — Adapter-Modernization Pilot P1b (declarative harness manifest)

**Task:** `work-bp-m_adapter_modernization_pilot_20260629-p1b_extract_manifest` (engineer: greg / `agent-0d2c690e`)
**Provenance pin:** **idea-398** → ratified **Design v1.0** (`66a8f721`) §3/§9 — Director-direct. NOT GATE-2.
**Branch:** `agent-greg/adapter-p1b-extract-manifest` (off `origin/main`).
**Sequencing:** P1c → P1d → **P1b** → P1e. (Done after P1c/P1d so the P1d consumption-ack cell drops straight into this manifest's capability-matrix.)

## Scope (the #1 shim-audit structural gap; part-1 only)
Move the per-harness STANDARD config from hardcoded TS → a **schema-validated, versioned JSON manifest** + a **3-valued capability-matrix** (yes/partial/no + REASON + per-capability unevenness). Per-agent INSTANCE values stay in ENV. Part-2 (kernel-loaded hooks) is SEPARATE per the delta-map → P1b stays tight.

## What was built
1. **The DURABLE versioned schema** (lily's steer): `packages/network-adapter/src/kernel/harness-manifest.ts` — a versioned `HarnessManifest` interface + `parseHarnessManifest` (HAND-ROLLED, fail-closed; no zod — it is a dev-dep only + matches the kernel's parseLabels idiom) + `loadHarnessManifest` + `serverCapabilitiesFromManifest`. claude is the FIRST conformant instance; opencode/Phase-2 slots in as a SECOND manifest against this SAME schema.
2. **The claude manifest:** `adapters/claude-plugin/agent-adapter.manifest.json` — proxyName/transport/serverName/toolPrefix/injectionChannel + the 3-valued capabilityMatrix (consumption-ack=partial [the P1d cell], tools-list-changed=no [bug-203 host], coalescer=no) + authOrder + envTemplate (var NAMES only). Shipped via package.json `files[]`.
3. **Shim wiring:** `adapters/claude-plugin/src/shim.ts` loads + validates the manifest at boot (fail-closed) and uses it — the 5 hardcoded literals (handshake.proxyName/transport, dispatcher.serverName/serverCapabilities, the 2 toolPrefix sites) now read from `MANIFEST`. Exported from kernel `index.ts`.
4. **Secret-contract made STRUCTURAL** (steve's F1 flag): `envTemplate` carries only var NAMES — the manifest *cannot* hold a raw secret; per-agent values stay in ENV.

## Tests (the discipline that matters in a config-extraction refactor)
- **Non-vacuous validation** (`packages/network-adapter/test/unit/harness-manifest.test.ts`, 7/7): each bad/missing field throws (wrong version, empty/missing required strings, invalid 3-valued value, missing reason, non-array auth/env). Closes test-theater on the validation end.
- **PARITY** (`adapters/claude-plugin/test/manifest-parity.test.ts`, 8/8): the claude manifest values == the prior hardcoded literals (proxyName/transport/serverName/toolPrefix + serverCapabilities deep-equal) → the extraction is **behavior-preserving**. Plus the 3-valued cells + the secret-contract (envTemplate = UPPER_SNAKE names only). Closes test-theater on the behavior end.
- Full suites: network-adapter 254/254, claude-plugin 188/188 — no regression. Build + shim typecheck clean.

## Log
- **23:46Z** — claimed + started P1b (resumed from the pre-P1c-redirect scoping). lily green-lit (no re-surface needed); steer: schema-is-the-durable-versioned-artifact (folded). manifestVersion-in-manifest = the schemaVersion-conformance check (already present).
- **23:47–23:55Z** — schema + claude manifest + shim wiring + index export + files[] + the two tests. 7/7 + 8/8 + full suites green.
- **next** — PR + complete_work ev_manifest.

## Forward
- The capability-matrix cell is the seam that feeds future per-harness behavioral branching (kept descriptive in P1b). Opencode = the second conformant manifest (Phase-2). After P1b the critical path is **P1e** (all-four integrate → pilot_accept), carrying: (a) real docker-L2 e2e, (b) enable the watchdog, (c) the §9 dep-prune.
