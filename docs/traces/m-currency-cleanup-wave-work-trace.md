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
- W1 PR opened (#251). CI 9/9 green.
- Architect review (thread-613 r7): one fix — `modules/hub/cloudrun.tf:11` carried a comment ref to the deleted `deploy/cloudrun/`. My grep was scoped to `.sh/.yml/.ts/.json/.md` and missed `.tf`. Dropped the stale parenthetical; repo-wide `.tf` grep confirms no other refs. Pushed to #251.
- **W1 merged** — PR #251 squash-merged to `main` as `11c767d`; CI 9/9 green; thread-613 converged.

## W2 · idea-309 — docs-currency pass over LIVE reference docs

**Branch:** `agent-greg/mission-87-w2-docs-currency` (off `origin/main @ 11c767d`)
**Coordination:** thread-614. W2 excludes `deploy/README.md` (W1 owned it). Anti-goal: archival record (audits/decisions/designs/history/traces/surveys/existing reviews) untouched — sole `docs/reviews/` addition is the architect-authored Phase-4 record.

### Targets + dispositions (surveyed; surfaced to architect thread-614 r2)
- `ARCHITECTURE.md` — rewrite-to-current (clear-cut; proceeding).
- 3 comment-refs (`hub/src/policy/agent-projection.ts`, `packages/storage-provider`, `.gitignore`) — clear fixes.
- `docs/architect-engineer-collaboration.md` — recommend **delete** (mostly-dead; conflicts with the methodology canon).
- `docs/runbooks/m-local-fs-cutover-drills.md` — recommend **delete** (drills the retired GCS↔local-fs cutover; `state-sync.sh` gone).
- `docs/onboarding/multi-env-operator-setup.md` — recommend **delete** (its `deploy/base`/`deploy/cloudrun`/`new-environment-bootstrap.sh` spine is all gone).
- `docs/sdk-guide.md` — **rewrite** (salvageable core: network-adapter + entities/policy; storage→substrate; drop §5 vertex-cloudrun + §6 architect-chat).
- `packages/repo-event-bridge/docs/webhook-source-design.md` — leave (point-in-time design doc).
- `docs/reviews/2026-05-22-phase-4-scoped.md` — architect-authored artefact; engineer `git add`s the provided content.

### Session log

### 2026-05-22 PM AEST — W2 picked up; dispositions surfaced

- thread-614: architect dispatched W2 (idea-309). Worktree synced to `11c767d`; W2 branch cut.
- Delegated a staleness assessment of the 4 judgment-call docs; surveyed `ARCHITECTURE.md` directly.
- Surfaced the disposition set on thread-614 (delete×3 + rewrite sdk-guide) as `decision_needed` — holding execution pending architect ratification.

### 2026-05-22 PM AEST — W2 executed (most); sdk-guide form-fork surfaced

- Architect ratified all dispositions (thread-614 r3); filed idea-310 for the fresh-environment runbook gap; provided the Phase-4 review artefact content.
- Executed: 3 deletes; `ARCHITECTURE.md` full currency rewrite; `.gitignore` + `contract.ts` comment-refs (the other 2 idea-309-flagged refs needed no change on inspection); inbound links repointed (HANDOVER ×2 + threads-2.md → methodology docs); Phase-4 artefact placed at `docs/reviews/2026-05-22-phase-4-scoped.md`.
- `sdk-guide.md`: read all 497 lines — the "rewrite" is a form-fork (exhaustive export tables + dated naming-verdicts are why it rots). Surfaced (a) faithful-table-rewrite vs (b) leaner module-concern map; recommended (b). Holding sdk-guide + the W2 PR pending the ruling.

### 2026-05-22 PM AEST — W2 (b) ratified; sdk-guide done; PR opened

- Architect ratified (b) — lean module-concern map; drop the export tables + dated naming-verdict content.
- `docs/sdk-guide.md` rewritten as a module-concern map (497 → ~150 lines): per-module *concern* + source pointer, no export tables, no naming-verdicts. Current package/module layout surveyed for accuracy.
- W2 PR opened. Net ≈ −1374 lines across the slice.
