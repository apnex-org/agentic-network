# Mission-140 node-contract-v4 foundation matrix

## Scope and identity

| Field | Value |
|---|---|
| WorkItem | `work-bp-workgraph_safe_revision_impl0_v6-foundation` |
| Repository | `apnex/agentic-network` |
| Worktree | `/home/apnex/taceng/agentic-network-alex-m140-foundation` |
| Branch | `alex/mission140-foundation-v4` |
| Base | `origin/main@2cf1cddfb818b9f19baad2a94febd5256cd0972e` |
| Source module | `hub/src/entities/work-item-contract-v4.ts` |
| Test module | `hub/src/entities/__tests__/work-item-contract-v4.test.ts` |
| Public export | `hub/src/entities/index.ts` |
| Effect class | source + tests + this matrix only; no deploy, migration, entity disposition, or live effect |

## Pre-effect authority fence

Fresh checks completed before worktree/branch creation or source mutation:

| Condition | Fresh result |
|---|---|
| Manifest path | `docs/authority/workgraph-safe-revision-implementation-authority-manifest-v6.md` |
| Manifest binding | `rv=56549641`, UTF-8 bytes `15072`, SHA-256 `ca83119d8a77555175fee692d09a1a4f9dfbf5d432875a6d9c22f41711c99c48` |
| Manifest raw participant re-fetch | exact bytes `15072`, exact SHA matched; ASCII-only; fresh document metadata retained original `createdAt=updatedAt=2026-07-23T12:48:24.929Z`, excluding an identical-byte overwrite/RV bump |
| Blueprint V6 gate | active PASS, `verify_attestation.valid=true`, no invalid reasons, no legacy evidence |
| Continuation3 final gate | active PASS, `verify_attestation.valid=true`, no invalid reasons, no legacy evidence |
| Design V2 gate | active PASS, `verify_attestation.valid=true`, no invalid reasons, no legacy evidence |
| Authority envelope | fresh raw bytes `42819`, SHA-256 `2733f304f1f0f5bce465630cbf030443c90acef84fff2665d288416db4e48ce1`; document `createdAt=updatedAt=2026-07-23T13:31:51.822Z` |
| Constitution | source SHA `8d3886823dfc1c971e5a47eec53d22eee3b91911`, manifest `c2c3984150e0b5f57ed500f22392906369b7f33952a4351a8e16e41bd20f4df7`, charter `ocharter-17`, `stale=false` |
| Start gate | exact V6 commencement WorkItem `done`; foundation was ready and explicitly assigned |

The Hub read surface does not return document resourceVersion. The participant proof therefore composes (a) the frozen `rv=56549641` from the active-valid exact attestation and node binding, (b) a fresh raw MCP byte/SHA re-fetch, and (c) fresh list metadata showing no overwrite since creation. A same-path identical-byte overwrite would move `updatedAt`, so it cannot silently satisfy this proof.

## Mechanics

### Canonicalization

| Requirement | Implementation | Executable proof |
|---|---|---|
| RFC-8785-compatible deterministic JSON | recursively sorted UTF-16 object keys; ECMAScript number serialization; exact JSON string escaping | key-order, sequence, exponent, and `-0` vectors |
| exact UTF-8, no normalization | SHA operates on original well-formed strings/bytes | composed vs decomposed Unicode hashes differ; multibyte inline byte count is 2 |
| forbidden values | reject `undefined`, non-finite numbers, bigint/function/symbol, sparse arrays, cycles, class instances, invalid UTF-8, and unpaired surrogates | negative vectors |
| duplicate object keys | strict raw JSON parser rejects before native `JSON.parse` erases duplicates | nested and top-level duplicate test |
| set/sequence semantics | declared sets reject duplicates then sort; reference and payload arrays retain order | role/edge duplicate tests; reference-position test |
| domain separation | SHA-256 over `domain + NUL + canonical-json` | fixed golden hashes for every identity domain |

### Exhaustive claimant contract

`node-contract-v4` admits exactly these claimant-significant fields:

- `type`
- sorted unique `roleEligibility`
- exact runbook UTF-8 SHA
- canonical payload SHA, with `null` distinct from absence
- exact `targetRef`
- evidence requirements ordered by ID, including description SHA, `refResolvable`, `allowPreClaim`, and `evidenceAuthority`
- references in declared position with exact storage identity
- `leaseWindowMs`
- authored pulse configuration with message SHA

Every known runtime/projection/provenance field is explicitly classified as excluded. Unknown top-level or nested contract fields reject until a new hash version is ratified. Pulse bookkeeping is excluded while authored pulse physics remains included.

