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
} from "../../src/session/handshake.js";

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

describe("parseHandshakeResponse", () => {
  it("parses a direct object response", () => {
    const body = { engineerId: "eng-abc123", sessionEpoch: 1, wasCreated: true };
    expect(parseHandshakeResponse(body)).toEqual(body);
  });

  it("parses a {content:[{text}]} envelope", () => {
    const body = { engineerId: "eng-abc123", sessionEpoch: 2, wasCreated: false };
    const result = { content: [{ text: JSON.stringify(body) }] };
    expect(parseHandshakeResponse(result)).toEqual(body);
  });

  it("returns null for missing engineerId", () => {
    expect(parseHandshakeResponse({ sessionEpoch: 1 })).toBeNull();
  });

  it("returns null for missing sessionEpoch", () => {
    expect(parseHandshakeResponse({ engineerId: "eng-x" })).toBeNull();
  });

  it("coerces wasCreated to boolean", () => {
    const body = { engineerId: "eng-x", sessionEpoch: 1 };
    expect(parseHandshakeResponse(body)?.wasCreated).toBe(false);
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

describe("performHandshake", () => {
  it("returns parsed response on success and logs the [Handshake] Registered line", async () => {
    const body: HandshakeResponse = { engineerId: "eng-abc", sessionEpoch: 1, wasCreated: true };
    const executeTool = vi.fn().mockResolvedValue(body);
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
    expect(result.response).toEqual(body);
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
    const body: HandshakeResponse = { engineerId: "eng-x", sessionEpoch: 5, wasCreated: false };
    const executeTool = vi.fn().mockResolvedValue(body);
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
    const body: HandshakeResponse = { engineerId: "eng-x", sessionEpoch: 3, wasCreated: false };
    const executeTool = vi.fn().mockResolvedValue(body);
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
    const body: HandshakeResponse = { engineerId: "eng-x", sessionEpoch: 2, wasCreated: false };
    const executeTool = vi.fn().mockResolvedValue(body);
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
