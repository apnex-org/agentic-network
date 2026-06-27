# M-Adapter-Substrate-Consolidation — Design v0.1 (idea-355)

**Status:** v0.1 architect-draft — awaiting engineer (greg) construction-design audit.
**Source Idea:** idea-355 (Director-directed 2026-06-27: "consolidate the substrate" + "clean up conflicting tooling"; autonomous authority delegated to architect).
**Mission class:** structural-inflection (the tick-drive kernel primitive is a mechanism every future host rides) with a substrate-cleanup-wave body. **Size: MEDIUM.**
**Author:** lily / architect.
**Sizing thread:** thread-727 (no-fork verdict + 5-slice decomposition, converged). **Vehicle thread:** thread-728 (option C, converged). **DR ledger:** `docs/decisions/autonomous-stint-3-2026-06-27-log.md` (DR-S3-002/003/004).
**Frames against (ratified architecture-of-record):** `docs/network/00-network-adapter-architecture.md` (v1.2 — the L4/L7 shared-core/last-mile-shim split) + `docs/decisions/026-push-pipeline-and-message-router.md` (Layer 1a/1b/1c + the planned Layer-2 message-router) + `docs/specs/universal-adapter-notification-contract.md` (the Layer-1c→Layer-3 `notificationHooks` emission seam).

---

## §1 Goal + framing

**Goal:** make the network-adapter substrate hold its own founding invariant — **one shared kernel (`@apnex/network-adapter`), identical code + version on every host; per-host shims carry transport wiring only.** Today the shims are 766–881 LOC; the architecture doc's §2 sets the thin-shim target at **~150–300 LOC**. The excess is generic infra that drifted independently into both shims.

**Why now (the recurring scar):** the architecture doc's §1.1 cites the **M18 scar** — "M18 was added to `claude-engineer` only, not the shared package; OpenCode silently inherited pre-M18 behavior; two engineers, two identity schemes." idea-355 is that *exact class recurring*: the mission-66 #40 version-source-of-truth fix landed in the claude shim only; the opencode shim still hardcodes `PROXY_VERSION="4.3.0"` / `SDK_VERSION="@apnex/network-adapter@2.1.0"` (`adapters/opencode-plugin/src/shim.ts:43-44`) — a phantom that masked the drift. **The structural fix is the doc's own principle: logic lives in the kernel exactly once; the shim does only the last mile.** When that holds, the next kernel feature (idea-353 wake/stall was the trigger) reaches every host automatically.

**North-star teles:** tele-3 (Sovereign Composition — one kernel everywhere) primary; tele-4 (zero-loss / no silent failure — honest version reporting, no drifted-in-two-places logic) primary; tele-1 (sovereign-state-transparency — the true adapter version is observable) secondary; tele-13 (the org self-drives — every host self-wakes off the queue, no per-host wiring or operator nudge) secondary.

---

## §2 Relationship to prior + parked work (READ FIRST — this design is *only-new*)

This is **not** greenfield. Three adjacent efforts already exist; idea-355 is scoped to what none of them covered.

