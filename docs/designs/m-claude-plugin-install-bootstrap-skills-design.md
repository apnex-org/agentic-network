# M-Claude-Plugin-Install-Bootstrap-Skills — Design v1.0

**Status:** v1.0 RATIFIED (architect-revised 2026-05-02; engineer round-1 + round-2 audits folded — 17 findings total: 15 round-1 + 2 round-2 NEW; full fold summary §11; bilateral seal expected via thread-465 round-3 engineer verify-and-converge per `mission-lifecycle.md` Phase 4 audit cycle)
**Methodology:** Phase 4 Design per `mission-lifecycle.md` v1.2 §1 (RACI: C=Director / R=Architect+Engineer)
**Survey envelope:** `docs/surveys/m-claude-plugin-install-bootstrap-skills-survey.md` v1.0 (Director-ratified 6 picks; commit `b6f3c5b`)
**Source idea:** idea-230 (status `triaged` via route-(a) skip-direct; will flip `incorporated` at mission-create)
**Companion:** idea-229 umbrella (parked architectural anchor; this mission = 1st-canonical consumer-install layer instance) + idea-228 / mission-69 (precondition; `/skills/survey/` v1.1 lives there)
**Branch:** `agent-lily/m-claude-plugin-install-bootstrap-skills` (Survey + Design + retrofit + claude-plugin extension cumulative; mission-68 M6 fold pattern)
**Round-1 audit:** thread-465 round-1 (greg authored 2026-05-02); see §11 fold summary

---

## §0 Document orientation

Substrate-introduction mission: consumer-install plumbing for the sovereign-Skill pattern. Fourth-canonical compressed-lifecycle execution OR fully-bilateral substrate-introduction (Director-direct routing chose bilateral). 2nd-canonical sovereign-Skill instance after mission-69 (1st-canonical was the Survey Skill itself; this is the install-layer for that pattern).

Reading order:
- §1 Mission scope summary (Survey envelope §3 + §4 reference)
- §2 Architecture overview (3-mechanism composition; revised per C2+C3 fold to all-user target)
- §3 Component designs:
  - §3.1 claude-plugin install.sh extension (orchestrator; revised per C1 helper-extraction + C2+C3 target-resolution + M5 nullglob + m3 array form)
  - §3.2 `.skill-permissions.json` schema (revised per M1 major-version compat)
  - §3.3 Per-skill install.sh contract (`--silent` flag addition)
  - §3.4 settings.local.json merge logic (revised per M2 limitation doc + M4 allow-array-absent + M7 fallback consolidation)
  - §3.5 Source-tree vs npm-installed detection (reuse existing per AG-3; user-global target resolution clarified per C3)
- §4 `skills/survey/` retrofit (per AG-5; revised per M7 + v1.1 manual-entry persistence note)
- §5 Edge cases + failure modes (F3 + F4; revised per M3 stale-symlink behavior)
- §6 Test / verification strategy (revised per M6 grep-pattern fix + m4 absent-dir test case)
- §7 PR sequencing + content map (revised per C1 helper-extraction +15 lines)
- §8 Anti-goals (revised: AG-8 NEW for M2 permission-pattern-normalization forward-pointer)
- §9 Architect-flags for round-1 audit (each marked addressed/deferred for round-2 verify)
- §10 Cross-references
- §11 Round-1 audit fold summary (NEW; per mission-67/68/69 precedent)

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

**Location:** `adapters/claude-plugin/install.sh` (existing file; ~+95 lines per revised content map §7)

**Three NEW additions:**
1. `detect_repo_root()` + `detect_context()` extracted from existing inline blocks at lines 24-35 of current `install.sh` into named helper functions (per C1 fold; +15 lines net refactor)
2. `bootstrap_skills()` orchestrator — invoked after existing install logic completes, before final success message
3. `merge_skill_permissions()` — see §3.4

**§3.1.a — Helper extraction (C1 fold)**

Current `install.sh` has context-detection logic inline at lines 24-35. Extract to named functions per C1 fold:

```bash
# Extracted from existing inline block (current lines 24-35).
# Resolves the consumer's repo-root or returns empty in npm-installed mode.
detect_repo_root() {
  local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # Walk up to find package.json with this script's known signature
  local d="$script_dir"
  while [ "$d" != "/" ]; do
    if [ -f "$d/package.json" ] && grep -q '"@apnex/claude-plugin"' "$d/package.json" 2>/dev/null; then
      echo "$d"; return 0
    fi
    d="$(dirname "$d")"
  done
  return 1
}

# Returns "source-tree" or "npm-installed".
detect_context() {
  local npm_prefix
  npm_prefix="$(npm prefix -g 2>/dev/null || echo "")"
  if [ -n "$npm_prefix" ] && [[ "$(realpath "${BASH_SOURCE[0]}" 2>/dev/null)" == "$npm_prefix"/* ]]; then
    echo "npm-installed"
  else
    echo "source-tree"
  fi
}
```

