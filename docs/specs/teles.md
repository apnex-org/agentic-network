# Teleological Goals — Canonical Specification

**Status:** Teles 0-10 ratified 2026-04-21 AEST (Director). Tele 11 Cognitive Minimalism added 2026-04-22 AEST per Director direction during 2026-04 architectural review Phase 1 (architect-authored; explicit exception to review anti-goal §7 "Modifying the ratified Tele set"). Hub state matches this spec exactly.
**Source audit:** idea-149 (initial 11) + architect authority 2026-04-22 (tele-11)
**Template:** 4-section (Mandate → Mechanics → Rationale → Faults) + measurable Success Criteria
**Axiom harvest source:** `/home/apnex/taceng/ois/org/gov/axioms` (OIS KMS-META-010 through KMS-META-070) for teles 0-10; tele-11 is architect-proposed, not AX-harvested.

## Context

This document is the canonical specification of the 12 ratified teleological goals for the Agentic Network. Each tele is a declaration of perfection — a qualitative asymptote toward which the system is engineered. The list is structured as **1 umbrella vision + 10 orthogonal load-bearing asymptotes (tele-0..tele-10, Director-ratified 2026-04-21) + 1 architect-proposed orthogonal asymptote (tele-11, added 2026-04-22 per Director direction)**; each orthogonal tele composes as a necessary sub-condition of the umbrella.

Per Director ratification, all teles are authored in the 4-section template (Mandate / Mechanics / Rationale / Faults) with a measurable Success Criteria list. This template is adopted from the shape discipline of the OIS KMS-META axioms for orthogonal-expression consistency.

**Hub state (as of 2026-04-22):** The Hub contains exactly **12 teles**, with Hub IDs `tele-0` through `tele-11` mapped 1-to-1 against the spec numbering below. Teles 0-10 carry `createdBy: { role: "director", agentId: "seed-ratified-2026-04-21" }`. Tele-11 carries `createdBy: { role: "architect", agentId: "eng-40903c59d19f" }` with provenance: Director-directed exception during 2026-04 architectural review Phase 1. Original 11-tele state was reached via full direct-write reset (`scripts/reset-teles.ts`) after architect-adapter tool-surface issues blocked the normal `create_tele` path; the tele-11 addition used the normal `create_tele` MCP tool successfully (role-gate did not block architect-scope invocation). Pre-reset Hub state (9 legacy `pre-provenance` teles + 7 seed-ratified at IDs 10-16) was backed up to `scripts/reset-teles-backup-2026-04-21T23-35-09-585Z/` before destructive operations.

---

## Tele #0 — Sovereign Intelligence Engine *(umbrella)*

**Hub ID:** `tele-0`

**Mandate.** Directors provide strategic intent; a network of specialized autonomous agents collaboratively design, build, test, deploy, and self-heal complex software systems with zero administrative friction, mathematical correctness, and perfect institutional memory.

**Mechanics.**
- Hierarchy: Director → Architect → Engineer → Hub, each sovereign in its domain
- Hub as deterministic facilitator translating approved intent into executable state
- Every other tele (tele-1 through tele-10) composes as a necessary sub-condition of this umbrella
- Directors manipulate strategic what-if; automated substrates handle imperative how-to

**Rationale.** The 10 orthogonal teles collectively compose this vision. Without a named umbrella, future teles drift without a unifying reference, and the Director loses a single handle for "why are we doing any of this?" The umbrella is the constitutional north star.

**Faults.**
- **Fragmented Asymptote** — contributors optimize locally without knowing the global target
- **Umbrella Amnesia** — new teles proposed that contradict the vision go unchallenged
- **Director Fatigue** — strategic intent requires translation overhead because no ground-truth vision exists

**Success Criteria.**
1. Every tele (`tele-1` through `tele-10`) demonstrably composes as a necessary sub-condition of this umbrella.
2. Every mission, design, and idea traces (transitively) to at least one of `tele-1`..`tele-10` and therefore to `tele-0`.
3. Directors never provide low-level how-to; strategic intent alone is sufficient to drive the network.

---

## Tele #1 — Sovereign State Transparency

