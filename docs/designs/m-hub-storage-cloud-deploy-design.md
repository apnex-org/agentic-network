# idea-298 M-Hub-Storage-Cloud-Deploy — Design

**Version:** v2.11 **RATIFIED** 2026-05-21 (v2.10 + **W5 production-smoke soak DESCOPED** — Director-direct 2026-05-21: the ~24h soak is "not part of the mission." **AG-W5.2 [24h uptime smoke] removed.** **AG-W5.3 [backup-runner verify]** retained but satisfied-by-evidence — the ≥24-snapshot count was soak-coupled; the backup mechanism is proven by the post-cutover full-size hourly snapshots already in GCS, no wait required. W5 critical path collapses to [plugin-release → AG-W5.9]; decommission [W5.4/W5.5] loses its soak-hold. §5 W5.)
**Prior:** v2.10 (W5 trimmed of COS-VM-specific validation — AG-W5.1 descoped → idea-306) · v2.9 (AG-W3.12 verification-form pinned — harness pre-merge) · v2.8 (`vertex-cloudrun`/`director-chat` deprecated) · v2.6 (bug-103 mechanism DECIDED (D))
**Survey anchor:** `docs/surveys/m-hub-storage-cloud-deploy-survey.md` v1.2 RATIFIED (commit `8418439`)
**Idea:** idea-298 (folded with idea-305 anchors 2026-05-19; status=open)
**Class:** distribution-packaging (deployment-target work; substrate is mature)
**Branch:** `agent-lily/m-hub-storage-cloud-deploy`
**Mission ID:** TBD (Phase 5 Manifest pending)

---

## §1 Statement of Intent

Deploy production-substrate-Hub to a single **internal-only** GCE VM (e2-small; `australia-southeast1`) via Terraform IaC. The cloud-Hub IS the new production-Hub (operator-laptop demoted to consumer-only). VM runs a **3-container docker-compose stack (Hub + Postgres + Watchtower)** + native-systemd backup-runner. **TLS termination + ingress proxy lives at a Cloud Run service (nginx container; min-instances=1; auto-managed HTTPS via `*.run.app` URL).** Cloud Run reaches the VM via **Direct VPC Egress** (no public VM IP). Image-CD via Cloud Build → Artifact Registry → Watchtower auto-pull (Hub container only). Migration from local-Hub via hard-cutover (`hub-snapshot.sh` pattern; mission-83 W5.4 precedent). API surface enables single-org/multi-machine + future API-clients via Hub-issued bearer tokens. **Future Web UI / non-agentic comms (dashboards / Open WebUI) will deploy as separate Cloud Run services with Google IAP enabled — explicitly OUT of v1 scope per AG-11.** bug-101 (Hub bootstrap migration-apply) folded into W2.

## §2 Survey anchor (cite-inline per `feedback_design_audit_survey_anchor`)

Survey v1.2 RATIFIED at commit `8418439`. Subsequent **Director-direct mid-Phase-4 architectural pivot 2026-05-19** amended several W1 locks (captured here; Survey v1.3 amendment will fold these back into the envelope).

| Survey pick / W1 lock | Design impact | Status |
|---|---|---|
| Q1 (a+c+d) Production-availability + Operational-DX + Multi-operator | Cloud-Hub IS production; local-Hub decommission at W5 (OQ-9 Director-confirm) | unchanged |
| Q2 (a+b+d) Single-op + Multi-machine + API-clients | Bearer-token auth load-bearing in v1 (§4.13); human Web UI surface deferred to v1.x missions per AG-11 | unchanged |
| Q3 (c) Semi-auto CD | Cloud Build → Watchtower auto-update on Hub container (§4.12 + §4.7) | unchanged |
| Q4 (a) Postgres co-located on VM | Postgres in docker-compose; data on attached PD (§4.5 + §4.3) | unchanged |
| Q5 (a) Hard-cutover via hub-snapshot.sh | `cutover-to-cloud.sh` mirrors mission-83 W5.4 pattern (§4.14 W4) | unchanged |
| Q6 (b) Bearer token | Hub-issued tokens; postgres-backed table; Hub middleware (§4.13) | unchanged |
| W1 lock: Traefik 3.x on VM | **AMENDED:** proxy moves to **Cloud Run service running nginx** (§4.15) — K8s Gateway API future-compat motivation dropped per Director-direct |
| W1 lock: TLS at External HTTPS LB | **AMENDED:** TLS at **Cloud Run service (auto-managed `*.run.app`)** (§4.15) — eliminates LB + Static IP + Cloud DNS + managed-cert |
| W1 lock: Watchtower image-CD | Pulls Hub container only via opt-in label; Cloud Run nginx is Terraform-managed | unchanged |
| W1 lock: systemd backup outside compose | Native VM systemd; independent of container lifecycle (§4.8) | unchanged |
| W1 lock: `australia-southeast1` | Operator latency + matches Artifact Registry; Cloud Run also in same region (§4.15) | unchanged |
| W1 lock: e2-small | 2 vCPU shared / 2 GB RAM; ~$13/mo (§4.2) | unchanged |
| **NEW (Director-direct):** Cloud Run service + Direct VPC Egress | Single Cloud Run service `hub-api-<hash>.run.app`; nginx container; min-instances=1; routes to internal-IP VM via Direct VPC Egress | new lock |
| **NEW (Director-direct):** VM internal-only (no public IP) | VM has no public IP; SSH via IAP-tunnel only; LB-replaced-by-Cloud-Run reaches via Direct VPC Egress | new lock |
| **NEW (Director-direct):** AG-11 NO Web UI services in v1 scope | Web UI / dashboards / Open WebUI deferred to v1.x missions; each adds its own Cloud Run service with Google IAP | new anti-goal |
| **NEW (Director-direct):** AG-2 amendment: NO Cloud Run for Hub itself | Carve-out for ingress proxy use of Cloud Run; preserves original anti-goal reasoning | anti-goal amendment |

## §3 Architectural overview (post Cloud-Run pivot; 4 layers)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Internet                                                             │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ HTTPS (Cloud Run auto-managed TLS)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Layer C — Cloud (GCP) — Cloud Run + VPC                             │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Cloud Run service: hub-api-<hash>.run.app                    │   │
│  │  • nginx container (reverse-proxy; minimal config)           │   │
│  │  • min-instances=1 (no cold-start); max=10                   │   │
│  │  • Region: australia-southeast1                              │   │
│  │  • Direct VPC Egress → hub-vpc                               │   │
│  └────────────────────────────┬─────────────────────────────────┘   │
│                               │ HTTP (proxy_pass to VM internal IP) │
│  ┌────────────────────────────▼─────────────────────────────────┐   │
│  │ hub-vpc / hub-subnet                                          │   │
│  │  • Internal-only VM (no public IP)                            │   │
│  │  • Firewall: allow Cloud Run → VM:8080; IAP-tunnel SSH        │   │
│  └────────────────────────────┬─────────────────────────────────┘   │
└───────────────────────────────┼──────────────────────────────────────┘
                                │ Direct VPC Egress
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Layer A — docker-compose stack on internal-only e2-small VM         │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐             │
│  │     Hub      │──▶│   Postgres   │   │  Watchtower  │             │
│  │   (Node)     │   │  (15-alpine) │   │  (CD poll)   │             │
│  │   :8080      │   │     (PD)     │   │              │             │
│  └──────────────┘   └──────────────┘   └──────┬───────┘             │
│         ▲                                     │                     │
└─────────┼─────────────────────────────────────┼─────────────────────┘
          │                                     │
          │                                     ▼
          │                            Artifact Registry
          │                            australia-southeast1
          │
          │      ┌───────────────────────────────────────────────────┐
          │      │ Layer B — VM-native                               │
          ├──────│  • systemd backup-runner (hourly hub-snapshot.sh) │
          │      │    → gsutil → GCS bucket                          │
          │      │  • Cloud Ops Agent (logs + metrics → GCP)         │
          │      └───────────────────────────────────────────────────┘
          │
          │      ┌───────────────────────────────────────────────────┐
          └──────│ Layer D — CI/CD                                   │
                 │  • Cloud Build trigger on apnex-org main-merge    │
                 │  • Build hub image → push to Artifact Registry    │
                 │  • Watchtower polls (5min) + auto-deploys Hub     │
                 │  • Cloud Run nginx service: Terraform-managed     │
                 │    (no Watchtower for proxy; config-rare-change)  │
                 └───────────────────────────────────────────────────┘
```

**Eliminated from v0.2 design (Director-direct pivot 2026-05-19):**
- External HTTPS Load Balancer (~$18/mo)
- Static IP for VM (~$3/mo)
- Cloud DNS managed zone + A-record (~$0.40/mo)
- Google-managed-certificate
- Domain registration / management
- Traefik container on VM (proxy moves upstream to Cloud Run nginx)
- VM public IP (security improvement)

**Future-shape (out of v1; AG-11):**

```
                      Internet
                     /         \
              (browser)    (programmatic)
                ↓                ↓
        Cloud Run #2 (IAP)  Cloud Run #1 (no IAP; bearer-token)
        hub-ui-<hash>       hub-api-<hash>
                \               /
                 ↓ Direct VPC Egress ↓
              Same backend VM (Hub + Postgres + Watchtower)
