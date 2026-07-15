# Changelog — @apnex/pi-plugin

All notable changes to the pi host extension are documented here.

## 0.1.7 — P3 package-integrity and publish-lag isolation

### Added
- Adds a pi `package-integrity` regression suite mirroring the Claude package
  hygiene guard at the pi-native distribution seam: package `files[]`, scripts,
  facade-clean deps/peers, manifest validity, publish-family wiring,
  `version-rewrite` coverage, quickstart/changelog anchors, and `npm pack` dry-run
  contents are now pinned.

### Release boundary
- Version bump is intentionally narrow to republish `@apnex/pi-plugin` from current
  main after the pi uplift/cutover fixes, separating real capability deltas from
  earlier publish-lag observations.
- Full pi npm-distribution convergence remains deferred: unlike Claude's
  marketplace `install.sh` stack, pi is launched by OIS with an explicit
  `npm:@apnex/pi-plugin@...` package spec and per-seat config rendering. Any
  broader install/distribution redesign is deferred to follow-up `idea-535` instead
  of being folded into this reversible P3 hygiene slice.

## 0.1.5 — Publish idea-465 retry-gap hardening (HCAP Slice-1.x)

### Fixed
- Publishes the post-#552 PI HCAP retry-gap hardening for live fleet use: failed
  Hub-spec refreshes no longer mark a drift revision as applied, so the next
  heartbeat retries and live agents can converge after a transient first-refresh
  failure.
- Includes the reconnect/identity-ready refresh path and corrected HCAP comments
  from idea-465, enabling fleet verification of the `[hcap-source]` marker after
  the updated package is active.

### Release boundary
- Depends on the matching republished `@apnex/network-adapter` line; the publish
  flow rewrites the workspace `*` dependency to the concrete registry floor.

## 0.1.2 — Swarm-Aware Footer (mission-99)

The pi footer becomes swarm-aware — a zero-hot-path, 2-line status surface
rendered via the public `ctx.ui.setFooter()` seam (no pi-core fork). Ships
slices (a) spine + (b) peers/S4 + (c) F2 jitter. Conformant to
`docs/designs/m-swarm-footer/ratified-spec.md` v2.1; verifier-VALID +
architect-conformance-PASS on every slice.

### Added
- **Swarm footer spine (slice a)** — 2-line footer composed from pi-tui width
  primitives (`visibleWidth` / `truncateToWidth`), work/hub/context cells, honest
  degradation cascade (`hub [live]` / `[reconnecting]` / `?`). Render path makes
  ZERO Hub calls (gate 1).
- **Peers cell + authoritative S4 (slice b)** — `peers ◉◉◉` dot census
  (`get_agents` filtered `env=prod`, exception-biased: down peers →
  `[⚠ name down]`, self-excluded via canonical `id`), and role-scoped
  "needs-you" (S4) counts: engineer = my-turn active threads + `scopeToCaller`
  claimable work; architect = role-scoped `get_pending_actions` sub-array sum
  (NEVER `totalPending` — §12 catch#1). Authoritative counts retire the push-only
  `~tilde` approximation when the pull is fresh; degrade honestly to
  `⟶ ~✎N (stale)` / `needs ?` when stale — never a fresh all-clear masquerade.
- **Poll path on the heartbeat tick** — Tier-C swarm pull piggybacks the existing
  heartbeat (no new timer), inheriting the F2 ±20% jitter; coalesced reads/tick;
  backoff-on-error preserved; render stays zero-call.

### Fixed
- §12 catch#1: architect S4 no longer re-derives the polluted `totalPending`
  (dropped `unreviewedTasks` — phantom-inflated + double-counting).
- §8 self-exclusion reads the canonical `AgentProjection.id` (legacy `agentId`
  fallback), so the footer never lists self as a peer.
- §9 stale-S4 honesty: a stale/failed refresh can no longer render a fresh
  `nothing needs you` all-clear.

### Notes
- Slice (d) llm-retry ribbon remains deferred — prerequisite-gated on an upstream
  pi retry/backoff extension hook (idea-413). Not a 0.1.2 deliverable.
- Requires `@apnex/network-adapter` ≥ 0.1.6 (F2 per-agent poll/heartbeat jitter).

## 0.1.1 and earlier

Reference implementation of the sovereign tool-manager + native-binding
architecture: pi registers tools natively (`pi.registerTool`); every call routes
through the shared `runToolDispatch` authority in `@apnex/network-adapter`.
