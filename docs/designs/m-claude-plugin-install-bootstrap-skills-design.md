# M-Claude-Plugin-Install-Bootstrap-Skills — Design v0.1

**Status:** v0.1 DRAFT (architect-authored 2026-05-02; pending engineer round-1 audit per Director-direct routing 2026-05-02 "a — design with greg")
**Methodology:** Phase 4 Design per `mission-lifecycle.md` v1.2 §1 (RACI: C=Director / R=Architect+Engineer)
**Survey envelope:** `docs/surveys/m-claude-plugin-install-bootstrap-skills-survey.md` v1.0 (Director-ratified 6 picks; commit `b6f3c5b`)
**Source idea:** idea-230 (status `triaged` via route-(a) skip-direct; will flip `incorporated` at mission-create)
**Companion:** idea-229 umbrella (parked architectural anchor; this mission = 1st-canonical consumer-install layer instance) + idea-228 / mission-69 (precondition; `/skills/survey/` v1.1 lives there)
**Branch:** `agent-lily/m-claude-plugin-install-bootstrap-skills` (Survey + Design + retrofit + claude-plugin extension cumulative; mission-68 M6 fold pattern)

---

## §0 Document orientation

Substrate-introduction mission: consumer-install plumbing for the sovereign-Skill pattern. Fourth-canonical compressed-lifecycle execution OR fully-bilateral substrate-introduction (Director-direct routing chose bilateral). 2nd-canonical sovereign-Skill instance after mission-69 (1st-canonical was the Survey Skill itself; this is the install-layer for that pattern).

Reading order:
- §1 Mission scope summary (Survey envelope §3 + §4 reference)
- §2 Architecture overview (3-mechanism composition)
- §3 Component designs:
  - §3.1 claude-plugin install.sh extension (orchestrator)
  - §3.2 `.skill-permissions.json` schema (architect-flag F1 CRITICAL)
  - §3.3 Per-skill install.sh contract (`--silent` flag addition)
  - §3.4 settings.local.json merge logic (F2 MEDIUM)
  - §3.5 Source-tree vs npm-installed detection (reuse existing per AG-3)
- §4 `skills/survey/` retrofit (per AG-5)
- §5 Edge cases + failure modes (F3 + F4)
- §6 Test / verification strategy
- §7 PR sequencing + content map
- §8 Anti-goals (carry from envelope §5)
- §9 Architect-flags for round-1 audit (carry from envelope §6)
- §10 Cross-references

---

## §1 Mission scope summary

Per Survey envelope §3 composite intent envelope (unchanged from v0.1):

| Axis | Bound |
|---|---|
| Mission scope | claude-plugin install.sh extension + `.skill-permissions.json` schema + skills/survey/ retrofit |
| Mission class | substrate-introduction (consumer-install plumbing for sovereign-Skill pattern) |
| Tele alignment (primary) | tele-3 (Sovereign Composition); tele-2 (Isomorphic Specification) |
| Tele alignment (secondary) | tele-7 (Resilient Agentic Operations); tele-12 (Precision Context Engineering) |
| Director picks (load-bearing) | Q1=d composite / Q2=a consumer-only / Q3=d hybrid cadence / Q4=d hybrid mechanism / Q5=c skill-shipped fragment / Q6=b compose orchestration |

---

## §2 Architecture overview

Three composable mechanisms, one bootstrap pass:

```
┌──────────────────────────────────────────────────────────────────────┐
│ adapters/claude-plugin/install.sh (existing; extended)               │
│                                                                      │
│   1. Detect context (source-tree vs npm-installed) ── reused as-is   │
│   2. NEW: bootstrap_skills() orchestrator                            │
│      ├── enumerate /skills/<name>/ (or bundled skills in npm mode)   │
│      ├── for each skill:                                             │
│      │     bash <skill>/install.sh --target=repo --silent            │
│      │     (per-skill install.sh handles symlink / vendored-tarball  │
│      │      via auto-detect; per-skill setup hooks)                  │
│      ├── collect <skill>/.skill-permissions.json fragments           │
│      └── merge fragments → .claude/settings.local.json permissions   │
│   3. Print summary (installed / skipped / failed)                    │
└──────────────────────────────────────────────────────────────────────┘
        │                                    │
        ▼                                    ▼
┌────────────────────────┐          ┌────────────────────────────────┐
│ skills/<name>/         │          │ .claude/                       │
│   install.sh           │ symlink  │   skills/<name>/  ──────►      │
│   .skill-permissions.  │ creates  │     (sovereign source via      │
│     json               │          │      symlink in source-tree;   │
│   SKILL.md             │          │      vendored-tarball in npm)  │
│   scripts/             │          │   settings.local.json          │
│   ...                  │          │     ← merged permissions       │
└────────────────────────┘          └────────────────────────────────┘
```

