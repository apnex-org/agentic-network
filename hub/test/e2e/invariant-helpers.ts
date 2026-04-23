/**
 * FSM-Invariant Assertion Helpers — Mission-41 Wave 1 T2
 *
 * Per-INV-id helpers that exercise specific invariants from
 * `docs/specs/workflow-registry.md` §7 against a `TestOrchestrator`.
 * Helper names match the INV-id exactly (`assertInv<ID>`) so the T5
 * coverage-report tool can statically auto-map call sites → coverage.
 *
 * Each helper accepts a fresh orchestrator and an optional `mode`
 * argument. `mode="all"` runs every mode the helper supports (positive,
 * negative-rejection, edge — where meaningful). Consumers who want a
 * narrow assertion pass the specific mode.
 *
 * Helpers throw on invariant violation (standard vitest-friendly shape).
 *
 * TH18/TH19 helpers are stubs pending Mission-41 Wave 1 T3 + T4
 * mock-harness delivery — they throw `InvariantNotYetTestable`. Consumers
 * may `it.skip`-equivalent catch this; Wave 2 graduates them via
 * follow-up PR.
 */

import type { ActorFacade, TestOrchestrator } from "./orchestrator.js";

// ── Types ────────────────────────────────────────────────────────────

/** Execution mode for an invariant helper. Default `all` runs every supported mode. */
export type InvariantMode = "all" | "positive" | "negativeReject" | "edge";

/** Thrown by helpers whose invariant cannot yet be exercised (e.g., pending mock-harness). */
export class InvariantNotYetTestable extends Error {
  constructor(inv: string, reason: string) {
    super(`INV-${inv}: not yet testable (${reason})`);
    this.name = "InvariantNotYetTestable";
  }
}

function shouldRun(mode: InvariantMode, target: "positive" | "negativeReject" | "edge"): boolean {
  return mode === "all" || mode === target;
}

function fail(inv: string, mode: string, detail: string): never {
  throw new Error(`[INV-${inv}/${mode}] invariant violated: ${detail}`);
}

// ── INV-T4 — Task terminal states ────────────────────────────────────

/**
 * INV-T4: `completed`, `failed`, `escalated`, `cancelled` are terminal task
 * states with no outbound transitions. workflow-registry §7.2.
 */
export async function assertInvT4(o: TestOrchestrator, mode: InvariantMode = "all"): Promise<void> {
  const arch = o.asArchitect();
  const eng = o.asEngineer();

  if (shouldRun(mode, "positive")) {
    // Positive: cancelled is reachable via cancelTask from pending.
    await arch.createTask("T4 positive", "Will be cancelled");
    const result = await arch.call("cancel_task", { taskId: "task-1" });
    if (result.isError) fail("T4", "positive", `cancel_task on pending should succeed; got ${JSON.stringify(result)}`);
  }

  if (shouldRun(mode, "negativeReject")) {
    // Negative: report on cancelled terminal → rejected.
    o.reset();
    const arch2 = o.asArchitect();
    const eng2 = o.asEngineer();
    await arch2.createTask("T4 negative", "To cancel then report");
    await arch2.call("cancel_task", { taskId: "task-1" });
    const reportResult = await eng2.call("create_report", {
      taskId: "task-1", report: "Attempting report on terminal", summary: "Should fail",
    });
    if (!reportResult.isError) fail("T4", "negativeReject", "create_report on cancelled task should be rejected but succeeded");
  }

  if (shouldRun(mode, "edge")) {
    // Edge: cancel on cancelled → rejected (no self-terminal re-transition).
    o.reset();
    const arch3 = o.asArchitect();
    await arch3.createTask("T4 edge", "Double cancel");
    await arch3.call("cancel_task", { taskId: "task-1" });
    const secondCancel = await arch3.call("cancel_task", { taskId: "task-1" });
    if (!secondCancel.isError) fail("T4", "edge", "cancel_task on cancelled task should be rejected");
  }
}

// ── INV-P1 — Architect-only proposal review ──────────────────────────

/**
 * INV-P1: Only the Architect can review proposals. workflow-registry §7.2.
 * Enforced at the PolicyRouter RBAC gate via `create_proposal_review`'s
 * architect-only role binding.
 */