```

## §4 Component design

### §4.1 Terraform module structure (v1.3 — reusable `modules/hub/` + thin `deploy/hub/` root caller)

**Lineage:** v1.0 prescribed greenfield `infra/terraform/` (architect-spec drift; W0 wave-start F1). v1.1 corrected to a new plan within the existing `deploy/` tree. **v1.3 (Director-direct 2026-05-19): structure "the hub" as a reusable module** — Director's stated intent is multi-project deployability ("the hub — a VM with its containerised resources — deployed multiple times in multiple projects, each configured differently: different registries, repos, sizing"). Declared reuse justifies a child module (no longer the "module per single-instance resource" anti-pattern).

**v1.3 structure — reusable module + thin root caller:**

```
modules/hub/                  ← THE REUSABLE UNIT (all hub logic; the repo's first child module)
├── network.tf                   VPC + subnet + firewall
├── compute.tf                   VM (internal-only) + docker-compose + startup
├── cloudrun.tf                  Cloud Run nginx proxy + Direct VPC Egress
├── cloudbuild.tf                webhook trigger + Secret Manager + github_repository_webhook
├── iam.tf                       service accounts + roles
├── storage.tf                   PD + GCS backup bucket
├── variables.tf                 ← ALL inputs — the parametrised interface
├── outputs.tf                   ← VM IP, Cloud Run URL, webhook URL, backup bucket, SA emails
├── versions.tf                  required_providers version constraints ONLY (no provider config)
├── proxy/ (Dockerfile + nginx conf)
└── scripts/ (startup.sh)

deploy/hub/                   ← THIN ROOT CALLER (one per deployment/project)
├── main.tf                      provider {} + backend {} + module "hub" { source = "../../modules/hub"; <inputs> }
├── variables.tf                 root pass-through vars
└── env/prod.tfvars              this instance's values
```

**Module-readiness disciplines (binding on `modules/hub/`):**
1. **Every project/env value is a `variable`** — NO hardcoded `labops-389703` / `apnex-org/agentic-network` / `cloud-run-source-deploy` anywhere in `modules/hub/`
2. **`name_prefix` variable drives all resource names** — multi-instance collision-safety (even within one project)
3. **`provider {}` + `backend {}` live ONLY in the `deploy/hub/` root caller** — `modules/hub/versions.tf` declares `required_providers` version constraints only; the root passes the provider
4. **Foundation dependencies are module *inputs*** (variables) — registry prefix, SA email, etc. wired by the root caller; `modules/hub/` never reaches into sibling-plan state (this also retires the F6 by-name awkwardness — it becomes a clean typed input)
5. **Complete `outputs.tf`** — everything a caller / cross-plan consumer needs

**Parametrised interface** (`modules/hub/variables.tf`; engineer confirms final set at W1-authoring):
- `project_id`, `region`, `zone`
- `name_prefix` (resource-naming + collision-safety)
- `hub_image`, `proxy_image` (full Artifact Registry image paths)
- `source_repo_url`, `source_repo_branch` (Cloud Build webhook trigger watch-target)
- `artifact_registry_repo` (build push-target)
- `machine_type`, `boot_disk_image`, `data_disk_size_gb`
- `proxy_min_instances`, `proxy_max_instances`, `watchtower_poll_interval`
- `vpc_cidr`, `backup_bucket_name`, `labels`, `environment`

`modules/hub/outputs.tf`: `vm_internal_ip`, `cloud_run_url`, `cloudbuild_webhook_url`, `backup_bucket`, `hub_vm_sa_email`

A second deployment = another thin root caller (`deploy/hub-<env>/` or a root in a different repo) pointing `source` at `modules/hub/` with different tfvars. mission-86's own deployment is the **first proof-instance** of the module.

**First-child-module note:** `modules/hub/` is the repo's first child module — a deliberate, Director-directed, reuse-justified divergence from the flat-root-plan convention (`deploy/base/`, `deploy/cloudrun/`). Unlike the F1 divergence, this one has explicit warrant. It also seeds the `modules/` directory for the future `deploy/`-wide modularization follow-on (e.g. `modules/cloud-run-service/`).

**Dead Hub-on-Cloud-Run retirement (greg F1(b); architect-CONCUR):** retained as a W0 hygiene deliverable (already shipped at W0 PR #219 / AG-W0.8) — `deploy/cloudrun/main.tf` Hub-on-Cloud-Run block removed (contradicted AG-2).

**Removed vs v0.2:** `lb.tf`, `dns.tf` — Cloud Run service URL is auto-managed; no LB / DNS provisioning at v1.

State backend: `deploy/hub/` root caller uses GCS tfstate backend (per `deploy/` convention).

**W1 restructure note:** W0 (PR #219, merged) shipped `deploy/hub/*.tf` as a flat root plan. W1 restructures into `modules/hub/` + thin `deploy/hub/` caller **before the first `terraform apply`** — applying the final module structure once (not flat-then-restructure). Mechanical: `git mv` concern-files into `modules/hub/`; author the variable/output interface; write the thin root caller; harden parameterization.

### §4.2 VM provisioning (Layer C)

`google_compute_instance` resource:

- `machine_type = "e2-small"`
- `zone = "australia-southeast1-a"` (or `-b` / `-c`; pick at engineer round-1 based on zone-availability)
- `machine_type = "e2-small"`
- `zone = "australia-southeast1-a"`
- `boot_disk` = **Container-Optimized OS (`cos-stable`)** — v1.6: OQ-1 (Debian-over-COS) REVERSED; B3 taken (greg W1 — see v1.6 amendment below). Docker pre-installed; Google-hosted image.
- `attached_disk` = PD-Standard 20 GB
- `service_account` = dedicated SA with roles: `storage.objectAdmin` (GCS backup) + `logging.logWriter` + `monitoring.metricWriter` + `artifactregistry.reader`
- `network_interface` = **internal-only** — `subnetwork = hub-subnet`; **NO `access_config` block** (no public IP; reachable only via Cloud Run Direct VPC Egress + IAP-tunnel SSH)
- `metadata_startup_script` = writes `docker-compose.yml` + systemd-timer for backup + bootstraps the compose stack (Docker NOT installed — pre-present on COS)
- `tags = ["hub-vm"]` for firewall targeting

**v1.5 amendment — bootstrap egress (greg W1 F8 fold; supersedes v1.4):** the VM is internal-only with egress to **Google services only** (Private Google Access; NO Cloud NAT — see §4.10). v1.0-v1.3 `metadata_startup_script` assumed general-internet reach (Docker install from `get.docker.com`) — invalid. **v1.4 then asserted "install Docker via the Google-hosted Debian apt mirror" — that premise was ALSO wrong** (greg W1 validation: GCE Debian 12 routes apt through `deb.debian.org` → `debian.map.fastly.net`, a Fastly CDN — NOT Google-hosted; not PGA-reachable). The binding validate-first conditional caught it before commit.

**v1.5 validated reachability (greg W1, from the live internal-only VM):**
- ❌ Debian apt repos (Fastly-served) — unreachable
- ✅ `packages.cloud.google.com` (Google apt) — reachable via PGA → Cloud Ops Agent installs fine
- ✅ Artifact Registry (`pkg.dev`) — reachable via PGA → AR-hosted artifacts pull fine

**v1.5 mechanism — AR remote repositories (primary; "B1"):** the Docker engine package is the *only* remaining gap (Ops Agent + all 3 container images already resolve via Google-reachable sources). Resolve it with an **Artifact Registry remote (pull-through) repository**: an AR `APT` remote repo proxying the upstream Debian/Docker apt source — the VM's `apt` installs the Docker engine through `pkg.dev` (PGA-reachable). Fully Terraform-IaC (`google_artifact_registry_repository` remote mode). The VM's egress stays Google-services-only. An AR Docker remote repo proxying Docker Hub may additionally replace the §4.3 manual image-mirror (engineer-decidable simplification).

**Sanctioned fallback "B3" — Container-Optimized OS:** if engineer B1-validation hits real friction (AR APT remote can't cleanly serve the Docker package set, or the resulting Docker/compose can't run the §4.3 compose file), engineer MAY pivot to COS (`cos-stable`; Docker pre-installed; Google-hosted image — eliminates the Docker-install problem entirely). This reverses OQ-1 (Debian-over-COS) — **architect pre-authorizes the reversal**: F8 has materially undermined OQ-1's "Debian for flexibility" premise (that flexibility is what needs internet). COS notes: systemd-timers supported; backup-runner script relocates `/opt/hub/` → `/var/lib/hub/` (COS writable-fs); native COS logging. Engineer surfaces the pivot-decision but it needs no fresh disposition cycle — both B1 and B3 sit inside the ratified envelope (~$20/mo; internal-only; Google-only egress).

**Validate-first remains binding for B1** — verify the AR APT remote actually serves the Docker package set to the VM + the installed Docker/compose runs the §4.3 compose file, before committing.

**v1.6 — RESOLVED: B3 (Container-Optimized OS) taken (greg W1).** B1 (AR APT remote for the Docker engine) hit friction; engineer pivoted to the pre-authorized B3 fallback. **The VM boots COS — Docker pre-installed; no boot-time Docker install at all; F8's whole failure-class eliminated.** OQ-1 (Debian-over-COS) is REVERSED — pre-authorized in v1.5. One COS-specific defect found + fixed at W1: COS `/root` is read-only, so `docker login` / `docker-credential-gcr` could not write `~/.docker/` — resolved by setting `DOCKER_CONFIG` to a writable path + the gcr credential helper. **Validated on the live VM: all 3 container images pull from Artifact Registry (via the AR Docker pull-through remote); postgres + watchtower containers Up + healthy.** The internal-only-egress + AR-pull-through architecture is proven. COS layout consequences: backup-runner script at `/var/lib/hub/` (COS writable-fs; not `/opt/hub/`); COS native logging composes with the Ops Agent path.

### §4.3 docker-compose stack (Layer A) — 3 containers post-pivot

`docker-compose.yml` shape (full content authored at engineer round-1; this is structural):

```yaml
# Note: `version:` field omitted (deprecated in docker-compose v2+; greg round-1 §E.3)
services:
  hub:
    image: <ARTIFACT_REGISTRY>/hub:latest
    container_name: ois-hub-prod
    restart: unless-stopped
    environment:
      - STORAGE_BACKEND=substrate
      - POSTGRES_CONNECTION_STRING=postgres://hub:${POSTGRES_PASSWORD}@postgres:5432/hub
      - BEARER_TOKEN_BACKEND=substrate      # postgres-backed tokens table (per §4.13 fold)
      - <other env-vars TBD at engineer round-1>
    ports:
      - "8080:8080"   # Cloud Run reaches via Direct VPC Egress + VM internal-IP:8080
    labels:
      - com.centurylinklabs.watchtower.enable=true
    depends_on:
      postgres:
        condition: service_healthy
    networks: [internal]

  postgres:
    image: <ARTIFACT_REGISTRY>/postgres:15-alpine    # v1.4: mirrored from Docker Hub into AR
    container_name: ois-postgres-prod
    restart: unless-stopped
    environment:
      - POSTGRES_DB=hub
      - POSTGRES_USER=hub
      - POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password
    secrets:
      - postgres_password
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hub -d hub"]
      interval: 5s
      retries: 5
    networks: [internal]

  watchtower:
    image: <ARTIFACT_REGISTRY>/watchtower:latest    # v1.4: mirrored from Docker Hub into AR
    container_name: watchtower-prod
    restart: unless-stopped
    command: --interval 300 --label-enable
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    networks: [internal]

volumes:
  postgres-data:

secrets:
  postgres_password:
    file: /etc/hub/postgres-password    # systemd-managed file written by metadata_startup_script

networks:
  internal:
    driver: bridge
```

**Traefik container REMOVED** (Director-direct pivot 2026-05-19; proxy lives upstream at Cloud Run nginx; see §4.15).

**v1.4 amendment — all images from Artifact Registry (greg W1 F8 fold):** the internal-only VM has NO general-internet egress (§4.10), so the compose stack CANNOT pull `postgres:15-alpine` + `containrrr/watchtower` from Docker Hub. **v1.4: all three images are sourced from Artifact Registry** (reachable via Private Google Access). The Hub image already builds into AR; **`postgres:15-alpine` + `containrrr/watchtower` are MIRRORED into AR** — a W1 deliverable: `docker pull` from Docker Hub (in Cloud Build or operator-side, where internet is available) → `docker tag` → `docker push` to `<ARTIFACT_REGISTRY>`. Pinned by digest where practical. This also tightens supply-chain posture — the VM's entire image dependency surface is mirrored into our AR control, not pulled from mutable public tags at boot.

### §4.4 Hub container config

- Image source: `<ARTIFACT_REGISTRY>/hub:latest` (built via Cloud Build; current build path: `scripts/local/build-hub.sh` → Artifact Registry)
- Substrate mode (production-default per CLAUDE.md hub-storage-substrate section)
- Auth middleware (NEW for cloud-deploy):
  - Reads bearer tokens from `/etc/hub/tokens.txt` (VM systemd-managed; immutable mount)
  - Validates `Authorization: Bearer <token>` header on every MCP call
  - Skip auth for `/health` endpoint (LB health-check)
  - Revoke-list check (per-token; cached + reloaded on tokens.txt SIGHUP / mtime poll)
- Audit-log: every authenticated MCP call logged with token-id + caller-ip + tool-name (no payload)

**v2.4 — §4.4 auth-middleware bullet SUPERSEDED by §4.13:** the v1.0-era text above (`/etc/hub/tokens.txt`; `SIGHUP`/mtime-poll reload; "LB health-check") predates the §4.13 decisions — **§4.13 is canonical**: tokens are a postgres-backed table (not a file), `/health` is skipped for the Cloud Run proxy (not an LB), and admin-auth is OQ-16(b) bootstrap-token via Secret Manager.

**v1.7 amendment — cloud-Hub repo-event-bridge config (greg W2 F11 fold):** §4.4 v1.0-v1.6 omitted the repo-event-bridge configuration — a Design-completeness gap. The cloud-Hub, post-W4-cutover, IS the production Hub; its repo-event-bridge is **load-bearing** (GitHub events → Hub). The bridge needs:
- `OIS_GH_API_TOKEN` — a GitHub API token, provisioned as a **Secret Manager secret** (same pattern as the webhook secret), surfaced to the Hub container as an env-var
- the repos-config (which repo(s) the bridge polls)
- startup.sh env-wiring to pass both into the Hub container
This is **folded into W3** (the auth-gate/secrets/config wave — natural fit; W3 already provisions Secret Manager + Hub-container env-config). Without it the cloud-Hub bridge no-ops at boot (greg W2 finding: cloud-Hub container never passed `OIS_GH_API_TOKEN`).

### §4.5 Postgres config

- **Image: `postgres:15-alpine`** (matches local-Hub exactly per `hub/spike/W0/docker-compose.yml:28`; eliminates cross-major-version dump-restore risk at W4 cutover per greg round-1 §G.3)
- Data volume: `postgres-data` Docker volume → backed by attached PD-Standard 20 GB
- Password: see §4.5.1 — secret-location (greg W2 F13 fold)
- Tuning: default Postgres 15 config sufficient at v1 workload
- **Postgres-17 upgrade is a separate future mission** (file as idea post v1 ship; not in cloud-deploy scope)

#### §4.5.1 Secret location — VM-replace survival (v1.9; greg W2 F13)

**The defect (F13):** v1.0-v1.8 had `startup.sh` generate `.env` (`POSTGRES_PASSWORD` + `HUB_API_TOKEN`) via a generate-once guard on the VM. But `/var/lib/hub/` is on the **ephemeral COS boot disk** (`auto_delete`). A `metadata_startup_script` change is a ForceNew Terraform attribute → `terraform apply` **REPLACES** the VM (destroy+create) — that is the normal COS-update mechanism AND it fires on *every* startup.sh change (including W3's F11 bridge-config). On replace: fresh boot disk → guard sees no `.env` → **regenerates `POSTGRES_PASSWORD`**. But postgres data is on the **persistent** data disk → the `hub` role keeps its OLD password → `28P01 auth_failed` crash-loop. The "replaceable cattle VM" premise was structurally broken — secrets-on-ephemeral-disk contradicts replaceable-VM. (Architect §4.4/§4.5 Design gap; greg W2 — first-ever VM replacement exposed the dormant defect.)

**v1.9 fix — two-stage:**
- **W2 (minimal; "F13(a)"):** `startup.sh` writes/reads `.env` on the **persistent data disk** (`/mnt/disks/hub-data/.env`), not the ephemeral boot disk. The generate-once guard now finds the existing `.env` across VM-replaces → stable password → postgres role matches. Survives replacement. (GCP encrypts the persistent disk at rest; VM is internal-only — acceptable plaintext-secret exposure for v1, same as before, just relocated.)
- **W3 (convergence; "F13(b)"):** secrets move to **GCP Secret Manager** — `startup.sh` fetches `POSTGRES_PASSWORD` + `HUB_API_TOKEN` from Secret Manager, alongside W3's F11 `OIS_GH_API_TOKEN`. Terraform-managed, off-disk, centrally rotatable. Supersedes the W2 persistent-disk `.env`. The VM SA gains `secretmanager.secretAccessor`.

**Broken-DB recovery (W2):** the current cloud-Hub DB holds throwaway W2(3)-test state (architect W2(3) sign-off) — recovery is to wipe the postgres data dir + let it re-init against the F13(a) persistent `.env`. W4's real cutover takes a fresh snapshot regardless.

### §4.6 ~~Traefik~~ (RETIRED at Director-direct pivot 2026-05-19)

Traefik container removed from VM. Reverse-proxy moved upstream to Cloud Run nginx service. See **§4.15** for current proxy design.

### §4.7 Watchtower config

- Image: `containrrr/watchtower:latest`
- Poll interval: 5 minutes (configurable; balances on-merge latency vs. registry-API load)
- Opt-in via Docker label `com.centurylinklabs.watchtower.enable=true` on Hub container ONLY
- Pull-restart sequence per Watchtower default: stop → pull → start → verify health
- No rollback automation (architect-flag for Phase 4 fold or future enhancement)
- Notification channel: TBD at engineer round-1 (Cloud Logging captures Watchtower stdout; could add Slack webhook if desired)

### §4.8 systemd backup-runner (Layer B; outside compose)

VM-resident systemd unit + timer:

```ini
# /etc/systemd/system/hub-backup.service
[Unit]
Description=Hub postgres snapshot to GCS
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
# v1.8 (greg W2 F12): COS mounts /var noexec — systemd execve() of a script
# on /var/lib/hub/ is blocked despite +x. Invoke via the bash interpreter
# (/bin/bash is on the exec-OK / mount; the script is read, not execve'd).
ExecStart=/bin/bash /var/lib/hub/hub-snapshot.sh
```

```ini
# /etc/systemd/system/hub-backup.timer
[Unit]
Description=Run hub-backup hourly

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

`/var/lib/hub/hub-snapshot.sh` (cloud-adapted from `scripts/local/hub-snapshot.sh`; v1.8 — path is `/var/lib/hub/` on COS, not `/opt/hub/` — COS `/opt` is read-only, `/var/lib/` is writable):
- `docker exec ois-postgres-prod pg_dump -Fc -U hub hub > /tmp/hub-${TIMESTAMP}.pgdump`
- upload to `gs://<GCS_BACKUP_BUCKET>/snapshots/` (GCS JSON API — no internet egress; PGA-reachable)
- Log to journald (captured by COS-native logging → Cloud Logging)

Cadence: hourly default; configurable via timer override. Retention via GCS lifecycle rule (e.g., 30-day delete on snapshots/).

**v1.8 — COS hardened-filesystem constraints (greg W2 F12):** COS mounts `/var` `noexec` and `/` read-only-except-specific-paths. Two consequences folded: (1) the backup script lives at `/var/lib/hub/` (writable) and is invoked `ExecStart=/bin/bash <script>` (the noexec mount blocks direct `execve`); (2) this is the same COS-hardening genus as the F8/B3 read-only-`/root` finding. AG-W1.5 (timer active+enabled) was a shallow verifier — it did not catch the never-runs failure; AG-W2.6 (end-to-end "GCS shows snapshot files") is the dispositive verifier that caught it. Verifier-strengthening lesson noted for Phase 10.

### §4.9 ~~External HTTPS LB~~ (RETIRED at Director-direct pivot 2026-05-19)

External HTTPS LB + Google-managed-cert + Static IP + Cloud DNS + custom domain all REMOVED. Cloud Run service (§4.15) provides TLS termination + stable URL.

### §4.10 VPC + firewall (Layer C; post-pivot)

- **Custom VPC `hub-vpc`** (greg round-1 §C OQ-13 CONCUR; cleaner separation; future-multi-VM ready)
- Subnet `hub-subnet` in `australia-southeast1`
- **VM has NO public IP** (internal-only; Cloud Run reaches via Direct VPC Egress)
- Firewall rules:
  - **`allow-cloudrun-to-vm`**: source = Cloud Run Direct-VPC-Egress source range (assigned per `google_vpc_access_connector` OR Direct VPC Egress subnet); allow tcp:8080 to `hub-vm` tag
  - **`allow-iap-ssh`**: source = IAP source range `35.235.240.0/20`; allow tcp:22 to `hub-vm` tag (greg round-1 §G.4 alignment; canonical IAP-tunnel pattern per OQ-15)
  - `deny-all-ingress`: default deny (default in Google VPC)
- **NO public-SSH endpoint** — operator SSH only via `gcloud compute ssh hub-vm --tunnel-through-iap`
- **`google_compute_router` + `google_compute_router_nat`** (v2.2; F15) — Cloud NAT for the subnet; provides VM outbound general-internet egress (the `repo-event-bridge` GitHub poll). Inbound unchanged — NO public IP.

**v1.4 — egress posture (greg W1 F8 fold; SUPERSEDED at v2.2):** v1.4 set the VM to **Google-services-only egress** — `private_ip_google_access = true`, NO Cloud NAT — a deliberate tight-egress posture. That held through W1-W2.

**v2.2 — Cloud NAT added (greg W2 F15; Director-direct 2026-05-20):** F15 found the cloud-Hub `repo-event-bridge` cannot reach `api.github.com` from the Google-services-only VM — and unlike F8's image-pulls, there is no Google-hosted mirror of the GitHub API, so the F8 mirror-solution does not transfer. The bridge is load-bearing post-cutover (GitHub events → Hub). **Director-direct disposition: add Cloud NAT** — `google_compute_router` + `google_compute_router_nat` on `hub-vpc` give the VM **outbound** general-internet egress; the `repo-event-bridge` polls `api.github.com` as designed (mission-52 poll model retained — no bridge re-architecture). The VM **remains internal-only for INBOUND** — still NO public IP; still reachable only via Cloud Run Direct VPC Egress + IAP-tunnel SSH. Cloud NAT adds outbound only.
- **Trade-offs Director-accepted:** (1) cost — Cloud NAT ~$32-35/mo → total envelope **~$50-55/mo** (up from the ~$20/mo Preflight-flagged figure; Director is the cost authority — E5 Preflight-flag); (2) the outbound egress surface widens from Google-services-only to general-internet. Director weighed both and directed Cloud NAT for the operational simplicity (standard pattern; no bridge re-architecture; general outbound egress is also useful beyond the bridge).
- F8's COS + AR-pull-through (boot-time Docker + images) is **retained** — it works, and AR-mirrored images keep a controlled supply-chain surface; Cloud NAT is added for the bridge's GitHub poll, not to undo F8.
- §4.2/§4.3 unchanged (Docker via Debian mirror + AR images still fine; Cloud NAT doesn't require reverting them).

### §4.11 ~~Cloud DNS~~ (RETIRED at Director-direct pivot 2026-05-19)

No DNS / domain provisioning at v1. Cloud Run service auto-URL `hub-api-<hash>-ts.a.run.app` is the canonical Hub endpoint. Adapter shim config uses this URL as `OIS_HUB_URL`. Custom domain mapping deferred to v1.1+ idea-fold candidate.

### §4.12 Cloud Build trigger (Layer D) — v1.2 WEBHOOK TRIGGER

**v1.1 → v1.2 amendment (Director-direct 2026-05-19):** trigger mechanism changed from GitHub-App-connected trigger to **webhook trigger**. Rationale: mission-86's trigger does only post-merge image-build (NOT PR-status-checks — those stay on the existing GitHub Actions CI). A webhook trigger is simpler, least-privilege (no standing GitHub App installed on `apnex-org`; just one outbound webhook + shared secret), more Terraform-coherent, and — because `apnex-org/agentic-network` is **public** — Cloud Build clones source credential-free, so no clone-credential is needed.

- `google_cloudbuild_trigger` with `webhook_config { secret }` (NOT `github { }` App-connection)
- Webhook secret stored in Secret Manager (`google_secret_manager_secret`; Terraformable)
- `source_to_build` / `git_file_source` references the public repo URL directly (credential-free clone — public repo)
- Trigger filters to `main` branch via webhook-payload substitution (the GitHub push-event payload carries `ref` + `after` SHA; trigger config keys on `ref == refs/heads/main`)
- Build steps (in `cloudbuild.yaml`) — UNCHANGED:
  - `docker build -t $REGISTRY/hub:latest hub/`
  - `docker push $REGISTRY/hub:latest`
  - (optional) `docker tag ... :$COMMIT_SHA` for rollback traceability
- Result: new image at Artifact Registry; Watchtower picks up within 5min poll interval

**v1.3 full-IaC closure (Director-direct):** the webhook registration is NOT a manual step — `modules/hub/cloudbuild.tf` includes a **`github_repository_webhook`** resource (Terraform `github` provider). One `terraform apply` creates the Cloud Build webhook trigger AND registers the GitHub repo webhook pointing at it (Terraform sequences the dependency). Terraform generates the shared secret once (`random_password` → Secret Manager) and wires it to both ends. `terraform destroy` cleanly removes the webhook; drift is detected.

- `github` provider configured in the `deploy/hub/` root caller; token supplied via `GITHUB_TOKEN=$(gh auth token)` at apply-time (operator runs `terraform apply` anyway — one env-var, no separate manual step)
- `github_repository_webhook` resource: `events = ["push"]`; `configuration { url, content_type = "json", secret }`
- ZERO manual webhook steps — W1 `terraform apply` fully closes the GitHub↔Cloud-Build loop

**Supersedes:** v1.1 "Cloud Build GitHub App connection" W1-prerequisite RETIRED (no GitHub App, no OAuth). v1.2 "post-apply manual webhook paste" RETIRED (now `github_repository_webhook` IaC). W1 has NO manual operator step anywhere.

### §4.13 Bearer-token CLI + auth gate

Per greg round-1 §E.2 CONCUR — clean operator-side / Hub-side split:

**Hub-side `/admin/*` endpoints** (Express route in `hub/src/admin/tokens.ts`):
- `POST /admin/tokens` — issue new token; body `{name, note}`; returns `{token-id, token, name, note, created_at}`
- `DELETE /admin/tokens/:token-id` — revoke token
- `GET /admin/tokens` — list tokens (returns token-id + name + note; NOT raw token values)
- **Admin-auth path — OQ-16 DISPOSED v2.4 (architect-confirm 2026-05-20):** SEPARATE from bearer-token (avoids chicken-egg). **(b) bootstrap-token** — provisioned as a 4th GCP Secret Manager secret `hub-admin-token` (terraform `random_password` → Secret Manager → `startup.sh` fetch → `HUB_ADMIN_TOKEN` env), validated by a **constant-time string compare** in the `/admin/*` guard. This supersedes the v0.1–v2.3 `/etc/hub/admin-token` VM-file: a boot-disk file regenerates on every VM-replace (the F13 failure-mode) and a persistent-disk file is the retired F13(a) pattern — Secret Manager is the F13(b)-consistent home, and the `hub-token` CLI reads the admin-token via `gcloud secrets versions access hub-admin-token` (no SSH-to-VM).
  - (a) GCP IAM service-account identity-token validation (Google-cert fetch + JWT-verify + SA-allowlist) is the better long-term posture (no shared secret) but materially more Hub-side code — **deferred to the v1.1 fold.**

**Operator-side `hub-token` CLI** (script in `scripts/cloud/hub-token`):
- `hub-token issue --name <client-name> --note <description>` — POSTs to Hub `/admin/tokens` with admin-auth
- `hub-token revoke <token-id>` — DELETEs to Hub `/admin/tokens/:token-id`
- `hub-token list` — GETs Hub `/admin/tokens`
- No SSH-to-VM-to-edit-file required — clean operator-DX

**Bearer-auth middleware** (in `hub/src/middleware/bearer-auth.ts`):
- Reads `Authorization: Bearer <token>` header
- Looks up token in cached tokens-DB (postgres-backed table; sourced via `/admin/tokens` writes)
- Reject 401 if invalid
- Skip auth for `/health` (LB health-check) + `/admin/*` (separate admin-auth path)
- Audit-log: every authenticated call gets {token-id, caller-ip, tool-name, timestamp} written to Cloud Logging

**Token storage shape decision:** postgres-backed table (NOT tokens.txt file). Simpler reload (no SIGHUP-on-file-mtime); persists across container restart; revocation is single SQL DELETE. Replaces architect-preliminary `/etc/hub/tokens.txt` from v0.1.

### §4.15 Cloud Run service + Direct VPC Egress (NEW; Director-direct pivot 2026-05-19)

**Cloud Run service `hub-api`:**

| Property | Value |
|---|---|
| Image | Custom nginx-based proxy container (built once via Terraform-managed Cloud Build job OR pinned `nginx:alpine` + config-mount) |
| Region | `australia-southeast1` (matches VM zone) |
| Concurrency | 80 (default; sufficient at v1 scale) |
| CPU | 0.5 vCPU (smallest tier; nginx footprint trivial) |
| Memory | 128 MB |
| min-instances | 1 (no cold-start; ~$5/mo for one warm instance) |
| max-instances | 10 (auto-scale on traffic spike) |
| Ingress | All (public; per `*.run.app` URL stable + auto-TLS) |
| Egress | Direct VPC Egress → `hub-vpc/hub-subnet` (Cloud Run network interface in VPC; no VPC connector cost) |
| IAP | **DISABLED** for `hub-api` (programmatic clients use bearer-token at Hub; future `hub-ui` Cloud Run services will have IAP enabled per AG-11 follow-on missions) |

**nginx config** (baked into container image; Cloud Build trigger rebuilds on `infra/cloudrun/nginx.conf` change):

```nginx
events {}
http {
  upstream hub_backend {
    server <VM_INTERNAL_IP>:8080;
  }
  server {
    listen 8080;

    # Health endpoint for Cloud Run probes
    location = /health {
      proxy_pass http://hub_backend/health;
      access_log off;
    }

    # All other paths to Hub
    location / {
      proxy_pass http://hub_backend;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto https;
      # Authorization header (bearer-token) passes through transparently
      proxy_read_timeout 300s;       # MCP keepalive
      proxy_send_timeout 300s;
    }
  }
}
```

**Direct VPC Egress configuration** (Terraform `google_cloud_run_v2_service` resource):

```hcl
template {
  vpc_access {
    network_interfaces {
      network    = google_compute_network.hub_vpc.id
      subnetwork = google_compute_subnetwork.hub_subnet.id
    }
    egress = "PRIVATE_RANGES_ONLY"  # Cloud Run only reaches private IPs; public internet via standard egress
  }
}
```

**VM internal IP discovery:** static internal IP assigned via Terraform; nginx config references at build-time (substituted by Cloud Build at image-build OR mounted as env-var-rendered config at Cloud Run startup).

### §4.14 Cutover orchestration (W4)

**Prerequisite (greg round-1 §E.1 CRITICAL fold; W2-prep):** Hub source-code adds SIGTERM handler mirroring existing SIGINT handler at `hub/src/index.ts:852` (~5 lines). Cloud-deploy ship includes this Hub change as a W2-prep deliverable (small; bundled). After this, `docker stop` gracefully drains Hub.

**Greg round-1 audit finding (v0.1 architect-spec drift; B-class):** v0.1 had `kill -USR2 1` — code-grep confirmed Hub does NOT handle SIGUSR2 (zero matches in `hub/src/`). Architect-spec was fabricated. Folded to clean `docker stop` via SIGTERM handler addition.

`scripts/cloud/cutover-to-cloud.sh` (operator-run; ~30s downtime target):

```bash
# Pre-flight
gcloud compute instances describe hub-vm --format=json > /tmp/pre-cutover.json
docker ps | grep ois-hub-local-prod

# 1. Stop local-Hub (graceful drain via SIGTERM; new in W2-prep)
docker stop --time=30 ois-hub-local-prod

# 2. Snapshot local-postgres (cloud-postgres also v15-alpine; matches; no cross-major)
bash scripts/local/hub-snapshot.sh
LATEST_DUMP=$(ls -t local-state/snapshots/*.pgdump | head -1)

# 3. Upload to cloud staging bucket
gsutil cp "$LATEST_DUMP" gs://<CUTOVER_BUCKET>/

# 4. SSH into cloud-VM (via IAP-tunnel); restore postgres
gcloud compute ssh hub-vm --tunnel-through-iap -- 'gsutil cp gs://<CUTOVER_BUCKET>/$(basename "$LATEST_DUMP") /tmp/ && \
  docker exec ois-postgres-prod pg_restore -U hub -d hub --clean --if-exists /tmp/$(basename "$LATEST_DUMP")'

# 5. Verify cloud-Hub via Cloud Run URL
curl -H "Authorization: Bearer <PROBE_TOKEN>" https://hub-api-<HASH>.a.run.app/health

# 6. Adapter shim URL switch (operator-machine; OIS_HUB_URL env-var):
#    OIS_HUB_URL=https://hub-api-<HASH>.a.run.app   (previously: http://localhost:8080)
#    Update on lily + greg adapter shim configs + restart adapter sessions

# 7. Decommission local-Hub container (per Director-flag OQ-9 disposition)
docker rm ois-hub-local-prod ois-postgres-local

echo "Cutover complete; cloud-Hub at hub-api-<HASH>.a.run.app"
```

Rollback path: re-restore from previous snapshot OR re-start local-Hub + revert `OIS_HUB_URL` env-var on adapter shims.

**Manual rollback runbook (per greg round-1 §C OQ-11):** in `docs/operator/cloud-deploy-rollback-runbook.md`:
1. `gcloud builds list --filter="status=SUCCESS" --limit=10` — find previous-known-good build SHA
2. `gcloud artifacts docker tags add <REGISTRY>/hub:<previous-sha> <REGISTRY>/hub:latest` — re-tag previous as latest
3. `gcloud compute ssh hub-vm --tunnel-through-iap -- docker exec watchtower-prod kill -USR1 1` — force Watchtower re-poll OR `docker pull + docker restart` manually
- Scripted rollback deferred to v1.1 (idea-fold candidate at retro)

## §5 Wave-by-wave breakdown

### W0 — IaC plan authoring + CI/CD setup (v1.1 — `deploy/` integration)

Deliverables:
- New `deploy/<hub-plan>/` Terraform plan per §4.1 v1.1 (integrated into existing `deploy/` tree; reuses `deploy/base/` via `terraform_remote_state`; inherits multi-env tfvars + `OIS_ENV` convention) — post-pivot resources (no `lb.tf`/`dns.tf`; includes Cloud Run nginx + Direct VPC Egress)
- nginx-proxy image source: `nginx.conf` + `Dockerfile` (location per `deploy/` convention; engineer-final)
- `cloudbuild.yaml` for Hub image build trigger + nginx-proxy image build trigger
- **Retire dead Hub-on-Cloud-Run block in `deploy/cloudrun/main.tf`** (greg F1(b); AG-2 hygiene)
- GCS backup-bucket created
- Artifact Registry: existing `cloud-run-source-deploy` (DOCKER; provisioned by `deploy/base/`) for Hub image; nginx-proxy image in same repo OR new `hub-proxy` repo (engineer-decidable)
- Cloud Build trigger configured (NOT firing on main-merge yet; manual-trigger only at W0)

**W0 scope clarification (greg F3):** "No production touch" = **no VM provisioned + nothing serving production traffic** (AG-W0.6). W0 DOES include non-VM GCP mutations: tfstate-backend (per `deploy/` convention), GCS backup-bucket, dedicated SAs, and a manual `gcloud builds submit` pushing the nginx-proxy image. These are setup-infra, not production-serving. Some foundation resources (shared SA/IAM, Artifact Registry) may already exist via `deploy/base/` — engineer reconciles create-vs-reference at authoring.

AG-W0:
- AG-W0.1 `terraform validate` exits 0 (new `deploy/<hub-plan>/` plan)
- AG-W0.2 `terraform plan` shows hub-specific resources to be created (no errors); includes Cloud Run service + Direct VPC Egress config; `deploy/base/` foundation consumed via remote-state
- AG-W0.3 `cloudbuild.yaml` syntax-validates
- AG-W0.4 GCS tfstate-backend exists + locked (per `deploy/` convention) + GCS backup-bucket created
- AG-W0.5 Manual `gcloud builds submit` produces nginx-proxy image in Artifact Registry
- AG-W0.6 No VM provisioned + nothing serving production traffic
- AG-W0.7 Dedicated SAs (`hub-vm-sa`, `cloudrun-proxy-sa`) created (or `deploy/base/`-provided + referenced) with declared IAM roles per OQ-14 CONCUR
- AG-W0.8 Dead Hub-on-Cloud-Run block removed from `deploy/cloudrun/main.tf`; `deploy/cloudrun/` plan still `terraform validate`s clean post-removal

### W1 — module restructure + VM (internal-only) + docker-compose + Cloud Run nginx + cold-boot

Deliverables:
- **W1-prep: module restructure (Design v1.3 §4.1)** — `git mv` W0's flat `deploy/hub/*.tf` concern-files into `modules/hub/`; author `modules/hub/variables.tf` (parametrised interface) + `outputs.tf` + `versions.tf`; write thin `deploy/hub/` root caller (`provider {}` + `backend {}` + `module "hub" {}` + env tfvars); harden parameterization (NO hardcoded project/registry/repo in `modules/hub/`). Done BEFORE `terraform apply` — apply the final module structure once.
- `terraform apply` (via `deploy/hub/` root caller) provisions: VPC + subnet + firewall + VM (e2-small; **internal-only**) + PD (20GB) + Cloud Run service `hub-api` (nginx-proxy; min-instances=1; Direct VPC Egress) + Cloud Build **webhook trigger** + webhook-secret (`random_password` → Secret Manager) + **`github_repository_webhook`** (full-IaC GitHub↔Cloud-Build closure) + dedicated SAs
- `GITHUB_TOKEN=$(gh auth token)` exported at apply-time for the `github` provider (no separate manual webhook step — full-IaC per §4.12 v1.3)
- **v1.4 — image-mirror deliverable:** `postgres:15-alpine` + `containrrr/watchtower` mirrored from Docker Hub into Artifact Registry (`docker pull` → `tag` → `push`, run where internet is available — Cloud Build or operator-side; pin by digest where practical)
- VM `metadata_startup_script` (v1.4): installs Docker via Google-hosted Debian apt mirror (NOT `get.docker.com`); deploys docker-compose.yml; bootstraps 3 containers (Hub + Postgres + Watchtower) — **all images pulled from Artifact Registry** (no Docker Hub; no general-internet egress)
- systemd backup-timer installed + enabled (no actual backups happen yet; postgres empty)
- Cloud Ops Agent installed (Google-hosted install path)
- **F7 (engineer-mechanism):** Cloud Build webhook trigger uses an inline `build {}` block (step 1 = credential-free public `git clone`) — `git_file_source repo_type=GITHUB` needs a host-connection that v1.3 A1 rejected; inline-build honors the webhook-not-GitHub-App intent
- Cold-boot test: Cloud Run nginx → VM → Hub → 200 OK on `/health` end-to-end

**v1.6 — W1/W2 sequencing fix (greg W1 bug-101 finding):** AG-W1.4 (end-to-end cold-boot) requires the Hub to BOOT — but the Hub crash-loops on a fresh empty postgres (`SchemaReconciler boot failed: relation "entities" does not exist`) because it does not apply its own substrate migrations on boot. **That is bug-101** — and v1.0-v1.5 scheduled bug-101's fix at W2. W1's dispositive verifier depended on a W2 deliverable — a Design sequencing error. **v1.6 disposition (greg Option (a); architect-CONCUR):** W1 uses a **declared migration-scaffold** — the 3 SQL migrations (`hub/src/storage-substrate/migrations/`) are manually applied (`docker exec`) into W1's postgres so the Hub boots and AG-W1.4 verifies the network path. This is honest scaffolding, NOT the bug-101 fix — it is explicitly labelled in the W1 PR. bug-101's REAL fix (Hub bootstrap migration-apply mechanism) + its dispositive test (AG-W2.2.a empty-postgres boot, fresh) remain at W2. The scaffold cleanly separates W1's concern ("cloud infrastructure + network path correct") from W2's ("Hub self-migration mechanism correct").

AG-W1:
- AG-W1.1 `terraform apply` exits 0
- AG-W1.2 `gcloud compute ssh hub-vm --tunnel-through-iap -- docker ps` shows 3 containers running (Hub + Postgres + Watchtower) — **3 NOT 4 post-pivot**
- AG-W1.3 `gcloud compute ssh hub-vm --tunnel-through-iap -- curl localhost:8080/health` returns 200 (VM-local Hub health check)
- AG-W1.4 `curl https://hub-api-<HASH>.a.run.app/health` returns 200 — **end-to-end through Cloud Run nginx → Direct VPC Egress → VM Hub** (dispositive verifier for the Cloud Run pivot + network path). **v1.6: Hub-boot via declared W1 migration-scaffold; self-migration mechanism = W2/AG-W2.2.a.**
- AG-W1.5 `systemctl status hub-backup.timer` shows active + enabled (no snapshots yet)
- AG-W1.6 **DEFERRED (v1.6; greg W1 finding F9):** Cloud Build webhook trigger — `google_cloudbuild_trigger` + `webhook_config` returns an opaque `400 invalid argument` (tried `git_file_source` + inline `build {}` + `TF_LOG=DEBUG`; API gives no field detail). Trigger is authored + IaC-ready but `count`-gated (disabled) so W1 ships clean. Image-CD is only end-to-end-validated at W5 — the trigger is NOT on W1-W4's critical path. **F9 must be diagnosed + the trigger enabled before W5** (W5/AG-W5.1 image-CD validation depends on it).
- AG-W1.12 module structure verified — `modules/hub/` contains all hub logic; `deploy/hub/` is a thin root caller (`module "hub"` block); `terraform validate` clean; no hardcoded project/registry/repo literals in `modules/hub/` (grep-verified)
- AG-W1.7 Watchtower logs show first poll attempt (visible in Cloud Logging)
- AG-W1.8 Cloud Logging + Monitoring agents shipping data (visible in Cloud Console)
- AG-W1.9 Cloud Run service min-instances=1 verified — `gcloud run services describe hub-api` shows `minScale: '1'`
- AG-W1.10 VM has NO public IP — `gcloud compute instances describe hub-vm --format='value(networkInterfaces[0].accessConfigs)'` returns empty
- AG-W1.11 VM unreachable from public internet — `curl http://<theoretical-public-IP>:8080` times out / fails (no public IP exists)

### W2 — State migration test + bug-101 fold + Hub SIGTERM-handler prep

Deliverables:
- **W2-prep: Hub SIGTERM-handler addition** (greg round-1 §E.1; ~5 lines at `hub/src/index.ts`; ship as small bundled change; required for clean `docker stop` at cutover W4)
- bug-101 fix: Hub bootstrap migration-apply mechanism (engineer to author per `hub/src/storage-substrate/migrations/` schema)
- Pre-flight: run `scripts/local/hub-snapshot.sh` on local-Hub → produces test dump
- Upload dump to GCS cutover-bucket
- SSH into cloud-VM (via IAP-tunnel); restore dump to cloud-postgres
- Verify cloud-Hub bootstrap correctly applies migrations (bug-101 fix dispositive)
- Verify bridge resumes polling from restored cursor
- Verify Hub state queryable (test: `list_missions`, `list_threads` etc. via temporary direct connection)

AG-W2 (strengthened per greg round-1 §B.1):
- AG-W2.1 Test dump restore completes without error
- **AG-W2.2.a (DISPOSITIVE — bug-101 root-cause verifier):** Boot cloud-Hub against EMPTY postgres (no `entities` table); confirm Hub bootstraps successfully + migrations apply + `\dt` shows `entities` table + `entities_kind_id_idx` index present. Pinned: **M = N = 3** for current migration count (`001-entities-table.sql` + `002-notify-trigger.sql` + `003-jsonb-size-check.sql` per `hub/src/storage-substrate/migrations/`).
- **AG-W2.2.b (IDEMPOTENCY verifier):** Boot cloud-Hub against post-migration postgres + immediate re-boot (2nd boot); confirm migrations are idempotent (no re-application errors; reconciler STRICT-ALL-OR-NOTHING composes per mission-85 PR #216).
- AG-W2.3 Substrate query returns latest mission ID on cloud-Hub matching pre-snapshot
- AG-W2.4 **RE-SEQUENCED → W3 (greg W2 F11 fold):** bridge-resume verification requires the cloud-Hub bridge to be configured — and the bridge config (`OIS_GH_API_TOKEN` etc.) is a W3 deliverable (§4.4 v1.7). "Bridge resumes within 60s from restored cursor" is verified at W3 (AG-W3.x) after the bridge exists. W2's state-migration test verifies the state RESTORE (AG-W2.3 + AG-W2.5); the bridge-resume-from-restored-cursor moves to W3.
- AG-W2.5 No data-loss: post-restore entity counts match pre-snapshot counts
- AG-W2.6 systemd backup-runner produces hourly snapshots; GCS bucket shows snapshot files
- AG-W2.7 SIGTERM handler verified — `docker stop --time=30` produces clean shutdown log entry (no SIGKILL fall-through; in-flight ops completed)

**v1.7 — AG-W2.2.a index-name correction (greg W2):** the kind+id index is `entities_pkey` (the `PRIMARY KEY (kind,id)`) — v1.0-v1.6's `entities_kind_id_idx` name was approximate. Verifier intent (composite kind+id index present) is met by the PK; verifier reads `entities_pkey`.

**v1.7 — F10 fold:** `scripts/local/hub-snapshot.sh` requires a host `pg_dump` not installed on the operator host (local-Hub postgres runs in the `hub-substrate-postgres` container). W2 amends `hub-snapshot.sh` to `docker exec` the `pg_dump` against the postgres container — small, and W4-blocking (it is the `cutover-to-cloud.sh` §4.14 dump-tool). Folded into W2.

**v1.9 — F13 fold (VM-replace survival):** the W2 F12 fix (a `startup.sh` change) triggered the first-ever VM replacement, which exposed F13 — secrets regenerate on the ephemeral boot disk + diverge from the persisted postgres role → `28P01` auth crash-loop (the COS VM could not survive a replacement). **W2 fix ("F13(a)"):** relocate `.env` generation/read to the persistent data disk (`/mnt/disks/hub-data/.env`) — survives VM-replace (§4.5.1). Broken-DB recovery: wipe postgres data dir + re-init (W2(3) test-state is throwaway per architect sign-off). The proper Secret Manager convergence ("F13(b)") is W3. F13(a) blocks W2 completion — a bricked VM cannot verify F12/AG-W2.6; AG-W2.6 + AG-W2.2.a re-verify on the post-F13(a) VM.

(bug-101 status flip moved to mission-completion gate AG-12-class per greg round-1 §B.1)

### W3 — Bearer-token auth gate + F11/F13(b) + bug-102/103 (Cloud Run nginx-proxy already wired at W1)

**v2.0 — W3 ships as 2 sub-PRs** (greg W3-start; sharpened by bug-103's Hub-side reframe):
- **Sub-PR A — secrets/config (pure terraform/infra; zero Hub-source):** F11 (cloud-Hub bridge config) + F13(b) (secrets → Secret Manager). W4-cutover-critical + unblocked → ships first.
- **Sub-PR B — Hub message/auth (pure Hub-TS):** bearer-token auth gate + bug-102 (`kind=note` encoding). **v2.5: bug-103 is deliberate-scoped OUT of Sub-PR B** into its own slice (see the bug-103 slice section + the v2.5 fold entry below) — Sub-PR B = bearer-auth + bug-102 only.

Deliverables:
- Hub `/admin/tokens` endpoints authored (POST issue / DELETE revoke / GET list)
- `hub-token` CLI authored + tested (calls Hub `/admin/tokens` with admin-auth)
- Hub `bearer-auth.ts` middleware authored + integrated (postgres-backed tokens table; cached lookup)
- Admin-auth path implemented — **OQ-16 DISPOSED v2.4:** (b) bootstrap-token as a 4th Secret Manager secret `hub-admin-token` (NOT a VM-file); constant-time compare in the `/admin/*` guard. Sub-PR B accordingly also touches `secret-manager.tf` + `compute.tf` + `startup.sh` for the 4th secret — the admin-token infra is part of the bearer-auth deliverable (the "pure Hub-source" A/B framing relaxes; coherent — a bearer-auth PR provisioning its own admin-token). (a) GCP IAM-SA validation = v1.1 fold.
- Audit-log entries shipped via Cloud Logging
- Cloud Run nginx-proxy already wired at W1 — W3 just adds auth-layer; no proxy reconfig needed
- **v1.7 — F11 fold: cloud-Hub repo-event-bridge configuration** (§4.4 v1.7). Provision `OIS_GH_API_TOKEN` as a Secret Manager secret + repos-config; wire both into the Hub container via startup.sh. The cloud-Hub bridge is load-bearing post-cutover (GitHub events → Hub) — must be live before W4.
- **v2.2 — F15 fold: Cloud NAT** (§4.10 v2.2; Director-direct 2026-05-20). `google_compute_router` + `google_compute_router_nat` on `hub-vpc` — gives the internal-only VM outbound general-internet egress so the `repo-event-bridge` can poll `api.github.com`. Without it F11's token-config is inert (bridge `fetch failed → halted`). Lands in W3 Sub-PR A (pure-infra); unblocks AG-W3.9/.10. Cost envelope → ~$50-55/mo (Director-accepted).
- **v1.9 — F13(b) fold: secrets → Secret Manager convergence** (§4.5.1). `POSTGRES_PASSWORD` + `HUB_API_TOKEN` move to GCP Secret Manager alongside F11's `OIS_GH_API_TOKEN` — `startup.sh` fetches all three; supersedes W2's persistent-disk `.env` (F13(a)); VM SA gains `secretmanager.secretAccessor`. W3 is the natural home — it is already the Secret-Manager-introducing wave.
- **v1.7 — bug-102 fix** (`create_message kind=note` payload-encoding) — already folded at W3 per the original disposition
- **v2.0 — bug-103 (PR-event notification) — DIAGNOSED + reframed** (greg W3-start trace). The original bridge/translator frame was wrong: the bridge DOES produce `pr-opened`, `PR_OPENED_HANDLER` DOES fire, 51 `pr-opened-notification` Messages ARE synthesized. The actual bug is Hub-side — all `pr-opened-notification`s are stuck at `status:new`, never projected/delivered (leading hypothesis: bridge-injected `authorRole:architect` → `target:architect` → self-message → projection skip; bug-98-adjacent). bug-103 regroups with bug-102 (both Hub-side `kind=note` bugs) — lands in W3 Sub-PR B (Hub-source), not the infra sub-PR. Must resolve before W4.
- **v2.3 — bug-103 root-cause CONFIRMED** (greg W3 delivery-pipeline trace; architect-disposed 2026-05-20). The v2.0 leading hypothesis (self-message-skip `author==target` / bug-98-adjacent) is **REFUTED** — `synthesizePrNotification` correctly targets the peer role; there is no `author==target` skip. **Confirmed cause:** `kind:note` messages carrying a `target.role` have **no durable delivery path** — the `message-policy.ts` dispatch→Message path creates the Message + fires one ephemeral SSE `message_arrived` push but never calls `pendingAction.enqueue()`; no sweeper transitions a `status:new` `kind:note`. (Contrast `thread-policy.ts`, which `pendingAction.enqueue()`s `kind:reply`/thread-messages → they deliver.) Substrate proof: 86 architect-targeted `kind:note` messages (`pr-opened/merged/review-approved-notification` + `commit-push-thread-heartbeat`) all stuck `status:new`, zero PendingActions — **broader than PR-events** (heartbeat notes stuck too). **Fix:** add the missing `kind:note`→PendingAction enqueue path — engineer-mechanism (synchronous-enqueue mirroring `thread-policy.ts` preferred; a `status:new`-draining sweeper is rejected — it reintroduces a poll-loop against the post-bug-93 substrate-watch direction). Inline in Sub-PR B alongside bug-102. AG-W3.12 unchanged (a `pr-opened-notification` is the witness instance — proving it delivers proves the class).
- **v2.5 — bug-103 deliberate-scoped OUT of W3 + W4-sequencing DISPOSED** (greg fix-scope finding; Director-approved Option A 2026-05-20). greg's implementation-trace found the bug-103 fix is NOT a clean `thread-policy` mirror: `PendingActionDispatchType` is a closed entity-bound enum (a `note` dispatchType is a real schema addition), `enqueue()` is single-`targetAgentId` (a role-targeted note needs role→agent fan-out), and a new dispatchType needs adapter-side rendering in BOTH `adapters/claude-plugin` + `adapters/opencode-plugin` — **cross-codebase**. Past the pre-set "touches the pipeline broadly / cross-codebase → deliberate-scope" bar → **bug-103 is split OUT of Sub-PR B** into its own slice (see the bug-103 slice section below). Blast-radius (greg trace): `kind:note`→role delivery is broken for architect (86 stuck) AND director (70 stuck — `emitDirectorNotification`) — 100%-`new` for both roles (a systematic, role-conditioned miss; engineer gets some via the ephemeral SSE path). **W4-sequencing — Director-approved Option A:** W4 proceeds on schedule; **bug-103 does NOT gate the cutover** — it is a pre-existing bug (equally broken on the local-Hub), so the cutover carries it across unchanged and introduces no new regression. bug-103 is a post-W4 fast-follow slice; **AG-W5.9** (end-to-end production proof) is its mission-close gate. This **supersedes the v2.0 "Must resolve before W4."**

AG-W3:
- AG-W3.1 `hub-token issue --name test-client` produces a token (called via admin-auth)
- AG-W3.2 `curl -H "Authorization: Bearer <invalid>" https://hub-api-<HASH>.a.run.app/mcp` returns 401
- AG-W3.3 `curl -H "Authorization: Bearer <valid>" https://hub-api-<HASH>.a.run.app/mcp` returns 200 (or appropriate MCP response)
- AG-W3.4 `curl https://hub-api-<HASH>.a.run.app/health` returns 200 (no auth required for health)
- AG-W3.5 `hub-token revoke <token-id>` removes token + subsequent calls 401
- AG-W3.6 Audit-log entries written + visible in Cloud Logging
- AG-W3.7 `/admin/tokens` endpoints require admin-auth; reject without it
- AG-W3.8 Token storage = postgres-backed `tokens` table (NOT tokens.txt file)
- **AG-W3.9 (v1.7; F11 + v2.2 F15):** cloud-Hub repo-event-bridge configured AND reachable — `OIS_GH_API_TOKEN` Secret Manager secret wired into the Hub container; Cloud NAT live; bridge boots non-no-op AND successfully polls `api.github.com` (`[repo-event-bridge] Bridge running` + a successful poll cycle, no `fetch failed`, in Hub logs)
- **AG-W3.10 (v1.7; AG-W2.4 re-sequenced):** bridge resumes from the restored cursor within 60s of cloud-Hub start (verified now that the bridge is configured)
- **AG-W3.11 (v2.1; bug-102):** `create_message kind=note` with an object payload succeeds (no "got string" rejection) — regression test green + a live round-trip on the fixed cloud-Hub.
- **AG-W3.12 (v2.1; bug-103 — DISPOSITIVE; v2.5: RE-HOMED to the bug-103 slice):** bug-103 left W3 (v2.5) — this verifier is verified at the **bug-103 slice**, not at W3-close. Criterion (unchanged, broadened v2.5 to both affected roles): `kind:note`→role notifications **deliver**, not just synthesize. On the bug-103-fixed Hub, a `pr-opened-notification` (synthesized by `PR_OPENED_HANDLER`) **progresses past `status:new`** — durably delivered, reaching `received`/`acked` against the target-role agent — and the same holds for a director-targeted `kind:note`. Verifier must observe actual *delivery*, not merely "the notification row exists" — the original bug was rows stuck at `status:new`. (Director-direct 2026-05-20: the outcome — notifications flowing to architect AND director — is the acceptance bar, not the code-patch.)

### W4 — Production cutover

**v2.5 — bug-103 does NOT gate W4** (Director-approved Option A 2026-05-20): the W4 cutover proceeds on schedule independent of bug-103. bug-103 is a pre-existing `kind:note`-delivery bug carried across the cutover unchanged (no new regression); it is fixed in the post-W4 bug-103 slice, gated on AG-W5.9 before mission-close.

Deliverables:
- `scripts/cloud/cutover-to-cloud.sh` authored + tested in dry-run mode
- Bilateral pre-cutover audit: greg + lily review script + rollback path
- Adapter shim config-update prepared (operator-side; flip `OIS_HUB_URL` from `http://localhost:8080` → `https://hub-api-<HASH>.a.run.app`)
- Cutover scheduled (Director-confirm cutover window)
- Execute cutover with ~30s downtime
- Adapter shim config swapped; agents reconnect to cloud-Hub via Cloud Run URL
- Verify all agents online + functional

AG-W4:
- AG-W4.1 Cutover script executes successfully end-to-end
- AG-W4.2 Cloud-Hub state matches local-Hub state at cutover-time (entity counts; latest IDs)
- AG-W4.3 All agents (lily + greg) reconnect within 60s of cutover via Cloud Run URL (v2.8: the `director-notification listeners` clause dropped — `vertex-cloudrun`/`director-chat` deprecated Director-direct 2026-05-20)
- AG-W4.4 First post-cutover MCP call succeeds (e.g., `list_missions`) — through Cloud Run nginx → VM Hub
- AG-W4.5 Local-Hub stopped + state archived (snapshot to permanent GCS location)
- AG-W4.6 Adapter shim configs all show Cloud Run URL (`OIS_HUB_URL=https://hub-api-<HASH>.a.run.app`)
- AG-W4.7 No data-loss vs pre-cutover snapshot

### bug-103 slice — `kind:note`→role delivery-recovery (deliberate-scope; post-W4 fast-follow)

**v2.5 — NEW; v2.6 — diagnosis COMPLETE + mechanism DECIDED.** bug-103 was a W3 deliverable, deliberate-scoped into its own slice. **Director-approved Option A:** post-W4 fast-follow — does NOT gate the cutover; gated on AG-W5.9 before mission-close.

**Diagnosis — COMPLETE** (greg trace + live instrumented check, 2026-05-20). The SSE-inline live-delivery path is *healthy* — a connected recipient gets a `kind:note` in ≈18ms (test note-C: delivered + rendered + claimed to a connected architect, even at `COGNITIVE_TTL=0` — `agent.state="streaming"` is a connection-state, not a turn-state). The bug is purely **delivery-recovery on reconnect**: a note pushed while the recipient is disconnected is lost — ephemeral SSE drops it, and the adapter's `list_messages` catch-up poll (`firstTimerEnabled`) is switched off (a bug-53/#180 scope-deferral), so nothing recovers it. The note IS durable Hub-side (`status:new` in postgres) — the recipient just never learns of it. The earlier "two strands / systematic-miss" reframe dissolved: no separate claim-side defect; the architect/director 0/226 is cumulative bursty-session timing (notes that landed while the adapter was disconnected).

**bug-104 surfaced** (filed major) — `message-repository-substrate.ts` `listFiltered` + `replayFromCursor` do an unfiltered `LIMIT 500` prefetch + client-side filter → `list_messages` answers over an arbitrary ~4% window of the 12k-Message substrate. Independent of bug-103's gap, but it must be fixed for the catch-up poll to function.

**Mechanism — DECIDED: (D)** (architect, 2026-05-20; Director "proceed as recommended"). Re-enable the adapter catch-up poll, on top of the bug-104 fix. (D) is the architecture's own designed hybrid SSE+poll-backstop (Design v1.2 #5) — `firstTimerEnabled: false` is a switched-off piece, not a missing one; robust for long-disconnection (polls durable postgres `status:new`); minimal + target-state-aligned. **(A)** new `note` dispatchType + PendingAction enqueue — REJECTED (overloads the PendingAction abstraction; notes aren't entity-bound; heaviest cross-codebase). **(C)** durable-SSE replay — REJECTED (bounded replay window misses hours-long disconnection).

Deliverables — **one PR** (the bug-103 slice; apnex-org cross-approval; hub + both adapters) — shipped as **PR #224**:
- **bug-104 fix** — `listFiltered` + `replayFromCursor`: push `targetRole`/`status`/`since` into the SQL `WHERE` + `ORDER BY id` so `LIMIT` applies to the filtered set. Fixes the `list_messages` MCP tool + makes the catch-up poll functional.
- **Re-enable `firstTimerEnabled`** — both adapters (`claude-plugin` + `opencode-plugin`). Verify: (i) the catch-up fires on each (re)connect; (ii) it queries `list_messages({targetRole, status:"new"})` (post-bug-104); (iii) polled notes render as `<channel>` notifications + claim (`new→received`) via the same delivery path as SSE-inline.
- **bug-104** resolves on merge (directly verifiable); **bug-103** resolves on AG-W3.12 + AG-W5.9.

**v2.7 — director-recipient disposition; v2.8 — vertex-cloudrun/director-chat DEPRECATED.** greg's trace (2026-05-20): the Director runs `agents/vertex-cloudrun` — its own codebase + adapter; it does NOT use `@apnex/network-adapter` or the plugin `PollBackstop`, so mechanism (D) structurally does not reach it. **Director-direct 2026-05-20: the `vertex-cloudrun` + `director-chat` interfaces are FULLY DEPRECATED — a new UI solution will be developed.** So bug-103's director-recipient delivery is **out of scope** — fixing push-delivery to a deprecated interface is moot; director-notification delivery is owned by the forthcoming UI solution. bug-104's `listFiltered` fix nonetheless stands as a general substrate-correctness fix (it repairs `list_messages` / `list_director_notifications` for **any** consumer — including the future UI). AG-W3.12 is verified with the engineer as recipient (below); no director-targeted harness.

AG (bug-103 slice):
- **AG-W3.12 (re-homed here; v2.9 — harness pre-merge form):** the recovery mechanism is role-agnostic (`pollBackstop.tick()` → `list_messages({targetRole, status:"new"})` → `router.route` render + `fireClaimMessage` claim — identical code per role; bug-104 verified `list_messages` correct for both roles). The claude-plugin adapter is marketplace-distributed (a versioned plugin reaching a running session only via the `m-github-releases-plugin-distribution` release pipeline — not a self-service rebuild). **Pre-merge verification:** run the rebuilt shim as a **standalone engineer-role harness** against the live Hub — connect → reconnect-hook → catch-up tick → recover the stranded engineer `status:new` backlog (psql-observable `new→received`). This exercises #224's actual code end-to-end; the render-to-live-`<channel>` half is covered by composition (note-C proved SSE→`router.route`→live `<channel>`; the poll feeds the identical `router.route`). The **real-adapter-in-production** form folds into AG-W5.9 (it requires a plugin re-release to reach running adapters). director-targeted case not harnessed — deprecated recipient (v2.8).
- **AG-W5.9** (verified in W5) — the end-to-end production proof (the architect-in-production confirmation).

### W5 — Validation + decommission + rollback runbook

**v2.10 — W5 trimmed (Director-approved 2026-05-20).** The Rocky VM re-platform (idea-306) supersedes the COS VM, so W5 descopes COS-VM-specific validation: the **image-CD chain validation** (Cloud Build → Watchtower → cloud-Hub restart — AG-W5.1) is **descoped** — Watchtower image-CD is bug-107-broken (COS-specific) and AG-W1.6 (Cloud Build trigger) is deferred; image-CD is validated on the Rocky VM in idea-306. **bug-107 is NOT fixed on COS** (the Rocky re-platform resolves it via writable /root) — leave it `investigating`, linked to idea-306. In the interim the production COS Hub uses the manual redeploy path (`docker pull` + `google_metadata_script_runner startup`). All OS-agnostic W5 items below are retained.

**v2.11 — production-smoke soak DESCOPED (Director-direct 2026-05-21).** The ~24h soak is "not part of the mission." **AG-W5.2 (24h uptime smoke) is removed.** **AG-W5.3 (backup-runner verify) is retained but satisfied-by-evidence** — the ≥24-snapshot count was soak-coupled; the backup mechanism is proven by the post-cutover full-size hourly snapshots already in GCS (22 confirmed at cutover+22h, ~8.8 MB each = migrated production state), no soak/wait required. Consequence: the W5 critical path collapses to **[plugin-release → AG-W5.9]**; the decommission (W5.4/W5.5) loses its soak-stability hold.

Deliverables:
- ~~Image-CD validation via docs-only PR mechanism~~ — **DESCOPED v2.10** → validated on the Rocky VM in idea-306 (the COS-VM Watchtower path is bug-107-broken; the Rocky re-platform supersedes this VM).
- ~~Production smoke: run normal agent workflows for ~24h; observe stability~~ — **DESCOPED v2.11** (Director-direct; soak not part of the mission).
- Backup-runner verify: hourly snapshots in GCS — **v2.11: satisfied-by-evidence** (mechanism proven by post-cutover full-size snapshots; the ≥24 count was soak-coupled).
- Local-Hub container removed from operator-machine (per Director-flag OQ-9 — strategic decision)
- Local state archive moved to permanent GCS retention
- **Manual rollback runbook authored at `docs/operator/cloud-deploy-rollback-runbook.md`** (per greg round-1 §C OQ-11; 3-step recipe; scripted rollback deferred to v1.1)
- bug-101 status flipped to `resolved` (mission-completion gate)

AG-W5 (strengthened per greg round-1 §B.2):
- **AG-W5.1 — DESCOPED v2.10.** The COS-VM image-CD chain (Cloud Build trigger → Watchtower auto-pull → cloud-Hub restart) is NOT validated in mission-86 W5 — Watchtower image-CD is bug-107-broken (COS-specific) + AG-W1.6 (Cloud Build trigger) deferred, and the Rocky re-platform (idea-306) supersedes the COS VM. image-CD validation moves to the idea-306 mission. (A real PR-merge as the AG-W5.9 vehicle is retained — see AG-W5.9.)
- **AG-W5.2 — DESCOPED v2.11** (Director-direct 2026-05-21). The ~24h uptime soak is not part of the mission.
- AG-W5.3 backup-runner verified — hourly snapshots in GCS, post-cutover snapshots full-size (migrated production state). **v2.11: satisfied-by-evidence** — the mechanism is proven; the ≥24 count was soak-coupled and is no longer a wait-gate.
- AG-W5.4 Local-Hub container + postgres removed from operator-machine
- AG-W5.5 Local state archived (final snapshot at fixed permanent GCS path)
- AG-W5.6 Manual rollback runbook exists at `docs/operator/cloud-deploy-rollback-runbook.md`; engineer dry-run validates 3-step recipe (against test image-tag, not production)
- AG-W5.7 bug-101 status = `resolved`
- **AG-W5.9 (v2.1; v2.9 — bug-103 end-to-end production proof + real-adapter form; v2.10 — self-contained):** PR-event notifications **flow to the architect in production**. AG-W5.1's image-CD test-PR is descoped (v2.10), so **AG-W5.9 stands alone** — merge a real no-op docs PR to `main`; confirm the production cloud-Hub's repo-event-bridge produces the PR-event (`pr-opened`/`pr-merged`) and the **architect actually receives** the notification (not stuck at `status:new`). This is the end-to-end production proof of the bug-103 fix + the **real-adapter form** of AG-W3.12 (AG-W3.12's pre-merge form is the standalone-shim harness). **Dependency (v2.9):** the bug-103 adapter-half (`firstTimerEnabled` + reconnect-hook) reaches running adapters only via a plugin re-release (`m-github-releases-plugin-distribution`) — AG-W5.9 therefore requires a plugin release landing before mission-close (surface the release timing at W5-planning). bug-103 status → `resolved` once AG-W3.12 (harness) + AG-W5.9 hold. (bug-102 already `resolved` — PR #223.)
- AG-W5.8 Mission close-ready

## §6 Open questions — engineer round-1 dispositions

| # | Question | Architect-view | Engineer disposition (greg round-1 thread-591) |
|---|---|---|---|
| OQ-1 | Boot disk: COS vs Debian 12 | Debian 12 | **CONCUR** — Debian for systemd-timer + Ops Agent install flexibility |
| OQ-2 | Postgres password mechanism | Docker secret + systemd-managed env file | **CONCUR direction** — engineer impl pattern ~5 lines |
| OQ-3 | Watchtower poll-interval: 5min? | 5min | **CONCUR** |
| OQ-4 | Backup-runner cadence: hourly? | hourly | **CONCUR** (RPO=1h tolerable v1) |
| OQ-5 | Domain name? | TBD | **DEFERRED to v1.1** — Director-direct 2026-05-19 pivot uses Cloud Run auto-URL (`*.run.app`); domain mapping is future-cycle idea-fold candidate |
| OQ-6 | Bearer-token expiry: none for v1? | static (none) for v1 | **CONCUR-with-flag** — rotation candidate for v1.1 |
| OQ-7 | Tokens storage path | `/etc/hub/tokens.txt` (v0.1); **revised v0.2:** postgres-backed table | **CONCUR revised shape** (cleaner; persists; per-row revocation) |
| OQ-8 | Audit-log: Cloud Logging only? | yes | **CONCUR** (free-tier at expected volume) |
| OQ-9 | Local-Hub decommission at W5? | yes (no shadow-prod) | **CONFIRMED via Director-implicit-accept at 2026-05-19 pivot engagement** (greg-CONCUR + architect-default + Director did not push back to demote-to-dev when asked) |
| OQ-10 | Image-tag: `:latest` + `:commit-sha`? | both | **CONCUR** |
| OQ-11 | Rollback automation deferred v1.1? | yes | **CONCUR-with-flag MEDIUM** — v1 ship includes 3-step manual rollback runbook; scripted deferred |
| OQ-12 | PD-Standard 20GB? | yes | **CONCUR** |
| OQ-13 | Custom VPC `hub-vpc`? | yes | **CONCUR** (folded into §4.10) |
| OQ-14 | Dedicated SA `hub-vm-sa`? | yes | **CONCUR** (least-privilege) |
| OQ-15 | IAP-tunnel SSH? | yes | **CONCUR-with-flag MILD** — adds `gcloud ssh --tunnel-through-iap` wrapper; ops-runbook docs at v1 ship |
| **OQ-16 (NEW)** | **Admin-auth path for `/admin/tokens` endpoint?** | (a) GCP IAM service-account token OR (b) Bootstrap-token; architect-preliminary (b) | **DISPOSED v2.4 (architect-confirm 2026-05-20): (b) bootstrap-token as a 4th Secret Manager secret `hub-admin-token` — NOT a VM-file (F13(b)-consistent); constant-time compare. (a) IAM-SA = v1.1 fold.** |

### Director-action items — ALL RESOLVED at 2026-05-19 pivot engagement

- **OQ-5 Domain name** — **DEFERRED to v1.1** (Cloud Run auto-URL at v1)
- **OQ-9 Local-Hub decommission at W5** — **CONFIRMED decommission**
- **OQ-16 Admin-auth path** — **DISPOSED v2.4 (architect-confirm 2026-05-20):** (b) bootstrap-token as a 4th Secret Manager secret `hub-admin-token`; constant-time compare in the `/admin/*` guard; (a) GCP IAM-SA deferred to v1.1 (architect-decidable per the OQ-16 framing — not a Director gate)
- **NEW OQ-17 (Director-direct pivot):** Cloud Run proxy choice — **nginx** (Director-ratified 2026-05-19; K8s Gateway API future-compat motivation dropped)
- **NEW OQ-18 (Director-direct pivot):** Cloud Run cold-start handling — **min-instances=1** (Director-ratified; ~$5/mo trade-off accepted)
- **NEW OQ-19 (Director-direct pivot):** Cloud Run → VM connectivity — **Direct VPC Egress** (Director-ratified; newer; free)
- **NEW AG-11 (Director-direct pivot):** NO Web UI services in v1 scope (deferred to v1.x; Google IAP pattern at that time)
- **AG-2 AMENDMENT (Director-direct pivot):** Original "NO Cloud Run / serverless" anti-goal AMENDED to "NO Cloud Run for Hub itself" — carve-out preserves intent (Hub-on-Cloud-Run was rejected for stateful-substrate reasons; nginx-on-Cloud-Run is stateless ingress and architecturally clean)

## §7 Audit ratify-criteria (round-1 engineer-fold status)

| RC-N | Criterion | Status |
|---|---|---|
| RC-1 | All 16 OQ-N (15 + new OQ-16) dispositioned | ✅ 15 resolved (OQ-16 DISPOSED v2.4 — admin-auth (b) bootstrap-token) + 2 Director-flag (OQ-5, OQ-9) |
| RC-2 | All 6 wave AG-N sets verifier-ready (executable checks; deterministic) | ✅ AG-W2.2 strengthened (greg §B.1 fold); AG-W5.1 specified (greg §B.2 fold); other waves complete |
| RC-3 | Survey v1.2 anchors cited inline correctly in §2; no spec-drift | ✅ PASS per greg round-1 §A |
| RC-4 | Component design §4.1-§4.14 has no missing piece for v1 ship | ✅ folded greg §E.2 (§4.13 admin endpoint) + §G.4 (§4.10 IAP firewall) + §E.1 (§4.14 SIGTERM handler); rollback runbook added |
| RC-5 | Anti-goals from Survey §5 not violated by Design choices | ✅ PASS per greg round-1 §G.1 |
| RC-6 | bug-101 fold confirmed in W2 + AG-W2 verifier exercises bootstrap migration-apply | ✅ AG-W2.2.a dispositive verifier (empty-postgres boot) + AG-W2.2.b idempotent verifier; pinned M=N=3 per current migration count |
| RC-7 | Cost envelope verified against actual Terraform resources spec'd in §4 | ✅ PASS revised to **~$20/mo** range post-Cloud-Run-pivot (down from $35-37; eliminated LB $18 + Static IP $3 + Cloud DNS $0.40; added Cloud Run min-instances=1 ~$5) |
| RC-8 | Cross-mission completeness check | ✅ PASS per greg round-1 §D (mission-78 missioncraft via OIS_HUB_URL env-var; idea-299 BlobBody non-precluded; mission-84 substrate-only confirmed; pulse-cadence unaffected; bug-93 substrate-watch on cloud-postgres ✓) |
| RC-9 (NEW) | Cross-major-version postgres risk eliminated | ✅ Cloud-postgres pinned to `postgres:15-alpine` (matches local exactly; postgres-17 upgrade as separate future mission) |
| RC-10 (NEW) | Hub SIGTERM handler addition specified as W2-prep deliverable | ✅ folded at §4.14 + W2 deliverables; ~5 lines code change |

## §8 References

- `docs/surveys/m-hub-storage-cloud-deploy-survey.md` v1.2 (Survey anchor; commit `8418439`)
- `docs/methodology/mission-lifecycle.md` v1.2 (Phase 4 Design phase)
- `docs/methodology/idea-survey.md` v1.0
- idea-298 (source; folded with idea-305)
- bug-101 (production-Hub bootstrap migration-apply; OPEN; folded into W2)
- mission-83 retrospective (W5.4 hard-cutover pattern reference)
- mission-84 retrospective (FS-retirement; substrate-only Hub artifact)
- `scripts/local/build-hub.sh` (Artifact Registry already in use; image-build reference)
- `scripts/local/hub-snapshot.sh` (operator-side dump tool; cloud-adapted at §4.8 + §4.14)
- `scripts/local/start-hub.sh` (operator-side Hub start; reference for env-var conventions in §4.4)
- `CLAUDE.md` Hub storage substrate section (substrate-mode production-prod path)
- `feedback_design_audit_survey_anchor` (Survey-fidelity sweep methodology)
- `feedback_architect_drives_engineer_engagement_when_idle` (bilateral audit mandatory)
- `feedback_substrate_currency_audit_rubric` (architect-side grep-verify discipline)
- `feedback_adapter_restart_protocol_hub_container` (Hub-rebuild + Cutover discipline)
- `feedback_long_lived_branch_dev_state_contamination` (branch-debt avoidance; per-mission landing convention)

---

## §12 v1.0 RATIFIED fold-summary (Cloud Run pivot; Director-direct mid-Phase-4 2026-05-19)

**Architectural pivot:** TLS termination + ingress proxy moves to Cloud Run service (nginx; min-instances=1; auto-managed HTTPS via `*.run.app`). VM becomes internal-only (no public IP). Eliminates External HTTPS LB + Static IP + Cloud DNS + Google-managed-cert + custom domain registration.

**Impacted Design sections (Part-1 commit `b69b0d8`):**
- §1 Statement of Intent (new topology summary)
- §2 Survey anchor table (W1 lock amendments; new locks; anti-goal AG-2 amendment + AG-11 NEW)
- §3 Architectural overview (4-layer diagram redrawn; future-shape callout)
- §4.1 Terraform module structure (no `lb.tf`/`dns.tf`; add `cloudrun.tf`)
- §4.2 VM provisioning (internal-only; NO `access_config`)
- §4.3 docker-compose stack (3 containers; Traefik retired)
- §4.6 Traefik (RETIRED marker)
- §4.9 External LB (RETIRED marker)
- §4.10 VPC + firewall (Cloud-Run-to-VM rule replaces LB-to-VM)
- §4.11 Cloud DNS (RETIRED marker)
- §4.14 Cutover orchestration (URL refs → Cloud Run)
- §4.15 NEW — Cloud Run service + Direct VPC Egress + nginx config

**Impacted Design sections (Part-2 commit this commit):**
- §5 Wave deliverables (W0 + W1 + W3 + W4 refreshed; W5 unchanged)
- §6 OQ dispositions (OQ-5 deferred; OQ-9 confirmed; OQ-16/17/18/19 NEW; AG-2 amendment; AG-11 NEW)
- §7 RC criteria (RC-7 cost envelope refreshed to ~$20/mo)
- §10 Director-action items (all resolved)

**Cost envelope refresh:** ~$35-37/mo → **~$20/mo** (savings of ~$15-17/mo).

## §9 v0.2 fold-summary (greg round-1 thread-591 audit; pre-pivot)

5 surfaces folded:

1. **§B.1 HIGH** — AG-W2.2 strengthened: pinned M=N=3 + added AG-W2.2.a dispositive empty-postgres-boot verifier + AG-W2.2.b idempotent-reboot verifier; bug-101 status-flip moved to mission-completion gate
2. **§B.2 MEDIUM** — AG-W5.1 specified: docs-only PR mechanism for synthetic main-merge; <20min end-to-end verification window
3. **§E.1 CRITICAL** — §4.14 SIGUSR2 architect-spec drift (Hub doesn't handle SIGUSR2; grep confirmed zero matches); folded to SIGTERM-handler W2-prep deliverable + clean `docker stop --time=30` cutover
4. **§G.3 MEDIUM** — Postgres version pinned to `postgres:15-alpine` (matches local exactly; eliminates cross-major-version dump-restore risk); postgres-17 upgrade = separate future mission
5. **§G.4 MINOR** — §4.10 firewall IAP-tunnel canonical pattern (`35.235.240.0/20`); dropped `0.0.0.0/0` fallback

Plus minor additions:
- §4.13 `/admin/tokens` endpoint shape + admin-auth path described (greg §E.2 CONCUR)
- §4.13 token storage changed to postgres-backed table (cleaner than tokens.txt)
- W5 rollback runbook added (greg OQ-11; manual 3-step at v1; scripted deferred v1.1)
- Cost envelope refreshed: $35 → $35-37/mo range (greg §F GCS backup bucket ~$1)
- OQ-16 NEW (admin-auth-mechanism for `/admin/tokens` endpoint)

## §10 Director-action items pre-v1.0 ratify

| # | Item | Architect-recommend | Notes |
|---|---|---|---|
| OQ-5 | Domain name pick | `hub.apnex.com.au` (suggestion; Director-pick required) | Phase 4 needs this for §4.11 Cloud DNS record + LB managed-cert subject |
| OQ-9 | Local-Hub decommission at W5 | Decommission (no shadow-prod) | greg-CONCUR; architect-default; Director ratify (or push back to "demote-to-dev") |

## §11 v1.0 RATIFIED (achieved)

Per `feedback_bilateral_audit_round_budget_discipline` — greg round-1 comprehensive + Director-direct mid-Phase-4 architectural pivot folded; v1.0 RATIFIED 2026-05-19. Cost envelope ~$20/mo. Ready for Phase 5 Manifest (create mission entity) + Phase 6 Preflight + Phase 7 Release-gate.
