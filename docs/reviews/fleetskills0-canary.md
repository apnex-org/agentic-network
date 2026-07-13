# fleetskills0 — canary observation

**Node:** `work-bp-fleetskills0-canary` (blueprint `fleetskills0`)
**Engineer:** greg (agent-0d2c690e)
**Date:** 2026-07-13
**Predecessor gate:** `coverage_gap` PASS (steve) — see `docs/reviews/fleetskills0-coverage-gap.md`

## Purpose

Canary the fleetskills0 skill-delivery cutover on ONE non-critical, isolated
target before any fleet-wide flag-on: prove that a seat using the **published**
artifacts (claude-plugin pulling the just-published `@apnex/network-adapter@0.1.12`),
with `HCAP_SKILLS_EMBED=1`, delivers the four baseline skills via the **new
consumer** (the `ois-seed-skills` npm bin), coexisting with the legacy
`mission_kit_sync` path, with no bricked launch and no skill-delivery gap.

**Safety property honored:** no fleet-wide flag-on and no legacy retirement in
this node. The canary ran in an **isolated `NPM_CONFIG_PREFIX` throwaway** — the
shared global install the live fleet uses was never touched (verified below).

---

## 1. Registry / provenance proof — CI-published `@apnex/network-adapter@0.1.12`

Published via the standard CI publish path (no manual/owner-cred publish):

