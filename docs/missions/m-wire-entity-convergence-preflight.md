# M-Wire-Entity-Convergence (mission-63) — Preflight Artifact

**Mission:** mission-63 M-Wire-Entity-Convergence
**Status:** `proposed` → activation pending Director release-gate signal
**Architect:** lily
**Engineer:** greg (Design v1.0 bilateral co-author; round-1 audit + round-2 ratify shipped on thread-399)
**Verdict:** **GREEN** — all 6 check categories pass; ready for `update_mission(missionId="mission-63", status="active")`
**Date:** 2026-04-28
**Methodology:** `docs/methodology/mission-preflight.md` v1.0

---

## Summary

`mission-63 M-Wire-Entity-Convergence` is the post-mission-62 follow-on architectural mission. Source idea-219 (Wire-Entity Envelope Convergence + Schema-Migration Discipline) — incorporated → mission-63 (per `update_idea(idea-219, missionId=mission-63, status=incorporated)`).

**Architectural framing:** *Wire = projection of entity.* Convert all Agent-state-bearing wire surfaces (Hub-output) AND adapter-render path (claude-plugin) to a canonical envelope shape that mirrors the Agent entity contract. Eliminate the per-event-type if-ladder in `buildPromptText`. Ship state-migration script + Pass 10 protocol extension as bundled deliverables. Substrate-self-dogfood with full 5-requirement pattern at W4 (mission's own coordination consumes the new envelope at the dogfood gate).

**Mission class:** structural-inflection. **Sizing:** L on paper / M+ in flight (round-1 audit recalibration; mission-62 estimated L realized M; this mission has fewer unknowns + new deliverables — migration script + Pass 10 ext PR).

**Tele primaries:** tele-3 Absolute State Fidelity + tele-7 Resilient Operations + tele-6 Deterministic Invincibility (substrate-self-dogfood); tele-1 Sovereign State Transparency tertiary.

**Calibrations retired (5 of 9 from mission-62 P0+W4):** #17 Hub-rebuild gap, #18 wire-shape drift, #19 schema-rename without migration, #20 thread-message render-layer gap, #22 pulse-template-as-derived-view.

**Survey envelope** (Phase 3 Director-ratified): Q1=A+B (calibration retire + substrate fidelity), Q2=D (full sweep), Q3=A (single big-bang mission), Q4=A (both Hub-output + adapter-render layers), Q5=E (4 anti-goals locked), Q6=A (substrate full 5-requirement self-dogfood).

**Phase 4 Design v1.0** ratified bilaterally on thread-399 round 4 (2026-04-28T03:43:54Z); 4-round audit-ratify cycle; 8 substantive engineer audit asks + 2 framing tweaks incorporated. Notable empirical finding: 4/4 prod Agent records have `globalInstanceId: null` (legacy first-contact-creates predate PR #114) — drove §5.1 migration script `name = id` fallback decision.

---

## A. Documentation integrity

| # | Check | Verdict | Note |
|---|---|---|---|
| A1 | Brief at `mission.documentRef = docs/designs/m-wire-entity-convergence-design.md` exists | ✅ PASS | Committed at `3fe1676` on branch `agent-lily/m-wire-entity-convergence-design`; will land on main in W0 bundle PR |
| A2 | Local branch in sync with origin (no unpushed commits affecting brief) | ✅ PASS | Branch `agent-lily/m-wire-entity-convergence-design` from origin/main; latest commit `3fe1676` pushed; no unpushed local edits |
| A3 | Cross-referenced artifacts exist | ✅ PASS | Survey at `docs/designs/m-wire-entity-convergence-survey.md` (this PR; commit `9900640`); ADR-028 scaffold pending in this PR; methodology docs `mission-lifecycle.md` v1.2 + `idea-survey.md` v1.0 + `multi-agent-pr-workflow.md` v1.0 + `mission-preflight.md` v1.0 (extant); mission-62 Survey + Design + W4 audit + W5 closing audit (extant — architectural-precedent references valid) |

---

## B. Hub filing integrity

| # | Check | Verdict | Note |
|---|---|---|---|
| B1 | Mission entity has correct id, status=proposed, documentRef populated | ✅ PASS | mission-63; status=proposed; documentRef=docs/designs/m-wire-entity-convergence-design.md; missionClass=structural-inflection; pulses configured per `mission-lifecycle.md` §4.1 default cadence |
| B2 | title + description faithful summary of brief | ✅ PASS | Description carries Survey picks + Design v1.0 architectural framing + anti-goals + calibrations + tele primaries + wave plan + provenance to thread-399 round 4 ratify; matches brief |
| B3 | tasks[] + ideas[] empty (unexpected for proposed) | ⚠️ ACCEPTABLE DEVIATION | tasks[] empty ✓. ideas[] = [idea-219] — intentional incorporation record (parent Idea linked via `update_idea(missionId=mission-63, status=incorporated)` per architect role; not pre-scaffolded execution; idea-219 status flipped to `incorporated` on linking — matches mission-62 idea-215 precedent) |

---

## C. Referenced-artifact currency

| # | Check | Verdict | Note |
|---|---|---|---|
| C1 | Every file path cited in brief exists | ✅ PASS | Hub source paths verified by greg's round-1 audit code-read: `hub/src/policy/session-policy.ts:15` (coerceAgentRole) + `:483` (AgentStateChangedPayload) + `handshake.ts:91` (parseHandshakeResponse) + `mcp-agent-client.ts:259+` (CallTool/response boundary) + `prompt-format.ts buildPromptText` (7+ branches enumerated) — all present at audit time |
| C2 | Numeric claims verified | ✅ PASS | "7+ branches" in `buildPromptText` — greg verified by code-read (corrected from v0.1's "~4 branches" claim); 4/4 prod Agent records have `globalInstanceId: null` — greg verified empirically; 5 calibrations retired (#17, #18, #19, #20, #22) — verified against mission-62 W5 closing audit; 4 anti-goals locked (Q5=E) |
| C3 | Every idea/bug/thread cited still in assumed state | ✅ PASS | idea-219 (incorporated → mission-63 at Phase 5 Manifest just now); idea-220 (open; companion for calibrations not retired here: #15, #16, #21, #23); idea-218 (open; anti-goal: stays deferred — no consumer); idea-217 (open; anti-goal: separate mission); idea-121 (open; composes — natural fold-in); thread-399 (converged at round 4; Design v1.0 bilateral ratify); thread-395 (converged; mission-62 W4 dogfood — empirical reproducer for calibration #20) — all in assumed state |
| C4 | Dependency prerequisites in stated state | ✅ PASS | mission-62 (M-Agent-Entity-Revisit) **completed** 2026-04-28 ~11:05 AEST — substrate this mission converts is on main; PRs #110-#116 all merged; W4 audit + W5 closing audit doc on main (commit `873eb1b` for #115 bundle); state-migration partially executed (mission-62 P0 manual recovery); local-fs Agent records have `id` field (not `engineerId`) per W4 audit. mission-61 (Layer-3 lesson + Path A wiring) **completed** — architectural precedent for §6.4 verification protocol. mission-40 (session-claim) **completed** — `claim_session` semantics consumed |

---

## D. Scope-decision gating

| # | Check | Verdict | Note |
|---|---|---|---|
| D1 | Every engineer-flagged scope decision has ratified answer | ✅ PASS | All 8 round-1 audit asks + 2 framing tweaks fully incorporated in Design v0.2 → v1.0 (see thread-399 round 3 disposition table); 1:1 ask-to-section mapping verified by greg in round-2 ratify; round-2 implementation-detail observation on `previous` JSON absent-vs-undefined semantics added to §3.4 as inline comment for W1+W2 author |
| D2 | Director + architect aligned on ambiguous decisions | ✅ PASS | Director Survey-anchored 6 picks (full intent envelope captured); architect interpreted + ratified per `idea-survey.md` §3.4 + §4 methodology; no open Director-side decision points; Phase 7 Release-gate is Director's next engagement (preflight verdict ratification) |
| D3 | Out-of-scope boundaries confirmed | ✅ PASS | 4 anti-goals locked in Design §8 per Survey Q5=E: (1) NO legacy-flat-field deprecation runway; (2) vertex-cloudrun stub-only; (3) idea-218 Adapter local cache stays deferred; (4) idea-217 Adapter compile/update streamline stays separate. Each anti-goal closes a scope-creep vector and is mission-internal (no parent review) |

---

## E. Execution readiness

| # | Check | Verdict | Note |
|---|---|---|---|
| E1 | First wave sequence clear; engineer can scaffold day-1 work | ✅ PASS | W0 (this preflight PR) is doc-only — bundle Survey + Design v1.0 + ADR-028 scaffold + this artifact; W1+W2 atomic plannedTask is fully scoped (Hub-side `session-policy.ts` + `agent-policy.ts` + `sse-dispatch.ts` envelope conversion + tests); engineer can begin with `register_role` response-builder conversion in `hub/src/policy/session-policy.ts registerRole` per Design §3.1 |
| E2 | Deploy-gate dependencies explicit | ✅ PASS | Wave-coherence anti-flake operational sequence ratified (Design §9.1 5-step): W3 PR opened in DRAFT before W1+W2 merge; engineer pre-rebases W3 onto W1+W2 branch head; runs local end-to-end dry-run (build Hub from W1+W2 + adapter from W3 + exercise handshake); merge sequence W1+W2 → W3 same-day window. W3 post-merge runs Pass 10 protocol extension under live exercise (Design §6.3 9-step sequence with explicit step-3 stop-hub guard). Pass 10 protocol-extension PR at W5 codifies this sequence into methodology |
| E3 | Success-criteria metrics measurable | ✅ PASS | W4 dogfood gate has 7 explicit verification points (Design §6.4): handshake parse-cleanly both sides; verbatim envelope captures both sides; agent_state_changed SSE round-trip with `previous` + `at`; pulse content rendering inline (carryover GREEN); thread-message rendering inline (calibration #20 retire); thread-convergence-finalized inline (calibration #20 sub-finding retire); get_agents engineer-callable (calibration #21 partial-retire). Each verifiable via shim-events.ndjson capture + Hub log + thread-replies (mission-62 W4 thread-395 pattern reused) |

### E.4 — Engineer concerns surfaced + resolved

Round-1 audit produced no T1-call escalations. Engineer's lean was clear on every open question; architect ratified per §11 disposition table. Two implementation-detail observations carry into W1+W2:

- **Render-template registry pattern** (§4.3): W3 deliverable is registry + 4 mandatory templates, NOT wholesale rewrite of all 7+ existing inline branches. Existing inline branches stay (mechanical port to registered templates only).
- **`previous` shape JSON absent-vs-undefined semantics** (§3.4 inline comment): W1+W2 unit tests SHOULD include explicit absence-vs-undefined assertions to catch JSON-parser drift across SSE-event subscribers. Greg flagged for awareness; not blocking.

No Director input needed at activation beyond the Phase 7 Release-gate ratification itself.

---

## F. Coherence with current priorities

| # | Check | Verdict | Note |
|---|---|---|---|
| F1 | Anti-goals from parent review still hold | ✅ PASS | 4 anti-goals in Design §8 are mission-internal (no parent review); locked bilaterally at Phase 4 ratify |
| F2 | No newer missions filed that supersede or overlap | ✅ PASS | Recent backlog: idea-216 (bug-35 deferred; orthogonal — selectAgents semantic shift); idea-217 (anti-goal — separate mission); idea-218 (anti-goal — deferred); idea-220 (companion — covers non-retired calibrations); idea-121 (composes — API v2.0; natural fold-in but not blocking); idea-219 (incorporated → mission-63). No active mission overlaps wire-entity-envelope scope |
| F3 | No recent bugs/ideas materially change scoping | ✅ PASS | Today's session yielded: PR #115 (W4-followon shim observability; companion idea-220 Phase 1 landed); PR #116 (test repair; bug-32 baseline shrunk by 2 dispatcher tests); calibration #24 (thread-vs-GitHub approval surface decoupling — Director-saved as durable feedback memory; first operational application on PR #116). None materially reshape mission-63 scope |

---

## Director release-gate decision

**Verdict: GREEN.** All 6 check categories pass cleanly. No engineer T1-call escalations. No Director-input decisions pending beyond release-gate ratification itself.

**Director's signal:** `update_mission(missionId="mission-63", status="active")` — engineer becomes claim-eligible for W0 bundle PR (Survey + Design v1.0 + ADR-028 scaffold + this Preflight artifact). After W0 merges, W1+W2 atomic claim opens.

**Engineer prep window:** opens at Phase 6 (now) — greg can begin W1+W2 PR scaffold drafting; W3 PR draft pre-rebase per §9.1 operational sequence.

---

## Notable methodology calibrations from this Survey + Design cycle

These will be captured in W5 closing audit; surfaced here for Director context:

1. **Calibration #24 first-instance application** (`feedback_thread_vs_github_approval_decoupled.md`) — surfaced during PR #115 close 2026-04-28; first operational application on PR #116 (greg ratified both thread + GitHub surfaces in same turn; saved a coord-round vs PR #115's two-thread close pattern). Memory operationalized as cross-session rule.

2. **Phase 3 Survey + Phase 4 Design + Phase 5 Manifest in one session** — third canonical execution of Survey-then-Design pattern (idea-206 / mission-57 first; idea-215 / mission-62 second; idea-219 / mission-63 third). Director-engagement compressed to ~5min for 6 picks per pattern; remainder architect+engineer scope per RACI matrix.

3. **Round-1 audit empirical-evidence pattern** (greg §9.3 globalInstanceId check) — engineer cited concrete prod-state data (4/4 records null globalInstanceId) to retire architect's proposed recovery clause. Pattern: when audit involves stateful claims, ground in actual data over proposed-recovery-paths. Methodology-refinement candidate: `idea-survey.md` §4 round-2 strategy could note "if round-1 surfaces stateful claim, prefer empirical-grounding over architect-proposal".

4. **Two-column-view audit pattern** (greg §4.3 ask) — when a Design framing conflates two work axes (data shape vs structural pattern), audit can surface a two-column view that distinguishes them. Reusable feedback shape; methodology-refinement candidate.

5. **Pre-merge dry-run as wave-coherence anti-flake mitigation** (Design §9.1) — engineer's draft-PR-pre-rebase + local end-to-end dry-run is a NEW operational pattern not in `multi-agent-pr-workflow.md`. Worth codifying at W5 Pass 10 protocol-extension PR alongside the rebuild-protocol mandates.

---

## Cross-references

- **Survey artifact:** `docs/designs/m-wire-entity-convergence-survey.md` (W0 bundle PR)
- **Design v1.0:** `docs/designs/m-wire-entity-convergence-design.md` (W0 bundle PR)
- **ADR-028 scaffold:** `docs/decisions/028-canonical-agent-envelope.md` (W0 bundle PR; final ratify at W5)
- **Methodology:** `docs/methodology/mission-preflight.md` v1.0; `docs/methodology/idea-survey.md` v1.0; `docs/methodology/multi-agent-pr-workflow.md` v1.0; `docs/methodology/mission-lifecycle.md` v1.2
- **Anchor Idea:** idea-219 (`incorporated` → mission-63)
- **Companion ideas:** idea-220 (Shim Observability Phase 2; covers calibrations #15, #16, #21, #23 not retired here)
- **Anti-goal ideas:** idea-217 (Adapter compile/update streamline; separate mission); idea-218 (Adapter local cache; deferred)
- **Composes-with:** idea-121 (API v2.0; natural fold-in but standalone ship)
- **Architectural precedents:** mission-62 (substrate-self-dogfood W4 first canonical observation-only; Pass 10 rebuild discipline); mission-61 (Layer-3 SDK-tgz-stale lesson + Path A SSE-push wiring; substrate-self-dogfood pattern source); mission-56 (substrate-self-dogfood substrate canonical); mission-40 (session-claim consumed)
- **Survey + Design ratification thread:** thread-399 (4-round arc; converged at Design v1.0 bilateral)
- **mission-62 W4 + W5 audits:** `docs/audits/m-agent-entity-revisit-w4-validation.md` (calibrations #20-#23 root-cause documentation); `docs/audits/m-agent-entity-revisit-w5-closing-audit.md` (full 23-calibration narrative)
- **Sealed companion ADRs:** ADR-013/014 (Threads 2.0 stagedActions — canonical envelope architectural-precedent); ADR-017 INV-AG6 (4-state liveness FSM preserved); ADR-018 (cognitive pipeline modular contract — orthogonal to buildPromptText render-pipeline)

---

*Architect-authored 2026-04-28; verdict GREEN; activation pending Director release-gate.*
