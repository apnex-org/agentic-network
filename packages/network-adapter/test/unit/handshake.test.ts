/**
 * Unit tests for the shared handshake primitives.
 *
 * Layer:     L7 (helper module under McpAgentClient)
 * Invariants pinned (see docs/network/06-test-specification.md):
 *   #6  Fatal handshake codes (agent_thrashing_detected, role_mismatch)
 *       halt instead of retry — parseHandshakeError classifies them
 *       into FATAL_CODES and performHandshake calls onFatalHalt
 *
 * Scope: pure parsing + performHandshake with a mock executor. No live
 * Hub or transport involved — covers the client-side handshake logic
 * that McpAgentClient drives during the `connecting` → `synchronizing`
 * transition.
 */

import { describe, it, expect, vi } from "vitest";
import {
  parseHandshakeError,
  parseHandshakeResponse,
  performHandshake,
  buildHandshakePayload,
  resolveClientName,
  resolveClientVersion,
  FATAL_CODES,
  type HandshakeConfig,
  type HandshakeFatalError,
  type HandshakeResponse,
} from "../../src/kernel/handshake.js";

const baseConfig: HandshakeConfig = {
  role: "engineer",
  globalInstanceId: "uuid-test",
  clientInfo: { name: "claude-code", version: "0.1.0" },
  proxyName: "@ois/claude-plugin",
  proxyVersion: "1.0.0",
  transport: "stdio-mcp-proxy",
  sdkVersion: "@ois/network-adapter@2.0.0",
  llmModel: "claude-opus-4-6",
};

describe("parseHandshakeError", () => {
  it("returns null for non-error results", () => {
    expect(parseHandshakeError({ content: [{ text: "{}" }] })).toBeNull();
    expect(parseHandshakeError(null)).toBeNull();
    expect(parseHandshakeError(undefined)).toBeNull();
  });

  it("returns null for isError results without a fatal code", () => {
    const result = { isError: true, content: [{ text: JSON.stringify({ code: "transient" }) }] };
    expect(parseHandshakeError(result)).toBeNull();
  });

  it("returns the fatal error for agent_thrashing_detected", () => {
    const result = {
      isError: true,
      content: [{ text: JSON.stringify({ code: "agent_thrashing_detected", message: "too many displacements" }) }],
    };
    const fatal = parseHandshakeError(result);
    expect(fatal).toEqual({ code: "agent_thrashing_detected", message: "too many displacements" });
  });

  it("returns the fatal error for role_mismatch", () => {
    const result = {
      isError: true,
      content: [{ text: JSON.stringify({ code: "role_mismatch", message: "token bound to architect" }) }],
    };
    const fatal = parseHandshakeError(result);
    expect(fatal?.code).toBe("role_mismatch");
  });

  it("returns null for malformed JSON bodies", () => {
    const result = { isError: true, content: [{ text: "not-json" }] };
    expect(parseHandshakeError(result)).toBeNull();
  });

  it("FATAL_CODES contains both known fatal codes and nothing else", () => {
    expect(FATAL_CODES.has("agent_thrashing_detected")).toBe(true);
    expect(FATAL_CODES.has("role_mismatch")).toBe(true);
    expect(FATAL_CODES.size).toBe(2);
  });
});

describe("parseHandshakeResponse (mission-63 W3 canonical envelope)", () => {
  // mission-63 W3: parses canonical wire shape per Design v1.0 §3.1 + ADR-028:
  // `{ok, agent: {id, ...}, session: {epoch, claimed:false}, wasCreated, message?}`.
  // Adapter flattens to internal HandshakeResponse `{agentId, sessionEpoch, wasCreated}`.
  // Legacy flat-field shape (`agentId` + `sessionEpoch` at top level) is gone post-W1+W2
  // (anti-goal §8.1 clean cutover); parser does NOT accept it.
  it("parses canonical envelope direct object", () => {
    const wire = {
      ok: true,
      agent: { id: "eng-abc123", name: "eng-abc123", role: "engineer", livenessState: "online", activityState: "online_idle", labels: {} },
      session: { epoch: 1, claimed: false },
      wasCreated: true,
    };
    expect(parseHandshakeResponse(wire)).toEqual({
      agentId: "eng-abc123",
      sessionEpoch: 1,
      wasCreated: true,
    });
  });

  it("parses canonical envelope inside {content:[{text}]} wrapper", () => {
    const wire = {
      ok: true,
      agent: { id: "eng-abc123", name: "n", role: "engineer", livenessState: "online", activityState: "online_idle", labels: {} },
      session: { epoch: 2, claimed: false },
      wasCreated: false,
    };
    const result = { content: [{ text: JSON.stringify(wire) }] };
    expect(parseHandshakeResponse(result)).toEqual({
      agentId: "eng-abc123",
      sessionEpoch: 2,
      wasCreated: false,
    });
  });

  it("returns null for missing agent.id", () => {
    expect(parseHandshakeResponse({ session: { epoch: 1, claimed: false } })).toBeNull();
  });

  it("returns null for missing session.epoch", () => {
    expect(parseHandshakeResponse({ agent: { id: "eng-x" } })).toBeNull();
  });

  it("returns null for legacy flat-field shape (anti-goal §8.1: no co-existence)", () => {
    expect(parseHandshakeResponse({ agentId: "eng-x", sessionEpoch: 1 })).toBeNull();
  });

  it("coerces wasCreated to boolean (default false when absent)", () => {
    const wire = {
      ok: true,
      agent: { id: "eng-x", name: "x", role: "engineer", livenessState: "online", activityState: "online_idle", labels: {} },
      session: { epoch: 1, claimed: false },
      // wasCreated absent
    };
    expect(parseHandshakeResponse(wire)?.wasCreated).toBe(false);
  });
});

