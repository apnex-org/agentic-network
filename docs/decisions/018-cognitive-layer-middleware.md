# ADR-018: Cognitive-Layer Middleware Contract (M-Cognitive-Hypervisor Phase 1)

**Status:** Accepted — Phase 1 shipped 2026-04-19 (thread-158 design; commits c01997b→[final]).
All 6 middlewares + integration + shim E2E coverage landed.
**Owner:** Engineer
**Reviewer:** Architect (ratified across thread-158 rounds 1-5)
**Supersedes / relates:** idea-107 (umbrella), idea-109 (Phase 4 quota integration), idea-111 (Hub-layer reply idempotency — sibling), idea-113 (cascade schema docs), idea-114 (state reconciliation — Phase 3), ADR-017 (persist-first comms queue — orthogonal)

---

## Context

The M-Ideas-Audit retrospective (2026-04-19) surfaced, in a single 90-minute autonomous mission:

- 10× `auto_thread_reply_failed` (tool-round exhaustion)
- 11× wrong-shape cascade staging
- 4× unauthorized task creation
- 1× duplicate reply
- 1× false-positive watchdog escalation

Director framing: **"The Universal Adapter + vertex harness is like a Hypervisor — abstracting infra primitives so our code never hits this issue."** Agent code should be bare against cognitive primitives; the adapter transparently manages budget, caching, dedup, and error translation.

M-Cognitive-Hypervisor has 4 phases (per `docs/planning/m-cognitive-hypervisor.md`); **Phase 1 targets ~70% of observed failure classes** through adapter-layer interception and vertex-cloudrun shim additions.

## Decision

Introduce `@apnex/cognitive-layer` as a **sovereign sibling package** to `@apnex/network-adapter`. The package owns the cognitive-enforcement-layer contract, pipeline composer, standard-pipeline factory, and an initial middleware catalog. Agents opt in via a `cognitive` config on `McpAgentClient`.

### Why sovereign (not a sub-module of network-adapter)

- **Decoupling:** cognitive logic (LLM↔tool interaction patterns) is conceptually distinct from transport (MCP/SSE/HTTP).
- **Independent versioning:** cognitive intelligence can ship at a different cadence than connectivity.
- **Reuse beyond MCP:** a future direct-LLM harness (e.g., bypassing MCP) can import the cognitive layer without the transport baggage.
- **Plugin architecture:** a clean package boundary enforces the middleware contract; sub-modules tend to leak.
- **Aligns with idea-102 (Universal Port) decomposition pattern.**

### Architecture

```
┌─ vertex-cloudrun ──┐   ┌─ claude-plugin ────┐   ┌─ opencode-plugin ──┐
│ sandwich.ts        │   │                    │   │                    │
│ llm.ts             │   │                    │   │                    │
│  ↓                 │   │                    │   │                    │
│ hub-adapter.ts     │   │ shim.ts            │   │ shim.ts            │
│ (McpAgentClient)   │   │  ↓                 │   │  ↓                 │
│                    │   │ dispatcher.ts      │   │ dispatcher.ts      │
│ Architect-only:    │   │                    │   │                    │
│  • Round-budget    │   │                    │   │                    │
│  • Parallel batch  │   │                    │   │                    │
│  • LLM 429         │   │                    │   │                    │
└──────────┬─────────┘   └──────────┬─────────┘   └──────────┬─────────┘
           │                        │                        │
           └────────────────────────┼────────────────────────┘
                                    │
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │   @apnex/network-adapter  (SHARED — every agent)    │
        │                                                    │
        │   McpAgentClient  ↔  McpTransport                 │
        │                                                    │
        │   Consumes @apnex/cognitive-layer via opt-in config │
        └────────────────────────┬──────────────────────────┘
                                 │
                                 ▼
        ┌───────────────────────────────────────────────────┐
        │   @apnex/cognitive-layer  (SHARED — sovereign)       │
        │                                                    │
        │   CognitivePipeline + CognitiveMiddleware contract │
        │                                                    │
        │   Phase 1 middlewares:                             │
        │    • CognitiveTelemetry                            │
        │    • CircuitBreaker                                │
        │    • WriteCallDedup                                │
        │    • ToolResultCache                               │
        │    • ToolDescriptionEnricher                       │
        │    • ErrorNormalizer                               │
        └────────────────────────┬──────────────────────────┘
                                 │
                                 ▼
                               Hub
```

