# M-Claude-Plugin-Install-Bootstrap-Skills Preflight (mission-pending)

**Mission:** pending creation (status: `proposed` post-create)
**Class:** substrate-introduction (consumer-install plumbing for sovereign-Skill pattern; 1st-canonical instance for the consumer-install layer)
**Filed:** 2026-05-02 (same-session Phase 5 Manifest from Phase 4 Design v1.0 ratify-bilateral)
**Verdict:** **GREEN**
**Author:** lily (architect)

---

## Context

Mission-pending implements idea-230 (M-Claude-Plugin-Install-Bootstrap-Skills) per Director-direct routing 2026-05-02 ("a — design with greg" / bilateral engineer-audit cycle). Phase 4 Design v1.0 RATIFIED via 3-round audit cycle (15 round-1 findings + 2 round-2 NEW findings = 17/17 folded total) sealed via thread-465 round-3 engineer convergence.

Mission shape: substrate-introduction with Phase 8 single-PR cumulative on `agent-lily/m-claude-plugin-install-bootstrap-skills` per §7. Architect-driven implementation (governance + bash + JSON schema work; engineer cross-approves at PR-open per standard bilateral pattern).

Per Director directive 2026-05-02 ("Full autonomous. Approved"): architect proceeds Phase 6 → Phase 7 → Phase 8 → Phase 9 → Phase 10 + mission-flip without further Director gate-engagement; engineer cross-approves at PR-open only.

Cross-references for preflight check:
- Survey envelope: `docs/surveys/m-claude-plugin-install-bootstrap-skills-survey.md` (commit `b6f3c5b`)
- Design v1.0 RATIFIED: `docs/designs/m-claude-plugin-install-bootstrap-skills-design.md` (commit `0a23add`)
- Source idea: idea-230 (status: `triaged`; will flip `incorporated` + populate missionId at mission-create)
- Bilateral thread: thread-465 (sealed converged 2026-05-02; 3 audit rounds; 2 close_no_action actions committed)
- Companion: idea-228 / mission-69 (precondition; `/skills/survey/` v1.1 lives there) + idea-229 (parked umbrella)

---

## §A Documentation integrity

| # | Check | Result | Notes |
|---|---|---|---|
| A1 | Brief files (Survey + Design) exist + committed | ✅ PASS | Survey at `docs/surveys/m-claude-plugin-install-bootstrap-skills-survey.md` (commit `b6f3c5b`); Design v1.0 at `docs/designs/m-claude-plugin-install-bootstrap-skills-design.md` (commit `0a23add`); both on `agent-lily/m-claude-plugin-install-bootstrap-skills` HEAD `0a23add` |
| A2 | Local branch in sync with `origin` | ✅ PASS | `agent-lily/m-claude-plugin-install-bootstrap-skills` pushed to `origin`; engineer (greg) verified-readable across thread-465 3 audit rounds; calibration #59 closure mechanism (a) applied 4th-canonically |
| A3 | Cross-referenced artifacts exist | ✅ PASS | All cross-refs verified at thread-465 audit rounds: `docs/methodology/idea-survey.md` v1.0 + `docs/methodology/strategic-review.md` (Idea Triage Protocol; route-(a) skip-direct 5/5 PASS) + `docs/methodology/mission-lifecycle.md` v1.2 + `adapters/claude-plugin/install.sh` (mission-64-era; 73 lines) + `skills/survey/install.sh` (mission-69-era; 134 lines) — all citations resolved |

---

## §B Hub filing integrity

| # | Check | Result | Notes |
|---|---|---|---|
| B1 | Mission entity correct shape (pending creation) | ⏸️ PENDING | Will create immediately post-preflight per Director-autonomous directive; status=`proposed` → `active` flip at execution start |
| B2 | `title` + `description` faithful to Design | ✅ PASS (planned) | title="M-Claude-Plugin-Install-Bootstrap-Skills"; description = composite intent envelope summary (6 picks across 2 rounds + 17/17 audit-fold history + 3-mechanism composition + bilateral seal 2026-05-02) |
| B3 | `plannedTasks[]` populated | ✅ PASS (planned) | Single architect-Responsibility track outside cascade per mission-68 §4.3 + mission-69 + mission-70 precedent. plannedTasks=[] (architect-driven implementation; closing audit + retrospective + execution all architect-direct; engineer cross-approves at PR-open) |
| B4 | Source idea linked | ✅ PASS (planned) | idea-230 will flip status `triaged` → `incorporated` + populate missionId at mission-create time |
| B5 | Pulses configured per mission-68 unified semantics | ✅ PASS (planned) | engineerPulse 600s + architectPulse 1200s + missedThreshold=2 (default; auto-injected). Per mission-70 retrospective μ5 + memory `feedback_compressed_lifecycle_preflight_currency_checks.md`: engineerPulse on architect-Responsibility/audit-WAIVED missions is template-noise — but THIS mission's audit cycle was NOT waived (3 rounds completed); engineerPulse is contextually appropriate for cross-approve coordination at PR-open. Retain default config |

