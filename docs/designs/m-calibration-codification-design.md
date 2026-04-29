# M-Calibration-Codification — Design v0.1 (architect-draft pre-Director-review)

**Status:** v0.1 architect-draft (pre-Director-review per Director directive 2026-04-29 "Author initial design, and I'd like to review it before moving to Design"). Following Director ratification, opens engineer round-1 audit thread for v0.2 → v1.0 ratification.
**Mission name:** M-Calibration-Codification (mission-65 candidate; idea-223)
**Mission-class:** structural-inflection + tooling-introduction sub-class (M sizing; ~2-3 engineer-days)
**Source idea:** idea-223 (Mechanize calibration ledger as first-class repo data + Skill access surface + CLAUDE.md pointer)
**Survey:** `docs/surveys/m-calibration-codification-survey.md` (Round 1 + Round 2 ratified 2026-04-29; composite intent envelope §14)
**Tele primaries (ratified Round 1 Q1=A,B,C,D):** all 4 — tele-6 Deterministic Invincibility + tele-3 Absolute State Fidelity + tele-2 Frictionless Agentic Collaboration + tele-7 Resilient Operations
**Authors:** lily / architect (v0.1); bilateral round-1 audit with greg / engineer pending Director review
**Lifecycle phase:** 4 Design (architect-led; Director Phase 4 review pre-engineer-audit per Director directive 2026-04-29; non-standard cadence — adds Director-in-the-loop pre-Design-phase-formal-start gate)

---

## §1 Goal + intent (echo Survey envelope)

**Goal:** ship a **canonical schema-versioned calibration ledger** + **read-only multi-role Skill scaffolding** that defeats LLM-state-fidelity drift across audits + retrospectives + methodology-doc surfaces. Phase 1 of a phased mechanization sequence; Phase 2+ (write authority + validation surface) defers to follow-on missions.

**Architectural framing:** *"Calibration ledger is first-class versioned repo data; audits + retrospectives + methodology become VIEWS over the canonical ledger."* Irreducible methodology prose (Pass 10 protocol body, §2c.X anti-pattern, named-pattern explanations) STAYS prose — what gets mechanized is **state metadata** (calibration status, closure-PRs, cross-references, count aggregates, named-pattern membership).

**Surface that prompted the idea:** mission-64 close arc (5 PRs + 5 thread closures) demonstrated repeated LLM hallucination of calibration metadata that bilateral review-loop cycles caught + fixed via fixup commits. Every drift = bilateral round burned on number-fidelity instead of architectural commitments. Review-loop-as-calibration-surface pattern is real but expensive when the surface is narrative-doc-state.

**Tele primaries (Round 1 Director Q1=A,B,C,D — all 4 load-bearing):**
- **tele-6 Deterministic Invincibility** — schema-validated ledger structurally defeats LLM-hallucination at calibration-state
- **tele-3 Absolute State Fidelity** — single source-of-truth for calibration state; views derive from it
- **tele-2 Frictionless Agentic Collaboration** — multi-role read access (Q2=A,B,C) sustains cross-internal-pool calibration-discipline coherence
- **tele-7 Resilient Operations** — count-aggregates / status-overview Skill defeats retrospective-authoring drift class structurally