Each agent is a **peer** stack consuming both shared packages. Traffic does not flow between plugins; "sharing" is code-level — any feature landing in the cognitive layer is inherited by every agent's next restart.

## Contract

```ts
export interface ToolCallContext {
  tool: string;
  args: Record<string, unknown>;
  sessionId: string;
  agentId?: string;
  startedAt: number;
  tags: Record<string, string>;  // middlewares annotate; propagates down-chain
}

export interface ListToolsContext {
  sessionId: string;
  agentId?: string;
  startedAt: number;
}

export interface ToolErrorContext {
  tool: string;
  args: Record<string, unknown>;
  sessionId: string;
  error: unknown;
  durationMs: number;
  startedAt: number;
}

export interface Tool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface CognitiveMiddleware {
  readonly name: string;

  onToolCall?(
    ctx: ToolCallContext,
    next: (ctx: ToolCallContext) => Promise<unknown>,
  ): Promise<unknown>;

  onListTools?(
    ctx: ListToolsContext,
    next: (ctx: ListToolsContext) => Promise<Tool[]>,
  ): Promise<Tool[]>;

  onToolError?(
    ctx: ToolErrorContext,
    next: (ctx: ToolErrorContext) => Promise<unknown>,
  ): Promise<unknown>;
}
```

Chain-of-responsibility pattern (Express/Koa style). Middlewares compose via `next()`; short-circuit by returning without calling `next()`. Errors propagate via standard throw; `onToolError` is invoked on errors that escape the chain.

## Standard Pipeline

Factory `CognitivePipeline.standard({ ...configs })` returns the canonical ordering:

```
┌─ outermost ─────────────────────────────────────┐
│ 1. CognitiveTelemetry   ← sees every call      │
│ 2. CircuitBreaker       ← fail-fast before cost │
│ 3. WriteCallDedup       ← block duplicate writes│
│ 4. ToolResultCache      ← return cached reads   │
│ 5. ToolDescriptionEnricher ← passive on listTools│
│ 6. ErrorNormalizer      ← closest to transport  │
└─────────────────────────────────────────────────┘
```

Each middleware added to the package registers at its ratified position; `.standard()` grows as checkpoints land. **Ad-hoc `.use()` composition remains available** for tests and custom pipelines; `.standard()` is the blessed production path.

## Integration with `@apnex/network-adapter`

```ts
new McpAgentClient({
  role: "engineer",
  handshake: { ... },
  cognitive: CognitivePipeline.standard({
    telemetry: { sink: (event) => structuredLogger.emit(event) },
    cache: { ttlMs: 30_000 },
    dedup: { windowMs: 5_000 },
    // ...
  }),
});
```

Agents opt in. Adapter's `agent.call()` routes through the pipeline if configured; otherwise falls through to raw transport (zero-cost for agents that don't opt in).

## Phase 1 Middleware Catalog

### 1. CognitiveTelemetry

**Role:** Outermost layer. Captures every tool call, list-tools invocation, and error with timing + tags. Fire-and-forget emission to a user-provided sink.

**State:** Stateless per-call; maintains internal bounded queue + drop counter.

**Config:**
- `sink: (event: TelemetryEvent) => void` — user emitter
- `logger: (msg: string) => void` — diagnostic output for overflow logs
- `maxQueueDepth: number` (default 1000) — back-pressure threshold
- `overflowLogIntervalMs: number` (default 60_000) — rate-limit overflow logs

