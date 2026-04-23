/**
 * reset-teles.ts — Director-ratified full reset of tele storage.
 *
 * GOAL: Hub holds exactly 11 teles with IDs `tele-0` through `tele-10`
 * mapped 1-to-1 against the ratified audit numbering (idea-149).
 * Every tele uses the 4-section template (Mandate / Mechanics / Rationale
 * / Faults + Success Criteria) — including the 4 previously-"preserved"
 * legacy entries (#0, #6, #7, #10) which get their retroactive rewrite
 * as part of this reset.
 *
 * OPERATIONS (in order):
 *   1. Back up every existing `tele/*.json` to a timestamped local dir
 *   2. Delete all existing tele JSONs from GCS
 *   3. Write 11 new tele JSONs directly at `tele/tele-0.json`..`tele-10.json`
 *   4. Update `meta/counter.json` with `teleCounter: 11` (preserving all
 *      other counter fields)
 *   5. Verify — list + spot-check
 *
 * USAGE:
 *   GOOGLE_APPLICATION_CREDENTIALS=<key> GCS_BUCKET=<bucket> npx tsx scripts/reset-teles.ts
 *   ... --dry-run    (print plan, no writes/deletes)
 *
 * SAFETY:
 *   - Backup is unconditional — always runs before any destructive op
 *   - counter.json read-modify-write preserves task/idea/thread/etc counters
 *   - Bypasses `defineTele` because its increment-then-return semantic
 *     can't produce `tele-0`; raw writes at controlled paths instead
 *   - `tele-0.json` uses 0 as the numeric ID; no collision risk with
 *     counter-based future creates (counter set to 11 means next auto
 *     create becomes `tele-11`)
 *
 * PROVENANCE:
 *   Every written tele is stamped with
 *   `createdBy: { role: "director", agentId: "seed-ratified-2026-04-21" }`.
 *
 * IRREVERSIBLE?
 *   Destructive but recoverable via the local backup dir written in step 1.
 *   Keep that dir until you've verified the new state is healthy.
 */

import { Storage } from "@google-cloud/storage";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SEED_PROVENANCE = {
  role: "director",
  agentId: "seed-ratified-2026-04-21",
};

interface TeleBody {
  audit: number;
  name: string;
  description: string;
  successCriteria: string;
}

// ─────────────────────────────────────────────────────────────────────
// The 11 ratified teles in 4-section format (idea-149, 2026-04-21 AEST).
// Ordered 0..10 to map 1-to-1 with Hub IDs `tele-0`..`tele-10`.
// ─────────────────────────────────────────────────────────────────────

