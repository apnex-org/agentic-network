#!/usr/bin/env npx tsx
/**
 * Production Smoke Test Suite
 *
 * Validates a live Hub deployment by exercising the critical workflows
 * declared in docs/specs/workflow-registry.md (the sovereign spec).
 *
 * Connects two McpAgentClient sessions — one as architect, one as
 * engineer — and drives them through the multi-actor workflows that
 * form the system's core contract.
 *
 * Usage:
 *   npx tsx tests/smoke-production.ts                      # uses .ois/hub-config.json
 *   OIS_HUB_URL=https://... OIS_HUB_TOKEN=... npx tsx tests/smoke-production.ts
 *
 * Workflows tested (from workflow-registry.md):
 *   WF-001  Task Happy Path      (create → pickup → report → review)
 *   WF-001a Task Revision Loop   (report → reject → re-report → approve)
 *   WF-002  Clarification        (create → resolve)
 *   WF-003  DAG Dependency       (parent complete → child unblocked)
 *   WF-004  Proposal Happy Path  (submit → review → close)
 *   WF-005  Thread Convergence   (create → reply → converge)
 *
 * Invariants validated:
 *   INV-T7  dependsOn → starts blocked
 *   INV-T8  Only working tasks can receive reports
 */

import { McpAgentClient } from "../packages/network-adapter/src/index.js";
import type { AgentEvent } from "../packages/network-adapter/src/index.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

// ── Configuration ────────────────────────────────────────────────────

interface HubConfig {
  hubUrl: string;
  hubToken: string;
}

function loadConfig(): HubConfig {
  if (process.env.OIS_HUB_URL && process.env.OIS_HUB_TOKEN) {
    return {
      hubUrl: process.env.OIS_HUB_URL,
      hubToken: process.env.OIS_HUB_TOKEN,
    };
  }

  const configPath = resolve(process.cwd(), ".ois", "hub-config.json");
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return {
      hubUrl: process.env.OIS_HUB_URL || raw.hubUrl,
      hubToken: process.env.OIS_HUB_TOKEN || raw.hubToken,
    };
  }

  console.error(
    "FATAL: No Hub configuration found.\n" +
    "  Set OIS_HUB_URL + OIS_HUB_TOKEN env vars, or create .ois/hub-config.json"
  );
  process.exit(1);
}

