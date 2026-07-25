# WorkGraph failed-gate-seal-v2 — implementation matrix and exact failpoint trace

Date: 2026-07-23  
WorkItem: `work-bp-workgraph_safe_revision_impl0_v6-failed_gate`  
Repository: `apnex/agentic-network`  
Foundation lineage: `5cb985c7c33391708faeb70535338af434ce778e`

## Authority fence revalidation

Before source mutation, the participant-local pre-effect check re-read and rehashed the frozen authority inputs and independently revalidated their active attestations:

- authority manifest V6: `docs/authority/workgraph-safe-revision-implementation-authority-manifest-v6.md`, RV `56549641`, bytes `15072`, SHA-256 `ca83119d8a77555175fee692d09a1a4f9dfbf5d432875a6d9c22f41711c99c48`
- blueprint V6 gate: active-valid `blueprint_v6_seal=PASS`
- Continuation3 final admission: active-valid `final_admission_seal=PASS`
- Repair2 design gate: active-valid design PASS
- constitution snapshot: fresh (`stale=false`)

This node changes source, tests, and this matrix only. It does **not** resolve `bug-319`, claim a verifier gate, push, open a PR, merge, deploy, migrate live entities, or perform a production disposition.

## Contract matrix

| Requirement | Implementation | Proof |
|---|---|---|
| exact pre-clear snapshot | `FailedGatePreClearReceiptV2.before` captures raw phase, exact holder, claim/expiry/heartbeat instants, domain-separated token fingerprint, structured blocker, state/evidence/active-projection hashes, and substrate resourceVersion | `commits FAIL authority, exact pre-clear snapshot, cleanup, and holder intent in one successful CAS` |
| one-CAS FAIL authority | `attestEvidence` derives every binding from the fresh row passed with its resourceVersion; one successful `putIfMatch` appends FAIL, records receipt/seal, sets effective disposition, clears lease/blocker, and appends holder intent | same test asserts exactly one successful WorkItem CAS |
| raw/effective separation | raw `status` remains `review`; `effectiveDisposition="failed_sealed"` is read-served independently | born-native and legacy tests |
| persist-first holder notification | `PendingFailedSealNotice` is appended in the authority CAS; downstream projection reads only the persisted intent | receipt test + projector failpoint test |
| exact-holder-only delivery | projector targets `{agentId: preClearHolder}`; no role or broadcast fallback exists | projector test asserts exact target and one Message |
| deterministic dedupe | `intentId = H("failed-seal-holder-notice-v2", workId, sealHash, holder)` and is used as `Message.migrationSourceId` | projector restart test |
| no raw token leakage | receipt and Message carry only `H("failed-gate-token-v2", token)` | receipt and Message payload negative assertions |
| same-operation idempotency | operation identity binds work, requirement, verifier, verdict, and canonical evidence set; retry is a read-only return with unchanged resourceVersion/history | idempotent replay test |
| later same-row attestation rejection | any PASS or distinct FAIL after a v2 seal rejects `FailedGateSealedRejected`; a legacy active FAIL is likewise non-supersedable | same-row rejection test + updated A2 regression |
| legacy active-FAIL precedence | `cloneWorkItem` derives failed-sealed from the active projection before list/claim/sweep checks; `expireLease` reconciles active FAIL before review-to-ready logic | legacy sweep and raw-ready tests |
| legacy stale lease cleanup | reconciler backfills receipt/seal, keeps raw review, clears lease/blocker, persists exact-holder intent, and returns `failed_sealed`; sweeper writes a durable audit and projects the intent | legacy reconciliation test + sweeper integration source |
| claim/list/legal/pulse exclusion | ready queues, graph next-action, claim authority, legal moves, WIP accounting, lifecycle writes, and node-pulse selection exclude effective failed-sealed rows | raw-ready test and source guards |
| restart-safe outbox scan | indexed `failedSealNoticePending` narrows retries; marking the persisted Message clears the bit; capped scans are truncation-loud and make progress batch-by-batch | schema/renameMap gate + projector restart test |

## Exact failpoint trace

The trace vocabulary is exported by `failed-gate-notice-projector.ts` and asserted without wildcard steps.

### FP-A — crash after authority CAS, before caller return

1. Begin with raw `review`, active lease, blocker, no FAIL, no receipt.
2. The WorkItem CAS succeeds and atomically writes FAIL + receipt + seal + `failed_sealed` + lease/blocker clear + pending exact-holder intent.
3. Inject `FAILPOINT:after_seal_cas_before_return`.
4. Simulated restart reads one active FAIL, one history row, one immutable v2 seal, and the pending intent.
5. Retry the same operation.
6. Result: read-only idempotent return; same `sealHash`; history remains length 1; no second CAS/effect.

### FP-B — crash after Message persistence, before intent mark

First process trace, exact ordered stages:

```text
after_intent_read
before_message_persist
after_message_persist
FAILPOINT:after_message_persist
```

State at crash:

- authority remains sealed;
- exactly one Message exists under `migrationSourceId=intentId`;
- WorkItem intent remains pending/unmarked.

Restart trace, exact ordered stages:

```text
after_intent_read
after_message_persist
before_intent_mark
after_intent_mark
```

The absent `before_message_persist` stage is load-bearing: restart finds the existing Message by the persisted idempotency key rather than creating/pushing another. Final state: one exact-holder Message, intent marked with that Message id, `failedSealNoticePending=false`. A third projector pass reports zero candidates and creates no effect.

### Legacy ordering trace

```text
read fresh row
→ derive active verifier FAIL from active projection
→ classify effectiveDisposition=failed_sealed
→ refuse review→ready fallthrough
→ CAS backfill receipt/seal + clear obsolete lease/blocker + persist holder intent
```

A raw-ready legacy FAIL is filtered from `listReadyForRole` and direct `claimWorkItem` rejects it.

## Verification

- TypeScript Hub build: PASS.
- Focused failed-gate tests: 6/6 PASS.
- Updated existing SEAL A2 tests: 21/21 PASS.
- RenameMap/envelope contract gate: 11/11 PASS.
- Full Hub suite: 2,727 PASS, 5 skipped; 216 files PASS, 1 skipped (217 total).
- Full-suite log: `/tmp/m140-failed-gate-full-test-final.log`, bytes `3040527`, SHA-256 `1450ccc5f7a7c7f56d9179a76da2aabc374049fb86107f58532af7d88830e897`.

## Recovery boundary

A FAIL-sealed row is terminal in the runbook sense. Recovery is intentionally outside this node and requires a distinct repair/revision with fresh authority. No code in this change resolves `bug-319` or converts a failed row back to PASS/ready/done.
