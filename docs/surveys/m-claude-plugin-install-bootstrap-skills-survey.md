---
mission-name: M-Claude-Plugin-Install-Bootstrap-Skills
source-idea: idea-230
methodology-source: docs/methodology/idea-survey.md v1.0
director-picks:
  round-1:
    Q1: d
    Q1-rationale: composite — all three motivations (friction-removal + consistency-enforcement + discovery-completeness)
    Q2: a
    Q2-rationale: consumer-only (where consumer = Claude-Code-using clone = lily + greg + future agents in current state; non-Claude-Code consumer set is empty so (a) and (b) collapse)
    Q3: d
    Q3-rationale: hybrid — one-shot at adapter-setup + manual refresh CLI; continuous-sync deferred as anti-goal
  round-2:
    Q4: d
    Q4-rationale: hybrid auto-detect — symlink in source-tree mode + vendored-tarball in npm-installed mode; mirrors existing claude-plugin install.sh source-tree-vs-npm-installed pattern
    Q5: c
    Q5-rationale: skill-shipped settings-fragment (.skill-permissions.json per Skill); claude-plugin install.sh consolidates fragments into .claude/settings.local.json
    Q6: b
    Q6-rationale: compose — claude-plugin install.sh calls each skill's own install.sh; per-skill autonomous setup; preserves existing skills/survey/install.sh pattern
mission-class: substrate-introduction
tele-alignment:
  primary: [tele-3, tele-2]
  secondary: [tele-7, tele-12]
  round-1:
    primary: [tele-3]
    secondary: [tele-2]
  round-2:
    primary: [tele-3]
    secondary: [tele-2, tele-7]
anti-goals-count: 6
architect-flags-count: 5
skill-meta:
  skill-version: survey-v1.1
  tier-1-status: implemented
  tier-2-status: stubbed
  tier-3-status: stubbed
calibration-data:
  director-time-cost-minutes: 4
  comparison-baseline: mission-69 Survey envelope (idea-228; first-canonical Skill-mechanized Survey execution)
  notes: |
    Second-canonical Skill-mechanized Survey execution (mission-69 was first-canonical). Auto-invocation via Skill tool worked cleanly — v1.1 `disable-model-invocation: false` validated end-to-end. Director picks were terse + decisive; ~4min total Director engagement across both rounds (matches Survey methodology ~5min target). Q-design quality μ-finding surfaced: Round-1 Q2 (a) "consumer-only" vs (b) "all-clones" framings were not perfectly orthogonal in current architecture (Director caught via clarifying question; in current state lily + greg ARE consumers, so (a) and (b) collapse onto same set). Methodology-evolution candidate for round-1-template orthogonality heuristic — add explicit guidance on testing answer-set membership-collapse before dispatch. Compressed Phase 3 entry: Survey was the only un-compressed phase this mission; prior Director-direct compressions waived Survey on idea-232 (mission-70 investigate+reconcile class) but retained for this idea-230 (substrate-introduction class). Pattern emerging: Survey value scales with mission class — investigate-class compresses well, substrate-introduction class retains.
contradictory-constraints:
  # No contradictory multi-pick detected this Survey; section omitted per §15 schema
calibration-cross-refs:
  closures-applied: []
  candidates-surfaced:
    - q-design-orthogonality-membership-collapse-class
---

# M-Claude-Plugin-Install-Bootstrap-Skills — Phase 3 Survey envelope

