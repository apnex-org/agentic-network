# M-Pulse-Mechanism-Phase-2 — Design v0.1

**Status:** v0.1 DRAFT (architect-authored 2026-04-30; pending engineer round-1 audit + bilateral converge to v1.0)
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

**Architect-recommendation:** **Candidate (b)** — message-content-dispatch is structurally distinct from entity-status-transitions; conflating risks abstraction-debt. New `hub/src/policy/message-handlers.ts` registry parallels `triggers.ts` but for message-content semantics.

**Architect-flag for round-1 audit:** confirm engineer-side preference.

### §2.2 Author-role-lookup primitive (NEW)

Translate GH login string → registered Hub agent → role determination.

```ts
// hub/src/policy/repo-event-author-lookup.ts (NEW)
async function lookupRoleByGhLogin(
  ghLogin: string,
  ctx: IPolicyContext,
): Promise<"architect" | "engineer" | "director" | null>
```

Implementation depends on Hub agent registration including GH-login mapping. **Architect-flag for round-1 audit:** does Agent entity carry `ghLogin` field today? If not, schema extension needed (small; additive).

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

### §2.5 Substrate scope

| Component | Status | Path |
|---|---|---|
| `message-handlers.ts` registry pattern | NEW | `hub/src/policy/message-handlers.ts` (or `repo-event-handlers.ts` if scoped to repo-events) |
| Author-role-lookup primitive | NEW | `hub/src/policy/repo-event-author-lookup.ts` |
| Dispatch wiring in `message-policy.ts` | EXTEND existing | `hub/src/policy/message-policy.ts:createMessage` post-create cascade |
| Agent.ghLogin schema extension | TBD (audit) | `hub/src/entities/agent.ts` (if missing) |
| Tests | NEW | `hub/test/unit/repo-event-handlers.test.ts` + author-lookup test |

---

## §3 First handler — commit-pushed (NEW; Path C deliverable)

**Trigger:** `external-injection` message with `payload.kind === "repo-event" && payload.subkind === "commit-pushed"`

**Logic:**

1. Extract `payload.payload.pusher` (GH login of commit author) + `payload.payload.commits[]` (commit metadata)
2. `lookupRoleByGhLogin(pusher)` → push-author role (architect / engineer / null)
3. If push-author is engineer:
   - Determine architect cross-role recipient (lookup architect agents via `list_available_peers(role="architect")`)
   - Emit message: `kind=note`, target={role: "architect"}, body="Engineer pushed N commits to branch X (commits: [...]); thread-heartbeat opportunity"
