import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const policyDir = fileURLToPath(new URL("..", import.meta.url));

function readPolicyFile(fileName: string): string {
  return readFileSync(join(policyDir, fileName), "utf8");
}

describe("external identity direct-agent routing architecture guard", () => {
  it("GitHub PR direct-agent route uses explicit cardinality state, not nullable first-match wrappers", () => {
    const source = readPolicyFile("repo-event-pr-merged-handler.ts");

    expect(source).toContain("resolveGhLoginAgent");
    expect(source).toMatch(/resolution\.status\s*!==\s*["']unique["']/);
    expect(source).toMatch(/target:\s*\{\s*agentId:\s*author\.id\s*\}/);
    expect(source).not.toMatch(/lookupUniqueAgentByGhLogin|lookupAgentByGhLogin\b/);
  });

  it("first-match GitHub-login identity helper is not exported or imported outside its legacy role-only module", () => {
    const authorLookup = readPolicyFile("repo-event-author-lookup.ts");
    expect(authorLookup).not.toMatch(/export\s+(?:async\s+)?function\s+lookupAgentByGhLogin\b/);
    expect(authorLookup).toMatch(/NOT valid for direct [` ]?agentId[` ]?/);

    const offenders = readdirSync(policyDir)
      .filter((fileName) => fileName.endsWith(".ts") && fileName !== "repo-event-author-lookup.ts")
      .filter((fileName) => /\blookupAgentByGhLogin\b/.test(readPolicyFile(fileName)));

    expect(offenders).toEqual([]);
  });
});
