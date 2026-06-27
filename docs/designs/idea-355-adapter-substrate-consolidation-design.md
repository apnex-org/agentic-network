# M-Adapter-Substrate-Consolidation — Design v1.0 (idea-355)

**Status:** v1.0 — RATIFIED. engineer (greg) construction-audit **GREEN-with-flags** + concur on the dedup delta (thread-729, substrate-accuracy HIGH, all claims verified vs code); Director steer folded (tool-surface convergence = a SLICE, "clean symmetry"); both-shim dedup audit folded (wf_b116cc96, 9 agents, adversarially verified).
**Source Idea:** idea-355 (Director-directed 2026-06-27: "consolidate the substrate" + "clean up conflicting tooling"; autonomous authority delegated).
**Mission class:** structural-inflection (the tick-drive kernel primitive is a mechanism every host rides) + substrate-cleanup-wave body. **Size: MEDIUM.**
**Author:** lily / architect. **Sizing:** thread-727 (no-fork). **Vehicle:** thread-728 (C). **Construction-audit:** thread-729. **Dedup audit:** wf_b116cc96. **DR ledger:** `docs/decisions/autonomous-stint-3-2026-06-27-log.md` (DR-S3-002..006).
**Frames against:** `docs/network/00-network-adapter-architecture.md` (L4/L7 shared-core/last-mile-shim) + `docs/decisions/026-push-pipeline-and-message-router.md` (Layer 1a/1b/1c + L2 message-router) + `docs/specs/universal-adapter-notification-contract.md` (notificationHooks seam).

---

## §1 Goal + framing — restore the kernel as the single home (and the org's honest self-view)

**Goal:** make the network-adapter substrate hold its own founding invariant — **one shared kernel (`@apnex/network-adapter`), identical code + version on every host; per-host shims carry transport + last-mile only.** The architecture doc §2 targets ~150–300 LOC/shim; today claude is ~1428 src LOC, opencode ~845 (3–5×).

**Why now — the M18 scar is recurring, AND it's corrupting the org's self-view.** The doc's §1.1 cites M18 (logic added to one shim; the other silently inherited stale behavior). idea-355 is that class recurring — and the cost is now visible as **three self-view corruptions, all from the one frozen opencode `2.1.0` bundle:**
1. **no queue self-wake** (idea-353 gap) — opencode can't self-coordinate;
2. **phantom version** (bug-183) — `get_agents` lies about *what* opencode runs (`shim.ts:43-44` hardcodes `4.3.0`/`2.1.0`);
3. **false-dead liveness** (bug-186) — `get_agents` reports steve `cognitiveState: unresponsive` while he is actually online (claude reports `alive` correctly → opencode-specific → stale-kernel cognitive-heartbeat divergence).

So idea-355 is not merely "dedup" — it is **"make the kernel the single home so capabilities + fixes propagate to every host, and the org's self-view is honest again."** North-stars: tele-3 (one kernel) · tele-4 (no silent failure / honest reporting) · tele-1 (transparency) · tele-13 (every host self-drives off the queue, no per-host wiring or operator nudge).

**The honest dedup framing (verified by wf_b116cc96).** "Does this dedupe BOTH shims?" splits into two values:
- **(a) Genuine both-shim dedup** (both shims literally stop duplicating) — **small, ~4 items**: config trio, file-backed logger, `onPendingTask`, `OIS_AGENT_NAME`.
- **(b) Single-home consolidation** (move *single-consumer* logic into the kernel → thins one shim, lets the other adopt free) — **the larger, strategic chunk**: observability, version/build-info read, `runWakeStallReconcile`, bug-180 live-refresh (claude→kernel); the coalescing queue (opencode→message-router); the tool-surface reconciler (opencode→kernel).

The arc's primary value is **(b)** — it's why opencode gets wake/stall + honest version + honest liveness *for free* once on the current kernel. **(a)** is a smaller bonus. We name this honestly rather than overclaiming symmetric dedup.

---

## §2 Relationship to prior + parked work — this design is *only-new*