**Hub ID:** `tele-1`. **Source:** evolves pre-reset tele-1 (persistence) + absorbs external axiom AX-010 (State Sovereignty).

**Mandate.** All system truth lives in a sovereign, structured, decoupled state-backplane. No functional unit possesses private, opaque, or transient truth; all state is perceivable by any authorized entity and durable across any infrastructure restart.

**Mechanics.**
- State is a Physical Object in the backplane, not a variable in a process
- Compute kernels (agents, adapters, tools) are stateless — they read, transform, write back
- Any authorized entity perceives any other entity's state in real-time
- Topology (entity shape) version-locked; values change, structure changes only via formal refactor
- Entities survive restart with identical field values

**Rationale.** Eliminates the Hidden State Problem. In multi-agent systems, hidden state is the primary source of Silent Drift — different agents reasoning against different "truths". A sovereign backplane gives every agent (and every human audit) the same ground truth. Persistence makes transient truth physically impossible.

**Faults.**
- **Hidden State Problem** — state inside a process; other agents reason about a different reality
- **Silent Drift** — agents acting on divergent ground truth without detection
- **Ephemeral Truth Loss** — state evaporates on restart, mission context with it
- **Logic Poisoning** — components depend on hidden side-effects; refactor becomes impossible

**Success Criteria.**
1. Every persistent entity (Idea, Mission, Task, Turn, Tele, etc.) survives Hub restart with identical field values.
2. No agent or tool holds state that another authorized agent cannot query.
3. Topology changes go through formal refactor; value changes do not.

---

## Tele #2 — Isomorphic Specification

**Hub ID:** `tele-2`. **Source:** preserves pre-reset tele-5 + absorbs AX-050 (Declarative Primacy) + FSM aspect of pre-reset tele-3.

**Mandate.** The specification IS the system. Human-readable intent and machine-executable reality are mathematically identical. The Manifest is the Master — no state changes through imperative drift; declared intent auto-reconciles the active system.

**Mechanics.**
- The `workflow-registry` (and equivalent spec documents) is the configuration the Hub's PolicyRouter parses at runtime to generate FSMs
- A change to documentation instantly changes system physics
- Every state transition for every entity is enforced by the Policy Router against the sovereign spec
- Active state diverging from the manifest is auto-reverted (or flagged as Corrupted)
- Zero delta between documented Source of Truth and executing code

**Rationale.** Manual configuration is a security and fidelity fault. Isomorphism means the Director operates at the speed of thought on high-level intent while automated substrates handle imperative toil. 10,000 nodes manage as easily as one. Documentation cannot rot relative to execution.

**Faults.**
- **Doc-Code Drift** — documentation describes an older reality than what runs
- **Snowflake Entropy** — nodes accumulate unique tweaks; replication fails
- **Instructional Bloat** — Director provides low-level how-to because declaration doesn't drive
- **Phantom State** — agent operates against a transition the spec doesn't know about

**Success Criteria.**
1. The PolicyRouter parses the sovereign spec at runtime to generate FSMs (not compiled-in).
2. Zero "Unhandled event" logs during normal multi-agent operation.
3. 100% FSM coverage of documented workflows by TestOrchestrator (negative + chaos paths included).
4. Active state mismatches with declared intent are detected and reverted.

---

## Tele #3 — Sovereign Composition

**Hub ID:** `tele-3`. **Source:** new tele from idea-148 + AX-020 (Interface Singularity).

**Mandate.** Every module is a self-contained sovereign unit owning exactly one concern, exposing bit-perfect semantic interfaces, composing without leaking internals. God objects, spaghetti coupling, and dual-purpose modules are structurally impossible.

**Mechanics.**
- **Law of One** — a module does exactly one thing; "and"/"also" in its description is a violation
- **Air-Gap Principle** — interaction through declared adapters only; no reaching into kernels
- **Semantic Bit-Masking** — interfaces use explicit versioned contracts; bit-perfect message formats
- **Composable by default** — new capability = compose existing modules, not modify them
- **Local reasoning** — any module understandable, testable, changeable in isolation from contract + inputs alone
- **Logic density** — code is dense with intent; ceremony and premature abstraction are defects

