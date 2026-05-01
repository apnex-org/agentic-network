# M-Pulse-Mechanism-Phase-2 — Design v0.1

**Status:** v1.0 (architect-authored 2026-04-30; engineer round-1 audit + round-2 verify folded; ratifiable bilateral converge via thread-445 round 5)
**Methodology:** Phase 4 Design per `mission-lifecycle.md` v1.2 §1 (RACI: C=Director / R=Architect+Engineer)
**Survey envelope:** `docs/surveys/m-pulse-mechanism-phase-2-survey.md` (Director-ratified 6 picks + Path C scope-expansion + 3 architect-flags)
**Source idea:** idea-224 M-Pulse-Mechanism-Phase-2 (status=triaged via route-(a) skip-direct)
**Bilateral thread:** TBD (opens at architect-engineer dispatch post this push)

---

## §0 Document orientation

Design v0.1 concretizes Survey envelope (6 Director picks + Path C ratification) into operational decisions for Phase 8 Execution. Reading order:
- §1 Mission scope summary (Survey envelope reference)
- §2 Repo-event routing substrate design (NEW; Path C deliverable)
- §3 First handler — commit-pushed (NEW; Path C deliverable; #54 + #55 closure)
- §4 Pulse mechanism simplification (Q1a + Q2a + Q3a)
- §5 Default cadence (Q5a; 10/20min)
- §6 Engineer-cadence-discipline 3-layer mechanization (Q4d)
- §7 Backward-compat handling (Q5a NEW-missions-only)
- §8 missedThreshold refinement (Q6d reduce-to-2)
- §9 ADR-027 amendments
- §10 Anti-goals + Phase-N revisit-axes
- §11 PR sequencing + content map
- §12 Open questions for round-1 audit
- §13 Cross-references

---

## §1 Mission scope summary

Per Survey envelope §6 composite intent envelope:

| Axis | Bound |
|---|---|
| Mission scope | (1) Strip class-based defaults; (2) Strip precondition predicate layer; (3) Mechanize engineer-cadence-discipline via 3-layer stack; (4) Default 10/20min unified per-role; (5) **Path C — build repo-event routing substrate + ship commit-push as FIRST handler instance** |
| Mission class | substrate-introduction |
| Primary outcome | Engineer-cadence-discipline mechanization (#55 closure; Q1d primary) |
| Secondary outcomes | Simplification (#56); faster missed-detection (#51 + #53); cross-party visibility substrate (#54 partial via commit-push handler) |
| Tele alignment (primary) | tele-2 + tele-7 + tele-11 + tele-3 |
| Tele alignment (secondary) | tele-1 + tele-4 + tele-8 |

---

## §2 Repo-event routing substrate (NEW; Path C deliverable)

The Hub today receives `kind=external-injection` messages from `RepoEventBridge` (mission-52 ships) but has NO downstream consumer for `payload.kind === "repo-event"`. Substrate: build the message-content-based dispatch layer that consumes RepoEvents + routes to per-subkind handlers.

### §2.1 Substrate-pattern decision (architect-flag for round-1 audit)

Existing `triggers.ts` is entity-status-transition-based (e.g., `task: pending → working`). RepoEvent dispatch is MESSAGE-CONTENT-based (`kind=external-injection + payload.kind=repo-event + payload.subkind=X`). Two design candidates:

**Candidate (a) — Extend triggers.ts:** add a new `TriggerKind` ("message-content") alongside existing entity-status pattern. Single registry; reuses DOWNSTREAM_ACTORS gate.
**Candidate (b) — New substrate primitive:** dedicated `message-handlers.ts` registry separate from triggers.ts; per-message-kind/subkind handler dispatch.

**Architect-recommendation: Candidate (b) RATIFIED post-engineer-P1.** New `hub/src/policy/repo-event-handlers.ts` registry (per §2.5 reconciled name; ratified by engineer MIN2) for message-content semantics. Structurally distinct from entity-status-transitions; conflating would risk abstraction-debt.

**Engineer P1 probe-back ratified:** no `DOWNSTREAM_ACTORS`-equivalent gate needed — the `repo-event-handlers.ts` registry IS the actor list. Semantics: registered handler ⟹ wants to fire; missing handler for received subkind = log-warn at WARN level (non-fatal; substrate-grade isolation per `repo-event-handler.ts` precedent).

### §2.2 Author-role-lookup primitive (NEW; AgentLabels approach ratified)

Translate GH login string → registered Hub agent → role determination.

```ts
// hub/src/policy/repo-event-author-lookup.ts (NEW)
async function lookupRoleByGhLogin(
  ghLogin: string,
  ctx: IPolicyContext,
): Promise<"architect" | "engineer" | "director" | null>
```

**Engineer P2 ratified (CRITICAL C4 closure):** **AgentLabels reserved-key approach** — `labels: { "ois.io/github/login": "apnex-greg" }`. Rationale:
- Labels are existing routing infrastructure (`Selector.matchLabels`); zero-cost lookup pattern available
- Adapter populates at `register_role` handshake (existing path, `session-policy.ts:50`); no schema migration
- Avoids polluting Agent type with optional identity-display field for one mission's needs

**Namespace ratified:** `ois.io/github/login` (forward-compat for other identity providers like `ois.io/gitlab/login`, `ois.io/bitbucket/login`, etc.).

**Implementation:**
- claude-plugin shim handshake reads `OIS_GH_LOGIN` env (or resolves via `git config user.email` → reverse-lookup), emits in `labels` at `register_role`
- `lookupRoleByGhLogin` becomes: query agent registry by label `ois.io/github/login=<login>` → return `agent.role`
- Verified: NO existing `ghLogin` field on Agent entity (`hub/src/state.ts:235-285`); AgentLabels approach avoids schema extension

### §2.3 Downstream-actor pattern for repo-events

Per-subkind handler dispatch. Each handler receives the inbound RepoEvent Message + IPolicyContext + emits 0+ downstream Messages.

```ts
// hub/src/policy/repo-event-handlers.ts (NEW)
interface RepoEventHandler {
  readonly subkind: RepoEventSubkind;  // "commit-pushed", "pr-opened", etc.
  readonly handle: (
    inbound: Message,            // The external-injection RepoEvent message
    ctx: IPolicyContext,
  ) => Promise<MessageDispatch[]>;  // Downstream messages to create
}

// Registry — Path C ships ONE handler:
export const REPO_EVENT_HANDLERS: RepoEventHandler[] = [
  COMMIT_PUSHED_HANDLER,  // §3 below
  // pr-opened, pr-closed, pr-merged, etc. → idea-227 / future mission
];
```

### §2.4 Dispatch wiring

Hub `message-policy.ts` `createMessage` post-create cascade adds:
1. Detect `message.kind === "external-injection" && message.payload?.kind === "repo-event"`
2. Look up handler by `message.payload.subkind` in REPO_EVENT_HANDLERS
3. Invoke handler; emit returned MessageDispatch[] via createMessage (recursive cascade-bounded)

**Two-message-intent rationale (M1 fold):** the bridge's `target: null` broadcast (`kind=external-injection`) and the §3 commit-pushed handler's `target.role=architect` synthesized note (`kind=note`) serve TWO consumer concerns by-design:
- **Raw broadcast** — substrate-grade event signal available to any future subscriber (including the routing substrate itself); preserves bridge as independent layer per `repo-event-handler.ts` failure-isolation contract
- **Synthesized note** — engineer-cadence-discipline-shaped derivative for architect-side surfacing; carries terse body + structured payload (per M2)

Architect-role subscribers receive both; this duplication is intentional (different consumer concerns, not redundant emission).

### §2.5 Substrate scope

| Component | Status | Path |
|---|---|---|
| `repo-event-handlers.ts` registry pattern | NEW | `hub/src/policy/repo-event-handlers.ts` (filename ratified per MIN2) |
| Author-role-lookup primitive | NEW | `hub/src/policy/repo-event-author-lookup.ts` |
| Dispatch wiring in `message-policy.ts` | EXTEND existing | `hub/src/policy/message-policy.ts:createMessage` post-create cascade |
| Agent label `ois.io/github/login` population | EXTEND existing | claude-plugin shim handshake at `register_role`; reads `OIS_GH_LOGIN` env or resolves via git config (NO Hub schema change; uses existing `AgentLabels` map per C4 closure) |
| Tests | NEW | `hub/test/unit/repo-event-handlers.test.ts` + author-lookup test |

---

## §3 First handler — commit-pushed (NEW; Path C deliverable)

**Trigger:** `external-injection` message with `payload.kind === "repo-event" && payload.subkind === "commit-pushed"`

**Logic:**

1. Extract `payload.payload.pusher` (GH login of commit author) + `payload.payload.commits[]` (commit metadata) + `payload.payload.ref` (branch)
2. `lookupRoleByGhLogin(pusher)` → push-author role (architect / engineer / null)
3. If push-author is engineer:
   - Determine architect cross-role recipient (lookup architect agents via `list_available_peers(role="architect")`)
   - Emit message: `kind=note`, target={role: "architect"}, body=**TERSE** + structured payload sub-fields per **M2 fold + P3 ratification**:
     - `body`: `"Engineer pushed N commits to <branch>"` (terse; matches existing trigger-payload conventions per `triggers.ts:108-119` mission-66 #41 STRUCTURAL ANCHOR ratification)
     - `payload`: `{ pusher, branch, commitCount, commits: [...] }` (structured; adapter-side `source-attribute.ts` rendering surface)
4. If push-author is architect: NO cross-role notification (architect pushes don't need engineer-cadence-discipline alert; AG-7 anti-goal)
5. If push-author role unknown: log + skip (non-fatal)

**Message kind ratified (P3):** `kind=note` (lightest option; already used by triggers.ts `mission_activated` for cross-role notifications). Avoids substrate-grade addition.

**Cross-mission #54 closure scope:** this handler closes #54 (commit-push visibility gap) for engineer-pushes-to-architect direction. Architect-pushes-to-engineer direction (calibration #54 implied symmetric coverage) NOT in scope this mission — composes with idea-227 hook design (AG-7).

---

## §4 Pulse mechanism simplification (Q1a + Q2a + Q3a)

### §4.1 Strip class-based defaults (Q2a)

`mission-lifecycle.md` §4.1 per-class default cadence template — DELETE.

**Replace with:** §4.1 v2 — unified per-role defaults (10min engineer / 20min architect; per Q5a). `missionClass` field on mission entity STAYS (used for retrospective + portfolio-balance scoring per `mission-lifecycle.md` §3) but no longer drives pulse cadence.

### §4.2 Strip precondition predicate layer (Q3a) — engineer C2 fold applied

ADR-027 PulseConfig schema:
- `precondition` field — REMOVE entirely from schema
- `mission_idle_for_at_least` entry (lines 89-103 in `preconditions.ts`) — REMOVE
- **Registry PRESERVED** — engineer C2 verified `thread-still-active` (line 60) + `task-not-completed` (line 73) entries remain active consumers via `scheduled-message-sweeper.ts`. ONLY the `mission_idle_for_at_least` entry is removed
- Auto-injection branch in `mission-policy.ts:83-90` — REMOVE (per C2 explicit enumeration)

PulseSweeper logic:
- Remove precondition evaluation (Step 3 at lines 222-236) from per-pulse fire-decision
- **Step 4 missedCount-increment 3-condition guard PRESERVED INTACT per C1 fold** — see §9 ADR-027 §2.6 amendment row for detail
- Pulse fires on schedule unconditionally (modulo missedThreshold logic)

### §4.3 Methodology-doc consequences (engineer C5 fold applied)

`mission-lifecycle.md` §4.x updates:
- §4.1 Per-class default cadence → DELETE per-class table; replace with §4.1 unified default (10/20) **PLUS distribution-packaging carve-out per C5**: "distribution-packaging missions SHOULD declare `pulses` explicitly to longer cadence (30/60 baseline preserved per v1.2 empirical anchoring); unified 10/20 default targets the synchronous-active-arc class cluster"
- §4.2 Override semantics → simplify (no per-class taxonomy; just per-mission `pulses.*` declaration; distribution-packaging override note)
- §4.3 When to disable → remove precondition-based row
- §4.4 Pulse vs ScheduleWakeup boundary → preserved (no change)
- §4.5 Active-missions cap → preserved (no change)

---

## §5 Default cadence (Q5a; 10/20min)

| Role | Default `intervalSeconds` | Default `missedThreshold` |
|---|---|---|
| engineer | **600** (10min) | **2** (per §8 Q6d) |
| architect | **1200** (20min) | **2** (per §8 Q6d) |

Default-injection at `mission-policy.ts` `create_mission` validation:
- If mission entity passes `pulses` config: use as-declared (with `null` precondition; field removed from schema per §4.2)
- If mission entity does NOT pass `pulses` config: auto-inject above defaults (per §7 backward-compat scope)

---

## §6 Engineer-cadence-discipline 3-layer mechanization (Q4d)

### §6.1 Layer (a) — Methodology-doc fold (engineer MIN3 + M4 folds applied)

Add NEW row to `engineer-runtime.md` (separate from existing #57 routing row per MIN3 — discrete cold-pickup discoverability):

| Concern | Why it matters at runtime | Canonical source | Heading anchor |
|---|---|---|---|
| Commit-push thread-heartbeat (mission-68) | Per-commit thread ping for architect visibility (#55 closure); silent between-commit pauses anti-pattern; **escalation latency 20min engineer / 40min architect (10/20min cadence × missedThreshold=2 per §5 + §8) — set engineer-side expectations for legitimate ~30min deep-thought-phases (rare; substrate-introduction class)** per M4 fold | `mission-lifecycle.md` | `#1-5-1-1-commit-push-thread-heartbeat-mechanization` (NEW; per §6.1.1) |

#### §6.1.1 `mission-lifecycle.md` §1.5.1 expansion

Add subsection "§1.5.1.1 Commit-push thread-heartbeat mechanization (mission-68 closure of #55)" — describes 3-layer stack; cross-references §6.2 + §6.3 + escalation horizon (20/40min per §5 + §8 composition).

### §6.2 Layer (b) — Adapter-side commit-push hook (engineer P4 ratified — Bash tool result post-process)

claude-plugin shim modification:
- **Detection ratified:** Bash tool result post-process — matches existing claude-plugin shim cognitive-event hook surface (`shim.ts`); commit-push observability already in flight via shim
- **Detection pattern:** `^git\s+push\b` (covers `git push origin`, `git push --force`, `git push -u origin`)
- **Augmentation per P4 probe-back:** detection requires (a) command-pattern match + (b) exit-code success + (c) commit-pushed shape match (output contains `→` or `[new branch]`) — avoids false-positives on push-failures + alias-variant gaps (e.g., `gp`, `gpush`)
- On detection: auto-emit thread message to active mission-coord thread (if any) with commit-push metadata
- Implementation: extend `adapters/claude-plugin/src/shim.ts` cognitive-event hook surface (OR new `adapters/claude-plugin/src/commit-push-hook.ts` if scope warrants module separation; engineer judgment at implementation)

**Rationale rejected (per P4):** stdout pattern listening (brittle; varies by remote/branch state) + filesystem watcher on `.git/` (noisy; every git operation touches).

### §6.3 Layer (c) — Hub-side commit-push event consumption (uses §2 + §3)

USES routing substrate from §2 + commit-pushed handler from §3. No additional Hub work beyond §2 + §3 deliverables.

### §6.4 3-layer composition (engineer M8 fold applied)

Belt + suspenders + braces:
- (a) methodology-doc fold = engineer-runtime documentation (cold-pickup awareness)
- (b) adapter-hook = engineer-side automation (no manual ping required)
- (c) Hub-side commit-push event consumption = architect-side notification (cross-party visibility)

Together: engineer cannot accidentally silent-stop without (a) cold-pickup awareness, (b) adapter-auto-ping, OR (c) Hub-side cross-party-notification firing.

**Failure-resilience hierarchy (M8 fold):** **Layer (c) is the load-bearing failure-resilient layer** — Hub bridge runs in-Hub-process (RepoEventBridge already integrated; failure-isolated); polls GitHub API directly; works regardless of adapter state. Layers (a) + (b) compose as defense-in-depth — adapter offline + engineer skips docs would still leave (c) intact. Worst-case partial-failure (Hub bridge stopped + adapter offline) leaves only (a); engineer-side discipline becomes load-bearing in that degenerate scenario (small probability; observable via Hub-state inspection).

---

## §7 Backward-compat handling (Q5a NEW-missions-only) — engineer C3 fold applied

| Mission state at v1.0 ship | Pulse behavior |
|---|---|
| Currently `active` mission with explicit `pulses` config | UNCHANGED (existing config preserved) |
| Currently `active` mission without `pulses` config (per ADR-027 §6 legacy backward-compat) | UNCHANGED (still no auto-pulses) |
| Currently `proposed` mission | UNCHANGED until status flip; if flipped post-v1.0-ship, gets new defaults applied via NEW `update_mission` FSM-handler auto-inject (see §11.1 implementation surface) |
| NEW missions created post-v1.0 ship | Gets 10/20 defaults unless explicit override |

**Implementation (CRITICAL C3 fold — non-trivial implementation surface):** Verified `mission-policy.ts:223-300`: `update_mission` only calls `preparePulsesForStorage` when `pulses` explicitly passed. Status-flip `proposed → active` does NOT re-run auto-injection today.

**Required NEW code:** `update_mission` FSM-handler at proposed→active transition — invoke existing `preparePulsesForStorage` pathway when mission missing `pulses` config. Engineer-recommended approach (P-style scope confirmation): existing `preparePulsesForStorage` reused; new tests for the flip path. **Named in §11.1 implementation scope.**

Pre-existing `active` missions are not retroactively updated (per Q5a NEW-missions-only ratification).

**P8 ratification (engineer round-2 micro-PROBE):** for pre-existing `proposed` missions that lack `missionClass` field (pre-mission-57-W1 era; ADR-027 §2.1 legacy backward-compat = NO auto-pulses), the new FSM-handler at proposed→active flip injects 10/20 defaults regardless. Architect-decision: **(a) accept post-v1.0 unified semantics override** — clean post-v1.0 mental model; legacy missions are an edge case (most pre-mission-57 missions are now `active`/`completed`; few candidates remain in `proposed`); unified default is reasonable for any mission flipped post-v1.0. NOT gating FSM-handler auto-inject behind `missionClass !== undefined`.

---

## §8 missedThreshold refinement (Q6d reduce-to-2)

**Architect-recommendation (Phase 4 Design ratification needed):** reduce default from 3 → 2.

Time-to-detection at 10/20min cadence:
- Engineer: 10min × 2 missed = 20min escalation (was 30min at threshold=3)
- Architect: 20min × 2 missed = 40min escalation (was 60min at threshold=3)

Trade-off: faster detection vs spurious-escalation tolerance. At 10/20min cadence, spurious-escalation risk lower than at 15/30min (cadence-cushion shorter; less likely architect/engineer is mid-deep-thought-phase across multiple intervals).

**Architect-flag for round-1 audit:** confirm engineer-side acceptance.

---

## §9 ADR-027 amendments — engineer C1 fold applied (CRITICAL bug-fix)

ADR-027 (Pulse-Primitive + PulseSweeper) is the substrate this mission EXTENDS + SIMPLIFIES. Amendments needed:

| ADR-027 section | Amendment |
|---|---|
| §2.1 Single declarative coordination surface | `precondition` field removed from PulseConfig schema (per §4.2) |
| §2.6 E2 3-condition missed-count guard | **PRESERVED INTACT (CRITICAL C1 correction).** Engineer round-1 audit verified: `noAckSinceLastFire = lastResponseMs < lastFiredMs` is the missed-count INCREMENT GUARD (Step 4 in `pulse-sweeper.ts`), ORTHOGONAL to the precondition layer (Step 3). Removing the guard would break pulse responsiveness model — escalation would fire after `missedThreshold` cadences regardless of acks. ONLY §2.8 + §4.x precondition-step references are removed; the 3-condition guard logic is unchanged. |
| §2.8 mission_idle_for_at_least precondition | DELETE entire section |
| §6 Backward-compat row | NEW addition: "post-mission-68: legacy missions preserve at-flip-time; new missions get 10/20 defaults via update_mission FSM-handler auto-inject; precondition layer entirely removed; preconditions registry PRESERVED for `thread-still-active` + `task-not-completed` consumers (scheduled-message-sweeper)" |
| §4.5 mission-lifecycle.md v1.0 — formal lifecycle phase additions | Co-shipping note (MIN1 fold): explicit amendment text — "mission-68 ships co-shipping methodology-doc updates per Design §4.3 + §6.1.1: §4.1 per-class default cadence table replaced by unified 10/20 with distribution-packaging carve-out; §1.5.1 expansion adds §1.5.1.1 commit-push thread-heartbeat mechanization" |

ADR-027 itself stays "Accepted" (foundational substrate intact); amendments document evolution.

---

## §10 Anti-goals + Phase-N revisit-axes

### §10.1 Anti-goals

| # | Anti-goal | Reviewer-test | Composes-with |
|---|---|---|---|
| AG-1 | NOT per-agent-idle predicate | Future-PR adds `agent_idle_for_at_least` predicate or any per-agent-idle gating → flag scope-creep | idea-225 M-TTL-Liveliness-Design |
| AG-2 | NOT phase-aware pulse content (#52) | Future-PR adds W0/W1+W2/W3/W4 pulse-content variation → flag scope-creep | Phase-N revisit |
| AG-3 | NOT cross-pulse coordination mechanization (#53) | Future-PR adds architect-pulse-checks-engineer-pulse-state logic → flag scope-creep | #53 superseded structurally; reopen if insufficient post-ship |
| AG-4 | NOT additional cross-party-routing handlers (pr-opened/closed/merged/review-requested) | Future-PR adds handler for non-`commit-pushed` subkind via routing substrate this mission ships → flag scope-creep | idea-227 hook design OR dedicated cross-party-routing follow-on mission |
| AG-5 | NOT tool-surface scope | Future-PR introduces new tool verbs / envelope shapes → flag scope-creep | idea-121 |
| AG-6 | NOT pulse-primitive substrate replacement | Future-PR replaces ADR-027 PulseSweeper / Mission entity pulses[] schema → flag scope-creep | This mission EXTENDS + SIMPLIFIES; doesn't replace |
| AG-7 | NOT architect-push cross-party notification | Future-PR adds architect-push-detection cross-party emission → flag scope-creep | idea-227 (symmetric coverage there). **NOTE per M7 fold:** AG-7 is a Design-time refinement (NOT Survey-ratified); composes with idea-227's symmetric-coverage scope; transparency-flag for Phase 4 Design ratification |

### §10.2 Phase-N revisit-axes

| Axis | Phase-N venue |
|---|---|
| Per-agent-idle predicate | idea-225 M-TTL-Liveliness-Design |
| Phase-aware pulse content (#52) | Open future-mission OR Phase 10 retrospective-fold |
| Cross-pulse coordination (#53) | Reopen IF Q3a + Q1c structural-supersession proves insufficient post-ship |
| Additional cross-party-routing handlers | idea-227 hook design |
| Architect-push cross-party notification | idea-227 hook design |
| Pulse cadence per-context refinement | Future-mission if 10/20 defaults prove suboptimal |
| 10/20 cadence — empirical validation watch-axis (M3 fold) | Reopen if first 3 missions post-v1.0-ship surface spurious-escalation; v1.2 empirical baseline anchored at 15/30 — 10/20 is tighter; explicit watch for 2.25× faster escalation horizon (per §6.1 + M4) |

---

## §11 PR sequencing + content map

### §11.1 PR split — engineer M5 + P6 fold applied (single hub PR + separate adapter PR)

**Branch (M6 fold):** rename current `agent-lily/idea-224-phase-3-survey` → `agent-lily/idea-224` (drop phase suffix; mission progresses on same branch through Phase 4 → Phase 8). Architect-recommended at first commit on Design v0.2.

**PR 1 (hub binding-artifact):**
- Survey artifact (already shipped; commit `1d6f2ad` + `e24fdf2` + `53ae277`)
- Design v1.x (post-bilateral converge)
- Hub implementation:
  - Routing substrate (§2): `repo-event-handlers.ts` registry + `repo-event-author-lookup.ts` + dispatch wiring in `message-policy.ts`
  - Commit-push handler (§3)
  - Pulse simplification (§4): `precondition` schema removal + `mission_idle_for_at_least` entry removal + auto-inject branch removal in `mission-policy.ts:83-90`
  - Default cadence (§5; 10/20)
  - missedThreshold refinement (§8; reduce-to-2)
  - ADR-027 amendments (§9; CRITICAL C1 + C2 corrections applied)
  - **NEW: `update_mission` FSM-handler auto-inject (§7 C3 implementation surface)** — invoke `preparePulsesForStorage` at proposed→active transition when mission missing `pulses` config
- Methodology updates: `mission-lifecycle.md` §4.x rewrite + engineer-runtime.md NEW row (per MIN3 + M4) + §1.5.1.1 expansion + ADR-027 amendments
- Tests: substrate + handler + pulse simplification regression + FSM-handler proposed→active flip path

**PR 2 (adapter; ships separately per M5 + P6 fold):**
- claude-plugin commit-push hook (§6.2): Bash tool result post-process; pattern + exit-code + shape-match
- Tests: hook detection + emission shape

**Rationale for split (engineer M5):** hub-side substrate doesn't depend on adapter hook landing first (Layer (c) Hub-side notification works standalone via existing bridge `commit-pushed` events). Adapter PR ships when hub PR lands + cross-package surfaces stable.

**Approval gate:** bilateral architect-engineer cross-approval per `multi-agent-pr-workflow.md` v1.0 (architect-content + engineer-content depending on PR file ownership).

---

## §12 Round-1 audit summary (engineer responses folded; probes resolved)

**Historical record** — all 7 probes received engineer responses; folded into v0.2 architect-revision pass.

| # | Probe | Engineer response | v0.2 fold |
|---|---|---|---|
| P1 | §2.1 substrate-pattern | ✅ Candidate (b) accepted (`repo-event-handlers.ts`); registry IS actor list; missing handler = log-warn at WARN | §2.1 + §2.5 reconciled |
| P2 | §2.2 author-role-lookup | ✅ AgentLabels `ois.io/github/login` (forward-compat namespace; CRITICAL C4 closure) | §2.2 + §2.5 specified |
| P3 | §3 commit-pushed handler kind | ✅ `kind=note`; terse body + structured payload sub-fields (M2 fold) | §3 specified |
| P4 | §6.2 adapter detection | ✅ Bash tool result post-process; pattern `^git\s+push\b` + exit-code success + shape-match (`→` or `[new branch]`) | §6.2 specified |
| P5 | §8 missedThreshold=2 | ✅ Accepted with caveat — engineer-runtime overlay surfaces 20/40min escalation horizon (M4 fold) | §6.1 row addition + §8 unchanged |
| P6 | §11.2 PR-split | ✅ Single hub binding-artifact PR + separate adapter PR (M5 fold) | §11.1 restructured |
| P7 | Anything else | Engineer surfaced: work-trace open-timing — Phase 4 start (NOW) is cleaner open-point per `engineer-runtime.md` discipline | **Engineer-Responsibility (P7 fold acknowledged):** engineer opens `docs/traces/m-pulse-mechanism-phase-2-work-trace.md` per `engineer-runtime.md` work-trace row; architect does NOT patch (engineer-owned) |

---

## §13 Cross-references

- **`docs/surveys/m-pulse-mechanism-phase-2-survey.md`** — Survey envelope (composite intent envelope this Design concretizes; commit `53ae277`)
- **`docs/methodology/idea-survey.md`** v1.0 — Phase 3 Survey methodology canonical reference
- **`docs/methodology/mission-lifecycle.md`** v1.2 — Phase 4 Design RACI + §4 Pulse coordination spec (this mission updates)
- **`docs/methodology/engineer-runtime.md`** — INDEX-overlay (this mission adds row)
- **`docs/decisions/027-pulse-primitive-and-pulsesweeper.md`** — substrate this mission EXTENDS + SIMPLIFIES (amendments per §9)
- **`packages/repo-event-bridge/`** — substrate-already-shipped (mission-52); idea-224 consumes via routing substrate (§2)
- **`hub/src/policy/triggers.ts`** — entity-status-transition pattern (architect-recommends NOT extending; new substrate per §2.1)
- **`hub/src/policy/repo-event-handler.ts`** — RepoEventBridge wiring (already exists; idea-224 builds dispatch consumer downstream)
- **idea-224** Hub Idea entity (status=triaged) — concept-level scope this Design operationalizes
- **idea-191** repo-event-bridge — incorporated; missionId=mission-52 (substrate-already-shipped)
- **idea-225** M-TTL-Liveliness-Design — companion (per-agent-idle work composes here per tele-8 sequencing)
- **idea-227** M-Hook-Design-End-to-End — forward composition (consumes 224 routing substrate + ships additional handlers)
- **Calibrations #50-#56** — closure-target set
- **Calibration #59** — bilateral-audit-content-access-gap closure mechanism (a) applied: Design v0.1 branch-pushed BEFORE bilateral round-1 audit dispatch

---

— Architect: lily / 2026-04-30 (Design v0.1 DRAFT)
