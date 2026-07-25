# WorkGraph pause/recall frozen-authority V4 repair matrix

## Scope and preserved boundary

This is the distinct `work-474` successor repair. It starts from the exact failed
candidate `515955e07a3d168e3a2a5d373baca7ac746b8213` and does not rewrite,
re-attest, or migrate evidence from
`work-bp-workgraph_safe_revision_impl0_v6-pause_gate`. That predecessor gate's
active-valid FAIL remains immutable. This change does not publish a revision
generation, claim downstream work, or perform PR, merge, deployment, migration,
disposition, or closeout effects.

The repair implements Design V2 §6.1's frozen active-generation authority. A
pause is no longer only a lifecycle phase change: it freezes the exact claimant
contract and topology authority that may later be scalar-recommitted.

## Frozen authority persisted by pause

Each new `RecallHistoryEntryV4` carries a `FrozenRecallAuthorityV4`:

| Field | Authority bound |
|---|---|
| `mode` | exact legacy/shadow or generation mode |
| `logicalId`, `physicalId`, `revision` | exact row/family identity |
| `generation` | active head generation at pause, not first-materialization provenance |
| `nodeContractHash` | freshly derived claimant contract from persisted fields and exact bound references |
| `nodeTopologyHash` | freshly derived forward dependency and completion topology |
| `dependsOnLogicalIds`, `completionDependsOnLogicalIds` | exact sorted persisted outgoing edges |
| `localExecutionIdentity` | generation-mode row, topology, and outgoing-target binding identity |
| `authorityHash` | domain-separated canonical digest of all fields above |

In generation mode, pause recomputes rather than trusts the row's stored hashes.
It requires the exact current physical binding and revision; maps both logical
and physical edge locators through the pinned generation; rejects duplicate,
dangling, or generation-divergent edges; re-derives the node contract from the
actual persisted type, role eligibility, runbook, payload, target, evidence
requirements, references, lease window, and engineer-authored node config; then
cross-checks the active binding, stored contract/topology versions and hashes,
and local execution identity.

In legacy/shadow mode there is no immutable generation. Pause therefore freezes
a canonical persisted claimant projection plus exact dependency arrays. Runtime
pulse bookkeeping is deliberately excluded; claimant-authored pulse fields are
included.

The new history field remains optional only for decoding historical rows. A
legacy paused row without this authority cannot prove unchanged claimant bytes,
so unpause fails closed and requires semantic revision rather than guessing or
injecting authority.

## Mutation fence

`WorkItemRepositorySubstrate.updateWorkItem` is the shared mutation seam behind
public `update_work` and internal callers. While an item is paused, or whenever
a topology generation is active, it rejects every claimant-significant path
with `workgraph.currentness.revision_required`:

- `targetRef`
- `runbook`
- `payload`
- `roleEligibility`
- `appendDependsOn`
- `appendCompletionDependsOn`
- `appendReferences`

`type` and `evidenceRequirements` remain permanently absent from the mutation
surface. Priority remains scalar coordination metadata and may change without
altering claimant or topology authority. Legacy, non-paused behavior retains
the prior field/phase rules until a topology generation is active.

The policy layer renders a frozen-authority rejection as a loud tool-level
transition/update rejection, never an opaque internal fault.

## Unpause predicate

Under the writer fence and fresh-row CAS, unpause now performs this order:

1. resolve the exact physical or current logical locator;
2. reject failed-sealed, wrong-revision, wrong-generation, and non-paused rows;
3. recompute the current frozen authority from the persisted row and pinned
   generation using the same trust-nothing procedure as pause;
4. verify the stored authority's own domain-separated integrity hash;
5. require exact equality with the recomputed authority;
6. only then resolve original-creator/steward authorization and recommit
   `paused → ready`.

A changed target, contract field, reference, dependency, completion edge,
stored identity, outgoing target binding, physical binding, revision, or active
generation leaves the row paused and requires a distinct semantic revision.
No automatic repair, hash rewrite, row deletion, history deletion, or evidence
migration occurs. An unchanged priority-only scalar update remains compatible
with unpause.

## Falsifier and race matrix

| Case | Memory | Real PostgreSQL | Required result |
|---|---:|---:|---|
| public target change while paused | yes | yes | `revision_required`; no write |
| public runbook/payload/role change while paused | yes | shared-seam proof | `revision_required`; no write |
| dependency/completion/reference append while paused | yes | completion edge yes | `revision_required`; no write |
| Steve targetRef + appended completion-edge old-binary end state with stale stored hashes | yes | yes | restart unpause rejects; row remains paused |
| same falsifier after repository restart | yes | yes | identical rejection |
| unpause versus every public semantic mutation alias | yes | target+completion combined in PostgreSQL | writer-fenced ordering; unpause may win, mutation never can |
| missing frozen authority | yes | schema-compatible | fail closed |
| tampered frozen payload with stale authority hash | yes | integrity path shared | fail closed |
| unchanged scalar priority update then unpause | yes | yes, across restart | succeeds and retains priority |
| recall and attestation history preservation | yes | yes | exact arrays retained; zero deletion |

The PostgreSQL falsifier writes the corrupt historical end state only while
holding the legitimate WorkGraph advisory writer fence. This proves the
application recomputation catches old-binary or direct-storage stale-hash rows
rather than depending on a test-only unfenced mutation. The race runs through
the real same-session advisory lock and CAS path.

## Verification

The final verification set includes:

- Hub TypeScript build;
- focused frozen-authority memory, policy, mutability-table, and real-PostgreSQL
  tests;
- WorkGraph simulator build and 14/14 oracle/lifecycle tests;
- full Hub suite including the real-PostgreSQL coverage.

One initial full-suite run preserved an unrelated existing `JSONB size CHECK`
5-second timeout. Its exact isolated retry passed, and the subsequent complete
suite passed. The failed run remains in the completion receipt rather than being
silently discarded.
