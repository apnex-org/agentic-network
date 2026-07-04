# M-Director-Interface — Intent Brief (idea-388)

**Status:** v1.0 — RATIFIED at G0 (Intent Session 2, 2026-07-04, item-by-item walkthrough: 7 constraints + 5 fences individually confirmed; two G0 additions — §3.5a decision-class ontology into survey scope, §7.3 dual attention-efficiency metric)
**Arc:** stint-6 sole focus, per strategic-review GATE 2 (audit-9270 + audit-9271, 2026-07-04)
**Primary tele:** tele-13 Director Intent Amplification; secondary tele-4, tele-6, tele-10
**Provenance:** Intent Session 1 with the Director (2026-07-04, audits 9280 / 9285 / 9286 / 9305), conducted per the co-design directive (audit-9272) and the idea-416 interactive-presentation rule
**Authority note:** every decision in §2 is Director-made, live, one topic at a time; the session record is the source of truth — this brief is its assembly, not its interpretation

---

## 1. Purpose and problem

The Director is the single non-scalable resource in the network (tele-13). Today, Director
decisions and directives are:

- **hand-assembled** — prose lists that can drop items (the friction idea-388 names);
- **mechanically frozen** — decision-gate WorkItems with `roleEligibility [director]` can never
  be claimed, completed, or abandoned because no director seat exists (bug-219; five items were
  frozen on 2026-07-04, one stale for a week);
- **executed by proxy without a sanctioned mechanism** — live Director decisions reach the Hub
  only through the architect's seat, recorded as audit entries (a workaround, not a rail);
- **presented inconsistently** — the Director rejected dense multi-question artifacts and
  standing routing-to-PRs as decision prerequisites (idea-416 standing rule, 2026-07-04).

**The mission:** make Director interaction a first-class mechanized subsystem — decisions
captured, curated, presented, resolved, and executed as durable system state, at minimum
attention cost per intent resolved.

**Primary requirements evidence:** the 2026-07-04 live session itself — the prop-34
three-decision triage (worked), the four-question form (rejected), the frozen decision queue
(bug-219), the ratification-by-audit workaround (audit-9270/9271), and Intent Session 1
(structured single-topic queries validated at ~15 minutes for six foundation decisions).

## 2. Ratified intent decisions (Session 1)

| # | Topic | Director decision | Record |
|---|---|---|---|
| T1 | Scope | ALL FOUR interaction classes: decision gates, intent capture, structured elicitation, awareness & presence | audit-9280 |
| T2 | V1 spine | **Decision gates** — the queue is the skeleton; the other three classes attach to it | audit-9280 |
| T3 | Surface | **Substrate-first**; architect-in-chat is the v1 presentation layer, mechanized underneath; dedicated Director surface is a later slice | audit-9280 |
| T4 | Model + admission | **Decision = first-class sub-work-item** with its own resolution lifecycle; admission is **file-free** (any agent raises decisions; nothing gatekept out); architect **curates** what reaches the Director | audit-9285 |
| T5 | Delegation | Architect **self-disposes** only decisions that are BOTH **reversible AND in-policy** (covered by standing rules/precedent); novel, irreversible, scope-changing, or preference-shaped decisions always route to the Director; every self-disposal logged and Director-reviewable | audit-9286 |
| T6 | Design process | **Full-blueprint design council**, scoped as an instantiation of the generalized deliberation primitive (§5) | audit-9305 |

**Experiment #1 verdict (arc dogfood):** the Director prefers **structured single-topic
queries, presented inline** over plain-chat prompts and over stacked multi-question forms.
Lineage: mission-kit `skills/survey` is the ancestral structured-elicitation mechanism; the
Director flags it may be replaced by this arc's elicitation class (design must disposition it).

## 3. Constitutional constraints

1. **Due-diligence gate** — planning → intent → survey → design complete and Director-ratified
   BEFORE any implementation (audit-9270). Steve (verifier) holds this gate.
2. **Director co-designs** — survey and design phases are conducted WITH the Director in
   interactive working sessions, not reviewed by him at phase exits (audit-9272).
3. **One decision at a time** — the idea-416 presentation rule is a hard interface requirement,
   not a preference.
4. **Presentation-agnostic payloads** — the same structured decision/elicitation payload must
   render inline in an agent session (v1) AND in a future **non-agent standalone surface
   (CLI/TUI/GUI)** the Director uses outside any agent session (roadmap-committed, not v1).
5. **Authority non-delegation** (tele-13) — no decision is ever auto-taken; the self-disposal
   tier is bounded by T5 and every disposal is visible; the lean never becomes a silent veto.
   **5a (G0 refinement, Director):** the survey must produce a **decision-class ontology** —
   an explicit classification of decision types where the Director may grant standing
   delegated authority per class; auto-decision is only ever a *ratified property of a class*,
   never an inference (composes with fence 3: inferred automation stays banned).
