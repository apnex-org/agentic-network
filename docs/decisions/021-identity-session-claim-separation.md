# ADR-021 — Identity / Session Claim Separation

**Status:** Accepted (mission-40 ratification, 2026-04-22)
**Mission:** M-Session-Claim-Separation (mission-40)
**Supersedes:** none
**Superseded by:** none
**Related:** bug-26 (forcing function), bug-16 (Agent lifecycle hardening that this ADR completes), idea-122 (`reset_agent` operator affordance, future consumer), idea-152 (Smart NIC Adapter, target-state successor), idea-121 (API v2.0 tool-surface modernization, verb-stability commitment), tele-3 (Sovereign Composition — the Logic Leakage fault this ADR closes), tele-1 (Sovereign State Transparency — the Hidden State fault this ADR closes)

---

## Context

The Hub's `register_role` MCP tool was doing two semantically-distinct things under one tool call:

1. **Identity claim** — "I am agent X, fingerprint Y, role Z, labels L." Idempotent. Should be safe to repeat. Should never affect any other session.
2. **Session claim** — "I am the active session for X. Route SSE notifications to me. Evict any prior session of the same fingerprint." Displacing. Increments `sessionEpoch`. Tears down prior `currentSessionId` + SSE stream.

The conflation produced a class of operator-visibility-breaks-the-system defect:

- Every adapter spawn (including transient probes from `claude mcp list`, plugin reload, IDE restart, terminal-side debugging) ran a full handshake.
- Every handshake derived fingerprint from `sha256(OIS_INSTANCE_ID)`.
- Probe and session spawns from the same wrapper script collided on fingerprint.
- The Hub treated each collision as session takeover (correct behavior for a real session restart) and silently displaced the prior session's SSE stream.
- Result: looking at plugin health killed the live session it was meant to inspect — the Heisenberg situation.

**Forcing function:** bug-26 (probe-induced session displacement), surfaced 2026-04-22 cold-start by lily (architect) when her session was repeatedly killed by `claude mcp list` invocations during her own debugging.

**Why detection-based fixes were rejected:**

Three obvious fix paths were considered and rejected during the mission's design (brief §1):
- **Adapter-side probe-detection heuristic** — every heuristic (process-tree introspection, MCP `clientInfo` signature match, idle-timeout) has false positives (real session looks like probe → silent identity loss) and false negatives (probe looks like session → bug recurs). Each new host = new heuristic. Fights the protocol instead of fixing it.
- **`probe: true` flag in `register_role` payload** — still requires the adapter to KNOW it's a probe (same heuristic problem). Default-displace-unless-flagged inverts the safer default.
- **Same-fingerprint N-coexistence at Hub** — doesn't actually fix the bug (N+1 sessions still cause displacement); breaks INV-AG3 spirit; cascades into routing logic. Wrong scope.

The principled fix was to **separate the two concerns at the protocol layer** so the bug becomes structurally impossible, not detection-dependent.

---

## Decision

The Hub protocol surface MUST distinguish identity-assertion from session-claim. The two concerns are independent operations with independent observability.

### Identity claim — `register_role` (idempotent)

`register_role` is purely identity-assertion. It:
- Ensures the Agent record exists with the given `(fingerprint, role, labels, clientMetadata, advisoryTags)`.
- Refreshes mutable handshake fields per the bug-16 C5 label-refresh contract (does NOT redefine those semantics).
- Updates `lastSeenAt`.
- Records the binding `sessionId → engineerId` (via the optional `sessionId` parameter on the underlying `IEngineerRegistry.assertIdentity` helper) so subsequent claim sites can look up the asserted identity.
- **Never** increments `sessionEpoch`.
- **Never** touches `currentSessionId`.
- **Never** flips `status` or `livenessState`.
- **Never** evicts an SSE stream.

Response carries `sessionClaimed: false` and `sessionEpoch` reflecting the as-observed value (NOT a just-incremented value). Adapters MUST key on `sessionClaimed` for takeover-detection — see Consequences §1.

### Session claim — `claim_session` (displacing)

