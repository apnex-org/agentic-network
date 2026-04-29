# M-Shim-Observability-Phase-2 — Survey envelope (mission-66 candidate; idea-220 Phase 2)

**Status:** Round 1 questions drafted; awaiting Director picks
**Mission:** mission-66 candidate (M-Shim-Observability-Phase-2)
**Source idea:** idea-220 Phase 2 (Shim Observability — Structured Telemetry Sinks; composite scope per `reference_idea_219_220_post_mission_62.md`)
**Methodology:** `docs/methodology/idea-survey.md` v1.0 (strict 2-round × 3-orthogonal-Q format; Calibration #43 discipline applied)
**Date authored:** 2026-04-29 (Phase 2 Survey)
**Author:** lily / architect

---

## §1 Idea description (anchor)

**idea-220 Phase 2 — Shim observability formalization + composite carryover from mission-64.**

Phase 1 (mission-62-W4-followon, architect-direct during P0 triage 2026-04-28) shipped tactical shim observability via FileBackedLogger + structured NDJSON events + dispatcher CallTool instrumentation + handshake parse-failure diagnostic + cognitive bypass knob + redaction discipline + naive timestamp-suffix rotation. Phase 1 immediately surfaced the P0 root cause (calibration #19 schema-rename without state migration) and demonstrated the substrate's value.

Phase 2 formalizes Phase 1's tactical landings + addresses composite scope accumulated during mission-64 close-arc and mission-65 carryover review.

**Composite scope (per `reference_idea_219_220_post_mission_62.md` 2026-04-28 + 2026-04-29 expansions):**

1. **Shim observability formalization** — log-level filter (`OIS_SHIM_LOG_LEVEL` env var); event taxonomy doc (every emitted eventName + fields shape); ADR for shim observability contract; engineer-side equivalents (vertex-cloudrun shim parity); tests for redaction + rotation; Pass 10 inclusion so it doesn't regress
2. **#21 closure** — Engineer Agent-record read-surface gap (`get_agents` not callable from engineer; substrate-self-check workflows blind on engineer side; **OPEN** since mission-62-W4)
3. **#40 closure** — Composite shim-observability + projection-fidelity gaps: (a) FileBackedLogger fds not open on fresh shim post-restart (lazy-fd dependency on routed events); (b) `get_engineer_status` advisoryTags missing `adapterVersion` projection (only `llmModel: "unknown"` surfaces); (c) version-source-of-truth divergence (`package.json:0.1.4` ≠ `.claude-plugin/plugin.json:1.0.0` ≠ `clientMetadata.proxyVersion:1.2.0`); + stale `pid` in projection across restarts. Defeats version-stamp-as-staleness-detector promise of mission-64 in practice (**OPEN** since mission-64-W3)
4. **#41 closure** — `kind=note` payload-rendering bilateral-blind defect; architect-lean closure path = option (b) **schema-validate at `create_message` entry-point** so caller gets immediate feedback on render-incompatible payload — closes the bilateral-blind class structurally at input boundary (**OPEN** since mission-64-W4-followon)
5. **#26 closure** — Silent thread_message body truncation marker missing; marker-protocol design (Hub embeds marker token at truncation boundary OR `<channel>` attribute `truncated="true" fullBytes="<n>"`) (**OPEN** since mission-63-W4)
6. **NEW Director scope ask 2026-04-29** — first-class CLI script for `get_agents` table against the Hub; no-MCP-required surface for operators (architect / Director / external) to inspect current Agent state; lives at `scripts/local/get-agents.sh` or `scripts/local/hub-status.sh`; auth via `~/.config/apnex-agents/<role>.env` `HUB_TOKEN`; targets `localhost:8080/...`; renders verbose projection (clientMetadata + advisoryTags + labels + lastSeenAt + status) as clean tabular CLI output. **Ergonomic frontend that ALSO surfaces #40 composite gaps** (anything stale in the projection becomes operator-visible immediately)

**Mission-class candidate (architect-pre-survey lean):** structural-inflection (M6 shifts substrate-state contracts on multiple seams: shim observability becomes formal contract; tool-surface authority extends to engineer for `get_agents`; render-template gains marker-protocol; version-source-of-truth consolidates; CLI script adds new operator surface). M6 is NOT a substrate-cleanup-wave because the formalization adds NEW substrate (event taxonomy doc, ADR, CLI script) rather than just retiring old.

**Sizing pre-survey lean:** L (~3-5 eng-days; revised up from M post-mission-64 carryover scope addition per `reference_idea_219_220_post_mission_62.md`).

---

## §2 Tele-mapping context (architect's read pre-Director-engagement)

Open calibrations rolling up to M6 scope (queryable via `python3 scripts/calibrations/calibrations.py list --status open`):

| Calibration | tele_alignment | M6 connection |
|---|---|---|
| #21 | tele-2 (collaboration) | Engineer get_agents read parity — symmetric multi-role read surface |
| #26 | tele-3 (fidelity) | thread_message marker-protocol — render-fidelity at truncation boundary |
| #40 | tele-3 (fidelity) | Projection-fidelity audit + version-source-of-truth consolidation |
| #41 | tele-2 + tele-3 | Schema-validate at create_message — bilateral-blind class closure at input boundary |

**Architect read:** M6 spans **all 4 primary teles**:
- **tele-3 Absolute State Fidelity** — projection audit + version consolidation + render-fidelity at truncation
- **tele-2 Frictionless Agentic Collaboration** — engineer get_agents read parity + bilateral-blind closure
- **tele-7 Resilient Operations** — shim observability formalization + diagnostic surface for future-P0 defense
- **tele-6 Deterministic Invincibility** — schema-validate at input boundary + version-stamp-as-staleness-detector restored

This is similar tele-spread to mission-65 (where Q1=A,B,C,D loaded all 4 primaries). M6 may also load all 4; Round 1 Q1 will surface Director's intent on which of the 4 are load-bearing primaries vs secondary/tertiary.

---

## §3 Round 1 — proposed questions (3 orthogonal; WHY/WHO/HOW-cadence dimensions)

### Q1 (WHY / tele-primary anchoring)

**Which tele primaries drive M6 most heavily? (multi-pick natural; M6 may be all-4-load-bearing similar to M65, or may narrow to 1-2 dominant primaries)**

- **A) tele-3 Absolute State Fidelity** — projection audit (#40 advisoryTags + version-source-of-truth divergence + stale pid); render-fidelity at truncation boundary (#26 thread_message marker); restored version-stamp-as-staleness-detector promise
- **B) tele-7 Resilient Operations** — shim observability formalization (event taxonomy + ADR + log-level filter + tests); future-P0 diagnostic surface; vertex-cloudrun engineer-side parity; defeat-recurrence-class for diagnostic-blackhole-at-P0
- **C) tele-2 Frictionless Agentic Collaboration** — engineer get_agents read parity (#21); bilateral-blind closure (#41 schema-validate input-boundary); multi-role read-surface symmetry across architect/engineer
- **D) tele-6 Deterministic Invincibility** — schema-validate at create_message entry-point (#41 architect-lean closure path b); structural input-boundary closure for bilateral-blind class; defeat-future-amplification-loop

### Q2 (WHO / role-pool coverage)

**Which role-pools should M6 deliver direct-benefit fixes to within Phase 2 scope? (multi-pick natural; defines deliverable surface)**

- **A) Engineer (LLM-side)** — `get_agents` callable from engineer (#21 closure); bilateral-blind closure (#41) benefits engineer-side authoring; vertex-cloudrun shim observability parity (engineer-side equivalents)
- **B) Architect (LLM-side)** — `kind=note` schema-validate caller-side feedback (#41 architect is the caller); shim-observability symmetric reads when authoring on lily-side; thread_message truncation marker visibility when authoring/reviewing (#26)
- **C) Director (operator / external)** — first-class `get_agents` CLI script (Director's 2026-04-29 ask); no-MCP-required surface for state inspection from terminal; ergonomic frontend that also surfaces #40 projection gaps
- **D) Future external pools** (post-substrate-shipment; would justify additional engineering — vertex-cloudrun observability parity ALONE is engineer-pool but additional external-pool work would be deferred)

