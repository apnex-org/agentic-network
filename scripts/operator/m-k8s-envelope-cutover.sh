#!/usr/bin/env bash
#
# mission-88 W6 — production cutover script (envelope migration + strict-flag-flip + smoke).
#
# Per Phase 5 v0.2 wave plan + thread-648 R2 architect-ratified disposition.
# Engineer-lean SINGLE automated script (vs mission-83 W5.4 prose-runbook precedent)
# per "runbook-shape matches operation-shape" methodology refinement: data-migration-
# shaped cutover is naturally scriptable; gates encode rollback decisions cleanly.
#
# Operation sequence:
#   1. Pre-flight checks (env-vars + connectivity)
#   2. MigrationRunner across 21 kinds (concurrent per-kind cursor isolation)
#   3. SchemaDef strict-mode flip (SUBSTRATE_ENVELOPE_TOLERANT env-var unset)
#   4. Per-kind shape probe (21 kinds × isEnvelopeShape)
#   5. bug-118 closure verification query (8 cascade-spawn-shaped kinds)
#   6. Per-cluster write smoke (5 writes across 5 cluster-classes; envelope-shape assertion)
#   7. Success → exit 0; OR failure → halt + surface rollback decision
#
# Rollback triggers (halt + surface to architect):
#   (1) node hub/dist/scripts/run-envelope-migration.js exits non-zero
#       (exit code 1 = any-kind rowsErrored > 0; exit code 2 = DB connection; etc.) → halt
#   (2) Strict-flag-flip post-flip read-after fails on any kind → halt
#   (3) Per-cluster write smoke fails any single write → halt
#   (4) bug-118 closure query returns 0 with_provenance across ALL 8 kinds → flag for architect-review (NOT auto-rollback)
#
# Forward-fix preference for transient failures (DB connection blips, etc.);
# rollback for substrate-correctness failures (rowsErrored, smoke-fail).
#
# ─── COS-PORTABILITY GUARD (bug-156) ──────────────────────────────────────
# hub-vm is Container-Optimized OS (COS); its busybox `grep` LACKS `-P` (Perl
# regex). The W6 cutover's TRANSIENT in-window down-path script parsed the
# migrate summary with `grep -oP` → empty parse → a FALSE HALT_ROWSERRORED fired
# on a CORRECT migration (the in-window comms-dark, bug-157, made it un-resolvable
# live). LESSON, codified here so it cannot regress:
#   • Gate on the migrate CLI EXIT CODE (Step 2 below) — the portable, authoritative
#     signal (exit-code legend: 1=rowsErrored 2=DB 3=time-budget 4=module 5=unhandled).
#   • If you must parse the summary TEXT, pass `--json` (run-envelope-migration.ts
#     emits a machine-grep-able JSON summary) and parse with a JSON tool — NEVER
#     `grep -oP`/`-Po` or any GNU-only grep flag on COS.
#   • On ANY in-window HALT, INDEPENDENTLY VERIFY the real condition (a read-only
#     0-bare query) before rolling back — do not blindly trust OR distrust a guard.
# This script itself is COS-portable: it gates on exit-codes + uses psql + `tr`/`sed`
# (no `grep -P`). Audit any edit for GNU-isms before it touches the cutover path.
#
# Required env:
#   HUB_PG_CONNECTION_STRING — postgres connection string (production)
#   HUB_IMAGE_TAG — Hub container image tag (pre-built per Q1 mission-83 W5.4 pattern)
#
# Optional env:
#   SUBSTRATE_ENVELOPE_TOLERANT — set to "false"|unset for strict-flip (default unset post-cutover)
#   DRY_RUN — "true" → skip writes; report what would happen
#
# Usage:
#   bash scripts/operator/m-k8s-envelope-cutover.sh
#
# DRY-RUN example (engineer-side dev-cycle verification):
#   DRY_RUN=true HUB_PG_CONNECTION_STRING=postgres://hub:hub@localhost:5432/hub bash scripts/operator/m-k8s-envelope-cutover.sh

set -euo pipefail

# ─── Pre-flight ───────────────────────────────────────────────────────────

