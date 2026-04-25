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

## Local-fs Hub state directory (post-mission-48 T2b)

Mission-48 T1 (2026-04-25) wired the `local-fs` Hub profile into `scripts/local/start-hub.sh` for single-writer-laptop-prod use. T2a added a cutover-bootstrap script with a post-copy set-equality invariant + `.cutover-complete` sentinel. T2b flipped the laptop-Hub default from `gcs` to `local-fs` and added a bootstrap-required guard at Hub startup. ADR-024 §6.1 captures the profile reclassification.

- **Default backend:** `local-fs` (mission-48 T2b — was `gcs` through T2a). Operators must run `scripts/state-sync.sh` once before first launch to bootstrap from GCS + write the sentinel; Hub fail-fasts otherwise.
- **Default host path:** `${REPO_ROOT}/local-state/` (gitignored). Override via `OIS_LOCAL_FS_ROOT=<path>`.
- **Rollback to GCS:** set `STORAGE_BACKEND=gcs` explicitly before `scripts/local/start-hub.sh`. Full rollback runbook (including manual reverse-sync via T2c when post-cutover writes need to land in GCS first) lands under T4.
- **Bind mount:** start-hub.sh bind-mounts the host path into the container at the same path; the container `OIS_LOCAL_FS_ROOT` env resolves identically inside.
- **uid/gid:** the container runs as host uid/gid (`docker run -u $(id -u):$(id -g)`) to keep bind-mount writes host-owned and operator-inspectable.
- **Single-writer enforcement:** `scripts/local/start-hub.sh:148-161` enforces one `ois-hub-local-*` container at a time per host. Concurrent hubs against the same state directory will corrupt state — the enforcement script makes this hard to do accidentally.
- **Defense-in-depth writability check:** the start-hub.sh shell-layer pre-flights writability before `docker run`; the Hub container also runs an internal writability assertion in `hub/src/index.ts` and fail-fasts on `EACCES`/`EPERM` with a uid/gid-diagnostic message.
- **Bootstrap-required guard (T2b):** Hub startup under `STORAGE_BACKEND=local-fs` checks for `${OIS_LOCAL_FS_ROOT}/.cutover-complete`; refuses to start without it. The sentinel is written by `scripts/state-sync.sh` only after the post-copy set-equality invariant passes — guarantees Hub never operates on a half-bootstrapped or never-bootstrapped state directory. Fresh-start scenarios: `state-sync.sh` against an empty bucket trivially passes the invariant and writes the sentinel.
- **Reverse-sync (T2c):** `scripts/state-sync.sh --reverse --yes` pushes local-fs state UP to GCS — the rollback path. `--yes` is required because the reverse direction can overwrite the canonical GCS state; accidental invocation is the most expensive mistake. The reverse path uses the same set-equality invariant as forward; tmp-file artifacts (`.tmp.*`) and the local-fs-only sentinel (`.cutover-complete`) are excluded from the upload by construction. Reverse direction does NOT touch the local sentinel — it reflects the LAST FORWARD bootstrap, not the last reverse upload.

Operator first-launch flow:
```bash
# One-time: bootstrap the local-fs state directory from GCS
scripts/state-sync.sh
# (.cutover-complete sentinel written; invariant verified)

# Subsequent launches: default backend is local-fs
scripts/local/start-hub.sh
```

Operator rollback flow (when post-cutover writes need to land in GCS first):
```bash
# 1. Stop the local-fs Hub so reverse-sync sees a stable local-state.
scripts/local/stop-hub.sh

# 2. Push local-fs state UP to GCS (--yes required — overwrites canonical state).
scripts/state-sync.sh --reverse --yes

# 3. Restart Hub explicitly under the GCS backend.
STORAGE_BACKEND=gcs scripts/local/start-hub.sh
```

Full cutover + rollback runbook lands under mission-48 T4.

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
