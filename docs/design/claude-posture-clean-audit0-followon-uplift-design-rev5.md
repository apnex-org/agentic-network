# Claude follow-on uplift design — Revision 5

**WorkItem:** `work-418`
**Status:** design and finite blueprints only; no uplift implementation or seed
**Supersedes for future consideration:** Rev 4, while preserving Rev 3, Rev 4, `work-363`, and `work-381` immutable **FAIL / NOT SEED-APPROVED** verdicts
**Authority boundary:** disposed `decision-26` is historical only. A fresh Decision may be raised only after canonical Rev 5 bytes exist.

## 1. Purpose and inherited mechanism

Rev 5 preserves Rev 4's useful mechanism split without reviving failed Rev 4 authority:

- **E:** additive/lazily enforced Hub schema evolution;
- **D:** dispatch-time declared-safe tolerance and precise failure otherwise;
- **C-minimal:** session-init-anchored harmful-drift alert;
- **B:** upstream `tools/list_changed` host tracking;
- read-only footer and bounded provenance/durability work.

The feature work is explicitly outside `mission-123`. These files describe a later finite WorkGraph only. Validation, review, Decision resolution, or seedability does not implement or prove the uplift.

## 2. Immutable artifacts

Rev 5 consists of this design and four complete static JSON files:

- `docs/blueprints/claudeuplift0-rev5-v0.json`
- `docs/blueprints/claudeuplift0-rev5-v1.json`
- `docs/blueprints/claudeuplift0-rev5-v2.json`
- `docs/blueprints/claudeuplift0-rev5-v3.json`

The review/merge reports bind each file's canonical git commit, git blob id, and SHA-256. Git is the immutable review source. Hub `nodesRef` documents are later byte-for-byte copies, never the authority source.

A post-merge copy protocol must:

1. read the exact committed file;
2. create/update its distinct Hub document path;
3. verify the returned `contentSha256` equals the committed file SHA-256 and record `resourceVersion`;
4. let the verifier call `seed_blueprint(nodesRef, dryRun=true)` on that copy;
5. use that same hash as `expectedContentSha256` for any authorized live seed.

The deployed control plane resolves one document snapshot, hashes/parses/validates those same bytes, and rejects mismatch with zero creation. Verifier calls are dry-run-only; live seed remains architect-only.

## 3. Complete variants and honest Director previews

All variants are complete static graphs. Omitted nodes are absent from `nodes[]`, driver completion edges, and verifier edges—never paused, skipped, or conditionally authored.

### V0 / option `rev5-minimal` — 18 nodes

`{driver, artifact_gate, rail_gate, drift_fixture, schema_policy, dispatch_tolerance, drift_alert, bug203_track, footer, frequency_calibration, estate_provenance, na_pin, specstore, skill_hotreload_probe, opencode_cleanup, citation_resolver, verifier_gate, closeout}`

Optional set: `{}`. Omits `{pB2_selfheal, pA_traction, pA_tool_actuator}`.

### V1 / option `rev5-selfheal` — 19 nodes

V0 plus `{pB2_selfheal}`. Omits `{pA_traction, pA_tool_actuator}`.

### V2 / option `rev5-actuator` — 20 nodes

V0 plus **both** `{pA_traction, pA_tool_actuator}`. Omits `{pB2_selfheal}`.

The Director preview must show both names. ToolActuator is not offered as a standalone cure. V2 is legal only if the Decision also binds pre-existing positive current-host traction evidence; a negative `pA_traction` result blocks the actuator and requires a new design/Decision.

### V3 / option `rev5-full` — 21 nodes

V0 plus all three `{pB2_selfheal, pA_traction, pA_tool_actuator}`. Omits nothing.

The Director preview must show all three names, including `pA_traction`.

Current bound Claude Code 2.1.195 evidence is negative, so only V0/V1 are eligible in the fresh Decision. V2/V3 require distinct pre-existing positive current-host traction evidence and cannot be inferred from adapter emission.

A custom answer must identify exactly one V0–V3 file identity. Any changed node set requires new committed bytes, review, dry-run, and Decision.

## 4. Structural admission gates

### 4.1 `artifact_gate`: verifier authority, not architect prose

Every variant carries requirement `artifact_admission` with:

- `kind=doc`;
- `evidenceAuthority=verifier-attestation`;
- `refResolvable` deliberately omitted because SEAL verifier-attestation requirements reject executor-resolution authority mixing.

The architect authors the exact corrective admission report separately, then claims/starts the gate and calls `complete_work` with **no executor evidence bound to the attestation requirement**. The SEAL hard fence parks the uncovered leaf in `review`. An independent verifier reads the report and calls `attest_evidence` with a load-bearing related target entity ref plus the report in the attestation note. Only a valid PASS advances it to `done`, which then opens implementation dependencies.

The report must prove mission-123 completion, bug-297 registry-only resolution, exact published gitHeads/integrities, registry-seeded OIS/fleet uniformity, and independent successor verifier PASS. Mission status or a generic done node never substitutes.

### 4.2 `rail_gate`: byte-bound Director proof plus verifier attestation

Every variant also gives `rail_admission` verifier-attestation authority. The architect authors a separate report fresh-reading the post-Rev5 Decision and proof, then parks the gate in review with no executor evidence bound to the attestation requirement; the verifier independently reads the report and attests before the gate can complete.

