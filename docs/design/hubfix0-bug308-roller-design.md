# hubfix0 bug-308 — Option-C roller design (implementation-grade)

**Scope:** SOURCE-ONLY design; no GCP/VM/registry/prod action. Co-authored: **ruby** = architecture + startup.sh cutover (§1, §9); **greg** = poll/detect + provenance + causality-evidence + sandbox/tests/canary/secrets (§2–§8). Feeds lily's hfx0x3 reseed + steve's verifier-owned `bug308_review` gate (F4). Addresses steve's gate-fail F-items + the causality bar.

## 0. Thesis (F2 — REPLACEMENT, not restart)

bug-308 FM-2: watchtower v1.7.1's own WWW-Authenticate parser hard-requires a nonempty `service=` and drops the GAR challenge (`auth.go`, issue #1681) — an **unpatchable upstream binary** (upstream unmaintained). Fixing the token SOURCE (credHelpers/credsStore) is INERT because the broken parser remains. **Option C REPLACES watchtower's auto-roll role** with a purpose-built roller that authenticates via **docker-credential-gcr → metadata → hub-vm-sa@ (artifactregistry.reader)** — the PROVEN §B.3 AR path (ruby ran it live) — sidestepping the parser entirely. **Legacy watchtower is RETIRED/decommissioned, NOT restarted.**

## 1. Roller architecture  [RUBY]  — *stub, ruby to fill*

> Requirements to cover: systemd service+timer shape; pinned source/deps + pinned roller image/helper digest; exact-digest `docker pull reg@sha256` run with no mutable-tag race; **Hub-ONLY restart without startup.sh relaunching legacy watchtower (F3)**; dynamic-D_prev rollback + timeout/failure receipts; **Postgres invariants (roll must not touch ois-postgres-prod / its attached PD)**; install/disable/uninstall + exact prior-stopped-state restoration; legacy-WT retirement + two-roller-prevention flock. Embeds the ROLL v8 roll-engine (515bd02): `recreate_hub`, `verify`, `health_local/health_ext/sha_of`, generalized to D_new/D_prev.

## 9. startup.sh terraform integration + cutover  [RUBY]  — *stub, ruby to fill*

> Requirements (F6): exact startup.sh/terraform bytes wiring the roller .service/.timer (mirroring the codified refresh-docker-token.timer pattern); watchtower-stop→roller-cutover; the watchtower container is stopped + its unit removed (decommissioned); idempotent + fail-loud.

---

## 2. Poll / detect loop  [GREG]

- **Run model:** systemd timer (`OnBootSec` + `OnUnitActiveSec`, reviewed cadence — proposed 5 min, matching watchtower's prior `--interval 300`), one-shot service per tick. No long-lived daemon.
- **Exclusive lock (F6 two-roller-prevention + causality):** acquire `flock -n` on `/run/hub-roller.lock` at tick start; if held, **exit no-op** (another tick/instance owns it). The held flock is also the exclusive-service-lock causality evidence (§4).
- **Detect (candidate) — GCLOUD-FREE (COS has NO gcloud):** resolve `:latest`'s current digest via the docker gcr-helper creds, never gcloud — candidate methods, the sandbox (§5) proving WHICH works on COS (a load-bearing unknown): (i) `docker manifest inspect <REGISTRY>/hub:latest` → the manifest digest; (ii) a registry v2 `HEAD /v2/<repo>/manifests/latest` with a bearer token minted by `docker-credential-gcr` (correct challenge handling — the exact auth watchtower's parser botches → `Docker-Content-Digest`); (iii) `docker pull <REGISTRY>/hub:latest` (idempotent, no-op if current) then read its RepoDigest. Canonical `reg@sha256:<64hex>` (validate the regex).
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
- **INDEPENDENT no-manual-assist (interval):** (a) GCP IAP/SSH audit-log **absence** of any human session on ois-hub-prod during the roll window; (b) the exclusive roller **flock** held throughout (no concurrent manual roll).

## 5. Sandbox-parity environment  [GREG]