describe("buildHandshakePayload", () => {
  it("constructs a well-formed payload", () => {
    const payload = buildHandshakePayload(baseConfig);
    expect(payload.role).toBe("engineer");
    expect(payload.globalInstanceId).toBe("uuid-test");
    expect(payload.clientMetadata.clientName).toBe("claude-code");
    expect(payload.clientMetadata.proxyName).toBe("@ois/claude-plugin");
    expect(payload.clientMetadata.pid).toBe(process.pid);
    expect(payload.advisoryTags.llmModel).toBe("claude-opus-4-6");
  });

  it("defaults llmModel to 'unknown' when missing", () => {
    const payload = buildHandshakePayload({ ...baseConfig, llmModel: undefined });
    expect(payload.advisoryTags.llmModel).toBe("unknown");
  });

  // ── bug-17: clientName/clientVersion proxy fallback ─────────────
  it("bug-17: falls back to proxyName when clientInfo.name is 'unknown' (dev-channel load path)", () => {
    const payload = buildHandshakePayload({
      ...baseConfig,
      clientInfo: { name: "unknown", version: "0.1.0" },
    });
    expect(payload.clientMetadata.clientName).toBe("@ois/claude-plugin");
    expect(payload.clientMetadata.clientVersion).toBe("0.1.0"); // version was fine — stays
  });

  it("bug-17: falls back to proxyVersion when clientInfo.version is '0.0.0'", () => {
    const payload = buildHandshakePayload({
      ...baseConfig,
      clientInfo: { name: "claude-code", version: "0.0.0" },
    });
    expect(payload.clientMetadata.clientName).toBe("claude-code"); // name was fine — stays
    expect(payload.clientMetadata.clientVersion).toBe("1.0.0"); // fell back to proxyVersion
  });

  it("bug-17: falls back on both fields when host announces nothing (empty strings)", () => {
    const payload = buildHandshakePayload({
      ...baseConfig,
      clientInfo: { name: "", version: "" },
    });
    expect(payload.clientMetadata.clientName).toBe("@ois/claude-plugin");
    expect(payload.clientMetadata.clientVersion).toBe("1.0.0");
  });
});

describe("resolveClientName (bug-17)", () => {
  it("returns the raw value when non-empty and not 'unknown'", () => {
    expect(resolveClientName("claude-code", "@ois/claude-plugin")).toBe("claude-code");
  });
  it("falls back to proxyName on empty string", () => {
    expect(resolveClientName("", "@ois/claude-plugin")).toBe("@ois/claude-plugin");
  });
  it("falls back to proxyName on 'unknown' sentinel", () => {
    expect(resolveClientName("unknown", "@ois/claude-plugin")).toBe("@ois/claude-plugin");
  });
  it("falls back to proxyName on undefined", () => {
    expect(resolveClientName(undefined, "@ois/vertex-cloudrun")).toBe("@ois/vertex-cloudrun");
  });
});

describe("resolveClientVersion (bug-17)", () => {
  it("returns the raw value when non-empty and not '0.0.0'", () => {
    expect(resolveClientVersion("0.1.0", "1.0.0")).toBe("0.1.0");
  });
  it("falls back to proxyVersion on empty string", () => {
    expect(resolveClientVersion("", "1.0.0")).toBe("1.0.0");
  });
  it("falls back to proxyVersion on '0.0.0' sentinel", () => {
    expect(resolveClientVersion("0.0.0", "1.0.0")).toBe("1.0.0");
  });
  it("falls back to proxyVersion on undefined", () => {
    expect(resolveClientVersion(undefined, "1.0.0")).toBe("1.0.0");
  });
});