### Q3 (HOW-cadence / wave structure)

**Should M6 deliver in single bundled wave or phased? (multi-pick contradictory IS a signal per §7)**

- **A) Single bundled wave** — all scope (substrate carryover + formalization + CLI script) ships in one PR sequence (W0+W1+W2+W3+W4 standard arc); closes carryover comprehensively in one mission cycle
- **B) Phased: substrate carryover first** — close #40 + #41 + #26 + #21 substrate fixes as primary scope (W1+W2 atomic = substrate fixes; W3 dogfood per fix); THEN formalization (event taxonomy + ADR + CLI script + tests) as separate wave or follow-on mission
- **C) Phased: substrate carryover as W0 fix-forward + formalization as primary** — substrate fixes ship as ordered fix-forward commits in W0 (similar to mission-64 5-cycle iteration pattern); formalization is the architectural mission scope (ADR + event taxonomy + Pass 10 inclusion + CLI script + tests)

---

## §4 Round 1 — Director picks (2026-04-29)

- **Q1:** B, C (tele-7 Resilient Operations + tele-2 Frictionless Agentic Collaboration; A + D NOT primary)
- **Q2:** A, B, C (Engineer + Architect + Director; D excluded — future external pools deferred)
- **Q3:** A (single bundled wave)

---

## §5 Round 1 aggregate response surface