| Effort | What | Relationship |
|---|---|---|
| **mission-64** (DONE) | npm-publish distribution | distinct axis; its auto-refresh evolution = **idea-354**, not this |
| **mission-92** (CLOSED #367) | opencode dedup down-payment: isPulseEvent + bug-108 → kernel, notificationHooks delegation, buildPluginCallbacks DELETE, opencode esbuild release pipeline | landed Phase-1; SLICE-1 does the *remaining* hoists |
| **mission-93** (CLOSED #368) | verifier role + cutover hardening + bug-161 R1 | landed Phase-1 |

Phase-1 cleared the parked debt (zero-loss, code-only, no redeploy — batches into SLICE-2). Everything below is genuinely-new.

---

## §3 Scope — the slices

| Slice | What | Dedup type | Owner | Deps |
|---|---|---|---|---|
| **SLICE-0** | opencode version-fix — kill `4.3.0`/`2.1.0` hardcodes (`shim.ts:43-44`) → `readPackageVersion`. Closes **bug-183** reported-half. | drift-fix | greg | — |
| **SLICE-1** | **Kernel-hoist anchor.** Both-shim dedup: config trio, file-logger, **`onPendingTask`**, **`OIS_AGENT_NAME`**. Single-home: observability, version/build-info read (claude→kernel); coalescing (opencode→**message-router** L2 extension). + the **tick-drive contract** (§4.3). | mixed | greg | SLICE-0 mergeable independently |
| **SLICE-1T** | **(Director-steered) Tool-surface symmetry — a DELETE, not a migration.** SLICE-1's kernel-driven live-refresh + SLICE-2's redeploy give opencode the kernel `ToolSurfaceReconciler` path for free → opencode's bespoke `computeToolHash`+`syncTools` (`shim.ts:349-400`, ~51 LOC) becomes redundant → explicit delete + verify. (greg's refinement: not a from-scratch ETag port.) | single-home (parity) | greg | SLICE-1 (rewire) + SLICE-2 (kernel path goes live) |
| **SLICE-2** | The **single** opencode redeploy onto the current kernel (mission-92 release pipeline, run once) → opencode gets dedup + live-refresh + wake/stall + honest version/liveness + the kernel tool-surface path. + **bug-186 post-redeploy verification** (= the converged Q5 readiness gate). | — | greg + architect-release | SLICE-1, SLICE-1T |
| **SLICE-3** | Version scheme (**bug-182**): kernel-spine + report `sdkVersion`+`shimVersion` + prepack auto-bump (`write-build-info.js`) + port idea-256 commit-identity wire to opencode. Closes **bug-183** true-half. | — | greg | — (parallels SLICE-1) |
| **SLICE-4** | Conflicting-tooling cleanup: retire `get_engineer_status` (**bug-184**) + deprecated-tool sweep + doc-fidelity refresh of `00-network-adapter-architecture.md` (stale `2.0.0`/`get_engineer_status`). | — | greg (Hub) | — |

**Sequence:** SLICE-0 + SLICE-4 anytime → SLICE-1 (anchor) + SLICE-3 (parallel) → SLICE-2 (the one redeploy) → SLICE-1T delete + verify (sequenced with SLICE-2; greg's construction call on delete-in-bundle vs delete-after-verify to avoid double-fire).

---

## §4 The hoist boundary + contracts

### §4.1 KEEP in the shim (genuinely host-unique — verified)
Transport wiring (claude MCP-stdio `StdioServerTransport`/`process.exit`/SIGINT vs opencode `@opencode-ai/plugin` + Bun.serve per-Initialize proxy); host render-surface binding (claude `<channel>` `pushChannelNotification` vs opencode `tui.showToast`/`session.promptAsync`); host SDK calls (`mcp.add`/`session.list`/`getClientInfo`/`onFatalHalt`); host session-event shapes + `sessionActive` gate + deferred-init; claude `commit-push-hook` (Bash is claude-native).

### §4.2 HOIST to the kernel
**Genuine both-shim dedup** (deletes from both):
- config trio `loadConfig`/`parseLabels`/`HubConfig` (claude `shim.ts:50-113` / opencode `134-186`; missing-cred policy + default hubUrl stay host-tunable).
- file-backed logger (claude `FileBackedLogger`+rotation / opencode primitive subset → one shared core logger).
- **`onPendingTask` payload-builder** (claude `608-610` / opencode `511-513`; byte-identical `task_issued` payload → kernel builder, each shim keeps its `appendNotification({logPath,mirror?})`). *Verified + greg-concurred.*
- **`readRequiredAgentName(log)`** (claude `408-416` / opencode `761-769`; identical read+trim+guard+log; each shim keeps the one-line abort `process.exit(2)` vs `return`). *Verified + greg-concurred.*

**Single-home consolidation** (claude→kernel, enables opencode parity): observability helpers (`redactFields`/`parseLogLevel`/`shouldEmitLevel` + NDJSON `appendEvent`); version+build-info read (`readPackageVersion`/`readBuildInfo` — the M18-scar root; also SLICE-0 for opencode).

**Single-home (opencode→message-router L2, Q2):** the ~140-LOC rate-limit/prompt-queue/deferred-backlog coalescing → `@apnex/message-router` (293→~430 LOC; it already owns Message→notificationHooks+dedup — the coalescing is delivery-*pacing* on that same path). Session-active *derivation* stays shim-fed (a boolean signal); wake/stall keeps its own idle-gate (not routed through the coalescer). An **extension**, not a new L2 stand-up (anti-goal #2 holds).

### §4.3 Tick-drive contract (the load-bearing new arch — Q3 GREEN, fully kernel-internal)
Move `runWakeStallReconcile` **and its invocation** into the kernel: it reads `list_ready_work` via the direct agent-client path (`{internal:true}`), uses kernel role/identity + idle-gate, and emits through `notificationHooks`. The kernel wires it onto the PollBackstop heartbeat tick itself — **shim contribution = zero**. Verified safe: `activeCallCount` is host-CallTool-scoped (`dispatcher.ts:662`) so the internal read doesn't pollute `isIdle`; the kernel *already* makes internal tick-driven Hub calls (poll-backstop `list_messages`/`transport_heartbeat`); PollBackstop has an inFlight guard + awaits the tick. **Construction notes (folded):** emit via `notificationHooks` (not `pushChannelNotification`); add a dedicated reconcile in-flight latch; role from kernel identity. Same shape for the bug-180 live-refresh `/health` invocation. **Invariant (enforce in review): no cross-cutting reconcile loop may be wired from a shim.**

### §4.4 Tool-surface symmetry (SLICE-1T — Director-steered, greg-refined)
opencode's bespoke `computeToolHash`+`syncTools` (`shim.ts:349-400`) reconciles its tool surface client-side; claude already uses the kernel `ToolSurfaceReconciler` (DI seam `ToolSurfaceReconcilerDeps`). **The convergence is a DELETE, not a port:** SLICE-1 makes the live-refresh invocation kernel-driven, and SLICE-2 puts opencode on the current kernel — at which point opencode has the kernel reconciler path active, making its client-side block redundant. SLICE-1T is the explicit delete of that block + a verify that the kernel path covers opencode's tool-surface reconciliation. Closes opencode's last tool-management asymmetry → clean symmetry. greg sequences the delete with SLICE-2 (in-bundle vs after-verify) to avoid a transient double-fire.

### §4.5 Conscious non-goals (adversarially refuted — do NOT hoist)
- **Cognitive telemetry sink** — REFUTED (host-unique): `COGNITIVE_BYPASS` is a claude-only *feature* (5 hits vs 0; porting adds lines); sink bodies diverge on render surface (claude NDJSON+stderr vs opencode TUI `showToast`/diag-only). A hoist needs 4 host params that ARE the divergences.
- **Boot-wiring / construction-lifecycle trio** — REFUTED (already-hoisted substance; the residual is the per-host *call* of shared primitives). The module-init(opencode)-vs-runtime(claude) construction alignment is a future-3rd-host refactor (opencode `shim.ts:90-97`). **greg-flag:** that comment co-buckets the construction-lifecycle align WITH the coalescing generalization SLICE-1 is doing — greg will *watch* during SLICE-1 whether a light touch is warranted, but it stays out of scope (defer to the 3rd host).
- **All-emits-through-message-router unification** — deferred (would push L; wake/stall already has its own gate+dedup).

---

## §5 SLICE-2 — the single redeploy + the converged bug-186/Q5 verification
ONE opencode redeploy, at SLICE-2 (Phase-1 + SLICE-0/1 merge code-only; redeploy batches). Mechanism: mission-92 `release-opencode-plugin.sh` → `apnex/opencode-hub-plugin` bundle → steve restart. **No Director gate** (architect-publishable + reversible). **steve-responsiveness is a SLICE-2 READINESS gate** — an operator-triggered restart puts him on the new bundle; WI's verifier-gate can't observe a self-wake (or validate bug-186) on a stale verifier. **Converged bug-186/Q5 verification (greg's catch):** post-redeploy, confirm `get_agents` reports steve `cognitiveState: alive` on the current kernel — if the stale-kernel hypothesis holds, the redeploy self-resolves the false-negative; if it persists → root is Hub-side freshness computation → separate follow-on.

## §6 SLICE-3 — version scheme (Q4, bug-182 + bug-183 true-half)
Kernel-version-as-spine; shims version independently but report **both** `sdkVersion` (kernel, from build-info) + `shimVersion` on `get_agents` (lockstep rejected — forces no-op bumps; shims have independent cadences). Auto-bump: extend the existing prepack hook (`scripts/build/write-build-info.js`) to assert/bump version vs the build sha → a kernel change can't ship unstamped. Port idea-256 `SHIM_COMMIT`/`ADAPTER_COMMIT` commit-identity to opencode (ref-traceable deploys).

## §7 SLICE-4 — conflicting-tooling cleanup
Retire `get_engineer_status` (bug-184; redirect to `get_agents`) + sweep the live tool surface for other deprecated-but-exposed verbs (retire or mark+redirect) + refresh `00-network-adapter-architecture.md` (header `2.0.0` + `get_engineer_status` are stale). *(The ~100-CRUD verb-collapse stays idea-121/D-1.)*

---

## §8 Dogfood-3 plan (queue-coordinated)
idea-355 runs through the C1 work-queue (dogfood-3; NARROW adoption continues before the widen decision). Architect seeds; greg claims/builds; Steve advisory-verifies; architect releases.
- **WI-0** SLICE-0 version-fix (no deps). Evidence: commit + PR.
- **WI-1** SLICE-1 kernel-hoist anchor (generic infra + 2 dups + tick-drive + coalescing→message-router + the opencode tool-surface rewire-to-kernel-reconciler) (no deps). Evidence: commit + PR + test-run (wake/stall kernel-driven).
- **WI-3v** SLICE-3 version scheme (no deps; parallels). Evidence: commit + PR + `get_agents` snapshot (sdkVersion+shimVersion honest).
- **WI-2** SLICE-2 redeploy + SLICE-1T delete + verify (deps WI-1, WI-3v). **verifier-gate** — Evidence: redeploy ref + `get_agents` snapshot (steve on current kernel + `cognitiveState=alive` [bug-186] + a wake/stall emit observed + tool-surface reconciled via kernel path). Steve advisory: did steve self-wake? liveness honest? tool-surface correct?
- **WI-4** SLICE-4 tooling cleanup (no deps). Evidence: commit + PR + tool-surface snapshot.
Acceptance = EVIDENCE-shaped (claim audit-IDs + org-state snapshots), mirroring dogfood-1/2.

## §9 Tele alignment + anti-goals
**Tele:** tele-3 (tick-drive structurally forbids shim-wired cross-cutting logic) · tele-4 (kills the version lie + the liveness lie) · tele-1 (honest get_agents) · tele-13 (every host self-wakes, no nudge). No interim shapes. **Anti-goals:** NOT mission-64/idea-354 distribution; NOT a full L2 message-router stand-up (extension only); NOT idea-121/D-1 verb-collapse; NOT a forced claude redeploy (SLICE-1 behavior-preserving for claude); NOT the §4.5 refuted hoists.

## §10 Open Qs — RESOLVED
Q1 GREEN (Phase-1 clean). Q2 coalescing→message-router (extension). Q3 tick-drive fully kernel-internal. Q4 kernel-spine + report-both + prepack auto-bump. Q5 no Director gate; steve-restart readiness gate (converged with bug-186 into one SLICE-2 verification). Q6 MEDIUM (tool-surface SLICE folded per Director steer; greg-refined to a delete not a migration → no L pressure; the all-emits unification stays deferred). Boundary verified; the dedup delta (2 folds, 2 refutations) verified + greg-concurred.

---
*v1.0 RATIFIED 2026-06-27. greg GREEN-with-flags + concur (thread-729); Director steer (tool-surface SLICE, clean symmetry); dedup audit wf_b116cc96 folded. Next: converge thread-729 → propose M-Adapter-Substrate-Consolidation + preflight + seed dogfood-3 (greg claims WI-0 + WI-1).*