// Helper: build a canonical envelope wire shape per mission-63 W3.
function canonicalRegisterRoleWire(
  agentId: string,
  sessionEpoch: number,
  wasCreated: boolean,
): Record<string, unknown> {
  return {
    ok: true,
    agent: {
      id: agentId, name: agentId, role: "engineer",
      livenessState: "online", activityState: "online_idle", labels: {},
    },
    session: { epoch: sessionEpoch, claimed: false },
    wasCreated,
  };
}

describe("performHandshake", () => {
  it("returns parsed response on success and logs the [Handshake] Registered line", async () => {
    const wire = canonicalRegisterRoleWire("eng-abc", 1, true);
    const executeTool = vi.fn().mockResolvedValue(wire);
    const log = vi.fn();

    const result = await performHandshake({
      executeTool,
      config: baseConfig,
      previousEpoch: 0,
      log,
    });

    expect(executeTool).toHaveBeenCalledWith("register_role", expect.objectContaining({
      role: "engineer",
      globalInstanceId: "uuid-test",
    }));
    expect(result.response).toEqual<HandshakeResponse>({ agentId: "eng-abc", sessionEpoch: 1, wasCreated: true });
    expect(result.epoch).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[Handshake] Registered as eng-abc"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("newly created"));
  });

  it("triggers onFatalHalt for fatal codes and returns null response", async () => {
    const fatalResult = {
      isError: true,
      content: [{ text: JSON.stringify({ code: "agent_thrashing_detected", message: "too many" }) }],
    };
    const executeTool = vi.fn().mockResolvedValue(fatalResult);
    const onFatalHalt = vi.fn();
    const log = vi.fn();

    const result = await performHandshake({
      executeTool,
      config: baseConfig,
      previousEpoch: 3,
      log,
      onFatalHalt,
    });

    expect(onFatalHalt).toHaveBeenCalledTimes(1);
    const arg = onFatalHalt.mock.calls[0][0] as HandshakeFatalError;
    expect(arg.code).toBe("agent_thrashing_detected");
    expect(result.response).toBeNull();
    expect(result.epoch).toBe(3); // unchanged
  });

  it("returns null on tool-call failure without throwing", async () => {
    const executeTool = vi.fn().mockRejectedValue(new Error("transport dead"));
    const log = vi.fn();

    const result = await performHandshake({
      executeTool,
      config: baseConfig,
      previousEpoch: 5,
      log,
    });

    expect(result.response).toBeNull();
    expect(result.epoch).toBe(5);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("tool-call failed"));
  });

  it("logs epoch advancement when external claim displaced us between register_role calls (mission-40 T3)", async () => {
    // Post-mission-40-T2: register_role no longer increments epoch on its own.
    // ANY positive delta (epoch grew between our two register_role calls)
    // means an external claim_session displaced our prior session in between.
    const wire = canonicalRegisterRoleWire("eng-x", 5, false);
    const executeTool = vi.fn().mockResolvedValue(wire);
    const log = vi.fn();

    await performHandshake({
      executeTool,
      config: baseConfig,
      previousEpoch: 2,
      log,
    });

    expect(log).toHaveBeenCalledWith(expect.stringContaining("sessionEpoch advanced from 2 to 5"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("external claim_session has displaced"));
  });

  it("logs epoch advancement on +1 delta (any positive delta is external displacement post-T2)", async () => {
    // Pre-mission-40-T2: +1 was a normal register_role-bump (no log).
    // Post-T2: +1 means an external claim_session displaced us (DO log).
    const wire = canonicalRegisterRoleWire("eng-x", 3, false);
    const executeTool = vi.fn().mockResolvedValue(wire);
    const log = vi.fn();

    await performHandshake({
      executeTool,
      config: baseConfig,
      previousEpoch: 2,
      log,
    });

    const calls = log.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("sessionEpoch advanced from 2 to 3"))).toBe(true);
  });

  it("does NOT log epoch advancement when epoch unchanged (idempotent register_role under T2)", async () => {
    // T2: register_role is pure identity assertion. Repeated calls leave
    // the epoch unchanged unless an external claim happened.
    const wire = canonicalRegisterRoleWire("eng-x", 2, false);
    const executeTool = vi.fn().mockResolvedValue(wire);
    const log = vi.fn();

    await performHandshake({
      executeTool,
      config: baseConfig,
      previousEpoch: 2,
      log,
    });

    const calls = log.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("sessionEpoch advanced") || c.includes("sessionEpoch jumped"))).toBe(false);
  });

  it("returns null response on malformed success body", async () => {
    const executeTool = vi.fn().mockResolvedValue({ notAHandshake: true });
    const log = vi.fn();

    const result = await performHandshake({
      executeTool,
      config: baseConfig,
      previousEpoch: 0,
      log,
    });

    expect(result.response).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("parse failed"));
  });
});
