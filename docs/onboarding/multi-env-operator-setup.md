# Multi-Environment Operator Setup — OIS Agentic Network

**Audience.** An operator setting up a **fresh, isolated OIS environment** from a cold clone on an uninstrumented machine. Zero tribal knowledge assumed. Runs on Linux, macOS, or Windows-via-WSL2. End state: live Hub + Architect Cloud Run services in a new GCP project, an OpenCode session connected as the Engineer, and a first canary thread exchanged with the Architect.

**What this gets you.** A fully isolated OIS tenant — new GCP project, new GCS bucket, new Cloud Run services, new OpenCode-backed Engineer adapter. Nothing is shared with any other env; the new tenant operates as its own sovereign network from the first canary thread onward.

**Written for.** Mission-46 M-Multi-Env-Substrate Task 4. First operator-facing runbook in `docs/onboarding/`.

**Companion docs (read alongside, not instead of):**

- `deploy/README.md` — deploy-tooling reference (scripts, tfvars layout, `OIS_ENV` convention).
- `adapters/opencode-plugin/QUICKSTART.md` — OpenCode plugin install + config mechanics (referenced in §5 below).
- `ARCHITECTURE.md` — what the OIS network is, at a glance.

---

## IMPORTANT — fail-fast config policy (read this first)

The Hub and Architect containers **fail-fast on missing env configuration** (mission-46 T1 decision, Director ratified). If a service starts without required env vars populated, it crashes loudly at startup — by design. There is no silent-wrong-tenant fallback; a half-configured env is immediately visible as a crash-loop, not a quietly-misrouted container.

**What this means for you as the operator:**

- **Populate the per-env tfvars before running the bootstrap wrapper** (the wrapper does this for you in §3). Do not run `terraform apply` manually against empty tfvars — the Cloud Run services will refuse to start.
- If you see `[vertex-cloudrun] MCP_HUB_URL env var is required` or `[hub] GCS_BUCKET env var is required` in Cloud Run logs, the terraform apply did not inject the env vars — usually because the tfvars file was missing or empty at apply time. Re-run the bootstrap wrapper (§3); it's idempotent.
- The crash-loop signal is your friend. It means a future operator won't accidentally ship to the wrong project because a config default papered over a missing value.

---

## 1. Prerequisites

### 1.1 Tools on your workstation

| Tool | Minimum | Install hint |
|---|---|---|
| `gcloud` | latest | https://cloud.google.com/sdk/docs/install |
| `terraform` | >= 1.5 | https://developer.hashicorp.com/terraform/install |
| `git` | any modern | `apt install git` / `brew install git` |
| `docker` | any modern | https://docs.docker.com/engine/install/ · only needed if you want local Hub dev (§7) |
| `uuidgen` | present by default on macOS / most Linux | `apt install uuid-runtime` if missing |
| `openssl` | present by default | pre-installed on macOS + most Linuxes |
| `bun` | >= 1.0 | https://bun.sh · required by the OpenCode plugin's local MCP proxy |
| `node` | >= 22 | https://nodejs.org · matches the CI environment for optional dev work |
| **OpenCode** | latest | https://opencode.ai · the Engineer runtime |

Confirm each with `<tool> --version` before proceeding.

### 1.2 GCP account + project

The bootstrap wrapper does **not** create the GCP project for you. You must do this first:

```bash
# Pick a globally unique project ID (lowercase, 6-30 chars, hyphens allowed)
gcloud projects create <your-project-id> --name="OIS <env-name>"

# Link a billing account (required for Cloud Run, Artifact Registry, GCS, Vertex AI)
gcloud billing accounts list
gcloud billing projects link <your-project-id> --billing-account=<billing-account-id>

# Confirm you have project-owner (or equivalent) IAM on the project
gcloud projects get-iam-policy <your-project-id> \
  --flatten="bindings[].members" \
  --filter="bindings.members:$(gcloud config get-value account)"
```

### 1.3 gcloud authentication (two separate contexts)

```bash
# gcloud CLI auth (for gcloud commands)
gcloud auth login

# Application Default Credentials (ADC) — required for terraform google provider
gcloud auth application-default login

# Set the default project (convenience; wrapper also takes --project-id)
gcloud config set project <your-project-id>
```

**Both** logins are required. ADC is a separate credential path that terraform uses via the Google provider; the bootstrap wrapper checks for it at Phase 1 and errors early if missing.

---

## 2. Clone the repo

```bash
git clone git@github.com:apnex-org/agentic-network.git
cd agentic-network

# (optional) Pin to a specific tag or branch. The main branch tracks
# mission ships.
# git checkout <tag-or-branch>
```

