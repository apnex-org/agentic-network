# Hub Storage Cutover Runbook

**Mission:** mission-83 M-Hub-Storage-Substrate Wave W5
**Status:** WORKING DRAFT (W7 finalizes)
**Audience:** operator orchestrating production cutover from FS storage to postgres `HubStorageSubstrate`
**Owner:** architect engages operator; Director ratifies cutover-trigger

---

## Pre-cutover prep checklist (W5-prep gate per Design §4 B1)

Before initiating cutover, verify ALL of the following:

- [ ] **W0 spike validated** — synthetic-state migration <60s TOTAL OBSERVED DOWNTIME (1.83s/10k entities measured)
- [ ] **W1-W4 integration tests green at HEAD** — `cd hub && npm test` reports 1329+ tests passing with zero regressions
- [ ] **Reconciler cold-boot complete** — applies all 20 SchemaDefs + per-kind expression indexes via `CREATE INDEX CONCURRENTLY IF NOT EXISTS`
- [ ] **Pre-cutover snapshot tooling tested** — `tar -czf` against representative state-tree completes within seconds
- [ ] **11 existing-sibling repository substrate-versions ready** (W4.x.1-11)
- [ ] **6 new-repository substrate-versions ready** (W4.x.12-17)
- [ ] **Operator has direct postgres access** to target substrate database (connection string + admin credentials)
- [ ] **Operator has Hub-stop / Hub-start orchestration capability** (whatever process supervision the prod Hub uses — pm2, systemd, docker-compose, etc.)
- [ ] **Disk space** at backup path ≥ 2× source state-tree size (snapshot + headroom)
- [ ] **Director-ratify** cutover-trigger authorization (Phase 7 release-gate pre-approval)

---

## Cutover orchestration sequence

**TOTAL OBSERVED DOWNTIME target:** <60s per Design §3.5 (inner-pipeline 1.83s + ~12-22s Hub-lifecycle bookends).

### Step 1 — Operator: Hub-stop

```bash
# (operator-specific; whatever the prod Hub supervision uses)
# e.g., docker-compose stop hub
# OR:   pm2 stop hub
# OR:   systemctl stop hub
```

**Verify:** Hub no longer responds on its bind port (curl/lsof/netstat). New requests return connection-refused.

**T+0 starts here** (TOTAL OBSERVED DOWNTIME timer).

### Step 2 — Operator: Pre-cutover snapshot

```bash
tar -czf /var/backups/hub-state-$(date +%Y%m%d-%H%M%S).tar.gz /var/lib/hub/local-state
```

**Verify:** Snapshot file exists; size matches `du -sh /var/lib/hub/local-state` × ~0.4 (gzip ratio typical).

### Step 3 — Operator: Migration script execution

```bash
cd /opt/hub
npm run migrate-fs-to-substrate -- \
  --source=/var/lib/hub/local-state \
  --target=postgres://hub:<password>@<host>:5432/hub \
  --backup=/var/backups/hub-state-$(date +%Y%m%d-%H%M%S).tar.gz \
  --skip-snapshot   # snapshot already taken in Step 2
```

**7-phase sequence per Design §3.1:**
1. Pre-cutover snapshot — SKIPPED via `--skip-snapshot`
2. Source scan — walk per-kind directories + JSON-array files; build inventory
3. Schema bootstrap — create `entities` table + sequence + base indexes (idempotent)
4. Reconciler primer — apply all 20 SchemaDefs; emit per-kind expression indexes
5. Bulk insert — batched `INSERT ... ON CONFLICT (kind, id) DO UPDATE` per kind
6. Verification — count parity (FS vs DB) + content-hash spot-check on random sample per kind
7. Cut signal — emit `.MIGRATION_COMPLETE` marker file at source

**Verify:** Migration script exits with status 0; final line "✅ WITHIN BUDGET"; `.MIGRATION_COMPLETE` marker present.

### Step 4 — Operator: Verification PASS

The migration script's Phase 6 verification is the dispositive gate. If verification reports failures, **DO NOT proceed to Hub-restart** — go to "Reverse-path runbook" below.

```bash
# Manual spot-check (optional)
psql postgres://hub:<password>@<host>:5432/hub -c \
  "SELECT kind, COUNT(*) FROM entities GROUP BY kind ORDER BY kind"
```

### Step 5 — Operator: Hub-restart with substrate flag

```bash
# Set HUB_STORAGE=substrate environment variable
export HUB_STORAGE=substrate
export HUB_SUBSTRATE_CONN=postgres://hub:<password>@<host>:5432/hub

# Start Hub
# (operator-specific; whatever the prod Hub supervision uses)
# e.g., docker-compose up -d hub
# OR:   pm2 start hub
# OR:   systemctl start hub
```

