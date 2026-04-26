# Mission M-Adapter-Config-Rename — Closing Audit

**Hub mission id:** mission-58
**Mission class:** substrate-cleanup-wave
**Source idea:** idea-209 (filed 2026-04-26 post mission-57 close + housekeeping discussion)
**Director directive (2026-04-26):** *"Lets do it now. But with a small scoped mission. I want full target state - no legacy compat"*
**Design v1.0 artifact:** thread-365 (Survey-bypassed per `idea-survey.md` §8; first canonical thread-as-Design-artifact execution)
**Preflight:** PR #95 (`47b02d8`) — verdict GREEN
**Dates:** Idea filed 2026-04-26 ~21:50Z → Design ratified ~22:08Z → Director release-gate ~22:10Z → W1+W2 merged ~22:31Z → W3 cut-over (3/4 worktrees) ~22:39Z → W4 (this) authored ~22:41Z. Total active arc: ~50min (vs ~3h+30min coord Design estimate; pattern-replication factor at lower edge per `feedback_pattern_replication_sizing.md`).
**Tele alignment:** primary tele-2 Isomorphic Specification + secondary tele-3 Sovereign Composition + secondary tele-4 Zero-Loss Knowledge.
**Retrospective:** SKIP per `feedback_retrospective_modes.md` substrate-cleanup-wave class default. This audit is the final artifact.

---

## 1. PRs merged

| PR | Title | Merge commit | Role |
|---|---|---|---|
| #95 | [mission-58] Preflight artifact — M-Adapter-Config-Rename | `47b02d8` | Mission preflight (architect-authored; engineer-pool ✓) |
| #97 | [mission-58] W1+W2 — adapter-config rename (substrate-cleanup-wave; full target state, no legacy compat) | `c1acfd2` | W1 code + W2 docs sweep bundled (engineer-authored; architect-pool ✓) |

**Bundled in mission window** (orthogonal merges that landed mid-arc):
| PR | Title | Merge commit | Notes |
|---|---|---|---|
| #94 | [housekeeping] docs/ T1+T2 — naming + folder consistency pass | `23abd14` | Pre-mission baseline; established Surface A carve-out precedent (engineer-frozen historical artifacts NOT touched by sweeps) |
| #96 | [methodology] mission-lifecycle.md v1.2 — pulse cadence defaults recalibrated to empirical 10-15min active-arc baseline | `f479142` | Methodology recalibration shipped during mission window; orthogonal but same Director-active session |

**Cross-approval lineage:** 39-PR consecutive admin-merge baseline (bug-32) preserved.

## 2. Files renamed

`hub-config.json` → `adapter-config.json`. **~28 references across 25 active files** (engineer round-1 re-grep caught architect undercount: ~21 → ~28; load-bearing miss was `tests/smoke-production.ts` with hard-coded path; would have broken W3 cut-over verification).

**Code surfaces (6 files; W1):**
- `adapters/claude-plugin/src/shim.ts` (3 lines)
- `adapters/opencode-plugin/src/shim.ts` (2 lines)
- `scripts/lib/architect-client.ts` (4 lines; transitively fixes both migrate scripts via `withArchitectClient`)
- `scripts/migrate-{agent-queue,bug-ideas}.ts` (1 docstring line each)
- `tests/smoke-production.ts` (3 lines incl. hard-coded `resolve(..., ".ois", "adapter-config.json")`)

**Docs sweep (13 active .md files; W2; sed-driven verify-by-grep clean):**
ARCHITECTURE.md + adapters/{claude-plugin,opencode-plugin}/QUICKSTART.md + docs/{decisions/004-universal-mcp-adapter, history/agentic-networking-architecture, history/mission-brief-shared-adapter-refactor, network/05-configuration-reference, onboarding/multi-env-operator-setup}.md + docs/reviews/{2026-04-phase-1-cartography, 2026-04-phase-1-cartography-critique, 2026-04-preflight, HANDOVER-greg, HANDOVER-lily}.md

