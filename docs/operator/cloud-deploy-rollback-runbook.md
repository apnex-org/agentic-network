# Cloud-Deploy Rollback Runbook

**Mission:** mission-86 M-Hub-Storage-Cloud-Deploy Wave W4
**Status:** v1.0 — authored pre-cutover (Design v2.9 §4.14; OQ-11)
**Audience:** operator orchestrating — or backing out of — the W4 production cutover
**Owner:** architect engages operator; Director gates the cutover-window
**Scope:** manual rollback only. Scripted rollback is deferred to v1.1 (retro idea-fold candidate).

---

## When to use this runbook

The W4 cutover (`scripts/cloud/cutover-to-cloud.sh`) migrates the production Hub from
the local container to the cloud. If the cutover goes wrong, this runbook gets you back
to a working production Hub. Two independent failure modes — pick the matching scenario:

| Symptom | Scenario |
|---|---|
| Cutover failed mid-flight, OR the cloud Hub is unhealthy / state looks wrong post-cutover | **A — Cutover rollback** (revert to the local Hub) |
| Cutover migrated state fine, but the cloud Hub container is running a broken image | **B — Cloud-Hub image rollback** (roll the image, keep the migrated state) |

**Decide fast.** The rollback is near-lossless *only while little new state has accumulated
on the cloud Hub*. The cutover itself never writes to the local Hub — it only `pg_dump`-reads
it — so the local Hub's state is exactly as it was at drain-time. But any entity created on
the *cloud* Hub after cutover (agents reconnected, missions advanced) is discarded by a
Scenario-A rollback. The longer the cloud Hub serves, the more a rollback costs. If in doubt,
roll back early; re-cutting over later is cheap, recovering lost state is not.

---

## Scenario A — Cutover rollback (revert to the local Hub)

**Precondition this relies on:** the cutover script *stops* the local Hub (`docker stop`),
it does **not** remove it. The container and its postgres (`hub-substrate-postgres`, never
stopped) are intact. Re-starting is therefore fast and lossless.

### A.1 — Re-start the local Hub

```bash
docker start ois-hub-local-prod
```

`hub-substrate-postgres` was never stopped and still holds the full pre-cutover state, so
`docker start` (not a recreate) brings the Hub back exactly as it was at drain-time.

### A.2 — Verify the local Hub is healthy

```bash
curl -s localhost:8080/health        # expect {"status":"ok",...}
```

If `/health` does not return `ok` within ~30s, check `docker logs ois-hub-local-prod`.
If the container itself is unrecoverable, see **A.4 — deep recovery** below.

### A.3 — Revert the adapter URL + restart sessions

For each adapter shim (lily + greg), point the Hub URL back at the local Hub:

- Edit `<workdir>/.ois/adapter-config.json` → set `"hubUrl": "http://localhost:8080"`
- **or** unset / revert the `OIS_HUB_URL` env var (it overrides the config file)
- Restart the adapter session.

This is a config change only — not a plugin reinstall. Once both sessions reconnect to
`localhost:8080` and a first MCP call succeeds (e.g. `list_missions`), the rollback is done.

### A.4 — Deep recovery (only if the local container is unrecoverable)

If `ois-hub-local-prod` will not start at all, restore from the cutover snapshot — it was
uploaded to GCS by the cutover script before anything was stopped:

```bash
# Find the cutover dump (cutover/ prefix; lifecycle-exempt — it persists):
gsutil ls gs://labops-389703-hub-backups/cutover/

# Pull it down, then restore into a fresh local postgres + re-create the Hub:
gsutil cp gs://labops-389703-hub-backups/cutover/<hub-cutover-TS.dump> /tmp/
HUB_PG_CONTAINER=hub-substrate-postgres scripts/local/hub-snapshot.sh restore /tmp/<hub-cutover-TS.dump>
OIS_ENV=prod scripts/local/start-hub.sh
```

Then complete A.2 + A.3. This path is slower but loses nothing — the snapshot is the
exact drain-time state.

---

## Scenario B — Cloud-Hub image rollback

Use this when the cutover migrated state correctly but the cloud Hub container is on a bad
image. This rolls the *image* back without rolling back the cutover (the migrated state in
`ois-postgres-prod` is left untouched).

### B.1 — Identify the previous known-good image

