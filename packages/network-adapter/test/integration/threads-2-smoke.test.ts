/**
 * Threads 2.0 — 3-agent smoke harness (Mission-21 Phase 1, INV-TH16/TH17).
 *
 * Layer:   L7 (McpAgentClient) ↔ LoopbackTransport ↔ PolicyLoopbackHub
 *          (real PolicyRouter + in-memory stores, all 13 policies)
 *
 * Scope:   Drive every documented thread workflow end-to-end against the
 *          real Hub policy surface, with three live agents (one architect,
 *          two engineers). Validates:
 *            • turn alternation, gate rejection, cascade close_no_action
 *            • staged / revised / retracted lineage
 *            • participant upsert + authorAgentId attach
 *            • summary refinement across rounds
 *            • round-limit termination
 *            • participant-scoped routing: eng-2 does not receive events
 *              belonging to an eng-1↔architect thread
 *            • engineer↔engineer threads: architect stays silent;
 *              non-participant engineers cannot usurp the reply turn
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { LoopbackTransport } from "../helpers/loopback-transport.js";
import { PolicyLoopbackHub } from "../helpers/policy-loopback.js";
import { waitFor, LogCapture } from "../helpers/test-utils.js";
import { McpAgentClient } from "../../src/kernel/mcp-agent-client.js";
import type { AgentEvent } from "../../src/kernel/agent-client.js";

interface ActorHandle {
  client: McpAgentClient;
  transport: LoopbackTransport;
  agentId: string;
  actionable: AgentEvent[];
}

async function createActor(
  hub: PolicyLoopbackHub,
  role: "architect" | "engineer",
  labels?: Record<string, string>,
): Promise<ActorHandle> {
  const transport = new LoopbackTransport(hub);
  const log = new LogCapture();
  const actionable: AgentEvent[] = [];
  const client = new McpAgentClient(
    {
      role,
      labels,
      handshake: {
        globalInstanceId: `loopback-${role}-${randomUUID()}`,
        proxyName: "threads-smoke",
        proxyVersion: "0.0.0",
        transport: "loopback",
        sdkVersion: "0.0.0",
        getClientInfo: () => ({ name: "threads-smoke", version: "0.0.0" }),
      },
      logger: log.logger,
    },
    { transport },
  );
  client.setCallbacks({ onActionableEvent: (ev) => actionable.push(ev) });
  await client.start();
  await waitFor(() => client.isConnected, 5_000);
  const loopbackSid = transport.getSessionId();
  if (!loopbackSid) throw new Error("LoopbackTransport did not bind a session id");
  const agentId = await hub.agentIdForSession(loopbackSid);
  if (!agentId) throw new Error(`Agent entity was not created for session ${loopbackSid}`);
  return { client, transport, agentId, actionable };
}

async function stopAll(actors: ActorHandle[]): Promise<void> {
  for (const a of actors) {
    try { await a.client.stop(); } catch { /* already torn down */ }
  }
}

function eventsFor(actor: ActorHandle, event: string, threadId?: string): AgentEvent[] {
  return actor.actionable.filter((e) => {
    if (e.event !== event) return false;
    if (threadId && (e.data as any)?.threadId !== threadId) return false;
    return true;
  });
}

// Parse JSON text from a tool-call result, tolerating either a raw object
// or { content: [{ text }] } shape depending on transport path.
function parseResult(raw: unknown): any {
  if (raw && typeof raw === "object" && "content" in (raw as any)) {
    const text = (raw as any).content?.[0]?.text;
    if (typeof text === "string") return JSON.parse(text);
  }
  return raw;
}

