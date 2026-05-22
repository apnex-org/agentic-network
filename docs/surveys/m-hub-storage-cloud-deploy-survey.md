---
mission-name: M-Hub-Storage-Cloud-Deploy
source-idea: idea-298
methodology-source: docs/methodology/idea-survey.md v1.0
director-picks:
  round-1:
    Q1: a+c+d
    Q1-rationale: Multi-pick; skipped (b) State-durability
    Q2: a+b+d
    Q2-rationale: Multi-pick; skipped (c) Distributed-team
    Q3: c
  round-2:
    Q4: a
    Q5: a
    Q6: b
mission-class: distribution-packaging
tele-alignment:
  primary: [tele-1, tele-7, tele-11]
  secondary: [tele-3, tele-6, tele-9]
  round-1:
    primary: [tele-1, tele-6, tele-7]
    secondary: [tele-3, tele-9]
  round-2:
    primary: [tele-3, tele-11]
    secondary: [tele-1, tele-9]
calibration-data:
  director-time-cost-minutes: 8
  comparison-baseline: idea-206 (~5 min Survey baseline per methodology §12)
  notes: First cloud-deploy Survey; Director-direct anchored 2026-05-19 with idea-305 fold (Terraform + GCE VM + Docker shape pre-anchored). Round 1 multi-pick saturation (3 of 4 in Q1+Q2) crystallized intent quickly (full-production-Hub-in-cloud target). Round 2 single-picks across the board anchor simplicity-maximalism (postgres on-VM + hard-cutover + bearer-token auth). 8-min total vs 5-min baseline reflects Round 1 architect-side methodology re-load (Director-correction "you have forgotten how to do a survey"; architect redrafted Round 1 per idea-survey.md v1.0 schema after initial deviation) — calibration candidate filed at §calibration.
contradictory-constraints: []
calibration-cross-refs:
  closures-applied: []
  candidates-surfaced:
    - "Survey methodology re-load discipline at session-cold-pickup (architect forgot idea-survey.md schema between mission-84 close + idea-298 Phase 3 entry; Director-correction triggered re-read; ~3 min recovery cost)"
---

# idea-298 M-Hub-Storage-Cloud-Deploy — Phase 3 Survey envelope

**Version:** v1.3 **RATIFIED** 2026-05-19 (Round 1 + Round 2 + W1 composition-shape unpack + e2-small compute-tier lock + **Director-direct mid-Phase-4 architectural pivot: Cloud Run nginx-proxy + Direct VPC Egress + internal-only VM + IAP-ready future**)
**Idea:** idea-298 (folded with idea-305 anchors 2026-05-19 per Director-direct "Yes fold, single mission")
**Methodology:** `docs/methodology/idea-survey.md` v1.0 (Round 1 §3 + Round 2 §4 + envelope §5 complete)
**Branch:** `agent-lily/m-hub-storage-cloud-deploy`
**Director time-cost:** ~8 min total (Round 1 ~5 min + Round 2 ~3 min); 1.6× idea-206 baseline reflecting methodology re-load overhead at Round 1

---

## §0 Context

