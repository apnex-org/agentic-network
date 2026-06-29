# M-Adapter-Modernization — Brainstorm (DRAFT, accumulating)

**Status:** brainstorm-in-progress (Director priority, post-stint-6-SR, 2026-06-29). Multi-session "figure it out" BEFORE a formal Idea→Design. **Scope: Adapters FIRST, then Agent harnesses. Hub + Transport-protocol PARKED.**

**Origin:** the stint-6 strategic-review under-represented infra/deployment (candidate_A = the adapter membrane; deployment/containerisation never summited = a backlog gap). Director prioritized adapter-modernization directly. Live pain this session: the proxy *wedged* (Hub-session dropped, no auto-reconnect → manual kill+restart) + bug-203 tool-surface staleness + directory-source provenance-impurity (`sdkDirty`).

## North-star (Director, 2026-06-29) — ALL THREE, not a trade-off
1. **Pure resilience** — self-healing adapter; no silent wedge; no manual kill+restart; survives Hub blips/redeploys by construction. [tele-7 Resilient Ops · tele-9 Chaos-Validated]
2. **Clean reproducible distribution** — versioned / npm-published / reproducible installs; no directory-source / hand-rebuild / `sdkDirty`; provenance-honest. [tele-2 Isomorphic · tele-1 State-Transparency]
3. **Maximal shared core regardless of harness** — ONE adapter brain; per-harness pieces are thin glue. [tele-3 Sovereign Composition]

## Target architecture (implied) — thin-shim / fat-resilient-kernel / npm-distributed
- **`@apnex/network-adapter` = fat shared kernel:** ALL MCP↔Hub logic + the connection lifecycle (establish / heartbeat / **auto-reconnect** / self-heal) + version-honesty. Resilience lives here, ONCE, for every harness.
- **`@apnex/claude-plugin` / `@apnex/opencode-plugin` = THIN shims:** only the harness-specific binding (how the host mounts MCP tools + spawns the runtime). No brains. A new harness (cursor / a CLI / …) = a new thin shim over the same kernel — zero kernel duplication.
- **Distribution:** npm, pinned + reproducible (shim depends on a pinned kernel version; lockfile); provenance-honest (running version = kernel-sha + shim-sha, truthfully surfaced); directory-source becomes a **dev-only** affordance, never prod.

## Key tension — "pure resilience" has TWO flavors that split on solvability
- **Connection-resilience** (this session's wedge: the proxy's Hub-session dropped + never reconnected) → **KERNEL-SOLVABLE.** Robust auto-reconnect / backoff / self-heal in the shared kernel; transport-protocol-agnostic (doesn't touch the parked transport theme).
- **Tool-surface-resilience** (bug-203: claude-code won't re-enumerate the tool-surface mid-session; opencode does) → **HOST-LIMITED, not fully kernel-solvable.** Even a perfect kernel can't make claude-code re-read tools without a restart. Needs either a clean/scripted restart OR idea-391 (system CLI→Hub REST, sidestepping the MCP tool-surface). The one place the north-star hits a host wall.

## Open forks (to brainstorm)
- **(i) shim↔kernel boundary** — minimal shim vs maximal kernel; makes "maximal shared core" precise. [the SPINE — likely first]
- **(ii) resilience contract** — what auto-reconnect / self-heal / version-honesty the kernel guarantees + how it handles the bug-203 tool-surface wall.
- **(iii) distribution + migration** — the npm-pinned model + how we move off directory-source without disruption.
- **framing Q:** is idea-391 (CLI→Hub REST) in-scope for this, or do we design resilience *around* the MCP host-limit and treat 391 separately?

## Related entities
mission-64 (M-Adapter-Streamline; `update-adapter.sh`, the npm-model) · bug-203 (host won't re-enumerate tool-surface) · idea-392 (live auto-refresh / no-stale-caches / opencode-parity) · idea-391 (system CLI→Hub REST) · idea-390 (agent⟂project separation) · bug-184 (version-honesty) · candidate_A (the SR adapter summit) · `@apnex` npm namespace.

---
*Brainstorm log — appended as discussions progress. Becomes a formal Idea→Design once the shape settles.*
