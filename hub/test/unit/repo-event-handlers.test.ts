/**
 * Mission-68 W1 — Repo-event routing substrate + commit-pushed handler tests.
 *
 * Pins:
 *   - REPO_EVENT_HANDLERS registry seed contains COMMIT_PUSHED_HANDLER
 *   - findRepoEventHandler resolves by subkind; returns null for missing
 *   - lookupRoleByGhLogin resolves AgentLabels `ois.io/github/login` → role
 *   - lookupRoleByGhLogin returns null for unknown login + empty input
 *   - COMMIT_PUSHED_HANDLER emits exactly 1 MessageDispatch for engineer-push
 *   - COMMIT_PUSHED_HANDLER emits 0 dispatches for architect-push (AG-7)
 *   - COMMIT_PUSHED_HANDLER emits 0 dispatches for unknown-login (log + skip)
 *   - Body shape: terse "Engineer pushed N commits to <branch>" + structured payload
 *   - Branch ref normalization: refs/heads/<branch> → <branch>
 */

import { describe, expect, it } from "vitest";
import {
  REPO_EVENT_HANDLERS,
  findRepoEventHandler,
} from "../../src/policy/repo-event-handlers.js";
import {
  lookupRoleByGhLogin,
  GITHUB_LOGIN_LABEL,
} from "../../src/policy/repo-event-author-lookup.js";
import { COMMIT_PUSHED_HANDLER } from "../../src/policy/repo-event-commit-pushed-handler.js";
import type { Message } from "../../src/entities/index.js";
import type { IPolicyContext } from "../../src/policy/types.js";
import type { Agent, AgentRole } from "../../src/state.js";

// ── Helper: minimal IPolicyContext with mockable agent registry ──────

function makeAgent(id: string, role: AgentRole, ghLogin?: string): Agent {
  return {
    id,
    fingerprint: `fp-${id}`,
    role,
    status: "online",
    archived: false,
    sessionEpoch: 1,
    currentSessionId: null,
    clientMetadata: {
      clientName: "test",
      clientVersion: "0.0.0",
      proxyName: "test",
      proxyVersion: "0.0.0",
    },
    advisoryTags: {},
    labels: ghLogin ? { [GITHUB_LOGIN_LABEL]: ghLogin } : {},
    firstSeenAt: "2026-05-01T00:00:00Z",
    lastSeenAt: "2026-05-01T00:00:00Z",
    livenessState: "online",
    lastHeartbeatAt: "2026-05-01T00:00:00Z",
    receiptSla: 60_000,
    wakeEndpoint: null,
    name: id,
    activityState: "online_idle",
    sessionStartedAt: null,
    lastToolCallAt: null,
    lastToolCallName: null,
    idleSince: null,
    workingSince: null,
    quotaBlockedUntil: null,
    adapterVersion: "test@0.0.0",
    ipAddress: null,
    restartCount: 0,
    recentErrors: [],
    restartHistoryMs: [],
  };
}

function makeCtx(agents: Agent[]): IPolicyContext {
  return {
    stores: {
      engineerRegistry: {
        listAgents: async () => agents,
      },
    },
    metrics: { increment: () => {} },
    emit: async () => {},
    dispatch: async () => {},
    sessionId: "test",
    clientIp: "127.0.0.1",
    role: "system",
    internalEvents: [],
    config: { storageBackend: "memory", gcsBucket: "" },
  } as unknown as IPolicyContext;
}

function makeRepoEventMessage(payload: unknown): Message {
  return {
    id: "01TEST",
    kind: "external-injection",
    authorRole: "architect",
    authorAgentId: "anonymous-architect",
    target: null,
    delivery: "push-immediate",
    payload,
    status: "new",
    createdAt: "2026-05-01T00:00:00Z",
  } as unknown as Message;
}

// ── Registry tests ────────────────────────────────────────────────────

describe("REPO_EVENT_HANDLERS registry (mission-68 W1 §2)", () => {
  it("seeds COMMIT_PUSHED_HANDLER (Path C ships ONE handler)", () => {
    expect(REPO_EVENT_HANDLERS.length).toBeGreaterThanOrEqual(1);
    const subkinds = REPO_EVENT_HANDLERS.map((h) => h.subkind);
    expect(subkinds).toContain("commit-pushed");
  });

  it("each handler has subkind + name + handle function", () => {
    for (const h of REPO_EVENT_HANDLERS) {
      expect(h.subkind).toBeTruthy();
      expect(h.name).toBeTruthy();
      expect(typeof h.handle).toBe("function");
    }
  });

  it("findRepoEventHandler resolves commit-pushed", () => {
    const found = findRepoEventHandler("commit-pushed");
    expect(found).not.toBeNull();
    expect(found!.subkind).toBe("commit-pushed");
  });

  it("findRepoEventHandler returns null for unregistered subkind (caller logs WARN)", () => {
    const found = findRepoEventHandler("pr-opened");
    expect(found).toBeNull();
  });
});

// ── Author-lookup primitive tests ─────────────────────────────────────

