/**
 * footer-poll.ts — the swarm-aware footer's Tier-C PULL path (mission-99 slice b).
 *
 * Design-of-record: docs/designs/m-swarm-footer/ratified-spec.md v2.1 (§6/§8/§10/§11/§12).
 *
 * WHY A PULL PATH (and why it lives OFF the render path):
 * spec §14 gate 1 requires render(width) to make ZERO Hub-client calls. The peers
 * cell (§8) + authoritative role-scoped S4 (§10/§11) are the two cells that NEED a
 * Hub read — so they are fetched here on the EXISTING 30s heartbeat tick (spec §6
 * PULL path; no new timer) and PUSHED into FooterState via observeSwarmPull. The
 * render then reads only the store (gate 1 preserved).
 *
 * ANTI-STAMPEDE (spec §6 / gate 7): this poll piggybacks the poll-backstop
 * heartbeat, which already carries ±20% per-agent jitter (slice c / F2) — so the
 * fleet's Tier-C reads are desynchronized for free. We coalesce to ≤2 Hub reads
 * per tick (get_agents + one role-scoped S4 read).
 *
 * READ-ONLY INVARIANT (spec §6 / gate 8): every call here is a READ tool
 * (get_agents, list_threads, list_ready_work). NEVER drain_pending_actions, NEVER
 * a mutating tool. S4 uses read surfaces only.
 *
 * A3 facade: types come through the render/state modules; the Hub call goes
 * through the injected agent.call() (the @apnex/network-adapter facade), never a
 * direct transport reach.
 */

import type { PeerHealth } from "./footer-state.js";

/**
 * The minimal agent-call surface this poll needs — the adapter's
 * `agent.call(method, params, { internal: true })`. `internal:true` keeps the
 * RAW result (bug-106: machinery must not get the LLM-summarized shape).
 */
export interface PollAgentCall {
  call(
    method: string,
    params: Record<string, unknown>,
    opts?: { internal?: boolean },
  ): Promise<unknown>;
}

/** A projected agent row from get_agents (canonical AgentProjection subset). */
interface AgentRow {
  name?: unknown;
  role?: unknown;
  livenessState?: unknown;
  agentId?: unknown;
}

// ── Peers projection (spec §8, catch #2 env=prod) ────────────────────

/**
 * `livenessState` values the Hub emits (ADR-017 FSM): online | degraded |
 * unresponsive | offline. Only `online` is healthy; everything else is a named
 * problem in the exception-biased peers cell (spec §8).
 */
export function isPeerDown(livenessState: string): boolean {
  return livenessState !== "online";
}

/**
 * Coerce a get_agents result into PeerHealth[] (spec §8). Defensive: tolerates
 * the `{agents:[...]}` body (transport already unwraps the MCP envelope, bug-103)
 * OR a bare array; drops malformed rows; EXCLUDES self (the footer shows PEERS,
 * not me). Returns [] on any unrecognized shape (honest empty, never a fabricated
 * census — the caller decides freshness/trust).
 */
export function projectPeers(raw: unknown, selfAgentId: string | null): PeerHealth[] {
  const rows = extractAgentRows(raw);
  if (rows === null) return [];
  const peers: PeerHealth[] = [];
  for (const r of rows) {
    const agentId = typeof r.agentId === "string" ? r.agentId : null;
    if (selfAgentId && agentId === selfAgentId) continue; // exclude self
    const name = typeof r.name === "string" && r.name ? r.name : agentId ?? "?";
    const liveness = typeof r.livenessState === "string" ? r.livenessState : "offline";
    peers.push({ name, livenessState: liveness, down: isPeerDown(liveness) });
  }
  return peers;
}

function extractAgentRows(raw: unknown): AgentRow[] | null {
  if (Array.isArray(raw)) return raw as AgentRow[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { agents?: unknown }).agents)) {
    return (raw as { agents: AgentRow[] }).agents;
  }
  return null;
}

/**
 * The env=prod peers filter (spec §8 catch #2 — get_agents lists env=test ghosts;
 * peers MUST filter env=prod). Passed as the get_agents `filter.label` — a
 * match-all label filter (hub session-policy labelsMatchAll).
 */
export const PEERS_QUERY = {
  filter: { label: { env: "prod" } },
} as const;

// ── Authoritative role-scoped S4 (spec §10/§11/§12 catch#1) ──────────
//
// S4's SOURCE is role-dependent (spec §11): get_pending_actions is ARCHITECT-
// scoped (its sub-arrays are the architect inbox). The ENGINEER's authoritative
// actionable surface = my-turn threads + claimable work (+ answered clarifications
// when within the call budget). NEVER totalPending (catch #1 / idea-409).
//
// Kept as pure counters so the poll orchestrator composes them per role and the
// gate-6 role matrix can unit-test each independently.