**Rationale.** Enables Parallel Orchestration — swap a Transport layer without Logic ever noticing. Prevents Spaghetti Synthesis, the primary failure mode of AI-assisted engineering. Logic density stays achievable because boundaries stay clean.

**Faults.**
- **Logic Leakage** — change in one area causes unexpected failure in another
- **Architectural Paralysis** — everything too entangled to change
- **God-Object Accretion** — "utils", "helpers", "managers" accumulating unrelated concerns
- **Ceremony Bloat** — signal drowned in scaffolding; logic density collapses
- **Veto Paralysis** — architect cannot isolate root cause; system-wide halt

**Success Criteria.**
1. Every module/class owns exactly one concern; no accretion-bucket modules.
2. All inter-module interaction goes through declared contracts.
3. New capabilities arrive by composition, not modification.
4. Modules can be understood in isolation from their contract alone.
5. Boundary violations detectable by review or tooling.

---

## Tele #4 — Zero-Loss Knowledge

**Hub ID:** `tele-4`. **Source:** new tele from AX-030 (Knowledge Fidelity), adopted at full strength.

**Mandate.** Information is an engineering product. Summarization is loss. All organizational knowledge is authored and maintained at bit-perfect fidelity — expansion over summarization, structure over prose, mechanics-rationale-consequence in every artifact.

**Mechanics.**
- **Expansionist Bias** — specification volume exceeds raw intent; a word is a pointer, a paragraph is a specification
- **Load-Bearing Context** — every artifact includes Mechanics (How), Rationale (Why), Consequence (Fault)
- **Anti-Prose Constraint** — natural language wraps structured data only; lists, diagrams, logic-trees are the primary languages
- Documentation is the RAM of collective intelligence — an agent loaded today has identical context to the human who designed the system

**Rationale.** In a zero-knowledge-engine environment, lossy documentation means the engine hallucinates the missing details. Zero-Loss fidelity ensures session handovers, agent reloads, and long-duration projects retain their design rationale perfectly. Corporate Amnesia is permanent capital destruction.

**Faults.**
- **Corporate Amnesia** — decision rationale lost in handovers
- **Narrative Debt** — org spends more time explaining than executing
- **Onboarding Decay** — time-to-mastery increases as docs rot
- **Hallucinated Fill-In** — agents invent plausible details to cover gaps

**Success Criteria.**
1. Every artifact (idea, design, manifest, mission, report) includes Mechanics + Rationale + Consequence sections.
2. Prose appears only as wrapping around structured content.
3. Session handover loses zero decision context (cold-session pickup produces same outputs as warm).
4. Documentation volume exceeds raw intent volume consistently.

---

## Tele #5 — Perceptual Parity

**Hub ID:** `tele-5`. **Source:** evolves pre-reset tele-7 (Perfect Contextual Hydration) + absorbs AX-040 (Observability Symmetry).

**Mandate.** Humans and agents share symmetric perception of reality. The delta between a Director's view of the system and an agent's view is <1%. Every actor's prompt is hydrated with mathematically verified ground truth before generating a single token.

**Mechanics.**
- Real-time state rendered through pre-attentive channels (human-parsable and agent-ingestible in <300ms)
- Agents possess Synthetic Sensory Organs (framebuffers, TUI mirrors, kinetic streams) to perceive their own output in context
- Prompts auto-hydrated with current Hub state (via `get_pending_actions`, semantic query, observability surfaces) before cognitive loops begin
- Director↔agent perception delta measurably <1%

**Rationale.** Without symmetry, agents are blind to consequences of their logic — they produce output that passes tests but fails the Reality-Test. Directors become "eyes" for agents, destroying workflow density. Symmetric perception enables Self-Correcting Synthesis: agents observe friction in their own output and refactor before humans notice.

**Faults.**
- **Cognitive Friction** — Director forced to act as eyes for the agent
- **Black-Box Failure** — agent output satisfies unit tests but fails reality tests
- **Architect Amnesia** — agents hallucinate state instead of perceiving it
- **Operational Lag** — org reacts to logs instead of feeling system pulse

