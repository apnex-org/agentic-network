# Phase 1 Cartography — Architect's Tele-Alignment Critique (Pass 1)

**Status:** DRAFT — engineer-apply-ready; awaits Director ratification
**Author:** lily (architect, eng-40903c59d19f), 2026-04-22 AEST
**Responds to:** `docs/reviews/2026-04-phase-1-cartography.md` (engineer Pass 1, commit `6721ba3` on agent/greg)
**Source:** thread-248 (correlationId `2026-04-architectural-review`)
**Plan reference:** `docs/reviews/2026-04-architectural-review.md` §Phase 1

---

## 0. Scope confirmation (answers to greg's Q1 + Q3)

**Q1 — Tele-rewrite remap authority.** Confirmed: the architect owns the canonical remap. This doc provides it. Engineer deferral in Pass 1 §4.1 option (b) was the right call — heuristic remap by the drafter would have anchored my read. Pass 1's explicit ambiguity register (§0 caveat + per-cluster `(b) LIKELY MISALIGNED` callouts) is the correct shape of deferral.

**Q3 — Reverse-gap flag bar.** Confirmed: "zero forward-motion ideas attributable in the new numbering" is the right bar. tele-0 (umbrella) is definitionally empty, not a reverse-gap. tele-8 is the only genuine reverse-gap after my remap — see §4.

Out-of-scope noted per Director feedback: mission-numbering chaos (Pass 1 §4.2), Phase-2x measurement-thread reaping (§4.5). Both flagged for post-review hardening; not this Phase 1 concern.

---

## 1. Authoritative old→new tele remap

Derived from `docs/specs/teles.md` §Provenance. Pre-reset had 9 teles numbered 1–9. Post-reset has 11 teles numbered 0–10. The mapping:

| Old tele (pre-reset) | Old name | New tele | New name | Fidelity |
|---|---|---|---|---|
| 1 | (persistence, narrow) | **1** | Sovereign State Transparency | evolved-broader (absorbs AX-010 State Sovereignty) |
| 2 | Frictionless Agentic Collaboration | **6** | Frictionless Agentic Collaboration | name preserved; ID changed |
| 3 | (workflow/FSM aspect) | **2** | Isomorphic Specification | merged (FSM aspect of old tele-3 absorbed by new tele-2) |
| 4 | Resilient Agentic Operations | **7** | Resilient Agentic Operations | name preserved; ID changed |
| 5 | (Declarative Primacy) | **2** | Isomorphic Specification | merged (absorbs AX-050 Declarative Primacy) |
| 6 | Deterministic Invincibility | **9** | Chaos-Validated Deployment | chaos-aspect only; layered aspect dropped |
| 7 | Perfect Contextual Hydration | **5** | Perceptual Parity | evolved-broader (absorbs AX-040 Observability Symmetry) |
| 8 | Autopoietic Evolution | **10** | Autopoietic Evolution | name preserved; ID changed |
| 9 | (umbrella) | **0** | Sovereign Intelligence Engine | renamed + repositioned as umbrella |

**New teles with no pre-reset predecessor** (ideas must be placed by body, not remapped):
- **tele-3** Sovereign Composition (from idea-148 + AX-020 Interface Singularity)
- **tele-4** Zero-Loss Knowledge (from AX-030 Knowledge Fidelity)
- **tele-8** Gated Recursive Integrity (from AX-060 Recursive Integrity, layered-construction aspect only)

**Correction to greg's Pass 1 §0 table:** greg's table lists "(none) → new tele-3" (correct), "(none) → new tele-4" (correct), "(none) → new tele-8" (correct). But in §2 greg's "old tele-9 was Determinism" prose is incorrect — old tele-9 was the umbrella per the spec, not Determinism. Pre-reset tele-6 was "Deterministic Invincibility" (split to new tele-8 + tele-9).

---

## 2. Ideas with `audit:tele_primary=tele-N` — authoritative remap

### 2.1 Mechanical remap (unambiguous by spec map)

Apply these tag-flips directly during revision. Format: `idea-X: old tele-N → new tele-M` (with secondary tele where supported by idea body / audit tags).

**old tele-1 → new tele-1** (scope broadened; stays):
- idea-39 → **new tele-1** primary
- idea-97 → **new tele-1** primary (ADR-017 comms-reliability + durability)

**old tele-2 → new tele-6** (Frictionless):
- idea-20 → **new tele-6** primary; tele-3 secondary (auto-linkage is a composition concern)
- idea-25 → **new tele-6** primary; tele-2 secondary (Routine as Isomorphic spec consumer)
- idea-30 → **new tele-2** primary, tele-6 secondary (task-FSM workflow-registry is pure Isomorphic)
- idea-50 → **new tele-3** primary (tx/rx dedup is composition), tele-6 secondary
- idea-68 → **new tele-6** primary (update_task lifecycle friction)
- idea-73 → **new tele-6** primary (generalized routing = zero-friction multi-agent)
- idea-79 → **new tele-3** primary (JSON-schema architecture = composition layer)
- idea-90 → **new tele-2** primary (Threads 2.0 anycast spec)
- idea-91 → **new tele-2** primary (multicast dynamic-membership spec)
- idea-92 → **new tele-2** primary (multicast open-dispatch spec)

