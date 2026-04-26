#!/usr/bin/env npx tsx
/**
 * One-shot migration: convert existing `bug`-tagged Ideas to first-class
 * Bug entities (M-Cascade-Perfection Phase 2, ADR-015, closes idea-16).
 *
 * For each Idea tagged with `bug`:
 *   1. Extract title from the idea text's first bold heading / first line
 *   2. Infer severity from tags (severity-critical | severity-major | severity-minor).
 *      Default: "minor" (conservative; architect triages post-migration)
 *   3. Extract class hint from tags matching known root-cause taxonomy
 *      (drift | race | cognitive | identity-resolution | dedup |
 *       schema-validation-gap | missing-feature | ...)
 *   4. Create a Bug via create_bug with sourceIdeaId linkage
 *   5. Mark the source Idea with status=triaged + tag "migrated-to-bug-N"
 *
 * Idempotent: skips ideas with sourceIdeaId already linked to a Bug
 * (checked against list_bugs).
 *
 * Usage:
 *   npx tsx scripts/migrate-bug-ideas.ts           # dry-run (default)
 *   npx tsx scripts/migrate-bug-ideas.ts --apply   # execute migrations
 *
 * Credentials read from .ois/adapter-config.json (via scripts/lib/architect-client.ts).
 */

import { withArchitectClient } from "./lib/architect-client.js";

const DRY_RUN = !process.argv.includes("--apply");

const KNOWN_CLASSES = new Set([
  "drift",
  "race",
  "cognitive",
  "identity-resolution",
  "dedup",
  "schema-validation-gap",
  "missing-feature",
  "architect-amnesia",
]);

interface IdeaLike {
  id: string;
  text: string;
  tags: string[];
  status: string;
}

interface BugLike {
  id: string;
  sourceIdeaId: string | null;
}

function deriveTitle(text: string): string {
  const boldMatch = text.match(/\*\*(.+?)\*\*/);
  if (boldMatch) return boldMatch[1].slice(0, 100).trim();
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "(untitled)";
  return firstLine.slice(0, 100);
}

function deriveSeverity(tags: string[]): "critical" | "major" | "minor" {
  if (tags.includes("severity-critical")) return "critical";
  if (tags.includes("severity-major")) return "major";
  if (tags.includes("severity-minor")) return "minor";
  return "minor";
}

function deriveClass(tags: string[]): string | undefined {
  for (const t of tags) if (KNOWN_CLASSES.has(t)) return t;
  return undefined;
}

function deriveSurfacedBy(tags: string[]): string | undefined {
  const channels = ["itw-smoke", "unit-test", "prod-audit", "integration-test", "code-review", "llm-self-review", "post-itw"];
  for (const t of tags) if (channels.includes(t)) return t;
  return undefined;
}

/** Parse an MCP tool response into its JSON payload. */
function parseResult(result: any): any {
  if (!result) return null;
  if (result.content && Array.isArray(result.content) && result.content[0]?.text) {
    try { return JSON.parse(result.content[0].text); } catch { return result.content[0].text; }
  }
  return result;
}

async function main() {
  console.log(`migrate-bug-ideas.ts — ${DRY_RUN ? "DRY-RUN (pass --apply to execute)" : "APPLY MODE"}`);

  await withArchitectClient("migrate-bug-ideas", async (client) => {
    // 1. List bug-tagged Ideas
    const ideasResp = parseResult(await client.call("list_ideas", { tags: ["bug"], limit: 500 }));
    const ideas: IdeaLike[] = ideasResp?.ideas ?? [];
    console.log(`Found ${ideas.length} ideas tagged "bug".`);

    // 2. Existing Bugs — idempotency check
    const bugsResp = parseResult(await client.call("list_bugs", { limit: 500 }));
    const existingBugs: BugLike[] = bugsResp?.bugs ?? [];
    const alreadyMigrated = new Map<string, string>();
    for (const b of existingBugs) {
      if (b.sourceIdeaId) alreadyMigrated.set(b.sourceIdeaId, b.id);
    }
    console.log(`${alreadyMigrated.size} of ${existingBugs.length} existing Bug entities already linked to a source Idea.\n`);

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const idea of ideas) {
      if (alreadyMigrated.has(idea.id)) {
        console.log(`  [SKIP] ${idea.id} — already migrated to ${alreadyMigrated.get(idea.id)}`);
        skipped++;
        continue;
      }
      if (idea.status === "dismissed" || idea.status === "incorporated") {
        console.log(`  [SKIP] ${idea.id} — idea status=${idea.status}; not re-opening as a Bug`);
        skipped++;
        continue;
      }

      const title = deriveTitle(idea.text);
      const severity = deriveSeverity(idea.tags);
      const classHint = deriveClass(idea.tags);
      const surfacedBy = deriveSurfacedBy(idea.tags);
      const passthroughTags = idea.tags.filter((t) =>
        t !== "bug" &&
        t !== "bug-entity-candidate" &&
        t !== "migrate-to-bug-entity" &&
        !t.startsWith("severity-") &&
        !KNOWN_CLASSES.has(t),
      );

      console.log(`  [${DRY_RUN ? "DRY" : "APPLY"}] ${idea.id} → new Bug`);
      console.log(`    title    : ${title}`);
      console.log(`    severity : ${severity}`);
      console.log(`    class    : ${classHint ?? "(none)"}`);
      console.log(`    surface  : ${surfacedBy ?? "(none)"}`);
      console.log(`    tags     : [${passthroughTags.join(", ")}]`);

      if (DRY_RUN) {
        skipped++;
        continue;
      }

      try {
        const createResp = parseResult(await client.call("create_bug", {
          title,
          description: idea.text,
          severity,
          class: classHint,
          tags: passthroughTags,
          surfacedBy,
          sourceIdeaId: idea.id,
        }));
        const bugId = createResp?.bugId;
        console.log(`    → created ${bugId}`);

        const migrationTag = `migrated-to-${bugId}`;
        const newTags = Array.from(new Set([...idea.tags, migrationTag]));
        await client.call("update_idea", {
          ideaId: idea.id,
          status: "triaged",
          tags: newTags,
        });
        console.log(`    → idea ${idea.id} marked triaged + tagged "${migrationTag}"`);
        created++;
      } catch (err: any) {
        console.error(`    ✗ FAILED: ${err?.message ?? String(err)}`);
        failed++;
      }
    }

    console.log("\n─────────────────────────────────────────");
    console.log(`Summary (${DRY_RUN ? "DRY-RUN" : "APPLY"}): created=${created}, skipped=${skipped}, failed=${failed}, total ideas=${ideas.length}`);
    console.log("─────────────────────────────────────────");
  });
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