The Decision must bind:

- selected option and complete node-set preview above;
- exact canonical design/variant git commit, path, blob id, and SHA-256;
- exact Hub `nodesRef` path, content SHA-256, and resourceVersion from independent dry-run;
- the `expectedContentSha256` required for live seed;
- positive host-traction evidence for V2/V3;
- no npm publication or unrelated execution authority.

Disposed `decision-26`, pre-byte answers, mutable prose, ambiguous custom answers, and mismatched hashes fail closed. Earlier execution nodes `work-314`–`work-317`, `work-334`–`work-337`, and `work-354`–`work-357` are historical correction/rejection lineage only; they are not current authority routes.

## 5. Pre-seed authority sequence

### 5.1 Immutable rejected lineage

`work-398 → work-399 → work-400 → work-401 → work-402`, `work-405 → work-406 → work-407 → work-408 → work-409`, and `work-412 → work-413 → work-414 → work-415 → work-416` are historical rejected/retired lineages only. `work-399`, `work-406`, and `work-413` preserve their CHANGES_REQUESTED verdicts; their downstream nodes cannot authorize these bytes. No item in any old chain is a current operational prerequisite.

### 5.2 Current operational sequence

1. Commit the complete corrected Rev 5 files on the immutable PR head (`work-418`).
2. An independent reviewer checks every byte, complete graph, authority string, and validator expectation on the exact PR head (`work-419`).
3. Protected-merge; bind canonical commit/blob/SHA-256, create new non-overwriting Hub copies, and obtain four expected-hash dry-run PASS receipts with exact Hub hash/resourceVersion (`work-420`).
4. Only then raise a fresh Decision whose options contain the complete previews in §3 and whose context binds those identities (`work-421`).
5. Steve independently checks Decision authority, git bytes, Hub copy equality, dry-run receipts, expected-hash mismatch rejection, verifier live denial, and zero creation (`work-422`).
6. A later mission may seed exactly one selected variant with the reviewed hash. Mission-123 itself seeds none.

`work-422` is the pre-created, structurally resolvable distinct verifier successor. Every exact variant names it; no variant names failed `work-363`. If `work-422` fails, these bytes become unseedable and require another distinct correction.

This sequence makes Decision authority postdate and bind the bytes. Decision-entity seed-time resolvability remains unavailable in the generic reference resolver; the combination of post-byte Decision proof, verifier-attested `rail_gate`, independent work-422, and expected-hash CAS is the fail-closed bridge. `idea-598` tracks native Decision entity-reference resolution.

## 6. Node/edge invariants

- `driver` is the sole arc driver and completion-gates every other node; it completes last.
- `artifact_gate` and `rail_gate` are root admission leaves.
- Every implementation path starts after both gates, directly or through an ancestor.
- `verifier_gate` has stable local id, type `verifier-gate`, and verifier-only eligibility.
- `closeout` depends on `verifier_gate`.
- V1 adds `pB2_selfheal` after drift alert/calibration and adds it to verifier/driver edges.
- V2 adds `pA_traction → pA_tool_actuator` and adds both to verifier/driver edges.
- V3 applies both deltas.
- Every node has one fixed evidence requirement kind; the two admission requirements additionally separate verifier authority.
- `skill_hotreload_probe` is a terminal binary probe, never a conditional watcher implementation.

## 7. Rev 4 FAIL closure matrix

| Rev 4 blocker | Rev 5 closure |
|---|---|
| B1 exact bytes inaccessible; verifier could not dry-run | Four full files are committed; commit/blob/SHA-256 reported; deployed policy permits verifier `dryRun=true`. |
| B2 mutable `nodesRef` / TOCTOU | Hub content hash/resourceVersion are recorded; live seed requires matching `expectedContentSha256`; mismatch creates zero. |
| B3 artifact admission was architect prose | `artifact_admission` is structurally `verifier-attestation`; executor evidence cannot satisfy it. |
| B4 Decision predates/does not bind bytes; V2/V3 previews omitted traction | Fresh Decision is raised only post-merge and binds exact identities; V2/V3 previews explicitly include `pA_traction` and `pA_tool_actuator`. |
| B5 Decision existence not seed-time resolvable | Post-byte Decision proof is independently checked in work-422 and structurally rechecked by verifier-attested `rail_gate`; exact expected-hash CAS binds seeded bytes. Native resolver support remains honestly tracked by idea-598. |
| B6 exact variants hard-coded failed `work-363` as required PASS | Every distinct Rev 5 execution contract names pre-created verifier successor `work-422`; the validator rejects `work-363`, `work-381`, and retired correction ids. A failed `work-422` makes these bytes unseedable rather than aliasing authority. |

## 8. Preserved non-claims

- Rev 3 and Rev 4 remain **FAIL / NOT SEED-APPROVED**.
- `decision-27`, `decision-28`, `work-363`, and `work-381` remain immutable history.
- `decision-26` remains disposed.
- No V0–V3 file is seeded by this corrective mission.
- No Claude uplift feature, watcher, ToolActuator, footer, schema policy, or dispatch behavior is implemented here.
- No local tarball, cache state, process presence, architect dry-run, or prose approval is production proof.
