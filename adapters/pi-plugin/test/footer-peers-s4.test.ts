/**
 * footer-peers-s4.test.ts — swarm-aware footer slice (b) gate proofs (mission-99).
 *
 * Design-of-record: docs/designs/m-swarm-footer/ratified-spec.md v2.1
 * (§6 pull path · §7 honesty cascade · §8 peers env=prod exception-bias ·
 *  §10/§11 authoritative role-keyed S4 · §12 catch#1 not-totalPending · §14 gates 3/6/7/8).
 *
 * Proves, via A3 Local Reasoning (no live Hub — pure projections + a fake agent.call):
 *   §8  peers — env=prod filter used; exception-biased ◉ census vs [⚠ name down];
 *              self excluded; degrades to `?` on untrusted wire / no pull.
 *   §7/§9 honesty cascade — untrusted hub → peers/needs `?`; stale pull → (stale) marker,
 *              never red-alert, never masquerades as fresh.
 *   §10/§11 authoritative S4 — engineer source = my-turn threads + claimable work
 *              (NOT get_pending_actions); retires the ~tilde when the pull is fresh.
 *   §12 catch#1 — architect S4 sums role-scoped sub-arrays, NEVER totalPending.
 *   gate 6 role matrix — engineer vs architect vs verifier S4 sources differ; no role
 *              sees an unauthorized producer surface.
 *   gate 8 read-only — the poll issues ONLY read tools (get_agents / list_threads /
 *              list_ready_work / get_pending_actions); NEVER a mutating tool.
 */

import { describe, it, expect, vi } from "vitest";
import { renderFooter, type FooterTheme } from "../src/footer.js";
import {
  createFooterState,
  observeHubState,
  observeSwarmPull,
  observePendingActionItem,
  isSwarmFresh,
  PULL_STALE_AFTER_MS,
  type FooterState,
  type PeerHealth,
} from "../src/footer-state.js";
import {
  isPeerDown,
  projectPeers,
  countMyTurnThreads,
  countClaimableWork,
  sumArchitectS4,
  runSwarmPoll,
  PEERS_QUERY,
  type PollAgentCall,
} from "../src/footer-poll.js";
import type { SessionState } from "@apnex/network-adapter";

const plainTheme: FooterTheme = { fg: (_k, s) => s };
const taggedTheme: FooterTheme = { fg: (k, s) => `<${k}>${s}</${k}>` };

const T0 = 1_000_000_000_000;

function live(state: FooterState, nowMs = T0): FooterState {
  observeHubState(state, "streaming", nowMs);
  return state;
}

function baseInputs(state: FooterState, nowMs = T0) {
  return {
    state,
    contextUsage: { tokens: 34_000, contextWindow: 200_000, percent: 17 },
    gitBranch: null,
    leases: [] as ReadonlyArray<{ workId: string; expiresAtMs: number }>,
    nowMs,
  };
}

// ── §8 peers projection ──────────────────────────────────────────────

