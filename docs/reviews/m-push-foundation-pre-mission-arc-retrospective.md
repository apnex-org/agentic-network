# M-Push-Foundation Pre-Mission Autonomous Arc — Retrospective

**Status:** Draft v1.0 (architect-authored 2026-04-26 ~14:20 AEST; collaborative walkthrough with Director)
**Scope:** Autonomous-arc execution from PR #62 (Design v1.2) merge through M-Push-Foundation propose_mission HOLD point — covers mission-54 (recon, pre-arc) + mission-55 (cleanup) + Design v1.2 + round-2 audit
**Window:** 2026-04-26 ~01:26Z → ~03:15Z (~110 min real-time including arc + retrospective surface)
**Author:** lily / architect
**Walkthrough:** Director-paced; one section per chat round; doc updated per Director feedback inline

---

## §1 Context + scope

### Why this retrospective exists

Director directive 2026-04-26 ~14:50 AEST: *"Requesting that you drive full autonomous next steps until step 5. Put in necessary loops and threads to coordinate with greg. Autonomous — though hold once M-Push-Foundation mission is ready to be staged, so we can do a retrospective."*

This is the retrospective the directive scheduled. It captures what happened in the autonomous arc, what calibration insights surfaced, what workflow gaps were observed, and what's queued post-retrospective for M-Push-Foundation activation.

### What the autonomous arc covered

5 explicit steps + a HOLD point:

1. PR #62 Design v1.2 merged → main
2. M-Pre-Push-Adapter-Cleanup mission (mission-55) created + activated
3. T1 dispatched to greg via thread-321
4. Cleanup shipped — 10 deliverables across PR #63/#64/#65 in ~3 hours engineer-time
5. Round-2 audit of Design v1.2 against post-cleanup adapter baseline (thread-325; bilateral seal)
**HOLD:** M-Push-Foundation propose_mission cascade NOT staged; Director-conducted retrospective first

### Predecessor context

The autonomous arc itself was the second half of a longer arc starting earlier in the day:

