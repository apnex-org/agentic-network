# M-Adapter-Modernization — Design v1.0

**Status:** Design v1.0 (reconciled 2026-06-29, architect lily; conformance-addendum `wrv6hgwzc` **FOLDED** — conformant-with-flags, 0 violate, 11 flags dispositioned §10b). **First canonical execution of the ratified Design-Process** (`design-process.md` v1.0). Pending: `verify_reconcile` (**cross-lineage steve re-run recommended**, §11) → Director **ratify**.
**Provenance (design-process nodes):** `design_draft` = `m-adapter-modernization-brainstorm.DRAFT.md` (the converged decision-log) · `feasibility_audit` = `m-adapter-modernization-shim-audit.md` · `design_redteam` = adversarial review `w6e5e0dqp` (15/32 confirmed; this doc folds them). This doc = the `reconcile` artifact.
**Supersedes:** the brainstorm DRAFT (now the decision-provenance log; full per-decision rationale lives there).

---

## 1. North-star + core invariant
**Three pillars (all, not a trade-off):** (1) **pure resilience** — self-healing, no silent wedge, survives Hub blips/redeploys by construction; (2) **clean reproducible distribution** — versioned/pinned/byte-reproducible, provenance-honest, no `sdkDirty`; (3) **maximal shared core regardless of harness** — one kernel; per-harness pieces are thin. *(Architectural intent; structurally PROVEN only at the opencode Phase-2 cutover — the claude pilot is single-harness, so the headline claim is deferred for its own validation.)*
**Core invariant:** *uniform transport from the adapter toward the network; per-harness variation confined to the last hop.* Everything kernel→Hub (resilient channel, push protocol, ack/retry/ordering, typed coordination entities) is identical for every harness; a harness only changes how an already-delivered message makes its final native landing.

## 2. Architecture (process topology — MUST-FIX #2 RESOLVED: EMBEDDED)
- **Fat shared kernel + thin per-harness package.** Kernel = `@apnex/network-adapter` (+ `message-router` + `cognitive-layer`). Per-harness package (the evolved `@apnex/<x>-plugin`) = a **schema-validated JSON manifest** + optional kernel-loaded hooks + a *conditional* literal native injection-plugin. One package per harness; no new sibling.
- **EMBEDDED process topology** (resolves the v0.x boot-model contradiction; the review proved the CLI *spawns/loads* the kernel, so kernel-as-PID-1-before-CLI was impossible): the **PID-1 entrypoint is a THIN supervisor** (env-inject + register → start tmux → launch the CLI → own restarts). The CLI then spawns (claude: stdio MCP server) / loads (opencode: plugin) the kernel-shim; the Hub connection comes up **inside that child**, not before the CLI. Injection is **in-process** (no IPC seam). L1 connection-resilience is bound to the CLI lifecycle; cross-restart durability rides durable Hub state + cold-pickup + PollBackstop. (SPLIT rejected — no requirement forces a connection that survives a CLI restart; the L1/L2 nesting is topology-independent.)
- **Last-hop injection (per-harness, capability-matrix `injection-mechanism`):** claude = MCP server-notification `notifications/claude/channel` (no literal plugin needed); opencode = literal `@opencode-ai/plugin` via SDK `session.promptAsync`. Kernel owns delivery + ack/retry/ordering; the last hop is the thin native landing.

## 3. Config standardisation
**Schema-validated JSON manifest (harness STANDARD) + ENV (per-agent INSTANCE)** — mirrors scion's YAML+env split, JSON because the kernel is JS and the manifest co-locates with the typed hooks. Manifest fields: command/env-template/**capability-matrix (3-valued yes/partial/no + REASON + per-capability unevenness** — the scion-steelman discipline)/auth-order/injection-flags/dialect. Per-agent ENV contract: identity (name/role) + Hub URL + `OIS_HUB_TOKEN` + git creds + worktree/branch + model/quota + `CLAUDE_CODE_OAUTH_TOKEN`. References-as-data, not topology.