describe("projectPeers — §8 env=prod exception-bias", () => {
  it("PEERS_QUERY filters env=prod (catch #2 test-ghost exclusion)", () => {
    expect(PEERS_QUERY).toEqual({ filter: { label: { env: "prod" } } });
  });

  it("projects {agents:[...]} body → PeerHealth[] with down = not-online", () => {
    const raw = {
      agents: [
        { agentId: "a1", name: "lily", role: "architect", livenessState: "online" },
        { agentId: "a2", name: "steve", role: "verifier", livenessState: "degraded" },
        { agentId: "a3", name: "gus", role: "engineer", livenessState: "offline" },
      ],
    };
    const peers = projectPeers(raw, null);
    expect(peers).toEqual([
      { name: "lily", livenessState: "online", down: false },
      { name: "steve", livenessState: "degraded", down: true },
      { name: "gus", livenessState: "offline", down: true },
    ]);
  });

  it("excludes self (footer shows PEERS, not me)", () => {
    const raw = {
      agents: [
        { agentId: "me", name: "greg", role: "engineer", livenessState: "online" },
        { agentId: "a1", name: "lily", role: "architect", livenessState: "online" },
      ],
    };
    const peers = projectPeers(raw, "me");
    expect(peers.map((p) => p.name)).toEqual(["lily"]);
  });

  it("tolerates a bare array + drops nothing but coerces missing liveness to offline", () => {
    const peers = projectPeers([{ agentId: "a1", name: "x" }], null);
    expect(peers).toEqual([{ name: "x", livenessState: "offline", down: true }]);
  });

  it("returns [] on unrecognized shape (honest empty, never fabricated)", () => {
    expect(projectPeers(null, null)).toEqual([]);
    expect(projectPeers({ nope: 1 }, null)).toEqual([]);
    expect(projectPeers("garbage", null)).toEqual([]);
  });

  it("isPeerDown: only 'online' is healthy", () => {
    expect(isPeerDown("online")).toBe(false);
    for (const s of ["degraded", "unresponsive", "offline", "", "unknown"]) {
      expect(isPeerDown(s)).toBe(true);
    }
  });
});

// ── §8 peers cell rendering + §7 honesty cascade ─────────────────────

describe("peers cell — §8 render + §7/§9 honesty cascade", () => {
  it("untrusted wire → peers `?` (never a fabricated census)", () => {
    const s = createFooterState("greg", "engineer");
    observeSwarmPull(s, [{ name: "lily", livenessState: "online", down: false }], 0, T0);
    // hub is null (cold) → not trusted → peers ?
    const [, line2] = renderFooter(plainTheme, baseInputs(s));
    expect(line2).toContain("peers ?");
  });

  it("no pull yet (trusted wire) → peers `?` (honest cold-start)", () => {
    const s = live(createFooterState("greg", "engineer"));
    const [, line2] = renderFooter(plainTheme, baseInputs(s));
    expect(line2).toContain("peers ?");
  });

  it("all healthy → compact ◉ dot census (one per online peer)", () => {
    const s = live(createFooterState("greg", "engineer"));
    observeSwarmPull(
      s,
      [
        { name: "lily", livenessState: "online", down: false },
        { name: "steve", livenessState: "online", down: false },
        { name: "gus", livenessState: "online", down: false },
      ],
      0,
      T0,
    );
    const [, line2] = renderFooter(plainTheme, baseInputs(s));
    expect(line2).toContain("peers ◉◉◉");
  });

  it("exception-biased: a down peer NAMES the problem (red), not a dot", () => {
    const s = live(createFooterState("greg", "engineer"));
    observeSwarmPull(
      s,
      [
        { name: "lily", livenessState: "online", down: false },
        { name: "steve", livenessState: "unresponsive", down: true },
      ],
      0,
      T0,
    );
    const [, line2] = renderFooter(taggedTheme, baseInputs(s));
    expect(line2).toContain("⚠ steve down");
    expect(line2).toContain("<error>"); // red alert on the named problem
    expect(line2).not.toContain("◉"); // exception-biased: names, doesn't dot
  });

  it("zero peers (trusted+fresh) → honest dim `none`, never a fabricated dot", () => {
    const s = live(createFooterState("greg", "engineer"));
    observeSwarmPull(s, [], 0, T0);
    const [, line2] = renderFooter(plainTheme, baseInputs(s));
    expect(line2).toContain("peers none");
  });

  it("stale pull (hub live, pull aged) → (stale) marker, never red-alert", () => {
    const s = live(createFooterState("greg", "engineer"), T0);
    observeSwarmPull(s, [{ name: "lily", livenessState: "online", down: false }], 0, T0);
    const stale = T0 + PULL_STALE_AFTER_MS + 1;
    const [, line2] = renderFooter(taggedTheme, baseInputs(s, stale));
    expect(line2).toContain("(stale)");
    // stale healthy peers do NOT red-alert (spec §9)
    expect(line2).not.toContain("<error>");
  });
});

