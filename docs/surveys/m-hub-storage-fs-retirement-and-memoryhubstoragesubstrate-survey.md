---
mission-name: M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate
source-idea: idea-300
methodology-source: docs/methodology/idea-survey.md v1.0
director-picks:
  round-1:
    Q1: ac
    Q1-rationale: substrate-currency cleanup + cloud-deploy de-risking as composed primary outcomes (orthogonal multi-pick; methodology §6)
    Q2: c
    Q2-rationale: maximum substrate-only including STORAGE_BACKEND env var removal
    Q3: a
    Q3-rationale: strict prerequisite before idea-298 cloud-deploy
  round-2:
    Q4: a
    Q4-rationale: full retirement of packages/storage-provider/; repo-event-bridge migrates to HubStorageSubstrate; bonus-closes substrate-currency-failure cluster #23 (ephemeral-persistence defect surfaced via Director-clarifying-question grep-walk)
    Q5: b
    Q5-rationale: Standard conformance suite (race + CAS + watch-event + restart-safety); mirrors mission-47 StorageProvider conformance suite scope precedent
    Q6: d
    Q6-rationale: architectural-discipline only; trust-based via architect+engineer review + retro-encoded substrate-currency-failure cluster pattern; conformance suite is sole architectural-defense vector
mission-class: pre-substrate-cleanup
tele-alignment:
  primary: [tele-3, tele-8]
  secondary: [tele-7, tele-9]
  round-1:
    primary: [tele-3]
    secondary: [tele-9]
  round-2:
    primary: [tele-3, tele-8]
    secondary: [tele-7, tele-9]
anti-goals-count: 5
architect-flags-count: 4
skill-meta:
  skill-version: survey-v1.0
  tier-1-status: implemented
  tier-2-status: stubbed
  tier-3-status: stubbed
calibration-data:
  director-time-cost-minutes: 8
  comparison-baseline: idea-206 first-canonical Survey (~5min); mission-83 idea-294 Survey (~5min); idea-300 slightly higher due to Director-clarifying-question grep-walk surfacing cluster #23
  notes: Director-Round-2-clarifying-question pattern (Q4 "help me understand repo-event-bridge dependency on storage") triggered architect grep-verify discipline + surfaced substrate-currency-failure cluster #23 (repo-event-bridge ephemeral-persistence in substrate-mode; mission-83 W5.4-Hub-bootstrap-flip silently introduced; cursor-store.ts "Survives Hub restart" commitment violated). Methodology-evolution candidate — codify "Round 2 clarifying questions as substrate-currency audit surface" as positive-pattern. Bilateral architect-grep-before-claim discipline (per feedback_substrate_currency_audit_rubric.md ARCHITECT-SIDE EXTENSION) yielded the defect surface as a Survey side-effect.
contradictory-constraints:
  # Optional; required when contradictory multi-pick detected per idea-survey.md §7
  # - round: 1
  #   questions: [Q-2]
  #   picks: [a, c]
  #   constraint-envelope: <description of common-satisfiable constraint Director is signaling>
