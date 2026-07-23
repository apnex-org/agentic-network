# bug-335 / bug-338 failure and race matrix v2

WorkItem: `work-bp-bug335_status_repair0_v8-implementation`
Base: `f431bdfeceaa98982a0105fe3b58ce04ddd8ac8a`
Focused suite: `hub/src/policy/__tests__/constitution-freshness.test.ts`
Companion suite: `hub/src/policy/__tests__/constitution-serve.test.ts`
Rejected predecessor: PR #667 / `c5ecbccee551af6ee2dcc92c40761a2b5e289abf` remains immutable FAIL.

## Result matrix

| Required case | Expected invariant | Load-bearing focused test | Result |
|---|---|---|---|
| production encoder/decoder status preservation, legacy row | a canonical envelope with raw `status.status="active"` and no `lastVerifiedAt` decodes to domain `status="active"`; `markVerified` adds health while both raw and decoded status remain active | `production envelope encoder/decoder preserves active status when markVerified upgrades a legacy row` | PASS |
| unchanged healthy polling | `lastVerifiedAt` advances durably; `syncedAt`, SHA, manifest, files, status, and history remain unchanged; raw `status.status` remains active; stale clears | `unchanged healthy polling advances verification health without changing content identity or history` | PASS |
| HEAD/API unreachable | tick errors; prior `lastVerifiedAt` stays unchanged and stale remains honest | `HEAD/API unreachable does not refresh verification health` | PASS |
| rate-budget skip on changed HEAD | no tree fetch, content swap, or health refresh | `rate-budget skip on a changed HEAD does not refresh old-snapshot health` | PASS |
| fetch-all failure | tick errors and prior health does not advance | `fetch-all failure does not refresh verification health` | PASS |
| malformed parse rejection | whole candidate rejects and prior health does not advance | `malformed changed candidate rejection does not refresh verification health` | PASS |
| live-charter referential rejection | whole candidate rejects and prior health does not advance | `live-charter referential rejection does not refresh verification health` | PASS |
| startup/restart unchanged recovery | new sync/repository instance durably verifies unchanged SHA without content rewrite | `startup/restart instance recovers freshness on unchanged HEAD` | PASS |
| concurrent-instance health CAS conflict/retry | successful observations converge monotonically and current health becomes fresh | `concurrent-instance health CAS conflict/retry converges monotonically` | PASS |
| snapshot SHA changes during health update | old HEAD cannot refresh a new current snapshot | `snapshot SHA change during a health update returns mismatch and cannot refresh the winner` | PASS |
| failed health persistence | tick reports error; no in-memory success claim; stale timestamp remains | `failed health persistence returns an error and remains stale-honest` | PASS |
| changed valid snapshot swap | new content atomically swaps, both timestamps are stamped, prior content remains in history | `changed valid snapshot swap stamps both times and preserves superseded content history` | PASS |
| no content-history churn | unchanged verification leaves `snap-<sha>` byte-equivalent; concurrent identical candidate yields one current/history identity | `unchanged healthy polling...` and `concurrent identical changed candidates commit once without content-history churn` | PASS |

## Status-collision closure

The regression runs the production memory substrate with the canonical envelope write encoder. It asserts the exact storage and repository projections, not a hand-built substitute:

```text
before raw:     status = { status: "active" }
before decoded: status = "active"; lastVerifiedAt = undefined
action:         markVerified(expectedSha, verifiedAt)
after raw:      status = { status: "active", lastVerifiedAt: verifiedAt }
after decoded:  status = "active"; lastVerifiedAt = verifiedAt
```

The ordinary non-legacy unchanged-poll test independently repeats the after-state raw/decoded assertions. This directly closes the V6 falsifier that observed decoded status undefined and raw status erased.

## Retained companion gates

The companion constitution serve suite retains:

- first and changed sync whole-corpus atomicity;
- unauthenticated public GitHub operation and dedicated-token isolation;
- pinned tree and raw-body acquisition;
- malformed, empty, and duplicate-ID rejection;
- live-charter referential rejection;
- rate-budget enforcement;
- post-commit best-effort announcement;
- not-synced distinctness;
- full provenance on all four read verbs;
- fail-open stale content serving;
- verbatim axiom fidelity.

`lastVerifiedAt` remains additive beside immutable `syncedAt`.

## Commands and observed results

Focused:

```text
cd hub && npx vitest run \
  src/policy/__tests__/constitution-freshness.test.ts \
  src/policy/__tests__/constitution-serve.test.ts
```

Observed: **2 files passed; 31 tests passed** (13 freshness/status tests + 18 serve tests). Exact focused log: 20,120 bytes, SHA-256 `84c5e0498095a5135c2315259612d7683bd744953c065c666b4ee35c12cd6d6b`, finished `2026-07-23T07:01:54Z`.

Build prerequisites and Hub build:

```text
npm run build --workspace=@apnex/storage-provider
npm run build --workspace=@apnex/repo-event-bridge
npm run build --workspace=hub
```

Observed: **PASS**.

Full Hub:

```text
cd hub && npm test -- --run
```

Observed: **214 files passed, 1 skipped; 2,667 tests passed, 5 skipped**. Full log: 3,030,252 bytes, SHA-256 `7f77bc6ff0c9565a8611d663dfda7f326f84ae20be23b608980251855b842c11`, finished `2026-07-23T07:01:09Z`.

## Proof boundary

These are local source checks in a fresh isolated worktree rooted at the frozen base. They prove no protected merge, deployment, production refresh, or live `stale=false` result. Final PR/head/tree/path/check and Hub document bindings are recorded after immutable commit and document upload; this report deliberately contains no self-referential hash.
