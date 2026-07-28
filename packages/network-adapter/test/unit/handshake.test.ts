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
  name: "uuid-test",
  clientInfo: { name: "claude-code", version: "0.1.0" },
  proxyName: "@apnex/claude-plugin",
  proxyVersion: "1.0.0",
  transport: "stdio-mcp-proxy",
  sdkVersion: "@apnex/network-adapter@2.0.0",
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

  it("parses raw string JSON fatal bodies from live transports", () => {
    const result = JSON.stringify({ ok: false, code: "role_mismatch", message: "token bound to architect" });
    expect(parseHandshakeError(result)).toEqual({ code: "role_mismatch", message: "token bound to architect" });
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

  it("parses canonical envelope delivered as a raw string JSON body", () => {
    const wire = {
      ok: true,
      agent: { id: "eng-string", name: "n", role: "engineer", livenessState: "online", activityState: "online_idle", labels: {} },
      session: { epoch: 7, claimed: false },
      wasCreated: false,
    };
    expect(parseHandshakeResponse(JSON.stringify(wire))).toEqual({
      agentId: "eng-string",
      sessionEpoch: 7,
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
    expect(payload.name).toBe("uuid-test");
    expect(payload.clientMetadata.clientName).toBe("claude-code");
    expect(payload.clientMetadata.proxyName).toBe("@apnex/claude-plugin");
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
    expect(payload.clientMetadata.clientName).toBe("@apnex/claude-plugin");
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
    expect(payload.clientMetadata.clientName).toBe("@apnex/claude-plugin");
    expect(payload.clientMetadata.clientVersion).toBe("1.0.0");
  });
});

describe("resolveClientName (bug-17)", () => {
  it("returns the raw value when non-empty and not 'unknown'", () => {
    expect(resolveClientName("claude-code", "@apnex/claude-plugin")).toBe("claude-code");
  });
  it("falls back to proxyName on empty string", () => {
    expect(resolveClientName("", "@apnex/claude-plugin")).toBe("@apnex/claude-plugin");
  });
  it("falls back to proxyName on 'unknown' sentinel", () => {
    expect(resolveClientName("unknown", "@apnex/claude-plugin")).toBe("@apnex/claude-plugin");
  });
  it("falls back to proxyName on undefined", () => {
    expect(resolveClientName(undefined, "@apnex/vertex-cloudrun")).toBe("@apnex/vertex-cloudrun");
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
      name: "uuid-test",
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

    // 🔴 work-592 / bug-398 — AN UNPARSEABLE RESPONSE MUST BE CLASSIFIED FATAL.
    //
    // This is the assertion whose ABSENCE was the root cause. `mcp-agent-client`
    // throws on `result.fatal` (mission-93's FAIL LOUD guard), but `fatal` was
    // only ever set by `parseHandshakeError`, which requires the error to PARSE.
    // So an unparseable response took the NON-FATAL path BY DEFAULT and the
    // client's `if (result.response)` skipped identity binding with no else, no
    // log and no throw — MALFORMED ERRORS BYPASSED THE GUARD BUILT TO CATCH BAD
    // ERRORS, and the seat ran on with a role and no agentId.
    //
    // `handshake.ts:99-104` has documented this exact fall-through degrading a
    // third seat since mission-93, filed as a parsing nuance. IV-6: the lesson
    // becomes an ENFORCED TEST rather than a comment, so the next recurrence is
    // impossible rather than merely described.
    // ⚠️ NON-FATAL, DELIBERATELY. `{notAHandshake:true}` is valid JSON of an
    // unrecognised SHAPE — a compatibility gap, not a broken contract. The legacy
    // FLAT handshake shape (`{agentId, sessionEpoch}`) lands here too, and the
    // loopback hub still emits it. Marking this fatal converted three integration
    // tests from green to red and would have turned a hub speaking the older shape
    // from "degraded but running" into "refuses to start".
    expect(result.fatal).toBeFalsy();
  });

  it("🔴 work-592: a NON-JSON body IS fatal — the bug-398 specimen", async () => {
    // THE DISCRIMINATOR. bug-398's actual bytes were
    //   `Unexpected token 's', "storage li"... is not valid JSON`
    // — a StorageAdmissionError reaching the client as PLAINTEXT where an envelope
    // was contracted. That is unambiguously not an identity, and continuing past it
    // is what left a live seat running as `anonymous-<role>`.
    const executeTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "storage list admission queue full (8 active, 128 queued)" }],
    });
    const log = vi.fn();

    const result = await performHandshake({
      executeTool,
      config: baseConfig,
      previousEpoch: 0,
      log,
    });

    expect(result.response).toBeNull();
    expect(result.fatal).toBe(true);
  });

  it("🔴 work-592: a TRANSPORT failure stays NON-fatal — only the parse failure is fatal", async () => {
    // The discriminator. Conflating the two would halt seats on an ordinary
    // reconnect: a call that never completed is a retry case, whereas a response
    // that arrived and could not be parsed means identity was NOT bound and
    // continuing would run the seat unbound. A guard that marked BOTH fatal
    // passes the assertion above and fails this one.
    const executeTool = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const log = vi.fn();

    const result = await performHandshake({
      executeTool,
      config: baseConfig,
      previousEpoch: 7,
      log,
    });

    expect(result.response).toBeNull();
    expect(result.fatal).toBeFalsy();
    expect(result.epoch).toBe(7);
  });
});
