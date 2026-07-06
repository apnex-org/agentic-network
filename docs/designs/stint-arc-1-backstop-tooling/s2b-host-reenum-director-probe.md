# S2b — Host Re-Enumeration Director Probe (staged L4 artifact)

**Arc:** Stint Arc-1 / backstop-tooling · **Slice:** S2b · **idea:** idea-456
**Status:** STAGED — a runnable manual procedure for the Director/operator. Nothing here is self-wired into the harness (the host-activation half deliberately stays out of automated code — it exercises Claude Code, which we don't own).

---

## What this proves (and what the in-repo oracle already proved)

The tool-surface live-refresh chain has four links:

| Link | What | Where | Coverage |
|------|------|-------|----------|
| **L1** | hub ETag `computeToolSurfaceRevision` moves when a new `[Any]` verb registers | `hub/src/policy/tool-surface-revision.ts` | ✅ in-repo — `hub/test/tool-surface-revision.test.ts` (two-victim block) |
| **L2** | reconciler detects `served≠live` drift → emits | `packages/network-adapter/src/tool-manager/catalog/tool-surface-reconciler.ts` | ✅ in-repo — `tool-surface-oracle-s2b.test.ts` (real registration delta) |
| **L3** | emit → `mcpServer.sendToolListChanged()` reaches the connected MCP client | `adapters/claude-plugin/src/runtime.ts` | ✅ in-repo — `tool-surface-l3-emit.test.ts` (client receives the notification) |
| **L4** | **the host (Claude Code) re-pulls `tools/list` on the notification and rebuilds the LLM tool surface** | Claude Code runtime — **not our code** | ⛔ **this probe** |

L1–L3 are deterministic, in-repo capital that CI gates on every PR. **L4 is the one link outside our code** — whether Claude Code, on receiving `notifications/tools/list_changed`, actually re-enumerates and exposes the new verbs to the model. It cannot be asserted in our test suite; this document is how a human verifies it in ~5 minutes.

---

## Acceptance precision (READ FIRST — a wrong subject makes the probe un-passable)

> The subject session **must START on the fixed shim, THEN survive a redeploy** that registers a new `[Any]` verb. A **pre-fix-vintage session is NOT a valid subject** — its shim predates the reconciler wiring, so it will (correctly) fail to refresh, and that failure says nothing about whether the fix works.

Concretely: **do not** use a session that was already open before the shim carrying the bug-180 reconciler was installed. Start a fresh session on the current shim first.

**Two-victim rule:** success requires **BOTH `update_work` AND `pause_work`** to become reachable. One verb appearing is not enough — two independent verbs kill a false-green where a single incidental registration masks a real regression.

---

## Path A — Fast deterministic probe (~5 min, the escape-hatch trigger)

Uses the in-repo **force-emit** entrypoint (`ToolSurfaceReconciler.forceEmit()`) to deliver the re-enumeration signal on demand, WITHOUT staging a real redeploy. This isolates L4: L1–L3 are known-green, so if the host re-enumerates here, the host link works.

1. **Start a fresh Claude Code session** on the current shim. Confirm connection (the session responds to a trivial tool call).
2. **Confirm the baseline surface.** In the session, list available tools (or attempt `pause_work` / `update_work`). Record which of the two victims are currently reachable. (If both are already reachable, pick any not-yet-registered `[Any]` verb as the probe verb, or proceed to Path B for the true dynamic.)
3. **Fire the escape-hatch.** From the operator context, invoke the force-emit entrypoint against the live reconciler (see *Escape-hatch invocation* below). This calls `emitListChanged()` unconditionally → `mcpServer.sendToolListChanged()` → the host receives `notifications/tools/list_changed`.
4. **Observe (within one heartbeat interval, no restart):** the session's tool surface re-enumerates. **Expected:** both `update_work` and `pause_work` are now reachable in the model's tool list.
5. **Record** the observation (timestamp + the two verbs' presence) against the acceptance rule.

**PASS:** both victims reachable after the forced emit, no session restart.
**FAIL:** either victim still absent after ≥1 heartbeat → the host did not re-enumerate → capture the notification log (`notificationLogPath`) and escalate; the gap is in L4 (host re-enum), not L1–L3.

## Path B — Full dynamic probe (real redeploy, thorough)

Exercises the whole chain end-to-end against a genuine registration delta.

1. **Start a fresh Claude Code session** on the current shim (acceptance precision above). Confirm `pause_work`/`update_work` reachability baseline.
2. **Redeploy the hub** with a tool-surface change that registers a new `[Any]` verb (any additive registration bumps `computeToolSurfaceRevision`). Keep the session **connected** across the redeploy — do NOT reconnect or restart.
3. **Wait one heartbeat interval** (the L2 backstop cadence). The reconciler's heartbeat tick observes `served≠live` drift and emits.
4. **Observe:** the session re-enumerates and the newly-registered verb (and, for the incident case, both `update_work` + `pause_work`) appears — no restart.

**PASS/FAIL:** as Path A.

---

## Escape-hatch invocation (host-activation half — documented, NOT self-wired)

The in-repo half of the operator escape-hatch is shipped and tested: `ToolSurfaceReconciler.forceEmit(reason)` unconditionally drives `emitListChanged → sendToolListChanged`, advancing the applied baseline to live when resolvable and never throwing on a host-emit failure. It is the deterministic trigger Path A relies on.

The **host-activation half** — a wired operator command/menu-item that reaches the live `reconciler` instance inside a running shim and calls `forceEmit()` — is intentionally left as a manual/staged step. Wiring it touches the harness (session control surface) and is the Director's return-gate call, not an engineer self-wire. When activated, the operator obtains a reference to the runtime's `reconciler` (returned from `createClaudeRuntime`) and calls `forceEmit("operator-unstick")`.

> If/when the host-activation half is prioritized, it is a fast-follow slice: expose a single operator entrypoint bound to the existing `reconciler.forceEmit`. No new reconcile logic — the capital already exists.

---

## Corroborating field evidence (session-vintage lag, observed live)

Two independent witnesses that the staleness is session-vintage (deployed/enumerated surface lagging merged code), not a code defect — both recorded during Arc-1:

1. **Architect session (the motivating incident):** `update_work` (S2, #539) and `pause_work` (S3, #540) registered `[Any]` on the hub but unreachable in the architect's long-running shim session — a process whose vintage predated the reconciler wiring / the redeploy that registered them.
2. **work-176's own `stateDurations`:** at ~17:01Z (mid-redeploy) the item's `stateDurations` was missing the `paused` bucket that S3 (#540) added; at ~17:03Z (post-roll) the same item carried `paused:0`. The deployed hub surface lagged the merged code by one redeploy — observed on the very work item that fixes the class.

Both are consistent with: the fix (bug-180 live-refresh chain) works **going forward** for sessions that start on the fixed shim and stay connected across a redeploy; it cannot retroactively refresh a pre-fix process — which is exactly why the escape-hatch (forced re-enumeration on demand) exists.