**Invariants:**
- Captures metadata synchronously on the hot path (event construction).
- Emits to sink asynchronously via `queueMicrotask` — never awaits the sink.
- Queue cap at `maxQueueDepth`; beyond, events are dropped silently with a once-per-minute `telemetry_overflow` log entry.
- Sink failures are swallowed; telemetry never propagates errors into the pipeline.

### 2. CircuitBreaker

**Role:** Trips on repeated transport-layer faults (5xx / timeout / connection-refused). OPEN state fails fast without reaching the transport, preventing tool-round exhaustion during Hub incidents.

**State:** `CLOSED → OPEN (cooldown) → HALF_OPEN (probe) → CLOSED | OPEN`.

**Config:**
- `failureThreshold: number` (default 3) — consecutive 5xx/timeout before trip
- `observationWindowMs: number` (default 30_000) — rolling window for threshold counting
- `cooldownMs: number` (default 30_000) — OPEN → HALF_OPEN delay

**Invariants:**
- Scope: `{hubUrl, sessionId}` (Hub-level fault, not per-tool).
- OPEN returns `HubUnavailable: tripped, retry after Ns` — **non-retryable by the LLM** (prevents round burning during incidents).
- HALF_OPEN admits exactly one probe call; success → CLOSED, failure → OPEN cooldown reset.
- Emits `circuit_breaker_state_change` to CognitiveTelemetry on every transition.

### 3. WriteCallDedup

**Role:** Promise-based idempotency for write tools. Protects Hub from duplicate writes caused by cognitive retries (LLM re-emitting the same tool call after a transient error).

**State machine per `{tool, args-hash, sessionId}` key:**

```
IN-FLIGHT  ← first call; Promise<Result> stored; TTL not started
             - duplicate awaits SAME Promise
             - both resolve identically at call completion

SETTLED    ← Promise settled; TTL timer starts (5s default)
             - duplicate within window replays cached result/rejection

EXPIRED    ← entry evicted; next call executes fresh
```

**Config:**
- `windowMs: number` (default 5_000) — post-settlement dedup window
- `maxInflightMs: number` (default 30_000) — fail-fast threshold for slow calls
- `writeTools: Set<string>` — explicit allow-list (defaults to MCP write verbs)

**Invariants:**
- TTL starts at settlement, not at first-call initiation (`INV-COG-8`).
- In-flight calls of arbitrary duration remain deduped (no time-based escape hatch other than `maxInflightMs`).
- Exceeding `maxInflightMs` on an in-flight call returns `DedupTimeout` to the duplicate caller — shim decides retry vs. abort.
- Read tools (`get_*`, `list_*`) are not in the dedup set — read caching is `ToolResultCache`'s job.

### 4. ToolResultCache

**Role:** LRU + TTL cache for idempotent read tools. Eliminates redundant Hub round-trips when the LLM re-fetches the same state within a turn.

**State:** LRU keyed by `{tool, args-hash, sessionId}`.

**Config:**
- `ttlMs: number` (default 30_000)
- `maxEntries: number` (default 500 per session)
- `cacheable: (tool: string) => boolean` — defaults to MCP read verbs
- `invalidationStrategy: InvalidationStrategy` — pluggable; Phase 1 ships `FlushAllOnWriteStrategy`

**Invariants:**
- Scope strictly per-session (`INV-COG-7`). Cross-session signals **not** supported in Phase 1.
- `FlushAllOnWriteStrategy`: any write tool (per `CallToolCallContext`) flushes the cache for the calling session.
- `InvalidationStrategy` interface is a **Phase 2 extension seam** (`INV-COG-4`). Stale-while-revalidate lives here.

**InvalidationStrategy contract (for Phase 2 extensibility):**
```ts
interface InvalidationStrategy {
  onWrite(tool: string, args: Record<string, unknown>): InvalidationDirective;
  onStaleRead?(key: CacheKey, staleResult: unknown): Promise<unknown> | null;
}
```

### 5. ToolDescriptionEnricher

**Role:** Injects compact cognitive hints into tool descriptions returned from `listTools`. Teaches the LLM how to call without enforcement.

**Hint vocabulary (closed; `INV-COG-9`):**

