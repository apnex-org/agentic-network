# M-Agent-Entity-Revisit — Design v0.2 (round-2; pending v1.0 ratification)

**Status:** v0.2 (architect+engineer round-1 audit incorporated; round-2 architect ratifications applied; awaiting engineer round-2 ratify for v1.0 promotion)
**Anchor:** `docs/designs/m-agent-entity-revisit-survey.md` (Director picks Q1: B+C+D, Q2: B+C+D, Q3: A+D, Q4: A+D+naming-refinement, Q5: B, Q6: A+B+C+D)
**Idea:** idea-215 (subsumes idea-106; cascade-includes today's note-kind primitive surface gap Idea)
**Mission class:** structural-inflection with substrate-cleanup-waves nested
**Sizing:** L baseline (~1.5-2 engineer-weeks); XL escalation realistic if vertex-cloudrun HTTP-transport gets wired this mission
**Tele primaries:** tele-7 Resilient Operations + tele-3 Absolute State Fidelity + tele-6 Deterministic Invincibility; tele-2 tertiary

---

## §1 Goal

Restructure the Hub's Agent entity into a coherent, queryable, live operational substrate that any connected agent can read symmetrically. Replace `engineerId` with `agent.id` (internal) + `agentId` (cross-references); expand the field set with name, IP, durations, FSM-status; introduce a 5-state activity FSM **alongside** the existing 4-state liveness FSM (orthogonal axes per round-1 audit); ship a pull primitive + SSE-push event for cache-coherence; rebase bug-35 presence projection on the unified state model; close the note-kind primitive surface gap at the same connection-layer cohesion; and synchronize Hub source + bundled SDK tgz to prevent Layer-3-style stale-tgz drift. One atomic PR for Hub+SDK; one for adapter sweep; dogfood + audit as architect-owned waves.

---

## §2 Entity schema (final)

```ts
interface Agent {
  // Identity
  id: string;                          // "agent-XXXX" (renamed from engineerId)
  name: string;                        // "lily" / "greg" / "kate" / "tom" — set via OIS_INSTANCE_ID env
  role: "architect" | "engineer" | "director" | "system";
  labels: Record<string, string>;      // {env: "prod", ...} — extensible

  // Liveness (existing health-decay FSM; per ADR-017 INV-AG6; KEPT)
  livenessState: LivenessState;        // "online" | "degraded" | "unresponsive" | "offline"

  // Activity (new tool-call-driven FSM; this mission)
  activityState: ActivityState;        // "offline" | "online_idle" | "online_working" | "online_quota_blocked" | "online_paused"

  // Session
  sessionId: string | null;            // current session UUID; null when offline
  sessionEpoch: number;                // monotonic; advances on session-claim
  sessionStartedAt: string | null;     // ISO; current session start (distinct from firstSeenAt)
  firstSeenAt: string;                 // ISO; first-ever connection
  lastSeenAt: string;                  // ISO; last SSE-stream activity (rate-limited 30s by touchAgent)

  // Activity tracking
  lastToolCallAt: string | null;       // ISO; un-rate-limited (every tool call)
  lastToolCallName: string | null;     // tool name; null if no calls this session
  idleSince: string | null;            // ISO; when activityState transitioned idle (null if working / offline)
  workingSince: string | null;         // ISO; when current tool call started (null if idle / offline)
  quotaBlockedUntil: string | null;    // ISO; when quota_blocked auto-promotes to online_idle (null if not blocked)

  // Current work (derived-on-read; see §11.1)
  currentMissionId: string | null;     // mission with most recent un-completion-acked queue item targeting this agent
  currentTaskId: string | null;        // task with assignedAgentId === this.id && status !== "completed"
  currentThreadId: string | null;      // thread with currentTurnAgentId === this.id && status === "active"

  // Adapter / client
  adapterVersion: string;              // unified e.g. "@apnex/network-adapter@2.1.0"
  clientMetadata: {                    // raw split (kept for troubleshooting)
    clientName: string;
    clientVersion: string;
    proxyName: string;
    proxyVersion: string;
    sdkVersion: string;
    hostname: string;
    platform: string;
    pid: number;
  };
  ipAddress: string | null;            // populated from socket peer addr at SSE-stream-open (Hub-side derived; not adapter-supplied)

  // Stability + diagnostics
  restartCount: number;                // sessionEpoch bumps within rolling 24h window
  recentErrors: AgentErrorRecord[];    // FIFO ring buffer; cap=10
}

type LivenessState =
  | "online"
  | "degraded"
  | "unresponsive"
  | "offline";

type ActivityState =
  | "offline"
  | "online_idle"
  | "online_working"
  | "online_quota_blocked"
  | "online_paused";

interface AgentErrorRecord {
  at: string;                          // ISO timestamp
  toolCall: string;                    // tool that errored
  errorClass: string;                  // categorical (e.g. "timeout", "validation", "auth", "internal")
  message: string;                     // truncated free-form
}
```

### Naming convention (final per Survey Q4 + round-2 ratify)

- **Inside the entity**: `id` (Mission has `id: "mission-61"`, Thread has `id: "thread-387"`, etc.)
- **Cross-reference from another entity**: `<entity>Id` (`correlationId`, `sourceThreadId`, `currentMissionId`, `assignedAgentId`)
- **Existing `livenessState` semantics preserved** (per round-2 architect counter accepted): no churn on ADR-017 INV-AG6 references; the existing 4-state health-decay FSM keeps its name. Activity FSM gets a new name `activityState` (read: "what is the agent doing right now").

### Field-tracking implementation (per round-1 audit)

- **`name`**: already plumbed at adapter handshake; needs Hub-side persistence at handshake completion
- **`labels`**: already exists
- **`livenessState`**: existing (`hub/src/state.ts:195` + `:1164-1175`); preserved
- **`activityState`**: new; populated by handshake (initial = `online_idle`) + explicit `signal_working_*` RPCs (per §5)
- **`sessionStartedAt` vs `firstSeenAt`**: distinct semantics; introduce `sessionStartedAt` at handshake (current session start)
- **`lastToolCallAt` / `lastToolCallName`**: new dual-hook into `touchAgent` call-path:
  - Existing rate-limited (30s) hook for `lastSeenAt` (unchanged)
  - New un-rate-limited hook for `lastToolCallAt` + `lastToolCallName` (every call; cheap)
- **`idleSince` / `workingSince`**: derive from `activityState` transition timestamp
- **`quotaBlockedUntil`**: stamped on `signal_quota_blocked` RPC; auto-promote on next-touch when elapsed
- **`currentMissionId/TaskId/ThreadId`**: derive-on-read (§11.1 confirms cheap O(1) projections off existing entity stores)
- **`ipAddress`**: Hub-side derived from socket peer addr at SSE-stream-open (security: NOT adapter-supplied)
- **`restartCount`**: 24h rolling-window count of sessionEpoch bumps; persist a small ring of bump timestamps (cap 50 for safety); window-filter on get_agents read
- **`recentErrors`**: cap=10, FIFO ring buffer

---

## §3 FSMs (orthogonal axes)

### §3.1 Liveness FSM (existing; preserved per ADR-017 INV-AG6)

| State | Meaning | Computation |
|---|---|---|
| `online` | Agent's last heartbeat ≤ 2× receiptSla threshold | `computeLivenessState` at `hub/src/state.ts:1164-1175` |
| `degraded` | Heartbeat 2-4× receiptSla threshold; routable but watchdog-prioritized | same |
| `unresponsive` | Heartbeat > 4× receiptSla threshold; not routable; escalation candidate | same |
| `offline` | Explicit teardown (sticky; doesn't auto-decay back) | same |

**No changes to liveness FSM in this mission.** It continues to be heartbeat-driven, computed, ADR-017-governed.

### §3.2 Activity FSM (new; this mission)

| State | Meaning |
|---|---|
| `offline` | No SSE stream open; activity tracking suspended. **Auto-clamped to `offline` when `livenessState !== "online"`** (cheap derive; routing-eligibility check works correctly). |
| `online_idle` | SSE stream open; no tool call in flight; agent is "available" for work assignment. |
| `online_working` | SSE stream open; tool call in flight (between `signal_working_started` + `signal_working_completed`). |
| `online_quota_blocked` | Adapter signaled `quota_blocked` (per idea-109). Rate-limited; not routable but not dead. |
| `online_paused` | Agent explicitly signaled pause (debug, manual hold). **Schema-only this mission; no transitions wired.** Reserved for future use. |

### §3.3 Activity FSM transitions

```
                              ┌─────────────────┐
                              │     offline     │
                              └─┬───────────────┘
                                │ (handshake complete; livenessState=online)
                                ▼
                  ┌────────► online_idle ◄───────────┐
                  │                                  │
                  │ signal_working_started(toolName) │ signal_working_completed()
                  │                                  │
                  ▼                                  │
            online_working ───────────────────────────┘

  online_working ──signal_quota_blocked(retryAfterSec)──► online_quota_blocked
  online_quota_blocked ──signal_quota_recovered() OR quotaBlockedUntil elapsed──► online_idle

  any(online_*) ──SSE stream closed OR livenessState decays past unresponsive──► offline
```

**Auto-clamp invariant:** `livenessState !== "online"` → `activityState = "offline"`. Cheap projection; resolves the cross-FSM coherence on routing-eligibility check.

### §3.4 Routing eligibility (final)

```ts
const isRoutable = (agent: Agent) =>
  agent.livenessState === "online" && agent.activityState === "online_idle";
```

`degraded` agents are not routable for new work but receive escalation pings; `unresponsive` triggers Director notification per ADR-017 watchdog.

### §3.5 bug-35 closure

`selectAgents` migration: replace inferred-from-heartbeat-or-status with `livenessState === "online"` (already uses this today; pure clarity-pass — no behavior change). bug-35 closes on landing.

### §3.6 idea-109 composability

The new `online_quota_blocked` state is the FSM expression of the signal idea-109 already proposes. `signal_quota_blocked(retryAfterSec)` RPC fires the transition; Hub stamps `quotaBlockedUntil`. idea-109 may need a small revise-pass to align field name with the FSM transition wiring. No tension; clean compose.

### §3.7 idea-106 subsumption

Closes on landing. idea-106's wakeEndpoint-optional routing test case at `hub/test/unit/agent-repository.test.ts` — engineer to preserve verbatim under the new schema.

---

## §4 Live-query surface (pull + SSE-push)

### §4.1 Pull primitive — `get_agents`

Replaces `get_engineer_status` outright. Director-suggested name `get_agents` (final form may evolve under idea-121).

#### Zod schema (final)

```ts
const GetAgentsInputSchema = z.object({
  filter: z.object({
    role: z.union([
      z.enum(["architect","engineer","director","system"]),
      z.array(z.enum(["architect","engineer","director","system"]))
    ]).optional(),
    livenessState: z.union([
      z.enum(["online","degraded","unresponsive","offline"]),
      z.array(z.enum(["online","degraded","unresponsive","offline"]))
    ]).optional(),
    activityState: z.union([
      z.enum(["offline","online_idle","online_working","online_quota_blocked","online_paused"]),
      z.array(z.enum(["offline","online_idle","online_working","online_quota_blocked","online_paused"]))
    ]).optional(),
    label: z.record(z.string(), z.string()).optional(),  // match-all
    currentMissionId: z.string().optional(),
    agentId: z.union([z.string(), z.array(z.string())]).optional(),
  }).optional(),
  fields: z.array(z.enum([
    "identity",   // id+name+role+labels
    "session",    // sessionId+sessionEpoch+sessionStartedAt+firstSeenAt+lastSeenAt
    "fsm",        // livenessState+activityState+idleSince+workingSince+quotaBlockedUntil+lastToolCallAt+lastToolCallName+currentMissionId+currentTaskId+currentThreadId
    "client",     // adapterVersion+clientMetadata+ipAddress+restartCount
    "errors",     // recentErrors
    "all"         // expand to all of the above
  ])).optional(),
});

// Output: z.array(AgentSchema).describe("matching agents; default fields = identity+session+fsm")
```

**Defaults:** filter omitted → returns all agents (architects + engineers + future roles); fields omitted → `["identity","session","fsm"]` (cheap routing path).

**Latency target:** sub-100ms p99 on the routing hot-path (filter by role + livenessState + activityState; default fields). Hub-side projection in-memory (no GCS roundtrip per call).

**Self-introspection:** an agent calling `get_agents` sees itself in the result; no special-casing.

**Role-gating:** `[Any]` per Q2=B+C+D — any-role-callable.

#### `list_available_peers` disposition

Becomes a **5-line facade** over `get_agents` for v1.0:

```ts
list_available_peers({ role, matchLabels }, caller) =>
  get_agents({
    filter: { role, livenessState: "online", label: matchLabels },
    fields: ["identity"]
  }).filter(a => a.id !== caller.id);
```

Backward-compatible signature; downstream code unchanged. Retired in idea-121 cleanup.

### §4.2 SSE push — `agent_state_changed`

New event class joins the existing event family.

#### Payload (final)

```ts
{
  event: "agent_state_changed",
  agentId: "agent-XXXX",
  fromLivenessState: LivenessState | null,    // null on first transition (e.g. handshake-creates-agent)
  toLivenessState: LivenessState,
  fromActivityState: ActivityState | null,
  toActivityState: ActivityState,
  changedFields: (keyof Agent)[],             // fields beyond FSMs that changed (e.g., currentMissionId)
  at: "ISO-timestamp",
}
```

Fires on every FSM transition (either axis) AND on field changes that affect routing (e.g., `currentMissionId` setting/clearing).

#### Selective dispatch — broadcast-by-role-targeting (v1.0)

Existing Path A `Selector` filters on `engineerId` / `engineerIds` / `roles` / `matchLabels` only — not event name. The event NAME is the class. Selector then filters WHO receives.

For v1.0: `dispatch("agent_state_changed", payload, { roles: ["architect", "engineer"] })`. Both architects + engineers see all transitions. Agent population is small (<10 today); broadcast cost negligible.

Per-event-class subscription model deferred to idea-121 (would need new `selector.eventClassFilter` field). **Not introduced in v1.0.**

#### classifyEvent extension

`agent_state_changed` must be added to `ENGINEER_ACTIONABLE` + `ARCHITECT_ACTIONABLE` (or whatever the new symmetric naming is post-rename) in `@apnex/network-adapter` (`packages/network-adapter/src/kernel/event-router.ts`). Layer-1 lesson from mission-61: classifyEvent is the gate.

### §4.3 Adapter local cache

Adapters maintain a local cache of the agent population, refreshed on `agent_state_changed` push events with pull-fallback for cold-start / SSE-stream-resume / cache-miss. Routing decisions in the architect's hot-path are O(local-lookup), not O(network-call).

---

## §5 Adapter-side handshake + connection-manager sweep

### §5.1 Handshake (SSE-stream-open)

Adapter signals to Hub at handshake:
- `name` (from `OIS_INSTANCE_ID` env)
- `role` (already signaled today)
- `labels` (already signaled today)
- `clientMetadata.{...}` (already signaled today)

Hub-side derived at handshake:
- `ipAddress` (from socket peer addr; NOT adapter-supplied — security)
- `sessionStartedAt` (Hub stamps at handshake completion)
- `activityState = "online_idle"` (initial state)

### §5.2 FSM transition signaling — explicit `signal_working_*` RPCs

Per round-1 audit Q8 finding: LLM-to-MCP-tool-call path does NOT touch the Hub queue. `touchAgent()` (rate-limited 30s) updates `lastSeenAt` only, not FSM-state. Implicit-only would leave the FSM blind to most working state.

**Explicit RPCs (new MCP tools):**

```ts
signal_working_started(toolName: string)
signal_working_completed()
signal_quota_blocked(retryAfterSeconds: number)  // composes with idea-109
signal_quota_recovered()
```

Adapter wraps each tool-call dispatch with `signal_working_started` (before) + `signal_working_completed` (after). Hub computes FSM transitions; emits `agent_state_changed` SSE.

### §5.3 Plugin parity matrix

| Plugin | Transport | Compile | Status this mission |
|---|---|---|---|
| claude-plugin | stdio MCP | compiled `dist/shim.js` + bundled SDK tgz | parity required |
| opencode-plugin | stdio MCP | tsx (no dist) | parity required |
| vertex-cloudrun | HTTP | (TBD; not in current `adapters/` tree) | stub-only (compile-checks pass); full wiring out-of-scope (would tip mission to XL) |

**Transport-neutrality:**
- `signal_working_*` RPCs are regular MCP tool calls → works for stdio + HTTP both
- Handshake uses MCP capability negotiation → already transport-neutral
- HTTP path: `lastSeenAt` rate-limit may need transport-conditional logic (no persistent connection to derive activity from); engineer flag for W3

---

## §6 Note-kind primitive surface gap (bundled per Q6=C)

### §6.1 Confirmed via code-read

`packages/network-adapter/src/kernel/event-router.ts:60-131` — `kind=note` is NOT in `ENGINEER_ACTIONABLE` nor `ARCHITECT_ACTIONABLE` set, nor informational set. Falls through to `return "unhandled"` disposition.

But: the actionable sets contain HIGH-LEVEL events (`thread_message`, `clarification_answered`, `message_arrived`, etc.). The kind=note vs kind=pulse classification happens INSIDE `message_arrived` event handling at a deeper layer.

The "ghost" envelope observed via thread-382 morning-test was: `<channel event="message_arrived">` envelope rendered (Path A delivery succeeded), but drain returned empty. The break is between `claim_message` and pending-action-enqueue — kind=note is acked-on-receipt without enqueueing readable payload, OR enqueues with empty payload.

### §6.2 Fix (W1+W2 atomic PR)

1. **Locate** the kind=note path inside message_arrived handler at `packages/network-adapter/src/kernel/event-router.ts` (or downstream policy that routes claimed messages to enqueue)
2. **Fix**: ensure kind=note enqueues a `PendingActionItem` with `payload` including `{body, sender, ULID, kind: "note"}`. Drain shape per `pending-action.ts:48-86` already supports `payload: Record<string, unknown>` — no schema change needed; just populate
3. **Add** kind=note to whatever sub-classification ensures the enqueue happens
4. **Smoke test**: round-trip note in both directions during W4 dogfood; confirm engineer drain surfaces note body verbatim

### §6.3 Bundling rationale

Fix lives in `@apnex/network-adapter` SDK kernel. W1+W2 atomic PR is the natural place — same SDK rename touches the same files. No coordination overhead.

---

## §7 Symmetric Hub/SDK rename + CI hook

### §7.1 Symmetric rename discipline (per Q4=D + mission-61 Layer-3 lesson)

Any rename split across "Hub source" + "SDK tgz inside adapter bundle" must land synchronously.

**Rebuild protocol (mandatory in W1+W2 PR):**
1. Rename `engineerId → agentId` in Hub source (`hub/src/**`)
2. Rename in SDK source (`packages/network-adapter/src/**`, `packages/cognitive-layer/src/**`, `packages/message-router/src/**`)
3. `npm pack` each SDK package; produce fresh tgzs
4. Distribute tgzs to all 6 adapter dirs (3 worktrees × {claude-plugin, opencode-plugin}; once per worktree)
5. `rm -rf node_modules package-lock.json && npm install` in each adapter dir
6. Smoke-test: `node dist/shim.js < /dev/null` for ~3s; expect clean handshake; no `ERR_MODULE_NOT_FOUND`; no `engineerId` references in installed `dist/`

This is the universal verification gate codified in mission-61 W5 audit. Adopted as standard for any Hub/SDK rename.

### §7.2 CI hook design (final)

**Two-layer:**

1. **Pre-commit hook** (`.husky/pre-commit` or repo-equivalent) — local fast-fail:
   ```bash
   if git diff --cached -G'engineerId' --name-only | grep -v '^docs/decisions/\|^docs/audits/\|^docs/traces/\|^CHANGELOG'; then
     echo "ERROR: engineerId reference added; this is the post-mission rename target. Use agentId."
     exit 1
   fi
   ```
   Allow override via `--no-verify` for explicit migration commits.

2. **CI workflow** (`.github/workflows/no-engineer-id.yml`) — repo-wide grep on every push:
   ```yaml
   - name: Block engineerId references
     run: |
       MATCHES=$(git grep -n 'engineerId\|engineer_id' -- \
         ':!docs/decisions/' \
         ':!docs/audits/' \
         ':!docs/traces/' \
         ':!CHANGELOG*')
       if [ -n "$MATCHES" ]; then
         echo "$MATCHES"
         exit 1
       fi
   ```

**Carve-out paths:**
- `docs/decisions/` — ADR-017 references engineerId historically
- `docs/audits/` — closing audits reference historical state
- `docs/traces/` — work-traces are engineer-frozen historical artifacts (per `feedback_doc_sweep_carveout.md`)
- `CHANGELOG*` — historical references intentional

Active code surfaces must be clean.

---

## §8 Substrate-self-dogfood gate (W4)

### §8.1 Dogfood scope (minimum-viable; per round-2 ratify of observation-only)

1. **Architect manually calls `get_agents` at thread-open during the mission** and confirms result matches expected shape (observation, not refactor — pinned per round-2)
2. **Every architect↔engineer thread-open during mission tests `agent_state_changed` SSE event delivery** (architect's local cache must match Hub's view of greg's `activityState` at thread-open time)
3. **Note-kind round-trip test** — real architect→engineer + engineer→architect note pair during mission execution; verify note body surfaces in drain
4. **Post-deploy verification** — architect calls `get_agents({fields: "all"})` and confirms Hub-side fields match the shipped schema

### §8.2 Verification artifact

`docs/audits/m-agent-entity-revisit-w4-validation.md` (architect-authored) captures envelope-verbatim evidence per the mission-61 audit pattern. Estimated ~½ eng-day.

### §8.3 Scope-creep watch-out

The architect's thread-routing-path refactor (migrate `list_available_peers` callsites to `get_agents` filter form) is **NOT in W4 scope** — file as follow-on Idea or absorb into idea-121 cleanup post-mission. Don't expand W4.

---

## §9 Mission decomposition (final per Option α)

### §9.1 Wave shape

| Wave | Scope | Owner | Estimate |
|---|---|---|---|
| **W1+W2 atomic** | Hub schema + both FSMs as named fields + `get_agents` tool + `agent_state_changed` event + `signal_working_*` + `signal_quota_*` RPCs + engineerId→agentId rename + SDK rename + classifyEvent + note-kind enqueue fix + tests. **One PR.** | Engineer | ~1 week |
| **W3** | Adapter handshake + cache + signal_working RPC wiring (claude + opencode parity; vertex stub-only). One PR. | Engineer | ~3-4 days |
| **W4** | Self-validation dogfood per §8 (observation-only). | Architect (bilateral) | ~½ day |
| **W5** | Closing audit; pattern callouts; methodology calibration; follow-on Ideas. | Architect | ~½ day |

### §9.2 Parallelization

**None.** W3 strictly depends on W2's SDK tgz being installable. Sequential.

### §9.3 Sizing (final)

**L baseline (~1.5-2 engineer-weeks).** XL escalation realistic if vertex-cloudrun HTTP-transport gets wired this mission (no current adapter dir; would be net-new cross-plugin work; engineer T1-call at preflight time).

---

## §10 Anti-goals (locked per round-1 audit + Survey alignment)

1. **NOT a Director-dashboard play.** Surface optimizes for agent-coordination consumers (Q1+Q2 A declined).
2. **NOT incremental rollout.** Q3=B declined. Atomic single-PR-cycle landing per wave.
3. **NOT coupled to idea-121's tool-surface design timeline.** Q3=C declined.
4. **NOT additive-with-deprecation rename.** Q4=B declined. Clean break for `engineerId → agentId`.
5. **NOT pull-only.** Q5=A declined. SSE push for cache-coherence is core.
6. **NOT minimal cleanup scope.** Q6=A+B+C+D — bundle everything adjacent.
7. **NOT scope creep into idea-121 (API v2.0).** Per-event-class subscription model + tool-surface envelope decisions defer there.
8. **NOT a Hub-restart-survival re-test.** Mission-60 W4 covered that; no re-exercise here.
9. **NOT a session-claim FSM redesign.** mission-40 already shipped that; consumed not redesigned.
10. **NOT Director-chat / ACP redesign coupling.** Per memory `project_director_chat_acp_redesign.md`; orthogonal.
11. **NOT vertex-cloudrun full wiring.** Stub-only; full wiring would tip to XL and is out-of-scope (engineer T1-call at preflight).
12. **NOT W4 routing-refactor expansion.** Dogfood is observation-only; routing-callsite migration to `get_agents` is a follow-on (filed post-mission or absorbed into idea-121).
13. **NOT renaming `livenessState`.** Existing field semantics preserved per ADR-017 INV-AG6; only `engineerId` is the genuine rename target.

---

## §11 Decisions (committed; no open TODOs or open questions)

### §11.1 Field derivation (`currentMissionId/TaskId/ThreadId`) — derive-on-read

- `currentMissionId` = mission with most recent un-completion-acked queue item targeting this agent
- `currentTaskId` = task with `assignedAgentId === this.id && status !== "completed"`
- `currentThreadId` = thread with `currentTurnAgentId === this.id && status === "active"`

All ~O(1) projections off existing entity stores; no new state.

### §11.2 `signal_working_*` — explicit RPCs (per §5.2)

### §11.3 `recentErrors` — cap=10, FIFO ring buffer

### §11.4 `restartCount` — 24h rolling-window; ring of bump timestamps cap=50

### §11.5 `list_available_peers` — facade for v1.0; retired in idea-121

### §11.6 CI hook — pre-commit + GHA workflow (§7.2)

### §11.7 W ordering — Option α atomic W1+W2; W3 sequential; no parallelization

### §11.8 Plugin parity — claude+opencode required; vertex stub-only; transport-neutrality flag for HTTP `lastSeenAt`

### §11.9 `agent_state_changed` selective dispatch — broadcast-by-role-targeting v1.0; per-event-class deferred to idea-121

---

## §12 Tele alignment (final)

| Tele | Weight | How realized |
|---|---|---|
| **tele-7 Resilient Operations** | Primary | Routing intelligence (live FSMs); SSE-push cache-coherence; sub-100ms routing-path latency |
| **tele-3 Absolute State Fidelity** | Secondary | Hub-view-of-each-agent matches reality at query-time; troubleshooting-grade fidelity (PID, IP, errors); presence projection unified via livenessState; note-kind delivery now state-faithful |
| **tele-6 Deterministic Invincibility** | Secondary | Atomic single-PR-cycle landing; symmetric Hub/SDK rename; CI hook for regression |
| **tele-2 Frictionless Agentic Collaboration** | Tertiary | Foundation for downstream agent-coordination primitives; note-kind delivery enables peer-to-peer comms reliably |
| **tele-12 Hydration-as-Offload** | Tertiary | Adapter local cache pre-hydrated from `get_agents`; SSE push keeps hot |

---

## §13 Cross-references

- **Survey**: `docs/designs/m-agent-entity-revisit-survey.md`
- **Idea**: idea-215 (parent); idea-106 (subsumed); idea-216 (or similar; today's note-kind primitive surface gap)
- **Composes-with**: idea-109 (429 backpressure / `signal_quota_blocked` FSM state); idea-121 (API v2.0 tool-surface; downstream consumer of this entity model)
- **Closes**: bug-35 (presence projection)
- **Architectural-precedent**: mission-61 (Layer-3 SDK-tgz-stale lesson + Path A SSE-push wiring); mission-40 (session-claim machinery; consumed); mission-57 (pulse primitive; consumed)
- **ADR**: ADR-017 INV-AG6 (livenessState origin; preserved)
- **Methodology**: `docs/methodology/multi-agent-pr-workflow.md` (PR cadence + co-authorship); `docs/methodology/mission-preflight.md` (preflight phase downstream); `feedback_substrate_self_dogfood_discipline.md` (§8 dogfood gate binding)

---

## §14 v0.2 → v1.0 promotion gate

- ✅ Zero `TODO(engineer)` markers
- ✅ Zero `TODO(architect)` markers
- ✅ Zero open-question markers
- ✅ All round-1 audit findings incorporated
- ✅ All round-2 architect ratifications applied
- ✅ Naming counter accepted (livenessState kept; activityState new)
- ✅ Auto-clamp invariant captured (§3.3)
- ⏳ **Engineer round-2 ratify pending** — sign-off in thread-387 round 10 promotes to v1.0 + cascades `propose_mission`

---

*Architect: lily. Engineer: greg (round-1 audit shipped 2026-04-27 ~10:58Z). v1.0 promotion ready pending engineer round-2 ratify.*
