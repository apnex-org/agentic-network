# M-Stint-Lifecycle (idea-380) — Stint-5 Design

**Status:** v0.1 — council pre-read (greg + steve) → Director ratification. **Author:** lily (architect). **FOCUS:** idea-380. **Mandate:** convert a stake — do not bank a third time.

**Provenance:** the body (§1–§6) was produced by an ultracode design workflow (5 parallel recon → synthesize → 3 adversarial red-team critiques → finalize; run `wf_8c8783cc-75b`). §0 below folds in four points the Director sharpened in dialogue *after* the workflow; **the council deliberates the design as refined by §0.**

---

## §0 — Director-dialogue refinements (post-workflow, pre-council)

Four refinements from the Director dialogue, one of which re-scopes §2.2:

1. **The mechanization primitive is the BLUEPRINT — general, not close-out-specific.** The workflow's §2.2 narrowed (for scope) to a `seed_closeout` seeder. The Director's framing is broader and is adopted: the primitive is **`seed_blueprint`** — a *declarative WorkItem-graph template* the Hub expands onto the work-queue, used to "pattern complex workflows on top of the work-queue to orchestrate complex and sophisticated **real-agent councils, brainstorms, and deliberations**." The close-out chain is *one* blueprint (a finite gate-DAG); the **council is another** (a richer graph: position×lens briefs → clash → converge). Generalizing the seeder from hardcoded-G1→G7 to *read-a-blueprint-spec* is marginal cost over the close-out-only seeder and directly delivers the Director's vision. **Re-scope: S2 builds the general `seed_blueprint` primitive (minimal node shape `{role, references, runbook, brief, dependsOn, evidenceRequirements}`); authors the COUNCIL blueprint as the FIRST instance (higher-value + needed sooner than close-out); close-out is the second blueprint.**

2. **Saved Workflows ≠ real-agent orchestration (Director correction).** The ultracode Workflow tool that produced this doc orchestrates only the architect's *local sub-agents* — an analysis tool, NOT a coordination mechanism for the real org. A real multi-way council MUST run on the Hub work-queue (the blueprint primitive). Saved workflows are not a tier of the lifecycle mechanization; they are private architect tooling.

3. **Bootstrap via a hand-seeded WorkItem graph (resolves the chicken-and-egg).** You can't build the mechanization "before a stint to build it." But the work-queue *already* supports the graph (`dependsOn` / `roleEligibility` / `payload` / `evidenceRequirements` all exist today). So the **first council is hand-seeded as a real WorkItem graph on existing substrate** — real agents claiming real nodes, briefs in payloads, zero new substrate. That manual instance is both the bootstrap *and* the spec for the `seed_blueprint` primitive stint-5 builds (do-it-by-hand-once-then-mechanize). stint-5 runs under the current prose lifecycle; it builds the mechanized one; each primitive is dogfooded the moment it ships; the lifecycle self-hosts over stints (compiler bootstrap).

4. **The council's cold-start mechanism = the position+lens "participant brief."** Each council-blueprint node carries a structured brief — `{participant, topic, assigned_position, assigned_lens, rationale}` — delivered as the claimant's just-in-time instruction. Double-duty: (a) it manufactures real clash (assigned adversarial positions; a seat can be briefed to argue *against* its own bias → breaks seat-capture), and (b) it IS the cold-start mechanism (a process-naive agent is told position+lens+why; no prior knowledge needed). Lens vocabulary is defined: **seat-domain** (architect-intent / engineer-buildability / verifier-risk) + **altitude** (gestalt / mechanical, CDACC) + **adversarial** (steelman / red-team / scope-realism). The council blueprint's first node computes the per-topic position×lens coverage matrix and assigns cells to participants.

