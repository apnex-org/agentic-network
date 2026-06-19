# Envelope-Substrate Cutover Runbook (mission-90 W6)

**Status:** mission-90 W6 deliverable (Design §3.2 / §4 W6). Authored at W6-prep (task-420).
**Scope:** the one-time re-migration of residual legacy-flat rows to envelope shape + the `SUBSTRATE_ENVELOPE_TOLERANT` envelope-only strict-flip + the manual redeploy of W1–W6.

> **⛔ DIRECTOR-GATED.** Steps 3 onward (Hub-stop → re-migrate → strict-flip → redeploy) are the **Phase 7 Release GATE**. Do NOT execute without the Director's explicit go. The W6-prep readiness report (`docs/reviews/m90-w6-prep-readiness-report.md`) is the evidence for that go. Steps 0–2 are clone-only prep.

> **Downtime budget:** <60s TOTAL OBSERVED (measured 47-57s composite at preflight; margin 3-13s — **image pre-pull is MANDATORY**). Shadow-read (Step 2c) runs OFFLINE on a clone, OFF the downtime critical path.

---

## Topology (per CLAUDE.md / mission-86)
Prod Hub = `hub-vm` (GCE) docker-compose (Hub + `ois-postgres-prod` + Watchtower) behind a Cloud Run nginx proxy. Deploy is **MANUAL** (Watchtower non-functional) via IAP-SSH. All `pg_dump`/`pg_restore`/`psql` run INSIDE the postgres container via `docker exec` (`HUB_PG_CONTAINER=ois-postgres-prod`).

---

## Step 0 — Pre-cutover prep (CLONE-ONLY, off-window)
0a. **Image pre-build/pre-pull** the W1–W6 Hub image to hub-vm so the redeploy (Step 5) is a near-instant container swap (do NOT rely on Watchtower). *Mandatory — the downtime margin assumes the image is already local.*
0b. **Snapshot → clone → shadow-read parity (§3.3):** `hub-snapshot.sh save` a fresh prod snapshot → restore into a throwaway testcontainers clone → run `shadow-read-parity-w6.test.ts`-style corpus against it. **100% parity (count + content-hash + every-renameMap-entry coverage) is the strict-flip gate.** Re-migration timing measured here vs the <60s budget.
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
**The dirty-cursor trap (preflight c2) silently under-migrates on a single pass. Both sub-steps are MANDATORY:**

4a. **Reset ALL checkpoints** (clears the lexical checkpoint-skip):
```
cd hub && POSTGRES_CONNECTION_STRING=... npm run envelope-migrate -- --reset-checkpoints
```
4b. **Loop the migrate until `rowsMigrated=0`** (single-pass under-delivers on dirty state; preflight: run-1=686, run-2=+5, runs 3-4=0):
```
while :; do
  OUT=$(cd hub && POSTGRES_CONNECTION_STRING=... npm run envelope-migrate -- --json)
  MIGRATED=$(echo "$OUT" | grep -o '"totalRowsMigrated":[0-9]*' | ...)   # parse summary
  [ "$MIGRATED" = "0" ] && break
done
```
Exit non-zero on any `rowsErrored>0` (rollback-trigger) or time-budget exit=3.

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
