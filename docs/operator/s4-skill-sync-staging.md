# S4 — mission-kit → claude/ois Skill-Sync (STAGED; Director activation recipe)

> ⚠️ **RETIRED (fleetskills0 / idea-505, 2026-07-14).** The legacy `mission_kit_sync` path and the `ois skill-sync-preview` command documented below have been **removed** from `ois/bin/ois`. Skills are now delivered fleet-wide by the **HCAP skills-consumer** (`claude_seed`), which is the SOLE skill-delivery path — it reads this same `wanted-bundles.yaml` manifest and materializes the role baseline unconditionally on every `ois up <agent> claude`. This document is retained as a point-in-time record of the retired S4 procedure; the commands below (`ois skill-sync-preview`, the `mission_kit_sync` internals) no longer exist.

**Arc:** Stint Arc-1 · **Slice:** S4 · **idea:** idea-453 · **Status:** BUILT + STAGED, not activated. **(RETIRED — see banner above.)**

This wires the deployment last-mile so ratified **mission-kit** skills become reachable by **claude/ois** agents. It is **staged**: the code + manifest are committed, but nothing runs until the Director deploys and restarts a harness. Activation touches the live harness and is the Director's switch (per the standing harness boundary).

---

## The gap this closes (idea-453 audit)

hermes agents get mission-kit skills bundle-driven (`wanted-bundles.yaml` → `skill-sync` initContainer → `/opt/data/extra-skills`). The **claude/ois** path had **no** mission-kit→claude sync: `ois up` only ever seeded the local-repo `skills/` (just `survey`). So ratifying a skill into mission-kit did **not** make it reachable by the claude agents meant to use it. This adds the sync.

> **Ground-truth correction to the runbook:** the audit named `claude-plugin/lib/bootstrap-skills.sh` as the hook. It isn't on the `ois up` path (its only caller is `claude-plugin/install.sh`, which runs at manual stage/deploy, never on launch), and it *skips* any skill lacking an `install.sh` (line 166) — which every bare-`SKILL.md` mission-kit skill does. The correct hook is **`claude_seed()` in `ois/bin/ois`**, which runs on every `ois up <agent> claude`. Architect-confirmed.

---

## What was built (all in `agentic-network`, zero mission-kit change)

| File | Change |
|------|--------|
| `ois/bin/ois` | `mission_kit_sync()` + `_mk_yaml_list()` helpers; called from `claude_seed()` after the plugin-install step |
| `ois/manifests/skill-sync/wanted-bundles.yaml` | the claude-path manifest (mirrors `hermes/manifests/skill-sync`): `bundles` + `extra_skills` |
| `ois/deploy.sh` | also ships the manifest to `~/.config/apnex-agents/manifests/skill-sync/` alongside `bin/ois` |

**How the sync behaves** (`mission_kit_sync "$CLAUDE_CONFIG_DIR/skills"`):
1. Reads `$ROOT/manifests/skill-sync/wanted-bundles.yaml` (absent → no-op).
2. Shallow-clones `apnex/mission-kit` and checks out the manifest's **pinned `source_ref` SHA** — so activation pulls the *reviewed* mission-kit state, not whatever `main` is at activation time. **Read-only.** Overrides: `SKILL_SYNC_REPO`/`SKILL_SYNC_REF` (testing only). The sync **logs the exact resolved SHA** (`… sha=<40-hex>`) so the `ois up` log records precisely what was deployed. **FAIL-CLOSED on the pin:** if `source_ref` can't be resolved (typo / unavailable SHA / fetch-by-sha unsupported), the sync copies **nothing** and returns 0 — it never silently falls back to default-branch content (that would defeat the pin). Verified: a bad `source_ref` leaves the target empty and `ois skill-sync-preview` reports `(none)`.
3. Resolves `bundles:` (→ `bundles/<name>.yaml` `skills:` lists) + `extra_skills:`, dedups.
4. Copies each `skills/<name>/` (with `SKILL.md`) into `$CLAUDE_CONFIG_DIR/skills/<name>/` — **per-skill merge, never a wipe**, so the local-repo skills survive.
5. **Best-effort, hard guarantee it never blocks `ois up`**: every failure path — no manifest, no git, clone/pin-resolve failure, missing skill, **and the write-side `mkdir`/`rm`/`cp`** (unwritable/locked target) — logs and continues/returns 0; the call site is additionally `|| true`. Verified: a non-writable target returns 0 under `set -e` (does not abort launch).

