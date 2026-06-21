# C2 W0 — Agent-Lifecycle Capability + Fidelity Matrix (SPIKE)

**Status:** IN PROGRESS — Claude-side legs probed by lily (architect, own harness); OpenCode-side pending Steve (verifier, thread-682).
**Date:** 2026-06-21 · **Gate for:** C2 (Agent-Lifecycle Substrate) graduation — the whole arc gates on this matrix.
**D-2 four legs:** (a) read remaining-context [measurability] · (b) trigger compaction externally [actuation] · (c) containerise + run headless under a supervisor with identity re-claim [restartability] · (d) route the trigger via Hub/peer [closed loop].
**Vocabulary:** GREEN (proven reachable) · AMBER (reachable via a non-MCP channel, NOT via the MCP adapter — the shim is a guest) · RED (unreachable → forks a fallback).

---

## Matrix

| Leg | Claude Code (lily/greg) | OpenCode/Bun (Steve) |
|---|---|---|
| **(a) report remaining-context** | **GREEN (statusline channel)** | _pending Steve — report-context_ |
| **(b) trigger/request compaction** | **AMBER** | _pending Steve — request-compaction_ |
| **(c) headless + supervisor + reclaim** | **GREEN** | _pending Steve — (containerised reclaim)_ |
| **(d) route trigger via Hub/peer** | **GREEN (design-level)** | _pending Steve — export-handoff / import-resume_ |

## Claude-side findings (ground-truthed 2026-06-21)

### (a) Context-readout — GREEN via the statusline stdin JSON
Claude Code pipes a rich JSON to the statusline command (`~/.claude/statusline.sh`) on every render: `.context_window.context_window_size`, `.context_window.used_percentage`, and `.rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}`. The existing statusline already computes used/total/pct + a burn-ratio + projected-exhaustion. **Implication for L1:** the runway gauge is buildable NOW at **measured fidelity** (not heuristic) — wrap/tee the statusline JSON to a Hub telemetry sink. BONUS: the same channel carries 5h/7d rate-limit burn — fold into the runway gauge. **CAVEAT:** the channel is the *statusline command's stdin*, NOT the MCP adapter — the shim (a guest inside the harness) does not receive it. So L1 captures via a statusline wrapper, never via the MCP shim. (Confirms the C2 design's a/d-green, b/c-amber-via-those-channels, NOT-the-adapter framing.)

### (b) External compaction trigger — AMBER
- stdin `/compact` inject: works for an **interactive long-lived** `claude` session (it reads stdin slash-commands) → can INITIATE compaction. NOT clean for headless `claude -p` (no interactive stdin loop; `--input-format stream-json` is a different path).
- PreCompact **hook**: hooks ARE supported (`--include-hook-events`, `--bare` skips them, hooks in the load-list); a PreCompact hook **INTERCEPTS** an already-occurring compaction (ideal for **L2 continuity-capture** — snapshot state at compaction) but does **NOT INITIATE** one. No PreCompact hook is configured in settings today (`hooks` key absent) — L2 would add one.
- No `--compact`/programmatic-external-trigger flag exists in the CLI surface.

### (c) Headless + supervisor + reclaim — GREEN
`claude -p`/`--print` (headless) + `-c/--continue` + `--resume` + `--fork-session` + `--no-session-persistence` + `--from-pr` + `--input-format stream-json`. A supervisor can spawn/continue/resume a headless session; ADR-021 session-claim displacement supplies Hub-identity reclaim. Containerisable under the watchtower/systemd reconcile pattern.

### (d) Hub/peer-routed trigger — GREEN (design-level)
A supervisor OUTSIDE the harness subscribes to the Hub over LISTEN/NOTIFY+SSE and actuates the lifecycle directive — feasible; depends on (c). No probe blocker.

## ⚠️ Central finding — the mutual-exclusivity tension is REAL (Claude-side)
Legs (a) + (b) favor the **long-lived interactive** model (has a statusline; accepts stdin `/compact`). Leg (c) favors **headless `claude -p`** (restarts/resumes cleanly). These pull apart: the *measurable + externally-compactable* model and the *cleanly-restartable* model are not obviously the same process shape. This is exactly the C2-design-flagged W0 risk, now **confirmed on the Claude side**. It is the data for C2's **execution-model-priority** decision (which the C2 Survey will pose to the Director): prioritize restartability (headless) or measurability+in-place-compaction (interactive), and is a vendor feature-request (a programmatic compaction trigger for `-p`, or a context-readout for headless) the path to unify them?

**Provisional Claude-side resolution candidate (for C2 Design):** run the long-lived **interactive `claude` in a container** as the production shape (keeps statusline-measurability + stdin-`/compact`), and use container recreate (docker = supervisor, per D-2) for the restart leg rather than `-p` — i.e. infra-driven restart of an interactive session, not a headless loop. To validate against (c)'s reclaim. Steve's OpenCode matrix may push this either way.

## Next
- Steve fills the OpenCode column (thread-682) → matrix complete → C2 graduation verdict + the execution-model fork goes to the C2 Survey.
- L1 mechanism is de-risked GREEN (statusline-tee); L2 capture path is the PreCompact hook; the open fork is the L3/L4 execution-model.
