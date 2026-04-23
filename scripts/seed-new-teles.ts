/**
 * seed-new-teles.ts — Director-ratified seed of the 7 new post-audit teles.
 *
 * BACKGROUND:
 *   The tele audit ratified in idea-149 produced 11 teles (1 umbrella + 10
 *   orthogonal). Seven are new and require filing; four are preserved
 *   as-is under their legacy IDs. The live `create_tele` path is blocked
 *   by adapter-surface issues (see bug-25-adjacent coordination); this
 *   script is the Director-approved backstop that writes directly through
 *   `GcsTeleStore.defineTele` — same store the Hub uses, same createOnly
 *   guarantees, bypassing only the adapter + policy-router layers.
 *
 * USAGE:
 *   GCS_BUCKET=<your-bucket> npx tsx scripts/seed-new-teles.ts
 *   GCS_BUCKET=<your-bucket> npx tsx scripts/seed-new-teles.ts --dry-run
 *
 * SAFETY:
 *   - Lists existing teles first; skips any whose `name` already exists
 *     (idempotent; safe to re-run)
 *   - `--dry-run` prints what would be written without calling GCS
 *   - Respects `createOnly` at the store layer — no overwrites possible
 *
 * PROVENANCE:
 *   Each seeded tele is stamped with `createdBy: { role: "director",
 *   agentId: "seed-ratified-2026-04-21" }` to distinguish from both the
 *   `legacy-pre-provenance` entries and future live-path creations.
 *
 * SOURCE OF TRUTH:
 *   `docs/specs/teles.md` + `documents/specs/teles.md` (Hub Document).
 *   Any edits to the tele bodies below MUST be mirrored to both.
 */

import { GcsTeleStore } from "../hub/src/entities/gcs/gcs-tele.js";
import type { EntityProvenance } from "../hub/src/state.js";

interface NewTeleDraft {
  name: string;
  description: string;
  successCriteria: string;
}

const SEED_PROVENANCE: EntityProvenance = {
  role: "director",
  agentId: "seed-ratified-2026-04-21",
};

// ─────────────────────────────────────────────────────────────────────
// The 7 new teles (ratified 2026-04-21 AEST via idea-149).
// ─────────────────────────────────────────────────────────────────────

const NEW_TELES: NewTeleDraft[] = [
  {
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

*Provenance: evolves legacy \`tele-1\` (persistence) + absorbs external axiom AX-010 (State Sovereignty) from OIS KMS-META-010. Director-ratified 2026-04-21 via idea-149.*`,
    successCriteria: `1. Every persistent entity (Idea, Mission, Task, Turn, Tele, etc.) survives Hub restart with identical field values.
2. No agent or tool holds state that another authorized agent cannot query.
3. Topology changes go through formal refactor; value changes do not.`,
  },
  {
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

*Provenance: preserves legacy \`tele-5\` + absorbs AX-050 (Declarative Primacy) + FSM aspect of legacy \`tele-3\`. Director-ratified 2026-04-21 via idea-149.*`,
    successCriteria: `1. The PolicyRouter parses the sovereign spec at runtime to generate FSMs (not compiled-in).
2. Zero "Unhandled event" logs during normal multi-agent operation.
3. 100% FSM coverage of documented workflows by TestOrchestrator (negative + chaos paths included).
4. Active state mismatches with declared intent are detected and reverted.`,
  },
  {
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

*Provenance: evolves legacy \`tele-7\` (Perfect Contextual Hydration) + absorbs AX-040 (Observability Symmetry). Director-ratified 2026-04-21 via idea-149.*`,
    successCriteria: `1. Agents never ask "what is the status of X?" — the system hydrates before the question arises.
2. Director↔agent perception delta measurably <1% on shared entities.
3. Agent output perceived in context (framebuffer/TUI/kinetic) before cognitive decision.
4. Hallucinated state counts as a bug, not expected behavior.`,
  },
  {
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

*Provenance: new tele from AX-060 (Recursive Integrity), layered-construction aspect only (chaos-validation split to separate tele). Director-ratified 2026-04-21 via idea-149.*`,
    successCriteria: `1. Each architectural layer has a binary pass/fail certification.
2. Layer N+1 cannot be activated/deployed without Layer N certification.
3. Failure at any layer triggers audit downward, not upward surface patch.
4. Architecture layers are explicitly enumerated with known ground-truth status for each.`,
  },
  {
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

*Provenance: new tele from chaos aspect of legacy \`tele-6\` (Deterministic Invincibility) + AX-070 (Virtual Grounding). Director-ratified 2026-04-21 via idea-149.*`,
    successCriteria: `1. TestOrchestrator covers every documented workflow under chaos (Level-9 entropy).
2. Merge-to-main gated on full chaos-path resolution.
3. Simulation ↔ production delta measurably <1%.
4. Production telemetry continuously tunes the simulation environment.`,
  },
];

// ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const bucket = process.env.GCS_BUCKET;
  if (!bucket) {
    console.error("ERROR: GCS_BUCKET env var must be set.");
    console.error("Usage: GCS_BUCKET=<bucket> npx tsx scripts/seed-new-teles.ts [--dry-run]");
    process.exit(1);
  }

  console.log(`Seed target: gs://${bucket}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Provenance stamp: ${JSON.stringify(SEED_PROVENANCE)}`);
  console.log();

  const store = new GcsTeleStore(bucket);

  // Read existing teles — keyed by (name + seed-provenance) for idempotency.
  // Skip only if a prior run of THIS seed already created the same name;
  // do NOT skip because a legacy tele of the same name exists (that's
  // the whole point — the new 4-section body supersedes legacy content).
  const existing = await store.listTele();
  const existingSeededNames = new Set(
    existing
      .filter((t) => t.createdBy?.agentId === SEED_PROVENANCE.agentId)
      .map((t) => t.name),
  );
  console.log(`Existing teles in bucket: ${existing.length}`);
  for (const t of existing) {
    const seedMark = t.createdBy?.agentId === SEED_PROVENANCE.agentId ? "  [SEEDED]" : "";
    console.log(`  [${t.id}] ${t.name}${seedMark}`);
  }
  console.log();

  let created = 0;
  let skipped = 0;

  for (const draft of NEW_TELES) {
    if (existingSeededNames.has(draft.name)) {
      console.log(`  SKIP  "${draft.name}" — already seeded by this script`);
      skipped++;
      continue;
    }
    if (dryRun) {
      console.log(`  DRY   "${draft.name}" — would create (${draft.description.length} char desc, ${draft.successCriteria.length} char criteria)`);
      continue;
    }
    const tele = await store.defineTele(
      draft.name,
      draft.description,
      draft.successCriteria,
      SEED_PROVENANCE,
    );
    console.log(`  NEW   [${tele.id}] "${tele.name}"`);
    created++;
  }

  console.log();
  console.log(`Summary: ${created} created, ${skipped} skipped${dryRun ? " (dry-run — nothing written)" : ""}.`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
