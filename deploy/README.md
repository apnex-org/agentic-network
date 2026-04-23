# OIS Agentic Network — Terraform Deploy

Two-plan structure as of 2026-04-22. Pre-split monolith archived under `archive-pre-split-2026-04-22/` for reference.

## Structure

```
deploy/
  base/        — Foundation tier: APIs, SA + IAM, GCS bucket, Artifact Registry
               (long-lived; rarely destroyed; must apply first)
  cloudrun/    — Application tier: Hub + Architect services + public IAM
               (frequently redeployed; sometimes destroyed; reads base outputs)
  archive-pre-split-2026-04-22/ — Pre-split monolith (not active)
```

## Apply order

**Base must be applied before cloudrun.** The cloudrun plan reads base outputs (service_account_email, state_bucket_name, registry_prefix) via `terraform_remote_state` pointing at `../base/terraform.tfstate`.

```bash
# First-time setup (fresh project):
cd deploy/base
terraform init
terraform apply -var-file=env/prod.tfvars

cd ../cloudrun
terraform init
terraform apply -var-file=env/prod.tfvars

# Routine: update services without touching foundation:
cd deploy/cloudrun
terraform apply -var-file=env/prod.tfvars

# Teardown services only (leaves foundation intact):
cd deploy/cloudrun
terraform destroy -var-file=env/prod.tfvars
```

## Backends

Both plans use the **local backend** as of the split (state files kept in-dir). Migration to GCS remote backend is a planned future improvement — bucket exists (`gs://ois-relay-hub-state`), so bootstrap will be straightforward once we cut over. Until then: do not operate simultaneously from multiple machines.

## Environment files

- `{base,cloudrun}/env/prod.tfvars` — live values (gitignored)
- `{base,cloudrun}/env/prod.tfvars.example` — committed templates

**Required secrets in `cloudrun/env/prod.tfvars`:**
- `hub_api_token` — bearer token for Hub `/mcp` endpoint
- `architect_global_instance_id` — UUID identifying the Architect agent

## Outstanding

- **`build.sh` needs rewriting for split structure.** The pre-split version (now in `archive-pre-split-2026-04-22/build.sh`) assumed monolithic `terraform apply` in `deploy/` root. New build.sh should apply base + cloudrun in correct order and handle the `deploy-ts` label bump for each service independently. Candidate script-rationalisation mission.
- **Remote state migration to GCS.** Move both plans' state files from local to `backend "gcs"` pointing at `ois-relay-hub-state`. Chicken-and-egg mitigated by: base bucket already exists, so both can use GCS backend from the start (no bootstrap-on-local needed).
- **Generic CloudRun lifecycle scripts.** Replace ad-hoc `start-architect.sh` / `stop-architect.sh` / `start-hub.sh` (the latter currently contains the wrong script body — it operates on architect-agent) with a generic `cloudrun/{start,stop,delete}.sh <service-name>` pattern.