// ── §10/§11 authoritative role-keyed S4 ──────────────────────────────

describe("authoritative S4 — §10/§11 retires the ~tilde, role-keyed", () => {
  it("fresh pull → exact `⟶ ✎N` (NO tilde — approximation retired)", () => {
    const s = live(createFooterState("greg", "engineer"));
    observeSwarmPull(s, [], 3, T0);
    const [, line2] = renderFooter(plainTheme, baseInputs(s));
    expect(line2).toContain("⟶ ✎3");
    expect(line2).not.toContain("~"); // tilde retired
  });

  it("fresh pull + zero → dim `nothing needs you` (fail-quiet, legal only live)", () => {
    const s = live(createFooterState("greg", "engineer"));
    observeSwarmPull(s, [], 0, T0);
    const [, line2] = renderFooter(plainTheme, baseInputs(s));
    expect(line2).toContain("nothing needs you");
  });

  it("no fresh pull → falls back to push-only ~approx (tilde returns)", () => {
    const s = live(createFooterState("greg", "engineer"));
    observePendingActionItem(s); // approx = 1
    observePendingActionItem(s); // approx = 2
    const [, line2] = renderFooter(plainTheme, baseInputs(s));
    expect(line2).toContain("⟶ ~✎2"); // tilde-marked approximation
  });

  it("stale pull → tilde returns (honest degrade from authoritative)", () => {
    const s = live(createFooterState("greg", "engineer"), T0);
    observeSwarmPull(s, [], 5, T0); // authoritative 5
    observePendingActionItem(s); // approx 1
    const stale = T0 + PULL_STALE_AFTER_MS + 1;
    const [, line2] = renderFooter(plainTheme, baseInputs(s, stale));
    // pull stale → not authoritative → falls back to ~approx
    expect(line2).toContain("⟶ ~✎1");
  });

  it("untrusted wire → needs `?` (never zeros on a broken wire)", () => {
    const s = createFooterState("greg", "engineer");
    observeHubState(s, "disconnected", T0);
    observeSwarmPull(s, [], 0, T0);
    const [, line2] = renderFooter(plainTheme, baseInputs(s));
    expect(line2).toContain("needs ?");
    expect(line2).not.toContain("nothing needs you");
  });

  it("isSwarmFresh: within SLO fresh, past SLO stale, null stale", () => {
    const s = createFooterState();
    expect(isSwarmFresh(s, T0)).toBe(false); // no pull
    observeSwarmPull(s, [], 0, T0);
    expect(isSwarmFresh(s, T0)).toBe(true);
    expect(isSwarmFresh(s, T0 + PULL_STALE_AFTER_MS)).toBe(true);
    expect(isSwarmFresh(s, T0 + PULL_STALE_AFTER_MS + 1)).toBe(false);
  });
});

// ── §11/§12 role-keyed S4 SOURCE (gate 6 role matrix) ────────────────