export async function assertInvP1(o: TestOrchestrator, mode: InvariantMode = "all"): Promise<void> {
  const arch = o.asArchitect();
  const eng = o.asEngineer();

  if (shouldRun(mode, "positive")) {
    await eng.createProposal("P1 positive", "summary", "body");
    const reviewResult = await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "LGTM",
    });
    if (reviewResult.isError) fail("P1", "positive", `architect review should succeed; got ${JSON.stringify(reviewResult)}`);
  }

  if (shouldRun(mode, "negativeReject")) {
    o.reset();
    const eng2 = o.asEngineer();
    await eng2.createProposal("P1 negative", "summary", "body");
    const engineerReview = await eng2.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "unauthorized",
    });
    if (!engineerReview.isError) fail("P1", "negativeReject", "engineer calling create_proposal_review should be rejected (Authorization denied)");
    const parsed = JSON.parse(engineerReview.content[0].text);
    if (!parsed.error || !/Authorization denied/.test(parsed.error)) {
      fail("P1", "negativeReject", `expected Authorization-denied shape; got ${parsed.error}`);
    }
  }
}

// ── INV-P2 — Only submitted proposals are reviewable (gap-surfacing) ──

/**
 * INV-P2: Only submitted proposals can be reviewed. workflow-registry §7.2.
 *
 * **Gap-surfacing helper.** Per mission-41 kickoff-decisions §Decision 1,
 * the proposal policy currently has NO status guard on `create_proposal_review`.
 * The `negativeReject` mode encodes the spec-correct behavior; it WILL throw
 * under today's policy. When the guard lands, the helper goes green — this
 * is the ratchet.
 */
export async function assertInvP2(o: TestOrchestrator, mode: InvariantMode = "all"): Promise<void> {
  const arch = o.asArchitect();
  const eng = o.asEngineer();

  if (shouldRun(mode, "positive")) {
    await eng.createProposal("P2 positive", "summary", "body");
    const first = await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "LGTM",
    });
    if (first.isError) fail("P2", "positive", `first review of submitted proposal should succeed; got ${JSON.stringify(first)}`);
  }

  if (shouldRun(mode, "negativeReject")) {
    o.reset();
    const arch2 = o.asArchitect();
    const eng2 = o.asEngineer();
    await eng2.createProposal("P2 negative", "summary", "body");
    await arch2.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "first review",
    });
    // proposal is now in approved/reviewed state. Re-review should be rejected.
    const secondReview = await arch2.call("create_proposal_review", {
      proposalId: "prop-1", decision: "rejected", feedback: "second review should be blocked",
    });
    if (!secondReview.isError) fail("P2", "negativeReject", "re-reviewing a non-submitted proposal should be rejected (SPEC-GAP — fails until status guard lands)");
  }
}

// ── INV-P4 — Proposal `implemented` is terminal ──────────────────────

/**
 * INV-P4: `implemented` is a terminal proposal state with no outbound
 * transitions. workflow-registry §7.2.
 */
export async function assertInvP4(o: TestOrchestrator, mode: InvariantMode = "all"): Promise<void> {
  const arch = o.asArchitect();
  const eng = o.asEngineer();

  if (shouldRun(mode, "positive")) {
    await eng.createProposal("P4 positive", "summary", "body");
    await arch.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "approve",
    });
    const close = await eng.call("close_proposal", { proposalId: "prop-1" });
    if (close.isError) fail("P4", "positive", `close_proposal after approved should reach implemented; got ${JSON.stringify(close)}`);
    const parsed = JSON.parse(close.content[0].text);
    if (parsed.status !== "implemented") fail("P4", "positive", `expected status=implemented; got ${parsed.status}`);
  }

  if (shouldRun(mode, "negativeReject")) {
    o.reset();
    const arch2 = o.asArchitect();
    const eng2 = o.asEngineer();
    await eng2.createProposal("P4 negative", "summary", "body");
    await arch2.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "approve",
    });
    await eng2.call("close_proposal", { proposalId: "prop-1" });
    // proposal is now implemented. Attempt to re-review → should reject.
    const reReview = await arch2.call("create_proposal_review", {
      proposalId: "prop-1", decision: "rejected", feedback: "should be blocked",
    });
    if (!reReview.isError) fail("P4", "negativeReject", "create_proposal_review on implemented proposal should be rejected");
  }

  if (shouldRun(mode, "edge")) {
    o.reset();
    const arch3 = o.asArchitect();
    const eng3 = o.asEngineer();
    await eng3.createProposal("P4 edge", "summary", "body");
    await arch3.call("create_proposal_review", {
      proposalId: "prop-1", decision: "approved", feedback: "approve",
    });
    await eng3.call("close_proposal", { proposalId: "prop-1" });
    // Double close — no outbound from implemented.
    const secondClose = await eng3.call("close_proposal", { proposalId: "prop-1" });
    if (!secondClose.isError) fail("P4", "edge", "close_proposal on implemented proposal should be rejected (no outbound)");
  }
}

