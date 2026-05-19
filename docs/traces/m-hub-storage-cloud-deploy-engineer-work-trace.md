---
mission: mission-86 M-Hub-Storage-Cloud-Deploy
mission-anchor: idea-298 (folded with idea-305)
upstream: idea-295..300 post-mission-83 follow-on cluster; mission-83 W5.4 substrate-cutover precedent
engineer-branch: agent-greg/mission-86-cloud-deploy (off main @ db81add)
architect-branch: agent-lily/m-hub-storage-cloud-deploy (carries Design v1.0 / Survey v1.3 / Preflight)
design: docs/designs/m-hub-storage-cloud-deploy-design.md v1.0 RATIFIED (d35d023)
coord-thread: thread-592 (W0 wave coordination)
phase: Phase 8 Execution — 6-wave (W0-W5); autonomous per-wave; per-wave PR
---

# mission-86 — engineer-side work-trace

## §1 Mission context

Deploy production-substrate-Hub to GCP — internal-only e2-small VM (`australia-southeast1`)
via Terraform IaC; 3-container docker-compose stack (Hub + Postgres 15-alpine + Watchtower)
+ native-systemd backup-runner. TLS + ingress proxy at a Cloud Run nginx service reaching
the VM via Direct VPC Egress (no public VM IP). Image-CD: Cloud Build → Artifact Registry →
Watchtower. Hard-cutover migration via `hub-snapshot.sh` (mission-83 W5.4 precedent).
Bearer-token auth at Hub. bug-101 folded at W2. Cost envelope ~$20/mo.

**Waves:** W0 Terraform skeleton + CI/CD setup · W1 VM + compose + Cloud Run nginx + cold-boot ·
W2 state-migration + bug-101 fold + SIGTERM-handler prep · W3 bearer-token auth gate ·
W4 production cutover (~30s) · W5 validation + decommission + rollback runbook.

**RACI:** architect (lily) drives; per-wave PR to main + cross-approval; Director gate-points
= W4 cutover-window confirm + Phase 10 retro.

## §2 Session log

### 2026-05-20 AM AEST — mission-86 W0 pickup

- mission-86 ACTIVE (Director Release-gate ratify 2026-05-19); architect issued W0 on thread-592.
- Branched `agent-greg/mission-86-cloud-deploy` off `main @ db81add`; work-trace initialized.
- **Preflight (Design §6 engineer-flags) — GREEN:**
  - terraform CLI ✅ v1.12.2 (satisfies the `>= 1.5` constraint existing `deploy/` plans pin)
  - gcloud SDK ✅ 512.0.0; active credential = `terraform@labops-389703.iam.gserviceaccount.com`
  - GCP project ✅ `labops-389703` — CONFIRMED; matches architect-preliminary, `deploy/env/prod.tfvars`,
    `scripts/local/build-hub.sh`
- **3 wave-start findings surfaced to architect on thread-592:**
  - **F1** (HIGH — needs disposition): existing `deploy/` IaC convention (`deploy/base/` +
    `deploy/cloudrun/` 2-plan split; multi-env tfvars; `OIS_ENV` selection; `terraform_remote_state`;
    `new-environment-bootstrap.sh`; operator runbook) collides with Design §4.1 greenfield
    `infra/terraform/`. `deploy/cloudrun/main.tf` still *defines* a Hub-on-Cloud-Run service
    (pattern AG-2 rejects) — dead-but-present code; not live (only `litellm-proxy` deployed).
  - **F2** (correction): Design §5 W0 "AR repo `hub` (existing)" — no such repo; existing one is
    `cloud-run-source-deploy` (provisioned by `deploy/base/`). `hub-proxy` correctly new.
  - **F3** (reconcile): architect-thread "W0 = validate + plan only" vs Design AG-W0.4/.5/.7
    requiring real non-VM GCP creation (tfstate bucket + 2 SAs + nginx image build/push).
- W0 skeleton authoring HELD pending F1 layout disposition (determines every file path).

### 2026-05-20 — architect dispositioned F1/F2/F3; W0 authoring decisions

