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

## Cloud Build tarball staging (mission-50 + task-386 extension)

Mission-50 (closed 2026-04-25) codified the sovereign-package tarball staging that `scripts/local/build-hub.sh` performs as a pre-build hook before `gcloud builds submit`. Task-386 (2026-04-26) extended the codification to cover a second sovereign package (`@ois/repo-event-bridge`) added by mission-52 T3 — same root cause, same fix shape, generalized to a loop over all sovereign packages. This section documents the rationale, mechanics, sunset condition, CI parity expectation, and ADR-024 boundary.

### Why

Hub depends on multiple sovereign packages — `@ois/storage-provider` (`packages/storage-provider/`) and `@ois/repo-event-bridge` (`packages/repo-event-bridge/`) — via `"file:../packages/<pkg>"` refs in `hub/package.json`. Those refs work for local dev (`cd hub && npm install` walks up one level), but they break under Cloud Build: `gcloud builds submit hub/` uploads only the contents of `hub/`, so the `..` escape leaves the sovereign package sources unreachable inside the build container. That's the failure mode bug-33 hit on the post-mission-49 redeploy attempt; task-386 catches the same gap retroactively for the second sovereign package introduced by mission-52 T3.

### How (transient swap)

`scripts/local/build-hub.sh` runs a pre-build hook before `gcloud builds submit`. The mechanic is a loop over all sovereign packages declared in the `SOVEREIGN_PACKAGES` array (`<package-name>:<source-dir>` entries):

1. For each entry: `npm pack --pack-destination "$HUB_DIR"` against `packages/<pkg>/` — produces `ois-<pkg>-<version>.tgz` inside `hub/` (filename auto-detected from `npm pack` stdout, so package version bumps require zero manual coordination).
2. For each entry: `sed` substitutes the `file:../packages/<pkg>` ref → `file:./<tarball>` in a transient `hub/package.json` swap.
3. `gcloud builds submit "$REPO_ROOT/hub"` uploads the prepared `hub/` directory. The container then resolves its own dep tree at build time (Dockerfile uses `npm install`, not `npm ci` — see "Why no host-side lockfile regen" below).
4. A trap on `EXIT INT TERM HUP` restores `package.json` to its committed state and removes ALL staged tarballs — committed git state stays clean even on signal interrupt. The script does NOT touch `package-lock.json` (T5 fix; see below). Backup of `package.json` lands in a `mktemp -d` outside `hub/` so the gcloud build context isn't polluted.

`hub/Dockerfile` permanently includes one `COPY ois-<pkg>-*.tgz ./` line per sovereign package before each `RUN npm install` line in BOTH builder + production stages. The wildcard match keeps the lines stable across version bumps. `hub/.gitignore` permanently excludes each `ois-<pkg>-*.tgz` pattern so staged tarballs can never be accidentally committed.

Adding a third sovereign package = append one entry to `SOVEREIGN_PACKAGES` in `build-hub.sh` + add matching `COPY ois-<pkg>-*.tgz ./` lines to `hub/Dockerfile` (both stages) + add matching exclusion to `hub/.gitignore` + add matching `!ois-<pkg>-*.tgz` re-include to `hub/.gcloudignore`.

### Why no host-side lockfile regen (bug-38)

Earlier mission-50 iterations regenerated `hub/package-lock.json` on the host before `gcloud builds submit` (T1 used `npm install --package-lock-only`; T4 used full `npm install`). Both produced lockfiles that turned out structurally fragile against three distinct sources of drift:

