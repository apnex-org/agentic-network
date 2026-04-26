# Pre-Flight — 2026-04 Architectural Review

**Status:** Pre-teardown state captured 2026-04-22 AEST (kate/greg session).
**Purpose:** provenance record of Hub state + infrastructure immediately before CloudRun teardown and local Hub bring-up for the architectural review.

## Pre-teardown state

### CloudRun inventory (3 services, all in `labops-389703` / `australia-southeast1`)

| Service | URL | Rev | Image | Managed by |
|---|---|---|---|---|
| architect-agent | `architect-agent-5muxctm3ta-ts.a.run.app` | 00059 | `architect-agent:latest` | terraform (`cloudrun/`) |
| hub | `hub-5muxctm3ta-ts.a.run.app` | 00040 | `hub:latest` | terraform (`cloudrun/`) |
| mcp-relay-hub | `mcp-relay-hub-5muxctm3ta-ts.a.run.app` | 00072 | `mcp-relay-hub@sha256:1adf9b5b0782...` | NOT terraform (legacy, pre-rename) |

### GCS state snapshot (`gs://ois-relay-hub-state`)

**`meta/counter.json` at snapshot time:**

```json
{
  "taskCounter": 317,
  "proposalCounter": 32,
  "engineerCounter": 13,
  "threadCounter": 244,
  "notificationCounter": 607,
  "ideaCounter": 152,
  "missionCounter": 39,
  "turnCounter": 3,
  "teleCounter": 10,
  "bugCounter": 25,
  "pendingActionCounter": 101,
  "directorNotificationCounter": 44
}
```

**Entity inventory (high-water IDs):**
- Ideas: up to `idea-152` assigned
- Bugs: up to `bug-25` assigned (bug-24 + bug-25 currently open)
- Missions: up to `mission-39` assigned
- Tasks: up to `task-317` assigned
- Threads: up to `thread-244` assigned
- Teles: **exactly 11 (`tele-0`..`tele-10`)** — post-reset canonical state
- Turns: `turn-1`..`turn-3` (not actively used)

### Terraform state (post-split, pre-teardown)

Split completed 2026-04-22. Monolithic plan archived under `deploy/archive-pre-split-2026-04-22/`.

**`deploy/base/terraform.tfstate`** — 10 resources (foundation, untouched by teardown):
- `google_project_service.apis` × 5
- `google_service_account.runtime`
- `google_project_iam_member.runtime_storage`
- `google_project_iam_member.runtime_vertex`
- `google_storage_bucket.state`
- `google_artifact_registry_repository.images`

**`deploy/cloudrun/terraform.tfstate`** — 4 resources (target of teardown):
- `google_cloud_run_v2_service.hub`
- `google_cloud_run_v2_service.architect`
- `google_cloud_run_v2_service_iam_member.hub_public[0]`
- `google_cloud_run_v2_service_iam_member.architect_public[0]`

**Not in terraform:** `mcp-relay-hub` service — legacy, to be deleted via `gcloud` separately.

### State backup locations

- `deploy/archive-pre-split-2026-04-22/terraform.tfstate.pre-split-backup` — monolith state at moment of split
- GCS native object versioning: `ois-relay-hub-state` bucket has versioning enabled + 3-version lifecycle (provides recovery window for any accidental overwrite)

## Planned teardown sequence

1. **`cd deploy/cloudrun && terraform destroy -var-file=env/prod.tfvars -auto-approve`**
   - Removes: `google_cloud_run_v2_service.hub`, `google_cloud_run_v2_service.architect`, `google_cloud_run_v2_service_iam_member.hub_public[0]`, `google_cloud_run_v2_service_iam_member.architect_public[0]`
   - Expected: 4 resources destroyed, 0 added, 0 changed
   - Leaves: base plan (foundation) untouched; GCS state intact

2. **`gcloud run services delete mcp-relay-hub --region=australia-southeast1 --project=labops-389703 --quiet`**
   - Removes the non-terraform legacy service

3. **Verification:** `gcloud run services list --region=australia-southeast1 --project=labops-389703` should return empty.

4. **GCS state verification:** `list_tele` and counter snapshot should still match this record (Hub state survives CloudRun deletion).

## Post-teardown state

### Teardown execution log

**1. `terraform destroy` in `deploy/cloudrun/` (first attempt):**
- 4 resources initially planned for destruction.
- IAM bindings destroyed: `hub_public[0]`, `architect_public[0]` (7s each).
- Service destroy BLOCKED: `cannot destroy service without setting deletion_protection=false and running terraform apply` — Google provider v6 default.

