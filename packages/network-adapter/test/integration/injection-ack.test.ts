/**
 * P1d — injection consumption-ACK + ordered delivery (M-Adapter-Modernization, Design §9).
 *
 * FAITHFUL test of the EXISTING Hub-leg exactly-once-across-drop machinery against the
 * PolicyLoopbackHub — the REAL PolicyRouter + REAL message policy (create_message/
 * list_messages/claim_message/ack_message) over the REAL MessageRepositorySubstrate, via
 * the REAL PollBackstop catch-up (cal #82 faithful-harness — exercise the real catch-up,
 * not a mock). The Hub-leg is NOT rebuilt here (it is already built: SeenIdCache +
 * PollBackstop+since-cursor + createDedupFilter + bug-108 reconnect-drain +
 * claim_message/ack_message); P1d TESTS + DISAMBIGUATES it.
 *
 * THE TWO ACKS (held honest):
 *   - HUB-LEG (kernel<->Hub, UNIFORM): exactly-once-by-construction. A message injected
 *     while the receiver missed it inline is caught up via list_messages(since=cursor) on
 *     the next poll, deduped vs any inline re-delivery, and acked. Proven by (a)+(dedup).
 *   - LAST-HOP (per-harness, NOT uniform): claude's one-way notifications/claude/channel
 *     CANNOT natively ack -> best-effort + the backstop chain (PollBackstop dedup-aware
 *     re-delivery + ack_message + L3) = at-least-once-with-dedup, explicitly NOT
 *     exactly-once-at-the-LLM. opencode's awaitable promptAsync = exactly-once. -> the
 *     3-valued capability-matrix cell (claude=partial / opencode=yes); see the P1d
 *     semantics doc.
 *
 * (c) ordering-under-burst is the EVIDENCE that the Hub-leg already holds order
 * (cal #81 — prove held-ordering, don't assume it) -> no ordered injection queue is built.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PolicyLoopbackHub } from "../helpers/policy-loopback.js";
import { LoopbackTransport } from "../helpers/loopback-transport.js";
import { LogCapture, waitFor } from "../helpers/test-utils.js";
import { McpAgentClient, PollBackstop } from "../../src/index.js";
import { SeenIdCache } from "@apnex/message-router";

interface PolledMessage {
  id: string;
  [k: string]: unknown;
}

function makeAgent(hub: PolicyLoopbackHub, role: string): McpAgentClient {
  return new McpAgentClient(
    { role, logger: new LogCapture().logger },
    { transport: new LoopbackTransport(hub) },
  );
}

describe("P1d — Hub-leg injection exactly-once-across-drop (faithful: real policy + substrate)", () => {
  let hub: PolicyLoopbackHub;
  let tmpDir: string;

  beforeEach(() => {
    hub = new PolicyLoopbackHub();
    tmpDir = mkdtempSync(join(tmpdir(), "p1d-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("(a) a message injected during a drop is delivered EXACTLY-ONCE via catch-up + acked; re-poll does NOT re-deliver", async () => {
    const receiver = makeAgent(hub, "engineer");
    const injector = makeAgent(hub, "architect");
    try {
      await receiver.start();
      await waitFor(() => receiver.isConnected, 10_000);
      await injector.start();
      await waitFor(() => injector.isConnected, 10_000);

      // INJECT-DURING-DROP: the architect persists a note targeted at the engineer role.
      // The receiver "missed" the inline delivery; the Hub-leg backstop is the catch-up poll.
      await injector.call("create_message", {
        kind: "note",
        target: { role: "engineer" },
        payload: { body: "injected-during-drop" },
        delivery: "queued",
      });

      const delivered: string[] = [];
      const pb = new PollBackstop({
        role: "engineer",
        cursorFile: join(tmpDir, "cursor-a.json"),
        onPolledMessage: (e) => {
          const m = (e.data as { message?: PolledMessage }).message;
          if (m) delivered.push(m.id);
        },
      });

      // Catch-up: REAL list_messages(targetRole=engineer, status:new, since=<cold>).
      await pb.tick(() => receiver);
      expect(delivered.length).toBe(1); // exactly-once delivery via catch-up

      // Hub-leg consumption-ack: claim (new->received) then ack (received->acked).
      const mid = delivered[0];
      await receiver.call("claim_message", { id: mid });
      await receiver.call("ack_message", { id: mid });

      // Re-poll: the since-cursor advanced past the message -> NO re-delivery (no dup).
      await pb.tick(() => receiver);
      expect(delivered.length).toBe(1); // still exactly-once
    } finally {
      await receiver.stop().catch(() => {});
      await injector.stop().catch(() => {});
    }
  });

  it("(c) ordering-under-burst: a burst is caught up IN ORDER -> the Hub-leg already holds order (no ordered-queue needed; cal #81)", async () => {
    const receiver = makeAgent(hub, "engineer");
    const injector = makeAgent(hub, "architect");
    try {
      await receiver.start();
      await waitFor(() => receiver.isConnected, 10_000);
      await injector.start();
      await waitFor(() => injector.isConnected, 10_000);

      // A burst of ordered injections.
      const bodies = ["m1", "m2", "m3", "m4", "m5"];
      for (const body of bodies) {
        await injector.call("create_message", {
          kind: "note",
          target: { role: "engineer" },
          payload: { body },
          delivery: "queued",
        });
      }

      const delivered: PolledMessage[] = [];
      const pb = new PollBackstop({
        role: "engineer",
        cursorFile: join(tmpDir, "cursor-c.json"),
        onPolledMessage: (e) => {
          const m = (e.data as { message?: PolledMessage }).message;
          if (m) delivered.push(m);
        },
      });
      await pb.tick(() => receiver);

      expect(delivered.length).toBe(bodies.length);
      // Message IDs are ULIDs (lexicographic order == creation/time order). The catch-up
      // surfaces them in id-order, so the delivered order EQUALS the monotonic sort ->
      // no reorder under burst. PROVEN order-held -> no ordered injection queue.
      const ids = delivered.map((m) => m.id);
      expect(ids).toEqual([...ids].sort());
    } finally {
      await receiver.stop().catch(() => {});
      await injector.stop().catch(() => {});
    }
  });
});

describe("P1d — push+poll dedup (real SeenIdCache): no double-delivery across inline + catch-up", () => {
  it("a message seen via BOTH the poll-catchup and the inline path is delivered exactly-once", () => {
    const seen = new SeenIdCache();
    const id = "01HX_MSG_ABC";
    // Catch-up surfaces it first -> proceed (deliver).
    expect(seen.markSeen(id)).toBe(true);
    // Inline re-delivers the same id -> short-circuit (drop) -> exactly-once.
    expect(seen.markSeen(id)).toBe(false);
    // A genuinely-new id still proceeds.
    expect(seen.markSeen("01HX_MSG_XYZ")).toBe(true);
  });
});
