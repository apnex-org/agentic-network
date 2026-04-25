# OIS Agentic Network — Terraform Deploy

Two-plan structure as of 2026-04-22. Pre-split monolith archived under `archive-pre-split-2026-04-22/` for reference.

Mission-46 T1 (2026-04-24) added multi-environment support — see §Multi-environment layout below. Mission-46 T2 added the `deploy/new-environment-bootstrap.sh` wrapper that stands up a new env end-to-end; see the step-by-step runbook at [`docs/onboarding/multi-env-operator-setup.md`](../docs/onboarding/multi-env-operator-setup.md) for cold-operator instructions.

## Structure

```
deploy/
  base/                — Foundation tier: APIs, SA + IAM, GCS bucket, Artifact Registry
                         (long-lived; rarely destroyed; must apply first)
  cloudrun/            — Application tier: Hub + Architect services + public IAM
                         (frequently redeployed; sometimes destroyed; reads base outputs)
  build-hub.sh         — Cloud Build → Artifact Registry wrapper for the Hub container.
  deploy-hub.sh        — Cloud Run roll wrapper for hub-<env>.
  build-architect.sh   — Cloud Build → Artifact Registry wrapper for the Architect container.
  deploy-architect.sh  — Cloud Run roll wrapper for architect-<env>.
  archive-pre-split-2026-04-22/ — Pre-split monolith (not active)
```

## Multi-environment layout

