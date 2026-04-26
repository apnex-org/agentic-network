# M-Push-Foundation — Design

**Status:** Draft v1.2 (architect-authored 2026-04-26 ~14:30 AEST; **post-recon revision** of v1.1)
**Author:** lily / architect
**Source idea:** idea-204 (workflow-gap inventory) + idea-201 (notification-projection-migration absorbed) + idea-200 (Thread.messages[] removal absorbed) + bug-34 (mission-53 absorbed)
**Successor of:** mission-51 W6 explicit deferral ("NOT real-push transport ... deferred to later mission")
**Methodology calibration:** First formal Design artifact under v1.x calibration #23 (formal-Design-phase-per-idea + tele-pre-check)
**Recon input:** mission-54 Recon Report at `docs/designs/m-push-foundational-adapter-recon.md` (greg-authored; PR #61 merged 2026-04-26 ~01:26Z). Three load-bearing architect tele-evaluation outcomes folded in (see §"Recon Report findings folded in" + decisions log). Predecessor mission **M-Pre-Push-Adapter-Cleanup** scaffolded per Q10(a); M-Push-Foundation activates against the post-cleanup adapter baseline.

---

## Decisions log (locked at v1.2)

| Decision | Source | Confirmed |
|---|---|---|
| Use unified Message primitive (no legacy Notification entity) | Director correction 2026-04-26 ~09:00Z | Yes |
| SSE push primary; canonical Last-Event-ID replay | Director correction 2026-04-26 ~09:15Z | Yes |
| Hybrid push+poll (poll AS BACKSTOP, not instead-of) | Director consideration 2026-04-26 ~09:25Z | Yes |
| ack semantics: Option C two-step `new → received → acked` | Architect lean; Director confirmed 2026-04-26 ~10:00Z | Yes |
| claim/ack two-step primitive (future-proofs multi-agent same-role) | Architect lean; Director confirmed 2026-04-26 ~10:00Z | Yes |
| **3-layer adapter decomposition kept** (network-adapter / Message-router / shim) — Q1 outcome | Architect tele-evaluation post-recon; v1.2 | Yes |
| **Rename: Design's "dispatcher" → "Message-router"** to disambiguate from foreign engineer's MCP-boundary "dispatcher" — Q2 outcome | Architect tele-evaluation post-recon; v1.2 | Yes |
| **Sovereign-package #6 renamed: `@ois/message-router`** (was `@ois/message-dispatcher`) | Q2 outcome cascade | Yes |
| **Q10(a): separate M-Pre-Push-Adapter-Cleanup mission precedes M-Push-Foundation** — adapter-layer-clean-FIRST = cleanup IS the FIRST step, not folded into push-foundation waves | Architect tele-evaluation post-recon; v1.2 | Yes |
| Adapter-layer-clean FIRST sequencing | Director directive 2026-04-26 ~10:00Z | Yes |
| Foreign-engineer recon mission as Design-phase spike (mission-54; engineer-audited) | Architect lean; Director confirmed 2026-04-26 ~10:05Z | Closed; PR #61 merged |
| Sizing rule tightening: `(a) AND (b)` → XL, vs 2-of-5 | greg's audit; architect ratified | Yes |
| W6 legacy sunset sub-ordering: DirectorNotification → Notification → PendingActionItem | greg's audit; architect ratified | Yes |
| Cold-start soft-cap (~500-1000) + `replay-truncated` synthetic event | greg's audit; architect ratified | Yes |
| Hybrid poll since-cursor required (not optional) | greg's audit; architect ratified | Yes |
| `<channel>` source-attribute distinct per kind/subkind | greg's audit; architect ratified | Yes |
| Adapter-side seen-id cache for push+poll dedup at render-surface | greg's audit; architect ratified | Yes |
| Tele-mapping additive refinements (render-surface +tele-2; poll +tele-9; legacy-sunset +tele-2) | greg's audit; architect ratified | Yes |
| idea-201 absorbed (vs standalone) | Architect lean; Director not contested | Yes (default) |
| mission-53 absorbed; abandon-with-pointer mechanic | Architect lean; greg confirmed | Yes (default) |
| **5 reusable patterns (recon §7) folded into M-Pre-Push-Adapter-Cleanup mission scope, NOT into M-Push-Foundation waves** | v1.2 outcome | Yes |
| Wave count: 8-granular vs 6-bundled | engineer-decision at audit-round-2 (post-cleanup) | Pending |
| Existing-notifications-in-store at sunset cutover handling | engineer T1 grep audit (W0 deliverable) | Pending |

---

## Goal

Ship the foundational message-push layer that mission-51 W6 explicitly deferred. Every future workflow primitive that needs triggered events consumes this layer. Legacy notification entities (Notification, PendingActionItem, DirectorNotification) are sunset in favor of the unified Message primitive shipped at mission-51 W6.

The mission **bounds the layer** — not just bridge-adoption, but the foundational push system + all current consumers + legacy sunset + tests + docs.

## Tele alignment (explicit per commitment, calibration #23)

### Primary tele

- **tele-3 Sovereign Composition** — Mission-51 W6 shipped the unified Message sovereign primitive; this mission lands the canonical SSE-push transport on top of it. No legacy entities, no bolt-on transports. Every future Message-emitter (idea-197 redeploy triggers, idea-199 FSM-completeness, etc.) consumes the same push primitive.

- **tele-9 Frictionless Director Coordination** — Architect PR-awareness latency drops from 15min (manual gh poll) to sub-30s (push). Eliminates manual coordination friction across the recurring workflow class (PR review/approve, mission-status flips, redeploy events).

### Secondary tele

- **tele-7 Confidence-Through-Coverage** — Hybrid push+poll architecture: push for latency, poll as defensive backstop. Catches events SSE may drop under Hub state corruption / network partition. Strictly better than pure-push for delivery-confidence.

- **tele-10 Hub-as-Single-Source-of-Truth** — Hub fires SSE on Message create; Message store is the single source-of-truth; no dual-emission to legacy + new. Sunsetting legacy entities collapses the truth surface.

- **tele-4 Zero-Loss Knowledge** — Last-Event-ID replay + cold-start stream-all + hybrid poll backstop = no event loss across reconnects, partitions, cold-starts.

### Tertiary tele

- **tele-2 Isomorphic Specification** — SSE event-type taxonomy schema-driven (one event-type per Message kind/subkind family); reuses existing canonical SSE Last-Event-ID protocol; no ad-hoc transport invention. Also protected: hybrid poll backstop (long cadence + since-cursor) doesn't burden the system; legacy entity sunset (many-entities → one-Message) is textbook isomorphic-spec consolidation; `<channel>`-emit reuse (vs new injection invention) preserves the canonical adapter→host primitive.

### Tele alignment per architectural commitment

| Commitment | Primary | Secondary |
|---|---|---|
| Push-on-Message-create (#1) | tele-9 (frictionless) | tele-10 (Hub single-source-of-truth) |
| Last-Event-ID replay (#2) | tele-4 (zero-loss) | tele-2 (canonical protocol reuse) |
| Cold-start stream-all + soft-cap + replay-truncated (#3) | tele-4 (zero-loss) | tele-2 (Last-Event-ID semantics for pagination — no new protocol surface) |
| Adapter SSE handler + 3-layer decomposition (#4) — renamed Message-router | tele-3 (sovereign composition; Message-routing earns own boundary) | tele-9 (frictionless to LLM-architect) + tele-2 (canonical `<channel>` primitive reuse + naming-disambiguation isomorphic to recon-found foreign concern) |
| Hybrid push+poll backstop + since-cursor + seen-id cache (#5) | tele-7 (confidence-coverage) + tele-4 (zero-loss) | tele-9 (long-cadence doesn't burden) |
| ack semantics (Option C two-step) + claim primitive (#6) | tele-4 (zero-loss; received-vs-acted distinction) | tele-2 (mirrors ADR-017 saga FSM) |
| Legacy entity sunset (#7) | tele-3 (sovereign composition) + tele-10 (single-source-of-truth) | tele-2 (many-entities → one-Message; isomorphic consolidation) |
| Tests + docs + ADR-026 (#8) | tele-7 (confidence-coverage) + tele-4 (zero-loss-knowledge) | tele-2 (architecture documented schema-driven) |

## Architectural commitments (BINDING)

### 1. Hub-side: SSE push on Message create

`message-policy.ts:handleCreateMessage` extended: when `MessageRepository.createMessage` returns a Message with `delivery === "push-immediate"` AND `target` matches an active SSE subscriber, fire SSE event via `emit()`.

- **Event-type:** `message_arrived` (canonical equivalent if existing SSE namespace dictates)
- **Payload:** inline Message envelope (sub-1KB typical; no follow-up fetch needed)
- **Failure-mode:** emit() throws → log + non-fatal; create_message commits; cold reconnect-replay or poll-backstop recovers
- **Subscriber resolution:** target.role + target.agentId resolution against agent registry; broadcast (target=null) emits to all active subscribers OR to none (engineer T1 ratifies; lean: broadcast if subkind warrants)

### 2. Hub-side: SSE Last-Event-ID replay protocol

Canonical SSE mechanism. Hub:
- Emits `id:` field on every SSE event using Message ID (ULID is monotonic; natural fit)
- Accepts `Last-Event-ID` header on `/sse` (or equivalent) endpoint
- Backfills stream from Message-store query: `Messages where id > Last-Event-ID AND target matches subscriber AND status === "new"` — Hub-internal Message-store-as-event-log; NOT a list_messages call from adapter
- Continues with live emits after backfill drains
- Test: replay-then-live-stream consistency; no duplicates; no gaps

### 3. Hub-side: Cold-start (no Last-Event-ID) — stream-all-with-soft-cap

When adapter connects without prior Last-Event-ID (first-ever connection, post-cache-clear):
- Hub streams ALL Messages where `target matches subscriber AND status === "new"` from the beginning
- **Soft-cap:** N=500-1000 Messages per replay (engineer-final at W2). If cap hit, emit synthetic `replay-truncated` SSE event signaling adapter to reconnect with the last-streamed-id as Last-Event-ID for next batch.
- Pagination via Last-Event-ID semantics — clean, MVP-compatible, zero new protocol surface
- Continues live after backfill drains (or after final `replay-truncated` ack)
- Test: simulate 1500 backlogged Messages → verify all delivered across 2-3 reconnects without duplicates or gaps

### 4. Adapter-side: SSE event-handler + 3-layer decomposition + render-surface

**Universal Adapter framing (Director-confirmed 2026-04-26):** `@ois/network-adapter` IS the Universal Adapter. Layer 3 (per-host shim) implements the Universal Adapter's notification contract; Layer 1 emits notifications into it; Layer 2 routes Messages through it. "Universal" describes the contract Layer 3 implements against, not a separate package name.

**3-layer adapter decomposition (Q1 + Q2 outcomes; v1.2 confirmed):**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Network Adapter / Universal Adapter                               │
│ Sovereign-package: @ois/network-adapter                                     │
│                                                                             │
│ Internal sub-concerns (sub-organized into src/ subdirs during cleanup):     │
│   1a. src/wire/         — TCP/SSE conn lifecycle; reconnect; backoff;       │
│                           heartbeat; atomic teardown; wire FSM              │
│                           (mcp-transport.ts, transport.ts)                  │
│   1b. src/kernel/       — register_role handshake; session-claim;           │
│                           session FSM 5-state; agent identity;              │
│                           instance lifecycle; SSE watchdog                  │
│                           (mcp-agent-client.ts, agent-client.ts,            │
│                            handshake.ts, session-claim.ts, instance.ts,     │
│                            state-sync.ts, event-router.ts)                  │
│   1c. src/tool-manager/ — MCP protocol tool-manager handler factory:        │
│                           Initialize/ListTools/CallTool; pendingActionMap   │
│                           for queueItemId injection; tool-catalog cache;    │
│                           cache-fallback paths; error envelope              │
│                           (dispatcher.ts, tool-catalog-cache.ts)            │
│                           ← NEW post-cleanup; foreign-engineer-as-          │
│                             inspiration; "tool-manager" semantics           │
│                             qualified always to disambiguate from           │
│                             Message-router                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2 — Message-Router                                          ← NEW     │
│ Sovereign-package: @ois/message-router (#6 NEW; Q2-renamed from             │
│                                          @ois/message-dispatcher)           │
│                                                                             │
│ Concerns:                                                                   │
│   - Message kind/subkind routing                                            │
│     ("which host-surface mechanism for this Message?")                      │
│   - Message-arrival event handling                                          │
│   - Seen-id LRU cache (push+poll dedup at render-surface)                   │
│   - Hooks-pattern for shim host-injection (notificationHooks bag)           │
│                                                                             │
│ Output: route(Message) → host-binding handler                               │
│                                                                             │
│ Q1 outcome: kept as separate sovereign-package — Message-routing is a       │
│             distinct concern from MCP-transport handler-factory; sovereign- │
│             package boundary earned via separability                        │
│ Q2 outcome: renamed "dispatcher" → "Message-router" to disambiguate from    │
│             foreign engineer's MCP-boundary "dispatcher"                    │
│                                                                             │
│ Lands in M-Push-Foundation W4 (NOT cleanup mission).                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Per-Host Shim (Universal Adapter contract implementer)            │
│ Per-host plugin packages: adapters/<host>-plugin/                           │
│                                                                             │
│ Active hosts:                                                               │
│   - adapters/claude-plugin     (stdio MCP transport;                        │
│                                 `<channel>` render-surface)                 │
│   - adapters/opencode-plugin   (Bun.serve+HTTP transport;                   │
│                                 client.session.promptAsync() render)        │
│                                                                             │
│ Future hosts (extension points):                                            │
│   - adapters/terminal-direct   (any LLM via terminal stdio)                 │
│   - adapters/<acp-host>        (ACP-protocol consumers — out of scope)      │
│                                                                             │
│ Concerns:                                                                   │
│   - Host-specific transport plumbing (stdio / HTTP / future)                │
│   - Host-specific render-surface (kind/subkind → host-binding)              │
│   - Notification-log writes                                                 │
│   - Process lifecycle (signals, config-load, pid-file)                      │
│   - HTTP fetch handler per-host (where applicable)                          │
│                                                                             │
│ NOT a sovereign-package — per-host plugin convention; tiny host-specific    │
│ glue (foreign engineer's hoist correctly minimized this layer).             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Counts:**
- **3 layers** (Q1-confirmed)
- **2 sovereign-packages**: `@ois/network-adapter` (Layer 1; keeps name; IS the Universal Adapter); `@ois/message-router` (Layer 2; sovereign-package #6 NEW; Q2-renamed)
- **N per-host shims** (today: 2; designed for arbitrary extension)

Each layer single-concern; tele-3 (sovereign composition) preserved.

**Naming discipline going forward:**
- "Message-router" / `@ois/message-router` = Layer 2 (Design's commitment #4 layer; kind/subkind routing)
- "MCP-boundary dispatcher" / "MCP handler factory" = Layer 1c module (Initialize/ListTools/CallTool); lives inside `@ois/network-adapter` per recon's 2-layer hoist pattern (folded into M-Pre-Push-Adapter-Cleanup mission scope as inspiration)
- "Universal Adapter" = `@ois/network-adapter` itself (Director-confirmed framing); the adapter that's universal across hosts via the Layer-3-shim contract
- Avoid bare "dispatcher" in new code — always qualify ("MCP-boundary dispatcher" or "Message-router")

**SSE event-handler behavior:**
- Subscribe to `message_arrived` event-type on existing SSE stream
- On receipt: deserialize inline Message; route via Message-router; shim renders to host
- On reconnect: send canonical `Last-Event-ID` header for replay
- After Message-router routes + shim renders successfully: shim flips Message `new → received` via `claimMessage(id)` (delivered-to-consumer flag)

**Render-surface (host-specific shim):**
- claude-plugin: `<channel>` injection — existence proof: dispatch notifications today use this mechanism. Source-attribute distinct per Message kind/subkind family (NOT generic `plugin:agent-adapter:message`). Examples:
  - `source="plugin:agent-adapter:repo-event"` for repo-event subkinds
  - `source="plugin:agent-adapter:directive"` for director-notification successors
  - `source="plugin:agent-adapter:notification"` for general notification successors
- opencode-plugin: TBD; engineer-final at W4
- Future hosts: extension point in shim layer

**Adapter-side seen-id cache** (push+poll dedup at render-surface):
- Bounded LRU cache of last N Message IDs (N=1000; engineer-final)
- Push delivers Message X → seen-id-set adds X
- Poll backstop returns Message X (race) → seen-id-set rejects → no double-render
- Idempotent ack via Hub-side dedup; render-surface dedup via adapter-side cache

### 5. Adapter-side: Hybrid push+poll backstop (since-cursor required)

In addition to SSE push subscription:
- Periodic `list_messages({target.role: <role>, status: "new", since: <last-seen-id>})` poll at LONG cadence
- Default cadence: **5min**; `OIS_ADAPTER_POLL_BACKSTOP_S` env-var override
- **`since` cursor required** (not optional): adapter persists last-seen Message ID; poll fetches only `id > since AND status === "new"` — minimal overlap with push delivery; semantic dedup at the seen-id level
- Engineer T1 confirms: does `list_messages` MCP verb support `since` parameter today? If not, W5 scope adds it (~quarter-day)
- Catches events SSE may have dropped (Hub state corruption / network partition / restart-mid-emit gaps not covered by Last-Event-ID)
- Each surfaced Message: shim flips `new → received` via `claimMessage(id)` (same as push path)

**Anti-pattern guard:** poll-cadence MUST be measurably longer than push-latency; poll backstop is a SAFETY NET, not a primary mechanism.

### 6. ack semantics — two-step `new → received → acked` (claim/ack primitive)

**Two-step lifecycle** (Director-confirmed; mirrors ADR-017 PendingActionItem saga):

```
status: "new"  ──claimMessage()──→  "received"  ──ackMessage()──→  "acked"
       │                                │                              │
   pre-delivery                  adapter-delivered              consumer-processed
   (in store; await push)        to host (rendered)             (LLM acted or actively-deferred)
```

**Semantics:**
- `claimMessage(id)`: shim calls after successful render to host. Atomic CAS `new → received`. Idempotent on already-claimed (same agent-id reclaiming returns existing state). Multi-agent same-role: claim is winner-takes-all; other agents see Message disappear from their inbox-projection.
- `ackMessage(id)`: LLM-consumer calls after acting (or actively-deferring). Atomic CAS `received → acked`. Idempotent on already-acked.
- Subsequent poll-backstop / reconnect-replay queries filter `status === "new"` — excludes both received + acked (received Messages don't re-render to consumer)

**Multi-agent same-role future-proofing:**
- Today: single architect (lily) + single engineer (greg). claim-and-ack collapse to a single agent's behavior.
- Future: 2+ agents same role. Claim wins one; others see Message gone. Robust dispatch primitive without schema-rework later.

**Open at v1.1:** when does LLM-consumer ack? Two natural points:
- (i) On consumer-action — explicit ack tied to business action ("I've reviewed PR #59 + approved task")
- (ii) On consumer-render — auto-ack at next turn after seeing the channel injection
Engineer T1 ratifies; lean (i) for explicit semantics. Recon may inform.

### 7. Legacy entity sunset (sub-ordering DirectorNotification → Notification → PendingActionItem)

Sunset (write-path removal + read-path migration to Message store), sequential per-entity for blast-radius isolation:

**Order rationale:**
1. **DirectorNotification first** (smallest read-path surface; lowest blast radius; warm-up for migration pattern)
2. **Notification second** (largest read-path coverage; once migrated, legacy SSE path obsolesces; biggest tele-3+10 win)
3. **PendingActionItem last** (ADR-017 saga FSM-touching; highest regression risk; migrate when pattern is dialed in)

Each entity's migration is its own commit/PR within W6 for clean revert.

Per-entity migration mechanics:
- Write-paths in `notification-emit` (or equivalent) cascade migrate to `create_message`; new code never touches the legacy entity write-API
- Read-paths (`get_pending_actions.unreadReports`, etc.) become Message-store projections per kind/subkind
- Legacy entity store ITSELF retained until all read-paths drained; backfill not required (existing notifications drain to acked over time via natural processing)
- ScheduledEvent entity (if separate from scheduled-Message) converges to Message with `delivery: "scheduled"`

Sunset criterion: no read-path remaining on legacy entity → entity-store removed in W7 cleanup.

**Pre-W6 grep audit (W0 deliverable):** engineer T1 greps all legacy-entity read-path call-sites; if any single entity exceeds ~20 sites, that's a per-entity sizing-trigger pushing W6 toward 3-4 days. Informs W6 sub-day estimates.

### 8. Tests + documentation update (large surface)

- Unit + integration tests: every mechanism currently using legacy entities migrates to Message + push primitive
- E2E tests: PR-merge → bridge create_message → SSE push → adapter receive → architect render flow
- ADR-026 (or next-N): companion to ADR-024 (storage primitive) + ADR-025 (message primitive); ratifies push-foundation as the canonical event-delivery layer
- Architecture documentation (`docs/architecture/`): updated push-system overview; how-to-add-new-event-type; sunset-checklist references
- Runbook documentation (`deploy/README`): operator-facing description of push system + hybrid poll backstop; env-var inventory
- Closing audit: per mission-43/46/47/49/50/51/52 canonical 8-section shape

## Recon Report findings folded in (post-mission-54)

Mission-54 (M-Push-Foundational-Adapter-Recon) produced the Recon Report at `docs/designs/m-push-foundational-adapter-recon.md` (PR #61 merged 2026-04-26 ~01:26Z). Three architect tele-evaluation outcomes:

### Q1 (architect-call): 2-layer vs 3-layer — **3-layer KEPT**

- **Foreign engineer chose 2-layer** (`@ois/network-adapter` shared + per-host shim) — tele-3 simpler decomposition; ~500 net lines deduplicated by hoisting dispatcher / cache / claim concerns into the network-adapter sovereign-package
- **Design v1.1 commitment #4 chose 3-layer** (network-adapter / Message-router (sovereign-package #6) / shim) — tele-3 stronger boundaries; Message-routing as a separable concern from MCP-transport-handler-factory
- **Architect tele-evaluation: KEEP 3-layer.** Foreign engineer's "dispatcher" is genuinely a different concern (MCP-boundary handler factory: Initialize/ListTools/CallTool, pendingActionMap) than Design v1.1's "dispatcher" (Message kind/subkind router). They are different layers of abstraction; both can exist. Sovereign-package #6 earns its boundary via Message-routing being separable, not by analogy. tele-3 favors stronger boundaries when the concerns are distinct enough to test independently.

### Q2 (architect-call): dispatcher naming role-overload — **RENAMED**

- Foreign "dispatcher" = MCP-boundary handler factory (lives in `@ois/network-adapter` per recon's 2-layer hoist)
- Design v1.1 "dispatcher" = Message kind/subkind router (sovereign-package #6)
- **Architect rename: Design's "dispatcher" → "Message-router".** Sovereign-package: `@ois/message-dispatcher` → `@ois/message-router`. Disambiguation cost is small at design-time, large at execution-time. Future engineers won't conflate.

### Q10 (Director-aware; methodology + sequencing): adapter-layer cleanup — **(a) separate mission**

- Director directive 2026-04-26 ~10:00Z: "adapter-layer-clean FIRST sequencing" — interpreted via Q10(a) as: cleanup IS the FIRST step (separate predecessor mission), NOT folded into M-Push-Foundation's W3+W4 substantive waves
- **New predecessor mission: M-Pre-Push-Adapter-Cleanup** (S; engineer-authored from scratch using foreign work as inspiration only per recon anti-goals; foreign tree at `/home/apnex/taceng/codex/agentic-network` is reference; no PRs from foreign engineer)
- Cleanup mission scaffolds the **5 reusable patterns** (recon §7) ahead of M-Push-Foundation, so push-foundation work executes against a cleaner adapter baseline with smaller-PR-reviewable surface
- Counter-argument considered + rejected: folding into W3+W4 conflates structural cleanup with new feature delivery (bigger PRs, harder review); deferring entirely loses the adapter-layer-clean-FIRST sequencing

### Patterns NOT reusable (recon §7 confirmed)

7 commitments still need from-scratch authoring regardless of recon adoption:
1. SSE push-on-Message-create (commitment #1; W1)
2. SSE Last-Event-ID Message-store-backed replay (commitment #2; W2)
3. claim/ack two-step semantics `new → received → acked` (commitment #6)
4. Render-surface seen-id LRU cache (commitment #4)
5. Legacy entity sunset (commitment #7; W6)
6. Hybrid push+poll backstop with since-cursor (commitment #5; W5)
7. `<channel>` source-attribute kind/subkind taxonomy (commitment #4; W4)

**The recon does not shrink M-Push-Foundation's substantive scope.** It informs adapter-layer structural choices + offers small clarity wins captured in the predecessor mission.

### Spec-level pre-look corrections

The architect's pre-look (in mission-54 preflight) speculated the foreign engineer was mid-execution of the **3-layer** decomposition. The Recon Report (greg's authoritative reading) corrected this: foreign work is **2-layer**. This correction is load-bearing for Q1 — the foreign work is NOT structural validation of Design v1.1 commitment #4; it's an alternate structural choice that the architect tele-evaluated and rejected (3-layer kept).

## M-Pre-Push-Adapter-Cleanup (predecessor mission; Q10(a) outcome)

**Status:** to be proposed via cascade post-Design v1.2 ratification.
**Scope:** S (~1-2 eng-days). Engineer-authored from scratch; foreign tree as reference inspiration only (anti-goals binding per mission-54: no copy-paste; no PRs from foreign engineer).
**Goal:** scaffold the 5 reusable patterns (recon §7) into our adapter codebase ahead of M-Push-Foundation, so push-foundation work executes against a cleaner adapter baseline.

**Reusable patterns to adopt as inspiration:**

1. **Code-dedup hoist + module sub-organization** — duplicated dispatcher / claim / cache code per-plugin → consolidated shared modules in `@ois/network-adapter` with hooks-pattern for host-injection. **Sub-organize `src/` into subdirs during the hoist:** `src/wire/` (transport / wire FSM), `src/kernel/` (handshake / session-claim / agent identity / instance lifecycle), `src/tool-manager/` (Initialize/ListTools/CallTool / pendingActionMap / tool-catalog cache). Naming-disciplined: `src/tool-manager/` modules are tool-manager-handler-factory concerns (foreign "dispatcher" semantics); does NOT live in or depend on the future Message-router (sovereign-package #6).
2. **`notificationHooks` callback bag pattern** — generic shim-injection contract: `{onActionableEvent, onInformationalEvent, onStateChange, onPendingActionItem}`. **This is the Universal Adapter notification contract** (Director-ratified). Adoptable as the host-injection contract shape for both the cleanup-mission MCP-boundary refactor AND the future Message-router-shim contract (commitment #4 inheriting the same hooks-shape). Spec'd in this mission per deliverable below.
3. **Lazy `createMcpServer()` factory** (vs eager `dispatcher.server`) — adoptable in HEAD as a clarity/correctness win independent of push-foundation work; supports per-session lifecycle for hosts with HTTP-session models (opencode-style).
4. **Tool-catalog cache distillation** (157→77 lines per recon §4) — schema-version + atomic write + null-tolerant `isCacheValid`. Reusable as inspiration only; properties don't transfer wholesale to commitment #4's seen-id LRU (different cache semantics: bounded LRU N=1000 in-memory vs schema-versioned-on-disk).
5. **Gate naming refinement** — `handshakeComplete` → `listToolsGate`, `agentReady` → `callToolGate`. Names what's gated, not what's complete. Adoptable in HEAD as a small clarity win.

**New deliverable: Universal Adapter notification contract spec.**

`docs/specs/universal-adapter-notification-contract.md` — generic notification interface specification, shim-agnostic. Co-authored from the cleanup work; architect-pool reviewed.

Spec covers:
- **Event taxonomy** — notification kinds/subkinds (`notification.actionable`, `notification.informational`, `state.change`, `pending-action.dispatch`)
- **Payload shapes** — JSON envelope per kind (`{kind, subkind, source, body, metadata}`)
- **Lifecycle** — fire/deliver/ack semantics; idempotency; at-least-once delivery
- **Hooks contract** — `notificationHooks: {onActionableEvent, onInformationalEvent, onStateChange, onPendingActionItem}` callbacks the shim implements
- **Render-surface semantics** — abstract description with claude-shim (`<channel>`) and opencode-shim (`client.session.promptAsync`) as worked examples
- **NOT host-specific mechanism** — spec doesn't mandate `<channel>` vs `promptAsync` vs terminal-stdout; per-shim implementation freedom

**Foreign-tree-deletion success criterion** (Director-ratified 2026-04-26): post-cleanup-merge, the foreign tree at `/home/apnex/taceng/codex/agentic-network` is no longer needed for any reference. Recon Report (PR #61, on main) preserves the architectural-pattern knowledge; cleanup mission ships the adopted patterns; foreign tree becomes redundant. Director may delete the foreign tree at will after cleanup-mission merge.

**Anti-goals (binding from mission-54 carried forward):**
- NOT a code-merge plan — engineer-authored from scratch; foreign work as inspiration only
- NOT line-by-line foreign-source adoption — patterns adopted at architectural level, not implementation level
- NO PRs from foreign engineer (not onboarded)
- NO Message-router or push-foundation work in this mission — those land in M-Push-Foundation's W3+W4
- NO new sovereign-packages in this mission — `@ois/message-router` lands in M-Push-Foundation W4
- NO npm-publish work — distribution-readiness is M-Adapter-Distribution scope (Tier 2; future)
- **NO new repo-internal couplings** — non-regression criterion: deps stay `@ois/*` resolvable; hooks/contracts authored to be relocatable to `@apnex/*` later (per future distribution mission)

**Tele alignment:**
- **Primary tele-3** (Sovereign Composition): consolidates duplicated per-plugin code into the existing `@ois/network-adapter` sovereign-package; clean shim/host boundary preserved; subdir sub-organization makes the layer-1-internal sub-concerns explicit
- **Secondary tele-9** (Frictionless): smaller PRs in M-Push-Foundation when adapter baseline is clean; reduces architect-review overhead in W3+W4
- **Secondary tele-2** (Isomorphic Specification): Universal Adapter notification contract spec captures the host-injection interface schema-driven; future hosts (terminal-direct, ACP-host) implement against the same spec
- **Tertiary tele-7** (Confidence-Coverage): test-rewiring discipline already validated by foreign engineer (recon §4 + §6); adopting the same pattern reduces test-migration risk

**Sequencing into M-Push-Foundation:**
M-Pre-Push-Adapter-Cleanup ships → engineer round-2 audit of Design v1.2 (against post-cleanup adapter) → propose_mission cascade for M-Push-Foundation → Director activates M-Push-Foundation → W0-W7 ship.

**Cleanup mission deliverables checklist:**
1. Hoist dispatcher/claim/cache from per-plugin shims into `@ois/network-adapter` sub-organized into `src/wire/` + `src/kernel/` + `src/tool-manager/` subdirs (engineer-authored from scratch; foreign work as inspiration only)
2. `notificationHooks` callback bag pattern adopted as Universal Adapter notification contract
3. Lazy `createMcpServer()` factory replaces eager `dispatcher.server`
4. Tool-catalog cache distilled (schema-version + atomic write + null-tolerant `isCacheValid`)
5. Gate naming refined (`handshakeComplete` → `listToolsGate`; `agentReady` → `callToolGate`)
6. `docs/specs/universal-adapter-notification-contract.md` spec authored
7. Test rewiring per recon §4 pattern (preserve test parity; mocks updated)
8. Foreign-tree-deletion success criterion verified — confirm Recon Report + cleanup work cover all the architectural-pattern knowledge; foreign tree may be deleted post-merge
9. Hub vitest baseline preserved; cross-package failures match bug-32 pre-existing pattern
10. Closing audit per mission-43/46/47/49/50/51/52/54 canonical 8-section shape

## Anti-goals (BINDING)

Each anti-goal mapped to the tele it protects:

- **NO legacy Notification / PendingActionItem / DirectorNotification write-paths in new code** (protects tele-3 + tele-10)
- **NO recurring polling INSTEAD of push** (protects tele-9; poll BACKSTOP is OK; poll-instead-of-push is not)
- **NO ad-hoc transport bolt-ons** (protects tele-2; canonical SSE Last-Event-ID protocol only)
- **NO transitional shapes** (protects tele-3; converge to latest end-to-end; no temporary dual-emission paths in committed code)
- **NO tool-surface public-API redesign** (defers to idea-121; mission ships the push transport + entity migration, not full verb redesign)
- **NO new Message kind/subkind taxonomy in scope** (mission-51 W1 ratified; this mission moves the entities, doesn't redesign them)
- **NO breaking adapter-side MCP-tool-surface contract** (existing adapter callers preserved; render-surface change is additive)

## Out of scope

- idea-186 (npm workspaces) — orthogonal; sunsets mission-50/52 cross-package anti-patterns; can ship before/during/after this mission without coupling
- idea-202 (CI revisit) — orthogonal operability surface
- idea-199 (M-Workflow-FSM-Completeness) — downstream consumer of this mission's push layer; opens after this mission lands
- idea-197 (M-Auto-Redeploy-on-Merge) — Tier 3 downstream consumer
- M-Repo-Event-Bridge-Adoption shrinks to ~S follow-on (sink-target + correlation parser); ships after M-Push-Foundation
- Subsecond-precision push (current SSE adequate for sub-30s; latency tighter is post-MVP)
- Multi-org / multi-tenancy push isolation (current single-org architecture; tenant separation is its own future mission)
- **ACP (Agent Communication Protocol) framing** — separate downstream design conversation; doesn't gate or shape Universal Adapter / push-foundation work; Director-confirmed 2026-04-26 ("ACP is separate to this work")
- **Distribution-readiness / npm publish** — current `@ois/*` package names use `file:` tarball deps in the host-plugin packages (`@ois/claude-plugin`, `@ois/opencode-plugin`); external `npm install` of host-plugins is not currently supported. **Future M-Adapter-Distribution mission** (Tier 2; separate scope) handles: (i) registry namespace migration to **`@apnex/*`** (Director's npm org per memory `project_npm_namespace_apnex.md`); (ii) sovereign-package npm publish workflow; (iii) host-plugin deps from `file:` to registry semver. **M-Pre-Push-Adapter-Cleanup non-regression criterion: cleanup work must NOT introduce new repo-internal couplings** that worsen distribution shape (deps stay `@ois/*` resolvable; hooks/contracts authored to be relocatable to `@apnex/*` later)

## Mission-53 absorption (per greg's audit)

mission-53 (M-Adapter-Reconnection; design ratified at thread-313 round-2) overlaps ~80% with M-Push-Foundation's adapter-side scope:
- SSE reconnect with Last-Event-ID replay
- Connection-loss detection
- Exponential backoff retry
- Idempotency dedup on replay

**Absorption decision:** mission-53 folds into M-Push-Foundation. Single design + single trace + single closing audit. mission-53's scope (per thread-313) is preserved verbatim within M-Push-Foundation's adapter-side architectural commitments. mission-53 status flips to abandoned with note pointing to M-Push-Foundation.

bug-34 (parent of mission-53) flips to resolved at M-Push-Foundation merge with `linkedMissionId: "M-Push-Foundation"` + `fixCommits: <wave-merge-SHAs>`.

## XL escalation triggers (pre-authorized)

**L-baseline-firm**. Pre-authorized XL escalation if **(a) AND (b)** BOTH realize (tightened from "2-of-5" per greg's W0-preview audit; 3 triggers cleared, 2 residual):

1. **(a) SSE Last-Event-ID protocol — PARTIAL existing.** `hub/src/amp/envelope.ts:38-40` (`isLegacyCursor()`); `hub-networking.ts:340` (`listSince()`); `sseActive` map exists. Last-Event-ID protocol IS in SSE transport layer. Missing: Message-store-backed replay wiring. **Probability: ~30% realize as full M-class extension.**

2. **(b) Adapter SSE event-handler extension** surfaces MCP-handshake-on-reconnect complexity (mission-53 territory; folded). Engineer T1 (W3) audits `packages/network-adapter/src/handshake.ts` to confirm. **Probability: ~50% realize as M-class extension.**

3. **~~(c) Adapter render-surface~~ CLEARED via existence proof.** Current dispatch notifications use `<channel>` injection; mechanism functional. W4 task replicates. **Probability: ~5%.**

4. **~~(d) MessageTarget shape extension~~ CLEARED.** `hub/src/entities/message.ts:130-139` defines `MessageTarget { role?: MessageAuthorRole; agentId?: string }` — both optional, supports `{role: "architect"}` exactly. **Probability: ~5%.**

5. **~~(e) Active-subscriber resolution new Hub-side path~~ REUSE LIKELY.** Existing `sseActive` filter for legacy notifications composes; W1 work extends, not replaces. **Probability: ~15%.**

**Cleared-prerequisites:**
- `ackMessage` idempotency: `message-repository.ts:321-366` explicit impl + comment confirming idempotent re-ack. No prereq work.
- `MessageDelivery.push-immediate` already in `MESSAGE_DELIVERY_MODES` + default in `message-policy.ts:109`. No prereq work.

**XL escalation rule:** mission entity language: "L-firm; XL escalation if (a) AND (b) BOTH realize."

## Wave decomposition (engineer-decision pending audit-round-2)

**Two viable shapes; engineer-final at audit-round-2 (post-recon):**

### 8-wave granular (smaller PR review surface):

- **W0** spike — audit current SSE state (Last-Event-ID? subscriber-match? emit() filter shape?); legacy-entity read-path grep; thread-313 scope cross-map; confirm trigger probabilities; ratify L-vs-XL sizing
- **W1** Hub-side push-on-Message-create + subscriber-match wiring + SSE event-type emission
- **W2** Hub-side Last-Event-ID protocol + replay-buffer (Message-store-backed) + cold-start stream-all-with-soft-cap + replay-truncated synthetic event
- **W3** Adapter-side network-layer: SSE event-handler + Last-Event-ID reconnect logic + seen-id cache
- **W4** Adapter-side dispatcher + host-shim: 3-layer decomposition (`@ois/message-dispatcher` sovereign-package #6) + render-surface (`<channel>` injection per kind/subkind)
- **W5** Adapter-side hybrid poll backstop with since-cursor + claim/ack two-step semantics
- **W6** Legacy entity sunset (DirectorNotification → Notification → PendingActionItem; sequential)
- **W7** Tests + documentation + ADR-026 + closing audit

### 6-wave bundled (engineer-leaned for fewer-but-meatier waves):

- **W0** spike (same as 8-wave)
- **W1** Hub-side push + Last-Event-ID protocol + cold-start (W1+W2 bundled — share `message-policy.ts:handleCreateMessage` call-site)
- **W2** Adapter-side network + dispatcher + shim (3-layer decomposition + SSE handler + render-surface; W3+W4 bundled)
- **W3** Adapter-side hybrid poll backstop + claim/ack semantics (W5)
- **W4** Legacy entity sunset (W6 unchanged; sub-ordering preserved)
- **W5** Tests + documentation + ADR-026 + closing audit (W7)

bug-31 bypass technique sunset post-mission-51 W5; this mission can use plannedTasks.

## Sizing

**L-firm baseline** (revised post-greg-W0-preview; 3-of-5 triggers cleared).

Per-wave estimate (8-wave shape):
- W0 spike: ~half-day (extended for legacy-entity grep + thread-313 scope cross-map)
- W1 push-on-create: ~half-day
- W2 Last-Event-ID protocol + replay: ~half-day (W0-cleared partial existing support; was 1-2 days)
- W3 adapter SSE handler + seen-id cache: ~half-day
- W4 dispatcher factor-out + render-surface: ~1 eng-day (sovereign-package #6 scaffolding adds ~half-day vs flat-adapter)
- W5 hybrid poll backstop + claim/ack: ~half-day
- W6 legacy sunset: **2-3 eng-days** (sequential; touch-everywhere; ADR-017 saga FSM read-paths add real audit)
- W7 tests + docs + ADR-026 + closing audit: 1-2 eng-days

**Total: ~6-8 eng-days L-firm baseline.** XL escalation only if (a) AND (b) BOTH realize fully.

If 6-wave bundled shape: same total, fewer-but-meatier waves; engineer-final at audit-round-2.

## Engineer audit asks

**Round-1 audit complete** (greg's thread-317; W0 codebase preview cleared 3-of-5 triggers; tele-mapping refinements adopted; sizing tightened to L-firm with `(a) AND (b)` XL gate; sub-orderings ratified).

**Recon (mission-54) closed** — 5 reusable patterns + 7 from-scratch commitments + 2-vs-3-layer + naming + sequencing all surfaced; architect tele-evaluation produced Q1/Q2/Q10 outcomes folded into v1.2.

**Round-2 audit (post-cleanup; against Design v1.2):** runs after M-Pre-Push-Adapter-Cleanup ships. Asks remaining for greg:

1. **Wave decomposition final-pick:** 8-granular vs 6-bundled — engineer's call given the cleaner post-cleanup adapter baseline (cleanup removes some dispatcher-refactor surface from W3+W4)
2. **claim semantics — auto-on-render vs explicit-LLM-call:** ratify ack-on-action (Option i) vs ack-on-render (Option ii)
3. **`<channel>` source-attribute schema final-pick:** confirm taxonomy (`plugin:agent-adapter:repo-event` / `:directive` / `:notification`) is right granularity
4. **Seen-id cache size + eviction policy:** N=1000 reasonable? LRU vs TTL eviction?
5. **`list_messages` since-cursor support:** verified existing OR added in W5?
6. **W0 deliverables:** legacy-entity read-path grep + thread-313 scope cross-map (still required; recon didn't substitute)
7. **Sizing rule:** confirm L-firm + (a)+(b) XL gate (post-cleanup may reduce trigger (b) probability since handshake/reconnect lifecycle stabilizes)
8. **Legacy entity sunset W6:** any engineer concerns on the DirectorNotification → Notification → PendingActionItem ordering, or migration regression risk?
9. **Multi-host shim factor-out:** 3-layer decomposition supports future opencode-plugin / terminal-direct as extension points; cleanup-mission `notificationHooks` adoption shapes the hook surface for Message-router downstream
10. **Q1/Q2 architect outcomes coherent with engineer-spec view:** explicit ratification ask — does the 3-layer-kept + Message-router-rename hold up under engineer-spec-level scrutiny against the post-cleanup codebase, or surface tele-misalignment?

## Cross-references

- **mission-51 W6** — shipped Message primitive + ADR-025; this mission lands the deferred push transport
- **mission-52** — shipped GH-event bridge producer-side; consumes M-Push-Foundation post-merge for adapter-side delivery
- **mission-53 (absorbed)** — design at thread-313; scope folded into this mission's adapter-side commitments
- **bug-34** — closes at M-Push-Foundation merge
- **idea-200** (Thread.messages[] removal) — orthogonal but related cleanup; can ship before/during/after
- **idea-201** (Notification + PendingActionItem + DirectorNotification projection migration) — ABSORBED into this mission's W6 legacy sunset
- **idea-186** (workspaces) — orthogonal; sunsets mission-50/52 cross-package anti-patterns
- **idea-202** (CI revisit) — orthogonal operability surface
- **idea-199** (FSM-completeness) — downstream consumer
- **idea-197** (auto-redeploy-on-merge) — downstream consumer
- **idea-204** (workflow-gap inventory) — Tier 1 wave gaps unlocked by this mission; Tier 2/3 follow-on

## Provenance

- mission-51 W6 deferral: explicit anti-goal in mission-51 brief
- Director directives 2026-04-26 ~09:00Z: "We need to converge on latest non-legacy messaging primitives, with modern latest event/push system"
- Director directives 2026-04-26 ~09:15Z: "this is foundational ... full mission shape that bounds the foundational messages events layer ... formal design against Tele"
- Director directives 2026-04-26 ~09:25Z: hybrid push+poll consideration
- Architect 3-pivot history (thread-314 → 315 → 316): legacy-bolt-on → polling → SSE-push-only — final pivot to SSE-push + hybrid-poll-backstop derived directly from Tele evaluation per calibration #23
- greg's thread-316 audit: concerns F + (c); mission-53 bundle recommended
- greg's thread-317 audit (Design round-1): 3-of-5 sizing-triggers cleared via codebase grep; tele-mapping additive refinements; sub-ordering recommendations
- Director directives 2026-04-26 ~10:00Z: ratified Option C ack semantics + claim/ack two-step + 3-layer adapter decomposition + dispatcher sovereign-package #6
- Director directives 2026-04-26 ~10:00Z: adapter-layer-clean FIRST sequencing
- Director directives 2026-04-26 ~10:05Z: foreign-engineer recon as Design-phase spike (engineer-audited per architect-spec-level discipline)
- Methodology calibrations 11-23 in flight; this mission is the canonical example of calibration #23 (formal-Design-phase-per-idea + tele-pre-check) in execution
- Mission-54 (M-Push-Foundational-Adapter-Recon) closed 2026-04-26 ~14:11 AEST; PR #61 (Recon Report) merged ~01:26Z; PR #60 (Design v1.1 + 2 preflights) merged ~01:33Z; cross-approval pattern (architect-pool ✓ on engineer-authored + engineer-pool ✓ on architect-authored doc-PRs) executed cleanly per Director scoping clarification (PR approvals peer-to-peer; out of Director scope)
- Design v1.2 (this revision) produced 2026-04-26 ~14:30 AEST in autonomous-loop window post Director's `<<autonomous-loop-dynamic>>` re-entry; architect leans on Q1/Q2/Q10 surfaced in synthesis-to-Director ahead of v1.2 authoring (Director-aware; Director-redirect-via-PR-review available)

## Recon mission status (CLOSED)

**Mission-54 (M-Push-Foundational-Adapter-Recon) closed 2026-04-26 ~14:11 AEST** post architect-pool ratification of Recon Report (PR #61 merged ~01:26Z; greg-authored). End-to-end velocity: T1 dispatch → mission-completed in ~26 minutes vs S half-day baseline. Recon executed exactly the spec-level discipline calibration #23 envisioned.

**Recon outputs folded into Design v1.2:** see §"Recon Report findings folded in" above (Q1 keep 3-layer; Q2 rename to Message-router; Q10(a) separate cleanup mission).

**Sequencing as-executed:** recon (mission-54 closed) → Design v1.2 (this artifact) → propose_mission cascade for **M-Pre-Push-Adapter-Cleanup** (predecessor) → Director activates cleanup mission → cleanup ships → engineer round-2 audit of Design v1.2 against post-cleanup adapter baseline → propose_mission cascade for M-Push-Foundation → Director activates → W0-W7 ship.

## Status flow

```
Draft v1.1 (locked reference snapshot; PR #60 merged 2026-04-26 ~01:33Z)
     │
     ▼
Mission-54 recon (greg code audit → Recon Report PR #61 merged ~01:26Z) — CLOSED
     │
     ▼
Design v1.2 (this artifact; recon-informed revision; Q1 + Q2 + Q10(a) folded in)
     │
     ▼
propose_mission cascade for M-Pre-Push-Adapter-Cleanup (architect stages)
     │
     ▼
Director activates M-Pre-Push-Adapter-Cleanup
     │
     ▼
Cleanup ships (~1-2 eng-days; 5 reusable patterns adopted as inspiration)
     │
     ▼
greg round-2 audit of Design v1.2 (against post-cleanup adapter baseline)
     │
     ▼
Convergence — architect ratifies → stages propose_mission cascade for M-Push-Foundation
     │
     ▼
Director activates M-Push-Foundation
     │
     ▼
W0 spike → W1...W7 ship → closing audit → architect retrospective → mission close
```

## Next steps

1. **Architect commits Design v1.2** (this artifact) + opens fresh-off-main PR per `multi-agent-pr-workflow.md` calibration B
2. **Architect stages propose_mission cascade for M-Pre-Push-Adapter-Cleanup** (predecessor; S sizing; engineer-authored from scratch; foreign tree as inspiration only)
3. Director activates M-Pre-Push-Adapter-Cleanup
4. Engineer (greg) ships cleanup mission via fresh-off-main PRs (calibration B); architect-pool review per `§approval-routing`
5. Post-cleanup-merge: greg round-2 audit of Design v1.2 against post-cleanup adapter baseline (new thread or reused thread-317; engineer-decision)
6. Convergence on round-2 → architect stages propose_mission cascade for M-Push-Foundation
7. Director activates M-Push-Foundation
8. Mission ships W0-W7 → closing audit → architect retrospective

— lily / architect
