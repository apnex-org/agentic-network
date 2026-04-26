/**
 * Mission-51 W6 — MessagePolicy MCP-verb unit tests.
 *
 * Covers: list_messages query-shape correctness; create_message
 * authorization-axis enforcement (any/director-only/self-only);
 * scheduled-delivery validation (fireAt required); end-to-end shape
 * preservation (created Message has expected fields).
 *
 * Tests use a stub IPolicyContext + the existing MessageRepository
 * + a minimal engineerRegistry stub; full integration with thread-
 * policy + cascade-runner is exercised by existing e2e tests
 * post-W6 (the orchestrator router includes message-policy).
 */

import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "@ois/storage-provider";

import { MessageRepository } from "../../src/entities/message-repository.js";
import { PolicyRouter } from "../../src/policy/router.js";
import { registerMessagePolicy, pushSelector } from "../../src/policy/message-policy.js";
import type { IPolicyContext } from "../../src/policy/types.js";
import type { Selector } from "../../src/state.js";

interface MockEngineerRegistry {
  getRole(sessionId: string): string;
  getAgentForSession(sessionId: string): Promise<{ engineerId: string; currentSessionId: string } | null>;
  claimSession?: (...args: unknown[]) => Promise<unknown>;
}

function makeRegistry(role: string, agentId: string, sessionId: string = "test-session"): MockEngineerRegistry {
  return {
    getRole: () => role,
    // Return currentSessionId matching ctx.sessionId so the router's
    // auto-claim branch doesn't fire (its claimSession isn't stubbed).
    getAgentForSession: async () => ({ engineerId: agentId, currentSessionId: sessionId }),
  };
}

interface DispatchCall {
  event: string;
  data: Record<string, unknown>;
  selector: Selector;
}

function makeCtx(
  messageStore: MessageRepository,
  registry: MockEngineerRegistry,
  sessionId: string = "test-session",
  dispatchCalls?: DispatchCall[],
  dispatchImpl?: (event: string, data: Record<string, unknown>, selector: Selector) => Promise<void>,
): IPolicyContext {
  const dispatch = dispatchImpl ?? (async (event, data, selector) => {
    if (dispatchCalls) dispatchCalls.push({ event, data, selector });
  });
  return {
    stores: {
      message: messageStore,
      engineerRegistry: registry,
    } as unknown as IPolicyContext["stores"],
    metrics: { increment: () => {} } as IPolicyContext["metrics"],
    emit: async () => {},
    dispatch,
    sessionId,
    clientIp: "127.0.0.1",
    role: "engineer",
    internalEvents: [],
    config: { storageBackend: "memory", gcsBucket: "" },
  } as unknown as IPolicyContext;
}

function setupRouter(): PolicyRouter {
  const router = new PolicyRouter(() => {});
  registerMessagePolicy(router);
  return router;
}

describe("registerMessagePolicy — registration", () => {
  it("registers list_messages, create_message, claim_message, ack_message", () => {
    const router = setupRouter();
    const tools = router.getRegisteredTools();
    expect(tools).toContain("list_messages");
    expect(tools).toContain("create_message");
    expect(tools).toContain("claim_message");
    expect(tools).toContain("ack_message");
  });

  it("router.size = 4 (W6 list+create + W3.2 claim+ack)", () => {
    const router = setupRouter();
    expect(router.size).toBe(4);
  });
});

