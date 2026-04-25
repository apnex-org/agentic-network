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
import { registerMessagePolicy } from "../../src/policy/message-policy.js";
import type { IPolicyContext } from "../../src/policy/types.js";

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

function makeCtx(
  messageStore: MessageRepository,
  registry: MockEngineerRegistry,
  sessionId: string = "test-session",
): IPolicyContext {
  return {
    stores: {
      message: messageStore,
      engineerRegistry: registry,
    } as unknown as IPolicyContext["stores"],
    metrics: { increment: () => {} } as IPolicyContext["metrics"],
    emit: async () => {},
    dispatch: async () => {},
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
  it("registers list_messages and create_message", () => {
    const router = setupRouter();
    const tools = router.getRegisteredTools();
    expect(tools).toContain("list_messages");
    expect(tools).toContain("create_message");
  });

  it("router.size includes the 2 new W6 tools", () => {
    const router = setupRouter();
    expect(router.size).toBe(2);
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
    await messageStore.ackMessage(m1.id);

    const result = await router.handle(
      "list_messages",
      { targetRole: "architect", status: "new" },
      ctx,
    );
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.count).toBe(1);
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
