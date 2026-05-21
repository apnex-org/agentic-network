# Architect session handover — 2026-05-21

For a fresh architect (lily) session resuming after a session clear. Written
2026-05-21 PM AEST, after the bug-108 close-out + housekeeping-bug lodging.
**On resume, read this first.**

## Recently completed — no action needed

- **mission-86 (M-Hub-Storage-Cloud-Deploy)** — CLOSED (`completed`). Production
  Hub on GCP: GCE VM (postgres substrate) fronted by a Cloud Run nginx proxy.
  Phase 10 retrospective done; calibrations #79–#82 filed.
- **Folder-by-folder cleanup review** — done. PR #232 (vertex-cloudrun /
  architect-agent dead-cluster removal) + PR #233 (`clients/`, `machines/`,
  `tests/`, `scripts/` dead code) merged.
- **bug-108 (Cloud Hub SSE reconnect storm)** — RESOLVED. Primary fix: v0.1.5
  adapter lossless reconnect-drain (PR #234), verified live via an organic
  drain-path hit. Secondary fix: Cloud Run + nginx SSE timeout 300s→3600s
  (PR #236), applied via a 2-step redeploy (proxy-image rebuild + `terraform
  apply` → Cloud Run revision `hub-api-00002-k5t`). Work-trace close-out
  PR #237 merged. Storm calmed dispositively — 125 `sse_watchdog` reconnects
  pre-apply → zero for 10h+. thread-607 holds the full record (labelled
  `round_limit` — cosmetic bug-48; substantively converged).

## Open — pick up here

**Housekeeping bugs filed 2026-05-21 (architect-owned, none urgent):**
- **bug-110** — `vitest (hub)` flaky: `substrate-counter.race.test.ts`
  pg-teardown race (minor; may fold into bug-109).
- **bug-111** — `scripts/local/get-agents.sh` broken: defaults to the
  decommissioned `localhost:8080` local Hub (major — broken operator diagnostic).
- **bug-112** — task-144 stuck `enqueued` → phantom "Pending actions: 2"; no
  force-close for FSM-bypassed stale tasks (minor).
- **bug-113** — `list_available_peers` advertised but not callable (minor).
- **bug-109** — test-infra debt (greg-filed; PolicyLoopbackHub harness +
  opencode baseline).

**Ideas on the backlog:**
- **idea-309** — docs-currency pass (ARCHITECTURE.md + onboarding/sdk-guide
  staleness; folder-review folder-9 finding).
- **idea-308** — remove `deploy/base` + `deploy/cloudrun` (gated on migrating
  `scripts/local/{start,build}-hub.sh` config off `deploy/cloudrun/env/`).
- **idea-306** (Rocky VM re-platform) + **idea-307** (fully-native plugin
  install) — held for the next Strategic Review. The Director has flagged
  **additional next-version requirements** to fold into that review.

## Next likely focus

The next Strategic Review (idea-306 / 307 / 308 / 309 + the Director's
next-version requirements), and/or the architect-owned housekeeping bugs above.
No mission active. No thread awaiting an actionable architect reply (thread-607
is `round_limit`-terminal — cosmetic bug-48; cannot and need not be replied to).

## Environment

- Adapter: v0.1.5 (`@apnex/claude-plugin`, commit `18c8e34`) — current.
- Branch: `agent-lily/main-sync`; worktrees synced to `origin/main` post-#233
  (the canonical `agentic-network` worktree's `main` fast-forward was the
  operator's step — verify if relevant).
- Calibration ledger `docs/calibrations.yaml` — 73 entries (#79–#82 from
  mission-86's retrospective).