### Storage-specific reference identity

| Storage | Frozen identity | Fail-closed checks |
|---|---|---|
| `hub-doc` | `{path,resourceVersion,utf8Bytes,sha256}` | exact locator, authoritative content, one supplied transaction snapshot |
| `git` | `{repo,full40CommitSha,path,blobSha256}` | branches/tags/HEAD/short SHA reject; locator must match authoritative repo/commit/path |
| `inline` | `{utf8Bytes,sha256}` | exact locator UTF-8; invalid Unicode rejects |
| `entity` | `{kind,id,resourceVersion,stateHash}` | exact locator and same authoritative snapshot; state hash recomputed locally |

Precomputed caller hashes are not an accepted resolver input. The binder accepts content/state and computes identity itself. Hub/entity resolutions must share the authoring transaction token; cross-snapshot version/content pairs reject.

### Logical and topology identity

| Identity | Inputs | Explicit exclusion |
|---|---|---|
| `node-topology-v4` | logical ID + sorted own start/completion outgoing logical IDs | global generation/hash |
| `target-binding-v4` | edge class + exact direct target logical/physical/revision/contract binding | recursive target local identity |
| `local-execution-v4` | own logical/physical/revision + contract hash + node topology hash + sorted direct target digests | unrelated global generation/churn |
| `work-topology-v4` | generation pair + sorted current bindings + tagged global edge set | runtime lease/evidence/projection state |

The module also defines `WorkRevisionFamilyV4`, `RevisionFieldsV4`, actor/family scope, recall-history, pending exact-holder intent, binding, and topology schema types. Persistent SchemaDefs, mutation/currentness integration, topology storage, pause/revision verbs, and failed-seal V2 are intentionally left to their separately gated V6 nodes.

## Golden vectors

| Vector | SHA-256 |
|---|---|
| canonical node-contract bytes | `5fbe99a3816529f02d130df731ea3d9f9795535a5bd48311e635d99fb82c0491` |
| `node-contract-v4` domain hash | `c683c8cbc9f2021266b7762a563fc3a984452f7a491027db844c167032df4f82` |
| `node-topology-v4` | `cc3eb50fccd2ee8a3f7bc4a2eb62d0e69df516f921410c5a4cc2536cea921015` |
| `target-binding-v4` | `8be8548e4e4890e79b585d0f369ec243e38e286b8325a4283ef4f2f662e59766` |
| `local-execution-v4` | `dc5ec652ac883ee1d17f8eb283c2b6378c3c39522f21db8d0057bed96465d48d` |
| `work-topology-v4` | `06b58198a558cf32e8643f160114c00bcccd1815df92689b6bdabc9447a00514` |

## Acceptance matrix

| Area | Positive | Negative / drift |
|---|---|---|
| Canonical JSON | deterministic ordering and exact Unicode | undefined, NaN/Infinity, sparse, cyclic, malformed Unicode, duplicate key |
| Contract included fields | every declared included field/subfield changes hash | missing/invalid/unknown schema input rejects |
| Contract excluded fields | every current runtime/provenance field preserves hash | unknown unclassified field rejects |
| Declared sets | input order does not matter | pre-dedupe duplicate rejects |
| References | every storage class binds exact content | path/repo/commit/snapshot/identity mismatch rejects |
| Hub document | content and resource version both participate | byte-identical RV drift invalidates identity |
| Git | full-40 immutable pin succeeds | mutable branch/tag/HEAD/short pin rejects |
| Inline | multibyte byte count/hash exact | malformed Unicode rejects |
| Entity | exact state + RV bind | same ID with RV or state drift invalidates |
| Node topology | edge order invariant | duplicate edge member rejects |
| Local identity | own contract/topology/direct target changes invalidate | disconnected global generation is structurally absent |
| Global topology | binding/edge declaration order invariant | duplicate tagged edge rejects |

## Rationale

Global topology publication and local execution/evidence identity solve different problems. A generation is the atomic visibility boundary for the graph; it must not invalidate an unrelated claimant. Conversely, a same-path document overwrite, a byte-identical resourceVersion change, a changed own edge, or a changed direct target must never leave a claimant operating under a stale contract. The pure foundation fixes these semantics before storage and mutation code can depend on them.

## Consequence

Later V6 storage/currentness/revision nodes can persist and enforce one versioned identity contract rather than inventing hashes independently. Any unclassified field, mutable reference, cross-snapshot pair, malformed canonical value, duplicate set member, or identity drift fails closed. This prevents stale-evidence reuse, disconnected-generation lease invalidation, recursive hash cascades, and silent contract refresh while preserving every historical WorkItem row.
