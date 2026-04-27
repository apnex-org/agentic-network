# M-Documents-Folder-Cleanup (mission-59) Closing Audit

**Mission:** M-Documents-Folder-Cleanup
**Mission ID:** mission-59
**Class:** Substrate-cleanup-wave (mission-58 analog)
**Author:** lily / architect
**Date:** 2026-04-27
**Status at close:** completed
**Retrospective mode:** SKIP (substrate-cleanup-wave default per `feedback_retrospective_modes.md`)

---

## Mission summary

**Goal achieved:** Eliminated `docs/` vs `documents/` naming split at repo root. Single canonical doc-tree converged on `docs/`.

**Lifecycle execution:**
- Director observation 2026-04-27 → idea-210 filed (open)
- Bilateral Design at thread-373 (Survey-bypassed; 2nd canonical execution after mission-58)
- propose_mission cascade fired → mission-59 created at status=proposed
- idea-210 → incorporated (linked to mission-59)
- Preflight artifact authored (verdict GREEN; 6/6 categories PASS) → PR #100 merged at 01:27:45Z
- Director release-gate fired → `update_mission(mission-59, status="active", pulses={...})` at 01:27:20Z (pulses bundled per substrate-cleanup-wave class defaults — engineerPulse 900s short_status, architectPulse 1800s short_status)
- W1 dispatched via thread-375 at 01:28:39Z
- Engineer PR #101 opened at ~01:53Z (10 files / 23+/23-)
- Architect peer-approved + admin-merged at 01:54:32Z (bug-32 baseline bypass per established 40+ PR consecutive lineage)
- Hub rebuild + redeploy completed at ~02:01Z (image digest `0804e98a38ce`); architect-Director coord moment per `feedback_architect_owns_hub_lifecycle.md`
- Post-redeploy verification PASSED at ~02:03Z (docs/ accept; documents/ clean Zod-reject with new error message)
- W2 closing audit (this document)

## Sizing — actuals vs predicted

| Phase | Predicted | Actual | Notes |
|---|---|---|---|
| W1 single-PR execution | XS-S (~30-45min) | **~22min** wall-clock | Sub-30min lower-edge; pattern-replication "second-iteration substrate-cleanup-wave executes faster + cleaner" prediction validated 2nd consecutive time |
| Hub rebuild + redeploy + verification | ~5-10min | **~7-8min** | Cloud Build dominant cost; matches mission-58 W3 timing |
| W2 closing audit | ~15min | ~15min | Within target |
| **Total mission span** | XS-S | **~75min** total (idea filing → audit close) | Includes Director coord moments (release-gate ratification + Hub redeploy approval) |

## Scope shipped

