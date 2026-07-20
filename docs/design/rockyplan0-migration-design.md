# rockyplan0 — COS→Rocky Hub-host migration + Rocky-native roller design

**Author:** Lily (architect) · WorkItem `work-bp-rockyplan0-migration_design`
**Arc:** rockyplan0 (COS→Rocky migration design)
**Status:** DESIGN PACKET for the `design_gate`. Source-only. Authorizes **nothing executable** — no Rocky sandbox, registry, Terraform, VM, PD, Cloud Run, CI, credential, or production action.

## Load-bearing inputs (consumed, not restated)

- Governor + authority gap + 8 constraints: `docs/reviews/rollerb-rocky-pivot-governor.md@rv=56430498`
- Failure register F01–F34 + binary gate criteria G0–G7 + recommended shape + impl order: `docs/audits/rockyplan0-failure-mode-audit.md@rv=56432206`
- Read-only current topology + Rocky target pin: `docs/receipts/rockyplan0-inventory-receipt.md@rv=56431866`
- Immutable COS before-state: `docs/receipts/rollerb-prod-observation-receipt.md@rv=56430086`
- Backup (restore-proven fallback) + verifier checks: `docs/receipts/rollerb-backup-provenance.md`, `docs/reviews/rollerb-backup-provenance-verifier-check.md@rv=56431087`, `docs/reviews/rollerb-backup-secure-repack-verifier-check.md@rv=56431170`
- Historical COS-only PASS (superseded, not reinterpreted): `9548d827` roller design
- Source candidates (historical/unreviewed until rebound): greg detect `09162239`, ruby roll-core `9309e980`
- `decision-25`, `bug-307`, `bug-308`, deployment source `main=0c21241b` (`modules/hub/**`, `deploy/hub/**`, `.github/workflows/deploy-hub.yml`, `scripts/local/build-hub.sh`)

---

## G0 — identity, authority, scope

**G0.1 Frozen packet identity.** This file's git commit / parent / path / blob / SHA-256 are bound in the accompanying Hub receipt `docs/receipts/rockyplan0-migration-design-identity.md` (a git file cannot contain its own commit hash). The `design_gate` binds those exact values; any edit re-freezes as a new packet.

**G0.2 Authority — decision-25 is HISTORICAL ONLY.** `decision-25` authorizes a bounded bug-307 Hub *image* roll on the *existing* host. It does **not** authorize OS replacement, PD detach/attach, a maintenance outage, host/network/CI identity change, or destroying the COS VM (governor authority gap). The Director's relayed "change the VM to rocky" + "brief downtime OK" set **direction**, not production authority. **A new Director Decision is required before ANY Rocky sandbox or production action.** This packet is design-only.

**G0.3 Proposed new-Decision parameters** (single-topic; finalized in `final_packet`, ratified by the Director):
- **Scope:** create a distinct Rocky VM `hub-vm-r9`, a distinct static internal IP, a distinct boot disk; move the *existing* `hub-vm-data` PD; switch the Cloud Run upstream to the Rocky IP. No deletion/replacement of `hub-vm`, `hub-vm` boot disk, `hub-vm-data`, `hub-vm-ip`, secrets, or IAM.
- **Executor:** lily (architect), from the operator seat, under the phase gates below.
- **Numeric outage / RTO:** target planned outage **≤ 15 min**, automatic-rollback RTO **≤ 20 min** (forward + reverse **measured in the Rocky sandbox** first; the Decision ratifies the measured envelope, not a guess). No "instant" claim.
- **Zero-data-loss definition:** cutover moves the **same current PD** after a clean Postgres checkpoint/stop/unmount; success requires identical canonical row/schema hashes + Postgres system-identifier + WAL LSN continuity pre/post. The restore-proven backup + a fresh quiesced snapshot are the **fallback**, not the mechanism.
- **Normal rollback:** move the **same current PD** back to the preserved COS VM (not the stale snapshot).
- **Emergency boundary:** snapshot/backup restore = explicit data-loss recovery, used only if the current PD is lost.
- **Irreversible exclusions:** COS VM/boot-disk/IP deletion and decommission are **out of scope** here — a later, separately authorized step after soak.

