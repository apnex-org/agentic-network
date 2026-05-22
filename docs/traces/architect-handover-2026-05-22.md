# Architect session handover — 2026-05-22

For a fresh architect (lily) session resuming after a session clear.
**On resume, read this first.**

Written 2026-05-22 PM AEST, after the 2026-05-22 housekeeping bug-batch
close-out.

## Recently completed — no action needed

- **Housekeeping bug-batch (2026-05-22)** — CLOSED. Seven bugs squashed across
  11 PRs (#238–#248), all cross-approved + CI-green:
  - **bug-109** — masked non-hub CI cells (two dead test harnesses + a dead
    CI-job config + stale fixtures). The 4 non-hub vitest cells were repaired
    and re-instated as blocking `test`-aggregator gates.
  - **bug-110** — pg error-handler crash-safety. The production Hub would
    crash on a postgres failover (unhandled `'error'` on idle pg connections);
    a canonical handler is attached at all 4 substrate pg sites.
  - **bug-111** — `get-agents.sh` resolved its Hub URL off the decommissioned
    `localhost:8080`.
  - **bug-112** — task-144 phantom `Pending actions: 2`. `create_review` now
    backfills `reviewAssessment` on a completed-but-unreviewed task.
  - **bug-113** — `list_available_peers` advertised-but-uncallable → pruned
    from the surface. It is permanently deprecated; `get_agents` is the sole
    canonical agent-state diagnostic.
  - **bug-115** — `get_thread` pagination. It now honors `offset`/`limit` and
    defaults to the newest 5 messages (was: the oldest 10, recent messages
    unreadable on long threads).
  - **bug-116** — opencode-plugin standalone `tsc` cleanliness.
  The three hub/src fixes (110/112/115) went live via a manual Hub redeploy to
  image `3d9b0b1` (~9s downtime) and were production-verified. Notable: **no
  production regressions** were hiding in the masked CI debt — it was
  test-infra rot. Full record: the bug entities + thread-610's converged
  summary + `docs/traces/housekeeping-bug-batch-work-trace.md`.
- **mission-86 (M-Hub-Storage-Cloud-Deploy)** — CLOSED. Production Hub on GCP.
- **bug-108 (Cloud Hub SSE reconnect storm)** — RESOLVED (v0.1.5 adapter
  reconnect-drain + the Cloud Run/nginx SSE timeout fix).
- **Folder-by-folder cleanup review** — done (PR #232 / #233 merged).

## Open — pick up here

- **bug-114** — tool-catalog cache staleness. Filed during the housekeeping
  batch as a non-urgent follow-on. Open, on the backlog.
- **Strategic Review — the main next focus.** Held for it: idea-306 (Rocky VM
  re-platform), idea-307 (fully-native plugin install), idea-308 (remove
  `deploy/base` + `deploy/cloudrun`), idea-309 (docs-currency pass). The
  Director flagged additional next-version requirements to fold in.
- **Ledger hygiene — grooming candidate** (none of it a live problem):
  - 5 missions stale-`active` (mission-24 / 25 / 36 / 38 / 43 — all April-era;
    none being actively driven; status never reconciled to
    `completed`/`abandoned`).
  - 3 mission-86 coordination threads stale-`active` (thread-592 / 595 / 597 —
    mission-86 itself is closed).
  - ~60 bugs `open` on the ledger, the bulk legacy / low-priority.
  A bug-and-mission-ledger grooming pass is a candidate for the Strategic
  Review or a dedicated cleanup.
- **ResponseSummarizer — latent design note.** bug-115's root cause was the
  cognitive-layer `ResponseSummarizer` middleware (a generic largest-array
  first-N truncator that also stamps an unconditional `Use offset=N` hint).
  Director-architect-reviewed: a real but latent design smell — `get_thread`
  was the only demonstrated victim and is fixed; for `list_*` tools the
  summarizer is messy-but-functional. Captured in bug-115's filing; revisit
  only if a second large-array tool surfaces as a victim.
- **Calibration candidate.** During the batch an (a)/(b) directional fork was
  built on bug-112's filing's unverified "queue" premise; the engineer's STOP
  caught that the premise was wrong. Candidate: *verify the shared premise
  before presenting a directional fork.* Surfaced to the Director; pending
  whether it becomes a ledger entry (calibration filings are Director-direct /
  architect-Director-bilateral, never LLM-autonomous).

## No thread awaiting an actionable architect reply

thread-607 round_limit-terminal; thread-608 / 609 closed; thread-610 converged
(the housekeeping batch). The 3 stale mission-86 threads carry no outstanding
architect action — they are ledger-hygiene (above).

## Environment

- **Production Hub:** image `3d9b0b1` (digest `sha256:cd6f9e…`). Watchtower
  auto-pull is down (bug-107) — Hub redeploys use the manual path: SSH the VM
  → `docker pull` → `docker stop`/`rm ois-hub-prod` → re-run `startup.sh`
  (digest-gate the pull before the stop).
- **Branch:** `agent-lily/main-sync`.
- **Adapter:** `@apnex/claude-plugin` v0.1.5 (verify currency if relevant).
- **Calibration ledger:** `docs/calibrations.yaml`.
- **No mission is being actively driven** (the 5 stale-`active` ledger entries
  notwithstanding — see Ledger hygiene).