**Live JSON files (4 locations; W3):**

| Worktree | Status | Owner |
|---|---|---|
| `agentic-network-lily/.ois/adapter-config.json` | ✅ Renamed | Architect |
| `agentic-network-greg/.ois/adapter-config.json` | ✅ Renamed | Engineer |
| `agentic-network/.ois/greg/.ois/adapter-config.json` | ⏳ Pending | Director (flexible-timing) |
| `agentic-network/.ois/lily/.ois/adapter-config.json` | ⏳ Pending | Director (flexible-timing) |

**Out-of-PR (per-worktree convention; gitignored):**
- `start-greg.sh` (greg worktree; engineer updated locally) + `start-lily.sh` (lily worktree; architect updated locally)
- `adapters/claude-plugin/dist/shim.js` — gitignored (NOT in `packages/{storage-provider,repo-event-bridge,message-router}/dist/` carve-out at `.gitignore`); regenerated locally via `postinstall:tsc` on `npm install`. **W3 restart runbook addition:** all 4 worktrees must `cd adapters/claude-plugin && npm install` (or `npx tsc`) BEFORE adapter restart so runtime loads new dist with `adapter-config.json` read path.

## 3. Surface A carve-out preserved

**NOT touched** (engineer-frozen historical artifacts per PR #94 housekeeping precedent):
- `docs/audits/m-multi-env-substrate-closing-audit.md` (closed mission record)
- `docs/traces/m-cognitive-hypervisor-work-trace.md` (engineer-owned work-trace)

Verified via `git diff --stat docs/audits/ docs/traces/` empty post-merge of PR #97. Captured as feedback memory: doc-sweep missions exclude engineer-frozen historical artifacts (sweep-all-with-carve-out default).

## 4. Hub redeploy outcome

✅ Architect ran `build-hub.sh` + `start-hub.sh` from main tree mid-W3; image `48f39ab...`; Hub healthy at `localhost:8080`; `activeSessions:2 sseStreams:2` (both adapters auto-reconnected); **PulseSweeper code now loaded + running for the first time** (mission-57 W2 substrate live; first dogfood-equivalent moment for the pulse primitive). Mission-58 W3 served as the trigger for PulseSweeper runtime activation.

## 5. Smoke-test verification

**Deferred to next adapter restart** per cached-config-safe semantics. Adapters running on cached `hub-config.json` content from `.start()` time; live in-memory until restart. On next session-start (operator-natural, Director-flexible timing), each adapter:
1. Loads regenerated `dist/shim.js` (post `npm install`)
2. Reads `.ois/adapter-config.json` via new code path
3. Hub handshake authenticates
4. Optional: `npx tsx tests/smoke-production.ts` for end-to-end validation

If anything breaks at restart: per Director constraint **NO LEGACY COMPAT** — investigate root cause; do NOT add fallback shim. Worst-case rollback: revert PR #97 + rename JSON files back.

## 6. Coordination summary

| Owner | Responsibility | Status |
|---|---|---|
| Director | Release-gate signal (`update_mission(mission-58, status="active")`) | ✅ 2026-04-26 ~22:10Z |
| Director | Main-worktree config renames (×2) + own environment adapter restart | ⏳ At convenience (cached config tolerates timing) |
| Architect | Hub redeploy via `build-hub.sh` + `start-hub.sh` | ✅ Mid-W3 |
| Architect | Lily-worktree config rename + lily adapter coordination | ✅ W3 step 2 |
| Architect | PR #94 + #95 + #96 admin-merges + PR #97 cross-approval | ✅ All landed |
| Engineer | W1+W2 implementation + PR #97 ship | ✅ `c1acfd2` |
| Engineer | Greg-worktree config rename | ✅ W3 step 3 |
| Engineer | Local `start-greg.sh` update + dist regen | ✅ Local-only (gitignored) |
| Engineer | W4 closing audit (this doc) | ⏳ This PR |

Coordination boundary preserved per `feedback_architect_owns_hub_lifecycle.md` (architect owns Hub lifecycle; engineer owns code change ship; Director owns own-environment renames + release-gate signal). Each owner ran their step asynchronously with no blocking — cached-config semantics tolerate timing variability.

## 7. Tele realization

| Tele | Realization |
|---|---|
| **tele-2 Isomorphic Specification** (PRIMARY) | `adapter-config.json` accurately names the file's substrate role: it is adapter-side credential config, not Hub configuration. The old `hub-config.json` name was a vestigial mismatch from earlier vocabulary; tele-2 advanced via accurate-naming-reflects-substrate-role. |
| **tele-3 Sovereign Composition** (SECONDARY) | Single-source-of-truth filename now matches single-purpose: one config file, one consumer (the adapter), one canonical name. No remaining dual-naming or legacy-shim ambiguity. |
| **tele-4 Zero-Loss Knowledge** (SECONDARY) | All active operator-facing surfaces updated; no orphan `hub-config.json` references in code/onboarding/decisions/network/reviews. Frozen historical artifacts (Surface A carve-out) preserved as point-in-time records — Zero-Loss applies to active surfaces, NOT to historical fidelity which is preserved via carve-out discipline. |

## 8. Methodology firsts (4)

1. **First canonical Survey-bypass execution** per `idea-survey.md` §8. Sufficiently-scoped + Director-anchored intent (Director directive verbatim) crisp enough that the 3+3 pick-list Survey overhead would have added time without resolution gain. Calibration: bypass saves ~5-10min Director time vs full Survey-then-Design path; appropriate for substrate-cleanup-wave class with Director-anchored crystal-clear scope.

2. **First canonical thread-as-Design-artifact execution** (substrate-cleanup-wave class). Bilateral exchange at thread-365 served as the Design v1.0 artifact; no separate Design doc authored. Calibration: appropriate for small + ratified-scope missions where the bilateral round-1 exchange substantively answers all open questions; would NOT scale to substantive missions requiring §-numbered Design doc reference (e.g. mission-57 substrate work).

3. **First PulseSweeper runtime activation.** Mission-57 W2 shipped PulseSweeper code (PR #88 `4f4b76f`); mission-58's bundled Hub redeploy was the trigger for first runtime load. PulseSweeper now live + running on Hub (post-W3); future missions consume `mission-lifecycle.md` v1.2 (PR #96 `f479142`) cadence defaults via PulseSweeper's reading of mission entity `pulses.{engineerPulse,architectPulse}` declarations.

4. **v1.2 cadence-recalibration shipped in same window** (PR #96). Director observation post-W1+W2 dispatch: pulse primitive replaces manual 10-15min loops from mission-56/57 active arcs; §4.1 default-cadence-table recalibrated from concept-memo aspirational (30-60min) to empirical 10-15min active-arc baseline. Defaults converge on 15min engineer / 30min architect for most classes; spike 10/20 (shorter); distribution-packaging 30/60 (async). Orthogonal to mission-58 mechanical rename, but tightly coupled in time + Director session — one session shipped both the substrate cleanup AND the methodology-cadence recalibration grounded in the same empirical evidence (mission-56/57 sub-PR rhythm).

## 9. Mission close

mission-58 closes after this W4 PR admin-merges. Architect-next: `update_mission(mission-58, status="completed")` + mission-close summary surface to Director. Retrospective SKIP per substrate-cleanup-wave default. Director main-worktree renames remain at Director convenience (no mission-blocker; cached config tolerates timing).

---

*Closing audit authored 2026-04-26 ~22:41Z (08:41 AEST 2026-04-27). Substrate-cleanup-wave class default = SKIP retrospective; this audit serves as the final artifact. Mission-58 nominally complete pending PR-merge + status-flip.*