**Success Criteria.**
1. Agents never ask "what is the status of X?" — the system hydrates before the question arises.
2. Director↔agent perception delta measurably <1% on shared entities.
3. Agent output perceived in context (framebuffer/TUI/kinetic) before cognitive decision.
4. Hallucinated state counts as a bug, not expected behavior.

---

## Tele #6 — Frictionless Agentic Collaboration

**Hub ID:** `tele-6`. **Source:** preserves pre-reset tele-2 content; retroactive 4-section rewrite applied 2026-04-21.

**Mandate.** Multi-agent collaboration occurs with zero administrative friction. No actor manually transcribes approved data, performs redundant tool calls, or produces context-wasting boilerplate. The Hub seamlessly translates approved intent into executable state.

**Mechanics.**
- **Zero Transcription** — no cognitive actor ever re-enters data formally approved in a Proposal or Thread
- **Atomic Transitions** — ideation→execution is single-tool-call or auto-cascade
- **Role Purity** — Architect governs active state; Engineer proposes and executes; neither blocks on the other's administrative limitations
- **DAG Fluidity** — task dependencies and cross-entity links established during planning, enforced invisibly by Policy Router

**Rationale.** Administrative friction compounds linearly with agent count. In a 10-agent network, 10% friction per transition becomes intractable. Friction-zero is the precondition for scale: without it, multi-agent coordination collapses under its own coordination overhead.

**Faults.**
- **Transcription Toil** — actors copy-paste approved data across entities
- **Boundary Blocking** — one role's tooling gap blocks another's sovereign action
- **DAG Manual Stitching** — engineer manually sets dependencies the Hub should infer
- **Cascade Amnesia** — approval doesn't propagate; human re-triggers downstream work

**Success Criteria.**
1. No actor ever copy-pastes approved Proposal/Thread content into a downstream entity.
2. Ratification → execution is a single tool call or auto-cascade.
3. Architect never blocked on Engineer-admin; Engineer never blocked on Architect-admin.
4. Policy Router enforces DAG invisibly — no agent constructs dependency graphs manually.

---

## Tele #7 — Resilient Agentic Operations

**Hub ID:** `tele-7`. **Source:** preserves pre-reset tele-4 content; retroactive 4-section rewrite applied 2026-04-21.

**Mandate.** The Agentic Network is self-healing, resilient to transient failures, and provides actionable feedback at every surface. No operation fails silently; no actor is permanently blocked by a system error.

**Mechanics.**
- Policy Router strictly isolates errors — failed DAG cascade does not crash primary task completion
- Asynchronous operations (auto-linkage, notification delivery) wrapped in error boundaries; failures log to Audit without failing the primary request
- Adapters robustly handle rate-limiting + network drops via deferred backlog + state-based reconnect (`get_pending_actions`)
- Agent event loops fully hydrated on startup; no duplicate directives, no hallucinated state
- All failures surface actionable feedback (`revision_required`, `cascade_failure`)

**Rationale.** In an autonomous multi-agent network, silent failures compound into system-wide incoherence. Agents must resume after transient disruption (rate limits, reconnects, restarts) without human shepherding. Actionable feedback is the precondition for autopoietic evolution (`tele-10`).

**Faults.**
- **Silent Collapse** — error isolated from logs; system continues on a broken branch
- **Cascade Bomb** — one failure crashes the orchestrator; all in-flight work lost
- **Blocked Actor** — agent paused indefinitely on transient condition with no resume path
- **Non-Actionable Failure** — error surfaces but lacks the information to fix or retry

**Success Criteria.**
1. No silent failures — every failure logs to Audit and surfaces actionable feedback.
2. Error boundaries isolate failures; primary operations complete even when secondary operations fail.
3. Adapters resume cleanly after rate limits and network drops.
4. Agent restart never produces duplicate directives or hallucinated state.

---

## Tele #8 — Gated Recursive Integrity

**Hub ID:** `tele-8`. **Source:** new tele from AX-060 (Recursive Integrity), layered-construction aspect only (chaos-validation split to tele-9).

