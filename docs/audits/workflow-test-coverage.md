# Workflow-Invariant Test Coverage

**Mission:** mission-41 (M-Workflow-Test-Harness) Wave 1 T5.
**Generated:** 2026-04-23T03:07:48.733Z (via `npm run coverage:invariants` from `hub/`).
**Status source:** scanner output over `assertInv*` call-sites + kickoff-decisions §Decision 1 ratified subset.

## Summary

| Dimension | Count |
|---|---|
| Ratified Wave-2 subset | 10 |
| &nbsp;&nbsp;Tested (≥1 call-site, helper not stubbed) | 8 |
| &nbsp;&nbsp;Stubbed (pending Wave 2 graduation) | 2 |
| Out-of-Scope for v1 (§7.2 NONE, not in ratified subset) | 10 |

## Per-invariant status — ratified subset

| INV-id | Status | Call sites | Note |
|---|---|---|---|
| `INV-T4` | Tested | `hub/test/e2e/invariant-helpers.test.ts:38`, `hub/test/e2e/invariant-helpers.ts:51` | Task terminal states — completed/failed/escalated/cancelled |
| `INV-P1` | Tested | `hub/test/e2e/invariant-helpers.test.ts:42`, `hub/test/e2e/invariant-helpers.ts:93` | Architect-only proposal review |
| `INV-P2` | Tested | `hub/test/e2e/invariant-helpers.test.ts:47`, `hub/test/e2e/invariant-helpers.ts:131` | Only submitted proposals reviewable (gap-surfacing ratchet) |
| `INV-P4` | Tested | `hub/test/e2e/invariant-helpers.test.ts:51`, `hub/test/e2e/invariant-helpers.ts:165` | Proposal `implemented` is terminal |
| `INV-TH6` | Tested | `hub/test/e2e/invariant-helpers.test.ts:55`, `hub/test/e2e/invariant-helpers.ts:217` | Non-active thread replies rejected |
| `INV-TH7` | Tested | `hub/test/e2e/invariant-helpers.test.ts:59`, `hub/test/e2e/invariant-helpers.ts:249` | close_thread architect-only stewardship |
| `INV-I2` | Tested | `hub/test/e2e/invariant-helpers.test.ts:63`, `hub/test/e2e/invariant-helpers.ts:281` | Idea auto-linkage failure is non-fatal |
| `INV-M4` | Tested | `hub/test/e2e/invariant-helpers.test.ts:67`, `hub/test/e2e/invariant-helpers.ts:303` | Mission completed/abandoned are terminal |
| `INV-TH18` | Stub | `hub/test/e2e/invariant-helpers.test.ts:71`, `hub/test/e2e/invariant-helpers.ts:355` | Workflow turn-pinning (cascade guard) — P2 spec |
| `INV-TH19` | Stub | `hub/test/e2e/invariant-helpers.test.ts:75`, `hub/test/e2e/invariant-helpers.ts:371` | Cascade validate-then-execute atomicity — P2 spec |

## Out-of-scope for v1

Invariants from `docs/specs/workflow-registry.md` §7.2 `Tested By: NONE` that are NOT in the ratified Wave-2 subset. Deferred to Wave 3 / post-mission-41 for follow-up idea filings.

| INV-id | Note |
|---|---|
| `INV-TH8` | Thread invariant (not in ratified v1 subset) |
| `INV-TN1` | Turn invariant |
| `INV-TE1` | Tele invariant |
| `INV-TE2` | Tele invariant |
| `INV-A1` | Agent invariant |
| `INV-A2` | Agent invariant |
| `INV-D1` | Director-notification invariant |
| `INV-D2` | Director-notification invariant |
| `INV-S*-unlisted` | System-invariant subset (spec §7.2 summary: 8 system NONEs) — enumerate in Wave 3 |
| `INV-XD*-unlisted` | Cross-domain-invariant subset (spec §7.2 summary: 2 cross-domain NONEs) — enumerate in Wave 3 |

## Regeneration

```bash
cd hub && npm run coverage:invariants
```

Overwrites this file. Check in the regenerated version on any change to `assertInv*` call-sites or the ratified subset.

## Provenance

- **Scanner:** `hub/scripts/invariant-coverage.ts`
- **Helpers:** `hub/test/e2e/invariant-helpers.ts` (Mission-41 T2, commit `b0208d3`)
- **Ratified subset:** `docs/missions/mission-41-kickoff-decisions.md` §Decision 1 (Director-ratified 2026-04-23)
- **Parent spec:** `docs/specs/workflow-registry.md` §7.2
- **Task:** task-328 (Wave 1 T5)