`claim_session` is a separate MCP tool that performs the session-claim work. It:
- Takes no args (uses the authenticated MCP session ID from transport context).
- Increments `sessionEpoch`.
- Sets `currentSessionId` to the calling session.
- Marks the agent `online` + resets liveness (per ADR-017).
- Evicts any prior session for the same engineerId (`displacedPriorSession` field in the response captures the evicted session's id + epoch).
- Returns `{ engineerId, sessionEpoch, sessionClaimed: true, displacedPriorSession? }`.

The verb `claim_session` is committed **stable** across any future API v2.0 envelope migration (idea-121 may wrap the envelope shape but MUST NOT rename the verb). This guarantees adapters introduced under this ADR survive v2.0 retrofit unchanged.

### Single helper, three triggers

All three claim paths route through one `IEngineerRegistry.claimSession(engineerId, sessionId, trigger)` helper. The `trigger` parameter discriminates audit emission only — the helper implementation is one path:

- `"explicit"` — called by the new `claim_session` MCP tool (above).
- `"sse_subscribe"` — called by the SSE-stream-open hook in `HubNetworking` (back-compat).
- `"first_tool_call"` — called by the policy-router pre-dispatch hook (back-compat).

### Back-compat via auto-claim hooks

To avoid forcing a Hub-and-all-adapters atomic deploy, two auto-claim hooks land at the Hub layer:

1. **SSE-subscribe** (`HubNetworking.app.get("/mcp")` after stream open) — if the session has identity but no claim, auto-call `claimSession(..., "sse_subscribe")`.
2. **First-tools/call** (`PolicyRouter.handle()` after RBAC, before tool dispatch) — if the session has identity but no claim AND the incoming tool is not in the skip-list (`register_role` + `claim_session`), auto-call `claimSession(..., "first_tool_call")`.

Both hooks emit `agent_session_implicit_claim` with the `trigger` field encoded in the audit `details` string. Un-updated adapters (any pre-mission-40 client) keep working unchanged: they call `register_role`, then either open SSE (auto-claim fires) or make a tool call (auto-claim fires).

### Deprecation runway

The §10.1 retirement criterion: when both `agent_session_implicit_claim` sub-rates (`trigger=sse_subscribe` AND `trigger=first_tool_call`) trend to zero for an operator-determined window, the back-compat hooks can be retired and `register_role` becomes purely identity-asserting with no implicit fallback. The dashboard at `docs/observability/m-session-claim-separation-runway-dashboard.md` parses the runway metric.

---

## Consequences

### 1. `currentSessionEpoch` semantics change (BREAKING for callers using epoch-delta)

Pre-ADR: `register_role` returned `sessionEpoch` reflecting a just-incremented value. Adapter code using `(response.sessionEpoch - priorEpoch > 0)` as a "I just took over" signal worked correctly.

Post-ADR: `register_role` returns `sessionEpoch` as-observed. The field no longer indicates takeover. **Adapter code using epoch-delta as a takeover proxy is silently broken.**

Adapters MUST key on the new `sessionClaimed: boolean` field from the `claim_session` response (true on successful explicit claim, with `displacedPriorSession` populated when a prior session was evicted). The `register_role` response also carries `sessionClaimed: false` so existing callers can distinguish the two-call shape from the legacy implicit-claim shape.

**Adapter audit during mission-40 T3:** one location in `packages/network-adapter/src/handshake.ts` had an epoch-jump-detection branch (threshold `> 1`) that used register_role's epoch delta to detect external displacement. Updated to threshold `> 0` with reworded log message — post-ADR, ANY positive delta means an external `claim_session` displaced us between our two `register_role` calls (because `register_role` itself doesn't bump). This detection is informational; the load-bearing takeover signal lives on the `claim_session` response.

### 2. Two new MCP tool surface entries

- `register_role` semantics narrowed (existing tool, behavior reduced to identity-only).
- `claim_session` added (new tool).

Existing callers of `register_role` get the new (narrower) semantics automatically — no code change required, but the implicit auto-claim only happens if they then open SSE or make a tool call (the back-compat hooks). New callers SHOULD adopt the explicit two-call pattern: `register_role` + `claim_session`.

### 3. Four new audit actions

- `agent_identity_asserted` — every `register_role` call.
- `agent_session_claimed` — explicit `claim_session` (`trigger=explicit`).
- `agent_session_implicit_claim` — back-compat auto-claim hooks (`trigger=sse_subscribe | first_tool_call`).
- `agent_session_displaced` — emitted alongside any `*_claimed` / `*_implicit_claim` when a prior session was evicted.

The `trigger` field is encoded in the `details` string per existing `AuditEntry` shape. Future schema evolution may promote it to a structured payload field; a migration trigger (`AuditPayloadSchemaVersion` or similar) would be the appropriate path. Encoding-in-details preserves dashboard-parser compatibility today.

### 4. Bug-26 structurally impossible (no longer detection-dependent)

The class of probe-induced-displacement defect closes by construction. A probe that asserts identity but doesn't open SSE and doesn't make a tool call (e.g. `claude mcp list`) leaves zero session-claim audits and zero side-effects on Hub session state. Combined with mission-40's adapter-side T4 tool-catalog cache, probes against a warm cache touch the Hub zero times.