`hub:latest` is a mutable tag, but Artifact Registry retains the full digest history.
List images newest-first and pick the digest that pre-dates the bad one:

```bash
gcloud artifacts docker images list \
  australia-southeast1-docker.pkg.dev/labops-389703/cloud-run-source-deploy/hub \
  --include-tags --sort-by=~UPDATE_TIME --format='table(IMAGE,DIGEST,TAGS,UPDATE_TIME)'
```

Record the previous-good `sha256:...` digest. (If W4-prep tagged images by commit SHA —
e.g. `hub:<commit>` — that tag is the legible alternative to the raw digest; either works.)

### B.2 — Re-point `hub:latest` at the known-good image

The cloud VM runs `ois-hub-prod` as a direct `docker run` from `modules/hub/scripts/startup.sh`
(COS — no docker-compose), pulling the `hub-image` metadata value (`hub:latest`). Roll back by
moving that tag to the known-good image, operator-side:

```bash
gcloud artifacts docker tags add \
  australia-southeast1-docker.pkg.dev/labops-389703/cloud-run-source-deploy/hub@sha256:<GOOD_DIGEST> \
  australia-southeast1-docker.pkg.dev/labops-389703/cloud-run-source-deploy/hub:latest
```

If rolling back to a SHA-tagged image — e.g. the W4 cutover image `hub:f35b08a` — pass that
tag as the source instead of the raw digest.

### B.3 — Redeploy the cloud Hub onto the rolled-back image

> **Watchtower note:** Watchtower auto-update is **currently non-functional** — it cannot
> authenticate to Artifact Registry (`denied: Unauthenticated request`; a known W5/AG-W5.1
> item). Restarting Watchtower will NOT pull the image. The redeploy is therefore manual —
> the steps below are the verified path (the same one the W4-prep image refresh used).

SSH to the VM and pull-then-recreate. `startup.sh` is idempotent — it recreates `ois-hub-prod`
from the `hub-image` metadata with secrets re-fetched from Secret Manager; the explicit
`docker pull` first is required because `docker run` alone reuses a cached `:latest`:

```bash
gcloud compute ssh hub-vm --zone=australia-southeast1-a --tunnel-through-iap --command='sudo bash -c "
  set -e
  export DOCKER_CONFIG=/var/lib/hub/docker-config
  HUB_IMAGE=\$(curl -s -H \"Metadata-Flavor: Google\" http://metadata.google.internal/computeMetadata/v1/instance/attributes/hub-image)
  docker pull \"\$HUB_IMAGE\"
  docker stop ois-hub-prod
  docker rm ois-hub-prod
  google_metadata_script_runner startup
"'
```

`ois-hub-prod` is recreated on the rolled-back image — verify via the checklist below.

**Important:** leave the good image as the current `hub:latest`. If a later `build-hub.sh`
re-pushes the bad code to `hub:latest`, the next manual redeploy would pick it up — confirm
the real fix is built + pushed before any further redeploy.

---

## Post-rollback verification checklist

- [ ] Target Hub `/health` returns `{"status":"ok",...}` (local `localhost:8080` for A; the
      Cloud Run URL for B)
- [ ] Entity count on the target Hub matches expectation (Scenario A: the pre-cutover
      baseline the cutover script logged; Scenario B: unchanged from post-cutover)
- [ ] Both agents (lily + greg) reconnected and a first MCP call (`list_missions`) succeeds
- [ ] For Scenario A: every adapter shim config shows `http://localhost:8080` again
- [ ] Architect notified on the mission thread; Director informed the cutover was rolled back
- [ ] Root cause captured in the mission work-trace before any re-attempt

---

## Notes

- **Scenario A is the primary, load-bearing path** — it is fast (~30s), needs no GCP
  mutations, and is lossless up to the drain-time state. Reach for it first.
- The cutover dump lives under the `cutover/` GCS prefix, which is **exempt** from the
  backup bucket's 30-day lifecycle rule (that rule matches `snapshots/` only) — so the
  drain-time snapshot persists as a permanent recovery point.
- Scripted rollback (a `rollback-from-cloud.sh` companion to `cutover-to-cloud.sh`) is
  deferred to v1.1 per OQ-11 — flag it as a retro idea-fold candidate.