The substrate-Hub has been running production-local since mission-83 W5.4 (2026-05-17). Substrate-substitution-and-stabilization is complete (mission-83 cutover; mission-84 FS-retirement; cluster #23 closed; bug-99/100 fixed). idea-298 is the natural next substrate-area mission: cloud-deployment.

### §0.1 Director-direct anchors (in-scope-confirmed; NOT in Survey)

- **IaC:** Terraform
- **Compute:** GCE VM (small/micro tier)
- **Runtime:** Docker containers
- **Service-set:** multi-service

Anti-goals already anchored: NO Kubernetes / GKE; NO Cloud Run / serverless; NO adapter cloud-deployment.

---

## §1 Round 1 — Director-intent (WHY/WHO/HOW-cadence)

### §1.0 Picks

| Question | Director pick | Rationale |
|---|---|---|
| Q1 (WHY) | **a + c + d** (Production-availability + Operational-DX + Multi-operator scaling) | Multi-pick; skipped (b) State-durability |
| Q2 (WHO) | **a + b + d** (Single-operator-laptop-decoupling + Multi-machine-multi-operator + API-client integration) | Multi-pick; skipped (c) Distributed-team |
| Q3 (HOW-cadence) | **c** (Semi-automated CD) | Single pick; ruled out manual-only (a/b) and full-managed CD (d) |

### §1.aggregate — Composite response surface (Round 1)

The cloud-Hub IS the new production-Hub: stays up regardless of operator-laptop lifecycle (Q1a), serves multiple consumer-shapes (Q2 a/b/d including future API-clients beyond agent-adapter), keeps current via image-CD on main-merge (Q3c). Operator-laptop becomes consumer-only; infrastructure stays operator-applied via Terraform; images flow through Cloud Build CD. State-durability is implicit (production-state lives in cloud); multi-org / cross-organizational use is explicitly OUT-of-scope (single-org/team scope).

### §1.Q1 — Per-question interpretation

**Multi-pick: a + c + d (skipped b State-durability)**

Director's pick across 3 of 4 outcome-categories indicates that no one outcome is dominant — all three are co-load-bearing. The composite intent rules out partial-deployments (e.g., "just decouple the data"; "just provide a read replica") and anchors a **full-production-Hub-in-cloud target**.

The explicit skip of (b) State-durability isn't a rejection of durability — it's that durability becomes inherent once the cloud-Hub IS the production state (rather than a backup-target). Director's mental model: cloud-Hub IS canonically authoritative for state; operator-laptop becomes consumer-only.

Multi-dim context anchoring: Original Idea ("deploy substrate-Hub to cloud") + tele-1 (Sovereign State Transparency — state moves to sovereign location) + tele-7 (Resilient Agentic Operations — uptime decoupled) + tele-6 (Frictionless Agentic Collaboration — multi-op scaling). Aggregate-surface anchoring: Q2 + Q3 confirm "production-Hub serving many; always-current."

Architect-flag for Phase 4: local-Hub decommission decision (cutover-decommission vs demoted-to-dev-only).

### §1.Q2 — Per-question interpretation

**Multi-pick: a + b + d (skipped c Distributed-team)**

Director's pick spans single-operator-laptop-decoupling → multi-machine-multi-operator → API-client integration. Explicit skip of (c) Distributed-team draws a boundary: NOT multi-org / cross-organizational; the cloud-Hub stays within single org/team scope but enables programmatic-access patterns.

The (d) API-client integration pick is **architecturally consequential**: it implies cloud-Hub's network surface needs to be properly authenticated + authorized for non-agent-adapter consumers. TLS + auth model becomes load-bearing in v1.

Multi-dim context anchoring: tele-6 (Frictionless Agentic Collaboration — multi-machine + API-client = removing friction) + tele-3 (Sovereign Composition — clean network surface for multiple consumer types). Aggregate-surface anchoring: Q1's (a)+(d) confirms (Q2 a + Q2 b); Q2's (d) adds a NEW dimension elicited at Round 2 Q6 (auth model).

Architect-flag for Phase 4: API-client integration requires defining TLS + auth surface in v1 (NOT v2 fold-in).

### §1.Q3 — Per-question interpretation

**Single pick: c (Semi-automated CD)**

Director's pick rules out both extremes — too-manual loses production-currency; full-managed CD (Terraform Cloud + GitHub Actions) is over-engineered at single-VM scale. The compromise: **infrastructure rarely changes (Terraform operator-applied); images deploy frequently (Cloud Build CD).**

Multi-dim context anchoring: tele-9 (Chaos-Validated Deployment — main-merge → cloud-deploy IS validation) + tele-7 (Resilient Agentic Operations — image updates without operator engagement). Aggregate-surface anchoring: Q1(a) production-availability + Q2(b) multi-operator-scaling require image-currency without operator engagement; Q3(c) delivers exactly that.

Architect-flag for Phase 4: Cloud Build trigger composition with apnex-org branch protection + admin-merge convention; on-merge-deploy mechanism (watchtower / cron / webhook + restart).

### §1.coherence — Cross-question coherence check (Round 1)

Q1 + Q2 align: both point at expanding/durable production-Hub serving multi-actor. Q1 + Q3 coherent: production-availability + multi-op needs CD to keep current. Q2 + Q3 coherent: API-client readiness benefits from CD. **No contradiction; Round 2 strategy = refine deeper into HOW.**

---

## §2 Round 2 — HOW-shape refinement

### §2.0 Picks

| Question | Director pick |
|---|---|
| Q4 (storage/DB placement) | **a** (Postgres co-located on VM via docker-compose; `hub-snapshot.sh` → GCS for backup) |
| Q5 (migration cutover) | **a** (Hard-cutover via hub-snapshot.sh; mission-83 W5.4 pattern; ~30s downtime) |
| Q6 (auth/API surface) | **b** (Bearer token; Hub-issued static tokens per client) |

### §2.aggregate — Composite response surface (Round 2)

Postgres on-VM + hard-cutover + bearer-token auth — all three picks anchor **simplicity-maximalism**. Director's pick reinforces v1 simplicity intent (matches Round 1 Q3(c) "don't over-engineer"). No managed-service dependencies for state-layer or auth-layer; Hub owns full ownership of state + auth.

### §2.Q4 — Per-question interpretation

**Single pick: a (Postgres co-located on VM)**

Director picks simplicity-maximalism: postgres co-located via docker-compose on same VM; `hub-snapshot.sh` → GCS for backup. Skipped (b)+(d) Cloud SQL managed options + (c) separate postgres VM.

Trade-offs accepted:
- Same-VM-fate-sharing (DB-fault-correlation with Hub-fault)
- No managed PITR; restore is `pg_restore` from GCS-stored dump
- Lowest cost (potentially free-tier-eligible)
- Matches mission-83 W5.4 local-prod pattern exactly

Multi-dim context anchoring: Original Idea + idea-305 fold ("Terraform-managed GCE VM running docker, hosting a number of hub services") — (a) fits exactly; "number of services" includes postgres on the VM. Tele mapping: tele-3 (Sovereign Composition — services compose in single VM) + tele-1 (Sovereign State Transparency — state lives in postgres-on-VM). Aggregate-surface anchoring: Q1(c) Operational-DX + Q5(a) hard-cutover confirm simplicity intent.

Architect-flag for Phase 4: VM persistent disk sizing + snapshot cadence (Cloud Disk Snapshot daily? `hub-snapshot.sh` on-demand? both?).

### §2.Q5 — Per-question interpretation

**Single pick: a (Hard-cutover via hub-snapshot.sh)**

Director picks proven-mechanism: mission-83 W5.4 pattern (`pg_dump-Fc` → restore → atomic agent-switch; ~30s effective downtime). Skipped (b) parallel-run (longer transition; complexity) + (c) greenfield (state-loss-not-acceptable) + (d) dual-write (complexity over-engineering).

Trade-offs accepted:
- ~30s production downtime during cutover (bounded; tolerable)
- Atomic cutover; no partial-state transition
- Rollback path: re-restore from snapshot OR re-bring-up local-Hub
- Uses existing `scripts/local/hub-snapshot.sh` — operationally familiar

Multi-dim context anchoring: tele-9 (Chaos-Validated Deployment — cutover IS validated mechanism) + tele-11 (Cognitive Minimalism — reuse proven path). Aggregate-surface anchoring: Q1(c) Operational-DX (low-friction migration) + Q4(a) Postgres-on-VM (restore-to-cloud-VM-postgres simpler than restore-to-Cloud-SQL).

Architect-flag for Phase 4: Cutover orchestration script (`cutover-to-cloud.sh`): snapshot-local + upload-GCS + restore-cloud + verify-agents + atomic-DNS-switch. **bug-101 disposition: FOLD into cloud-deploy scope** — hard-cutover via hub-snapshot.sh exercises Hub bootstrap migration-apply mechanism = bug-101 naturally surfaces during this slice.

### §2.Q6 — Per-question interpretation

**Single pick: b (Bearer token)**

Director picks pragmatic-simplicity: Hub-issued static bearer tokens per API-client; `Authorization: Bearer <token>` header; revocation mechanism required. Skipped (a) GCP IAM (couples to GCP project) + (c) OIDC (setup overhead; identity-provider dependency) + (d) mTLS (cert-management overhead).

Trade-offs accepted:
- No OAuth ecosystem standards-compliance
- Token-leak-risk requires rotation/revocation mechanism
- Simpler client integration (single header)
- Manageable in v1 single-org scope (cross-org is AG-4 anti-goal)

Multi-dim context anchoring: tele-6 (Frictionless Agentic Collaboration — simplest auth = least friction) + tele-3 (Sovereign Composition — Hub owns auth concern; doesn't delegate to IAM). Aggregate-surface anchoring: Q1(c) Operational-DX + Q3(c) Semi-auto CD (bearer-token deployment via env-var matches CD shape) + Q2(d) skip of cross-org = single-tenant auth scope.

Architect-flag for Phase 4: Token issuance mechanism (operator CLI vs Hub bootstrap-seed) + revocation mechanism (token-revoke endpoint + expiry-based + both?). Architect-preliminary: Hub-issued tokens via CLI command; static (no expiry) for v1; revoke-list mechanism + audit log.

### §2.coherence — Cross-question coherence check (Round 2)

Q4 + Q5 align: postgres-on-VM + hard-cutover hub-snapshot.sh use same mechanism (compose-stack restore). Q5 + Q6 align: bearer-token auth doesn't require cross-tenant identity → migration doesn't carry external-auth-state. Q4 + Q6 coherent: both Hub-owned. **No contradiction; envelope ratifiable.**

---

## §3 Composite intent envelope (v1.0 RATIFIED)

**Mission objective:** Deploy production-substrate-Hub to a single GCE VM (**e2-small**: 2 vCPU shared-core / 2 GB RAM) in `australia-southeast1` via Terraform IaC. The cloud-Hub IS the new production-Hub (operator-laptop demoted to consumer-only). VM runs docker-compose stack with **Hub + Postgres + Traefik 3.x (HTTP-only; internal routing) + Watchtower (image-CD)**. TLS termination offloaded to **External HTTPS Load Balancer + Google-managed-certificate** at the cloud layer (NOT on VM). Backup via **systemd-timer on VM running `hub-snapshot.sh` → GCS** (outside compose stack). Image updates flow via Cloud Build CD on main-merge → Artifact Registry → Watchtower auto-pull-and-restart. Migration from local-Hub uses hard-cutover via existing `hub-snapshot.sh` pattern (~30s downtime). API surface enables single-org/multi-machine + future API-clients via Hub-issued bearer tokens.

**Tele rollup (whole-mission):**
- **Primary:** tele-1 (Sovereign State Transparency), tele-7 (Resilient Agentic Operations), tele-11 (Cognitive Minimalism)
- **Secondary:** tele-3 (Sovereign Composition), tele-6 (Frictionless Agentic Collaboration), tele-9 (Chaos-Validated Deployment)

**Architectural shape (per W1 composition-shape unpack 2026-05-19):**

Layer A — docker-compose stack on the VM:
1. **Hub** container (substrate-Hub; production-mode)
2. **Postgres** container (substrate state-store; co-located per Q4(a))
3. **Traefik 3.x** container (HTTP-only reverse-proxy + internal routing across services; future K8s Gateway API compatibility per Director-direct refinement; replaces architect-preliminary Caddy)
4. **Watchtower** container (image-CD; polls Artifact Registry; auto-pulls + restarts Hub on new digest; opt-in via Docker label on Hub only)

Layer B — native GCE-VM things (NOT in compose):
5. **systemd-timer + `hub-snapshot.sh` + `gsutil`** → GCS backup bucket (backup-runner option (c) per Director-direct refinement; outside compose stack; independent of container restart lifecycle)
6. **Cloud Logging + Cloud Monitoring Ops Agent** (architect-preliminary; lightweight VM-resident agents; ship logs + metrics out-of-box)

Layer C — cloud-layer (GCP services):
7. **External HTTPS Load Balancer** + **Google-managed-certificate** (TLS termination offloaded to LB per Director-direct refinement; forwards plain HTTP to VM)
8. **VPC + firewall rules** (LB → VM ingress; SSH allow for operator)
9. **Static IP** for VM (or LB-managed IP)
10. **Cloud DNS** managed zone (domain TBD at Phase 4 Design) — Cloud-DNS-managed A-record points to LB

Layer D — CI/CD layer:
11. **Cloud Build trigger** on apnex-org/agentic-network main-merge
12. **Artifact Registry** (already in use per `scripts/local/build-hub.sh`)
13. Watchtower polls Artifact Registry; auto-pulls on new digest

Operator-side artifacts:
14. **Terraform module(s)** provisioning Layers C + D (VM + PD + firewall + LB + DNS + Cloud Build + GCS bucket); Layer A initial deploy via `terraform metadata_startup_script` or cloud-init
15. **Cutover orchestration:** `cutover-to-cloud.sh` (snapshot-local → upload-GCS → restore-cloud → verify → DNS-switch); operator-run at W4
16. **Bearer-token CLI:** `hub-token issue|revoke|list` (operator-side; static tokens; revoke-list checked on every auth)
17. **systemd unit + timer files** for backup-runner (deployed via Terraform `metadata_startup_script` or `google_compute_instance.metadata`)

---

## §4 Mission scope summary

**Mission-class:** distribution-packaging
**Mission-class default disciplines:** per `docs/methodology/mission-lifecycle.md` §3 (deployment-target work; substrate is mature; bilateral Design audit mandatory)

### §4.1 Estimated waves

| Wave | Scope | Risk | Owns |
|---|---|---|---|
| W0 | Terraform skeleton (`infra/terraform/`) + variable + state-backend; Cloud Build trigger + Artifact Registry; GCS backup bucket; LB + DNS zone (no traffic yet) | Low (no production touch) | Engineer |
| W1 | VM provisioning (`terraform apply` in `australia-southeast1`; **machine_type = e2-small**) + docker-compose stack baseline (Hub + Postgres + Traefik HTTP-only + Watchtower) + systemd backup-timer + cold-boot test on cloud-VM with empty state | Medium (first cloud-Hub boot; substrate boot path on fresh DB) | Engineer |
| W2 | `hub-snapshot.sh` test-run local → cloud restore + bridge resume verification; **bug-101 fix folded here** (Hub bootstrap migration-apply mechanism); cloud-Hub running with restored state | Medium-High (substrate-bootstrap; cluster #23-class regression-risk) | Engineer |
| W3 | Bearer-token CLI (`hub-token issue|revoke|list`) + auth gate integration (Hub middleware checks bearer + revoke-list) + audit-log; LB-to-VM HTTP-forwarding wired + Google-managed-cert provisioning at LB | Medium (auth-surface introduction + first TLS-via-LB stand-up) | Engineer |
| W4 | Cutover orchestration script (`cutover-to-cloud.sh`) + DNS A-record switch (Cloud DNS) + adapter shim URL update; agent adapter shim config swap | High (production cutover; ~30s downtime; rollback path tested) | Engineer + Architect (cutover orchestration) |
| W5 | Verify cloud-currency cadence: image-CD validation (Cloud Build → Watchtower auto-update); production smoke; decommission-local-Hub (archive local state) | Low-Medium (verification) | Engineer + Architect (cutover ratify) |

### §4.2 Per-mission per-tele alignment

| Tele | Wave-mapping |
|---|---|
| tele-1 Sovereign State Transparency | W2 (state migration); W4 (cutover) |
| tele-3 Sovereign Composition | W1 (compose stack); W3 (Hub-owned auth) |
| tele-6 Frictionless Agentic Collaboration | W3 (multi-client auth); W4 (adapter shim swap) |
| tele-7 Resilient Agentic Operations | W4 (cutover); W5 (CD validation) |
| tele-9 Chaos-Validated Deployment | W5 (production validation) |
| tele-11 Cognitive Minimalism | W0-W5 throughout (simplicity-maximalism) |

### §4.3 Bug-fold-in

- **bug-101** (production-Hub bootstrap migration-apply mechanism) — FOLDED INTO W2 per Q5(a) hard-cutover mechanism elicitation

---

## §5 Anti-goals (RATIFIED v1.0)

### §5.1 Pre-anchored (Director-direct 2026-05-19; pre-Survey)

- AG-1 NO Kubernetes / GKE
- AG-2 NO Cloud Run / serverless
- AG-3 NO adapter cloud-deployment (adapters stay operator-machine-side)
- AG-4 NO Distributed-team / multi-org scope (Q2 skip of c ratifies)

### §5.2 Ratified at Round 2 picks

- AG-5 NO multi-VM in v1 scope (single-VM-first; future scale-out non-precluded)
- AG-6 NO Terraform Cloud + GitHub Actions full-CD in v1 (Q3 skip of d ratifies; v1.1 fold-in candidate)
- AG-7 NO managed Cloud SQL in v1 scope (Q4(a) pick = postgres-on-VM)
- AG-8 NO OIDC / OAuth / mTLS auth in v1 (Q6(b) pick = bearer-token only)
- AG-9 NO parallel-run / soft-cutover / dual-write migration in v1 (Q5(a) pick = hard-cutover only)
- AG-10 NO state-loss-acceptable / greenfield migration (Q5 skip of c ratifies; state-continuity preserved)

---

## §6 Architect-flags / open questions for Phase 4 audit

From Round 1 + Round 2 interpretations + W1 composition-shape unpack 2026-05-19:

Resolved at W1 unpack (Director-direct):
- **Reverse-proxy choice:** ~~Traefik 3.x on VM~~ → **AMENDED v1.3: nginx on Cloud Run service** (Director-direct mid-Phase-4 pivot 2026-05-19; K8s Gateway API future-compat motivation dropped)
- **TLS termination:** ~~External HTTPS Load Balancer + Google-managed-certificate~~ → **AMENDED v1.3: Cloud Run service auto-managed TLS via `*.run.app` URL** (eliminates LB + Static IP + Cloud DNS + Google-managed-cert + custom domain registration)
- **Image-CD mechanism:** Watchtower container in compose; polls Artifact Registry; opt-in via Docker label on Hub only
- **Backup-runner shape:** systemd-timer on VM running `hub-snapshot.sh` → GCS (outside docker-compose stack)
- **Region target:** `australia-southeast1` (operator latency; matches existing Artifact Registry + Cloud Run service)
- **Image registry:** Artifact Registry (already in use for hub image per `scripts/local/build-hub.sh`)
- **Compute tier:** e2-small (2 vCPU shared / 2 GB RAM); ~$13/mo Sydney on-demand; chosen over e2-micro (free-tier-eligible but 1 GB tight on memory under backup + burst workload; OOM-risk during `pg_dump` or concurrent agent operations)
- **NEW v1.3: VM internal-only** — no public IP; Cloud Run reaches via Direct VPC Egress; SSH only via IAP-tunnel
- **NEW v1.3: Cloud Run min-instances=1** — zero cold-start; ~$5/mo for one warm instance at minimum CPU
- **NEW v1.3: AG-2 amendment** — original "NO Cloud Run / serverless" → "NO Cloud Run for Hub itself" (carve-out for nginx ingress proxy; original reasoning preserved)
- **NEW v1.3: AG-11 NEW** — NO Web UI services in v1 scope; future Web UIs (dashboards / Open WebUI / non-agentic comms) deploy as separate Cloud Run services with Google IAP; explicit deferral
- **NEW v1.3: OQ-5 Domain deferred** — Cloud Run auto-URL at v1; custom domain mapping = v1.1 idea-fold candidate

Open for Phase 4 Design:
- **(Q1)** Local-Hub decommission decision: cutover-decommission vs demoted-to-dev-only → Phase 4 Design
- **(Q3)** Cloud Build trigger composition with apnex-org branch protection + admin-merge convention; Watchtower poll-interval (5m? 10m? 1h?) → Phase 4 Design
- **(Q4)** VM persistent disk sizing + Cloud Disk Snapshot cadence (daily? hourly? OR purely `hub-snapshot.sh` on-demand? OR both?) → Phase 4 Design
- **(Q5)** Cutover orchestration script (`cutover-to-cloud.sh`) — snapshot-local + upload-GCS + restore-cloud + verify-agents + atomic-DNS-switch — design at Phase 4
- **(Q6)** Bearer-token issuance + revocation mechanism: operator CLI; static tokens; revoke-list + audit-log; expiry policy (v1 = none?) → Phase 4 Design
- **Domain name** — Cloud DNS managed zone + A-record target; domain choice TBD → Phase 4 Design
- **VPC + firewall design** — LB → VM ingress; SSH allow for operator; egress rules for Watchtower (Artifact Registry) + systemd-backup (GCS) → Phase 4 Design
- **Ops Agent install** — Cloud Logging + Cloud Monitoring agents; install via Terraform `metadata_startup_script` or cloud-init? → Phase 4 Design
- **Cost envelope at v1.3** — refreshed post-Cloud-Run-pivot: **~$20/mo total** (e2-small ~$13 + PD-Standard 20GB ~$1 + GCS backup ~$1 + Cloud Run min-instances=1 ~$5; Cloud Build / Logging / Monitoring under free-tier). **Down from v1.2 ~$35-37/mo** by eliminating LB $18 + Static IP $3 + Cloud DNS $0.40 = $21.40/mo savings, partially offset by Cloud Run min-instances=1 ~$5; **net savings ~$16-17/mo.**

---

## §7 Sequencing / cross-mission considerations

- **mission-83 substrate-cutover** — COMPLETE; substrate-Hub is the artifact being deployed
- **mission-84 FS-retirement** — COMPLETE; substrate-only Hub means no FS-mount complexity on VM
- **idea-299 M-Hub-Storage-BlobBody-Substrate** — independent; if cloud-Hub gets GCS-backed blob-store at W4+, idea-299 may compose; Phase 4 Design decision-point
- **bug-101** — FOLDED INTO W2 per §4.3
- **mission-78 missioncraft v1.2.0** — independent; adapter shim URL update at W4 (operator-side) impacts missioncraft's adapter-shim-config consumer; coordinate at W4 dispatch

---

## §calibration

- `director-time-cost-minutes:` 30 (Round 1 ~5 min + Round 2 ~3 min + W1 composition-shape unpack ~6 min + e2-small compute-tier lock ~3 min + v1.3 Cloud Run pivot engagement ~13 min including Web UI auth-model discussion)
- `comparison-baseline:` idea-206 (~5 min baseline; methodology §12)
- `notes:` First cloud-deploy Survey. Director-direct pre-anchored deployment-target shape (Terraform + GCE VM + Docker + multi-service) materially compressed Survey scope. Round 1 multi-pick saturation (3-of-4 in Q1+Q2) crystallized intent quickly. Round 2 single-picks across the board anchor simplicity-maximalism. v1.1 fold absorbed Director-direct mid-Phase-3 W1 composition-shape unpack: Caddy → Traefik 3.x (K8s Gateway API future-compat); TLS offloaded to External HTTPS LB; Watchtower locked for image-CD; backup-runner shape (c) systemd-timer outside compose; region `australia-southeast1`. 14-min total reflects:
  - ~5 min Round 1 Director-engagement
  - ~3 min Round 2 Director-engagement
  - ~6 min v1.1 W1 composition-shape unpack (Director-direct mid-Phase-3)
  - PLUS ~3 min architect-side methodology re-load cost (Director-correction "you have forgotten how to do a survey" surfaced after architect's initial 8-question single-round draft deviated from idea-survey.md v1.0 schema; architect re-read methodology + redrafted Round 1 per schema) — Director time-cost NOT inflated by this; architect-side cost was

**Calibration candidate surfaced** (Phase 10 retro batch; Director-bilateral filing):
- **Survey methodology re-load discipline at session-cold-pickup** — architect forgot `idea-survey.md` v1.0 schema between mission-84 close (2026-05-19 ~01:43 AEST) + idea-298 Phase 3 entry (~13:15 AEST); ~12 hours between Survey-use; methodology not re-loaded at session-cold-pickup until Director-correction. Pattern signature: cold-pickup memory-recall of methodology-doc structure is unreliable; mandatory re-read of methodology before each Survey draft is the discipline. Composes with `feedback_architect_review_doc_behavioral_claims_code_verify` (same architect-side pattern in different surface) + `feedback_substrate_currency_audit_rubric` (load-bearing methodology doc-grep before authorship).

---

## §8 Cross-references

- `docs/methodology/idea-survey.md` v1.0 (methodology source)
- `docs/methodology/mission-lifecycle.md` §2 Survey phase + §3 Mission-class taxonomy (distribution-packaging)
- `docs/methodology/tele-glossary.md` (tele-N decoder)
- idea-298 (source; folded with idea-305 anchors)
- idea-305 (FOLDED → idea-298; archived)
- mission-83 retrospective (substrate-cutover precedent; W5.4 hard-cutover pattern reference for Q5(a))
- mission-84 retrospective (FS-retirement precedent)
- `scripts/local/build-hub.sh` (Artifact Registry already in use; reference for image-CD)
- `scripts/local/hub-snapshot.sh` (operator-side dump tool; reference for Q5(a))
- bug-101 (production-Hub bootstrap migration-apply; OPEN; folded into W2 per §4.3)
- `feedback_director_strategic_maximalism_discipline_defended` (architect-anchor for simplicity-defended Survey-question framing)
- `feedback_idea_triage_protocol_skip_criteria` (Survey-skip 5-criteria; idea-298 did NOT qualify — multi-dimensional architectural-decision space; correct Survey was applied)
- `feedback_calibration_ledger_discipline` (Phase 10 calibration filing path for §calibration candidate)

---

## Survey envelope v1.0 RATIFIED

All 6 Director picks captured (Round 1: Q1=a+c+d, Q2=a+b+d, Q3=c; Round 2: Q4=a, Q5=a, Q6=b). Per-question interpretations complete with multi-dim context anchoring + tele-mapping per round. Composite intent envelope crystallized (§3). Mission scope summary with 6-wave plan (§4). Anti-goals ratified (§5; 10 total). Architect-flags surfaced for Phase 4 Design audit (§6). Sequencing + cross-mission considerations documented (§7). Calibration candidate surfaced (§calibration; Phase 10 retro batch).

**Ready for Phase 4 Design** (architect drafts v0.1 → bilateral with greg → v1.0 RATIFIED → Phase 5 Manifest).

Standing by for Director ratify-marker.