**Mandate.** Integrity proven from the core outward. No entity, layer, or system ascends to Layer N+1 until Layer N is bit-perfect and physically sealed. There is no "mostly verified" state.

**Mechanics.**
- **Sovereign Onion** — systems constructed as nested layers; each layer grounds the one above
- **Gated Ascension** — entry into any layer requires bit-perfect certification of the layer below
- **Law of Fallback** — failure at layer N triggers recursive audit of layers N-1 through L0; surface-patching forbidden
- **Binary Certification** — pass/fail gates only; no partial credit

**Rationale.** Prevents Foundation-of-Sand syndrome. High-level logic failures are almost always low-level drift surfacing. Stable cores eliminate the bug class where an abstraction fails because its substrate was never verified. Engineering Certainty at the base is the precondition for autonomous multi-agent work at the apex.

**Faults.**
- **Debugging Quicksand** — app-layer errors take weeks because the kernel bug was never found
- **Surface Patching** — symptoms addressed without audit of the failing layer
- **Foundation-of-Sand** — high abstractions built on unverified assumptions
- **Trust Collapse** — Director loses confidence because Ground Truth was never formally sealed

**Success Criteria.**
1. Each architectural layer has a binary pass/fail certification.
2. Layer N+1 cannot be activated/deployed without Layer N certification.
3. Failure at any layer triggers audit downward, not upward surface patch.
4. Architecture layers are explicitly enumerated with known ground-truth status for each.

---

## Tele #9 — Chaos-Validated Deployment

**Hub ID:** `tele-9`. **Source:** new tele from chaos aspect of pre-reset tele-6 (Deterministic Invincibility) + AX-070 (Virtual Grounding).

**Mandate.** If it cannot be proven under chaos in a sandboxed environment, it does not exist in production. Every merge to main is deterministically proven against simulated chaos — node death, packet loss, jitter, concurrency races, cascade failures — before it reaches real users.

**Mechanics.**
- **TestOrchestrator** simulates not just the Hub but the actual Architect and Engineer clients (local caches + network transports) in a sandboxed Dry Run
- **Chaos Ledger** — every system survives a standardized Level-9 entropy battery (node death, packet loss, jitter) before earning a deploy certificate
- **Reality Mirror** — production telemetry feeds back into the chaos environment; simulated entropy stays representative of real conditions
- **Simulation↔Production delta <1%** — if simulation deviates beyond threshold, the simulation is Broken and must be refactored before engineering continues
- Code does not merge to main unless the multi-agent graph resolves successfully under chaos

**Rationale.** Eliminates Operational Fear. Traditional "fear of breaking production" slows innovation; chaos-first eliminates the unknown. When something first touches hardware/users, it has already lived 1,000 years of simulated failure. Deterministic elimination of regressions across the distributed network is the multi-agent version of test coverage.

**Faults.**
- **Production Fragility** — org afraid to deploy because real-world impact is unknown
- **Hope-Based Engineering** — decisions on hunches instead of cycle-accurate data
- **Happy-Path Brittleness** — system works in tests, collapses under real-world entropy
- **Regression Leakage** — a race condition surfaces in prod that the tests didn't explore

**Success Criteria.**
1. TestOrchestrator covers every documented workflow under chaos (Level-9 entropy).
2. Merge-to-main gated on full chaos-path resolution.
3. Simulation ↔ production delta measurably <1%.
4. Production telemetry continuously tunes the simulation environment.

---

## Tele #10 — Autopoietic Evolution

**Hub ID:** `tele-10`. **Source:** preserves pre-reset tele-8 content; retroactive 4-section rewrite applied 2026-04-21.

**Mandate.** The system autonomously corrects itself and refines its own architecture. When a task fails, a thread deadlocks, or friction surfaces, the system detects its own friction, diagnoses the root cause, and proposes its own evolution.

**Mechanics.**
- Failure auto-spawns a `Bug` entity and initiates a post-mortem thread
- Architect and Engineer autonomously debate the failure, draft a Proposal/Design to fix it, and auto-scaffold the remediation Missions
- Single Director "Approve" click executes the self-healing chain
- Friction reflections (governance + workflow) embedded in every Report feed back into the Concept/Idea/Bug pool
- Engineer reflections surface patterns for triage into the Concept registry