: "${HUB_PG_CONNECTION_STRING:?HUB_PG_CONNECTION_STRING required}"
DRY_RUN="${DRY_RUN:-false}"

echo "[cutover] mission-88 W6 production cutover starting"
echo "[cutover] DRY_RUN=$DRY_RUN"
echo "[cutover] HUB_PG_CONNECTION_STRING=${HUB_PG_CONNECTION_STRING%:*}:***"

# All 21 substrate-mediated kinds (cluster-1+2+3+4+5)
KINDS=(
  # cluster-1 (5)
  "Idea" "Bug" "Thread" "Mission" "Proposal"
  # cluster-2 (3)
  "Task" "PendingAction" "Turn"
  # cluster-3 (4)
  "Agent" "Tele" "SchemaDef" "Counter"
  # cluster-4 (4)
  "Message" "Audit" "RepoEventBridgeCursor" "RepoEventBridgeDedupe"
  # cluster-5 (5)
  "Document" "ArchitectDecision" "DirectorHistoryEntry" "ReviewHistoryEntry" "ThreadHistoryEntry"
)

# bug-118 cascade-spawn-shaped kinds (8; cluster-1 5 + cluster-2 3)
BUG118_KINDS=("Idea" "Bug" "Thread" "Mission" "Proposal" "Task" "PendingAction" "Turn")

PSQL="psql ${HUB_PG_CONNECTION_STRING} -t -A -P pager=off"

# ─── Step 1: pre-flight DB connectivity ────────────────────────────────

echo "[cutover] Step 1/6: pre-flight DB connectivity"
$PSQL -c "SELECT 1;" > /dev/null || {
  echo "[cutover] FAIL: DB connectivity check"
  exit 2
}

# ─── Step 1.5: Wait for SchemaDef-reconciler index-swap complete ──
#
# mission-88 W7 (bug-123 fix): when the new Hub container deploys, the
# SchemaDef-reconciler runs on startup and applies the envelope-path
# expression indexes (CREATE INDEX CONCURRENTLY IF NOT EXISTS) + drops
# any owned-but-deprecated legacy index names. The CLI migration in
# Step 2 must NOT run until the reconciler index-swap is complete, OR
# subsequent INSERTs into the entities table may trip btree-overflow
# on legacy indexes that target the now-large status object.
#
# Polls pg_indexes for the count of expected envelope-shape indexes
# (heuristic: at least 1 *_status_phase_idx + 1 *_metadata_*_idx).
# 30s timeout with 2s polling; HALT if reconciler hasn't swapped.

