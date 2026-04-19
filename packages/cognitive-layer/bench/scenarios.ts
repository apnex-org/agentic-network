/**
 * Benchmark scenarios — canonical workloads modeled on M-Ideas-Audit
 * patterns. Each runs against a real `McpAgentClient` with a real
 * loopback `PolicyLoopbackHub`. The harness runs each scenario twice
 * (with and without the cognitive pipeline) and compares.
 *
 * Scenario design goals:
 *   - Exercise the patterns that blew up during M-Ideas-Audit
 *   - Be deterministic (no wall-clock races)
 *   - Be representative: realistic read:write mix, realistic arg sizes
 */

import { randomUUID } from "node:crypto";
import type { McpAgentClient } from "../../network-adapter/src/mcp-agent-client.js";

export interface ScenarioContext {
  eng: McpAgentClient;
  arch: McpAgentClient;
  engEngineerId: string;
  archEngineerId: string;
}

export interface Scenario {
  name: string;
  description: string;
  run(ctx: ScenarioContext): Promise<void>;
}

// Seed the hub with some ideas for the audit-workflow scenario to read.
export async function seedIdeas(eng: McpAgentClient, count = 20): Promise<void> {
  for (let i = 0; i < count; i++) {
    try {
      await eng.call("create_idea", {
        text: `bench-idea-${i}: ${"lorem ipsum ".repeat(8)}`,
        tags: ["bench", `group-${i % 4}`],
      });
    } catch {
      /* ignore seed failures */
    }
  }
}

/**
 * Scenario 1 — Audit workflow read-heavy pattern.
 *
 * Pattern observed during M-Ideas-Audit: list_ideas, then for each
 * idea, get_idea (implicit, here simulated), then update_idea. Plus
 * repeated list_tele + list_available_peers interspersed.
 *
 * Cognitive benefit expected: heavy cache hits on list_tele /
 * list_available_peers (called many times per turn but state doesn't
 * change within the turn).
 */
export const auditWorkflowScenario: Scenario = {
  name: "audit-workflow",
  description: "Read-heavy audit pass — list + get + update across 10 ideas with interspersed read-of-read",
  async run({ eng }) {
    for (let pass = 0; pass < 3; pass++) {
      // List ideas (often redundant in a single turn — cache candidate)
      await eng.call("list_ideas", { limit: 10 }).catch(() => null);
      await eng.call("list_tele", {}).catch(() => null);
      await eng.call("list_available_peers", { role: "architect" }).catch(() => null);

      // Simulate per-idea fetches (cache should catch re-reads in subsequent passes)
      for (let i = 0; i < 5; i++) {
        await eng.call("list_ideas", { limit: 5, offset: i }).catch(() => null);
      }
    }
  },
};

/**
 * Scenario 2 — Duplicate write storm (the cognitive-retry pattern).
 *
 * Pattern: an LLM re-emits the same write tool call within seconds
 * after a transient error. Pre-Phase-1 → double-write + double-cascade.
 * With WriteCallDedup: exactly one Hub write.
 */
export const duplicateWriteStormScenario: Scenario = {
  name: "duplicate-write-storm",
  description: "5 identical create_idea calls fired concurrently — dedup should collapse to 1",
  async run({ eng }) {
    const args = { text: `dup-storm-${randomUUID()}`, tags: ["bench", "dup"] };
    const promises = Array.from({ length: 5 }, () =>
      eng.call("create_idea", args).catch(() => null),
    );
    await Promise.all(promises);
  },
};

/**
 * Scenario 3 — Read cache saturation.
 *
 * Pattern: LLM re-fetches the same thread / tele / ideas multiple times
 * within a turn (observed during M-Ideas-Audit convergences — architect
 * re-read thread state 5+ times per convergence).
 */
export const readCacheScenario: Scenario = {
  name: "read-cache",
  description: "20 identical list_ideas calls — cache should serve 19 from memory",
  async run({ eng }) {
    for (let i = 0; i < 20; i++) {
      await eng.call("list_ideas", { limit: 3 }).catch(() => null);
    }
  },
};

