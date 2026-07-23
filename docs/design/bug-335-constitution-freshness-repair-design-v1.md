# bug-335 constitution freshness repair design v1

Status: implementation-bound design for `work-bp-bug335_prereq0_v5-implementation`  
Base: `f431bdfeceaa98982a0105fe3b58ce04ddd8ac8a`  
Scope: constitution sync freshness only; no constitutional content, cadence, threshold, deployment, or authority change.

## Defect

`ConstitutionSync.tick()` currently returns immediately after a successful unchanged-HEAD read. `ConstitutionRepositorySubstrate.buildProvenance()` derives age only from content `syncedAt`. Consequently unchanged healthy content becomes permanently stale after the threshold and restart cannot recover it.

## State model

The singleton `ConstitutionSnapshot/current` carries two distinct timestamps:

- `syncedAt`: when the exact SHA/manifest/files content snapshot was committed. It is content provenance and never changes on verification-only polling.
- `lastVerifiedAt`: the latest durable successful upstream HEAD verification bound to the same current SHA. It is mutable health in the status envelope partition and drives `stale`/`ageSeconds`.

Legacy rows may lack `lastVerifiedAt`; reads fall back to `syncedAt`, preserving stale honesty until a successful unchanged verification durably upgrades health. The public provenance response adds `lastVerifiedAt` while retaining `syncedAt`.

A changed valid snapshot stamps both timestamps to the same commit-time instant. Superseded/history rows preserve their last values.

## Unchanged-HEAD transaction

After a successful HEAD API call returns SHA H and current snapshot also has H:

1. call `markVerified(H, now)`;
2. repository reads `current` with resource version;
3. reject `not_synced` or `sha_mismatch` if current identity no longer equals H;
4. preserve all content fields, `syncedAt`, status, history, and createdAt;
5. monotonically advance only `lastVerifiedAt` plus row `updatedAt` via `putIfMatch`;
6. retry CAS conflict from a fresh row up to the existing bounded repository retry cap;
7. return `unchanged` only after durable success.

Persistence exhaustion/error returns a stale-honest tick error. It never reports successful freshness from memory. Verification-only writes do not call history retention and do not emit `constitution-updated-notification`, because content did not change.

## Changed-candidate race fence

The sync passes the pre-fetch current SHA (or null on first sync) into `swapSnapshot`. The repository refuses to commit if current identity changed while the tree/blobs were fetched. Concurrent instances fetching the same SHA are idempotent when the already-committed SHA and manifest hash match. Different candidates cannot overwrite a newer winner through the old blind CAS retry loop.

The content swap remains the single-row atomic commit. Parse, complete pinned-tree fetch, and live-charter referential gates still run before it.

## Failure semantics

The following never advance verification health:

- HEAD/API failure;
- changed HEAD below the fetch-all rate budget;
- tree/blob fetch failure;
- malformed or empty parse candidate;
- live-charter referential rejection;
- current SHA changing before health CAS;
- health persistence/CAS exhaustion;
- changed-candidate expected-current mismatch.

No no-op Git commit, manual row rewrite, threshold change, timestamp fabrication, or history mutation is introduced.

## Storage compatibility

- `ConstitutionSnapshot` SchemaDef version advances from 1 to 2.
- `lastVerifiedAt` is placed in `status` by `ConstitutionSnapshot` envelope migration; immutable SHA/syncedAt/manifest/files remain in `spec`.
- Existing envelope rows need no eager rewrite. `decodeEnvelopeToFlat` plus fallback supports legacy reads, and the first successful verification writes the new field through the canonical encoder.
- No new index is required: this is a singleton point-read/CAS path.

## API compatibility

`ConstitutionProvenance` additively exposes `lastVerifiedAt`. Existing `sourceRepo`, `sha`, `syncedAt`, `manifestHash`, `stale`, and `ageSeconds` remain. `ageSeconds` now means time since successful upstream verification rather than time since content acquisition. MCP descriptions state the distinction.

## Test contract

Focused tests bind twelve named cases in `hub/src/policy/__tests__/constitution-freshness.test.ts`; existing constitution serve tests remain green and now require `lastVerifiedAt` in every provenance projection. The matrix is recorded at `docs/reports/bug-335-failure-race-matrix-v1.md`.

## Rollback

Pre-deploy rollback is branch/PR abandonment. Post-merge rollback must be a separate protected change. Old binaries ignore `lastVerifiedAt` and derive staleness from `syncedAt`; therefore this repair must be deployed as one Hub binary/schema unit. No source or production deployment is authorized by this WorkItem.