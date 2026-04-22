# BUG CANDIDATE — Concurrent MCP probe displaces live session identity

> **RESOLVED-BY-MISSION: m-session-claim-separation (mission-40)** — flipped `open → resolved` at T5 commit. fixCommits: `[18cde2d, a011fcd, dd1423c, 9e14ff7, <T5 commit>]`. See `docs/audits/m-session-claim-separation-closing-report.md` + `docs/decisions/021-identity-session-claim-separation.md`.

**Status:** **RESOLVED via mission-40** (2026-04-22). bug-26 Hub entity flipped `open → resolved`. Original filing context preserved below for forensic continuity. Authored 2026-04-22 by greg (engineer); diagnosis by lily (architect).
**Discovery context:** 2026-04-22 architectural review cold-start. While lily was debugging her own startup failure (see companion bug `bug-candidate-adapter-startup-race.md`), every `claude mcp list` she invoked bumped her Hub `sessionEpoch` and displaced the prior session — including her live session when she had one. greg's Hub-log read corroborated: `eng-40903c59d19f` epoch 7 → 14 entirely caused by lily's probe spawns.
**Why this doc exists (not yet a Hub Bug entity):** Same as the companion bug — locks wording while fresh.

---

## Severity / Class / Tags

- **Severity:** major
- **Class:** `identity-management` (subclass: `displacement-misuse`)
- **Tags:** `adapter`, `hub`, `identity`, `session-takeover`, `probe`, `observed-2026-04-22`, `lily-discovery`, `compounds-with:bug-candidate-adapter-startup-race`

## Symptom (observable)

A live agent session loses its Hub connection when an unrelated `claude mcp list` (or similar transient health-probe spawn of the same plugin) runs concurrently. Hub log shows `Agent displaced: eng-XXX epoch=N+1` triggered by the probe's handshake. The live session's SSE stream is closed; it must reconnect from scratch — and may itself trigger another displacement on retry, escalating into a churn loop.

## Mechanics (how it arises)

Every adapter spawn — including transient probe spawns from `claude mcp list`, `claude mcp ping`, plugin-health checks — runs the full Hub handshake unconditionally. The handshake derives the agent fingerprint from `sha256(OIS_INSTANCE_ID)` (the `~/.ois/instance.json` UUID is a fallback when the env var is unset, but the wrapper scripts always set the env var, so all spawns from a given `start-<name>.sh` share one fingerprint).

Because probe and session spawns from the same wrapper script collide on fingerprint, the Hub treats the second handshake as "newer session takes over from older" — increments `sessionEpoch`, evicts the prior `currentSessionId`, kills the prior SSE stream. This is the *correct* behavior for an actual session restart and is essential to the Agent reconnect contract (per workflow-registry §1.x and the Mission-19 routing model). It is the *wrong* behavior for a transient probe.

Lily's evidence in this session: `eng-40903c59d19f` (her real Agent record) bumped epoch 7 → 8 → … → 14 entirely from `claude mcp list` invocations during her debugging — none of those were intended session restarts.

## Rationale (why it matters)

- **tele-7 Resilient Agentic Operations (Blocked-Actor + Cascade-Bomb faults).** A transient diagnostic action — by definition a *probe*, intended to be observably idempotent on session state — is not. The operator faces a Heisenberg situation: looking at the system breaks the system. Tele-7 criterion 4 ("Adapters resume cleanly after rate limits and network drops") is technically satisfied (the live session *can* reconnect after a probe-induced eviction), but every reconnect is a few-hundred-ms window where SSE delivery drops, and the operator caused the disruption with what should have been a read-only action.
- **tele-3 Sovereign Composition (Logic Leakage fault).** The adapter's MCP server contract (respond to host probes about availability, capabilities, tool list) is leaking into its Hub client contract (session takeover, SSE binding). Two distinct concerns are conflated under one handshake codepath. The probe-vs-session distinction needs to be expressed explicitly — either at the protocol layer (a `probe: true` flag in the handshake payload) or at the adapter layer (don't handshake at all when invoked under probe mode).
- **tele-5 Perceptual Parity (operator side).** The operator wants visibility of plugin health (`claude mcp list` is exactly the right tool for that). Today they cannot exercise that visibility without breaking the live session — operator perception is in tension with operator non-interference. tele-5 criterion 1 ("Agents never ask 'what is the status of X?' — the system hydrates") implicitly requires that asking-about-status is itself harmless.