**Methodology:** `docs/methodology/idea-survey.md` v1.0 (3+3 Director-intent pick-list)
**Source idea:** idea-230
**Mission-class candidate:** substrate-introduction (consumer-install plumbing for sovereign-Skill pattern; 2nd-canonical sovereign-Skill instance after mission-69)
**Branch:** `agent-lily/m-claude-plugin-install-bootstrap-skills` (push pre-bilateral round-1 audit per calibration #59 closure mechanism (a))

---

## §0 Context

idea-230 (M-Claude-Plugin-Install-Bootstrap-Skills) Director-originated 2026-05-01 during idea-228 design discussion. Triaged via route-(a) skip-direct 2026-05-02 (5 criteria all PASS — self-contained scope, not load-bearing on open mission, Director-intent clear from idea body's 5 enumerated scope-axes, mechanical/well-bounded, ~1-2hr small mission size).

Composes downstream of **idea-229** (Sovereign-Skill Pattern + Mission-Lifecycle-as-Skills umbrella; parked architectural anchor) and **idea-228** (first-canonical sovereign-Skill instance; incorporated via mission-69 closed 2026-05-02). idea-228's ship satisfied this idea's "at least one sovereign Skill exists at `/skills/<name>/`" precondition — `/skills/survey/` v1.1 lives there now.

Concept: claude-plugin adapter's install/setup flow auto-bootstraps sovereign Skills from `/skills/<name>/` into consumer's `.claude/skills/<name>/` (Claude Code discovery convention). `.claude/skills/` is gitignored (consumer-install location); `/skills/` is sovereign source-of-truth. Bridging the two requires per-clone install plumbing — currently manual `ln -s` per consumer per skill (drift-prone, friction-prone). Target: one-shot install with idempotent re-run on schema bump / new Skills added.

Methodology anchor: `docs/methodology/idea-survey.md` v1.0 (3+3 Director-intent pick-list with per-question architect interpretation matrix-solve). Mission-69 was first-canonical execution of the Skill-mechanized Survey; this mission is **second-canonical Survey-Skill execution** (data point for Survey-Skill v1.1 calibration loop). Per AG-9 carve-out, Survey methodology itself is NOT modified by this mission.

---

## §questions — Question text dispatched to Director

Recorded for envelope self-containment + future format-pick-presentation rendering. Standard question shape per `round-1-template.md`.

**Q1 — Motivation / value-proposition:** What's the primary value-proposition driving this install bootstrap?

- (a) Friction-removal — eliminate manual `ln -s /skills/<name> .claude/skills/<name>` + settings.json snippet steps every consumer must do per skill per clone
- (b) Consistency-enforcement — prevent skill-version drift between sovereign source `/skills/` and consumer `.claude/skills/` (sovereign always wins; no copy-paste rot)
- (c) Discovery-completeness — ensure every available sovereign Skill is reachable from every consumer (no "I didn't know that Skill existed" failure mode)
- (d) All of the above (composite framing) — the mechanism addresses all three simultaneously

**Q2 — Install audience scope:** Which clones get the bootstrap?

- (a) Consumer-only — claude-plugin's runtime install location only; only Claude Code end-users get the Skills
- (b) All-clones — every working tree (architect lily, engineer greg, future agent worktrees) gets `.claude/skills/` populated as part of install
- (c) Role-filtered (per-RACI) — architect installs Survey + Preflight + Closing-Audit; engineer installs PR-cycle + work-trace; per-role default plus opt-in/opt-out flags
- (d) Explicit-opt-in — consumer enables per-skill via flag; default off

**Q3 — Install cadence / lifecycle-touch:** When does install run?

- (a) Adapter-setup-time only — one-shot at `install.sh` invocation; consumer manually re-runs to refresh
- (b) On-demand per-skill — `bash skills/<name>/install.sh` per skill; bootstrap is a script we ship, not auto-invoked
- (c) Continuous-sync — background hook detects sovereign-source updates + auto-refreshes (e.g., post-`git pull` or via filesystem-watcher)
- (d) Hybrid — one-shot at adapter-setup + manual refresh CLI for ad-hoc; continuous-sync deferred as anti-goal

**Q4 — Install mechanism:** How is `.claude/skills/<name>/` actually populated?

- (a) Symlink — `.claude/skills/survey -> /home/apnex/taceng/<repo>/skills/survey` (sovereign source-of-truth wins)
- (b) Copy — full tree replicated; each refresh re-copies; consumer edits get clobbered on refresh
- (c) Vendored-tarball — for npm-installed mode; `.claude/skills/<name>/` populated from package contents
- (d) Hybrid auto-detect — symlink in source-tree mode; vendored-tarball in npm-installed mode; auto-detected per existing `adapters/claude-plugin/install.sh` pattern

**Q5 — Permission allowlist handling:** How are `.claude/settings.local.json` Bash permission entries handled?

- (a) Print snippet, manual paste — current Survey-Skill v1.1 pattern; install.sh prints JSON snippet; user copy-pastes
- (b) Auto-merge — install.sh reads existing settings.local.json + merges new allowlist entries; warns on conflict; idempotent
- (c) Skill-shipped settings-fragment — each Skill ships `.skill-permissions.json`; bootstrap consolidates fragments into settings.local.json automatically
- (d) Defer to per-Skill install.sh — claude-plugin install.sh delegates permission UX to each skill's own install.sh

**Q6 — Discovery + composition:** Does claude-plugin own the install logic, or compose?

- (a) Own it — claude-plugin walks `/skills/`, symlinks each into `.claude/skills/`; per-skill install.sh bypassed
- (b) Compose — claude-plugin install.sh calls each skill's own install.sh in turn; per-skill autonomous setup
- (c) Hybrid — claude-plugin owns the symlink walk; calls per-skill install.sh ONLY for post-symlink-hooks if a skill ships one
- (d) Discovery-only — claude-plugin lists available skills + prompts user to opt-in per-skill; no auto-install

---

## §1 Round 1 picks

| Q | Pick | Director-intent reading (1-line summary) |
|---|---|---|
| Q1 — Motivation / value-proposition | **d** all-of-the-above (composite) | Mechanism must satisfy friction-removal + consistency-enforcement + discovery-completeness simultaneously |
| Q2 — Install audience scope | **a** consumer-only | Universal across Claude-Code-using clones (lily + greg + future agents); (a)/(b) collapse in current architecture |
| Q3 — Cadence / lifecycle-touch | **d** hybrid | One-shot at adapter-setup + manual refresh CLI; continuous-sync deferred as anti-goal |

### §1.Q1 — Per-question interpretation

Director's **(d) all-of-the-above** read against **Original Idea** (5 enumerated scope-axes; idea body explicitly cites "friction-prone + drift-prone" current state) + **Tele-mapping** (tele-3 sovereign-composition primary; tele-2 isomorphic-specification secondary) + **Aggregate-Surface** (Q2=a + Q3=d both reinforce a value-system framing rather than narrow-mechanism framing): the install bootstrap is positioned as **infrastructure plumbing that simultaneously satisfies three distinct value-pillars**, not a point-solution for one pain. This bounds Phase 4 Design to architectures where mechanism choices must be evaluated against ALL three (e.g., a copy-based install satisfies friction-removal but FAILS consistency-enforcement → would violate the composite envelope).

The composite read also tightens later anti-goal scope: design choices that optimize one pillar at the expense of the others (e.g., heavyweight continuous-sync that reduces friction further but adds operational fragility) need explicit Director-flagged rationale to ship.

### §1.Q2 — Per-question interpretation

Director's **(a) consumer-only** with clarifying question read against **Original Idea** (idea cites `/skills/<name>/` → `.claude/skills/<name>/` mapping; `.claude/skills/` is a Claude-Code-runtime convention) + **Tele-mapping** (tele-3 sovereign-composition; tele-12 precision-context-engineering secondary): the audience is **the Claude-Code runtime population**, which in current state IS lily + greg + future agent worktrees. There's no "non-Claude-Code consumer" set to distinguish (a) from (b) against — they collapse in current architecture.

The pick **rules out** future per-RACI filtering (c) and explicit-opt-in (d) at the install layer — install is universal across Claude-Code clones; any role-filtering happens elsewhere (likely in Skills' own SKILL.md `disable-model-invocation` or per-Skill activation policies, NOT in install plumbing). This is a **scope-narrowing pick**: keeps install plumbing simple + universal.

### §1.Q3 — Per-question interpretation

Director's **(d) hybrid** read against **Original Idea** ("re-run install on schema bump / new Skills added; idempotent" — exactly the hybrid pattern) + **Tele-mapping** (tele-7 resilient-agentic-operations primary; tele-12 precision-context-engineering secondary; tele-3 sovereign-composition tertiary) + **Aggregate-Surface** (Q1=d composite-value + Q2=a universal-audience favor a model where install is automatic-where-possible + manual-where-needed): adapter-setup is the one-shot trigger for the common case; a manual CLI handles ad-hoc refresh after `git pull` or new-Skill-added events; **continuous-sync (filesystem-watcher / git-hook auto-refresh) is explicitly deferred as anti-goal** — keeping operational surface small.

This composes naturally with the existing `skills/<name>/install.sh` pattern shipped with mission-69's `/skills/survey/install.sh` — that script IS the manual refresh CLI for the survey skill. Phase 4 Design will need to decide whether the bootstrap is "claude-plugin install.sh calls each `skills/<name>/install.sh`" (composition) or "claude-plugin install.sh does its own walk-and-symlink" (independent mechanism). [Resolved at Round-2 Q6=b: compose.]

**Round-1 composite read:** install bootstrap is universal infrastructure for the Claude-Code agent population, motivated by composite friction+drift+discovery value, with hybrid one-shot-at-setup-plus-manual-refresh cadence and continuous-sync explicitly excluded. This bounds Phase 4 to a small + scope-stable + mechanically-conservative design space.

---

## §2 Round 2 picks

| Q | Pick | Director-intent reading (1-line summary) |
|---|---|---|
| Q4 — Install mechanism | **d** hybrid auto-detect | Symlink in source-tree mode + vendored-tarball in npm-installed mode; mirrors existing claude-plugin install.sh dual-context detection |
| Q5 — Permission allowlist handling | **c** skill-shipped settings-fragment | Each Skill ships `.skill-permissions.json`; claude-plugin install.sh consolidates fragments into settings.local.json; supersedes manual-snippet-paste |
| Q6 — Discovery + composition | **b** compose | claude-plugin install.sh walks /skills/ + invokes each skill's own install.sh; preserves per-skill autonomy + existing skills/survey/install.sh pattern |

### §2.Q4 — Per-question interpretation

Pick read against **Original Idea** (idea body explicitly contemplated symlink-preferred OR copy-alternative; vendored-tarball wasn't enumerated but is implied by the existing `adapters/claude-plugin/install.sh` source-tree-vs-npm-installed detection precedent) + **Round-1 carry-forward** (Q3=d hybrid cadence reinforces hybrid mechanism — both compose) + **Round-2 tele-mapping** (tele-7 resilient-agentic-operations primary; tele-3 sovereign-composition secondary): the install bootstrap **mirrors the existing claude-plugin install.sh dual-context pattern** rather than introducing a new mechanism. Source-tree mode (current lily/greg state) = symlink to sovereign source; npm-installed mode (future package-published consumer) = vendored-tarball contents copied into place. Single `install.sh` auto-detects via `npm prefix -g` membership check.

This pick **rules out** copy-only mechanism (b) which would lose sovereign source-of-truth in source-tree mode + violate Q1=d consistency-enforcement pillar.

### §2.Q5 — Per-question interpretation

Pick read against **Original Idea** (no explicit pre-anchor on permissions; this is a Round-2 architect-introduced dimension) + **Round-1 carry-forward** (Q1=d composite-value favors uniform discovery; Q2=a universal-audience favors declarative permissions over per-clone manual paste) + **Round-2 tele-mapping** (tele-2 isomorphic-specification primary; tele-3 sovereign-composition secondary): each Skill ships **`.skill-permissions.json`** (declarative permissions fragment, schema TBD at Phase 4 Design); claude-plugin install.sh's job is to **walk all `/skills/<name>/.skill-permissions.json` fragments + merge into `.claude/settings.local.json`** under `permissions.allow`. Idempotent merge (no duplicate entries; warns on conflict).

This pick **supersedes** the current Survey-Skill v1.1 pattern (manual snippet paste). The Survey Skill should be retrofitted in Phase 8 implementation to ship `.skill-permissions.json` (small backward-compat fold; ~5 lines of JSON replacing ~10 lines of shell prompt-and-print). Anti-goal candidate: do NOT expand `.skill-permissions.json` schema to cover other Claude-Code settings (env vars, hooks, etc.) — keep narrow to `permissions.allow` for v1; broader scope deferred to follow-on idea.

### §2.Q6 — Per-question interpretation

Pick read against **Original Idea** (idea body's "symlink (preferred; reflects sovereign source-of-truth)" implicitly assumes per-skill autonomy on what gets symlinked) + **Round-1 carry-forward** (Q1=d composite + Q3=d hybrid favor delegation-with-orchestration over uniform-walk) + **Round-2 tele-mapping** (tele-3 sovereign-composition primary; tele-7 resilient-agentic-operations secondary): claude-plugin install.sh **walks `/skills/<name>/` + invokes each skill's own `install.sh`** (per-skill autonomous setup — symlink, skill-specific bootstrap, etc.). Then claude-plugin install.sh separately consolidates `.skill-permissions.json` fragments per Q5=c.

Composition resolves the Q5/Q6 boundary cleanly: per-skill `install.sh` handles symlink + any skill-specific setup; per-skill `.skill-permissions.json` declares permission fragments; claude-plugin install.sh orchestrates: enumerate /skills/ → call each skill's install.sh → consolidate permission fragments → write merged settings.local.json. This pick **explicitly preserves** the existing `skills/survey/install.sh` pattern (mission-69 deliverable) — that script becomes one of the per-skill install.sh files claude-plugin invokes, rather than being deprecated.

**Round-2 composite read:** mechanism is hybrid-auto-detect symlink/vendored-tarball; permissions are skill-shipped declarative fragments consolidated centrally; orchestration is claude-plugin-calls-per-skill-install.sh with central permission consolidation. Three mechanisms compose into one bootstrap pass.

---

## §3 Composite intent envelope

The mission ships consumer-install plumbing for the sovereign-Skill pattern with these load-bearing constraints (matrix-solved across both rounds):

1. **Universal audience**: every Claude-Code-using clone (current lily + greg + future agents); install is automatic across the population, not opt-in (Q2=a).
2. **Composite value**: addresses friction-removal + consistency-enforcement + discovery-completeness simultaneously; mechanism choices must satisfy all three (Q1=d).
3. **Hybrid cadence**: one-shot at adapter-setup + manual refresh CLI; continuous-sync explicitly excluded as anti-goal (Q3=d).
4. **Hybrid mechanism**: symlink in source-tree mode; vendored-tarball in npm-installed mode; auto-detected per existing claude-plugin install.sh pattern (Q4=d).
5. **Declarative permissions**: each Skill ships `.skill-permissions.json`; claude-plugin install.sh consolidates fragments into `.claude/settings.local.json`; supersedes manual-snippet-paste (Q5=c).
6. **Composing orchestration**: claude-plugin install.sh walks `/skills/` + invokes each skill's own install.sh; preserves per-skill autonomy + existing `skills/survey/install.sh` pattern (Q6=b).

Phase 4 Design v0.1 concretizes each constraint into specific scripts + JSON schemas + retrofit work for `skills/survey/`. Primary outcome: claude-plugin's `adapters/claude-plugin/install.sh` extended with skill-bootstrap orchestration; secondary outcome: `skills/survey/` retrofit to ship `.skill-permissions.json` + remove manual-snippet-print logic.

---

## §4 Mission scope summary

| Axis | Bound |
|---|---|
| Mission name | M-Claude-Plugin-Install-Bootstrap-Skills |
| Mission class | substrate-introduction (consumer-install plumbing for sovereign-Skill pattern) |
| Substrate location | `adapters/claude-plugin/install.sh` (extension) + `/skills/<name>/.skill-permissions.json` (new file per skill) + `skills/survey/` retrofit |
| Primary outcome | claude-plugin install.sh auto-bootstraps sovereign Skills (`/skills/<name>/` → `.claude/skills/<name>/` via symlink-in-source-tree / vendored-tarball-in-npm-installed) + consolidates `.skill-permissions.json` fragments into `.claude/settings.local.json` |
| Secondary outcomes | (a) `skills/survey/` retrofit to ship `.skill-permissions.json` + remove manual-snippet-print; (b) `.skill-permissions.json` schema codified at Phase 4 Design |
| Tele alignment (primary, whole-mission) | tele-3 (Sovereign Composition); tele-2 (Isomorphic Specification) |
| Tele alignment (secondary, whole-mission) | tele-7 (Resilient Agentic Operations); tele-12 (Precision Context Engineering) |
| Tele alignment (Round-1) | primary: tele-3; secondary: tele-2 |
| Tele alignment (Round-2) | primary: tele-3; secondary: tele-2, tele-7 |

---

## §5 Anti-goals (out-of-scope; deferred)

| AG | Description | Composes-with target |
|---|---|---|
| AG-1 | Don't expand `.skill-permissions.json` schema beyond `permissions.allow` for v1 (env vars, hooks, MCP server config, etc.) — keep narrow | follow-on idea (TBD; expand after 2nd-canonical sovereign-Skill ships needing it) |
| AG-2 | Don't add continuous-sync mechanism (filesystem-watcher / git-hook auto-refresh) per Q3=d explicit deferral | future idea (TBD; only if friction warrants it) |
| AG-3 | Don't refactor existing claude-plugin source-tree-vs-npm-installed detection logic; reuse pattern as-is | n/a — explicitly out-of-scope |
| AG-4 | Don't introduce per-RACI permission filtering at install layer per Q2=a (universal audience); role-filtering belongs in Skill activation, not install | future idea-229 codification (sovereign-Skill activation methodology) |
| AG-5 | Don't deprecate `skills/survey/install.sh`; retrofit to add `.skill-permissions.json` + remove manual-snippet-print, but keep symlink installation logic | mission-69 delivery preserved as load-bearing |
| AG-6 | Don't codify sovereign-Skill consumer-install methodology in `docs/methodology/sovereign-skills.md` per mission-69 retrospective; defer until 2nd-canonical consumer-install instance surfaces (this mission is 1st-canonical for consumer-install layer) | future-canonical-instance trigger |

---

## §6 Architect-flags / open questions for Phase 4 Design round-1 audit

| # | Flag | Architect-recommendation |
|---|---|---|
| F1 (CRITICAL) | `.skill-permissions.json` schema design — exact field names, schema-version, extension surface boundary | Propose minimal schema: `{schema-version: "1.0", permissions: {allow: [...]}}`; lock extension surface to `permissions.*` only per AG-1; defer `env`/`hooks` to follow-on |
| F2 (MEDIUM) | Conflict resolution in settings.local.json merge — what if user has manually-added entries that conflict with skill-shipped fragments? | Propose: warn-and-skip on conflict (preserve user intent); print summary of skipped entries; idempotent on re-run |
| F3 (MEDIUM) | Source-tree vs npm-installed detection edge cases — stale symlink (source deleted), partial install (some skills succeed, others fail) | Propose: validate each skill's source exists pre-symlink; on failure, print error + continue (best-effort); summary of installed/failed at end |
| F4 (MINOR) | Consumer-edits scenario — user edits `.claude/skills/<name>/SKILL.md` for personal customization; refresh wipes (symlink) or copies-over (vendored) | Document explicitly: consumer-edits to `.claude/skills/<name>/` are NOT preserved across refresh; sovereign source-of-truth wins; if customization needed, fork the Skill into separate `/skills/<custom-name>/` |
| F5 (PROBE) | Cross-repo skill sources — future scenarios where skills come from OTHER repos (not just this monorepo) | Out-of-scope for v1 (universal audience = Claude-Code-clones-of-THIS-repo); flag as forward design surface; leave Phase 4 Design pluggable enough to extend |

---

## §7 Sequencing / cross-mission considerations

### §7.1 Branch + PR strategy

Branch handle: `agent-lily/m-claude-plugin-install-bootstrap-skills`. Push pre-bilateral round-1 audit per calibration #59 closure mechanism (a) — 4th-canonical instance.

PR cadence: single PR (small mission; ~1-2hr architect-side estimated; substrate-introduction class but narrow scope). Single commit per logical change OR cumulative-fold pattern per mission-68 M6 if engineer-audit cycle surfaces folds.

### §7.2 Composability with concurrent / pending work

- **idea-228 / mission-69 (closed)**: Survey Skill v1.1 is the precondition; this mission retrofits `skills/survey/install.sh` + adds `.skill-permissions.json` (per AG-5)
- **idea-229 (parked architectural anchor)**: this mission is 1st-canonical instance of consumer-install layer for the sovereign-Skill umbrella; codification deferred per AG-6 + mission-69 retrospective
- **adapters/claude-plugin/install.sh** (existing; mission-64-era): extends via composition, NOT refactor (AG-3)
- **mission-70 retrospective μ-findings**: this mission's compressed-lifecycle compression points should fold the μ2 + μ5 currency-checks (compressed-lifecycle preflight currency-check class per memory entry) at Phase 6 preflight authoring time

### §7.3 Same-day compressed-lifecycle candidate?

**Yes — strong candidate.** Scope is small (~1-2hr architect-side); investigation-class is mostly closed (Round-2 Q-design enumerated mechanism choices); engineer-audit cycle would normally catch `.skill-permissions.json` schema flaws or merge-logic gaps, but those are mechanical + self-evidencing at Phase 8 implementation time (test-driven). Director may compress on Phase 4 Design v0.1 → v1.0 ratify-direct (mission-70 precedent). Alternative: bilateral-with-greg cycle for substrate-introduction class discipline (mission-69 precedent for sovereign-Skill missions).

Architect-recommendation at Phase 4 entry: surface compression option to Director; lean toward compress given small scope + mechanical work.

---

## §calibration — Calibration data point

Per `idea-survey.md` §5 (Survey output element) + §15 schema. Captures empirical baseline for methodology-evolution loop per §13 Forward Implications.

- **Director time-cost (minutes):** 4 (across both Survey rounds; terse + decisive picks)
- **Comparison baseline:** mission-69 Survey envelope (idea-228; first-canonical Skill-mechanized Survey execution)
- **Notes:** Second-canonical Skill-mechanized Survey execution (mission-69 = 1st-canonical). Auto-invocation via Skill tool worked cleanly — v1.1 `disable-model-invocation: false` validated end-to-end. Director picks were terse + decisive; ~4min total Director engagement matches Survey methodology ~5min target. **Q-design quality μ-finding surfaced**: Round-1 Q2 (a) "consumer-only" vs (b) "all-clones" framings were not perfectly orthogonal in current architecture — Director caught via clarifying question; in current state lily + greg ARE consumers, so (a) and (b) collapse onto same set. Methodology-evolution candidate for `round-1-template.md` orthogonality heuristic — add explicit guidance on testing answer-set membership-collapse before dispatch. **Compression pattern emerging**: Survey value scales with mission class — investigate-and-reconcile class (mission-70 / idea-232) compresses well via Director-direct waiver; substrate-introduction class (this mission / idea-230 + mission-69 / idea-228) retains Survey discipline; Director's selective compression suggests an emergent class-based compression heuristic worth documenting in `mission-lifecycle.md` Phase 3 entry guidance.

---

## §8 Cross-references

- **`docs/methodology/idea-survey.md`** v1.0 — canonical Survey methodology this mission consumes (NOT modified per AG-9 carve-out; mission-69 already exhausted §15 schema enrichment scope)
- **`docs/methodology/strategic-review.md`** — Idea Triage Protocol (route-(a) skip-direct rationale applied 2026-05-02; 5/5 criteria PASS)
- **`docs/methodology/mission-lifecycle.md`** v1.2 — Phase 3 entry methodology + §3 mission-class taxonomy (substrate-introduction)
- **`docs/calibrations.yaml`** — calibration ledger cross-refs (closures-applied: []; candidates-surfaced: q-design-orthogonality-membership-collapse-class)
- **idea-230** — source idea (status: triaged → will flip to incorporated at mission-create)
- **idea-228** — first-canonical sovereign-Skill instance (incorporated via mission-69; precondition satisfied)
- **idea-229** — Sovereign-Skill umbrella (parked architectural anchor; this mission = 1st-canonical for consumer-install layer)
- **mission-69** — Survey envelope baseline reference (`docs/surveys/m-survey-process-as-skill-survey.md`; commit `ce5b6c1`)
- **mission-70** — compressed-lifecycle preflight currency-check μ-findings (memory: `feedback_compressed_lifecycle_preflight_currency_checks.md`)

---

— Architect: lily / 2026-05-02 (Phase 3 Survey envelope; Director-ratified 6 picks across 2 rounds; branch-pushed pre-bilateral round-1 audit per calibration #59 closure mechanism (a) — 4th-canonical)
