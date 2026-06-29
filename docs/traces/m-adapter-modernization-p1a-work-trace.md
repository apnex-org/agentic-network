# Work-Trace — Adapter-Modernization Pilot P1a (reproducible + provenance-guaranteed image)

**Task:** `work-bp-m_adapter_modernization_pilot_20260629-p1a_repro_image` (engineer: greg / `agent-0d2c690e`)
**Provenance pin:** **idea-398** → ratified **Design v1.0** (`66a8f721:docs/designs/m-adapter-modernization-design.md`) — Director-direct priority, first run of the Design-Process methodology. **NOT GATE-2/candidate_A** (the SR ratified stint-6 = idea-388 separately; corrected by architect 2026-06-29).
**Blueprint runId:** `m_adapter_modernization_pilot_20260629` (lily seeded 2026-06-29 22:00Z). P1a is the load-bearing FIRST milestone; DAG gates P1c/P1d on P1a, P1e on all four.
**Branch:** `agent-greg/adapter-p1a-repro-image` (off `origin/main` @ b057685).

## Deliverables (both falsifiable, per Design §8/§9)
1. **ev_wedge_diagnosed** (doc) — diagnose-first provenance GATE. ✅ authored: `docs/traces/m-adapter-modernization-p1a-wedge-provenance-gate.md`.
2. **ev_repro_digest** (test-run) — same git SHA → same image digest equality TEST.

## Log
- **22:04Z** — claimed P1a; started; cut branch off `origin/main`.
- **22:05–22:11Z** — DIAGNOSE-FIRST forensics. Read Design v1.0 + brainstorm DRAFT + shim-audit. Pinned the wedge = this session's claude-plugin Hub-session-drop incident.
  - Source forensics: L1 reconnect machinery PRESENT in `packages/network-adapter/src` (transport.ts/agent-client.ts/poll-backstop.ts/tool-surface-reconciler.ts) → wedge ≠ missing-code.
  - Live `get_agents`: claude harness (greg+lily) = `sdkDirty:true` + `proxyDirty:true` @ 567ccd6 (OFF-main, 3 behind, dirty); opencode (steve) = clean @ on-main 7295220. → claude-harness-specific provenance impurity = the wedge-prone harness.
  - Discarded the McpConnectionManager src↔dist divergence hypothesis (head-truncation artifact; symbol is a stale-comment hygiene smell present in both, no code def). Recorded in the gate doc E5 for honesty.
  - **Gate verdict:** provenance CONFIRMED IMPURE → wedge-time code not byte-identifiable → reproducibility eliminates that root condition (primary fix SUPPORTED, not over-claimed); keepalives-dead edge NOT ruled out → P1c chaos + §4 L1.5 watchdog carry residual; no prod-wedge-repro blocker (mustFix #3). **P1a build GREEN.**
- **next** — surface the gate verdict to lily (redteam #13: before leaning repro on it); author the reproducible Dockerfile + digest-equality test.

## Key facts / constraints
- No agent-runtime Dockerfile/compose exists yet → P1a image is GREENFIELD (P1e containerises it on compose).
- Build env: docker 20.10.3 (daemon UP), node v24.12.0, npm 11.6.2.
- Reproducibility recipe (Design §8): source-bake @ git SHA (workspace `@apnex/*:"*"` resolves in-tree, no caret) + `npm ci` external deps + digest-pinned bases + `SOURCE_DATE_EPOCH` + layer-mtime/file-ordering normalization + reproducible node-gyp. Record immutable `:sha`, never `:latest`.
- `dirty` provenance = `git status --porcelain !== ""` at build time (`scripts/build/write-build-info.js`, idea-256). Repro build must be from a CLEAN committed on-main SHA so `dirty=false`.