**1-sentence composite read:** M6 is an **operationalize-the-diagnostic-surface + close-the-multi-role-asymmetry mission** delivering a coherent architectural arc (single bundled wave) that benefits all 3 internal roles (engineer + architect + Director) — driven by tele-7 (resilient operations / future-P0 diagnostic surface) + tele-2 (frictionless multi-role collaboration), with tele-3 fidelity fixes + tele-6 input-boundary mechanism riding along as substrate-of-the-mission rather than as primary drivers.

---

## §6 Round 1 tele-mapping (per §3 Step 4 multi-dim context)

| Tele | Round 1 weight | Justification |
|---|---|---|
| **tele-7 Resilient Operations** | **PRIMARY** (Q1=B) | Shim observability formalization is the mission's anchor; future-P0 diagnostic surface defeats the diagnostic-blackhole-at-P0 class structurally; vertex-cloudrun engineer-side parity ensures resilience across deployment substrates |
| **tele-2 Frictionless Agentic Collaboration** | **PRIMARY** (Q1=C) | Engineer get_agents read parity (#21) closes multi-role asymmetry; bilateral-blind closure (#41) restores caller-feedback round-trip; symmetric read-surface across architect/engineer is collaboration-substrate |
| **tele-3 Absolute State Fidelity** | secondary (Q1 NOT picked but #40 + #26 cite it) | Projection audit + version-source-of-truth + render-fidelity at truncation are sub-scope mechanisms in service of tele-7 + tele-2 primaries — substrate-of-the-mission, not driver |
| **tele-6 Deterministic Invincibility** | tertiary (Q1 NOT picked but #41 closure path mechanism) | Schema-validate at create_message entry-point is a structural-closure mechanism in service of bilateral-blind class (tele-2) — supports tele-2 primary |

**Cross-question coherence check:** Q1=B,C + Q2=A,B,C + Q3=A all align internally:
- tele-7 + tele-2 primaries directly map to the 3 internal roles benefiting (Q2=A,B,C)
- single bundled wave (Q3=A) reflects "operationalize diagnostic surface + multi-role-asymmetry-closure as one coherent arc"
- No tension surfaced; Round 1 cleanly anchors WHY/WHO/HOW-cadence

---

## §7 Round 1 per-question interpretations (per §3 Step 4)

### Q1 interpretation (B + C: tele-7 + tele-2 primaries)

**Architect read:** Director frames M6 as fundamentally an *"operations resilience + multi-role collaboration mission"*, NOT a fidelity (A) or invincibility (D) play. Even though calibrations #40 + #26 cite tele-3, those are downstream consequences of the operationalization arc rather than mission-driving primaries. Schema-validate at create_message (#41 closure path) is a tele-6 mechanism but the BILATERAL-BLIND CLASS it closes is fundamentally a tele-2 collaboration concern (closing the round-trip-feedback gap that breaks multi-role authoring).

**Phase 4 Design implication:** Anti-tele-drift check — Design phase must keep tele-7 + tele-2 framing front-and-center; tele-3 fixes ride along as "things that get cleaned up because we're doing the formalization" rather than as primary architectural commitments. Anti-pattern: fidelity-first framing that demotes operationalization (e.g., "audit projection drift" as Phase 4 Design framing) — that would invert the tele weight.

### Q2 interpretation (A + B + C: all 3 internal roles)

**Architect read:** M6 is **internal-pool-infrastructure mission** — exclusion of D (future external pools) signals scope-conservation similar to mission-65 Q2 pattern. All 3 internal roles benefit directly:
- Engineer: get_agents callable for substrate-self-check workflows (#21); bilateral-blind closure benefits engineer authoring; vertex-cloudrun parity closes deployment-substrate observability gap
- Architect: kind=note caller-side feedback (#41); symmetric reads enable lily-side substrate-introspection during authoring; thread_message truncation marker visibility prevents render-fidelity blindness
- Director: first-class CLI script provides no-MCP-required terminal surface for state inspection (operator-pool ergonomic frontend that ALSO surfaces #40 projection gaps to operator visibility immediately)

**Phase 4 Design implication:** Per-role acceptance criteria in W4 closing audit; each role must have at least one direct-benefit deliverable verifiable. Bilateral PR review surface should test both LLM-side roles (engineer + architect dogfood at W3) plus Director-side spot-check on CLI script.

### Q3 interpretation (A: single bundled wave)

**Architect read:** Director sees M6 as a **single coherent architectural arc** rather than two separable concerns (substrate-carryover vs formalization). The bundled-wave choice signals:
- Substrate fixes (#40 #41 #26 #21) and formalization (event taxonomy + ADR + log-level + tests + CLI script + vertex-cloudrun parity) share a common substrate (diagnostic surface), and bundling preserves architectural coherence
- W3 dogfood gate naturally exercises both substrate-fix AND formalization in single dogfood-cycle (calibration #34 W3-collapse-into-W1+W2-fix pattern is canonical for this class)
- Single Director-engagement gate (Phase 7 Release-gate) preserves Director time-cost minimization (anti-pattern: phased mission requires multiple Release-gates)
- L sizing baseline holds (~3-5 eng-days; substantial W1+W2 atomic execution)

**Phase 4 Design implication:** Wave plan = standard W0 + W1+W2 atomic + W3 dogfood + W4 closing arc. W1+W2 atomic execution will be substantial (multiple ordered commits per R8 mitigation; substrate-introduction class signature with potential 5-cycle iteration similar to mission-64 W1+W2-fix-N pattern). Bilateral PR review surface heavier than mission-65 W1+W2 (which was doc-only).

---

## §8 Round 2 — proposed questions (architect's choice: refine deeper + drill into HOW + WHAT-shape)

Round 1 cleanly confirmed all 3 dimensions (no contradictory multi-pick; no ambiguity flagged). Round 2 strategy per §4 table = **refine deeper (drill into HOW); explore new dimension (WHAT-shape; risk-anchor for Phase 4 Design)**.

### Q4 (WHAT-shape / scope coverage within bundled wave)

**Within the single bundled wave (Q3=A), which scope items ARE-IN vs DEFER to Phase 3 mission?** (single-pick or contradictory-pick = clarification signal per §7)

- **A) Substrate carryover only** — close #21 + #26 + #40 + #41 as primary scope; defer formalization (event taxonomy + ADR + log-level filter + tests + CLI script + vertex-cloudrun parity) to Phase 3 mission. Lower-bound scope; M sizing.
- **B) Substrate carryover + observability formalization** — close carryover + ship event taxonomy + log-level filter + ADR-031 + tests + Pass 10 inclusion. Defer CLI script + vertex-cloudrun parity to Phase 3 mission. Mid-scope; L lower-bound.
- **C) Substrate carryover + formalization + Director's CLI script** — comprehensive idea-220 Phase 2 scope per `reference_idea_219_220_post_mission_62.md`. Defer vertex-cloudrun engineer-side parity to Phase 3 mission. L mid-scope.
- **D) C + vertex-cloudrun engineer-side observability parity** — full Phase 2 scope including deployment-substrate symmetry. L upper-bound (~5 eng-days); substrate-introduction class signature throughout.

### Q5 (HOW-execution / lead-role split)

**Who takes lead on W1+W2 atomic execution? (multi-pick valid; D = engineer-led-with-architect-fix-forward signals task-domain split)**

- **A) Architect-led** — architect authors all artifacts (docs + ADR + Pass 10 + CLI script); engineer audits + ships any required Hub/SDK code via fix-forward
- **B) Engineer-led** — engineer authors all code (Hub schema audit + adapter logger + CLI script + bilateral schema-validate at create_message); architect audits + provides docs/ADR
- **C) Bilateral co-execution per task-domain** — architect on docs + ADR + event taxonomy + Pass 10 update; engineer on Hub code + adapter logger + CLI script + #41 schema-validate; M6 W1+W2 PR has commits from both sides
- **D) Engineer-led with architect-direct fix-forward authority on docs** — engineer ships all substrate fixes; architect ships docs/ADR/Pass 10/CLI script via direct-commit fix-forward (mission-64 architect-direct-fix-forward precedent for tooling-introduction class — note: M6 may not be tooling-introduction)