(Exact extraction depends on existing inline-block contents at install-time; the above is the contract/shape — actual extraction preserves current behavior verbatim.)

**§3.1.b — `bootstrap_skills()` orchestrator (C2+C3 fold: all-user target resolution)**

Per C2+C3 fold to greg's option (a) all-user target — symlinks land at `~/.claude/skills/`; permissions land at `~/.claude/settings.local.json`. Symmetric, npm-installed-mode safe, matches per-skill `install.sh` default `--target=user`, no new flags.

```bash
bootstrap_skills() {
  shopt -s nullglob   # M5 fold: empty-glob expands to nothing rather than literal pattern
  local repo_root context skills_dir
  context="$(detect_context)"
  case "$context" in
    source-tree)
      repo_root="$(detect_repo_root)" || { echo "[bootstrap-skills] not in a recognized claude-plugin source tree; skipping" >&2; return 0; }
      skills_dir="$repo_root/skills"
      ;;
    npm-installed)
      # m3 fold: array form (zero-cost future-proof per AG-7); single-source for v1
      # N1 fold (round-2): drop the trailing /.. — install.sh lives AT the package root,
      # so its dirname IS the pkg_root. v0.2 had `/..` which resolved to the @apnex
      # namespace dir instead of the claude-plugin package dir; v0.1 was correct;
      # C1 helper-extraction inadvertently regressed. This v1.0 restores correctness.
      local pkg_root
      pkg_root="$(realpath "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null || dirname "${BASH_SOURCE[0]}")"
      skills_dir="$pkg_root/skills"
      ;;
  esac

  local skills_dirs=("$skills_dir")   # m3 fold: array form for future multi-source extension

  if [ ! -d "$skills_dir" ]; then
    echo "[bootstrap-skills] no skills dir found at $skills_dir; skipping" >&2
    return 0
  fi

  local installed=() skipped=() failed=()
  local merged_fragments=()

  local sd
  for sd in "${skills_dirs[@]}"; do
    local skill_dir
    for skill_dir in "$sd"/*/; do
      local skill_name="$(basename "$skill_dir")"
      [ -f "$skill_dir/install.sh" ] || { skipped+=("$skill_name (no install.sh)"); continue; }

      # C2+C3 fold: --target=user (always lands at ~/.claude/skills/; works in source-tree
      # AND npm-installed; matches per-skill default; resolves npm-installed REPO_ROOT bug)
      if bash "$skill_dir/install.sh" --target=user --silent; then
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
  done

  # Consolidate fragments into ~/.claude/settings.local.json (user-global per C3 fold)
  if [ ${#merged_fragments[@]} -gt 0 ]; then
    merge_skill_permissions "${merged_fragments[@]}"
  fi

  # Summary (with §3.1 empty-array guards per greg's surface check)
  echo "[bootstrap-skills] installed: ${#installed[@]} | skipped: ${#skipped[@]} | failed: ${#failed[@]}"
  [ ${#installed[@]} -gt 0 ] && printf "  ✓ %s\n" "${installed[@]}"
  [ ${#skipped[@]} -gt 0 ]   && printf "  ○ %s\n" "${skipped[@]}"
  [ ${#failed[@]} -gt 0 ]    && printf "  ✗ %s\n" "${failed[@]}"
}
```

**Invocation order in main install.sh:**
1. Existing claude-plugin install steps (Hub config, MCP server registration, etc.)
2. NEW: `bootstrap_skills()` call
3. Final success message

**Failure mode:** if `bootstrap_skills()` partially fails, claude-plugin install.sh still succeeds overall (skills are best-effort additive layer; main install can succeed without them). Failures logged + summarized.

