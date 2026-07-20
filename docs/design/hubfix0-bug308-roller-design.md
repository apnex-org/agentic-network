# hubfix0 bug-308 — Option-C roller design (implementation-grade)

**Scope:** SOURCE-ONLY design; no GCP/VM/registry/prod action. Co-authored: **ruby** = architecture + startup.sh cutover (§1, §9); **greg** = poll/detect + provenance + causality-evidence + sandbox/tests/canary/secrets (§2–§8). Feeds lily's hfx0x3 reseed + steve's verifier-owned `bug308_review` gate (F4). Addresses steve's gate-fail F-items + the causality bar.

## 0. Thesis (F2 — REPLACEMENT, not restart)

bug-308 FM-2: watchtower v1.7.1's own WWW-Authenticate parser hard-requires a nonempty `service=` and drops the GAR challenge (`auth.go`, issue #1681) — an **unpatchable upstream binary** (upstream unmaintained). Fixing the token SOURCE (credHelpers/credsStore) is INERT because the broken parser remains. **Option C REPLACES watchtower's auto-roll role** with a purpose-built roller that authenticates via **docker-credential-gcr → metadata → hub-vm-sa@ (artifactregistry.reader)** — the PROVEN §B.3 AR path (ruby ran it live) — sidestepping the parser entirely. **Legacy watchtower is RETIRED/decommissioned, NOT restarted.**

## 1. Roller architecture  [RUBY]

