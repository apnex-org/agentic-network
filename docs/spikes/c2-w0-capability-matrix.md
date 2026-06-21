# C2 W0 — Agent-Lifecycle Capability + Fidelity Matrix (SPIKE)

**Status:** COMPLETE — Claude-side probed by lily (architect, own harness); OpenCode-side probed by Steve (verifier, audit-3950). **C2-W0 GRADUATES: no RED on either harness → C2 (Agent-Lifecycle Substrate) is feasible on both runtimes.**
**Date:** 2026-06-21 · **Gate for:** C2 (Agent-Lifecycle Substrate) graduation — the whole arc gates on this matrix.
**D-2 four legs:** (a) read remaining-context [measurability] · (b) trigger compaction externally [actuation] · (c) containerise + run headless under a supervisor with identity re-claim [restartability] · (d) route the trigger via Hub/peer [closed loop].
**Vocabulary:** GREEN (proven reachable) · AMBER (reachable via a non-MCP channel, NOT via the MCP adapter — the shim is a guest) · RED (unreachable → forks a fallback).

---

## Matrix

| Leg | Claude Code (lily/greg) | OpenCode/Bun (Steve — audit-3950) |
|---|---|---|
| **(a) report remaining-context** | **GREEN (statusline channel)** | **AMBER** — data in the **DB** (session/message token counters) + SDK `AssistantMessage.tokens` + live `/provider` limits, but **no first-class field**; surfacing it needs **custom shim code** (Director-confirmed) |
| **(b) trigger/request compaction** | **AMBER** | **GREEN** — `POST /session/{id}/summarize` + SDK `session.summarize` + TUI `session.compact` + plugin hook `experimental.session.compacting` |
| **(c) headless + supervisor + reclaim** | **GREEN** | **AMBER** — Docker/headless "plausible but unproven from this host" (thread-680); reclaim needs an explicit identity-reattach invariant. Continuity-record half is GREEN (export/import below) |
| **(d) route trigger via Hub/peer** | **GREEN (design-level)** | **GREEN** — `opencode export --sanitize` (handoff) + `opencode import` (resume) both proven; routed over the existing Hub LISTEN/NOTIFY+SSE Steve already consumes |

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

## OpenCode-side findings (Steve/verifier, audit-3950, against live OpenCode/Bun)

### (a) Context-readout — AMBER (DB-resident; needs custom shim code)
OpenCode exposes enough runtime data to *compute* a latest-call estimate, but **no first-class exact remaining-context field**. Evidence: **DB session/message token counters**, SDK `AssistantMessage.tokens`, and live `/provider` model limits. Active provider `openai/gpt-5.5` reports context=400000 / input=272000 / output=128000; latest non-empty assistant call total=49559 (input=3570, cache_read=45568) → estimated latest-call remaining ≈ 350k before the configured reserve. Session cumulative counters are aggregate, not current-window usage.
- **Director-confirmed (2026-06-21):** the context figure **lives in the OpenCode DB** and surfacing it as a clean signal **requires custom code in the shim** — a wrapper that reads the DB token counters (+ `/provider` limits) and computes remaining-context. This is the AMBER→effective-GREEN path for OpenCode L1.

### (b) External compaction trigger — GREEN
`POST /session/{sessionID}/summarize` (providerID / modelID / auto) exists; SDK exposes `session.summarize`; the TUI command vocabulary includes `session.compact`; the plugin hook `experimental.session.compacting` exists. Steve route-probed with an invalid session and got the expected 404 after payload validation (did NOT compact the live session). **This is the leg OpenCode wins on** — Claude-side (b) is AMBER (no programmatic `-p` trigger), OpenCode-side (b) is GREEN (a host-native compaction RPC).

### (c)/(d) Continuity record — GREEN (export + import both proven)
- **export-handoff:** `opencode export [sessionID] --sanitize` produced a structured continuity JSON for the live session — 360823 bytes, `info` + 88 messages.
- **import-resume:** `opencode import <file>` rehydrated the sanitized export into an isolated `XDG_DATA_HOME`; DB verification showed 88 distinct messages + 469 parts. Resume path: `opencode run --session <id>` / `opencode attach --session <id>`.
- The **headless-supervisor process-shape itself** (leg c restartability) stays AMBER-unproven from Steve's host (thread-680): Docker/headless "plausible but unproven"; reclaim needs an explicit same-named-identity-reattach invariant. The *continuity record* (the hard part) is GREEN; the *process shape* is the open fork — the same mutual-exclusivity tension found Claude-side.

## ⚖️ C2-W0 GRADUATION VERDICT — PASS (both harnesses feasible)

No RED on either runtime → **C2 (Agent-Lifecycle Substrate) graduates.** The harnesses are *complementary*: Claude wins (a) context-readout (GREEN statusline), OpenCode wins (b) compaction (GREEN host-native RPC) + (c/d) export/import continuity (GREEN). Each is AMBER exactly where the other is GREEN.

**Symmetric structural finding (both harnesses):** surfacing remaining-context is **never via the MCP adapter/shim's tool surface** — Claude reads it from the *statusline command's stdin JSON* (a wrapper), OpenCode reads it from the *session DB* (custom shim code, Director-confirmed). So **C2-L1's context-runway gauge is a per-host wrapper/sidecar that reads a host-native channel and tees to a Hub telemetry sink** — it is NOT an MCP-shim capability on either side. This is the load-bearing L1 mechanism decision, and it dovetails with **D-3 (idea-343, centralised agent telemetry):** the same per-host wrapper that surfaces context is the natural emit-point for LLM-API-call volume + error-counts (503/429) + quota.

## Next
- L1 mechanism decided: **per-host context-wrapper → Hub telemetry sink** (statusline-tee on Claude; DB-read shim code on OpenCode). De-risked GREEN both sides.
- L2 capture path: the PreCompact hook (Claude) / `experimental.session.compacting` hook (OpenCode).
- **Open fork → C2 Survey:** the L3/L4 **execution-model** (restartability-vs-measurability process shape) — unresolved on BOTH harnesses (the mutual-exclusivity tension); this is the genuine Director-survey question, now confirmed cross-adapter.
