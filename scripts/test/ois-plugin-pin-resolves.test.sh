#!/usr/bin/env bash
# bug-428 — THE ois PIN MUST NAME A VERSION THAT EXISTS ON THE REGISTRY.
#
# 🔴 WHY THIS GUARD EXISTS. `ois/bin/ois` pinned CLAUDE_PLUGIN_VERSION=0.1.16 for nine days.
# THAT VERSION WAS NEVER PUBLISHED — the registry goes 0.1.14 -> 0.1.19. So a FRESH SEAT
# COULD NOT BE SEEDED AT ALL, and existing seats survived only via the :291 short-circuit
# ("the installed copy already matches, skip the install").
#
# ⚠️ AND THE FAILURE WAS SILENT IN THE MOST EXPENSIVE WAY. Miss one of the 21 in-repo
# version literals and the BUILD fails loudly with `wrong package version`. Miss THIS one and
# the publish SUCCEEDS while every seat keeps installing the old version, with nothing
# reporting it. A pin is a CLAIM ABOUT THE REGISTRY and no in-repo assertion can check it —
# only the registry can. That is what this test does and why it must be a network check.
#
# ⚠️ It also compounds with bug-429: a seat whose installed copy is destroyed cannot be
# re-seeded, because the short-circuit has nothing left to short-circuit on.
set -euo pipefail

PIN="$(grep -oP '^CLAUDE_PLUGIN_VERSION="\K[^"]+' ois/bin/ois)"
[ -n "$PIN" ] || { echo "FAIL: could not read CLAUDE_PLUGIN_VERSION from ois/bin/ois"; exit 1; }
echo "ois pins @apnex/claude-plugin@${PIN}"

# 1. It must RESOLVE. `npm view <pkg>@<ver> version` prints the version or exits non-zero.
resolved="$(npm view "@apnex/claude-plugin@${PIN}" version 2>/dev/null || true)"
if [ "$resolved" != "$PIN" ]; then
  echo "FAIL: @apnex/claude-plugin@${PIN} does not resolve on the registry (got: '${resolved:-<nothing>}')."
  echo "      A fresh seat cannot be seeded with this pin. See bug-428."
  exit 1
fi

# 2. It must not be DEPRECATED. 0.1.19 is deprecated for failing post-publication
#    qualification; pinning a deprecated version would seed every new seat with it.
dep="$(npm view "@apnex/claude-plugin@${PIN}" deprecated 2>/dev/null || true)"
if [ -n "$dep" ]; then
  echo "FAIL: @apnex/claude-plugin@${PIN} is DEPRECATED: ${dep}"
  exit 1
fi

echo "PASS: @apnex/claude-plugin@${PIN} resolves and is not deprecated"
