# bug-335 failure and race matrix v1

WorkItem: `work-bp-bug335_prereq0_v5-implementation`  
Base: `f431bdfeceaa98982a0105fe3b58ce04ddd8ac8a`  
Focused suite: `hub/src/policy/__tests__/constitution-freshness.test.ts`  
Companion regression suite: `hub/src/policy/__tests__/constitution-serve.test.ts`

## Result matrix

| Required case | Expected invariant | Load-bearing focused test | Result |
|---|---|---|---|
| unchanged healthy polling | `lastVerifiedAt` advances durably; `syncedAt`, SHA, manifest, files, and history remain unchanged; stale clears | `unchanged healthy polling advances verification health without changing content identity or history` | PASS |
| HEAD/API unreachable | tick errors; prior `lastVerifiedAt` stays unchanged and stale remains honest | `HEAD/API unreachable does not refresh verification health` | PASS |
| rate-budget skip on changed HEAD | no tree fetch/content swap/health refresh | `rate-budget skip on a changed HEAD does not refresh old-snapshot health` | PASS |
| fetch-all failure | tick errors and prior health does not advance | `fetch-all failure does not refresh verification health` | PASS |
| malformed parse rejection | whole candidate rejects and prior health does not advance | `malformed changed candidate rejection does not refresh verification health` | PASS |
| live-charter referential rejection | whole candidate rejects and prior health does not advance | `live-charter referential rejection does not refresh verification health` | PASS |
| startup/restart unchanged recovery | new sync/repository instance can durably verify unchanged SHA without content rewrite | `startup/restart instance recovers freshness on unchanged HEAD` | PASS |
| concurrent-instance health CAS conflict/retry | both successful observations converge; CAS retry is monotonic and current health becomes fresh | `concurrent-instance health CAS conflict/retry converges monotonically` | PASS |
| snapshot SHA changes during health update | old HEAD cannot refresh new current snapshot | `snapshot SHA change during a health update returns mismatch and cannot refresh the winner` | PASS |
| failed health persistence | tick reports error; no in-memory success claim; stale timestamp remains | `failed health persistence returns an error and remains stale-honest` | PASS |
| changed valid snapshot swap | new content atomically swaps, both timestamps are stamped, prior content remains in history | `changed valid snapshot swap stamps both times and preserves superseded content history` | PASS |
| no content-history churn from verification-only updates | unchanged verification leaves `snap-<sha>` byte-equivalent; concurrent identical candidate produces one current/history identity | `unchanged healthy polling...` and `concurrent identical changed candidates commit once without content-history churn` | PASS |

## Additional retained gates

The companion constitution serve suite retains these pre-existing contracts:

- first and changed sync whole-corpus atomicity;
- unauthenticated public GitHub operation and dedicated-token isolation;
- pinned tree plus raw-body acquisition;
- malformed/empty/duplicate-ID rejection;
- live-charter referential gate;
- rate-budget enforcement;
- post-commit best-effort announcement;
- not-synced distinctness;
- full provenance on all four read verbs;
- fail-open stale content serving;
- verbatim axiom body fidelity.

The provenance contract now additionally requires `lastVerifiedAt` beside immutable content `syncedAt`.

## Commands

Focused command:

```text
cd hub && npx vitest run \
  src/policy/__tests__/constitution-freshness.test.ts \
  src/policy/__tests__/constitution-serve.test.ts
```

Observed focused result before commit: **2 files passed, 30 tests passed**.

Hub type/build command:

```text
cd hub && npm run build
```

Observed result before commit: **PASS**.

Full Hub command:

```text
cd hub && npm test -- --run
```

Observed result before commit: **214 test files passed, 1 skipped; 2,666 tests passed, 5 skipped**. The command includes the Hub TypeScript build in `pretest`.

Final PR/check identities are recorded after the immutable commit/PR boundary; this report does not pre-claim CI, merge, deployment, or live production behavior.

## Proof boundary

These are local source tests on the implementation branch. They prove no merge, deployment, production refresh, or `stale=false` live qualification. Independent review, protected merge, deploy, and live verification belong to later WorkItems.

Hub document binding (resourceVersion, exact UTF-8 bytes, SHA-256) is carried by the WorkItem `failure_matrix_binding` evidence after this exact file is uploaded; it is intentionally not self-referential inside the hashed bytes.