// ── INV-TH6 — Replies to non-active threads are rejected ─────────────

/**
 * INV-TH6: `create_thread_reply` is rejected when the target thread's
 * status is not `active`. workflow-registry §7.2.
 */
export async function assertInvTH6(o: TestOrchestrator, mode: InvariantMode = "all"): Promise<void> {
  const arch = o.asArchitect();
  const eng = o.asEngineer();

  if (shouldRun(mode, "positive")) {
    // Positive: reply to active broadcast thread → accepted.
    await arch.createThread("TH6 positive", "Initial message", { routingMode: "broadcast" });
    const reply = await eng.call("create_thread_reply", {
      threadId: "thread-1", message: "Reply on active thread",
    });
    if (reply.isError) fail("TH6", "positive", `reply on active thread should succeed; got ${JSON.stringify(reply)}`);
  }

  if (shouldRun(mode, "negativeReject")) {
    o.reset();
    const arch2 = o.asArchitect();
    const eng2 = o.asEngineer();
    await arch2.createThread("TH6 negative", "Will be closed", { routingMode: "broadcast" });
    await arch2.call("close_thread", { threadId: "thread-1" });
    const replyToClosed = await eng2.call("create_thread_reply", {
      threadId: "thread-1", message: "Reply on closed thread",
    });
    if (!replyToClosed.isError) fail("TH6", "negativeReject", "create_thread_reply on closed thread should be rejected");
  }
}

// ── INV-TH7 — close_thread is architect-only stewardship ─────────────

/**
 * INV-TH7: `close_thread` is architect-only administrative stewardship.
 * Participants use `leave_thread`. workflow-registry §7.2.
 */
export async function assertInvTH7(o: TestOrchestrator, mode: InvariantMode = "all"): Promise<void> {
  const arch = o.asArchitect();
  const eng = o.asEngineer();

  if (shouldRun(mode, "positive")) {
    await arch.createThread("TH7 positive", "Initial", { routingMode: "broadcast" });
    const close = await arch.call("close_thread", { threadId: "thread-1" });
    if (close.isError) fail("TH7", "positive", `architect close_thread should succeed; got ${JSON.stringify(close)}`);
  }

  if (shouldRun(mode, "negativeReject")) {
    o.reset();
    const arch2 = o.asArchitect();
    const eng2 = o.asEngineer();
    await arch2.createThread("TH7 negative", "Initial", { routingMode: "broadcast" });
    const engineerClose = await eng2.call("close_thread", { threadId: "thread-1" });
    if (!engineerClose.isError) fail("TH7", "negativeReject", "engineer calling close_thread should be rejected (Authorization denied)");
    const parsed = JSON.parse(engineerClose.content[0].text);
    if (!parsed.error || !/Authorization denied/.test(parsed.error)) {
      fail("TH7", "negativeReject", `expected Authorization-denied shape; got ${parsed.error}`);
    }
  }
}

// ── INV-I2 — Idea auto-linkage failure is non-fatal ──────────────────

/**
 * INV-I2: Auto-linkage failure is non-fatal — the idea still updates
 * even when the linkage target (e.g., sourceThreadId) cannot be resolved.
 * workflow-registry §7.2. Behavior invariant; `negativeReject` mode is a
 * no-op (there's no rejection semantics — this is graceful degradation).
 */
