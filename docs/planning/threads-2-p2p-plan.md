# Threads 2.0 — direct P2P plan (Mission-21 Phase 1 follow-on)

**Status:** working document — mutable, not an ADR or spec. Promote or delete when complete.
**Owner:** Director · **Started:** 2026-04-18

## Goal

Direct, private, autonomous peer-to-peer threads between any pairs of roles. Concretely: two local Claude Code engineers (or an architect and an engineer, or future architect↔architect) open a thread with each other, converge on an outcome, and optionally spawn entities — without any third agent observing the conversation or participating in convergence.

## Current state (2026-04-18)

Commits landed on `main`:
- `4cb52e7` — M21 Phase 1 core (staged actions, summary, participants, gate)
- `9d951f5` — M21 Phase 1 hardening: architect prompt + digest wiring
- `f2f3799` — M21 Phase 1 hardening: tool-driven thread replies + cascade guard
- `fc7f8d3` — M21 Phase 1 hardening: participant-scoped routing + 3-agent smoke

Shipped invariants (pragmatic — awaiting Architect ratification into spec):
- **INV-TH16** — thread dispatches (open, reply, converged, convergence_completed) scoped to `participants[]` via `Selector.engineerIds`; fallback to role only when no participants have resolved agentIds.
- **INV-TH17** — reply turn pinned to `currentTurnAgentId` in addition to role; a reply whose `authorAgentId` doesn't match is rejected.

New schema surface (awaiting Architect ratification):
- `Selector.engineerIds?: string[]` (pool filter)
- `Thread.recipientAgentId?: string | null` (opener-declared counterparty)
- `Thread.currentTurnAgentId?: string | null` (per-turn pin)
- `OpenThreadOptions` bag (replaces positional args on `openThread`)
- `create_thread` tool gained `recipientAgentId` optional arg

Test coverage:
- Hub 299 + network-adapter 84 passing
- `packages/network-adapter/test/integration/threads-2-smoke.test.ts` — 11 scenarios, 3-agent harness (arch, eng-1, eng-2) on `PolicyLoopbackHub` + `LoopbackTransport`

Production state:
- Hub revision `hub-00008-8tx` (2026-04-18) — INV-TH16/17 live; `recipientAgentId` advertised on `create_thread`.
- Architect revision `architect-agent-00023-7s5` — tool-driven reply, cascade guard, 60s director-chat TTL. OK as-is.

## Plan — tiered

### Tier 1 — live P2P enablement (one mission, executing now)

| # | Item | Status | Architect review? |
|---|---|---|---|
| T1 | Deploy hardened Hub (INV-TH16/17) | [x] `hub-00008-8tx` live 2026-04-18 | No — mechanical |
| T2 | Engineer-plugin Threads 2.0 instructions (AGENTS.md + prompt-format) | [x] Shipped — see `packages/network-adapter/src/prompt-format.ts` and `adapters/opencode-plugin/AGENTS.md` Ideation Threads section | Not blocking — flag for comment in review thread |
| T3 | Discovery tool — extend `get_engineer_status` to expose agentId + labels (vs new `list_peers`) | [ ] held | **Yes** — new public tool surface. Hold pending Architect thread. |
| T4 | ITW smoke: two Claude Code engineers vs prod Hub, close_no_action convergence | [x] PASS on `thread-122` (2026-04-18T07:24Z). greg (`eng-0d2c690e7dd5`) ↔ kate (`eng-2c249473aa50`) bilateral convergence; architect received zero events for the thread (0 architect audit entries); INV-TH16 + INV-TH17 validated live. | No — pure validation |

Shipping T1 + T2 + T4 unilaterally. T3 held until Architect thread completes.

### Tier 2 — autonomous production throughput (parallel)

**M-Phase2 — full convergence vocabulary**
- [ ] Zod `stagedActions.type` widened: `create_task | create_proposal | create_idea | create_mission | update_mission | update_idea` (6 types)
- [ ] Cascade handlers per type, best-effort with `ConvergenceReport.warning` on partial failure
- [ ] Idempotency keys per action (natural key: action-id + thread-id)
- [ ] Back-link on spawned entity: `sourceThreadId` + `sourceActionId`
- [ ] Un-skip and rewrite 10 Phase 2 tests in `wave3b-policies.test.ts` / `e2e-convergence-spawn.test.ts`
- [ ] Extend 3-agent smoke with create_task + create_proposal convergence

**M-SandwichTests — unit-test harness for sandwich handlers**
- [ ] Mock `HubAdapter` + `ContextStore`
- [ ] Regression tests for `sandwichThreadReply` tool-driven contract (allow-list, cascade suppression, gate self-correction)
- [ ] Coverage for all five sandwiches (thread reply, thread converged, review report, review proposal, clarification)

### Tier 3 — polish (later)

**M-Phase3 — Path B removal + observability**
- [ ] Delete legacy single-convergenceAction code path
- [ ] Metrics: gate-rejection counter by reason; per-action-type exec success/fail; participant-count + round-at-convergence histograms
- [ ] Wire into Director digest (`thread_convergence_completed` data or time-series sink)

## Architect review gate

**When:** after Tier 1 ships (Hub deployed, engineer instructions updated, ITW smoke passed).

**Thread scope:**

1. **Retrospective ratification** (already shipped)
   - INV-TH16 participant-scoped routing — is this the right invariant name/shape?
   - INV-TH17 agent-pinned turn — same
   - Amendments needed in `docs/specs/workflow-registry.md` §1.3 thread FSM
   - ADR-013 amendment or new ADR covering INV-TH16/17

2. **Forward design — T3 discovery tool**
   - Extend `get_engineer_status` (one tool does more) vs new `list_peers(role?, labels?)` (clearer naming)
   - Return shape: `{agentId, role, labels, status, lastSeenAt}` — what else?
   - Visibility: broadcast all online agents? Scope by caller's labels? Require opt-in?
   - Privacy: the Director's view vs peer view

3. **Forward design — M-Phase2 action vocabulary**
   - 6 action types — agreed set?
   - Cascade semantics: best-effort with warning (partial success OK) vs all-or-nothing (rollback on any failure)?
   - Idempotency strategy
   - Back-linking — should entities carry just `sourceThreadId` or full `sourceActionId` too?
   - Director involvement: does a Phase 2 `create_mission` action require Director approval, or is Architect+Engineer agreement sufficient?

## Held / out of scope

- **Director-role participation in threads** — currently "reserved". Worth a design thread later; not urgent.
- **agentId ↔ engineerId naming unification** — idea-85; blocked on Entity SSOT mission (hub-mission-22).

## Working log

- 2026-04-18 — Doc created. Tier 1 starting.
- 2026-04-18 — T1 deployed (`hub-00008-8tx`); `recipientAgentId` live on `create_thread`. T2 landed: `prompt-format.ts` dropped hard-coded "[Architect]" prefix (now role-aware) and embeds Threads 2.0 gate discipline in the per-notification prompt; `adapters/opencode-plugin/AGENTS.md` Ideation Threads section rewritten for Threads 2.0 (stagedActions, summary, gate, recipientAgentId, peer discovery). T4 two-engineer smoke pending Director-run pair test.
- 2026-04-18 — OIS_INSTANCE_ID env override (`26ed0f8`) + start-claude.sh name argument (`dd90882`) shipped to unblock multi-agent co-location on one laptop. T4 two-engineer smoke PASSED: thread-122, greg (`eng-0d2c690e7dd5`) ↔ kate (`eng-2c249473aa50`), architect silent (0 audit entries), action-1 committed, cascade fired cleanly. INV-TH16 + INV-TH17 validated live on prod.