| Token | Meaning |
|---|---|
| `[C30s]` | Cached 30s — prefer reuse within turn |
| `[ID]` | Idempotent — safe to retry |
| `[PAR]` | Supports parallel invocation |
| `[W]` | Write — mutates state; no caching |
| `[CB]` | Behind CircuitBreaker |

**Config:**
- `hintMap: Record<string, ToolHints>` — per-tool hint set (defaults derived from cacheable + writeTools sets of sibling middlewares)
- `enabled: boolean` — kill switch for small-context models

**Invariants:**
- Closed hint vocabulary (no prose, no model-specific customization in Phase 1).
- Hints append as `" [C30s][ID]"` suffix to tool description.
- Worst-case overhead: ~10 tokens per tool × ~40 tools ≈ ~400 tokens total.
- Passive on `onToolCall` — enricher ONLY modifies `onListTools` output.

### 6. ErrorNormalizer

**Role:** Innermost layer (closest to transport). Rewrites deterministic tool errors into "Reasoning Hints" the LLM can self-correct against. Pass-through for all other errors.

**Closed rewrite set (`INV-COG-10`):**

1. **Zod type mismatch** → `Invalid Input: <field> expects <type>, got <received>. Example: { <field>: <valid-example> }`
2. **Missing required field** → `Missing required field: <name>. Retry with args including <name>.`
3. **Cascade-action schema drift (6 known variants)** → `<action> requires { <key>: { ... } }, got flat shape. Retry with args wrapped in '<key>'.` (Appendix A)
4. **Unknown tool + edit-distance ≤2** → `Tool '<name>' not found. Did you mean '<suggestion>'? Similar tools: <top-3>.`

**Invariants:**
- Rewrites **only** when an exact-match rule fires. Any other error passes through untouched.
- Never infers business-logic corrections ("task doesn't exist; try task-N-1").
- Never rewrites semantic errors ("invalid state transition").
- Never attempts to guess values for ambiguous fields.

## Invariants Catalog

| ID | Invariant |
|---|---|
| **INV-COG-1** | Standard pipeline ordering factory-enforced |
| **INV-COG-2** | CognitiveTelemetry captures all calls (pre-short-circuit) |
| **INV-COG-3** | Middleware never throws from `next()` — errors flow via onToolError |
| **INV-COG-4** | InvalidationStrategy pluggable (Phase 2 extension seam) |
| **INV-COG-5** | Dedup and cache are distinct primitives (different TTLs/triggers/state) |
| **INV-COG-6** | CircuitBreaker OPEN state fails-fast non-retryable |
| **INV-COG-7** | ToolResultCache scope strictly per-session (no cross-session signals in Phase 1) |
| **INV-COG-8** | Dedup TTL starts at settlement, not first-call |
| **INV-COG-9** | Hint syntax is closed vocabulary; no prose |
| **INV-COG-10** | ErrorNormalizer rewrites ONLY deterministic violations |
| **INV-COG-11** | Pipeline overhead ≤10ms p99 per call; CognitiveTelemetry strictly non-blocking |

## Telemetry Baseline

Phase 1 ships CognitiveTelemetry **first** (task-287). The subsequent middlewares land with telemetry already in place, so every "before" and "after" measurement is captured by the same instrument.

**Baseline metrics** (pre-middlewares, CognitiveTelemetry only):
- Tool calls per session per turn
- Per-tool invocation frequency
- Duplicate call rate (keyed by `{tool, args-hash}` observed within 30s window)
- Read-tool re-fetch rate (how often the same read is called twice per turn)
- Error rates by class (Zod, cascade-drift, unknown-tool, transport)

**Post-Phase-1 targets:**
- ≥60% reduction in tool-rounds-per-convergence on architect replies
- Cache hit rate ≥40% on idempotent reads
- Dedup prevention rate captures all observed duplicate writes
- Circuit-breaker trip count correlates with Hub incident windows
- Zero observed tool-round exhaustions under normal production load

## Non-goals (Phase 1)

