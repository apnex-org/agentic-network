# WorkGraph pause/recall v4 — authority, race, and projection matrix

## Scope and authority binding

This is the implementation record for `work-bp-workgraph_safe_revision_impl0_v6-pause`, based on fence commit `fb010621a0cc779c2192ebf19000b68a94edf4e0`.

Pre-effect authority was independently re-read and rehashed:

- `docs/authority/workgraph-safe-revision-implementation-authority-manifest-v6.md`
- resourceVersion `56549641`
- exact UTF-8 bytes `15072`
- SHA-256 `ca83119d8a77555175fee692d09a1a4f9dfbf5d432875a6d9c22f41711c99c48`

The repaired design, blueprint V6, Continuation3 final-admission gate, and prerequisite fence were fresh-verified before implementation effects. This slice implements design V2 §5.1, §6 scalar authority, §7, rollout step F, and only the pause-node portion of §11.

**Explicit exclusion:** semantic `revise_work`, successor/head publication, revision-set batch recommit, and revision-gate behavior belong to the separately gated `revision` node. This change does not create or activate a topology generation.

## State and authority matrix

All identities are derived from the authenticated session and persisted row/family authority. Request fields cannot assert actor, role, original creator, holder, or current successor.

| Pre-state | Original creator | Architect | Director | Holder-only / other | Result |
|---|---:|---:|---:|---:|---|
| `ready` | allow | allow | allow | deny | `paused`; no holder intent because no lease |
| `claimed` | deny unless separately architect/Director | allow | allow | deny | exact-holder recall |
| `in_progress` | deny unless separately architect/Director | allow | allow | deny | exact-holder recall |
| `blocked` | deny unless separately architect/Director | allow | allow | deny | blocker captured; exact-holder recall |
| `paused` | deny | deny | deny | deny | pause rejects; same operation is read-only replay |
| `review` | deny | deny | deny | deny | reject |
| `done` / `abandoned` | deny | deny | deny | deny | reject |
| failed-sealed | deny | deny | deny | deny | failed-seal authority is checked first |
| draft / noncurrent physical row | deny | deny | deny | deny | currentness fence rejects with current target metadata |

Under an active topology head, original-creator authority resolves from immutable `WorkRevisionFamily.originalCreatedBy`; successor `createdBy`, `revisedBy`, payload, labels, and lease history cannot launder authority. Exact physical IDs never follow successors. A logical ID resolves only through the pinned current generation.

## One-CAS recall protocol

`pause_work` requires exactly one of `workId|logicalId`, a non-empty `operationId`, a non-empty `reason`, and optional `expectedRevision|expectedGeneration` fences.

The globally writer-fenced WorkItem CAS does the following atomically:

1. re-pins and validates the current physical binding, revision, generation, contract, topology, and failed-seal state;
2. checks same-operation idempotency (`requestHash` exact match => read-only return; changed bytes => reject);
3. validates phase/lease/blocker structural integrity and the server-derived actor matrix;
4. hashes the complete persisted pre-row and stores an exact operational before snapshot:
   - physical/logical/revision/materialization generation;
   - raw phase and substrate resourceVersion;
   - complete blocker projection;
   - holder, claimed/expiry/heartbeat times, and a domain-separated token fingerprint;
   - domain-separated full-row state hash;
5. derives the holder notice intent from physical ID, operation ID, exact holder, and before-state hash;
6. appends immutable recall history and (when a lease existed) an exact-holder pending intent;
7. transitions to `paused`, clears `lease` and `blockedOn`, invalidates the bearer token, accrues dwell, and commits `recallNoticePending=true`.

The raw bearer token is never copied to recall history, a Message, logs, or evidence.

## Holder-verb and sweeper linearization matrix

Pause and every holder/sweeper mutation use the same WorkGraph advisory lock and the same fresh-row CAS discipline. The focused memory suite runs concurrent `Promise.allSettled` races for every row below; the real-PostgreSQL suite races pause against renew while the database writer fence is active.

