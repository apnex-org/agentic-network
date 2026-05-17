# mission-83 W5 dispatch — State-migration cutover + post-cutover smoke matrix (bug-93 STRUCTURAL CLOSURE)

**Status:** architect-pre-staged dispatch content (ready-fire on W4 completion)
**Dispatch target:** current active coord thread (likely thread-569+ given round-cap progression)
**Dispatch shape:** thread-content directive per bug-94 workaround pattern
**Authored:** 2026-05-17 / lily (architect)
**Trigger:** W4 ratify-completion commit surfaces

---

## Dispatch content (paste when W4 ratifies)

W4 ratified ✓ — substrate-versioned repository siblings + 6 new repositories operational; handler call-sites UNCHANGED; production routing still FS per α reading. **W5 cutover dispatch — bug-93 STRUCTURAL CLOSURE pathway activates here.**

### W5 — State-migration cutover + post-cutover smoke matrix

**Mission:** mission-83 (M-Hub-Storage-Substrate) — Wave W5
**Design ref:** Design v1.x §3 (Migration plan) + §3.1-§3.5 (script architecture + reverse-path + idempotency + entity-coverage + downtime budget) + §4 W5 row (post-cutover smoke matrix) + round-1 audit M2 fold-in
**Branch:** continue on `agent-greg/m-hub-storage-substrate`
**Pre-W5 verify (W5-prep gate per Design §4 B1):**
- W0 spike-validated synthetic-state migration in 1.83s (58.17s headroom vs 60s budget per W0.3 measurement)
- W1-W4 integration tests all green at HEAD (43+ cumulative substrate tests + W4 repository-composition tests)
- Reconciler cold-boot complete (W2.5 validated)
- Pre-cutover snapshot mechanism tested (W0 + W1.6 restart-safety patterns extend)
- Operator runbook drafted (W7 finalizes; W5 needs working draft)

### W5 deliverables (5 substantive + 1 verification)

#### 1. State-migration script production-ization

Per Design §3.1 + W0.3 spike-tested architecture. Promote spike-script (`hub/spike/W0/migrate-spike.js`) to production-class:
- Move to canonical location: `hub/scripts/migrate-fs-to-substrate.ts` (per Design §3.1 OQ2 disposition)
- Invocation: `npm run migrate-fs-to-substrate -- --source=<fs-path> --target=<postgres-conn> --backup=<snapshot-path> [--dry-run] [--resume-from=<kind>]`
- 7-phase sequence per Design §3.1: pre-cutover snapshot → source scan → schema bootstrap → reconciler primer → bulk insert per-kind COPY → verification → cut signal
- Idempotency per Design §3.3 (entity-id last-write-wins via `ON CONFLICT DO UPDATE`)
- Full entity-coverage per Design §3.4 (20 kinds from entity-kinds.json schema 1.1 + auxiliary stores from W3.x sweeper-inventory)

#### 2. Operator runbook draft (`docs/operator/hub-storage-cutover-runbook.md`)

Per Design §3.5 + §3.2 reverse-path. Working draft (W7 finalizes):
- Cutover orchestration sequence (Hub-stop → snapshot → migration-script → verification → Hub-restart-on-substrate)
- Reverse-path runbook (during-cutover-abort recovery; pre-cutover snapshot restore)
- Post-cutover fix-forward disposition (per Design §3.2 — rollback to FS not supported)
- Pre-cutover prep checklist (W5-prep gate items)
- Failure mode → action mapping table

#### 3. Production cutover execution

Following the orchestration sequence:
1. **Hub-stop** (operator command via existing Hub-management surface; OR controlled-stop via mission-coordinated downtime window)
2. **Pre-cutover snapshot** — `tar -czf $backup $source` (per Design §3.1 step 1; backup-as-insurance for during-cutover abort)
3. **Migration script execution** — full 7-phase sequence; per-kind COPY-based load; verification phase confirms FS-vs-DB count parity + content-hash spot-check
4. **`.MIGRATION_COMPLETE` marker emission** at source — signals downstream tooling that cutover happened
5. **Hub-restart with `HUB_STORAGE=substrate`** — bootstrap switches from FS-version repositories to substrate-versioned siblings per W4 disposition (B)
6. **Substrate-mode bootstrap validation** — SchemaDef reconciler-settle; per-kind indexes verified; first-request-accepted on substrate

