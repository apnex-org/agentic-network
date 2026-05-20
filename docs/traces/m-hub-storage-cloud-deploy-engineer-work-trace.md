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
- **AG-W0.8 — dead Hub-on-Cloud-Run block retired** from `deploy/cloudrun/`: removed the Hub
  `google_cloud_run_v2_service` + `hub_public` IAM + `hub_url`/`hub_mcp_url`/`hub_service_name`
  outputs + 6 hub-* vars; Architect block rewired (`MCP_HUB_URL` ← new `var.hub_mcp_url`;
  `depends_on` Hub dropped); `env/prod.tfvars.example` refreshed. `deploy/cloudrun/` `terraform
  validate` GREEN post-removal (AG-W0.8 preview PASS). Architect-on-Cloud-Run block left in place
  (also legacy, but beyond AG-W0.8 literal scope — recommend whole-dead-app-tier retirement +
  orphaned `deploy/build-hub.sh`/`deploy-hub.sh` cleanup as a follow-on hygiene idea).

### 2026-05-20 — W0 GCP mutations + AG-W0 verification

- main.tf API list hardened (+iam, +cloudresourcemanager, +vpcaccess) for the SA / IAM / Direct-VPC-Egress resources.
- **GCP mutations** (per architect F3 — non-VM setup-infra; nothing serving production traffic):
  - GCS tfstate-backend bucket `labops-389703-tfstate` created (versioned; public-access enforced).
  - `terraform init` against the GCS backend — auth via the `terraform@labops-389703` SA key
    (`GOOGLE_APPLICATION_CREDENTIALS`); ADC defaulted to the human account which lacked bucket
    access — local env-fix, not a finding.
  - `terraform apply -target` created the 7 W0 setup resources: GCS backup-bucket
    `labops-389703-hub-backups` + `hub-vm-sa` (4 roles) + `cloudrun-proxy-sa`.
  - `gcloud builds submit` built + pushed the nginx-proxy image → `cloud-run-source-deploy/hub-proxy:latest`.
- **AG-W0.1–W0.8 — ALL GREEN:**
  - W0.1 `terraform validate` Success (deploy/hub/)
  - W0.2 `terraform plan` clean — 28 resources incl. Cloud Run + Direct VPC Egress + VM; no errors
  - W0.3 `cloudbuild.yaml` valid YAML (3 build steps / 3 images)
  - W0.4 tfstate bucket exists + versioned + GCS-backend-locked; backup bucket created
  - W0.5 nginx-proxy image present in Artifact Registry
  - W0.6 no VM provisioned; only the pre-existing unrelated `litellm-proxy` serving
  - W0.7 `hub-vm-sa` + `cloudrun-proxy-sa` created; `hub-vm-sa` carries all 4 declared roles
  - W0.8 `deploy/cloudrun/` validates clean; 0 Hub Cloud Run blocks remain
- W0 authoring complete (8 commits); opening W0 PR + surfacing on thread-592.

### 2026-05-20 — W0 MERGED; W1 issued

- W0 PR #219 cross-approved + admin-squash-merged → `main @ 8454352`. F4/F5/F6 all architect-signed-off.
  W1 branch `agent-greg/mission-86-w1` cut off `origin/main @ 8454352`.
- 2 `deploy/`-IaC-hygiene follow-on candidates noted by architect for mission-86 Phase 10 filing
  (whole dead Cloud-Run app-tier retirement; base/cloudrun GCS-state migration).
- **W1 ISSUED** — VM + docker-compose + Cloud Run nginx + cold-boot (AG-W1.1–W1.11). W1 = full
  `terraform apply` of the W0-authored `deploy/hub/` plan. Dry-run `terraform plan`: **21 to add**
  — VPC + subnet + 2 firewalls + internal-only VM + static IP + PD-20GB + Cloud Run `hub-api` +
  Cloud Build trigger + 11 API enablements; 0 errors. Dispositive verifier AG-W1.4: end-to-end
  `curl https://hub-api-<hash>.a.run.app/health` → 200.
- **W1 operator-prerequisite:** the Cloud Build GitHub App must be connected to
  `apnex-org/agentic-network` (Cloud Console, one-time) before the `hub-image-cd` trigger can
  apply. Architect contingency: apply everything-except-trigger; sequence the trigger W1-tail.
- W1 `terraform apply` provisions real standing production infra (~$20/mo) — checkpointing with
  the operator before apply (prior-turn commitment + the operator-only GitHub-App prerequisite).

### 2026-05-20 — operator authorized autonomous execution; Design v1.3 absorbed

- Operator: "no need to clarify; ensure up to date with architect revisions; continue mission" —
  declined the per-wave checkpoint; W1 (incl. `terraform apply`) proceeds autonomously.
