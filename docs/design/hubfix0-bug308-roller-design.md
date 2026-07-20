# hubfix0 bug-308 — Option-C roller design (implementation-grade)

**Scope:** SOURCE-ONLY design; no GCP/VM/registry/prod action. Co-authored: **ruby** = architecture + startup.sh cutover (§1, §9); **greg** = poll/detect + provenance + causality-evidence + sandbox/tests/canary/secrets (§2–§8). Feeds lily's hfx0x3 reseed + steve's verifier-owned `bug308_review` gate (F4). Addresses steve's gate-fail F-items + the causality bar.

## 0. Thesis (F2 — REPLACEMENT, not restart)

bug-308 FM-2: watchtower v1.7.1's own WWW-Authenticate parser hard-requires a nonempty `service=` and drops the GAR challenge (`auth.go`, issue #1681) — an **unpatchable upstream binary** (upstream unmaintained). Fixing the token SOURCE (credHelpers/credsStore) is INERT because the broken parser remains. **Option C REPLACES watchtower's auto-roll role** with a purpose-built roller that authenticates via **docker-credential-gcr → metadata → hub-vm-sa@ (artifactregistry.reader)** — the PROVEN §B.3 AR path (ruby ran it live) — sidestepping the parser entirely. **Legacy watchtower is RETIRED/decommissioned, NOT restarted.**

## 1. Roller architecture  [RUBY]

