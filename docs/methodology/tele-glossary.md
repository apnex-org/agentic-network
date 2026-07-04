# Tele Glossary — lookup table

**Status:** v1.1 (work-76 S0-TELE 2026-07-04; MINOR bump per Update protocol — tele-13 row added + umbrella census-refresh tele-0→tele-14. Prior: v1.0, mission-67 close 2026-04-30, first hardened version per Design v1.3 §6.2)
**Tier:** 1 (per `mission-lifecycle.md` v1.2 + Design v1.3 §1.2 tier-by-location rule)
**Scope:** load-bearing decoder for inline tele-N references across the methodology + Tier 0 directive surfaces. Cold-session pickup MUST be able to decode `tele-12 (attention-ordering)` style references without out-of-band knowledge.
**Bound at runtime via:** `CLAUDE.md` §4 Cold-pickup primary surfaces + §5 Companion policies index
**Canonical source:** Hub `list_tele` MCP tool — query for current ratified Tele set; this glossary is a derived lookup table (not source-of-truth)

---

## Purpose

Decode tele-N short-references in methodology docs + CLAUDE.md Tier 0 directives. The Hub Tele entities are the canonical source; this glossary is a low-effort load-bearing decoder for inline references.

## Tele lookup

| ID | Short name | Mandate (1-line) |
|---|---|---|
| **tele-14** | Sovereign Intelligence Engine | Umbrella vision: Director strategic intent + autonomous agents collaboratively design/build/test/deploy with zero administrative friction + mathematical correctness + perfect institutional memory. Supersedes **tele-0** (2026-07-04 census refresh: stale "#1–#10" → tele-1..tele-13); legacy `tele-0` references decode here |
| **tele-1** | Sovereign State Transparency | All system truth in sovereign structured decoupled state-backplane; no functional unit possesses private/opaque/transient truth |
| **tele-2** | Isomorphic Specification | The specification IS the system; human-readable intent + machine-executable reality mathematically identical; manifest is master |
| **tele-3** | Sovereign Composition | Every module is self-contained sovereign unit owning exactly one concern; bit-perfect semantic interfaces; composes without leaking internals |
| **tele-4** | Zero-Loss Knowledge | Information is engineering product; summarization is loss; expansionist bias; load-bearing context (Mechanics + Rationale + Consequence in every artifact) |
| **tele-5** | Perceptual Parity | Humans + agents share symmetric perception of reality; Director↔agent perception delta <1%; auto-hydrated context before cognitive loops |
| **tele-6** | Frictionless Agentic Collaboration | Multi-agent collaboration with zero administrative friction; no transcription toil; atomic ratification→execution transitions; role purity |
| **tele-7** | Resilient Agentic Operations | Self-healing + resilient to transient failures + actionable feedback at every surface; no silent failures; no permanent agent block |
| **tele-8** | Gated Recursive Integrity | Integrity proven from core outward; gated ascension layer-by-layer; binary pass/fail certification; failure triggers downward audit |
| **tele-9** | Chaos-Validated Deployment | Cannot prove under chaos in sandboxed environment → does not exist in production; merge-to-main gated on chaos-path resolution; sim↔prod delta <1% |
| **tele-10** | Autopoietic Evolution | System autonomously corrects itself + refines architecture; failure auto-spawns Bug + post-mortem thread; single Director "Approve" executes self-healing chain |
| **tele-11** | Cognitive Minimalism | LLM tokens are scarce; deterministic work mechanized; LLM invoked only for cognitive work (judgment / creativity / ambiguity); maximum logic-per-token |
| **tele-12** | Precision Context Engineering | Every LLM invocation's context precision-engineered for maximum information density per token; bounded accumulation + structured-over-prose + attention-ordering discipline |
| **tele-13** | Director Intent Amplification | The single human Director is the one irreplaceable non-scalable resource; system continuously evolves intent-elicitation/resolution interfaces to maximize Director-intent resolved per unit of Director attention; revealed-preference leans advisory tie-break only; final authority always the Director's |

## Common inline-reference shorthand decoders

The methodology docs use parenthetical short-names alongside tele-N references. Convention:
- `tele-N (short-name)` — first-use in a doc OR canonical-cite shape
- `tele-N` standalone — second+ uses where the short-name is established in same doc

| Reference seen inline | Decoder (this glossary row) |
|---|---|
| `tele-12 attention-ordering` | tele-12 Precision Context Engineering — attention-ordering discipline (positions high-signal content where LLM attention is strongest) |
| `tele-4 load-bearing-context` | tele-4 Zero-Loss Knowledge — load-bearing context (every artifact carries Mechanics + Rationale + Consequence) |
| `tele-2 isomorphic-spec` / `tele-2 spec-as-system` | tele-2 Isomorphic Specification — the spec IS the system |
| `tele-5 cross-clone-consistency` | tele-5 Perceptual Parity — cross-clone perceptual symmetry |
| `tele-11 cognitive-economy` / `tele-11 right-context-density` | tele-11 Cognitive Minimalism — right context-density at right depth-of-engagement |
| `tele-3 one-concern-per-module` | tele-3 Sovereign Composition — Law of One; one concern per module |
| `tele-6 zero-friction` | tele-6 Frictionless Agentic Collaboration — zero administrative friction |
| `tele-8 binary-cert` / `tele-8 gated-ascension` | tele-8 Gated Recursive Integrity — binary pass/fail certification + gated layer ascension |
| `tele-0` / `tele-0 umbrella` (legacy, pre-2026-07-04 docs) | tele-14 Sovereign Intelligence Engine — umbrella vision; tele-0 superseded by tele-14 (census refresh, work-76) |

## Cross-references

- **Tier 0:** `CLAUDE.md` §4 Cold-pickup primary surfaces (cross-link in) + §5 Companion policies index
- **Hub canonical source:** `list_tele` MCP tool (query for current ratified Tele set; this glossary is derived)
- **Methodology consumers:** `mission-lifecycle.md` v1.2 + `idea-survey.md` v1.0 + `strategic-review.md` + `multi-agent-pr-workflow.md` + `mission-preflight.md` + `entity-mechanics.md` + `engineer-runtime.md` + `architect-runtime.md` + `CLAUDE.md` (Tier 0)
- **Design source:** `docs/designs/m-claude-md-hardening-design.md` v1.3 §6.2 (tele-glossary IN-SCOPE upgrade rationale + load-bearing-decoder semantics)
- **Tele entity creators:** Director (tele-0 through tele-10 ratified 2026-04-21 via idea-149); architect-proposed via Director-direction (tele-11 + tele-12 ratified 2026-04-22; tele-13 Director-ratified 2026-06-20); tele-14 = architect-authored census-refresh successor of tele-0 (work-76 S0-TELE 2026-07-04 — mandate unchanged, "#1–#10" → tele-1..tele-13; tele-0 preserved as `superseded` for lineage)

## Update protocol

When Hub Tele set changes (new Tele ratified / existing Tele superseded / mandate refined):
- Architect updates this glossary in same PR as Tele entity creation/update OR as immediate follow-on
- Versioning: MINOR bump for additive Tele add; MAJOR bump for Tele removal or mandate-redefine; PATCH bump for shorthand-decoder updates only
- Source-of-truth: Hub `list_tele` (this glossary derived; if drift observed, refresh from Hub query)