calibration-cross-refs:
  closures-applied: []
  candidates-surfaced:
    - substrate-currency-failure cluster #23 (repo-event-bridge ephemeral-persistence in substrate-mode; mission-83 W5.4-Hub-bootstrap-flip silently introduced; cluster sibling to architect-side 16-instance cluster from mission-83 retro)
    - positive-pattern Director-Round-2-clarifying-question-as-substrate-currency-audit-surface (Q4 "help me understand X" triggered architect grep-walk that yielded cluster #23 defect surface; methodology-evolution candidate)
---

# M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate — Phase 3 Survey envelope

**Methodology:** `docs/methodology/idea-survey.md` v1.0 (3+3 Director-intent pick-list)
**Source idea:** idea-300
**Mission-class candidate:** `pre-substrate-cleanup` (per `mission-lifecycle.md` §3 taxonomy; analogous-to mission-83's `substrate-introduction` class but inverted scope — retiring rather than introducing)
**Branch:** `agent-lily/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate` (push pre-bilateral round-1 audit per calibration #59 closure mechanism (a))

---

## §0 Context

**Origin:** filed by architect (lily) 2026-05-17 post mission-83 W6 scope-rescope (sourceThreadId=thread-573). Updated 2026-05-18 with mission-83 Phase 10 retrospective folded items (PR #203 revert + STORAGE_BACKEND=memory retirement + Counter abstraction unification + substrate-conformance test suite + Document MCP tools re-introduction). Mission-83 W6 narrowed scope (GCS-only deletion at `6bcdb5d`) due to discovery that `hub/test/*` (~22 files; ~170 tests) depends on FS-version repos via `hub/src/policy/test-utils.ts` (Memory + FS-version-repository pattern). Production substrate-only is gated at mission-83 W5.4-Hub-bootstrap-flip; this follow-on mission closes the deferred code-debt + introduces `MemoryHubStorageSubstrate` (in-process substrate test backend) + restores Document MCP tools retired as W6-narrowed deletion-cascade.

**Cross-mission anchors:** mission-83 (M-Hub-Storage-Substrate) is the upstream substrate-introduction that this mission completes. Sequencing dependency with idea-298 (M-Hub-Storage-Cloud-Deploy) — Director-pinned strict prerequisite (Q3a). 4 other follow-on ideas (295/296/297/299) compose with this mission via shared substrate-architecture but are sequence-independent.

---

## §1 Round 1 picks

| Q | Pick | Director-intent reading (1-line summary) |
|---|---|---|
| Q1 — Primary outcome priority (WHY axis) | **a + c** (multi-pick; orthogonal-answer composition) | Substrate-currency cleanup + cloud-deploy de-risking as composed primary outcomes; one motivates the other |
| Q2 — Scope discipline (HOW axis) | **c** Maximum substrate-only inc env var removal | Substrate is sole production path; STORAGE_BACKEND env var itself is ceremony to retire |
| Q3 — Sequencing vs idea-298 (HOW-cadence axis) | **a** Strict before idea-298 | tele-8 Gated Recursive Integrity at mission-sequencing scale; clean local first, then cloud |

### §1.Q1 — Per-question interpretation

Director's multi-pick on (a) + (c) signals idea-300's primary value is **dual + mechanistically composed**: eliminate dual-pattern code-debt (one pattern per concern; tele-3 Law of One) AND stage clean substrate as foundation for cloud-deploy (tele-3 sovereign-composition portability validated by upcoming idea-298 cloud variants). The two are not independent priorities — they're causally linked. Substrate-currency cleanup IS the prerequisite for cloud-deploy de-risking; you cannot risk-validate substrate-portability against a half-cleaned-up local-substrate hosting dual-patterns. The (b) substrate-conformance defense and (d) Document MCP tool restoration outcomes were NOT primary-picked, meaning they're supporting deliverables that fall out of doing (a)+(c) correctly: building `MemoryHubStorageSubstrate` (required for (c) de-risking) naturally creates the second impl that conformance-suite generalization (b) operates over; restoring document MCP tools (d) is a side-effect cleanup that the substrate-currency wave naturally folds in.

**Tele weighting (Round 1):** primary = tele-3 Sovereign Composition (currency + portability); secondary = tele-9 Chaos-Validated Deployment (multi-impl validation enables cloud-cutover-without-fear). The unpicked options (b)+(d) compose into the secondary-tele surface; Q1 a+c pick weights the *primary* tele to tele-3 unambiguously.

### §1.Q2 — Per-question interpretation

Director picked (c) — more aggressive than (b). Where (b) preserves `STORAGE_BACKEND` env var as a substrate-only-tautology for operator-doc backwards-compat, (c) removes it entirely. Reading: **the env var IS dead-code-shape once mode collapses to one value; preserving it for "operator backwards-compat" is itself a code-debt source**. Director's pick signals tele-3 Law of One applied uncompromisingly — if there's only one storage backend, the env var that "selects" it is ceremony, not capability. This composes with Q1(a) substrate-currency cleanup (cleanup includes ceremonial-config cleanup, not just dead-code) and Q1(c) cloud-deploy de-risking (cleaner local-substrate config surface reduces cloud-deploy operator runbook complexity by one env var).

Notable: Q2c choice **eliminates the Design-phase question Q3 I had pre-scoped in idea-300 ("keep env var vs remove entirely")** — Director resolved it directly via Survey. The remaining Design-phase Q2 (packages/storage-provider/ disposition) is NOT resolved by Q2c since Director did not pick (d) "Comprehensive" — that boundary question remains for architect+engineer Design round (Round 2 candidate refinement target).

### §1.Q3 — Per-question interpretation

Director picked (a) strict prerequisite. Reading: **clean substrate first is non-negotiable before cloud-cutover risk** — tele-8 Gated Recursive Integrity applied at mission-sequencing scale (Layer N = clean local substrate; Layer N+1 = cloud-deploy of that substrate; cannot ascend to N+1 without N certified per tele-8 mechanics). Composes with Q1(c) cloud-deploy de-risking: sequencing IS the de-risking mechanism (idea-298 inherits a clean baseline; substrate-conformance suite ready as architectural-defense; `MemoryHubStorageSubstrate` ready as reference impl). Composes with Q2(c) max substrate-only: uncompromising local cleanup is what makes the sequencing meaningful — if dual-pattern remained in place, idea-298 would have to handle both patterns, defeating Q3a's purpose.

**Follow-on sequencing implication:** mission-83 follow-on ordering is locked → idea-300 → idea-298. Other follow-ons (295/296/297/299) can interleave or follow idea-298 per Strategic Review prioritization; only the 300→298 dependency is sequence-load-bearing.

**Round-1 composite read** (1-2 sentences; per `idea-survey.md` §3 Step 3): All three picks form a coherent narrative — **idea-300 is the cloud-deploy clearing-the-path mission; clean local substrate first uncompromisingly (no dual-pattern; no STORAGE_BACKEND env var); idea-298 inherits the certified baseline**. No cross-question coherence tension; no contradictory multi-pick; Round 2 strategy is "refine deeper" per `idea-survey.md` §4 (drill into HOW for the architecturally-significant remaining decisions — `packages/storage-provider/` boundary + conformance-suite shape + enforcement mechanism).

---

## §2 Round 2 picks

| Q | Pick | Director-intent reading (1-line summary) |
|---|---|---|
| Q4 — `packages/storage-provider/` final disposition (sovereign-package boundary axis) | **a** Retire entirely | One storage-abstraction (HubStorageSubstrate); repo-event-bridge migrates; bonus-closes cluster #23 defect |
| Q5 — Substrate-conformance suite scope (architectural-defense shape axis) | **b** Standard | Mirrors mission-47 StorageProvider conformance suite scope precedent (race + CAS + watch-event + restart-safety) |
| Q6 — Architectural-integrity enforcement mechanism (substrate-only-everywhere protection axis) | **d** Architectural-discipline only | Trust-based; conformance suite is sole architectural-defense vector; retro-encoded cluster pattern as substrate-defense |

### §2.Q4 — Per-question interpretation

Director picked (a) full retirement — most architecturally aggressive of the 4 options. Reading: **substrate-only-everywhere applies at sovereign-package boundary too; one storage-abstraction in the codebase (HubStorageSubstrate), not two (StorageProvider + HubStorageSubstrate)**. Composes with Round 1 Q1(a+c) substrate-currency cleanup + cloud-deploy de-risking — both reinforced by package-boundary cleanup (cleaner architectural boundary AND cloud-deploy reference-impl is a single abstraction). Composes with Round 1 Q2(c) max substrate-only — extends max-substrate-only from Hub-internal scope to repo-event-bridge external scope. Director rejected (b) preserve-as-sovereign-concern + (c) rename-for-boundary + (d) defer-to-Design — direct architectural-decision, not Design-phase delegation.

**Bonus outcome surfaced during architect grep-verify (per Director clarifying-question prompt):** Q4(a) migration architecturally closes **substrate-currency-failure cluster #23** (newly-surfaced this Survey): in substrate-mode production, `hub/src/index.ts:163` instantiates `MemoryStorageProvider` as a "sentinel for type-safety", then passes it to RepoEventBridge at line 840 (`storage: storageProvider`). The sentinel isn't benign — repo-event-bridge USES it for cursor + dedupe persistence. Result: ephemeral persistence; lost on Hub restart; violates cursor-store.ts's "Survives Hub restart" commitment. Q4(a) migration to HubStorageSubstrate in production wires repo-event-bridge to PostgresHubStorageSubstrate (same as Hub uses); cursor + dedupe state becomes durable in postgres alongside Hub entities. Defect-closure as side-effect.

**Design-phase architectural-decision carry-forward** (Architect-flag F3): two implementation variants — **Variant (i) fully-entity-integrated** (new entity kinds `RepoEventBridgeCursor` + `RepoEventBridgeDedupe` with SchemaDef + per-kind expression indexes; repo-event-bridge becomes first-class entity-kind producer) vs **Variant (ii) substrate-as-KV-backend** (repo-event-bridge uses substrate's get/put primitives keyed on existing `repo-event-bridge/cursor/<owner>/<repo>` shape; no new entity kinds; minimal migration). Architect-recommendation: **Variant (ii) for v1 simplicity**; (i) deferred to operational-need surface as separate follow-on.

### §2.Q5 — Per-question interpretation

Director picked (b) Standard scope — mirrors mission-47 StorageProvider conformance suite scope precedent (race + CAS + watch-event + restart-safety; ~25-30 tests). Reading: **precedent-anchored choice (mission-47's conformance suite is the canonical reference); avoids (a) minimal insufficient-defense + (c) comprehensive over-engineering + (d) tier-staging which defers half to idea-298**. Director chose middle-ground that matches existing-codebase pattern → operator-DX-consistent + lowest-friction architectural-decision.

Composes with Round 1 Q1(c) cloud-deploy de-risking — Standard scope IS the architectural-defense magnitude needed before cloud variants land; Tier-2 staging deferred per Q1(c) implicit acceptance (cloud variants inherit Standard suite as binary-certification per tele-8 Gated Recursive Integrity Layer N gate). Composes with Q4(a) full-retirement — conformance suite operates over HubStorageSubstrate impls (postgres-prod + memory-test + future cloud-variants); StorageProvider conformance suite from mission-47 effectively retires alongside packages/storage-provider/ retirement, with HubStorageSubstrate Standard suite as the architectural-successor.

### §2.Q6 — Per-question interpretation

Director picked (d) — most permissive of the 4 options; no mechanical enforcement; trust-based via architect+engineer review. Reading: **Director trusts the substrate-currency-failure cluster pattern (well-documented at `feedback_substrate_currency_audit_rubric.md` ARCHITECT-SIDE EXTENSION) + bilateral grep-before-claim discipline to prevent regression organically**. Lean toward minimal-ceremony — the 22-instance Phase 10 cluster work + retro-encoded discipline serves as the architectural-defense without code-level enforcement infrastructure.

Composes with Q5(b) conformance suite — conformance suite IS the mechanical-enforcement layer for substrate-correctness; Q6(d) means we don't ALSO add import-restriction-style enforcement. **Single architectural-defense vector** (conformance suite) rather than overlapping mechanisms. Notable trust signal: Director rejected (a) ESLint rule + (b) CI grep gate + (c) TypeScript module-boundary check despite all three being lower-cost than expected. Pattern suggests Director prefers methodology-discipline + retro-encoded patterns over code-level enforcement — consistent with `feedback_methodology_bypass_amplification_loop.md` framing where architectural-pathology comes from missing discipline, not missing enforcement. Composes with cluster #23 finding from Q4 grep-walk — Director-clarifying-question pattern itself is the substrate-currency audit-surface; bilateral discipline yielded the defect; mechanical-enforcement would have caught it post-hoc but not better than the discipline did pre-hoc.

**Round-2 composite read** (1-2 sentences): Director picks reinforce the **"uncompromising substrate-only with minimal ceremony"** theme — full package retirement (Q4a) + Standard conformance suite as sole architectural-defense (Q5b + Q6d); trust-based but conformance-suite-backed. Cross-question coherence ✓ (no internal tension; all three picks compose into Layer-N-substrate-bit-perfect-then-Layer-N+1-cloud-deploy mental model).

---

## §3 Composite intent envelope

idea-300 is the **cloud-deploy clearing-the-path mission with maximum substrate-currency posture**. Five composed pillars from Director picks across both rounds:

1. **Substrate is THE substrate** (Q1a + Q2c + Q4a) — one storage-abstraction (HubStorageSubstrate); StorageProvider retires; one production storage path (PostgresHubStorageSubstrate); one test backend (MemoryHubStorageSubstrate); no STORAGE_BACKEND env var ceremony
2. **Repo-event-bridge integrates fully** (Q4a) — migrates from StorageProvider to HubStorageSubstrate; bonus-closes cluster #23 ephemeral-persistence defect; becomes substrate-portable across deployment shapes (local-docker / CR+PD / GCE+PD) via connection-string interface
3. **Standard architectural-defense via conformance suite** (Q5b) — race + CAS + watch-event + restart-safety tests as the binary-certified Layer-N gate (tele-8 Gated Recursive Integrity); precedent-matches mission-47 scope; HubStorageSubstrate impls must pass to ratify deployment
4. **Architectural-integrity via discipline, not mechanism** (Q6d) — no ESLint / no CI grep gate / no TypeScript boundary check; trust-based on the cluster-discipline pattern from mission-83 retro (`feedback_substrate_currency_audit_rubric.md` ARCHITECT-SIDE EXTENSION); conformance suite is sole architectural-defense vector
5. **Strict sequencing before idea-298** (Q3a) — clean local substrate (everywhere) first; cloud-deploy inherits the certified baseline; tele-8 applied at mission-sequencing scale

**Survey-side-effect outcome (not a primary pick; surfaced via Round 2 clarifying-question grep-walk):** substrate-currency-failure cluster #23 surfaced + filed for closure as part of W3 (repo-event-bridge migration). Calibration material for Phase 10 retrospective + positive-pattern entry for "Director-Round-2-clarifying-question-as-substrate-currency-audit-surface".

---

## §4 Mission scope summary

| Axis | Bound |
|---|---|
| Mission name | M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate |
| Mission class | `pre-substrate-cleanup` (per `mission-lifecycle.md` §3 — analogous-to mission-83's `substrate-introduction` class but inverted scope; retires the dual-pattern code-debt mission-83 left behind) |
| Substrate location | `packages/storage-provider/` (retiring) + `hub/src/storage-substrate/` (canonical home; MemoryHubStorageSubstrate added) + `hub/src/entities/*-repository.ts` (FS-version; retiring) + `hub/src/policy/test-utils.ts` (migrating to substrate-version pattern) + `hub/src/index.ts` (STORAGE_BACKEND env var removal) + `packages/repo-event-bridge/src/cursor-store.ts` (migrating from StorageProvider to HubStorageSubstrate) |
| Primary outcome | Substrate-only-everywhere (one abstraction; one production path; one test backend; no env-var ceremony); repo-event-bridge integrated into substrate; cluster #23 closed |
| Secondary outcomes | Standard conformance suite as architectural-defense; PR #203 30s-tick-throttle band-aid revert; Counter abstraction rename; Document MCP tools restoration |
| Tele alignment (primary, whole-mission) | tele-3 (Sovereign Composition; Law of One at module + package boundary), tele-8 (Gated Recursive Integrity; binary-certified substrate-correctness) |
| Tele alignment (secondary, whole-mission) | tele-7 (Resilient Agentic Operations; race-defect prevention), tele-9 (Chaos-Validated Deployment; multi-impl conformance proofs) |
| Tele alignment (Round-1) | primary: tele-3; secondary: tele-9 |
| Tele alignment (Round-2) | primary: tele-3 + tele-8; secondary: tele-7 + tele-9 |

---

## §5 Anti-goals (out-of-scope; deferred)

| AG | Description | Composes-with target |
|---|---|---|
| AG-1 | Hub MCP tool surface bugs (bug-94 missing `assignedEngineerId` on create_task / bug-95 get_thread pagination cap / bug-96 antml-prefix-parameter trap) | Separate bug-fix missions; different stack from substrate-test-architecture |
| AG-2 | `hub-snapshot.sh` vs `hub-backup.sh` operator-DX script reconciliation | Operator-DX cleanup; could fold into idea-298 cloud-deploy operator-runbook polish OR small standalone architect-side mission |
| AG-3 | Multi-cloud / cross-cloud test affordances (substrate impls for AWS App Runner / Azure Container Apps / Fly.io / etc.) | idea-298 territory; idea-300 is local-test-architecture |
| AG-4 | PITR / WAL-archiving for substrate | Separate follow-on; snapshot-based `hub-backup` is sufficient for v1 RPO per mission-83 disposition |
| AG-5 | Variant (i) fully-entity-integrated repo-event-bridge (new RepoEventBridgeCursor + Dedupe SchemaDefs) | Architect-recommendation: defer to operational-need surface; Variant (ii) substrate-as-KV-backend is sufficient for v1 minimal-migration |

---

## §6 Architect-flags / open questions for Phase 4 Design round-1 audit

Architect-flags batched for engineer's round-1 content-level audit (per mission-67 + mission-68 audit-rubric precedent: CRITICAL / MEDIUM / MINOR / PROBE classifications). Each flag carries an architect-recommendation to challenge.

| # | Flag | Architect-recommendation |
|---|---|---|
| F1 (CRITICAL) | Repo-event-bridge migration MUST close cluster #23 substantively — cursor + dedupe persist across Hub restart in substrate-mode-production at W3 ship; integration-test that wraps Hub restart + verifies cursor survival is the dispositive evidence | Engineer authors W3 integration test that: (a) starts Hub in substrate-mode with bound repo-event-bridge; (b) lets cursor advance via 1-2 polling cycles; (c) docker-restarts Hub container; (d) verifies cursor + dedupe restored from PostgresHubStorageSubstrate persistence (not re-zero'd) |
| F2 (MEDIUM) | SubstrateConformanceSuite scope must MATCH mission-47 StorageProvider conformance suite scope precedent (race + CAS + watch-event + restart-safety; ~25-30 tests); do NOT reinvent | Engineer reads mission-47 conformance suite source (likely under `packages/storage-provider/__tests__/conformance/` or similar; verify path); ports test cases 1-to-1 to HubStorageSubstrate interface; adds watch-event + restart-safety variants since HubStorageSubstrate has those primitives StorageProvider didn't |
| F3 (MEDIUM) | Repo-event-bridge migration variant decision (Variant (i) fully-entity-integrated vs Variant (ii) substrate-as-KV-backend) must be documented in Design with architect-rationale; architect-recommendation is Variant (ii) | Engineer audits cursor-store.ts's current StorageProvider usage shape (key-value-style with namespaced paths); confirms Variant (ii) preserves the data-shape commitment; documents architectural-decision + rationale in Design §X.Y |
| F4 (MINOR/PROBE) | Does PostgresHubStorageSubstrate's NOTIFY-trigger fire for repo-event-bridge writes (since they're not entity-table-modeled in Variant ii)? Watch-vs-no-watch semantic for non-entity writes | Engineer probes substrate behavior: if Variant (ii) writes go through substrate's put primitive but not via entity-kind discrimination, does the NOTIFY trigger fire? If yes — repo-event-bridge benefits from watch primitive for free (could simplify polling-cycle architecture); if no — document as known-limit + accept as out-of-scope for v1 |

---

## §7 Sequencing / cross-mission considerations

### §7.1 Branch + PR strategy

**Branch:** `agent-lily/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate` (architect-side); `agent-greg/m-hub-storage-fs-retirement-and-memoryhubstoragesubstrate` (engineer-side; same handle slug).

**PR cadence:** cumulative-fold per wave (mission-83 precedent at `feedback_per_mission_work_trace_obligation.md` + per-wave-thread coord pattern); 8 waves drafted (W0-W7):

- **W0** MemoryHubStorageSubstrate spike + per-method parity test baseline
- **W1** SubstrateConformanceSuite extraction + Standard scope (race + CAS + watch-event + restart-safety)
- **W2** test-utils.ts migration + 22 test-file cascade (substrate-version-repo + MemoryHubStorageSubstrate pattern)
- **W3** repo-event-bridge migration (Variant (ii) substrate-as-KV-backend; closes cluster #23 — F1 integration test gate)
- **W4** FS-version repo deletion (12 entity-repository.ts files) + counter.ts + LocalFsStorageProvider + packages/storage-provider retirement
- **W5** STORAGE_BACKEND env var removal (Hub bootstrap simplifies to substrate-only; no mode selection)
- **W6** Document MCP tool restoration (substrate-backed DocumentRepository; PolicyRouter tool count 68 → 71)
- **W7** PR #203 revert (drop OIS_SCHEDULED_MESSAGE_SWEEPER_INTERVAL_MS + OIS_MESSAGE_PROJECTION_SWEEPER_INTERVAL_MS env vars; restore 1s/5s tick defaults) + ship-criteria operator runbook update + Phase 7 release-gate

### §7.2 Composability with concurrent / pending work

- **idea-298** (M-Hub-Storage-Cloud-Deploy) — strict downstream per Q3a; idea-300 ships first; idea-298 inherits clean substrate baseline + Standard conformance suite ready for cloud variants
- **idea-295/296/297/299** (other mission-83 follow-ons) — sequence-independent; can interleave or follow idea-298 per Strategic Review prioritization
- **mission-83 retrospective** at `docs/reviews/m-hub-storage-substrate-retrospective.md` — Phase 10 calibration material referenced as design ground-truth (substrate-currency-failure cluster lineage)
- **mission-47 conformance suite** (whatever path it lives at) — direct precedent template for F2 architect-recommendation
- **`feedback_substrate_currency_audit_rubric.md`** (ARCHITECT-SIDE EXTENSION) — the architectural-discipline this mission's Q6d trust-pattern relies on
- **`feedback_counter_collision_substrate_defect_pattern.md`** — relevant to W1 conformance suite race-correctness tests

### §7.3 Same-day compressed-lifecycle candidate?

**No — compressed-lifecycle NOT recommended.** 8 waves; ~170 test-file blast-radius (W2); cluster #23 integration test gate (W3) needs careful verification; conformance suite extraction (W1) is substantive new test infrastructure. Bilateral architect+engineer cycle of ~1-2 weeks is appropriate. Sub-mission scope compression possible if Director surfaces priority shift, but not single-day execution.

---

## §calibration — Calibration data point

Per `idea-survey.md` §5 (Survey output element) + §15 schema. Captures empirical baseline for methodology-evolution loop per §13 Forward Implications.

- **Director time-cost (minutes):** ~8 (across both Survey rounds; Round 1 ~2-3min + Round 2 ~3-4min + Q4 clarifying-question deep-dive surface ~3min)
- **Comparison baseline:** idea-206 first-canonical Survey (~5min); mission-83 idea-294 Survey (~5min); idea-300 slightly higher due to Director-clarifying-question grep-walk surfacing cluster #23
- **Notes:** Director-Round-2-clarifying-question pattern (Q4 "help me understand repo-event-bridge dependency on storage; do we still need an abstraction interface?") triggered architect grep-verify discipline + surfaced **substrate-currency-failure cluster #23** (repo-event-bridge ephemeral-persistence in substrate-mode; mission-83 W5.4-Hub-bootstrap-flip silently introduced; cursor-store.ts "Survives Hub restart" commitment violated). Methodology-evolution candidate — codify **"Round 2 clarifying questions as substrate-currency audit surface"** as positive-pattern Phase 10 calibration entry. Bilateral architect-grep-before-claim discipline (per `feedback_substrate_currency_audit_rubric.md` ARCHITECT-SIDE EXTENSION) yielded the defect surface as a Survey side-effect — Q4(a) pick now ALSO closes cluster #23 as bonus outcome.

---

---

## §8 Cross-references

- **`docs/methodology/idea-survey.md`** v1.0 — canonical Survey methodology
- **`docs/methodology/strategic-review.md`** — Idea Triage Protocol (route-(a) skip-direct rationale: Director-anchored Tier-2 follow-on with iteratively-shaped scope; bilateral-negotiation thread not needed)
- **`docs/methodology/mission-lifecycle.md`** §3 — `pre-substrate-cleanup` mission-class taxonomy entry
- **`docs/calibrations.yaml`** — calibration ledger cross-refs (closures-applied: empty; candidates-surfaced: cluster #23 + positive-pattern Director-Round-2-clarifying-question-as-substrate-currency-audit-surface)
- **idea-300** — source idea (filed 2026-05-17; scope-pinned + iterated 2026-05-18)
- **idea-294** — mission-83 origin idea (upstream substrate-introduction this mission completes)
- **idea-298** — M-Hub-Storage-Cloud-Deploy (strict downstream per Q3a)
- **mission-83** — M-Hub-Storage-Substrate (upstream mission; Phase 7 ratified 2026-05-18; this is the W6 deferred-scope follow-on)
- **`docs/reviews/m-hub-storage-substrate-retrospective.md`** — mission-83 retro (Phase 10 calibration material informing this Survey)
- **`docs/missions/m-hub-storage-substrate-phase-7-release-gate.md`** — mission-83 Phase 7 release-gate (operational handoff inventory)
- **mission-47** (M-Sovereign-Storage-Interface) — StorageProvider conformance suite precedent for Q5(b) Standard scope
- **`feedback_substrate_currency_audit_rubric.md`** (ARCHITECT-SIDE EXTENSION) — the architectural-discipline Q6(d) trust-pattern relies on
- **`feedback_counter_collision_substrate_defect_pattern.md`** — race-correctness pattern relevant to W1 conformance suite design
- **`reference_docker_seccomp_old_kernel.md`** — operational-context reference (Hub-rebuild remediation; relevant for W3 integration-test rebuild)
- **`project_mission_83_state.md`** — mission-83 snapshot (production substrate state Hub runs against)

---

— Architect: lily / 2026-05-18 (Phase 3 Survey envelope; Director-ratified 6 picks across 2 rounds; cluster #23 surfaced + filed for closure; pre-bilateral round-1 audit branch push pending per calibration #59 closure mechanism (a))
