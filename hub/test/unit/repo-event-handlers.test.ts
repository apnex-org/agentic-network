/**
 * Repo-event routing substrate tests (mission-68 W1 + mission-76 + idea-255).
 *
 * mission-85 retired COMMIT_PUSHED_HANDLER per CROSS-LAYER IDENTITY EXTRACTION
 * calibration (see `docs/designs/m-commit-pushed-handler-retirement-design.md`).
 * Post-retirement registry pinned to 7 handlers (4 PR-event + 3 workflow-run).
 *
 * Pins:
 *   - REPO_EVENT_HANDLERS registry seed contains 7 post-mission-85 handlers
 *   - REPO_EVENT_HANDLERS registry seed does NOT contain commit-pushed (AG-4)
 *   - findRepoEventHandler resolves by subkind; returns null for missing
 *   - findRepoEventHandler returns null for commit-pushed (mission-85 retirement)
 *   - lookupRoleByGhLogin resolves AgentLabels `ois.io/github/login` → role
 *   - lookupRoleByGhLogin returns null for unknown login + empty input
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

// ── Registry tests ────────────────────────────────────────────────────

describe("REPO_EVENT_HANDLERS registry (mission-68 + mission-76 + idea-255 + mission-85 retirement)", () => {
  it("post-mission-85 contains 7 handlers (4 PR-event + 3 workflow-run; commit-pushed RETIRED)", () => {
    expect(REPO_EVENT_HANDLERS.length).toBe(7);
    const subkinds = REPO_EVENT_HANDLERS.map((h) => h.subkind);
    expect(subkinds).toContain("pr-opened");
    expect(subkinds).toContain("pr-merged");
    expect(subkinds).toContain("pr-review-submitted");
    expect(subkinds).toContain("pr-review-approved");
    expect(subkinds).toContain("workflow-run-completed");
    expect(subkinds).toContain("workflow-run-dispatched");
    expect(subkinds).toContain("workflow-run-in-progress");
  });

  it("AG-4 (mission-85): registry does NOT contain COMMIT_PUSHED_HANDLER (commit-pushed retired)", () => {
    const subkinds = REPO_EVENT_HANDLERS.map((h) => h.subkind);
    expect(subkinds).not.toContain("commit-pushed");
    const names = REPO_EVENT_HANDLERS.map((h) => h.name);
    expect(names).not.toContain("commit-pushed-handler");
  });

  it("each handler has subkind + name + handle function", () => {
    for (const h of REPO_EVENT_HANDLERS) {
      expect(h.subkind).toBeTruthy();
      expect(h.name).toBeTruthy();
      expect(typeof h.handle).toBe("function");
    }
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

  it("findRepoEventHandler returns null for retired + carved-out subkinds", () => {
    // commit-pushed RETIRED per mission-85 (CROSS-LAYER IDENTITY EXTRACTION
    // calibration; bug-98 wontfix). pr-closed / pr-review-comment remain
    // translator-supported but carved out per idea-250 (genuine design-time
    // deferrals with documented promotion triggers). pr-review-approved
    // REMOVED from carve-out list per bug-51 closure (original §3.1.1 +
    // AG-2 rationale was factually incorrect — approved reviews dispatch
    // to a separate subkind that pr-review-submitted never sees).
    expect(findRepoEventHandler("commit-pushed")).toBeNull();
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

