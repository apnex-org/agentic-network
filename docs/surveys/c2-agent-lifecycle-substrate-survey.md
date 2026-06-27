---
mission-name: M-Agent-Lifecycle-Substrate (C2 arc)
source-idea: "C2 arc — docs/designs/c2-agent-lifecycle-substrate-arc-design.md (spike-gated arc)"
methodology-source: docs/methodology/idea-survey.md v1.0
status: DRAFT — AWAITING DIRECTOR PICKS (staged during autonomous-stint-3 for the Director's return)
director-picks:
  round-1:
    Q1: TBD
    Q2: TBD
    Q3: TBD
  round-2:
    Q4: TBD
    Q5: TBD
    Q6: TBD
mission-class: substrate-introduction
tele-alignment:
  primary: [tele-13, tele-4, tele-1]
  secondary: [tele-7, tele-10, tele-8, tele-3]
  round-1:
    primary: [tele-13, tele-1]
    secondary: [tele-4, tele-10]
  round-2:
    primary: [tele-4, tele-13]
    secondary: [tele-7, tele-8]
anti-goals-count: 5
architect-flags-count: 4
skill-meta:
  skill-version: architect-direct (methodology run inline, not Skill-mediated)
calibration-data:
  director-time-cost-minutes: TBD (target ~4-5 for 6 picks)
  comparison-baseline: idea-206 first-canonical + c3-ship-integrity-spine arc Survey
  notes: >-
    Questions ground-truth-anchored to the C2 arc-design doc's pre-identified
    "Survey questions for the Director" section (4 decision-points) + the W0 spike
    charter, surfaced via a read-only research pass (Explore agent) BEFORE
    question-design. Staged pre-Director-input during the autonomous stint; picks
    + per-question interpretations to be filled when the Director answers on return.
calibration-cross-refs:
  closures-applied: []
  candidates-surfaced:
    - arc-design-doc-pre-identifies-Survey-questions (the arc-design already carried a
      "Survey questions for the Director" section — confirms the c3 arc-design-panel-precedes-Survey
      methodology-evolution candidate; here the arc-design itself did the pre-identification)
---

## §0 Context

**C2 — Agent-Lifecycle Substrate** (`docs/designs/c2-agent-lifecycle-substrate-arc-design.md`) is the **"measured → lossless → system-restartable"** arc, the k8s+cognitive-continuity facet that **retires the Director-as-restart-bottleneck** (the strongest tele-13 driver in the roadmap). It exists to kill two fused root causes: (1) **no control plane OUTSIDE the LLM process** — the plugin/shim runs INSIDE the harness, so it can never restart its own host; (2) **durable working-state fused to an ephemeral, unmeasured, exhaustible context window** (the only checkpoint primitive is queue-item-scoped). The org already solved this reconcile shape one layer down (prod Hub under watchtower+systemd reconciling ACTUAL→DECLARED) but **never turned that pattern on the agents themselves.**

**Arc shape:** a Director-gated **W0 spike** (R0) → four banked build rungs — **L1 Context-Runway-Observability** (the standalone keystone: context as a measured, Hub-visible, first-class resource on `Agent.status.contextRunway`, with a `{measured|estimated|heuristic}` fidelity tag) → **L2 Agent-Continuity-Contract** (new kind ContinuityRecord; a thin pointer+cursor over Hub truth, advisory handoff note) → **L3 Harness-Lifecycle-Supervisor** (new kind AgentLifecycleDirective; the supervisor outside the harness — `docker stop/start` IS the clean exit a plugin can't call) → **L4 Lifecycle-Authority-And-Auto-Trigger** (policy + Audit; restart-authority vs restart-mechanism split; auto-trigger behind four hardening gates) → **R5 Fleet-Orchestration is CHARTERED-DEFERRED, do-not-build.** Substrate footprint: locked kinds 22 → 24.

This Survey anchors C2's **execution intent** before Design opens. Its six questions are ground-truth-anchored to the arc-design's own pre-identified "Survey questions for the Director" (4 decision-points) + the W0 spike's central risk. **The roadmap names this exact step: "C2 Survey → ratify → build L1."**

> **Note on the W0 spike:** the central spike risk is an **execution-model mutual-exclusivity** hypothesis — the *restartable* model (headless `claude -p`, one-shot) and the *measurable + in-place-compactable* model (long-lived interactive `claude`-in-container with a statusline + `/compact`) may not coexist. Several questions below are conditioned on, or feed, that spike verdict. Per calibration #4, an AMBER verdict that forces a fallback **is a successful spike, not a failure.**

---

## Round 1 — Guide intent space (WHY / SCOPE / SEQUENCING)

*Three orthogonal high-level axes. Multi-pick is natural and a signal, not an error.*

### Q1 — Primary outcome priority: what should C2 deliver FIRST?
- **(a) Restartability** — agents restartable from OUTSIDE the LLM (kill the Director-as-restart-bottleneck). *(tele-13)*
- **(b) Measurability** — context as a measured, Hub-visible, first-class resource; see exhaustion coming before it hits. *(tele-1 / tele-4)*
- **(c) Continuity** — lossless handoff of working-state across restart/compaction. *(tele-4)*
- **(d) The coherent whole** — all three as one arc; no single spearhead, sequence by dependency.

**Architect self-justification (axis):** discriminates the intent space along the *value-driver* axis — which of C2's three fused outcomes is the Director's primary pull. Maps cleanly to distinct tele leads (restartability→tele-13; measurability→tele-1/4; continuity→tele-4). The build order is naturally **L1 measurability → L2 continuity → L3 restartability**, so picking restartability-first (a) signals appetite to push through to L3 quickly (gated on siblings — see Q3), whereas measurability-first (b) endorses shipping the standalone L1 keystone first. Single-pick is a prioritization signal; (d) endorses dependency-ordered build.

### Q2 — Scope of THIS arc: how far does C2 go before the next gate?
- **(a) L1 only** — Context-Runway-Observability (the measurement keystone; standalone, no containers).
- **(b) L1 + L2** — add the Continuity Contract (both genuinely standalone; no container/sibling dependency).
- **(c) L1 + L2 + L3** — add the external Harness-Lifecycle-Supervisor (needs containers + C3-R4 governor + D-1 control-plane).
- **(d) Full L1–L4** — add Lifecycle-Authority + auto-trigger (the throughput multiplier; max sibling-gating + the safety envelope).

**Architect self-justification (axis):** discriminates along the *ambition/commitment* axis — how much of the substrate to commit to in this arc. Orthogonal to Q1 (you can want restartability-first yet scope conservatively to L1+L2 pending the spike). The arc-design flags that **only L1/L2 are genuinely standalone**; L3/L4 are gated on three uncommitted siblings (C1 telemetry, C3-R4 renameMap governor, D-1 control-plane). So (a)/(b) are low-risk "bank the standalone value now"; (c)/(d) commit to the sibling-dependency chain.

### Q3 — Sequencing posture for the sibling-gated rungs (L3/L4)
- **(a) Ship L1/L2 now standalone; PARK L3/L4** behind the sibling commitments (C1 / C3-R4 / D-1), re-engage when they land.
- **(b) Land an enabling sibling FIRST** (e.g. D-1 R1 read-binding) and re-prioritize C2's deeper rungs after it.
- **(c) Commit the sibling arcs as a parallel bundle** — drive C1 telemetry + C3-R4 + D-1 alongside C2 as one wave.
- **(d) Let the W0 spike verdict decide** the sequencing (don't commit posture until the spike's GREEN/AMBER/RED lands).

**Architect self-justification (axis):** discriminates along the *cross-arc dependency* axis — how to handle the headline-value hazard that C2's throughput multiplier (L3/L4) depends on three uncommitted siblings. This is the arc-design's pre-identified question #3 (cross-arc sequencing posture). Orthogonal to scope (Q2 = how far in C2; Q3 = how to handle the dependencies that gate going far). (a) = safety-before-leverage default; (d) = defer-the-posture-to-evidence.

---

## Round 2 — Refine the hard trade-offs (EXECUTION-MODEL / DEFER-BAN / AUTHORITY)

*The three load-bearing safety/authority trade-offs the arc-design + adversarial verdict flagged.*

### Q4 — Execution-model priority IF the spike confirms mutual exclusivity
*If W0 proves the restartable model (headless `claude -p`) and the measurable+in-place-compactable model (interactive `claude`-in-container) cannot coexist, prioritize:*
- **(a) Restartability** — accept estimated/heuristic context (lower fidelity tag), gain external restart.
- **(b) Measurability + in-place compaction** — accept a harder/uglier restart path, gain true measured context + `/compact`.
- **(c) Vendor feature-request to unify** — accept a wait; pursue the upstream fix that gives both.
- **(d) Both models, per-role** — e.g. verifier/steve restartable (headless); builders measurable (interactive). Accept two execution models.

**Architect self-justification (axis):** the arc-design's pre-identified question #2 + the #1 spike risk, made decision-ready. Discriminates the *which-leg-wins* axis under the worst-case spike outcome. This conditions the whole arc's runtime target, so it's posed now (advisory until the spike resolves) to avoid a stall at the spike gate. (d) is the composable escape — different harnesses, different models — which the per-host spike matrix already accommodates.

### Q5 — The defer-and-restart ban vs L4's automatic lossless handoff
*Your INDEFINITE no-defer-and-restart ban ("until rescinded") — does an AUTOMATIC, lossless, gated checkpoint-then-restart (L4) fall under it?*
- **(a) Permitted** — the ban targeted the HUMAN-gated bottleneck; an automatic, lossless, gated handoff is a different thing and is allowed.
- **(b) Still banned** — L4 auto-trigger needs an EXPLICIT rescind before it can ship; do not assume.
- **(c) Permitted only behind the four hardening gates** — fidelity-gate (measured-only) + checkpoint-completeness + restart-rate circuit-breaker + non-gating verifier-audit.
- **(d) Permitted for verifier / non-load-bearing agents only** — human-gated for builders carrying load-bearing work.

**Architect self-justification (axis):** the arc-design's pre-identified question #1 — a direct constitutional check, since L4's auto-handoff re-activates a pattern the Director banned indefinitely. Discriminates the *autonomy-boundary* axis. This is the gate that decides whether L4 can ship at all this arc; (c) is the constraint-satisfaction option (the c3 Survey's resolution shape — "yes, behind a maximal safety envelope").

### Q6 — Force-restart authority tier (overriding peer consent on a proven-staleness verdict)
- **(a) Per-occasion Director authorization** — mirror `change_agent_role` / the sanctioned-role-change path.
- **(b) Architect-RACI sufficient** + a first-class Audit entry (record-first, not gate-first).
- **(c) Architect-RACI, but ONLY on a measured-fidelity staleness verdict** — never on a heuristic gauge (ties authority to L1 fidelity).
- **(d) Tiered** — graceful self-drain = architect-RACI; hard-kill (overriding consent) = Director-gated.

**Architect self-justification (axis):** the arc-design's pre-identified question #4. Discriminates the *who-may-pull-the-trigger* axis, distinct from Q5's *may-it-be-automatic-at-all*. (c) couples authority to the L1 fidelity tag (a structural safety link); (d) tiers by reversibility (drain is reversible; hard-kill isn't) — mirrors the deploy-posture "flow reversible, gate irreversible" discipline.

---

## §Anti-goals (carried into Design)
1. **R5 Fleet-Orchestration is NOT in scope** — chartered-deferred, do-not-build; activation gate = >3 agents or recurring manual-orchestration toil, architect-surfaced AND Director-confirmed.
2. **No new telemetry ledger** — context-runway is a FIELD on the existing Agent kind (`status.contextRunway`), and the operator view converges into C1's org-health pane, NOT a parallel dashboard.
3. **The continuity record is NOT free-form markdown** — it's a thin pointer+cursor over Hub ground-truth; the LLM handoff note is advisory-only, work-trace markdown explicitly non-load-bearing.
4. **The verifier-audit on lifecycle transitions must NOT become a veto** — no create_review / reopen / gating authority; that would breach the ratified `verifier-role.md` §1/§2.3 and need separate Director re-ratification this arc does not request. (C4 boundary.)
5. **The harness-supervisor class retires for the two CURRENT harnesses only** (claude + opencode) — no over-claim to a general N-harness supervisor.

## §Architect-flags (open for Phase-4 audit / Design)
1. **Auto-trigger-on-unreliable-gauge** is the central tele-4 threat — the L1-fidelity → L4-safety propagation must be the load-bearing link (L4 refuses to auto-act on non-measured data). Q4+Q5+Q6 jointly bound it.
2. **Staleness must be a PRIMITIVE, not a heuristic** — two signals (heartbeat AND work-progress → {healthy|crashed|stalled}); an under-specified staleness verdict kills slow-but-legitimate long work (the exact org-rule violation). Feeds Q6.
3. **Cross-arc dependency slip is the headline-value hazard** — if the siblings (C1/C3-R4/D-1) don't land, L3/L4 (the actual throughput multiplier) can't ship; only L1/L2 are bankable standalone. Q2+Q3 bound it.
4. **W0 execution-model verdict gates the runtime target** — Q4 is advisory until the spike resolves; the Design must not hard-commit a runtime model before the spike's per-host matrix lands.

## §Cross-references
- Arc design: `docs/designs/c2-agent-lifecycle-substrate-arc-design.md` (W0 charter + L1–L4 rungs + the source "Survey questions for the Director" §)
- Methodology: `docs/methodology/idea-survey.md` v1.0 (the 3+3 process)
- Sibling arc Survey (current-schema precedent): `docs/surveys/c3-ship-integrity-spine-survey.md`
- Canonical content template: `docs/surveys/m-mission-pulse-primitive-survey.md` (idea-206, first execution)
- Roadmap: `docs/roadmap.md` (C2 = "spike passed; arc-design DRAFT, not yet surveyed → next: C2 Survey → ratify → build L1")
- Teles: tele-13 (Director Intent Amplification — the north star), tele-4 (Zero-Loss Knowledge), tele-1 (Sovereign State Transparency), tele-7 (Resilient Operations — no silent kill/loss)