### 5. Independent readiness preconditions for adapter handlers

Pre-ADR: adapter dispatcher had two readiness signals (`handshakeComplete` + `agentReady`) that didn't cleanly map to the protocol semantics.

Post-ADR: three-phase readiness signal in adapter shim (`identityReady` / `sessionReady` / `syncReady`). Each handler waits on exactly the precondition it needs:
- Initialize: ungated (host's MCP `initialize` timeout is tighter than handshake latency — the bug-A startup-race fix from earlier this session).
- ListTools: gated on `identityReady` (transport connected; can fetch catalog from Hub).
- CallTool: gated on `sessionReady` (session claimed; safe to dispatch tool calls).

In lazy mode (no `OIS_EAGER_SESSION_CLAIM=1` env hint), `sessionReady` resolves immediately on `identityReady` because the Hub's auto-claim hooks handle the actual claim server-side. CallTool gates pass through; first tool call triggers Hub-side auto-claim transparently.

### 6. Operator-visibility decoupled from Hub load

Pre-ADR: operator running `claude mcp list` during a live session caused (a) live-session displacement, (b) reconnect churn, (c) downstream notification gaps. At scale, every IDE health check, every CI script, every plugin-reload was a Hub-load amplifier.

Post-ADR: operator visibility is non-destructive at the Hub session layer (T2/T3) AND Hub-load-free at the protocol layer (T4 cache). At limit: continuous `mcp list` polling generates zero Hub interaction against a warm cache.

### 7. Forward compatibility with idea-152 (Smart NIC Adapter)

The Smart NIC target-state will absorb identity-and-transport entirely. mission-40's protocol cleanup positions the system so that idea-152 inherits a clean identity-vs-session model rather than carrying the conflated `register_role` legacy forward.

---

## Migration path for adapter authors

Adapters introduced post-ADR-021 SHOULD adopt the explicit two-call pattern:

```ts
// Adapter startup
await agent.call("register_role", { /* role, globalInstanceId, clientMetadata, ... */ });
// At this point: identity asserted; sessionClaimed=false; SSE notifications NOT yet routed to this session.

// When the adapter intends to be the active session (e.g. wrapper script
// declared "I'm a real session" via OIS_EAGER_SESSION_CLAIM=1 env hint):
const claim = await agent.call("claim_session", {});
// claim.sessionClaimed === true; claim.displacedPriorSession populated if a prior session was evicted.
// SSE notifications now routed to this session. CallTool dispatches will work.
```

Lazy adapters (those that don't call `claim_session` explicitly) keep working unchanged via the SSE-subscribe + first-tools/call auto-claim hooks. They emit `agent_session_implicit_claim` audits with `trigger=sse_subscribe` or `trigger=first_tool_call` so the deprecation-runway dashboard can track them.

Probes (e.g. `claude mcp list`) MUST NOT call `claim_session` — that defeats the bug-26 structural fix. Probes call `register_role` (cheap identity assertion), serve their inspection task, exit. No SSE, no tool calls, no claim.

---

## References

- bug-26 — `class: identity-management`. Resolved by mission-40 commits `[18cde2d, a011fcd, dd1423c, 9e14ff7, e2ce3f8]`.
- Mission brief — `documents/missions/m-session-claim-separation.md` v1.1.
- Closing audit — `docs/audits/m-session-claim-separation-closing-report.md`.
- Deprecation runway dashboard spec — `docs/observability/m-session-claim-separation-runway-dashboard.md`.
- Bug-candidate doc (origin) — `docs/reviews/bug-candidate-mcp-probe-displacement.md` (carries `RESOLVED-BY-MISSION` banner post-T5).
- Companion bug-A (already shipped) — `docs/reviews/bug-candidate-adapter-startup-race.md` (commit `83b57e3`).
- ADR-013 — Threads 2.0 multi-action convergence (mission-40 cascade emission relied on this for `propose_mission` ratification).
- ADR-014 — Threads 2.0 Phase 2 architecture (mission-19 director-* prefix preserved).
- ADR-017 — Persist-first comms queue (`receiptSla`, `wakeEndpoint`, `livenessState` semantics preserved by `assertIdentity`).
- ADR-018 — Cognitive layer middleware (`agent.listTools()` cognitive-pipeline pass-through preserved).
- ADR-019 — Semantic / plumbing split (mission-40's `claim_session = no args, derives session from transport` follows ADR-019's plumbing-fields-Hub-derives principle).