## 4. Resilience — the 4-actor model (MUST-FIX #1 RESOLVED)
The v0.x 3-layer model had a hole the review caught: the **live-but-wedged container has no restart-actor** (forever-backoff → L1 never exhausts → process never exits → docker L2 restart-on-exit never fires; the *keepalives-flowing-but-session-dead* edge slips both L1 [kernel believes connected] and L2 [process alive]; L3 reclaims only the WORK, not the container). FIX = a 4th actor:
- **L1 — kernel reconnect** *(exists)*: forever-backoff on a **DETECTED** drop (correct — reconnect when the Hub returns; L3 covers the work meanwhile).
- **L1.5 — liveness self-watchdog *(NEW — closes the hole)*:** an **application-level session-validity probe independent of transport keepalive** (e.g. the injection consumption-ACK round-trip, or a periodic Hub round-trip). On failure to confirm a live Hub session within a bounded budget → the kernel **deliberately self-exits PID-1** → re-handshake fresh on restart. This converts the *undetected* live-wedge into a process-exit that L2 can act on.
- **L2 — platform restart** *(docker restart-policy / watchtower)*: restarts a dead/exited container.
- **L3 — Hub lease-expiry reclaim** *(exists)*: reclaims the WORK to `ready` — the progress backstop.
**Cognitive-rehydration claim DEMOTED:** "byte-stable" is scoped to the MECHANICAL re-claim only; cognitive re-hydration is *assumed-robust at clean cognitive-node boundaries, UNVALIDATED for involuntary restart mid-long-cognitive-node* → a Phase-1 chaos-test (restart-mid-long-node) + the inherited mitigations (checkpoint/cognitive-node-boundary granularity, lease-renewal-during-long-nodes, L3 no-loss backstop).

## 5. Credentials
**`claude setup-token` → a one-year `CLAUDE_CODE_OAUTH_TOKEN`**, injected as a **mounted secret (file-mount — NOT env; closes the `/proc` exposure window, consistent with the Tier-0 token — scion avoid[10] fold)** — the *documented* headless path. **Construct-once-on-host; runtime-injected; NEVER baked** (cred-free image).
- **⚠ CORRECTION (conformance fold):** the one-year token does **NOT self-refresh** — it is long-lived and **expires after ~1 year** (the earlier "harness self-refreshes" line was WRONG; *self-refresh* describes the `.credentials.json` OAuth path we did NOT take).
- **→ Annual auth-expiry is a 5th resilience concern, NOT covered by the §4 4-actor model:** a synchronized expiry keeps transport UP (so L1/L1.5 never fire), then re-handshake on the expired token would **crash-loop**, not self-heal. **REQUIRED: an auth-expiry monitor + rotation runbook** (alert ahead of expiry → re-mint via `setup-token` → re-inject the secret → rolling restart). `apiKeyHelper` (broker) is the multi-host path that *also* dissolves the annual cliff.
- Tier-0 **Hub token = mounted file** + kernel-owned refresh. opencode = its own `auth.json` (**DEFER — Phase-2**, §11). Distinct modes confirmed: subscription OAuth ≠ `ANTHROPIC_API_KEY` (console) ≠ `ANTHROPIC_AUTH_TOKEN` (gateway).

## 6. Runtime + update
**docker-compose FIRST; k8s later** (don't expose a half-built host-type — scion's CloudRunRuntime cautionary tale). L2 = docker restart-policy + watchtower-pull. **Safe-update contract (shouldAddress):** a quiesce/drain signal (SIGTERM → "finish turn / checkpoint, then accept restart", bounded grace) + staggered/rolling restart (not one `:latest` digest restarting all same-harness agents) + a boot-smoke health-gate before adoption + **rollback = re-point to the prior immutable `:sha`** (dual-tag: watch `:latest` as TRIGGER, record/deploy the immutable `:sha` as reference-of-record). **Manual-first is the pilot default** (no auto-watchtower dependency). L3 lease + CAS + role-eligibility already bound any competing-claimant case to wasted duplicate effort (no corruption).

## 7. Telemetry
NOT built; **deferred to idea-343**. scion's data-driven dialect → ONE OTEL `gen_ai.*` pipeline is the reference when built; recorded lean = SEPARATE channel (don't piggyback coordination on a lossy pipeline).

## 8. Reproducibility (MUST-FIX #3 + caret-vs-pin RESOLVED)
**Framing SOFTENED:** reproducibility removes the **most LIKELY** wedge cause — it is NOT asserted as THE fix. **Chaos-validation must independently confirm the `keepalives-flowing-but-session-dead` edge before the wedge is declared closed** (§9 P1c). The first L1 deliverable is a **diagnose-first / provenance-confirm GATE**: use the provenance work to confirm what code was actually deployed during the historical wedge (a GATE, not a byproduct).
**Reproducible bake:** bake from **monorepo source at a git SHA** (workspace `@apnex/*:"*"` resolves in-tree → the publish-path caret `^X.Y.Z` never enters the image path, closing the caret-vs-exact-pin gap) + `npm ci` for external deps + **digest-pin base images**. This guarantees **deterministic INPUTS** (dep-resolution + bases). **NUANCE (conformance fold): a byte-identical image DIGEST additionally requires `SOURCE_DATE_EPOCH` + layer-mtime/file-ordering normalization + reproducible native-module (node-gyp) builds** — named, not assumed. So P1a's "same SHA → same digest" is a **falsifiable digest-equality TEST to hold**, not a claim to assert. Deploy/record the immutable `:sha`/digest, never `:latest` as the reference-of-record. ("reproducible" is distinct from "no `sdkDirty`", which only means no uncommitted source.)