- **Design v1.3 RATIFIED `d6cceea`** — consolidated W1 amendment (thread-594; supersedes thread-593):
  - A1: Cloud Build trigger → **webhook trigger** (`apnex-org/agentic-network` is public; no GitHub App).
  - A2: **`modules/hub/` reusable-module restructure** — flat `deploy/hub/` plan → `modules/hub/`
    module + thin `deploy/hub/` root caller; parametrized for multi-project deployability.
  - A3: **full-IaC webhook closure** — `github_repository_webhook` (Terraform `github` provider);
    ZERO manual webhook steps. The W1 GitHub-App operator-prerequisite is RETIRED.
- W1 = restructure (before first apply) → `terraform apply` → cold-boot. AG-W1.1–W1.12.
- State note: W0 applied 7 resources (backup bucket + 2 SAs + 4 IAM) at flat addresses —
  W1 restructure `terraform state mv`s them into `module.hub.*` (re-home, not recreate).
- W1 branch `agent-greg/mission-86-w1` off `origin/main @ 8454352`.

### 2026-05-20 — W1 restructure complete; plan clean

- `modules/hub/` fully parametrized + authored: versions/main/variables/outputs +
  network/compute/cloudrun/iam/storage/cloudbuild `.tf` + proxy/ + scripts/.
  cloudbuild.tf rewritten — webhook trigger + `random_password`→Secret Manager +
  `google_apikeys_key` + `github_repository_webhook` (full-IaC closure per §4.12).
- `deploy/hub/` thin root caller authored (provider google+github + backend gcs +
  `module "hub"` block); `env/prod.tfvars(.example)`.
- `terraform state mv` re-homed the 7 W0 resources into `module.hub.*` (4 commands).
- `terraform validate` GREEN (AG-W1.12 preview). `terraform plan`: **30 add / 2
  in-place change / 1 replace** — clean, no errors.
  - replace: `module.hub.google_service_account.proxy` (`account_id` cloudrun-proxy-sa
    → hub-proxy-sa, name_prefix-driven; ForceNew). No live dependents — architect
    pre-acked; documented in the W1 PR body per the guard-rail.
  - in-place: hub_vm SA (display_name) + backup bucket (labels) — cosmetic.

### 2026-05-20 — W1 apply partial; cold-boot BLOCKED (F8); trigger 400 (F7)

- `terraform apply`: 28/30 created — network + VM + Cloud Run + Secret Manager +
  API key + SAs up; proxy SA replaced (`hub-proxy-sa`) per plan. FAILED: Cloud
  Build trigger + `github_repository_webhook`.
- **F8 (HIGH — design gap; cold-boot BLOCKER):** VM `metadata_startup_script`
  failed first boot — `curl https://get.docker.com` timed out (exit 28). The
  internal-only VM (no public IP, no Cloud NAT) has Google-API egress ONLY via
  Private Google Access — it cannot reach `get.docker.com` or Docker Hub
  (`postgres:15-alpine` / `containrrr/watchtower` per §4.3). §4.2/§4.3/§4.10 do
  not reconcile the internal-only topology with an internet-dependent bootstrap.
  **AG-W1.4 end-to-end cold-boot cannot pass until resolved.** Surfaced to
  architect (thread-594) — options: (A) Cloud NAT (~$30/mo — breaches the
  ~$20/mo envelope); (B) Google-mirror Docker apt-install + Artifact-Registry
  mirror of postgres/watchtower ($0). Recommended (B). Awaiting disposition.
- **F7 (mechanism):** webhook trigger `git_file_source repo_type=GITHUB` → Cloud
  Build `400 invalid argument` — `git_file_source` needs a host connection that
  v1.3 A1 rejected. Fix: inline `build {}` block (credential-free public clone
  in step 1, honoring §4.12 intent). Engineer-fix; documented for the W1 PR.
- Cold-boot probe: HTTP 502 — Cloud Run → Direct VPC Egress → VM path works; the
  VM Hub stack is simply absent (startup failed). Networking layer is sound.
- W1 holds at the cold-boot gate pending F8 disposition.

### 2026-05-20 — F8 → Option B; validate-first found B-as-specified INFEASIBLE; STOP + surfaced

- Architect disposed F8 → Option B (Design v1.4 RATIFIED `ac7ef22`); binding validate-first conditional.
- IAP-SSH validation on the live internal-only `hub-vm`:
  - ❌ Debian apt repos UNREACHABLE — GCE Debian 12 routes Debian packages via
    `deb.debian.org` / `debian.map.fastly.net` (Fastly CDN, NOT Google-hosted). `apt-get update`
    fails every Debian component. No Google-hosted Debian mirror exists in the image — v1.4 §4.2's
    "install Docker via the Google-hosted Debian apt mirror" premise does not hold.
  - ✅ `packages.cloud.google.com` (Google apt) reachable via PGA — Cloud Ops Agent path OK.
  - ✅ Artifact Registry `pkg.dev` reachable via PGA (HTTP 401) — AR-mirrored images pull OK.
- Blocker narrows to EXACTLY one thing: the Docker engine `.deb` (no Google-reachable source).
- STOPPED per the binding conditional; surfaced to architect (thread-594) with rescue variants —
  B1 AR apt remote-repo (recommended) / B2 pre-baked image / B3 COS / B4 staged `.debs`. All keep
  the ~$20/mo envelope + internal-only (no Cloud NAT). Awaiting disposition.