- **Round-budget prompt injection** — shim-layer (vertex-cloudrun only); we own the LLM prompt in sandwich.ts.
- **Parallel tool-call composition** — shim-layer (vertex-cloudrun only); we compose the Gemini tool-call array.
- **Granular per-tool cache-invalidation matrix** — Phase 2 via GranularMatrixStrategy.
- **Host-specific hint customization** — Phase 2.
- **Cross-session cache invalidation** — Phase 2+ (requires Hub signals).
- **LLM-loop re-drive on cognitive-budget exhaustion** — Phase 2.
- **State reconciliation / thread_sync_check** — Phase 3.
- **429 backpressure signal** — Phase 4 (idea-109).

## Future Extensions (Phase 2+)

- `GranularMatrixStrategy` for ToolResultCache (Hub-declared invalidation matrix).
- `StaleWhileRevalidateStrategy` via `InvalidationStrategy.onStaleRead` hook.
- Additional middlewares: `ResponseSummarizer` (truncate long payloads with "get more via offset" hints), `ParallelBatchSuggester` (detect sequential calls that could've been parallel).
- Adapter-configurable hint templates per agent type (small-context vs. large-context models).
- LLM-driven cognitive budget exhaustion + resumption (coordinates with M-Mission-Conductor).

## Rationale

The Hypervisor framing landed because the failure classes observed in M-Ideas-Audit were **not correctable at the agent code level** — they were properties of the LLM harness leaking through the adapter into agent-observable behavior. The fix therefore had to live in the adapter's interception layer, not in the agent code itself.

Sovereignty (separate package) was chosen over sub-module inlining for three reasons: (1) **independent versioning** of cognitive intelligence vs connectivity, (2) **clean contract enforcement** forces the middleware interface to be stable before proliferation, (3) **future reuse** by direct-LLM harnesses that don't need MCP.

The chain-of-responsibility pattern was chosen over observer/hook patterns because it naturally handles short-circuits (cache hits return immediately; circuit-open fails fast) without requiring middlewares to cooperate on "should I proceed?" signals. Insertion-order-with-standard-factory was chosen over explicit `priority` numbers to avoid priority-inflation tech debt and to make the canonical ordering reviewable in one place.

The closed hint vocabulary (`INV-COG-9`) and deterministic-only rewrite set (`INV-COG-10`) were architect-raised hardening requirements — the cognitive layer must never hallucinate fixes, only expose information that's ground-truth about the tool surface.

## References

- **thread-158:** design convergence thread (rounds 1-5 ratified; round 7 closure attempted)
- **M-Ideas-Audit retrospective:** `docs/audits/ideas-audit-v1.md`
- **Mission plan:** `docs/planning/m-cognitive-hypervisor.md`
- **Related ADRs:** ADR-017 (persist-first comms queue), ADR-014 (Threads 2.0 Phase 2)
- **Sibling ideas:** 107 (umbrella), 109 (Phase 4), 111 (Hub idempotency), 113 (cascade schema docs), 114 (state reconciliation)

## Appendix A — Known Cascade-Action Schema Drift Variants (ErrorNormalizer rewrite set)

Observed during M-Ideas-Audit thread-140..156 convergences. ErrorNormalizer rewrites each into the correct wrapped shape:

1. `update_idea({ideaId, tags, status, missionId})` → requires `{ideaId, changes: {tags?, status?, missionId?}}`
2. `update_idea({ideaId, text})` → requires `{ideaId, changes: {text}}`
3. `create_idea({text, tags})` → requires `{title, description, tags?}`
4. `update_mission_status({missionId, status})` → requires `{missionId, status, statusMessage?}` (schema-complete check)
5. `close_no_action({reason})` at the tool level → staged action form only; direct tool errors if invoked outside thread convergence
6. `propose_mission({...})` direct-call → director-gated; rewrite suggests thread-staging as alternative

Each rewrite preserves the original error payload in a `rawError` field for debugging while surfacing the correction-friendly prose to the LLM.