### 1.1 Form — host-side bash, content-pinned (not a container)
The roller is host-side bash (like startup.sh's `refresh.sh` and the proven §B.3 manual roll), NOT a containerized agent — no bootstrap image, and it mirrors the existing codified `refresh-docker-token.*` pattern. Files install under `/var/lib/hub-roller/` (COS `/var` is writable but `noexec` → invoke via `/bin/bash`, as `refresh-docker-token.service` does), each **pinned by content SHA-256** asserted at install and re-asserted by the roller at start (fail-closed on drift):
- `roller.sh` — tick body (resolve → detect → validate → roll → verify → receipt);
- `hub-resolve.sh` — the SHARED gcloud-free resolver (roller **and** boot);
- `hub-launch.sh` — the SHARED Hub-ONLY launcher (roller **and** boot).
Auth: `DOCKER_CONFIG="$HUB_DIR/docker-config"` (startup.sh:45-47) → `docker-credential-gcr` → metadata → `hub-vm-sa@` (`artifactregistry.reader`) — the PROVEN §B.3 path. The gcr-helper binary is **exact-pinned** at install (path from `command -v docker-credential-gcr`, version, SHA-256); the roller asserts the helper SHA before use. Contrast the retired watchtower: its OWN registry client couldn't use the CLI helper → the parser bug + bug-107 static-token race; the roller uses the CLI and sidesteps both.

### 1.2 systemd units (mirror `refresh-docker-token.*`; §9 codifies the bytes)
- `hub-roller.service`: `Type=oneshot`; `Requires=docker.service`, `After=docker.service network-online.target`; `ExecStart=/bin/bash /var/lib/hub-roller/roller.sh`; `TimeoutStartSec=<bounded, > worst-case roll+rollback>`.
- `hub-roller.timer`: `OnBootSec=2min`, `OnUnitActiveSec=<cadence — greg §2: 5min, matching watchtower's prior --interval 300>`, `Persistent=true`, `WantedBy=timers.target`.
- Run-model/cadence owned by greg §2. Two-roller prevention: single oneshot unit (no long-lived daemon) + exclusive `flock -n /run/hub-roller.lock` (greg §2) at tick start; held ⇒ exit 0 no-op.

### 1.3 SHARED resolver `hub-resolve.sh` — gcloud-free, used by roller **and** boot (closes steve's reboot TOCTOU)
Emits an exact `$REG@sha256:<64hex>` target OR fails closed. It NEVER emits a mutable tag; both roller and boot consume only its exact-digest output.
1. Resolve `:latest`'s current digest via the gcloud-free method greg's §2/§5 selects (docker manifest inspect / v2 HEAD via gcr-helper token / pull-then-RepoDigest).
2. Validate: canonical `$REG@sha256:[0-9a-f]{64}` regex; and (when derived from `.RepoDigests`) require **exactly one** `$REG@sha256:*` membership — **zero or multiple ⇒ FAIL** (steve), never index-`[0]`.
3. Quarantine check: if the resolved digest == persisted `D_bad` and still-current ⇒ refuse (never return a known-bad digest).
4. **Fallback:** on any resolution failure / ambiguity / quarantine ⇒ return persisted `lastGoodDigest` (the last successfully-verified roll). If neither a valid fresh digest nor a `lastGoodDigest` exists ⇒ FAIL loud.

### 1.4 SHARED launcher `hub-launch.sh $REG@sha256:...` — Hub-ONLY, exact-digest-only (steve)
- **Arg contract (steve):** accepts ONLY an exact `$REG@sha256:[0-9a-f]{64}` ref; **fails closed on any tag** (regex-assert the arg; a `:tag`/bare/mutable ref aborts nonzero before touching docker).
- Recreates ONLY `ois-hub-prod` from the `startup.sh:107-119` **shared snippet** (one source, no line-range drift): fetch Hub secrets from Secret Manager (**never logged**); `docker rm -f ois-hub-prod`; `docker run -d --name ois-hub-prod --restart unless-stopped --network hub-net -p 8080:8080 -e NODE_ENV=production -e PORT=8080 -e POSTGRES_CONNECTION_STRING=… -e HUB_API_TOKEN=… -e WATCHDOG_ENABLED=true -e HUB_ADMIN_TOKEN=… -e OIS_GH_API_TOKEN=… -e OIS_REPO_EVENT_BRIDGE_REPOS=… -l com.centurylinklabs.watchtower.enable=true "$1"` (the exact digest).
- Touches NOTHING else: no `ois-postgres-prod`, no `hub-backup`, no watchtower, no full startup runner.
- Consumed by BOTH: boot (`startup.sh` → `hub-resolve.sh` → `hub-launch.sh "$D_boot"`) and the roller (`hub-launch.sh "$D_new"` / `"$D_prev"`). startup.sh stops inlining the docker-run and **never** launches by `:latest`.

### 1.5 The roll — embeds ROLL v8 engine (@515bd02), generalized to D_new/D_prev
Per tick, after resolve+detect find a NEW valid candidate `D_new` ≠ running (provenance-validated per greg §3):
1. `D_prev` = running `ois-hub-prod` RepoDigest **before any mutation** — the DYNAMIC rollback target (not a fixed digest; corrects #629).
2. **PG pre-snapshot:** `ois-postgres-prod` container ID + mount (attached PD) + liveness.
3. `hub-launch.sh "$REG@$D_new"` (v8 `recreate_hub`).
4. **VERIFY** (v8 `verify` = `health_local`/`health_ext`/`sha_of` + RepoDigest membership): bounded poll — local + external cache-busted `/health` gitSha == D_new build-info gitSha **AND** running RepoDigest membership == `$REG@$D_new`.
5. **verify OK ⇒** persist `lastGoodDigest = D_new`; emit `rolled` receipt (disposition `roll_success`).
6. **verify FAIL / timeout ⇒ ROLLBACK:** `hub-launch.sh "$REG@$D_prev"`; verify running == D_prev; **persist `D_bad = D_new`** (quarantine — §2/§6 circuit-breaker); emit `rolled_back` (v8 rc2) — or `rollback_unproven` (v8 rc3, fail-loud) if the rollback itself won't verify. **rc2 is NEVER forward-success.**
7. **PG invariant (post):** assert `ois-postgres-prod` ID + mount + liveness UNCHANGED vs the pre-snapshot; any mismatch ⇒ fail-loud (the roll must never touch PG or its PD).
Receipts: create-once JSON under `/var/lib/hub-roller/receipts/<ts>.json` (BUILD-capture discipline) binding greg's §4 causality fields + PG invariants + helper SHA + the `lastGoodDigest`/`D_bad` transitions; **no secrets** (greg §8).

### 1.6 Install / disable / uninstall — safe-manual rollback (steve)
- **INSTALL:** write the 3 scripts + 2 units (exact bytes, SHA-256 asserted); `systemctl daemon-reload`; `systemctl enable --now hub-roller.timer`.
- **DISABLE / UNINSTALL = SAFE MANUAL-ONLY:** `systemctl disable --now hub-roller.timer`; remove the roller units + scripts; `daemon-reload`. Leaves Hub RUNNING (last launched by the shared launcher) with **NEITHER roller NOR watchtower**. Does NOT restore prior metadata and does NOT restore watchtower (either would relaunch the broken WT on reboot). WT stays retired.
- Prior-stopped-state restoration for the WT cutover itself is captured in §9.3.

### 1.7 Legacy-WT retirement + two-roller prevention
- WT retirement is executed in §9 (container decommissioned + provisioning removed from startup.sh so no re-run/reboot relaunch). The now-inert `com.centurylinklabs.watchtower.enable` label on ois-hub-prod is harmless (no watchtower consumes it) — kept for minimal diff, removable.
- Two-roller prevention: single oneshot timer (no daemon) + the exclusive `flock -n /run/hub-roller.lock`; an overrunning tick's successor no-ops.

## 9. startup.sh terraform integration + cutover  [RUBY]

### 9.1 startup.sh source edits (the bytes)
- **Remove** the watchtower block (`:194-200`) and the `refresh.sh` + `refresh-docker-token.service`/`.timer` block (`:135-192`) — the refresh-token machinery existed ONLY for watchtower's bug-107 static-token workaround; the roller uses the gcr-helper directly, so both are dead.
- **Replace** the inlined Hub `docker run` (`:107-119`) with: source `hub-resolve.sh` (the §1.3 shared resolver, with `lastGoodDigest` fallback) → `hub-launch.sh "$RESOLVED_DIGEST"`. Boot NEVER launches by `:latest` (steve's reboot-TOCTOU fix — boot uses the SAME resolve/validate/quarantine reconciliation as the roller).
- **Add** the roller install block: write `/var/lib/hub-roller/{roller.sh,hub-resolve.sh,hub-launch.sh}` + `/etc/systemd/system/hub-roller.{service,timer}` via heredocs (mirroring the codified `refresh-docker-token.*` block being removed at :135-192), SHA-256-assert each, `daemon-reload`, `enable --now hub-roller.timer`. Idempotent (guarded like the existing `if ! docker inspect …` checks; re-running startup.sh re-asserts, never double-installs).

### 9.2 Terraform apply — reboot durability (steve pt-1 discipline)
startup.sh lives in VM metadata via `modules/hub/compute.tf` (`metadata_startup_script = file(".../startup.sh")`). Metadata cutover:
1. `terraform plan -out=<planfile>` (kept LOCAL/protected).
2. SHA-256 the planfile; `terraform show -json <planfile>` → assert **ZERO resource replacement** (no `-/+`) and **ONLY** `metadata_startup_script` as an in-place `~ update` (metadata is mutable / non-replacement-forcing ⇒ NO VM replacement).
3. `terraform apply <planfile>` (the EXACT saved plan) under **state-lock**.
4. Record **pre/post `metadata.startup-script` hashes**.
- **Plan secret-handling (steve):** the saved plan is potentially SECRET-BEARING → keep it LOCAL/protected; **publish only** its SHA-256 + a **redacted machine-readable change summary** (`terraform show -json` filtered to resource addresses + change actions, **no values**). **Bind provenance:** exact Terraform commit, `.terraform.lock.hcl` provider versions, workspace + backend, var-file hash, and state **lineage + serial**. The cutover receipt carries NONE of the plan and NO secret — only these hashes/refs.

### 9.3 Live imperative removal — apply ≠ live-stop (steve pt-2)
The in-place metadata change affects only FUTURE boots; it does NOT stop the RUNNING watchtower/timer. So on the live VM the cutover ALSO:
- **Capture prior state** (reversible-cutover receipt): `docker inspect watchtower-prod`; `systemctl status refresh-docker-token.{service,timer}`.
- `docker stop watchtower-prod && docker rm watchtower-prod`.
- `systemctl disable --now refresh-docker-token.timer`; remove the `refresh-docker-token.service`/`.timer` units + `refresh.sh`; `systemctl daemon-reload`.
- **VERIFY absent:** `docker inspect watchtower-prod` fails; `systemctl status refresh-docker-token.timer` gone.

### 9.4 Ordering, idempotence, fail-loud
- **Order (no auto-roll gap):** (a) terraform apply metadata [future boots] → (b) install + `enable --now` the roller on the live VM → (c) confirm one clean roller tick (detect-only/no-op) → (d) live-remove watchtower + the refresh-timer. The roller is proven live BEFORE watchtower is decommissioned.
- **Idempotent + fail-loud:** every step guarded + asserted; any failed assertion aborts nonzero with a receipt (no partial silent cutover); re-running is safe.
- **Reboot durability (F3 / case-1):** post-cutover the metadata script has NO watchtower and NO refresh-token block ⇒ reboot recreates Hub (via resolve+launcher) + postgres (guards) + installs/enables the roller; watchtower is NEVER relaunched — closed AT THE SOURCE, matching greg's §6 NO-WT-RELAUNCH test (re-run **and** reboot).

---

## 2. Poll / detect loop  [GREG]

- **Run model:** systemd timer (`OnBootSec` + `OnUnitActiveSec`, reviewed cadence — proposed 5 min, matching watchtower's prior `--interval 300`), one-shot service per tick. No long-lived daemon.
- **Exclusive lock (F6 two-roller-prevention + causality):** acquire `flock -n` on `/run/hub-roller.lock` at tick start; if held, **exit no-op** (another tick/instance owns it). The held flock is also the exclusive-service-lock causality evidence (§4).
- **Detect (candidate) — FROZEN, GCLOUD-FREE (R4; COS has NO gcloud):** `docker pull <REGISTRY>/hub:latest` (via the docker gcr-helper creds — the proven §B.3 path; idempotent, no-op if unchanged), THEN read the pulled image's `.RepoDigests` and require EXACTLY ONE canonical `<REGISTRY>/hub@sha256:<64hex>` match → operate ONLY on that captured digest. NO `docker manifest inspect` / direct-helper registry-HEAD (unproven / conflicts with the no-direct-helper rule). `hub-detect` emits that single ref on stdout + exit 0; **nonzero + no stdout** on pull-failure / zero-or-multiple-match / regex-fail (never a partial or ambiguous ref). This IS ruby's resolver step-1 (§1.3), which then TYPES it (R1: only `fresh_candidate` advances a periodic tick).
- **New-vs-running:** running digest = `docker inspect ois-hub-prod --format '{{.Image}}'` → `docker image inspect <id> --format '{{json .RepoDigests}}'` → **membership** test of the AR `reg@sha256` ref (never index-0). If the `:latest` candidate ref ∈ running RepoDigests → **no-op** (already current). Else → NEW candidate → validate (§3) → roll (§1 engine).
- **Idempotent + fail-closed:** any detect error (AR query fails, ambiguous) → no-op + log (never roll on uncertainty). Only an authenticated, unambiguous new-digest advances to a roll.

## 3. Candidate build-info / provenance validation  [GREG]

Before rolling a candidate `D_ci`, validate it (never roll a foreign/broken image) — reuse BUILD-capture's no-exec extraction:
- canonical `reg@sha256` for the hub repo (regex);
- `docker create <D_ci>` → `docker cp :/repo/hub/build-info.json - | tar -xO` → `docker rm` (no image exec); assert build-info is an object with `gitSha` (40-hex) + `builtAt` (exact UTC `YYYY-MM-DDTHH:MM:SSZ`, round-trip valid);
- record the candidate `{digest, gitSha, builtAt}` in the roll receipt (provenance).
- **ci_greenrun coupling:** for the ci_greenrun proof the candidate's `gitSha` must == `D_src` (the bridge-pin+roller-fix merge descendant). The roller records the candidate gitSha; the `== D_src` equality is verify_autoroll's binding — the roller provides the evidence, doesn't self-certify.

## 4. Causality evidence  [GREG]  (steve's bar — roller manifest is necessary but NOT sufficient)

The roll manifest (create-once, hashed, BUILD-capture discipline) must bind — so causality is proven, **never inferred from final digest equality alone**:
- **before-state:** `D_manual` = running digest before the roll + its gitSha;
- **candidate:** `D_ci` digest + its build-info `builtAt` (CI build time) + the AR push/update time;
- **roller timestamps (UTC):** candidate-observed → lock-acquired → stop → rm → create → start → health-complete;
- **Docker facts:** daemon ID; old+new container IDs + `.State.StartedAt`; `docker events` for the stop/rm/create/start of `ois-hub-prod` over the interval;
- **service identity:** the systemd unit name + the journal entries for the tick (the roll ran under the roller service, not an interactive shell);
- **after-state:** external cache-busted `/health` gitSha + the running RepoDigest;
- **EVIDENCE-BOUNDED no-manual-assist (R5 — a roller flock does NOT exclude a manual root that ignores it; this is bounded evidence, not mathematical absence):** bind (a) the roll process's systemd **PID/PPID/cgroup** == the `hub-roller` service unit's (the roll ran under the roller, not an interactive shell or other unit); (b) `docker events` actor/attributes for the stop/rm/create/start (daemon-side record); (c) ALL queryable human/automation ACCESS-audit surfaces for the interval — GCP IAP/SSH audit logs, **serial-console** access, OS-Login/sshd sessions, and any metadata/startup-script runs — showing no other writer; (d) the shared **flock** (every sanctioned roll/launcher path acquires `/run/hub-roller.lock` — coordination among sanctioned writers, NOT exclusion of an unsanctioned root). Result phrased as: no sanctioned OR audited path other than this roller mutated ois-hub-prod in the window.

## 5. Sandbox-parity environment  [GREG]

Mirror the prod-relevant surface to validate the roller BEFORE any prod deploy (autonomous authority → a throwaway GCE VM or a throwaway container-host, NEVER prod):
- **Parity (must match):** `docker-credential-gcr` → **metadata → SA → AR reader** (the exact prod auth path — the load-bearing unknown to prove: does the gcr-helper AR **`docker pull :latest` + exact-single-RepoDigest detect (§2 FROZEN)** AND pull-by-digest work end-to-end on COS); a throwaway AR repo/tag; the **Hub-ONLY launcher** (`hub-launch.sh` — recreates ONLY ois-hub-prod from the startup.sh:107-119 shared snippet, ruby §1 — NOT the full startup runner); the flock; the systemd timer/service; a stand-in "hub" container exposing `/health` reporting a build-info gitSha; stand-in postgres + watchtower containers to prove non-interference.
- **Documented non-parity:** the real hub image + real postgres are stand-ins — but a stand-in PG container asserts the roll does **not touch PG** (validates ruby's PG-invariant, §1).
- **Detect note:** the frozen detect is docker-CLI-only (no gcloud on COS); the sandbox proves the `docker pull :latest` → exactly-one canonical RepoDigest path on the COS-parity host.

## 6. Positive / negative / MUTATION tests  [GREG]

- **POSITIVE:** `:latest` → new valid `D_ci` ⇒ detect → validate → roll → `/health` = D_ci gitSha + running == D_ci ⇒ full causality manifest. PASS.
- **NEGATIVE no-op:** `:latest` == running ⇒ no roll, no churn. PASS.
- **NEGATIVE bad candidate:** `:latest` → image with missing/invalid build-info ⇒ provenance REFUSES ⇒ stays on D_manual. PASS (fail-closed).
- **NEGATIVE health-miss → rollback:** roll to D_ci, `/health` never reports D_ci gitSha in the bounded window ⇒ **rollback to dynamic D_prev** ⇒ `/health` back to D_prev ⇒ rollback receipt. PASS (fail-closed).
- **MUTATION-proof (steve's bar, the v8 8/8 pattern):** delete/neuter each guard ⇒ a specific test goes RED — remove provenance ⇒ bad-candidate rolls (caught); remove flock ⇒ two-roller test detonates; remove health-check ⇒ health-miss doesn't roll back; remove D_prev capture ⇒ rollback targets wrong/empty; remove membership ⇒ index-0 false-match. Each mutation → one RED test.
- **TWO-ROLLER:** two ticks race ⇒ flock ⇒ exactly one rolls, the other no-ops.
- **HUB-ONLY recreate:** the Hub-launcher recreates ONLY ois-hub-prod ⇒ the stand-in postgres + watchtower containers are **untouched** (same container ID/StartedAt across the roll). PASS (F3/PG-invariant).
- **NO-WT-RELAUNCH (F3):** with legacy watchtower removed, re-run startup.sh **AND** reboot the sandbox VM ⇒ watchtower is **NOT** relaunched (the roller owns auto-roll). PASS.
- **FROZEN detect (R4):** the §2 detect (`docker pull :latest` → exactly-one canonical RepoDigest, no gcloud) resolves on the COS-parity host; a zero-or-multiple-match input ⇒ `hub-detect` exits nonzero + no stdout (fail-closed, no roll). PASS.

## 7. Live-canary plan  [GREG]

Aligns with ruby's R3 no-overlap cutover (§9): the roller is installed **DISABLED / detect-only**; legacy watchtower is stopped+removed and its absence PROVEN first; THEN one explicitly non-mutating **detect-only canary** (poll + detect + validate + LOG the candidate, **no roll**) confirms detect + gcr-helper auth + provenance in prod with NO writer overlap; THEN the roller is enabled + a first controlled roll under lily's supervision (rollback-ready). Canary evidence = the WT-absence proof + detect-only logs + the first roll's causality manifest. A bounded manual-only gap during cutover is acceptable + auditable; overlapping writers are not.

## 8. Secret-exclusion tests  [GREG]

- No static token anywhere (gcr-helper mints per-pull from metadata — never a config.json token file, unlike the retired bug-107 refresh.sh).
- **SENTINEL tests (R10):** in the SANDBOX inject unique planted sentinel secret values (e.g. into the SA/token path + env) and prove the sentinels NEVER occur in the receipt, stdout/stderr, the journal, the roll manifests, any Terraform plan/summary, or test artifacts. A generic grep can miss unknown formats AND can itself expose a match, so the planted sentinels are the positive control (they PROVE the exclusion actually catches a secret). PRODUCTION receipts are no-secret by construction; NEVER scan or publish real secret values — sentinels are sandbox-only.

## F-item mapping (to complete with ruby/steve against the gate-fail F-list)

F2 REPLACEMENT → §0; F3 Hub-only-restart-no-WT-relaunch → §1 (ruby); F4 fix-review verifier node → this doc + sandbox = steve's `bug308_review`; F6 startup.sh cutover + flock → §9/§2 (ruby+greg).

**ruby architecture-pass coverage (steve's added cases + refinements):** helper exact-pin (case-4) → §1.1; Hub-only launcher, exact-`@sha256`-only arg / fail-closed-on-tags (case-2, steve pt-4/5) → §1.4; gcloud-free resolver with single-membership + quarantine + `lastGoodDigest` fallback, boot uses the SAME resolver → no reboot TOCTOU (steve final-1) → §1.3 + §9.1; dynamic-D_prev rollback (rc2 ≠ forward-success) → §1.5; Postgres-invariant (no touch to ois-postgres-prod / PD) → §1.5; quarantine/circuit-breaker (case-3) → §1.3 + §1.5; two-roller flock → §1.2/§1.7; install/disable = safe-manual-only, no metadata/WT restore → §1.6; TF `plan -out`/hash/zero-replacement/apply-exact/state-lock/pre-post-hashes + plan-secret-handling (local-only, publish hash+redacted summary, bind TF commit/lockfile/workspace/backend/var-file-hash/state-lineage+serial) (steve pt-1/final-2) → §9.2; apply ≠ live-stop → live imperative WT removal (steve pt-2) → §9.3; reboot-durability at source → §9.4. Open knobs: cadence value (greg §2); RepoDigests membership filter form (§1.3).
