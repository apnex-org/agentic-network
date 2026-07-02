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
- **22:12Z** — gate surfaced to lily (redteam #13); she endorsed (GREEN, no reframe) + held me to two lines: (1) residual — "reproducibility SUPPORTED" must not drift into "wedge closed" (P1c chaos + L1.5 watchdog are the real closure; cal #81); (2) determinism boundary explicit, never fake a byte-identical green (tele-4).
- **22:18Z** — Director/lily redirect: build on **Google Cloud Build** (buildkit 0.11+ -> normalizes the image-config `created` field that local buildx-0.5.1 can't -> FULL image-digest reproducibility, not just content-digest). lily folding "build-env = Cloud Build" into Design §8. Cloud Build access CONFIRMED (SA terraform@labops-389703; Artifact Registry cloud-run-source-deploy). Plus a secret-leak risk-catch: "image is cred-free" is now a pillar-2 acceptance line (scion-avoid[10]).
- **22:20–22:45Z** — authored `deploy/adapter-image/`: Dockerfile (source-bake @ SHA, npm ci, digest-pinned base, SOURCE_DATE_EPOCH-pinned build-info via _p1a-stamp.cjs), cloudbuild.yaml (pinned buildx 0.18 + docker-container + `rewrite-timestamp=true` + `--provenance/--sbom=false`), dockerignore.template (secret-safe), p1a-build.sh + repro-build-test.sh (digest-equality + controls-off non-vacuity).
  - Build env facts: docker 20.10.3/buildx 0.5.1 locally (too old for rewrite-timestamp; node even core-dumps running images locally) -> Cloud Build is authoritative. Adapter is pure-JS (no node-gyp). 
  - FIX (build #5eabf9e6 failed): packages/repo-event-bridge + storage-provider declare `prepare:"npm run build"`, which npm ci runs in package-not-dependency order -> TS2307. Stripped the prepare cascade in the Dockerfile (deterministic build-time control; neither is in the adapter dep-closure).
  - **Build A (controls on) SUCCESS** — digest `sha256:6b8e0520899dbe3ffaa58c3df86c0ed1006f997d3711ae25f4e42375c28b6159`. B (controls on) + C (controls-off mutation) in flight (async, polling).
  - Cred-free CONTEXT check clean: git-archive = tracked-only (no .git, count 0); 3 pattern-hits are all non-secrets (secret-scan.yml / secret-manager.tf / hub.env.example) and reach only the builder stage, not the runtime image.
- **22:47Z** — **ev_repro_digest PASS.** Three Cloud Builds from the same clean on-main SHA b057685: A & B (controls on) both `sha256:6b8e0520899dbe3ffaa58c3df86c0ed1006f997d3711ae25f4e42375c28b6159` → **A==B, FULL image-digest reproducible** (buildkit rewrite-timestamp normalized the config `created` + layer mtimes; --provenance/--sbom=false dropped attestation nondeterminism). C (controls-off mutation) `sha256:02db60eb7072d674a79f0658a8c057a73a0751ed5e42a72ce3192453c4adb3b0` → **A!=C, NON-VACUOUS** (the SOURCE_DATE_EPOCH/buildTime control is load-bearing). Determinism boundary: FULL image-digest, no residual.
- **22:51Z** — cred-free image-layer scan (Cloud Build). First pass false-positived on library *source filenames* (`google-auth-library/credentials.js`, `jose/generate_secret.js`) + base-image `npm/.npmrc`, all under node_modules — NO real secrets. Tightened the scan to match only true secret-bearing files outside node_modules; re-ran. **Real finding (not a blocker):** the runtime stage copies the WHOLE monorepo node_modules (google-auth-library/jose/@google-cloud/* — other workspaces' deps) → image BLOAT → **P1e should prune** to the adapter's dep closure. Reproducible + cred-free regardless.
- **next** — confirm cred-scan PASS; open the P1a PR (lily cross-approves); complete_work binding ev_wedge_diagnosed + ev_repro_digest.

## Key facts / constraints
- No agent-runtime Dockerfile/compose exists yet → P1a image is GREENFIELD (P1e containerises it on compose).
- Build env: docker 20.10.3 (daemon UP), node v24.12.0, npm 11.6.2.
- Reproducibility recipe (Design §8): source-bake @ git SHA (workspace `@apnex/*:"*"` resolves in-tree, no caret) + `npm ci` external deps + digest-pinned bases + `SOURCE_DATE_EPOCH` + layer-mtime/file-ordering normalization + reproducible node-gyp. Record immutable `:sha`, never `:latest`.
- `dirty` provenance = `git status --porcelain !== ""` at build time (`scripts/build/write-build-info.js`, idea-256). Repro build must be from a CLEAN committed on-main SHA so `dirty=false`.