1. **Host-vs-container npm/node version drift.** The architect's host runs `npm 11.6.2` on `node v24`; the production container is `node:22-slim` with `npm 10.9.x`. Different npm versions resolve platform-conditional / optional deps differently — host-regenerated lockfiles missed `@emnapi/*` entries that the container's npm strictly demanded.
2. **Registry state at regen time.** Different runs of `npm install` against the same `package.json` produced lockfiles with different `@emnapi/*` version pinnings (e.g., 1.9.2 vs 1.10.0). Director's original ground-truth manual workaround had `1.10.0`; later regens produced `1.9.2`. The container demanded BOTH versions simultaneously after T4's regen.
3. **Operator-environment fragility.** Different operator hosts (different OS / kernel / npm version) produce different lockfiles for identical inputs. In-docker host-side regen would normalize this but is blocked on operators running older host kernels (architect's Fedora 31 / Linux 5.8 kernel aborts the `node:22` thread layer).

The only durable fix is to NOT regenerate the lockfile on the host. T5 (closed by mission-50 T5, 2026-04-25) drops the host-side `npm install` step entirely. The container then resolves its own dep tree at build time using its own toolchain, against the swap-modified `package.json` (which now points to the local tarball). The `hub/Dockerfile` uses `npm install --ignore-scripts --no-audit --no-fund` (builder) and `npm install --omit=dev --ignore-scripts --no-audit --no-fund` (production), NOT `npm ci`, because the swap-modified `package.json` no longer matches the committed lockfile and `npm ci` strict-validation would fail.

**Tradeoff.** Switching to `npm install` in the Cloud Build path removes strict lockfile-validation FOR THAT PATH. This is acceptable for THIS codification arc because (a) the lockfile was already transient (regenerated each build by build-hub.sh in T1-T4; never reaching commit-state-strictness in the build path); (b) `cd hub && npm install` local dev keeps using the committed lockfile via the unchanged `file:../packages/storage-provider` ref; (c) the sunset condition reverts the Dockerfile to `npm ci` once idea-186 (npm workspaces) lands and the file: ref resolves natively against the committed lockfile.

`hub/.gcloudignore` permanently re-includes the staged tarballs into the Cloud Build upload context. This file is load-bearing: `gcloud builds submit` falls back to `.gitignore` when no `.gcloudignore` is present, which means the tarball-exclusions in `hub/.gitignore` (intentional, to prevent accidental commits) silently propagate to the gcloud upload context too — the tarballs get staged locally, then dropped from the upload, and the Dockerfile's `COPY ois-<pkg>-*.tgz` step fails with `no source files were specified` inside the build container. That's the failure mode bug-36 hit at architect-side dogfood post-mission-50 T2 merge. `hub/.gcloudignore` is self-contained (does NOT use `#!include:.gitignore`); it mirrors the meaningful excludes (currently `node_modules/`) and explicitly re-includes each staged tarball via `!ois-<pkg>-*.tgz`. With this file present, gcloud uses it instead of `.gitignore` for upload-context filtering, and all staged tarballs land in the build container as expected.

### Stays clean in git

`hub/package.json` keeps `"file:../packages/<pkg>"` refs as the dev-mode source-of-truth for both sovereign packages; `hub/package-lock.json` stays at the file: resolutions and is no longer touched by `build-hub.sh` at all (T5 dropped the host-side lockfile-regen step). Local dev (`cd hub && npm install`) is unchanged. The transient swap is invisible to anything outside the `build-hub.sh` process lifetime; the swap now affects only `hub/package.json` (restored by trap on every exit path) and the staged tarballs (removed by trap).

### CI parity note (forward-look)

`scripts/local/build-hub.sh` is the canonical Hub-build entry-point until idea-186 (npm workspaces adoption) lands and supersedes it. Future auto-redeploy mechanisms — including idea-197 / M-Auto-Redeploy-on-Merge when that ships — MUST invoke this script (or a workspaces-aware successor that inherits equivalent behavior) rather than calling `gcloud builds submit hub/` directly. Bypassing the script would re-introduce bug-33 (cross-package context trap on Cloud Build) and silently regress.

### Sunset condition

The tarball staging is a workaround. The sunset trigger: idea-186 (npm workspaces adoption) ratified + Hub migrated to workspace resolution. At that point, npm workspaces resolve the cross-package dependencies natively; the tarball staging becomes dead weight. Cleanup at sunset:

- Delete the §"Sovereign-package tarball staging (mission-50 T1+T5; task-386 ext.)" section from `scripts/local/build-hub.sh` (the entire `SOVEREIGN_PACKAGES` loop + trap + cleanup).
- Delete BOTH `COPY ois-storage-provider-*.tgz ./` AND `COPY ois-repo-event-bridge-*.tgz ./` lines from `hub/Dockerfile` (both stages — four lines total).
- Revert `hub/Dockerfile`'s `RUN npm install ...` lines back to `RUN npm ci` (builder stage) and `RUN npm ci --omit=dev` (production stage). With workspaces resolution, the committed lockfile matches the workspace-resolved package tree and `npm ci` strict-validation passes natively. (The bug-38 motivation for `npm install` is gone: there's no swap-modified `package.json` to mismatch the lockfile.)
- Delete BOTH `ois-storage-provider-*.tgz` AND `ois-repo-event-bridge-*.tgz` lines from `hub/.gitignore`.
- Delete `hub/.gcloudignore` entirely (the file becomes obsolete once the underlying tarball-staging mechanic is gone — there is nothing to re-include).
- Delete this `Cloud Build tarball staging` section from `deploy/README.md`.

