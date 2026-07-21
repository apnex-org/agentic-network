# Exact frozen-tarball publication protocol

Use only for the post-TOCTOU successor release authorized by a Director proof that binds the complete manifest and held-inode protocol source. This protocol does not itself grant authority.

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
  "protocolVersion": 1,
  "npmCliVersion": "11.6.2",
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

The freeze node replaces every placeholder with immutable values and preserves the manifest beside the read-only tarballs. The Director decision must bind the manifest bytes, source commit/tree, all paths/hashes/integrities/gitHeads, executor/npm identity and CLI version, commands/order, latest-tag movement, and partial-failure boundary.

## Fail-closed sequence

1. Match runtime seat to `lily` / `architect` and npm CLI to the manifest.
2. Run `npm whoami`; failure or identity mismatch stops before registry mutation.
3. Open and re-hash **all** tarballs for the initial preflight; inspect each descriptor-derived packed `package.json` for exact name/version/full `gitHead` before the first registry probe.
4. Probe all three exact versions. Fresh mode requires vacancy.
5. Before the first publish, open every pending manifest path once with `O_NOFOLLOW`, re-identify SHA-256, SHA-512, packed manifest, exact internal dependencies, and full `gitHead` from each held descriptor, and retain all verified descriptors.
6. Publish in order from the inherited descriptor path only:
   1. cognitive-layer `0.1.4`
   2. network-adapter `0.1.14`
   3. Claude plugin `0.1.16`
7. The only mutation command is:

   ```bash
   npm publish /tmp/ois-held-inode-<random>/<ordinal>-<artifact>.tgz --access public --tag latest
   ```

   The protocol creates the suffix-bearing alias in a private mode-0700 directory, targets it at `/proc/self/fd/3`, and maps the already-verified artifact descriptor to child fd 3 for each npm invocation. (Bare `/proc/self/fd/3` is not a valid npm tarball spec because npm classifies the suffixless path as a directory.) npm therefore consumes the held inode, not the replaceable manifest pathname. A pathname swap before the final opens fails identification before any publish; a swap after final open cannot redirect the bytes npm reads. The private alias target is re-checked immediately before spawn and the directory is removed at exit.
8. Stop on first failure and preserve the state JSON. Do not unpublish, deprecate, or move a dist-tag as rollback.
9. Recovery requires fresh authority. `--recover` accepts only an already-published **prefix** whose registry integrity and full `gitHead` exactly match the manifest, then continues at the first vacant step. Any mismatch or hole stops.

Linux `/proc/self/fd` semantics are a fail-closed runtime requirement. Read-only files and a least-permissive parent directory remain defense in depth; byte identity comes from final descriptor-bound verification and use. The legacy `scripts/publish-packages.sh`, `npm publish --workspace`, directory publication, pathname publication, and repacking are forbidden because they do not preserve verifier-bound bytes.