export async function assertInvI2(o: TestOrchestrator, mode: InvariantMode = "all"): Promise<void> {
  const eng = o.asEngineer();

  if (shouldRun(mode, "positive")) {
    // Positive: create idea with a bad sourceThreadId → idea still created.
    const result = await eng.call("create_idea", {
      text: "INV-I2 positive — bad linkage should not block",
      sourceThreadId: "thread-nonexistent",
    });
    if (result.isError) fail("I2", "positive", `idea creation with bad linkage should succeed (non-fatal); got ${JSON.stringify(result)}`);
    const parsed = JSON.parse(result.content[0].text);
    if (!parsed.ideaId) fail("I2", "positive", `expected ideaId in response; got ${JSON.stringify(parsed)}`);
  }
  // negativeReject + edge: no meaningful mode for a graceful-degradation invariant.
}

// ── INV-M4 — Mission completed/abandoned are terminal ────────────────

/**
 * INV-M4: `completed` and `abandoned` are terminal mission states with
 * no outbound transitions. workflow-registry §7.2.
 */
export async function assertInvM4(o: TestOrchestrator, mode: InvariantMode = "all"): Promise<void> {
  const arch = o.asArchitect();

  async function createAndActivate(facade: ActorFacade, title: string): Promise<string> {
    const createResult = await facade.call("create_mission", {
      title, description: "INV-M4 scenario", documentRef: `docs/test/${title}.md`,
    });
    if (createResult.isError) fail("M4", "setup", `create_mission failed: ${JSON.stringify(createResult)}`);
    const missionId = JSON.parse(createResult.content[0].text).missionId as string;
    const activateResult = await facade.call("update_mission", { missionId, status: "active" });
    if (activateResult.isError) fail("M4", "setup", `update_mission→active failed: ${JSON.stringify(activateResult)}`);
    return missionId;
  }

  if (shouldRun(mode, "positive")) {
    const missionId = await createAndActivate(arch, "M4-positive");
    const complete = await arch.call("update_mission", { missionId, status: "completed" });
    if (complete.isError) fail("M4", "positive", `active→completed should succeed; got ${JSON.stringify(complete)}`);
  }

  if (shouldRun(mode, "negativeReject")) {
    o.reset();
    const arch2 = o.asArchitect();
    const missionId = await createAndActivate(arch2, "M4-negative");
    await arch2.call("update_mission", { missionId, status: "completed" });
    // Attempt completed → active → should reject (no outbound).
    const reactivate = await arch2.call("update_mission", { missionId, status: "active" });
    if (!reactivate.isError) fail("M4", "negativeReject", "completed→active should be rejected (completed is terminal)");
  }

  if (shouldRun(mode, "edge")) {
    o.reset();
    const arch3 = o.asArchitect();
    const missionId = await createAndActivate(arch3, "M4-edge");
    await arch3.call("update_mission", { missionId, status: "abandoned" });
    const reviveAbandoned = await arch3.call("update_mission", { missionId, status: "active" });
    if (!reviveAbandoned.isError) fail("M4", "edge", "abandoned→active should be rejected (abandoned is terminal)");
  }
}

// ── INV-TH18 — Routing mode semantics (STUBBED pending mock-harness) ─

/**
 * INV-TH18: Routing mode is declared at `create_thread` and immutable
 * for the thread's lifetime. Current vocabulary per ADR-016:
 *
 *   - `unicast`   (was "targeted")   — one-to-one pinned; requires recipientAgentId
 *   - `broadcast`                     — pool-discovery; coerces to unicast on first reply
 *   - `multicast` (was "context_bound") — dynamic membership from bound-entity assignee; requires context
 *
 * Graduated from T2 stub by Mission-41 Wave 2 task-337. Tests exercise
 * each mode's persistence + the broadcast→unicast coercion edge. Pure
 * TestOrchestrator surface suffices — Mock*Client harnesses not required
 * for the routing-mode semantics (multi-actor scenarios use
 * `asArchitect()` + `asEngineer(id?)` facades).
 */