**Rationale.** A multi-agent network that cannot self-correct drowns in operational debt. Autopoiesis is the closing of the loop: the same system that builds software builds its own refinement. Without it, every friction point stays ad-hoc and every lesson is re-learned.

**Faults.**
- **Friction Fossilization** — the same operational drag recurs without surfacing
- **Lesson Loss** — a failure teaches one session; the insight dies when the session ends
- **Manual Remediation** — humans must recognize, diagnose, and propose every fix
- **Post-Mortem Debt** — failures accumulate without formal diagnosis backlog

**Success Criteria.**
1. Every failed task/mission auto-spawns a Bug entity.
2. Every Report includes governance + workflow friction reflection sections (required; "no friction observed" is acceptable).
3. Self-healing chains (Bug → post-mortem → Proposal/Design → Mission) execute with single Director approval.
4. Concept registry accretes patterns from engineer reflections without manual triage.

---

## Tele #11 — Cognitive Minimalism

**Hub ID:** `tele-11`. **Source:** architect-proposed 2026-04-22 AEST per Director direction during 2026-04 architectural review Phase 1. Explicit exception to review anti-goal §7 ("Modifying the ratified Tele set"). Related: idea-107 M-Cognitive-Hypervisor umbrella, mission-38 five mitigations (round-budget awareness, parallel dispatch, tool-result caching, chunked replies, graceful exhaustion), idea-115 dynamic tool scope, idea-119 query-shape-engineering, idea-138 cost-aware tier routing.

**Mandate.** LLM tokens are the scarce economic resource. Every deterministic function is mechanized; the LLM is invoked only for genuinely cognitive work — judgment, creativity, ambiguity resolution. Maximum logic-per-token is the engineering objective.

**Mechanics.**
- **Substrate-First Principle** — if code can do it, code does it. LLMs handle irreducibly cognitive work only; everything else is substrate responsibility.
- **Token Accounting** — every prompt discloses its token budget; work that fits in deterministic code does not consume budget. Token consumption is a first-class telemetry signal.
- **Cognitive-Boundary Discipline** — the seam between deterministic substrate and cognitive agent is explicit, documented, and auditable per subsystem. Work drifts toward the cheaper side; drift the wrong way surfaces as a Fault.
- **Hydration-as-Offload** — pre-compute state, surfaces, and scoped tool-catalogs before LLM invocation. LLM reads (cheap) rather than derives (expensive). Composes with tele-5 Perceptual Parity on the mechanism but not the mandate.
- **Deterministic Primitives** — recurring patterns (retries, dedup, caching, routing, DAG stitching, state reconciliation, idempotency) live in substrate primitives, never in agent prompts. When an LLM-side workaround is observed for a pattern, the pattern becomes a substrate primitive candidate.
- **Economic Telemetry** — token cost per operation is observable; outlier paths surface for refactor; model-tier migrations (Opus → Sonnet → Haiku; quota-budget changes) do not require workload redesign.
- **Composition with adjacent teles.** tele-6 Frictionless covers anti-transcription *between actors*; Cognitive Minimalism covers the broader offload-to-substrate rule for *deterministic work within an actor's own cognitive loop*. tele-3 Sovereign Composition gives clean module boundaries; Cognitive Minimalism gives the rule for *which side of each boundary* a concern belongs on. tele-2 Isomorphic Specification says the spec drives the FSM (no LLM needed for workflow execution); Cognitive Minimalism generalizes that: no LLM needed for *any* deterministic execution.

**Rationale.** LLM token consumption is the dominant variable cost driver of a multi-agent network and the primary scarce resource. Without a first-principle that drives deterministic work to the substrate, agents silently absorb toil that could be mechanized — paying in tokens what a single function invocation could do for free, and burning context windows on ceremony that displaces judgment-capacity. Mission-38 (Cognitive Hypervisor) shipped five mitigations (round-budget awareness, parallel dispatch, tool-result caching, chunked replies, graceful exhaustion) that are each instantiations of this principle — but until the principle is named as a tele, each mitigation was framed as a local fix rather than a pattern manifestation. Naming it promotes the pattern from implicit to governing.

