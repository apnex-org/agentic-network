# Exact frozen-tarball publication protocol

Use only for the `claude_clean_artifact_corrective1` successor release authorized by a Director proof that binds the complete manifest. This protocol does not itself grant authority.

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
3. Re-hash **all** tarballs and inspect each packed `package.json` for exact name/version/full `gitHead` before the first registry probe.
4. Probe all three exact versions. Fresh mode requires vacancy.
5. Publish the absolute frozen `.tgz` paths only, in order:
   1. cognitive-layer `0.1.4`
   2. network-adapter `0.1.14`
   3. Claude plugin `0.1.16`
6. The only mutation command is:

   ```bash
   npm publish <absolute-frozen-tgz> --access public --tag latest
   ```

7. Stop on first failure and preserve the state JSON. Do not unpublish, deprecate, or move a dist-tag as rollback.
8. Recovery requires fresh authority. `--recover` accepts only an already-published **prefix** whose registry integrity and full `gitHead` exactly match the manifest, then continues at the first vacant step. Any mismatch or hole stops.

The legacy `scripts/publish-packages.sh`, `npm publish --workspace`, directory publication, and repacking are forbidden for this release because they do not preserve verifier-bound bytes.
