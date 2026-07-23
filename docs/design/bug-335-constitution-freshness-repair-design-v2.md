# bug-335 constitution freshness and status-preservation repair design v2

Status: implementation-bound design for `work-bp-bug335_status_repair0_v8-implementation`
Base: `f431bdfeceaa98982a0105fe3b58ce04ddd8ac8a`
Supersedes for implementation purposes: rejected PR #667 design v1; the V6 FAIL and exact rejected head remain immutable.
Scope: constitution synchronization freshness and the `ConstitutionSnapshot` decode collision only. No constitutional content, cadence, threshold, merge, deployment, or authority change.

## Defects

### bug-335: freshness permanently decays

`ConstitutionSync.tick()` returns after a successful unchanged-HEAD read without recording verification health, while `buildProvenance()` derives age from immutable content `syncedAt`. Healthy unchanged content therefore becomes stale permanently and cannot recover after restart.

### bug-338: domain status is erased

The V1 implementation placed both domain `status` and mutable `lastVerifiedAt` in the envelope status partition. The production envelope stores domain status as `envelope.status.status`. Generic `decodeEnvelopeToFlat` spreads that bucket but reserves top-level `status` for `envelope.status.phase`; it deletes the spread `status` leaf before phase restoration. `ConstitutionRepositorySubstrate` consequently received a row without domain status and `markVerified()` rewrote the envelope without `status: "active"`.

Rejected identity `c5ecbccee551af6ee2dcc92c40761a2b5e289abf` / PR #667 remains failed and must never be updated, merged, or reused.

## State model

The singleton `ConstitutionSnapshot/current` carries:

- `status`: domain lifecycle state (`active` for current), canonically stored as `envelope.status.status`;
- `syncedAt`: immutable acquisition/commit time for the exact SHA/manifest/files;
- `lastVerifiedAt`: latest durable successful upstream HEAD verification bound to that SHA, stored in the mutable status partition.

Legacy rows may lack `lastVerifiedAt`; provenance falls back to `syncedAt` until a successful unchanged verification upgrades health. A verification-only update may change only `lastVerifiedAt` and row `updatedAt`; it must preserve domain status, SHA, content provenance, corpus, history, and `createdAt`.

## Narrow decode repair

`ConstitutionRepositorySubstrate` owns a kind-specific read boundary because `ConstitutionSnapshot` has a domain field whose name collides with the generic envelope status bucket.

For `ConstitutionSnapshot` only, its clone/decode helper:

1. reads and retains string `raw.status.status` before generic flattening;
2. runs the existing production generic decoder unchanged;
3. restores the retained domain value as flat `status`.

Legacy flat rows continue through the generic decoder, which already preserves a top-level status string via `phaseFromEntity`. Other kinds are unchanged. The fix does not relax envelope integrity checks, introduce a rename, change raw storage shape, or create a second write encoder.

This makes the subsequent canonical `putIfMatch` encode `{status: "active", lastVerifiedAt}` back to raw `status: {status: "active", lastVerifiedAt}`.

## Unchanged-HEAD transaction

After an authenticated HEAD read returns H and current snapshot also has H:

1. call `markVerified(H, now)`;
2. read current with resource version and decode with the kind-specific status restoration;
3. reject `not_synced` or `sha_mismatch` if identity changed;
4. monotonically advance `lastVerifiedAt` plus row `updatedAt`;
5. CAS-write through the one canonical production encoder;
6. retry from a fresh row up to the bounded repository cap;
7. report `unchanged` only after durable success.

Persistence exhaustion remains a stale-honest error. Verification-only writes do not retain history or emit content-update announcements.

## Changed-candidate race fence

The sync passes the pre-fetch current SHA (or null) into `swapSnapshot`. The repository rejects a candidate if current identity changed during fetch. Concurrent identical candidates are idempotent only when SHA and manifest hash match. Different candidates cannot overwrite a newer winner through blind CAS retry.

Parse, pinned-tree completeness, and live-charter referential gates still precede the singleton commit.

## Failure semantics

None of the following advances verification health:

- HEAD/API failure;
- changed HEAD below rate budget;
- tree/blob fetch failure;
- malformed or empty candidate;
- live-charter referential rejection;
- current SHA changing before health CAS;
- health persistence/CAS exhaustion;
- changed-candidate expected-current mismatch.

No artificial commit, row rewrite, threshold bypass, timestamp fabrication, content-history churn, or constitutional-content change is introduced.

## Storage and API compatibility

- `ConstitutionSnapshot` SchemaDef advances to version 2.
- `lastVerifiedAt` joins domain `status` in the status partition; content identity remains in spec.
- Existing envelopes need no eager rewrite. Legacy missing-health rows stay stale-honest and upgrade on the next durable successful unchanged verification.
- `ConstitutionProvenance` additively exposes `lastVerifiedAt`; `syncedAt` retains content meaning and `ageSeconds` measures verification health age.
- No index is required for the singleton point-read/CAS path.

## Test contract

`hub/src/policy/__tests__/constitution-freshness.test.ts` retains the full V1 failure/race matrix and adds production encoder/decoder regressions that assert both:

- decoded domain `status === "active"`; and
- raw `envelope.status.status === "active"`

before and after `markVerified`, including a legacy row with no `lastVerifiedAt`. The ordinary unchanged-health path repeats those raw and decoded assertions. Companion constitution serve contracts remain intact. Exact cases and results are in `docs/reports/bug-335-failure-race-matrix-v2.md`.

## Rollback and authority boundary

Before merge, rollback is abandonment of this distinct branch/PR. After merge, rollback requires a separate protected change. This WorkItem authorizes source, tests, a new PR, and one exact Hub binding only. It authorizes no merge, enqueue, deployment, production refresh, or live `stale=false` claim.
