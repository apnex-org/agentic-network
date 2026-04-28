# Mission M-Adapter-Streamline — Pre-Design Intent Survey

**Source Idea:** idea-217 (Streamline adapter compile/update/re-install for consumers; Director-flagged 2026-04-27 ~21:00Z during mission-62 W3 coord-pause)
**Survey conducted:** 2026-04-28 ~07:00Z (architect lily; Director-paced; both rounds + ratification within ~30 min)
**Per:** `docs/methodology/idea-survey.md` v1.0 (canonical Idea→Design triage methodology)
**Lifecycle phase:** 3 Survey (between Idea triage + Design v0.1 architect draft)
**Status:** v1.0 — bilateral interpretation complete; composite intent envelope below bounds Phase 4 Design phase
**Companion idea filed:** idea-221 (Pass 10 cross-§ orchestration; operator-side companion per Q5 C split-scope)

---

## Source Idea description (carry-forward context)

idea-217 captures the operator-friction surface of the current adapter-update flow:

- Adapter SDK source lives in `packages/{network-adapter,cognitive-layer,message-router}/src/`
- Adapter dirs (`adapters/{claude,opencode}-plugin/`) bundle SDKs as `file:*.tgz` deps
- After any SDK source change: build dist (tsc) → `npm pack` each SDK → distribute tgzs to all 6 adapter dirs (3 worktrees × 2 plugins) → clean reinstall in each adapter dir → plugin cache reinstall → session restart
- Layer-1 (SDK-stale tgz) / Layer-2 (plugin cache stale) / Layer-3 (`file:../sibling` deps don't survive pack) — the consumer should never have to know about these

idea-217's framing: make adapter updates **single-command** for consumers. Hide source-code structure + bundle mechanics + restart-protocol behind a clean update verb.

**5 candidate solution shapes filed in idea-217:**
1. **Update script** — `scripts/local/update-adapter.sh` (rebuild + redistribute + reinstall + plugin cache + restart notice)
2. **CLI command** — `ois adapter update` (cleaner UX wrapper; same as 1 with status output)
3. **npm-published packages** — `@apnex/claude-plugin@latest` (consumer runs `npm install -g`)
4. **Auto-update on session-start** — adapter shim self-updates on launch
5. **Hub-served adapter** — Hub HTTP-serves binary; shim downloads on connect

**Tele primary (idea-217 declared):** tele-2 Frictionless Agentic Collaboration; tele-7 Resilient Operations secondary; tele-6 Deterministic Invincibility tertiary.

---

## §1 Pre-anchor: tele inventory + adjacent context

**idea-217 declared tele weight:**
- Primary: tele-2 Frictionless Agentic Collaboration (consumer experience friction reduction)
- Secondary: tele-7 Resilient Operations (robust update path reduces drift between source + running adapter)
- Tertiary: tele-6 Deterministic Invincibility (single update path eliminates Layer-1/2/3-class regression vectors)

**Adjacent tele weight (architect-anchored):**
- tele-3 Absolute State Fidelity — consumer-running-adapter coherence with source
- tele-13 Hub-as-Source-of-Truth — relevant only under option 5 (Hub-served adapter); rejected at Round 1 Q1 D

**Adjacent post-mission-63 context:** Pass 10 protocol just landed in `multi-agent-pr-workflow.md` codifying §A Hub rebuild + §B SDK rebuild + §C state-migration + §D claude-plugin reinstall. Calibration #25 (mission-63 W4-surfaced) flagged Pass 10 §B as the most-frequently-skipped step. The adapter-streamline scope and the Pass-10-mechanisation scope overlap but aren't identical.

---

## §2 Round 1 — picks + interpretation

### Director picks

| Q | Picks | Type |
|---|---|---|
| Q1 (WHY: dominant pressure) | **A + B + C** | multi-pick (3 of 4) |
| Q2 (WHO: target audience) | **A + B + D** | multi-pick (3 of 4) |
| Q3 (HOW-cadence: rollout strategy) | **A** | single pick |

**Q1 options:** A=Consumer-side friction reduction; B=Mechanise Pass 10 §B + §D; C=Establish adapter distribution channel; D=Pressure-test Pass 10 protocol via mechanisation.

**Q2 options:** A=Local-dev consumers; B=External consumers; C=Hub operators; D=Future agent-pool members.

**Q3 options:** A=Single big-bang mission ship; B=Spike-first → fix-forward; C=Phased multi-PR mission; D=Defer to future mission.

### Aggregate response surface (Round 1)

Mission addresses **consumer-receipt-friendly streamlining** across **local-dev + external + future-agent-pool audiences** (not operator-runbook surface), driven by 3 orthogonal pressures (friction reduction + Pass-10-mechanisation + distribution channel) — shipped as a **single big-bang mission with full scope**. Director rejected Q1 D (meta/protocol-hygiene framing) and Q2 C (operator audience) — dominant signal is **consumer-receipt fidelity**, not protocol coherence.

### Tele mapping (Round 1)

- tele-2 Frictionless Agentic Collaboration — primary (Q1 A consumer friction; Q2 A+B+D developer-equivalent audiences)
- tele-7 Resilient Operations — primary (Q1 B Pass-10 mechanisation closes regression class)
- tele-3 Absolute State Fidelity — secondary, ELEVATED (Q1 C distribution channel implies version-coherence)
- tele-6 Deterministic Invincibility — secondary (Q1 B mechanisation hardens against drift)
- tele-9 Frictionless Director Coordination — NOT activated (Q2 C rejection rules out operator-coordination scope)
- tele-13 Hub-as-Source-of-Truth — NOT activated (Q1 D rejection rules out option 5)

### Per-question interpretations

**Q1 (WHY) — A+B+C unified:**
Three orthogonal consumer-receipt-friendly pressures unified, not three independent missions. Consumer friction (A) is the surface symptom; Pass-10 mechanisation (B) is the protocol-mechanism-level fix; distribution channel (C) is the packaging-layer enabler. Together: this is a coherent **consumer-receipt-fidelity mission** — the adapter-receipt experience IS what the substrate needs to be, and the existing manual recipe + per-PR coordination is what's broken. D rejected because "protocol-pressure-test via mechanisation" is meta-architectural; Director wants substrate work.

**Q2 (WHO) — A+B+D unified; C rejected:**
"Anyone who installs the adapter" — local-dev + external + future-pool — excluding Hub operators. Director's signal: this mission is for **developer-equivalents** receiving the adapter; not for operators running the substrate. **Rules OUT** solutions shaped like operator runbooks (e.g., a Hub-side admin-dashboard "deploy adapter to all consumers" — that would be tele-9 Director-coordination, not tele-2 consumer-experience). **Rules IN** solutions consumers self-serve.

**Q3 (HOW-cadence) — A unambiguous:**
Single big-bang mission. Director rejected B (spike-first), C (phased multi-PR), D (defer). Combined with multi-pressure (Q1) + multi-audience (Q2) framing: the **solution-shape that ships must address all 3 pressures across all 3 audiences in one mission cycle**. Mission-class structural-inflection sizing pattern (matches mission-62 + mission-63 cadence).

### Cross-question coherence (Round 1)

- Multi-pressure (Q1) + multi-audience (Q2) + big-bang (Q3) align internally → structural-inflection class
- Constraint envelope: solution must address all 3 pressures simultaneously (bundled shape) AND scale across 3 audiences (multi-target output) AND ship in single mission

**Tension flagged for Round 2:** which composition of idea-217's 5 candidates simultaneously satisfies (Q1 A+B+C) + (Q2 A+B+D) under (Q3 A)? Architect's hypothesis carry-forward: bundle option 3 (npm-publish) + option 1 or 2 (local-dev wrapper).

---

## §3 Round 2 — picks + interpretation

### Round 2 strategy chosen

Per `idea-survey.md` §4: Round 1 cleanly confirmed all 3 dimensions (no ambiguity); strategy = **refine deeper** — drill into HOW-shape composition + scope-coverage + anti-goals slate.

### Director picks

| Q | Picks | Type |
|---|---|---|
| Q4 (HOW-shape: solution-shape composition) | **A** | single pick |
| Q5 (Pass 10 mechanisation breadth) | **C** | single pick |
| Q6 (Anti-goals slate) | **B + C + D** | multi-pick (3 of 4); A INTENTIONALLY NOT picked |

**Q4 options:** A=Option 1 + Option 3 (script + npm-publish thin bundle); B=Option 2 + Option 3 (CLI + npm); C=Option 1 + 2 + 3 (full bundle); D=Option 3 only.

**Q5 options:** A=§B + §D only; B=§B + §D + cross-§ orchestration; C=§B + §D this mission + file separate idea for §A + §C orchestration; D=defer to Design phase.

**Q6 options:** A=NO `@ois/*` → `@apnex/*` namespace migration; B=NO Universal Adapter / ACP redesign; C=NO idea-102 Universal Port absorption; D=NO Hub-served adapter shape.

### Aggregate response surface (Round 2)

Director ratifies the **minimum-viable bundle** (script + npm-publish; no CLI middleware) under **split-scope discipline** (this mission = §B + §D consumer-side; §A + §C operator-side orchestration filed as separate idea — idea-221 created), with **3 of 4 anti-goals locked**. **Q6 A intentionally NOT picked** = the `@apnex/*` vs `@ois/*` namespace decision stays IN-SCOPE for Design-phase brainstorm rather than locked-out.

### Tele mapping refresh (Round 2)

- tele-2 Frictionless Agentic Collaboration — primary, REINFORCED (Q4 A thin bundle = lowest-friction surface)
- tele-7 Resilient Operations — primary, REINFORCED (Q5 C split-scope discipline reduces blast radius)
- tele-3 Absolute State Fidelity — secondary, REINFORCED (Q6 NOT-A keeps namespace coherence as a live Design question)
- tele-6 Deterministic Invincibility — secondary, retained
- tele-9 confirmed NOT activated (Q5 C confirms operator-side orchestration is separate concern via idea-221)

### Per-question interpretations

**Q4 (HOW-shape) — A: Option 1 + Option 3 thin bundle:**
Director picked the **thinnest bundle** that still satisfies all 3 pressures + 3 audiences. Local script (option 1) handles local-dev ergonomics (Q2 A); npm-publish (option 3) handles external + future-pool (Q2 B + D) + distribution channel (Q1 C); **script frontends npm** — single-source-of-truth for rebuild logic in the npm package; script provides ergonomic wrapper. Q4 B/C (CLI middleware variants) rejected — over-engineered. Q4 D (npm-only) rejected — local-dev wants script ergonomics.

**Minimum-viable bundle:** 2 outputs (1 script + 1 npm package family) covering 3 audiences via 1 mission ship.

**Q5 (Pass 10 mechanisation breadth) — C: split-scope discipline:**
Mechanise §B + §D this mission; file separate idea for §A + §C orchestration. **Split-into-2-missions pattern.** This mission = consumer-side adapter-update mechanism (§B SDK rebuild + §D claude-plugin reinstall). Future mission (idea-221, filed at Survey close) = operator-side cross-§ orchestration (§A Hub rebuild + §C state-migration + cross-§ sequencing).

Split-scope discipline matches Round 1 audience signal: this mission is for developer-equivalents (Q2 A+B+D); §A + §C are operator-side concerns (Hub-stopped operations) — those belong to a future operator-orchestration mission.

**Architect-derived deliverable (Survey-close):** ✅ filed idea-221 for Pass 10 cross-§ orchestration before Manifest.

**Q6 (anti-goals) — B+C+D locked; A intentionally NOT locked:**
3 of 4 anti-goals locked: NO Universal Adapter, NO Universal Port, NO Hub-served. **Q6 A intentionally NOT picked** — per `idea-survey.md` §7 contradictory-multi-pick handling, NOT picking a proposed anti-goal lock IS a signal: Director is communicating *"namespace question stays IN-SCOPE for Design-phase resolution."*

**Reading:** the npm-publish path requires a namespace; Director keeps the choice open for Design v0.1. Possible Design-phase outcomes:
- Keep `@ois/*` (current internal namespace; published under same)
- Move to `@apnex/*` (per `project_npm_namespace_apnex.md` Director-prior-preference signal)
- Hybrid (publish `@apnex/*` while keeping `@ois/*` as deprecated alias)

**Design-brainstorm anchor (carried forward per §7):** "what namespace ships?" — Phase 4 Design v0.1 must resolve.

### Cross-question coherence (Round 2)

- Q4 A (thin bundle) ↔ Q5 C (split scope) — consistent: both narrow mission scope
- Q4 A ↔ Q6 B+C+D — consistent: thin bundle rules out Universal Adapter / Port / Hub-served
- Q5 C ↔ Q6 B+C+D — consistent: split-scope + anti-goal locks both anchor narrow consumer-side framing
- Q4 A (Option 3 npm-publish) ↔ Q6 NOT-A — consistent + non-trivial: Option 3 requires namespace decision; Q6 NOT-A keeps that decision OPEN

### Cross-round coherence (Round 1 ↔ Round 2)

- Round 1 multi-pressure → Round 2 thin bundle addresses all 3: friction (script) + Pass-10 mechanisation (npm package) + distribution channel (npm publish itself)
- Round 1 multi-audience → Round 2 thin bundle covers all 3: script for local-dev; npm for external + future-pool
- Round 1 big-bang → Round 2 thin bundle ships in single mission cycle; split-scope keeps mission within sizing budget
- Round 1 NOT-D → Round 2 Q6 D lock makes the rejection explicit at anti-goal level

No internal tension; no contradictory multi-pick on mutually-exclusive Q. Round 2 cleanly anchors constraint envelope.

---

## §4 Composite intent envelope (the "solved matrix")

idea-217 ships as a **structural-inflection mission** ("M-Adapter-Streamline"; final naming at Manifest) delivering:

### In scope (substrate)

1. **Local update script** (option 1 from idea-217) — for local-dev consumers (Q2 A); ergonomic single-command frontend
2. **npm-published adapter packages** (option 3) — for external + future-pool consumers (Q2 B + D) + distribution channel (Q1 C)
3. **Pass 10 §B + §D mechanisation embedded in the npm package + script** (Q5 C narrow scope; calibration #25 root-cause class closed)
4. **Namespace decision** (Design-brainstorm anchor; Q6 NOT-A) — `@ois/*` vs `@apnex/*` vs hybrid; resolved at Phase 4 v0.1

### Anti-goals locked at Manifest

- ✗ Universal Adapter / ACP redesign integration (Q6 B locked)
- ✗ idea-102 Universal Port absorption (Q6 C locked)
- ✗ Hub-served adapter shape (Q6 D locked; option 5 ruled out)

### Out-of-scope but tracked (filed at Survey close)

- ✅ idea-221 created — Pass 10 cross-§ orchestration (operator-side §A + §C + cross-§ runner; future separate mission per Q5 C)

### Mission-class hypothesis (Manifest-time ratification)

**structural-inflection**, **M sizing** (~2-3 engineer-days; smaller than mission-63's L due to thin bundle + split scope).

### Substrate-self-dogfood discipline (Manifest-time decision)

Plausible W4 dogfood gate — use new script/npm-package to update adapter mid-mission (vs manual Pass 10 recipe). Architect-lean YES; defer ratification to Manifest per `feedback_substrate_self_dogfood_discipline.md`.

---

## §5 Calibration data point (Survey methodology)

| Metric | M-Adapter-Streamline | Comparison |
|---|---|---|
| Director time-cost | ~5-10 minutes (6 picks across 2 rounds + ratification) | vs mission-63 ~15-20 min full lifecycle (Survey was ~5 min subset) |
| Multi-pick observed | Q1: A+B+C; Q2: A+B+D; Q6: B+C+D | 3 of 6 questions multi-pick — high constraint-density signal |
| Contradictory multi-pick | None on mutually-exclusive Q | Q6 NOT-A is intentional non-pick (per §7); not contradictory |
| Bypass invoked | No | idea-217 is a Director-flagged Idea with broad scope; Survey appropriate |
| Architect-interpretation discipline | Per §3 §9: aggregate surface + per-Q loop with multi-dim context + anti-tele drift check + cross-Q coherence check | First canonical execution post-mission-63 (sharpened per Director correction at Round 1) |
| Architect Round 1 protocol error | Posted 6 questions instead of 3; missed §3 Step 1 round-discipline | Director-corrected; restarted properly. **Calibration:** future Survey openings should explicitly cite §3 Step 1 "Round 1 = 3 questions only" before drafting questions. |

### Methodology calibration surfaced this Survey

**Calibration #27 (NEW):** Survey artifact location preference — Director chose `docs/surveys/` over `idea-survey.md` v1.0 §5 default `docs/designs/<mission>-survey.md`. This is a doc-tree-organization refinement (separates Survey artifacts from Design artifacts at directory level for cleaner topology). Worth folding into `idea-survey.md` v1.1: update §5 to specify `docs/surveys/<mission>-survey.md` as canonical location.

---

## §6 Cross-references

- **Source Idea:** idea-217 (Streamline adapter compile/update/re-install for consumers)
- **Companion idea filed:** idea-221 (Pass 10 cross-§ orchestration; operator-side; Q5 C split-scope deliverable)
- **Methodology:** `docs/methodology/idea-survey.md` v1.0
- **Design v0.1:** `docs/designs/m-adapter-streamline-design.md` (architect-authored; ships bundled with Survey artifact in W0 PR)
- **Pass 10 protocol:** `docs/methodology/multi-agent-pr-workflow.md` §Adapter-restart rebuild protocol (just landed at mission-63 W5 PR #120)
- **calibration #25:** mission-63 W4 surfaced; Pass 10 §B SDK rebuild gap; closed by this mission's substrate
- **mission-63 W5 closing audit:** `docs/audits/m-wire-entity-convergence-w5-closing-audit.md`
- **Predecessor missions:** mission-62 (Layer-1+2+3 Hub/SDK/canonical-tree lessons); mission-61 (Layer-3 SDK-tgz-stale lesson; pulse-primitive surface closure)
- **Memory referenced:** `project_npm_namespace_apnex.md` (Director-prior-preference signal on namespace; Q6 NOT-A activation)

---

*Survey v1.0; Director-ratified 2026-04-28 ~07:00Z; Phase 4 Design v0.1 architect-draft begins next. Architect: lily.*