**old tele-3 → new tele-2** (FSM merged) OR **new tele-3** (if body is about modularity):
- idea-24 → **new tele-2** primary (role/RBAC workflow-registry = Isomorphic)
- idea-46 → **new tele-1** primary (M18 advisory-tags observability); tele-3 secondary
- idea-60 → **new tele-1** primary (structured telemetry observability)
- idea-63 → **new tele-1** primary (agent session-table observability)
- idea-94 → **new tele-7** primary (cascade replay-queue resilience); tele-3 secondary
- idea-95 → **new tele-3** primary (cross-action deps = composition); tele-7 secondary
- idea-103 → **new tele-3** primary (Zod-strict is contract purity)

**old tele-4 → new tele-7** (Resilient):
- idea-6 → **new tele-7** primary (task reassign/timeout)
- idea-15 → **new tele-7** primary (architect session-management resilience)
- idea-18 → **new tele-7** primary (SDK performance/tech-debt in resilience layer)
- idea-33 → **new tele-7** primary (state-machine auto-triage)
- idea-54 → **new tele-7** primary (architect-chat resilience)
- idea-55 → **new tele-9** primary (Terraform IaC = deployment = Chaos-Validated); tele-7 secondary
- idea-74 → **new tele-9** primary (terraform env-isolation = deployment)
- idea-78 → **new tele-6** primary (admin force-close = operator affordance); tele-7 secondary
- idea-93 → **new tele-7** primary (deferred-queue hardening)
- idea-96 → **new tele-7** primary (cascade-failed recovery)
- idea-98 → **new tele-7** primary (routing-modes hardening)
- idea-99 → **new tele-7** primary (dispatch hardening)
- idea-105 → **new tele-7** primary (watchdog SLA tuning)
- idea-106 → **new tele-7** primary (Agent.status deprecation + wakeEndpoint)

**old tele-5 → new tele-2** (Isomorphic):
- idea-48 → **new tele-3** primary (tx/rx dedup network-adapter = composition); tele-2 secondary
- idea-66 → **new tele-2** primary (wire-level event-schema renaming)
- idea-69 → **new tele-2** primary (tool-surface MCP standardization)
- idea-80 → **new tele-4** primary (tags-vs-labels metadata clarity = Knowledge Fidelity); tele-2 secondary
- idea-81 → **new tele-4** primary (correlation-id typed-refs = Knowledge Fidelity)
- idea-82 → **new tele-3** primary (BaseEntity turnId refactor = composition); tele-2 secondary
- idea-83 → **new tele-4** primary (status-vs-state terminology)
- idea-85 → **new tele-4** primary (naming-standardization cleanup)
- idea-102 → **new tele-3** primary (Universal Port = composition layer); tele-2 secondary

**old tele-7 → new tele-5** (Perceptual Parity):
- idea-11 → **new tele-4** primary (Wisdom/Context Management = Knowledge Fidelity); tele-5 secondary
- idea-13 → **new tele-5** primary (code-visibility tooling = parity)
- idea-35 → **new tele-5** primary (architect-prompt hardening = hydration)
- idea-45 → **new tele-5** primary (tooling observability DX)
- idea-56 → **new tele-5** primary (thread-guidance system-prompt)
- idea-58 → **new tele-5** primary (plugin notifications)
- idea-61 → **new tele-5** primary (architect-chat ACP/TUI)
- idea-64 → **new tele-4** primary (lightweight note entity = Knowledge); tele-5 secondary
- idea-65 → **new tele-4** primary (beacon entity = research knowledge)
- idea-70 → **new tele-5** primary (list-filter ergonomics)
- idea-72 → **new tele-5** primary (on-demand context retrieval = hydration)

**old tele-8 → new tele-10** (Autopoietic):
- idea-14 → **new tele-10** primary (auto-triage resilience)

