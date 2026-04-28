# Mission M-Adapter-Streamline — Preflight Artifact

**Phase:** 6 Preflight (architect-owned audit; Director Release-gate next at Phase 7)
**Mission ID:** mission-64 (created at Phase 5 Manifest 2026-04-28 via `create_mission` cascade)
**Mission class:** structural-inflection (M sizing; ~2-3 engineer-days; W0 publish-flow spike gates M-vs-L upsizing per R2)
**Source Idea:** idea-217 (Streamline adapter compile/update/re-install for consumers)
**Companion Idea:** idea-221 (Pass 10 cross-§ orchestration; operator-side; out-of-scope this mission per Q5 C split-scope)
**Design v1.0:** `docs/designs/m-adapter-streamline-design.md` (bilateral ratified thread-405 round-7 2026-04-28T07:34:09.132Z)
**Survey:** `docs/surveys/m-adapter-streamline-survey.md` (Director-ratified Phase 3 2026-04-28 ~07:00Z)
**Author:** lily / architect
**Status:** Verdict GREEN (all 6 categories pass); Director Phase 7 Release-gate pending
**Date:** 2026-04-28

---

## §1 Mission-class fit

| Check | Status | Evidence |
|---|---|---|
| Mission-class taxonomy declared per `mission-lifecycle.md` §5.4.1 | ✅ | `structural-inflection` declared at Manifest |
| Mission-class signature fits the mission shape | ✅ | Introduces consumer-receipt mechanism (npm-publish + script) that future adapter-update flows ride; matches structural-inflection signature pattern (mission-62/63 precedent) |
| Wave plan aligns with mission-class default cadence | ✅ | 4-wave (W0 + W1+W2 atomic + W3 dogfood + W4 closing) matches mission-63 cadence; smaller than mission-63's 5-wave due to thin-bundle + split-scope |
| Pulse cadence matches class default | ✅ | 30min architect / 15min engineer (mission-lifecycle.md v1.0 default for structural-inflection) |
| Substrate-self-dogfood discipline at W3 | ✅ | Observation-only dogfood per Survey Q5 architect-lean + greg round-1 audit concur; concrete dummy-bump protocol at Design v1.0 §6.3 |

**Verdict:** mission-class fit GREEN.

---

## §2 Tele alignment

| Tele | Declared | Realized-target | Verification |
|---|---|---|---|
| **tele-2 Frictionless Agentic Collaboration** | Primary | Single-command consumer adapter-update; eliminates "know source-tree mechanics" burden | `update-adapter.sh` ergonomics; npm install -g for external |
| **tele-7 Resilient Operations** | Primary | Pass 10 §B+§D regression class closed structurally; calibration #25 root-cause class retired | §2.7 version-visibility (handshake adapterVersion + npm ls + adapter.log stamp); §B mechanisation embedded in publish flow |
| **tele-3 Absolute State Fidelity** | Secondary, elevated | Source ↔ consumer-running-adapter version-coherence detectable end-to-end | §2.7 version visibility surfaces; advisoryTags.adapterVersion in canonical envelope |
| **tele-6 Deterministic Invincibility** | Secondary | Single update path eliminates Layer-1/2/3-class regression vectors | mission-61 Layer-3 root-cause class closed structurally via `workspace:^` rewrite (§2.4) |