describe("S4 source role matrix — §11 role-keyed / §12 catch#1", () => {
  it("engineer S4 = my-turn threads + claimable work (NOT get_pending_actions)", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const agent: PollAgentCall = {
      call: vi.fn(async (method, params) => {
        calls.push({ method, params });
        if (method === "get_agents") return { agents: [] };
        if (method === "list_threads")
          return { threads: [
            { status: "active", currentTurnAgentId: "me" },
            { status: "active", currentTurnAgentId: "me" },
            { status: "active", currentTurnAgentId: "other" }, // not mine
            { status: "converged", currentTurnAgentId: "me" }, // not active
          ] };
        if (method === "list_ready_work") return { items: [{}, {}, {}] }; // 3 claimable
        throw new Error(`unexpected call: ${method}`);
      }),
    };
    const { s4Authoritative } = await runSwarmPoll(agent, "engineer", "me");
    expect(s4Authoritative).toBe(2 + 3); // 2 my-turn + 3 claimable
    // engineer must NEVER touch the architect-scoped get_pending_actions
    expect(calls.map((c) => c.method)).not.toContain("get_pending_actions");
    // env=prod filter used on get_agents
    expect(calls.find((c) => c.method === "get_agents")?.params).toEqual({
      filter: { label: { env: "prod" } },
    });
    // scopeToCaller on the claimable-work read
    expect(calls.find((c) => c.method === "list_ready_work")?.params).toEqual({
      scopeToCaller: true,
    });
  });

  it("architect S4 = honest role-scoped sub-array sum (NOT totalPending, no unreviewedTasks)", async () => {
    const calls: string[] = [];
    const agent: PollAgentCall = {
      call: vi.fn(async (method) => {
        calls.push(method);
        if (method === "get_agents") return { agents: [] };
        if (method === "get_pending_actions")
          return {
            totalPending: 999, // POLLUTED (legacy phantoms) — MUST be ignored
            unreadReports: [{}, {}],
            unreviewedTasks: [{}], // DROPPED (phantom + double-count) — not summed
            pendingProposals: [],
            threadsAwaitingReply: [{}],
            clarificationsPending: [],
            convergedThreads: [{}],
            anomalies: { count: 7, orphanedReviews: [{}] }, // NOT actionable-surface
          };
        throw new Error(`unexpected call: ${method}`);
      }),
    };
    const { s4Authoritative } = await runSwarmPoll(agent, "architect", "arch-id");
    // unreadReports(2) + pendingProposals(0) + threadsAwaitingReply(1)
    //   + clarificationsPending(0) + convergedThreads(1) = 4 — NOT 5, NOT 999,
    //   NOT +anomalies; unreviewedTasks EXCLUDED (catch#1).
    expect(s4Authoritative).toBe(4);
    // architect must NOT touch the engineer surfaces
    expect(calls).not.toContain("list_ready_work");
  });

  it("verifier S4 = 0 (gates surface deferred; honest zero, no unauthorized read)", async () => {
    const calls: string[] = [];
    const agent: PollAgentCall = {
      call: vi.fn(async (method) => {
        calls.push(method);
        if (method === "get_agents") return { agents: [] };
        throw new Error(`unexpected call: ${method}`);
      }),
    };
    const { s4Authoritative } = await runSwarmPoll(agent, "verifier", "ver-id");
    expect(s4Authoritative).toBe(0);
    // verifier never sees producer surfaces (no get_pending_actions, no list_ready_work)
    expect(calls).toEqual(["get_agents"]);
  });

  it("sumArchitectS4 ignores totalPending + anomalies + unreviewedTasks; tolerates missing keys", () => {
    expect(
      sumArchitectS4({
        totalPending: 42,
        unreadReports: [{}, {}, {}],
        unreviewedTasks: [{}], // EXCLUDED — phantom + double-count
        anomalies: { count: 9 },
      }),
    ).toBe(3); // only unreadReports counted here
    expect(sumArchitectS4({})).toBe(0);
    expect(sumArchitectS4(null)).toBe(0);
    expect(sumArchitectS4("x")).toBe(0);
  });

  it("catch#1 GUARD: sumArchitectS4 ≠ totalPending on a phantom + awaiting-review fixture", () => {
    // Fixture models the two pollutions catch#1 forbids:
    //  - unreviewedTasks carries a legacy phantom (idea-409), AND
    //  - the awaiting-review report appears in BOTH unreadReports AND
    //    unreviewedTasks (both filter !reviewAssessment) — a double-count.
    // The Hub derives totalPending = sum of ALL SIX sub-arrays, so a naive
    // all-six sum would EQUAL totalPending. The honest sum MUST be strictly less.
    const raw = {
      unreadReports: [{ taskId: "t-review" }], // the awaiting-review report
      unreviewedTasks: [{ taskId: "t-review" }, { taskId: "t-phantom" }], // dup + phantom
      pendingProposals: [{ proposalId: "p1" }],
      threadsAwaitingReply: [{ threadId: "th1" }],
      clarificationsPending: [],
      convergedThreads: [],
    };
    // What the Hub would report as totalPending (all six summed): 1+2+1+1+0+0 = 5.
    const totalPending =
      raw.unreadReports.length +
      raw.unreviewedTasks.length +
      raw.pendingProposals.length +
      raw.threadsAwaitingReply.length +
      raw.clarificationsPending.length +
      raw.convergedThreads.length;
    expect(totalPending).toBe(5);
    // Honest S4 drops unreviewedTasks: 1+1+1+0+0 = 3 — STRICTLY LESS than totalPending.
    expect(sumArchitectS4(raw)).toBe(3);
    expect(sumArchitectS4(raw)).toBeLessThan(totalPending); // the catch#1 invariant
  });

  it("countMyTurnThreads: only active + my agentId", () => {
    const raw = { threads: [
      { status: "active", currentTurnAgentId: "me" },
      { status: "active", currentTurnAgentId: "you" },
      { status: "closed", currentTurnAgentId: "me" },
    ] };
    expect(countMyTurnThreads(raw, "me")).toBe(1);
    expect(countMyTurnThreads(raw, null)).toBe(0); // no self → 0
    expect(countMyTurnThreads(null, "me")).toBe(0);
  });

  it("countClaimableWork: items[] len, or count, or bare array; else 0", () => {
    expect(countClaimableWork({ items: [{}, {}] })).toBe(2);
    expect(countClaimableWork({ count: 5 })).toBe(5);
    expect(countClaimableWork([{}, {}, {}])).toBe(3);
    expect(countClaimableWork(null)).toBe(0);
    expect(countClaimableWork({ nope: 1 })).toBe(0);
  });
});