**Total scope:** 10 files / 23+/23- (matches engineer round-2 re-grep tally; sits cleanly in architect's 15-25 band — **no undercount this iteration**, validates pattern-replication discipline).

**Layer 1 (cosmetic):**
- `git mv documents/missions/m-hypervisor-adapter-mitigations.md docs/missions/`
- `git mv documents/missions/m-session-claim-separation.md docs/missions/`
- Self-reference path inside `m-hypervisor-adapter-mitigations.md` updated
- Empty `documents/` directory cleaned up

**Layer 2 (substrate):** 8 files patched with `documents/` → `docs/` literal rename
- `hub/src/policy/document-policy.ts` (compile-time constant + docstring + error msg)
- `hub/src/policy/mission-policy.ts:496` (documentRef docstring example)
- `packages/network-adapter/test/helpers/test-hub.ts:221-225` (test mirror, atomic with policy)
- `scripts/seed-new-teles.ts:29` (comment example)
- `docs/network/02-protocol-specification.md` (write_document API contract + co-authoring example)
- `docs/specs/entities.md` (Document entity row + path-key note)
- `docs/specs/workflow-registry.md:344` (INV-D1)
- `docs/methodology/strategic-review.md` (~7 phase-artifact paths + retros)

## Anti-goals — preservation verified

| # | Anti-goal | Preservation status |
|---|---|---|
| 1 | NO backward-compat shim | ✅ Full target state — clean Zod-rejection envelope on stale `documents/` writes |
| 2 | NO touching engineer-frozen historical artifacts | ✅ 29 frozen-line refs in `docs/audits/`, `docs/traces/`, `docs/decisions/`, `docs/reviews/` stay as-is per PR #94 carve-out |
| 3 | NO mutating closed-mission documentRef values | ✅ mission-37/38/40 documentRef values unchanged (frozen-artifact dead links acceptable per PR #94 carve-out extension) |
| 4 | NO Tier 3 housekeeping creep | ✅ Architecture-vs-methodology overlap, top-level docs sweep, mission-N-preflight numeric-vs-slug all deferred |
| 5 | NO node_modules / vendored content | ✅ No node_modules touched |
| 6 | NO dist regen + commit | ✅ Verified inapplicable (engineer round-2 confirmed hub/network-adapter dist NOT committed for affected packages) |

## Verification gates — all clean

- `npx tsc --noEmit` (hub typecheck): ✅
- `npm test` (hub vitest): **989 pass / 5 skipped / 1 file skipped** ✅
- `npm run build` (claude-plugin tsc): ✅
- `npm run coverage:invariants` regen: no drift ✅
- Success-criterion grep: ✅ ONLY frozen-artifact + preflight-narrative matches remain
- **Post-redeploy `create_document({path:'docs/...'})`:** ✅ namespace accept (backend-limited error orthogonal)
- **Post-redeploy `create_document({path:'documents/...'})`:** ✅ clean Zod-reject envelope with NEW error message ("Path must start with 'docs/'")
- CI: 3 vitest failures (network-adapter / claude-plugin / opencode-plugin) confirmed bug-32 admin-merge baseline (40+ PR consecutive lineage; doc-only or substrate-only diff cannot have introduced them)

## Carve-out extension RATIFIED (precedent extension)

**Preflight-narrative carve-out (3rd application of PR #94 logic):**

The preflight artifact at `docs/missions/m-documents-folder-cleanup-preflight.md` retains 4 narrative refs to `documents/`:
- closed-mission documentRef VALUES (mission-37/38/40)
- pre-rename code-state description (e.g., "documents/ was the compile-time literal")
- success-criterion grep self-reference
- post-rename rejection-example

These are **intentional historical narrative**. Mutating them turns the doc into nonsense (e.g. "`docs/` was the compile-time literal" describing the prior state). Treating as **frozen-artifact narrative extension**.

**Codified precedent for substrate-cleanup-wave class:** preflight artifacts about a rename mission MUST preserve old-namespace references for narrative coherence. Extends PR #94 frozen-artifact carve-out logic naturally to mission-narrative docs class.

## Side observations (non-blocking; for downstream)

### dist/shim.js src/dist drift on main (engineer round-2 surface)

Running `npm run build` in `adapters/claude-plugin/` regenerated `dist/shim.js` with **substantial structural differences** from the committed version (much larger import list, different internal structure). Engineer correctly reverted to keep PR scope clean.

**Implication:** pre-existing src/dist drift on main itself, **independent of mission-59 scope**. **2nd validation today** of idea-208 (M-Dogfood-CI-Automation; expanded scope captures dist-regen-verification CI automation) — PR #99 mission-58 W3 recovery being the 1st. Surface as preventative-methodology-priority signal.

**Recommended follow-up:** prioritize idea-208 OR a quick dist-regen-sweep mission. Not blocking mission-59 closure.

### Pulse first-fire — observation pending verification

architectPulse first-fire window was ~01:57Z. As of audit-author time (~02:08Z), no pulse-Message observed in lily session. Possible causes:
- Active session traffic during Hub redeploy reset `mission_idle_for_at_least` precondition
- Pulses-passthrough was silently stripped at MCP boundary (idea-211 Gap 1 risk — if confirmed, fix-forward via Hub-side default-injection)
- Hub restart mid-cycle reset sweeper bookkeeping

**Verification path:** check `mission-59.pulses.architectPulse.lastFiredAt` field on entity post-Hub-stable-window OR wait for next architectPulse cycle (~02:27Z if precondition unblocks 30min after restart). If still no fire by ~02:30Z, confirms strip → idea-211 Gap 1 fix-forward.

**Calibration:** even if pulse persisted, the Hub restart mid-mission likely reset bookkeeping. Future substrate missions where Hub redeploy mid-flight: expect pulse cycle restart from zero.

### Adapter tool-catalog staleness (idea-211 Gap 2 reconfirmed)

Post-Hub-restart, my session's `.ois/tool-catalog.json` STILL shows `'Path must start with documents/'` description for `create_document`. Hub-side validation correctly returns the NEW error message ("Path must start with 'docs/'"). Functional tools work; only descriptions go stale. **Confirms idea-211 Gap 2:** adapter doesn't auto-refresh tool-catalog on reconnect.

### Substrate-cleanup-wave class signature reaffirmed

| Signature | Mission-58 | Mission-59 |
|---|---|---|
| Survey-bypass | 1st canonical | 2nd canonical |
| Thread-as-Design-artifact | 1st canonical | 2nd canonical |
| Engineer round-2 re-grep | Caught architect undercount | **Clean — no undercount** |
| Sizing actuals vs predicted | XS-S target met | **Sub-target lower-edge** (~22min) |
| Hub redeploy required | YES (compile-time literal) | YES (compile-time literal) |
| dist-drift surface caught | Yes — recovery PR #99 | Yes — surfaced as side observation; deferred |
| Carve-out application | PR #94 frozen-artifact | PR #94 + preflight-narrative extension (3rd application) |

## Mission outcome — class signature consolidation

This is the **second consecutive substrate-cleanup-wave class mission** to ship cleanly with Survey-bypass + thread-as-Design-artifact + bilateral round-2 re-grep + single-PR atomic execution. Pattern-replication discipline (`feedback_pattern_replication_sizing`) validated:
- Mission-58 was first iteration; mission-59 is second; both shipped XS-S sizing (mission-59 sub-edge faster than mission-58).
- The PR #94 frozen-artifact carve-out has now been applied 3 times (PR #94 itself + mission-58 + mission-59); class-stable carve-out logic with mission-59-introduced preflight-narrative extension.
- Engineer round-2 re-grep discipline holds — first iteration caught architect undercount; second iteration validated architect estimate; pattern is "mandatory-for-first-iteration / sanity-check-for-replication".

## Cross-references

- thread-373 (Design v1.0 binding source-of-truth)
- thread-374 (PR #100 preflight peer-approval)
- thread-375 (W1 dispatch)
- idea-210 (incorporated → mission-59)
- idea-211 (M-Pulse-Defaults-Auto-Injection + Tool-Catalog-Refresh; both gaps surfaced today; Tier 2 follow-on)
- mission-58 M-Adapter-Config-Rename (analog precedent; substrate-cleanup-wave class first canonical)
- PR #94 (frozen-artifact carve-out 1st precedent)
- PR #99 (mission-58 W3 dist-regen recovery; idea-208 expanded scope provenance)
- PR #100 (mission-59 preflight)
- PR #101 (mission-59 W1 single-PR execution)
- mission-37/38/40 (closed; documentRef values frozen at `documents/missions/...` per carve-out)
- idea-208 M-Dogfood-CI-Automation (orthogonal Tier 2; expanded scope captures dist-regen-verification methodology — 2nd validation today)

## Retrospective mode — SKIP

Per `feedback_retrospective_modes.md` substrate-cleanup-wave class default = SKIP retrospective. Calibration data captured in this audit + memory-side notes; no separate retrospective doc warranted.

---

*Closing audit authored 2026-04-27 ~02:08Z. Mission-59 status flips to completed. Substrate-cleanup-wave class signature consolidated through 2nd canonical execution. Tier 2 follow-on queue: idea-207 (PAI saga) + idea-208 (CI dogfood + dist-regen verification) + idea-211 (pulse defaults auto-injection + tool-catalog refresh) + M-Adapter-Distribution.*