---

## §C Referenced-artifact currency

| # | Check | Result | Notes |
|---|---|---|---|
| C1 | File paths cited in Design exist | ✅ PASS | All cited paths verified during Phase 4 audit cycles + at preflight authoring: `adapters/claude-plugin/install.sh` (73 lines), `skills/survey/install.sh` (134 lines), `skills/survey/SKILL.md`, `skills/survey/install.test.sh` (134 lines) — all live in working tree. **μ-finding caught at preflight (NEW; will fold to Phase 8 work-trace):** `adapters/claude-plugin/install.test.sh` referenced in Design §6.1 as "(existing): extend" but does NOT exist in current working tree; will CREATE from scratch in Phase 8 (modeled on `skills/survey/install.test.sh` pattern). Both audit rounds missed this — single-instance carry-as-awareness; potential calibration class "verify referenced-existing-files actually exist at Design-ratify time" |
| C2 | Numeric claims verified | ✅ PASS | Design v1.0 size: 461 lines; bilateral fold count: 15 round-1 + 2 round-2 NEW = 17 findings total; thread-465 round count: 3/10; AG count: 8 (AG-7 + AG-8 NEW v0.2); architect-flag count: 5 (F1-F5 all addressed) |
| C3 | Cited ideas/missions/threads in assumed state | ✅ PASS | idea-230 status=`triaged` (just-flipped from `open` 2026-05-02 11:13Z); idea-228 status=`incorporated` (mission-69 precondition satisfied); idea-229 status=`open` (parked umbrella; this mission = 1st-canonical consumer-install layer); idea-186 = workspaces (shipped via mission-64 PR #122; per mission-70 §11 verification); thread-465 sealed (status=converged via 2 close_no_action actions committed); mission-69 + mission-70 closed |
| C4 | Dependency prerequisites in assumed state | ✅ PASS | mission-69 shipped (Survey Skill v1.1 at `/skills/survey/`); mission-70 shipped (.gitignore reconcile + idea-233 follow-on filed); npm workspaces topology stable (root `package.json` has `workspaces: ["packages/*", "adapters/*"]` per mission-64 PR #122); claude-plugin install.sh source-tree-vs-npm-installed detection logic stable + extends-not-refactors per AG-3 |

---

## §D Methodology compliance

| # | Check | Result | Notes |
|---|---|---|---|
| D1 | Survey not waived (substrate-introduction class) | ✅ PASS | Survey was NOT compressed for this mission (Director directive 2026-05-02 "Move to survey"); 6 picks ratified across 2 rounds via `/survey` Skill v1.1 auto-invocation; envelope at `docs/surveys/m-claude-plugin-install-bootstrap-skills-survey.md` |
| D2 | Engineer-audit cycle not waived (substrate-introduction class) | ✅ PASS | Director-direct routing 2026-05-02 ("a — design with greg") chose bilateral cycle over ratify-direct compression; 3 audit rounds via thread-465 caught + folded 17 findings (including round-2's regression-detection of round-1's C1 refactor introducing N1 correctness bug). Round-1 + Round-2 + Round-3 all bilateral; v1.0 RATIFIED with bilateral seal |
| D3 | Compressed-lifecycle pattern documented | ✅ PASS | Phase 6+7+8+9+10 compression authorized by Director directive "Full autonomous. Approved" 2026-05-02; this mission joins mission-67/68/69/70 compressed-lifecycle precedent at the post-Phase-4 boundary (post-bilateral-seal) |
| D4 | RACI honored | ✅ PASS | Architect drives execution; engineer cross-approves at PR-open per standard pattern; Director engaged at Phase 3 Survey + Phase 4 routing + Phase 7 autonomous-execute ratify (3 gate-points); RACI per `mission-lifecycle.md` v1.2 §1 |

---

## §E Scope clarity

| # | Check | Result | Notes |
|---|---|---|---|
| E1 | Mission deliverable enumerated | ✅ PASS | Single PR per Design §7 content map: claude-plugin install.sh extended (~+95 lines incl. C1 helper-extraction +15) + `.skill-permissions.json` (NEW per skill) + skills/survey/install.sh modifications + SKILL.md v1.1 → v1.2 bump + adapters/claude-plugin/install.test.sh CREATED + skills/survey/install.test.sh extended + scripts/local/test-skill-bootstrap.sh NEW + Design v0.1 → v0.2 → v1.0 + this preflight + Phase 8/9/10 work-trace. Total ~1185 lines net |
| E2 | Out-of-scope items enumerated | ✅ PASS | Design §8 anti-goals (8 total): AG-1 narrow `.skill-permissions.json` schema / AG-2 no continuous-sync / AG-3 no claude-plugin source-tree-vs-npm refactor / AG-4 no per-RACI install filtering / AG-5 retrofit (don't deprecate) skills/survey/install.sh / AG-6 defer sovereign-Skill consumer-install methodology codification / AG-7 NEW no multi-source skill enum / AG-8 NEW v0.2 no permission-pattern-normalization (subsumption / glob-expansion dedup) |
| E3 | Success criteria measurable | ✅ PASS | Design §6.3 verification gates: §6.1 + §6.2 all pass on PR branch; `git grep -c "settings.local.json" skills/survey/install.sh` → 0 post-retrofit; `cat SKILL.md | grep -c "v1.2"` → 1; `jq . skills/survey/.skill-permissions.json` exits 0; `jq -e '.["schema-version"]' ... | grep -E '^"1\\.'` returns 0 |

---

## §F Risks + mitigations

| # | Risk | Mitigation |
|---|---|---|
| F1 | C1 helper-extraction implementation diverges from current inline detection (`[ -d "$PLUGIN_DIR/../../packages/network-adapter" ]` test, NOT package.json walk-up sketched in pseudocode) | Per Design §3.1.a disclaimer "actual extraction preserves current behavior verbatim" — implementation MUST extract exact existing test, not pseudocode walk-up. Phase 8 verification: `bash adapters/claude-plugin/install.sh` from source-tree mode pre/post refactor produces identical CONTEXT detection |
| F2 | npm-installed mode deferred verification (mission post-Phase-8 flag per §3.5): `@apnex/claude-plugin` package may not include `skills/` in its npm-published files[] | Out-of-scope for this mission's verification (no npm-publish in PR scope); deferred to next claude-plugin npm publish; Phase 8 work-trace flags this for the next-canonical npm-publish PR |
| F3 | μ-finding (caught at preflight): `adapters/claude-plugin/install.test.sh` doesn't exist; Design §6.1 said "extend" | Adjusted Phase 8 implementation: CREATE from scratch modeled on `skills/survey/install.test.sh` pattern. Document at Phase 8 work-trace as μ-finding for retrospective consumption |
| F4 | jq dependency for `merge_skill_permissions()` + `emit_snippet_fallback()` — claude-plugin install.sh currently uses pure bash (skills/survey/install.sh comment line 12 "AG-7 compliance: pure bash + POSIX utilities; no python/yq/jq" suggests anti-goal context exists) | claude-plugin install.sh is NOT under that AG-7 (which was per-Skill scope in mission-69). claude-plugin already runs in npm context where jq is reasonable to require; if issues surface, fall back to bash-only JSON parsing or document jq prerequisite. Mitigated by Phase 8 smoke-test |
| F5 | Cross-approval timing: greg may not be available immediately post-PR-open | Standard async pattern: open thread, post message, wait. mission-69/70 precedent shows 5-30min response window typical. PR can sit unmerged without affecting mission state; mission-flip happens on merge |

---

## Verdict

**GREEN** — all 6 categories PASS or have planned-PASS items contingent only on mission-create which is the immediate next action. F3 μ-finding caught at preflight (test file CREATE-not-extend); folded into Phase 8 implementation plan with no blocking impact. F4 jq dependency assumed present in claude-plugin runtime context; verified at Phase 8 smoke-test.

Architect proceeds to mission-create + Phase 8 implementation + Phase 9 closing audit + Phase 10 retrospective + mission-flip per Director-autonomous-execute directive.