Currently declared (`extra_skills`): `survey`, `substrate-audit` (K3), `research-artefacts` (K4), `arc-lifecycle` (K6). **Pinned `source_ref`:** `a93e711…` (mission-kit `main` HEAD at staging). Verified end-to-end against a local mission-kit clone: 4/4 synced with `SKILL.md` at the pinned SHA, local skill preserved, negative-path (unwritable target) non-aborting.

---

## Director activation recipe (pin → preview → diff → activate; ~5 min)

1. **(program-design, optional-but-intended) Promote the operator manuals into mission-kit + bump the pin.** The sync only deploys skills that exist in `mission-kit/skills/<name>/SKILL.md` **at the pinned `source_ref` SHA**. To reach the full operator-manual class:
   - Promote **`O1-convene-council`** into `mission-kit/skills/o1-convene-council/SKILL.md` (ratified design, **not yet promoted** — until then the sync cannot carry it; not a blocker on the mechanism).
   - Promote the flat rule-cards **K1** (`ai-attribution-scrub`) / **K2** (`force-push-carve-out`) into `SKILL.md`-directory form to make them active skills.
   - Optionally define `mission-kit/bundles/operator-manuals.yaml` (`skills:` = the operator set) and switch the manifest to `bundles: [operator-manuals]` for hermes-uniform grouping.
   - Add the promoted names to `ois/manifests/skill-sync/wanted-bundles.yaml`, and **bump `source_ref` to the reviewed mission-kit SHA** (this is the reviewable diff — activation is reproducible against exactly that commit).
2. **PREVIEW (dry-run — no live skills touched):** `ois skill-sync-preview`. Syncs the pinned source into a throwaway temp dir and prints exactly which skills would land + the resolved `sha=<40-hex>`. Review that the set + SHA are what you intend **before** touching any harness.
3. **PREFLIGHT DIFF:** `./ois/deploy.sh --diff` — shows the `bin/ois` **and** skill-sync-manifest (incl. pinned `source_ref`) deltas between the live and canonical copies. Nothing changes.
4. **DEPLOY:** `./ois/deploy.sh` — ships `bin/ois` → `~/.config/apnex-agents/bin/ois` **and** the manifest → `~/.config/apnex-agents/manifests/skill-sync/` (backs up the prior `bin/ois`).
5. **ACTIVATE:** `ois down <agent> claude && ois up <agent> claude`. On up, `claude_seed` runs `mission_kit_sync`; the skills land in `~/.config/apnex-agents/<agent>.claude/skills/`.

**Verify (post-up):** `ls ~/.config/apnex-agents/<agent>.claude/skills/` shows the synced skills alongside the local ones; the `ois up` log shows `seeding : mission-kit skill-sync → … (N synced, …) from …@<ref> sha=<40-hex>` — the exact commit deployed.

**Launch-safety guarantee:** the sync is best-effort and can **never** block `ois up` — every failure (no manifest / no git / clone or pin-resolve failure / missing skill / **unwritable target `mkdir`/`rm`/`cp`**) logs and skips; the call site is `|| true`. Verified: a non-writable target returns 0 under `set -e`.

**Rollback:** `deploy.sh` backs up the prior `bin/ois`; empty `extra_skills` (or remove the manifest) and re-up to stop syncing. The sync only ever *adds* skill dirs (per-skill merge), so removing the manifest + deleting the synced dirs fully reverts.

---

## Dogfood target (closes the loop)

Once `O1-convene-council` is promoted + synced and a harness is re-upped: `O1-convene-council` becomes reachable by claude agents → pick up the first operator-manual "hand" → **convene a council via O1**. That closes the mechanization loop the operator-manual program is for ("operator manuals = the hands").