**Three mechanisms compose:**
1. **Per-skill install.sh** (existing pattern; extended with `--silent` flag) handles its own symlink + skill-specific setup. Sovereign per-skill autonomy.
2. **`.skill-permissions.json`** (NEW; schema §3.2) declares each skill's permission fragments declaratively.
3. **claude-plugin install.sh's `bootstrap_skills()` function** (NEW) orchestrates: enumerate → invoke per-skill installs → consolidate permissions.

---

## §3 Component designs

### §3.1 claude-plugin install.sh extension

**Location:** `adapters/claude-plugin/install.sh` (existing file; ~+60 lines)

**New function:** `bootstrap_skills()` — invoked after existing install logic completes, before final success message.

Pseudocode:

```bash
bootstrap_skills() {
  local repo_root="$(detect_repo_root)"      # reuses existing helper
  local context="$(detect_context)"          # source-tree | npm-installed
  local skills_dir
  case "$context" in
    source-tree)   skills_dir="$repo_root/skills" ;;
    npm-installed) skills_dir="$INSTALL_PREFIX/lib/node_modules/@apnex/claude-plugin/skills" ;;
  esac
  [ -d "$skills_dir" ] || { echo "[bootstrap-skills] no skills dir found at $skills_dir; skipping"; return 0; }

  local installed=() skipped=() failed=()
  local merged_fragments=()

  for skill_dir in "$skills_dir"/*/; do
    local skill_name="$(basename "$skill_dir")"
    [ -f "$skill_dir/install.sh" ] || { skipped+=("$skill_name (no install.sh)"); continue; }

    # Per-skill install (symlink / vendored-tarball auto-detected by skill's install.sh)
    if bash "$skill_dir/install.sh" --target=repo --silent; then
      installed+=("$skill_name")
    else
      failed+=("$skill_name (install.sh exit nonzero)")
      continue
    fi

    # Collect permission fragment if present
    if [ -f "$skill_dir/.skill-permissions.json" ]; then
      merged_fragments+=("$skill_dir/.skill-permissions.json")
    fi
  done

  # Consolidate fragments into .claude/settings.local.json
  if [ ${#merged_fragments[@]} -gt 0 ]; then
    merge_skill_permissions "${merged_fragments[@]}"
  fi

  # Summary
  echo "[bootstrap-skills] installed: ${#installed[@]} | skipped: ${#skipped[@]} | failed: ${#failed[@]}"
  printf "  ✓ %s\n" "${installed[@]}"
  [ ${#skipped[@]} -gt 0 ] && printf "  ○ %s\n" "${skipped[@]}"
  [ ${#failed[@]} -gt 0 ] && printf "  ✗ %s\n" "${failed[@]}"
}
```

**Helper functions:**
- `detect_repo_root()` — existing logic
- `detect_context()` — existing logic (source-tree vs npm-installed via `npm prefix -g` membership)
- `merge_skill_permissions()` — NEW; see §3.4

**Invocation order in main install.sh:**
1. Existing claude-plugin install steps (Hub config, MCP server registration, etc.)
2. NEW: `bootstrap_skills()` call
3. Final success message

**Failure mode:** if `bootstrap_skills()` partially fails, claude-plugin install.sh still succeeds overall (skills are best-effort additive layer; main install can succeed without them). Failures logged + summarized.

### §3.2 `.skill-permissions.json` schema (F1 CRITICAL)