### Q6 (RISK / Phase 4 Design architectural-risk surface)

**Which architectural-risk class needs explicit Phase 4 Design treatment? (multi-pick natural; informs Design risks register + ADR-031 commitments)**

- **A) Schema-validate at create_message backward-compat** — #41 closure path b changes Hub MCP entry-point semantics; existing kind=note callers may break if validation rejects payloads previously accepted. Phase 4 Design must architect: validate-warn-vs-reject mode; migration path; deprecation signaling.
- **B) Hub-side projection-fidelity audit scope** — #40 surfaces 4 specific divergence symptoms (FileBackedLogger fd / advisoryTags adapterVersion / version-source-of-truth / stale pid). Phase 4 Design must architect: which other Hub surfaces have similar divergence? Audit-scope-narrowing-vs-comprehensive (audit-only-known-symptoms vs full-projection-class-audit).
- **C) thread_message marker-protocol design** — #26 marker-protocol options ((a) Hub embeds marker token at truncation boundary; (b) `<channel>` attribute `truncated="true" fullBytes="<n>"`; (c) marker-spec design at this mission). Phase 4 Design must ratify the marker-protocol choice + surfacing convention to render-template registry.
- **D) Shim observability event taxonomy boundary** — Phase 1 shipped tactical events (handshake parse-failure / dispatcher CallTool / cognitive bypass); formalization defines the canonical event taxonomy. Phase 4 Design must architect: which events are canonical-taxonomy vs ad-hoc; event-name + fields-shape stability commitments; backward-compat for existing event consumers (vertex-cloudrun parity ramifications).