## Consequence

Any operator action that spawns the plugin — `claude mcp list`, `claude mcp ping`, plugin reload, terminal-side debugging, IDE-restart — silently breaks the live session's Hub connection.

**Compounds with the startup-race bug.** If the live session's reconnect triggers a fresh handshake that itself exceeds Claude Code's MCP initialize timeout (the startup-race condition), the operator's probe doesn't merely cause a brief reconnect — it causes a *terminal* loss of session. lily's actual experience this morning: each `mcp list` would either kill the live session outright or set up the next reconnect to fail. The two bugs are *individually* fixable but *together* explain why the failure mode looked unrecoverable.

## Reproduction

1. Start a healthy session via `./start-lily.sh` from her worktree; let it complete handshake.
2. From a separate shell on the same host, run `claude mcp list`.
3. Hub log shows `Agent displaced: eng-XXX epoch=N+1` within ~600 ms.
4. Live session's SSE stream closes immediately; subsequent SSE-driven notifications (task issuance, thread messages) won't arrive until the live session itself reconnects.

## Proposed fix paths

Three paths, in increasing principle / decreasing surgical-ness:

### Path 1 (recommended for surgical fix) — Adapter-side: probe mode

When invoked under `claude mcp list` or similar probe contexts, the adapter responds to MCP capability discovery without performing a Hub handshake. Detection options (any one suffices):

- The host's MCP `initialize` includes a clientInfo / capabilities signature that distinguishes probes from sessions (need to confirm by reading the MCP spec / `claude mcp list` source).
- A CLI hint: e.g. plugin runs differently when its parent process matches `claude mcp list` (process-tree introspection — fragile).
- A timeout-based heuristic: if no tool call arrives within N ms after `initialize`, exit cleanly; this naturally suppresses long-lived state.

**Pros:** entirely contained in the adapter; no Hub change; no protocol change; no other-agent change. Backward-compatible.
**Cons:** detection is heuristic — false positives (a real session that takes a moment to issue its first tool call) would silently lose Hub registration; false negatives (a probe that issues a tool call) would still displace.

### Path 2 (recommended medium-term) — Hub-side: probe-aware handshake

Add an optional `probe: boolean` flag to the `register_role` payload. When `true`:

- Hub records the probe in audit (`agent_probe_handshake` action) for observability.
- Hub does NOT increment `sessionEpoch`.
- Hub does NOT evict the prior `currentSessionId`.
- Hub returns a "probe-accepted" response shape so the adapter knows not to subscribe to SSE.