**Target-resolution coherence note (C3 fold):** all install operations resolve to user-global `~/.claude/`. Skills land at `~/.claude/skills/<name>/`; permissions land at `~/.claude/settings.local.json`. Symmetric. Matches per-skill `install.sh` default `--target=user`. Survey Q3=d hybrid cadence + Q4=d hybrid mechanism + Q2=a universal-audience all align with user-global. Per-repo isolation (alternative C3 option (b) "all-repo") deferred — if surfaced as need, becomes follow-on idea (would require `--skill-target=user|repo` propagated end-to-end; out of scope for v1).

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
- `schema-version` (required, string): SemVer-style `"<MAJOR>.<MINOR>"` — bootstrap accepts any fragment whose `schema-version` MAJOR matches `"1"` (e.g., `"1.0"`, `"1.1"`, `"1.99"`); MAJOR mismatch (e.g., `"2.0"`) is rejected. **Per M1 fold:** major-version-compat semantics (not exact-match) — allows forward-compat for additive schema bumps without consumer-side detection upgrades. Unknown sub-fields under recognized top-level keys are ignored (forward-compat warn-only).
- `permissions` (required, object): only `allow` array key permitted in v1.0; future minor bumps (1.x) MAY add additional permission-class keys (e.g., `deny` array) without breaking 1.x consumers
- `permissions.allow` (required, array of strings): Claude Code permission patterns (per `.claude/settings.local.json` permissions.allow format)

**Anti-goal (AG-1):** schema does NOT extend to other Claude Code settings (env vars, hooks, MCP server config, sub-agent definitions, etc.) in v1.0. v1.0 is `permissions.*`-only. Schema bumps to add new top-level keys (e.g., `env`, `hooks`) require MAJOR version bump (2.0) + consumer-side detection upgrade.

**Validation:** claude-plugin install.sh's `merge_skill_permissions()` validates each fragment:
1. Is valid JSON (else: skip + warn)
2. `schema-version` exists + matches MAJOR `^1\.` (else: skip + warn "unsupported schema major: <V>")
3. `permissions.allow` is array of strings (else: skip + warn malformed)
4. Unknown top-level keys other than `schema-version` + `permissions`: warn "unknown keys ignored: <list>"; proceed with permissions
5. Unknown keys under `permissions` other than `allow` in v1.0: warn "unknown permission keys ignored: <list>"; proceed with `allow` (per M1 forward-compat semantics)

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

### §3.4 settings.local.json merge logic (F2 MEDIUM; M2 + M4 + M7 folds)

**Function:** `merge_skill_permissions(fragment_paths...)` in `adapters/claude-plugin/install.sh`

**Algorithm:**

1. Resolve target settings file: `${HOME}/.claude/settings.local.json` (user-global per C3 fold; gitignored)
2. If target doesn't exist: create with `{"permissions": {"allow": []}}`
3. **(M4 fold; NEW step 2.5)** If target exists with `permissions` object but no `permissions.allow` key: set `permissions.allow = []` before merge proceeds (avoids null-array dereference under jq when user has only `permissions.deny` configured)
4. Read target into memory (jq-parsed)
5. For each fragment path:
   a. Validate fragment per §3.2 schema constraints (incl. M1 major-version-compat semantics)
   b. If invalid: warn + skip
   c. For each `permissions.allow` entry in fragment:
      - If **exact string match** exists in target's permissions.allow: skip (idempotent; no warning)
      - If **subsumption-pair detected** (e.g., user has `"Bash(npm:*)"`, fragment has `"Bash(npm:install)"`): treated as distinct → both end up in allowlist (M2 limitation: exact-match only). Documented limitation, not a bug.
      - If **self-duplication within a single fragment** (e.g., fragment ships overlapping patterns like `"Bash(skills/survey/scripts/*:*)"` + `"Bash(*skills/survey/scripts/*:*)"`): both enter target. M2 limitation: no glob-expansion dedup.
      - If new: append to target's permissions.allow
6. Write target back atomically: write to `<target>.tmp` → `mv` to `<target>`
7. Print summary: `merged N entries; M skipped (duplicates) ; W warnings (validation)`

**M2 limitation (documented):** exact-string-match conflict detection is the v1 floor. It correctly handles the dominant idempotency case (re-run → skip duplicates) but does NOT detect:
- *Subsumption*: narrower-vs-broader pattern overlap (both land in target)
- *Self-duplication*: overlapping patterns within a single fragment (both land in target)

These are not harmful (allowlist redundancy is benign), but produce noise. Permission-pattern-normalization deferred to follow-on idea (AG-8 NEW; see §8). Forward-pointer in code comment + summary message ("M extra entries; consider deduping in future").

**Rationale for warn-and-skip on conflict (preserved from v0.1):**
- Preserves user-customized permission patterns
- Avoids overwriting user-tightened permissions with skill-defaults
- User can manually reconcile if needed
- Matches the "sovereign source-of-truth wins, but consumer customizations preserved" pattern

**Atomic write:** required to avoid corruption if claude-plugin install.sh is interrupted mid-merge.

**§3.4.fallback — Failure mode (M7 fold; consolidated to claude-plugin level)**