describe("lookupRoleByGhLogin (mission-68 W1 §2.2; AgentLabels approach)", () => {
  it("resolves login → role via ois.io/github/login label", async () => {
    const ctx = makeCtx([
      makeAgent("eng-A", "engineer", "apnex-greg"),
      makeAgent("eng-B", "architect", "apnex-lily"),
    ]);
    expect(await lookupRoleByGhLogin("apnex-greg", ctx)).toBe("engineer");
    expect(await lookupRoleByGhLogin("apnex-lily", ctx)).toBe("architect");
  });

  it("returns null for unknown login (no agent has the label)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    expect(await lookupRoleByGhLogin("apnex-stranger", ctx)).toBeNull();
  });

  it("returns null for empty / non-string input", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    expect(await lookupRoleByGhLogin("", ctx)).toBeNull();
  });

  it("returns null for agents without the label set (legacy registrations)", async () => {
    const ctx = makeCtx([
      makeAgent("eng-A", "engineer"), // no ghLogin label
    ]);
    expect(await lookupRoleByGhLogin("apnex-greg", ctx)).toBeNull();
  });
});

// ── COMMIT_PUSHED_HANDLER tests ───────────────────────────────────────

describe("COMMIT_PUSHED_HANDLER (mission-68 W1 §3)", () => {
  it("emits 1 dispatch for engineer-push (kind=note + target.role=architect; terse body + structured payload per M2)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "commit-pushed",
      payload: {
        repo: "apnex-org/agentic-network",
        ref: "refs/heads/feature-branch",
        pusher: "apnex-greg",
        commitCount: 3,
        commits: [
          { sha: "abc", message: "first", author: "apnex-greg" },
          { sha: "def", message: "second", author: "apnex-greg" },
          { sha: "ghi", message: "third", author: "apnex-greg" },
        ],
      },
    });

    const dispatches = await COMMIT_PUSHED_HANDLER.handle(msg, ctx);
    expect(dispatches).toHaveLength(1);
    const d = dispatches[0];
    expect(d.kind).toBe("note");
    expect(d.target).toEqual({ role: "architect" });
    expect(d.intent).toBe("commit-push-thread-heartbeat");
    // Terse body per M2 fold (#41 STRUCTURAL ANCHOR)
    const payload = d.payload as Record<string, unknown>;
    expect(payload.body).toBe("Engineer pushed 3 commits to feature-branch");
    // Structured payload sub-fields for adapter-side rendering
    expect(payload.pusher).toBe("apnex-greg");
    expect(payload.branch).toBe("feature-branch");
    expect(payload.commitCount).toBe(3);
    expect(Array.isArray(payload.commits)).toBe(true);
    expect((payload.commits as unknown[]).length).toBe(3);
    expect(payload.repo).toBe("apnex-org/agentic-network");
    expect(payload.sourceMessageId).toBe("01TEST");
  });

  it("singularizes commit count in body (1 commit, not 1 commits)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "commit-pushed",
      payload: {
        repo: "apnex-org/agentic-network",
        ref: "refs/heads/main",
        pusher: "apnex-greg",
        commitCount: 1,
        commits: [{ sha: "abc", message: "fix", author: "apnex-greg" }],
      },
    });
    const dispatches = await COMMIT_PUSHED_HANDLER.handle(msg, ctx);
    expect((dispatches[0].payload as Record<string, unknown>).body).toBe(
      "Engineer pushed 1 commit to main",
    );
  });

  it("emits 0 dispatches for architect-push (AG-7 anti-goal; symmetric coverage deferred to idea-227)", async () => {
    const ctx = makeCtx([makeAgent("eng-B", "architect", "apnex-lily")]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "commit-pushed",
      payload: {
        repo: "apnex-org/agentic-network",
        ref: "refs/heads/feature-branch",
        pusher: "apnex-lily",
        commitCount: 2,
        commits: [],
      },
    });
    const dispatches = await COMMIT_PUSHED_HANDLER.handle(msg, ctx);
    expect(dispatches).toHaveLength(0);
  });

  it("emits 0 dispatches for unknown-login (log + skip; non-fatal)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "commit-pushed",
      payload: {
        repo: "apnex-org/agentic-network",
        ref: "refs/heads/main",
        pusher: "apnex-stranger", // not registered
        commitCount: 1,
        commits: [],
      },
    });
    const dispatches = await COMMIT_PUSHED_HANDLER.handle(msg, ctx);
    expect(dispatches).toHaveLength(0);
  });

  it("handles malformed inbound (missing payload.payload) by skipping non-fatally", async () => {
    const ctx = makeCtx([]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "commit-pushed",
      // missing nested payload
    });
    const dispatches = await COMMIT_PUSHED_HANDLER.handle(msg, ctx);
    expect(dispatches).toHaveLength(0);
  });

  it("handles missing pusher gracefully (skip; non-fatal)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "commit-pushed",
      payload: {
        repo: "apnex-org/agentic-network",
        ref: "refs/heads/main",
        // pusher missing
        commitCount: 1,
        commits: [],
      },
    });
    const dispatches = await COMMIT_PUSHED_HANDLER.handle(msg, ctx);
    expect(dispatches).toHaveLength(0);
  });

  it("normalizes refs/heads/ prefix from branch ref", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const msg = makeRepoEventMessage({
      kind: "repo-event",
      subkind: "commit-pushed",
      payload: {
        repo: "apnex-org/agentic-network",
        ref: "refs/heads/agent-lily/idea-224",
        pusher: "apnex-greg",
        commitCount: 1,
        commits: [],
      },
    });
    const dispatches = await COMMIT_PUSHED_HANDLER.handle(msg, ctx);
    expect((dispatches[0].payload as Record<string, unknown>).branch).toBe(
      "agent-lily/idea-224",
    );
  });
});