describe("list_messages — query primitives", () => {
  it("returns empty array when no messages match", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"));

    const result = await router.handle("list_messages", { threadId: "no-such-thread" }, ctx);
    expect(result.isError).not.toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.messages).toEqual([]);
    expect(body.count).toBe(0);
  });

  it("filters by threadId and returns messages ordered by sequenceInThread", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"));

    await messageStore.createMessage({
      kind: "reply",
      authorRole: "engineer",
      authorAgentId: "eng-1",
      target: null,
      delivery: "push-immediate",
      threadId: "t-1",
      payload: { text: "first" },
    });
    await messageStore.createMessage({
      kind: "reply",
      authorRole: "architect",
      authorAgentId: "arch-1",
      target: null,
      delivery: "push-immediate",
      threadId: "t-1",
      payload: { text: "second" },
    });
    await messageStore.createMessage({
      kind: "reply",
      authorRole: "engineer",
      authorAgentId: "eng-1",
      target: null,
      delivery: "push-immediate",
      threadId: "t-2",
      payload: { text: "other-thread" },
    });

    const result = await router.handle("list_messages", { threadId: "t-1" }, ctx);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.count).toBe(2);
    expect(body.messages.map((m: { payload: { text: string } }) => m.payload.text)).toEqual(["first", "second"]);
  });

  it("filters by authorAgentId (outbox view)", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"));

    await messageStore.createMessage({
      kind: "note",
      authorRole: "engineer",
      authorAgentId: "eng-1",
      target: null,
      delivery: "push-immediate",
      payload: {},
    });
    await messageStore.createMessage({
      kind: "note",
      authorRole: "engineer",
      authorAgentId: "eng-2",
      target: null,
      delivery: "push-immediate",
      payload: {},
    });

    const result = await router.handle("list_messages", { authorAgentId: "eng-1" }, ctx);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.count).toBe(1);
    expect(body.messages[0].authorAgentId).toBe("eng-1");
  });

  it("combines target + status filters", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"));

    const m1 = await messageStore.createMessage({
      kind: "note",
      authorRole: "engineer",
      authorAgentId: "eng-1",
      target: { role: "architect" },
      delivery: "push-immediate",
      payload: {},
    });
    await messageStore.createMessage({
      kind: "note",
      authorRole: "engineer",
      authorAgentId: "eng-1",
      target: { role: "architect" },
      delivery: "push-immediate",
      payload: {},
    });
    // Mission-56 W3.2: ack now requires prior claim (FSM new→received→acked).
    await messageStore.claimMessage(m1.id, "test-agent");
    await messageStore.ackMessage(m1.id);

    const result = await router.handle(
      "list_messages",
      { targetRole: "architect", status: "new" },
      ctx,
    );
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.count).toBe(1);
  });

  it("since cursor (mission-56 W3.1) flows through args → returns only delta", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"));

    const m1 = await messageStore.createMessage({
      kind: "note",
      authorRole: "engineer",
      authorAgentId: "eng-1",
      target: { role: "architect" },
      delivery: "push-immediate",
      payload: {},
    });
    const m2 = await messageStore.createMessage({
      kind: "note",
      authorRole: "engineer",
      authorAgentId: "eng-1",
      target: { role: "architect" },
      delivery: "push-immediate",
      payload: {},
    });

    const result = await router.handle(
      "list_messages",
      { targetRole: "architect", since: m1.id },
      ctx,
    );
    expect(result.isError).not.toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    // Strict: m1 excluded; only m2 in delta.
    expect(body.count).toBe(1);
    expect(body.messages[0].id).toBe(m2.id);
  });
});

describe("create_message — authorization axes", () => {
  it("allows engineer to create kind=note (any-author)", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"));

    const result = await router.handle(
      "create_message",
      {
        kind: "note",
        target: null,
        delivery: "push-immediate",
        payload: { text: "hello" },
      },
      ctx,
    );
    expect(result.isError).not.toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.messageId).toBeTruthy();
    expect(body.kind).toBe("note");
    expect(body.status).toBe("new");
  });

  it("rejects non-director caller for kind=urgency-flag (director-only)", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"));

    const result = await router.handle(
      "create_message",
      {
        kind: "urgency-flag",
        target: { role: "engineer" },
        payload: {},
      },
      ctx,
    );
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.subtype).toBe("authorization");
    expect(body.error).toMatch(/director author/);
  });

  it("allows director caller for kind=urgency-flag", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("director", "dir-1"));

    const result = await router.handle(
      "create_message",
      {
        kind: "urgency-flag",
        target: { role: "engineer" },
        payload: {},
      },
      ctx,
    );
    expect(result.isError).not.toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.kind).toBe("urgency-flag");
  });

  it("rejects amendment without priorAuthorAgentId (self-only auth gate)", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"));

    const result = await router.handle(
      "create_message",
      {
        kind: "amendment",
        target: null,
        payload: {},
      },
      ctx,
    );
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.error).toMatch(/priorAuthorAgentId/);
  });

  it("accepts amendment when caller agentId matches priorAuthorAgentId", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"));

    const result = await router.handle(
      "create_message",
      {
        kind: "amendment",
        target: null,
        payload: {},
        priorAuthorAgentId: "eng-1",
      },
      ctx,
    );
    expect(result.isError).not.toBe(true);
  });

  it("rejects amendment when caller agentId mismatches priorAuthorAgentId", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"));

    const result = await router.handle(
      "create_message",
      {
        kind: "amendment",
        target: null,
        payload: {},
        priorAuthorAgentId: "eng-2",
      },
      ctx,
    );
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.error).toMatch(/self-only/);
  });
});