If target settings.local.json is not writable OR unparseable: `merge_skill_permissions()` does NOT defer back to per-skill install.sh (per M7 fold; per-skill install.sh has had snippet-print logic REMOVED per AG-5 retrofit). Instead, claude-plugin emits a synthesized snippet directly from the in-memory fragment data:

```bash
# §3.4.fallback pseudocode (n1 fold round-2: process substitution preserves outer-scope `first` mutation; pipe-to-while runs in subshell + variable-leak makes comma-separator never trigger → malformed JSON)
emit_snippet_fallback() {
  local fragment_paths=("$@")
  echo "[merge-skill-permissions] settings.local.json not writable/unparseable; emitting snippet for manual paste:" >&2
  echo ""
  echo '{'
  echo '  "permissions": {'
  echo '    "allow": ['
  local first=1
  local fragment entry
  for fragment in "${fragment_paths[@]}"; do
    while IFS= read -r entry; do
      [ $first -eq 0 ] && echo ","
      printf '      "%s"' "$entry"
      first=0
    done < <(jq -r '.permissions.allow[]?' "$fragment" 2>/dev/null)
  done
  echo ""
  echo '    ]'
  echo '  }'
  echo '}'
  echo ""
  echo "Add the entries above to your existing .claude/settings.local.json under permissions.allow." >&2
}
```

**Why claude-plugin owns the fallback (M7 fold):** per-skill install.sh has been retrofit to remove snippet-print logic (per AG-5 + §4); fallback data lives at the fragment-level and the formatter at the orchestrator-level — single concern, one location.

### §3.5 Source-tree vs npm-installed detection (reuse existing per AG-3; C2 fold clarifies)

Per AG-3: NO refactor of detection logic. Per C1 fold: extract inline blocks at lines 24-35 of `install.sh` into named `detect_context()` + `detect_repo_root()` helpers (same behavior, named surface). Returns `source-tree` or `npm-installed`; consumed by `bootstrap_skills()` to locate `skills_dir`.

