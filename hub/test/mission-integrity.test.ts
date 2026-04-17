/**
 * Mission-entity integrity — task-223 regression pin.
 *
 * Origin: M19 prod run auto-linked 7 tasks into a single mission in ~3
 * seconds; task-196 silently disappeared from mission.tasks. Root cause was
 * a naked read-modify-write in `GcsMissionStore.linkTask` (and sibling
 * `linkIdea`) — concurrent appenders each wrote their own stale snapshot
 * back over each other's.
 *
 * Fix (Option B): mission.tasks / mission.ideas became a virtual view
 * computed on every read from the task store (by `correlationId`) and idea
 * store (by `missionId`). No stored array, no race surface.
 *
 * This pin drives N concurrent `create_task` and `update_idea` calls
 * through the real PolicyRouter and asserts every entity ID lands on the
 * mission view. The invariant — "mission linkage survives concurrent
 * auto-linkage" — is durable regardless of implementation. If a future
 * change reintroduces a stored-array shape, this test guards the
 * user-visible contract.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../src/policy/router.js";
import { registerTaskPolicy } from "../src/policy/task-policy.js";
import { registerIdeaPolicy } from "../src/policy/idea-policy.js";
import { registerMissionPolicy } from "../src/policy/mission-policy.js";
import { registerSessionPolicy } from "../src/policy/session-policy.js";
import { createTestContext, type TestPolicyContext } from "../src/policy/test-utils.js";

const noop = () => {};

function buildRouter(): PolicyRouter {
  const router = new PolicyRouter(noop);
  registerTaskPolicy(router);
  registerIdeaPolicy(router);
  registerMissionPolicy(router);
  registerSessionPolicy(router);
  return router;
}

describe("Mission-entity integrity (task-223)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;

  beforeEach(() => {
    router = buildRouter();
    ctx = createTestContext({ sessionId: "sess-arch-integrity", role: "architect" });
  });

  it("concurrent create_task with correlationId=missionId — every taskId lands in mission.tasks", async () => {
    const created = await router.handle("create_mission", {
      title: "Concurrent arc",
      description: "N tasks at once",
    }, ctx);
    const { missionId } = JSON.parse(created.content[0].text);

    const N = 7; // matches the M19 cohort size (tasks 191–197).
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        router.handle("create_task", {
          title: `T${i}`,
          description: `Do ${i}`,
          correlationId: missionId,
        }, ctx),
      ),
    );

    const taskIds = results.map((r) => JSON.parse(r.content[0].text).taskId as string);
    expect(new Set(taskIds).size).toBe(N);

    const mission = await ctx.stores.mission.getMission(missionId);
    expect(mission).not.toBeNull();
    const linked = new Set(mission!.tasks);
    const missing = taskIds.filter((id) => !linked.has(id));
    expect(missing, `mission.tasks dropped ${missing.length}/${N} task IDs`).toEqual([]);
  });

  it("concurrent update_idea incorporations — every ideaId lands in mission.ideas", async () => {
    const mRes = await router.handle("create_mission", {
      title: "Idea arc",
      description: "Incorporate N ideas",
    }, ctx);
    const { missionId } = JSON.parse(mRes.content[0].text);

    const N = 7;
    const ideaIds: string[] = [];
    for (let i = 0; i < N; i++) {
      const r = await router.handle("create_idea", { text: `Idea ${i}` }, ctx);
      ideaIds.push(JSON.parse(r.content[0].text).ideaId as string);
    }

    await Promise.all(
      ideaIds.map((ideaId) =>
        router.handle("update_idea", {
          ideaId,
          missionId,
          status: "incorporated",
        }, ctx),
      ),
    );

    const mission = await ctx.stores.mission.getMission(missionId);
    expect(mission).not.toBeNull();
    const linked = new Set(mission!.ideas);
    const missing = ideaIds.filter((id) => !linked.has(id));
    expect(missing, `mission.ideas dropped ${missing.length}/${N} idea IDs`).toEqual([]);
  });
});