describe("Threads 2.0 — 3-agent smoke (Mission-21 Phase 1)", () => {
  let hub: PolicyLoopbackHub;
  let arch: ActorHandle;
  let eng1: ActorHandle;
  let eng2: ActorHandle;

  beforeEach(async () => {
    hub = new PolicyLoopbackHub();
    arch = await createActor(hub, "architect");
    eng1 = await createActor(hub, "engineer");
    eng2 = await createActor(hub, "engineer");
  });

  afterEach(async () => {
    await stopAll([arch, eng1, eng2]);
  });

  // ── WF-TH-01/10: architect↔engineer isolation on open ─────────────

  it("WF-TH-10 open: eng-1 → architect thread pins architect; eng-2 not notified", async () => {
    await eng1.client.call("create_thread", {
      title: "eng1 to arch",
      message: "hello architect",
      recipientAgentId: arch.agentId,
    });
    await waitFor(() => eventsFor(arch, "thread_message").length === 1, 2_000);
    expect(eventsFor(arch, "thread_message")).toHaveLength(1);
    expect(eventsFor(eng2, "thread_message")).toHaveLength(0);
  });

  // ── WF-TH-02/14: turn alternation + wrong-party rejection ─────────

  it("WF-TH-02 + WF-TH-14: turn alternation; wrong-party replies rejected", async () => {
    const r = parseResult(await eng1.client.call("create_thread", {
      title: "turn test",
      message: "open",
      recipientAgentId: arch.agentId,
    }));
    const threadId = r.threadId;

    // Architect replies — OK (arch has the turn).
    const r2 = parseResult(await arch.client.call("create_thread_reply", {
      threadId, message: "reply-1",
    }));
    expect(r2.isError).toBeFalsy();
    expect(r2.currentTurn).toBe("engineer");

    // eng-2 (not a participant) tries to reply — blocked by turn pin.
    const r3 = parseResult(await eng2.client.call("create_thread_reply", {
      threadId, message: "sneak",
    }));
    expect(r3.success).toBe(false);

    // eng-1 replies — OK (participant).
    const r4 = parseResult(await eng1.client.call("create_thread_reply", {
      threadId, message: "reply-2",
    }));
    expect(r4.isError).toBeFalsy();
    expect(r4.currentTurn).toBe("architect");
  });

  // ── WF-TH-03/04: gate rejection paths ─────────────────────────────

  it("WF-TH-03: gate rejects converged=true when summary empty", async () => {
    const r = parseResult(await eng1.client.call("create_thread", {
      title: "gate test", message: "open", recipientAgentId: arch.agentId,
    }));
    const threadId = r.threadId;
    // Arch stages action, does not author summary, sets converged=true.
    await arch.client.call("create_thread_reply", {
      threadId, message: "stage only", converged: true,
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "r" } }],
    });
    // Eng-1 attempts to converge → gate fires on summary-empty.
    const r2 = parseResult(await eng1.client.call("create_thread_reply", {
      threadId, message: "agree", converged: true,
    }));
    expect(r2.success).toBe(false);
    expect(r2.error).toMatch(/summary is empty/);
  });

  it("WF-TH-04: gate rejects converged=true when no stagedActions", async () => {
    const r = parseResult(await eng1.client.call("create_thread", {
      title: "gate test 2", message: "open", recipientAgentId: arch.agentId,
    }));
    const threadId = r.threadId;
    await arch.client.call("create_thread_reply", {
      threadId, message: "summary only", converged: true, summary: "agreed",
    });
    const r2 = parseResult(await eng1.client.call("create_thread_reply", {
      threadId, message: "agree", converged: true,
    }));
    expect(r2.success).toBe(false);
    expect(r2.error).toMatch(/no convergenceActions committed/);
  });

  // ── WF-TH-05: bilateral convergence with close_no_action ──────────

  it("WF-TH-05 + WF-TH-12: close_no_action bilateral convergence + cascade close", async () => {
    const r = parseResult(await eng1.client.call("create_thread", {
      title: "happy path", message: "open", recipientAgentId: arch.agentId,
    }));
    const threadId = r.threadId;

    await arch.client.call("create_thread_reply", {
      threadId, message: "stage + summary", converged: true, summary: "All good.",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "done" } }],
    });
    const r2 = parseResult(await eng1.client.call("create_thread_reply", {
      threadId, message: "confirm", converged: true,
    }));
    expect(["converged", "closed"]).toContain(r2.status);
    expect(r2.convergenceActions).toHaveLength(1);
    expect(r2.convergenceActions[0].status).toBe("committed");

    // Mission-24 Phase 2 (M24-T3): merged thread_convergence_finalized
    // replaces the legacy thread_converged + thread_convergence_completed
    // pair, carrying the full ConvergenceReport in one delivery.
    const cascadeEvents = hub.dispatched.filter((d) => d.event === "thread_convergence_finalized");
    expect(cascadeEvents.length).toBeGreaterThanOrEqual(1);
    expect(cascadeEvents[0].data.report).toBeDefined();
    expect((cascadeEvents[0].data as any).committedActionCount).toBe(1);
    expect((cascadeEvents[0].data as any).executedCount).toBe(1);

    // Participant isolation on cascade: eng-2 did not receive.
    expect(eventsFor(eng2, "thread_convergence_finalized", threadId)).toHaveLength(0);
  });

  // ── WF-TH-06: stage → revise → retract lineage ────────────────────

  it("WF-TH-06: stage → revise → retract lineage", async () => {
    const r = parseResult(await eng1.client.call("create_thread", {
      title: "lineage", message: "open", recipientAgentId: arch.agentId,
    }));
    const threadId = r.threadId;

    const r1 = parseResult(await arch.client.call("create_thread_reply", {
      threadId, message: "stage",
      stagedActions: [{ kind: "stage", type: "close_no_action", payload: { reason: "first" } }],
    }));
    expect(r1.convergenceActions[0].id).toBe("action-1");
    expect(r1.convergenceActions[0].status).toBe("staged");

    const r2 = parseResult(await eng1.client.call("create_thread_reply", {
      threadId, message: "revise",
      stagedActions: [{ kind: "revise", id: "action-1", payload: { reason: "second" } }],
    }));
    const revised = r2.convergenceActions.find((a: any) => a.id === "action-1");
    const superseding = r2.convergenceActions.find((a: any) => a.revisionOf === "action-1");
    expect(revised.status).toBe("revised");
    expect(superseding.status).toBe("staged");
    expect(superseding.payload.reason).toBe("second");

    const r3 = parseResult(await arch.client.call("create_thread_reply", {
      threadId, message: "retract",
      stagedActions: [{ kind: "retract", id: superseding.id }],
    }));
    const finalAction = r3.convergenceActions.find((a: any) => a.id === superseding.id);
    expect(finalAction.status).toBe("retracted");
  });

  // ── WF-TH-07: round limit termination ─────────────────────────────

  it("WF-TH-07: roundCount == maxRounds transitions to round_limit", async () => {
    const r = parseResult(await eng1.client.call("create_thread", {
      title: "short", message: "open", maxRounds: 2, recipientAgentId: arch.agentId,
    }));
    const threadId = r.threadId;
    // Round 1 is the open; round 2 should trigger round_limit.
    const r2 = parseResult(await arch.client.call("create_thread_reply", {
      threadId, message: "round 2",
    }));
    expect(r2.status).toBe("round_limit");
  });

  // ── WF-TH-08/09: authorAgentId + participant upsert ──────────────

  it("WF-TH-08 + WF-TH-09: authorAgentId on every message; participant upsert is idempotent", async () => {
    const r = parseResult(await eng1.client.call("create_thread", {
      title: "participants", message: "open", recipientAgentId: arch.agentId,
    }));
    const threadId = r.threadId;
    await arch.client.call("create_thread_reply", { threadId, message: "arch 1" });
    await eng1.client.call("create_thread_reply", { threadId, message: "eng 1 repeat" });

    const thread = parseResult(await arch.client.call("get_thread", { threadId }));
    expect(thread.messages.length).toBe(3);
    for (const msg of thread.messages) {
      expect("authorAgentId" in msg).toBe(true);
      expect(typeof msg.authorAgentId).toBe("string");
    }
    // Three rounds, two unique (role, agentId) tuples — upsert is idempotent.
    // eng-1 opened + replied; arch replied once. The participants list must
    // stay at 2 entries (not 3). `lastActiveAt` monotonicity is intentionally
    // not asserted here: three rounds can land within the same millisecond
    // on a fast loopback (ISO-string resolution). The idempotency property
    // is what this test pins.
    expect(thread.participants).toHaveLength(2);
    const engEntry = thread.participants.find((p: any) => p.agentId === eng1.agentId);
    expect(engEntry).toBeDefined();
    expect(engEntry.role).toBe("engineer");
  });

  // ── WF-TH-11/15: engineer↔engineer isolation ─────────────────────

  it("WF-TH-11: eng-1 ↔ eng-2 thread; architect silent, both engineers on participants", async () => {
    const r = parseResult(await eng1.client.call("create_thread", {
      title: "peer review", message: "hey eng-2", recipientAgentId: eng2.agentId,
    }));
    const threadId = r.threadId;

    await waitFor(() => eventsFor(eng2, "thread_message", threadId).length === 1, 2_000);
    expect(eventsFor(arch, "thread_message", threadId)).toHaveLength(0);
    expect(eventsFor(eng2, "thread_message", threadId)).toHaveLength(1);

    // eng-2 replies; eng-1 gets the bounce, arch stays silent.
    await eng2.client.call("create_thread_reply", { threadId, message: "hi eng-1" });
    await waitFor(() => eventsFor(eng1, "thread_message", threadId).length === 1, 2_000);
    expect(eventsFor(eng1, "thread_message", threadId)).toHaveLength(1);
    expect(eventsFor(arch, "thread_message", threadId)).toHaveLength(0);

    const thread = parseResult(await eng1.client.call("get_thread", { threadId }));
    const ids = thread.participants.map((p: any) => p.agentId).sort();
    expect(ids).toEqual([eng1.agentId, eng2.agentId].sort());
  });

  it("WF-TH-15: non-participant engineer cannot usurp the turn on eng↔eng thread", async () => {
    const r = parseResult(await eng1.client.call("create_thread", {
      title: "peer review 2", message: "hey eng-2", recipientAgentId: eng2.agentId,
    }));
    const threadId = r.threadId;
    // Architect tries to reply — blocked (currentTurn=engineer + pin=eng2).
    const r1 = parseResult(await arch.client.call("create_thread_reply", {
      threadId, message: "archs say", converged: false,
    }));
    expect(r1.success).toBe(false);
  });

  // ── WF-TH-13: summary refinement across rounds ────────────────────

  it("WF-TH-13: latest-author's summary persists; earlier values are overwritten", async () => {
    const r = parseResult(await eng1.client.call("create_thread", {
      title: "summary refinement", message: "open", recipientAgentId: arch.agentId,
    }));
    const threadId = r.threadId;
    await arch.client.call("create_thread_reply", {
      threadId, message: "first draft", summary: "Draft A",
    });
    const reply = parseResult(await eng1.client.call("create_thread_reply", {
      threadId, message: "refine", summary: "Final summary",
    }));
    expect(reply.summary).toBe("Final summary");
  });
});
