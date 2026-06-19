# Envelope-Substrate Cutover Runbook (mission-90 W6)

**Status:** mission-90 W6 deliverable (Design §3.2 / §4 W6). Authored at W6-prep (task-420).
**Scope:** the one-time re-migration of residual legacy-flat rows to envelope shape + the `SUBSTRATE_ENVELOPE_TOLERANT` envelope-only strict-flip + the manual redeploy of W1–W6.

> **⛔ DIRECTOR-GATED.** Steps 3 onward (Hub-stop → re-migrate → strict-flip → redeploy) are the **Phase 7 Release GATE** — PROD-MUTATING. The Director gave **go-in-principle** (downtime option (c), 2026-06-19), but EXECUTION requires a SEPARATE explicit Director **execution-authorization + scheduled window + prod-write/deploy access** (the W6-prep read-only snapshot grant does NOT cover execution). Do NOT run Steps 3+ without that explicit go. The W6-prep readiness report (`docs/reviews/m90-w6-prep-readiness-report.md`, incl. the empirical ADDENDUM) is the evidence. Steps 0–2 are clone-only prep.

> **Downtime: a one-time ~90s PLANNED MAINTENANCE WINDOW (Director-accepted option (c), 2026-06-19) — ANNOUNCE it.** Empirically measured on a fresh real-data clone (2026-06-19): re-migration ~40s (1,488 bare rows; reset-once + single productive pass + confirm, with the bug-155 fix), composite downtime ~66–75s (pg_dump ~20s + re-migrate ~40s + SQL verify + bookends ~15s). The original <60s budget was struck — 9 days of live-bare-writer growth pushed it over (1,488 bare now vs the preflight's 686). **Image pre-pull is MANDATORY** (keeps the bookends tight). Shadow-read parity (Step 2b) runs OFFLINE on a clone, OFF the critical path.

---

## Topology (per CLAUDE.md / mission-86)
Prod Hub = `hub-vm` (GCE) docker-compose (Hub + `ois-postgres-prod` + Watchtower) behind a Cloud Run nginx proxy. Deploy is **MANUAL** (Watchtower non-functional) via IAP-SSH. All `pg_dump`/`pg_restore`/`psql` run INSIDE the postgres container via `docker exec` (`HUB_PG_CONTAINER=ois-postgres-prod`).

## PREREQUISITES (the W6 image MUST carry these — else silent data-loss at cutover)
Empirically validated 2026-06-19; both close a silent-data-loss class (131 rows on the prod snapshot would otherwise go envelope-blind-UNREADABLE after the strict-flip):
- **bug-155 — `runKind` stable `ORDER BY id`** (migration-runner.ts): without it, the offset-pagination over an unordered list silently skips ~6-7%/pass under in-loop mutation (104 rows on the snapshot). With it, reset-ONCE + loop-until-0 converges in a SINGLE productive pass (the reset-before-each-pass workaround is NOT needed).
- **bug-154 — `--reset-checkpoints` (resetAllCheckpoints) + `--list-kinds`** (run-envelope-migration.ts): without resetCheckpoint-ALL, the dirty-cursor lexical-skip trap leaves rows whose ids sort `<=` a stale checkpoint un-migrated (27 rows on the snapshot: Bug/Task/Idea). `--list-kinds` is the single-authority for the KINDS array.

Confirm the deployed W6 image is built from `main` AT-OR-AFTER the #319 merge (both fixes present). The cutover uses the `--list-kinds`-derived loop + verify-ALL-22 below — **NOT** the drifted mission-88 `m-k8s-envelope-cutover.sh` (its hand-list misses Notification → a verify blind-spot).

---

## Step 0 — Pre-cutover prep (CLONE-ONLY, off-window)
0a. **Image pre-build/pre-pull** the W1–W6 Hub image to hub-vm so the redeploy (Step 5) is a near-instant container swap (do NOT rely on Watchtower). *Mandatory — the downtime margin assumes the image is already local.*
0b. **Snapshot → clone → shadow-read parity (§3.3):** `hub-snapshot.sh save` a fresh prod snapshot → restore into a throwaway testcontainers clone → run `shadow-read-parity-w6.test.ts`-style corpus against it. **100% parity (count + content-hash + every-renameMap-entry coverage) is the strict-flip gate.** Re-migration timing measured here vs the ~90s window (and confirm convergence to 0 bare outside exemptions — the dispositive correctness check).
0c. **Rollback rehearsal on the clone:** `pg_restore` the snapshot + `npm run envelope-migrate -- --reset-checkpoints` → confirm clean restore.
0d. **KINDS single-authority:** `cd hub && npm run envelope-migrate -- --list-kinds` → this list (22 kinds) is authoritative; do NOT hand-maintain a KINDS array.

## Step 1 — Pre-flight (Hub still UP)
1a. Confirm W1–W6 integration green at HEAD + the readiness report signed off.
1b. Confirm `POSTGRES_CONNECTION_STRING` / `HUB_PG_CONTAINER=ois-postgres-prod` reachable.
1c. Reconciler index-swap settled (W7 ownership-pattern indexes applied).

## Step 2 — Snapshot (in-window; abort restore-path)
`HUB_PG_CONTAINER=ois-postgres-prod hub-snapshot.sh save /tmp/hub-precutover-$(date +%Y%m%d-%H%M%S).dump`
This is the **abort restore-path** for Steps 3-5.

## Step 3 — Hub-stop
Stop the Hub container (downtime starts). Postgres stays up.

## Step 4 — Re-migrate with CURSOR DISCIPLINE (§3.2 step-3 — load-bearing)
**Both sub-steps are MANDATORY** (each closes a silent-data-loss class — see PREREQUISITES). With both fixes deployed, this converges in a SINGLE productive pass (no reset-before-each-pass workaround):

4a. **Reset ALL checkpoints** (bug-154 — clears the dirty-cursor lexical-skip trap so rows whose ids sort `<=` a stale checkpoint are not skipped):
```
cd hub && POSTGRES_CONNECTION_STRING=... npm run envelope-migrate -- --reset-checkpoints
```
4b. **Loop the migrate until `rowsMigrated=0`** (with the bug-155 ORDER-BY fix this is ONE productive pass + one confirm pass; loop-until-0 is the convergence guarantee, NOT a multi-pass requirement). Real-data clone 2026-06-19: pass-1 migrated 1,491 / 0 errored, pass-2 = 0 → converged, 0 bare outside exemptions.
```
while :; do
  OUT=$(cd hub && POSTGRES_CONNECTION_STRING=... npm run envelope-migrate -- 2>&1)
  MIGRATED=$(echo "$OUT" | grep -oP 'SUMMARY: \d+ kinds; \K\d+')   # total rowsMigrated
  echo "pass migrated=$MIGRATED"
  [ "$MIGRATED" = "0" ] && break
done
```
Exit non-zero on any `rowsErrored>0` (rollback-trigger) or time-budget exit=3. **If a pass leaves bare rows outside exemptions with `rowsMigrated=0` (non-convergence), HALT** — that signals the bug-155 fix is absent from the deployed image (offset-skip recurring); do NOT strict-flip.

## Step 4v — Verify (ALL 22 kinds; no Notification blind-spot)
- per-kind COUNT parity vs psql `data#>>'{status,phase}'` oracle;
- content-hash spot-check;
- **zero legacy-shape rows OUTSIDE the exemption set.** Exemptions: `MigrationCursor` (no migration module, by-design) + `SchemaDef` (expected ZERO post the W1 boot-put fix — **bare SchemaDef rows ⇒ the W1 fix regressed, HALT**). Verify across the `--list-kinds` 22, NOT the stale 21-kind hand-array.

## Step 5 — Strict-flip + redeploy
5a. Unset `SUBSTRATE_ENVELOPE_TOLERANT` (envelope-only reader; idea-320 surface — W6 flips, W8 deletes the tolerant parse).
5b. Redeploy the pre-pulled W1–W6 image (IAP-SSH manual container swap).
5c. Start the Hub (downtime ends).

## Step 6 — Post-start smoke (W7 owns full validation)
Boot OK; reconciler boots (SchemaDef status-writes converge per W5); a write-smoke through a tool path lands envelope; bug-151/152 liveness re-checked (envelope scheduled-Message fires; envelope-thread reply works; envelope-tele retire works).

---

## ROLLBACK (abort during Steps 3-5)
`pg_restore` the Step-2 snapshot via `hub-snapshot.sh restore` + `npm run envelope-migrate -- --reset-checkpoints` → redeploy the PRIOR image → start. (Post-cutover-SUCCESS is fix-forward, per the mission-83 substrate-introduction precedent.)

---

## Tooling reference (mission-90 W6-prep additions)
- `npm run envelope-migrate -- --list-kinds` — single-authority KINDS list.
- `npm run envelope-migrate -- --reset-checkpoints` — reset ALL cursors (Step 4a).
- `npm run envelope-migrate -- --dry-run [--json]` — inventory; no writes, no cursor advance.
- Shadow-read harness: `hub/src/storage-substrate/__tests__/shadow-read-parity-w6.test.ts` (point at the restored clone).
- Cursor discipline proof: `hub/src/storage-substrate/__tests__/migration-cursor-discipline-w6.test.ts`.