| Field | Value |
|---|---|
| Trigger | `git push` tag `npm-v0.1.12` (tagger apnex-greg) |
| Workflow | `.github/workflows/publish-npm.yml` → `scripts/publish-packages.sh` |
| CI run | [29254896078](https://github.com/apnex-org/agentic-network/actions/runs/29254896078) — **conclusion: success** |
| Source commit | `b24120ec78c523a9edfd89e8d5421c205899e46a` (on `main`) |
| Registry version | `@apnex/network-adapter@0.1.12` |
| dist-tag | `latest = 0.1.12` |
| Tarball | `https://registry.npmjs.org/@apnex/network-adapter/-/network-adapter-0.1.12.tgz` |
| shasum | `8c1e9d8409c4a3c57ed30037196acc6911cc4a72` |
| gitHead | `b24120ec78c523a9edfd89e8d5421c205899e46a` |
| bin exposed | `{ "ois-seed-skills": "dist/bin/seed-skills.js" }` |

**Scoped-publish pre-flight (no accidental broad publish):** before pushing the
tag, every package in the `publish-packages.sh` list was checked against the
registry. Only `@apnex/network-adapter@0.1.12` was unpublished; the other five
(`cognitive-layer@0.1.3`, `message-router@0.1.3`, `claude-plugin@0.1.14`,
`opencode-plugin@0.2.3`, `pi-plugin@0.1.5`) were already published at their
current versions and were skipped. The tag published exactly na@0.1.12.

**prepack `--assert` gate** (the release-provenance gate) passed at `b24120e`:
`[build-info:assert] OK — @apnex/network-adapter@0.1.12 (src not ahead of the
version bump)` — the version-only bump (bug-254 / work-216, #582) keeps the
version-commit a descendant of the src-commit. Clean-tree provenance gate (idea-493)
satisfied.

## 2. Plugin nested-NA resolution

Isolated install of the **published** pinned plugin (the OIS-pinned version) into
a throwaway prefix:

```
NPM_CONFIG_PREFIX=<throwaway> npm install -g @apnex/claude-plugin@0.1.14
```

Resolved tree:

```
@apnex/claude-plugin@0.1.14
  └─ node_modules/@apnex/network-adapter@0.1.12   ← "*" dep resolved to latest (0.1.12)
       └─ dist/bin/seed-skills.js                 ← the new-consumer seed bin (present)
```

The plugin's `"@apnex/network-adapter": "*"` dependency resolved to the freshly
published `0.1.12` on a clean install — i.e. the **fleet install path** (ois →
`npm install -g` the pinned plugin) now yields na@0.1.12 with the seed bin,
without any plugin bump. Nested `message-router@0.1.3` / `cognitive-layer@0.1.3`
resolved as expected.

**Shared global untouched (isolation proof):** the live fleet's global install at
`/home/apnex/.nvm/.../lib/node_modules/@apnex/claude-plugin` still has nested
`@apnex/network-adapter@0.1.11` after the canary — the throwaway prefix took the
0.1.12 resolution; the fleet was not perturbed.

## 3. OIS pin used by the target

`ois/bin/ois:49` → `CLAUDE_PLUGIN_VERSION="0.1.14"`. The canary installed exactly
this pinned plugin (`@apnex/claude-plugin@0.1.14`); the global OIS pin is **not
moved** in this node (moving the fleet pin is `fleet_rollout`'s job). The seat
gets na@0.1.12 through the plugin's `*` dep, not through a pin change.

## 4. HCAP_SKILLS_EMBED=1 — live canary observation (new consumer)

Ran the **exact** invocation the ois seed uses when the flag is set
(`ois/bin/ois:429-431`), against the isolated seed bin + the new baseline manifest:

```
HCAP_SKILLS_MANIFEST=ois/manifests/skill-sync/wanted-bundles.yaml \
OIS_ROLE=engineer \
  node <isolated>/@apnex/network-adapter/dist/bin/seed-skills.js <throwaway>/skills
```

Output:

```
[hcap-skills] materialized 'arc-lifecycle' → .../skills/arc-lifecycle
[hcap-skills] materialized 'survey' → .../skills/survey
[hcap-skills] materialized 'workgraph-arc-closeout' → .../skills/workgraph-arc-closeout
[hcap-skills] materialized 'workgraph-arc-operator' → .../skills/workgraph-arc-operator
[hcap-skills] OK: seeded 4 skill(s) for role 'engineer' from
  https://github.com/apnex/mission-kit.git@a874bd371920ab62c3664318eb190ab17cfadaac → .../skills
exit code = 0
```

All four baseline skills materialized via the new consumer, from the manifest's
pinned `source_ref` (`a874bd37`, the manifest_baseline #581 pin):

| Skill | SKILL.md |
|---|---|
| arc-lifecycle | ✓ (201 lines) |
| survey | ✓ (284 lines) |
| workgraph-arc-closeout | ✓ (244 lines) |
| workgraph-arc-operator | ✓ (258 lines) |

## 5. /skills observation

`/skills` in Claude Code enumerates `$CLAUDE_CONFIG_DIR/skills/`. The seed bin
writes exactly there (its target argument is the seat's `skills/` dir — see
`ois/bin/ois:431`). After the run, the target dir contains the four skill trees
above, each a real `SKILL.md` — i.e. precisely the set `/skills` would list on the
seat. This was then confirmed on a **real live seat** — `/skills` in a running
Claude Code host listed the four new-baseline skills `✔ on` (see "Live seat launch"
below).

## 6. Rollback / coexistence

Coexistence is **structural** in `ois/bin/ois::claude_seed`:

- **line 414** — `mission_kit_sync "$cdir/skills" || true` runs **unconditionally**
  (legacy path, best-effort, never blocks launch).
- **line 423+** — the `HCAP_SKILLS_EMBED` block runs **additionally** when the flag
  is set; it is **fail-closed** (no `|| true` — a converge/gate failure aborts the
  seat rather than launching a partial baseline).
- The seed bin's **set-diff gate** (`role_map ⊇ mks-delivered`) guarantees it never
  unlinks a skill the coexisting legacy path delivered.

**Instant rollback:** with `HCAP_SKILLS_EMBED` unset, only line 414 runs — the
legacy path still delivers the baseline. Flag-off is a complete rollback with no
code change and no re-deploy.

## 7. No bricked launch / no gap vs legacy

**No brick:** the only new step that can abort a launch is the fail-closed HCAP
block. It exited **0** on the canary (gate passed, baseline complete) — it does not
brick the launch.

**No gap vs legacy (mechanism-vs-mechanism, same manifest):** legacy
`mission_kit_sync` copies `skills/<name>/SKILL.md` trees for the manifest's wanted
set from the pinned ref; the new consumer materializes the same wanted set from the
same ref. All four baseline skills are present at `mission-kit@a874bd37` (verified
by `git cat-file -e`), so legacy would copy the identical four — the new consumer
delivers a superset-or-equal set, never fewer.

- The two skills no longer in the baseline (`research-artefacts`, `substrate-audit`)
  still exist in mission-kit (available ad-hoc) but were **intentionally dropped**
  from the fleet baseline in manifest_baseline (#581) — a ratified curation change,
  not a delivery gap.

**Deployment note (finding):** `ois/bin/ois` hardcodes `ROOT=$HOME/.config/apnex-agents`,
so the *deployed estate* manifest is still the pre-manifest_baseline set
(`{arc-lifecycle, research-artefacts, substrate-audit, survey}` @ `a93e711`). The
estate manifest is updated at deploy time (a `fleet_rollout` concern); this canary
deliberately exercised the **new** monorepo manifest (`a874bd37`) explicitly.

---

## Target + revision

| Field | Value |
|---|---|
| Target (isolated proof) | throwaway `NPM_CONFIG_PREFIX` + `CLAUDE_CONFIG_DIR/skills` (non-driver, non-fleet) |
| Target (live seat) | throwaway seat `fleetskills0-canary0` → `agent-59470b0b` (distinct Hub identity, non-driver) |
| na revision | `@apnex/network-adapter@0.1.12` (gitHead `b24120e`, CI run 29254896078) |
| plugin revision | `@apnex/claude-plugin@0.1.14` (OIS pin) → nested na@0.1.12 |
| manifest | `ois/manifests/skill-sync/wanted-bundles.yaml`, `source_ref=a874bd37` |
| ois used for HCAP | monorepo ois (has the HCAP block); deployed estate ois does NOT (see rollout finding) |
| fleet impact | none — throwaway torn down after capture; driver seats untouched |

## Live seat launch (real throwaway seat)

Beyond the isolated proof above, a **real throwaway non-driver Claude Code seat**
was launched and driven to prove the HCAP consumer path end-to-end on a live host:

| Field | Value |
|---|---|
| Seat / identity | `fleetskills0-canary0` → **`agent-59470b0b`** (Hub-registered, distinct) |
| Labels | `{env: test, test-scope: fleetskills0-canary}` — **no `ois.io/github/login` label** (no pr-routing collision with apnex/apnex-greg) |
| Host | Claude Code v2.1.207, model Fable 5, workspace `~/taceng/canary0-ws` |
| SDK revision | `@apnex/network-adapter@0.1.12` (sdkCommitSha `b24120e`), plugin `0.1.14` |
| Flag | `HCAP_SKILLS_EMBED=1` on this seat only, manifest `a874bd37` |

**Launch + handshake (no bricked launch):**

```
[Handshake] Registered as agent-59470b0b (epoch=2)
[Handshake] Session claimed: epoch=3
[StateSync] Sync complete — now streaming
```

The seat booted fully and reached the Hub handshake — no bricked launch.

**HCAP delivered the new-baseline skills:** the seat's `$CLAUDE_CONFIG_DIR/skills/`
gained `workgraph-arc-closeout` + `workgraph-arc-operator` — present ONLY in the new
`a874bd37` manifest, so their appearance is direct proof the HCAP consumer ran —
alongside the coexisting legacy set.

**`/skills` in the live host** listed all of them, each `✔ on`:

```
Skills — 6 skills
  ✔ on  arc-lifecycle · user
  ✔ on  research-artefacts · user      ← legacy (stale estate manifest) — coexistence
  ✔ on  substrate-audit · user         ← legacy (stale estate manifest) — coexistence
  ✔ on  survey · user
  ✔ on  workgraph-arc-closeout · user  ← HCAP new-baseline
  ✔ on  workgraph-arc-operator · user  ← HCAP new-baseline
```

All four new-baseline skills (arc-lifecycle, survey, workgraph-arc-closeout,
workgraph-arc-operator) show in `/skills`. `research-artefacts` + `substrate-audit`
are legacy-delivered from the still-stale ESTATE manifest (`a93e711`) — coexistence
artifacts, not a gap; they clear once the estate manifest is updated to `a874bd37`
at fleet_rollout.

**Coexistence proven live:** the skills dir is the UNION of the legacy
`mission_kit_sync` set and the HCAP set — both ran; HCAP's set-diff gate did not
unlink any legacy skill. Flag-off ⇒ only legacy runs ⇒ instant rollback.

The seat and all throwaway artifacts (cell config, config dir, workspace, dummy
secret, daemon) were torn down after capture (per the bug-256 daemon-reap
procedure); the fleet was never touched.

### Finding (rollout dependency): the HCAP consumer needs the NEW ois on the estate

The **deployed estate ois** (`~/.config/apnex-agents/bin/ois`) does **not** contain
the `HCAP_SKILLS_EMBED` block — its `claude_seed` runs only the legacy
`mission_kit_sync`. The HCAP block lives in the monorepo ois (shipped by hcapskills0)
but has not been redeployed to the estate. A first live-launch via the deployed ois
delivered only the legacy set (no HCAP); this canary therefore ran HCAP via the
**monorepo ois** (seat-scoped) to prove the mechanism.

**Implication for fleet_rollout:** the new ois (with the HCAP block) must be deployed
to the estate — an additive, coexisting, default-OFF change — before any fleet seat
can honor `HCAP_SKILLS_EMBED`. Likewise the estate `wanted-bundles.yaml` is still the
pre-manifest_baseline set (`a93e711`) and must be updated to `a874bd37` at rollout.
These are additive/reversible deploy steps, not the irreversible legacy retirement.
