/**
 * Gap-fill regressions for invariants previously tracked as G2–G4 in
 * `docs/network/06-test-specification.md`.
 *
 * Layer:     L7 (McpAgentClient)
 * Invariants pinned:
 *   G2 — Duplicate hub-event (same id + entity + timestamp) delivered twice
 *        is routed once. Guards the dedup filter on the hot path: if
 *        Last-Event-ID replay lands a second copy of an already-seen
 *        event after a reconnect, the actionable/informational callbacks
 *        still fire exactly once.
 *   G3 — `getTransport()` returns the injected transport instance live,
 *        and `listMethods()` reflects what the hub currently advertises.
 *   G4 — A non-retriable error from the handshake call (e.g. 401 from a
 *        bearer-token auth path) propagates out of `start()` as a thrown
 *        exception and leaves the session in `disconnected`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { LoopbackHub, LoopbackTransport } from "../helpers/loopback-transport.js";
import { LogCapture, waitFor } from "../helpers/test-utils.js";
import { McpAgentClient } from "../../src/kernel/mcp-agent-client.js";
import type { AgentEvent } from "../../src/kernel/agent-client.js";

describe("Invariant gaps — G2/G3/G4", () => {
  let hub: LoopbackHub;
  let log: LogCapture;

  beforeEach(() => {
    hub = new LoopbackHub();
    log = new LogCapture();
  });

  // ── G2 ──────────────────────────────────────────────────────────────

  it("G2: duplicate hub-event (same id + entity + timestamp) is delivered once", async () => {
    const transport = new LoopbackTransport(hub);
    const agent = new McpAgentClient(
      { role: "engineer", logger: log.logger },
      { transport }
    );
    const actionable: AgentEvent[] = [];
    agent.setCallbacks({ onActionableEvent: (e) => actionable.push(e) });

    try {
      await agent.start();
      await waitFor(() => agent.isConnected, 5_000);

      // Craft a payload whose dedup hash (event + entity + timestamp)
      // is stable across two pushes. LoopbackHub generates a fresh wire
      // event id each call, but the dedup filter hashes on the
      // *application-level* timestamp carried in `data.timestamp`, so
      // as long as we pin that we get a collision.
      const payload = {
        id: 42,
        event: "thread_message",
        data: { threadId: "th-dup", body: "hi", timestamp: "2026-04-15T00:00:00.000Z" },
        timestamp: "2026-04-15T00:00:00.000Z",
      };
      transport._deliverPush("hub-event", payload);
      transport._deliverPush("hub-event", payload);

      await waitFor(() => actionable.length >= 1, 2_000);
      // A second pass is allowed to accumulate for a brief window
      // before we assert — if dedup were broken we'd see length === 2.
      await new Promise((r) => setTimeout(r, 50));
      expect(actionable.length).toBe(1);

      const m = agent.getMetrics();
      expect(m.dedupDropCount).toBe(1);
    } finally {
      await agent.stop();
    }
  });

  // ── G3 ──────────────────────────────────────────────────────────────

  it("G3: getTransport() returns the injected instance and listMethods reflects hub state", async () => {
    const transport = new LoopbackTransport(hub);
    const agent = new McpAgentClient(
      { role: "engineer", logger: log.logger },
      { transport }
    );

    try {
      await agent.start();
      await waitFor(() => agent.isConnected, 5_000);

      // The transport handed out must be the exact instance injected —
      // no wrapping, no proxy. This is what shims rely on for the
      // listToolsRaw() escape hatch.
      expect(agent.getTransport()).toBe(transport);

      // listMethods() must reflect the hub's current advertised tools.
      const methods = await agent.listMethods();
      expect(methods).toContain("register_role");
      expect(methods).toContain("get_task");
      expect(methods).toContain("get_pending_actions");

      // After adding a new tool on the hub, listMethods reflects it
      // immediately — the transport isn't caching a stale snapshot.
      hub.setHandler("custom_tool", () => ({ ok: true }));
      const methodsAfter = await agent.listMethods();
      expect(methodsAfter).toContain("custom_tool");
    } finally {
      await agent.stop();
    }
  });

  // ── G4 ──────────────────────────────────────────────────────────────

  it("G4: non-retriable handshake error (401) propagates out of start() and leaves session disconnected", async () => {
    const transport = new LoopbackTransport(hub);
    const agent = new McpAgentClient(
      { role: "engineer", logger: log.logger },
      { transport }
    );

    // Simulate the MCP SDK surfacing a 401 from the bearer-token auth
    // path during the bootstrap register_role call. The LoopbackHub's
    // one-shot error injection fires exactly once; if start() tries to
    // retry the same call it would succeed the second time. The
    // invariant is that it does NOT retry: the error propagates.
    hub.injectToolError("register_role", "401 Unauthorized");

    await expect(agent.start()).rejects.toThrow(/401|Unauthorized/i);

    expect(agent.state).toBe("disconnected");
    expect(agent.isConnected).toBe(false);
  });
});