// ── gate 8 read-only proof ───────────────────────────────────────────

describe("gate 8 — the swarm poll is READ-ONLY", () => {
  const MUTATING = [
    "drain_pending_actions",
    "claim_work",
    "complete_work",
    "create_thread_reply",
    "create_review",
    "signal_working_started",
    "renew_lease",
    "block_work",
  ];

  for (const role of ["engineer", "architect", "verifier"]) {
    it(`${role}: poll issues ONLY read tools — no mutating tool`, async () => {
      const calls: string[] = [];
      const agent: PollAgentCall = {
        call: vi.fn(async (method) => {
          calls.push(method);
          if (method === "get_agents") return { agents: [] };
          if (method === "list_threads") return { threads: [] };
          if (method === "list_ready_work") return { items: [] };
          if (method === "get_pending_actions") return {};
          throw new Error(`unexpected call: ${method}`);
        }),
      };
      await runSwarmPoll(agent, role, "self");
      for (const m of MUTATING) expect(calls).not.toContain(m);
      // every issued call is a known READ tool
      const READS = new Set(["get_agents", "list_threads", "list_ready_work", "get_pending_actions"]);
      for (const c of calls) expect(READS.has(c)).toBe(true);
    });
  }

  it("get_agents always uses the env=prod filter (never unfiltered — catch #2)", async () => {
    let agentsParams: unknown = null;
    const agent: PollAgentCall = {
      call: vi.fn(async (method, params) => {
        if (method === "get_agents") { agentsParams = params; return { agents: [] }; }
        if (method === "list_threads") return { threads: [] };
        if (method === "list_ready_work") return { items: [] };
        return {};
      }),
    };
    await runSwarmPoll(agent, "engineer", "self");
    expect(agentsParams).toEqual({ filter: { label: { env: "prod" } } });
  });
});

// ── fixed-height preserved with the new cells (gate 3) ───────────────

describe("gate 3 — 4-cell line-2 still fixed 2-line height", () => {
  it("peers + needs both present → still exactly 2 lines", () => {
    const s = live(createFooterState("greg", "engineer"));
    observeSwarmPull(
      s,
      [{ name: "steve", livenessState: "offline", down: true }],
      4,
      T0,
    );
    const lines = renderFooter(plainTheme, baseInputs(s), 80);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(80);
  });
});
