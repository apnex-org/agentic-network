#!/usr/bin/env bash
# adapters/claude-plugin/lib/bootstrap-skills.sh — sovereign-Skill bootstrap
# library sourced by adapters/claude-plugin/install.sh (mission-71; idea-230).
#
# Defines:
#   - bootstrap_skills()         orchestrator: walks /skills/<name>/ + invokes
#                                each skill's install.sh + consolidates fragments
#   - merge_skill_permissions()  jq-driven merge of .skill-permissions.json
#                                fragments into ~/.claude/settings.local.json
#   - emit_snippet_fallback()    fallback synth from in-memory fragment data
#                                when target is not writable / unparseable
#
# Required env vars (caller sets before sourcing):
#   - PLUGIN_DIR   absolute path to adapters/claude-plugin/
#   - CONTEXT      "source-tree" or "npm-installed"
#   - REPO_ROOT    repo root in source-tree mode (unset in npm-installed)
#
# Architecture: lib-extracted from install.sh per mission-71 Phase 8 to enable
# unit-testable function-level invocation without running the install main flow.
# install.sh wires this in via `source "$PLUGIN_DIR/lib/bootstrap-skills.sh"`.

# emit_snippet_fallback: synthesize a settings.local.json snippet from in-memory
# fragment data. Used when target is not writable / unparseable.
# n1 fold (round-2 audit): process substitution `< <(jq ...)` keeps `while`
# loop body in outer scope so `first=0` mutation persists across iterations;
# pipe-to-while runs in subshell + variable-leak made comma-separator never
# trigger → malformed JSON.
emit_snippet_fallback() {
  local fragment_paths=("$@")
  echo "" >&2
  echo "[merge-skill-permissions] emitting snippet for manual paste:" >&2
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
  echo "Add the entries above to your existing user-global Claude config under permissions.allow." >&2
}

# merge_skill_permissions: consolidate .skill-permissions.json fragments into
# ~/.claude/settings.local.json. Schema: {schema-version: "1.x", permissions:
# {allow: [...]}}. Major-version-compat (^1.) per M1 fold; exact-string-match
# dedup per M2 (subsumption + self-duplication treated as benign noise; AG-8
# forward-pointer); step 2.5 ensures permissions.allow exists per M4 fold;
# atomic write.
merge_skill_permissions() {
  local fragment_paths=("$@")
  local target="${HOME}/.claude/settings.local.json"

  # Step 1: ensure target exists with proper structure
  mkdir -p "$(dirname "$target")"
  if [ ! -f "$target" ]; then
    echo '{"permissions": {"allow": []}}' > "$target"
  fi

  # Validate target is parseable; if not, fall back to snippet emit
  if ! jq -e . "$target" >/dev/null 2>&1; then
    echo "[merge-skill-permissions] target $target is unparseable JSON; emitting snippet fallback" >&2
    emit_snippet_fallback "${fragment_paths[@]}"
    return 0
  fi

  # Step 2.5 (M4 fold): ensure permissions.allow exists if permissions does
  # but allow key absent (e.g., user has only permissions.deny configured)
  local current
  current="$(jq '
    if .permissions == null then .permissions = {allow: []}
    elif .permissions.allow == null then .permissions.allow = []
    else .
    end
  ' "$target")"

  # Per-fragment merge
  local merged="$current"
  local fragment fragment_data fragment_version entry
  local merged_count=0 skipped_count=0 warned_count=0

  for fragment in "${fragment_paths[@]}"; do
    # Validate fragment is valid JSON
    if ! fragment_data="$(jq -e . "$fragment" 2>/dev/null)"; then
      echo "[merge-skill-permissions] WARN: invalid JSON in $fragment; skipping" >&2
      warned_count=$((warned_count + 1))
      continue
    fi

    # Validate schema-version major (M1 major-version-compat: ^1.)
    fragment_version="$(jq -r '."schema-version" // ""' <<< "$fragment_data")"
    if [[ ! "$fragment_version" =~ ^1\. ]]; then
      echo "[merge-skill-permissions] WARN: unsupported schema major in $fragment (got '$fragment_version'); skipping" >&2
      warned_count=$((warned_count + 1))
      continue
    fi

    # Validate permissions.allow is array
    if ! jq -e '.permissions.allow | type == "array"' <<< "$fragment_data" >/dev/null 2>&1; then
      echo "[merge-skill-permissions] WARN: missing or non-array permissions.allow in $fragment; skipping" >&2
      warned_count=$((warned_count + 1))
      continue
    fi

    # Merge: append entries not already present (exact-string-match dedup per M2)
    while IFS= read -r entry; do
      if jq -e --arg e "$entry" '.permissions.allow | index($e) != null' <<< "$merged" >/dev/null; then
        skipped_count=$((skipped_count + 1))
      else
        merged="$(jq --arg e "$entry" '.permissions.allow += [$e]' <<< "$merged")"
        merged_count=$((merged_count + 1))
      fi
    done < <(jq -r '.permissions.allow[]' <<< "$fragment_data")
  done

  # Atomic write
  local tmp="${target}.tmp.$$"
  if echo "$merged" | jq . > "$tmp" 2>/dev/null && mv "$tmp" "$target"; then
    echo "[merge-skill-permissions] merged: $merged_count entries; skipped: $skipped_count (duplicates); warnings: $warned_count"
  else
    rm -f "$tmp"
    echo "[merge-skill-permissions] write to $target failed; emitting snippet fallback" >&2
    emit_snippet_fallback "${fragment_paths[@]}"
    return 0
  fi
}