**Faults.**
- **LLM as Calculator** — cognitive agent doing deterministic work (counting, sorting, pattern-matching, schema-validation, repetitive transformation) that a function would perform in microseconds at zero token cost.
- **Substrate Leakage** — deterministic logic drifts into LLM prompts because the substrate doesn't expose a primitive for it; the workaround becomes permanent because no one refactors back.
- **Token Fragility** — workload becomes brittle to model-change, quota-limits, or tier-cost changes because it's doing too much per invocation.
- **Context Displacement** — genuinely cognitive work can't fit because administrative overhead consumed the context window; judgment quality degrades without the cause being visible.
- **Economic Blindness** — architecture ignores marginal-token-cost as a design constraint; inefficient patterns proliferate unobserved.
- **Prompt as Configuration** — operator parameters, routing rules, or schemas embedded in prompts where they should be explicit substrate configuration; changing behavior requires LLM-round execution instead of a config update.

**Success Criteria.**
1. Every recurring deterministic operation has a substrate primitive; LLM invocation of that operation is prevented by design (or flagged as a Fault + bug).
2. Token consumption per operation is observable via telemetry; outlier paths surface for refactor as a matter of course.
3. No LLM prompt contains work that a Hub primitive could perform instead; review catches violations.
4. The cognitive-boundary between substrate and agent is explicitly documented per subsystem (adapter, policy-router, cognitive-layer, cascade, etc.).
5. Model-tier migrations (cross-model, cross-quota, cross-vendor) do not require workload redesign — only configuration change.
6. Prompt context is dominated by genuinely cognitive content; administrative/transcription/pattern-matching overhead is negligible by construction.
7. When an LLM-side workaround for a deterministic pattern is observed, a substrate-primitive candidate is filed within one review cycle.

---

## Provenance & Cross-Reference

### Spec numbering ↔ Hub ID map

| # | Name | Hub ID | Pre-reset source (backed up) |
|---|---|---|---|
| 0 | Sovereign Intelligence Engine | `tele-0` | pre-reset `tele-9` |
| 1 | Sovereign State Transparency | `tele-1` | pre-reset `tele-1` + AX-010 |
| 2 | Isomorphic Specification | `tele-2` | pre-reset `tele-5` + AX-050 + FSM of pre-reset `tele-3` |
| 3 | Sovereign Composition | `tele-3` | idea-148 + AX-020 |
| 4 | Zero-Loss Knowledge | `tele-4` | AX-030 (full strength) |
| 5 | Perceptual Parity | `tele-5` | pre-reset `tele-7` + AX-040 |
| 6 | Frictionless Agentic Collaboration | `tele-6` | pre-reset `tele-2` |
| 7 | Resilient Agentic Operations | `tele-7` | pre-reset `tele-4` |
| 8 | Gated Recursive Integrity | `tele-8` | AX-060 (layered-construction only) |
| 9 | Chaos-Validated Deployment | `tele-9` | chaos aspect of pre-reset `tele-6` + AX-070 |
| 10 | Autopoietic Evolution | `tele-10` | pre-reset `tele-8` |
| 11 | Cognitive Minimalism | `tele-11` | architect-proposed 2026-04-22 per Director direction (not AX-harvested; orthogonal addition to the 2026-04-21 ratified set) |

Spec number equals Hub ID by design; 1-to-1 mapping is an invariant of the reset and of subsequent architect-authored additions.

### External axiom harvest

Source: `/home/apnex/taceng/ois/org/gov/axioms` (read-only external project; not filed in Hub)

| Axiom | Title | Incorporated into |
|---|---|---|
| AX-010 (KMS-META-010) | State Sovereignty | `tele-1` |
| AX-020 (KMS-META-020) | Interface Singularity | `tele-3` |
| AX-030 (KMS-META-030) | Knowledge Fidelity | `tele-4` |
| AX-040 (KMS-META-040) | Observability Symmetry | `tele-5` |
| AX-050 (KMS-META-050) | Declarative Primacy | `tele-2` |
| AX-060 (KMS-META-060) | Recursive Integrity | `tele-8` (layered construction only) |
| AX-070 (KMS-META-070) | Virtual Grounding | `tele-9` |