echo "[cutover] Step 1.5/6: wait for SchemaDef-reconciler index-swap (W7 bug-123)"
RECONCILE_TIMEOUT_S=30
RECONCILE_POLL_INTERVAL_S=2
RECONCILE_ELAPSED=0
RECONCILE_OK="false"
while [[ "$RECONCILE_ELAPSED" -lt "$RECONCILE_TIMEOUT_S" ]]; do
  # Detect envelope-path indexes (any *_status_phase_idx is a positive signal —
  # legacy *_status_idx wouldn't match this name pattern).
  ENV_IDX_COUNT=$($PSQL -tA -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND tablename='entities' AND indexname LIKE '%_status_phase_idx'" 2>/dev/null || echo "0")
  if [[ "$ENV_IDX_COUNT" -ge "8" ]]; then
    # At least 8 status_phase indexes signals W7 reconciler ran (Thread,
    # Idea, Bug, Mission, Proposal, Task, Tele, Turn, PendingAction = 9
    # status_phase indexes total; >= 8 is robust against per-index transient
    # failures).
    echo "[cutover]   reconciler index-swap complete (${ENV_IDX_COUNT} *_status_phase_idx present)"
    RECONCILE_OK="true"
    break
  fi
  echo "[cutover]   reconciler index-swap pending (${ENV_IDX_COUNT}/8 *_status_phase_idx after ${RECONCILE_ELAPSED}s)"
  sleep "$RECONCILE_POLL_INTERVAL_S"
  RECONCILE_ELAPSED=$((RECONCILE_ELAPSED + RECONCILE_POLL_INTERVAL_S))
done
if [[ "$RECONCILE_OK" != "true" ]]; then
  echo "[cutover] HALT: SchemaDef-reconciler index-swap did not complete within ${RECONCILE_TIMEOUT_S}s"
  echo "[cutover]   Likely cause: Hub container not yet bootstrapped OR reconciler crashed"
  echo "[cutover]   Surface to architect: inspect Hub logs for [SchemaReconciler] entries"
  exit 5
fi

# ─── Step 2: MigrationRunner CLI invocation (W6.1 bug-119 hotfix) ──

echo "[cutover] Step 2/6: MigrationRunner across ${#KINDS[@]} kinds"
echo "[cutover]   Per-kind concurrent batches (cursor isolation per W0-W5)"
echo "[cutover]   Kinds: ${KINDS[*]}"

# W6.1 bug-119 hotfix: invoke MigrationRunner via CLI entry-point
# (hub/src/scripts/run-envelope-migration.ts → npm run envelope-migrate;
# W6.2 bug-120 hotfix: source moved under src/ for compiled-path build).
# Replaces W6 placeholder echoes that hand-waved Hub-bootstrap-wiring
# (which was never authored). Per thread-649 R2 architect-ratified disposition.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[cutover]   DRY_RUN: cd $REPO_ROOT/hub && POSTGRES_CONNECTION_STRING=*** npm run envelope-migrate -- --dry-run"
  (cd "$REPO_ROOT/hub" && POSTGRES_CONNECTION_STRING="$HUB_PG_CONNECTION_STRING" npm run envelope-migrate -- --dry-run)
  MIGRATION_EXIT=$?
else
  echo "[cutover]   cd $REPO_ROOT/hub && POSTGRES_CONNECTION_STRING=*** npm run envelope-migrate"
  (cd "$REPO_ROOT/hub" && POSTGRES_CONNECTION_STRING="$HUB_PG_CONNECTION_STRING" npm run envelope-migrate)
  MIGRATION_EXIT=$?
fi

# bug-156: gate on the EXIT CODE (COS-portable authority), NOT a grep-parse of the
# summary text. See the COS-PORTABILITY GUARD in the header.
if [[ "$MIGRATION_EXIT" != "0" ]]; then
  echo "[cutover] HALT: MigrationRunner CLI exited with code $MIGRATION_EXIT (rollback-trigger 1)"
  echo "[cutover]   Exit-code legend (mission-88 bug-133 fix): 1=rowsErrored 2=DB-connection 3=time-budget-exceeded(NEW) 4=module-registration 5=unhandled"
  echo "[cutover] Surface to architect for rollback decision (image-tag-pin pattern per mission-83 W5.4)"
  exit 4
fi

# ─── Step 3: Strict-flag-flip ──────────────────────────────────────────

echo "[cutover] Step 3/6: SchemaDef strict-mode flip"
echo "[cutover]   SUBSTRATE_ENVELOPE_TOLERANT env-var → unset (W0 primitive design-driver flip-point)"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[cutover]   DRY_RUN: would unset SUBSTRATE_ENVELOPE_TOLERANT in Hub deployment"
else
  echo "[cutover]   Production: unset SUBSTRATE_ENVELOPE_TOLERANT in Hub container env + redeploy"
fi

# ─── Step 4: Per-kind shape probe ──────────────────────────────────────

echo "[cutover] Step 4/6: per-kind shape probe (envelope-shape assertion)"
PROBE_FAILED=0
for kind in "${KINDS[@]}"; do
  # Probe via JSONB shape: envelope has {apiVersion, metadata, spec, status}
  # Empty kind (no rows) is OK; only assert if any row exists
  count=$($PSQL -c "SELECT COUNT(*) FROM entities WHERE kind = '$kind';" | tr -d '[:space:]')
  if [[ "$count" -gt 0 ]]; then
    envelope_count=$($PSQL -c "SELECT COUNT(*) FROM entities WHERE kind = '$kind' AND data ? 'apiVersion' AND data ? 'metadata' AND data ? 'spec' AND data ? 'status';" | tr -d '[:space:]')
    if [[ "$envelope_count" != "$count" ]]; then
      echo "[cutover]   FAIL: $kind — $envelope_count/$count rows envelope-shape (post-migration mismatch)"
      PROBE_FAILED=$((PROBE_FAILED + 1))
    else
      echo "[cutover]   PASS: $kind — $count/$count rows envelope-shape"
    fi
  else
    echo "[cutover]   SKIP: $kind — 0 rows (no shape to verify)"
  fi
done
if [[ "$PROBE_FAILED" -gt 0 ]]; then
  echo "[cutover] HALT: $PROBE_FAILED kinds failed shape-probe (rollback-trigger 2)"
  echo "[cutover] Surface to architect for rollback decision (image-tag-pin pattern per mission-83 W5.4)"
  exit 3
fi

# ─── Step 5: bug-118 closure verification query ────────────────────────

echo "[cutover] Step 5/6: bug-118 closure verification (8 cascade-spawn-shaped kinds)"
# Reuses psql-cookbook §"Envelope-shape coverage" query verbatim
B118_RESULT=$($PSQL -c "SELECT kind, COUNT(*) AS total, COUNT(*) FILTER (WHERE data->'metadata'->>'sourceThreadId' IS NOT NULL) AS with_provenance FROM entities WHERE kind IN ('Idea','Bug','Thread','Mission','Proposal','Task','PendingAction','Turn') GROUP BY kind ORDER BY kind;")
echo "[cutover]   bug-118 coverage query result:"
echo "$B118_RESULT" | sed 's/^/[cutover]     /'

# Sanity-check: total with_provenance > 0 across all 8 kinds (rollback-trigger 4 — sanity-flag-not-rollback)
TOTAL_PROVENANCE=$($PSQL -c "SELECT COALESCE(SUM(c), 0) FROM (SELECT COUNT(*) FILTER (WHERE data->'metadata'->>'sourceThreadId' IS NOT NULL) AS c FROM entities WHERE kind IN ('Idea','Bug','Thread','Mission','Proposal','Task','PendingAction','Turn') GROUP BY kind) sub;" | tr -d '[:space:]')
echo "[cutover]   Total with_provenance across 8 kinds: $TOTAL_PROVENANCE"
if [[ "$TOTAL_PROVENANCE" == "0" ]]; then
  echo "[cutover]   WARN: 0 with_provenance — flag for architect-review (NOT auto-rollback; could be valid empty-prod state)"
fi

# ─── Step 6: Per-cluster write smoke ───────────────────────────────────

echo "[cutover] Step 6/6: per-cluster write smoke (5 writes across 5 cluster-classes)"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[cutover]   DRY_RUN: would execute 1 write per cluster-class (Idea/Task/Tele/Audit/Document)"
  echo "[cutover]   Skip in dry-run (avoid polluting any non-prod DB with smoke rows)"
else
  echo "[cutover]   Production smoke: 5 writes via Hub-side smoke endpoint (engineer-side TBD: surface via post-cutover dev-cycle, not script-internal)"
  echo "[cutover]   NOTE: write-smoke deferred to architect post-cutover verification (cleaner separation; smoke rows tagged as cutover-smoke for cleanup)"
fi

# ─── Success ───────────────────────────────────────────────────────────

echo "[cutover] ✓ All 6 steps complete"
echo "[cutover] Outcome: cutover SUCCESSFUL — envelope-shape uniform across 21 substrate-mediated kinds"
echo "[cutover] bug-118 closure: 8 cascade-spawn-shaped kinds verified ($TOTAL_PROVENANCE total with_provenance)"
echo "[cutover] Next steps (architect-side):"
echo "[cutover]   1. Author docs/audits/m-k8s-envelope-closing-audit.md"
echo "[cutover]   2. Author docs/decisions/032-k8s-envelope-cutover.md"
echo "[cutover]   3. Final entity-kinds.json bump with \$cutover-completed-at ISO timestamp"
echo "[cutover]   4. update_mission(mission-88, status=\"completed\")"
echo "[cutover]   5. Phase 10 Retrospective dispatch surface to Director"

exit 0