**G0.4 F01–F34 disposition:** every failure mode is dispositioned in the register table in §8. No item is "TBD".

**G0.5 Historical boundary.** `9548d827`, `09162239`, `9309e980` remain historical/unreviewed; they are re-bound + independently re-reviewed under this Rocky design in the implementation arc, never inherited as passed.

---

## G1 — target host + supply-chain identity

**G1.1 Rocky image — exact dated pin (F13, governor #3).** Terraform pins the **exact dated image**, never the floating family:
- image: `rocky-linux-9-optimized-gcp-v20260720`
- full selfLink: `https://www.googleapis.com/compute/v1/projects/rocky-linux-cloud/global/images/rocky-linux-9-optimized-gcp-v20260720`
- imageId: `1595402168191675674`; family `rocky-linux-9-optimized-gcp`; architecture X86_64; status/deprecation + observation time bound in the identity receipt at freeze.
- Rationale for `-optimized-gcp`: GCP-tuned kernel/virtio/guest-env, faster boot. If freeze finds it DEPRECATED, select the exact newest non-deprecated dated image and re-record — never the family head.

**G1.2 Package / supply-chain provenance (F13, governor #3).** Bound at `sandbox_freeze` on the provisioned Rocky VM, never prod:
- Docker-CE repo `https://download.docker.com/linux/centos/docker-ce.repo` — bind repo-file bytes/hash, GPG key + fingerprint (`https://download.docker.com/linux/centos/gpg`), repomd metadata/checksum.
- Packages `docker-ce docker-ce-cli containerd.io` (+ `container-selinux`) — bind exact RPM NEVRAs + SHA-256 via `dnf download`/`repoquery`; retention: stage the exact RPMs (or prove old-version availability); **no unbounded `dnf update`**, fail-closed if exact artifacts disappear.
- `docker-credential-gcr` — pinned release binary (GoogleCloudPlatform/docker-credential-gcr): exact version, asset URL, SHA-256, install path/owner/mode (`0755 root:root /usr/local/bin`), and `--version` runtime output.
- guest-agent / OS Login / Ops Agent / systemd / kernel / containerd — exact versions read on the sandbox and bound; patch policy = frozen, staged, fail-closed.

**G1.3 Host shape.** Same zone `australia-southeast1-a`; machine `e2-small` (parity; note if headroom testing forces a change); boot disk resource protection (`deletion_protection`/lifecycle) so a plan can never destroy it silently.

**G1.4 SELinux (F11, governor #4).** SELinux stays **ENFORCING**. PGDATA volume labeling strategy is **explicit and singular**: durable `semanage fcontext -a -t container_file_t '/mnt/disks/hub-data/postgres(/.*)?'` + `restorecon -Rv` (preferred over ad-hoc `:Z` because it survives relabels and is auditable), with the docker `-v` mount using `:Z` only if freeze proves the fcontext path insufficient. Sandbox MUST: record before/after contexts, prove Postgres RW to PGDATA under enforcing, prove a **denial mutation** (remove the label → access DENIED = RED), and prove the **same PD clone** still mounts+labels back on COS for rollback. **SELinux is never disabled to pass.**

**G1.5 Sandbox parity (F27).** Rocky sandbox matches exact image / machine / zone / runtime / SELinux / systemd; isolated SA, VPC/IP, registry tags, sandbox secrets, and a **cloned disk** (or sanitized dataset) — never the production PD. Prove reboot, cgroup v2, firewall, and resource headroom on `e2-small`.

---

## G2 — Terraform / state safety

**G2.1 Distinct resources, old preserved (F02, governor #2/#5).** New: `google_compute_instance.hub_vm_r9`, `google_compute_address.hub_vm_r9_ip` (distinct internal static IP), distinct boot disk. Old `hub-vm`, `hub-vm` boot disk, `hub-vm-data`, `hub-vm-ip` are **preserved** with explicit `deletion_protection = true` / `lifecycle { prevent_destroy = true }`. Resource *moves* (if any) use reviewed `moved` blocks only.

**G2.2 Address / proxy (F03).** **Do NOT dual-assign or destroy `10.10.0.2`.** The Rocky VM gets its **own** distinct static internal IP. The Hub is reached via the **Cloud Run upstream `HUB_VM_INTERNAL_IP`** (there is no observed external DNS cutover). Cutover = a Cloud Run upstream **revision change** to the Rocky IP; rollback = redeploy the **prior Cloud Run revision** pointing at `10.10.0.2`. `10.10.0.2`/`hub-vm-ip` is preserved for rollback.

**G2.3 Lockfile + CLI identity (F25).** A **root** `deploy/hub/.terraform.lock.hcl` with provider hashes (the module lock is **not** inherited); exact Terraform CLI version; fresh GCS state lock/lineage/serial; saved-plan SHA; local `0600` plan/state; secret-free `terraform show` action summary; **re-plan after every phase/state change** (stale-plan invalidation).

**G2.4 Multi-phase apply (F26) — separate reviewed saved plans + receipts per phase:**
1. **P1 inert create** — Rocky VM + IP + boot disk, runtime & roller **disabled**, no PD touch.
2. **P2 detach** — after app quiesce + clean PG stop/unmount, detach `hub-vm-data` from COS.
3. **P3 attach** — attach `hub-vm-data` to Rocky (exact self-link/sourceDiskId/device).
4. **P4 runtime validate** — start PG+Hub on Rocky, verify locally.
5. **P5 proxy switch** — Cloud Run upstream → Rocky IP.
Each phase: reviewed saved plan whose **action allowlist shows no deletion/replacement** of old host/data/address/secret/IAM and **no current-PD format**.

**G2.5 No destructive same-name replace** (F02): the plan is rejected if it shows `-/+` (replace) or `destroy` on any preserved resource.

---

## G3 — state migration + one writer

**G3.1 Preregistered cutover sequence (F05/F06/F08):**
1. Freeze mutable publication + active deploy-hub runs (reject if a deploy-hub run is active); keep Watchtower stopped.
2. Quiesce Cloud Run ingress; stop `ois-hub-prod` + background writers; bounded drain; **timestamp every boundary**.
3. Capture Postgres canonical invariants: version, **exact running image digest**, data-dir, **system identifier**, **WAL LSN**, and canonical **all-row + schema hashes** (read-only).
4. `CHECKPOINT`; clean-stop `ois-postgres-prod`; require clean-shutdown logs + exit 0.
5. host `sync`; verify no open handles (`lsof`/`fuser`); `umount`; only then **detach** PD.
**One writer:** old Hub+PG stopped and PD detached before any new RW attach; Rocky runtime stays disabled until attachment is proven; reverse identically for rollback (F08).

**G3.2 Fresh quiesced snapshot (F09).** After clean stop+unmount and **before** the first Rocky write/relabel, take a fresh snapshot of `hub-vm-data`; bind full snapshot identity/status. **Normal rollback uses the current PD, not this snapshot.** Snapshot restore = emergency, explicit data-loss.

**G3.3 Attach + fail-closed mount (F04/F07).** Attach by exact `sourceDiskId 7748260844854623709` / self-link, device name `hub-data`. Before mount, assert by-id (`/dev/disk/by-id/google-hub-data`), filesystem UUID, `ext4` type, and size. **NO `mkfs` anywhere on the migration path** — existing-disk mode only, **fail-closed** on any sourceDiskId/UUID/ext4 mismatch. The COS `startup.sh` `blkid || mkfs.ext4` pattern is **forbidden** for migration; the Rocky mount unit is existing-disk-only.

**G3.4 Postgres data-format compatibility (F10).** Same PG **major 15**. Pin the **exact Postgres image digest** (resolved from the current running digest at cutover — currently UNKNOWN, so it is observed-at-cutover, never assumed) and use that identical digest in sandbox and prod. Before Hub starts: verify PG_VERSION, data-dir path, UID/GID (`70`), system identifier, encoding/locale/checksums, and read-only canonical hashes.

**G3.5 SELinux relabel (F11).** Apply the G1.4 durable labeling to the attached PGDATA; record before/after contexts; prove RW; the denial-mutation + COS-clone rollback compatibility are proven in sandbox before any prod cutover.

**G3.6 Normal rollback (F29/F30).** Stop new Hub+PG cleanly → move the **same current PD** back to COS `hub-vm` → start COS containers by **pinned digest** (exact `docker run`/recreate commands, **not** startup idempotency, which checks existence not running-state) → verify identical canonical pre/post hashes + system identifier. A verified rollback is **not** forward success.

---

## G4 — runtime, secrets, backup, observability

**G4.1 Inert create + one supervisor (F16).** Rocky host boots **inert**; runtime and roller are **separately enabled** by later gates. Exactly one systemd supervisor chain: `hub-data.mount` → `ois-postgres.service` (health-gated) → `ois-hub.service` (health-gated). **No second Docker restart supervisor**; Docker `--restart` policy and systemd do not both own lifecycle.

**G4.2 Secret hygiene (F15).** Startup bytes are **secret-free** (env values are Secret-Manager refs). Secret fetch = fail-loud HTTP + JSON parse; transient secret files `0600` under `/run`; **no `set -x`**; a secret sentinel scans repo bytes, receipts, logs, unit output, and any published plan summary. Plan/state/archive bytes stay local, restricted.

**G4.3 Backup continuity (F33).** Recreate the exact backup service/timer on Rocky with SM/SA access, conditional/object-unique upload, and a **restore test**; prove the timer fires, logs/alerts, disk/PG/Hub/roller health, and **reboot recovery**. (The one-shot pre-migration backup already exists, restore-proven.)

**G4.4 Observability (F14).** GCE guest-agent / OS Login / startup execution bound + sandbox-proven. COS `google-logging/monitoring-enabled` metadata → **Ops Agent** exact install/config/version on Rocky; prove logs + metrics flow.

**G4.5 Watchtower + stale-owner retirement (F17/F31).** Remove the `com.centurylinklabs.watchtower.enable=true` label and the watchtower container/config. **Enumerate every production consumer** — `deploy-hub.yml`, PR #643, rollback/cutover scripts, Terraform outputs, docs/operator runbooks, monitoring — and **update or explicitly deprecate** each against the new host identity. A stale operational path targeting `hub-vm`/Watchtower is a **deploy blocker**, not doc polish.

---

## G5 — Rocky-native roller

Reuses the OS-independent roll logic (ruby `9309e980`, UNREVIEWED — re-bound + independently reviewed under **this** design) + greg detect (`09162239`), repackaged Rocky-native. The COS-specific bits (`/bin/bash`-ExecStart noexec-/var workaround, COS `DOCKER_CONFIG` path, bundled-runtime baseline, `startup.sh` COS-metadata cutover) are **scrapped**.

- **detect-emit / roll-core seam explicit** (greg's friction): `hub-detect` = detect-emit; `roller.sh` tick + typed-resolve + launch + roll = roll-core.
- **Auth (F17):** docker CLI → pinned `docker-credential-gcr` via a literal restricted `DOCKER_CONFIG` → metadata SA → exact AR `australia-southeast1-docker.pkg.dev/labops-389703/cloud-run-source-deploy/hub`. Falsifiers RED: positive pull; expired/no-helper/wrong-registry negatives; the historical Watchtower `/v2 service=` challenge failure. Watchtower absent/stopped.
- **Detection-only `:latest` (F18):** capture one full canonical `$REG@sha256:<64>` from full RepoDigest membership; validate build-info + Cloud Build provenance; **launch/rollback/state/quarantine/receipts use exact digests only**.
- **Preflight-before-stop (F19):** all non-mutating preflight (auth, pull, secrets, DB reachability, rollback readiness) completes **before** stopping the good Hub; record old container/image/digest + PG invariants; **non-recursive** transaction with explicit pre/post-mutation failure classes; only `rc0`+coherent advances last-good; **a verified rollback is not forward success**.
- **State/receipts durability (F20):** stable per-boot lock **inode** + inherited FD (helpers assert, never re-flock); replace-state = write-all + file `fsync` + parent `fsync`; receipts = same-filesystem **create-once/no-clobber** + dir `fsync`; seed validated last-good; persist quarantine across reboot; race the timer against a distinct direct/boot entrypoint.
- **Timer/timeout (F21):** `OnBootSec=60`, `OnUnitInactiveSec=300`, exact service/start/stop timeouts, monotonic internal deadlines, GNU `timeout` syntax; distinct `rc124`/`rc137` vs systemd `Result=timeout` tests.
- **Systemd unit (Rocky-native):** `/etc/systemd/system/ois-roller.{service,timer}`; `ExecStart=/usr/local/bin/roller.sh` (real executable path, no noexec workaround); `After=ois-hub.service`; runs as a confined user with only the docker socket + DOCKER_CONFIG it needs.
- **Mutation matrix (all RED when the guard is removed):** cold boot, candidate failure, reboot, concurrency, network loss, helper failure, health failure, rollback.

---

## G6 — CI / FM-1 causality

- **Reviewed successor workflow.** Any functional `deploy-hub.yml` successor gets a **new source review** (bridge `2485ce05` / PR #643 is source-only **input**, unmerged, predates Rocky roller semantics — F24). Key expiry tracked at `idea-591`.
- **Immutable build identity (F22):** build a create-once commit tag from an immutable **peeled commit** ref; pin workflow/actions/SDK/build-script; bind Cloud Build **ID + location + source + build-info + digest**. `cancel-in-progress:true` must not orphan a running Cloud Build or its evidence (guard or remove it).
- **One `:latest` promoter** under one writer; `:latest` promotion is a distinct, gated step.
- **Digest-level causal receipt (F23):** the final green run binds run id/attempt/ref/event/actor, workflow identity, Cloud Build id, immutable tag, selected digest, canonical `:latest`, **roller receipt**, running RepoDigest, and exact health SHA. `selected digest == promoted :latest == roller-selected == running RepoDigest`. Superseding ancestry alone is insufficient.
- **Re-audit deploy-hub target (F31)** vs the new VM name/IP.
- The **real post-rotation green run** happens **only after** the roller is independently accepted live (order in G7).

---

## G7 — implementation graph order (impl-arc outline for `final_packet`)

Structurally encoded, no back-fill of prod/sandbox/build/registry/credential/Terraform evidence after execution:

1. **New Director Decision** resolved with Director-grade proof (gates everything).
2. Exact implementation bytes produced **from this PASSED Rocky design**.
3. Independent **source review** (verifier).
4. **Frozen sandbox** manifest / resources / falsifiers (preregistered, zero-exec).
5. Verifier **pre-execution freeze review** (PASS-only).
6. Isolated **Rocky sandbox** forward + rollback + mutation execution + teardown.
7. Independent **implementation/migration gate** (verifier, PASS-only).
8. Fresh **credential** + production **baseline/freeze** (reject active deploy run).
9. **Inert Rocky production host** create + preflight.
10. **Controlled PD cutover** + Cloud Run proxy switch + **timed rollback** armed.
11. Independent **live/state/rollback-readiness** verification.
12. **Separately gated roller enable**.
13. Reviewed **CI successor** + real green build.
14. **Causal unattended auto-roll** verification (verifier, PASS-only).
15. **bug-307 / bug-308 reconciliation + closeout**, driver last.

Roles: architect (lily) drives + cutover; engineers (greg/ruby) impl bytes + sandbox; verifier (steve) every gate. Anti-scope: COS VM deletion/decommission (post-soak, separate authority); WIF/keyless (`idea-591`); any non-migration platform work.

---

## §8 — F01–F34 disposition register

| F | Control location | F | Control location |
|---|---|---|---|
| F01 authority broadening | G0.2/G0.3 new Decision | F18 `:latest` as authority | G5 detection-only |
| F02 TF destroys old | G2.1/G2.5 preserve+prevent_destroy | F19 stop-before-preflight | G5 preflight-before-stop |
| F03 dual-assign 10.10.0.2 | G2.2 distinct IP + Cloud Run rev | F20 receipt/lock durability | G5 fsync/create-once/inode |
| F04 PD attach/device identity | G3.3 by-id/UUID/ext4 assert | F21 timer/timeout drift | G5 exact cadence+rc tests |
| F05 writers continue | G3.1 freeze+quiesce | F22 CI cancel/orphan | G6 immutable tag + guard |
| F06 unclean PG stop | G3.1 checkpoint+clean-stop | F23 SHA-green≠digest | G6 digest causal receipt |
| F07 mkfs on data | G3.3 NO mkfs, fail-closed | F24 bridge PASS mistaken | G6 source-only input |
| F08 two writers | G3.1 one-writer | F25 stale/floated TF plan | G2.3 root lock + re-plan |
| F09 crash-snap as zero-loss | G3.2 fresh quiesced snap | F26 single-apply ordering | G2.4 5-phase plans |
| F10 PG data incompat | G3.4 exact digest+format | F27 unsafe/unfaithful sandbox | G1.5 isolated+cloned |
| F11 SELinux/`:Z` | G1.4/G3.5 durable label | F28 undefined downtime/RTO | G0.3 numeric + §measured |
| F12 Rocky runtime diff | G1.2/G1.5 pin+sandbox | F29 rollback loses writes | G3.6 same-PD back |
| F13 latest-pkg install | G1.1/G1.2 frozen provenance | F30 stopped-container inspect | G3.6 pinned start cmds |
| F14 startup/telemetry gone | G4.4 Ops Agent+guest-agent | F31 stale runbooks | G4.5 enumerate+deprecate |
| F15 secret leak | G4.2 sentinel+0600+no set -x | F32 old COS deleted early | G0.3 preserve through soak |
| F16 competing supervisors | G4.1 one systemd chain | F33 backup stops on Rocky | G4.3 recreate+restore-test |
| F17 roller repeats WT defect | G5 helper-per-pull negatives | F34 comms die mid-cutover | §9 out-of-band abort |

## §9 — downtime/RTO + comms (F28/F34)

- **Budgets (design targets; measured forward+reverse in sandbox, ratified in the Decision):** planned outage ≤ 15 min; automatic-rollback RTO ≤ 20 min; per-phase budgets with clock start/stop timestamps; an **automatic rollback trigger** on any phase exceeding budget or any invariant mismatch. No "instant" claim anywhere.
- **Comms (F34):** deterministic abort/rollback criteria are **pre-authorized** before Hub stop; an **out-of-band** operator channel + evidence store is used during the window; there is **no in-window Hub-MCP approval dependency** after the Hub is stopped.

## §10 — non-claims / boundary

Source-only design. Authorizes nothing executable. No prod / sandbox / build / registry-tag / credential / Terraform action is taken or approved here. Running image digests + on-VM versions remain UNOBSERVED (observed-at-cutover / on-sandbox, never assumed). `bug-307` + `bug-308` remain OPEN. Watchtower remains stopped/manual-only. **A new bounded Director Decision (G0.3) is required before any Rocky action.**