**2. Fix: added `deletion_protection = false` to both services in `cloudrun/main.tf`** (commit-ready edit).

**3. `terraform apply` to propagate deletion_protection=false:**
- 2 changed (hub, architect services — metadata update to clear protection flag + label/scaling drift reconciled)
- 2 added (IAM bindings recreated, having been destroyed in step 1)
- 0 destroyed
- No live-service disruption; just metadata.

**4. `terraform destroy` (second attempt):**
- Plan: 0 to add, 0 to change, 4 to destroy
- IAM bindings destroyed: `hub_public[0]`, `architect_public[0]` (6s each)
- `google_cloud_run_v2_service.architect` destroyed (11s)
- `google_cloud_run_v2_service.hub` destroyed (10s)
- Result: **Destroy complete! Resources: 4 destroyed.**

**5. `gcloud run services delete mcp-relay-hub` (legacy, non-terraform):**
- Deleted in ~30s.

### Post-teardown verification

- **CloudRun services:** `gcloud run services list --region=australia-southeast1 --project=labops-389703` → **Listed 0 items**. Empty confirmed.
- **Terraform state:**
  - `deploy/base/terraform.tfstate` — unchanged, 10 foundation resources intact
  - `deploy/cloudrun/terraform.tfstate` — empty (all 4 resources destroyed)
