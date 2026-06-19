# Envelope-Substrate Cutover Runbook (mission-90 W6)

**Status:** mission-90 W6 deliverable (Design §3.2 / §4 W6). REWRITTEN at execution-prep (2026-06-19) to the REAL prod-deploy mechanism (COS + Cloud Build + Artifact Registry + GCE metadata + Secret Manager + `startup.sh`) — the earlier draft wrongly assumed docker-compose + an explicit env-unset.
**Scope:** the one-time re-migration of residual legacy-flat rows to envelope shape + the envelope-only strict reader + the redeploy of the W1–W6 Hub image.

> **⛔ DIRECTOR-GATED — PROD-MUTATING.** The Director gave go-in-principle + execution-authorization (2026-06-19, option (c) downtime). EXECUTION still requires: the rewritten runbook REVIEWED by the architect + the (A)-solo-vs-(B)-paired deploy-access decision resolved + a scheduled announced window. Do NOT run Steps 2+ before that. The handling of the prod write credential (Secret Manager / the running-container env) is part of the prod-write authorization — only at execution, never as prep.

> **Downtime: a one-time ~90s PLANNED MAINTENANCE WINDOW (Director option (c)) — ANNOUNCE it.** Empirical (real-data clone, 2026-06-19): re-migration ~40s (1,488 bare; reset-once + single productive pass + confirm, with the bug-155 fix); composite ~66–75s. Image pre-pull (Step 1) keeps the bookends tight; it is OFF the downtime clock (Hub still up). Shadow-read parity (Step 0c) runs OFFLINE on a clone, off the critical path.

---