If additional sovereign packages get added between now and idea-186 sunset, repeat the same four-file extension pattern (one entry in `SOVEREIGN_PACKAGES` + Dockerfile COPYs + .gitignore exclusion + .gcloudignore re-include); each addition extends the per-package count in the sunset cleanup proportionally.

`scripts/local/build-hub.sh` carries an inline `TODO(idea-186)` comment naming the sunset condition + cleanup steps so the trigger is discoverable from the workaround itself.

### ADR-024 boundary statement

Mission-50 does NOT amend [`ADR-024`](../docs/decisions/024-sovereign-storage-provider.md) (StorageProvider sovereign-package contract). The `@ois/storage-provider` 6-primitive contract surface is unchanged; the `capabilities.concurrent` flag is unchanged; both `LocalFsStorageProvider` and `GcsStorageProvider` implementations are untouched. The tarball staging is a build-pipeline pattern adapting AROUND the contract, not a contract change. Per methodology v1.0 §ADR-amendment-scope-discipline, ADR amendments are reserved for contract changes; deployment-pattern adaptations live in build-pipeline + runbook docs — i.e., here.

The same boundary holds for the task-386 extension: `@ois/repo-event-bridge`'s sovereign-package contract (the `EventSource` interface, `CursorStore`, GH event translator surface introduced by mission-52 T1) is unchanged; the extension only adds the second package to the build-pipeline tarball-staging loop and matching ignore/Dockerfile lines.

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

## Repo-event-bridge env-vars (mission-52 T3)

The Hub's optional repo-event-bridge component (M-Repo-Event-Bridge) ingests GitHub repository events (PR open/close/merge, review submissions, push events) by polling the GH API on a constant cadence and dispatching them through the Hub's `create_message` MCP verb.

**The component is OFF by default** — without `OIS_GH_API_TOKEN` set, the Hub starts cleanly with the bridge skipped. Enable it by setting all of:

| Env-var | Required | Default | Description |
|---|---|---|---|
| `OIS_GH_API_TOKEN` | yes | (unset) | GitHub Personal Access Token with `repo`, `read:org`, `read:user` scopes. Token absent → bridge skipped. |
| `OIS_REPO_EVENT_BRIDGE_REPOS` | yes | (empty) | Comma-separated `owner/name` list. Empty + token-set → bridge skipped (warning logged). |
| `OIS_REPO_EVENT_BRIDGE_CADENCE_S` | no | `30` | Seconds between polls per repo. |
| `OIS_REPO_EVENT_BRIDGE_RATE_BUDGET_PCT` | no | `0.8` | Fraction of GH PAT 5000-req/hr limit to budget. Soft-limit (warns on overrun; not enforcing). |

**Operator setup (laptop Hub):**

```bash
# 1. Provision a PAT at https://github.com/settings/tokens with scopes:
#    repo, read:org, read:user
export OIS_GH_API_TOKEN="ghp_…"

# 2. List repos to poll
export OIS_REPO_EVENT_BRIDGE_REPOS="apnex-org/agentic-network,apnex-org/other-repo"

# 3. (Optional) override cadence + budget
export OIS_REPO_EVENT_BRIDGE_CADENCE_S=60
export OIS_REPO_EVENT_BRIDGE_RATE_BUDGET_PCT=0.5

# 4. Boot the Hub — start-hub.sh forwards these env-vars into the container.
OIS_ENV=prod scripts/local/start-hub.sh
```

The container Hub logs `[repo-event-bridge] Polling N repos × Ks cadence = M req/hr (budget cap: K req/hr; X% headroom)` at startup when active, or `[Hub] OIS_GH_API_TOKEN not set — repo-event-bridge skipped` when the token is absent.

**Failure modes (Hub stays up):**
- PAT lacks required scopes → bridge state `failed`; error logs include `PAT under-scoped: missing X`. Hub continues.
- PAT auth-failure (401) → bridge state `failed`. Hub continues.
- 429 / rate-limit → bridge auto-pauses for `Retry-After` or `X-RateLimit-Reset` window; resumes automatically. `health()` reports `paused: true, pausedReason: 'rate-limit'`.
- Network transient → bridge exp-backoffs (1 → 2 → 5 → 10 → 30s cap); `pausedReason: 'network'` set when backoff > 30s.

**State persistence:** per-repo cursor + bounded LRU dedupe set persist via the Hub's StorageProvider (same backend as other entities — GCS / local-fs / memory). Hub restart resumes polling from the persisted cursor; events seen pre-restart don't re-emit.

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