| Concurrent mutation | If pause linearizes first | If other mutation linearizes first | Required invariant |
|---|---|---|---|
| `start` | old token rejects | recall captures `in_progress` | final pause has one history entry and no lease |
| `renew` | old token rejects | recall captures renewed lease times | no heartbeat can resurrect the token |
| `block` | old token rejects | recall captures exact blocker | live blocker is cleared; history is preserved |
| `resume` | old token rejects | recall captures `in_progress` | no resumed live lease survives |
| `release` | release rejects | recall subsequently pauses `ready` with no phantom holder intent | no role/broadcast fallback |
| `complete` | complete rejects | terminal completion makes pause reject | exactly one terminal authority outcome |
| `abandon` | abandon rejects | terminal abandon makes pause reject | exactly one terminal authority outcome |
| expiry sweep | sweep returns skipped | requeue/poison result is freshly re-decided before pause | no stale-token or phantom-intent outcome |

After a winning active pause, focused tests invoke `start`, `block`, `resume`, `renew`, `release`, `complete`, and `abandon` with the old token; every verb rejects and the row remains paused.

## Persist-first exact-holder outbox

The WorkItem intent is authority. Message projection is downstream and retryable.

- Recipient is `{agentId: exactHolder}` only; no role is set and no broadcast fallback exists.
- `intentId` is also `migrationSourceId`, giving put-if-absent idempotency.
- `recallNoticePending` has a status-partitioned B-tree index; recall history and pending intents retain their GIN indexes.
- The lease sweeper retries persisted recall intents after restart and surfaces per-intent projection errors.
- Historical rows remain projectable after supersession; projection never restores their lifecycle authority.
- Message payload reports the exact recall-time before-state, obsolete-token status, the phase observed when projection occurs, and the current-authority next step.

Deterministic crash trace proven by `pause-recall-v4.test.ts`:

```text
first process:
  after_intent_read
  before_message_persist
  after_message_persist
  FAILPOINT

restart:
  after_intent_read
  after_message_persist        # existing Message found by migrationSourceId
  before_intent_mark
  after_intent_mark
```

Postcondition: exactly one exact-agent Message, zero role-targeted Messages, one projected intent, and no raw token in either persisted row or payload.

## Scalar unpause contract

`unpause_work` supports an exact physical or current logical locator with optional expected revision/generation.

- `paused → ready` is a scalar recommit only.
- Failed-seal, currentness, revision, generation, and graph identity remain fail-closed.
- Dependency *state* is deliberately not checked; `claim_work` remains the only start-gate authority.
- Original creator compatibility is narrow: the actor must be the immutable family creator, must have lawfully paused this unchanged row, and the row must have no predecessor.
- Architect/Director authority is allowed; holder, former holder, and reviser status alone are denied.
- Pending historical recall notice projection survives unpause.

## Structural integration inventory

| Surface | Integration |
|---|---|
| domain | `PauseWorkRequestV4`, `UnpauseWorkRequestV4`, full recall receipt/lease snapshot |
| repository | current logical resolver, family-original creator resolution, one-CAS pause, scalar unpause, outbox scan/mark |
| policy | coordinated pause schema, server-stamped actor, correct transition origin, post-commit projection |
| restart | `recall-notice-projector.ts` plus lease-sweeper retry |
| storage | status envelope partition, `recallNoticePending` rename map/index, existing recall GIN indexes |
| currentness | exact historical rejection, current logical resolution, writer/read pinning |
| SEAL | pause, projection mark, and unpause preserve attestation history/projection |
| simulator | active architect recall added for claimed/in-progress/blocked; operation IDs/reasons supplied |
| PostgreSQL | advisory-lock race, DB writer fence, status round trip, recall-index EXPLAIN |

## Test evidence commands

The committed receipt records exact log hashes. Test sets exercised during implementation:

```text
hub build
focused pause/recall + paused-state + policy + failed-seal + currentness
schema rename/encoder/writer inventories
real PostgreSQL currentness/pause race and revision-storage index plans
SEAL writer inventory
workgraph-sim build and full oracle suite
full Hub test suite
```

No migration was applied to a live environment. No PR, push, merge, deploy, production mutation, bug disposition, Skills effect, `pause_gate` claim, or other WorkItem claim was performed by this slice.