- Architect CONCUR all 3 findings; Design v1.1 RATIFIED at `0715410` (§4.1 rewrite + §5 W0 refresh).
  - F1(a): integrate as new plan within `deploy/` (reuse `deploy/base/`); parallel `infra/terraform/` REJECTED.
  - F1(b): retire dead Hub-on-Cloud-Run block in `deploy/cloudrun/` → new **AG-W0.8**.
  - F2: Hub image → existing `cloud-run-source-deploy` repo; nginx-proxy image repo engineer-decidable.
  - F3: "no production touch" = "no VM + nothing serving prod traffic"; W0 includes non-VM GCP mutations.
- W0 net scope (v1.1): 8 AG-W0 verifiers; new `deploy/hub/` plan + nginx-proxy image + `cloudbuild.yaml`
  + GCS backup-bucket + Cloud Build trigger (manual-only) + dead-block retirement.
- **Engineer W0-authoring decisions (engineer-decidable per §4.1 v1.1 latitude; documented for PR review):**
  - D1 plan dir = `deploy/hub/`
  - D2 file split = main/variables/outputs + network/compute/cloudrun/iam/storage/cloudbuild `.tf`
  - D3 state backend = `backend "gcs"` (bucket `labops-389703-tfstate`, prefix `hub`); per AG-W0.4.
    Diverges from base/cloudrun local-state (F5) — production IaC should not keep state on the operator
    laptop; recommend base/cloudrun GCS-migration as a follow-on idea.
  - D4 foundation reuse = `deploy/hub/` is self-contained (own dedicated SAs per OQ-14; own VPC). The
    only base-shared resource is the Artifact Registry repo, referenced by name as a variable — NO
    `terraform_remote_state` coupling (F6: base local-state is not present in every checkout). Deviates
    from AG-W0.2 "consumed via remote-state" wording.
  - D5 nginx-proxy image = `cloud-run-source-deploy/hub-proxy:latest` (no new AR repo).
  - D6 nginx-proxy image source = `deploy/hub/proxy/` (colocated with the plan).
  - D7 AG-W0.8 = remove Hub service block + IAM + outputs + hub-* vars from `deploy/cloudrun/`; rewire
    Architect block `MCP_HUB_URL` to a var + drop `depends_on` Hub (minimal-scope; the also-dead
    Architect-on-Cloud-Run block left in place — recommend whole-app-tier retirement as a follow-on).
- F4/F5/F6 = same architect-spec-drift calibration pattern (3rd/4th instances); all engineer-decidable
  per §4.1 latitude — proceeding + documenting for W0-PR review (no pre-author round-2 halt per
  `feedback_bilateral_audit_round_budget_discipline`).

### 2026-05-20 — W0 authoring in flight

- `deploy/hub/main.tf` + `variables.tf` authored (plan core: GCS backend, provider, API-enablement, image-ref locals).
- `deploy/hub/proxy/default.conf.template` + `Dockerfile` authored (nginx ingress-proxy image source per §4.15).
- `deploy/hub/network.tf` (VPC + subnet w/ private-google-access + 2 firewall rules), `iam.tf`
  (hub-vm-sa w/ 4 least-privilege roles + cloudrun-proxy-sa w/ none), `storage.tf` (GCS backup
  bucket + 30d lifecycle) authored.
- `deploy/hub/compute.tf` (static internal IP + PD-Standard data disk + internal-only e2-small
  VM, no access_config) + `scripts/startup.sh` (first-boot bootstrap: Docker + Ops Agent + data
  disk + .env-based 3-container compose stack + systemd hourly backup timer) authored.
- `deploy/hub/cloudrun.tf` (Cloud Run nginx proxy + Direct VPC Egress + public invoker IAM),
  `cloudbuild.tf` (Cloud Build trigger; disabled at W0), `outputs.tf`, `env/prod.tfvars.example`
  + root `cloudbuild.yaml` (hub + hub-proxy image build) authored — `deploy/hub/` plan COMPLETE.
- **`terraform validate` GREEN** (`terraform -chdir=deploy/hub validate` after `init -backend=false`)
  — AG-W0.1 preview PASS; `terraform fmt` clean.
