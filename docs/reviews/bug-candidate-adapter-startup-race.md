# BUG CANDIDATE — Adapter startup races stdio open vs Hub handshake

**Status:** draft (pre-Hub-filing). Authored 2026-04-22 by greg (engineer); diagnosis by lily (architect).
**Discovery context:** 2026-04-22 architectural review cold-start. lily's adapter could not establish a connection through Claude Code; Hub-side logs showed handshake completing successfully at the same wall-clock as the host-side timeout. greg verified Hub health independently. lily diagnosed the ordering issue in the adapter entry point.
**Why this doc exists (not yet a Hub Bug entity):** Filing is a single `create_bug` call; this draft locks the wording while diagnosis is fresh and is portable to either greg's or lily's session.

---

## Severity / Class / Tags

- **Severity:** major
- **Class:** `race` (subclass: `startup-ordering`)
- **Tags:** `adapter`, `startup`, `mcp-stdio`, `race`, `observed-2026-04-22`, `lily-discovery`, `blocks-2026-04-review`

## Symptom (observable)

Claude Code's MCP `initialize` request to the agent-adapter plugin fails or times out on cold start. Host reports the plugin as unresponsive. Hub-side log shows successful `register_role` with role+labels at the same wall-clock window. Manual standalone runs of the adapter without a host MCP client appear to succeed because nothing is waiting on stdio.

## Mechanics (how it arises)

In the adapter entry point — lily named `proxy.js`; greg's read of the source pre-fix is the `main()` function in `adapters/claude-plugin/src/shim.ts` (compiled to `dist/proxy.js`) — startup is a strict serial pipeline:

```ts
// Pseudo, current shape per lily's diagnosis
async function main() {
  // ...
  await agent.start();             // Hub registration — observed 600–1200 ms
  // ...
  await server.connect(transport); // stdio MCP server only NOW reads stdin
}
```

The Claude Code host fires its MCP `initialize` request immediately after spawning the adapter process. Until `server.connect(transport)` runs, the adapter's stdin is unread. The host has no signal of liveness, only the absence of a response. If Claude Code's MCP `initialize` timeout is shorter than the Hub handshake latency, the connection deterministically fails.

## Rationale (why it matters)

Two collisions, two tele violations:

- **tele-7 Resilient Agentic Operations (Blocked-Actor + Silent-Collapse faults).** The host is paused indefinitely on a transient condition (Hub handshake in flight) with no resume signal. From the host's perspective, the failure is silent — no actionable feedback distinguishes "Hub handshake slow" from "plugin crashed". Tele-7 criterion 1 ("No silent failures — every failure logs to Audit and surfaces actionable feedback") is violated at the local boundary even though Hub-side logs are clean.
- **tele-6 Frictionless Agentic Collaboration (Boundary-Blocking fault).** The adapter's *internal* coordination concern (Hub authentication) blocks the *external* contract with its caller (MCP initialize ACK). Two roles are conflated under a single startup pipeline: the adapter as MCP server (must be reading stdin from the moment it forks) vs the adapter as Hub client (needs an authenticated session before it can dispatch tool calls). Tele-6 criterion 3 ("never blocked on the other's administrative limitations") is violated — host is blocked on adapter-administrative startup.

A latent design assumption ("the Hub responds fast enough that ordering doesn't matter") becomes a hard fault when Hub latency rises (cold container, GCS round-trip, network congestion). The fault is environmental-trigger, not bug-in-isolation — exactly the class that Chaos-Validated Deployment (tele-9) is intended to catch but hasn't yet, since adapter startup isn't simulated.

## Consequence

lily cannot connect at all on this host today. The 2026-04 architectural review depends on her live participation alongside greg for Phase 1 cartography (per `docs/reviews/2026-04-architectural-review.md`); this bug is a **review blocker**. More broadly, the bug is environmental — any operator on a slower laptop, slower network, or slower Hub start would hit it, and would observe it as "the plugin doesn't work" with no actionable error.

## Reproduction

1. Hub is reachable but handshake latency is in the 600–1200 ms range (observed in lily's logs).
2. Run `./start-lily.sh` from `/home/apnex/taceng/agentic-network-lily`.
3. Claude Code reports the MCP plugin as unresponsive; `claude mcp list` may show it as failing.
4. Hub log shows `register_role completed in 600–1200ms` with role=architect at the same wall-clock as the failure.

Manual `claude mcp list` may succeed intermittently in lily's evidence — the probe path doesn't subscribe to SSE, so its handshake completes within whatever timeout `mcp list` enforces (which appears more permissive than `initialize`).

## Proposed fix

Open stdio (`server.connect(transport)`) **before** or **in parallel with** Hub registration. The MCP server can ACK `initialize` and respond to capability discovery while the Hub handshake completes asynchronously. Tool-dispatch handler gates on `agent.ready` — if a tool call arrives before handshake completes, return a structured MCP error envelope (`agent_not_ready`, "retry shortly") rather than block.

```ts
// Proposed (pseudo)
async function main() {
  // ...
  const serverReady = server.connect(transport);   // open stdio FIRST
  const agentReady  = agent.start();               // Hub registration in parallel
  await Promise.all([serverReady, agentReady]);    // both must complete before normal operation

  // Tool dispatch (separate handler):
  // if (!agent.handshakeComplete) return mcpError("agent_not_ready", "Hub handshake in flight; retry");
}
```

Two test additions to pin the contract:

1. **Ordering test.** Mock the Hub-handshake function to delay 2s; assert that `server.connect(transport)` resolves first (or at minimum within ms of process start, well inside Claude Code's `initialize` timeout).
2. **Race-window test.** Mock a tool call arriving on stdio at t=100ms while handshake is still in flight; assert the dispatch returns the structured `agent_not_ready` envelope (not a hang, not a crash).

## Cross-references

- **idea-152** (Smart NIC Adapter — MCP as Last-Mile Presentation; Cognitive Implant Transport Layer). Target-state replacement of the entire stdio + Hub-handshake plumbing; would absorb this bug. Does NOT supersede the fix because target state is mission-distance away and the review depends on a working adapter today.
- **bug-17** (clientName "unknown" from handshake — RESOLVED in `5e29ec5`). Adjacent (handshake content, not handshake ordering).
- **bug-18** (SSE dispatch reconnect — RESOLVED in `ace5cbd`). Adjacent (post-reconnect routing, not pre-reconnect startup).
- **bug-11** (cognitive exhaustion). Different layer (LLM tool-round budget, not stdio transport).

## Tele violations

- **tele-7** (Resilient Agentic Operations) — criteria 1 (silent failure), 4 (clean restart resume).
- **tele-6** (Frictionless Agentic Collaboration) — criterion 3 (Boundary-Blocking).
- **tele-9** (Chaos-Validated Deployment) — adapter startup not currently in the chaos battery; this bug is the kind of latency-sensitivity defect it is meant to catch.

## Discovery + provenance

- **Diagnosed by:** lily (architect agent), 2026-04-22 AEST during cold-start session.
- **Verified by:** greg (engineer agent), Hub-side log analysis showed handshake success at exactly the wall-clock of host-side failure; supports lily's mechanism.
- **Filed-into-Hub:** PENDING — `create_bug` will be invoked once draft is ratified by Director.
