# mission-87 — M-Currency-Cleanup-Wave — work-trace

**Mission:** mission-87 (M-Currency-Cleanup-Wave) — Director-approved 2026-05-22 (Strategic Review Phase-4)
**Engineer:** greg
**Coordination:** thread-613 (W1 · idea-308); W2/W3 in their own threads
**Class:** substrate-cleanup-wave · compressed lifecycle (Survey waived, no separate Design — execute from source idea specs)

## Mission shape

Three surface-independent slices, each its own cross-approved CI-green PR:
- **W1 · idea-308** — remove legacy `deploy/base` + `deploy/cloudrun` terraform.
- **W2 · idea-309** — docs-currency pass over LIVE reference docs.
- **W3 · idea-302** — complete the mission-62 `engineerId→agentId` rename for the Task entity (hub-code; heaviest; sequenced last).

W1 + W2 order-independent; W3 last.

---

## W1 · idea-308 — remove legacy deploy/base + deploy/cloudrun terraform

**Branch:** `agent-greg/mission-87-w1-deploy-cleanup` (off `origin/main @ d3fb442`)
**Config-target ruling:** Option B ratified (architect, thread-613 r3) — config moves to `~/.config/apnex-agents/hub.env`.

### Scope (idea-308 + mission plan)
1. Add a committed config example template (3–4 keys the local scripts need).
2. Trim the dead `deploy/cloudrun/env/` entry from tfvars-discovery in `scripts/local/{start,build}-hub.sh`; fix related comments.
3. Delete `deploy/base/` + `deploy/cloudrun/`.
4. Fold-in: commit `modules/hub/.terraform.lock.hcl` as the Terraform provider-lock (engineer judges single- vs multi-platform `terraform providers lock`).
5. Operator step: operator moves the gitignored real config into the new location — flag to architect, don't block.

### Open question — investigated, surfaced to architect (thread-613) before committing

idea-308 NOTE + architect: *are `scripts/local/{start,build}-hub.sh` still the right local-Hub tooling post-mission-86, and should the config target move to `~/.config/apnex-agents/hub.env` rather than a tfvars file?*

**Finding (a) — scripts are live.** `start-hub.sh` (local-dev Hub container launcher, postgres substrate) + `build-hub.sh` (Cloud Build image builder) are actively maintained (mission-84 W5/W7 refs; May-19 mtime). mission-86 moved the *production* Hub to a GCE VM (`deploy/hub/` + `modules/hub/`); it did not retire the local-dev tooling. Scripts stay.

**Finding (b) — recommend moving config to `hub.env`.** `start-hub.sh` already sources `~/.config/apnex-agents/hub.env` for runtime knobs, and *separately* hand-parses HCL tfvars (`read_tfvar` awk) for `hub_api_token`/`state_bucket_name`/`project_id`; `build-hub.sh` parses `project_id`/`region`. The tfvars HCL format was justified only because the same file fed `deploy/cloudrun/` terraform — which idea-308 deletes. Post-deletion the tfvars file is a bash-only config pretending to be terraform input → exactly the drift this mission targets (tele-2). Moving the 4 keys into `hub.env` consolidates to one config file in the established convention and drops the vestigial HCL parser. Reshapes steps 1–2; surfaced for architect ratification.

**Note:** idea-308 says "3 keys" — misses `region` (read by `build-hub.sh`). Full set is 4: `hub_api_token`, `state_bucket_name`, `project_id`, `region`.

## Session log

### 2026-05-22 PM AEST — mission-87 picked up; W1 open-question investigated

- thread-613: architect issued mission-87 W1 (idea-308). Compressed lifecycle.
- Read idea-308 + idea-302 + idea-309 + mission-87 entity; surveyed `deploy/` tree + `scripts/local/{start,build}-hub.sh`.
- Investigated the idea-308 open question (config-target). Recommendation: move config to `~/.config/apnex-agents/hub.env` (Option B) — surfaced to architect on thread-613; holding W1 implementation pending the ruling (it reshapes steps 1–2).
- Work-trace opened.

### 2026-05-22 PM AEST — W1 Option B ratified; implementation underway

- Architect ratified Option B (thread-613 r3). 4-key set confirmed (`region` added — idea-308's "3 keys" was a spec gap).
- Branch `agent-greg/mission-87-w1-deploy-cleanup` cut off `d3fb442`.
- Implemented: `scripts/local/hub.env.example` (complete template); `start-hub.sh` + `build-hub.sh` cut over from `read_tfvar` HCL parsing to the sourced `hub.env` (both `bash -n` clean); deleted `deploy/base/` + `deploy/cloudrun/` + `deploy/env/`; staged `modules/hub/.terraform.lock.hcl` (committed as-is — `zh:` hashes are platform-independent); `deploy/.gitignore` comment fixed.
- Surfaced a slice-boundary question on thread-613: `deploy/README.md` (394 lines, heavy base/cloudrun content) — the mission framing puts it on W1's `deploy/` surface, but idea-309 lists it for W2. Recommended W1 owns it in full (zero W1/W2 conflict). Holding the PR pending the ruling.
- Operator step surfaced for Director relay: operator moves config values into `~/.config/apnex-agents/hub.env`.

### 2026-05-22 PM AEST — W1 README pass; PR opened

- Architect ratified: W1 owns `deploy/README.md` in full (current, not just de-referenced); W2/idea-309 excludes it. Lock-file commit-as-is accepted.
- `deploy/README.md` rewritten current (394 → ~140 lines): removed dead base/cloudrun + multi-env-layout + apply-order + local-fs-profile + GCS↔local-fs cutover/rollback runbooks + GCS-state-layout + stale Outstanding; preserved the still-accurate Cloud-Build-tarball-staging + repo-event-bridge sections (operator-setup updated to `hub.env`); added a §Configuration section.
- Repo-wide grep: no live scripts/CI reference the deleted dirs. Residual stale refs are in `docs/onboarding/multi-env-operator-setup.md` (W2/idea-309's explicit scope) + archival mission/design docs (anti-goal: untouched). Out-of-scope observation flagged to architect: `docs/runbooks/m-local-fs-cutover-drills.md` is a stale local-fs runbook not covered by idea-308/309.
- W1 PR opened. One cross-approved PR.
