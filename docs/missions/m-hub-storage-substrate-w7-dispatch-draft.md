# mission-83 W7 dispatch — Ship + operator runbook + bug-93 close + Phase 7 release-gate

**Status:** architect-pre-staged dispatch content (ready-fire on W6 completion)
**Dispatch target:** current active coord thread
**Dispatch shape:** thread-content directive per bug-94 workaround pattern
**Authored:** 2026-05-17 / lily (architect)
**Trigger:** W6 retirement ratify-completion

---

## Dispatch content (paste when W6 ratifies)

W6 ratified ✓ — FS+GCS+gcs-*.ts retired; substrate-only Hub; repo-event-bridge regression-gate passes; CI green. **W7 ship dispatch — mission-83 final wave.**

### W7 — Ship + operator runbook + psql cookbook + bug-93 close

**Mission:** mission-83 (M-Hub-Storage-Substrate) — Wave W7 (FINAL)
**Design ref:** Design v1.x §2.6 (operator-DX) + §4 W7 row (ship-criteria) + §6 AG-1..AG-7 (anti-goal carve-outs)
**Branch:** continue on `agent-greg/m-hub-storage-substrate`
**Pre-W7 verify:** W6 ratified; substrate-only Hub stable; FS+GCS code retired; all CI green

### W7 deliverables (5 substantive + 1 verification)

#### 1. Operator runbook finalization

`docs/operator/hub-storage-cutover-runbook.md`:
- Promote W5 working-draft to ship-quality
- Include: standard operations (boot/restart/snapshot/restore) + incident playbooks + capacity/scaling notes + R6 resource-bounds rationale (from W0.1 cookbook scaffolding)

`docs/operator/hub-storage-substrate-local-dev.md`:
- Promote W0.1 v0.1 scaffolding to ship-quality v1.0
- W6/W7-deliverable placeholders filled in
- Cross-link to runbook + cookbook + snapshot scripts

#### 2. psql forensic cookbook

`docs/operator/psql-cookbook.md` (per Design §2.6 Surface 2):
- Common forensic queries: all active threads / pending actions by engineer / recent activity / message-on-thread / mission-by-status / etc.
- Cross-kind queries (rare but documented)
- TOAST inspection, vacuum, EXPLAIN-ANALYZE hints
- escape-hatch positioning vs `get-entities.sh` daily-driver CLI

#### 3. CLI scripts

`scripts/local/get-entities.sh` (per Design §2.6 Surface 1):
- Direct-psql per N2 disposition (no HUB_TOKEN/HUB_URL)
- `HUB_PG_CONNECTION_STRING` env-driven
- `<kind> [--id=...] [--filter='k=v,...'] [--limit=N] [--format=table|json]` shape
- Filter translates to `data->>'k' = 'v'` clauses

`scripts/local/hub-snapshot.sh` (per Design §2.5):
- Wraps `pg_dump -Fc` directly (same direct-psql posture)
- `hub-snapshot.sh save <target-path>` + `hub-snapshot.sh restore <source-path>`
- Validation: schemaVersion compat before restore

#### 4. **bug-93 STRUCTURAL CLOSURE**

Per Design §10 cross-references + mission-83 raison-d'être. **Close bug-93 with reference to W5 cutover commit + W5 smoke matrix CPU-elimination evidence.**

bug-93 closure narrative:
> Structurally closed by mission-83 W5 cutover (commit `<W5-cutover-commit-hash>` 2026-05-1?). ScheduledMessageSweeper + MessageProjectionSweeper no longer hold O(N) listMessages/listThreads CPU pressure — substrate-watch primitive replaces poll-loop with event-driven model per Design v1.x §2.4. CPU pressure observed-eliminated post-cutover per smoke matrix monitoring (~74% idle → <X% expected). bug-93 PR #203 30s tick-throttle band-aid made obsolete by substrate-watch model and may be reverted in follow-on cleanup (separate idea-candidate).

Use `mcp__plugin_agent-adapter_proxy__update_bug` (architect-only) to flip bug-93 status: open → resolved.

#### 5. CLAUDE.md substrate notes update

Add to project CLAUDE.md (lightweight architectural note):
- Hub storage substrate post-W5: postgres + LISTEN/NOTIFY + JSONB + SchemaDef reconciler
- Operator-DX surfaces: `get-entities.sh` daily / `psql` cookbook / `hub-snapshot.sh` for backup
- Companion follow-on missions referenced: idea-295/296/297/298 (resourceVersion / audit / FK / cloud-deploy)

#### 6. Phase 7 release-gate (Director-approval)

Architect surfaces mission-83 readiness to Director:
- All 7 waves shipped (W0+W1+W2+W3+W4+W5+W6+W7)
- All acceptance criteria met
- bug-93 structurally closed; substrate observed-stable
- All Design v1.x ratify-criteria met
- 4 follow-on ideas filed (idea-295/296/297/298)
- 3 Hub-side bugs filed via mission-83 routine coordination (bug-94/95/96; Phase 10 retrospective material)
- Mission-83 status: ready for `update_mission(status="completed")` per Director-RACI

### W7 acceptance criteria

- [ ] `docs/operator/hub-storage-cutover-runbook.md` ship-quality
- [ ] `docs/operator/hub-storage-substrate-local-dev.md` v1.0 ship-quality
- [ ] `docs/operator/psql-cookbook.md` checked in + comprehensive
- [ ] `scripts/local/get-entities.sh` + `scripts/local/hub-snapshot.sh` functional + tested
- [ ] **bug-93 status flipped open → resolved with W5-cutover-commit ref + CPU-elimination evidence**
- [ ] CLAUDE.md substrate notes added
- [ ] All v1 acceptance gates pass; CI green at HEAD
- [ ] **Phase 7 release-gate surfaced to Director** (Director-side `update_mission(status="completed")` decision)
- [ ] Bilateral surface report final commit ladder + bug-93 close-commit + Phase 7 release-gate evidence

### Substrate state during W7

**LIVE.** Ship-quality docs + operator-DX surfaces + bug-93 close + Phase 7 release-gate. Substrate stable per Hub operational metrics since W5.

### Hand-off

W7 final wave: engineer ships ship-criteria deliverables + bug-93 closure + Phase 7 release-gate. **mission-83 substantive work ENDS at W7 ship.** Phase 8 (post-ship monitoring; days) + Phase 9 (in-flight refinements; weeks) + Phase 10 retrospective follow.

---

## Pre-dispatch checklist (architect-side, pre-fire)

- [ ] W6 ratified (FS+GCS+gcs-*.ts retired; repo-event-bridge regression-gate passes)
- [ ] Substrate stable for N hours since W5 (operator-judgment)
- [ ] Phase 10 retrospective notes draft ready (architect-side parallel work)

## Companion follow-ups (architect-side, post-W7-ship)

- File 4 follow-on missions/ideas: M-Hub-Storage-ResourceVersion (idea-295) / M-Hub-Storage-Audit-History (idea-296) / M-Hub-Storage-FK-Enforcement (idea-297) / M-Hub-Storage-Cloud-Deploy (idea-298) — verify all 4 already filed at v0.1 per F4 PROBE
- Phase 7 release-gate Director-approval coordination
- Phase 8 post-ship monitoring (substrate health metrics; bug-93 elimination confirmed-sustained)
- Phase 10 retrospective: file calibration candidates (bug-94/95/96 cluster + bilateral substrate-currency-discipline 3-instance pattern + per-wave-thread + repaste-on-pagination-block coord pattern + architect-side substrate-currency-verification failure pattern)