### 2026-05-20 — B1 validation FAILED; pivoting to B3 (COS) per pre-authorization

- Architect disposed B1 primary (AR remote pull-through repos) + B3 (COS) pre-authorized
  fallback; Design v1.5 RATIFIED `fadfc49`. Validate-first still binding for B1.
- B1 validation: created AR remote repos `hub-debian-remote` (APT — proxies Debian bookworm)
  + `hub-dockerhub-remote` (Docker — proxies Docker Hub). VM-side test (IAP-SSH on `hub-vm`):
  - VM reaches the AR APT remote endpoint (`pkg.dev`) — but `apt-get update` returned **HTTP
    404** on the package index (`.../hub-debian-remote/dists/bookworm/main/binary-amd64/Packages`).
    The AR-APT-remote-proxying-Debian path model does not cleanly line up with apt's request
    path; `apt-get install docker.io` → "Unable to locate package".
  - = "real friction — AR APT remote can't cleanly serve the Docker package set" per the
    architect's pivot criterion. Further B1 = blind trial-and-error on an under-doc'd AR feature.
- **PIVOTED to B3 (COS)** per architect pre-authorization (no fresh disposition cycle needed;
  OQ-1 Debian→COS reversal pre-approved). COS ships Docker pre-installed → eliminates the
  Docker-install failure class entirely.
- `hub-debian-remote` AR repo DELETED (B1-only; orphaned). `hub-dockerhub-remote` RETAINED —
  B3 still needs it (COS pulls postgres/watchtower via the AR Docker proxy; internal-only VM).
- B3 fix-pass next: compute.tf → COS boot image; startup.sh COS-rewrite (no Docker/Ops-Agent
  install; `/opt/hub/`→`/var/lib/hub/`; compose mechanism on COS); + F7 inline-build; re-apply.

### 2026-05-20 — B3 (COS) fix-pass authored; docker-auth bug fixed; trigger 400 persists

- B3 authored: compute.tf → COS boot image; startup.sh full COS rewrite (Docker pre-installed;
  `docker run`-direct 3-container stack — COS has no docker-compose; `/var/lib/hub/`; GCS-JSON-API
  backup, no gcloud); `artifactregistry.tf` → AR Docker pull-through remote (terraform-folded +
  `terraform import`ed); cloudbuild.tf → F7 inline-build trigger; root caller + tfvars + postgres/
  watchtower image vars; `cloudbuild.yaml` retired. `terraform validate` GREEN.
- `terraform apply`: VM replaced Debian→COS. COS startup progressed (Docker ✓, .env ✓, postgres
  `docker run` reached) but `docker pull` from the AR Docker remote → "Unauthenticated request" —
  `docker-credential-gcr configure-docker` didn't wire the credential. **FIXED**: startup.sh now
  does explicit `docker login -u oauth2accesstoken` with the metadata token (pending re-apply).
- **Cloud Build trigger STILL 400s** with the F7 inline `build` (so the 400 was NOT git_file_source —
  the common factor is `webhook_config`). TF_LOG=DEBUG: the Cloud Build API returns only "Request
  contains an invalid argument" with no field detail. 2 configs tried + debug-logged — undiagnosable
  from the error. Surfacing to architect: recommend defer AG-W1.6 (image-CD is W5-validated; the
  dispositive W1 cold-boot does not depend on the trigger).

### 2026-05-20 — COS auth root-caused + fixed; W1 cold-boot blocked by bug-101

- COS docker→AR auth: ROOT CAUSE = COS's `/root` is a read-only filesystem, so `docker login`
  / `docker-credential-gcr` could not write `~/.docker/`. Both prior auth attempts failed for
  that one reason. **FIXED:** `export DOCKER_CONFIG=<writable>` + `docker-credential-gcr
  configure-docker` — confirmed on the live VM (`docker pull` from the AR remote succeeds).
- Re-applied. COS VM bootstraps cleanly: all 3 images pull from Artifact Registry; **postgres +
  watchtower containers Up + healthy.** The B3/COS + internal-only-egress + AR-pull-through
  design is VALIDATED.
- **W1 cold-boot BLOCKER — bug-101:** the Hub container crash-loops —
  `[SchemaReconciler] boot failed: 22/22 SchemaDef apply failures: relation "entities" does not
  exist`. The Hub does not apply its substrate migrations on boot; it expects the `entities`
  table to pre-exist. Against W1's fresh empty postgres → crash. **This is bug-101**, whose fix
  the Design scheduled for **W2** (§5 W2 "bug-101 fold"). AG-W1.4 (end-to-end cold-boot) depends
  on it — a W1/W2 sequencing gap.
- Surfaced both blockers to architect (thread-594): bug-101 sequencing (options: manual-migrate
  W1 / pull fix forward / re-sequence AG-W1.4) + recommend defer AG-W1.6 (count-gate the trigger).
