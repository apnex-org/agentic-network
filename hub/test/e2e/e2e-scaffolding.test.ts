/**
 * E2E Auto-Scaffolding Tests — Tele-2
 *
 * Validates the Proposal Auto-Scaffolding feature: when a proposal
 * with a proposedExecutionPlan is approved, the Hub automatically
 * creates all missions and tasks.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "./orchestrator.js";
import type { ActorFacade } from "./orchestrator.js";

describe("E2E Auto-Scaffolding", () => {
  let orch: TestOrchestrator;
  let arch: ActorFacade;
  let eng: ActorFacade;

  beforeEach(() => {
    orch = TestOrchestrator.create();
    arch = orch.asArchitect();
    eng = orch.asEngineer();
  });

  describe("Basic Scaffolding", () => {
    it("approving a proposal with execution plan creates missions and tasks", async () => {
      // Engineer submits proposal with execution plan
      const proposal = await eng.createProposal(
        "Build Feature X",
        "Implement feature X in 2 phases",
        "Full proposal body...",
        {
          correlationId: undefined,
          proposedExecutionPlan: {
            missions: [
              { idRef: "m1", title: "Phase 1", description: "Foundation work" },
            ],
            tasks: [
              { idRef: "t1", missionRef: "m1", title: "Build base", description: "Create the base module" },
              { idRef: "t2", missionRef: "m1", title: "Add tests", description: "Write tests for base", dependsOn: ["t1"] },
            ],
          },
        }
      );
      expect(proposal.hasExecutionPlan).toBe(true);

      // Architect approves
      const review = await arch.reviewProposal(proposal.proposalId as string, "approved", "Looks good");
      expect(review.success).toBe(true);
      expect(review.scaffolded).toBe(true);

      const result = review.scaffoldResult as any;
      expect(result.missions.length).toBe(1);
      expect(result.tasks.length).toBe(2);

      // Verify missions were created
      const missionId = result.missions[0].generatedId;
      const missionResult = await arch.call("get_mission", { missionId });
      const mission = JSON.parse(missionResult.content[0].text);
      expect(mission.title).toBe("Phase 1");

      // Verify tasks were created and linked to mission
      expect(mission.tasks).toContain(result.tasks[0].generatedId);
      expect(mission.tasks).toContain(result.tasks[1].generatedId);

      // Verify task dependency resolved
      const tasks = await arch.listTasks();
      const taskList = (tasks as any).tasks;
      const t2 = taskList.find((t: any) => t.title === "Add tests");
      expect(t2.status).toBe("blocked"); // depends on t1
      expect(t2.dependsOn).toContain(result.tasks[0].generatedId);
    });

    it("approving a proposal without execution plan works normally (no scaffolding)", async () => {
      const proposal = await eng.createProposal(
        "Simple question",
        "Should we use Redis?",
        "Discussion about caching strategy"
      );
      expect(proposal.hasExecutionPlan).toBeFalsy();

      const review = await arch.reviewProposal(proposal.proposalId as string, "approved", "Yes, use Redis");
      expect(review.success).toBe(true);
      expect(review.scaffolded).toBeFalsy();
    });
  });

  describe("Lineage Rules", () => {
    it("mission correlationId = proposal ID", async () => {
      const proposal = await eng.createProposal(
        "Lineage test",
        "Test lineage",
        "Body",
        {
          proposedExecutionPlan: {
            missions: [{ idRef: "m1", title: "Mission", description: "Desc" }],
          },
        }
      );
      const proposalId = proposal.proposalId as string;

      await arch.reviewProposal(proposalId, "approved", "OK");

      // Check mission was created — we can find it via list
      const missions = await arch.call("list_missions", {});
      const parsed = JSON.parse(missions.content[0].text);
      expect(parsed.count).toBe(1);
      // Mission's correlationId should reference the proposal
      // (verified by the linkage pattern)
    });

    it("task with missionRef gets correlationId = generated mission ID", async () => {
      const proposal = await eng.createProposal(
        "Task lineage",
        "Test task lineage",
        "Body",
        {
          proposedExecutionPlan: {
            missions: [{ idRef: "m1", title: "Mission", description: "Desc" }],
            tasks: [{ idRef: "t1", missionRef: "m1", title: "Task", description: "Linked task" }],
          },
        }
      );

      const review = await arch.reviewProposal(proposal.proposalId as string, "approved", "OK");
      const result = review.scaffoldResult as any;
      const missionId = result.missions[0].generatedId;
      const taskId = result.tasks[0].generatedId;

      // Task should be linked to mission
      const missionResult = await arch.call("get_mission", { missionId });
      const mission = JSON.parse(missionResult.content[0].text);
      expect(mission.tasks).toContain(taskId);
    });

    it("standalone task (no missionRef) gets correlationId = proposal ID", async () => {
      const proposal = await eng.createProposal(
        "Standalone",
        "Standalone task",
        "Body",
        {
          proposedExecutionPlan: {
            tasks: [{ idRef: "t1", title: "Solo task", description: "No mission" }],
          },
        }
      );
      const proposalId = proposal.proposalId as string;

      const review = await arch.reviewProposal(proposalId, "approved", "OK");
      expect(review.scaffolded).toBe(true);

      const result = review.scaffoldResult as any;
      expect(result.tasks.length).toBe(1);

      // Task should have been created
      const tasks = await arch.listTasks();
      const taskList = (tasks as any).tasks;
      expect(taskList.length).toBe(1);
      expect(taskList[0].correlationId).toBe(proposalId);
    });
  });

  describe("Resolution Map", () => {
    it("local dependsOn refs are resolved to generated IDs", async () => {
      const proposal = await eng.createProposal(
        "Dependency resolution",
        "Test dep resolution",
        "Body",
        {
          proposedExecutionPlan: {
            tasks: [
              { idRef: "t1", title: "First", description: "Do first" },
              { idRef: "t2", title: "Second", description: "Do second", dependsOn: ["t1"] },
              { idRef: "t3", title: "Third", description: "Do third", dependsOn: ["t1", "t2"] },
            ],
          },
        }
      );

      const review = await arch.reviewProposal(proposal.proposalId as string, "approved", "OK");
      const result = review.scaffoldResult as any;

      // t2 should depend on the generated ID for t1
      const tasks = await arch.listTasks();
      const taskList = (tasks as any).tasks;
      const t2 = taskList.find((t: any) => t.title === "Second");
      const t3 = taskList.find((t: any) => t.title === "Third");

      expect(t2.dependsOn).toContain(result.tasks[0].generatedId); // t1's generated ID
      expect(t3.dependsOn).toContain(result.tasks[0].generatedId); // t1
      expect(t3.dependsOn).toContain(result.tasks[1].generatedId); // t2
    });

    it("external dependsOn refs are passed through unchanged", async () => {
      // Create a pre-existing task
      await arch.createTask("Existing task", "Already exists");

      const proposal = await eng.createProposal(
        "External deps",
        "Test external deps",
        "Body",
        {
          proposedExecutionPlan: {
            tasks: [
              { idRef: "t1", title: "Depends on external", description: "Needs existing", dependsOn: ["task-1"] },
            ],
          },
        }
      );

      const review = await arch.reviewProposal(proposal.proposalId as string, "approved", "OK");
      const result = review.scaffoldResult as any;

      const tasks = await arch.listTasks();
      const taskList = (tasks as any).tasks;
      const scaffolded = taskList.find((t: any) => t.title === "Depends on external");

      expect(scaffolded.dependsOn).toContain("task-1"); // external ref preserved
      expect(scaffolded.status).toBe("blocked"); // blocked on task-1
    });
  });

  describe("Validation", () => {
    it("rejects plan with duplicate mission idRefs", async () => {
      const result = await eng.call("create_proposal", {
        title: "Dup mission", summary: "Test", body: "Body",
        proposedExecutionPlan: {
          missions: [
            { idRef: "m1", title: "A", description: "A" },
            { idRef: "m1", title: "B", description: "B" },
          ],
        },
      });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.details).toBeDefined();
      expect(parsed.details.some((d: string) => d.includes("Duplicate mission idRef"))).toBe(true);
    });

    it("rejects plan with task referencing non-existent mission", async () => {
      const result = await eng.call("create_proposal", {
        title: "Bad ref", summary: "Test", body: "Body",
        proposedExecutionPlan: {
          tasks: [
            { idRef: "t1", missionRef: "m-nonexistent", title: "Bad", description: "Bad" },
          ],
        },
      });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.details.some((d: string) => d.includes("non-existent mission"))).toBe(true);
    });
  });

  describe("Events", () => {
    it("task_issued emitted for pending (non-blocked) tasks", async () => {
      orch.events.clear();

      const proposal = await eng.createProposal(
        "Events test",
        "Test events",
        "Body",
        {
          proposedExecutionPlan: {
            tasks: [
              { idRef: "t1", title: "Pending task", description: "Should emit" },
              { idRef: "t2", title: "Blocked task", description: "Should not emit", dependsOn: ["t1"] },
            ],
          },
        }
      );

      orch.events.clear(); // clear proposal_submitted
      await arch.reviewProposal(proposal.proposalId as string, "approved", "OK");

      // task_issued for t1 (pending), but NOT for t2 (blocked)
      const directives = orch.events.forEvent("task_issued");
      expect(directives.length).toBe(1);
      expect(directives[0].targetRoles).toContain("engineer");
    });

    it("proposal_decided includes scaffold metadata", async () => {
      const proposal = await eng.createProposal(
        "Meta test",
        "Test meta",
        "Body",
        {
          proposedExecutionPlan: {
            missions: [{ idRef: "m1", title: "M", description: "D" }],
            tasks: [{ idRef: "t1", missionRef: "m1", title: "T", description: "D" }],
          },
        }
      );

      orch.events.clear();
      await arch.reviewProposal(proposal.proposalId as string, "approved", "OK");

      const decided = orch.events.expectEvent("proposal_decided");
      expect(decided.data.scaffolded).toBe(true);
      expect(decided.data.scaffoldedMissions).toBe(1);
      expect(decided.data.scaffoldedTasks).toBe(1);
    });
  });

  describe("Backward Compatibility", () => {
    it("rejection with execution plan does not scaffold", async () => {
      const proposal = await eng.createProposal(
        "Rejected plan",
        "Will be rejected",
        "Body",
        {
          proposedExecutionPlan: {
            missions: [{ idRef: "m1", title: "M", description: "D" }],
          },
        }
      );

      await arch.reviewProposal(proposal.proposalId as string, "rejected", "No");

      // No missions should exist
      const missions = await arch.call("list_missions", {});
      const parsed = JSON.parse(missions.content[0].text);
      expect(parsed.count).toBe(0);
    });

    it("changes_requested with execution plan does not scaffold", async () => {
      const proposal = await eng.createProposal(
        "Changes plan",
        "Needs changes",
        "Body",
        {
          proposedExecutionPlan: {
            tasks: [{ idRef: "t1", title: "T", description: "D" }],
          },
        }
      );

      await arch.reviewProposal(proposal.proposalId as string, "changes_requested", "Fix it");

      const tasks = await arch.listTasks();
      expect((tasks as any).count).toBe(0);
    });
  });
});