- **GCS state:** `gs://ois-relay-hub-state` untouched by teardown. Direct MCP verification pending local Hub bring-up (current session's adapter is in `session state=reconnecting` after cloud Hub disappeared, as expected).

### Current-session impact

- My engineer-adapter lost connection to the now-deleted cloud Hub — tool calls return `McpAgentClient.call: session state=reconnecting`.
- Hub state in GCS is presumed intact (bucket wasn't touched); will be confirmed once local Hub boots and serves `list_tele` / `list_ideas`.

### Minor learnings captured

- **Google provider v6 `deletion_protection` default is `true`** — anything destroying a Cloud Run v2 service via terraform must set this to `false` *before* destroy. Not intuitive; documented here so next teardown doesn't rediscover it the slow way.
- **Terraform's two-step dance:** `apply deletion_protection=false` then `destroy` — neither alone sufficient. Worth encoding in a teardown script.

## Local Hub bring-up

**Outcome: Hub running locally in Docker at `http://localhost:8080/mcp`.**

### Approach

Original plan: `docker build` hub/ then run. Failed — Node 22 inside container hit libuv `uv_thread_create` assertion (`Assertion failed: (0) == (uv_thread_create(...))`) at `npm ci` time. Root cause: Docker 20.10.3 (host) has an older default seccomp profile missing syscalls Node 22 needs for worker-thread creation.

Pivoted to pulling the prod image from Artifact Registry:

1. `gcloud auth configure-docker australia-southeast1-docker.pkg.dev` (one-time)
2. `docker pull australia-southeast1-docker.pkg.dev/labops-389703/cloud-run-source-deploy/hub:latest`
3. `docker tag ... ois-hub:local`
4. `docker run --security-opt seccomp=unconfined ... ois-hub:local`

Even the pulled image crashed on startup with the same libuv error without `--security-opt seccomp=unconfined` — proved it's a runtime issue, not just build-time. `seccomp=unconfined` relaxes the filter and lets Node's thread pool initialize. Safe for local dev; would be unacceptable in multi-tenant environments. Upgrading host Docker would resolve at root.

### Script changes

- `scripts/local/start-hub.sh` uses `--security-opt seccomp=unconfined` with inline comment explaining why + pointing at long-term fix (upgrade Docker)
- First-time setup requires `gcloud auth configure-docker australia-southeast1-docker.pkg.dev` (not scripted — one-time)
- Image is pulled + tagged as `ois-hub:local`; the script's "build if missing" path still works for rebuild scenarios, but on this host Node 22 build fails — documented as a known limitation

### Post-bring-up verification

- **Container:** `docker ps` shows `ois-hub-local` — Status: Up, Ports: 0.0.0.0:8080->8080/tcp
- **/health endpoint:** returns HTTP 200, `{"status":"ok","service":"mcp-relay-hub","version":"1.0.0","activeSessions":0,"sseStreams":0}`
- **GCS state integrity (verified via Hub startup logs):** `[Reconcile] Counters OK` with exact same values captured pre-teardown (`taskCounter:317, proposalCounter:32, engineerCounter:13, threadCounter:244, notificationCounter:607, ideaCounter:152, missionCounter:39, turnCounter:3, teleCounter:10, bugCounter:25, pendingActionCounter:101, directorNotificationCounter:44`). **GCS state fully intact.**
- **Policy router:** 57 tools registered
- **Watchdog:** paused (`WATCHDOG_ENABLED=false`), by design for local dev
- **Bucket connectivity:** all GCS stores initialized (`[GcsProposalStore]`, `[GcsThreadStore]`, `[GcsTeleStore]`, etc.)

### Findings captured for review Phase 2 friction cartography

- **Docker 20.10 + Node 22 incompatibility** — currently works around with `seccomp=unconfined`. Real fix: upgrade host Docker (unblocks clean builds) or downgrade Node in Dockerfile (changes prod image — out of scope).
- **No scripted `docker auth configure`** — the Artifact Registry credential setup is a one-time manual step. If we adopt pull-from-registry as primary local dev path, worth scripting.
- **`start-hub.sh` carries two distinct paths** (build-from-source, or pull-and-run) — mixed concerns. Splitting might be cleaner as part of the script rationalisation mission.

## Next phase (pending)

### Agent config migration — DONE

**greg (engineer):** `/home/apnex/taceng/agentic-network/.ois/greg/.ois/adapter-config.json` (inside a single `.ois/` parent with per-agent subfolders; gitignored).
```json
{
  "hubUrl": "http://localhost:8080/mcp",
  "hubToken": "9dtfAYeijUloVeMsDbyzR6XxyuZ1wHVnqv_R6m50DEE",
  "role": "engineer",
  "labels": { "env": "prod" }
}
```

**lily (architect):** `/home/apnex/taceng/agentic-network/.ois/lily/.ois/adapter-config.json` (isolated state under the shared `.ois/` parent; gitignored).
```json
{
  "hubUrl": "http://localhost:8080/mcp",
  "hubToken": "9dtfAYeijUloVeMsDbyzR6XxyuZ1wHVnqv_R6m50DEE",
  "role": "architect",
  "labels": { "env": "prod" }
}
```

### Launch commands for next-session cold start

Open two terminals, both in the repo:

```bash
# Terminal 1 — greg (engineer)
cd /home/apnex/taceng/agentic-network
./start-greg.sh

# Terminal 2 — lily (architect)
cd /home/apnex/taceng/agentic-network
./start-lily.sh
```

These wrap `OIS_INSTANCE_ID=<name>` + `OIS_HUB_LABELS='{"env":"prod"}'` + `WORK_DIR=<repo>/.ois/<name>` + the required `--dangerously-load-development-channels plugin:agent-adapter@agentic-network` flag. Scripts validate the per-agent config exists before launching; passthrough args forward to `claude` (e.g. `./start-greg.sh -p "Read docs/reviews/HANDOVER-greg.md"` for scripted first-turn).

Why the `WORK_DIR` split: shim.ts reads `.ois/adapter-config.json` relative to `$WORK_DIR` and also writes a per-session `global-instance-id` + notification log there. If both agents shared one `.ois/` dir, they'd overwrite each other's agent identity and log streams. Separating via per-agent `WORK_DIR` (inside a single `.ois/` parent for operational tidiness) gives each its own state directory while both read the same git repo source.

Layout:
```
.ois/
├── greg/.ois/adapter-config.json   (engineer)
└── lily/.ois/adapter-config.json   (architect)
```
The inner `.ois/` under each agent dir is the shim's required convention (hardcoded `$WORK_DIR/.ois/` path); hidden from Director view, the user-facing abstraction is "`.ois/<agent-name>/` is that agent's home."

### Current-session fate (kate/greg)

This session's McpAgentClient cached the cloud URL at handshake time (see `adapters/claude-plugin/src/shim.ts:loadConfig` — called once at startup). Editing the config file does not reconnect this session; it only affects the NEXT session that starts up. The currently-running adapter stays in `session state=reconnecting` indefinitely.

Correct next action per the review plan: end this session, spin up fresh `greg` + `lily` per the commands above, follow the cold-start checklist in `docs/reviews/2026-04-architectural-review.md`, begin Phase 1.

### Validation of the new config (first thing greg/lily should do)

In either new session:
```
list_tele → expected: 11 teles (tele-0..tele-10)
list_available_peers → expected: greg sees lily, lily sees greg (once both are up)
```

If those pass, MCP path against local Hub is live and the review can proceed.