---

## §9 Round 2 — Director picks (2026-04-29)

- **Q4:** C (substrate carryover + observability formalization + Director's CLI script; defer vertex-cloudrun engineer-side parity to Phase 3 mission)
- **Q5:** C (bilateral co-execution per task-domain) + Director note: *"architect and engineer already have defined roles RACI in mission-lifecycle"*
- **Q6:** B + C + D (NOT A — schema-validate at create_message backward-compat is NOT a Phase 4 Design architectural-risk surface; deferred to implementation-level decision during W1+W2)

---

## §10 Round 2 aggregate response surface

**1-sentence composite read:** M6 ships **L mid-scope** (substrate carryover + formalization + CLI script; vertex-cloudrun parity deferred to Phase 3) via **bilateral co-execution per task-domain** following standing mission-lifecycle RACI; Phase 4 Design must architect-decide on **3 substantive surfaces** (B Hub-side projection-fidelity audit scope + C thread_message marker-protocol design + D shim observability event taxonomy boundary), with #41 schema-validate backward-compat treated as implementation-discretion-during-W1+W2 rather than Design-time decision.

---

## §11 Round 2 tele-mapping refresh (per §4 Step 4 multi-dim context)

Round 2 picks reinforce Round 1 tele-primaries without shifting weight:

| Tele | Round 1+2 weight | Round 2 reinforcement |
|---|---|---|
| **tele-7 Resilient Operations** | PRIMARY | Q4=C includes formalization scope (event taxonomy + ADR + tests + Pass 10); Q6=D event-taxonomy-boundary is direct tele-7 architecture-of-resilience |
| **tele-2 Frictionless Agentic Collaboration** | PRIMARY | Q4=C includes #21 closure (engineer get_agents parity) + #41 closure (bilateral-blind class); Q5=C bilateral co-execution is collaboration-substrate operationally |
| **tele-3 Absolute State Fidelity** | secondary | Q6=B (projection-fidelity audit) + Q6=C (thread_message marker render-fidelity) ARE tele-3 surfaces but framed as Phase 4 Design risk-register entries (not primary mission drivers) |
| **tele-6 Deterministic Invincibility** | tertiary | Q6 NOT A (schema-validate backward-compat deferred to implementation-level) — tele-6 mechanism is implementation-domain at this mission, NOT architecture-of-invincibility |

---

## §12 Round 2 per-question interpretations (per §4 Step 4)

### Q4 interpretation (C: carryover + formalization + CLI script; defer vertex-cloudrun parity)

**Architect read:** Director picked the **L mid-scope tier** rejecting both lower-bound (A — substrate-only; loses formalization architectural commitment) and upper-bound (D — vertex-cloudrun parity; deferral signal to Phase 3 mission). C captures *"comprehensive idea-220 Phase 2 internal-pool scope"* without crossing into deployment-substrate parity territory.

**Phase 4 Design implication:**
- W1+W2 atomic execution scope = #21 + #26 + #40 + #41 closures + event taxonomy doc + log-level filter env var + ADR-031 + tests for redaction/rotation + Pass 10 inclusion + CLI script
- L sizing baseline holds (~3-4 eng-days; no upper-bound flag from Q4 since D excluded)
- Phase 3 mission scope (post-M6): vertex-cloudrun engineer-side observability parity (deployment-substrate symmetry; Cloud Run filesystem semantics; engineer-side FileBackedLogger equivalent)
- Anti-goal locked: NO scope creep into vertex-cloudrun parity in this mission

### Q5 interpretation (C + Director RACI note: bilateral co-execution per task-domain)

**Architect read:** Director's note *"architect and engineer already have defined roles RACI in mission-lifecycle"* signals two things:
1. Q5 was partially redundant with standing methodology — Survey questions about role-execution should presume the existing RACI rather than re-litigate it
2. Bilateral co-execution per task-domain IS the canonical RACI for mission-class L work; architect on docs/ADR/methodology, engineer on code/tests; bilateral PR review

**Phase 4 Design implication:**
- W1+W2 PR has commits from both architect (lily) AND engineer (greg) — bilateral co-execution split per task-domain
- Architect commits: docs/decisions/031-shim-observability.md (ADR; SCAFFOLD → RATIFIED at W4); docs/methodology/multi-agent-pr-workflow.md Pass 10 §F update; docs/specs/shim-observability-events.md (NEW; event taxonomy doc)
- Engineer commits: Hub schema audit + version-source-of-truth consolidation; adapter logger event-taxonomy alignment + log-level filter + redaction/rotation tests; #21 engineer get_agents tool surface; #41 schema-validate at create_message; #26 thread_message marker-protocol implementation; CLI script scripts/local/get-agents.sh (or hub-status.sh)
- Bilateral PR review surface = both sides audit each other's commits; calibration #24 dual-surface compliance throughout
- **Forward methodology-doc nugget for W4 retrospective:** Q5 surfaced that mission-lifecycle.md RACI is sufficient documentation; Survey methodology can presume it. Worth folding back into idea-survey.md as "Q5-class questions about role-execution split should defer to mission-lifecycle.md RACI rather than re-asking"

### Q6 interpretation (B + C + D; NOT A: 3 architectural-decision surfaces for Phase 4 Design)

**Architect read:** Director identified **3 substantive Phase 4 Design surfaces** that need architect-decide-at-Design-time:

- **B Hub-side projection-fidelity audit scope:** #40 surfaces 4 known symptoms (FileBackedLogger fd / advisoryTags adapterVersion / version-source-of-truth divergence / stale pid). Phase 4 Design must architect: **audit-scope decision** — fix only the 4 known symptoms (narrow), OR systematically audit Hub projection class for similar divergences (comprehensive). The narrow path risks leaving sister-divergences unsurfaced; the comprehensive path expands W1+W2 scope. Phase 4 Design ratifies the audit-scope boundary.
- **C thread_message marker-protocol design:** #26 has 3 marker-protocol options sketched (Hub embeds token / `<channel>` attribute / out-of-band). Phase 4 Design must ratify: **marker-protocol choice + render-template surfacing convention** — token-in-body breaks render-template parsing simplicity; channel-attribute requires render-template-registry update; out-of-band requires sidecar event. Architect-engineer bilateral architecture decision; Phase 4 Design ratifies.
- **D shim observability event taxonomy boundary:** Phase 1 shipped 3 ad-hoc events (handshake parse-failure / dispatcher CallTool / cognitive bypass). Formalization defines: **canonical taxonomy + naming convention + event fields stability** — what's in-taxonomy vs ad-hoc; backward-compat for existing event consumers (vertex-cloudrun deferred but vertex-cloudrun event consumers exist); how new events get added (versioned namespace? linter? migration?).

**Q6 NOT A interpretation:** Director excluded A (schema-validate backward-compat) which signals — #41 closure path b (validate-at-create_message-entry-point) is **runtime/implementation choice**, NOT architecture-of-input-boundary decision. The validate-warn-vs-reject-mode question + migration path are W1+W2-execution-discretion concerns (engineer-domain) rather than Design-time-architecture-decisions. Anti-pattern: over-architecting backward-compat at Design phase that engineer-side intuition handles cleanly during execution.

**Phase 4 Design implication:**
- Risk register has 3 explicit entries (B + C + D)
- ADR-031 commitments must include: B audit-scope boundary; C marker-protocol ratification; D event-taxonomy + naming-convention + stability-commitments + version-namespace
- Engineer-side intuition on #41 backward-compat is trusted (validate mode is implementation choice during W1+W2; no Design-time gate)
- Anti-goal locked: NO Phase 4 Design treatment of #41 schema-validate backward-compat (defer to W1+W2 execution discretion)

---

## §13 Cross-question coherence check (Round 1 + Round 2)

**All 6 picks align internally:**

- Round 1 Q1 (tele-7 + tele-2 primaries) ↔ Round 2 Q4=C (formalization for tele-7 ops + carryover for tele-2 multi-role): coherent
- Round 1 Q2 (engineer + architect + Director benefit) ↔ Round 2 Q5=C (bilateral co-execution per RACI): coherent — Director benefit via CLI script is bilateral-co-author candidate; Q4=C includes CLI script
- Round 1 Q3 (single bundled wave) ↔ Round 2 Q4=C (mid-scope; not phased): coherent — bundled wave with mid-scope deliverable, vertex-cloudrun parity is explicit Phase 3 deferral, not mid-mission phasing
- Round 2 Q6 NOT A ↔ Round 1 Q1 D-NOT-primary: coherent — tele-6 invincibility was tertiary in Round 1; Round 2 confirms #41 schema-validate is implementation-domain, not architecture-of-input-boundary

**No tension surfaced; mission intent is coherent across both rounds.**

---

## §14 Composite intent envelope (the "solved matrix"; Design phase input)

**Mission name:** mission-66 candidate = M-Shim-Observability-Phase-2 (idea-220 Phase 2; structural-inflection mission-class with substrate-introduction sub-class for ADR-031 event taxonomy + tooling-introduction sub-class for CLI script)

**Sizing:** L mid-scope (~3-4 eng-days bilateral; no upper-bound flag — Q4 D excluded)

**Phase composition:**
- **Phase 2 (this mission #6):** scope per Q4=C — comprehensive internal-pool idea-220 Phase 2 scope:
  - Substrate carryover closures: #21 (engineer get_agents read parity) + #26 (thread_message marker-protocol) + #40 (Hub-side projection audit + version-source-of-truth consolidation; 4 known symptoms; audit-scope ratified at Phase 4 Design Q6=B) + #41 (schema-validate at create_message entry-point per architect-lean closure path b; backward-compat = implementation discretion)
  - Observability formalization: event taxonomy doc (NEW; canonical taxonomy + naming convention + stability commitments per Q6=D); log-level filter env var (`OIS_SHIM_LOG_LEVEL`); ADR-031 architect-authored + bilateral-ratified; tests for redaction + rotation; Pass 10 §F inclusion
  - Director's CLI script: `scripts/local/get-agents.sh` or `scripts/local/hub-status.sh`; bash+curl+jq OR Python; auth via `~/.config/apnex-agents/<role>.env` `HUB_TOKEN`; targets `localhost:8080/...` for local-Hub posture; renders verbose Agent projection (clientMetadata + advisoryTags + labels + lastSeenAt + status); ergonomic frontend that ALSO surfaces #40 projection gaps
- **Phase 3 (deferred future mission):** vertex-cloudrun engineer-side observability parity (deployment-substrate symmetry; Cloud Run filesystem semantics; engineer-side FileBackedLogger equivalent; backward-compat for existing event consumers) — Q4 D explicitly excluded from this mission

**Wave plan:**
- **W0** (architect-led): Survey + Design v1.0 + Preflight + ADR-031 SCAFFOLD + Phase 7 Director Release-gate ratification → admin-merge → status flip proposed → active
- **W1+W2 atomic** (bilateral co-execution per Q5=C / mission-lifecycle.md RACI): substrate carryover closures (engineer code) + observability formalization (architect docs/ADR + engineer wiring) + CLI script (bilateral co-author); ordered commits per R8 mitigation
- **W3 dogfood** (5 verification gates per Design §3.2; observation-only architect-bilateral): substrate-self-dogfood for shim observability + projection-fidelity round-trip + marker-protocol render-fidelity + multi-role accessibility + CLI-script operator-side render
- **W4 closing**: closing audit + ADR-031 RATIFIED + Phase 10 retrospective + carryover-not-closed-here entries filed in calibration ledger (substrate-of-record landing as ledger entries from outset per mission-65 mechanization)

**Tele primaries:** tele-7 Resilient Operations (PRIMARY) + tele-2 Frictionless Agentic Collaboration (PRIMARY); tele-3 Absolute State Fidelity (secondary; sub-scope mechanism); tele-6 Deterministic Invincibility (tertiary; implementation-domain mechanism)

**Anti-goals locked from Survey:**
1. **NO scope creep into vertex-cloudrun engineer-side parity** (Q4 D explicitly excluded; Phase 3 mission scope)
2. **NO new tool-surface MCP verbs without idea-121 ratification** (CLI script uses existing Hub `get_agents` + read-only API; no new MCP verbs introduced)
3. **NO replacement of irreducible methodology prose** (event taxonomy is NEW prose; Pass 10 §F inclusion is doc extension; not replacement)
4. **NO LLM-side autonomous shim-config** (config knobs architect-authored; LLMs read-only at observability layer)
5. **NO fidelity-first framing in Phase 4 Design** (Q1=B,C primaries; tele-7 + tele-2 front-and-center; tele-3 fixes ride-along)
6. **NO Phase 4 Design treatment of #41 schema-validate backward-compat** (Q6 NOT A; runtime/implementation discretion during W1+W2)
7. **NO retroactive earlier-mission migration** of unaddressed open calibrations (#10 #15 #23 #30 #32 #44 #47 stay open; M6 closes ONLY #21 #26 #40 #41 plus any M6-origin calibrations surfaced)

**Phase 4 Design risk register surface (per Q6 picks):**
- **R1 (B)** Hub-side projection-fidelity audit-scope decision (narrow vs comprehensive)
- **R2 (C)** thread_message marker-protocol ratification (token-in-body vs channel-attribute vs out-of-band)
- **R3 (D)** Shim observability event-taxonomy boundary + naming convention + stability commitments + version-namespace strategy

**Substrate-self-dogfood discipline:** W3 dogfood gate exercises shim observability at architect-side AND engineer-side; substrate-introduction-class signature with potential 5-cycle iteration similar to mission-64 W1+W2-fix-N pattern (bilateral PR review may surface fix-forward chain)

**Calibrations addressed:**
- **#21** Engineer Agent-record read-surface gap → closed-structurally by W1+W2 atomic (engineer-side get_agents tool surface)
- **#26** Silent thread_message body truncation marker missing → closed-structurally by W1+W2 atomic (marker-protocol implementation per Phase 4 Design ratification)
- **#40** Composite shim observability + projection-fidelity gaps → closed-structurally by W1+W2 atomic (Hub schema audit + version-source-of-truth consolidation per Phase 4 Design audit-scope ratification)
- **#41** kind=note bilateral-blind defect → closed-structurally by W1+W2 atomic (schema-validate at create_message per architect-lean closure path b)

**Calibrations NEW likely (TBD-W4-closing-audit):**
- Methodology-class: Q5-RACI-redundancy nugget (idea-survey.md Q5-class questions should defer to mission-lifecycle.md RACI rather than re-asking)
- Substrate-class: any backward-compat regression surfaced during W1+W2 (#41 validate-mode + #40 audit-scope side-effects; surfaces via W3 dogfood or PR review)
- Methodology-class: any review-loop refinements (review-loop-as-calibration-surface pattern application)

**Calibration data point (Director time-cost):**
- Round 1 picks: ~3 minutes (Q1 + Q2 + Q3 multi-pick)
- Round 2 picks: ~3 minutes (Q4 + Q5 + Q6 multi-pick) + RACI clarifying note
- **Total Survey Director time-cost: ~6 minutes** (within methodology §1 estimate)
- Comparison: mission-65 Survey was ~6 minutes Director time-cost; M6 holds the cadence — methodology-stack steady-state operationally signaled

---

## §15 Phase 3 ratification gate

**Director-engagement gate:** Phase 2 Survey envelope complete. Phase 3 Director ratification = "Approved for Phase 4 Design" signal → architect drafts Design v0.1 (pre-Director-Phase-4-review per mission-65 cadence precedent).

**Architect-engagement next:** Phase 4 Design v0.1 architect-draft author (~30min architect-time) → Director Phase 4 review (4-item-class precedent per mission-65) → Design v0.1+ folds → engineer round-1 audit thread → Design v1.0 BILATERAL RATIFIED.

---

*Phase 2 Survey envelope completed 2026-04-29. Strict idea-survey.md v1.0 methodology applied throughout (Calibration #43 discipline; NO single-round-aggregation drift). Cross-question coherence check passed (Round 1 + Round 2). Composite intent envelope §14 = pre-Design phase input artifact per methodology §5. Awaits Director Phase 3 ratification signal.*