**Location:** `<skill-dir>/.skill-permissions.json` (per-skill; optional file — skill without permissions ships no fragment)

**Schema v1.0:**

```json
{
  "schema-version": "1.0",
  "permissions": {
    "allow": [
      "Bash(skills/survey/scripts/*:*)"
    ]
  }
}
```

**Schema constraints (v1.0):**
- `schema-version` (required, string): exact match `"1.0"` — version-locked for v1; future schema bumps require backward-compat handling in `merge_skill_permissions()`
- `permissions` (required, object): only `allow` array key permitted in v1
- `permissions.allow` (required, array of strings): Claude Code permission patterns (per `.claude/settings.local.json` permissions.allow format)

**Anti-goal (AG-1):** schema does NOT extend to other Claude Code settings (env vars, hooks, MCP server config, sub-agent definitions, etc.). v1 is permissions-only. Schema bumps to add new top-level keys deferred to follow-on idea.

**Validation:** claude-plugin install.sh's `merge_skill_permissions()` validates each fragment:
1. Is valid JSON (else: skip + warn)
2. `schema-version === "1.0"` (else: skip + warn "unsupported schema version: <V>")
3. `permissions.allow` is array of strings (else: skip + warn malformed)
4. No top-level keys other than `schema-version` + `permissions` (else: warn "unknown keys ignored: <list>"; proceed with permissions only)

### §3.3 Per-skill install.sh contract (`--silent` flag addition)

**Existing contract** (per mission-69 `skills/survey/install.sh`):
- `--target=user|repo|--dry-run|--uninstall` flags
- Idempotent (skip if already symlinked correctly)
- Validates sovereign source exists before symlink-create
- Prints `.claude/settings.local.json` snippet (TO BE REMOVED per AG-5 retrofit; claude-plugin now handles via `.skill-permissions.json`)

**NEW addition:** `--silent` flag — suppresses interactive prompts + decorative output; suitable for bootstrap orchestration. Errors still printed to stderr.

**Standard contract for bootstrap-orchestrated skills:**

```
Usage: bash <skill>/install.sh [--target=user|repo] [--dry-run] [--uninstall] [--silent]

Exit codes:
  0  success (or already-installed; idempotent)
  1  validation error (sovereign source missing, target not writable, etc.)
  2  user-error (invalid flag combination)
```

**Backward compat:** existing `skills/survey/install.sh` callers without `--silent` keep working (flag defaults off; existing behavior preserved).

### §3.4 settings.local.json merge logic (F2 MEDIUM)

**Function:** `merge_skill_permissions(fragment_paths...)` in `adapters/claude-plugin/install.sh`

**Algorithm:**

1. Resolve target settings file: `${HOME}/.claude/settings.local.json` (consumer-side, gitignored)
2. If target doesn't exist: create with `{"permissions": {"allow": []}}`
3. Read target into memory (jq-parsed)
4. For each fragment path:
   a. Validate fragment per §3.2 schema constraints
   b. If invalid: warn + skip
   c. For each `permissions.allow` entry in fragment:
      - If exact-match exists in target's permissions.allow: skip (idempotent; no warning)
      - If different-but-similar (e.g., differs only in glob scope): warn-and-skip (preserve user intent per F2 architect-recommendation)
      - If new: append to target's permissions.allow
5. Write target back atomically: write to `<target>.tmp` → `mv` to `<target>`
6. Print summary: `merged N entries; M skipped (duplicates) ; W skipped (conflicts) ; X warnings`

**Rationale for warn-and-skip on conflict:**
- Preserves user-customized permission patterns
- Avoids overwriting user-tightened permissions with skill-defaults
- User can manually reconcile if needed
- Matches the "sovereign source-of-truth wins, but consumer customizations preserved" pattern

**Atomic write:** required to avoid corruption if claude-plugin install.sh is interrupted mid-merge.