describe("create_message — scheduled-delivery validation", () => {
  it("rejects delivery='scheduled' without fireAt", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"));

    const result = await router.handle(
      "create_message",
      {
        kind: "note",
        target: null,
        delivery: "scheduled",
        payload: {},
      },
      ctx,
    );
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.subtype).toBe("validation");
    expect(body.error).toMatch(/fireAt/);
  });

  it("accepts delivery='scheduled' with fireAt; auto-sets scheduledState='pending'", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"));

    const fireAt = new Date(Date.now() + 60_000).toISOString();
    const result = await router.handle(
      "create_message",
      {
        kind: "note",
        target: null,
        delivery: "scheduled",
        payload: { reason: "test" },
        fireAt,
      },
      ctx,
    );
    expect(result.isError).not.toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.scheduledState).toBe("pending");
    // Verify the persisted message has the right fields.
    const persisted = await messageStore.getMessage(body.messageId);
    expect(persisted?.delivery).toBe("scheduled");
    expect(persisted?.fireAt).toBe(fireAt);
    expect(persisted?.scheduledState).toBe("pending");
  });
});

// ── Mission-56 W1a — push-on-Message-create tests ────────────────────

describe("pushSelector — MessageTarget → Selector mapping", () => {
  it("null target → empty selector (broadcast to all online)", () => {
    expect(pushSelector(null)).toEqual({});
  });

  it("target.role → selector.roles", () => {
    expect(pushSelector({ role: "architect" })).toEqual({ roles: ["architect"] });
  });

  it("target.agentId → selector.engineerId", () => {
    expect(pushSelector({ agentId: "eng-7" })).toEqual({ engineerId: "eng-7" });
  });

  it("target.role + target.agentId → both fields (AND filter)", () => {
    expect(pushSelector({ role: "engineer", agentId: "eng-3" })).toEqual({
      roles: ["engineer"],
      engineerId: "eng-3",
    });
  });

  it("target.role === 'system' is omitted (system isn't an Agent role)", () => {
    expect(pushSelector({ role: "system" })).toEqual({});
    expect(pushSelector({ role: "system", agentId: "eng-9" })).toEqual({ engineerId: "eng-9" });
  });
});

