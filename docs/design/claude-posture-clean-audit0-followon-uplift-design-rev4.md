# Claude follow-on uplift design — Revision 4

**WorkItem:** `work-314`  
**Status:** design and finite blueprints only; no uplift implementation or seed  
**Supersedes for future consideration:** Rev 3, while preserving its immutable **FAIL / NOT SEED-APPROVED** verdict  
**Authority boundary:** disposed `decision-26` is historical only. A fresh Decision may be raised only after canonical Rev 4 bytes exist.

## 1. Purpose and inherited mechanism

Rev 4 preserves Rev 3's useful mechanism split without reviving its authority:

- **E:** additive/lazily enforced Hub schema evolution;
- **D:** dispatch-time declared-safe tolerance and precise failure otherwise;
- **C-minimal:** session-init-anchored harmful-drift alert;
- **B:** upstream `tools/list_changed` host tracking;
- read-only footer and bounded provenance/durability work.

The feature work is explicitly outside `mission-123`. These files describe a later finite WorkGraph only. Validation, review, Decision resolution, or seedability does not implement or prove the uplift.

## 2. Immutable artifacts

Rev 4 consists of this design and four complete static JSON files:

- `docs/blueprints/claudeuplift0-rev4-v0.json`
- `docs/blueprints/claudeuplift0-rev4-v1.json`
- `docs/blueprints/claudeuplift0-rev4-v2.json`
- `docs/blueprints/claudeuplift0-rev4-v3.json`

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

### V0 / option `rev4-minimal` — 18 nodes

`{driver, artifact_gate, rail_gate, drift_fixture, schema_policy, dispatch_tolerance, drift_alert, bug203_track, footer, frequency_calibration, estate_provenance, na_pin, specstore, skill_hotreload_probe, opencode_cleanup, citation_resolver, verifier_gate, closeout}`

Optional set: `{}`. Omits `{pB2-selfheal, pA-traction, pA-tool-actuator}`.

### V1 / option `rev4-selfheal` — 19 nodes

V0 plus `{pB2-selfheal}`. Omits `{pA-traction, pA-tool-actuator}`.

### V2 / option `rev4-actuator` — 20 nodes

V0 plus **both** `{pA-traction, pA-tool-actuator}`. Omits `{pB2-selfheal}`.

The Director preview must show both names. ToolActuator is not offered as a standalone cure. V2 is legal only if the Decision also binds pre-existing positive current-host traction evidence; a negative `pA-traction` result blocks the actuator and requires a new design/Decision.

### V3 / option `rev4-full` — 21 nodes

V0 plus all three `{pB2-selfheal, pA-traction, pA-tool-actuator}`. Omits nothing.

The Director preview must show all three names, including `pA-traction`.

A custom answer must identify exactly one V0–V3 file identity. Any changed node set requires new committed bytes, review, dry-run, and Decision.

## 4. Structural admission gates

### 4.1 `artifact_gate`: verifier authority, not architect prose

Every variant carries requirement `artifact_admission` with:

- `kind=doc`;
- `evidenceAuthority=verifier-attestation`;
- `refResolvable` deliberately omitted because SEAL verifier-attestation requirements reject executor-resolution authority mixing.

The architect may claim the gate, submit the exact corrective admission report as candidate evidence, and call `complete_work`; executor evidence cannot satisfy the requirement, so the leaf parks in `review`. An independent verifier must call `attest_evidence` with a load-bearing related ref. Only a valid PASS attestation advances it to `done`, which then opens implementation dependencies.

The report must prove mission-123 completion, bug-297 registry-only resolution, exact published gitHeads/integrities, registry-seeded OIS/fleet uniformity, and independent successor verifier PASS. Mission status or a generic done node never substitutes.

### 4.2 `rail_gate`: byte-bound Director proof plus verifier attestation

Every variant also gives `rail_admission` verifier-attestation authority. The architect submits a report fresh-reading the post-Rev4 Decision and proof; the verifier independently attests it before the gate can complete.

The Decision must bind:

- selected option and complete node-set preview above;
- exact canonical design/variant git commit, path, blob id, and SHA-256;
- exact Hub `nodesRef` path, content SHA-256, and resourceVersion from independent dry-run;
- the `expectedContentSha256` required for live seed;
- positive host-traction evidence for V2/V3;
- no npm publication or unrelated execution authority.

Disposed `decision-26`, pre-byte answers, mutable prose, ambiguous custom answers, and mismatched hashes fail closed.

## 5. Pre-seed authority sequence

1. Commit complete Rev 4 files and open immutable review PR (`work-314`).
2. Independent reviewer checks every byte and complete graph (`work-315`).
3. Protected-merge; bind canonical commit/blob/SHA-256; create exact Hub copies; perform dry-runs.
4. Only then raise a fresh Decision whose options contain the complete previews in §3 and whose context binds those identities (`work-316`).
5. Steve independently checks Decision authority, git bytes, Hub copy equality, dry-run receipts, expected-hash mismatch rejection, verifier live denial, and zero creation (`work-317`).
6. A later mission may seed exactly one selected variant with the reviewed hash. Mission-123 itself seeds none.

This sequence makes Decision authority postdate and bind the bytes. Decision-entity seed-time resolvability remains unavailable in the generic reference resolver; the combination of post-byte Decision proof, verifier-attested `rail_gate`, independent work-317, and expected-hash CAS is the fail-closed bridge. `idea-598` tracks native Decision entity-reference resolution.

## 6. Node/edge invariants

- `driver` is the sole arc driver and completion-gates every other node; it completes last.
- `artifact_gate` and `rail_gate` are root admission leaves.
- Every implementation path starts after both gates, directly or through an ancestor.
- `verifier_gate` has stable local id, type `verifier-gate`, and verifier-only eligibility.
- `closeout` depends on `verifier_gate`.
- V1 adds `pB2-selfheal` after drift alert/calibration and adds it to verifier/driver edges.
- V2 adds `pA-traction → pA-tool-actuator` and adds both to verifier/driver edges.
- V3 applies both deltas.
- Every node has one fixed evidence requirement kind; the two admission requirements additionally separate verifier authority.
- `skill_hotreload_probe` is a terminal binary probe, never a conditional watcher implementation.

## 7. Rev 3 FAIL closure matrix

| Rev 3 blocker | Rev 4 closure |
|---|---|
| B1 exact bytes inaccessible; verifier could not dry-run | Four full files are committed; commit/blob/SHA-256 reported; deployed policy permits verifier `dryRun=true`. |
| B2 mutable `nodesRef` / TOCTOU | Hub content hash/resourceVersion are recorded; live seed requires matching `expectedContentSha256`; mismatch creates zero. |
| B3 artifact admission was architect prose | `artifact_admission` is structurally `verifier-attestation`; executor evidence cannot satisfy it. |
| B4 Decision predates/does not bind bytes; V2/V3 previews omitted traction | Fresh Decision is raised only post-merge and binds exact identities; V2/V3 previews explicitly include `pA-traction` and `pA-tool-actuator`. |
| B5 Decision existence not seed-time resolvable | Post-byte Decision proof is independently checked in work-317 and structurally rechecked by verifier-attested `rail_gate`; exact expected-hash CAS binds seeded bytes. Native resolver support remains honestly tracked by idea-598. |

## 8. Preserved non-claims

- Rev 3 remains **FAIL / NOT SEED-APPROVED**.
- `decision-26` remains disposed.
- No V0–V3 file is seeded by this corrective mission.
- No Claude uplift feature, watcher, ToolActuator, footer, schema policy, or dispatch behavior is implemented here.
- No local tarball, cache state, process presence, architect dry-run, or prose approval is production proof.
