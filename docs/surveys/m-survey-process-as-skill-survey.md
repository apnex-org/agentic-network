# M-Survey-Process-as-Skill — Phase 3 Survey envelope

**Methodology:** `docs/methodology/idea-survey.md` v1.0 (3+3 Director-intent pick-list)
**Source idea:** idea-228 (status `triaged` via route-(a) skip-direct 2026-05-01; all 5 skip-criteria satisfied)
**Composes:** idea-229 (umbrella; Sovereign-Skill Pattern + Mission-Lifecycle-as-Skills Vision) + idea-230 (claude-plugin install bootstrap; consumer-install automation)
**Mission-class candidate:** substrate-introduction (first-canonical sovereign-Skill instance)
**Branch:** `agent-lily/idea-228` (pushed to origin BEFORE bilateral round-1 audit dispatch per calibration #59 closure mechanism (a) applied 3rd-canonically — mission-67 + mission-68 precedent)

---

## §0 Context

idea-228 mechanizes the Survey methodology (`docs/methodology/idea-survey.md` v1.0) as a structured Skill at `/skills/survey/` (sovereign first-class repo entity per idea-229 architectural commitment). This Skill is the **first-canonical sovereign-Skill instance** — establishes the sovereign-Skill design pattern via implementation; future Skill missions mirror this layout.

Director-originated 2026-04-30 post-mission-67 close. Refined 2026-05-01 during architect-Director design discussion to elevate from "single-Skill mechanization" to "first-canonical instance establishing the sovereign-Skill pattern" (idea-229 umbrella context).

---

## §1 Round 1 picks + interpretation

| Q | Pick | Director-intent reading |
|---|---|---|
| Q1 — MVP scope | **d** Full feature scope | Walk-through + all helper scripts (init + validate + skip-criteria + format-pick-presentation) + Hub `list_tele` integration + Hub `get_idea` auto-pull + cited-calibrations cross-ref. Skill ships feature-rich for our actual workflow. |
| Q2 — Sovereignty depth | **d** Tier 1 + Tier 2/3 stubbed | Tier 1 (OIS Hub defaults) implemented + tested. Tier 2 (config-override) + Tier 3 (manual-fallback prompts) interface stubs in place with TODO bodies; not implemented; not tested. Sovereignty-shaped, not sovereignty-proven. |
| Q3 — Pattern-establishment posture | **a** Implicit | SKILL.md walks Survey methodology only. Sovereign-Skill pattern emerges from directory layout + structure + tier-articulation + versioning. Future Skill authors infer from observation. No explicit "this is the canonical template" anchor block. |

**Composite Round-1 reading:** maximum feature velocity (Q1=d) + minimum upfront portability investment (Q2=d) + implicit pattern crystallization (Q3=a). Pragmatic + opinionated combination — Skill DOES a lot for our actual workflow without paying for portability we don't yet need or evangelizing the pattern through explicit prose.

---

## §2 Round 2 picks + interpretation

| Q | Pick | Director-intent reading |
|---|---|---|
| Q4 — Helper script invocation | **d** Direct + batched | All scripts called by Skill at structured gates (init gate + finalize gate); architect reviews each gate's combined output. Lowest friction; coarsest control. Bash tool calls per gate; permission-prompt frequency minimized. |
| Q5 — Tier-2/3 stub marking | **c** SKILL.md status matrix | Top of SKILL.md has explicit tier-status table per input dimension (Tele framework / Source idea / Output location / Mission-class / Methodology spec / Director-pick capture). Status visible declaratively on SKILL.md surface; sovereign-shape posture readable without grepping code. |
| Q6 — Output artifact format | **d** Markdown frontmatter | YAML frontmatter block at top of Survey envelope (`---` block before prose) with structured fields (Skill version, Tier status, picks, mission-class, tele-alignment). Single-file artifact; tools parse frontmatter; prose stays prose. |

**Composite Round-2 reading:** high-velocity execution (Q4=d batched gates) + declarative sovereignty visibility (Q5=c top-of-file matrix) + machine-readable single-file outputs (Q6=d frontmatter). Coherent with Round-1 theme (feature-rich, declarative-not-buried, single-file simplicity).

---

## §3 Composite intent envelope

Mission-69 ships:

### §3.1 Skill body — `/skills/survey/`

```
/skills/survey/                          # sovereign + git-tracked first-class repo entity
├── SKILL.md                             # main flow + tier status matrix at top
├── round-1-template.md                  # round-1 question framing template
├── round-2-template.md                  # round-2 question framing template (informed by round-1 picks)
├── envelope-template.md                 # Survey envelope artifact template (with frontmatter)
└── scripts/
    ├── survey-init.sh                   # gate 1: scaffold envelope artifact at canonical output location
    ├── validate-envelope.sh             # gate finalize: shape-check vs idea-survey.md v1.0 spec
    ├── check-skip-criteria.sh           # walk through 5 skip-criteria for route-(a) decision
    └── format-pick-presentation.sh      # render Round-N questions in standard markdown shape
```

### §3.2 SKILL.md structure

- **Frontmatter** (YAML): `Version: v1.0` + `Methodology-source: docs/methodology/idea-survey.md v1.0` + tier-status matrix
- **Top section (status matrix)** — Tier-1/Tier-2/Tier-3 status per input dimension; Q5=c declarative posture
- **Phase walk-through** (sequential prose):
  1. **Init gate** — Skill calls `survey-init.sh` (creates skeleton envelope at canonical location); architect reviews scaffold
  2. **Round-1 question design + dispatch** — Skill prompts architect to design 3 orthogonal questions; uses `round-1-template.md`; architect synthesizes for Director chat
  3. **Round-1 pick capture + interpretation** — architect reports picks back to Skill flow; Skill prompts for interpretation per pick
  4. **Round-2 question design + dispatch** — Skill uses `round-2-template.md` informed by Round-1 picks; architect synthesizes Round-2 questions
  5. **Round-2 pick capture + interpretation** — same pattern
  6. **Finalize gate** — Skill calls `validate-envelope.sh` (shape check) + `format-pick-presentation.sh` (final render); writes complete envelope artifact + reports diff to architect

### §3.3 Survey envelope artifact format (Q6=d frontmatter)

```yaml
---
mission-name: M-<name>
source-idea: idea-<N>
director-picks:
  round-1:
    Q1: <letter>
    Q2: <letter>
    Q3: <letter>
  round-2:
    Q4: <letter>
    Q5: <letter>
    Q6: <letter>
mission-class: <substrate-introduction|...>
tele-alignment:
  primary: [tele-N, tele-M, ...]
  secondary: [tele-X, tele-Y, ...]
skill-meta:
  skill-version: survey-v1.0
  tier-1-status: implemented
  tier-2-status: stubbed
  tier-3-status: stubbed
---

# M-<name> — Phase 3 Survey envelope

(prose body follows; same shape as mission-67 + mission-68 + this Survey artifact)
```

### §3.4 Hub integrations (Q1=d full feature scope)

- **`list_tele`** — Skill queries Hub at runtime for current tele framework; falls through to Tier-2 stub (config file) → Tier-3 stub (manual prompt) if unavailable
- **`get_idea(<id>)`** — Skill auto-pulls source-idea text + tags + cross-refs at init gate; architect doesn't need to paste idea content manually
- **`docs/calibrations.yaml` cross-ref** — Skill reads calibrations file (or queries via calibrations.py if present); validates that idea-cited calibrations exist + are in correct status; flags any drift

### §3.5 Tier-2 + Tier-3 stub interfaces (Q2=d stubbed; Q5=c declared)

For each input dimension, Tier-2 + Tier-3 functions exist as stubs in `scripts/` with:
- Function/script signature + minimal arg parsing
- Body: `echo "TODO: Tier-N path not implemented (stub for sovereignty interface)" >&2; exit 1`
- TODO comment inline referencing idea-228 + idea-229 umbrella

Status declared in SKILL.md top matrix:
```
| Input | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Tele framework | ✅ Hub list_tele | ⏸ stub | ⏸ stub |
| Source idea | ✅ Hub get_idea | ⏸ stub | ⏸ stub |
| Output location | ✅ docs/surveys/<name>-survey.md | ⏸ stub | ⏸ stub |
| Mission-class taxonomy | ✅ create_mission enum | ⏸ stub | ⏸ stub |
| Methodology spec | ✅ ref docs/methodology/idea-survey.md | ⏸ stub | ⏸ stub |
| Director-pick capture | ✅ Conversation (universal) | — | — |
```

---

## §4 Mission scope summary

| Axis | Bound |
|---|---|
| Mission name | M-Survey-Process-as-Skill |
| Mission class | substrate-introduction (first-canonical sovereign-Skill instance) |
| Substrate location | `/skills/survey/` (NEW first-class repo directory; sovereign) |
| Primary outcome | Survey methodology mechanization for architect Phase-3 use; pattern-establishment via implementation (idea-229) |
| Secondary outcomes | Tier-status declarative discipline (Q5=c) + frontmatter artifact format (Q6=d) become reference for future sovereign Skills |
| Tele alignment (primary) | tele-3 Sovereign Composition + tele-2 Isomorphic Specification + tele-11 Cognitive Minimalism + tele-12 Precision Context Engineering |
| Tele alignment (secondary) | tele-4 Zero-Loss Knowledge + tele-7 Resilient Agentic Operations + tele-6 Frictionless Agentic Collaboration |

---

## §5 Anti-goals (out-of-scope; deferred)

| AG | Description | Composes-with target |
|---|---|---|
| AG-1 | NOT shipping `.claude/skills/survey/` directory or symlink | idea-230 (claude-plugin install bootstrap) |
| AG-2 | NOT codifying `docs/methodology/sovereign-skills.md` spec doc | idea-229 umbrella; deferred to 2nd-canonical-instance precedent (mission-67 + mission-68 pattern) |
| AG-3 | NOT implementing/testing Tier 2 + Tier 3 paths | Future portability work; idea-229 umbrella; on-demand if external use case arises |
| AG-4 | NOT mutating `docs/calibrations.yaml` from Skill (read-only cross-ref only) | Calibration ledger discipline (architect-only writes per CLAUDE.md) |
| AG-5 | NOT mechanizing other phases (Phase 4 Design / Phase 6 Preflight / etc.) | Separate sovereign-Skill missions per idea-229 vision |
| AG-6 | NOT formalizing per-RACI Skill loading enforcement | idea-229 commitment 6 + idea-230 install scope |
| AG-7 | NOT adding non-bash dependencies (no python, no npm packages) | Per Director ratification 2026-05-01 (helper scripts are bash) |
| AG-8 | NOT adding webhook architecture or polling-bridge changes | Webhook-free design per architect-Director discussion 2026-05-01 (orthogonal scope) |
| AG-9 | NOT modifying `idea-survey.md` v1.0 spec | Skill mechanizes existing spec verbatim; methodology evolution via separate authoring discipline |

---

## §6 Architect-flags / open questions for Phase 4 Design round-1 audit (engineer-side)

7 architect-flags batched for greg's round-1 content-level audit:

| # | Flag | Architect-recommendation |
|---|---|---|
| F1 | **Frontmatter format** — YAML (per Q6=d default) vs TOML vs JSON. YAML is canonical in this codebase (tfvars, Hub configs, GitHub Actions); recommend YAML. | YAML |
| F2 | **Bash tool permission allowlist** — Skill calls helper scripts via Bash tool; per-script permission prompts may surface. Should we ship `.claude/settings.json` allowlist additions OR defer to user's own settings? | Defer to user; Skill works with prompts; can ship allowlist as separate small follow-on if friction surfaces |
| F3 | **Tier-2/3 stub interface convention** — function/script signature + `echo TODO; exit 1` body OR something more interface-like (e.g., return a fixed "stub-not-implemented" error code Skill can detect)? | Latter — distinct exit code (e.g., 42) for "stub not implemented" so Skill can fall through to next tier programmatically |
| F4 | **SKILL.md status matrix shape** — markdown table per dimension (rich; full status), bullet list (compact), or simple paragraph (least structured)? | Markdown table per Q5=c (declarative discipline) |
| F5 | **Hub error handling** — Skill calls `list_tele` / `get_idea` via MCP tools; what if Hub MCP unreachable (network down, Hub container restarting)? Fall through to Tier-3 prompts immediately, retry-then-fall-through, or fail-fast? | Retry-once-then-fall-through to Tier-3 prompts (defensive default; gracefully degrades; avoids hard-failure if Hub blip) |
| F6 | **Mission-class default suggestion** — Skill should suggest mission-class for the new mission. How does it know? Heuristic from idea text + tags? Architect prompt? Default + override? | Default to "substrate-introduction" if any sovereign-Skill keywords in idea (`/skills/`, `sovereign`, `substrate`); otherwise prompt architect with create_mission enum picks |
| F7 | **PR sequencing** — single PR for `/skills/survey/` end-to-end (substrate + scripts + templates + SKILL.md), OR split (substrate first, then scripts, then SKILL.md)? | Single PR — small scope (5-7 files); no cross-package dependencies; mirrors mission-68 W1 single-hub-PR pattern; simpler for review |

Engineer round-1 audit invited to challenge any of these recommendations.

---

## §7 Sequencing / cross-mission considerations

### §7.1 Branch + PR strategy

- Branch: `agent-lily/idea-228` (off main; pushed pre-Phase-4-bilateral per calibration #59 closure mechanism (a) — 3rd-canonical instance after mission-67 + mission-68)
- Single PR for end-to-end Skill ship (per F7 recommendation; revisit at Design phase)

### §7.2 Composability with concurrent / pending work

- **idea-229** (umbrella) — stays parked; this mission is its first-canonical instance; idea-229's text already references this mission as such
- **idea-230** (claude-plugin install bootstrap) — pending mission; depends on `/skills/survey/` existing (this mission satisfies); should NOT block this mission
- **idea-227** (M-Event-Design-End-to-End) — orthogonal; runtime-mechanism layer; composes with sovereign Skills via per-RACI loading future-investment
- **`docs/methodology/idea-survey.md` v1.0** — NOT modified (AG-9); Skill mechanizes existing spec verbatim
- **mission-67 + mission-68** — closed; their precedents (compressed-lifecycle, calibration #59 closure mechanism, branch-naming convention) inform this mission's execution pattern

### §7.3 Same-day compressed-lifecycle candidate

Per mission-67 + mission-68 second-canonical precedent (substrate-introduction-class + bounded scope + ≤6 picks + ≤5 bilateral rounds + Director engagement at gate-points only), this mission is a candidate for **third-canonical compressed-lifecycle execution** (Phase 1 → Phase 9 within 1 working day). Architect-projection: feasible if Phase 4 Design bilateral round count stays ≤4 + no substrate surprises.

### §7.4 Phase-N revisit-axes (forward-investment surfaces)

| Axis | Trigger to revisit |
|---|---|
| Tier-2/3 implementation | First external-network adoption ask OR first internal need (e.g., test environment with mocked Hub) |
| `docs/methodology/sovereign-skills.md` codification | After 2nd-canonical sovereign-Skill instance ships (e.g., Preflight Skill in some future mission) — per idea-229 plan |
| Per-RACI Skill loading enforcement | When idea-230 (claude-plugin install bootstrap) ships AND multiple Skills exist; affects discoverability + cognitive-context discipline |
| Survey methodology evolution | When `idea-survey.md` v1.x bumps; Skill `Methodology-source` frontmatter pinning + version-mismatch warning at runtime |
| Frontmatter parsing tooling | If/when downstream tools (CI, scripts) need to consume Survey artifact metadata; Q6=d frontmatter shape ratifies this future affordance |

---

## §8 Cross-references

- **`docs/methodology/idea-survey.md`** v1.0 — canonical Survey methodology this Skill mechanizes (NOT modified by this mission per AG-9)
- **`docs/methodology/strategic-review.md`** §Idea Triage Protocol — route-(a) skip-direct rationale for idea-228 triage 2026-05-01
- **`docs/calibrations.yaml`** — calibration #59 closure mechanism (a) applied 3rd-canonically (Survey branch-pushed pre-bilateral round-1 audit)
- **idea-228** — source idea (status `triaged`; this Survey artifact moves it forward to mission-69 candidate)
- **idea-229** — umbrella architectural anchor (Sovereign-Skill Pattern + Mission-Lifecycle-as-Skills Vision)
- **idea-230** — claude-plugin install bootstrap (consumer-install automation; pending mission depending on this mission shipping)
- **idea-227** — M-Event-Design-End-to-End (sister runtime-mechanism layer; composes via per-RACI loading discipline — future-investment)
- **mission-67** — first-canonical doc-substrate substrate-introduction (precedent for compressed-lifecycle + tier-hierarchy methodology + calibration #59 mechanism)
- **mission-68** — second-canonical code-substrate substrate-introduction (precedent for in-flight cleanup absorption + calibration #59 mechanism applied 2nd-canonically)
- **`/packages/storage-provider/` + `/packages/repo-event-bridge/`** — sovereign-package precedent that `/skills/` mirrors at mechanism layer

---

— Architect: lily / 2026-05-01 (Phase 3 Survey envelope; Director-ratified 6 picks across 2 rounds; branch-pushed pre-bilateral round-1 audit per calibration #59 3rd-canonical)
