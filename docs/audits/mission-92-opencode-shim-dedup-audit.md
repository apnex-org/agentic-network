# Audit — mission-92 (M-OpenCode-Shim-Sovereign-Deduplication): was it optimally completed?

**Auditor:** lily (architect) · **Date:** 2026-06-21 · **Status:** v1.0
**Method:** three parallel ground-truth fan-outs (completeness / correctness+bug-161 / process+test-coverage) over the live branches, synthesised at the methodology altitude.
**Subject branches (not yet main-merged):** `agent-greg/opencode-plugin-prod` (#334, base) → `agent-greg/opencode-shim-dedup` (#336, pure dedup) → `agent-greg/opencode-shim-deany` (#337, de-any + bug-161). The bundle these produce is republished as `@apnex/opencode-hub-plugin` and consumed by **Steve** (GPT-5.5 / OpenCode, the org's cross-lineage verifier peer).

---

## 1. Verdict (headline)

**Mission-92 shipped a genuine, well-scoped structural win — but it was NOT optimally completed, on three independent axes, and the shortfall is the same root each time: the mission was measured by a code-tidiness metric (line-count / delegation) while the actual risk surface for a cross-lineage consumer is behavioural-contract fidelity against a real non-Claude runtime.**

It did its declared job well *inside its scope*: it deleted the worst divergence, closed a real correctness defect (the `router.route()` dedup-bypass), hoisted two genuinely-shared helpers cross-adapter, and the de-any pass earned its keep by flushing **bug-161** — a defect that had shipped silently in production for ~2 months. That is fix-forward working as intended.

But "optimally completed" requires three things the mission left open:
1. **Its own invariant is not met** — strict-thin was *approached*, not reached (§3).
2. **The fix it made is incomplete on its own terms** — bug-161's fix has an unhandled terminal state and no watchdog, and the defect *class* (SDK shape-skew) is only half-retired (§4).
3. **The test philosophy is the real gap** — the headline surfacing-path change shipped with no live-surfacing guard, and there is no cross-lineage runtime harness at all; the reassuring "172/172 green" is the Claude suite, orthogonal to OpenCode-shim behaviour (§5).

The deeper lesson (§6) and the validating irony (§7) follow.

---

## 2. What mission-92 set out to do

The OpenCode shim (`adapters/opencode-plugin/src/shim.ts`) had accreted notification-dispatch / dedup / pulse logic that the **shared core** (`packages/network-adapter`, `cognitive-layer`, `message-router`) and the sibling `adapters/claude-plugin` already own. The invariant: make the shim a **thin model-agnostic bridge** that *delegates* to core rather than re-implementing — "strict-thin", with a floated target of **~650–680 lines**.

---

## 3. Completeness — APPROACHED, not MET

**Line-count ground truth (`wc -l` on `shim.ts`):**

| Ref | Commit | Lines | Δ vs post-prod base |
|---|---|---|---|
| `origin/main` (pre-mission) | — | 766 | — |
| **Real base** (productionization #334) | `d033131` | **844** | (baseline) |
| pure-dedup tip (#336) | `c20a9a3` | 790 | **−54** |
| **FULL final mission state** (#337 de-any) | `c891cf8` | **806** | **−38** |
| strict-thin **target** | — | 650–680 | (−164 to −194) |

Two honest corrections to the in-flight narrative:
- The widely-quoted **"844 → 790, −54"** is the *pure-dedup tip*. The **full final shim is 806 (−38)** — de-any added +16 lines (real type annotations are more verbose than `: any`). De-any improves safety but works *against* the line target.
- Relative to **what is on `main` today (766)**, the full mission-92 shim is **+40 larger** — productionization (#334) added scaffolding the dedup then partly removed. The −38/−54 only holds against the post-productionization base.

**All four dedup steps landed and were confirmed in-diff:** Step-1 (deleted the `DEFAULT_SURFACE_SUPPRESS` band-aid + its env wiring + its test), Step-2c (deleted `buildPluginCallbacks`; surfacing now flows through `createSharedDispatcher` → `router.route()` → the `SeenIdCache` push/poll dedup — **this closes a real dedup-bypass**), Step-2a (`isPulseEvent`/`PULSE_KINDS` hoisted to core, both adapters rewired), Step-2b (bug-108 reconstruction hoisted to core as `reconstructDrainedAction`, both adapters rewired). Core `event-router.ts` grew 222→292 to host the hoists; the claude side was rewired in lock-step.

**What remains sole-resident in the shim:** the **~140-line notification-coalescing / deferred-backlog band** (`QueuedNotification`, `notificationQueue[]`, `deferredBacklog[]`, `isRateLimited`, `buildBacklogSuffix`, `drainBacklog`, `flushBacklog`, `processNotification`, `flushQueue`). This is the single largest sovereign block, and it is **not in core** — core holds only a comment naming the type; the only other copy is a *test-local mock* in `packages/network-adapter/test/unit/deferred-backlog.test.ts` that re-declares the interface. ~106 of the band's 153 lines are genuinely portable (the remaining ~47 are legitimate OpenCode-SDK glue — `showToast`/`promptLLM`/`injectContext` — that *should* stay).

**Completeness verdict:** the deferral is *defensible and disciplined* — it is named in-code (shim lines 94-97), bucketed with a dispatcher-lifecycle alignment, and gated on "when a 2nd OpenCode-class host arrives" rather than silently dropped. But it means the mission **approached** its invariant and stopped one named step short. Hoisting the coalescing band (~140 lines) would land the shim at **~666** — inside the target window. Mission-92 should therefore be recorded as **"structural dedup shipped; terminal coalescing hoist deferred"**, not "strict-thin achieved".

---

## 4. Correctness — bug-161, and what it reveals

**bug-161 mechanism (confirmed in-diff):** the OpenCode v2 SDK delivers `session.status` as an **object** `{type: idle|busy|retry}`, but the shim compared it as a **string** (`status === "idle"`, `=== "running"`...). The `else if` that set `sessionActive = true` was the *only* place the flag could go true — and it never matched. So `sessionActive` was **permanently false** → the `if (sessionActive) queue.push() else processNotification()` gate always took the `else` → **every notification surfaced mid-stream; the queue gate was inert.** The fix reads `event.properties.status.type` and maps idle→inactive(flush), busy/retry→active(buffer).

**This was worse than "SDK 0.4.x→1.3.x drift."** Ground truth from the pinned SDK type union: `session.status`/`session.created` **do not exist in the 0.4.x Event union at all**, and 0.4.x `session.updated` carried `properties.info`, not `.id`. The original handler was `any`-cast **speculative code that typechecked against nothing** — it matched neither the pinned SDK nor the runtime. The handler shipped 2026-04-19; because the only true-path never matched any version it ran against, **the queue gate was dead on arrival and stayed non-functional in production for ~2 months** against Steve's 1.3.x host. The de-any pass (applying real types, removing the `event: any` cast) is what converted a silent runtime no-op into a compile error that got fixed.

**Fix correctness:** correct, with **one unhandled terminal state** — `session.error` is in the union and is **not handled**; a session that goes busy/retry then dies via `session.error` (rather than idle) leaves `sessionActive` stuck true and the queue never flushes. There is a transport-level SSE watchdog (reconnect/recovery), but **no *session-state* watchdog and no max-queue-size cap** for the notification queue — scoping the original blanket "no watchdog" wording per the verifier cross-check (Steve, audit-3794). Mitigation exists (dual idle triggers: `session.status{idle}` *and* `session.idle`), so a single missed event doesn't strand it — but the `session.error` path + a host disconnect remain a narrow, real stuck-queue window. bug-161's fix needs a small completion: handle `session.error` + a bounded fallback flush.

**Regression safety (Claude path):** behaviour-preserving. Core changes are strictly additive (only new exports); `reconstructDrainedAction` is character-for-character the prior claude logic; the `isPulseEvent` hoist is byte-identical. One correction to the review claim: `source-attribute.ts` is **not "comment-only"** — it deletes the local defs and re-imports from core (a real, behaviour-preserving refactor, not a comment change). The 172/172 claim is plausible-by-inspection (not re-executed in this audit; see §5 for why that number is narrower than it sounds).

**The defect class is only half-retired.** bug-161 was not isolated — the same shape-skew family produced a *cluster*: the dead queue gate, `injectContext` passing `system:true` (boolean) where v2 wants a string (thread-669), `session.updated` reading `.id` vs `.info.id`, the `_testOnly` non-function export that crashed the 1.3.x loader at Steve's onboarding (thread-667), and `PluginInput.directory` vs `app.path.cwd`. De-any typed the **ingress** (the event handler) — but the **egress is still `any`**: `let sdkClient: any` (shim.ts:57), so every `sdkClient.session.promptAsync(...)` request-shape is untyped. The `system:true→string` fix there was caught *by eye, not by the compiler*. **More of this class can still be silently wrong on the request side.** Typing `sdkClient` to the real SDK client is the follow-on that actually retires the class.

---

## 5. Process + test coverage — the structural blind spot

**What mission-92 added:** exactly **one** net test file — `adapters/opencode-plugin/test/session-event.test.ts` (6 cases pinning the bug-161 `sessionActive` discriminators). It also **net-removed** `notification-suppress.test.ts` (its subject, `buildPluginCallbacks`, was deleted), and the **hoisted core logic got zero new tests** — the dedup-delegation wiring is asserted nowhere.

**Three structural gaps:**
1. **No live-surfacing test exists.** The mission's *headline* change rewired the surfacing path (`surfaceActionableEvent` → `buildToastMessage`/`buildPromptText` → `processNotification` → `showToast`/`injectContext`). **No test exercises any of those.** The e2e suite *explicitly excludes* the toast/inject layer by design comment ("OpenCode-runtime-dependent… orthogonal to the ADR-017 invariants"). bug-161 *is* the proof of this hole — a pure surfacing-path defect the suite never caught; it was found by typing, not testing. The dedup's marquee change shipped with no guard that surfacing still reaches the human/agent.
2. **No verifier / role-change e2e** — and structurally couldn't have one: the `verifier` role didn't exist on mission-92's tree (it arrived in mission-93).
3. **No cross-lineage / OpenCode-runtime integration test.** Every "opencode" test runs under vitest/Node with `InMemoryTransport` + mocks ("zero network, no Bun"). Nothing exercises the real OpenCode/Bun runtime, the live `HubPlugin` hook, or a non-Claude peer against a live Hub. **"172/172 green" is the *Claude* suite** (the de-any commit says so: "opencode 38/38 … claude FULL 172/172"); it does not exercise the OpenCode shim's runtime at all, and even the 38 are handler-logic-in-isolation.

**The two cutover bugs were unreachable by this mission by construction:** both are **Hub-side** (`agent-repository-substrate.ts` role-change refusal; `thread-policy.ts`/`message-policy.ts` turn-role gate), and mission-92 touched **zero `hub/` files**. Worse for bug (a): the Hub suite has a **green test asserting the role-change refusal is *correct*** (`mission-40-session-claim-separation/t1-helpers.test.ts`) — it is a deliberately-tested invariant, not a missing test; it became a defect only when the verifier-flip use case arrived. Only a *system-level* verifier/role-change e2e invalidates it.

**Process verdict:** mission-92's review+test process **structurally could not catch either cutover bug** (cross-subsystem scope wall + a tested-in-as-correct invariant + a cross-lineage runtime blind spot). It *did* own one local miss: the surfacing-path delegation shipped without a live-surfacing guard — the same hole that let bug-161 ship.

---

## 6. The deeper finding — the wrong success metric

Every shortfall above is the same root. Mission-92 optimised for a **structural/code-tidiness axis** (line-count, delegation-to-core) — a real and worthy axis. But the risk surface that actually matters for a bundle a **cross-lineage consumer** runs is **behavioural-contract fidelity against a real non-Claude runtime**. bug-161, the surfacing-path blind spot, and (one membrane over) the cutover bugs *all live on that second axis* — the one the mission's metric and test process couldn't see.

"Optimal completion" of a shim that a cross-lineage verifier consumes is therefore **not** "fewest lines / most delegated"; it is "**behaviour verified against the actual host before the consumer cuts over.**" That harness did not exist, so the dedup was graded on the wrong exam.

---

## 7. The validating irony

The verifier's **very first act of value — its own onboarding — caught two latent bugs the production test process structurally could not.** The dedup audit is, incidentally, the empirical case *for* the verifier role: an independent cross-lineage perspective surfaced defects that same-lineage review + a Claude-path test suite were blind to. mission-92's gaps are exactly the gaps a cross-lineage runtime check closes.

---

## 7a. Verifier cross-check (Steve / audit-3794, 2026-06-21)

The verdict was independently cross-checked on the live OpenCode/Bun host by Steve (cross-lineage verifier):
- **Strengthened** on all three axes — strict-thin-not-met, defect-class-not-retired, and cross-lineage test blindness all confirmed from the running bundle.
- **Refined one claim:** the live bundle *does* have a transport-level SSE watchdog (reconnect), so §4's "no watchdog" is scoped to **session-state / `session.error` handling + the notification-queue flush**, not the transport (applied above).
- **New finding → bug-164 (major):** the verifier session handshakes correctly as `verifier` but the **poll-backstop starts with `role=engineer`** — role-drift in the backstop path, likely sharing a root with the thread `currentTurn=engineer` participation symptom (Rung-0). One fix may close both. Routed to greg's rung-list.
- **Surfacing observations:** directed actionable traffic reaches the host via prompt/context **inject (no separate toast)**; the *informational* log shows **flood-like `AGENT_STATE_CHANGED` bursts** (log-level, post-Step-1 no-inject), but **actionable-notification coalescing could not be proven either way from live data** — so the R3 harness must *deterministically* prove actionable coalescing and cover the verifier poll-backstop role (bug-164).

This is the verifier→artifact loop working: an independent cross-lineage seat corrected one claim, hardened the rest, and surfaced a fresh defect — on the very audit of the bundle it consumes.

---

## 8. Recommendations (prioritised)

| # | Action | Class | Owner | Lands in |
|---|---|---|---|---|
| R1 | **Complete bug-161's fix** — handle `session.error`; add a bounded fallback flush (size cap or flush-on-any-terminal-session-event). Closes the stuck-queue window. | bug (correctness) | engineer | greg's hardening batch |
| R2 | **Type the SDK egress** — `sdkClient: any` → the real client type, so request-shape skew (the `system:true`-class) is compile-caught. Retires the shape-skew defect class de-any started. | idea (follow-on) | engineer | new idea |
| R3 | **Live-surfacing + cross-lineage runtime harness** — an e2e under the actual OpenCode/Bun runtime asserting an inbound actionable event renders (`showToast`/`injectContext` fire; idle flushes the queue to a render), plus a non-Claude peer participating against a live Hub. **This is the structurally important one** — it closes the §6 blind spot that bit us twice. | idea (test-infra) | engineer + architect | new idea |
| R4 | **Finish strict-thin** — hoist the ~140-line coalescing band to core (the named, in-code-deferred terminal step). Lands the shim ~666, inside target. Already gated on a 2nd OpenCode-class host; un-defer if Steve shows stuck-queue or coalescing symptoms. | follow-on | engineer | existing in-code deferral / new idea |
| R5 | **Methodology / calibration (PROPOSE to Director)** — *an adapter-only mission that ships a bundle a cross-lineage peer consumes requires a system-level (hub + adapter + real-runtime) acceptance gate before the consumer cuts over.* Calibration filing is Director-direct — surfaced here as a proposal, not filed. | calibration candidate | Director | proposal |

**Bottom line:** mission-92 is a **B+ structural win mis-graded as complete.** Nothing it shipped is wrong; the dedup is sound and the de-any pass paid for itself. But it stopped one named step short of its invariant, left its own fix with a terminal-state hole and a half-typed defect class, and — most importantly — shipped on a test metric that was blind to the behavioural-contract axis where the real cross-lineage risk lives. The fix-forward path is R1–R3 (R3 the keystone); R4 completes the original invariant; R5 prevents the class.