**Added fork for the council (on top of §5):** does S2 build the GENERAL `seed_blueprint` primitive (*recommended* — delivers the council/brainstorm/deliberation vision at marginal extra cost; council = first blueprint, close-out = second) or the close-out-ONLY seeder (the workflow's scope-lean lean)? Recommended: the general primitive, proven by running BOTH the stint-5 design council (now, hand-seeded) and the stint-5 close-out (end, via `seed_blueprint`) on it.

---

## §0.5 — Council convergence (v0.2, 2026-06-28)

The stint-5 design council ran as a hand-seeded WorkItem graph (work-65..71: POSITION×3 → CLASH×3 → ADJUDICATE), with assigned position×lens briefs. It **converged on all 9 topics**, and moved three of the architect's v0.1 leans — evidence the assigned-position mechanism produced genuine clash, not rubber-stamp. Full per-seat evidence: work-65/67 (inline), work-66/69 (Hub Documents), work-68/70 (inline).

**Per-topic council decisions:**

- **T1 (blueprint scope) — CONVERGED to a buildable middle (collapses the §0 fork).** Ship a **minimal, data-driven `seed_blueprint`** — a *finite DAG expander*, NOT a workflow platform. Strict node schema `{role, references, runbook, brief, dependsOn, evidenceRequirements}`; guardrails as **fail-closed `create_work` rejects**: acyclic, static nodes only, no conditionals/loops/dynamic-expansion, node-count cap, dry-run required, deterministic idempotency key, **no public contract until 2 dogfoods** (council + close-out) prove the shape. This delivers the Director's general-primitive vision (councils/brainstorms/deliberations as data) at ≈close-out-only build cost, without the platform tail. *Director confirm.*
- **T2 (cold-start surface) — CONVERGED: thin projection, NO entity.** Ship `get_current_stint` as a **read-only projection over WorkItems** with snapshot semantics (projection watermark, active phase, gate-checklist, satisfying-WorkItem-ids, blockers, holders/leases, next-verb, non-dark empty-reason) + a test asserting projection-consistency vs the graph. **No 25th-kind Stint entity** (a 2nd state machine that would diverge from the WorkItem graph — the bug-137 class; greg conceded this). Stake-clock = **M5 durable deferral records** (schema-required `revivalTrigger`+`rationale`), not the projection, not an entity. Entity deferred (revival trigger: ≥2 blueprints need cross-cutting state un-derivable from the graph, or projection tests expose an unfixable race).
- **T3 (observability PUSH) — CONVERGED on safe-by-construction + owned bound; *Director ratify*.** Minimal-cut PUSH ships as **non-authoritative wake/notification hints over an always-correct pull** (`get_next`/`list_work` stay source-of-truth) → a dropped event degrades to poll-latency, never silent loss → **needs no bug-190 dependency**. Full idea-357 PUSH → stint-6, **GATED on bug-190 = work-44** (the cursor-safety invariant "don't-advance-cursor-on-sink-failure"), made concrete (owned WorkItem + acceptance test + written revival trigger) so the bound is *owned, not silently named*.
- **T4 (governance) — CONVERGED on a split.** **Hard-enforce the deterministic AUTHORING-TIME structural class NOW** (cheap, local, fail-fast, fixable by the author — does NOT gate close): `create_work` requires runbook + doneWhen + evidence-requirements; reject cycles / dangling-deps / over-large node-count / missing role-eligibility / invalid evidence-ids; G7 `dependsOn` G1..G6; deferral requires owner+rationale+revivalTrigger; **verifier gate requires a pinned PR head-SHA + post-claim verdict** (mechanizes the FR-36 stale-checkout fix); legal-moves in rejection envelopes. **ADVISE the close-BLOCKING semantic gates (G4/G3) this stint** (loud digest/close-report surface, no block — G4-hard couples close to the late idea-356 + can wedge with no operator, the FR-27/38 class). Run G4 in advise/dry-run for the first close-out; **promote to hard-enforce in stint-6** once idea-356 is proven green. G3 hard-enforces *creation* of intake nodes (not completion by a slow peer); timeboxed override.
- **T5 (cold-start spine) — CONVERGED: REQUIRED.** `get_next` + non-dark empty digest + legal-moves + schema-enforced runbook. **Pre-read/inter-node-artifact accessibility is a blueprint VALIDATION rule** (seed-time, fail-closed): every referenced input + evidence-artifact must resolve **inline in payload / a pinned git ref / a discoverable Hub Document** — never a dangling `docs/...` path. (Proven necessary: the council hit this **3×** live.)
- **T6 (SysML) — CONVERGED; *Director nod*.** Mermaid for the FSM artifact; **no maintained SysML twin, no emitter** (drift machinery without codegen). mission-kit *concepts* adopt (K6 arc-lifecycle = cold-start verbatim); toolchain skip. Revival trigger: a 2nd real model-consumer.
- **T7 (deferral honesty) — CONVERGED.** Any deferral write requires `rationale` + `owner` + `revivalTrigger` + `next-review-condition`; the close-out report lists deferred items **separately** from converted stakes + bounded commitments.
- **T8 (velocity) — CONVERGED: measured hypothesis, not a committed number.** Treat +1.5–2 PRs/hr as a hypothesis; instrument before/after **merge-leg latency breakdown** (ready-to-merge latency · rebase-churn · CI-rerun · **cross-agent-approval-wait** · queue-wait · merged-PR/hr). **Land S1 before S2**; **gate merge-queue-enable on CI reliability** (bug-195/deploy-floor first — a flaky-CI queue stalls everything behind it); pilot a **2-3 PR stacked batch**, not one green PR. S0 is a transient burst, not sustained. S2 is an explicit current-stint velocity **debit** with future-cold-start payoff.
- **T9 (borrow Workflow primitives) — CONVERGED: vocabulary with Hub-durable semantics + supported/reserved tagging.** `phase` = WorkItem grouping/label (not an execution thread); `parallel` = independently-claimable WorkItems under WIP caps; `barrier` = `dependsOn`-all; **`pipeline` = RESERVED** (deferred until the Hub has an explicit per-item streaming scheduler — `dependsOn` only expresses barriers; do NOT emulate; revival trigger: a high-volume per-item flow like per-bug reconcile→fix→verify); `typed-output` → map to `evidenceRequirements`/`complete_work` predicates (adopt bounded, gates-first); `label/progress` = projection metadata. **Spec rule:** every borrowed term must declare *supported-now* vs *reserved-for-future-substrate* (prevents ephemeral-local assumptions contaminating durable orchestration).

**Reduced Director forks (the council resolved the rest as architect-adjudicable):**
1. **T1 — confirm** the minimal-narrow-general `seed_blueprint` (delivers your vision, non-platform, ≈close-out cost).
2. **T3 — ratify** the observability-PUSH bound (minimal-cut non-authoritative-hints now; full idea-357 → stint-6 gated on work-44/bug-190).
3. **T6 — nod** Mermaid (no SysML toolchain).

**META findings → seed_blueprint spec + backlog:**
- **Accessibility (3 live instances)** → seed-time fail-closed validation of node-input + evidence-artifact resolvability (T5).
- **Gate-vs-merge / FR-31** → live on PR #412: steve's verifier-approve + all-green CI still = `reviewDecision: REVIEW_REQUIRED`. Direct evidence for S1's per-path branch-protection + cross-approve matrix.
- **WIP-cap vs anchor** → the architect's perpetual anchor (work-45) + a claimed council node = 2 concurrent WIP; the cap must reserve a slot so anchor-holding doesn't starve council/gate participation.
- **The council self-corrected** (architect mis-stated steve's artifact as inaccessible; steve corrected → Hub Document) — the deliberation caught its own error, validating the blueprint.
- **CODIFY `references` (inputs) as a first-class node field — the unifying structural fix (Director-surfaced, 2026-06-28).** The deeper question behind the triangulation gap: should a node's INPUTS/REFERENCES be codified into the work-queue graph structure, not buried in prose? **Yes.** The council exposed that a node's READ-SET — pre-reads, prior-node outputs, the entities to triangulate against — lived only in prose runbooks + organic citation, and it failed three ways: **accessibility** (3× unresolvable refs), **triangulation** (organic; teles + axioms under-cited — organic citation covers what's salient in the pre-read but misses the teles the work serves + the axioms it must honor), and **cold-start** (prose archaeology). One codified field unifies all three. A node's contract becomes THREE distinct relationships, of which only the first is codified today:
  - **`dependsOn`** = WHEN-claimable (sequencing) — codified ✓
  - **`references`** = WHAT-to-consume (the read-set) — currently prose-only ✗ → **codify this**
  - **`evidenceRequirements`** = WHAT-to-produce (the write-set / output contract) — codified ✓
  Minimal shape: `references: [{kind: doc|bug|idea|friction|calibration|tele|axiom|workitem|pr, ref, storage: inline|git|hub-doc|entity, mode: read|triangulate-against, required}]`. Payoffs from the single field: **seed-time fail-closed resolvability check** (every ref resolves → fixes accessibility); a **`triangulate-against` ref must be addressed in the node's evidence** (fixes triangulation, mechanizes mission-kit **M1 triangulated-review** + calibration **#85 ground-truth** + grounding in the **A-series axioms**); **`get_next`/`get_work` surface the declared read-set** (fixes cold-start, no archaeology); and the graph now records **what each node consumed** (provenance/lineage — tele-1 transparency). Scope-safe: a typed list + two checks, not a subsystem. **→ ADD `references` to the seed_blueprint node schema** (it is arguably what makes a blueprint node a complete primitive). This supersedes the narrower "require triangulation" framing: triangulation is just `mode: triangulate-against` on a codified reference.

**Spawned:** idea-381 (M-Client-Side-429-Backoff, deferred-with-revival-trigger). **Pending Director ratification of the forks + FOCUS:** the M-Stint-Lifecycle mission-proposal (not filed until the Director confirms — proposing pre-ratification would be premature).

---

## §0.6 — Triangulation matrix (tele + axiom grounding, Director-requested 2026-06-28)

Each converged decision mapped to the **tele-N / A-series axiom** it *serves* and the named fault it *defends against*. Ground-truthed via Hub `list_tele` (14 teles, tele-0..tele-13) + mission-kit `axioms/` (A0..A12). **tele-N ↔ A-N pair 1:1 for 0–12** (axioms crystallize the teles). **Two drift findings surfaced by this pass** (cheap follow-ons): the derived `tele-glossary.md` v1.0 is STALE (stops at tele-12; **tele-13 "Director Intent Amplification"** was ratified 2026-06-20) → refresh it; and the axiom export has **no A13** for tele-13 → file it (the mission-kit axioms-from-teles follow-on).

**Overall — M-Stint-Lifecycle serves:** **tele-0/A0** Sovereign Intelligence Engine (the umbrella — the org self-drives Director intent with zero-admin-friction) · **tele-13** Director Intent Amplification (mechanizing the lifecycle + cold-start + governance-as-substrate = *less Director attention per stint*; the org runs without the Director in the synchronous loop — defends *Attention Leak* + *Authority Drift*) · **tele-10/A10** Autopoietic Evolution (the org mechanizes its own process) · **tele-2/A2** Isomorphic Specification (lifecycle as enforced spec, not prose) · **tele-6/A6** Frictionless Agentic Collaboration.

| Decision | Serves (tele / axiom) | Defends against (fault) | Supporting entities |
|---|---|---|---|
| **T1** minimal data-driven `seed_blueprint` (non-platform) | tele-2/A2 (the blueprint IS the process — declarative graph → enforced WorkItems, manifest-is-master); tele-11/A11 (deterministic substrate, not LLM ceremony); tele-6/A6 (mechanized coordination) | tele-3/A3 *God-Object / Ceremony Bloat* — the non-platform guardrails (acyclic, static, node-cap, no-public-contract-until-2-dogfoods) ARE the A3 defense against a blueprint *platform* | idea-380; the council's own hand-run (proof); greg+steve non-platform guardrails |
| **T2** thin projection, NO entity; stake-clock = M5 durable deferral records | tele-1/A1 (ONE source of truth — the WorkItem graph; projection derives); tele-3/A3 (no 2nd state machine) | tele-1/A1 *Hidden State / Silent Drift* — a 25th-kind Stint FSM is a parallel truth that diverges from the graph (bug-137 class); refusing it defends A1 | bug-137; M5 anti-amnesia; envelope-divergence class |
| **T3** minimal-cut PUSH = non-authoritative hints-over-pull; full idea-357 gated on bug-190/work-44 | tele-7/A7 (no silent failure — dropped event → poll-latency, never loss); tele-1/A1 (pull stays authoritative) | tele-7/A7 *silent failure* — authoritative PUSH on a fails-dark drainer = silent work-loss; non-authoritative design + the work-44 cursor-safety invariant defend A7 | idea-357; bug-190 = work-44; idea-381; stint-4 retro §3 (429) |
| **T4** hard-enforce authoring-time structural invariants; advise close-blocking gates | tele-8/A8 (gated integrity from the core — fail-fast invariants at `create_work`); tele-2/A2 (spec-enforced); tele-7/A7 (advise-not-hard avoids self-deadlock) | tele-7/A7 *permanent agent block* — a hard close-gate coupled to a late dependency (idea-356) wedges close with no operator (FR-27/38); advise-this-stint defends A7. (pinned-head-SHA = the FR-36 fix) | FR-36; FR-27/38; FR-34; cal #88; idea-356 |
| **T5** cold-start spine + references-accessibility validation REQUIRED | tele-5/A5 (a cold agent perceives the same ground truth — `get_next` hydrates); tele-4/A4 (node carries its load-bearing context); tele-13 (less operator intervention) | tele-5/A5 *Architect Amnesia / Hallucinated Fill-In* + tele-4/A4 *Corporate Amnesia* — dangling refs force out-of-band archaeology; seed-time resolvability validation defends A5/A4 | the 3 live accessibility instances; bug-180/199; FR-37 |
| **T6** Mermaid, no SysML toolchain | tele-11/A11 (no literacy-tax/ceremony); tele-2/A2 (avoid a twin that drifts) | tele-2/A2 *Doc-Code Drift / Phantom State* — a maintained SysML twin without an emitter is drift machinery; Mermaid-not-twin defends A2 | mission-kit eval (no emitter); P3 twin-parity-by-generation |
| **T7** deferral honesty (rationale + owner + revivalTrigger + review) | tele-10/A10 (revival-trigger = the system surfaces its own deferred work); tele-4/A4 (deferral carries its full why); tele-1/A1 (durable records) | tele-10/A10 *Friction Fossilization / Lesson Loss* + tele-4 *Corporate Amnesia* — silent banking; owner+trigger defend A10 | cal #86 (deferred-divergence-becomes-drift); M5; FR-34 |
| **T8** velocity as measured hypothesis; S1-before-S2; gate on CI reliability | tele-9/A9 (don't enable the merge-queue on unproven CI — deploy-floor first); tele-1/A1 (instrument latency = velocity observable, not assumed); tele-13 (throughput per Director-attention) | tele-9/A9 *ship-on-unproven* (flaky-CI queue) + cal #85 *ground-truth-over-assumption* (assuming +PRs/hr) | cal #85; FR-35; FR-31; bug-195; stint-4 velocity baseline |
| **T9** borrow Workflow vocabulary w/ Hub-durable semantics + supported/reserved tagging; pipeline RESERVED | tele-2/A2 (a borrowed term declares its real supported semantics — no phantom); tele-3/A3 (clean contracts, no leaked ephemeral assumptions); tele-4/A4 (supported/reserved = load-bearing precision) | tele-2/A2 *Phantom State* — borrowing "pipeline" while the substrate has no streaming scheduler = the spec lies; the supported/reserved discipline defends A2 | the Workflow tool; greg+steve T9 CLASH |
| **META** `references` field + accessibility + FR-31 + WIP-cap | tele-1/A1 (provenance — the graph records what each node consumed); tele-5/A5 (perceptual parity at claim); tele-6/A6 (frictionless) | tele-1/A1 *Hidden State* (un-codified inputs) + tele-5 *Black-Box* | the 3 accessibility instances; #412 (FR-31); work-45 WIP-cap |

**Coverage read:** the design touches **every axiom A0–A12 + tele-13**; A9 is *touched-not-served* (T8 gates on CI reliability but ships no chaos-path this stint — acceptable, out of FOCUS). **No tele is contradicted; the design is net-positive or neutral on all 14.** Each decision is grounded in ≥1 named tele/axiom *plus* concrete supporting entities (bugs/ideas/friction/calibrations). Triangulation rigor: discharged.

---

## 1. EXECUTIVE SUMMARY

**Thesis (post-critique, narrowed).** The autonomous-stint lifecycle should stop living in prose docs and start being *enforced by the substrate that already runs the org* — but only at the **bookends** (Launch, Close-Out), which are real gate-chains; the **Drive middle stays a governed self-drive loop** (DAG-ifying a loop models a lie). The mechanization is small and dogfoodable: a completed gate carries its own runbook, the `complete_work` predicate decides the gate non-gameably, and a freshly-spawned agent is *pushed* its next action at wake. That is the FOCUS, and it is the Director's HARD cold-start requirement satisfied by construction — **not** an empire.

**The three critiques converge on one correction, accepted:** the prior draft was a 3-4 stint empire in one stint's clothes. The velocity number is NOT bought by the lifecycle spine — it is bought by **GitHub merge-queue config + the burstable hygiene batch**. The cold-start claim was load-bearing on banked surfaces. And "convert a stake" was being diluted into "convert four stakes" — the mechanical recipe for converting none.

**The leanest version that converts a stake (four buckets, depth over breadth):**
- **S0 Hygiene floor (slimmed)** — file the stint-4 calibration set + idea-378 FIRST (this retro's own FR-34 debt), `reconcile --apply`, tele-0, ONE mechanical triage-tag pass over the 265-open backlog.
- **S1 Velocity floor (RELIEF, the metric)** — merge-queue + auto-merge + per-path branch-protection + cross-approve matrix + `concurrency:cancel-in-progress`, piloted on one low-stakes PR before defaulting. Config, hours, no build. This is where stint-5's PRs/hr number is earned.
- **S2 Lifecycle mechanization (the FOCUS, thin + dogfooded)** — per §0, the general `seed_blueprint` primitive (council blueprint first, close-out second), runbook as a schema-enforced WorkItem field (fail-closed at authoring), gates→`evidenceRequirements`, a pushed entry verb `get_next` + non-dark empty digest + legal-moves-in-rejection-envelopes, a thin read-only `get_current_stint` projection (NOT a 25th-kind entity), and the `create_work` cascade-action. **Dogfooded by running stint-5's own design council + close-out on it.**
- **S3 Pull idea-356 (calibration write-verb) INTO the spine** — so G4 can actually hard-enforce FR-34 closure. You cannot claim the kill and park the weapon.

**Stakes explicitly converted (not banked):** (1) velocity floor → measurable PRs/hr relief; (2) FR-34 → mechanically killed by G4+idea-356; (3) the FOCUS → lifecycle enforced + cold-start true-by-construction. **Bounded under Director ratification (sanctioned, not silent):** observability general-PUSH (idea-357 full) → stint-6 with bug-190 named as scoped+owned safety prereq, push minimal-cut ships now; 429 backoff → file idea now, build bounded. **Deferred to stint-6+ with revival triggers:** heavy Stint FSM entity, LifecycleSpec doc-generation, idea-370/372, full drainer hardening, any SysML emitter.

---

## 2. THE DESIGN

### 2.1 Stake-Clock Disposition

**CONVERT NOW (in-spine):** file the stint-4 calibration set + idea-378 (FR-34 debt this retro is exposed to — do FIRST); idea-356 calibration write-verb (so G4 hard-enforce is real); reconcile `--apply` (idea-379) + tele-0 staleness + ONE mechanical triage-tag pass.

**BOUND + COMMIT (Director-ratified at council — a sanctioned bound is not a third bank; a silent re-slip is):**
- **Observability general-PUSH (idea-357 full)** → stint-6, written revival trigger, **bug-190 named as the safety prerequisite, scoped+owned this stint even if built next** (PUSH on a fails-dark drainer ships unsafe relief). The push *axis* is not dark now: `get_next`-delivery + CI-green/merge-ready + WI-completion events ship in S2.
- **Client-side 429 backoff/circuit-breaker** — the only forward-investment with no tracking entity. File the Idea NOW (closes the silent-owner gap); build bounded behind bug-190.
- **bug-190 drainer** — CUT from "full rearchitecture FIRST." This stint: scope + own it + ship the single safety property that makes any push correct (don't-advance-cursor-on-sink-failure). Bound the rest behind its revival trigger.

**ISOLATE (mechanical, one pass):** the ~34 curation tail + ~22 missioncraft + ~250 deep-backlog get a triage-tag stamp from the single reconcile pass — NOT 50 hand-dispositions. CDACC run-672bd0f stays the highest-attention isolation item (greg holder-unseal OR build-lull → drift-map → PING DIRECTOR). bug-162 (pulse false-escalation) → DROP/wontfix (pulses structurally subsumed by lease-expiry).

**OPPORTUNISTIC-IF-TIME (not committed):** bug-180/199 catalog-staleness smoke (serves cold-start), bug-185/184/172, FR-36/39.

### 2.2 Mechanization Architecture

**The grand "4-layer process-engine" framing is CUT** — it oversold a modest change-set. The substrate is already ~80% a process-engine (`WorkItem.dependsOn`/`evidenceRequirements`/`roleEligibility`/`payload` all exist; the anti-gameability predicate is real at `work-item.ts:174-181`).

**What ships (per §0, the general blueprint primitive — council first, close-out second):**

1. **`seed_blueprint` primitive (the keystone).** A CLI/verb that reads a declarative blueprint spec and **pre-lays the WorkItem graph at t0** — each node carrying its runbook + `evidenceRequirements` + RACI eligibility + (for council nodes) its position×lens brief. A pre-seeded finite graph is strictly *more* cold-start-legible than lazy cascade-seeding (the agent sees the whole road from `list_work` at t0) and has **zero cascade depth** (dissolves the INV-TH25 concern). First blueprint = the **council** (position×lens briefs → clash → converge); second = **close-out** (G1→G7 chain).

2. **`runbook` as a schema-enforced first-class WorkItem field.** `create_work` REJECTS a gate/blueprint WorkItem without a runbook (fail-closed at authoring, same posture as the existing dangling-`dependsOn` reject). `get_work` guarantees it at claim-time. This is the difference between real and hand-wavy cold-start.

3. **Gates → `evidenceRequirements`.** Close-out blueprint: G1 retro-doc + Verification-Log; G3 tri-seat = two `{kind:"review", producedBy:<engineer/verifier agentId>}` (structurally kills the one-sided retro); G4 = calibration-filed + `calibrations.py validate` green (deterministic once idea-356 is in-spine); G7 = `dependsOn:[G1..G6]`.

4. **`create_work` cascade-action (kept — cheap, reusable).** Mirrors `create-task.ts` (`kind:"spawn"`, payloadSchema, `findByCascadeKey` idempotency), registered as the 10th ActionSpec. Re-scoped: the Drive-reseed / general successor-spawn primitive — the genuine "push half applied to the lifecycle queue."

**CUT from the architecture:** LifecycleSpec layer + prose-generation (a YAML→prose generator for a 91-line doc contradicts the thesis); the heavy Stint entity (25th kind + FSM — once-weekly instantiation, ~3 readers, worst payoff-per-use — stays deferred; the legible surface is the thin projection in §2.3); full LifecycleSpec for Launch/Drive (the bookends are DAGs, the Drive middle a governed loop — lease-renew heartbeat + idea-353 re-wake + continuous reseed).

### 2.3 Cold-Start Mechanism (the Director's HARD requirement #2 — made TRUE, not aspirational)

The cold-start critique proved the prior design fails cold-start by construction. All FATAL/SEVERE gaps closed with cheap projections + envelope enrichment:

- **`get_next` — ONE pushed canonical entry verb** (FATAL→fixed). Auto-invoked by the adapter handshake at wake. Returns `{ identity(role/agentId), current stint+phase, the single next claimable item, its runbook (+ brief if a council node), and the literal next verb string }`. The one thing the substrate must *push* — and the natural delivery target for the L2 PUSH minimal-cut, **unifying cold-start with the velocity push lever.**
- **Thin read-only `get_current_stint` projection** (FATAL→fixed). A projection over the WorkItems (active phase + gate-checklist + which WorkItem satisfies each gate). No 25th-kind FSM entity. The C1↔C2 reconciliation: cold-start needs a legible org-state surface (non-bankable); the heavy entity is premature → ship the cheap projection, defer the entity.
- **Legal-move-set in rejection envelopes** (near-free). The FSM already knows legal source phases at every `TransitionRejected`; emit `{rejected, currentPhase, legalMoves:[...]}`.
- **Non-dark empty digest** (SEVERE→fixed). `list_ready_work`/`get_next` always carry `reason`+`nextAction` when empty (capped → "renew_lease or complete your N in-progress"; quarantined → "call clear_work_quarantine"; genuinely-empty → "no ready work in role X; stint at phase Y awaiting gate Z by role W"). Empty is still an instruction.
- **`renew_lease` in the canonical loop + every runbook's `doneWhen`** (MODERATE→fixed). Seeder marks long-running gate evidence `allowPreClaim`; freshness error points at `renew_lease`.
- **One enforced close path** — the close action REFUSES outside the DAG (no parallel prose close). If the prose path survives, the mechanization is advisory.
- **Thin digest, full runbook at claim-time** — digest stays lean (id, type, phase, one-line summary, next-verb); `get_work` delivers the full runbook + brief at claim.

**The canonical loop:** `get_next` (pushed at wake) → `claim_work` → `get_work` (full runbook/brief) → execute → `renew_lease` (heartbeat) → `complete_work` (predicate decides the gate, self-teaching rejection). **Zero doc reads.** Requirement #2 by construction.

### 2.4 Governance-Embedded

`complete_work`'s predicate errors are specific and self-teaching — a naive agent learns the gate from the rejection. Lean into this; it is the best cold-start primitive we own.

| Discipline | Enforcement | Posture |
|---|---|---|
| **G4 — FR-34 banked-not-filed calibrations** | close blocked until a calibration referencing this stint is filed AND `calibrations.py validate` green | **HARD-ENFORCE** (idea-356 in-spine → deterministic); manual-override escape hatch documented |
| **G3 — tri-seat intake (FR-20)** | predicate requires real engineer + verifier agentIds on intake WorkItems | **ADVISE until green ≥2 stints**, then promote (a hard gate that blocks close on a slow peer is a velocity hazard) |
| **Close-out G1–G7 ordering** | G7 `dependsOn` G1–G6; one enforced close path | enforced ordering |
| **M5 anti-amnesia (deferral-becomes-drift)** | `revivalTrigger` + `rationale` schema-required on any deferral write | enforced (the one field kept from idea-370) |
| everything else (verifier-gate, faithful-shape, truncation-honesty, RACI) | advise / inherited | advise-default |

**Posture principle:** hard-enforce *only* a gate whose dependency has shipped AND which targets a proven recurrent loss-vector — G4 alone this stint. Governance-as-substrate is the goal; governance-as-deadlock is the anti-velocity pattern to avoid. Promote to hard-enforce only after dependency ships + green ≥2 stints.

### 2.5 Velocity Thesis (honest about where the number comes from)

stint-5's PRs/hr number is earned by **S1 (merge-queue config) + the S0 burstable hygiene batch** — small, independent, pre-verified, no merge-churn (the regime where the proven ~15-20 PRs/hr burst lives). The **FOCUS spine does NOT lift this stint's throughput** — it is serial verifier-gated backplane code; its velocity payback is *cold-start in future stints* + a modest L2 minimal-cut now. We do not claim otherwise. Shipping a PR-cadence dashboard without merge-queue would measure the ceiling instead of lifting it (the third bank). **Stint-5 ships the relief.**

The throughput governor is the **merge leg** (serial: require-up-to-date + one-at-a-time merge); build+verify is parallel — by Little's Law the merge gate is the bottleneck.

| Rank | Lever | Mechanization | This-stint payback |
|---|---|---|---|
| **1** | **L1 merge-churn** | merge-queue + auto-merge + per-path branch-protection + cross-approve matrix | **+1.5–2 PRs/hr — the actual metric win.** Config, hours. Pilot first. |
| **2** | **L2 poll→push (minimal cut)** | `get_next`-delivery + CI-green/merge-ready + WI-completion events over LISTEN/NOTIFY+SSE | +0.5–1, AND it is the cold-start wake |
| **3** | **L4 tool-catalog staleness** | make the #362 invalidation path default (block first ListTools on `/health` revision) | +0.2–0.4 — so the session shipping a verb uses it immediately |

**Claim, narrowed:** L1 alone plausibly moves the org from ~2 PRs/hr sustained toward ~4 blended, with the S0 hygiene batch recovering bursts toward 15-20 PRs/hr; L2-minimal trims round-trips. The heavy backplane (full PUSH, drainer) is out of this stint precisely because it would *lower* PRs/hr — the velocity goal and a heavy FOCUS fight inside one stint, so keep the FOCUS thin.

### 2.6 Slicing

Sequenced cheap-and-independent first so the stint dogfoods its own faster merge regime:

- **S0 — Hygiene floor (~hours, parallel PRs):** file stint-4 calibrations + idea-378 (FIRST) · reconcile `--apply` · tele-0 · ONE triage-tag pass. Opportunistic-if-time: bug-180/199, bug-185/184/172, FR-36/39.
- **S1 — Velocity floor (RELIEF, ship + PILOT first):** merge-queue + auto-merge + per-path protection + cross-approve + `concurrency:cancel-in-progress`. Pilot on one low-stakes PR + documented manual-merge escape hatch before defaulting.
- **S2 — Lifecycle mechanization (FOCUS, thin + dogfooded):** the general `seed_blueprint` primitive (council blueprint first, close-out second) + schema-enforced `runbook` field + gates→`evidenceRequirements` + the cold-start spine (`get_next`, thin `get_current_stint` projection, legal-moves, non-dark digest, renew_lease-in-loop, one-enforced-close) + `create_work` cascade-action. **Dogfood: run stint-5's own design council + close-out on it.**
- **S3 — idea-356 calibration write-verb INTO the spine.** Makes G4 hard-enforce real + S0 calibration-filing mechanical + serves the S2 close-out dogfood.

**Sequencing:** cheap independent PRs (S0+S1) merge first → bank early throughput + dogfood the faster merge → S2/S3 spine in the middle → bounded heavy work out of the stint.

---

## 3. mission-kit / SysML VERDICT (final, decisive)

**Concepts: RELEVANT — ADOPT (free, already congruent).** K6 arc-lifecycle ENGINE pattern (sovereign state engine operated by verbs, FSM-gated writes, a `describe` self-doc verb whose goal is "the agent learns the system from the system, not from prose" = cold-start requirement #2 *verbatim*; banked/staked payoff axis + anti-amnesia triggers = the stake-clock *verbatim*) — the conceptual blueprint for the cold-start projection (NOT a heavy entity). Plus P5 verbs-as-data, M5 anti-amnesia (revival-trigger-as-required-field), M3 default-reject + honest-yield (the close-out report leads with *relief delivered*, not *instruments shipped* — "banked the instrument not the relief" is the M3 anti-pattern exactly), P4/P3 (factoring + drift-guard).

**Toolchain: DISTRACTION for stint-5 — SKIP.** Ground-truthed: `mission-kit/tools/` = `skill-graph.mjs` only; no emitter/codegen from `.sysml` → SchemaDef/FSM. "Model → generate the substrate" is not an available capability; the kit itself warns "authoring SysML is the error-prone direction." Even a one-time diagram imposes a literacy tax.

**Decisive answer to the Director:** the stint-lifecycle FSM council artifact is a **Mermaid diagram** (zero literacy tax, zero new tooling); SysML opt-in *only* if the Director explicitly wants the artifact. Do NOT maintain a live SysML twin (no emitter → guaranteed drift). Do NOT build a SysML→SchemaDef emitter (defer if a second model-consumer appears). **SysML is relevant as concepts, a distraction as toolchain.**

---

## 4. OPEN DESIGN-DECISIONS (for council + Director)

**The §0 fork (added, high-stakes):** S2 builds the GENERAL `seed_blueprint` primitive (*recommended* — delivers the council/brainstorm/deliberation vision; council = first blueprint) vs the close-out-ONLY seeder.

**Two genuine high-stakes forks:**
1. **Cold-start org-state surface — thin projection vs entity vs nothing.** *Recommended: ship a thin read-only `get_current_stint` PROJECTION; defer the heavy Stint FSM entity (25th kind).*
2. **Observability PUSH scope (stake-clock-critical — Director must ratify).** *Recommended: BOUND full idea-357 to stint-6 with bug-190 scoped+owned, ship the push minimal-cut now.* A Director-ratified bound is not a third bank; a silent re-slip is.

**Ratify-the-lean (recommended stated; needs a yes):**
3. **Hard-enforce vs advise.** *Recommended: hard-enforce G4 ONLY (idea-356 in-spine), documented manual-override; advise G3 + others until green ≥2 stints.*
4. **Cold-start spine as REQUIRED.** *Recommended: yes — `get_next` + non-dark digest + legal-moves + schema-enforced runbook are the mechanization of HARD requirement #2, and cheap. Reject "convention-only."*
5. **SysML.** *Recommended: default Mermaid; SysML opt-in only; no live twin, no emitter.*
6. **Deferral honesty.** *Recommended: "deferred to stint-6+ with revival trigger" (not "banked-with-trigger"); accept the deferred set.*

---

## 5. RECOMMENDED MINIMAL STINT-5 SLICE PLAN

Four ordered buckets, cheap-and-independent first. **S0 (hygiene floor):** file stint-4 calibrations + idea-378 FIRST, then reconcile `--apply` + tele-0 + ONE triage-tag pass. **S1 (velocity floor — the stake converted, RELIEF):** merge-queue + auto-merge + per-path protection + cross-approve + `concurrency:cancel-in-progress`, piloted first — GitHub config, lands in hours, where the PRs/hr number is measurably earned. **S2 (the FOCUS — thin, dogfooded):** the `seed_blueprint` primitive (council blueprint first, close-out second) + schema-enforced `runbook` + gates→`evidenceRequirements` + the cold-start spine + the `create_work` cascade-action — proven by running stint-5's own design council + close-out on it. **S3:** idea-356 calibration write-verb → makes G4 hard-enforce FR-34 closure real. **Banked-vs-staked:** STAKED-AND-CONVERTED = velocity floor (S1) + mechanical FR-34 closure (S3/G4) + the dogfooded FOCUS (S2); BOUNDED-under-ratification = observability general-PUSH (stint-6, bug-190 owned) + 429 backoff (idea filed now); DEFERRED-with-revival-trigger = heavy Stint entity + LifecycleSpec generation + idea-370/372 + full drainer + SysML emitter.

---

## 6. Provenance + next step

- v0.1 authored 2026-06-28 (workflow `wf_8c8783cc-75b` + Director-dialogue §0). Council pre-read.
- **Next:** hand-seed the stint-5 design **council** as a real WorkItem graph (the bootstrap + the spec for `seed_blueprint`), with this doc as pre-read and the position×lens briefs in the node payloads; the council settles §4 + the §0 fork; Director ratifies → commence stint-5.
- Companion: `docs/methodology/autonomous-stint-close-out-protocol.md` (the close-out blueprint's gate definitions), `docs/methodology/autonomous-stint-operating-model.md` (the Drive engine that stays a governed loop).