describe("create_message — push-on-create (Mission-56 W1a)", () => {
  it("delivery='push-immediate' + target.role → fires message_arrived with role selector", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const dispatchCalls: DispatchCall[] = [];
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"), "test-session", dispatchCalls);

    const result = await router.handle(
      "create_message",
      {
        kind: "note",
        target: { role: "architect" },
        delivery: "push-immediate",
        payload: { hello: "world" },
      },
      ctx,
    );
    expect(result.isError).not.toBe(true);

    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0].event).toBe("message_arrived");
    expect(dispatchCalls[0].selector).toEqual({ roles: ["architect"] });
    // Inline Message envelope
    const dispatched = dispatchCalls[0].data as { message: { id: string; payload: { hello: string } } };
    expect(dispatched.message).toBeTruthy();
    expect(dispatched.message.id).toBeTruthy();
    expect(dispatched.message.payload).toEqual({ hello: "world" });
  });

  it("delivery='push-immediate' + target.agentId → fires with engineerId selector", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const dispatchCalls: DispatchCall[] = [];
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"), "test-session", dispatchCalls);

    await router.handle(
      "create_message",
      {
        kind: "note",
        target: { role: "engineer", agentId: "eng-7" },
        delivery: "push-immediate",
        payload: {},
      },
      ctx,
    );

    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0].selector).toEqual({ roles: ["engineer"], engineerId: "eng-7" });
  });

  it("delivery='push-immediate' + target=null → fires with empty selector (broadcast)", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const dispatchCalls: DispatchCall[] = [];
    const ctx = makeCtx(messageStore, makeRegistry("architect", "arch-1"), "test-session", dispatchCalls);

    await router.handle(
      "create_message",
      {
        kind: "note",
        target: null,
        delivery: "push-immediate",
        payload: {},
      },
      ctx,
    );

    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0].selector).toEqual({});
  });

  it("delivery='queued' → does NOT fire (poll-backstop / sweeper recovery)", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const dispatchCalls: DispatchCall[] = [];
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"), "test-session", dispatchCalls);

    const result = await router.handle(
      "create_message",
      {
        kind: "note",
        target: { role: "architect" },
        delivery: "queued",
        payload: {},
      },
      ctx,
    );
    expect(result.isError).not.toBe(true);
    expect(dispatchCalls).toHaveLength(0);
  });

  it("delivery='scheduled' → does NOT fire (sweeper handles fire-time)", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const dispatchCalls: DispatchCall[] = [];
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"), "test-session", dispatchCalls);

    const result = await router.handle(
      "create_message",
      {
        kind: "note",
        target: null,
        delivery: "scheduled",
        payload: {},
        fireAt: new Date(Date.now() + 60_000).toISOString(),
      },
      ctx,
    );
    expect(result.isError).not.toBe(true);
    expect(dispatchCalls).toHaveLength(0);
  });

  it("dispatch throwing is non-fatal — Message commits regardless", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const dispatchImpl = async () => {
      throw new Error("simulated SSE delivery failure");
    };
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-1"), "test-session", undefined, dispatchImpl);

    const result = await router.handle(
      "create_message",
      {
        kind: "note",
        target: { role: "architect" },
        delivery: "push-immediate",
        payload: { resilient: true },
      },
      ctx,
    );
    // Create succeeds even though dispatch threw.
    expect(result.isError).not.toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.messageId).toBeTruthy();
    // Message is persisted.
    const persisted = await messageStore.getMessage(body.messageId);
    expect(persisted?.payload).toEqual({ resilient: true });
  });
});

describe("create_message — payload + metadata propagation", () => {
  it("propagates intent / semanticIntent / payload verbatim", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("architect", "arch-1"));

    const result = await router.handle(
      "create_message",
      {
        kind: "note",
        target: { role: "engineer" },
        delivery: "push-immediate",
        payload: { foo: "bar", n: 42 },
        intent: "decision_needed",
        semanticIntent: "seek_rigorous_critique",
      },
      ctx,
    );
    expect(result.isError).not.toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    const persisted = await messageStore.getMessage(body.messageId);
    expect(persisted?.payload).toEqual({ foo: "bar", n: 42 });
    expect(persisted?.intent).toBe("decision_needed");
    expect(persisted?.semanticIntent).toBe("seek_rigorous_critique");
    expect(persisted?.target).toEqual({ role: "engineer" });
  });
});

// ── Mission-56 W3.2 — claim_message + ack_message MCP verbs ──────────

describe("claim_message — MCP verb", () => {
  it("flips status new → received and reports wonClaim=true for the winner", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-A"));

    const m = await messageStore.createMessage({
      kind: "note",
      authorRole: "architect",
      authorAgentId: "arch-1",
      target: { role: "engineer" },
      delivery: "push-immediate",
      payload: {},
    });

    const result = await router.handle("claim_message", { id: m.id }, ctx);
    expect(result.isError).not.toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.wonClaim).toBe(true);
    expect(body.callerAgentId).toBe("eng-A");
    expect(body.message.status).toBe("received");
    expect(body.message.claimedBy).toBe("eng-A");
  });

  it("multi-agent same-role: loser observes wonClaim=false (sees winner's claimedBy)", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctxA = makeCtx(
      messageStore,
      makeRegistry("engineer", "eng-A", "session-A"),
      "session-A",
    );
    const ctxB = makeCtx(
      messageStore,
      makeRegistry("engineer", "eng-B", "session-B"),
      "session-B",
    );

    const m = await messageStore.createMessage({
      kind: "note",
      authorRole: "architect",
      authorAgentId: "arch-1",
      target: { role: "engineer" },
      delivery: "push-immediate",
      payload: {},
    });

    // eng-A wins.
    await router.handle("claim_message", { id: m.id }, ctxA);
    // eng-B loses.
    const result = await router.handle("claim_message", { id: m.id }, ctxB);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.wonClaim).toBe(false);
    expect(body.callerAgentId).toBe("eng-B");
    expect(body.message.status).toBe("received");
    expect(body.message.claimedBy).toBe("eng-A");
  });

  it("missing id arg returns validation error", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-A"));

    const result = await router.handle("claim_message", {}, ctx);
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.subtype).toBe("validation");
  });

  it("non-existent Message returns not_found error", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-A"));

    const result = await router.handle("claim_message", { id: "missing-ulid" }, ctx);
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.subtype).toBe("not_found");
  });
});