/**
 * Scenario 4 — Thread convergence workflow.
 *
 * Opens a thread, replies several times, converges with stagedActions.
 * Represents the "real work" the agent does — many tool calls across
 * multiple entities. Measures cumulative token throughput + per-tool
 * mix.
 */
export const threadConvergenceScenario: Scenario = {
  name: "thread-convergence",
  description: "Full thread open → 3 replies → convergence with stagedAction",
  async run({ eng, arch, engEngineerId }) {
    const openRaw = await arch.call("create_thread", {
      title: "bench convergence",
      message: "benchmark scenario",
      routingMode: "unicast",
      recipientAgentId: engEngineerId,
    }).catch(() => null);

    const threadId = extractId(openRaw, "threadId");
    if (!threadId) return;

    // Engineer reads thread state (would cache)
    await eng.call("get_thread", { threadId }).catch(() => null);
    await eng.call("get_thread", { threadId }).catch(() => null); // cache hit

    // Reply round 1
    await eng.call("create_thread_reply", {
      threadId,
      message: "round 1",
    }).catch(() => null);

    // Architect replies
    await arch.call("create_thread_reply", {
      threadId,
      message: "arch round 2",
    }).catch(() => null);

    // Engineer converges
    await eng.call("create_thread_reply", {
      threadId,
      message: "converging",
      converged: true,
      summary: "benchmark complete",
      stagedActions: [
        { kind: "stage", type: "close_no_action", payload: { reason: "bench" } },
      ],
    }).catch(() => null);
  },
};

/**
 * Scenario 5 — Schema-drift error path.
 *
 * Pattern: LLM calls update_idea with the wrong (flat) shape.
 * Without ErrorNormalizer: raw Zod error. With ErrorNormalizer: rewrite
 * hint (visible in errorMessage).
 */
export const schemaDriftScenario: Scenario = {
  name: "schema-drift",
  description: "Hit update_idea with flat shape (expected to error) — ErrorNormalizer rewrites",
  async run({ eng }) {
    // Seed first
    const created = await eng.call("create_idea", { text: "drift-bench" }).catch(() => null);
    const ideaId = extractId(created, "ideaId");
    if (!ideaId) return;

    // Intentionally wrong shape — flat instead of wrapped
    for (let i = 0; i < 3; i++) {
      await eng.call("update_idea", {
        ideaId,
        tags: [`drift-${i}`],
        status: "triaged",
      }).catch(() => null);
    }
  },
};

/**
 * Scenario 6 — Oversized read surface (Phase 2a ResponseSummarizer target).
 *
 * Pattern: LLM asks list_ideas without a limit (common — the M-Ideas-Audit
 * prompts did exactly this). Hub returns 50+ items; pre-Phase-2a this
 * flooded the context with redundant payload. With ResponseSummarizer:
 * the LLM sees first 10 + a pagination hint + the next-offset cursor.
 *
 * Designed so each list_ideas result exceeds BOTH heuristics:
 *   - top-level array length > maxItems (50 > 10), AND
 *   - serialized bytes > maxBytes (50 items × ~150 bytes > 2000)
 *
 * Cognitive benefit expected: large virtualTokensSaved surface per call,
 * driving the Phase 2a primary KPI.
 */
export const oversizedReadSurfaceScenario: Scenario = {
  name: "oversized-read-surface",
  description: "3 list_ideas calls without limit (returns 50+ items each) — summarizer target",
  async run({ eng }) {
    for (let i = 0; i < 3; i++) {
      await eng.call("list_ideas", {}).catch(() => null);
    }
  },
};

export const ALL_SCENARIOS: Scenario[] = [
  auditWorkflowScenario,
  duplicateWriteStormScenario,
  readCacheScenario,
  threadConvergenceScenario,
  schemaDriftScenario,
  oversizedReadSurfaceScenario,
];

function extractId(raw: unknown, key: string): string | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed[key] === "string" ? parsed[key] : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && raw !== null) {
    const v = (raw as Record<string, unknown>)[key];
    return typeof v === "string" ? v : null;
  }
  return null;
}
