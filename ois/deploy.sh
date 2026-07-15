#!/usr/bin/env bash
#
# ois/deploy.sh — install the canonical ois (ois/bin/ois, the source of truth)
# to the Director's workstation live path, with a pre-overwrite backup.
#
#   ./ois/deploy.sh          install to ~/.config/apnex-agents/bin/ois
#   ./ois/deploy.sh --diff   show canonical-vs-live diff, change nothing
#
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bin/ois"
DEST="$HOME/.config/apnex-agents/bin/ois"

# bug-247: the interactive-prompt resolver lib + its handler table are part of the staged
# surface. They co-ship with any ois that references them (the resolver is sourced beside
# bin/ois; the table is read from config/). See the co-deploy guard + install blocks below.
RESOLVER_SRC="$(dirname "$SRC")/../../deploy/adapter-image/prompt-resolve.sh"
HANDLERS_SRC="$(dirname "$SRC")/../../deploy/adapter-image/prompt-handlers.json"
RESOLVER_DEST="$HOME/.config/apnex-agents/bin/prompt-resolve.sh"
HANDLERS_DEST="$HOME/.config/apnex-agents/config/prompt-handlers.json"
PI_HARNESS_CONFIG_SRC="$(dirname "$SRC")/../../config/harnesses/pi.json"
PI_HARNESS_CONFIG_DEST="$HOME/.config/apnex-agents/config/harnesses/pi.json"

[[ -f "$SRC" ]] || { echo "error: canonical source not found at $SRC" >&2; exit 1; }
bash -n "$SRC" || { echo "error: canonical source fails bash -n; refusing to deploy" >&2; exit 1; }
# work-160: content guard — deploy.sh ships whatever bin/ois is next to it, so a STALE
# (unpulled) checkout would silently ship an old ois and persist nothing. Refuse unless
# the source carries the claudeSettings reader (the marker of the current config-driven
# claude-defaults wiring). NB: the claudeSettings VALUES live in the separate config repo
# (config/harnesses/claude.json) — verify those are present at deploy time too, else the
# reader defaults to {} and seeds nothing.
grep -q 'claudeSettings' "$SRC" || { echo "error: deploy source lacks the claudeSettings reader — stale ois? pull main or deploy from the worktree with the code. Refusing to deploy." >&2; exit 1; }
# bug-272: pi settings/models policy is config, not inline script or implicit ~/.pi/agent.
# This deployable surface must co-ship the repo-side harness config into live OIS /config,
# because bin/ois reads $HOME/.config/apnex-agents/config at runtime.
[[ -f "$PI_HARNESS_CONFIG_SRC" ]] || { echo "error: missing repo pi harness config at $PI_HARNESS_CONFIG_SRC — refusing to deploy pi settings/models renderer without its config source" >&2; exit 1; }
jq -e '.piSettings.theme == "dark" and .piSettings.defaultProvider == "openai-codex" and .piSettings.defaultModel == "gpt-5.5" and .piSettings.defaultThinkingLevel == "xhigh" and .piSettings.terminal.showTerminalProgress == true and ((.piSettings.packages // []) | index("npm:pi-tool-display")) != null and ((.piSettings.packages // []) | index("npm:pi-web-access")) != null and .piSettings.compaction.enabled == true and (.piSettings.compaction.reserveTokens | type == "number") and (.piSettings.compaction.keepRecentTokens | type == "number") and .piModels.providers["openai-codex"].modelOverrides["gpt-5.5"].contextWindow == 400000' "$PI_HARNESS_CONFIG_SRC" >/dev/null || { echo "error: repo pi harness config lacks required piSettings/piModels fleet policy — refusing to deploy" >&2; exit 1; }
# bug-247 co-deploy guard: if THIS ois sources the resolver, its lib + table MUST co-ship.
# The new ois moved the dev-channels-banner handler (which seat-launch depends on) out of a
# hardcoded branch and INTO the table — so shipping the ois without them would silently hang
# every claude seat. Fail-closed on a stale/partial checkout; unaffected for a pre-bug247 ois.
if grep -q 'prompt-resolve.sh' "$SRC"; then
  [[ -f "$RESOLVER_SRC" ]]  || { echo "error: ois references prompt-resolve.sh but source missing at $RESOLVER_SRC — stale/partial checkout? Refusing to deploy." >&2; exit 1; }
  [[ -f "$HANDLERS_SRC" ]]  || { echo "error: ois needs prompt-handlers.json but source missing at $HANDLERS_SRC — refusing to deploy." >&2; exit 1; }
  bash -n "$RESOLVER_SRC"   || { echo "error: prompt-resolve.sh fails bash -n; refusing to deploy" >&2; exit 1; }
  jq empty "$HANDLERS_SRC" 2>/dev/null || { echo "error: prompt-handlers.json is not valid JSON; refusing to deploy" >&2; exit 1; }