describe("ack_message — MCP verb", () => {
  it("flips status received → acked when called after claim", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-A"));

    const m = await messageStore.createMessage({
      kind: "note",
      authorRole: "architect",
      authorAgentId: "arch-1",
      target: { role: "engineer" },
      delivery: "push-immediate",
      payload: {},
    });
    await router.handle("claim_message", { id: m.id }, ctx);

    const result = await router.handle("ack_message", { id: m.id }, ctx);
    expect(result.isError).not.toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.acked).toBe(true);
    expect(body.message.status).toBe("acked");
    // claimedBy preserved across ack flip.
    expect(body.message.claimedBy).toBe("eng-A");
  });

  it("ack on `new` (skip-claim) is a no-op (acked=false; status stays new)", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-A"));

    const m = await messageStore.createMessage({
      kind: "note",
      authorRole: "architect",
      authorAgentId: "arch-1",
      target: { role: "engineer" },
      delivery: "push-immediate",
      payload: {},
    });

    const result = await router.handle("ack_message", { id: m.id }, ctx);
    expect(result.isError).not.toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.acked).toBe(false);
    expect(body.message.status).toBe("new");
  });

  it("idempotent on already-acked (acked=true; second call returns same state)", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-A"));

    const m = await messageStore.createMessage({
      kind: "note",
      authorRole: "architect",
      authorAgentId: "arch-1",
      target: { role: "engineer" },
      delivery: "push-immediate",
      payload: {},
    });
    await router.handle("claim_message", { id: m.id }, ctx);
    await router.handle("ack_message", { id: m.id }, ctx);

    const result = await router.handle("ack_message", { id: m.id }, ctx);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.acked).toBe(true);
    expect(body.message.status).toBe("acked");
  });

  it("missing id arg returns validation error", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-A"));

    const result = await router.handle("ack_message", {}, ctx);
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.subtype).toBe("validation");
  });

  it("non-existent Message returns not_found error", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-A"));

    const result = await router.handle("ack_message", { id: "missing-ulid" }, ctx);
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.subtype).toBe("not_found");
  });

  it("status filter on list_messages excludes received + acked (W3.3 poll-backstop pattern)", async () => {
    const router = setupRouter();
    const messageStore = new MessageRepository(new MemoryStorageProvider());
    const ctx = makeCtx(messageStore, makeRegistry("engineer", "eng-A"));

    const m1 = await messageStore.createMessage({
      kind: "note",
      authorRole: "architect",
      authorAgentId: "arch-1",
      target: { role: "engineer" },
      delivery: "push-immediate",
      payload: {},
    });
    const m2 = await messageStore.createMessage({
      kind: "note",
      authorRole: "architect",
      authorAgentId: "arch-1",
      target: { role: "engineer" },
      delivery: "push-immediate",
      payload: {},
    });
    await messageStore.createMessage({
      kind: "note",
      authorRole: "architect",
      authorAgentId: "arch-1",
      target: { role: "engineer" },
      delivery: "push-immediate",
      payload: {},
    });
    // m1 received-only; m2 received+acked; m3 stays new.
    await router.handle("claim_message", { id: m1.id }, ctx);
    await router.handle("claim_message", { id: m2.id }, ctx);
    await router.handle("ack_message", { id: m2.id }, ctx);

    const result = await router.handle(
      "list_messages",
      { targetRole: "engineer", status: "new" },
      ctx,
    );
    const body = JSON.parse((result.content[0] as { text: string }).text);
    // Only m3 (status: new); m1 (received) + m2 (acked) excluded.
    expect(body.count).toBe(1);
  });
});