## Real topology (recon-verified 2026-06-19 — `modules/hub/*.tf` + `scripts/startup.sh` + cloud-deploy-rollback-runbook)
- Prod Hub = `ois-hub-prod`, a COS container on GCE **`hub-vm`** (zone `australia-southeast1-a`), started by the Terraform **metadata `startup.sh`** via direct `docker run` (NOT docker-compose). Sibling containers on the `hub-net` docker network: `ois-postgres-prod` (the substrate), `watchtower-prod` (non-functional).
- Image: Artifact Registry `australia-southeast1-docker.pkg.dev/labops-389703/cloud-run-source-deploy/hub:latest`, selected via the `hub-image` GCE metadata attribute.
- Secrets (incl. the postgres password → the write conn-string) fetched from Secret Manager by `startup.sh` at boot. The Hub's write conn-string (startup.sh:112): `postgres://hub:${POSTGRES_PASSWORD}@ois-postgres-prod:5432/hub`.
- Deploy is MANUAL via IAP-SSH (Watchtower can't auth to AR — W5/AG-W5.1). All `docker`/`psql` on hub-vm run under `sudo` (`(ALL) NOPASSWD: ALL` for the IAP SSH user).
- **STRICT-FLIP IS THE DEPLOY:** `hub/src/index.ts:127` — the W6 code is envelope-STRICT BY DEFAULT (tolerant only if `SUBSTRATE_ENVELOPE_TOLERANT === "true"`, which `startup.sh` does NOT set). So **deploying the W6 image IS the strict-flip** — there is no separate env-unset on a running container. The re-migration MUST converge to 0-bare BEFORE this redeploy (the strict reader makes any residual bare row unreadable).

## Access (dry-check 2026-06-19) + the A/B execution-ownership decision
- Engineer SA (`terraform@labops-389703`) = `roles/owner`; hub-vm sudo = `(ALL) NOPASSWD: ALL`; AR repo present; Cloud Build reachable. → access for **(A) engineer-solo** is cleanly available. NOTE: owner is a very broad grant for unsupervised prod use → the Director may prefer **(B) paired** (operator runs build+push+redeploy; engineer runs the data-migration + gates). **DIRECTOR decides A/B** (owns the IaC/deploy access). The steps below are annotated `[DEPLOY]` (A: engineer / B: operator) vs `[MIGRATE]` (engineer, both A & B).

## PREREQUISITES (the W6 image MUST carry these — else silent data-loss at cutover)
Empirically validated 2026-06-19 (131 rows on the prod snapshot would otherwise go envelope-blind-UNREADABLE after the strict redeploy):
- **bug-155 — `runKind` stable `ORDER BY id`** (offset-pagination silent-skip; 104 rows). With it, reset-ONCE + loop-until-0 converges in a SINGLE productive pass.
- **bug-154 — `--reset-checkpoints` (resetAllCheckpoints) + `--list-kinds`** (dirty-cursor lexical-skip trap; 27 rows).

Confirm the W6 image is built from `main` AT-OR-AFTER the #319 merge (`4dd22c3`) — both fixes present. Use the `--list-kinds`-derived verify-ALL-22 (NOT the drifted mission-88 `m-k8s-envelope-cutover.sh`).

---

## Step 0 — Pre-window prep (OFF the clock; reversible)
0a. `[DEPLOY]` **Build + push the W6 image** (Cloud Build → AR `hub:latest`):
```
OIS_ENV=prod scripts/local/build-hub.sh        # gcloud builds submit hub/ → AR hub:latest (from current checkout = main ≥ 4dd22c3)
```
Confirm the new `hub:latest` digest in AR (`gcloud artifacts docker images list .../hub --include-tags --sort-by=~UPDATE_TIME`). RECORD the PRIOR digest (the rollback image).
0b. `[DEPLOY]` **Pre-pull on hub-vm** (off the clock — Hub still up):
```
gcloud compute ssh hub-vm --zone=australia-southeast1-a --command='sudo bash -c "export DOCKER_CONFIG=/var/lib/hub/docker-config; HUB_IMAGE=$(curl -s -H \"Metadata-Flavor: Google\" http://metadata.google.internal/computeMetadata/v1/instance/attributes/hub-image); docker pull \"$HUB_IMAGE\""'
```
0c. `[MIGRATE]` **Step-0 GATE (clone, read-only):** fresh read-only snapshot (`pg_dump -Fc -U hub_reader -t entities`) → local throwaway clone → (i) shadow-read parity 100% (`shadow-read-parity-w6.test.ts` corpus) + (ii) reset-once + loop-migrate-until-0 converges to **0 bare outside exemptions**. **→ PING (a): GO/NO-GO for the window.** NO-GO ⇒ do not proceed.

## Step 1 — Pre-flight (Hub UP)
- Architect-reviewed runbook + A/B resolved + window announced.
- `[MIGRATE]` **Extract the write conn-string** from the running container (gated credential — do NOT echo/log it):
```
WRITE_CONN=$(gcloud compute ssh hub-vm --zone=australia-southeast1-a --command='sudo docker exec ois-hub-prod printenv POSTGRES_CONNECTION_STRING')
```

## Step 2 — Snapshot (in-window start; the abort restore-path)
```
gcloud compute ssh hub-vm --zone=australia-southeast1-a --command='sudo docker exec ois-postgres-prod pg_dump -Fc -U hub -d hub' > /tmp/hub-precutover-$(date +%Y%m%d-%H%M%S).dump
```
This `pg_dump` is the during-window abort restore-path.

## Step 3 — Hub-stop (downtime starts) — **PING (b) window-START**
```
gcloud compute ssh hub-vm --zone=australia-southeast1-a --command='sudo docker stop ois-hub-prod'
```

## Step 4 — Re-migrate with CURSOR DISCIPLINE (Hub down) `[MIGRATE]`
Run the W6 image as a one-shot on `hub-net` (it carries `dist/`). **Both fixes deployed ⇒ converges in ONE productive pass** (no reset-before-each-pass workaround):
```
# 4a. reset ALL checkpoints (bug-154):
gcloud compute ssh hub-vm --zone=australia-southeast1-a --command="sudo docker run --rm --network hub-net -e POSTGRES_CONNECTION_STRING='$WRITE_CONN' $HUB_IMAGE node dist/scripts/run-envelope-migration.js --reset-checkpoints"
# 4b. loop migrate until rowsMigrated=0:
#   sudo docker run --rm --network hub-net -e POSTGRES_CONNECTION_STRING='$WRITE_CONN' $HUB_IMAGE node dist/scripts/run-envelope-migration.js
#   parse SUMMARY '<N> total rowsMigrated'; repeat until N=0. HALT on any rowsErrored>0 (→ rollback).
```

## Step 5 — VERIFY (Hub down; the dispositive gate BEFORE the irreversible redeploy) — **PING (c)**
Read-only against prod psql (hub_reader): **0 bare rows outside the exemption set** (MigrationCursor by-design; SchemaDef MUST be 0 — a bare SchemaDef ⇒ the W1 boot-put regressed ⇒ HALT) across ALL 22 `--list-kinds`; per-kind count parity + content-hash spot-check.
- **HALT-GUARDS:** non-convergence (bare>0 outside exemptions) ⇒ the bug-155 fix is absent or the migrate under-delivered ⇒ **do NOT redeploy/strict-flip; abort-to-rollback (with the architect)**. rowsErrored>0 in Step 4 ⇒ rollback. **PING (c) with the 0-bare result — this gates the redeploy-commit.**

## Step 6 — Redeploy W6 = strict-flip + code (one step; the irreversible commit) `[DEPLOY]`
```
gcloud compute ssh hub-vm --zone=australia-southeast1-a --command='sudo bash -c "
  set -e
  export DOCKER_CONFIG=/var/lib/hub/docker-config
  HUB_IMAGE=$(curl -s -H \"Metadata-Flavor: Google\" http://metadata.google.internal/computeMetadata/v1/instance/attributes/hub-image)
  docker pull \"$HUB_IMAGE\"
  docker stop ois-hub-prod 2>/dev/null || true
  docker rm ois-hub-prod
  google_metadata_script_runner startup
"'
```
`startup.sh` recreates `ois-hub-prod` from `hub:latest` (= W6, STRICT by default) + re-fetched secrets. (Confirm `hub-image` metadata = the new W6 `hub:latest`; if pinned by digest, update it first.)

## Step 7 — Smoke (downtime ends) — **PING (d) window-COMPLETE**
- `curl -s https://<prod-proxy>/health` → `ok`; Hub logs show `envelope tolerance mode: STRICT`.
- a read tool (e.g. `list_missions`) returns; reconciler boots (SchemaDef status converges); a write-smoke lands envelope.
- bug-151/152 spot-check: an envelope scheduled-Message fires; an envelope-thread reply + envelope-tele retire work.
- **PING (d): Hub up + smoke green ⇒ cutover COMPLETE.**

---

## ROLLBACK (abort during Steps 3–6; with the architect, never solo)
1. Restore the Step-2 snapshot: `sudo docker exec -i ois-postgres-prod pg_restore --clean --if-exists -U hub -d hub < /tmp/hub-precutover-*.dump` (or via the GCS hourly snapshot).
2. `--reset-checkpoints` (clear cursors).
3. Redeploy the PRIOR image (Step-0a recorded digest): `gcloud artifacts docker tags add .../hub@sha256:<PRIOR> .../hub:latest` → Step-6 recreate.
4. Verify `/health` + a tool call. (Post-cutover-SUCCESS is fix-forward, per the mission-83 precedent.)

## WATCH PROTOCOL (ping architect + Director)
(a) Step-0c GATE (parity + convergence = GO/NO-GO) · (b) window-START (Step 3) · (c) Step-5 VERIFY 0-bare (BEFORE Step-6 redeploy-commit) · (d) window-COMPLETE (Step 7) OR rollback-triggered. Flag ANY HALT-guard trip or surprise → abort-to-rollback TOGETHER.

## Tooling reference (mission-90 W6 additions)
`npm run envelope-migrate -- --list-kinds | --reset-checkpoints | --dry-run [--json]`. Shadow-read harness: `shadow-read-parity-w6.test.ts`. Cursor-discipline proof: `migration-cursor-discipline-w6.test.ts`.

---

## Post-cutover learnings (mission-90 W7 fold — 2026-06-19 execution retro)

The W6 cutover executed successfully (bug-138 closed live), but the live run surfaced learnings to fold here:

- **bug-156 — in-window guard portability (`grep -oP`):** the down-path script parsed the migrate summary with `grep -oP` (Perl regex), which **COS grep does not support** → migrated/errored parsed empty → a FALSE `HALT_ROWSERRORED` fired even though the migrate succeeded (exit 0, 1491 migrated, 0 errored). LESSON: in-window the automated guards ARE the authority (the human is unreachable — see bug-157); a guard that false-trips is itself a hazard. Use a PORTABLE parser (`grep -oE` / `sed` / the `--json` summary), and on any HALT INDEPENDENTLY VERIFY the real condition (a read-only 0-bare query) before acting — do NOT blindly trust OR blindly distrust the guard.
- **bug-157 — comms-dark in-window human-GO is impossible:** stopping `ois-hub-prod` ALSO kills the MCP relay (the Hub IS the channel), so the watch-protocol's "PING (c) → human GO before redeploy" cannot be delivered mid-window. The in-window authority must be the automated gate (0-bare verify) + the operator's own judgment, NOT a Hub-MCP round-trip. Future: out-of-band comms (a non-Hub channel) OR fully-automated guards-as-authority. The human GO belongs at the PRE-window gate (Step 0c PING (a)), which IS deliverable (Hub still up).
- **Downtime retro (~4m46s vs the ~90s estimate):** the prod migrate ran slower than the local clone (docker-run-per-pass cold-starts + prod-PG), and the false-halt investigation + comms-dark handling added latency while the Hub was down. The ~90s estimate (from the faster local clone) was optimistic. For a re-run: pre-write a PORTABLE down-path script (bug-156), accept the automated 0-bare gate as in-window authority (bug-157), and budget the window from a prod-representative timing (not the local clone). Correctness was NOT compromised (rollback armed, not needed).
- **bug-158 — list_missions accessor residual (SHIPPED, closed live @ ~08:58Z):** the strict cutover exposed a W3 accessor-sweep gap (MISSION_ACCESSORS envelope-blind). Code-only fix → isolated FAST-TRACK hotfix (PR #322 squash `9f579f6`) → container-recreate off merged-main (image `edc4792`, NO migration — data already all-envelope) → live re-verify (`list_missions` 1/50/39/90 = oracle). Downtime <1min, no data-touch. This established the **CODE-ONLY redeploy class** below.

### CODE-ONLY redeploy class (post-cutover; from the bug-158 execution)
A reader-policy / code-only bug found AFTER the cutover redeploys WITHOUT the data machinery — NO snapshot, NO re-migration, NO `--reset-checkpoints`, NO shadow-read gate, NO 0-bare verify (data is untouched; only the image changes). Steps reduce to: **build off merged-main → recreate → live-verify.**
1. **Build:** `CI=1 OIS_ENV=prod scripts/local/build-hub.sh` → Cloud Build → AR `hub:latest`. RECORD the new digest (`CI=1` skips the unneeded local docker pull/tag).
2. **No metadata edit:** the `hub-image` GCE metadata is the `hub:latest` TAG (verified — not a pinned digest), so the recreate's `docker pull` auto-resolves the new digest. (If ever pinned by digest, update it first.)
3. **Recreate** (the only downtime; comms-dark — see the COS-safe primitive). Code-only, ~<1min.
4. **Live-verify = the gate:** the exact symptom-read vs the psql oracle; mismatch → rollback.

**Rollback-target precision (load-bearing lesson):** a CODE-ONLY redeploy rolls back to the **CURRENT RUNNING image** (the one being replaced), NOT the pre-cutover image.
- **Primary rollback = the prior W6 image** (`f02a9bb` for bug-158): re-tag it to `:latest` (`gcloud artifacts docker tags add .../hub@sha256:<PRIOR> .../hub:latest`) → recreate. Removes only the code change; returns to the exact known-good strict/all-envelope state; ZERO data risk (it has read the migrated data correctly since the cutover).
- **The pre-cutover image (`dd61d96`) is UNSAFE alone** vs migrated data — it is bare-shape-expecting, so deploying it over all-envelope data re-introduces envelope-blindness on the migrated reads. Valid ONLY in a full W6-unwind (image **+** `pg_restore` the rollback dump TOGETHER), which a code-only redeploy never needs.

**COS-safe recreate primitive (bug-156 generalized):** drive the recreate by **piping the script to `sudo bash -s` over stdin**, NOT by nesting it in `gcloud ssh --command="..."`. This is the get-entities.sh quote-safe pattern; it sidesteps both the ssh→bash quote-layering AND the COS-`grep` Perl-regex trap, and needs no output-parsing:
```
cat <<'RECREATE' | gcloud compute ssh hub-vm --zone=australia-southeast1-a --command='sudo bash -s'
set -e
export DOCKER_CONFIG=/var/lib/hub/docker-config
HUB_IMAGE=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/attributes/hub-image)
docker pull "$HUB_IMAGE"
docker stop ois-hub-prod 2>/dev/null || true
docker rm -f ois-hub-prod 2>/dev/null || true
google_metadata_script_runner startup
RECREATE
```
The `gcloud ssh` channel is independent of the Hub/MCP relay, so this single command completes even though stopping `ois-hub-prod` makes the relay comms-dark; verify afterward via psql (postgres stays up) + the restored relay. Health: `docker ps` shows `ois-hub-prod` Up on `hub:latest`; logs show `envelope tolerance mode: STRICT` + reconciler `N of N kinds applied; 0 failures` + `Listening on port 8080`.
