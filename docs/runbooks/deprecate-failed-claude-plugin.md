# Deprecate a failed `@apnex/claude-plugin@0.1.18`

This is a **negative-only contingency**, not a publication or rollout path. Use it only after `0.1.18` has been published and independent public qualification has failed under the separately admitted Decision/WorkGraph packet.

## Protected operation

Run the GitHub Actions workflow **deprecate-claude-plugin**. It is manual-dispatch-only, uses the protected `npm-production` environment and accepts exactly:

- package: `@apnex/claude-plugin`
- version: `0.1.18`
- confirmation: `DEPRECATE_FAILED_QUALIFICATION:@apnex/claude-plugin@0.1.18`

The workflow rejects every other package, version or confirmation before an npm command. It then:

1. proves the exact public version exists;
2. executes one `npm deprecate` with `Failed post-publication qualification; do not install or reuse this version.`;
3. reads the public registry again until that exact deprecation message is observed.

The workflow has `contents: read`, receives `NPM_TOKEN` only from `npm-production`, and contains no publish, unpublish, dist-tag, overwrite, tag, install, deployment or fleet operation. Never reuse or overwrite `0.1.18` after failure.

A workflow source PASS does not itself authorize execution. Bind the reviewed exact source head and Director-grade Decision proof in the publication graph before any registry mutation.
