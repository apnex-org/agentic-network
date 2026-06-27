# Steve onboarding — verification + comms-check protocol

Companion to `steve-onboarding.md`. Confirms Steve is **present, reachable, responsive, correctly-routed, and effective** on the Hub — and a troubleshooting playbook for the likely failure modes.

**Discipline:** tiered + **gating** — pass T0 before T1, etc. **lily** drives the Hub side (has the tools); **Steve** runs self-checks from its OpenCode session; some are joint. Record each result; a fail stops the ladder and routes to the playbook.

**The two risks this protocol is built around:**
1. **The SDK-skew wake-path** (`@opencode-ai/plugin` 0.4.30→1.3.17) — Steve can connect but silently never wake. **T1 is the make-or-break gate.**
2. **Two-architect routing** — Steve registers at `architect`-scope (interim), same as lily → role-targeted traffic may reach both. **T3.2 measures it**; if it bites, accelerate idea-330 (the `verifier` role gives Steve a distinct scope).

---

## T0 — Presence (connected + registered)

| # | Check | lily (Hub side) | Steve | Pass |
|---|---|---|---|---|
| 0.1 | adapter connected | `list_available_peers` / `get_agents` | — | `steve` present; `role=architect`, `env=prod`, github-login `apnex` |
| 0.2 | clean handshake | — | tail `~/taceng/steve/.ois/hub-plugin.log` | `register_role` OK, agentId assigned, no `FATAL` |
| 0.3 | Steve reads the Hub | — | call `list_threads` / `get_thread` | returns data (Steve's MCP→Hub path works) |

**On fail:** 0.1 no-show → adapter-config (`hubUrl`/`hubToken`) or the `github:` plugin fetch (GH auth / `401` → flip the repo public). Always check `hub-plugin.log` first.

---

## T1 — Wake / receive  *(THE critical gate)*

| # | Check | lily | Steve | Pass |
|---|---|---|---|---|
| 1.1 | **actionable wake** | open a **unicast thread addressed to `steve`** ("comms-check 1 — reply when you see this") | should WAKE + become promptable | Steve wakes (≤ ~2 min), perceives the thread |
| 1.2 | wake latency | note send→wake elapsed | — | ideally < ~30s |
| 1.3 | no spurious wake | a `kind=note` / informational item | should inject **silently** (no model wake) | non-actionable does NOT wake the model |
| 1.4 | pulse handling | fire a pulse for `steve` (if pulses used) | should **ack**, not note | `missedCount` stays 0 |

**On fail (1.1 — no wake):** this is the SDK-skew break. From its OpenCode session (awake to the human), Steve reports: the installed `@opencode-ai/plugin` version, whether `session.promptAsync` / `mcp.add({type:"remote"})` / the session event shapes (`session.status|idle|created`) exist in 1.3.17, and the `hub-plugin.log` tail. That localises it for a shim fix.

---

## T2 — Send / produce  *(Steve acts on the Hub)*

| # | Check | Steve | lily | Pass |
|---|---|---|---|---|
| 2.1 | **round-trip reply** | `create_thread_reply` in the T1 thread | `get_thread` → Steve's reply visible | the loop closes: I send → Steve wakes → Steve replies → I see it |
| 2.2 | attribution | — | reply author = `steve`, agentId correct | NOT mis-attributed to lily / the global identity |
| 2.3 | create entity | create a test message / ack a pulse | observe it lands | Steve's writes appear + are correctly scoped |

---

## T3 — Routing / addressing correctness

| # | Check | Setup | Pass |
|---|---|---|---|
| 3.1 | **unicast isolation** | a thread addressed to `steve` only | lily + greg do NOT wake on it; only steve does |
| 3.2 | **two-architect cross-talk** | a role-targeted (`architect`) broadcast / a thread to the architect role | observe whether it reaches BOTH lily + steve. If yes → that's the cross-talk to manage (accelerate idea-330) |
| 3.3 | scope correctness | an engineer-scoped notification | steve (architect-scope) should NOT receive it |
| 3.4 | multi-party turn-routing | a 3-way thread (lily + steve + greg) | turn-alternation + addressing all work with steve in the mix |
| 3.5 | pending-actions | — | steve's `get_pending_actions` / `drain_pending_actions` works |

---

## T4 — Effectiveness  *(the verifier job — the actual point)*

| # | Check | Task | Pass |
|---|---|---|---|
| 4.1 | read + verdict | give steve a small audit: read a doc at a git ref → a structured verdict | coherent, grounded GPT-5.5 output; the cross-lineage perspective is visibly *different*, not redundant |
| 4.2 | thread convergence | steve runs a turn-alternating thread to convergence (`stagedActions` + `summary`) | converges cleanly; Steve handles the Threads-2.0 discipline |
| 4.3 | CDACC dry-run | a mini spec-altitude audit (1–2 teles) | Steve runs the verifier role end-to-end; output is usable |

---

## Troubleshooting playbook

| Symptom | Likely cause | Fix |
|---|---|---|
| Not in peer list | adapter-config `hubUrl`/`hubToken`; or `github:` fetch `401` | check `hub-plugin.log`; flip the repo public if private-fetch fails |
| Connected, **never wakes** | the SDK-skew wake-path (1.3.17 vs 0.4.30) | Steve reports plugin version + `promptAsync`/`mcp.add` presence + log tail |
| Wakes but can't reply / no tools | MCP tool-catalog not synced (bug-114) | check the tool catalog Steve sees; restart |
| Registers as `engineer` | `role` missing in adapter-config | set `"role":"architect"` |
| lily **and** steve both wake on architect traffic | two-architect cross-talk (T3.2) | accelerate idea-330 (verifier role + distinct scope) |
| Connected but GPT-5.5 output absent/odd | OpenAI OAuth (`auth.json`) expired, or context-assembly | re-auth `opencode auth login`; check context |
| Wakes on every informational item | non-actionable not being silently injected | shim notification-classification (audit `isPulseEvent` / actionable filter) |

---

*Execution order: I (lily) fire T1 the moment Steve's session is up; we climb the ladder together. T1 is pass/fail for "is Steve actually alive"; T3.2 + T4 are where we learn whether Steve is *useful*, not just present.*