# bootstrap_skills: walk /skills/<name>/ + invoke each skill's install.sh +
# consolidate .skill-permissions.json fragments. Source-tree mode: skills_dir
# = REPO_ROOT/skills. npm-installed mode: skills_dir = PLUGIN_DIR/skills
# (assumes @apnex/claude-plugin npm package bundles skills/; post-Phase-8
# verification flag per Design §3.5).
bootstrap_skills() {
  shopt -s nullglob   # M5 fold: empty glob expands to nothing under set -e

  local skills_dir
  if [ "$CONTEXT" = "source-tree" ]; then
    skills_dir="$REPO_ROOT/skills"
  else
    skills_dir="$PLUGIN_DIR/skills"
  fi

  local skills_dirs=("$skills_dir")   # m3 fold: array form (zero-cost future-proof per AG-7)

  if [ ! -d "$skills_dir" ]; then
    echo "[bootstrap-skills] no skills dir found at $skills_dir; skipping"
    return 0
  fi

  local installed=() skipped=() failed=()
  local merged_fragments=()

  local sd skill_dir skill_name
  for sd in "${skills_dirs[@]}"; do
    for skill_dir in "$sd"/*/; do
      skill_name="$(basename "$skill_dir")"
      [ -f "$skill_dir/install.sh" ] || { skipped+=("$skill_name (no install.sh)"); continue; }

      # C2+C3 fold: --target=user (always lands at ~/.claude/skills/; works in
      # source-tree AND npm-installed; matches per-skill default; resolves
      # npm-installed REPO_ROOT bug surfaced in round-1 audit C2)
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

  # Consolidate fragments into ~/.claude/settings.local.json (user-global per C3)
  if [ ${#merged_fragments[@]} -gt 0 ]; then
    merge_skill_permissions "${merged_fragments[@]}"
  fi

  # Summary (with empty-array printf guards per greg's surface check)
  echo "[bootstrap-skills] installed: ${#installed[@]} | skipped: ${#skipped[@]} | failed: ${#failed[@]}"
  [ ${#installed[@]} -gt 0 ] && printf "  ✓ %s\n" "${installed[@]}"
  [ ${#skipped[@]} -gt 0 ]   && printf "  ○ %s\n" "${skipped[@]}"
  [ ${#failed[@]} -gt 0 ]    && printf "  ✗ %s\n" "${failed[@]}"
  return 0   # Explicit — last `[ ... ] && ...` returns 1 when condition false (empty array); `set -e` callers would propagate the spurious 1
}