| Effort | What it is | Relationship to idea-355 |
|---|---|---|
| **mission-64** (M-Adapter-Streamline, DONE) | npm-publish **distribution** channel + `update-adapter.sh` consumer self-serve | DISTINCT axis (distribution, not code-boundary). The auto-refresh evolution is **idea-354**, not this. |
| **mission-92** (M-OpenCode-Shim-Sovereign-Dedup, parked) | opencode shim dedup: hoist isPulseEvent + bug-108 → core, notificationHooks delegation, DELETE buildPluginCallbacks, + the opencode esbuild **release pipeline** | **PHASE-1 prerequisite.** Lands first (thread-728 option C), code-only, normal PR flow → closes mission-92. Its hoists are the SLICE-1 *down-payment*; idea-355 does the *remaining* hoists. |
| **mission-93** (M-Verifier-Role, parked) | verifier role; Hub-side already merged (#335/#338/#343/#346); 2 adapter commits remain | **PHASE-1 prerequisite.** Land its 2 remaining adapter commits → close mission-93. |

**Phase-1 (clear parked debt, NOT part of idea-355's lifecycle):** greg rebases mission-92's dedup stack onto current main (~1 trivial `index.ts` barrel collision with #362/#363; no semantic overlap), build-verifies, PRs → architect cross-approves + merges → close 92; then lands 93's 2 adapter commits → close 93. **Code-only — no redeploy** (see §5). This is a fast zero-loss merge; idea-355 (Phase-2) is the design below.

---

## §3 Scope — the five slices (only-new, post Phase-1)

| Slice | What | Owner | Depends |
|---|---|---|---|
| **SLICE-0** | Port the mission-66 #40 version-fix to the opencode shim — delete the `4.3.0`/`2.1.0` hardcodes, read `package.json` via `readPackageVersion`. Closes **bug-183** reported-half. | greg | — (independent) |
| **SLICE-1** | **The structural anchor.** Hoist the *remaining* generic infra shim→kernel (the infra mission-92 didn't cover) **+ the tick-drive contract** (§4): `runWakeStallReconcile` + its invocation onto the kernel PollBackstop tick + bug-180 live-refresh kernel-drive. | greg (kernel) | SLICE-0 mergeable independently |
| **SLICE-2** | The **single** opencode redeploy onto the current kernel (run mission-92's release pipeline once) → steve gets dedup + live-refresh + wake/stall **for real**. | greg + architect-release | SLICE-1 |
| **SLICE-3** | Unify the version scheme + auto-bump across packages (**bug-182**) + port the idea-256 build-info commit-identity wire (`SHIM_COMMIT`/`ADAPTER_COMMIT`) to opencode. Closes **bug-183** true-surfacing half (advisoryTags shows the real kernel version + an explicit `shimVersion`). | greg | — (can parallel SLICE-1) |
| **SLICE-4** | Retire the deprecated `get_engineer_status` (**bug-184**; redirect callers to `get_agents`) + sweep the live tool surface for any other deprecated-but-exposed verbs (retire or mark+redirect). The Director's "conflicting tooling." | greg (Hub-domain) | — (independent) |

**Sequence:** SLICE-0 + SLICE-4 anytime (independent); SLICE-1 (anchor) → SLICE-2 (the one redeploy); SLICE-3 parallels SLICE-1, lands before/with SLICE-2 so the redeploy reports honest versions.

---

## §4 The hoist boundary + the tick-drive contract (the load-bearing design)

### §4.1 KEEP in the shim (genuinely host-unique — the last mile)
Per mission-92's ratified boundary + the architecture doc §3.2 (L4/L7 must-NOT table). The shim keeps **only**:
- **Transport wiring:** claude MCP-stdio (`StdioServerTransport`, `process.exit` lifecycle, SIGINT/SIGTERM) vs opencode `@opencode-ai/plugin` `Plugin` + Bun.serve per-Initialize MCP proxy + `WebStandardStreamableHTTPServerTransport`.
- **Host render-surface binding:** how *this* host surfaces a notification — claude `<channel>` `pushChannelNotification` vs opencode `tui.showToast` / `session.promptAsync`. Bound to the kernel's `notificationHooks` seam.
- **Host SDK calls:** `mcp.add`, `session.list`, `getClientInfo`, `onFatalHalt` (claude exits; opencode logs+toasts — can't kill the TUI), the host-specific session-event shapes + `sessionActive` gate, the deferred init.
- **Host-native tool hooks:** claude's `commit-push-hook.ts` (Bash is a Claude-native non-proxied tool — no opencode analog).

### §4.2 HOIST to the kernel (generic infra that drifted into both shims)
The dedup target (the infra mission-92 did **not** cover — it did isPulseEvent + bug-108 + notificationHooks + buildPluginCallbacks-delete):
- `loadConfig` / `parseLabels` / `HubConfig` (generic `.ois/adapter-config.json` + env loading — byte-near-identical in both shims).
- file-backed logger + rotation (both hand-roll one; the kernel has `ILogger` but no concrete file impl — add one).
- version + build-info read (`readPackageVersion` / `readBuildInfo` — the SLICE-0 fix, hoisted so it can't drift again; this is the M18-scar root).
- `observability.ts` pure helpers (`redactFields`/`parseLogLevel`/`shouldEmitLevel`).
- **The rate-limit / prompt-queue / deferred-backlog coalescing** (~140 LOC, opencode-only today; mission-92 *deferred* it as "2nd-host-triggered." The consolidation mandate now triggers it). **OPEN Q (§10): its natural home is Layer-2 `@apnex/message-router` (which exists at ~301 LOC) — hoist there, or into network-adapter Layer-1c, or defer if it would upsize. greg's construction call.**

### §4.3 The tick-drive contract — wake/stall + live-refresh become kernel-driven (the NEW architecture)
This is the piece that makes "the queue self-wakes **everyone**" true, and the reason redeploy-alone is insufficient.

**Today (the drift surface):** the idea-353 decision cores (`ClaimableDigestTracker`, `WorkLeaseTracker`) + the seams (`onHeartbeatTick`, `onToolCallResult`, the idle-gate) are kernel-resident — but the **orchestration `runWakeStallReconcile()`** (read `list_ready_work` on the tick → `reconcile` → emit W1/W2) lives in the **claude shim**, wired via `onHeartbeatTick: () => runWakeStallReconcile()`. The opencode shim references **none** of it (greg confirmed: zero hits). Same shape for bug-180 live-refresh: reconciler core kernel-resident, the `/health`-gated invocation shim-side.

**The contract (move the function AND its invocation into the kernel):**
1. `runWakeStallReconcile` moves into the kernel (tool-manager / a small `wake-stall` module). It reads `list_ready_work` via the kernel's own dispatch, uses the kernel's role/identity (post-handshake) + idle-gate (`getActiveCallCount`/`isIdle`), and **emits through the existing `notificationHooks` seam** (actionable W1 digest + W2 stall) — which each shim already binds to its host render-surface.
2. The kernel **wires the invocation itself** onto the PollBackstop heartbeat tick (`onHeartbeatTick`) inside `createSharedDispatcher` / kernel boot — **not** the shim. Same for the bug-180 live-refresh `/health` revision check.
3. **Shim contribution = zero new wiring.** A host author implements transport + binds `notificationHooks` (render surface). Wake/stall + live-refresh come for free.

**Invariant (state it at the hook site, enforce in review):** *no cross-cutting reconcile loop may be wired from a shim.* Cross-cutting behaviors (wake/stall, live-refresh, future ticks) are kernel-driven; the shim only provides transport + render. This is the structural close — it removes the surface where the next feature drifts into one shim.

---

## §5 SLICE-2 — the single redeploy (deploy posture)

**ONE opencode redeploy, at SLICE-2** (DR-S3-004). Phase-1 (92/93) merges **code-only, no redeploy**: redeploying opencode at 92-close would be wasted — it'd ship a thinner shim but still **dormant** on wake/stall until SLICE-1 hoists the tick-drive. steve stays on the old `4.3.0` bundle (no regression — already lacks wake/stall) until the single SLICE-2 republish picks up everything at once: 92 dedup + 93 hardening + SLICE-1 hoists + SLICE-0 version-fix.

**Mechanism:** mission-92's `release-opencode-plugin.sh` esbuild bundle → push to `apnex/opencode-hub-plugin` → steve installs + restarts. **Posture:** the opencode shim republish is architect-publishable (mission-92 charter) + reversible (rollback to the old bundle) → flow autonomously, surface post-hoc ([[feedback_flow_verifier_gated_deploys]]). **Coordination:** steve must be cognitively responsive to restart onto the new bundle (currently unresponsive — a SLICE-2 coordination detail; the verifier-dying-with-no-org-visibility is itself the D-3/C2 signal). Claude rides its normal redeploy cadence to pick up the SLICE-1 refactor (behavior-preserving → no forced claude hop).

---

## §6 SLICE-3 — version scheme (close bug-182 + bug-183 true-half)

**bug-182 (no unified scheme):** today network-adapter `0.1.4`, claude-plugin `0.1.9`, opencode-plugin `0.1.0` (deployed phantom `4.3.0`), opencode-hub-plugin `0.1.0` — independent lines. Decide a single coherence rule. **Architect lean (greg confirms feasibility):** kernel version is the spine; shims version independently but **report both** (kernel `sdkVersion` from build-info + `shimVersion` from the shim package.json). Auto-bump on release so a kernel change can't ship unstamped.
**bug-183 (reporting):** SLICE-0 kills the hardcode; SLICE-3 makes `advisoryTags.adapterVersion` carry the **true kernel** version (from the adapter build-info) + adds an explicit `shimVersion` so shim-vs-kernel are both unambiguous on `get_agents`. **idea-256 wire:** port `SHIM_COMMIT`/`ADAPTER_COMMIT` build-info commit-identity to opencode (claude-only today) → future opencode deploys are ref-traceable (closes the "no commitSha" gap greg flagged).

---

## §7 SLICE-4 — conflicting-tooling cleanup

The Director's explicit add. Inventory (architect-scoped; greg executes Hub-side):
- **`get_engineer_status`** — deprecated, superseded by `get_agents` (mission-63/ADR-028). Still live + reachable (**bug-184**). Retire from the surface, or mark deprecated in the tool description + redirect to `get_agents`.
- **Sweep** the live tool surface for other deprecated-but-exposed verbs (`list_available_peers` already appears gone — confirm). For each: retire, or mark+redirect.
- **Doc fidelity:** refresh `docs/network/00-network-adapter-architecture.md` (header reads `@apnex/network-adapter@2.0.0` + cites `get_engineer_status` — both stale).

*(Deeper verb-surface rationalization — the ~100-CRUD-tool collapse — stays idea-121/D-1 territory, NOT this mission. SLICE-4 is deprecated-tool retirement only.)*

---

## §8 Dogfood-3 plan (idea-355 proper, queue-coordinated)

idea-355 (Phase-2) runs **through the C1 work-queue** (dogfood-3 — continues NARROW adoption before the widen decision). WorkItem chain (architect seeds; greg claims/builds; Steve advisory-verifies; architect releases):
- **WI-0** SLICE-0 version-fix (no deps). Evidence: commit + PR.
- **WI-1** SLICE-1 kernel-hoist + tick-drive (no deps; the anchor). Evidence: commit + PR + test-run (wake/stall driven from kernel tick; opencode shim has zero wake/stall wiring yet still emits via notificationHooks in a harness).
- **WI-2** SLICE-3 version scheme (no deps; parallels WI-1). Evidence: commit + PR.
- **WI-3** SLICE-2 redeploy (deps WI-1, WI-2). Evidence: redeploy ref + `get_agents` snapshot showing steve on the current kernel + a wake/stall emit observed. **verifier-gate** WorkItem (Steve advisory: did steve actually self-wake?).
- **WI-4** SLICE-4 tooling cleanup (no deps). Evidence: commit + PR + tool-surface snapshot (get_engineer_status gone/redirected).

Acceptance = EVIDENCE-shaped (claim audit-IDs + org-state snapshots), per the dogfood discipline. The proof-bar mirrors dogfood-1/2 (clean claim→evidence-close trail).

---

## §9 Tele alignment + anti-goals

**Tele pre-check (per design discipline):** tele-3 (one kernel everywhere) — SLICE-1's tick-drive contract structurally enforces it (cross-cutting logic can't live in a shim). tele-4 (zero-loss / no silent failure) — Phase-1 lands built work (no strand); SLICE-0/3 kill the version-reporting lie. tele-1 (transparency) — true kernel version on `get_agents`. tele-13 (org self-drives) — every host self-wakes off the queue with no per-host wiring + no operator nudge (the FR-23 operator-bottleneck shrinks). **No "convenient interim shape" accepted** — the tick-drive contract is the durable fix, not a per-shim patch.

**Anti-goals:**
1. NOT mission-64's distribution rework / npm-publish auto-refresh — that's **idea-354**.
2. NOT a full Layer-2 `@apnex/message-router` build-out — idea-355 hoists into the kernel; the message-router migration of the coalescing block is a flagged OPEN Q, not a committed L2 stand-up.
3. NOT the idea-121/D-1 verb-surface collapse — SLICE-4 is deprecated-tool retirement only.
4. NOT a claude-side forced redeploy — the SLICE-1 refactor is behavior-preserving for claude.

---

## §10 Open questions for greg's construction-design audit

1. **Phase-1 rebase reality:** after rebasing mission-92's dedup onto main + build-verify, is it genuinely merge-ready, or did #362/#363 introduce semantic drift beyond the `index.ts` barrel? (Confirms the "build-looks-complete" call.)
2. **Coalescing home (§4.2):** the ~140-LOC rate-limit/prompt-queue/backlog — hoist into `@apnex/message-router` (Layer-2, exists ~301 LOC), into `@apnex/network-adapter` Layer-1c, or defer? Which avoids upsizing while not stranding it in the shim?
3. **Tick-drive read path (§4.3):** can the kernel call `list_ready_work` cleanly from inside the PollBackstop tick (it's an MCP round-trip through the kernel's own dispatch), or does that create a re-entrancy/ordering concern with the idle-gate? Any reason the invocation can't be fully kernel-internal?
4. **Version scheme (§6):** is "kernel-version-as-spine + shims report sdkVersion+shimVersion, auto-bump on release" the right coherence rule, or do you want a single lockstep version across all packages?
5. **SLICE-2 steve-restart:** what's the minimal coordination to get steve onto the new bundle if he's cognitively unresponsive at redeploy time — and does the redeploy need any Director gate beyond the architect-publishable republish?
6. **Sizing:** does this hold at MEDIUM, or does the tick-drive hoist + coalescing-home decision push it toward L?

If GREEN-with-construction-flags, we fold them, I propose the mission + preflight, and seed the dogfood-3 WorkItems.

---

*v0.1 architect-draft 2026-06-27. Engineer construction-audit next (thread TBD, after Phase-1 lands).*