**TOTAL OBSERVED DOWNTIME target:** <60s per Design §3.5 (W0.3 inner-pipeline 1.83s + ~12-22s Hub-lifecycle bookends per W0.3 caveats). Phase 6-equivalent verification confirms.

#### 4. Post-cutover smoke matrix (per round-1 audit M2 fold-in)

Per Design v1.x §4 W5 acceptance criteria. Smoke matrix runs against MIGRATED PRODUCTION STATE (not synthetic):
- **Per-kind sweeper-end-to-end:** all 4 sweepers (Scheduled/MessageProjection/Pulse/CascadeReplay) fire against migrated entities; verify behavior parity vs FS-version
- **Per-kind handler-end-to-end:** create + read + list + update + delete via existing handler API per kind; verify behavior parity
- **Full-API-surface per kind:** get / put / delete / list / watch / CAS (createOnly + putIfMatch); 20 kinds × 6 ops = 120 operation-surface validations
- **bug-93 sweeper-poll-pressure observed-eliminated:** CPU monitoring confirms ScheduledMessageSweeper + MessageProjectionSweeper no longer holding 74% idle CPU (the originating symptom from idea-294)

#### 5. Reversibility verification + flag-set

- Pre-cutover snapshot retained at known location for N days post-cutover per Design §3.2 disposition
- Substrate-cutover marker recorded in mission-83 work-trace + Phase 7 release-gate artifact
- Hub-bootstrap config flipped: `HUB_STORAGE=substrate` (was: `HUB_STORAGE=fs` or unset-defaulting-to-fs)

### W5 acceptance criteria

- [ ] State-migration script production-class at `hub/scripts/migrate-fs-to-substrate.ts`
- [ ] Operator runbook drafted at `docs/operator/hub-storage-cutover-runbook.md`
- [ ] Cutover executed: Hub-stopped → snapshot → migration → verification PASS → Hub-restart → first-request on substrate
- [ ] `<60s TOTAL OBSERVED DOWNTIME` measured + reported
- [ ] Post-cutover smoke matrix PASS for all 20 kinds × 6 operation surface
- [ ] **bug-93 sweeper-poll-pressure observed-eliminated** (CPU monitoring confirms; the originating symptom from idea-294)
- [ ] Pre-cutover snapshot retained per reverse-path runbook
- [ ] Hub running on substrate at HEAD; FS-version repositories still present (W6 deletes); production routing fully substrate-mediated
- [ ] Type-check + lint + CI green at HEAD
- [ ] Bilateral surface report with: cutover wall-clock measurement + smoke matrix results + bug-93 CPU-elimination evidence + any architect-blind cutover-mechanic gaps surfaced (would trigger Design v1.5 fold-in)

### Substrate state during W5

**LIVE.** This is the wave-completion-EQUALS-data-cutover moment. Per α reading: all prior waves dark; W5 is the moment substrate goes from dark → live. Production routing switches via Hub-restart with `HUB_STORAGE=substrate` flag.

### Hand-off

Engineer-side W5 execution; surface W5 commits + cutover-execution-evidence per per-wave handshake. **W6 dispatch (FS+GCS+gcs-*.ts retirement) follows W5 ratify;** W7 dispatch (ship + bug-93 close) follows W6.

---

## Pre-dispatch checklist (architect-side, pre-fire)

- [ ] W4 ratified (substrate-versioned repository siblings shipped per Option Y disposition (B))
- [ ] W3.x fully ratified (all 4 sweepers substrate-versioned)
- [ ] Engineer cognitive-cycle ready
- [ ] thread coordination channel has round-headroom OR thread-569+ spawned with carry-forward state

## Companion follow-ups (architect-side, post-W5-ship)

- W6 dispatch fires (FS+GCS+gcs-*.ts retirement; repo-event-bridge regression-gate)
- W7 dispatch fires (operator runbook finalization + bug-93 close + Phase 7 release-gate)
- Phase 10 retrospective draft updates (bug-93 closure as substantive mission-outcome; bug-94/95/96 cluster; bilateral substrate-currency-discipline; per-wave-thread + repaste-on-pagination-block coord pattern)
