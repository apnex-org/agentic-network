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
