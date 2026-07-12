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

## Hub build (npm workspaces)

`scripts/local/build-hub.sh` builds the Hub image via `gcloud builds submit` from the **repo-root** context: `hub` is a member of the root npm workspace, so its sovereign dependencies (`@apnex/storage-provider`, `@apnex/repo-event-bridge`) resolve natively as workspaces and `hub/Dockerfile` runs `npm ci` against the committed **root** lockfile — no tarball staging, no host-side lockfile regen (**bug-38 dissolves by construction**). idea-186 / cleanslate0 hub_rebase (#570) rebased the build onto workspace resolution; swap_delete (#571) removed the retired transient tarball-swap primitive.

This is a build-pipeline pattern only; it does NOT amend [`ADR-024`](../docs/decisions/024-sovereign-storage-provider.md) — the StorageProvider (and repo-event-bridge) sovereign-package contracts are unchanged.

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