const TELES: TeleBody[] = [
  {
    audit: 0,
    name: "Sovereign Intelligence Engine",
    description: `**Mandate.** Directors provide strategic intent; a network of specialized autonomous agents collaboratively design, build, test, deploy, and self-heal complex software systems with zero administrative friction, mathematical correctness, and perfect institutional memory.

**Mechanics.**
- Hierarchy: Director → Architect → Engineer → Hub, each sovereign in its domain
- Hub as deterministic facilitator translating approved intent into executable state
- Every other tele (#1–#10) composes as a necessary sub-condition of this umbrella
- Directors manipulate strategic what-if; automated substrates handle imperative how-to

**Rationale.** The 10 orthogonal teles collectively compose this vision. Without a named umbrella, future teles drift without a unifying reference, and the Director loses a single handle for "why are we doing any of this?" The umbrella is the constitutional north star.

**Faults.**
- **Fragmented Asymptote** — contributors optimize locally without knowing the global target
- **Umbrella Amnesia** — new teles proposed that contradict the vision go unchallenged
- **Director Fatigue** — strategic intent requires translation overhead because no ground-truth vision exists

*Role: umbrella vision. Director-ratified 2026-04-21 via idea-149.*`,
    successCriteria: `1. Every tele (tele-1 through tele-10) demonstrably composes as a necessary sub-condition of this umbrella.
2. Every mission, design, and idea traces (transitively) to at least one of tele-1..tele-10 and therefore to this tele.
3. Directors never provide low-level how-to; strategic intent alone is sufficient to drive the network.`,
  },
  {
    audit: 1,
    name: "Sovereign State Transparency",
    description: `**Mandate.** All system truth lives in a sovereign, structured, decoupled state-backplane. No functional unit possesses private, opaque, or transient truth; all state is perceivable by any authorized entity and durable across any infrastructure restart.

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

*Provenance: evolves pre-reset tele-1 (persistence) + absorbs external axiom AX-010 (State Sovereignty) from OIS KMS-META-010. Director-ratified 2026-04-21 via idea-149.*`,
    successCriteria: `1. Every persistent entity (Idea, Mission, Task, Turn, Tele, etc.) survives Hub restart with identical field values.
2. No agent or tool holds state that another authorized agent cannot query.
3. Topology changes go through formal refactor; value changes do not.`,
  },
  {
    audit: 2,
    name: "Isomorphic Specification",
    description: `**Mandate.** The specification IS the system. Human-readable intent and machine-executable reality are mathematically identical. The Manifest is the Master — no state changes through imperative drift; declared intent auto-reconciles the active system.

**Mechanics.**
- The \`workflow-registry\` (and equivalent spec documents) is the configuration the Hub's PolicyRouter parses at runtime to generate FSMs
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

*Provenance: preserves pre-reset tele-5 + absorbs AX-050 (Declarative Primacy) + FSM aspect of pre-reset tele-3. Director-ratified 2026-04-21 via idea-149.*`,
    successCriteria: `1. The PolicyRouter parses the sovereign spec at runtime to generate FSMs (not compiled-in).
2. Zero "Unhandled event" logs during normal multi-agent operation.
3. 100% FSM coverage of documented workflows by TestOrchestrator (negative + chaos paths included).
4. Active state mismatches with declared intent are detected and reverted.`,
  },
  {
    audit: 3,
    name: "Sovereign Composition",
    description: `**Mandate.** Every module is a self-contained sovereign unit owning exactly one concern, exposing bit-perfect semantic interfaces, composing without leaking internals. God objects, spaghetti coupling, and dual-purpose modules are structurally impossible.

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

*Provenance: new tele from idea-148 + AX-020 (Interface Singularity). Director-ratified 2026-04-21 via idea-149.*`,
    successCriteria: `1. Every module/class owns exactly one concern; no accretion-bucket modules.
2. All inter-module interaction goes through declared contracts.
3. New capabilities arrive by composition, not modification.
4. Modules can be understood in isolation from their contract alone.
5. Boundary violations detectable by review or tooling.`,
  },
  {
    audit: 4,
    name: "Zero-Loss Knowledge",
    description: `**Mandate.** Information is an engineering product. Summarization is loss. All organizational knowledge is authored and maintained at bit-perfect fidelity — expansion over summarization, structure over prose, mechanics-rationale-consequence in every artifact.

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

*Provenance: new tele from AX-030 (Knowledge Fidelity), adopted at full strength. Director-ratified 2026-04-21 via idea-149.*`,
    successCriteria: `1. Every artifact (idea, design, manifest, mission, report) includes Mechanics + Rationale + Consequence sections.
2. Prose appears only as wrapping around structured content.
3. Session handover loses zero decision context (cold-session pickup produces same outputs as warm).
4. Documentation volume exceeds raw intent volume consistently.`,
  },
  {
    audit: 5,
    name: "Perceptual Parity",
    description: `**Mandate.** Humans and agents share symmetric perception of reality. The delta between a Director's view of the system and an agent's view is <1%. Every actor's prompt is hydrated with mathematically verified ground truth before generating a single token.

**Mechanics.**
- Real-time state rendered through pre-attentive channels (human-parsable and agent-ingestible in <300ms)
- Agents possess Synthetic Sensory Organs (framebuffers, TUI mirrors, kinetic streams) to perceive their own output in context
- Prompts auto-hydrated with current Hub state (via \`get_pending_actions\`, semantic query, observability surfaces) before cognitive loops begin
- Director↔agent perception delta measurably <1%

**Rationale.** Without symmetry, agents are blind to consequences of their logic — they produce output that passes tests but fails the Reality-Test. Directors become "eyes" for agents, destroying workflow density. Symmetric perception enables Self-Correcting Synthesis: agents observe friction in their own output and refactor before humans notice.

**Faults.**
- **Cognitive Friction** — Director forced to act as eyes for the agent
- **Black-Box Failure** — agent output satisfies unit tests but fails reality tests
- **Architect Amnesia** — agents hallucinate state instead of perceiving it
- **Operational Lag** — org reacts to logs instead of feeling system pulse

*Provenance: evolves pre-reset tele-7 (Perfect Contextual Hydration) + absorbs AX-040 (Observability Symmetry). Director-ratified 2026-04-21 via idea-149.*`,
    successCriteria: `1. Agents never ask "what is the status of X?" — the system hydrates before the question arises.
2. Director↔agent perception delta measurably <1% on shared entities.
3. Agent output perceived in context (framebuffer/TUI/kinetic) before cognitive decision.
4. Hallucinated state counts as a bug, not expected behavior.`,
  },
  {
    audit: 6,
    name: "Frictionless Agentic Collaboration",
    description: `**Mandate.** Multi-agent collaboration occurs with zero administrative friction. No actor manually transcribes approved data, performs redundant tool calls, or produces context-wasting boilerplate. The Hub seamlessly translates approved intent into executable state.

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

*Provenance: preserves pre-reset tele-2 content; retroactive 4-section rewrite applied 2026-04-21. Director-ratified via idea-149.*`,
    successCriteria: `1. No actor ever copy-pastes approved Proposal/Thread content into a downstream entity.
2. Ratification → execution is a single tool call or auto-cascade.
3. Architect never blocked on Engineer-admin; Engineer never blocked on Architect-admin.
4. Policy Router enforces DAG invisibly — no agent constructs dependency graphs manually.`,
  },
  {
    audit: 7,
    name: "Resilient Agentic Operations",
    description: `**Mandate.** The Agentic Network is self-healing, resilient to transient failures, and provides actionable feedback at every surface. No operation fails silently; no actor is permanently blocked by a system error.

**Mechanics.**
- Policy Router strictly isolates errors — failed DAG cascade does not crash primary task completion
- Asynchronous operations (auto-linkage, notification delivery) wrapped in error boundaries; failures log to Audit without failing the primary request
- Adapters robustly handle rate-limiting + network drops via deferred backlog + state-based reconnect (\`get_pending_actions\`)
- Agent event loops fully hydrated on startup; no duplicate directives, no hallucinated state
- All failures surface actionable feedback (\`revision_required\`, \`cascade_failure\`)

**Rationale.** In an autonomous multi-agent network, silent failures compound into system-wide incoherence. Agents must resume after transient disruption (rate limits, reconnects, restarts) without human shepherding. Actionable feedback is the precondition for autopoietic evolution (tele-10).

**Faults.**
- **Silent Collapse** — error isolated from logs; system continues on a broken branch
- **Cascade Bomb** — one failure crashes the orchestrator; all in-flight work lost
- **Blocked Actor** — agent paused indefinitely on transient condition with no resume path
- **Non-Actionable Failure** — error surfaces but lacks the information to fix or retry

*Provenance: preserves pre-reset tele-4 content; retroactive 4-section rewrite applied 2026-04-21. Director-ratified via idea-149.*`,
    successCriteria: `1. No silent failures — every failure logs to Audit and surfaces actionable feedback.
2. Error boundaries isolate failures; primary operations complete even when secondary operations fail.
3. Adapters resume cleanly after rate limits and network drops.
4. Agent restart never produces duplicate directives or hallucinated state.`,
  },
  {
    audit: 8,
    name: "Gated Recursive Integrity",
    description: `**Mandate.** Integrity proven from the core outward. No entity, layer, or system ascends to Layer N+1 until Layer N is bit-perfect and physically sealed. There is no "mostly verified" state.

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

*Provenance: new tele from AX-060 (Recursive Integrity), layered-construction aspect only (chaos-validation split to tele-9). Director-ratified 2026-04-21 via idea-149.*`,
    successCriteria: `1. Each architectural layer has a binary pass/fail certification.
2. Layer N+1 cannot be activated/deployed without Layer N certification.
3. Failure at any layer triggers audit downward, not upward surface patch.
4. Architecture layers are explicitly enumerated with known ground-truth status for each.`,
  },
  {
    audit: 9,
    name: "Chaos-Validated Deployment",
    description: `**Mandate.** If it cannot be proven under chaos in a sandboxed environment, it does not exist in production. Every merge to main is deterministically proven against simulated chaos — node death, packet loss, jitter, concurrency races, cascade failures — before it reaches real users.

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

*Provenance: new tele from chaos aspect of pre-reset tele-6 (Deterministic Invincibility) + AX-070 (Virtual Grounding). Director-ratified 2026-04-21 via idea-149.*`,
    successCriteria: `1. TestOrchestrator covers every documented workflow under chaos (Level-9 entropy).
2. Merge-to-main gated on full chaos-path resolution.
3. Simulation ↔ production delta measurably <1%.
4. Production telemetry continuously tunes the simulation environment.`,
  },
  {
    audit: 10,
    name: "Autopoietic Evolution",
    description: `**Mandate.** The system autonomously corrects itself and refines its own architecture. When a task fails, a thread deadlocks, or friction surfaces, the system detects its own friction, diagnoses the root cause, and proposes its own evolution.

**Mechanics.**
- Failure auto-spawns a \`Bug\` entity and initiates a post-mortem thread
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

*Provenance: preserves pre-reset tele-8 content; retroactive 4-section rewrite applied 2026-04-21. Director-ratified via idea-149.*`,
    successCriteria: `1. Every failed task/mission auto-spawns a Bug entity.
2. Every Report includes governance + workflow friction reflection sections (required; "no friction observed" is acceptable).
3. Self-healing chains (Bug → post-mortem → Proposal/Design → Mission) execute with single Director approval.
4. Concept registry accretes patterns from engineer reflections without manual triage.`,
  },
];

// ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const bucket = process.env.GCS_BUCKET;
  if (!bucket) {
    console.error("ERROR: GCS_BUCKET env var required.");
    process.exit(1);
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("ERROR: GOOGLE_APPLICATION_CREDENTIALS env var required.");
    process.exit(1);
  }

  if (TELES.length !== 11) {
    console.error(`ERROR: expected 11 teles in TELES[], found ${TELES.length}`);
    process.exit(1);
  }
  // Verify audit numbers are 0..10 in order
  for (let i = 0; i < 11; i++) {
    if (TELES[i].audit !== i) {
      console.error(`ERROR: TELES[${i}].audit is ${TELES[i].audit}, expected ${i}`);
      process.exit(1);
    }
  }

  console.log(`Target bucket: gs://${bucket}`);
  console.log(`Dry run:       ${dryRun}`);
  console.log(`Target state:  11 teles at tele/tele-0.json .. tele/tele-10.json`);
  console.log(`Provenance:    ${JSON.stringify(SEED_PROVENANCE)}`);
  console.log();

  const storage = new Storage();
  const gcsBucket = storage.bucket(bucket);

  // ── Step 1: list existing teles ─────────────────────────────────
  const [files] = await gcsBucket.getFiles({ prefix: "tele/" });
  const teleFiles = files.filter((f) => f.name.endsWith(".json"));
  console.log(`Existing tele files: ${teleFiles.length}`);
  for (const f of teleFiles) console.log(`  ${f.name}`);
  console.log();

  // ── Step 2: backup ──────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = resolve(process.cwd(), `scripts/reset-teles-backup-${stamp}`);
  if (!dryRun) {
    mkdirSync(backupDir, { recursive: true });
    console.log(`Backup dir: ${backupDir}`);
    for (const f of teleFiles) {
      const [buf] = await f.download();
      const localName = f.name.replace(/^tele\//, "");
      writeFileSync(resolve(backupDir, localName), buf);
      console.log(`  backed up ${f.name} (${buf.length} bytes)`);
    }
  } else {
    console.log(`(dry-run) would backup ${teleFiles.length} files to ${backupDir}`);
  }
  console.log();

  // ── Step 3: delete existing teles ───────────────────────────────
  if (!dryRun) {
    for (const f of teleFiles) {
      await f.delete();
      console.log(`  deleted ${f.name}`);
    }
  } else {
    console.log(`(dry-run) would delete ${teleFiles.length} files`);
  }
  console.log();

  // ── Step 4: write 11 new teles ──────────────────────────────────
  const now = new Date().toISOString();
  for (const body of TELES) {
    const id = `tele-${body.audit}`;
    const path = `tele/${id}.json`;
    const json = {
      id,
      name: body.name,
      description: body.description,
      successCriteria: body.successCriteria,
      createdBy: SEED_PROVENANCE,
      createdAt: now,
    };
    if (!dryRun) {
      await gcsBucket.file(path).save(JSON.stringify(json, null, 2), {
        contentType: "application/json",
      });
      console.log(`  wrote ${path} (${body.name})`);
    } else {
      console.log(`(dry-run) would write ${path} (${body.name}, ${body.description.length + body.successCriteria.length} body chars)`);
    }
  }
  console.log();

  // ── Step 5: update counter (read-modify-write) ─────────────────
  const counterFile = gcsBucket.file("meta/counter.json");
  const [counterBuf] = await counterFile.download();
  const counters = JSON.parse(counterBuf.toString("utf-8"));
  const oldTeleCounter = counters.teleCounter;
  // Set to 10 so the next getAndIncrementCounter call produces 11 → tele-11
  // (increment-then-return semantic). Counter value = highest used ID.
  counters.teleCounter = 10;
  console.log(`Counter: teleCounter ${oldTeleCounter} → 10 (next auto-create would be tele-11)`);
  if (!dryRun) {
    await counterFile.save(JSON.stringify(counters, null, 2), {
      contentType: "application/json",
    });
    console.log(`  counter.json updated`);
  } else {
    console.log(`(dry-run) would update counter.json`);
  }
  console.log();

  // ── Step 6: verify ──────────────────────────────────────────────
  if (!dryRun) {
    const [verifyFiles] = await gcsBucket.getFiles({ prefix: "tele/" });
    const verifyJsons = verifyFiles.filter((f) => f.name.endsWith(".json"));
    console.log(`Verify: ${verifyJsons.length} tele files after reset`);
    const expectedPaths = TELES.map((t) => `tele/tele-${t.audit}.json`).sort();
    const actualPaths = verifyJsons.map((f) => f.name).sort();
    const match = JSON.stringify(expectedPaths) === JSON.stringify(actualPaths);
    console.log(`  expected paths: ${JSON.stringify(expectedPaths)}`);
    console.log(`  actual paths:   ${JSON.stringify(actualPaths)}`);
    console.log(`  match: ${match ? "YES" : "NO"}`);
    if (!match) {
      console.error("ERROR: post-reset verification failed");
      process.exit(1);
    }
  }

  console.log();
  console.log("Reset complete.");
}

main().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