6. **Meta-dogfood** — the arc itself trials Director-interaction approaches as named
   experiments; the Director's experience feedback is first-class design evidence. The arc's
   own phase gates ride the decision-entity rail it designs (§5).
7. **Composing floor in scope** — the bounded candidate-C operator-DX/CLI papercut batch
   (+ idea-361 reconciliation) may run alongside design phases (audit-9271): operator-DX is
   related work (same cause: Director-facing surface quality).

## 4. Entity-model seed (for the survey/council, not a design)

The Director's own formulation (T4): *"a decision is a sub-work-item that requires resolution."*

- **Decision entity:** child of a parent work/mission/proposal context; lifecycle
  `raised → curated → routed → resolved → executed`, every transition audited.
- **Raised** by any agent, free admission; raw feed durable and auditable.
- **Curated** by the architect: framing, dedup/merge, priority, presentation quality.
- **Routed:** to the Director queue, or self-disposed under the T5 boundary (logged).
- **Resolved:** Director answer (or in-boundary architect answer) captured as structured state —
  including custom/hybrid answers, which Session 1 showed carry the highest signal.
- **Executed:** the resolution propagates (approvals fire, scope changes recorded) without
  re-transcription (tele-6) — retiring the ratify-by-audit workaround (bug-219 fix shapes a/b
  are absorbed into this design space).

Known substrate lessons to absorb: bug-219 (no director seat; frozen FSM), bug-220
(evidence-requirement kinds must be mintable/validated at create-time — greg), the
work-transition/unblock event vocabulary (work-54) as the queue's signaling layer, and
idea-355's event-scoping taxonomy (Director-gates route exclusively to the Director surface).

## 5. Arc plan and the generalized pattern

**Pattern (audit-9305):** a scale-invariant deliberation primitive — *sealed inputs →
independent multi-seat positions → adversarial clash with recorded movement → verified
synthesis → authority ratification* — instantiated at portfolio altitude (strategic review,
idea-389, dogfooded VALID), now at **arc altitude** (this design council), and later at slice
altitude (lightweight variant for contested implementation choices).

**Phases** (each gate is a decision-entity in the Director queue — the arc rides its own rail):

| Phase | Content | Gate |
|---|---|---|
| P0 Intent | Session 1 (done) + this brief | **G0: Director ratifies intent brief** (Session 2) |
| P1 Survey | Option-space mapping: entity schema options, queue/curation mechanics, elicitation formats, survey-skill disposition, non-agent-surface requirements; Director participates | G1: Director confirms survey conclusions |
| P2 Design council | Full blueprint: sealed intent+survey → architect/engineer/verifier positions → clash → synthesis; Director injected at divergence points | G2: Director ratifies the design |
| P3 Build | Implementation per ratified design; verifier-gated slices | G3: commence-build confirmation, then standard PR/verify machinery |

**Planning follow-on:** extract the strategic-review blueprint's deliberation stages into a
**parameterized council blueprint** consumable at both altitudes (P2 uses it; future arcs reuse it).

## 6. Scope fences

- V1 spine is the decision-gate queue (T2); intent capture, elicitation, and awareness attach
  incrementally — no big-bang four-class build.
- The non-agent surface (CLI/TUI/GUI) is **not v1**; v1 must only guarantee its payloads render
  there without redesign (constraint 4).
- No auto-decisions, no preference-model re-ranking (tele-13 faults).
- Event subscription/routing beyond the Director-gate class stays idea-355.
- bug-219 fix shapes (a) sanctioned proxy-execution and (b) director seat are design INPUTS
  here, not parallel work.

## 7. Success criteria (draft — to be hardened at G0)

1. Zero frozen Director gates: every decision item is claimable/resolvable through a sanctioned
   path; the ratify-by-audit workaround is retired.
2. Nothing dropped: every raised decision reaches resolution or explicit disposal; the raw feed
   is auditable end-to-end.
3. Attention efficiency (G0-hardened): TWO trended signals — (a) measured Director-time per
   decision resolved beats the Session-1 benchmark (~2.5 min/decision including context);
   (b) a one-tap Director session rating; both must trend favorably (tele-13 SC4).
4. Authority integrity: audit shows zero decisions auto-taken and zero self-disposals outside
   the T5 boundary.
5. Presentation-agnostic: the same decision payload demonstrably renders in ≥2 surfaces
   (inline agent + one non-agent prototype) without payload change.
6. The arc's own gates (G0–G3) ran on the decision-entity rail (dogfood proof).