**Phase composition (Survey §14 ratified):**
- **Phase 1 (Mission #5; this mission):** substrate + seed + read-only Skill scaffolding (3 verbs) + CLAUDE.md pointer + ADR-030 RATIFIED
- **Phase 2 (follow-on mission):** Skill write-authority + PR-diff validate Skill + (optional) pre-commit hook + (optional) CI workflow + (optional) methodology-doc auto-derivation

---

## §2 Architecture

### §2.1 Output shape — canonical YAML ledger

**Path:** `docs/calibrations.yaml` (single file at `docs/` root; no separate `calibrations/` directory at Phase 1).

**Why no `calibrations/` directory at Phase 1:** there's exactly one ledger file at this scope; directory is overhead. If Phase 2+ adds auxiliary files (schema-definition file, archive folder, per-mission seeded views), directory promotes at that point — `docs/calibrations.yaml` migrates to `docs/calibrations/ledger.yaml`. Phase 1 keeps the simpler single-file path.

**Format: YAML** (single-file; schema-versioned root field).

**Why YAML (per Director Phase 4 review 2026-04-29 — making rationale explicit since format wasn't a Round 1/Round 2 question):**

| Reason | YAML beats alternative |
|---|---|
| Multi-line strings essential — `closure_mechanism` + pattern `description` fields hold prose | JSON without escaping is unreadable for our use case |
| Comments for migration rationale | JSON has no comments; JSONC requires non-standard parser |
| Readable diffs at PR review | Line-oriented YAML diffs > JSON's unparseable diffs |
| Parser ubiquity + zero install cost | Same for JSON; YAML adds the prose advantages without the cost |

**Counter-formats considered + rejected:**

- **JSON** — loses on multi-line + comments; would force escape-sequence prose that breaks readability
- **Markdown with YAML frontmatter (per-entry files)** — over-fragments at 50-60 entries; one file per calibration is overkill; cross-ref discipline harder across files; per idea-223 option C defer until narrative density justifies
- **TOML** — weak with nested data (calibrations + patterns); cross-link semantics awkward
- **SQLite** — overkill for current scale; binary format = bad git diff; CI tooling complex

**Two first-class entity types** (Survey Round 2 Q4=B):

```yaml
schema_version: 1
calibrations:
  - id: 42
    class: methodology
    title: "Post-event narration AEST/UTC date conflation discipline"
    origin: mission-64-W4-followon
    surfaced_at: thread-414-round-2
    status: closed-folded
    closure_mechanism: |
      Discipline note in multi-agent-pr-workflow.md v1.0 ratified-with calibrations
      subsection "Post-event narration AEST/UTC date conflation discipline".
    closure_pr: 130
    pattern_membership: [post-event-narration-aest-utc-discipline]
    cross_refs:
      - "feedback_methodology_bypass_amplification_loop.md"
      - "project_session_log_timezone.md"

patterns:
  - id: post-event-narration-aest-utc-discipline
    title: "Post-event narration AEST/UTC date conflation"
    origin: mission-64-W4-followon
    description: |
      Authoring docs in AEST timezone (UTC+10) leads to timeline entries that
      mix AEST date with UTC `Z` suffix, producing dates ~1 day forward of
      actual UTC event time. Discipline: timeline tables use UTC consistently
      (Z-suffix attached only to UTC timestamps); never mix AEST calendar date
      with UTC time-of-day-suffix.
    surfaced_by_calibrations: [42]
    methodology_doc_subsection: "docs/methodology/multi-agent-pr-workflow.md#post-event-narration-aest-utc-date-conflation-discipline-calibration-42-new"
```

**Schema fields per entity type:**

`calibrations[]`:
| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | integer | yes | Unique calibration number; monotonic across missions |
| `class` | enum | yes | `substrate` \| `methodology` |
| `title` | string | yes | Concise human-readable summary |
| `origin` | string | yes | `mission-X-WN` or `mission-X-W4-followon` |
| `surfaced_at` | string | optional | `thread-NNN-roundN` if applicable; otherwise omitted |
| `status` | enum | yes | `open` \| `closed-structurally` \| `closed-folded` \| `retired` \| `superseded` |
| `closure_mechanism` | string (multiline) | required if status≠open | Free-text closure narrative |
| `closure_pr` | integer | optional | PR # that delivered closure (scalar field; not first-class entity per Q4=B) |
| `pattern_membership` | list of pattern ids | optional | References patterns[].id |
| `cross_refs` | list of strings | optional | Memory-doc paths or other architect references |
| `tele_alignment` | list of tele ids | optional | e.g. `[tele-3, tele-7]`. Captures which tele primaries the calibration addresses (defensive / closure / fault-surfaced). Enables `status` Skill aggregates by tele (e.g. "5 calibrations addressing tele-3 fidelity"); makes tele alignment a queryable governance dimension matching Survey Q1=A,B,C,D ratification weight. **Engineer round-1 audit fold (greg thread-417 round-2; Q1 surface).** |

`patterns[]`:
| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string slug | yes | Stable kebab-case slug (e.g. `methodology-bypass-amplification-loop`) |
| `title` | string | yes | Human-readable pattern name |
| `origin` | string | yes | `mission-X-WN` where pattern was first named |
| `description` | string (multiline) | yes | Pattern definition + diagnostic signature (current Phase 1: prose-only; Phase 2+ may extract to structured `diagnostic_signature` / `forward_discipline_test` field once 5-10 patterns crystallize structural commonalities — engineer round-1 audit Q2 surface; named for future) |
| `surfaced_by_calibrations` | list of calibration ids | yes | References calibrations[].id; non-empty |
| `methodology_doc_subsection` | string (path + anchor) | optional | Link to methodology-doc subsection if pattern has prose explanation |

**Cross-link discipline:**
- Every calibration's `pattern_membership` references existing pattern id
- Every pattern's `surfaced_by_calibrations` references existing calibration id
- Phase 1: manual cross-link discipline at edit-time (architect hand-authors; lints at PR review via `--check`)
- Phase 2+: mechanized validate operation enforces cross-refs

### §2.2 Seed scope (full M62/M63/M64 corpus per Survey Q5=C)

**Approximately 50-60 calibration entries + 4 named patterns** seeded at W1+W2 atomic execution.

**Calibration count breakdown (architect estimate; subject to W1+W2 actual extraction):**
- M62: 23 calibrations from W5 closing audit (carried forward as a mix of retired-by-M63 + carryover-OPEN)
- M63: 5 retired (#17, #18, #19, #20main, #22) + 2 NEW (#25, #26) — net delta on top of M62
- M64: 14 NEW (#29 / #30 / #31 / #32 / #33 / #34 / #35 / #36 / #37 / #38 / #39 / #40 / #41 / #42) + 1 bonus retire (#6 from M62 full) + 1 carryover closed (#25 from M63)

**Named patterns (M64-origin):**
1. `methodology-bypass-becomes-substrate-defect-amplification-loop` (3-component diagnostic test)
2. `two-sided-convergence-accounting` (round-counting diplomatic phrasing)
3. `review-loop-as-calibration-surface` (review cycles surface methodology refinements)
4. `post-event-narration-aest-utc-discipline` (Calibration #42 named pattern)

**Migration source:**
- M62: `docs/audits/m-agent-entity-revisit-w5-closing-audit.md` (or equivalent path)
- M63: `docs/audits/m-wire-entity-convergence-w5-closing-audit.md` + `docs/reviews/m-wire-entity-convergence-retrospective.md`
- M64: `docs/audits/m-adapter-streamline-closing-audit.md` + `docs/reviews/m-adapter-streamline-retrospective.md` + `docs/methodology/multi-agent-pr-workflow.md` v1.0 ratified-with calibrations subsections

**Migration discipline:** each entry transformed from narrative-doc-state to schema entry; cross-ref discipline enforced; named-pattern membership tagged. **Validation pass at W3 dogfood gate** confirms all 50-60 entries cleanly fit schema (substrate-self-dogfood input).

**Out-of-scope:** earlier-mission calibrations (M56/M57/M58/M61) — retroactive migration deferred per Q5=C.

### §2.3 Skill access surface (Phase 1 read-only multi-role)

**3 verb-classes** ship at Phase 1 (Survey Q6=C ratified; tool-surface specifics defer to idea-121):

1. **`list`** — browse + filter by class/status/mission/origin; returns calibration ids + titles + status (multi-role)
2. **`show <id-or-slug>`** — **polymorphic** (engineer round-1 audit Q3 fold; greg thread-417 round-2): accepts integer (resolves to `calibrations[].id`) OR kebab-case slug (resolves to `patterns[].id`). Single verb dispatches both shapes; matches "show me this referenced thing" UX expectation; doesn't qualify as dedicated patterns-browser surface (which defers to Phase 2+ per Q6=C scope) — this is just resolving cross-refs at retrieval time. Returns full entry + named-pattern membership cross-ref resolved + closure-PR link + cross-doc references resolved (multi-role; pull-through for retrospective authoring + PR review).
3. **`status`** — cross-mission aggregate + status table (e.g., `M62: 23 / 5 retired by M63 / 1 retired by M64` + `M64: 14 NEW / 6 substrate-class structurally closed` + tele-aligned aggregates per Q1 fold); Director governance + retrospective authoring surface

**Multi-role accessibility:** all 3 operations multi-role-readable at Phase 1 per Survey Q2=A,B,C ratified scope. Auth posture: read-access requires no special credentials; write authority defers to Phase 2+ where role-differentiation matters.

**Tool-surface verb names defer to idea-121:** Phase 1 may use placeholder Skill verbs (e.g., `/calibration-list`); idea-121 ratifies final names + verb-namespace conventions at later mission. Phase 1 mission deliverable surfaces the **architectural shape**, not the canonical verb namespace.

**NOT included at Phase 1:**
- Dedicated patterns-browser surface (Q6=C exclusion of D)
- Skill write-authoring (defer to Phase 2+)
- PR-diff validate operation (defer to Phase 2+)

### §2.4 CLAUDE.md integration — behavioral-discipline directive (NOT just a path-pointer)

**Per Director Phase 4 review 2026-04-29:** the CLAUDE.md addition isn't a bare path-pointer (which would just add context-budget cost per session for marginal discoverability value). The real function is **behavioral-discipline directive** that instructs agents to query the ledger via Skill rather than recalling from narrative-doc memory.

**Why behavioral-discipline matters:** mechanization (the ledger + Skill) only protects tele-6 when agents USE it. Without explicit instruction at session boot, an LLM agent might still "recall" calibration counts even though the ledger exists. The directive surfaces the discipline at every session boot via CLAUDE.md's always-loaded property; defeats memory-recall-vs-mechanism-recall failure mode.

**Concrete addition (~5 lines; W1+W2 final wording authored at implementation time):**

```markdown
## Calibration ledger discipline

Calibration metadata (id + status + closure-PR + cross-refs) + named architectural-pathology patterns live at `docs/calibrations.yaml` (canonical schema-versioned source-of-truth; ADR-030).

When authoring audits / retrospectives / methodology references that cite calibrations: **query the ledger via the calibration Skill rather than recalling from narrative-doc memory.** Defeats the LLM-state-fidelity drift class (calibration #42 origin; idea-223 ratified mechanization). Skill verb names follow `/calibration-*` convention (placeholders pending idea-121 final ratification).
```

**Discipline boundaries:**
- Stays terse (CLAUDE.md is always-loaded + truncated past line ~200; ~5 lines is the budget)
- Behavior-shaping > path-pointing — the directive specifies WHEN agents should query (citation contexts) + HOW (via Skill) + WHY (defeats drift class)
- Verb names placeholder per `/calibration-*` convention; idea-121 ratifies final names
- Section title "Calibration ledger discipline" matches established CLAUDE.md naming convention (e.g., existing "Commit message policy" + "Companion policies" sections)

### §2.5 Methodology-doc rebinding (Phase 1 status quo)

`multi-agent-pr-workflow.md` v1.0 ratified-with calibrations subsection **stays prose** at this mission (architect-lean default carried from idea-223). Auto-derive (Phase 2+ option) defers.

**Why prose stays:** irreducible methodology content (Pass 10 protocol body, §2c.X anti-pattern, named-pattern explanations) is human-authored prose; ledger captures the **state metadata** that's currently drift-vulnerable. Hybrid prose + ledger-view rebinding (where each subsection auto-derives "what" from ledger view + retains "why" as prose) is the long-term target but requires ledger maturity first.

### §2.6 ADR-030 SCAFFOLD

**ADR-030 (candidate; ratify at Manifest):** *"Calibration ledger is first-class versioned repo data; audits + retrospectives + methodology become views over the canonical ledger."*

**Architectural commitments:**
- Ledger location: `docs/calibrations.yaml`
- Two first-class entity types: `calibrations[]` + `patterns[]`
- Schema-version field at root; v1 documented in this ADR
- Closure-PR + sourceRefs as scalar fields on calibrations (NOT separately-indexed first-class entities; Q4=B scope)
- Cross-link discipline enforced at edit-time Phase 1; mechanized validate Phase 2+
- Read-only Skill scaffolding ships Phase 1; write authority + validate operations Phase 2+
- Methodology-doc prose stays as source-of-truth for "why"; ledger captures "what" state metadata

**Sealed companions:**
- `docs/methodology/idea-survey.md` v1.0 (Survey methodology IS canonical input)
- `docs/methodology/multi-agent-pr-workflow.md` v1.0 ratified-with calibrations subsection (will reference ledger entries by id post-merge)
- `docs/methodology/mission-lifecycle.md` (Phase 4 Design + Phase 9+10 retrospective close-out reference ledger)
- ADR-023 (multi-agent-pr-workflow underlying ADR; W4 closing wave amends to reference ADR-030)
- idea-121 (API v2.0 tool-surface; future ratification of Skill verb names)

**Forward consequences:**
- Future missions ratify calibration entries via the ledger surface (read at Phase 1; write at Phase 2+)
- Phase 2+ mechanization (write authority + validation) composes cleanly without disrupting Phase 1 substrate
- Methodology-doc rebinding (auto-derive "what" sections from ledger views) becomes possible post-Phase-2 once write authority + validation settle
- **CLAUDE.md context-budget governance** (engineer round-1 audit structural concern 2 fold; greg thread-417 round-2): future behavioral-discipline directives in CLAUDE.md should compete for the ~5-line average budget per discipline; consolidation pass at line ~150-200 mark (always-loaded truncation cliff is ~200 lines) is a recurring methodology-discipline checkpoint as more substrate areas earn behavioral-discipline-directive surfaces. Architecture-of-architecture observation; not blocking but worth durable forward-pointer since idea-220 Phase 2 + future missions may add directives too

### §2.7 Schema evolution discipline

**`schema_version` field at ledger root.** Phase 1 ships v1. Future schema changes (e.g., upgrading closure-PR to first-class entity per Q4=C; adding mission/wave indexed entities per Q4=D) bump schema_version + ship migration tooling at the upgrading mission.

**Discipline:** schema-version bumps require ADR amendment OR new ADR (per `multi-agent-pr-workflow.md` ADR-amendment scope discipline). Contract-change schema bumps = new ADR; deployment-context-only changes = in-place ADR §Amendments.

---

## §3 Wave plan

| Wave | Scope | PR | Sizing |
|---|---|---|---|
| **W0** | Survey + Design v1.0 + ADR-030 SCAFFOLD + Preflight artifact bundle | 1 PR; doc-only | ~30min architect-time + Director Phase 4 review (this gate) + bilateral round-1 audit on thread |
| **W1+W2 atomic** | (1) Schema authoring at `docs/calibrations.yaml` (schema_version=1; calibrations + patterns sections; empty data) + (2) Seed migration of M62/M63/M64 corpus (~50-60 calibration entries + 4 named patterns) + (3) Skill scaffolding for 3 read-only verbs (list / show / status; placeholder names) + (4) CLAUDE.md pointer paragraph | 1 PR; substrate-introduction | ~1.5-2 engineer-days (seed migration is ~30-40% of effort) |
| **W3 dogfood gate** | Substrate-self-dogfood verification on seed corpus — verify schema accommodates all 50-60 entries cleanly + Skill returns correct cross-refs + cross-link discipline enforced + status-overview returns sensible aggregates | 1 architect-bilateral thread; observation-only | ~30min architect-time + ~30min greg dogfood |
| **W4 closing** | Closing audit + ADR-030 RATIFIED + Phase 10 retrospective + (optional) calibration-from-this-mission filing as ledger's first non-seed entries | 1 PR; doc-only + ADR ratification | ~1 engineer-hour architect-time |

**Aggregate sizing:** ~2-3 engineer-days bilateral (M class baseline holds). Director Phase 4 review (this gate) adds non-standard cadence overhead; treated as one-time methodology-cost.

**Upper-bound risk flag (engineer round-1 audit Q7 sizing observation; greg thread-417 round-2):** seed-extraction effort estimate splits ~40-50% of W1+W2 (10h of ~20h total at upper bound) IF per-entry extraction-from-narrative + transform-to-schema + cross-link-tagging runs slow. M sizing baseline holds at ~12h W1+W2 = ~1.5 eng-days; upper-bound ~20h = ~2.5 eng-days. **Calibration #30 in-arc-sizing-recalibration discipline applies** if W1+W2 reveals ~25h+ of work mid-execution (architect autonomous-ratify + Director-notify-for-visibility per mission-64 precedent). Not enough surface tension at v0.2-ratify-time to recalibrate to L; engineer-side awareness flag for execution-time vigilance.

### §3.1 Wave-coherence operational sequence

- W0 PR ratifies architectural commitments (ADR-030 SCAFFOLD); Phase 7 Release-gate Director ratification follows
- W1+W2 atomic: schema + seed + Skill scaffolding ships in single PR (mission-63 tight-cycle precedent; engineer pre-merge dry-run + bilateral PR review per calibration #24 dual-surface)
- W3 dogfood gate: substrate-self-dogfood thread bilateral; architect-bilateral with greg per `feedback_substrate_self_dogfood_discipline.md` observation-only framing
- W4 closing: ADR RATIFIED + Phase 10 retrospective; mission flips active → completed

### §3.2 Substrate-self-dogfood (W3) discipline

Per `feedback_substrate_self_dogfood_discipline.md`: W3 dogfood-gate scope is **observation-only**. Architect-bilateral with greg validates:

1. **Schema fidelity** — all 50-60 seed entries fit schema cleanly; schema-version=1 holds; no shape-bumps required mid-mission
2. **Cross-link discipline** — every calibration's pattern_membership references existing pattern; every pattern's surfaced_by_calibrations references existing calibration; manual lint at edit-time catches the discipline class
3. **Skill read-fidelity** — `list` returns expected results across class/status/mission filters; `show <id-or-slug>` polymorphic resolution + cross-refs correctly; `status` returns sensible cross-mission aggregates including tele-aligned slices
4. **Multi-role accessibility** — Skill works for architect (lily-side) + engineer (greg-side); role-difference doesn't break read access at Phase 1
5. **Round-trip validation against existing audit/retrospective citations** (engineer round-1 audit Q5 fold; greg thread-417 round-2): pick 5-10 calibration citations from M64 W4 audit + retrospective + cleanup PR + methodology-doc subsections; run `show <id>` on each; verify rendered ledger metadata matches what's currently cited in narrative-doc state. **This catches drift between seed corpus and source-of-truth narrative state at W3-time** — exactly the drift class the mission is structurally defeating. ~30min architect-time; high value for drift-defense; substrate-self-dogfood proof point. If round-trip fails, that's seed-extraction discipline failing — exactly what dogfood gates exist to catch.

**Hold-on-failure:** any verification gate failure halts W3; investigate via direct YAML inspection + Skill log; fix-forward; re-run dogfood. **W3 dogfood-gate collapse-into-W1+W2-fix retry pattern** (Calibration #34 from mission-64) applies if defect surfaces during Skill operation.

---

## §4 Anti-goals (locked from Survey)

1. **NO scope creep into Phase 2+ items** — Skill write-authoring, PR-diff validate, pre-commit hook, CI workflow, methodology-doc auto-derivation, named-pattern-browser-surface defer to follow-on missions
2. **NO LLM-side autonomous calibration filing** — architects file calibrations; LLMs draft proposals + render Skill output; the ledger-as-source-of-truth is not LLM-authored
3. **NO replacement of irreducible methodology prose** — Pass 10 protocol body, §2c.X anti-pattern, named-pattern explanations stay as prose in `multi-agent-pr-workflow.md`
4. **NO new tool-surface verbs without idea-121 ratification** — Skill verb names (e.g., `/calibration-list`) are placeholder; defer to idea-121's API v2.0 tool-surface authority
5. **NO scope creep into idea-220 Phase 2** — shim observability + projection-fidelity + `get_agents` CLI script are Mission #6 scope (separate)
6. **NO retroactive earlier-mission migration this mission** — M56/M57/M58/M61 calibrations defer; retroactive on-demand only (Q5=C exclusion of D)
7. **NO vertex-cloudrun engineer-side parity this mission** — engineer-side adapter access to Skill defers to mission whose primary scope is engineer-side parity (mirrors mission-62/63/64 vertex-cloudrun precedent)

---

## §5 Risks + open questions

### §5.1 Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| **R1** | Schema evolution friction (calibration/pattern shape changes mid-mission during W1+W2 seed migration) | Medium | `schema_version` field at root + migration tooling at the upgrading mission; v1 schema documented in ADR-030 RATIFIED at W4; Phase 1 commits to v1 stability |
| **R2** | Skill verb names block on idea-121 ratification | Low | Tool-surface defers; ledger data-file ships first; Skill scaffolding uses placeholder verbs; idea-121 ratifies final verbs at later mission; Phase 1 deliverable surfaces architectural shape, not canonical verb namespace |
| **R3** | Migration scope blowup (~50-60 entries from narrative-doc-state) — extracting + transforming + cross-link tagging is effort-heavy | Low-Medium | W3 dogfood-gate validates schema/Skill against seed corpus; if migration proves > expected scope, downgrade to active calibrations only (Q5=B fallback) at architect autonomous-ratify (calibration #30 in-arc-sizing-recalibration discipline) |
| **R4** | Cross-reference drift between ledger + audits + retrospectives + methodology doc | Medium | W3 dogfood-gate audit pass validates each existing reference; ledger consistency lints at edit-time; mechanized validate operation in Phase 2+ closes the class structurally |
| **R5** | ~~Methodology-vs-practice gap on Survey persist-path~~ — **RESOLVED by Director Phase 4 review 2026-04-29: `docs/surveys/<mission>-survey.md` is canonical (established practice ratified)** | Resolved | File as methodology-class calibration this mission with closure mechanism = methodology-doc fixup of `docs/methodology/idea-survey.md` §5 to read `docs/surveys/<mission>-survey.md`. Could land as W4 closing inline-fixup OR standalone tiny fixup PR pre-W4. Architect-lean: bundle into W4 closing audit + ADR-030 commit (smaller PR-cost than standalone). |
| **R6** | LLM-drift-vs-strict-Survey-methodology surfaced this mission's Survey authoring (architect drift to multi-question-aggregation-only) | Low (already self-corrected) | File as methodology-class calibration during W4 closing audit; closure-path = **ledger-mechanization-as-substrate-foundation-for-future-Survey-mechanization (truthful but indirect; full closure requires Survey-Skill at later mission)** (engineer round-1 audit structural concern 1 fold; greg thread-417 round-2 — clarifies that idea-223 mechanizes calibration ledger, NOT Survey methodology; Survey-Skill is distinct future-mission scope) |
| **R7 NEW** | YAML parse fragility on edge cases — whitespace-sensitivity + multi-line string indentation can introduce parser-tripping bugs that aren't caught at edit-time (a miscounted leading-space on `closure_mechanism` continuation could silently truncate or shift into sibling key) | Low-Medium | (engineer round-1 audit Q6 fold; greg thread-417 round-2) Skill operations call `yaml.safe_load` strictly + halt on parse error; W3 dogfood includes deliberately-malformed-YAML round-trip test as Gate-5 supplement; pre-commit hook in Phase 2+ closes structurally |
| **R8 NEW** | Git diff readability of bulk seed migration — W1+W2 PR adds ~50-60 calibration entries in a single commit produces giant ~1500-2400-line YAML diff hard to spot-check thoroughly at PR-time; bilateral PR review precision suffers | Low (cosmetic; doesn't affect substrate correctness) | (engineer round-1 audit Q6 fold; greg thread-417 round-2) Split seed migration into 3 ordered commits within W1+W2 PR — M62 batch / M63 batch / M64 batch — so each commit is independently reviewable; or sort entries by mission so monolithic-commit diff is at least topographically navigable. Implementation choice; defer to W1+W2-execution discretion |

### §5.2 Open questions for engineer round-1 audit

(Round-1 questions for greg; opens after Director Phase 4 review per Director directive 2026-04-29)

1. **Schema field completeness** — does the calibration entry schema (id + class + title + origin + surfaced_at + status + closure_mechanism + closure_pr + pattern_membership + cross_refs) capture all the metadata you've seen in M62/M63/M64 retrospectives + audits? Any field missing from your engineer-side perspective?
2. **Pattern entity field completeness** — does the pattern entity schema (id + title + origin + description + surfaced_by_calibrations + methodology_doc_subsection) cover the named-pattern shape? Anything else worth first-class status?
3. **Skill verb scope adequate for engineer use case** — list / show / status; multi-role read access. Engineer-side use case is PR review (look up calibrations cited in audits) + retrospective authoring participation (round-1 audit threads). Does the 3-verb scope cover engineer-side PR-review operations? Any verb missing that would be high-friction-cost to defer to Phase 2+?
4. **Migration scope confirmation** — Q5=C ratifies full M62/M63/M64 corpus. Do you concur on the seed corpus boundary, or is there a calibration not in M62-M64 that you'd flag as critical-must-include (e.g., a frequently-cited calibration from M56/M57/M58/M61 that the ledger would feel incomplete without)?
5. **W3 dogfood-gate scope adequate** — observation-only per `feedback_substrate_self_dogfood_discipline.md`. Sufficient or tighter?
6. **Anti-goals + risks register completeness** — anything in §4 + §5.1 you'd add or revise?
7. **Sizing baseline** — M (~2-3 engineer-days) holds, or surface tension during round-1 audit?

---

## §6 Mission-class declaration + ADR-030 SCAFFOLD

### §6.1 Mission-class

**Structural-inflection + tooling-introduction sub-class** (M sizing baseline; ~2-3 engineer-days).

Distinct from substrate-introduction (M62/M63/M64) where the substrate was network/protocol/distribution; here the substrate is **methodology-state itself**. Tooling-introduction sub-class signals: the deliverable is mostly NEW tooling (canonical YAML ledger; Skill scaffolding; ADR documenting schema) rather than evolution of existing substrate.

**Architectural-precedents:**
- mission-64 (M-Adapter-Streamline; structural-inflection + substrate-introduction sub-class; tight-cycle merge cadence + Director Phase 4 review pre-engineer-audit pattern not present — non-standard cadence introduced this mission)
- mission-63 (M-Wire-Entity-Convergence; structural-inflection M-class precedent + ADR-RATIFIED protocol)
- mission-57 (M-Mission-Pulse-Primitive; coordination-primitive-shipment class precedent; first canonical Survey execution)

### §6.2 ADR-030 SCAFFOLD

See §2.6 for architectural commitments + sealed companions + forward consequences. ADR-030 SCAFFOLD ships in W0 bundle PR; RATIFIED at W4 closing wave per mission-63 ADR-028 + mission-64 ADR-029 precedent.

### §6.3 Substrate-self-dogfood discipline

W3 dogfood-gate scope: **observation-only** (Survey §14 ratified; mission-class signature for tooling-introduction). Architect-bilateral with greg per `feedback_substrate_self_dogfood_discipline.md`. Concrete verification per §3.2 above (4 gates: schema fidelity / cross-link discipline / Skill read-fidelity / multi-role accessibility).

---

## §7 Engineer audit ask (round-1 questions)

(Per `idea-survey.md` autonomous-arc-driving + bilateral architect+engineer round-1 audit pattern; opens AFTER Director Phase 4 review ratifies v0.1 per Director directive 2026-04-29.)

Opens via thread to greg (unicast; semanticIntent: seek_rigorous_critique; correlationId: mission-65-candidate; maxRounds: 10) with the 7 open questions in §5.2 + a request for any structural concerns architect missed.

If GREEN-with-folds, engineer ratifies on round-N thread close → Design v1.0 → Manifest+Preflight bundle PR → Phase 7 Director Release-gate.

If REQUEST CHANGES, architect folds engineer audit asks into v0.2 → engineer ratify round → v1.0.

---

## §8 Cross-references

- **Source Idea:** idea-223 (Mechanize calibration ledger as first-class repo data + Skill access surface + CLAUDE.md pointer)
- **Survey:** `docs/surveys/m-calibration-codification-survey.md` (Round 1 + Round 2 ratified 2026-04-29; composite intent envelope §14)
- **Methodology:**
  - `docs/methodology/idea-survey.md` v1.0 (Survey methodology; canonical input)
  - `docs/methodology/multi-agent-pr-workflow.md` v1.0 (PR workflow + named architectural-pathology patterns)
  - `docs/methodology/mission-lifecycle.md` (Phase 4 Design + Phase 9+10 retrospective)
  - `docs/methodology/mission-preflight.md` (Preflight artifact)
- **Architectural-precedents:**
  - mission-64 (M-Adapter-Streamline; ADR-029 RATIFIED precedent for tooling-introduction class)
  - mission-63 (M-Wire-Entity-Convergence; ADR-028 RATIFIED + tight-cycle merge cadence)
  - mission-57 (M-Mission-Pulse-Primitive; first canonical Survey execution — idea-206)
- **ADRs (sealed companions):**
  - ADR-030 (this mission's ADR; ratify at Manifest+W4 close)
  - ADR-023 (multi-agent-pr-workflow underlying ADR; W4 closing wave references ADR-030)
- **Foundational dependencies:**
  - `docs/methodology/idea-survey.md` v1.0 (Survey methodology mandates this Survey + composite intent envelope as Design input)
- **Memory referenced:**
  - `feedback_review_loop_calibration_surface.md` (review cycles surface methodology refinements)
  - `feedback_methodology_bypass_amplification_loop.md` (architectural-pathology pattern naming discipline)
  - `feedback_defer_tool_surface_to_idea_121.md` (tool-surface authority boundary)
  - `feedback_substrate_self_dogfood_discipline.md` (W3 dogfood-gate observation-only framing)
  - `reference_idea_219_220_post_mission_62.md` (mission sequencing post-mission-64; idea-223 Mission #5; idea-220 Phase 2 Mission #6)
- **Calibrations addressed (as named in Survey + Design v0.1):**
  - **#42** (mission-64 W4-followon) — post-event narration AEST/UTC date conflation discipline; cleanup-PR-fold; this ledger ratifies the discipline structurally
  - **NEW (TBD-NEXT)** — LLM drift from documented multi-round Survey methodology (Round-1-aggregation-only anti-pattern); architect-self-corrected this Survey; closure-path = idea-223 mechanization itself
  - **NEW (TBD-NEXT)** — methodology-vs-practice gap on Survey persist-path; **RESOLVED by Director Phase 4 review 2026-04-29 ratifying `docs/surveys/<mission>-survey.md` as canonical**; closure mechanism = methodology-doc fixup of `docs/methodology/idea-survey.md` §5 bundled into W4 closing

---

## §9 Status

- v0.1 architect-draft (initial; pre-Director-review)
- v0.1+ architect-revision (Director Phase 4 review feedback applied: §2.1 single-file path + YAML rationale + §2.4 CLAUDE.md behavioral-discipline directive + §5.1 R5 resolved)
- **v0.2 architect-revision** (this commit; engineer round-1 audit folded — greg thread-417 round-2 GREEN-with-folds verdict): 7 surface refinements + 2 structural concerns absorbed:
  1. §2.1 calibrations[] schema — added optional `tele_alignment` field (Q1 fold)
  2. §2.1 patterns[] schema — named `diagnostic_signature` / `forward_discipline_test` for Phase 2+ (Q2 fold)
  3. §2.3 Skill `show` — clarified polymorphic shape accepts integer (calibration) OR slug (pattern) (Q3 fold)
  4. §3.2 W3 dogfood gates — added 5th gate "round-trip validation against existing audit/retrospective citations" (Q5 fold)
  5. §5.1 risks register — added R7 YAML parse fragility + R8 git diff readability of bulk seed (Q6 fold)
  6. §3 sizing prose — added upper-bound flag for seed-extraction effort (Q7 fold)
  7. §5.1 R6 closure-path — refined to "ledger-mechanization-as-substrate-foundation-for-future-Survey-mechanization" (truthful but indirect; full closure requires Survey-Skill at later mission) — engineer round-1 structural concern 1 fold
  8. §6.2 ADR-030 forward consequences — added CLAUDE.md context-budget governance callout (engineer round-1 structural concern 2 fold)
  9. NO CHANGE (Q4 migration scope; Q7 sizing baseline) — engineer concur
- v1.0 BILATERAL RATIFIED (engineer + architect ratify on thread-417 close; Manifest+Preflight bundle PR follows)
- W0 bundle PR opens (Survey + Design v1.0 + ADR-030 SCAFFOLD + Preflight artifact)

---

*Design v0.2 architect-revision 2026-04-29 lily / architect; v0.1+ Director Phase 4 review feedback (4 items) + greg round-1 engineer audit folds (7 surface refinements + 2 structural concerns) integrated. Awaiting engineer round-2 ratify on thread-417 → v1.0 BILATERAL RATIFIED → W0 bundle PR (Survey + Design v1.0 + ADR-030 SCAFFOLD + Preflight) → Phase 7 Director Release-gate.*