**Anti-tele drift check:** all 4 declared tele map cleanly to mission deliverables; no tele over-claim or under-claim. Same Design-discipline-maturity signal as mission-57 + mission-62 + mission-63 (calibration #23 working as designed).

**Verdict:** tele alignment GREEN.

---

## §3 Sizing

**Baseline:** M (~2-3 engineer-days). W0 publish-flow dry-run spike is THE gate that determines whether M holds or upsizes to L.

**M holds IF:**
- W0 dry-run spike (`npm publish --workspaces --dry-run --access public`) confirms `workspace:^` → semver rewrite at publish-time works correctly with npm 8+ tooling
- Director ratifies `@apnex` org claim + NPM_TOKEN credentials posture at Release-gate (~30min Director-time)
- First-publish topological bootstrap (`scripts/publish-packages.sh`) is straightforward (~1h scope add)
- Active-session 6-step coordination protocol during W1+W2 ship doesn't surface complications

**Upsize-to-L flag conditions (mid-W1 surface):**
- R2 fallback path activated: explicit `version-rewrite.sh` script if `workspace:^` rewrite fails empirically (~2h scope add)
- Coordinated cross-session restart turns out to need its own protocol beyond §3 sub-section
- npm registry account ownership snags surface during Director Release-gate prep

**Sizing comparison:**
- mission-63 (M-Wire-Entity-Convergence; structural-inflection): L baseline / M realized
- mission-62 (M-Agent-Entity-Revisit; substrate-introduction): L baseline / M realized
- mission-64 (M-Adapter-Streamline; structural-inflection): **M baseline / M expected** (smaller than mission-63 due to thin bundle + split scope per Q5 C)

**Verdict:** sizing GREEN with W0 spike as the M-vs-L upsizing gate.

---

## §4 Risks

(Full risk register at Design v1.0 §5.1)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | npm publish account / `@apnex` org ownership unresolved | Medium | Director ratifies at W0 Release-gate (Phase 7); ~30min Director-time; documented in Manifest |
| R2 | `workspace:^` → semver rewrite at publish-time may surface npm tooling edge cases | Medium | **W0 dry-run spike is THE gate**; fallback `version-rewrite.sh` (~2h add; flags M→L) |
| R3 | Postinstall hook security/idempotency concerns | RESOLVED v0.2 | §D reframed as script-driven (Fold 3); install.sh stays explicit operator step |
| R4 | Namespace migration α→β coupling with package publish | Medium | Coupled in single PR (W1+W2 atomic); pre-merge dry-run validates end-to-end |
| R5 | Calibration #25 root-cause class re-emergence | Low | W4 closing wave deprecates manual recipe in `multi-agent-pr-workflow.md` Pass 10 §B+§D |
| R6 | First-publish bootstrap order — alphabetical-vs-topological | Low-Medium | Explicit `scripts/publish-packages.sh` topological dep-walk (~1h add; bundled W1+W2) |
| R7 | Version-drift between concurrent consumers | Low | `update-adapter.sh` `--pin <version>` flag for coordinated rollout |
| R8 | `~/.claude` config stomping during install.sh run | Low | Idempotency-checks + don't-clobber pattern + W1+W2 PR description local-config doc |

**No critical (P0) risks identified.** All risks have concrete mitigations either embedded in design (R1/R2 W0 gates; R4 PR coupling) or codified at engineer round-2 audit (R5/R6/R7/R8).

**Verdict:** risk register GREEN.

---

## §5 Anti-goals (Survey Q6 + Design implicit; locked at Manifest)

1. ✗ NO Universal Adapter / ACP redesign integration (Survey Q6 B; orthogonal future-mission)
2. ✗ NO idea-102 Universal Port absorption (Survey Q6 C; orthogonal contract layer)
3. ✗ NO Hub-served adapter shape (Survey Q6 D; option 5 ruled out)
4. ✗ NO §A Hub rebuild + §C state-migration mechanisation (Survey Q5 C; deferred to idea-221)
5. ✗ NO opencode-plugin full parity (stub-only this mission per Design §4.2 #5)
6. ✗ NO CLI middleware (Survey Q4 A thin bundle; script + npm install suffices)
7. ✗ NO npm postinstall hook for install.sh (v0.2 Fold 3 reframe; script-driven §D mechanisation)
8. ✗ NO `@apnex/*` deprecation alias (γ hybrid rejected; clean cutover)

**Q6 NOT-A resolved IN-SCOPE:** namespace decision β (`@apnex/*` clean cutover) per Design v0.2 §2.3.

**Verdict:** anti-goals GREEN; clean cutover discipline matches mission-63 precedent.

---

## §6 Dependencies + cross-references

### §6.1 Predecessors (sealed companions)

- **mission-63** (M-Wire-Entity-Convergence) — clean-cutover discipline; tight-cycle merge cadence; structural-inflection M-class precedent; Pass 10 protocol codified at W5 PR #120; calibration #25 surfaced
- **mission-62** (M-Agent-Entity-Revisit) — Pass 10 §A discipline; state-migration discipline (companion to mission-64's §B+§D path); shim observability Phase 1 (idea-220 Phase 2 pending)
- **mission-61** (M-Pulse-Primitive-Surface-Closure) — Layer-1+2+3 SDK-tgz-stale lesson source; mission-64's §2.4 `workspace:^` rewrite closes Layer-3 root-cause class structurally
- **mission-57** (M-Mission-Pulse-Primitive) — coordination-primitive-shipment class precedent

### §6.2 Foundational dependencies

- **idea-186** (npm workspaces) — `workspace:^` publish flow rides this idea's foundation
- **idea-217** (Streamline adapter compile/update/re-install for consumers) — incorporated into mission-64

### §6.3 Companion / parallel

- **idea-221** (Pass 10 cross-§ orchestration) — companion idea filed at Survey close; mission-64 ships first; idea-221 materializes after; CLI contract pre-anchored at Design v1.0 §2.10 for downstream consumption

### §6.4 ADRs

- **ADR-029 (candidate; SCAFFOLD ships at Phase 6 Preflight; RATIFIED at W4)** — Adapter update is consumer-self-serve via npm-published packages + script-driven local install
- **ADR-023** (multi-agent-pr-workflow) — sealed companion (W4 amends Pass 10 protocol territory)
- **ADR-028** (canonical envelope) — orthogonal sealed companion
- Pass 10 protocol (mission-63 W5 PR #120) — sealed companion (W4 extends §B+§D references)

### §6.5 Methodology

- `docs/methodology/idea-survey.md` v1.0 (Survey methodology; mission-57 + mission-63 + mission-64 third canonical execution)
- `docs/methodology/mission-lifecycle.md` (10-phase lifecycle; mission-64 second canonical execution post-mission-63)
- `docs/methodology/multi-agent-pr-workflow.md` (Pass 10 protocol; mission-64 W4 amends §B+§D deprecation language)
- `docs/methodology/mission-preflight.md` (this artifact's methodology)

**Verdict:** dependencies + cross-references GREEN; clean linkage; no orphan references.

---

## §7 Activation prerequisites (Director Release-gate checklist)

Before mission status flip `proposed → active`, Director must ratify:

| # | Item | Director-action | Required |
|---|---|---|---|
| A | Mission scope envelope ratified | Survey + Design v1.0 review acknowledgment | ✅ Survey ratified Phase 3; Design v1.0 bilateral ratified Phase 4 |
| B | "Approved for go" release-gate signal | Conversational ratification | **PENDING this gate** |
| C | `@apnex` org claim + NPM_TOKEN credentials posture | Director ratifies npm-registry account ownership + credentials surface (env var, secret store, CI integration if applicable) | **PENDING this gate** (R1 mitigation) |
| D | Active-session coordination protocol awareness | Director acknowledges 6-step protocol at §3 sub-section will fire during W1+W2 ship; both lily + greg sessions need to update simultaneously per Design v1.0 §3 active-session sub-section | **PENDING this gate** (Q11 mitigation) |
| E | Sizing acceptance | Director acknowledges M baseline + W0 spike-as-gate for M-vs-L upsizing | **PENDING this gate** |

**Director engagement at Release-gate:** ~30min total (per estimate; matches mission-57 + mission-63 Release-gate Director-time-cost).

---

## §8 Mission close criteria (forward-pointer)

Mission-64 closes when:
1. ✅ All 4 plannedTasks (W0/W1+W2/W3/W4) status=completed
2. ✅ ADR-029 SCAFFOLD → RATIFIED (W4 closing wave)
3. ✅ Calibration #28 captured + W4 Pass 10 protocol-extension PR forward-pointer landed
4. ✅ Substrate-self-dogfood W3 verdict GREEN (or AMBER with documented residual)
5. ✅ Phase 10 retrospective mode-pick to Director (full / lite / skip)

**Estimated close timeline:** Director Release-gate + ~3 engineer-days (W0 prereq + W1+W2 + W3 + W4 sequence) → mission-64 closed within session of activation.

---

## Verdict — Phase 6 Preflight

**🟢 GREEN across all 6 categories** (mission-class fit + tele alignment + sizing + risks + anti-goals + dependencies). Mission ready for Director Phase 7 Release-gate.

**Director-ask (Phase 7):**
1. **Approved for go** (release-gate ratification)
2. **`@apnex` org claim + NPM_TOKEN credentials posture** ratified (R1 mitigation; ~30min Director-time)
3. **Active-session coordination awareness** acknowledged (Q11; mid-W1+W2 simultaneous-update of both lily + greg sessions)
4. **Sizing acceptance** (M baseline; W0 spike as M-vs-L gate)

Post-ratification: mission status flip `proposed → active`; W0 PR open + bilateral PR review with greg; W0 publish-flow dry-run spike result determines W1+W2 dispatch + sizing-confirm.

---

*Preflight artifact authored 2026-04-28 ~07:35Z post Design v1.0 bilateral ratify; ships in W0 bundle PR with Survey + Design v1.0 + ADR-029 SCAFFOLD. Architect: lily.*
