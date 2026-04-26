#!/usr/bin/env npx tsx
/**
 * Admin: drain pending notifications from stale engineerIds into a
 * target engineerId. For the M18 "laptop died, new globalInstanceId"
 * recovery path — Agents are append-only, so the old engineerId stays
 * but its queue must be migrated to the replacement Agent.
 *
 * Registers an ephemeral architect session via `withArchitectClient` and
 * invokes migrate_agent_queue once per source. Reads hub credentials
 * from .ois/adapter-config.json or OIS_HUB_URL / OIS_HUB_TOKEN env vars.
 *
 * Usage:
 *   npx tsx scripts/migrate-agent-queue.ts <target> <source1> [source2 ...]
 */

import { withArchitectClient } from "./lib/architect-client.js";

const [, , target, ...sources] = process.argv;
if (!target || sources.length === 0) {
  console.error("Usage: migrate-agent-queue.ts <target> <source1> [source2 ...]");
  process.exit(1);
}

async function main(): Promise<void> {
  await withArchitectClient("admin-migrate", async (client) => {
    for (const source of sources) {
      try {
        const result = await client.call("migrate_agent_queue", {
          sourceEngineerId: source,
          targetEngineerId: target,
        });
        console.log(`${source} → ${target}:`, typeof result === "string" ? result : JSON.stringify(result));
      } catch (err) {
        console.error(`${source} failed:`, err instanceof Error ? err.message : err);
      }
    }
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
