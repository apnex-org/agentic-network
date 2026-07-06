/**
 * canonical-fixtures.ts — source-of-truth-bound test fixtures for the
 * canonical Agent wire shape (idea-414, C2 / mission-104).
 *
 * WHY (mission-99 slice-b §8 self-exclusion bug): a hand-authored peers
 * fixture used `agentId` while the canonical `AgentProjection` exposes `id`.
 * The test was internally consistent with the BUG — the fixture mirrored the
 * code's wrong assumption — so both greg's build tests AND lily's conformance
 * spot-read missed it; steve caught it only by probing with the real
 * `AgentProjection` shape (`get_agents`). A fixture that mirrors the code's
 * assumption instead of the source-of-truth type is self-confirming: it
 * proves the code does what it does, not what it should.
 *
 * MITIGATION (idea-414 (a)): derive fixtures from the ACTUAL projection.
 * `makeAgentProjection` builds a canonical projection by running a real
 * `Agent` through the real `projectAgent()`, so the fixture is canonical
 * BY CONSTRUCTION — it exposes `id`, never `agentId`. A rename of a
 * projected field (or a change to `projectAgent`'s allowlist) breaks every
 * fixture at the type/behaviour boundary instead of silently diverging.
 * This is strictly stronger than a hand-authored `... satisfies AgentProjection`
 * literal, which guards only the type, not the projection function.
 *
 * Any test consuming a `get_agents` / `AgentProjection` wire shape should
 * build its fixtures here rather than hand-author `{ agentId, ... }`.
 */

import type { Agent } from "../../src/state.js";
import { projectAgent, type AgentProjection } from "../../src/policy/agent-projection.js";

// Deterministic base stamps — fixtures must never depend on wall-clock.
const FIXED_ISO = "2026-01-01T00:00:00.000Z";
const FIXED_MS = 1_767_225_600_000; // 2026-01-01T00:00:00.000Z

/**
 * A complete, canonical `Agent` entity with sane defaults. The base literal
 * is typed `: Agent` (NOT `Partial`), so a NEW required Agent field breaks
 * this factory at compile time — one place to add its default. Override any
 * field via `overrides`.
 */
export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  const base: Agent = {
    id: "eng-fixture01",
    fingerprint: "fixture-fingerprint",
    role: "engineer",
    status: "online",
    archived: false,
    sessionEpoch: 1,
    currentSessionId: "sess-fixture",
    clientMetadata: {
      clientName: "fixture-client",
      clientVersion: "0.0.0",
      proxyName: "fixture-proxy",
      proxyVersion: "0.0.0",
    },
    advisoryTags: { llmModel: "fixture-model" },
    labels: { env: "fixture" },
    firstSeenAt: FIXED_ISO,
    lastSeenAt: FIXED_ISO,
    livenessState: "online",
    lastHeartbeatAt: FIXED_ISO,
    receiptSla: 1000,
    wakeEndpoint: null,
    name: "fixture-agent",
    activityState: "online_idle",
    sessionStartedAt: FIXED_ISO,
    lastToolCallAt: null,
    lastToolCallName: null,
    idleSince: FIXED_ISO,
    workingSince: null,
    quotaBlockedUntil: null,
    adapterVersion: "@apnex/network-adapter@0.0.0",
    ipAddress: "127.0.0.1",
    restartCount: 0,
    recentErrors: [],
    restartHistoryMs: [FIXED_MS],
    cognitiveTTL: null,
    transportTTL: null,
    cognitiveState: "alive",
    transportState: "alive",
    thrashCount: 0,
    quarantined: false,
  };
  return { ...base, ...overrides };
}

/**
 * A canonical `AgentProjection`, produced by the REAL `projectAgent()` — so
 * the fixture IS the wire shape by construction (exposes `id`, never
 * `agentId`). `agentOverrides` tweak the underlying Agent (e.g.
 * id/name/role/livenessState); `nowMs` feeds the live TTL computation
 * deterministically.
 */
export function makeAgentProjection(
  agentOverrides: Partial<Agent> = {},
  nowMs: number = FIXED_MS,
): AgentProjection {
  return projectAgent(makeAgent(agentOverrides), nowMs);
}

/**
 * The `get_agents` wire envelope `{ agents: AgentProjection[] }` — the exact
 * shape consumers parse. Build peer/census fixtures from this so a projection
 * rename breaks them.
 */
export function makeGetAgentsResponse(
  projections: AgentProjection[] = [makeAgentProjection()],
): { agents: AgentProjection[] } {
  return { agents: projections };
}
