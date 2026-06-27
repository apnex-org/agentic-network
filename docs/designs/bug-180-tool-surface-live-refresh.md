# bug-180 — Tool-Surface Live-Refresh (design-of-record)

**Status:** DESIGN-OF-RECORD · **Author:** lily (architect) · **Date:** 2026-06-27
**Bug:** bug-180 (major, class `cache-invalidation`) · **Friction:** FR-21
**Role in C1 dogfood:** WI-1 (Design) deliverable — the first WorkItem of the C1 NARROW-adoption dogfood, coordinated end-to-end through the sovereign work-queue.

> Architect spec-level design-of-record. The code-level construction-design is greg's (WI-2), in the #361 adapter domain.

---

## 1. Problem

After the #361 onramp deploy (prod gitSha `2a56939`, builtAt 2026-06-27T01:47:57Z) added the 11 C1 work-queue verbs (`create_work` / `get_work` / `claim_work` / `start_work` / `complete_work` / `block_work` / `resume_work` / `release_work` / `abandon_work` / `list_ready_work` / `clear_work_quarantine`), **both claude-plugin proxies (architect + engineer) continued to advertise a tool surface without those verbs.** Neither a full client hard-reset nor `/reload-plugins` restored them. The opencode adapter saw all 11 verbs throughout.

**Impact:** blocked the C1 go-live (could not seed WorkItems). More broadly: **every Hub redeploy that changes the tool surface leaves already-running claude-plugin agents blind to the change**, and a reset wakes them *without* the new verbs — which would defeat the "recover via the sovereign queue" premise of NARROW adoption. Must be fixed before adoption widens.

## 2. Root cause (proxy-side; Hub is correct)

Confirmed via thread-712 (greg, independent raw-prod MCP session) + thread-713 (Steve, opencode tiebreaker, converged):

- The Hub is up to date and serves the full 83-tool surface to **any fresh MCP session** (live `toolSurfaceRevision = f96c6bd56a1a0f32`). No stale Hub state.
- The claude-plugin proxy persists the catalog to `$WORK_DIR/.ois/tool-catalog.json`, tagged with a `toolSurfaceRevision` ETag. Both proxies held a cache written 2026-05-26 (rev `db48a16707617c0f`, 68 tools, **zero** work verbs) — valid until today's build bumped the surface 68→83.
- The host enumerates `tools/list` **once** at startup, via the ListTools probe path (`dispatcher.ts` ~526-551), which serves the on-disk cache while identity is unresolved. `isCacheValid` (`tool-catalog-cache.ts` ~199-211) **trusts the cache when it does not yet know the live revision** (fail-open). The shim's `/health` revision fetch (`shim.ts` ~502) is fire-and-forget and **loses the race** against the startup probe.
- A surface change delivered by **redeploy** (a new Hub process) never emits an in-life `notifications/tools/list_changed` to already-connected hosts → nothing invalidates the file. A restart re-reads + re-trusts the same file; `/reload-plugins` reconnects the *same* long-lived proxy process (no re-fetch). Hence the persistence across every reset short of `rm` + full restart.

**The cache is not the villain** — it exists for probe latency (`claude mcp list` and pre-identity probes must not block on a network fetch). The defect is that **correctness depends on the cache instead of on a revision reconcile.**

## 3. Design

Treat tool-surface delivery as a **declared-vs-applied reconcile** — the exact pattern the storage substrate's SchemaDef-reconciler already uses. Desired-state = the Hub's tool surface, versioned by `toolSurfaceRevision`; applied-state = the host's enumerated tools. MCP's `notifications/tools/list_changed` is the watch/notify primitive (the LISTEN/NOTIFY analog); the Hub already advertises `tools.listChanged: true`. The probe-friendly cache stays — it just stops being load-bearing for correctness.

Three layers, in priority order:

### L1 — Primary: reconcile on `identityReady` (event-driven; no poll, no restart)
The shim already resolves an `identityReady` lifecycle event. On that event the live revision is knowable. Compare the served/cached revision against the live revision; **on drift, emit `notifications/tools/list_changed` to the host**, which re-calls `tools/list` and receives the live surface. Covers the redeploy-then-reconnect case that caused bug-180 — without any manual cache-delete.

### L2 — Backstop: revision-poll on the existing PollBackstop heartbeat
Reuse the existing heartbeat timer to periodically resolve the live `toolSurfaceRevision`; on drift, trigger the same `list_changed`. Covers the one case L1 misses: a redeploy **while a session stays connected** (no reconnect, so no fresh `identityReady`).

### L3 — Source-of-truth (Hub-side): deterministic revision
Make `toolSurfaceRevision` a **deterministic hash of the registered tool set** (names + a version/shape discriminator), so any add/remove bumps it automatically with zero manual bookkeeping. This is the missing piece that makes L1/L2 fire: the revision stayed `db48a16…` through the #361 deploy precisely because nothing bumped it.

### Retain (do not change)
- The on-disk cache + the pre-identity probe-serving path (latency).
- Break-glass (`rm $WORK_DIR/.ois/tool-catalog.json` + full client restart) as the manual escape hatch.

## 4. Acceptance criteria (evidence-shaped — drive WI-3 verify)

- **AC1 (the core proof):** With an agent already running, a Hub redeploy that changes the surface causes that agent to re-enumerate and expose the new verbs **within one heartbeat interval, with no manual cache-delete and no restart.** Evidence: before/after `tools/list` capture across a surface-changing redeploy on a connected claude-plugin session.
- **AC2:** `toolSurfaceRevision` changes iff the registered tool set changes — adding/removing a tool bumps it; an identical set yields an identical hash. Evidence: unit test.
- **AC3:** The `identityReady` reconcile detects a stale-vs-live revision delta (db48→f96 class) and emits `list_changed`. Evidence: unit/integration test.
- **AC4 (no latency regression):** A pre-identity probe is still served from cache without a blocking network fetch. Evidence: existing `dispatcher-list-tools-cache.test.ts` extended; probe-path timing assertion.
- **AC5 (no regression):** Break-glass still works; a cold start with no cache live-fetches the full surface.

## 5. Test plan
- Unit: revision-hash determinism (AC2); `isCacheValid` no longer fail-open on unknown-vs-known-drift (AC3).
- Integration: simulate a surface-changing redeploy against a connected proxy → assert `list_changed` emitted + re-enumeration (AC1); probe-path latency preserved (AC4).
- Extend `dispatcher-list-tools-cache.test.ts` rather than add a parallel harness.

## 6. Rollout & the bootstrap caveat
- **Hub change** (L3) ships via `deploy-hub.yml` → watchtower roll (per repo deploy norm).
- **Adapter change** (L1/L2) bumps the `@apnex/claude-plugin` proxy version; agents must update to the fixed adapter + restart **once** to get onto it (chicken-and-egg: the live-refresh can't deliver the fix that enables live-refresh). After that one-time hop, no future surface change needs break-glass.
- Reversible: revision-hash + list_changed are additive; the cache + break-glass remain as fallback.

## 7. Out of scope / follow-ons
- Opencode adapter parity (it already refreshes correctly; confirm it shares the revision contract).
- Generalising the reconcile pattern to other proxy-cached Hub surfaces, if any.
