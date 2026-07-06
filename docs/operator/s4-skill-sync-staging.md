# S4 — mission-kit → claude/ois Skill-Sync (STAGED; Director activation recipe)

**Arc:** Stint Arc-1 · **Slice:** S4 · **idea:** idea-453 · **Status:** BUILT + STAGED, not activated.

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
2. Shallow-clones `apnex/mission-kit` (override: `SKILL_SYNC_REPO` / `SKILL_SYNC_REF`) — **read-only**.
3. Resolves `bundles:` (→ `bundles/<name>.yaml` `skills:` lists) + `extra_skills:`, dedups.
4. Copies each `skills/<name>/` (with `SKILL.md`) into `$CLAUDE_CONFIG_DIR/skills/<name>/` — **per-skill merge, never a wipe**, so the local-repo skills survive.
5. **Best-effort**: any failure (no git, clone fails, missing skill) logs and returns 0 — it can **never** block `ois up`.

Currently declared (`extra_skills`): `survey`, `substrate-audit` (K3), `research-artefacts` (K4), `arc-lifecycle` (K6). Verified end-to-end against a local mission-kit clone: 4/4 synced with `SKILL.md`, local skill preserved.

---

## Director activation recipe (~5 min)

1. **(program-design, optional-but-intended) Promote the operator manuals into mission-kit.** The sync only deploys skills that exist in `mission-kit/skills/<name>/SKILL.md`. To reach the full operator-manual class:
   - Promote **`O1-convene-council`** into `mission-kit/skills/o1-convene-council/SKILL.md` (it is a ratified design, **not yet promoted** — until then the sync cannot carry it; this is not a blocker on the mechanism).
   - Promote the flat rule-cards **K1** (`ai-attribution-scrub`) / **K2** (`force-push-carve-out`) into `SKILL.md`-directory form if you want them as active skills (they are currently flat `.md` catalog cards).
   - Optionally define a `mission-kit/bundles/operator-manuals.yaml` (`skills:` = the operator set) and switch the manifest to `bundles: [operator-manuals]` for hermes-uniform grouping.
   - Then add the promoted names to `ois/manifests/skill-sync/wanted-bundles.yaml`.
2. **Deploy** the new ois + manifest: `./ois/deploy.sh` (ships `bin/ois` → `~/.config/apnex-agents/bin/ois` **and** the manifest → `~/.config/apnex-agents/manifests/skill-sync/`). Verify with `./ois/deploy.sh --diff` first.
3. **Restart a claude harness**: `ois down <agent> claude && ois up <agent> claude`. On up, `claude_seed` runs `mission_kit_sync` and the skills land in `~/.config/apnex-agents/<agent>.claude/skills/`.

**Verify (post-up):** `ls ~/.config/apnex-agents/<agent>.claude/skills/` shows the synced skills alongside the local ones; the `ois up` log shows `seeding : mission-kit skill-sync → … (N synced, …)`.

**Rollback:** `deploy.sh` backs up the prior `bin/ois`; remove the manifest (or empty `extra_skills`) and re-up to stop syncing. The sync only ever *adds* skill dirs (per-skill merge), so removing the manifest + deleting the synced dirs fully reverts.

---

## Dogfood target (closes the loop)

Once `O1-convene-council` is promoted + synced and a harness is re-upped: `O1-convene-council` becomes reachable by claude agents → pick up the first operator-manual "hand" → **convene a council via O1**. That closes the mechanization loop the operator-manual program is for ("operator manuals = the hands").
