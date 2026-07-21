# Exact frozen-tarball publication protocol

Use only for the post-TOCTOU successor release authorized by a Director proof that binds the complete manifest and this alias-free protocol source. This protocol does not itself grant authority.

## Invocation

The authorized executor is the `lily` architect seat. The manifest path and every artifact path must be absolute.

```bash
OIS_AGENT_NAME=lily OIS_HUB_ROLE=architect \
  node scripts/release/publish-exact-frozen-tgzs.mjs \
  /absolute/path/release-manifest.json
```

Verifier/producer rehearsal adds `--dry-run`. A partial-release continuation requires fresh authority and adds `--recover`; recovery is never automatic.

## Manifest

```json
{
  "protocolVersion": 3,
  "registry": "https://registry.npmjs.org/",
  "npmCliVersion": "11.6.2",
  "libnpmpublishVersion": "11.1.2",
  "executor": {
    "agentName": "lily",
    "role": "architect",
    "npmIdentity": "AUTHORIZED_NPM_IDENTITY"
  },
  "statePath": "/absolute/path/execution-state.json",
  "source": {
    "commit": "FULL_CANONICAL_COMMIT",
    "tree": "FULL_CANONICAL_TREE"
  },
  "artifacts": [
    {
      "name": "@apnex/cognitive-layer",
      "version": "0.1.4",
      "path": "/absolute/frozen/cognitive-layer-0.1.4.tgz",
      "sha256": "HEX",
      "integrity": "sha512-BASE64",
      "gitHead": "FULL_CANONICAL_COMMIT"
    },
    {
      "name": "@apnex/network-adapter",
      "version": "0.1.14",
      "path": "/absolute/frozen/network-adapter-0.1.14.tgz",
      "sha256": "HEX",
      "integrity": "sha512-BASE64",
      "gitHead": "FULL_CANONICAL_COMMIT"
    },
    {
      "name": "@apnex/claude-plugin",
      "version": "0.1.16",
      "path": "/absolute/frozen/claude-plugin-0.1.16.tgz",
      "sha256": "HEX",
      "integrity": "sha512-BASE64",
      "gitHead": "FULL_CANONICAL_COMMIT"
    }
  ]
}
```

The freeze node replaces every placeholder with immutable values and preserves the manifest beside the read-only tarballs. Protocol version 3 deliberately rejects prior manifests. The production manifest registry is exactly the normalized canonical endpoint `https://registry.npmjs.org/` (the protocol accepts `http://127.0.0.1:<port>/` only for disposable loopback falsifiers). The Director decision must bind the manifest bytes, registry, source commit/tree, all hashes/integrities/gitHeads, executor/npm identity, npm and bundled `libnpmpublish` versions, single frozen config snapshot, programmatic Buffer transport, fixed order, latest-tag movement, and partial-failure boundary.

Before dependency-order builds, verify the detached canonical source is clean and export `OIS_BUILD_SHA=<full 40-hex canonical commit>` and `OIS_BUILD_DIRTY=false` (plus the recorded branch). After packing, extract every shipped `package/dist/build-info.json` and require `commitSha` to equal that full canonical commit and `dirty` to be exactly `false`; separately require every packed `package.json.gitHead` to equal the same full commit. Freeze fails before producing authority evidence if any runtime package violates either predicate.

## Fail-closed sequence

1. Match runtime seat to `lily` / `architect`, npm CLI to the manifest, and npm's bundled `libnpmpublish` to the manifest. Normalize the manifest registry and require the production value `https://registry.npmjs.org/`.
2. Load npm configuration exactly once and freeze its flattened options. Its effective normalized registry must equal the manifest before any identity/vacancy call. The same immutable options drive `npm-registry-fetch` identity, `pacote` vacancy/recovery reads, OTP, and `libnpmpublish`; no later CLI/config reload may choose a mutation destination.
3. Open and re-hash **all** tarballs for the initial preflight; inspect each descriptor-derived packed `package.json` for exact name/version/full `gitHead` and internal dependency lineage, and packed `dist/build-info.json` for the full canonical commit plus `dirty:false`, before the first registry read.
4. Call `/-/whoami` with the frozen options; failure or identity mismatch stops. Probe all three exact versions through that same snapshot. Fresh mode requires vacancy.
5. Before the first mutation, open every pending manifest path once with `O_NOFOLLOW`; re-identify SHA-256, SHA-512, packed manifest, exact internal dependencies, and full `gitHead` from each held descriptor; copy every complete descriptor-derived byte sequence into a Buffer; retain all descriptors and Buffers.
6. Publish the Buffers in fixed order:
   1. cognitive-layer `0.1.4`
   2. network-adapter `0.1.14`
   3. Claude plugin `0.1.16`
7. Immediately before mutation, re-check the frozen and OTP-derived effective registry against the immutable manifest target. The only mutation operation is npm 11.6.2's own bundled API:

   ```js
   otplease(npm, options, opts =>
     libnpmpublish.publish(packedManifest, exactVerifiedTarballBuffer, opts))
   ```

   `options` is the one frozen npm configuration snapshot with `access: "public"`, `defaultTag: "latest"`, and the exact manifest registry. Immediately before each call, the protocol copies and re-hashes the already verified Buffer. No artifact pathname, symlink, `/proc/self/fd` locator, directory, workspace, repack, or child-process argv is supplied to the npm consumer. A swap before final open fails identity before mutation; a swap after final open cannot alter the in-memory bytes supplied to `libnpmpublish`. Replacing npm config from loopback R1 to R2 after launch either leaves the held R1 snapshot authoritative or fails before PUT; R2 must receive zero PUTs.
8. `--dry-run` performs the complete identity, vacancy, toolchain-load, Buffer-binding, order, and state checks but skips the registry PUT.
9. Stop on first failure and preserve the state JSON. Do not unpublish, deprecate, or move a dist-tag as rollback.
10. Recovery requires fresh authority. `--recover` accepts only an already-published **prefix** whose registry integrity and full `gitHead` exactly match the manifest, then continues at the first vacant step. Any mismatch or hole stops.

## Required committed timing regressions

The canonical suite must execute two distinct successful disposable-loopback publication cases, not infer one from the other:

1. **Post-vacancy config replacement:** load R1 once, complete R1 whoami and all three E404 vacancy reads, then atomically replace the active npmrc with R2 endpoint/credentials during R1's first PUT. Assert the ambient file now names R2 while all three exact Buffer PUTs, bearer auth, top-level state registry, and `npmConsumer.registry` remain R1; R2 must receive zero PUTs. Any post-vacancy ambient reload/retarget must fail this case.
2. **Artifact-path replacement:** independently replace the next artifact source pathname during a first PUT and prove the already-held Buffer remains the original verified bytes.

The test output and frozen log must contain two successful `published-complete` executions, and reports must name each case separately.

Read-only files and least-permissive parent directories remain defense in depth. Byte identity comes from final descriptor-derived Buffer verification and direct programmatic consumption. Corrective2's private suffix-bearing alias, bare descriptor paths, the legacy `scripts/publish-packages.sh`, `npm publish --workspace`, directory publication, pathname publication, and repacking are forbidden because they leave a mutable path boundary or do not preserve verifier-bound bytes.