export async function assertInvTH18(o: TestOrchestrator, mode: InvariantMode = "all"): Promise<void> {
  const arch = o.asArchitect();
  const eng = o.asEngineer();

  // Resolve the engineer's agentId via the registry after first-tool-call
  // registration. ActorFacade doesn't expose engineerId directly, but the
  // derived sessionId is stable (`session-engineer-<name>`; default name).
  async function engineerIdFor(orch: TestOrchestrator): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reg = orch.stores.engineerRegistry as any;
    const agent = await reg.getAgentForSession("session-engineer-default");
    if (!agent?.engineerId) throw new Error("INV-TH18 helper: engineer not registered — call eng.listTasks() or similar first");
    return agent.engineerId as string;
  }

  if (shouldRun(mode, "positive")) {
    // unicast: requires recipientAgentId; persists routingMode='unicast'.
    await eng.listTasks();
    const engId = await engineerIdFor(o);
    await arch.createThread("TH18 unicast positive", "msg", {
      routingMode: "unicast",
      recipientAgentId: engId,
    });
    const unicastStored = await o.stores.thread.getThread("thread-1");
    if (unicastStored?.routingMode !== "unicast") {
      fail("TH18", "positive", `unicast thread routingMode should persist as 'unicast'; got '${unicastStored?.routingMode}'`);
    }

    // broadcast: no recipientAgentId; persists routingMode='broadcast'.
    o.reset();
    const arch2 = o.asArchitect();
    await arch2.createThread("TH18 broadcast positive", "msg", { routingMode: "broadcast" });
    const broadcastStored = await o.stores.thread.getThread("thread-1");
    if (broadcastStored?.routingMode !== "broadcast") {
      fail("TH18", "positive", `broadcast thread routingMode should persist as 'broadcast' at open; got '${broadcastStored?.routingMode}'`);
    }
  }

  if (shouldRun(mode, "negativeReject")) {
    // Invalid mode-field combinations rejected at create.
    o.reset();
    const arch3 = o.asArchitect();

    // unicast without recipientAgentId → rejected.
    const unicastBad = await arch3.call("create_thread", {
      title: "TH18 unicast-missing-recipient",
      message: "should fail",
      routingMode: "unicast",
    });
    if (!unicastBad.isError) {
      fail("TH18", "negativeReject", "unicast without recipientAgentId should be rejected");
    }

    // broadcast with recipientAgentId → rejected.
    await (o.asEngineer()).listTasks();
    const broadcastBad = await arch3.call("create_thread", {
      title: "TH18 broadcast-with-recipient",
      message: "should fail",
      routingMode: "broadcast",
      recipientAgentId: "eng-whatever",
    });
    if (!broadcastBad.isError) {
      fail("TH18", "negativeReject", "broadcast with recipientAgentId should be rejected");
    }

    // multicast without context → rejected.
    const multicastBad = await arch3.call("create_thread", {
      title: "TH18 multicast-missing-context",
      message: "should fail",
      routingMode: "multicast",
    });
    if (!multicastBad.isError) {
      fail("TH18", "negativeReject", "multicast without context should be rejected");
    }
  }

  if (shouldRun(mode, "edge")) {
    // Broadcast coerces to unicast on first reply (INV-TH18 spec).
    o.reset();
    const arch4 = o.asArchitect();
    const eng4 = o.asEngineer();
    await arch4.createThread("TH18 broadcast coerce", "open", { routingMode: "broadcast" });

    // Pre-reply: routingMode is broadcast.
    const preReply = await o.stores.thread.getThread("thread-1");
    if (preReply?.routingMode !== "broadcast") {
      fail("TH18", "edge", `pre-reply broadcast expected; got '${preReply?.routingMode}'`);
    }

    // Engineer replies — triggers the INV-TH18 coercion.
    const replyResult = await eng4.call("create_thread_reply", {
      threadId: "thread-1",
      message: "first reply coerces mode",
    });
    if (replyResult.isError) {
      fail("TH18", "edge", `reply on broadcast thread should succeed; got ${JSON.stringify(replyResult)}`);
    }

    const postReply = await o.stores.thread.getThread("thread-1");
    if (postReply?.routingMode !== "unicast") {
      fail("TH18", "edge", `broadcast should coerce to unicast on first reply; got '${postReply?.routingMode}'`);
    }
  }
}

