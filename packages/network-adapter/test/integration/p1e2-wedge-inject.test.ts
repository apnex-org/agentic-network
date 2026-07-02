/**
 * P1e-2 silent wedge inject — faithfulness test (M-Adapter-Modernization Design §4/§9).
 *
 * Proves the wedge the LIVE docker-L2 e2e relies on is the SILENT one (keepalives-flowing-
 * but-session-dead), NOT a transport drop: evictAllTransports removes the session from the
 * REAL transports map (so the adapter's next get_task POST 400s -> the watchdog probe REJECTS
 * = the L1.5 trigger) WITHOUT closing the SSE (sseActive unchanged + keepalive still flows ->
 * the transport-watchdog stays green -> L1.5, not L1, escalates). Contrast: destroySession ->
 * transport.close() would drop the SSE (an L1 test).
 *
 * Mutation-proof: stub evictAllTransports to a no-op and `expect(hub.sessionCount).toBe(0)`
 * goes RED — i.e. it catches a vacuous wedge that doesn't actually evict.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestHub } from "../helpers/test-hub.js";
import { LogCapture, waitFor } from "../helpers/test-utils.js";
import { McpAgentClient } from "../../src/kernel/mcp-agent-client.js";

describe("P1e-2 silent wedge — evictAllTransports (probe 400s; SSE/keepalive stay up = L1.5, not L1)", () => {
  let hub: TestHub;

  beforeEach(async () => {
    hub = new TestHub({ autoStartTimers: false });
    await hub.start();
  });

  afterEach(async () => {
    try {
      await hub.stop();
    } catch {
      /* ignore */
    }
  });

  it("evicts the session from transports (probe will 400) WITHOUT closing the SSE (keepalive still flows)", async () => {
    const log = new LogCapture();
    const agent = new McpAgentClient(
      { role: "engineer", logger: log.logger },
      { transportConfig: { url: hub.url, token: "" } },
    );
    try {
      await agent.start();
      await waitFor(() => agent.isConnected, 10_000);

      // Live session: present in transports + SSE active + keepalive flowing.
      expect(hub.sessionCount).toBeGreaterThan(0);
      const sseBefore = hub.sseActiveCount;
      expect(sseBefore).toBeGreaterThan(0);
      expect(await hub.sendKeepalive()).toBeGreaterThan(0);

      // WEDGE: evict from the REAL transports map.
      const evicted = hub.evictAllTransports();
      expect(evicted).toBeGreaterThan(0);

      // transports cleared -> the adapter's next get_task POST 400s -> the watchdog probe
      // REJECTS (the L1.5 escalation trigger). MUTATION-PROOF: a no-op evictAllTransports
      // leaves sessionCount > 0 -> this assertion goes RED.
      expect(hub.sessionCount).toBe(0);

      // SILENT: the SSE is NOT closed (vs destroySession's transport.close()) -> sseActive
      // unchanged AND keepalive still flows. This keeps the transport-watchdog green so ONLY
      // L1.5 escalates.
      expect(hub.sseActiveCount).toBe(sseBefore);
      expect(await hub.sendKeepalive()).toBeGreaterThan(0);
    } finally {
      await agent.stop().catch(() => {});
    }
  }, 20_000);
});