**Verify:** Hub responds on its bind port within ~5s; first request accepted; substrate-mode bootstrap validation in Hub logs:
- `[reconciler] SchemaDef-for-SchemaDef applied`
- `[reconciler] 20 SchemaDefs settled`
- `[Hub] Listening on :8001 (HUB_STORAGE=substrate)`

**T+end** (TOTAL OBSERVED DOWNTIME timer stops).

### Step 6 — Operator: Cutover wall-clock report

Record:
- T+0 timestamp (Hub-stop)
- T+end timestamp (first-request-accepted on substrate)
- Total wall-clock seconds
- Migration script reported wall-clock + per-kind breakdown
- Verification PASS evidence

---

## Reverse-path runbook (during-cutover abort recovery)

If verification fails OR Hub-restart fails OR post-cutover smoke matrix surfaces show-stopping issue, the engineer has a 30-minute window to revert to FS-storage cleanly.

### Reverse-path A: pre-cutover snapshot restore

```bash
# 1. Hub-stop (operator)
docker-compose stop hub  # or pm2 stop hub / systemctl stop hub

# 2. Restore source state-tree from snapshot
rm -rf /var/lib/hub/local-state
tar -xzf /var/backups/hub-state-<TIMESTAMP>.tar.gz -C /

# 3. Verify .MIGRATION_COMPLETE marker is absent (restored snapshot is pre-cutover)
ls /var/lib/hub/local-state/.MIGRATION_COMPLETE  # should NOT exist

# 4. Clear HUB_STORAGE env or set to fs explicitly
export HUB_STORAGE=fs

# 5. Hub-restart on FS storage
docker-compose up -d hub  # or pm2 start hub / systemctl start hub
```

### Reverse-path B: substrate cleanup (optional)

If you want to clean up the partial substrate state to retry cutover later:

```sql
-- WARNING: destructive; only run after pre-cutover snapshot restore is verified
DROP TABLE IF EXISTS entities CASCADE;
DROP SEQUENCE IF EXISTS entities_rv_seq;
```

---

## Post-cutover fix-forward disposition

Per Design §3.2: **rollback to FS not supported once Hub is restarted with `HUB_STORAGE=substrate` against migrated production state**.

After Step 5 (Hub-restart on substrate) succeeds, all subsequent writes go to substrate only. Any new entities created post-cutover are NOT mirrored to FS. The pre-cutover snapshot is now stale historical state.

**Fix-forward criteria** — proceed via fix-forward rather than reverse-path when:
- Hub-restart on substrate succeeded
- First-request-accepted on substrate
- Any post-cutover writes occurred (even a single client request creates substrate-only state)

**Fix-forward actions:**
- Issues with specific entity-kinds → handler-side fix + redeploy Hub (no data migration needed)
- Performance regression → tune postgres (work_mem / shared_buffers per W0.1 baseline)
- bug-93 sweeper-poll-pressure NOT eliminated → investigate sweeper substrate-version wiring (W3.x.1-4 sweeper-substrate-versions); not a substrate-correctness issue

---

## Pre-cutover prep checklist (W5-prep gate items detailed)

### Postgres operator config (per Design §2.2)

Verify postgres instance has:
- `max_connections >= 50`
- `shared_buffers = 256MB`
- `work_mem = 16MB`
- LISTEN/NOTIFY enabled (default; no config needed)
- JSONB column type support (postgres 9.5+; we use postgres:15-alpine)

### Backup retention policy

Pre-cutover snapshot MUST be retained per Design §3.2 disposition:
- **Minimum retention:** 30 days post-cutover
- **Storage location:** offsite backup recommended (S3 / GCS / equivalent); local backup acceptable for dev/staging
- **Access controls:** read-only to operator; no auto-rotation in first 30 days

### Director-ratify documentation

Director ratification of cutover-trigger should reference:
- mission-83 work-trace (engineer-side) at `docs/traces/mission-83-m-hub-storage-substrate-work-trace.md`
- Design v1.x at `docs/designs/m-hub-storage-substrate-design.md`
- W4.x ship-completion surface (thread-569)
- This runbook
- **Body-storage degradation note** (see below)
- bug-93 closure pathway (substrate eliminates sweeper-poll-pressure structurally)

---

## Failure mode → action mapping table

