/**
 * mission-103 P3-S2 — the curated tele→axiom pair spec for the fidelity suite.
 *
 * Each pair carries the load-bearing concept checklists the axiom's Mandate /
 * Mechanics / Success-signals sections must cover (D2/D3/D5), derived faithfully
 * from the paired tele's content. The fault-scar coverage (D4) is driven by the
 * tele's own fault names (from the frozen snapshot) via FAULT_RENAMES for the two
 * deliberate renames. Concepts are case-insensitive regex sources; a pair passes
 * a dimension only when EVERY listed concept is present in the axiom section.
 *
 * The map (design §4): tele-1..13→A1..13, tele-14→A0 (umbrella), tele-15→A14.
 */

export interface PairSpec {
  axiom: string;
  tele: string;
  umbrella?: boolean;
  mandateConcepts: string[];
  mechanicsConcepts: string[];
  scConcepts: string[];
}

/** Deliberate fault-name renames axiom-side (everything else is identity). */
export const FAULT_RENAMES: Record<string, Record<string, string>> = {
  A0: { "Director Fatigue": "Principal Fatigue" },
  A6: { "DAG Manual Stitching": "Dependency Manual Stitching" },
};

export const PAIRS: PairSpec[] = [
  {
    axiom: "A0",
    tele: "tele-14",
    umbrella: true,
    mandateConcepts: ["strategic", "autonomous agents", "zero administrative friction", "institutional memory", "what-if", "how-to"],
    mechanicsConcepts: ["Sovereign Hierarchy", "Deterministic Facilitator", "Intent / Execution Separation", "Autonomous Lifecycle", "Compositional Stack"],
    scConcepts: ["sub-condition", "traces", "low-level how-to"],
  },
  {
    axiom: "A1",
    tele: "tele-1",
    mandateConcepts: ["sovereign", "backplane", "perceivable", "durable", "restart"],
    mechanicsConcepts: ["physical object", "stateless", "read, transform", "version-locked", "identical field values"],
    scConcepts: ["identical field values", "cannot query", "formal.*refactor"],
  },
  {
    axiom: "A2",
    tele: "tele-2",
    mandateConcepts: ["specification is the system", "mathematically identical", "manifest is the master", "auto-reconciles"],
    mechanicsConcepts: ["parses at runtime", "state machine", "auto-reverted", "zero delta"],
    scConcepts: ["parses the sovereign spec at runtime", "unhandled", "conformance", "detected and reverted"],
  },
  {
    axiom: "A3",
    tele: "tele-3",
    mandateConcepts: ["one concern", "bit-perfect", "leaking internals", "structurally impossible"],
    mechanicsConcepts: ["Law of One", "Air-Gap", "Semantic Bit-Masking", "Composable", "Local Reasoning", "Logic Density"],
    scConcepts: ["one concern", "declared contracts", "composition, not", "in isolation"],
  },
  {
    axiom: "A4",
    tele: "tele-4",
    mandateConcepts: ["engineering product", "Summarization is loss", "bit-perfect fidelity", "expansion over summarization"],
    mechanicsConcepts: ["Expansionist", "Load-Bearing", "Anti-Prose", "collective"],
    scConcepts: ["Mechanics", "Rationale", "Consequence", "wrapping around structured", "cold pickup", "exceeds"],
  },
  {
    axiom: "A5",
    tele: "tele-5",
    mandateConcepts: ["symmetric perception", "delta", "hydrated with verified ground truth"],
    mechanicsConcepts: ["Pre-Attentive", "Synthetic Sensory", "Auto-Hydration", "Measured Parity"],
    scConcepts: ["never ask", "perception delta", "in context", "Hallucinated state"],
  },
  {
    axiom: "A6",
    tele: "tele-6",
    mandateConcepts: ["zero administrative friction", "transcribes", "boilerplate", "translates approved intent"],
    mechanicsConcepts: ["Zero Transcription", "Atomic Transitions", "Role Purity", "Dependency-Graph"],
    scConcepts: ["copy-paste", "single tool call", "blocked on another role", "dependency graph"],
  },
  {
    axiom: "A7",
    tele: "tele-7",
    mandateConcepts: ["self-healing", "transient failures", "actionable feedback", "fails silently"],
    mechanicsConcepts: ["Error Isolation", "Error Boundaries", "backlog", "rehydrate", "Actionable Signals"],
    scConcepts: ["No silent failures", "Error boundaries isolate", "resume cleanly", "duplicate directives"],
  },
  {
    axiom: "A8",
    tele: "tele-8",
    mandateConcepts: ["core outward", "layer N.?1", "bit-perfect", "physically sealed", "mostly verified"],
    mechanicsConcepts: ["Sovereign Onion", "Gated Ascension", "Law of Fallback", "Binary Certification"],
    scConcepts: ["binary pass/fail", "cannot be activated", "audit downward", "enumerated"],
  },
  {
    axiom: "A9",
    tele: "tele-9",
    mandateConcepts: ["proven under chaos", "sandboxed", "node death", "packet loss", "real users"],
    mechanicsConcepts: ["Full-Stack Simulation", "Entropy Battery", "Telemetry Feedback", "Fidelity", "Trunk Gate"],
    scConcepts: ["entropy battery", "gated on full chaos", "delta is measurably", "telemetry continuously tunes"],
  },
  {
    axiom: "A10",
    tele: "tele-10",
    mandateConcepts: ["autonomously corrects", "root cause", "proposes its own evolution"],
    mechanicsConcepts: ["auto-spawns", "post-mortem", "single human approval", "reflections"],
    scConcepts: ["auto-spawns a defect", "friction reflection", "single human approval", "concept registry"],
  },
  {
    axiom: "A11",
    tele: "tele-11",
    mandateConcepts: ["tokens are the scarce", "deterministic function is mechanized", "genuinely cognitive", "logic-per-token"],
    mechanicsConcepts: ["Substrate-First", "Token Accounting", "Cognitive-Boundary", "Hydration-as-Offload", "Deterministic Primitives", "Economic Telemetry"],
    scConcepts: ["recurring deterministic operation has a primitive", "token consumption is observable", "No prompt contains work", "documented per subsystem", "Model-tier migrations"],
  },
  {
    axiom: "A12",
    tele: "tele-12",
    mandateConcepts: ["precision-engineered", "information density per token", "bounded, structured", "margin"],
    mechanicsConcepts: ["Bounded Accumulation", "Capped Per-Response", "Structured-over-Prose", "Context-Ordering", "Virtual Tokens Saved", "Shape-Aware"],
    scConcepts: ["explicit size budget", "structured wherever the data has shape", "Virtual Tokens Saved", "attention-strength", "emission source"],
  },
  {
    axiom: "A13",
    tele: "tele-13",
    mandateConcepts: ["irreplaceable, non-scalable", "augments, offloads", "Director attention", "authority is never delegated"],
    mechanicsConcepts: ["Intent-Interface Evolution", "Revealed-Preference", "Lean-as-Tie-Break", "Attention-as-the-Scarce", "Authority Non-Delegation"],
    scConcepts: ["strategic judgment", "full, unbiased option set", "ratify/approve/decide", "single Director approval", "trends"],
  },
  {
    axiom: "A14",
    tele: "tele-15",
    mandateConcepts: ["path of greatest learning", "invested capital", "captured durably", "compounding"],
    mechanicsConcepts: ["root cause, never workaround", "Capture-on-discovery", "adjacency", "attention ledger", "Compounding is traceable"],
    scConcepts: ["mined to root cause", "durable queryable state", "does not recur", "traceable payback", "toil", "invariants"],
  },
];