Mirror the prod-relevant surface to validate the roller BEFORE any prod deploy (autonomous authority → a throwaway GCE VM or a throwaway container-host, NEVER prod):
- **Parity (must match):** `docker-credential-gcr` → **metadata → SA → AR reader** (the exact prod auth path — the load-bearing unknown to prove: does the gcr-helper AR pull-by-digest AND the gcloud-free **detect** (§2 (i)/(ii)/(iii)) work end-to-end on COS); a throwaway AR repo/tag; the **Hub-ONLY launcher** (`hub-launch.sh` — recreates ONLY ois-hub-prod from the startup.sh:107-119 shared snippet, ruby §1 — NOT the full startup runner); the flock; the systemd timer/service; a stand-in "hub" container exposing `/health` reporting a build-info gitSha; stand-in postgres + watchtower containers to prove non-interference.
- **Documented non-parity:** the real hub image + real postgres are stand-ins — but a stand-in PG container asserts the roll does **not touch PG** (validates ruby's PG-invariant, §1).
- **Digest source note:** `fully_qualified_digest` is confirmed for gcloud 512; the sandbox re-confirms on its client.

## 6. Positive / negative / MUTATION tests  [GREG]

- **POSITIVE:** `:latest` → new valid `D_ci` ⇒ detect → validate → roll → `/health` = D_ci gitSha + running == D_ci ⇒ full causality manifest. PASS.
- **NEGATIVE no-op:** `:latest` == running ⇒ no roll, no churn. PASS.
- **NEGATIVE bad candidate:** `:latest` → image with missing/invalid build-info ⇒ provenance REFUSES ⇒ stays on D_manual. PASS (fail-closed).
- **NEGATIVE health-miss → rollback:** roll to D_ci, `/health` never reports D_ci gitSha in the bounded window ⇒ **rollback to dynamic D_prev** ⇒ `/health` back to D_prev ⇒ rollback receipt. PASS (fail-closed).
- **MUTATION-proof (steve's bar, the v8 8/8 pattern):** delete/neuter each guard ⇒ a specific test goes RED — remove provenance ⇒ bad-candidate rolls (caught); remove flock ⇒ two-roller test detonates; remove health-check ⇒ health-miss doesn't roll back; remove D_prev capture ⇒ rollback targets wrong/empty; remove membership ⇒ index-0 false-match. Each mutation → one RED test.
- **TWO-ROLLER:** two ticks race ⇒ flock ⇒ exactly one rolls, the other no-ops.
- **HUB-ONLY recreate:** the Hub-launcher recreates ONLY ois-hub-prod ⇒ the stand-in postgres + watchtower containers are **untouched** (same container ID/StartedAt across the roll). PASS (F3/PG-invariant).
- **NO-WT-RELAUNCH (F3):** with legacy watchtower removed, re-run startup.sh **AND** reboot the sandbox VM ⇒ watchtower is **NOT** relaunched (the roller owns auto-roll). PASS.
- **GCLOUD-FREE detect:** the §2 detect resolves `:latest`→digest with NO gcloud on the COS-parity host (proves the chosen method (i)/(ii)/(iii) works). PASS.

## 7. Live-canary plan  [GREG]

Before roller-deploy flips to active auto-roll: **detect-only canary** first — deploy the roller in dry-run (poll + detect + validate + LOG the candidate, **do not roll**) → confirm detect + gcr-helper auth + provenance work in prod without a prod roll. Then the first controlled roll under lily's supervision (rollback-ready). Canary evidence = detect-only logs + the first roll's causality manifest.

## 8. Secret-exclusion tests  [GREG]

- No static token anywhere (gcr-helper mints per-pull from metadata — never a config.json token file, unlike the retired bug-107 refresh.sh).
- Grep the roller script + roll manifest + journal/logs + sandbox artifacts for token/key/credential patterns ⇒ MUST be empty. The receipt carries only digests/gitSha/timestamps/container-IDs — no secrets.

## F-item mapping (to complete with ruby/steve against the gate-fail F-list)

F2 REPLACEMENT → §0; F3 Hub-only-restart-no-WT-relaunch → §1 (ruby); F4 fix-review verifier node → this doc + sandbox = steve's `bug308_review`; F6 startup.sh cutover + flock → §9/§2 (ruby+greg). Remaining F-items (steve's ~12) mapped on ruby's architecture pass + steve's review.