| Failure mode | Detection | Action |
|---|---|---|
| Migration script timeout (>60s) | Phase 5 wall-clock exceeds budget | Investigate per-kind throughput; consider `--resume-from=<slow-kind>` after tuning |
| Verification FAIL count parity | Phase 6 reports FS≠DB | Investigate per-kind discrepancy; common cause is malformed-JSON source files (script warns + skips) |
| Verification FAIL content-hash | Phase 6 reports content mismatch | Inspect specific entity; may be JSON canonicalization issue (object-key ordering) |
| `.MIGRATION_COMPLETE` marker absent | Phase 7 skipped | Verification FAILED at Phase 6; do NOT proceed to Hub-restart |
| Hub-restart fails to start on substrate | Hub logs error | Inspect substrate connectivity; verify HUB_SUBSTRATE_CONN env; check postgres logs |
| Hub starts but first-request-rejected | 500 errors from Hub | Inspect substrate-bootstrap; reconciler may be stuck applying SchemaDefs |
| bug-93 NOT eliminated post-cutover | CPU still 74% idle | Inspect sweeper substrate-version wiring; W3.x sweepers must be substrate-routed |
| **Body-storage degradation** | document-policy `read_document` 404 on substrate-stored item | Expected; idea-299 follow-on tracks resolution; degraded operator-DX behavior |

---

## Body-storage degradation note (W4.x.7-8 carve-out fold-in)

**KNOWN DEGRADATION post-cutover:**

Substrate-versioned `ProposalRepositorySubstrate` + `TaskRepositorySubstrate` **DO NOT** write proposal-body MD or task-report/review MD files (substrate-API has no blob primitive per Design §2.x). The `proposalRef` / `reportRef` / `reviewRef` fields on Proposal + Task entities are preserved as vestigial.

**User-visible impact:**
- `document-policy.read_document` MCP tool succeeds for legacy-stored Proposals + Tasks (FS files still present until W6 deletion)
- `document-policy.read_document` MCP tool FAILS (404) for substrate-stored Proposals + Tasks created post-cutover
- Proposal summary + Task report-summary still retrievable via entity body (subset of full MD body)

**Resolution path:** idea-299 M-Hub-Storage-BlobBody-Substrate filed as follow-on. Options under evaluation:
- (i) substrate-API blob primitive (`substrate.putBlob(path, bytes)` / `substrate.getBlob(path)`)
- (ii) new kinds `ProposalBody` / `TaskReport` / `TaskReview` with parent-id foreign-key
- (iii) external blob store integration (S3 / GCS)
- (iv) embed body inline on parent entity (bloat concern)

**Director-awareness:** Phase 7 release-gate Director-surface flags this known-degradation explicitly so Director ratifies with full awareness.

---

## Post-cutover smoke matrix (engineer-side test-fixtures inform; architect operates)

Per round-1 audit M2 fold-in. Runs against MIGRATED PRODUCTION STATE post-cutover:

- **Per-kind sweeper-end-to-end:** all 4 substrate-versioned sweepers (ScheduledMessage/MessageProjection/Pulse/CascadeReplay) fire against migrated entities; verify behavior parity vs FS-version
- **Per-kind handler-end-to-end:** create + read + list + update + delete via existing handler API per kind; verify behavior parity
- **Full-API-surface per kind:** get / put / delete / list / watch / CAS (createOnly + putIfMatch + getWithRevision); ~20 kinds × 6 ops = ~120 operation-surface validations
- **bug-93 sweeper-poll-pressure observed-eliminated:** CPU monitoring confirms ScheduledMessageSweeper + MessageProjectionSweeper no longer holding 74% idle CPU
- **NotificationRepository absorption verified:** notif persistence flows through substrate (Message kind="note" since mission-56 W5 closure already complete; NotificationRepository substrate-stub available for future use)

Smoke matrix execution scripts to be added at `hub/scripts/post-cutover-smoke-matrix.sh` (W7 finalizes).

---

## References

- Design: `docs/designs/m-hub-storage-substrate-design.md` (mission-83 architect-side)
- Migration script source: `hub/scripts/migrate-fs-to-substrate.ts` (W5.1 production-class)
- Migration spike: `hub/spike/W0/migrate-spike.js` (W0.3 1.83s baseline measurement)
- Entity-kinds inventory: `hub/scripts/entity-kinds.json` (v1.1 LOCKED 20 kinds)
- Local-dev cookbook: `docs/operator/hub-storage-substrate-local-dev.md` (W0.1 baseline)
- Mission work-trace: `docs/traces/mission-83-m-hub-storage-substrate-work-trace.md`
- bug-93 (sweeper-poll-pressure structural closure target): tracked in mission-83 W5 acceptance criteria
- idea-299 (M-Hub-Storage-BlobBody-Substrate follow-on): post-mission-83 body-storage resolution