Mission-46 T1 established per-env tfvars files under a single canonical tree + `OIS_ENV` selection convention. Scripts (build/deploy + scripts/local/*) default to `prod` when `OIS_ENV` is unset — existing single-env callers are byte-identical. A new isolated tenant drops a new `<env>.tfvars` next to `prod.tfvars` and uses `OIS_ENV=<env-name>` in every command.

```
deploy/base/env/
  prod.tfvars          — current env (gitignored; operator-populated)
  <env-name>.tfvars    — new isolated tenant; same shape as prod.tfvars
  prod.tfvars.example  — committed template
deploy/cloudrun/env/
  prod.tfvars          — current env (gitignored)
  <env-name>.tfvars    — new tenant
  prod.tfvars.example  — committed template
```

`OIS_ENV` name constraints: `^[a-z][a-z0-9-]*$`, max 20 chars — enforced by every script that reads it. Lowercase-DNS-safe to avoid mid-apply terraform failures on GCP resource-name validation.

Per-env Cloud Run service naming: `hub-<env>` and `architect-<env>`. `deploy-hub.sh` reads `hub_service_name` from tfvars if set; falls back to `hub-${OIS_ENV}`. Symmetric for architect.

## Apply order

**Base must be applied before cloudrun.** The cloudrun plan reads base outputs (service_account_email, state_bucket_name, registry_prefix) via `terraform_remote_state` pointing at `../base/terraform.tfstate`.

```bash
# First-time setup (fresh project) — use OIS_ENV to select the tfvars file:
ENV=prod   # or <your-env-name>

cd deploy/base
terraform init
terraform apply -var-file=env/${ENV}.tfvars

cd ../cloudrun
terraform init
terraform apply -var-file=env/${ENV}.tfvars

# Routine: update services without touching foundation:
cd deploy/cloudrun
terraform apply -var-file=env/${ENV}.tfvars

# Teardown services only (leaves foundation intact):
cd deploy/cloudrun
terraform destroy -var-file=env/${ENV}.tfvars
```

## Build + deploy scripts (OIS_ENV-aware)

```bash
# Typical mission-ship flow for the Hub container:
OIS_ENV=<env> deploy/build-hub.sh --tag "mission-XX-$(date -u +%Y%m%d-%H%M%S)"
# ... note the printed timestamped URI ...
OIS_ENV=<env> deploy/deploy-hub.sh --image "<printed-uri>"

# Same flow for the Architect container:
OIS_ENV=<env> deploy/build-architect.sh --tag "mission-XX-$(date -u +%Y%m%d-%H%M%S)"
OIS_ENV=<env> deploy/deploy-architect.sh --image "<printed-uri>"
```

All four scripts read only `project_id`, `region`, and service-name keys from the env's tfvars. They never read, print, or log secret material (hub_api_token / architect_global_instance_id).

## Local Docker Hub (scripts/local/)

`scripts/local/{build,start,stop}-hub.sh` are the local-dev equivalents — they build via Cloud Build + pull + tag `ois-hub:local`, launch a container named `ois-hub-local-<env>` on port 8080, and stop/remove on teardown.

```bash
OIS_ENV=<env> scripts/local/build-hub.sh
OIS_ENV=<env> scripts/local/start-hub.sh     # one container at a time enforced
scripts/local/stop-hub.sh                    # auto-detects the running env
```

Default `OIS_ENV` is `prod` — existing single-env operators see unchanged behavior.

## Cloud Build tarball staging (mission-50)

Mission-50 (closed 2026-04-25) codified the storage-provider tarball staging that `scripts/local/build-hub.sh` performs as a pre-build hook before `gcloud builds submit`. This section documents the rationale, mechanics, sunset condition, CI parity expectation, and ADR-024 boundary.

### Why

Hub depends on `@ois/storage-provider` (a sovereign package living at `packages/storage-provider/`) via `"file:../packages/storage-provider"` in `hub/package.json`. That ref works for local dev (`cd hub && npm install` walks up one level), but it breaks under Cloud Build: `gcloud builds submit hub/` uploads only the contents of `hub/`, so the `..` escape leaves the storage-provider source unreachable inside the build container. That's the failure mode bug-33 hit on the post-mission-49 redeploy attempt.

### How (transient swap)

`scripts/local/build-hub.sh` runs a pre-build hook before `gcloud builds submit`:

1. `npm pack --pack-destination "$HUB_DIR"` against `packages/storage-provider/` — produces `ois-storage-provider-<version>.tgz` inside `hub/` (filename auto-detected from `npm pack` stdout, so storage-provider version bumps require zero manual coordination).
2. `sed` substitutes the `file:../packages/storage-provider` ref → `file:./<tarball>` in a transient `hub/package.json` swap.
3. `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` regenerates `hub/package-lock.json` against the tarball resolution.
4. `gcloud builds submit "$REPO_ROOT/hub"` then uploads the prepared `hub/` directory.
5. A trap on `EXIT INT TERM HUP` restores `package.json` + `package-lock.json` to their committed state and removes the staged tarball — committed git state stays clean even on signal interrupt. Backups land in a `mktemp -d` outside `hub/` so the gcloud build context isn't polluted.

`hub/Dockerfile` permanently includes `COPY ois-storage-provider-*.tgz ./` before each `RUN npm ci` line in BOTH builder + production stages. The wildcard match keeps the line stable across storage-provider version bumps. `hub/.gitignore` permanently excludes `ois-storage-provider-*.tgz` so a staged tarball can never be accidentally committed.

`hub/.gcloudignore` permanently re-includes the staged tarball into the Cloud Build upload context. This file is load-bearing: `gcloud builds submit` falls back to `.gitignore` when no `.gcloudignore` is present, which means the tarball-exclusion in `hub/.gitignore` (intentional, to prevent accidental commits) silently propagates to the gcloud upload context too — the tarball gets staged locally, then dropped from the upload, and the Dockerfile's `COPY ois-storage-provider-*.tgz` step fails with `no source files were specified` inside the build container. That's the failure mode bug-36 hit at architect-side dogfood post-mission-50 T2 merge. `hub/.gcloudignore` is self-contained (does NOT use `#!include:.gitignore`); it mirrors the meaningful excludes (currently `node_modules/`) and explicitly re-includes the staged tarball via `!ois-storage-provider-*.tgz`. With this file present, gcloud uses it instead of `.gitignore` for upload-context filtering, and the staged tarball lands in the build container as expected.

### Stays clean in git

`hub/package.json` keeps `"file:../packages/storage-provider"` as the dev-mode source-of-truth; `hub/package-lock.json` stays at the file: resolution. Local dev (`cd hub && npm install`) is unchanged. The transient swap is invisible to anything outside the `build-hub.sh` process lifetime.

### CI parity note (forward-look)

`scripts/local/build-hub.sh` is the canonical Hub-build entry-point until idea-186 (npm workspaces adoption) lands and supersedes it. Future auto-redeploy mechanisms — including idea-197 / M-Auto-Redeploy-on-Merge when that ships — MUST invoke this script (or a workspaces-aware successor that inherits equivalent behavior) rather than calling `gcloud builds submit hub/` directly. Bypassing the script would re-introduce bug-33 (cross-package context trap on Cloud Build) and silently regress.

### Sunset condition

The tarball staging is a workaround. The sunset trigger: idea-186 (npm workspaces adoption) ratified + Hub migrated to workspace resolution. At that point, npm workspaces resolve the cross-package dependency natively; the tarball staging becomes dead weight. Cleanup at sunset:

- Delete the §"Storage-provider tarball staging (mission-50 T1)" section from `scripts/local/build-hub.sh`.
- Delete the `COPY ois-storage-provider-*.tgz ./` lines from `hub/Dockerfile` (both stages).
- Delete the `ois-storage-provider-*.tgz` line from `hub/.gitignore`.
- Delete `hub/.gcloudignore` entirely (the file becomes obsolete once the underlying tarball-staging mechanic is gone — there is nothing to re-include).
- Delete this `Cloud Build tarball staging` section from `deploy/README.md`.

`scripts/local/build-hub.sh` carries an inline `TODO(idea-186)` comment naming the sunset condition + cleanup steps so the trigger is discoverable from the workaround itself.

### ADR-024 boundary statement

Mission-50 does NOT amend [`ADR-024`](../docs/decisions/024-sovereign-storage-provider.md) (StorageProvider sovereign-package contract). The `@ois/storage-provider` 6-primitive contract surface is unchanged; the `capabilities.concurrent` flag is unchanged; both `LocalFsStorageProvider` and `GcsStorageProvider` implementations are untouched. The tarball staging is a build-pipeline pattern adapting AROUND the contract, not a contract change. Per methodology v1.0 §ADR-amendment-scope-discipline, ADR amendments are reserved for contract changes; deployment-pattern adaptations live in build-pipeline + runbook docs — i.e., here.

## Backends

Both plans use the **local backend** as of the split (state files kept in-dir). Migration to GCS remote backend is a planned future improvement — bucket exists (per-env `gs://<env>-state` or `gs://ois-relay-hub-state` for prod), so bootstrap will be straightforward once we cut over. Until then: do not operate simultaneously from multiple machines.

## Environment files

- `{base,cloudrun}/env/*.tfvars` — live values (gitignored via `env/*.tfvars`)
- `{base,cloudrun}/env/prod.tfvars.example` — committed templates; copy to `<env>.tfvars` per env

**Required secrets in `cloudrun/env/<env>.tfvars`:**
- `hub_api_token` — bearer token for Hub `/mcp` endpoint
- `architect_global_instance_id` — UUID identifying the Architect agent

**Per-env fields recommended in `cloudrun/env/<env>.tfvars`:**
- `hub_service_name = "hub-<env>"` (mission-46 T1 convention)
- `architect_service_name = "architect-<env>"` (mission-46 T1 convention)

**Per-env fields recommended in `base/env/<env>.tfvars`:**
- `state_bucket_name = "<project-id>-hub-state"` or similar uniqueness-guaranteed name (GCS bucket names are global-namespaced — don't reuse `ois-relay-hub-state` across envs)

## Local-fs Hub profile

Mission-48 (closed 2026-04-25) made `local-fs` the laptop-Hub prod default — bind-mounted host directory, single-writer, durable across container restart. ADR-024 §6.1 captures the profile reclassification (dev-only → also single-writer-laptop-prod-eligible).

**Properties:**

- **Default backend:** `local-fs` (mission-48 T2b). Override to `gcs` via `STORAGE_BACKEND=gcs`.
- **Default host path:** `${REPO_ROOT}/local-state/` (gitignored). Override via `OIS_LOCAL_FS_ROOT=<path>`.
- **Bind mount + uid/gid:** start-hub.sh bind-mounts the host path into the container at the same path and runs the container as host uid/gid (`docker run -u $(id -u):$(id -g)`). Bind-mount writes are host-owned and operator-inspectable; uid mismatch can't surface as a generic `EACCES` mid-mission.
- **Single-writer enforcement:** start-hub.sh permits only one `ois-hub-local-*` container at a time per host. Concurrent hubs against the same state dir will corrupt state — the enforcement script makes this hard to do accidentally. Cloud Run / multi-instance deployments must continue to use `STORAGE_BACKEND=gcs` (`concurrent:false` capability flag still rules out multi-writer profiles by contract).
- **Defense-in-depth writability check:** start-hub.sh shell-layer probes writability before `docker run`; Hub container also asserts writability internally and fail-fasts on `EACCES`/`EPERM` with a uid/gid-diagnostic message.
- **Bootstrap-required guard:** Hub startup under `STORAGE_BACKEND=local-fs` checks for `${OIS_LOCAL_FS_ROOT}/.cutover-complete`; refuses to start without it. The sentinel is written by `scripts/state-sync.sh` only after the post-copy set-equality invariant passes — Hub never operates on a half-bootstrapped state.
- **Reverse-sync:** `scripts/state-sync.sh --reverse --yes` pushes local-fs state UP to GCS — the rollback feeder. `--yes` required (canonical GCS state can be overwritten). Tmp-file artifacts (`.tmp.*`) and the local-fs-only sentinel are excluded from the upload by construction. Reverse direction does NOT touch the local sentinel.

## Cutover runbook (operator-facing)

Move a Hub from GCS-backed operation to local-fs-backed operation. Idempotent at every step. Required before first launch on the local-fs default.

### Pre-flight

| Check | Command | Expected |
|---|---|---|
| `gcloud` SDK installed + authenticated | `gcloud auth list` | active account listed |
| GCP project + region resolved | `cat deploy/env/prod.tfvars` | `project_id` + `region` populated |
| Docker daemon running | `docker ps` | exits 0 |
| `gsutil` accessible | `gsutil version -l` | gsutil + python paths printed |
| GCS bucket reachable | `gsutil ls gs://ois-relay-hub-state/` | object listing |
| Repo at current main HEAD | `git fetch && git status` | "up to date with origin/main" |

### Step 1 — Build the Hub image from current main

```bash
OIS_ENV=prod scripts/local/build-hub.sh
```

Cloud Build runs the build over the local `hub/` directory; pushes `:latest` to the env's Artifact Registry; pulls back to the host; tags locally as `ois-hub:local`. Re-runnable; idempotent.

Verify post-build:
```bash
docker image inspect ois-hub:local --format '{{.Created}} {{.Id}}'
# Expect: timestamp == current build minute; new SHA
```

### Step 2 — Bootstrap local-fs from GCS

```bash
scripts/state-sync.sh
```

Forward direction (GCS → local-fs); idempotent (re-run is a no-op). Output trail:
- gsutil rsync mirrors `gs://${BUCKET}/` → `${REPO_ROOT}/local-state/` (parallel; tmp-file exclusion via regex)
- Post-copy set-equality invariant verifies keyspace match between GCS + local
- `.cutover-complete` sentinel written ONLY after invariant green (timestamp + bucket + script commit + invocation epoch)

If the invariant fails, the script exits 1 with explicit `< / >` path-diff output; sentinel NOT written. Re-run after resolving (interrupted rsync, mid-flight GCS modification, or local writes during sync).

### Step 3 — Stop the prior container (if present)

```bash
docker ps --filter 'name=^/ois-hub-local' -q | xargs -r docker stop
docker ps -a --filter 'name=^/ois-hub-local' -q | xargs -r docker rm
```

(start-hub.sh's one-hub-at-a-time enforcement also handles this on launch — Step 3 is for explicit-cleanup operators who want a known-clean slate.)

### Step 4 — Start Hub against local-fs default

```bash
OIS_ENV=prod scripts/local/start-hub.sh
```

start-hub.sh's defaults pick up local-fs automatically (T2b flip). Output trail:
- Pre-flight: `mkdir -p` + writability probe on `${REPO_ROOT}/local-state/`
- `docker run -u $(id -u):$(id -g)` with bind mount of state dir
- Hub-side writability assertion + bootstrap-required guard pass
- `/health` returns 200 within ~5s

### Step 5 — Verify

```bash
curl -sf http://localhost:8080/health   # → {"status":"ok",...}
docker logs --tail 30 ois-hub-local-prod   # no FATAL/ERROR; "Using local-fs storage backend at: ..." line present
```

Optional Hub-restart verification (the load-bearing readback assertion captured in `docs/runbooks/m-local-fs-cutover-drills.md` §2): stop + start the container; re-enumerate entities; assert ID-set equality pre/post.

## Rollback runbook (operator-facing)

Roll back from local-fs to GCS-backed operation. Two scenarios; pick the one that matches.

### Scenario A — pure time-travel (no post-cutover writes to preserve)

If no entity creation / state mutation happened on local-fs since the cutover, the GCS-as-of-cutover snapshot is still authoritative. Just flip and restart:

```bash
docker stop ois-hub-local-prod && docker rm ois-hub-local-prod
STORAGE_BACKEND=gcs OIS_ENV=prod scripts/local/start-hub.sh
```

### Scenario B — preserve post-cutover writes (most common case)

If Hub has written entities to local-fs since cutover, those writes are NOT in GCS. Rolling back without first pushing them to GCS = silent data loss. Always do this:

```bash
# 1. Stop the local-fs Hub (stable local-state for reverse-sync).
docker stop ois-hub-local-prod

# 2. Push local-fs state UP to GCS — REQUIRES --yes (canonical GCS will be overwritten).
scripts/state-sync.sh --reverse --yes

# 3. Verify the post-cutover write landed in GCS.
gsutil ls gs://${BUCKET}/<entity-path>/
# (Spot-check whichever entity type you wrote during the local-fs window.)

# 4. Restart Hub on GCS backend.
docker rm ois-hub-local-prod
STORAGE_BACKEND=gcs OIS_ENV=prod scripts/local/start-hub.sh

# 5. Verify Hub returns the post-cutover entities via Hub-API.
curl -sf http://localhost:8080/health   # /health: ok
# (Use list_* / get_* MCP tools to spot-check the post-cutover writes.)
```

### Why `--yes` on reverse-sync

The reverse direction can clobber the canonical GCS state. Forgetting `--yes` was deliberately blocked: accidental invocation is the most expensive mistake (overwriting GCS with a partial / broken local-state). The flag forces explicit operator intent.

### Sentinel handling on rollback

The local `.cutover-complete` sentinel is NOT touched by reverse-sync — it reflects the LAST FORWARD bootstrap, not the last reverse upload. After a rollback:
- The local-state directory still has a sentinel from the original forward bootstrap.
- If an operator later forwards-bootstraps again (e.g., after upstream GCS state moved on), the new sentinel overwrites the old.
- Fresh-start scenarios: delete `local-state/` entirely, then run `scripts/state-sync.sh` to rebuild from GCS.

## Hub GCS state layout (post-mission-49)

Hub state is keyed under the env's state bucket (e.g. `gs://<env>-state` or `gs://ois-relay-hub-state` for prod). Mission-49 (2026-04-25) introduced a v2 audit namespace; pre-migration audit blobs are frozen-but-grep-accessible.

**Audit entries:**

- **Pre-2026-04-25 (legacy timestamp-ID format):** `gs://$bucket/audit/audit-${ISO-timestamp}.json`. Frozen — Hub no longer reads or writes here. Grep-accessible for forensic / archaeology purposes only.
- **Post-2026-04-25 (counter-ID format):** `gs://$bucket/audit/v2/audit-${N}.json` where `N` is the unpadded monotonic counter from `meta/counter.json`'s `auditCounter` field. Hub `list_audit_entries` API returns only this v2 namespace.

**Internal notifications (SSE fan-out + reconnect-backfill):**

- **Pre-AMP-cutover (legacy integer-id format):** any objects directly under `gs://$bucket/notifications/` that pre-date the v2 cutover. Frozen.
- **Post-AMP-cutover (ULID format):** `gs://$bucket/notifications/v2/${ulid}.json`. Hub reads/writes here exclusively. Mission-49 W9 preserved this namespace byte-identically (no second cutover; no migration script).

If you find blobs at any other path under `audit/` or `notifications/` outside these conventions, treat them as historical artifacts — they're not Hub-API-visible and won't affect the running system.

## Outstanding

- **Hub deploy pipeline (build + roll)** — COMPLETE as of mission-43 + mission-46 T1:
  - `deploy/build-hub.sh` — Cloud Build → Artifact Registry + `:latest` re-tag (OIS_ENV-aware as of mission-46 T1).
  - `deploy/deploy-hub.sh` — Cloud Run roll to a specified image (default `:latest`; OIS_ENV-aware service name as of mission-46 T1).

- **Architect deploy pipeline (build + roll)** — COMPLETE as of mission-46 T1:
  - `deploy/build-architect.sh` — mirror of build-hub for agents/vertex-cloudrun.
  - `deploy/deploy-architect.sh` — mirror of deploy-hub for architect-<env>.

- **New-environment bootstrap wrapper** — COMPLETE as of mission-46 T2: `deploy/new-environment-bootstrap.sh`. Single-command scaffold: takes `--project-id` + `--region` + `--env`, scaffolds per-env tfvars from templates (idempotent), auto-generates `hub_api_token` (openssl rand) + `architect_global_instance_id` (uuidgen), enables bootstrap GCP APIs, applies base terraform, builds + deploys Hub + Architect via the T1 wrappers, reports service URLs. Optional `--provision-local-key` flag generates an SA key JSON at repo root for local-dev (opt-in; default off). Secrets written to `.bootstrap-secrets-<env>.txt` (gitignored, chmod 600). Idempotent end-to-end; safe to re-run.

- **End-to-end `build.sh`** — historical successor (previously `archive-pre-split-2026-04-22/build.sh`, assumed monolithic apply in `deploy/` root) still needs a tracked wrapper that applies base + cloudrun in correct order and handles `deploy-ts` label bumps per service. Candidate script-rationalisation mission.

- **Remote state migration to GCS.** Move both plans' state files from local to `backend "gcs"` pointing at the env's state bucket. Separate future mission (explicitly pulled out of mission-46 scope to preserve M effort class).

- **Generic CloudRun lifecycle scripts.** Replace ad-hoc `start-architect.sh` / `stop-architect.sh` / `start-hub.sh` (historical names under `scripts/`) with a generic `cloudrun/{start,stop,delete}.sh <service-name>` pattern, OR delete them entirely now that the `deploy/deploy-*` wrappers cover the same ground.

- **bug-30 / idea-186 narrow-gate re-require.** PR #4 (2026-04-24) installed `continue-on-error: true` on 4 non-hub matrix cells in `.github/workflows/test.yml` as an interim CI unblock. Once bug-30 (adapter tarball deps + cross-package imports) lands via idea-186 (npm workspaces migration), re-add those cells to the `test` aggregator's `needs: [...]` list + delete `continue-on-error`. Time-box: 4 weeks from 2026-04-24.
