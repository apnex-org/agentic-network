import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";

/** Mission-140 mechanical inventory: adding a public WorkItem writer/read projection
 * without updating this table is a red test, not a prose-review dependency. */
const WRITERS = [
  // idea-640 hotfix: the system-projection seam is a PUBLIC WRITER and is held to the same
  // fence standard as every other one — it is exempt from the live-row TIER refusal, nothing else.
  "appendSystemProjectionEdge",
  "createWorkItem", "updateWorkItem", "createBlueprintNode", "deleteWorkItem",
  "claimWorkItem", "startWork", "blockWork", "resumeWork", "systemUnblock",
  "renewLease", "releaseWork", "abandonWork", "pauseWork", "unpauseWork",
  "expireLease", "completeWork", "attestEvidence", "markFailedSealNoticeProjected",
] as const;

const CURRENT_READS = [
  "getCompletionProgress", "getStintProjection", "getNextAction", "getLegalMoves",
  "listWorkItems", "listPrReviewBindingWorkItems", "listWorkItemsByProjectionKey",
  "listPendingFailedSealNoticeItems", "listReadyForRole", "listExpiredLeaseItems",
  "verifyAttestation",
] as const;

const HISTORICAL_READ_EXCEPTIONS = ["getWorkItem", "entityExists"] as const;

function methodSlice(source: string, name: string): string {
  const start = source.indexOf(`  async ${name}(`);
  expect(start, `${name} implementation exists`).toBeGreaterThanOrEqual(0);
  const candidates = [source.indexOf("\n  async ", start + 3), source.indexOf("\n  private async ", start + 3)]
    .filter((n) => n >= 0);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

describe("Mission-140 WorkGraph currentness integration inventory", () => {
  const source = readFileSync(join(__dirname, "..", "work-item-repository-substrate.ts"), "utf8");

  it("every declared public writer exists and enters the writer/CAS fence", () => {
    const proto = WorkItemRepositorySubstrate.prototype as unknown as Record<string, unknown>;
    for (const name of WRITERS) {
      expect(typeof proto[name], `${name} is a public method`).toBe("function");
      const body = methodSlice(source, name);
      expect(body, `${name} enters withWriterFence or the fenced CAS seam`)
        .toMatch(/withWriterFence|tryCasUpdate/);
    }
  });

  it("every declared current projection exists and pins one topology generation", () => {
    const proto = WorkItemRepositorySubstrate.prototype as unknown as Record<string, unknown>;
    for (const name of CURRENT_READS) {
      expect(typeof proto[name], `${name} is a public method`).toBe("function");
      const body = methodSlice(source, name);
      expect(body, `${name} pins or consumes the ambient immutable pin`)
        .toMatch(/withReadPin|currentness\.currentPin|getCurrentProjectionItem|listWorkItems/);
    }
  });

  it("the exact-read exceptions stay explicit and do not follow logical identity", () => {
    expect(HISTORICAL_READ_EXCEPTIONS).toEqual(["getWorkItem", "entityExists"]);
    expect(methodSlice(source, "getWorkItem")).not.toMatch(/withReadPin|assertCurrent/);
    expect(methodSlice(source, "entityExists")).not.toMatch(/withReadPin|assertCurrent/);
  });

  it("cross-cutting integrations route through the inventory-owned seam", () => {
    const root = join(__dirname, "..", "..");
    const files: Array<[string, RegExp]> = [
      ["policy/work-item-lease-sweeper.ts", /withTopologyReadPin/],
      ["policy/pulse-sweeper.ts", /withTopologyReadPin/],
      ["policy/driver-liveness-watchdog.ts", /withTopologyReadPin/],
      ["policy/work-item-events.ts", /listWorkItems\(/],
      ["policy/repo-event-pr-review-requested-handler.ts", /listPrReviewBindingWorkItems/],
      ["entities/decision-executor.ts", /systemUnblock/],
      ["entities/work-item-repository-substrate.ts", /completeWork[\s\S]*attestEvidence[\s\S]*verifyAttestation/],
    ];
    for (const [relative, pattern] of files) {
      expect(readFileSync(join(root, relative), "utf8"), relative).toMatch(pattern);
    }
  });
});