fi

if [[ "${1:-}" == "--diff" ]]; then
  diff -u "$DEST" "$SRC" && echo "live bin/ois is identical to canonical" || true
  # work-179 (Arc-1 S4): the preflight must also cover the skill-sync manifest —
  # bin/ois alone is not the whole staged surface. Shows the manifest (incl. the
  # pinned source_ref) the Director is about to activate.
  MSRC="$(dirname "$SRC")/../manifests/skill-sync/wanted-bundles.yaml"
  MDEST="$HOME/.config/apnex-agents/manifests/skill-sync/wanted-bundles.yaml"
  if [[ -f "$MSRC" ]]; then
    echo "--- skill-sync manifest diff ---"
    diff -u "$MDEST" "$MSRC" && echo "live skill-sync manifest is identical to canonical" || true
  fi
  # bug-247: the resolver lib + handler table are part of the staged surface too.
  if [[ -f "$RESOLVER_SRC" ]]; then
    echo "--- prompt-resolve.sh diff ---"
    diff -u "$RESOLVER_DEST" "$RESOLVER_SRC" && echo "live prompt-resolve.sh is identical to canonical" || true
  fi
  if [[ -f "$HANDLERS_SRC" ]]; then
    echo "--- prompt-handlers.json diff ---"
    diff -u "$HANDLERS_DEST" "$HANDLERS_SRC" && echo "live prompt-handlers.json is identical to canonical" || true
  fi
  echo "--- config/harnesses/pi.json diff ---"
  diff -u "$PI_HARNESS_CONFIG_DEST" "$PI_HARNESS_CONFIG_SRC" && echo "live pi harness config is identical to canonical" || true
  exit 0
fi

mkdir -p "$(dirname "$DEST")"
if [[ -f "$DEST" ]]; then
  # Collision-safe backup (audit-10371): a timestamp alone clobbers when two
  # deploys land in the same second — probe for a free name with a numeric
  # suffix, and copy no-clobber so a racing deploy can never eat a backup.
  STAMP="$(date +%Y%m%d-%H%M%S)"
  BAK="$DEST.bak-$STAMP"
  n=1
  while [[ -e "$BAK" ]]; do BAK="$DEST.bak-$STAMP.$n"; n=$((n+1)); done
  cp -p -n "$DEST" "$BAK" && [[ -e "$BAK" ]] || { echo "error: backup failed (refusing to overwrite live copy without one)" >&2; exit 1; }
  echo "backed up live copy -> $BAK"
fi
install -m 0755 "$SRC" "$DEST"
echo "deployed $SRC -> $DEST"

# work-179 (Arc-1 S4): ship the claude/ois skill-sync manifest alongside bin/ois.
# The HCAP skills-consumer (claude_seed, fleetskills0/idea-505) reads
# $ROOT/manifests/skill-sync/wanted-bundles.yaml; absent it no-ops. Non-fatal if absent.
MANIFEST_SRC="$(dirname "$SRC")/../manifests/skill-sync/wanted-bundles.yaml"
MANIFEST_DEST="$HOME/.config/apnex-agents/manifests/skill-sync/wanted-bundles.yaml"
if [[ -f "$MANIFEST_SRC" ]]; then
  mkdir -p "$(dirname "$MANIFEST_DEST")"
  install -m 0644 "$MANIFEST_SRC" "$MANIFEST_DEST"
  echo "deployed $MANIFEST_SRC -> $MANIFEST_DEST"
else
  echo "note: no skill-sync manifest at $MANIFEST_SRC (skill-sync will no-op until present)"
fi

# bug-247: co-ship the interactive-prompt resolver lib (beside bin/ois, where ois sources it)
# + the handler table (config/, where ois reads it). Guarded above to co-deploy with any ois
# that references them — so a claude seat's dev-channels banner is always auto-accepted.
mkdir -p "$(dirname "$PI_HARNESS_CONFIG_DEST")"
install -m 0644 "$PI_HARNESS_CONFIG_SRC" "$PI_HARNESS_CONFIG_DEST"
echo "deployed $PI_HARNESS_CONFIG_SRC -> $PI_HARNESS_CONFIG_DEST"

if grep -q 'prompt-resolve.sh' "$SRC"; then
  install -m 0755 "$RESOLVER_SRC" "$RESOLVER_DEST"
  echo "deployed $RESOLVER_SRC -> $RESOLVER_DEST"
  mkdir -p "$(dirname "$HANDLERS_DEST")"
  install -m 0644 "$HANDLERS_SRC" "$HANDLERS_DEST"
  echo "deployed $HANDLERS_SRC -> $HANDLERS_DEST"
fi

echo "verify: ois doctor"