**old tele-9 ideas (greg's "new tele-9 cluster (b) audit signal")** — per spec, old tele-9 was the umbrella → new tele-0. But umbrella-placement is usually wrong; individual body read required:
- idea-5 → **new tele-5** primary (frontend UX ag-ui = Perceptual Parity); tele-6 secondary
- idea-23 → **new tele-9** primary (CI/GitHub = Chaos-Validated Deployment)
- idea-27 → **new tele-2** primary (workflow-registry kubernetes-analogy = Isomorphic)
- idea-43 → **new tele-3** primary (capability/network-expansion = composition)
- idea-62 → **new tele-5** primary (architect-chat external UI = Perceptual Parity)
- idea-67 → **new tele-6** primary (identity/GitHub attribution = frictionless collaboration)
- idea-71 → **new tele-3** primary (gemini-cli adapter = composition); tele-6 secondary
- idea-84 → **new tele-3** primary (cognitive-architecture network-adapter = composition); tele-5 secondary
- idea-86 → **new tele-5** primary (director integration = Perceptual Parity)

### 2.2 Net effect of remap

After applying §2.1, greg's Pass 1 per-tele cluster sizes become:

| Tele | Pass 1 size | Post-remap size | Change |
|---|---|---|---|
| tele-0 | 0 | 0 | unchanged (umbrella, expected empty) |
| tele-1 | 4 | ~8 | +4 (absorbed old tele-3 observability ideas) |
| tele-2 | 19 | ~12 | -7 (frictionless ideas moved to tele-6; gained from old tele-5 Isomorphic + FSM-aspect ideas) |
| tele-3 | 11 | ~18 | +7 (absorbed composition ideas from old tele-2/5/9) |
| tele-4 | 16 | ~10 | -6 (Resilient ideas moved to tele-7; absorbed Knowledge Fidelity from old tele-5) |
| tele-5 | 11 | ~14 | +3 (absorbed Hydration ideas from old tele-7 + tele-9) |
| tele-6 | 3 | ~11 | +8 (absorbed Frictionless from old tele-2 + operator affordances) |
| tele-7 | 13 | ~20 | +7 (absorbed Resilient from old tele-4 + cascade replay-queue) |
| tele-8 | 0 | **0** | **unchanged — REVERSE-GAP confirmed** |
| tele-9 | 16 | ~6 | -10 (most "new tele-9" ideas were old tele-9 umbrella; only idea-23/55/74 are actual CI/Chaos/Deployment) |
| tele-10 | 4 | ~5 | +1 (from old tele-8 Autopoietic) |

Totals: ~104 ideas placed; 33 orphans to place in §3; ~18 ideas still in `dismissed` status (not clustered per scope).

---

## 3. Orphan placement (33 ideas)

### 3.1 Dismiss — bug-migration legacy (9 ideas)

Confirmed: original "bug" Ideas migrated to first-class Bug entities; scope now lives in linked Bug record. Dismiss all 9 (they carry `migrated-to-bug-N` tags explicitly):

- idea-19 → DISMISS (→ bug-1)
- idea-22 → DISMISS (→ bug-2)
- idea-28 → DISMISS (→ bug-3)
- idea-29 → DISMISS (→ bug-4)
- idea-40 → DISMISS (→ bug-5)
- idea-41 → DISMISS (→ bug-6)
- idea-57 → DISMISS (→ bug-7)
- idea-88 → DISMISS (→ bug-8)
- idea-89 → DISMISS (→ bug-9)

Use `audit:valid=superseded-by-bug` + status flip. Greg can batch these with a single status update per idea.

### 3.2 Place (24 ideas)

Derived from idea tags + title patterns. `P=primary`, `S=secondary`.

**Ideas 115–128 (M-Cognitive-Hypervisor / vocabulary / strategic cluster):**
- idea-115 (dynamic-tool-scope) → **P tele-3** (composition), **S tele-5** (perceptual parity — scoped tool surface reduces hallucinated-surface noise)
- idea-117 (retry-death-spiral queue) → **P tele-7** (resilient ops)
- idea-118 (circuit-breaker queue) → **P tele-7**
- idea-119 (query-shape-engineering tool-surface) → **P tele-5** (prompt-side hydration), **S tele-2** (isomorphic query surface)
- idea-122 (`reset_agent` operator affordance) → **P tele-6** (frictionless operator action), **S tele-7** (state recovery)
- idea-123 (thread-reply protocol simplification) → **P tele-2** (isomorphic protocol)
- idea-124 (label-routing / reserved-labels / VRF) → **P tele-2** (routing-layer isomorphism), **S tele-6**
- idea-125 (clarification primitives ADR-017) → **P tele-2** (protocol primitives), **S tele-6**
- idea-126 (Kubernetes entity-model long-term strategic) → **P tele-2** (k8s-style CRD is the ratified direction)
- idea-127 (threads-2.0 semantic-intent mechanism) → **P tele-2** (mechanism-design), **S tele-6**
- idea-128 (gitops multi-agent concurrent-engineers) → **P tele-9** (deployment / coordination), **S tele-6**

**Ideas 129–143 (vocabulary chain cluster):**
- idea-129 (Design entity) → **P tele-2** (Manifest/Isomorphic), **S tele-4** (knowledge fidelity)
- idea-130 (Manifest entity) → **P tele-2** (explicitly "Manifest is the Master"), **S tele-3**
- idea-131 (Registry entity) → **P tele-1** (state transparency), **S tele-5** (discoverability)
- idea-132 (triaged; incorporated into mission-38) → **P tele-7** (cognitive-layer resilience). Retain open status or reclass `incorporated`? Engineer call during revision.
- idea-133 (Concept entity) → **P tele-4** (Zero-Loss Knowledge — concepts ARE the knowledge vocabulary), **S tele-10** (autopoietic — concepts feed self-refinement)
- idea-134 (Trace + Report entity) → **P tele-4** (bit-perfect fidelity of execution history), **S tele-10**
- idea-135 (Survey entity) → **P tele-4** (structured input), **S tele-6** (pre-brainstorm frictionless)
- idea-136 (Routine entity) → **P tele-2** (scheduled governance = spec-driven), **S tele-10** (autopoietic maintenance)
- idea-137 (Evaluation framework) → **P tele-10** (autopoietic — evaluation feeds refinement), **S tele-4**
- idea-138 (Cost-aware tier routing) → **P tele-6** (economic optimization of collaboration), **S tele-7**
- idea-139 (Goal entity) → **P tele-4** (project-scope knowledge), **S tele-2** (goal-tele bridge)
- idea-140–143 (concept-candidates harvested from 139) → **P tele-4** (vocabulary expansion), **S tele-10**. These are concept seeds; batch the same assignment.

**Ideas 144–155 (post-mission-40 follow-ups + strategic target-state):**
- idea-144 (workflow engine review→next-task advancement) → **P tele-6** (frictionless mission advancement), **S tele-2** (Hub workflow primitives)
- idea-145 (chunked-reply v2) → **P tele-7** (resilience follow-up)
- idea-146 (continuation v2) → **P tele-7**
- idea-147 (Rule entity — project policy layer) → **P tele-2** (explicit policy = isomorphic spec), **S tele-4**
- idea-148 (Sovereign Composition source idea, landed as tele-3) → **P tele-3** (this IS the tele-3 origin artifact)
- idea-149 (tele audit ratification artifact) → **P tele-4** (this IS the Zero-Loss Knowledge artifact applied to the constitutional layer), **S tele-10** (autopoietic constitutional refinement)
- idea-150 (Environment Deployer CI/CD GCP) → **P tele-9** (deployment), **S tele-6**
- idea-151 (Graph relationships registry) → **P tele-1** (structured state topology), **S tele-4** (knowledge graph)
- idea-152 (Smart NIC Adapter target-state) → **P tele-3** (composition layer replacing adapter + transport), **S tele-1** (state transparency); also tele-7 tertiary
- idea-153 (adapter-core refactor) → **P tele-3** (composition)
- idea-154 (wrapper-script `OIS_EAGER_SESSION_CLAIM` durable surface) → **P tele-1** (observable deployment state), **S tele-7** (operator onboarding)
- idea-155 (AuditEntry typed payload) → **P tele-1** (structured state fidelity), **S tele-4** (knowledge integrity)

---

## 4. Reverse-gap confirmation + seed proposals

### 4.1 tele-0 (Sovereign Intelligence Engine umbrella)

**Not a reverse-gap.** Umbrella by definition; composition of tele-1..tele-10 IS forward-motion toward tele-0. No direct ideas expected. Mark in cartography as "umbrella — aggregates below".

### 4.2 tele-8 (Gated Recursive Integrity)

**Confirmed reverse-gap.** After full remap + orphan placement, zero forward-motion ideas attributable. The tele's Mandate (layered integrity, binary pass/fail gates, no partial-credit ascension) has no champion in the current backlog.

**Proposed seed ideas (Phase 4 mission-candidate territory, flagged here for reverse-gap closure):**

1. **Layer-certification registry.** Formal enumeration of architectural layers (L0 Hub protocol / L1 entity-registry / L2 policy-router / L3 threads+cascade / L4 cognitive-layer / L5 adapter) with per-layer pass/fail gate + known-good commit. Closes the "Foundation-of-Sand" fault; makes the "Law of Fallback" actionable.
2. **Binary certification for Phase-2d CP3 reaper+lifecycle.** Existing work toward it; naming it as tele-8-aligned makes the gate explicit.
3. **Merge-gate automation: no Layer N+1 change without Layer N green.** Codify as CI policy + review checklist.

These aren't mission briefs yet — just seed ideas so tele-8 has ≥1 attributed forward-motion item before Phase 4 prioritization. Engineer should file as Ideas during revision (3 separate, or 1 umbrella). Filing them in my name (architect-authored) is the cleanest provenance.

### 4.3 Other teles

All others populated after remap. tele-4 (Zero-Loss Knowledge) absorbs the largest pull from vocabulary-chain orphans — consistent with the ratified direction.

---

## 5. Built / Ratified-but-unshipped / Open split (deeper)

Extension of greg's §4.4 sketch. Evidence in parentheses; missions + commits cited where applicable.

### 5.1 BUILT (in-prod, tests green, deployed)

| Direction | Evidence | Bugs/gaps |
|---|---|---|
| Threads 2.0 (ADR-013/014) | mission-22, mission-23, mission-24 shipped; Phase 2 cascade runner landed | bug-23 (bilateral-seal race, minor) |
| ADR-017 comms-reliability (queue + persist-first) | `074b6c1`..`316baa8` + follow-ups; mission-30 ran against it | bug-11 (cognitive-layer silence; distinct scope), bug-22 (continuation retry), bug-12 (test-helper drift) |
| Identity layer (Mission-18 + Mission-19 + bug-16 reaper + mission-40 identity/session split) | mission-40 closed 2026-04-22 (commits `18cde2d`..`e2ce3f8`); bug-16 resolved (`9385290`, `6eacfca`); bug-26 resolved | Zero open identity-layer bugs at severity≥major |
| Cognitive Layer Phase 1 (ADR-018 / `@ois/cognitive-layer` package) | Phase 1 ckpt 1–4 landed; `ToolResultCache` + `FlushAllOnWriteStrategy` shipping | mission-31/32/33/34 duplicates as design-entity artifacts only |
| Cognitive Hypervisor adapter mitigations (mission-38) | Completed 2026-04-21, 5-task scope + closing audit | bug-11 verdict pending 24–48h observability window |
| Mission-19 Granular Routing (label-selector routing) | mission-18 entity = "Mission-19 Granular Routing" (7 tasks shipped) | none known |
| Tele rewrite (idea-149 ratification) | 11 teles in GCS at tele-0..tele-10; spec at `docs/specs/teles.md` | bug-24 blocks retirement of 5 legacy tele records (additive overwrite was the workaround) |
| Workflow-registry v2.0 | Multiple FSM tables + INV-TH# invariants; shipped across multiple missions | Partial (some FSMs still documented-only; entity-registry §5 Wall-of-Shame enumerates) |
| M-Cascade-Perfection Phase 1 + 2 | mission-29 + Phase 2d CP1/CP2/CP3 shipped | CP4 (`retry_cascade`) deferred; bug-14/15/bug-27 minor cascade drift |

### 5.2 RATIFIED-but-unshipped (Director-approved direction; code not yet in-prod)

| Direction | Status | Gating |
|---|---|---|
| Vocabulary chain (Concept→Idea→Design→Manifest→Mission→Trace→Report) | Ratified 2026-04-21; ideas 129–143 filed | No entity implementation started; no mission brief; Phase 4 candidate |
| Goal entity (idea-139) | Ratified scope 2026-04-21 | Filing as Hub primitive pending |
| k8s-style API as target tool-surface (review input §14.1) | Ratified direction per review plan §"Ratified directions" | Post-review mission scope (anti-goal §1); idea-121 + idea-126 carry candidate spec |
| Mission-19 P2P agentId targeting (in-Mission-19 scope, deferred sub-scope) | Ratified but implementation pending | Mission-19's task-197 range |
| Multi-engineer concurrent REPO work protocol | Identified problem per review plan §Ratified-directions item 6 | Candidate mission output, not review work |
| Deprecation of mission-40's back-compat auto-claim paths (brief §10.1) | Gated on deprecation-runway dashboard zero-trend | Post-architectural-review hardening |
| `AuditEntry` typed payload (idea-155) | Filed post-mission-40 | Gated on dashboard-consumer maturity |

### 5.3 OPEN (not yet ratified direction OR target-state architecture)

| Direction | Status | Notes |
|---|---|---|
| Smart NIC Adapter (idea-152) | Open target-state | Absorbs identity + transport; would supersede idea-153 (adapter-core) |
| Rule entity (idea-147) | Open | Project-level policy/convention layer; awaits triage |
| Graph relationships registry (idea-151) | Open | Hub primitive for idea-dependency graphs |
| Environment Deployer (idea-150) | Open | CI/CD GCP deployer tooling |
| Universal Port (idea-102) | Open | Supersedes idea-17 (dismissed) |
| Adapter-core extraction (idea-153) | Open | Transitional vs idea-152 target-state; explicitly noted as superseded-by-idea-152 in its body |
| Director-chat redesign | Pending architect-adapter redesign (my memory refs this) | No mission yet |
| Wrapper-script tracking (idea-154) | Open post-mission-40 | Small cleanup; hub-config.json candidate |

---

## 6. Answers to greg's Q2 + Q4 + Q5 (Director-directed)

**Q2 — Mission-numbering cleanup:** Out of Phase 1 scope. File as post-review hardening item after Phase 4 closes. Not an anti-goal exception (review didn't introduce it — it's pre-existing churn).

**Q4 — Phase 2x measurement-thread reaping (16 stuck threads):** Defer to post-hardening. Sweeping mid-review violates review anti-goal §6 ("no opportunistic mid-review missions"). Flag in the cartography artifact's §4.5 as-is; Phase 4 can include a candidate "thread-reaper operational audit" mission brief if cleanup scope warrants.

**Q5 — Pass 1 sufficiency:** Pass 1 shape is good; do NOT attempt heuristic remap before architect critique (which is THIS). Pass 1 correctly handed the remap to me.

---

## 7. Summary for engineer revision

What greg applies in the Pass 1 → Pass 1.1 revision:

1. **Apply §2.1 tag-flips**: batch `update_idea` calls to replace `audit:tele_primary=tele-N` with new-numbering assignments per the table. Preserve the `audit:tele_primary=` prefix. Add `audit:tele_secondary=` where §2 specifies.
2. **Apply §3.1 dismissals**: 9 bug-migration legacy ideas → `status: dismissed` + `audit:valid=superseded-by-bug` tag.
3. **Apply §3.2 orphan placements**: 24 orphan ideas gain `audit:tele_primary=tele-N` (+ optional `audit:tele_secondary=tele-M`).
4. **File 3 seed ideas for tele-8** per §4.2.1–4.2.3 (or 1 umbrella idea with 3 sub-items; engineer call).
5. **Replace §4.4 Built/Ratified/Open sketch** with §5 of this critique (3 sub-tables).
6. **Update §0 caveat prose** to reflect: remap now authoritative (cite this critique doc); old-tele-9 is umbrella, not "Determinism".
7. **Update §5 convergence-criteria self-check:** all three criteria pass after revision (every open idea in ≥1 cluster via §2+§3; tele-8 flagged reverse-gap with §4.2 rationale; Built/Ratified/Open per §5).

**Pass 1.1 goes to Director** for ratification per brief §11 step 4. My critique is complete for this round.

---

## 8. Scope boundaries of this critique

**In scope:**
- Old→new tele remap (§1, §2.1)
- Orphan placement (§3)
- Reverse-gap identification + seed proposal (§4)
- Built/Ratified/Open deeper split (§5)
- Answers to Director open-loop questions (§6)

**NOT in scope (deferred / out-of-phase):**
- Per-idea bodies for ideas-not-yet-triaged — relied on tags + titles for placements; any miscall is greg's call to flag during revision
- Mission-numbering cleanup (Q2 — post-review hardening)
- Thread reaper (Q4 — post-review hardening)
- Phase 2 Friction Cartography scope (next phase)
- Phase 3 Concept + Defect extraction (next-next phase)

---

*End of Pass 1 critique. Engineer revision + Director ratification expected next. Convergence not expected in the thread round; thread stays open for engineer pushback on specific assignments if any.*

---

## 9. Addendum — `tele-11 Cognitive Minimalism` filed 2026-04-22 AEST (post-convergence)

**Status of this addendum:** Appended 2026-04-22 AEST after thread-248 converged. Director directed filing of a new tele during Phase 1 (explicit exception to review anti-goal §7 "Modifying the ratified Tele set"); tele-11 now exists in Hub + spec. This addendum updates the Pass 1 critique's assignments to reflect the new tele. Supersedes specific primary-tele assignments in §2.1 and §3.2 where the idea body maps more cleanly to tele-11 than to the originally-assigned tele.

### 9.1 Cluster impact — tele-11 is populated at birth, not a reverse-gap

After applying §9.2 + §9.3 below, tele-11 cluster size: **4 primary + ~8 secondary = ~12 ideas**. Viable cluster; not a reverse-gap. tele-8 Gated Recursive Integrity remains the only reverse-gap per §4.2.

### 9.2 Primary-tele reassignments (move out of prior tele into tele-11)

Apply during Pass 1.1 revision. These are the ideas whose body most tightly maps to tele-11's mandate ("LLM tokens as scarce economic resource; offload deterministic work to substrate"). The original tele now becomes secondary where applicable:

- **idea-107** (M-Cognitive-Hypervisor umbrella) — was §2.1 tele-6 primary (post-remap). **NEW: tele-11 primary, tele-6 secondary.** Body is explicitly "cognitive hypervisor shields agent responses from LLM-infrastructure faults" with 4 phases of substrate offload — archetypal tele-11.
- **idea-115** (dynamic tool scope) — was §3.2 tele-3 primary. **NEW: tele-11 primary, tele-3 secondary.** Body is about reducing tool-surface exposure to the LLM to cut token cost + hallucination surface.
- **idea-119** (query-shape-engineering) — was §3.2 tele-5 primary. **NEW: tele-11 primary, tele-5 secondary.** Body is about efficient Hub query surfaces reducing LLM rounds-per-decision.
- **idea-138** (cost-aware tier routing) — was §3.2 tele-6 primary. **NEW: tele-11 primary, tele-6 secondary.** Body is explicitly "economic optimization" + cross-tier cognition routing.

### 9.3 Secondary-tele additions (tele-11 as secondary; primary unchanged)

These ideas stay on their primary tele per §2.1/§3.2 but gain `audit:tele_secondary=tele-11`:

- **idea-72** (on-demand context retrieval) — primary tele-5; secondary **+tele-11** (hydration-as-offload exemplar).
- **idea-79** (JSON-schema gemini tech-debt) — primary tele-3; secondary **+tele-11** (schema drift in substrate = cognitive-layer leak).
- **idea-108** (Hub-as-conductor) — primary tele-2 (or tele-6 if Director prefers frictionless framing); secondary **+tele-11** (Hub drives work = substrate offload).
- **idea-109** (429 backpressure) — primary tele-7; secondary **+tele-11** (substrate handles quota so LLM doesn't waste calls).
- **idea-110** (structural invariant enforcement) — primary tele-6; secondary **+tele-11** (substrate enforces invariants = offload).
- **idea-113** (cascade-actions schema-drift Zod) — primary tele-3; secondary **+tele-11** (schema-drift-in-substrate prevents LLM re-learning shapes).
- **idea-114** (state-sync drift-reconciliation) — primary tele-7; secondary **+tele-11** (state reconciliation in substrate reduces LLM burden).
- **idea-145** (chunked reply v2) — primary tele-7; secondary **+tele-11** (efficient composition reduces LLM rounds).
- **idea-146** (continuation v2) — primary tele-7; secondary **+tele-11** (graceful exhaustion as substrate primitive).

### 9.4 Revised engineer apply-list (supersedes §7 step for `audit:tele_secondary` application)

Greg's Pass 1.1 revision should now execute §7 steps 2-7 **with** the §9.2 reassignments applied (4 ideas change primary) and §9.3 additions (9 ideas gain tele-11 secondary). Net effect: ~13 ideas touched beyond the Pass 1 critique's original assignment set.

### 9.5 teles.md update

`docs/specs/teles.md` updated 2026-04-22 AEST in the same commit as this addendum: full § Tele #11 section inserted, Provenance table extended, Coordination artifacts note added, Hub-state parity counts revised. See commit message for scope.

### 9.6 Review anti-goal §7 exception — provenance note for Phase 4 retrospective

When the 2026-04 review retrospective triggers (first ratified mission ships), document this exception: Director direction to file tele-11 mid-review was made after the architect diagnostic showed tele-6/3/2/5 covered cognitive offload only compositionally, no single tele carried "LLM tokens as scarce economic resource" as first-class mandate. Rather than wait for post-review (delaying the naming + risking the principle staying implicit through another review cycle), the exception was granted. Methodology retrospective should evaluate whether this was the right call or whether the methodology should explicitly allow "tele addition via Director exception" as a formal protocol versus an ad-hoc variance.

---

*End of §9 addendum. tele-11 implications folded into Pass 1.2 (applied by engineer in commit `fae6ef8`, bilaterally accepted on thread-249).*

---

## 10. Addendum 2 — `tele-12 Precision Context Engineering` filed 2026-04-22 AEST (same-day re-refinement)

**Status of this addendum:** Appended 2026-04-22 AEST, later the same day as §9. Director probe "Are you sure Cognitive Minimalism is the same as Precision Engineered Context?" surfaced a conceptual distinction the architect had conflated when accepting engineer's idea-116 promotion to tele-11 primary in §9.2. Architect re-examined: tele-11 covers the **extensive margin** (whether to invoke LLM at all; substrate-vs-LLM work allocation); **Precision Context Engineering** covers the **intensive margin** (given invocation, how efficient is the context). Distinct mandates → distinct teles. tele-12 filed per Director direction as a second anti-goal §7 exception the same day.

### 10.1 tele-12 exists

- **Hub:** `tele-12 Precision Context Engineering` via `create_tele` MCP tool (standard path, same as tele-11)
- **Spec:** `docs/specs/teles.md` updated in the same commit as this addendum

### 10.2 idea-116 primary reassignment (supersedes §9.2 for this idea only)

**idea-116** (originally titled "Proposed tele-10 — Precision Context Engineering") — was §9.2 tele-11 primary + tele-10 secondary. **NEW: tele-12 primary, tele-11 secondary, tele-10 tertiary.**

Rationale:
- tele-12 primary — idea-116's body is literally the intellectual ancestor of tele-12 (Virtual Tokens Saved, bounded accumulation, Precision Context Engineering as named concept). Filing tele-12 *delivers* what idea-116 was proposing. This is the tightest possible alignment.
- tele-11 secondary — idea-116's precision-engineering-mechanisms still serve tele-11's economic mandate (maximally-efficient invocations support minimum-invocation-count).
- tele-10 tertiary — retains the autopoietic-ancestor linkage greg established in Pass 1.2 (idea-116 was proposing a tele; engineer-identified as archetypal autopoietic constitutional refinement).

### 10.3 Adjacent candidates for tele-12 (optional Pass 1.3 polish — architect recommendation; Pass 1.2 assignments remain valid)

The following ideas were tele-11 primary in §9.2 or tele-11 secondary in §9.3. With tele-12 now existing, tele-12 is the *more precise* primary — but tele-11 is *defensible* (not wrong, just not tightest). Architect recommends reassignment in Pass 1.3 polish; leaving as-is is acceptable if Director prefers minimal churn:

| Idea | §9 assignment | Tightest post-tele-12 | Rationale |
|---|---|---|---|
| idea-119 (query-shape-engineering) | §9.2 tele-11 primary | **tele-12 primary** + tele-11 secondary | "query-shape engineering" literally names tele-12's mandate; tele-11 was an over-reach |
| idea-72 (on-demand context retrieval) | §9.3 tele-11 secondary (primary tele-5 from §3.2) | **tele-12 primary** + tele-5 secondary | On-demand retrieval IS precision context engineering; the structural fit is exact |
| idea-145 (chunked-reply v2) | §9.3 tele-11 secondary (primary tele-7) | **tele-12 primary** + tele-7 secondary | Chunked-reply IS the "Capped Per-Response Size" mechanism in tele-12's spec |
| idea-146 (continuation-state v2) | §9.3 tele-11 secondary (primary tele-7) | **tele-12 primary** + tele-7 secondary | Continuation-state IS the "Bounded Accumulation / Capped Per-Response Size" overflow-handling primitive |

**Architect does NOT unilaterally reassign these.** Pass 1.2 assignments stand; Director may direct Pass 1.3 polish at ratification time. Rationale: scope discipline — user direction was narrow (file tele-12 + reassign idea-116 per option 1); these four ideas are adjacent but not-in-scope for this architect action.

### 10.4 Remaining §9.3 secondary adds — keep as tele-11 secondary

The following §9.3 secondary-only ideas stay on tele-11 secondary (Pass 1.2 current state is correct):
- idea-79, 108, 109, 110, 113, 114 — all are substrate-offload ideas (extensive margin); tele-11 secondary is the tightest fit. No tele-12 secondary add recommended unless the idea's body is also context-shape-oriented (none of these six are, by my read).

### 10.5 Cluster sizes after this addendum (Pass 1.2 state + idea-116 reassignment only)

- **tele-11 cluster (minimum Pass 1.3 state):** 4 primary (107, 115, 138, + whichever of 119/145/146 Director leaves at tele-11 primary if reassignment not done) + 9 secondary (including idea-116 as new secondary, and idea-119 if primary reassigned)
- **tele-12 cluster (minimum Pass 1.3 state):** 1 primary (idea-116 only, if architect recommendation §10.3 is NOT applied) OR 5 primary (if §10.3 is applied: idea-116, 119, 72, 145, 146) + 0-1 secondary depending
- **tele-8:** still only reverse-gap (unchanged by tele-12 filing)

### 10.6 Revised engineer apply-list — incremental over Pass 1.2

Greg's Pass 1.3 (if Director directs) executes:

1. Apply §10.2: one `update_idea` call for idea-116 — flip `audit:tele_primary=tele-11` → `tele-12`; `audit:tele_secondary=tele-10` → `tele-11`; add new `audit:tele_tertiary=tele-10` (or drop tertiary and keep secondary=tele-11 only; tagging-policy call).
2. **Optional (§10.3):** four additional `update_idea` calls for ideas 119, 72, 145, 146 per the table.
3. Update Pass 1.2's §9 table to reflect §10 amendments.

If Director skips Pass 1.3 entirely, the only necessary mechanical change is §10.2 (idea-116 single update); Pass 1.2 is otherwise ratification-ready.

### 10.7 Provenance note for Phase 4 retrospective

A second tele exception on the same day as the first is unusual. Retrospective should evaluate:
- Did the tele-11 + tele-12 distinction need to exist at constitutional level, or would Concept-level naming have sufficed?
- Does the methodology benefit from allowing same-day architect reconsideration of a just-filed tele?
- Is there a procedural filter that would have surfaced the extensive/intensive margin distinction before tele-11 was filed, saving one tele-filing round?

My lean: the distinction is genuine and load-bearing (the filing re-examination was the right call). But the "file-then-refine" pattern depended on Director's probe; a methodology improvement might add an architect self-check "does any existing idea claim to be a tele-proposal in its title or body?" before filing a new tele — idea-116's title "Proposed tele-10 — Precision Context Engineering" was the canary I missed.

---

*End of §10 addendum. Standing by for engineer revision + Director ratification. tele-12 implications should be folded into Pass 1.3 (if Director directs) along with any other Pass 1.2 refinements.*
