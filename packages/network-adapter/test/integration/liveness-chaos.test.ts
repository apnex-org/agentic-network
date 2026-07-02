/**
 * L1.5 liveness watchdog — CHAOS validation (M-Adapter-Modernization P1c, Design §4/§9).
 *
 * Proves the keepalives-flowing-but-session-dead edge end-to-end against a REAL
 * TestHub (real hub-networking + real SSE/POST + real session FSM), at integration
 * level (the honest+sufficient bar for P1c per the architect; the REAL docker-L2
 * container-exit e2e is P1e's acceptance — P1c proves the signal is EMITTED, P1e
 * proves it is CONSUMED). Zero manual intervention in every arm.
 *
 *   Arm A — the LIVED INCIDENT, recoverable: kill the session server-side while
 *           the SSE keepalive flows. The proactive session-probe surfaces the
 *           otherwise-idle dead session -> L1 session_invalid -> reconnect -> heal
 *           (fresh sessionId, streaming). The watchdog does NOT self-exit when L1
 *           can recover (it must not fight forever-backoff). This is the exact
 *           wedge I hit this session, now auto-detected + auto-healed.
 *
 *   Arm B — UNRECOVERABLE -> self-exit signal -> L2 restart -> re-handshake/re-claim:
 *           the session is dead AND reconnect cannot re-establish it. The watchdog's
 *           probe fails the budget -> onLivenessLost -> the kernel->supervisor SENTINEL
 *           is written (exitCode 75). A FRESH McpAgentClient (== the L2-restarted
 *           container) then re-handshakes + re-registers against the still-up Hub.
 *           Restart-mid-long-cognitive-node: the self-exit is state-agnostic (it just
 *           writes the sentinel + exits); in-flight work durability rides on L3
 *           lease-reclaim (Design §4 demotion) — fully validated at P1e's container e2e.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestHub } from "../helpers/test-hub.js";
import { LogCapture, waitFor } from "../helpers/test-utils.js";
import { McpAgentClient } from "../../src/kernel/mcp-agent-client.js";
import { LivenessWatchdog } from "../../src/kernel/liveness-watchdog.js";
import { emitLivenessLostSignal } from "../../src/kernel/liveness-signal.js";

function makeAgent(hub: TestHub, log: LogCapture): McpAgentClient {
  return new McpAgentClient(
    { role: "engineer", logger: log.logger },
    { transportConfig: { url: hub.url, token: "" } },
  );
}

/** A session-requiring probe: a real call() (carries L1's session_invalid retry). */
function sessionProbe(agent: McpAgentClient): () => Promise<boolean> {
  return async () => {
    try {
      await agent.call("get_task", {});
      return true;
    } catch {
      return false;
    }
  };
}

describe("L1.5 liveness watchdog — chaos (keepalives-flowing-but-session-dead)", () => {
  let hub: TestHub;

  beforeEach(async () => {
    hub = new TestHub({ sessionTtl: 30_000, orphanTtl: 10_000, autoStartTimers: false });
    await hub.start();
  });

  afterEach(async () => {
    try {
      await hub.stop();
    } catch {
      /* ignore */
    }
  });

  it("Arm A — named edge, recoverable: probe surfaces the server-side-dead session while keepalive flows -> L1 heals, NO self-exit", async () => {
    const log = new LogCapture();
    const agent = makeAgent(hub, log);
    const sentinels: Array<{ path: string; data: string }> = [];
    const wd = new LivenessWatchdog({
      probe: sessionProbe(agent),
      probeIntervalMs: 1_000,
      failureBudget: 3,
      onLivenessLost: (info) =>
        emitLivenessLostSignal({
          consecutiveFailures: info.consecutiveFailures,
          lastError: info.lastError,
          sentinelPath: "/tmp/p1c-armA-sentinel",
          writeFile: (path, data) => sentinels.push({ path, data }),
        }),
    });

    try {
      await agent.start();
      await waitFor(() => agent.isConnected, 10_000);
      const sid1 = agent.getSessionId();
      expect(sid1).toBeTruthy();

      // THE NAMED EDGE: kill the session server-side; keep the SSE keepalive flowing.
      await hub.destroySession(sid1!);
      await hub.sendKeepalive(); // transport stays "connected" — the wedge condition

      // Proactive probe: the call surfaces the dead session -> session_invalid ->
      // reconnect -> re-register. (Without this probe, an idle agent would never
      // call() and the dead session would sit undetected — the lived wedge.)
      await wd.tick();
      await waitFor(() => agent.state === "streaming", 15_000);

      const sid2 = agent.getSessionId();
      expect(sid2).toBeTruthy();
      expect(sid2).not.toBe(sid1); // re-handshaked onto a fresh session
      expect(wd.hasFired).toBe(false); // recoverable -> watchdog must NOT self-exit
      expect(sentinels).toHaveLength(0); // no wedged-restart signal emitted
    } finally {
      wd.stop();
      await agent.stop().catch(() => {});
    }
  });

  it("Arm B — unrecoverable: probe fails the budget -> self-exit signal (sentinel, code 75) -> fresh client re-handshakes + re-claims", async () => {
    const log = new LogCapture();
    const agent = makeAgent(hub, log);
    const sentinels: Array<{ path: string; data: string }> = [];
    const wd = new LivenessWatchdog({
      probe: sessionProbe(agent),
      probeIntervalMs: 1_000,
      failureBudget: 2,
      onLivenessLost: (info) =>
        emitLivenessLostSignal({
          consecutiveFailures: info.consecutiveFailures,
          lastError: info.lastError,
          sentinelPath: "/tmp/p1c-armB-sentinel",
          writeFile: (path, data) => sentinels.push({ path, data }),
        }),
    });

    try {
      await agent.start();
      await waitFor(() => agent.isConnected, 10_000);
      const registersBefore = hub.getToolCalls("register_role").length;

      // UNRECOVERABLE wedge: every wire request now fails session-dead, incl. the
      // reconnect's register_role -> L1 forever-backoff cannot re-establish.
      const transport = agent.getTransport() as unknown as {
        request: (m: string, p: Record<string, unknown>) => Promise<unknown>;
      };
      transport.request = async () => {
        throw new Error("MCP error -32000: Session not found: wedged-unrecoverable");
      };

      await wd.tick(); // fail 1
      expect(wd.hasFired).toBe(false);
      await wd.tick(); // fail 2 -> budget exhausted -> escalate
      expect(wd.hasFired).toBe(true);

      // The kernel->supervisor SIGNAL is emitted (P1e's supervisor consumes it).
      expect(sentinels).toHaveLength(1);
      const payload = JSON.parse(sentinels[0].data);
      expect(payload.reason).toBe("session-wedged");
      expect(payload.exitCode).toBe(75); // EX_TEMPFAIL — the CONTAINER exit code for docker-L2
      expect(payload.consecutiveFailures).toBe(2);

      // The wedged process exits. Stand in the L2-restarted container with a FRESH
      // client against the still-up Hub: it re-handshakes -> streaming -> re-registers
      // (re-claim). Zero manual intervention.
      wd.stop();
      await agent.stop().catch(() => {});

      const log2 = new LogCapture();
      const fresh = makeAgent(hub, log2);
      try {
        await fresh.start();
        await waitFor(() => fresh.isConnected, 15_000);
        expect(fresh.state).toBe("streaming");
        expect(hub.getToolCalls("register_role").length).toBeGreaterThan(registersBefore);
      } finally {
        await fresh.stop().catch(() => {});
      }
    } finally {
      wd.stop();
    }
  });
});