### 1.1 Form — host-side bash, content-pinned (not a container)
The roller is host-side bash (like startup.sh's `refresh.sh` and the proven §B.3 manual roll), NOT a containerized agent — no bootstrap image, and it mirrors the existing codified `refresh-docker-token.*` pattern. Files install under `/var/lib/hub-roller/` (COS `/var` is writable but `noexec` → invoke via `/bin/bash`, as `refresh-docker-token.service` does), each **pinned by content SHA-256** asserted at install and **re-asserted before every use (R8)** — the roller AND boot (§9.1) hash-check each script BEFORE sourcing/exec, fail-closed on drift:
- `roller.sh` — tick body (resolve → detect → validate → roll → verify → receipt);
- `hub-resolve.sh` — the SHARED gcloud-free resolver (roller **and** boot);
- `hub-launch.sh` — the SHARED Hub-ONLY launcher (roller **and** boot).
Auth: `DOCKER_CONFIG="$HUB_DIR/docker-config"` (startup.sh:45-47) → `docker-credential-gcr` → metadata → `hub-vm-sa@` (`artifactregistry.reader`) — the PROVEN §B.3 path. Contrast the retired watchtower: its OWN registry client couldn't use the CLI helper → the parser bug + bug-107 static-token race; the roller uses the CLI and sidesteps both.
**Pinned dependency baseline (R9):** the roller binds the Hub VM's exact **COS image/milestone** (`image`/`image_family` pin) as its runtime baseline and the required behaviour of `docker`, `bash`, `flock` (util-linux), `curl`, `tar`, `jq`, `docker-credential-gcr` — all already present on the COS Hub VM and used by startup.sh. The gcr-helper binary is **exact-pinned** at install (path from `command -v docker-credential-gcr`, version, SHA-256); the roller asserts the helper SHA before use. Any missing/drifted dependency or helper-SHA mismatch ⇒ fail-loud (never a silent partial-capability run).

### 1.2 systemd units (mirror `refresh-docker-token.*`; §9 codifies the bytes)
- `hub-roller.service`: `Type=oneshot`; `Requires=docker.service`, `After=docker.service network-online.target`; `ExecStart=/bin/bash /var/lib/hub-roller/roller.sh`; `TimeoutStartSec=<bounded, > worst-case roll+rollback>` + `TimeoutStopSec` + explicit `KillMode=mixed`/`KillSignal=SIGTERM` (R9 timeout/kill).
- `hub-roller.timer`: `OnBootSec=2min`, `OnUnitActiveSec=<cadence — greg §2: 5min, matching watchtower's prior --interval 300>`, `Persistent=true`, `WantedBy=timers.target`.
- **Unit hardening (R9):** run under a dedicated low-privilege identity holding only docker-socket access (the minimum to drive the daemon; root only if the socket group cannot be granted on COS); `UMask=0077`; state/runtime dirs owned `0700` by the service user (`/var/lib/hub-roller`, `/run/hub-roller`); `Environment=DOCKER_CONFIG=$HUB_DIR/docker-config`; **journal redaction** — the unit never echoes secret env (secrets are fetched inside `hub-launch.sh` and passed via `-e`, never printed); no secret-bearing `EnvironmentFile`.
- Run-model/cadence owned by greg §2. Two-roller prevention: single oneshot unit (no long-lived daemon) + exclusive `flock -n /run/hub-roller.lock` (greg §2) at tick start; held ⇒ exit 0 no-op. **Flock scope (R5):** it excludes only concurrent *roller* instances — NOT a manual/root docker command; the no-manual-writer claim is evidence-bounded (§1.7 + greg §4), not proven by the lock.

### 1.3 SHARED resolver `hub-resolve.sh` — TYPED outcome (R1) + FROZEN method (R4)
Wraps greg's `hub-detect` (seam: `hub-detect` emits a raw `$REG@sha256:<64hex>` on stdout, exit 0 on a clean single resolution, nonzero on any ambiguity/failure/no-auth). The resolver returns a **TYPED outcome** — `fresh_candidate` | `boot_fallback` | `quarantined` | `error` — plus the exact digest for the first two. It NEVER emits a mutable tag; the CALLER's policy decides what each outcome permits.

**FROZEN detect method (R4)** — no (i)/(ii)/(iii) open selection: `docker pull "$REG:latest"` (CLI + gcr-helper) → `docker image inspect` the pulled image → require **exactly one** canonical `$REG@sha256:[0-9a-f]{64}` member of `.RepoDigests` (zero/multiple ⇒ `error`, never index-`[0]`) → that captured digest is the candidate. (Direct registry-`HEAD`-via-helper-token and `docker manifest inspect` are OUT — unproven / conflict with the no-assumed-helper-semantics rule.) The sandbox (greg §5) proves this exact CLI path.

**Outcome logic:**
1. `hub-detect` clean + digest validates + not quarantined ⇒ `fresh_candidate(digest)`.
2. resolved digest == persisted `D_bad` and still-current ⇒ `quarantined`.
3. `hub-detect` fails/ambiguous/no-auth ⇒ `boot_fallback(lastGoodDigest)` if a valid persisted `lastGoodDigest` exists, else `error`.

**CALLER POLICY (R1 — the no-backwards-roll rule):**
- **Periodic roller tick** advances (rolls) **ONLY** on `fresh_candidate`. `boot_fallback` / `quarantined` / `error` ⇒ **NO-OP** — a tick must NEVER roll to `lastGoodDigest`; a transient registry failure must not let a stale fallback read as "new-vs-running" and roll production backwards.
- **Boot / recovery** may LAUNCH `boot_fallback` (it needs a known-good digest to start), then defers all further rolls to the periodic tick. `error` at boot ⇒ fail-loud to manual (no launch target — never `:latest`).

### 1.4 SHARED launcher `hub-launch.sh $REG@sha256:...` — Hub-ONLY, exact-digest-only (steve)
- **Arg contract (steve):** accepts ONLY an exact `$REG@sha256:[0-9a-f]{64}` ref; **fails closed on any tag** (regex-assert the arg; a `:tag`/bare/mutable ref aborts nonzero before touching docker).
- Recreates ONLY `ois-hub-prod` from the `startup.sh:107-119` **shared snippet** (one source, no line-range drift): fetch Hub secrets from Secret Manager (**never logged**); `docker rm -f ois-hub-prod`; `docker run -d --name ois-hub-prod --restart unless-stopped --network hub-net -p 8080:8080 -e NODE_ENV=production -e PORT=8080 -e POSTGRES_CONNECTION_STRING=… -e HUB_API_TOKEN=… -e WATCHDOG_ENABLED=true -e HUB_ADMIN_TOKEN=… -e OIS_GH_API_TOKEN=… -e OIS_REPO_EVENT_BRIDGE_REPOS=… "$1"` (the exact digest). **The `com.centurylinklabs.watchtower.enable` label is REMOVED (R7)** — retirement is fail-safe by construction: any watchtower that ever reappears finds no opted-in container.
- Touches NOTHING else: no `ois-postgres-prod`, no `hub-backup`, no watchtower, no full startup runner.
- Consumed by BOTH: boot (`startup.sh` → `hub-resolve.sh` → `hub-launch.sh "$D_boot"`) and the roller (`hub-launch.sh "$D_new"` / `"$D_prev"`). startup.sh stops inlining the docker-run and **never** launches by `:latest`.

### 1.5 The roll — embeds ROLL v8 engine (@515bd02), generalized to D_new/D_prev
Per tick, after resolve+detect find a NEW valid candidate `D_new` ≠ running (provenance-validated per greg §3):
1. `D_prev` = running `ois-hub-prod` RepoDigest **before any mutation** — the DYNAMIC rollback target (not a fixed digest; corrects #629).
2. **PG pre-snapshot:** `ois-postgres-prod` container ID + mount (attached PD) + liveness.
3. `hub-launch.sh "$REG@$D_new"` (v8 `recreate_hub`).
4. **VERIFY** (v8 `verify` = `health_local`/`health_ext`/`sha_of` + RepoDigest membership): bounded poll — local + external cache-busted `/health` gitSha == D_new build-info gitSha **AND** running RepoDigest membership == `$REG@$D_new`.
5. **verify OK ⇒** persist `lastGoodDigest = D_new` (atomic, §1.8); emit `rolled` receipt (disposition `roll_success`).
6. **verify FAIL / timeout ⇒ ROLLBACK:** `hub-launch.sh "$REG@$D_prev"`; verify running == D_prev; **persist `D_bad = D_new`** (atomic quarantine, §1.8 — §2/§6 circuit-breaker); emit `rolled_back` (v8 rc2) — or `rollback_unproven` (v8 rc3, fail-loud) if the rollback itself won't verify. **rc2 is NEVER forward-success.**
7. **PG invariant (post):** assert `ois-postgres-prod` ID + mount + liveness UNCHANGED vs the pre-snapshot; any mismatch ⇒ fail-loud (the roll must never touch PG or its PD).
Receipts: create-once JSON under `/var/lib/hub-roller/receipts/<ts>.json` (BUILD-capture discipline; atomic write per §1.8) binding greg's §4 causality fields + PG invariants + helper SHA + the `lastGoodDigest`/`D_bad` transitions; **no secrets** (greg §8 sentinel-tested §10).

### 1.6 Install / disable / rollback — REBOOT-DURABLE safe-manual (R2)
- **INSTALL:** write the 3 scripts + 2 units (exact bytes, SHA-256 asserted); `systemctl daemon-reload`. **Enable is gated by a Terraform-controlled metadata flag `hub-roller-enabled` (§9):** startup.sh always installs the units but only `systemctl enable --now hub-roller.timer` when the flag is `true`.
- **DISABLE / ROLLBACK = REBOOT-DURABLE SAFE-MANUAL (R2):** the naive "disable timer + remove scripts" is NOT reboot-durable — the unchanged metadata startup-script would reinstall/re-enable the failed roller on the next boot. So safe-manual rollback is a **metadata transition**: flip `hub-roller-enabled=false` via the exact `plan -out`→`apply` discipline (§9.2) AND live `systemctl disable --now hub-roller.timer`. Result: Hub keeps RUNNING (last launched via the shared launcher), **NEITHER auto-roller enabled**, and **reboot cannot resurrect either writer** (metadata has no watchtower; the roller flag is false). It NEVER restores the old watchtower metadata.
- Prior-stopped-state capture for the WT cutover is in §9.3; the cutover FSM (§9.4) defines the compensating transitions.

### 1.7 Legacy-WT retirement + writer-exclusion (R5)
- WT retirement is executed in §9 (container decommissioned + provisioning removed from startup.sh so no re-run/reboot relaunch). The watchtower control label is **removed** from the Hub-run spec (§1.4, R7) — no reliance on watchtower "staying absent forever."
- **Two-roller prevention:** single oneshot timer (no daemon) + the exclusive `flock -n /run/hub-roller.lock`; an overrunning tick's successor no-ops.
- **No-manual-writer is EVIDENCE-BOUNDED, not proven by the flock (R5):** the flock coordinates only *roller* instances; a manual root/operator `docker` command ignores it. The "no manual assist" claim (greg §4) rests on every *sanctioned* roll/launcher path sharing the lock + binding the systemd unit **PID/PPID/cgroup** + `docker events` for the interval, cross-checked against **all** available access-audit surfaces (IAP/SSH **and** serial-console **and** OS-login/automation) — phrased as evidence-bounded, NOT mathematical absence (the OS does not enforce the lock against every writer).

### 1.8 State-integrity contract (R6) — `lastGoodDigest`, `D_bad`, receipts
All persisted roller state lives on the **persistent boot disk** under `/var/lib/hub-roller/` (NOT tmpfs `/run`, which holds only the lock) so it survives container restarts; each item obeys:
- **Atomic create/replace:** write a temp file in the same directory → `fsync` → `rename()` over the target (never a partial in-place write); a reader always sees a whole prior or whole new value.
- **Perms/ownership:** `0600`, owned by the service user; parent dir `0700`.
- **Schema/version:** a `{schema_version, …}` envelope; an unknown/newer version is treated as unreadable (fail-closed), never guessed.
- **Validation on READ:** `lastGoodDigest`/`D_bad` must match `^<REG>@sha256:[0-9a-f]{64}$` (exact registry prefix + digest regex); anything else ⇒ treated as ABSENT/corrupt. **A corrupt/invalid/tampered state value must NEVER become a launch or rollback target** — boot with no valid `lastGoodDigest` fails-loud to manual; a corrupt `D_bad` degrades safe (quarantine nothing, but a roll still requires `fresh_candidate`).
- **Symlink refusal:** open state paths `O_NOFOLLOW` / reject if `[ -L ]` (no state-file symlink redirection).
- **VM recreation:** a freshly-recreated VM has an empty `/var/lib/hub-roller` → boot resolves a `fresh_candidate` or fails-loud to manual (explicit; never launches an unvalidated ref). Receipts are best-effort durable; their loss never affects launch safety.

## 9. startup.sh terraform integration + cutover  [RUBY]

### 9.1 startup.sh source edits (the bytes)
- **Remove** the watchtower block (`:194-200`) and the `refresh.sh` + `refresh-docker-token.service`/`.timer` block (`:135-192`) — the refresh-token machinery existed ONLY for watchtower's bug-107 static-token workaround; the roller uses the gcr-helper directly, so both are dead.
- **Boot order (R8) — hash-assert before use:** (1) write `/var/lib/hub-roller/{roller.sh,hub-resolve.sh,hub-launch.sh}` + `/etc/systemd/system/hub-roller.{service,timer}` via heredocs (mirroring the codified `refresh-docker-token.*` block being removed at :135-192); (2) **SHA-256-assert each script BEFORE sourcing/exec** (fail-loud on mismatch); (3) **replace** the inlined Hub `docker run` (`:107-119`) with: source the hash-verified `hub-resolve.sh` → resolve (typed; boot may LAUNCH `boot_fallback`, §1.3) → `hub-launch.sh "$RESOLVED_DIGEST"`. Boot NEVER launches by `:latest`.
- **Roller enable is metadata-gated (R2):** a Terraform-controlled metadata key `hub-roller-enabled` (`true|false`) — startup.sh always installs the units + `daemon-reload`, but only `systemctl enable --now hub-roller.timer` when `hub-roller-enabled=true`; this makes the safe-manual rollback (§1.6) reboot-durable.
- Idempotent (guarded like the existing `if ! docker inspect …` checks; re-running startup.sh re-asserts, never double-installs).

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

### 9.4 Cutover FSM — NO two-writer overlap, per-step compensation (R3 + R8)
The **one-writer invariant** dominates zero-gap availability: watchtower is removed BEFORE the roller is enabled — never both enabled at once (`flock` does not coordinate with legacy watchtower). A bounded, auditable manual-only gap between S2 and S4 is acceptable; overlapping writers are not. Each state has a defined compensation; any failure lands in a **verified manual-only** state, never an ambiguous half-install.

| State | Action | Compensation on failure |
|---|---|---|
| **S0** | Terraform `plan -out`→`apply` the metadata: roller scripts/units provisioned, `hub-roller-enabled=false` (installed, NOT enabled); boot launches Hub via resolver | apply fails/rejected ⇒ abort, no live change; watchtower still sole writer (safe) |
| **S1** | Install roller on the live VM **DISABLED** (write + SHA-assert scripts/units, `daemon-reload`; timer NOT enabled) | install/assert fails ⇒ remove partial install; manual-only; watchtower still sole writer |
| **S2** | Capture WT prior-state (§9.3) → `docker stop && rm watchtower-prod`; `systemctl disable --now refresh-docker-token.timer` + remove its units/`refresh.sh`; `daemon-reload`; **VERIFY absent** | WT won't stop/remove ⇒ abort with roller still DISABLED; watchtower remains sole writer (no overlap introduced) |
| **S3** | Run ONE explicitly **non-mutating detect-only canary** (greg §7): resolve+detect+validate+LOG, **no roll**; confirm gcr-helper auth + frozen detect + provenance in prod | canary fails ⇒ roller stays DISABLED; Hub already on a good digest → **bounded manual-only** (auditable); fix + retry S3, never enable on a failed canary |
| **S4** | Enable active rolling: flip `hub-roller-enabled=true` via the exact `plan -out`→`apply` transition **and** `systemctl enable --now hub-roller.timer` | enable fails ⇒ set flag false + disable timer ⇒ manual-only |

- **Invariant:** at NO state are two writers both enabled — WT is gone (S2) strictly before the roller is enabled (S4).
- **Idempotent + fail-loud:** every step guarded + asserted; a failed assertion aborts nonzero with a receipt (no partial silent cutover); re-running resumes safely.
- **Reboot durability (F3 / case-1):** post-cutover the metadata has NO watchtower and enables the roller only when `hub-roller-enabled=true` ⇒ reboot recreates Hub (resolve+launcher) + postgres (guards) + enables the roller per the flag; watchtower is NEVER relaunched — closed AT THE SOURCE, matching greg's §6 NO-WT-RELAUNCH test (re-run **and** reboot).

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

**ruby architecture-pass coverage (steve's added cases + refinements):** helper exact-pin (case-4) → §1.1; Hub-only launcher, exact-`@sha256`-only arg / fail-closed-on-tags (case-2, steve pt-4/5) → §1.4; gcloud-free resolver with single-membership + quarantine + `lastGoodDigest` fallback, boot uses the SAME resolver → no reboot TOCTOU (steve final-1) → §1.3 + §9.1; dynamic-D_prev rollback (rc2 ≠ forward-success) → §1.5; Postgres-invariant (no touch to ois-postgres-prod / PD) → §1.5; quarantine/circuit-breaker (case-3) → §1.3 + §1.5; two-roller flock → §1.2/§1.7; install/disable = safe-manual-only, no metadata/WT restore → §1.6; TF `plan -out`/hash/zero-replacement/apply-exact/state-lock/pre-post-hashes + plan-secret-handling (local-only, publish hash+redacted summary, bind TF commit/lockfile/workspace/backend/var-file-hash/state-lineage+serial) (steve pt-1/final-2) → §9.2; apply ≠ live-stop → live imperative WT removal (steve pt-2) → §9.3; reboot-durability at source → §9.4. Open knobs: cadence value (greg §2).

**Pre-gate REVISE (`a51a9ca9` review, rv 56421733) — ruby R-items:** R1 typed resolver outcome, periodic tick advances ONLY on `fresh_candidate` (no backwards-roll to `lastGoodDigest`) → §1.3; R2 reboot-durable safe-manual via TF `hub-roller-enabled` flag (metadata can't resurrect either writer) → §1.6 + §9.1; R3 NO two-writer overlap (disabled-install → retire-WT → detect-only canary → enable), one-writer invariant → §9.4 FSM; R6 state-integrity contract (atomic rename+fsync, perms, schema/version, regex-on-read, symlink-refuse, corrupt≠launch-target, VM-recreate) → §1.8; R7 remove `watchtower.enable` label (fail-safe retirement) → §1.4; R8 hash-before-use boot order + cutover FSM compensation → §9.1 + §9.4; R9 dependency/unit hardening (COS baseline + docker/bash/systemd/curl/tar/jq; user/umask/dirs/journal-redaction/timeout-kill) → §1.1 + §1.2. R4 (freeze detect) + R5 (evidence-bounded no-manual) + R10 (sentinel secrets) = greg §2/§4/§8; SEAMS: my §1.3 resolver step-1 = greg's frozen `hub-detect`; my §9.4 detect-only canary (S3) = greg's §7; §1.7 carries the R5 flock-scope caveat.