**Rejected for wholesale adoption:** Virtual-twin-as-primary-environment (AX-070 ceiling) — spirit kept in `tele-9`, literal adoption deferred as aspirational.

### Coordination artifacts

- **idea-149** — Tele audit + standardization pass (ratified outcome; teles 0-10)
- **idea-148** — Sovereign Composition source idea (landed as `tele-3`)
- **idea-152** — Smart NIC Adapter + Cognitive Implant Layer (architectural target-state that makes bug-25 structurally impossible)
- **idea-121** — Tool-surface v2.0 (home for `create_tele` manifest-gap diagnosis, MCP pagination class-of-defect, tool rationalisation follow-on)
- **tele-11 provenance** — Filed via `create_tele` MCP tool 2026-04-22 AEST during 2026-04 architectural review Phase 1. Director directed filing after architect diagnostic: existing teles 0-10 cover LLM token-efficiency concerns only compositionally (tele-6 anti-transcription + tele-3 logic-density + tele-2 spec-drives-FSM + tele-5 hydration); no single tele has "LLM tokens as scarce economic resource" as a first-class mandate. Director ratified filing as explicit exception to review anti-goal §7. Architect-as-proposer provenance (`createdBy: { role: "architect", agentId: "eng-40903c59d19f" }`) retained for forensic clarity; this does NOT lower the tele's authority vs teles 0-10 — Director direction carries the ratification, architect authored the text.
- **thread-243** — Original Engineer↔Architect coordination (unicast, Director-ratified). Filing blocked; superseded by direct-write path.
- **thread-244** — Per-tele filing retry for pre-reset Tele #1; content architect-ratified. Converged 2026-04-21 with direct-write resolution.
- **task-317** — Architect's self-queue marker for pre-reset Tele #1; cancelled after direct-write path completed.
- **scripts/seed-new-teles.ts** — Director-approved seed script (2026-04-21). Filed 7 new teles via `GcsTeleStore.defineTele` at IDs `tele-10`..`tele-16` as interim state.
- **scripts/reset-teles.ts** — Director-approved full reset script (2026-04-21). Backed up, deleted, and rewrote tele storage to achieve 1-to-1 spec-number ↔ Hub-ID mapping. Backup dir: `scripts/reset-teles-backup-2026-04-21T23-35-09-585Z/`.
- **bug-24** — Major: no retirement/supersede primitive for teles. 5 pre-reset retirements + 4 retroactive 4-section rewrites executed via direct-write workaround on 2026-04-21. Primitive still missing; bug remains open for future tele lifecycle operations.
- **bug-25** — Major: thread-message delivery truncation at ~10-15KB. Short-term mitigation (adapter size-guard) stance ratified; long-term fix via idea-152.

### Hub-state parity

**Target achieved (as of 2026-04-22).** Hub contains exactly 12 teles with IDs `tele-0`..`tele-11` matching spec numbering 1-to-1. Teles 0-10 authored in 4-section template with `director/seed-ratified-2026-04-21` provenance. Tele-11 authored in the same 4-section template with `architect/eng-40903c59d19f` provenance (Director-directed addition 2026-04-22; see Coordination artifacts above). `teleCounter` in `meta/counter.json` advanced to `11`; next live `create_tele` call would assign `tele-12`.

**Remaining blockers (for future tele lifecycle operations, not current state):**

| Blocker | Impact | Resolution requires |
|---|---|---|
| bug-24 | Future tele supersessions must use direct-write workaround | `supersede_tele` or equivalent lifecycle primitive |
| bug-25 | Large ratified specs truncate on delivery | Short-term: adapter size-guard on oversized tool_result. Long-term: idea-152 Smart NIC + Cognitive Implant Layer. |

**`create_tele` role gate + architect-adapter manifest issues** — both surfaced during this audit; both resolved via the direct-write workaround. Root causes deferred to idea-121 for proper diagnosis.
