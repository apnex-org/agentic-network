import assert from "node:assert/strict";

export const CLAUDE_RELEASE_VERSION = "0.1.20";
export const CLAUDE_RELEASE_PACKAGE = "@apnex/claude-plugin";
export const CLAUDE_RELEASE_TAG = `claude-plugin-v${CLAUDE_RELEASE_VERSION}`;
export const CLAUDE_PROVENANCE_REPOSITORY = "https://github.com/apnex-org/agentic-network";

const irreversiblePublish = "npm publish --workspace=@apnex/claude-plugin --access public --provenance --ignore-scripts";

function requireBefore(workflow, needle, boundary, description = needle) {
  const index = workflow.indexOf(needle);
  assert.notEqual(index, -1, `publication workflow missing ${description}`);
  assert.ok(index < boundary, `${description} must fail before irreversible publish`);
}

/**
 * Static admission policy for the one-attempt Claude publication workflow.
 * Registry reacquisition belongs to a separate read-only WorkGraph gate. The
 * irreversible publish command is therefore the final command in this job.
 */
export function validateClaudePublicationBoundary(workflow) {
  assert.equal(typeof workflow, "string", "publication workflow must be text");
  const publishIndex = workflow.lastIndexOf(irreversiblePublish);
  assert.notEqual(publishIndex, -1, "publication workflow missing irreversible publish command");
  const afterPublish = workflow.slice(publishIndex + irreversiblePublish.length);
  assert.equal(afterPublish.trim(), "", "nothing may run after irreversible publish; registry qualification is a separate WorkGraph gate");

  requireBefore(workflow, "- 'claude-plugin-v*'", publishIndex, "tag trigger");
  requireBefore(workflow, `test "$version" = "${CLAUDE_RELEASE_VERSION}"`, publishIndex, "exact package version guard");
  requireBefore(workflow, 'test "${GITHUB_REF#refs/tags/}" = "claude-plugin-v$version"', publishIndex, "exact tag/version guard");
  requireBefore(workflow, "test -z \"$(git status --porcelain)\"", publishIndex, "clean-source guard");
  requireBefore(workflow, "OIS_BUILD_SHA=$(git rev-parse HEAD)", publishIndex, "full source commit binding");
  requireBefore(workflow, "OIS_BUILD_TREE=$(git rev-parse HEAD^{tree})", publishIndex, "source tree binding");
  requireBefore(workflow, "OIS_BUILD_DIRTY=false", publishIndex, "clean build identity");
  requireBefore(workflow, "verify-claude-plugin-package.mjs integrity", publishIndex, "frozen-byte integrity check");
  requireBefore(workflow, `inspect /tmp/claude-realized/node_modules/@apnex/claude-plugin "$CLAUDE_VERSION"`, publishIndex, "realized package inspection");
  requireBefore(workflow, `test "$(jq -r '.provenanceRepository' /tmp/claude-projection.json)" = "${CLAUDE_PROVENANCE_REPOSITORY}"`, publishIndex, "packed provenance repository guard");
  requireBefore(workflow, `npm view "${CLAUDE_RELEASE_PACKAGE}@$CLAUDE_VERSION" version`, publishIndex, "fresh-version guard");
  requireBefore(workflow, "environment: npm-production", publishIndex, "protected npm environment");

  assert.equal((workflow.match(/npm publish --workspace=@apnex\/claude-plugin/g) ?? []).length, 2,
    "workflow must contain exactly one dry-run and one irreversible publish command");
  assert.ok(workflow.includes(`${irreversiblePublish} --dry-run`), "workflow_dispatch must stop at the dry-run boundary");
  return true;
}