- **mission-54 (M-Push-Foundational-Adapter-Recon)** — Director-disclosed foreign-engineer adapter cleanup work at `/home/apnex/taceng/codex/agentic-network`. greg performed spec-level recon; produced 8-section Recon Report at `docs/designs/m-push-foundational-adapter-recon.md` (PR #61 merged 2026-04-26 ~01:26Z); architect tele-evaluated. Closed ~01:33Z. **Surfaced 5 reusable patterns + 10 architect-tele-evaluation questions including the load-bearing 2-vs-3-layer (Q1), dispatcher naming role-overload (Q2), and adapter-layer-clean-FIRST sequencing (Q10).**
- **Design v1.2 authoring** — architect-authored revision of v1.1 incorporating Q1/Q2/Q10 outcomes + Director-ratified Universal Adapter framing (`@ois/network-adapter` IS the Universal Adapter) + Layer-1 module sub-organization (wire/Kernel/mcp-boundary) + Universal Adapter notification contract spec deliverable + foreign-tree-deletion success criterion + future M-Adapter-Distribution flag (`@apnex/*` namespace). PR #62 merged ~02:05Z.

### What's at HOLD

**M-Push-Foundation** mission entity is fully ratified at design level + engineer-spec level (round-2 audit thread-325). Architect-side `create_mission(M-Push-Foundation, ...)` cascade is ready to fire — held pending Director retrospective ratification + green-light.

### Methodology framing

This arc is the **third canonical execution example of methodology calibration #23** (formal-Design-phase-per-idea + tele-pre-check):
- mission-54 = first execution (recon as Design-phase spike)
- mission-55 = second execution (cleanup against ratified Design v1.2)
- M-Push-Foundation = third execution (substantive feature mission against post-cleanup baseline; pending)

Also the second canonical execution of the **autonomous-arc-driving pattern** (architect drives N steps; Director defines HOLD points; ratifies at boundaries).

---

## §2 Timeline

| Time (UTC) | Milestone | Commit | Notes |
|---|---|---|---|
| 00:50Z | mission-54 recon mission filed | — | Architect-staged; Director-ratified |
| 01:12Z | T1 dispatched to greg (thread-318) | — | Foreign-code path shared by Director ~13:45 AEST |
| 01:24Z | Recon Report PR #61 opened | — | greg-authored; spec-level discipline; 8 sections |
| 01:26Z | PR #61 merged | `f519f74` | architect-pool ✓ + admin-merge per bug-32 pattern |
| 01:33Z | mission-54 closed | — | post architect ratification of Recon Report |
| 01:33Z | PR #60 (Design v1.1 + 2 preflights) merged | `08643e5` | doc-queue close-out |
| 02:05Z | **PR #62 Design v1.2 merged** | `cc90174` | Q1/Q2/Q10 + Universal Adapter framing folded in |
| 02:07Z | mission-55 created + flipped active | — | architect-flip per autonomous-arc directive |
| 02:07Z | T1 dispatched to greg (thread-321) | — | greg ratified 3-PR plan in ~1 min |
| 02:32Z | PR #63 (cleanup PR 1: hoist + 7 deliverables) opened | — | ~24min from T1 dispatch |
| 02:33Z | PR #63 merged | `983e926` | architect-pool ✓; ~80sec from open |
| 02:55Z | greg observed idle (~22min) | — | **coordination handoff gap surfaced** |
| 02:56Z | Architect ping (thread-322) | — | nudge after Director observation |
| 03:00Z | PR #64 (cleanup PR 2: spec) opened | — | ~4min from nudge |
| 03:01Z | PR #64 merged | `736e13d` | spec is high-quality; substantive review |
| 03:02Z | Architect ping (thread-323) — proactive | — | **lesson applied; no idle gap this time** |
| 03:08Z | PR #65 (cleanup PR 3: closing audit) opened | — | ~6min from ping |
| 03:10Z | PR #65 merged | `ef633144` | mission-55 closing PR |
| 03:10Z | mission-55 closed | — | architect-flip; routine |
| 03:11Z | Architect ping (thread-324) — proactive | — | step 5 nudge |
| 03:14Z | Round-2 audit (thread-325) — greg-initiated | — | comprehensive; all 10 asks ratified |
| 03:15Z | **Round-2 bilateral seal** | — | HOLD point reached |

**Total real-time arc:** ~85 minutes from PR #62 merge → round-2 convergence.
**Total engineer-time mission-55:** ~3 hours across 3 PRs (lower edge of S sizing per pattern-replication-sizing calibration).
**Architect cross-approval velocity:** PR open → merge ~80-90 sec average.

---

## §3 Mission outcomes

### mission-54 — M-Push-Foundational-Adapter-Recon (CLOSED)

**Output:** `docs/designs/m-push-foundational-adapter-recon.md` (commit `f519f74`).

**Spec-level findings:**
- Foreign engineer (`/home/apnex/taceng/codex/agentic-network` HEAD `f29635d`) implemented a **2-layer hoist**, NOT 3-layer as architect's pre-look had assumed
- ~835 lines duplicate-across-plugins → ~430 shared (~500 line dedup)
- Wire/transport/session FSM untouched by foreign work — preserved from L4/L7 ADR-008 split
- Foreign work is **MCP-boundary refactor**, not push-foundation work; pre-Message-primitive baseline (predates mission-51 W6 + mission-52)

**5 reusable patterns surfaced:**
1. Code-dedup hoist (per-plugin → shared with hooks-pattern)
2. `notificationHooks` callback bag (host-injection contract)
3. Lazy `createMcpServer()` factory (vs eager construction)
4. Tool-catalog cache distillation (schema-version + atomic write + null-tolerant `isCacheValid`)
5. Gate naming refinement (names what's gated, not what's complete)

**10 architect-tele-evaluation questions** — Q1 (2-vs-3-layer), Q2 (dispatcher naming), Q10 (sequencing) load-bearing.

### Design v1.2 — M-Push-Foundation Design (MERGED)

**Output:** `docs/designs/m-push-foundation-design.md` v1.2 (commit `cc90174`).

**Architect tele-evaluation outcomes folded in:**
- **Q1: 3-layer KEPT** — sovereign-package #6 boundary earned by separability of Message-routing from MCP-boundary handler-factory
- **Q2: Rename** — Design's "dispatcher" → "Message-router"; sovereign-package `@ois/message-dispatcher` → `@ois/message-router`
- **Q10: (a) separate predecessor mission** — M-Pre-Push-Adapter-Cleanup scaffolds reusable patterns ahead of M-Push-Foundation

**Director-ratified additions:**
- Universal Adapter framing — `@ois/network-adapter` IS the Universal Adapter
- Layer-1 module sub-organization — `src/wire/` (transport) + `src/session/` (Kernel) + `src/mcp-boundary/` (MCP request handlers)
- Universal Adapter notification contract spec deliverable
- Foreign-tree-deletion success criterion
- Future M-Adapter-Distribution flag — `@apnex/*` namespace migration

### mission-55 — M-Pre-Push-Adapter-Cleanup (CLOSED)

**Output:** 10 deliverables across PR #63/#64/#65.

**Concrete shipped:**
- `packages/network-adapter/src/{wire,session,mcp-boundary}/` — Layer-1 sub-organization on main
- `notificationHooks` callback bag pattern — Universal Adapter notification contract surface
- Lazy `createMcpServer()` factory + tool-catalog cache distillation + gate naming refinement
- `docs/specs/universal-adapter-notification-contract.md` — generic shim-agnostic spec (commit `736e13d`)
- `docs/audits/m-pre-push-adapter-cleanup-closing-report.md` — canonical 8-section closing audit (commit `ef633144`)
- 70/70 new unit tests passing; Hub vitest baseline preserved (919/5)

**Sizing realized:** S lower edge (~3 hours engineer-time vs 1-2 day estimate). Pattern-replication-sizing-calibration validated again.

### Round-2 audit thread-325 (CONVERGED)

**Output:** Design v1.2 ratified at engineer-spec level. All 10 round-2 asks substantively answered.

**Engineer-final calls:**
- 6-bundled wave decomposition (W3+W4 collapse into W2 post-cleanup; smaller adapter surface)
- claim semantics: Option (i) explicit-ack-on-action (multi-agent same-role future-proofing)
- `<channel>` taxonomy: 3-family + `:proxy` fallback
- Seen-id LRU N=1000 + `OIS_ADAPTER_SEEN_ID_CACHE_N` env override
- L-firm sizing holds; (a)+(b) XL gate ~9% combined post-cleanup

**No tele-misalignment surfaced.** Q1/Q2/Q10 outcomes hold under engineer-spec scrutiny.

---

## §4 Calibration insights ratified

Director ratified the following calibration insights at retrospective surface (1-7) plus #7 tele-evaluation answer:

### 1. Test rewiring under-estimate (greg's closing audit §5.2) — RATIFIED

When a mission's "test rewiring" item underwrites tests against a NEW API shape (constructor sig / return shape / gate naming), scope budget for genuine test-code rewrites at **~1.5x the recon's naive search-and-replace estimate**. mission-55 absorbed the variance into S lower-edge sizing; future pattern-replication missions should size accordingly.

### 2. Cross-approval pattern stabilized — RATIFIED

Across 6-PR lineage (#60/#61/#62/#63/#64/#65), the operational pattern executed cleanly:
- engineer-pool ✓ on architect-content paths (`docs/designs/`, `docs/specs/`, `docs/audits/`, `docs/missions/`)
- architect-pool ✓ on engineer-content paths (`packages/network-adapter/`, `adapters/*/`)
- Both via the repo's "approval from someone other than the last pusher" rule
- In our 2-agent system this functionally means **the OTHER agent always does the cross-approval ✓** regardless of strict CODEOWNERS pool

**Director ratified formalizing in `docs/methodology/multi-agent-pr-workflow.md` v1.1.**

### 3. Bug-32 stable failure mode — RATIFIED

8th consecutive PR landing with cross-package vitest failure pattern intact (`packages/network-adapter` + `adapters/claude-plugin` + `adapters/opencode-plugin` all FAILURE; workflow-level `test` SUCCESS). Admin-merge baseline informally adopted; merge-velocity data demonstrates this is a stable failure mode rather than regression risk.

### 4. Coordination handoff gap during multi-PR missions — RATIFIED

greg idled ~22min after PR #63 merge until architect ping (thread-322). Root cause: greg's adapter doesn't push-receive PR-merge events; thread-321 sealed before PR 1 merged; no wake signal flowed.

**Interim discipline (until M-Push-Foundation W2 adapter SSE handler lands):** architect proactively pings via fresh short thread after each merge in multi-PR missions. Applied successfully for thread-323 (post PR #64 merge → 6min to PR 3 open).

**Structural fix:** M-Push-Foundation W1 push-on-create + W2 adapter SSE handler eliminates the gap. The mission's own justification.

### 5. Calibration #23 has multiple canonical executions — RATIFIED

Methodology calibration #23 (formal-Design-phase-per-idea + tele-pre-check):
- **Execution 1:** mission-54 (recon as Design-phase spike)
- **Execution 2:** mission-55 (cleanup against ratified Design v1.2)
- **Execution 3 (pending):** M-Push-Foundation (substantive feature mission)

**Director ratified: author calibration #23 methodology doc NOW** — three executions either side of M-Push-Foundation gives Director ratification surface. Doc lands at `docs/methodology/calibration-23-formal-design-phase.md` (or similar) as a downstream artifact.

### 6. Pattern-replication-sizing-calibration validated again — RATIFIED

mission-55 hit S lower edge realized (~3 hours vs 1-2 day estimate). Cleanup is mechanical-with-judgement using the recon's distilled blueprint; no novel structural decisions inside the mission. Calibration: when a mission scope is "execute the patterns a recon already distilled", size at S lower edge.

### 7. Tele evaluation of post-cleanup adapter — RATIFIED

**Query:** "Have we now fully deduplicated the old dispatcher pattern so that shared code is shared, and shims are strictly last mile? Is our updated adapter structurally closer to perfection according to Tele?"

**Answer:** **Substantially closer; full alignment requires M-Push-Foundation to ship Layers 1+2+3 together with message-primitive integration.**

| Tele | Pre-cleanup | Post-cleanup | Post-M-Push-Foundation (projected) |
|---|---|---|---|
| **tele-3** Sovereign Composition | Per-plugin duplication; unclear boundaries | Layer 1 has 3 explicit sub-concerns; shims minimal; sovereign boundary clean | + Layer 2 Message-router earns its sovereign-package boundary |
| **tele-9** Frictionless | Manual coordination required | Same as pre (no push transport yet) | Push on Message create eliminates manual coord |
| **tele-2** Isomorphic Specification | No formal contract spec | Universal Adapter notification contract spec on main | + Layer 2 routing contract spec extends additively |
| **tele-7** Confidence-Coverage | Tests duplicated per-plugin | Test parity preserved + 70 new tests | + e2e push-foundation tests; multi-host parity tests |
| **tele-4** Zero-Loss Knowledge | Knowledge implicit in code | Recon Report + Design v1.2 + spec doc + closing audit document everything | + ADR-026 ratifies push-foundation as canonical event-delivery layer |
| **tele-10** Hub-as-Single-Source-of-Truth | Notification + PendingActionItem + DirectorNotification all separate stores | Same as pre | + W6 legacy entity sunset; Message store single truth |

**Dedup ~95% complete** (~835 → ~430 shared lines; both shims consume same shared dispatcher).
**Shims strictly last-mile** (host-binding only; one structural residual: `makeOpenCodeFetchHandler` correctly in opencode shim because HTTP routing IS host-specific).
**Adapter is structurally ready** for the foundational push layer to land cleanly.

---

## §5 Workflow gaps observed + structural fixes scheduled

### Coordination handoff gap (calibration insight #4)

**Observed:** greg idled ~22min after PR #63 merge until architect ping. Director observed before architect did.

**Root cause:** greg's adapter doesn't push-receive PR-merge events; thread coordination sealed before merge; no wake signal flowed.

**Interim discipline:** architect proactively pings via fresh short thread after each merge in multi-PR missions.

**Structural fix scheduled in M-Push-Foundation W1+W2:**
- W1 Hub-side push-on-Message-create (mission-52 bridge fires `repo-event/pr-merged` → Hub stores → SSE pushes to subscriber)
- W2 adapter SSE event-handler + Message-router routes via `notificationHooks.onActionableEvent`
- Engineer's claude-shim renders via `<channel>` source `plugin:agent-adapter:repo-event` → engineer LLM wakes for next task

**Net post-M-Push-Foundation:** zero manual coordination pings; the merge event itself is the wake signal.

### PR-review workflow event-driven closure

**Engineer flow post-M-Push-Foundation:**
1. Engineer raises PR via `gh CLI`
2. mission-52 bridge fires `repo-event/pr-opened` Message
3. M-Push-Foundation W1 push-on-create fires SSE to architect's adapter
4. M-Push-Foundation W2 Message-router routes via `notificationHooks.onActionableEvent`
5. Architect's claude-shim renders via `<channel>` source `plugin:agent-adapter:repo-event` → architect LLM wakes for review
6. Architect reviews + merges (or requests changes) via `gh CLI`
7. mission-52 bridge fires `repo-event/pr-merged` (or `repo-event/pr-review-changes-requested`) Message
8. Same M-Push-Foundation push pipeline routes back to engineer's claude-shim
9. Engineer's adapter wakes LLM with PR-completed notification → engineer continues autonomously

**Architect flow:** symmetric. Receive PR-opened push → review → action → engineer-side push closes the loop.

### Mission lifecycle / state machine doc

**Validation:** `docs/methodology/mission-lifecycle.md` v0.1 (2026-04-25, lily-authored) EXISTS. Director's instinct correct — we have it.

**Status:** v0.1 draft; not a policy doc; a MAP of mechanics. Explicitly names workflow-primitive ideas (idea-191 repo-event-bridge, idea-192 hub-triggers-inbox) as gap-closers.

**Convergence path post-M-Push-Foundation:**
- mission-52 shipped idea-191 (repo-event-bridge producer-side) ✓
- mission-51 W6 shipped Message primitive (idea-192's spirit) ✓
- M-Push-Foundation W1+W2 closes the remaining push-pipeline gaps
- Post-M-Push-Foundation: ratify mission-lifecycle.md to **v1.0 RATIFIED** capturing the now-mechanised state

### multi-agent-pr-workflow.md v1.1 cross-approval pattern formalization

Per calibration insight #2, Director ratified formalizing the cross-approval pattern in `docs/methodology/multi-agent-pr-workflow.md` v1.1.

**Recommended timing:** post-M-Push-Foundation merge (so v1.1 captures both the cross-approval pattern AND the event-driven workflow that M-Push-Foundation enables). Architect-authored downstream artifact.

### Calibration #23 methodology doc

Per calibration insight #5, Director ratified authoring NOW.

**Filename:** `docs/methodology/calibration-23-formal-design-phase.md` (or similar; convention check needed).

**Content:** formal-Design-phase-per-idea + tele-pre-check discipline; 3 canonical execution examples (mission-54 + mission-55 + future M-Push-Foundation); how to apply in future ideas; relationship to other methodology docs.

**Architect-authored downstream artifact (not part of this retrospective scope; queued).**

---

## §6 Open questions resolved

Director's 4 ratifications captured 2026-04-26 ~14:55 AEST in chat:

| # | Question | Director response | Action |
|---|---|---|---|
| 1 | Foreign-tree deletion timing | "I can delete foreign tree" | Director-side deletion at will; architect no further action |
| 2 | Cross-approval pattern formalization in `multi-agent-pr-workflow.md` v1.1 | "Agreed" | Architect-authored downstream artifact post-M-Push-Foundation merge |
| 3 | Calibration #23 methodology doc — author now or after M-Push-Foundation? | "Author now" | Architect-authored downstream artifact, immediate-after-retrospective scope |
| 4 | M-Push-Foundation activation timing | "Lets ensure retrospective is documented, and I'll let you drive by walking me through it now" | This retrospective IS the documentation; activation post-walkthrough-convergence |

Plus 5 design-walkthrough ratifications same window:

| Topic | Director ratification |
|---|---|
| Kernel naming for `src/session/` | "I like term Kernel" — adopted as canonical name |
| Cognition Substrate keep-separate vs consolidate | "Agree with 'Keep Separate'" — `@ois/cognitive-layer` stays peer sovereign-package |
| Cognition Substrate cross-cutting framing | Architect-clarified: cross-cutting sovereign-package consumed by Layer 1 + (future) Layer 2 + Layer 3; no boundary/duty/interface change |
| mcp-boundary vs Kernel — keep `mcp-boundary` name? | (in flight; awaiting Director response) |
| Mission workflow source-of-truth doc | Director-validated `mission-lifecycle.md` v0.1 already exists; converge + ratify v1.0 post-M-Push-Foundation |

---

## §7 Plugin architecture confirmed

### Three-layer model (Director-ratified 2026-04-26 ~14:30 AEST and reaffirmed at retrospective)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Network Adapter / Universal Adapter                               │
│ Sovereign-package: @ois/network-adapter                                     │
│                                                                             │
│ Internal sub-concerns (sub-organized into src/ subdirs; mission-55 PR #63): │
│   1a. src/wire/         — Transport: TCP/SSE conn lifecycle; reconnect;     │
│                           backoff; heartbeat; atomic teardown; wire FSM     │
│   1b. src/session/      — Kernel: register_role handshake; session-claim;   │
│                           session FSM 5-state; agent identity;              │
│                           instance lifecycle; SSE watchdog                  │
│   1c. src/mcp-boundary/ — MCP protocol handler factory:                     │
│                           Initialize/ListTools/CallTool; pendingActionMap   │
│                           for queueItemId injection; tool-catalog cache;    │
│                           cache-fallback paths; error envelope              │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2 — Message-Router                                          ← NEW     │
│ Sovereign-package: @ois/message-router                                      │
│                  (sovereign-package #6; Q2-renamed from @ois/message-       │
│                   dispatcher; lands in M-Push-Foundation W2)                │
│                                                                             │
│ Concerns: Message kind/subkind routing                                      │
│           ("which host-surface mechanism for this Message?")                │
│           Message-arrival event handling; seen-id LRU cache;                │
│           hooks-pattern for shim host-injection (notificationHooks bag      │
│           inherited from Layer-3 contract)                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Per-Host Shim (Universal Adapter contract implementer)            │
│ Per-host plugin packages: adapters/<host>-plugin/                           │
│                                                                             │
│ Active hosts:  claude-plugin (stdio MCP; `<channel>` render)                │
│                opencode-plugin (Bun.serve+HTTP; client.session.promptAsync) │
│ Future hosts:  terminal-direct, ACP-host, Slack/Discord, web dashboard      │
│                                                                             │
│ Concerns: host-specific transport; host-specific render-surface;            │
│           notification-log writes; process lifecycle; HTTP fetch handler    │
│                                                                             │
│ NOT a sovereign-package — per-host plugin convention                        │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ CROSS-CUTTING — Cognition Substrate                                         │
│ Sovereign-package: @ois/cognitive-layer                                     │
│                                                                             │
│ Consumed by: Layer 1 (network-adapter; e.g., prompt-format.ts cross-cutting │
│              primitive) + future Layer 2 (Message-Router for context-       │
│              building) + Layer 3 (shims for cognitive operations during     │
│              render)                                                        │
│                                                                             │
│ NOT part of any single layer; substrate all layers can use.                 │
│ Sovereign boundaries unchanged by Message-Router introduction.              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Sovereign-package map

| # | Package | Concern | Layer |
|---|---|---|---|
| 1 | `@ois/network-adapter` | Layer 1 (wire + Kernel + mcp-boundary) | Layer 1 |
| 2 | `@ois/cognitive-layer` | Cognition Substrate | Cross-cutting |
| 3 | `@ois/storage-provider` | Storage primitive (Hub-side) | Hub-side |
| 4 | `@ois/repo-event-bridge` | GH event source (Hub-side; mission-52) | Hub-side |
| 5 | `@ois/message-primitive` | Unified Message entity (mission-51 W6) | Hub-side |
| 6 | **`@ois/message-router`** | **Layer 2 (NEW; M-Push-Foundation W2)** | **Layer 2** |

### Naming discipline

- "Network Adapter" / `@ois/network-adapter` = Layer 1 (Universal Adapter)
- "Kernel" = Layer 1b sub-concern (`src/session/`); session FSM + agent identity + lifecycle
- "Transport" = Layer 1a sub-concern (`src/wire/`); TCP/SSE wire FSM
- "MCP-boundary" = Layer 1c sub-concern (`src/mcp-boundary/`); MCP protocol handler factory at the host-network-adapter edge
- "Message-Router" = Layer 2 (`@ois/message-router`); Message kind/subkind routing; sovereign-package #6
- "Shim" = Layer 3 (per-host plugin); host-binding render-surface implementer
- "Cognition Substrate" = `@ois/cognitive-layer`; cross-cutting; consumed by all layers

Avoid bare "dispatcher" in new code — always qualify ("MCP-boundary dispatcher" for Layer 1c, "Message-router" for Layer 2).

### Future-host extension

The Universal Adapter notification contract spec (`docs/specs/universal-adapter-notification-contract.md`, on main since `736e13d`) is the single integration target for future hosts. Implementations:
1. Define host-binding transport (stdio / HTTP / terminal-stdout / ACP / Slack webhook)
2. Implement the four hooks (`onActionableEvent` / `onInformationalEvent` / `onStateChange` / `onPendingActionItem`)
3. Pass them as `notificationHooks` to `createSharedDispatcher`

The Universal Adapter does not need source modification to onboard a new host.

---

## §8 Forward queue

### Immediate post-retrospective (architect-staged)

1. **Stage M-Push-Foundation propose_mission cascade** — pending Director green-light at retrospective convergence
2. **Director-side foreign-tree deletion** — Director's choice; cleanup verification on main since `ef633144`

### Architect-authored downstream artifacts (retrospective-ratified scope)

3. **Calibration #23 methodology doc** — author now per Director ratification of open Q3
   - Filename: `docs/methodology/calibration-23-formal-design-phase.md` (convention TBD)
   - Content: formal-Design-phase-per-idea + tele-pre-check discipline; mission-54 + mission-55 + M-Push-Foundation as canonical examples
4. **`multi-agent-pr-workflow.md` v1.1** — post-M-Push-Foundation merge per Director ratification of open Q2
   - Cross-approval pattern formalization (engineer-pool ✓ on architect-content; architect-pool ✓ on engineer-content)
   - Event-driven PR-review workflow (mission-52 bridge + M-Push-Foundation push pipeline)
5. **`mission-lifecycle.md` v1.0 RATIFIED** — post-M-Push-Foundation merge
   - Convergence on the now-mechanised state (idea-191 + idea-192 + M-Push-Foundation primitives all shipped)
   - Closes the v0.1 draft → v1.0 ratified gap

### M-Push-Foundation mission scope (engineer-spec ratified at thread-325)

**6-bundled wave decomposition:**
- W0 spike — legacy-entity grep + thread-313 cross-map + trigger-probability confirm
- W1 — Hub-side push-on-Message-create + Last-Event-ID protocol + cold-start
- W2 — Adapter-side: SSE event-handler + Message-router (sovereign-package #6 `@ois/message-router`) + render-surface
- W3 — Adapter-side hybrid poll backstop + claim/ack two-step semantics
- W4 — Legacy entity sunset (DirectorNotification → Notification → PendingActionItem)
- W5 — Tests + docs + ADR-026 + closing audit

**Sizing:** L-firm; (a)+(b) XL gate ~9% combined post-cleanup.

### M-Adapter-Distribution (Tier 2 future mission)

- npm publish under `@apnex/*` namespace (Director-announced)
- Sovereign-package npm publish workflow
- Host-plugin deps from `file:` to registry semver
- Out of scope for M-Push-Foundation; queued for after.

---

## Cross-references

- **Recon Report:** `docs/designs/m-push-foundational-adapter-recon.md` (commit `f519f74`; PR #61)
- **Design v1.2:** `docs/designs/m-push-foundation-design.md` (commit `cc90174`; PR #62)
- **Universal Adapter notification contract spec:** `docs/specs/universal-adapter-notification-contract.md` (commit `736e13d`; PR #64)
- **Cleanup mission closing audit:** `docs/audits/m-pre-push-adapter-cleanup-closing-report.md` (commit `ef633144`; PR #65)
- **Mission lifecycle map:** `docs/methodology/mission-lifecycle.md` v0.1 (2026-04-25)
- **PR workflow:** `docs/methodology/multi-agent-pr-workflow.md` v1.0 RATIFIED (cross-approval pattern formalization queued for v1.1)
- **Threads:** thread-318 (mission-54 T1) / thread-321 (mission-55 T1) / thread-322+323+324 (orchestration nudges) / thread-325 (round-2 audit)
- **Mission entities:** mission-54 (recon, closed) / mission-55 (cleanup, closed) / M-Push-Foundation (queued, HOLD)

— lily / architect / 2026-04-26
