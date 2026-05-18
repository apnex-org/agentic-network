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
import { translateGhEvent } from "@apnex/repo-event-bridge";
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

describe("REPO_EVENT_HANDLERS registry (mission-68 W1 §2 + mission-76 W1 bug-46 closure + bug-51 pr-review-approved + idea-255 workflow-run)", () => {
  it("post-idea-255 contains 8 handlers (commit-pushed + 4 PR-event + 3 workflow-run)", () => {
    expect(REPO_EVENT_HANDLERS.length).toBe(8);
    const subkinds = REPO_EVENT_HANDLERS.map((h) => h.subkind);
    expect(subkinds).toContain("commit-pushed");
    expect(subkinds).toContain("pr-opened");
    expect(subkinds).toContain("pr-merged");
    expect(subkinds).toContain("pr-review-submitted");
    expect(subkinds).toContain("pr-review-approved");
    expect(subkinds).toContain("workflow-run-completed");
    expect(subkinds).toContain("workflow-run-dispatched");
    expect(subkinds).toContain("workflow-run-in-progress");
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

  it("findRepoEventHandler resolves pr-opened (mission-76 W1 bug-46 closure)", () => {
    const found = findRepoEventHandler("pr-opened");
    expect(found).not.toBeNull();
    expect(found!.subkind).toBe("pr-opened");
  });

  it("findRepoEventHandler resolves pr-merged (mission-76 W1 bug-46 closure)", () => {
    const found = findRepoEventHandler("pr-merged");
    expect(found).not.toBeNull();
    expect(found!.subkind).toBe("pr-merged");
  });

  it("findRepoEventHandler resolves pr-review-submitted (mission-76 W1 bug-46 closure)", () => {
    const found = findRepoEventHandler("pr-review-submitted");
    expect(found).not.toBeNull();
    expect(found!.subkind).toBe("pr-review-submitted");
  });

  it("findRepoEventHandler returns null for carved-out subkinds (post-bug-51: pr-closed + pr-review-comment per idea-250)", () => {
    // pr-closed / pr-review-comment remain translator-supported but
    // carved out per idea-250 (genuine design-time deferrals with
    // documented promotion triggers). pr-review-approved REMOVED from
    // carve-out list per bug-51 closure (original §3.1.1 + AG-2 rationale
    // was factually incorrect — approved reviews dispatch to a separate
    // subkind that pr-review-submitted never sees).
    expect(findRepoEventHandler("pr-closed")).toBeNull();
    expect(findRepoEventHandler("pr-review-comment")).toBeNull();
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

  // bug-50 audit: confirm commit-pushed Class A + Class B scope-clean.
  //
  // Class A (type-shape mismatch): normalizePush emits
  // {repo, ref, pusher, commitCount, commits} — NO base/head object
  // refs (PushEvent payload has no equivalent surface). Handler reads
  // string-typed pusher/ref/repo + array commits + numeric commitCount.
  // No string-vs-object drift possible.
  //
  // Class B (Events-API null fields): bug-44 already addressed Events-API
  // PushEvent shape (payload.pusher/sender absent → fall back to event-level
  // actor.login). normalizePush at translator.ts:268-296 reads pusher via
  // chained ?? fallback. Commit fields (sha/message/author) are pass-through
  // and not used in handler body construction.
  //
  // The fixture below feeds an Events-API-shape PushEvent (no pusher /
  // sender; only event-level actor) through translateGhEvent → handler to
  // pin the live-runtime contract.
  it("Events-API-shape PushEvent: pusher falls back to actor (bug-44 + bug-50 audit lock-in)", async () => {
    const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
    const ghEvent = {
      type: "PushEvent",
      actor: { login: "apnex-greg" }, // Events-API delivers pusher at event-level
      repo: { name: "apnex-org/agentic-network" },
      payload: {
        ref: "refs/heads/agent-greg/feature",
        // No pusher / sender — Events-API omits these (webhook-only)
        commits: [
          {
            sha: "abc123",
            message: "first commit",
            author: { name: "Greg", email: "g@example.com" },
          },
        ],
      },
    };
    const repoEvent = translateGhEvent(ghEvent);
    const inboundMsg = makeRepoEventMessage(repoEvent);
    const dispatches = await COMMIT_PUSHED_HANDLER.handle(inboundMsg, ctx);
    expect(dispatches).toHaveLength(1);
    const payload = dispatches[0].payload as Record<string, unknown>;
    expect(payload.pusher).toBe("apnex-greg"); // bug-44 actor fallback
    expect(payload.branch).toBe("agent-greg/feature");
    expect(payload.commitCount).toBe(1);
    expect(payload.body).toBe("Engineer pushed 1 commit to agent-greg/feature");
  });

  // ── bug-98 fix tests (mission-84 post-mortem) ────────────────────────

  describe("bug-98 fix: commit-author fallback + architect-agentId resolution", () => {
    it("falls back to commits[0].author when pusher lookup fails (org-credential push case)", async () => {
      // Real-world scenario: GitHub PushEvent actor.login = "apnex" (org-level
      // credential), but commits authored as "apnex-greg" (individual git config).
      // Handler should fall back to commit-author identity for role resolution.
      const ctx = makeCtx([
        makeAgent("eng-A", "engineer", "apnex-greg"),
        makeAgent("arch-B", "architect", "apnex-lily"),
      ]);
      const msg = makeRepoEventMessage({
        kind: "repo-event",
        subkind: "commit-pushed",
        payload: {
          repo: "apnex-org/agentic-network",
          ref: "refs/heads/main",
          pusher: "apnex", // org-credential pusher; unregistered
          commitCount: 2,
          commits: [
            { sha: "abc", message: "first", author: "apnex-greg" },
            { sha: "def", message: "second", author: "apnex-greg" },
          ],
        },
      });

      const dispatches = await COMMIT_PUSHED_HANDLER.handle(msg, ctx);
      expect(dispatches).toHaveLength(1);
      const d = dispatches[0];
      expect(d.kind).toBe("note");
      expect(d.target).toEqual({ role: "architect", agentId: "arch-B" });
      expect(d.intent).toBe("commit-push-thread-heartbeat");
      const payload = d.payload as Record<string, unknown>;
      expect(payload.pusher).toBe("apnex"); // original pusher preserved for forensic trace
      expect(payload.identityResolvedVia).toBe("commit-author");
      expect(payload.resolvedIdentity).toBe("apnex-greg");
    });

    it("skips when BOTH pusher AND commit-author lookups fail (unregistered author class)", async () => {
      const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
      const msg = makeRepoEventMessage({
        kind: "repo-event",
        subkind: "commit-pushed",
        payload: {
          repo: "apnex-org/agentic-network",
          ref: "refs/heads/main",
          pusher: "apnex", // unregistered
          commitCount: 1,
          commits: [{ sha: "x", message: "y", author: "apnex-stranger" }], // also unregistered
        },
      });
      const dispatches = await COMMIT_PUSHED_HANDLER.handle(msg, ctx);
      expect(dispatches).toHaveLength(0);
    });

    it("AG-7 still holds: commit-author fallback resolving to architect → skip (no architect→architect notification)", async () => {
      const ctx = makeCtx([makeAgent("arch-B", "architect", "apnex-lily")]);
      const msg = makeRepoEventMessage({
        kind: "repo-event",
        subkind: "commit-pushed",
        payload: {
          repo: "apnex-org/agentic-network",
          ref: "refs/heads/main",
          pusher: "apnex", // org-credential; falls back to commit-author
          commitCount: 1,
          commits: [{ sha: "x", message: "y", author: "apnex-lily" }],
        },
      });
      const dispatches = await COMMIT_PUSHED_HANDLER.handle(msg, ctx);
      expect(dispatches).toHaveLength(0);
    });

    it("resolves target.agentId from architect-role agent when architect registered (inbox-visibility fix)", async () => {
      // Direct case (no commit-author fallback): pusher matches engineer; ctx
      // includes architect → target.agentId pinned to architect's id for
      // strict-filter-query inbox visibility per matchesAdditionalFilters.
      const ctx = makeCtx([
        makeAgent("eng-A", "engineer", "apnex-greg"),
        makeAgent("arch-LILY", "architect", "apnex-lily"),
      ]);
      const msg = makeRepoEventMessage({
        kind: "repo-event",
        subkind: "commit-pushed",
        payload: {
          repo: "apnex-org/agentic-network",
          ref: "refs/heads/main",
          pusher: "apnex-greg",
          commitCount: 1,
          commits: [{ sha: "x", message: "y", author: "apnex-greg" }],
        },
      });
      const dispatches = await COMMIT_PUSHED_HANDLER.handle(msg, ctx);
      expect(dispatches).toHaveLength(1);
      expect(dispatches[0].target).toEqual({ role: "architect", agentId: "arch-LILY" });
      const payload = dispatches[0].payload as Record<string, unknown>;
      expect(payload.identityResolvedVia).toBe("pusher"); // direct path; no fallback fired
      expect(payload.resolvedIdentity).toBe("apnex-greg");
    });

    it("falls back gracefully when no architect registered (target.agentId undefined; broadcast-to-role semantic preserved)", async () => {
      const ctx = makeCtx([makeAgent("eng-A", "engineer", "apnex-greg")]);
      const msg = makeRepoEventMessage({
        kind: "repo-event",
        subkind: "commit-pushed",
        payload: {
          repo: "apnex-org/agentic-network",
          ref: "refs/heads/main",
          pusher: "apnex-greg",
          commitCount: 1,
          commits: [],
        },
      });
      const dispatches = await COMMIT_PUSHED_HANDLER.handle(msg, ctx);
      expect(dispatches).toHaveLength(1);
      expect(dispatches[0].target).toEqual({ role: "architect" }); // no agentId; role-only
    });
  });
});