## 9. The pilot — sequenced reproducibility-FIRST; falsifiable acceptance (MUST-FIX #3 + scope shouldAddress)
- **P1a — reproducible + provenance-guaranteed image FIRST** (can't chaos-validate a build you can't guarantee-deploy). Acceptance: same git SHA → same image digest; every dep pinned; the diagnose-first gate confirms the historically-deployed code.
- **P1b — manifest extraction** (parallelizable refactor): hardcoded-TS shim config → JSON manifest + capability-matrix.
- **P1c — chaos-validate L1 + the L1.5 watchdog**: chaos matrix **including the named `keepalives-flowing-but-session-dead` edge** (kill the Hub session server-side while the SSE keepalive flows) **+ a restart-mid-long-cognitive-node case**; assert auto-recovery (probe-fail → PID-1 self-exit → L2 restart → re-handshake → re-claim) with **zero manual intervention**; one criterion tied to the lived incident.
- **P1d — injection consumption-ACK** (the riskiest net-new): a message injected during a Hub-channel drop is delivered **exactly-once + acked after reconnect** (no loss, no dup). **Disambiguate the two acks:** the Hub-leg ack/retry/ordering (kernel↔Hub, UNIFORM — what delivers "survive blips by construction") vs the last-hop consumption-ack (per-harness: opencode awaitable `promptAsync` = yes; claude one-way MCP notification = partial/best-effort + backstop chain [PollBackstop dedup-aware re-delivery + `ack_message` + L3]).
- **P1e — containerise on docker-compose** + L2 restart-supervision + **host-side worktree creation mounted-in (FORBID in-container worktree creation** — the `--relative-paths` path-identity hazard; isolation-by-absence; scion avoid[9] fold).
- **Acceptance = falsifiable TESTS, not outcomes:** + a **claude-headless-auth run-gate** (`CLAUDE_CODE_OAUTH_TOKEN`, no keychain/TUI prompt — the adopted ValidateAuth checks PRESENCE not FUNCTION) with the fallback ladder named; "version-honest" = a regression-guard (already built per bug-184).

## 10. Disposition ledger (the 15 confirmed `design_redteam` findings)
| # | Finding (sev) | Disposition |
|---|---|---|
| 3/7 | forever-backoff defeats L2 / no actor for live-wedge (major) | **ACCEPT** → §4 L1.5 liveness self-watchdog |
| 9 | kernel-topology ↔ boot-model contradiction (major) | **ACCEPT** → §2 EMBEDDED |
| 6 | cold-pickup N=2 / cognitive-rehydration over-claimed (major) | **ACCEPT** → §4 demotion + chaos-test |
| 13 | pilot built on unconfirmed wedge diagnosis (major) | **ACCEPT** → §8 diagnose-first gate + §9 P1c incident-tied chaos |
| 2 | wedge root-cause inference (minor) | **ACCEPT** → §8 softened framing |
| 1 | caret-vs-exact-pin (minor) | **ACCEPT** → §8 source-bake |
| 8 | consumption-ACK not uniform — claude one-way (minor) | **ACCEPT** → §9 P1d ack disambiguation |
| 4 | claude auth doc-confidence-not-test (minor) | **ACCEPT** → §9 headless-auth run-gate |
| 10 | watchtower unsynchronized (minor) | **ACCEPT** → §6 safe-update contract |
| 11 | no rollback / `:latest`-vs-`:sha` (minor) | **ACCEPT** → §6 rollback + record-`:sha` |
| 14 | 4-part pilot too big (minor) | **ACCEPT** → §9 reproducibility-first sequencing |
| 15 | acceptance criteria are outcomes not tests (minor) | **ACCEPT** → §9 falsifiable tests |
| 5 | opencode auth-parity (minor) | **DEFER** → Phase-2 check (§5/§11) |
| 12 | LLM-auth claude-shaped doesn't scale / shared-token cap (major) | **DEFER** → Phase-2 + multi-host (`apiKeyHelper`/per-account); §5/§11 |
*(No rejects — every must-fix accepted; the two defers are genuinely Phase-2/multi-host scope, recorded as tracked items, not silent drops.)*

