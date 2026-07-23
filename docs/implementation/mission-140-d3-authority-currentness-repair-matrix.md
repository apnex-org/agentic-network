# Mission-140 D3 authority/currentness repair matrix

## Boundary and lineage

This is the bounded `work-479` source receipt. The clean worktree was created from exact failed candidate `bcb6b9339ec4fab1b5782764484edaf648f846ab` (tree `d3e28d9f738c88f3e353cb870a5a5f3121a1e04a`). The Repair2 `semantic_gate` and its active-valid `semantic_seal=FAIL` remain immutable. No WorkItem, evidence, attestation, PR, merge, deployment, production state, disposition, or predecessor history was mutated by this source work.

The resulting Git commit is intentionally bound outside this file in the Work-479 evidence row to avoid a self-referential commit hash. This file, the implementation, and the frozen regression are committed atomically.

## Production mechanism

`WorkItemRepositorySubstrate` now authorizes semantic revision only after deriving the complete reverse closure and loading every current family/row under the global writer fence, and before allocating any successor revision.

| V2 D3 obligation | Implemented rule | Exact denial |
|---|---|---|
| authenticated identity only | actor is the server-stamped repository argument; immutable creator stamp requires role and agent ID match | `revision.actor_forbidden`, `revision.family_owner_mismatch` |
| holder is not authority | current/former holder history grants no revise or unpause authority | `revision.holder_has_no_authority` |
| creator scope | creator semantic revision is limited to one standalone family/node | `revision.architect_required` |
| creator topology | both edge arrays must remain byte-equal; reverse-dependent closure is denied | `revision.architect_required` |
| creator roles | next roles are limited to existing roles plus the creator's authenticated role | `revision.authority_expansion_forbidden` |
| creator target | target binding cannot change | `revision.authority_expansion_forbidden` |
| creator required refs | every previously required `{kind,ref,storage,mode}` remains present and required | `revision.authority_expansion_forbidden` |
| creator lease/pulse | lease window cannot be introduced/increased; node pulse config cannot change | `revision.authority_expansion_forbidden` |
| architect/Director closure | multi-family closure requires every family to share one mission scope; mixed standalone/cross-mission closures reject | `revision.cross_scope_forbidden` |
| target scope | mission family cannot target another mission; standalone cannot expand into a mission | `revision.cross_scope_forbidden` |
| batch recommit | architect or Director only | `revision.director_or_architect_required` |
| quiescence/seal | failed seal and non-quiescent/evidence-bearing rows fail before allocation | `revision.failed_gate_sealed`, `revision.affected_state_forbidden` |
| caller closure/currentness | expected closure and generation/current binding are deterministic | `revision.affected_set_mismatch`, `revision.currentness_mismatch` |
| scalar unpause | unchanged same-pausing creator remains compatible; holder/reviser/successor laundering gets exact revision denial | `revision.actor_forbidden`, `revision.architect_required`, `revision.holder_has_no_authority` |

No request schema can mutate `originalCreatedBy`, `familyScope`, evidence requirements/authority, executor history, evidence, attestations, or authority records. Successor `createdBy`/`revisedBy` therefore cannot amplify authority because future decisions re-read the immutable family creator and scope.

## Frozen independent-falsifier regression

`hub/src/entities/__tests__/d3-revision-authority-matrix-v4.test.ts` freezes the seven prior counterexamples before any successor allocation and additionally exercises positive and cross-action matrix cells.

| Prior falsifier | Frozen regression |
|---|---|
| D3-1 creator mission-family revision | mission-scoped creator gets `revision.architect_required`; generation and allocation stay at 1 |
| D3-2 creator edge replacement | standalone single-node creator edge replacement gets `revision.architect_required`; no head/allocation movement |
| D3-3 required-reference removal | removal gets `revision.authority_expansion_forbidden` |
| D3-4 lease escalation | `300000 → 86400000` gets `revision.authority_expansion_forbidden`; pulse escalation is separately denied |
| D3-5 target-scope expansion | standalone bug target → foreign mission gets `revision.authority_expansion_forbidden`; role expansion is separately denied |
| D3-6 architect mixed mission/standalone closure | architect mixed closure and Director cross-mission closure get `revision.cross_scope_forbidden`; architect same-mission closure succeeds |
| D3-7 generic denial taxonomy | unrelated actor, creator stamp mismatch, former holder, affected-set mismatch, stale generation, batch recommit, and target crossing assert exact `revision.*` codes |

Additional controls prove narrow standalone creator success; architect and Director same-mission success; creator batch denial plus architect batch success; and successor-author laundering denial.

## Test and environment receipt

All commands ran in `/home/apnex/taceng/agentic-network-greg-m140-d3-repair`, with package dependencies linked read-only from the exact base integration worktree and removed before commit. PostgreSQL suites used testcontainers and exercised real transactions, advisory locks, restart/recommit, indexed >500 traversal, and frozen pause-authority restart behavior.

| Artifact | Result | UTF-8 bytes | SHA-256 |
|---|---|---:|---|
| `/tmp/work479-build-final.log` | Hub TypeScript build PASS | 92 | `d48078b9622ff9a84b825f436a89320074e2007348679075b351008e89c74d90` |
| `/tmp/work479-d3-frozen-final.log` | frozen D3 file: 1 file / 11 tests PASS | 535 | `30b9a578534909cdc37b288f919b5e8b4215e48d1183f8e4cb75fcf91d7821ac` |
| `/tmp/work479-focused-final2.log` | focused + real-PG: 14 files / 290 tests PASS | 109739 | `1a011cff199f78ce20859c85567f608713d79e351d5e235e61df78740c58cffa` |
| `/tmp/work479-full-hub-final2.log` | full Hub: 229 files PASS, 1 skipped; 2827 tests PASS, 5 skipped | 3102395 | `87c9ae664f0e3c470e80bc13db8e10b9dfe7328da52379a8fffb220e17cad97d` |
| `/tmp/work479-sim-build-final2.log` | WorkGraph simulator TypeScript build PASS | 43 | `5ab4e91cf11ca0dc1b52abc1d526868410e605157c2fd206e073c2be7b7db383` |
| `/tmp/work479-sim-test-final2.log` | simulator: 6 files / 14 tests PASS | 1177 | `84736eb2da73917e0c5d4b7503abe4ffe0238afec16eea65a266ed03af07e2ef` |

Expected diagnostics remain visible: advisory-lock latency, deliberately malformed rename-map rows, intentionally terminated PostgreSQL clients, and stubbed failure-path messages.

### Preserved failed run

The first full-Hub run correctly failed because legacy `paused-state.test.ts` still asserted the old `TransitionRejected` class after scalar unpause began returning exact `revision.actor_forbidden`. That failed run remains preserved at `/tmp/work479-full-hub-final.log`, 3,103,095 bytes, SHA-256 `08886e03da46231bbef8c219f5b246d060fec2a171de6a84de9a8efe7b774b86`. The test expectation was updated without weakening behavior, then the focused and full suites passed.

## Non-effects

No PR was created or changed. No merge, deploy, production mutation, evidence migration, semantic-gate replay/re-attestation, existing WorkItem mutation, publication, disposition, or closeout occurred. `work-479` source completion grants no delivery authority; `work-480` remains the distinct independent D3 repair gate.
