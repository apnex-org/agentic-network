/**
 * Invariant #9 — register_role is called in two distinct shapes:
 *   1. Plain — just `{ role }`. Proves the wire is alive and the
 *      session is bound before the M18 handshake spends round-trips
 *      on the enriched payload.
 *   2. Enriched — full M18 shape: `{ role, globalInstanceId,
 *      clientMetadata, advisoryTags }`. This call is the M18 handshake
 *      itself and produces `engineerId` + `sessionEpoch`.
 *
 * Post-Phase-6: both calls live in `McpAgentClient.runHandshake()`.
 * After the refactor, the agent must still emit both payload shapes in
 * this order — otherwise M18 handshake semantics change (wasCreated
 * flag, sessionEpoch monotonicity) and the Hub can't distinguish a
 * fresh engineer from a reconnect.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LoopbackHub, LoopbackTransport } from "../helpers/loopback-transport.js";
import { LogCapture, waitFor } from "../helpers/test-utils.js";
import { McpAgentClient } from "../../src/kernel/mcp-agent-client.js";

describe("Invariant #9 — plain vs enriched register_role", () => {
  let hub: LoopbackHub;
  let log: LogCapture;
  let agent: McpAgentClient | undefined;

  beforeEach(() => {
    hub = new LoopbackHub();
    log = new LogCapture();
    agent = undefined;
  });

  afterEach(async () => {
    try { if (agent) await agent.stop(); } catch { /* */ }
  });

  it("first register_role is plain, second is enriched with M18 fields", async () => {
    agent = new McpAgentClient(
      {
        role: "engineer",
        logger: log.logger,
        handshake: {
          globalInstanceId: "test-instance-uuid-9",
          proxyName: "@ois/test",
          proxyVersion: "1.0.0",
          transport: "test-mcp",
          sdkVersion: "@ois/network-adapter@test",
          getClientInfo: () => ({ name: "test-client", version: "0.0.1" }),
          llmModel: "test-model",
        },
      },
      { transport: new LoopbackTransport(hub) }
    );

    await agent.start();

    // Both register_role calls land during start() → runSynchronizingPhase
    // → runHandshake. Poll until the Hub has recorded both.
    await waitFor(() => hub.getToolCalls("register_role").length >= 2, 10_000);

    const calls = hub.getToolCalls("register_role");
    expect(calls.length).toBeGreaterThanOrEqual(2);

    // Call 1: plain — only `role`, nothing else.
    const plain = calls[0].args;
    expect(plain.role).toBe("engineer");
    expect(plain.globalInstanceId).toBeUndefined();
    expect(plain.clientMetadata).toBeUndefined();
    expect(plain.advisoryTags).toBeUndefined();

    // Call 2: enriched — carries the full M18 handshake payload.
    const enriched = calls[1].args;
    expect(enriched.role).toBe("engineer");
    expect(enriched.globalInstanceId).toBe("test-instance-uuid-9");
    expect(enriched.clientMetadata).toBeTruthy();
    expect(enriched.advisoryTags).toBeTruthy();

    const metadata = enriched.clientMetadata as Record<string, unknown>;
    expect(metadata.clientName).toBe("test-client");
    expect(metadata.clientVersion).toBe("0.0.1");
    expect(metadata.proxyName).toBe("@ois/test");
    expect(metadata.proxyVersion).toBe("1.0.0");
    expect(metadata.transport).toBe("test-mcp");
    expect(metadata.sdkVersion).toBe("@ois/network-adapter@test");
    expect(metadata.hostname).toBeDefined();
    expect(metadata.platform).toBeDefined();
    expect(metadata.pid).toBeDefined();

    const tags = enriched.advisoryTags as Record<string, unknown>;
    expect(tags.llmModel).toBe("test-model");

    // Same session: the enriched call happens on the SAME session id
    // as the plain call — it's a re-registration, not a new session.
    expect(calls[1].sessionId).toBe(calls[0].sessionId);
  }, 20_000);
});