**Failure mode:** if target settings.local.json is not writable or unparseable: fall back to print-snippet mode (per skill's individual install.sh historical pattern); warn user; proceed.

### §3.5 Source-tree vs npm-installed detection (reuse existing)

Per AG-3: NO refactor. Reuse existing `detect_context()` from `adapters/claude-plugin/install.sh`. Returns `source-tree` or `npm-installed`; consumed by `bootstrap_skills()` to locate `skills_dir`.

**Source-tree mode:** `skills_dir = <repo_root>/skills`
**npm-installed mode:** `skills_dir = $(npm prefix -g)/lib/node_modules/@apnex/claude-plugin/skills`

**npm-installed mode requirement:** `@apnex/claude-plugin` package must include `skills/` in its published files (npm publish). Out-of-scope for this mission to verify; assumed correct or handled at npm publish time per existing claude-plugin packaging discipline. (Post-Phase-8 verification flag.)

---

## §4 `skills/survey/` retrofit (per AG-5)

Three changes:

1. **Add** `skills/survey/.skill-permissions.json`:

```json
{
  "schema-version": "1.0",
  "permissions": {
    "allow": [
      "Bash(skills/survey/scripts/*:*)",
      "Bash(*skills/survey/scripts/*:*)"
    ]
  }
}
```

   (Two patterns to cover both project-relative + symlink-resolved invocation paths per existing v1.1 SKILL.md guidance.)

2. **Modify** `skills/survey/install.sh`:
   - Add `--silent` flag support (suppresses interactive prompts + decorative output)
   - REMOVE the trailing "paste this snippet into settings.local.json" print logic — claude-plugin install.sh now handles via `.skill-permissions.json` fragment consolidation
   - Print bare success message in non-silent mode: `[install] survey-skill installed at <target>; permissions handled by claude-plugin bootstrap`

3. **Bump** `skills/survey/SKILL.md`:
   - Frontmatter version v1.1 → v1.2
   - Update §Install section: replace manual-paste guidance with "claude-plugin install.sh handles automatically; manual `bash skills/survey/install.sh` for ad-hoc refresh"
   - Add note: `.skill-permissions.json` is the load-bearing surface; do not paste snippets manually

**Backward compatibility:** existing v1.1 install (Director-flagged manual-paste path) keeps working — users with existing settings.local.json entries don't need to re-run install. New consumers / re-runs use the new path.

---

## §5 Edge cases + failure modes (F3 + F4 + F5)

### §5.1 F3 — Source-tree edge cases

| Scenario | Behavior |
|---|---|
| Skill source dir deleted post-install (stale symlink) | Per-skill install.sh detects (via source-validate); on stale symlink: remove + warn; `bootstrap_skills()` reports as failed |
| Skill install.sh missing | `bootstrap_skills()` skips skill + reports as skipped (no install.sh = not bootstrap-eligible) |
| Skill install.sh exits nonzero | `bootstrap_skills()` reports as failed; continues with other skills (best-effort) |
| `.claude/settings.local.json` not writable | `merge_skill_permissions()` falls back to print-snippet; warns; proceeds |
| `.claude/settings.local.json` unparseable JSON | `merge_skill_permissions()` falls back to print-snippet; warns user to repair manually; proceeds |
| `npm prefix -g` returns empty / not on PATH | `detect_context()` returns source-tree; if NOT in source tree, `bootstrap_skills()` falls back to user-cwd resolution OR skips with warning |

### §5.2 F4 — Consumer-edits scenario

**Documented behavior:** consumer-edits to `.claude/skills/<name>/` are NOT preserved across refresh. Sovereign source-of-truth (at `/skills/<name>/` source-tree mode; vendored-tarball npm-installed mode) wins.

**Rationale:** the `.claude/skills/<name>/` location is consumer-install plumbing, not a customization surface. If consumers need customization:
- **Option 1 (preferred):** fork the skill into separate `/skills/<custom-name>/` (sovereign source); claude-plugin install.sh picks it up automatically
- **Option 2:** maintain a private fork of the repo with desired modifications

**Documentation surface:** `skills/survey/SKILL.md` §Customization section (NEW; ~3 lines) noting this constraint.

### §5.3 F5 — Cross-repo skill sources (PROBE; out-of-scope for v1)

Out-of-scope per Q2=a (universal audience = Claude-Code-clones-of-THIS-repo only). Forward design surface: `bootstrap_skills()` enumeration could extend to multiple `skills_dir` paths from a config file (e.g., `.claude/skill-sources.json`), but no concrete use case yet. Phase 4 Design v0.1 keeps `skills_dir` singular for v1; refactor surface is small if needed later.

**Anti-goal hardening:** AG-7 NEW (added at Phase 4 Design): don't add multi-source skill enumeration in v1 — defer to follow-on idea triggered by 2nd-canonical cross-repo skill source surfacing.

---

## §6 Test / verification strategy

### §6.1 Unit tests (per-script test files alongside scripts)

- `adapters/claude-plugin/install.test.sh` (existing): extend to cover `bootstrap_skills()` + `merge_skill_permissions()` paths
  - Empty skills dir → no-op success
  - One skill with valid `.skill-permissions.json` → installed + merged
  - One skill missing install.sh → skipped
  - One skill install.sh exits nonzero → failed
  - Malformed `.skill-permissions.json` → warn + skip
  - Conflict in settings.local.json → warn + skip + preserve user entry
  - Idempotent re-run → no duplicate entries
- `skills/survey/install.test.sh` (existing): extend to cover `--silent` flag + new exit-without-printing-snippet behavior

### §6.2 Integration test (smoke-run)

`scripts/local/test-skill-bootstrap.sh` (NEW; ~50 lines):
1. Create temp `.claude/` dir
2. Run `bash adapters/claude-plugin/install.sh --target=temp` (with HOME override)
3. Verify `.claude/skills/survey` symlink exists + valid
4. Verify `.claude/settings.local.json` permissions.allow contains expected entries
5. Re-run; verify idempotent (no duplicate entries)
6. Cleanup temp dir

### §6.3 Verification gates (Phase 6 + Phase 7)

- §6.1 + §6.2 all pass on PR branch
- `git grep -c "Paste this into" skills/survey/install.sh` → 0 (manual-snippet print logic removed)
- `cat skills/survey/SKILL.md | grep -c "v1.2"` → 1 (version bumped)
- `jq . skills/survey/.skill-permissions.json` exits 0 (valid JSON)

---

## §7 PR sequencing + content map

**Single-PR mission** (substrate-introduction class but narrow scope; ~1-2hr architect-side estimated). Branch `agent-lily/m-claude-plugin-install-bootstrap-skills` cumulative with Survey envelope (already committed) + Design (this doc, pending commit) + implementation.

**Content map:**

| File | Change | Lines (est.) |
|---|---|---|
| `docs/surveys/m-claude-plugin-install-bootstrap-skills-survey.md` | Phase 3 envelope (already committed `b6f3c5b`) | +282 |
| `docs/designs/m-claude-plugin-install-bootstrap-skills-design.md` | This Design v0.1 → v1.0 | +400 |
| `adapters/claude-plugin/install.sh` | Extend with `bootstrap_skills()` + `merge_skill_permissions()` | +80 |
| `adapters/claude-plugin/install.test.sh` | Extend with new test cases (~6 cases) | +60 |
| `skills/survey/.skill-permissions.json` | NEW file | +9 |
| `skills/survey/install.sh` | Add `--silent` flag; remove manual-snippet-print | +5 / −15 |
| `skills/survey/install.test.sh` | Extend with `--silent` flag coverage | +15 |
| `skills/survey/SKILL.md` | Frontmatter v1.1 → v1.2; update §Install | ±20 |
| `scripts/local/test-skill-bootstrap.sh` | NEW integration test | +50 |
| `docs/missions/m-claude-plugin-install-bootstrap-skills-preflight.md` | Phase 6 preflight | +100 |
| `docs/traces/m-claude-plugin-install-bootstrap-skills-architect-trace.md` | Phase 8/9/10 work-trace | +150 |

**Total est.** ~1170 lines net addition. Single squash-merge PR.

---

## §8 Anti-goals (carry from envelope §5 + §5.3 NEW)

| AG | Description | Composes-with target |
|---|---|---|
| AG-1 | Don't expand `.skill-permissions.json` schema beyond `permissions.allow` for v1 | follow-on idea |
| AG-2 | Don't add continuous-sync mechanism per Q3=d explicit deferral | future idea (TBD) |
| AG-3 | Don't refactor existing claude-plugin source-tree-vs-npm-installed detection | n/a — out-of-scope |
| AG-4 | Don't introduce per-RACI permission filtering at install layer per Q2=a | future idea-229 codification |
| AG-5 | Don't deprecate `skills/survey/install.sh`; retrofit as defined in §4 | mission-69 delivery preserved |
| AG-6 | Don't codify sovereign-Skill consumer-install methodology in `docs/methodology/sovereign-skills.md` | future-canonical-instance trigger (≥2 instances) |
| AG-7 (NEW) | Don't add multi-source skill enumeration in v1 (cross-repo skill sources) | follow-on idea (F5 PROBE) |

---

## §9 Architect-flags for round-1 audit (carry from envelope §6)

| # | Flag | Architect-recommendation |
|---|---|---|
| F1 (CRITICAL) | `.skill-permissions.json` schema design — exact field names, schema-version, extension surface boundary | Per §3.2: minimal schema `{schema-version: "1.0", permissions: {allow: [...]}}`; lock extension surface to `permissions.*` only per AG-1. **Engineer-audit ask:** validate field naming + schema-version semantics + extension-boundary discipline |
| F2 (MEDIUM) | Conflict resolution in settings.local.json merge — what if user has manually-added entries that conflict? | Per §3.4: warn-and-skip on conflict (preserve user intent); idempotent on re-run; atomic write. **Engineer-audit ask:** validate conflict-detection semantics — is "exact string match" the right granularity, or should we normalize patterns (e.g., absolute paths)? |
| F3 (MEDIUM) | Source-tree vs npm-installed detection edge cases — stale symlink, partial install, settings.local.json not writable | Per §5.1: per-table behavior. **Engineer-audit ask:** any edge case missing from §5.1 table? Specifically: symlink-already-exists-but-points-to-different-source case |
| F4 (MINOR) | Consumer-edits scenario — user edits `.claude/skills/<name>/SKILL.md` for personal customization; refresh wipes/clobbers | Per §5.2: documented as not-preserved; sovereign source wins; fork-skill workaround. **Engineer-audit ask:** is the documentation surface (SKILL.md §Customization) sufficient, or should we add a runtime warning when consumer-edits detected? |
| F5 (PROBE) | Cross-repo skill sources — future scenarios where skills come from OTHER repos | Per §5.3: out-of-scope v1; AG-7 NEW. **Engineer-audit ask:** is the v1 architecture pluggable enough for future extension, or do we need an explicit pluggability hook now? |

---

## §10 Cross-references

- **Survey envelope:** `docs/surveys/m-claude-plugin-install-bootstrap-skills-survey.md` (commit `b6f3c5b`)
- **Source idea:** idea-230 (status: `triaged` → will flip `incorporated` at mission-create)
- **Companion ideas:** idea-228 (1st-canonical Skill instance; mission-69 closed) + idea-229 (parked umbrella; this mission = 1st-canonical consumer-install layer)
- **Methodology:** `docs/methodology/idea-survey.md` v1.0 (Survey methodology consumed; not modified per AG-9 from mission-69) + `docs/methodology/strategic-review.md` (Idea Triage Protocol applied) + `docs/methodology/mission-lifecycle.md` v1.2 (Phase 4 Design entry)
- **Substrate to extend:** `adapters/claude-plugin/install.sh` (mission-64-era; existing source-tree-vs-npm-installed detection reused per AG-3)
- **Substrate to retrofit:** `skills/survey/install.sh` + SKILL.md (mission-69 delivery; mods per AG-5)
- **Calibration ledger:** `docs/calibrations.yaml` (closures-applied: []; candidates-surfaced: q-design-orthogonality-membership-collapse-class from Survey)
- **Compressed-lifecycle precedent:** mission-67/68/69 substrate-introduction sub-class; mission-70 governance-doc-reconcile sub-class; this mission may establish 2nd-canonical sovereign-Skill instance sub-class

---

— Architect: lily / 2026-05-02 (Phase 4 Design v0.1 DRAFT; pending engineer round-1 audit per Director-direct routing 2026-05-02)