## §10b Conformance disposition (addendum `wrv6hgwzc` — conformant-with-flags; 48 items, 37 pass / 11 flag / **0 violate**)
The verifier conformance-addendum (the §4 conformance pass the `design_redteam` skipped) found **zero principle/pathology violations**. The 11 flags dispositioned:
| Flag (frame) | Disposition |
|---|---|
| Pillar-1 annual auth-expiry cliff + wrong "self-refresh" line | **ACCEPT+folded** → §5 corrected + auth-expiry rotation runbook (5th resilience concern) |
| LLM token via env = `/proc` window (scion avoid[10]) | **ACCEPT+folded** → §5 mandate file-mount (drop the env option) |
| in-container worktree not forbidden (scion avoid[9]) | **ACCEPT+folded** → §9 P1e host-side + mount, forbid in-container |
| "byte-reproducible" over-claim (pillar-2) | **ACCEPT+folded** → §8 softened to deterministic-inputs + P1a digest-equality TEST + named controls |
| pillar-3 asserted-not-proven (pillar-3) | **ACCEPT+folded** → §1 scoped architectural-intent-pending-opencode |
| cross-lineage-cutover-without-runtime-gate (calibration — HIGHEST-VALUE) | **ACCEPT+folded** → §11 pre-commit the opencode R3 Cross-Lineage Runtime Acceptance Gate |
| deferred-divergence: opencode auth-parity defer (calibration) | **ACCEPT** → §11 pressure-test the defer cost before Phase-2 |
| tele-5 perceptual-parity (observability deferred) | **ACCEPT-tracked** (idea-343 + P1c rehydration assertion) — no design change |
| tele-6 / tele-12 / tele-13 orthogonal (3 flags) | **ACCEPT-neutral** — an adapter-infra design legitimately doesn't engage these |
**CAVEAT (load-bearing):** the addendum ran as an architect-LOCAL same-lineage (Anthropic) PROXY — it supplies the conformance CHECK but NOT the cross-lineage decorrelation the real verifier (steve) provides. **Shared-blind-spot risk is live → steve should re-run the matrix + `verify_reconcile` before the real ratify** (§11).

## 11. Open / deferred
- **Verifier conformance-addendum (PENDING — next step):** the `design_redteam` (w6e5e0dqp) ran only the 6 generic dimensions, NOT the design-process §4 **conformance matrix** (axioms/teles + calibration-ledger + the 3 pillars + scion prior-art). Per design-process §10 this is **re-engaged with the verifier** (a conformance-only addendum that *this reconcile then dispositions*), NOT architect-scored. Must complete before `verify_reconcile`.
- **opencode Phase-2** (the 2nd shim drop-in — proves maximal-shared-core; carries the auth-parity check + the shared-subscription concurrency cap) — **PRE-COMMIT the R3 Cross-Lineage Runtime Acceptance Gate** against the REAL opencode/Bun runtime (`docs/specs/cross-lineage-runtime-acceptance-gate.md`), NOT just structural metrics + auth-parity (cal *cross-lineage-cutover-without-runtime-acceptance-gate* — this design IS that pattern's mission-class). **Pressure-test the opencode auth-parity defer's cost before Phase-2** (cal *deferred-divergence-becomes-drift* — if cheap, fold earlier).
- **Glossary-staleness side-finding:** `docs/methodology/tele-glossary.md` is missing tele-13 (ratified 2026-06-20) — track a fix (pairs with idea-396).
- **Cross-lineage `verify_reconcile`:** the conformance-addendum ran as an architect-local same-lineage PROXY → **steve (cross-lineage) should re-run the conformance matrix + `verify_reconcile`** before the real ratify, to supply the decorrelation the proxy can't.
- **idea-388** (ratify mechanization / bug-205) · **idea-396** (tele→axiom; axiom-frame local) · **idea-397** (normalised reference syntax; conformance refs pinnable).
- **The design-process blueprint JSON** (option B) — so future designs + a clean adapter re-run execute as a seeded graph.

## 12. Forward path (through the ratified Design-Process)
`reconcile` ✓ → conformance-addendum ✓ (`wrv6hgwzc`, folded §10b) → **`verify_reconcile`** (proxy VALID — all flags dispositioned, 0 rejects; cross-lineage steve re-run recommended before the real ratify, §11) → **`ratify`** (Director) → Manifest → the claude-pilot mission work-graph (P1a→P1e).

---
*Design v1.0 — author: lily, 2026-06-29. First execution of design-process.md v1.0. Pending conformance-addendum + verify_reconcile + Director ratify.*