// ── INV-TH19 — Cascade validate-then-execute atomicity (STUBBED) ─────

/**
 * INV-TH19: Cascade atomicity via validate-then-execute at the gate.
 *
 * - Every staged action's validator runs before `staged→committed` promotion.
 * - Any validator failure rejects the whole convergence; thread stays `active`; no partial commit.
 * - Post-gate execute-phase infrastructure failures route the thread to
 *   `cascade_failed` terminal (high-priority alert), never revert committed state.
 *
 * workflow-registry.md §7.2 (ratified thread-125). Graduated from T2
 * stub by Mission-41 Wave 2 task-338. Mock*Client not consumed —
 * TestOrchestrator surface exercises the ThreadPolicy convergence handler
 * + `validateStagedActions` + cascade.ts execute path directly; cascade
 * atomicity is policy-layer, not shim-layer.
 */
export async function assertInvTH19(o: TestOrchestrator, mode: InvariantMode = "all"): Promise<void> {
  const arch = o.asArchitect();
  const eng = o.asEngineer();

  if (shouldRun(mode, "positive")) {
    // Bilateral convergence with valid staged action → atomically committed.
    await eng.listTasks();
    const { threadId } = (await arch.createThread("TH19 positive", "open", { routingMode: "broadcast" })) as { threadId: string };
    await eng.replyToThread(threadId, "agreed", {
      converged: true,
      summary: "Atomic-commit positive scenario",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "positive test" } }],
    });
    o.events.clear();
    await arch.replyToThread(threadId, "agreed", { converged: true });
    const finalized = o.events.expectEvent("thread_convergence_finalized");
    if (finalized.data.committedActionCount !== 1) {
      fail("TH19", "positive", `expected committedActionCount=1; got ${finalized.data.committedActionCount}`);
    }
    if (finalized.data.threadTerminal !== "closed") {
      fail("TH19", "positive", `expected threadTerminal='closed' on clean cascade; got '${finalized.data.threadTerminal}'`);
    }
  }

  if (shouldRun(mode, "negativeReject")) {
    // Stage an invalid-payload action → gate rejects; thread stays active.
    o.reset();
    const arch2 = o.asArchitect();
    const eng2 = o.asEngineer();
    await eng2.listTasks();
    const { threadId } = (await arch2.createThread("TH19 invalid-payload", "open", { routingMode: "broadcast" })) as { threadId: string };
    // create_task schema requires `title` + `description`. Omit description.
    await eng2.replyToThread(threadId, "staging invalid", {
      converged: true,
      summary: "invalid staged action — should reject whole convergence",
      stagedActions: [{ kind: "stage", type: "create_task", payload: { title: "missing description" } }],
    });
    // Architect converges — gate should reject because staged action is invalid.
    const archResult = await arch2.call("create_thread_reply", {
      threadId, message: "attempting to converge", converged: true,
    });
    if (!archResult.isError) {
      fail("TH19", "negativeReject", "bilateral convergence with invalid staged-action payload should reject at the gate");
    }

    // Thread remains active (not converged, not closed).
    const thread = await o.stores.thread.getThread(threadId);
    if (thread?.status !== "active") {
      fail("TH19", "negativeReject", `invalid-payload rejection should leave thread 'active'; got '${thread?.status}'`);
    }
    // No action promoted to committed — still staged (no partial commit).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actions = (thread as any).convergenceActions as Array<{ status: string }>;
    const anyCommitted = actions.some((a) => a.status === "committed");
    if (anyCommitted) {
      fail("TH19", "negativeReject", "no action should be committed when gate rejects; found a 'committed' entry");
    }
  }

  // Edge mode: post-gate execute-phase failure → `cascade_failed`. Not
  // directly forceable without cascade-handler fault injection (cascade
  // handlers don't have a built-in test-only failure hook). Documented
  // here + covered separately by cascade-specific tests (e2e-chaos.test.ts,
  // thread-truncation.test.ts). INV-TH19's edge branch is a no-op at
  // TestOrchestrator level; positive + negativeReject cover the
  // validate-then-execute atomicity gate itself.
}
