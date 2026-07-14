/**
 * lifecycle.test.ts — the load-bearing seam validation (idea-449 Phase A): the sim
 * drives the REAL WorkGraph FSM (create → claim → start → complete) through
 * `PolicyRouter.handle`, with seeded identity, and observes real phase transitions.
 * If this passes, the sim is exercising the production engine — not a re-impl.
 */
import { describe, it, expect } from "vitest";
import { SimHarness } from "../src/index.js";

/** pull the WorkItem out of a verb outcome (verbs wrap it as {workItem} or return it). */
function wi(data: unknown): Record<string, unknown> {
  const d = data as Record<string, unknown>;
  return (d?.workItem as Record<string, unknown>) ?? d;
}

describe("SimHarness — drives the REAL WorkGraph FSM via PolicyRouter.handle", () => {
  it("create → claim → start → complete over the real substrate", async () => {
    const h = new SimHarness();
    const arch = "sess-arch";
    const eng = "sess-eng";
    await h.seedAgent(arch, "architect", "arch-1");
    await h.seedAgent(eng, "engineer", "eng-1");

    const created = await h.handle(arch, "create_work", {
      type: "task",
      roleEligibility: ["engineer"],
      evidenceRequirements: [{ id: "commit", kind: "commit", description: "ship it" }],
    });
    expect(created.ok, `create_work: ${JSON.stringify(created.data)}`).toBe(true);
    const workId = wi(created.data).id as string;
    expect(workId).toBeTruthy();
    expect(wi(created.data).status).toBe("ready");

    const claimed = await h.handle(eng, "claim_work", { workId });
    expect(claimed.ok, `claim_work: ${JSON.stringify(claimed.data)}`).toBe(true);
    const leaseToken = (claimed.data as Record<string, unknown>).leaseToken as string;
    expect(leaseToken, "leaseToken hoisted to top level").toBeTruthy();
    expect(wi(claimed.data).status).toBe("claimed");

    const started = await h.handle(eng, "start_work", { workId, leaseToken });
    expect(started.ok, `start_work: ${JSON.stringify(started.data)}`).toBe(true);
    expect(wi(started.data).status).toBe("in_progress");

    const done = await h.handle(eng, "complete_work", {
      workId,
      leaseToken,
      evidence: [
        {
          requirementId: "commit",
          kind: "commit",
          ref: "abc123def456",
          producedAt: new Date().toISOString(),
        },
      ],
    });
    expect(done.ok, `complete_work: ${JSON.stringify(done.data)}`).toBe(true);
    expect(wi(done.data).status).toBe("done");
  });

  it("RBAC: an engineer cannot create_work ([Architect] gate)", async () => {
    const h = new SimHarness();
    await h.seedAgent("e", "engineer", "eng-2");
    const r = await h.handle("e", "create_work", { type: "task", roleEligibility: ["engineer"] });
    expect(r.ok).toBe(false); // denied by the role gate
  });
});