You do **not** need to run `npm install` at the repo root for this runbook. The bootstrap wrapper only needs shell tools listed in §1.1 on your workstation; the actual Hub + Architect images are built remotely in Cloud Build.

---

## 3. Run the bootstrap wrapper

Pick an env name for your new tenant. Constraints: `^[a-z][a-z0-9-]*$`, max 20 chars. Examples: `prod`, `staging-eu`, `tenant-acme`, `review`.

```bash
deploy/new-environment-bootstrap.sh \
  --project-id <your-project-id> \
  --region <your-gcp-region>     \
  --env <your-env-name>
```

Typical region values: `australia-southeast1`, `us-central1`, `europe-west1`. Pick one supported by [Vertex AI](https://cloud.google.com/vertex-ai/docs/general/locations).

**What the wrapper does** (9 phases, idempotent — safe to re-run):

1. Validates inputs + tool presence + gcloud auth/ADC.
2. Scaffolds `deploy/base/env/<env-name>.tfvars` + `deploy/cloudrun/env/<env-name>.tfvars` from templates. Generates `hub_api_token` (openssl rand) + `architect_global_instance_id` (uuidgen). Writes a `.bootstrap-secrets-<env-name>.txt` at repo root (chmod 600, gitignored). These secrets are **never echoed to stdout**.
3. Enables the two bootstrap GCP APIs (`cloudresourcemanager` + `serviceusage`) terraform itself needs.
4. `terraform apply` in `deploy/base/` — creates SA, GCS bucket, Artifact Registry, enables remaining APIs.
5. Builds Hub image via Cloud Build (calls `deploy/build-hub.sh`).
6. Builds Architect image via Cloud Build (calls `deploy/build-architect.sh`).
7. `terraform apply` in `deploy/cloudrun/` — creates `hub-<env-name>` + `architect-<env-name>` Cloud Run services.
8. Reports the live URLs + Hub `/health` probe.
9. Optional: `--provision-local-key` generates an SA key JSON at repo root for local Hub dev (§7).

**Expected runtime:** 5-15 minutes end-to-end depending on GCP API propagation latency + Cloud Build queue. Flow-based success gate: the wrapper prints live URLs on the last screen. If it exits non-zero, read the last few log lines — every phase is labeled.

**On re-run:** the wrapper is idempotent. It detects existing tfvars + skips secret regen. `terraform apply` converges. Builds re-push with new timestamped tags + re-point `:latest`. Cloud Run services redeploy without image churn.

**If the wrapper errors at any phase:**

- **Phase 1 (preflight):** fix the reported missing tool or auth context and re-run.
- **Phase 3 (gcloud services enable):** project may lack billing; verify §1.2.
- **Phase 4 (base terraform apply):** most often an IAM issue. Verify you have project-owner or equivalent. Check `terraform plan -var-file=env/<env-name>.tfvars` manually from `deploy/base/` for detail.
- **Phase 5-6 (Cloud Build):** check the Cloud Build console at `https://console.cloud.google.com/cloud-build/builds?project=<your-project-id>` for the failing step.
- **Phase 7 (cloudrun apply):** if a service crash-loops at startup, check Cloud Run logs for the fail-fast error message — usually means an env var wasn't injected (read §Important at top of this doc).

---

## 4. Verify live services

The wrapper prints the URLs on completion. You can also re-fetch them:

```bash
cd deploy/cloudrun
terraform output hub_url
terraform output hub_mcp_url
terraform output architect_url
```

Quick sanity checks:

```bash
# Hub health — should return 200 with a small JSON body
curl -s -w "\nHTTP %{http_code}\n" "$(cd deploy/cloudrun && terraform output -raw hub_url)/health"

# Architect health
curl -s -w "\nHTTP %{http_code}\n" "$(cd deploy/cloudrun && terraform output -raw architect_url)/health"
```

Expected: both return HTTP 200 with `{"status":"ok",...}`. If either returns a crash-loop error, consult the fail-fast section at the top of this doc + the Cloud Run logs.

---

## 5. Install + configure the OpenCode plugin

**Canonical plugin docs:** `adapters/opencode-plugin/QUICKSTART.md`. Read that for install mechanics and troubleshooting.

**What this runbook adds on top:** the plugin needs to point at **your new env's Hub URL + token**, not a shared default. The values come from the bootstrap wrapper output.

### 5.1 Pull the values from the bootstrap output

```bash
# Hub MCP URL
HUB_MCP_URL="$(cd deploy/cloudrun && terraform output -raw hub_mcp_url)"
echo "$HUB_MCP_URL"

# Hub API token (from the chmod-600 secrets summary or the tfvars)
HUB_API_TOKEN="$(grep '^hub_api_token' deploy/cloudrun/env/<your-env-name>.tfvars | awk -F'"' '{print $2}')"
# Do NOT echo $HUB_API_TOKEN to stdout. Treat it as a long-lived secret.
```

### 5.2 Configure the plugin for your OpenCode workspace

Pick a working directory for OpenCode. Inside it, create `.ois/adapter-config.json`:

```bash
mkdir -p .ois
cat > .ois/adapter-config.json <<EOF
{
  "hubUrl": "$HUB_MCP_URL",
  "hubToken": "$HUB_API_TOKEN",
  "role": "engineer",
  "autoPrompt": true
}
EOF
chmod 600 .ois/adapter-config.json
```

Alternative: set `OIS_HUB_URL` / `OIS_HUB_TOKEN` / `OIS_HUB_ROLE` env vars (they override the config file). See the plugin's QUICKSTART §Configuration reference for the full precedence table.

### 5.3 Register the plugin in your OpenCode config

```jsonc
// .opencode/config.json
{
  "plugins": {
    "hub-notifications": {
      "path": "/full/path/to/agentic-network/adapters/opencode-plugin/src/shim.ts"
    }
  }
}
```

Or the GitHub-direct shorthand (no repo clone needed on the OpenCode-host machine):

```jsonc
{
  "plugins": {
    "hub-notifications": {
      "github": "apnex/agentic-network",
      "path": "adapters/opencode-plugin/src/shim.ts"
    }
  }
}
```

### 5.4 Launch OpenCode + confirm connection

Start OpenCode in your workspace. Within a few seconds, the plugin should:

1. Connect to your new Hub via MCP Streamable HTTP.
2. Perform an `register_role` handshake (M18 Agent identity).
3. Start a local `Bun.serve` MCP proxy.
4. Expose all Hub tools to OpenCode.

Confirm via OpenCode's tool-inspector UI that you can see Hub tools (e.g., `list_missions`, `create_task`, `get_engineer_status`). If tools don't appear after ~15 seconds, see the plugin's QUICKSTART §Troubleshooting + check `<workdir>/.ois/hub-plugin.log`.

---

## 6. Canary thread — first engineer session (SC #2)

This step proves the `adapter ↔ Hub ↔ Architect` path end-to-end. It is the **success criterion #2** from mission-46's brief: _"OpenCode-plugin engineer completes an end-to-end thread against the new env (write + read path exercised)."_

From your OpenCode session, prompt the LLM:

> Open a unicast thread with the architect in this env. Title: "Canary — new env smoke test". Send any short message. Wait for a reply. Converge the thread with close_no_action.

Expected flow:

1. LLM invokes `list_available_peers` (role: architect) — should return the architect running in this env.
2. LLM invokes `create_thread` (routingMode: unicast, recipientAgentId: <architect from step 1>) with the title + message.
3. Hub dispatches the `thread_message` event to the Architect.
4. Architect (running in `architect-<env>` Cloud Run service) receives the event, generates a reply, calls `create_thread_reply` back.
5. Notification lands in OpenCode; LLM reads it.
6. LLM invokes `create_thread_reply` with `converged: true` + `stagedActions: [{kind:"stage",type:"close_no_action",payload:{reason:"..."}}]` + a `summary`.
7. Hub seals the thread (bilateral convergence); `thread_convergence_finalized` fires.

Verify via OpenCode log or `list_threads` call that the thread is `status: "converged"` with both parties' messages present. This is your go-live signal.

If any step hangs or errors:

- **No architect visible:** Architect Cloud Run service may not be running. `gcloud run services list --project=<your-project-id> --region=<your-region>` should show `architect-<env>` as ready.
- **Hub returns 401:** token in plugin config doesn't match tfvars. Re-read `deploy/cloudrun/env/<env-name>.tfvars`.
- **Architect never replies:** Architect has `event_loop_enabled=true` by default; it polls every 300s. If nothing happens after 5 min, check the Architect Cloud Run logs for LLM errors (quota, Vertex AI model availability, etc.).

---

## 7. (Optional) Local Hub dev

Needed only if you want to run a **local Hub container** against your new env's GCS bucket — e.g., to iterate on Hub code without pushing a new Cloud Run revision per change.

### 7.1 Provision a local SA key

Re-run the bootstrap wrapper with `--provision-local-key`:

```bash
deploy/new-environment-bootstrap.sh \
  --project-id <your-project-id> \
  --region <your-gcp-region>     \
  --env <your-env-name>          \
  --provision-local-key
```

This generates `<your-project-id>.json` at the repo root (chmod 600, gitignored) — a long-lived SA key. Rotate periodically; do not commit; do not share.

### 7.2 Launch the local Hub container

```bash
OIS_ENV=<your-env-name> scripts/local/build-hub.sh
OIS_ENV=<your-env-name> scripts/local/start-hub.sh
```

The local Hub container `ois-hub-local-<env-name>` runs on port 8080. Point a second OpenCode session at `http://localhost:8080/mcp` (using the same token from the tfvars) to dev against local-Hub-against-prod-GCS.

Stop the local Hub with `scripts/local/stop-hub.sh` (auto-detects the running env) or `OIS_ENV=<env-name> scripts/local/stop-hub.sh` (targeted).

**Security caveat.** A local SA key is a long-lived credential with full access to your env's GCS bucket. Treat it like a password. See `deploy/README.md` for rotation guidance.

---

## 8. Troubleshooting index

| Symptom | Probable cause | Where to look |
|---|---|---|
| Wrapper exits at Phase 1 — missing tool | Tool absent from PATH | §1.1 install table |
| Wrapper exits at Phase 1 — no gcloud auth | `gcloud auth login` not run | §1.3 |
| Wrapper exits at Phase 1 — no ADC | `gcloud auth application-default login` not run | §1.3 |
| Wrapper exits at Phase 3 — API enable fails | Project has no billing | §1.2 |
| Wrapper exits at Phase 4 — terraform permission denied | Operator lacks project-owner IAM | §1.2 |
| Wrapper exits at Phase 5/6 — Cloud Build fails | See Cloud Build logs | `https://console.cloud.google.com/cloud-build/builds?project=<project-id>` |
| Hub /health returns error | Env var not injected → fail-fast crash-loop | Cloud Run logs; re-run wrapper |
| Plugin shows no Hub tools | hubUrl/hubToken misconfigured | Plugin QUICKSTART §Troubleshooting + `<workdir>/.ois/hub-plugin.log` |
| Canary thread hangs | Architect not running or LLM errored | `gcloud run services list` + Architect Cloud Run logs |

For deeper issues, check:

- **Bootstrap wrapper log:** stdout of your terminal session. Re-run with `bash -x deploy/new-environment-bootstrap.sh ...` for verbose tracing.
- **Terraform state:** `deploy/base/terraform.tfstate` + `deploy/cloudrun/terraform.tfstate` (local backend; do not commit).
- **Cloud Run logs:** `gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name="hub-<env>"' --project=<project-id> --limit=50`.

---

## 9. Teardown

To destroy the entire environment (Cloud Run services only; leaves GCS bucket + SA + Artifact Registry intact, per `force_destroy=false` on the bucket):

```bash
cd deploy/cloudrun
terraform destroy -var-file=env/<your-env-name>.tfvars
```

To destroy the foundation tier (bucket + SA + Artifact Registry):

```bash
# Empty the GCS bucket first (bucket has force_destroy=false for safety)
gsutil rm -r "gs://<your-project-id>-hub-state/**"

cd deploy/base
terraform destroy -var-file=env/<your-env-name>.tfvars
```

Delete the tfvars + secrets files manually (they're gitignored; no need to commit):

```bash
rm deploy/base/env/<your-env-name>.tfvars
rm deploy/cloudrun/env/<your-env-name>.tfvars
rm .bootstrap-secrets-<your-env-name>.txt
rm -f <your-project-id>.json  # if --provision-local-key was used
```

Delete the GCP project last (irreversible after the grace window):

```bash
gcloud projects delete <your-project-id>
```

---

## 10. References

- **`deploy/README.md`** — deploy-tooling reference (scripts, tfvars layout, OIS_ENV convention). The multi-env section is the companion to this runbook.
- **`adapters/opencode-plugin/QUICKSTART.md`** — OpenCode plugin install + config mechanics.
- **`adapters/opencode-plugin/AGENTS.md`** — OpenCode plugin architecture.
- **`deploy/new-environment-bootstrap.sh --help`** — authoritative flag + phase reference for the wrapper.
- **`ARCHITECTURE.md`** — OIS architecture at a glance.
- **Mission-46 brief:** `docs/reviews/2026-04-phase-4-briefs/m-multi-env-substrate.md` (if authored post-ratification) or via Hub `get_mission(mission-46)`.

---

*Runbook v1.0 — mission-46 T4. Written for cold-operator-testable acceptance (Director amendment 2026-04-24). Report issues as bugs tagged `multi-env-operator-setup`.*