4. If push-author is architect: NO cross-role notification (architect pushes don't need engineer-cadence-discipline alert)
5. If push-author role unknown: log + skip (non-fatal)

**Cross-mission #54 closure scope:** this handler closes #54 (commit-push visibility gap) for engineer-pushes-to-architect direction. Architect-pushes-to-engineer direction (calibration #54 implied symmetric coverage) NOT in scope this mission — composes with idea-227 hook design.

**Architect-flag for round-1 audit:** message kind for the cross-party notification — `kind=note` is the lightest option (informational; no actionable response required). Alternatives: `kind=external-injection` with subkind, OR new `kind=cross-party-notification` (heavier; substrate-grade addition).

---

## §4 Pulse mechanism simplification (Q1a + Q2a + Q3a)

### §4.1 Strip class-based defaults (Q2a)

`mission-lifecycle.md` §4.1 per-class default cadence template — DELETE.

**Replace with:** §4.1 v2 — unified per-role defaults (10min engineer / 20min architect; per Q5a). `missionClass` field on mission entity STAYS (used for retrospective + portfolio-balance scoring per `mission-lifecycle.md` §3) but no longer drives pulse cadence.

### §4.2 Strip precondition predicate layer (Q3a)

ADR-027 PulseConfig schema:
- `precondition` field — REMOVE entirely from schema
- `mission_idle_for_at_least` predicate in `hub/src/policy/preconditions.ts` registry — REMOVE (and registry itself if no other consumers)
- Auto-injection of default precondition at `create_mission` validation — REMOVE

PulseSweeper logic:
- Remove precondition evaluation from per-pulse fire-decision
- Pulse fires on schedule unconditionally (modulo missedThreshold logic)

### §4.3 Methodology-doc consequences

`mission-lifecycle.md` §4.x updates:
- §4.1 Per-class default cadence → DELETE entire table; replace with §4.1 unified default (10/20)
- §4.2 Override semantics → simplify (no per-class taxonomy; just per-mission `pulses.*` declaration)
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

### §6.1 Layer (a) — Methodology-doc fold

Add to `engineer-runtime.md` row table (existing INDEX-overlay; mission-67 §4.2):

| Concern | Why it matters at runtime | Canonical source | Heading anchor |
|---|---|---|---|
| Commit-push thread-heartbeat | Per-commit thread ping for architect visibility (calibrations #54/#55); silent between-commit pauses are anti-pattern | `mission-lifecycle.md` | `#15-1-engineer-runtime-decision-moment-routing-calibration-57-codification` (existing) — extend to reference Q4d adapter-side automation per §6.2 |

`mission-lifecycle.md` §1.5.1 expansion: add subsection "§1.5.1.1 Commit-push thread-heartbeat mechanization (mission-68 closure of #55)" — describes 3-layer stack; cross-references §6.2 + §6.3.

### §6.2 Layer (b) — Adapter-side commit-push hook

claude-plugin shim modification:
- Detect `git push` execution (via Bash tool result observation OR explicit hook integration)
- On detection: auto-emit thread message to active mission-coord thread (if any) with commit-push metadata
- Implementation: extend `adapters/claude-plugin/src/shim.ts` OR new `adapters/claude-plugin/src/commit-push-hook.ts`

**Architect-flag for round-1 audit:** detection mechanism — hook into Bash tool result post-processing? Listen for stdout patterns? Filesystem watcher on `.git/`? Engineer-side preference?

### §6.3 Layer (c) — Hub-side commit-push event consumption (uses §2 + §3)

USES routing substrate from §2 + commit-pushed handler from §3. No additional Hub work beyond §2 + §3 deliverables.

### §6.4 3-layer composition

Belt + suspenders + braces:
- (a) methodology-doc fold = engineer-runtime documentation (cold-pickup awareness)
- (b) adapter-hook = engineer-side automation (no manual ping required)
- (c) Hub-side commit-push event consumption = architect-side notification (cross-party visibility)

Together: engineer cannot accidentally silent-stop without (a) cold-pickup awareness, (b) adapter-auto-ping, OR (c) Hub-side cross-party-notification firing.

---

## §7 Backward-compat handling (Q5a NEW-missions-only)

**Architect-recommendation (Phase 4 Design ratification needed):** NEW missions only get auto-pulse defaults; legacy active/proposed missions PRESERVE current behavior at-flip-time.

| Mission state at v1.0 ship | Pulse behavior |
|---|---|
| Currently `active` mission with explicit `pulses` config | UNCHANGED (existing config preserved) |
| Currently `active` mission without `pulses` config (per ADR-027 §6 legacy backward-compat) | UNCHANGED (still no auto-pulses) |
| Currently `proposed` mission | UNCHANGED until status flip; if flipped post-v1.0-ship, gets new defaults applied via `create_mission`-equivalent validation |
| NEW missions created post-v1.0 ship | Gets 10/20 defaults unless explicit override |

**Implementation:** version-check at `update_mission` status-flip-to-active OR `create_mission`. Pre-existing `active` missions are not retroactively updated.

---

## §8 missedThreshold refinement (Q6d reduce-to-2)

**Architect-recommendation (Phase 4 Design ratification needed):** reduce default from 3 → 2.

Time-to-detection at 10/20min cadence:
- Engineer: 10min × 2 missed = 20min escalation (was 30min at threshold=3)
- Architect: 20min × 2 missed = 40min escalation (was 60min at threshold=3)

Trade-off: faster detection vs spurious-escalation tolerance. At 10/20min cadence, spurious-escalation risk lower than at 15/30min (cadence-cushion shorter; less likely architect/engineer is mid-deep-thought-phase across multiple intervals).

**Architect-flag for round-1 audit:** confirm engineer-side acceptance.

---

## §9 ADR-027 amendments

ADR-027 (Pulse-Primitive + PulseSweeper) is the substrate this mission EXTENDS + SIMPLIFIES. Amendments needed:

| ADR-027 section | Amendment |
|---|---|
| §2.1 Single declarative coordination surface | `precondition` field removed from PulseConfig schema (per §4.2) |
| §2.6 E2 3-condition missed-count guard | Simplified — remove `noAckSinceLastFire` precondition-skip logic (no precondition layer); preserve `pulseFiredAtLeastOnce` + `graceWindowElapsed` |
| §2.8 mission_idle_for_at_least precondition | DELETE entire section |
| §6 Backward-compat row | NEW addition: "post-mission-68: legacy missions preserve at-flip-time; new missions get 10/20 defaults; precondition layer entirely removed" |
| §4.5 mission-lifecycle.md v1.0 — formal lifecycle phase additions | Note co-shipping with this mission's mission-lifecycle.md updates per §4.3 |

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
| AG-7 | NOT architect-push cross-party notification | Future-PR adds architect-push-detection cross-party emission → flag scope-creep | idea-227 (symmetric coverage there) |

### §10.2 Phase-N revisit-axes

| Axis | Phase-N venue |
|---|---|
| Per-agent-idle predicate | idea-225 M-TTL-Liveliness-Design |
| Phase-aware pulse content (#52) | Open future-mission OR Phase 10 retrospective-fold |
| Cross-pulse coordination (#53) | Reopen IF Q3a + Q1c structural-supersession proves insufficient post-ship |
| Additional cross-party-routing handlers | idea-227 hook design |
| Architect-push cross-party notification | idea-227 hook design |
| Pulse cadence per-context refinement | Future-mission if 10/20 defaults prove suboptimal |

---

## §11 PR sequencing + content map

### §11.1 Single PR (binding-artifact)

Per Phase 4 binding-artifact protocol — Survey + Design v1.x + implementation ship in single PR.

**Branch:** `agent-lily/idea-224-phase-3-survey` (currently carries Survey + Design v0.1; will carry Design v1.x + implementation post-bilateral)

**Scope:**
- Survey artifact (already shipped; commit `1d6f2ad` + `e24fdf2` + `53ae277`)
- Design v1.x (post-bilateral converge)
- Implementation:
  - Hub: routing substrate (§2) + commit-push handler (§3) + pulse simplification (§4) + default cadence (§5) + missedThreshold refinement (§8) + ADR-027 amendments (§9)
  - Adapter: claude-plugin commit-push hook (§6.2)
  - Methodology: mission-lifecycle.md §4.x updates + engineer-runtime.md row addition + ADR-027 amendments
- Tests: substrate + handler + pulse simplification regression + commit-push hook

### §11.2 Architect-judgment on PR-split

Single PR aligns with mission-67 binding-artifact pattern. If implementation surfaces scope-creep risk, can spin housekeeping concerns to separate PR per engineer C1 split-PR pattern (mission-67 precedent). Architect-flag for round-1 audit: engineer-side preference on split.

---

## §12 Open questions for round-1 audit (engineer Step 3)

Surfaced for engineer round-1 audit:

1. **§2.1 substrate-pattern decision** — Candidate (a) extend triggers.ts vs Candidate (b) new message-handlers.ts. Architect-recommends (b); confirm engineer-side preference?
2. **§2.2 author-role-lookup** — does Agent entity carry `ghLogin` field today? If not, schema extension acceptable scope?
3. **§3 commit-pushed handler** — message kind for cross-party notification: `kind=note` (light) vs `kind=external-injection` w/ subkind vs new `kind=cross-party-notification` (substrate-grade). Architect-recommends `kind=note`.
4. **§6.2 adapter-side commit-push hook detection mechanism** — Bash tool result post-processing vs stdout pattern listening vs filesystem watcher on `.git/`. Engineer-side preference?
5. **§8 missedThreshold reduce-to-2** — engineer-side acceptance?
6. **§11.2 PR-split** — single binding-artifact PR vs split (housekeeping concerns to separate PR per C1 mission-67 pattern)?
7. **Anything else** — content-level surface may reveal gaps invisible at shape-level (cross-section coherence, terminology drift, implicit-vs-explicit specifications, etc.)

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