The adapter sets `probe: true` when invoked via `claude mcp list`-style detection (same heuristic as Path 1, but the failure mode of misdetection is gentler: missing the probe flag falls back to Path 1's situation).

**Pros:** principled; explicit in the protocol; preserves operator visibility into plugin health (the probe still confirms Hub-side reachability); makes the contract auditable.
**Cons:** Hub-side change required; touches `register_role` schema (needs `idea-121` API v2 alignment review); adapter still needs the same heuristic to set the flag.

### Path 3 (NOT recommended — semantic change too large for a bug fix) — Hub-side: same-fingerprint coexistence

Allow N concurrent sessions per fingerprint (cap small, e.g. 2). Displacement applies only when N is exceeded.

**Pros:** principled at the Hub identity layer.
**Cons:** large semantic change to the Agent FSM; breaks INV-AG3 implicitly (one fingerprint, one identity, one session); cascades into routing logic (`assignedEngineerId`, `currentTurnAgentId` pinning); deserves its own ratified architectural ramp, not a bug-fix-shaped delivery.

## Cross-references

- **idea-122** (`reset_agent` operator affordance — triage-pending). Related but distinct: idea-122 covers *deliberate* operator-side identity reset (clear a stuck Agent). This bug is about *silent* probe-induced displacement. Both are operator-side concerns; together they form a small "operator-controls-identity" cluster that idea-122 should absorb in scope when triaged.
- **bug-16** (Agent lifecycle gaps — RESOLVED in `9385290` + `6eacfca`). Covered the labels-not-refreshed-on-reconnect and the no-reaper cases. Did **not** cover probe-doesn't-displace. This bug is the uncaptured tail of the bug-16 class.
- **bug-18** (SSE dispatch cross-env drop — RESOLVED in `ace5cbd`). Adjacent (post-reconnect routing). Different.
- **idea-152** (Smart NIC Adapter — target state). Would absorb the entire identity-and-transport layer; doesn't supersede the bug-fix today.
- **idea-121** (API v2.0 tool-surface modernization). Path 2 above touches `register_role` schema; if Path 2 is chosen, it should be sequenced with idea-121's v2 envelope work to avoid double-touching the handshake protocol.
- **Companion bug:** `bug-candidate-adapter-startup-race.md` — these two bugs *compound*. Fixing one without the other meaningfully reduces the failure but doesn't eliminate it.

## Tele violations

- **tele-7** (Resilient Agentic Operations) — Blocked-Actor, Cascade-Bomb faults.
- **tele-3** (Sovereign Composition) — Logic Leakage between MCP server and Hub client roles within the adapter.
- **tele-5** (Perceptual Parity) — operator visibility breaks the system.

## Discovery + provenance

- **Diagnosed by:** lily (architect agent), 2026-04-22 AEST during cold-start session debugging.
- **Verified by:** greg (engineer agent), Hub-log read confirmed the epoch-bump pattern matches lily's `mcp list` invocations.
- **Filed-into-Hub:** **bug-26** (2026-04-22).
- **Resolution mission:** mission-40 (M-Session-Claim-Separation).

---

## Resolution

bug-26 was structurally resolved by mission-40 (M-Session-Claim-Separation) over 5 tasks shipped 2026-04-22 AEST:

| Task | Commit | Layer | Contribution |
|---|---|---|---|
| **T1** | `18cde2d` | Hub | Purely-additive `assertIdentity` + `claimSession` registry helpers + 4 audit actions wired internally; `register_role` behavior unchanged externally |
| **T2** | `a011fcd` | Hub | Protocol cutover — `register_role` becomes idempotent identity-only; new `claim_session` MCP tool; SSE-subscribe + first-tools/call back-compat auto-claim hooks |
| **T3** | `dd1423c` | Adapter | Lazy-claim refactor + `OIS_EAGER_SESSION_CLAIM=1` env hint declared by wrapper scripts; probes inherit env but don't go through wrappers, stay lazy, never trigger explicit claim |
| **T4** | `9e14ff7` | Adapter | Tool-catalog cache (`$WORK_DIR/.ois/tool-catalog.json`) — probes against warm cache touch zero Hub round-trips; cache invalidation by Hub version, atomic writes, schema-versioned |
| **T5** | `<T5 commit>` | Docs | Closing audit + ADR-021 + deprecation-runway dashboard spec + bug-26 entity flip |

**Resolution mechanism:** the `register_role` MCP tool was conflating two semantically-distinct operations (identity assertion + session claim) under one tool call. mission-40 split the protocol along that natural seam. Probes that assert identity but never claim sessions are now observably idempotent on Hub session state — the bug class is structurally impossible, not detection-dependent.

**ADR:** see `docs/decisions/021-identity-session-claim-separation.md` for the design decision + Consequences (notably the `currentSessionEpoch` semantics change that requires adapters to key takeover-detection on `sessionClaimed` + `displacedPriorSession` rather than epoch delta).

**Closing audit:** see `docs/audits/m-session-claim-separation-closing-report.md` for the full mission report, deliverable scorecard, audit-action inventory, observability surface, deprecation runway baseline, and findings (including sibling bug-27 + bug-28 that surfaced during mission execution).

**Companion bug already shipped:** see `docs/reviews/bug-candidate-adapter-startup-race.md` (commit `83b57e3`). Predates mission-40 but motivated the diagnostic context — fixed adapter startup race that compounded with bug-26 to make the failure mode unrecoverable.
