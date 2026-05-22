# OIS Agentic Network — Terraform Deploy

## Production Hub (`deploy/hub/` + `modules/hub/`)

The production Hub runs on a single internal-only GCE VM (`australia-southeast1`) as a
3-container docker-compose stack — Hub + Postgres + Watchtower — fronted by a Cloud Run
nginx proxy for TLS + ingress. Provisioned by mission-86 (M-Hub-Storage-Cloud-Deploy);
see `docs/designs/m-hub-storage-cloud-deploy-design.md` and the operator runbooks under
`docs/operator/`.

```
modules/hub/   — reusable Hub Terraform module (compute, network, Cloud Run proxy, IAM,
                 Secret Manager, Artifact Registry, Cloud Build). Environment-agnostic.
deploy/hub/    — thin root caller: invokes modules/hub/ with per-env tfvars. A second
                 deployment is just another thin root caller pointing at ../../modules/hub.
```

### Apply

```bash
cd deploy/hub
terraform init
terraform plan  -var-file=env/prod.tfvars
terraform apply -var-file=env/prod.tfvars
```

`deploy/hub/env/prod.tfvars` is operator-populated and gitignored — copy it from
`deploy/hub/env/prod.tfvars.example`.

The committed `modules/hub/.terraform.lock.hcl` pins provider versions; `terraform init`
in `deploy/hub/` resolves providers against it.

## Local Docker Hub (`scripts/local/`)

`scripts/local/{build,start,stop}-hub.sh` are the local-dev Hub tooling — `build-hub.sh`
builds the image via Cloud Build + pulls + tags `ois-hub:local`; `start-hub.sh` launches a
container `ois-hub-local-<env>` on port 8080 against a Postgres substrate; `stop-hub.sh`
stops/removes it. One container at a time is enforced.

```bash
scripts/local/build-hub.sh
scripts/local/start-hub.sh     # one container at a time enforced
scripts/local/stop-hub.sh
```

`OIS_ENV` (default `prod`) tags the container name and is validated `^[a-z][a-z0-9-]*$`,
max 20 chars. `start-hub.sh` requires a running Postgres — see
`docs/operator/hub-storage-substrate-local-dev.md`.

## Configuration

Two distinct config surfaces:

- **`deploy/hub/env/<env>.tfvars`** — Terraform variables for the `deploy/hub/` root.
  Gitignored (secrets); copy from `deploy/hub/env/prod.tfvars.example`.
- **`~/.config/apnex-agents/hub.env`** — config for the `scripts/local/` Hub tooling
  (mission-87 W1 / idea-308). `key=value`, shell-sourced; lives outside the repo so
  secrets never sit in the working tree. Copy from `scripts/local/hub.env.example`.
  `start-hub.sh` reads `HUB_API_TOKEN`, `STATE_BUCKET_NAME`, `PROJECT_ID`,
  `POSTGRES_CONNECTION_STRING` + the repo-event-bridge knobs; `build-hub.sh` reads
  `PROJECT_ID` + `REGION`.

> mission-87 W1 removed the pre-mission-86 `deploy/base/` + `deploy/cloudrun/` Cloud Run
> terraform (the old two-plan deployment of the retired `vertex-cloudrun` Architect
> service). Their per-env `*.tfvars` had become the local scripts' config source despite
> no longer feeding any terraform; that config moved to `hub.env`.

## Cloud Build tarball staging (mission-50 + task-386 extension)

Mission-50 (closed 2026-04-25) codified the sovereign-package tarball staging that `scripts/local/build-hub.sh` performs as a pre-build hook before `gcloud builds submit`. Task-386 (2026-04-26) extended the codification to cover a second sovereign package (`@apnex/repo-event-bridge`) added by mission-52 T3 — same root cause, same fix shape, generalized to a loop over all sovereign packages. This section documents the rationale, mechanics, sunset condition, CI parity expectation, and ADR-024 boundary.

### Why

Hub depends on multiple sovereign packages — `@apnex/storage-provider` (`packages/storage-provider/`) and `@apnex/repo-event-bridge` (`packages/repo-event-bridge/`) — via `"file:../packages/<pkg>"` refs in `hub/package.json`. Those refs work for local dev (`cd hub && npm install` walks up one level), but they break under Cloud Build: `gcloud builds submit hub/` uploads only the contents of `hub/`, so the `..` escape leaves the sovereign package sources unreachable inside the build container. That's the failure mode bug-33 hit on the post-mission-49 redeploy attempt; task-386 catches the same gap retroactively for the second sovereign package introduced by mission-52 T3.

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

### Sunset condition

The tarball staging is a workaround. The sunset trigger: idea-186 (npm workspaces adoption) ratified + Hub migrated to workspace resolution. At that point, npm workspaces resolve the cross-package dependencies natively; the tarball staging becomes dead weight. Cleanup at sunset:

- Delete the §"Sovereign-package tarball staging" section from `scripts/local/build-hub.sh` (the entire `SOVEREIGN_PACKAGES` loop + trap + cleanup).
- Delete BOTH `COPY ois-storage-provider-*.tgz ./` AND `COPY ois-repo-event-bridge-*.tgz ./` lines from `hub/Dockerfile` (both stages — four lines total).
- Revert `hub/Dockerfile`'s `RUN npm install ...` lines back to `RUN npm ci` (builder stage) and `RUN npm ci --omit=dev` (production stage).
- Delete BOTH `ois-storage-provider-*.tgz` AND `ois-repo-event-bridge-*.tgz` lines from `hub/.gitignore`.
- Delete `hub/.gcloudignore` entirely.
- Delete this `Cloud Build tarball staging` section from `deploy/README.md`.

`scripts/local/build-hub.sh` carries an inline `TODO(idea-186)` comment naming the sunset condition + cleanup steps so the trigger is discoverable from the workaround itself.

### ADR-024 boundary statement

Mission-50 does NOT amend [`ADR-024`](../docs/decisions/024-sovereign-storage-provider.md) (StorageProvider sovereign-package contract). The tarball staging is a build-pipeline pattern adapting AROUND the contract, not a contract change. The same boundary holds for the task-386 extension: `@apnex/repo-event-bridge`'s sovereign-package contract is unchanged; the extension only adds the second package to the build-pipeline tarball-staging loop and matching ignore/Dockerfile lines.

## Backends

`deploy/hub/` uses the Terraform **local backend** (state file kept in-dir, gitignored).
Migration to a GCS remote backend is a planned future improvement; until then, do not run
`terraform apply` simultaneously from multiple machines.

## Repo-event-bridge env-vars (mission-52 T3)

The Hub's optional repo-event-bridge component (M-Repo-Event-Bridge) ingests GitHub repository events (PR open/close/merge, review submissions, push events) by polling the GH API on a constant cadence and dispatching them through the Hub's `create_message` MCP verb.

**The component is OFF by default** — without `OIS_GH_API_TOKEN` set, the Hub starts cleanly with the bridge skipped. Enable it by setting all of:

| Env-var | Required | Default | Description |
|---|---|---|---|
| `OIS_GH_API_TOKEN` | yes | (unset) | GitHub Personal Access Token with `repo`, `read:org`, `read:user` scopes. Token absent → bridge skipped. |
| `OIS_REPO_EVENT_BRIDGE_REPOS` | yes | (empty) | Comma-separated `owner/name` list. Empty + token-set → bridge skipped (warning logged). |
| `OIS_REPO_EVENT_BRIDGE_CADENCE_S` | no | `30` | Seconds between polls per repo. |
| `OIS_REPO_EVENT_BRIDGE_RATE_BUDGET_PCT` | no | `0.8` | Fraction of GH PAT 5000-req/hr limit to budget. Soft-limit (warns on overrun; not enforcing). |

**Operator setup (local Docker Hub):** set these keys in `~/.config/apnex-agents/hub.env`
(see `scripts/local/hub.env.example`) — `start-hub.sh` sources that file and forwards the
vars into the container:

```
OIS_GH_API_TOKEN="ghp_…"                                  # PAT: repo, read:org, read:user
OIS_REPO_EVENT_BRIDGE_REPOS="apnex-org/agentic-network"   # comma-separated owner/name
OIS_REPO_EVENT_BRIDGE_CADENCE_S="60"                       # optional override
OIS_REPO_EVENT_BRIDGE_RATE_BUDGET_PCT="0.5"                # optional override
```

The container Hub logs `[repo-event-bridge] Polling N repos × Ks cadence = M req/hr (budget cap: K req/hr; X% headroom)` at startup when active, or `[Hub] OIS_GH_API_TOKEN not set — repo-event-bridge skipped` when the token is absent.

**Failure modes (Hub stays up):**
- PAT lacks required scopes → bridge state `failed`; error logs include `PAT under-scoped: missing X`. Hub continues.
- PAT auth-failure (401) → bridge state `failed`. Hub continues.
- 429 / rate-limit → bridge auto-pauses for `Retry-After` or `X-RateLimit-Reset` window; resumes automatically. `health()` reports `paused: true, pausedReason: 'rate-limit'`.
- Network transient → bridge exp-backoffs (1 → 2 → 5 → 10 → 30s cap); `pausedReason: 'network'` set when backoff > 30s.

**State persistence:** per-repo cursor + bounded LRU dedupe set persist via the Hub storage substrate (Postgres). Hub restart resumes polling from the persisted cursor; events seen pre-restart don't re-emit.

## Outstanding

- **Remote state migration to GCS.** Move `deploy/hub/`'s Terraform state from the local
  backend to `backend "gcs"` pointing at the state bucket. Separate future mission.
- **bug-30 / idea-186 narrow-gate re-require.** Once idea-186 (npm workspaces migration)
  lands, the Cloud Build tarball staging sunsets — see the sunset condition above.