/** Count my-turn active threads from a list_threads result (engineer S4 leg). */
export function countMyTurnThreads(raw: unknown, selfAgentId: string | null): number {
  const threads = extractThreadRows(raw);
  if (threads === null || !selfAgentId) return 0;
  return threads.filter(
    (t) =>
      (t as { status?: unknown }).status === "active" &&
      (t as { currentTurnAgentId?: unknown }).currentTurnAgentId === selfAgentId,
  ).length;
}

/** Count claimable work from a list_ready_work {scopeToCaller:true} result. */
export function countClaimableWork(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  // list_ready_work returns { items:[...], count, ... } (or a bare array defensively).
  const items = (raw as { items?: unknown }).items;
  if (Array.isArray(items)) return items.length;
  if (typeof (raw as { count?: unknown }).count === "number") {
    return (raw as { count: number }).count;
  }
  if (Array.isArray(raw)) return (raw as unknown[]).length;
  return 0;
}

function extractThreadRows(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { threads?: unknown }).threads)) {
    return (raw as { threads: unknown[] }).threads;
  }
  return null;
}

// ── Poll orchestrator (runs on the heartbeat tick; pushes into the store) ──

/** The result of one Tier-C poll — pushed into FooterState via observeSwarmPull. */
export interface SwarmPollResult {
  peers: PeerHealth[];
  s4Authoritative: number;
}

/**
 * Run ONE Tier-C swarm poll (spec §6 PULL path). Coalesces to ≤2 Hub READS:
 *   1. get_agents (env=prod filter) → peers projection (§8).
 *   2. one role-scoped S4 read (§11): engineer → list_threads(my-turn) +
 *      list_ready_work(scopeToCaller) [2 reads, still within the coalesce budget
 *      because get_agents is the only OTHER call and these are the S4 pair];
 *      architect → get_pending_actions role-scoped sub-array sum (catch #1).
 *
 * READ-ONLY (gate 8): every call is a read tool. Never drains, never mutates.
 * Throws propagate to the caller (the heartbeat tick), which treats a throw as a
 * failed refresh — the store keeps its prior (now-ageing) pull, and render
 * stale-marks it per the §6 SLO (one failed refresh → stale-notice).
 */
export async function runSwarmPoll(
  agent: PollAgentCall,
  role: string,
  selfAgentId: string | null,
): Promise<SwarmPollResult> {
  const agentsRaw = await agent.call("get_agents", { ...PEERS_QUERY }, { internal: true });
  const peers = projectPeers(agentsRaw, selfAgentId);
  const s4Authoritative = await readRoleScopedS4(agent, role, selfAgentId);
  return { peers, s4Authoritative };
}

/**
 * Role-keyed authoritative S4 (spec §11). ONE renderer, role-dependent SOURCE:
 *  - engineer: my-turn active threads + claimable work (scopeToCaller). Answered-
 *    clarifications DEFERRED (per-task get_clarification fan-out busts the §6
 *    ≤2-read budget; narrow case). NEVER get_pending_actions (architect-scoped).
 *  - architect: get_pending_actions role-scoped actionable sub-array sum, NEVER
 *    totalPending (catch #1 / idea-409).
 *  - verifier / other: gates surface deferred (no verifier-scoped read wired yet);
 *    returns 0 (honest — render still shows `nothing needs you` only when trusted).
 *
 * NOTE (pending architect confirm, thread 01KWJKQE7M): the engineer source is the
 * proposed reading; if the ratified answer differs, only THIS function changes
 * (peers + store + render are source-agnostic).
 */
async function readRoleScopedS4(
  agent: PollAgentCall,
  role: string,
  selfAgentId: string | null,
): Promise<number> {
  if (role === "engineer") {
    const threadsRaw = await agent.call(
      "list_threads",
      { filter: { status: "active", currentTurnAgentId: selfAgentId ?? "" } },
      { internal: true },
    );
    const myTurn = countMyTurnThreads(threadsRaw, selfAgentId);
    const readyRaw = await agent.call(
      "list_ready_work",
      { scopeToCaller: true },
      { internal: true },
    );
    const claimable = countClaimableWork(readyRaw);
    return myTurn + claimable;
  }
  if (role === "architect") {
    const paRaw = await agent.call("get_pending_actions", {}, { internal: true });
    return sumArchitectS4(paRaw);
  }
  // verifier / unknown: no role-scoped read wired (deferred). Honest zero.
  return 0;
}

/**
 * Architect authoritative S4 (spec §12 catch#1): sum ONLY the role-scoped
 * actionable sub-arrays — NEVER totalPending (polluted by legacy phantom tasks,
 * idea-409). Anomalies are NOT actionable-surface for S4 (separate concern).
 */
export function sumArchitectS4(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  const o = raw as Record<string, unknown>;
  const len = (k: string): number => (Array.isArray(o[k]) ? (o[k] as unknown[]).length : 0);
  return (
    len("unreadReports") +
    len("unreviewedTasks") +
    len("pendingProposals") +
    len("threadsAwaitingReply") +
    len("clarificationsPending") +
    len("convergedThreads")
  );
}