// ── Test Harness ─────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];
const RUN_TAG = `smoke-${Date.now()}`;

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, duration });
    console.log(`  \u2713 ${name} (${duration}ms)`);
  } catch (err: unknown) {
    const duration = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, duration, error: message });
    console.log(`  \u2717 ${name} (${duration}ms)`);
    console.log(`    \u2192 ${message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

// ── Client Factory ───────────────────────────────────────────────────

async function createClient(
  config: HubConfig,
  role: string,
  labels?: Record<string, string>
): Promise<McpAgentClient> {
  // Labels only stick when the M18 enriched handshake runs — the bare
  // register_role path silently drops them (no Agent entity is created,
  // so callerLabels() returns {} and dispatch degrades to broadcast).
  // Fabricate a per-session globalInstanceId so each smoke run gets a
  // fresh Agent (no collision with prior runs or real operators).
  const client = new McpAgentClient(
    {
      role,
      labels,
      handshake: {
        globalInstanceId: `smoke-${role}-${randomUUID()}`,
        proxyName: "smoke-production",
        proxyVersion: "0.0.0",
        transport: "http",
        sdkVersion: "0.0.0",
        getClientInfo: () => ({ name: "smoke-production", version: "0.0.0" }),
      },
      logger: () => {}, // suppress transport chatter
    },
    {
      transportConfig: {
        url: config.hubUrl,
        token: config.hubToken,
      },
    }
  );
  client.setCallbacks({});
  await client.start();
  return client;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Call a Hub tool and return the parsed JSON response. */
async function call(
  client: McpAgentClient,
  method: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const result = await client.call(method, params);
  return (result ?? {}) as Record<string, unknown>;
}

/** Look up a single task's current state via list_tasks + filter. */
async function getTaskStatus(
  client: McpAgentClient,
  taskId: string
): Promise<Record<string, unknown>> {
  const res = await call(client, "list_tasks", {});
  const tasks = res.tasks as Array<Record<string, unknown>>;
  const task = tasks.find((t) => t.id === taskId);
  assert(!!task, `task ${taskId} not found in list_tasks`);
  return task!;
}

/**
 * Drain all pending tasks via get_task until either:
 *   (a) we pick up the target taskId, or
 *   (b) no more pending tasks remain.
 * Returns the target task once it's in "working" state.
 */
async function pickUpTask(
  client: McpAgentClient,
  targetTaskId: string
): Promise<Record<string, unknown>> {
  for (let i = 0; i < 20; i++) {
    const res = await call(client, "get_task", {});
    if (!res.taskId) break; // no more pending tasks
    if (res.taskId === targetTaskId) return res;
  }
  // If we drained other tasks but ours wasn't found, check its status
  const task = await getTaskStatus(client, targetTaskId);
  assert(task.status === "working", `expected ${targetTaskId} to be working, got ${task.status}`);
  return task;
}

// ── Cleanup sweep ────────────────────────────────────────────────────

const TERMINAL_TASK = new Set(["completed", "cancelled", "failed"]);
const TERMINAL_THREAD = new Set(["closed"]);
const TERMINAL_PROPOSAL = new Set(["implemented", "rejected"]);

/**
 * Sweep every artifact tagged with this run and drive it to a terminal
 * state. Matches by title containing RUN_TAG, which works uniformly
 * across list_tasks/list_threads/list_proposals regardless of which
 * fields the Hub exposes in list summaries. Idempotent and best-effort
 * — logs failures but never throws, so it is safe in a finally block.
 */
async function cleanupRunArtifacts(
  architect: McpAgentClient,
  engineer: McpAgentClient,
  runTag: string
): Promise<void> {
  console.log("\nCleaning up run artifacts...");

  const mineByTitle = <T extends { title?: unknown }>(items: T[]): T[] =>
    items.filter((x) => typeof x.title === "string" && x.title.includes(runTag));

  // Tasks: cancel any non-terminal task from this run.
  try {
    const res = await call(architect, "list_tasks", {});
    const tasks = (res.tasks as Array<Record<string, unknown>>) ?? [];
    for (const t of mineByTitle(tasks)) {
      if (TERMINAL_TASK.has(t.status as string)) continue;
      const r = await call(architect, "cancel_task", { taskId: t.id });
      const ok = r.success === true;
      console.log(`  ${ok ? "\u2713" : "!"} cancel ${t.id} (${t.status})${ok ? "" : ` \u2192 ${r.error}`}`);
    }
  } catch (err) {
    console.log(`  ! task sweep failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Threads: close any non-closed thread from this run.
  try {
    const res = await call(architect, "list_threads", {});
    const threads = (res.threads as Array<Record<string, unknown>>) ?? [];
    for (const t of mineByTitle(threads)) {
      if (TERMINAL_THREAD.has(t.status as string)) continue;
      const r = await call(architect, "close_thread", { threadId: t.id });
      const ok = r.success === true;
      console.log(`  ${ok ? "\u2713" : "!"} close ${t.id} (${t.status})${ok ? "" : ` \u2192 ${r.error}`}`);
    }
  } catch (err) {
    console.log(`  ! thread sweep failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Proposals: engineer can close approved → implemented. Submitted /
  // changes_requested cannot be cancelled (no tool); report them.
  try {
    const res = await call(architect, "list_proposals", {});
    const proposals = (res.proposals as Array<Record<string, unknown>>) ?? [];
    for (const p of mineByTitle(proposals)) {
      const status = p.status as string;
      if (TERMINAL_PROPOSAL.has(status)) continue;
      if (status === "approved") {
        const r = await call(engineer, "close_proposal", { proposalId: p.id });
        const ok = r.success === true || r.status === "implemented";
        console.log(`  ${ok ? "\u2713" : "!"} close ${p.id} (${status})${ok ? "" : ` \u2192 ${r.error}`}`);
      } else {
        console.log(`  ! proposal ${p.id} left in non-terminal state (${status}) — no cancel tool`);
      }
    }
  } catch (err) {
    console.log(`  ! proposal sweep failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`\n\u2500\u2500 Production Smoke Tests \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  console.log(`Hub: ${config.hubUrl}`);
  console.log(`Run: ${RUN_TAG}\n`);

  // ── Connect both roles ─────────────────────────────────────────────
  console.log("Connecting clients...");

  let architect: McpAgentClient;
  let engineer: McpAgentClient;

  // Mission-19: smoke clients register with env:smoke so their traffic
  // does not broadcast into prod engineer/architect pools. Labels are
  // immutable post-create (INV-AG1); the bare register_role call stamps
  // them before any scoped dispatch fires.
  const SMOKE_LABELS = { env: "smoke" };

  try {
    architect = await createClient(config, "architect", SMOKE_LABELS);
    console.log("  architect: connected (labels: env=smoke)");
  } catch (err) {
    console.error(`FATAL: architect connection failed: ${err}`);
    process.exit(1);
  }

  try {
    engineer = await createClient(config, "engineer", SMOKE_LABELS);
    console.log("  engineer:  connected (labels: env=smoke)");
  } catch (err) {
    console.error(`FATAL: engineer connection failed: ${err}`);
    await architect.stop();
    process.exit(1);
  }

  console.log("\nRunning tests...\n");

  // Hoisted so the finally block can stop it on test failure too.
  let prodEngineer: McpAgentClient | undefined;

  try {

  // ════════════════════════════════════════════════════════════════════
  // WF-001: Task Happy Path
  //   create_task → get_task → create_report → create_review(approved)
  // ════════════════════════════════════════════════════════════════════
  let wf001TaskId: string | undefined;

  await runTest("WF-001.1 Architect creates task → pending", async () => {
    const res = await call(architect, "create_task", {
      title: `[smoke] WF-001 task (${RUN_TAG})`,
      description: "Smoke test: task happy path",
      correlationId: RUN_TAG,
    });
    wf001TaskId = res.taskId as string;
    assert(!!wf001TaskId, "taskId must be returned");
    assertEq(res.status, "pending", "new task starts pending");
  });

  await runTest("WF-001.2 Engineer picks up task → working", async () => {
    assert(!!wf001TaskId, "prerequisite: task created");
    const res = await pickUpTask(engineer, wf001TaskId!);
    assertEq(res.status, "working", "picked-up task must be working");
  });

  await runTest("WF-001.3 Engineer submits report → in_review", async () => {
    assert(!!wf001TaskId, "prerequisite");
    const res = await call(engineer, "create_report", {
      taskId: wf001TaskId,
      summary: `Smoke test report for ${RUN_TAG}`,
      report: "All checks passed. This is an automated smoke test report.",
    });
    assertEq(res.success, true, "create_report must succeed");
    assertEq(res.status, "in_review", "response status must be in_review");
  });

  await runTest("WF-001.4 Architect approves → completed", async () => {
    assert(!!wf001TaskId, "prerequisite");
    const res = await call(architect, "create_review", {
      taskId: wf001TaskId,
      decision: "approved",
      assessment: "Smoke test — auto-approved",
    });
    assertEq(res.success, true, "create_review must succeed");
    assertEq(res.status, "completed", "task must be completed");
  });

  // ════════════════════════════════════════════════════════════════════
  // INV-T8: Only working tasks can receive reports
  // ════════════════════════════════════════════════════════════════════
  await runTest("INV-T8 Report rejected on completed task", async () => {
    assert(!!wf001TaskId, "prerequisite: task completed");
    const res = await call(engineer, "create_report", {
      taskId: wf001TaskId,
      summary: "This should fail",
      report: "Attempting report on completed task",
    });
    assertEq(res.success, false, "report on completed task must fail");
    assert(
      String(res.error ?? "").includes("transition") ||
      String(res.error ?? "").includes("state"),
      `expected FSM violation error, got: ${res.error}`
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // WF-002: Clarification
  //   create_task → get_task → create_clarification → resolve
  // ════════════════════════════════════════════════════════════════════
  let wf002TaskId: string | undefined;

  await runTest("WF-002.1 Create + pick up task for clarification", async () => {
    const res = await call(architect, "create_task", {
      title: `[smoke] WF-002 clarification (${RUN_TAG})`,
      description: "Smoke test: clarification workflow",
      correlationId: RUN_TAG,
    });
    wf002TaskId = res.taskId as string;
    assert(!!wf002TaskId, "taskId returned");
    await pickUpTask(engineer, wf002TaskId);
  });

  await runTest("WF-002.2 Engineer creates clarification → input_required", async () => {
    assert(!!wf002TaskId, "prerequisite");
    const res = await call(engineer, "create_clarification", {
      taskId: wf002TaskId,
      question: `Smoke test clarification from ${RUN_TAG}`,
    });
    assertEq(res.success, true, "create_clarification must succeed");
    assertEq(res.status, "input_required", "response status must be input_required");
  });

  await runTest("WF-002.3 Architect resolves clarification → working", async () => {
    assert(!!wf002TaskId, "prerequisite");
    const res = await call(architect, "resolve_clarification", {
      taskId: wf002TaskId,
      answer: "Automated smoke test answer",
    });
    assertEq(res.success, true, "resolve_clarification must succeed");
    assertEq(res.status, "working", "response status must be working");
  });

  // ════════════════════════════════════════════════════════════════════
  // WF-003: DAG Dependency Cascade
  //   parent + blocked child → complete parent → child unblocks
  // ════════════════════════════════════════════════════════════════════
  let dagParentId: string | undefined;
  let dagChildId: string | undefined;

  await runTest("WF-003.1 Create parent task", async () => {
    const res = await call(architect, "create_task", {
      title: `[smoke] WF-003 parent (${RUN_TAG})`,
      description: "Smoke test: DAG parent",
      correlationId: RUN_TAG,
    });
    dagParentId = res.taskId as string;
    assert(!!dagParentId, "parent taskId returned");
  });

  await runTest("WF-003.2 Create child with dependsOn → blocked (INV-T7)", async () => {
    assert(!!dagParentId, "prerequisite");
    const res = await call(architect, "create_task", {
      title: `[smoke] WF-003 child (${RUN_TAG})`,
      description: "Smoke test: DAG child depends on parent",
      correlationId: RUN_TAG,
      dependsOn: [dagParentId],
    });
    dagChildId = res.taskId as string;
    assertEq(res.status, "blocked", "child must start as blocked (INV-T7)");
  });

  await runTest("WF-003.3 Complete parent → child unblocks to pending", async () => {
    assert(!!dagParentId && !!dagChildId, "prerequisite");
    // Pick up parent
    await pickUpTask(engineer, dagParentId!);
    // Report + approve parent
    await call(engineer, "create_report", {
      taskId: dagParentId,
      summary: "DAG parent work done",
      report: "Smoke test parent report",
    });
    const review = await call(architect, "create_review", {
      taskId: dagParentId,
      decision: "approved",
      assessment: "Smoke test — parent approved",
    });
    assertEq(review.status, "completed", "parent must be completed");
    // Verify child unblocked by cascade
    const child = await getTaskStatus(architect, dagChildId!);
    assertEq(child.status, "pending", "child must cascade to pending");
  });

  // ════════════════════════════════════════════════════════════════════
  // WF-004: Proposal Happy Path
  //   create_proposal → create_proposal_review → close_proposal
  // ════════════════════════════════════════════════════════════════════
  let proposalId: string | undefined;

  await runTest("WF-004.1 Engineer submits proposal", async () => {
    const res = await call(engineer, "create_proposal", {
      title: `[smoke] WF-004 proposal (${RUN_TAG})`,
      summary: "Smoke test proposal",
      body: "This is an automated smoke test proposal body.",
      correlationId: RUN_TAG,
    });
    proposalId = res.proposalId as string;
    assert(!!proposalId, "proposalId returned");
    assertEq(res.status, "submitted", "proposal starts as submitted");
  });

  await runTest("WF-004.2 Architect reviews → approved", async () => {
    assert(!!proposalId, "prerequisite");
    const res = await call(architect, "create_proposal_review", {
      proposalId,
      decision: "approved",
      feedback: "Smoke test — auto-approved",
    });
    assertEq(res.success, true, "review must succeed");
    // Verify via get_proposal (engineer-tagged tool)
    const proposal = await call(engineer, "get_proposal", { proposalId });
    assertEq(proposal.status, "approved", "proposal must be approved");
  });

  await runTest("WF-004.3 Engineer closes → implemented", async () => {
    assert(!!proposalId, "prerequisite");
    const res = await call(engineer, "close_proposal", { proposalId });
    assertEq(res.status, "implemented", "proposal must be implemented");
  });

  // ════════════════════════════════════════════════════════════════════
  // WF-005: Thread Convergence
  //   create_thread → reply(converged) → reply(converged) → converged
  // ════════════════════════════════════════════════════════════════════
  let threadId: string | undefined;

  await runTest("WF-005.1 Engineer creates thread", async () => {
    const res = await call(engineer, "create_thread", {
      title: `[smoke] WF-005 thread (${RUN_TAG})`,
      message: "Smoke test thread — engineer opening message",
      correlationId: RUN_TAG,
    });
    threadId = res.threadId as string;
    assert(!!threadId, "threadId returned");
    assertEq(res.status, "active", "new thread starts active");
  });

  await runTest("WF-005.2 Architect replies converged=true → still active", async () => {
    assert(!!threadId, "prerequisite");
    const res = await call(architect, "create_thread_reply", {
      threadId,
      message: "Architect acknowledges — marking converged",
      converged: true,
    });
    assertEq(res.status, "active", "one-sided convergence keeps thread active");
  });

  await runTest("WF-005.3 Engineer replies converged=true → converged", async () => {
    assert(!!threadId, "prerequisite");
    const res = await call(engineer, "create_thread_reply", {
      threadId,
      message: "Engineer confirms — both converged",
      converged: true,
    });
    assertEq(res.status, "converged", "both parties converged");
  });

  // ════════════════════════════════════════════════════════════════════
  // WF-001a: Revision Loop
  //   report → reject → re-report → approve
  //   Uses WF-002's task (still in working state)
  // ════════════════════════════════════════════════════════════════════

  await runTest("WF-001a.1 Engineer reports → in_review", async () => {
    assert(!!wf002TaskId, "prerequisite");
    const res = await call(engineer, "create_report", {
      taskId: wf002TaskId,
      summary: "First report — expecting rejection",
      report: "Smoke test revision loop report v1",
    });
    assertEq(res.success, true, "report must succeed");
    assertEq(res.status, "in_review", "task must be in_review");
  });

  await runTest("WF-001a.2 Architect rejects → working + revisionCount incremented", async () => {
    assert(!!wf002TaskId, "prerequisite");
    const res = await call(architect, "create_review", {
      taskId: wf002TaskId,
      decision: "rejected",
      assessment: "Needs revision — smoke test rejection",
    });
    assertEq(res.success, true, "reject must succeed");
    assertEq(res.status, "working", "rejected task returns to working");
    // Verify revisionCount via list_tasks
    const task = await getTaskStatus(architect, wf002TaskId!);
    assert(
      (task.revisionCount as number) >= 1,
      `revisionCount must be >= 1, got ${task.revisionCount}`
    );
  });

  await runTest("WF-001a.3 Engineer re-reports → approve → completed", async () => {
    assert(!!wf002TaskId, "prerequisite");
    await call(engineer, "create_report", {
      taskId: wf002TaskId,
      summary: "Revised report v2",
      report: "Smoke test revision loop — revised report v2",
    });
    const res = await call(architect, "create_review", {
      taskId: wf002TaskId,
      decision: "approved",
      assessment: "Revision accepted — smoke test",
    });
    assertEq(res.status, "completed", "task completed after approved revision");
  });

  // ════════════════════════════════════════════════════════════════════
  // M19-ISO: Label isolation
  //   A parallel engineer labeled env:prod must NOT receive task_issued
  //   for a task created by an env:smoke architect. Exercises the full
  //   live dispatch path (selector resolution → transport → notification).
  // ════════════════════════════════════════════════════════════════════
  let isoTaskId: string | undefined;

  await runTest("M19-ISO.1 Prod-scoped engineer connects in parallel", async () => {
    prodEngineer = await createClient(config, "engineer", { env: "prod" });
    assert(!!prodEngineer, "prod engineer connected");
  });

  await runTest("M19-ISO.2 Smoke directive does NOT reach env:prod engineer", async () => {
    assert(!!prodEngineer, "prerequisite");
    const received: AgentEvent[] = [];
    prodEngineer!.setCallbacks({
      onActionableEvent: (e) => received.push(e),
      onInformationalEvent: (e) => received.push(e),
    });

    const res = await call(architect, "create_task", {
      title: `[smoke] M19-ISO task (${RUN_TAG})`,
      description: "Label isolation assertion — should not reach env:prod engineer",
      correlationId: RUN_TAG,
    });
    isoTaskId = res.taskId as string;
    assert(!!isoTaskId, "taskId returned");

    // Give the Hub a moment to dispatch. task_issued on the smoke
    // engineer should arrive within a few hundred ms; if prod receives
    // it, it lands in the same window.
    await new Promise((r) => setTimeout(r, 1500));

    const leaked = received.filter(
      (e) =>
        e.event === "task_issued" &&
        (e as unknown as { taskId?: string }).taskId === isoTaskId
    );
    assert(
      leaked.length === 0,
      `env:prod engineer received ${leaked.length} task_issued events for the smoke task — label isolation broken`,
    );
  });

  await runTest("M19-ISO.3 env:smoke engineer CAN claim the smoke task (sanity)", async () => {
    assert(!!isoTaskId, "prerequisite");
    // The smoke engineer is labeled env:smoke and must be able to claim.
    // This guards against over-restrictive selector logic (false negative).
    const task = await pickUpTask(engineer, isoTaskId!);
    assertEq(task.status, "working", "smoke engineer claims smoke task");
  });

  } finally {
    // Sweep artifacts before disconnecting so both clients are still
    // live (architect cancels/closes, engineer closes approved proposals).
    // Runs even if a test above threw.
    await cleanupRunArtifacts(architect, engineer, RUN_TAG);

    console.log("\nDisconnecting...");
    await engineer.stop();
    await architect.stop();
    if (prodEngineer) await prodEngineer.stop();
  }

  // ── Summary ────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;
  const totalTime = results.reduce((acc, r) => acc + r.duration, 0);

  console.log(`\n\u2500\u2500 Results \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  console.log(`  ${passed}/${total} passed, ${failed} failed (${totalTime}ms total)`);

  if (failed > 0) {
    console.log(`\nFailed tests:`);
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  \u2717 ${r.name}`);
      console.log(`    ${r.error}`);
    }
    process.exit(1);
  }

  console.log(`\nAll smoke tests passed.\n`);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(2);
});