**Source-tree mode:** `skills_dir = <repo_root>/skills` (where `repo_root` resolves to the consumer's checkout root via `detect_repo_root()`)
**npm-installed mode:** `skills_dir = <pkg_root>/skills` (where `pkg_root` is the `@apnex/claude-plugin` install location, e.g. `$(npm prefix -g)/lib/node_modules/@apnex/claude-plugin`)

**Per-skill invocation contract (C2 fold):** in BOTH modes, bootstrap invokes per-skill `install.sh` with `--target=user` (NOT `--target=repo`). This resolves the npm-installed REPO_ROOT bug greg surfaced — per-skill install.sh's internal `REPO_ROOT="$(cd "$SOURCE_DIR/../.." && pwd)"` resolution is irrelevant when `--target=user` because the symlink target is `~/.claude/skills/<name>` (HOME-anchored), not REPO_ROOT-anchored.

**npm-installed mode packaging requirement:** `@apnex/claude-plugin` package must include `skills/` in its published files (npm publish). Out-of-scope for this mission to verify; assumed correct or handled at npm publish time per existing claude-plugin packaging discipline. (Post-Phase-8 verification flag.)

---

## §4 `skills/survey/` retrofit (per AG-5; M7 + greg's surface check)

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

   (Two patterns to cover both project-relative + symlink-resolved invocation paths per existing v1.1 SKILL.md guidance. M2 limitation: these may both end up in the consumer's allowlist; documented as benign redundancy pending AG-8 permission-pattern-normalization follow-on.)

2. **Modify** `skills/survey/install.sh`:
   - Add `--silent` flag support (suppresses interactive prompts + decorative output)
   - REMOVE the trailing "Bash permission allowlist — add to .claude/settings.local.json" print logic — claude-plugin install.sh now handles via `.skill-permissions.json` fragment consolidation (M7 fold: claude-plugin owns fallback snippet-emit; per-skill install.sh permanently loses snippet logic)
   - Print bare success message in non-silent mode: `[install] survey-skill installed at <target>; permissions handled by claude-plugin bootstrap (or set by you manually if running standalone)`
   - Stale-symlink behavior preserved (M3 fold): existing refuse-and-exit (exit 1) on stale symlink kept as-is — safer; respects user's possibly-intentional manual symlinks; bootstrap reports the failure + continues with other skills

3. **Bump** `skills/survey/SKILL.md`:
   - Frontmatter version v1.1 → v1.2
   - Update §Install section: replace manual-paste guidance with "claude-plugin install.sh handles automatically; manual `bash skills/survey/install.sh` for ad-hoc refresh"
   - Add note: `.skill-permissions.json` is the load-bearing surface; do not paste snippets manually
   - **Per greg's surface check on §4 backward-compat (NEW):** add sentence to §Install: "v1.1 users with manually-pasted permission entries can keep them as-is; the new `.skill-permissions.json` path is additive, not migratory — exact-match dedup in `merge_skill_permissions()` ensures idempotent behavior on re-install."
   - Add NEW §Customization section (~3 lines per F4 fold): "consumer-edits to `.claude/skills/survey/` are NOT preserved across refresh; sovereign source wins. For customization, fork the Skill into `/skills/<custom-name>/`."

**Backward compatibility:** existing v1.1 install (Director-flagged manual-paste path) keeps working — users with existing settings.local.json entries don't need to re-run install; merge_skill_permissions exact-match-dedup preserves them on re-run. New consumers / re-runs use the new path.

---

## §5 Edge cases + failure modes (F3 + F4 + F5)

### §5.1 F3 — Source-tree + npm-installed edge cases (M3 fold corrected)

| Scenario | Behavior |
|---|---|
| Skill source dir deleted post-install (stale symlink) | Per-skill install.sh **refuses (exit 1)** — preserved existing behavior per M3 fold; `bootstrap_skills()` reports as failed; user manually resolves (`rm` the stale symlink + re-run) |
| Skill source EXISTS but symlink points to different source (different-source symlink case; greg's F3 sub-question) | Per-skill install.sh refuses (exit 1) per same code path as stale symlink — symlink-target validation is "exists AND matches expected source"; `bootstrap_skills()` reports as failed; user manually resolves |
| Skill install.sh missing | `bootstrap_skills()` skips skill + reports as skipped (no install.sh = not bootstrap-eligible) |
| Skill install.sh exits nonzero (any cause) | `bootstrap_skills()` reports as failed; continues with other skills (best-effort) |
| `~/.claude/settings.local.json` not writable | `merge_skill_permissions()` falls back to claude-plugin-side snippet-emit per §3.4.fallback (M7 fold); warns; proceeds |
| `~/.claude/settings.local.json` unparseable JSON | Same as above: claude-plugin-side snippet-emit; warns user to repair manually; proceeds |
| `npm prefix -g` returns empty / not on PATH | `detect_context()` returns source-tree; `detect_repo_root()` may also fail → `bootstrap_skills()` skips with warning ("not in a recognized claude-plugin source tree") |
| Empty `skills/` dir (no sub-dirs) | M5 fold: `shopt -s nullglob` makes `for skill_dir in "$skills_dir"/*/` no-op; `bootstrap_skills()` returns 0 with summary `installed: 0 skipped: 0 failed: 0` |
| `skills/` dir absent | `bootstrap_skills()` early-returns 0 with `[bootstrap-skills] no skills dir found` warning (per `[ ! -d "$skills_dir" ]` guard) |

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

### §6.1 Unit tests (per-script test files alongside scripts; m4 + greg's surface check folds)

- `adapters/claude-plugin/install.test.sh` (existing): extend to cover `bootstrap_skills()` + `merge_skill_permissions()` paths (NEW cases below; ~7 cases per m4 fold)
  - Case 1: Empty skills dir → no-op success
  - Case 2: One skill with valid `.skill-permissions.json` → installed + merged
  - Case 3: One skill missing install.sh → skipped
  - Case 4: One skill install.sh exits nonzero → failed
  - Case 5: Malformed `.skill-permissions.json` → warn + skip
  - Case 6: Idempotent re-run → no duplicate entries (exact-match dedup verified)
  - Case 7 (m4 NEW): `skills/` dir ABSENT entirely → no-op success (early-return path)
  - Case 8 (M4 NEW): target settings.local.json has `permissions` but no `permissions.allow` → step 2.5 creates `allow=[]` then merges
  - Case 9 (M1 NEW): fragment with `schema-version: "1.5"` → accepted (major-version-compat)
  - Case 10 (M1 NEW): fragment with `schema-version: "2.0"` → rejected with warn
  - Case 11 (M3 NEW): per-skill install.sh refuses on stale symlink → bootstrap reports as failed; other skills continue
  - Case 12 (n1 NEW round-2): settings.local.json not writable → `emit_snippet_fallback()` emits valid JSON parseable by `jq .` (catches subshell-variable-leak class regression — verifies comma-separator works across multiple fragments)
- `skills/survey/install.test.sh` (existing): extend to cover `--silent` flag + new exit-without-printing-snippet behavior

### §6.2 Integration test (smoke-run)

`scripts/local/test-skill-bootstrap.sh` (NEW; ~50 lines):
1. Create temp `.claude/` dir
2. Run `bash adapters/claude-plugin/install.sh --target=temp` (with HOME override)
3. Verify `.claude/skills/survey` symlink exists + valid
4. Verify `.claude/settings.local.json` permissions.allow contains expected entries
5. Re-run; verify idempotent (no duplicate entries)
6. Cleanup temp dir

### §6.3 Verification gates (Phase 6 + Phase 7; M6 fold)

- §6.1 + §6.2 all pass on PR branch
- **M6 fold:** `git grep -c "settings.local.json" skills/survey/install.sh` → 0 post-retrofit (broader pattern catches both phrasings of the original snippet-print logic). Verify by running pre-retrofit (should return ≥1) + post-retrofit (should return 0). The original v0.1 grep `"Paste this into"` was a false-positive — actual current text is `"Bash permission allowlist — add to .claude/settings.local.json"`; v0.1 gate would have passed without retrofit doing anything.
- `cat skills/survey/SKILL.md | grep -c "v1.2"` → 1 (version bumped)
- `jq . skills/survey/.skill-permissions.json` exits 0 (valid JSON)
- `jq -e '.["schema-version"]' skills/survey/.skill-permissions.json | grep -E '^"1\\.'` returns 0 (schema-version v1.x; M1 major-version-compat verification)

---

## §7 PR sequencing + content map

**Single-PR mission** (substrate-introduction class but narrow scope; ~1-2hr architect-side estimated). Branch `agent-lily/m-claude-plugin-install-bootstrap-skills` cumulative with Survey envelope (already committed) + Design (this doc, pending commit) + implementation.

**Content map:**

| File | Change | Lines (est.) |
|---|---|---|
| `docs/surveys/m-claude-plugin-install-bootstrap-skills-survey.md` | Phase 3 envelope (already committed `b6f3c5b`) | +282 |
| `docs/designs/m-claude-plugin-install-bootstrap-skills-design.md` | This Design v0.1 → v1.0 | +400 |
| `adapters/claude-plugin/install.sh` | Extract `detect_repo_root()` + `detect_context()` helpers (C1 fold; +15) + extend with `bootstrap_skills()` + `merge_skill_permissions()` + `emit_snippet_fallback()` (M7 fold) | +95 |
| `adapters/claude-plugin/install.test.sh` | Extend with new test cases (~6 cases) | +60 |
| `skills/survey/.skill-permissions.json` | NEW file | +9 |
| `skills/survey/install.sh` | Add `--silent` flag; remove manual-snippet-print | +5 / −15 |
| `skills/survey/install.test.sh` | Extend with `--silent` flag coverage | +15 |
| `skills/survey/SKILL.md` | Frontmatter v1.1 → v1.2; update §Install | ±20 |
| `scripts/local/test-skill-bootstrap.sh` | NEW integration test | +50 |
| `docs/missions/m-claude-plugin-install-bootstrap-skills-preflight.md` | Phase 6 preflight | +100 |
| `docs/traces/m-claude-plugin-install-bootstrap-skills-architect-trace.md` | Phase 8/9/10 work-trace | +150 |

**Total est.** ~1185 lines net addition (revised from v0.1's ~1170 per C1 helper-extraction +15). Single squash-merge PR per greg's surface-check on §7 (don't split — bootstrap-orchestrator + survey-retrofit don't compose if shipped half).

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
| AG-8 (NEW v0.2) | Don't add permission-pattern-normalization (subsumption / glob-expansion / self-duplication dedup) in v1; exact-string-match is the v1 floor | follow-on idea (M2 forward-pointer; trigger: noisy-allowlist-from-redundant-fragments user complaint) |

---

## §9 Architect-flags status (v0.2 — round-1 audit results folded; pending round-2 verify)

| # | Original flag | Round-1 outcome | Round-2 verify ask |
|---|---|---|---|
| F1 (CRITICAL → MEDIUM after fold) | `.skill-permissions.json` schema design | M1 fold: major-version-compat (`^1\.`) replaces exact-match; v1.0 = `permissions.allow`-only per AG-1; future MAJOR bump for new top-level keys | Verify §3.2 schema constraints + validation steps post-fold; confirm M1 forward-compat semantics correct |
| F2 (MEDIUM) | settings.local.json merge conflict resolution | M2 fold: exact-string-match v1 floor + documented limitation (subsumption + self-duplication noise) + AG-8 NEW forward-pointer to permission-pattern-normalization follow-on idea | Verify §3.4 limitation documentation + AG-8 new entry + M2 noise treatment as benign |
| F3 (MEDIUM) | Source-tree vs npm-installed edge cases | M3 fold corrected stale-symlink behavior (refuse-and-exit preserved per existing safer pattern, NOT auto-remove); §5.1 table revised + new row for different-source symlink case | Verify §5.1 table completeness; greg flagged different-source symlink case — covered? |
| F4 (MINOR) | Consumer-edits scenario | m2 concur: SKILL.md §Customization documentation sufficient (NEW §Customization section in §4 retrofit); runtime warning deferred to follow-on idea triggered by ≥1 user complaint | Verify §4 §Customization section adequately documents constraint |
| F5 (PROBE) | Cross-repo skill sources pluggability | P1 concur: v1 architecture sufficiently pluggable; m3 zero-cost future-proof adopted (skills_dirs array form in §3.1 — 1-line cost); AG-7 + defer | Verify §3.1 array form + AG-7 stance |

**NEW round-1-only flags (folded; round-2 verify only):**

| # | Origin | Status |
|---|---|---|
| C1 | Helper-extraction scope | Folded: §3.1.a extracts `detect_repo_root()` + `detect_context()`; §7 content map updated +15 lines |
| C2 | npm-installed `--target=repo` REPO_ROOT bug | Folded: bootstrap invokes per-skill with `--target=user` (greg's option (a)); resolves npm-installed-mode + matches per-skill default |
| C3 | Target-location asymmetry | Folded: all-user target consistently — skills @ `~/.claude/skills/`, permissions @ `~/.claude/settings.local.json`; per-repo isolation deferred as follow-on if surfaced |
| M4 | `permissions.allow` absent under existing `permissions` key | Folded: §3.4 step 2.5 adds `allow=[]` if missing |
| M5 | Empty-glob expansion under `set -euo pipefail` | Folded: `shopt -s nullglob` in `bootstrap_skills()` |
| M6 | False-positive grep verification gate | Folded: §6.3 grep pattern broadened to `"settings.local.json"` (captures actual text removed by retrofit) |
| M7 | Print-snippet-fallback orphan after AG-5 retrofit | Folded: claude-plugin-side `emit_snippet_fallback()` synthesizes from in-memory fragment data; per-skill install.sh permanently loses snippet logic |
| m4 | Test coverage gap (skills dir absent) | Folded: §6.1 case 7 added |
| m3 | Optional zero-cost future-proof (skills_dirs array form) | Folded: §3.1 uses array form; behaviorally identical for v1; pluggable for future |

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

## §11 Round-1 audit fold summary (NEW v0.2; per mission-67/68/69 precedent)

Engineer round-1 audit (greg; thread-465 round-1; 2026-05-02). **15 findings total: 3 CRITICAL + 7 MEDIUM + 4 MINOR + 1 PROBE.** Architect fold-decisions:

| Finding | Class | Architect fold-decision | v0.2 § |
|---|---|---|---|
| C1 | helper-extraction scope hidden | **FOLDED** — option (a): extract `detect_repo_root()` + `detect_context()` as part of this PR (+15 lines net refactor); §7 content map updated | §3.1.a + §7 |
| C2 | `--target=repo` broken in npm-installed mode (REPO_ROOT bug) | **FOLDED** — option (a): bootstrap invokes per-skill with `--target=user`; resolves bug + matches per-skill default | §3.1.b + §3.5 |
| C3 | Target-location asymmetry (skills repo-local, permissions user-global) | **FOLDED** — option (a): all-user target consistently; symmetric; aligns with all 6 Survey picks; per-repo isolation deferred to follow-on if surfaced | §3.1.b + §3.4 + §3.5 |
| M1 | schema-version exact-match brittle | **FOLDED** — major-version-compat semantics (`^1\.`); forward-compat for additive minor bumps | §3.2 |
| M2 | exact-string conflict detection misses subsumption + self-duplication | **FOLDED** — exact-match v1 floor + documented limitation + AG-8 NEW forward-pointer to permission-pattern-normalization follow-on idea | §3.4 + §8 (AG-8) |
| M3 | stale-symlink behavior inconsistent (auto-remove vs refuse-and-exit) | **FOLDED** — preserved existing refuse-and-exit (safer); §5.1 table corrected + new row for different-source symlink case | §4 + §5.1 |
| M4 | `permissions` exists but `permissions.allow` absent | **FOLDED** — §3.4 step 2.5 adds `allow=[]` if missing | §3.4 |
| M5 | Empty-glob expansion under `set -euo pipefail` | **FOLDED** — `shopt -s nullglob` in `bootstrap_skills()` | §3.1.b |
| M6 | §6.3 grep verification gate is false-positive | **FOLDED** — broadened to `"settings.local.json"` pattern; verifies pre-retrofit ≥1 → post-retrofit 0 | §6.3 |
| M7 | Print-snippet-fallback orphan after AG-5 retrofit | **FOLDED** — claude-plugin-side `emit_snippet_fallback()` synthesizes from in-memory fragment data; per-skill install.sh permanently loses snippet logic | §3.4.fallback + §4 |
| m1 | Schema fine for v1; optional `description` field | **CONCUR** — defer; AG-1 lock to `permissions.*`-only confirmed | (no change) |
| m2 | SKILL.md §Customization documentation sufficient | **CONCUR** — defer runtime-warning; new §Customization section added per F4 fold | §4 |
| m3 | Optional zero-cost future-proof (skills_dirs array form) | **FOLDED** — §3.1 uses array form for forward-compat; behaviorally identical for v1; pluggable for future cross-repo per AG-7 | §3.1.b |
| m4 | Test coverage gap (skills dir absent) | **FOLDED** — §6.1 case 7 added | §6.1 |
| P1 | Pluggability hook now vs defer | **CONCUR** — m3 array form provides zero-cost future-proof; AG-7 + defer | §3.1.b + §8 (AG-7) |

**Other surface-checks (greg's section "Other audit-surface checks"):**

| Check | Status |
|---|---|
| §3.1 empty-array `printf` guards | **FOLDED** in §3.1.b (`[ ${#installed[@]} -gt 0 ] && printf ...` for installed/skipped/failed) |
| §3.3 `--silent` backward-compat | **CONFIRMED** ✅ |
| §4 retrofit backward-compat for v1.1 manually-pasted entries | **FOLDED** — SKILL.md §Install gets explicit additive-not-migratory sentence per greg's wording |
| §7 don't split | **CONFIRMED** ✅; +15 lines per C1 fold reflected in revised total |
| §8 nothing missing | **CONFIRMED** as of v0.1; AG-8 NEW added in v0.2 per M2 fold |

**Round-1 verdict:** all 3 CRITICALs resolved; 7/7 MEDIUMs folded; 2/4 MINORs folded (m3 + m4) + 2/4 concur (m1 + m2; documented decisions); 1/1 PROBE concur. Per greg's round-2 expectation: "if all 3 CRITICALs resolved + ≥5 of 7 MEDIUMs folded, ratify-direct" — v0.2 satisfied the ratify-direct condition (3/3 + 7/7 — both thresholds exceeded).

## §11.b Round-2 audit fold summary (NEW v1.0; per mission-67/68/69 round-2 verify discipline)

Engineer round-2 verify (greg; thread-465 round-2; 2026-05-02). **Round-1 fold verification: 15/15 + 5/5 surface checks all confirmed correct ✅.** But **2 NEW findings** caught on v0.2 reading:

| Finding | Class | Architect fold-decision | v1.0 § |
|---|---|---|---|
| N1 | MEDIUM (correctness regression introduced by C1 refactor) | **FOLDED** — drop the spurious `/..` in npm-installed `pkg_root` computation; v0.1 was correct; C1 helper-extraction inadvertently regressed; v1.0 restores correctness | §3.1.b npm-installed branch |
| n1 | MINOR (pseudocode correctness; subshell-variable-leak in `emit_snippet_fallback()`) | **FOLDED** — process substitution `< <(jq ...)` replaces pipe-to-while; preserves outer-scope `first` mutation across iterations so comma-separator triggers correctly; output is valid JSON | §3.4.fallback + §6.1 case 12 NEW (regression-test for the JSON-validity property) |

**Round-2 verdict:** both findings mechanical 1-3 line fixes; folded directly to v1.0 (skipping v0.3 commit per greg's "skip-v0.3-go-to-v1.0 equivalent" offer). Round-3 expectation: greg verifies N1 + n1 folds correct + converges thread-465 + GitHub-side `gh pr review --approve` once PR opens at Phase 8 close.

**v1.0 ratification basis:** 17/17 findings folded across 2 audit rounds (15 round-1 + 2 round-2). Bilateral seal pending greg's round-3 reply.

---

— Architect: lily / 2026-05-02 (Phase 4 Design v1.0 RATIFIED; engineer round-1 + round-2 audits folded — 17 findings total; bilateral seal pending greg's round-3 verify-and-converge per `mission-lifecycle.md` Phase 4 audit cycle)
