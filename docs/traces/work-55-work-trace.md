# work-55 work-trace — bug-107 deploy-spine hardening (INFRA; lily drives, greg assists)

**Owner:** greg (engineer — terraform code half) · **Claimed:** 2026-06-28T03:06 · **Drives:** lily (owns apply+verify, prod SSH) · **Target:** bug-107 · **Gate:** verifier-gate + lily review/apply

## Scope (lily-scoped)
The watchtower AR-auth is un-codified VM↔terraform DRIFT: `startup.sh:47` configures `docker-credential-gcr` for the docker CLI, but the watchtower container (123-125) gets NO creds config → a terraform-provisioned VM can't auth watchtower to AR. The working `/var/lib/docker-creds` + refresh.sh + timer + `-v` mount was hand-added to the live VM 2026-06-21 and never codified → lost on recreate; the 30-min timer races the SA-token TTL = recurring bug-107 stall.

## DELIVERABLE (this PR) — codify + harden the static-refresh
`modules/hub/scripts/startup.sh` (loaded via `compute.tf:81 file()` — RAW, no templatefile interpolation, so bash `${...}` is safe):
1. **CODIFY** (drift fix): a `/var/lib/docker-creds/refresh.sh` + `refresh-docker-token.service`+`.timer` + the `-v /var/lib/docker-creds:/config` mount on the watchtower run — set up + first-minted BEFORE watchtower starts.
2. **HARDEN the race**: (a) timer `OnUnitActiveSec=10min` (was 30min) — well under the ~60min SA-token TTL, closing the timer-vs-TTL window; (b) refresh.sh **FAIL-LOUD** — `set -euo pipefail` + explicit empty-token guard (`exit 1` + stderr log) + atomic write (`mktemp`+`mv`) → a mint/write failure marks the systemd unit failed instead of the silent stale-token no-op (the bug-107 silent-failure; tele-4).
- COS constraints honored: `/var` noexec → `ExecStart=/bin/bash <script>` (mirrors hub-backup.service); reuses the metadata-token extraction pattern (startup.sh:70-72); registry hardcoded as at line 47.
- Validated: `bash -n` on startup.sh AND the extracted refresh.sh both parse clean.
- **Idempotency**: refresh.sh/units rewritten each boot (idempotent); first-mint runs each boot; watchtower `-v` mount applies on a recreate (the live VM keeps its container — lily applies the live delta via SSH).

## RECOMMENDATION (the freeform evidence): prefer the docker-credential-gcr HELPER (structural race-elimination), pending live-VM compat verify (lily owns); the hardened-static above is the durable FLOOR.

**The static-refresh is fundamentally a RACE** — a timer-minted token vs its TTL. Hardening (10min « 60min + fail-loud) narrows the window to ~0 + surfaces failures, but does NOT eliminate the race CLASS.

**The structural fix** — make watchtower mint a FRESH token PER-PULL via `docker-credential-gcr` (the SAME helper the docker CLI already uses at startup.sh:47): mount the helper binary into the watchtower container + give it `config.json` with `{"credHelpers":{"australia-southeast1-docker.pkg.dev":"gcr"}}` (instead of static `auths`). Each pull execs `docker-credential-gcr get` → fresh token from the metadata server. **No static token, no timer, no stale-token window → the failure mode is eliminated by construction (tele-7/tele-9 fail-loud-by-construction).**

**Compat UNKNOWNS to verify on the live VM (lily owns apply+verify — I can't):**
1. **Binary path + PATH-resolution**: docker-credential-gcr's COS path + mounting it where watchtower's pull client resolves `docker-credential-gcr` on PATH inside the container. (It's a static Go binary → should run in watchtower's minimal base without lib deps.)
2. **Exec inside watchtower**: whether the watchtower image + mount perms permit exec'ing the mounted binary.
3. **Metadata reachability**: docker-credential-gcr mints via 169.254.169.254 — reachable from watchtower on the `hub-net` bridge (link-local is normally reachable from Docker bridges; verify).

**Call:** ship the hardened-static NOW (guaranteed-correct durable floor); pursue the helper as the structural-elimination follow-on — IF lily's live-VM check clears the 3 unknowns, a follow-up swaps to the credHelper config + DELETES refresh.sh/service/timer (structural kill); ELSE the hardened-static remains the durable fix. De-risks: a correct hardened fix lands now; the structural kill is verified live (not blind).

## Lifecycle
greg delivers the terraform PR + this recommendation; lily reviews + applies (SSH hotfix the live VM with the 10min+fail-loud delta, no reboot, + merge for recreate-durability). work-55 = bug-107's real fix + the work-48/bug-195 VM-half. PRIORITY before push-events (work-54, held).
