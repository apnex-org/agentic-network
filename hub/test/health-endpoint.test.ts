/**
 * /health endpoint tests (bug-114).
 *
 * Pins the `/health` response contract — in particular the bug-114
 * additions: a `version` field wired to config (no longer a hardcoded
 * "1.0.0" literal) and a `toolSurfaceRevision` ETag the network-adapter
 * keys its tool-catalog cache off.
 *
 * `/health` reads only `this.config` + session maps — it never touches
 * the injected stores — so the stores are stubbed; they are never called.
 */

import { describe, it, expect, afterEach } from "vitest";
import { HubNetworking, type CreateMcpServerFn, type HubNetworkingConfig } from "../src/hub-networking.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IAuditStore, IEngineerRegistry } from "../src/state.js";
import type { IMessageStore } from "../src/entities/message.js";
import { AdmissionGate } from "../src/storage-substrate/admission-gate.js";

const stubRegistry = {} as unknown as IEngineerRegistry;
const stubAudit = {} as unknown as IAuditStore;
const stubMessages = {} as unknown as IMessageStore;
const stubCreateMcpServer: CreateMcpServerFn = () => ({}) as unknown as McpServer;

function makeHub(config: HubNetworkingConfig = {}) {
  return new HubNetworking(
    stubRegistry,
    stubCreateMcpServer,
    { port: 0, bindAddress: "127.0.0.1", autoStartTimers: false, quiet: true, ...config },
    stubAudit,
    stubMessages,
  );
}

describe("/health endpoint", () => {
  let hub: HubNetworking | null = null;
  afterEach(async () => {
    if (hub) await hub.stop();
    hub = null;
  });

  it("reports the configured version + toolSurfaceRevision (bug-114)", async () => {
    hub = makeHub({ version: "1.4.2", toolSurfaceRevision: "234edbab843bcfe7" });
    await hub.start();

    const res = await fetch(`http://127.0.0.1:${hub.port}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json();

    expect(body.status).toBe("ok");
    expect(body.service).toBe("mcp-relay-hub");
    expect(body.version).toBe("1.4.2");
    expect(body.toolSurfaceRevision).toBe("234edbab843bcfe7");
    expect(body.activeSessions).toBe(0);
    expect(body.sseStreams).toBe(0);
  });

  it("reports configured gitSha + builtAt ALONGSIDE the ETag (C3-R1 M-Roll-Signal)", async () => {
    // The deploy-truth fields are ADDED to /health, not a replacement — the
    // bug-114 ETag must still be served (the network-adapter keys its cache
    // off it). gitSha is what the deploy-hub.yml roll-confirm step polls.
    hub = makeHub({
      version: "1.5.0",
      toolSurfaceRevision: "a11543f8e5545c25",
      gitSha: "2d741c9ddeadbeefcafe0123456789abcdef0123",
      builtAt: "2026-06-21T08:00:00Z",
    });
    await hub.start();

    const body = await (await fetch(`http://127.0.0.1:${hub.port}/health`)).json();
    // ETag preserved (bug-114) — not clobbered by the deploy-truth additions.
    expect(body.toolSurfaceRevision).toBe("a11543f8e5545c25");
    expect(body.gitSha).toBe("2d741c9ddeadbeefcafe0123456789abcdef0123");
    expect(body.builtAt).toBe("2026-06-21T08:00:00Z");
  });

  it("defaults version to 1.0.0 and toolSurfaceRevision to empty when unconfigured", async () => {
    // Empty toolSurfaceRevision → the adapter reads it as "unknown" and
    // falls back to its probe-friendly trust-cache default.
    hub = makeHub();
    await hub.start();

    const body = await (await fetch(`http://127.0.0.1:${hub.port}/health`)).json();
    expect(body.version).toBe("1.0.0");
    expect(body.toolSurfaceRevision).toBe("");
    // C3-R1 M-Roll-Signal — deploy-truth fields default empty (build-info
    // absent in local dev / tests); the roll-confirm reads "" as not-rolled.
    expect(body.gitSha).toBe("");
    expect(body.builtAt).toBe("");
  });

  it("EXPOSES repo-event-bridge delivery health on /health when the bridge is wired (bug-190 d)", async () => {
    // The (d) requirement: a poll-healthy-but-delivery-failing bridge must NOT be dark in prod.
    hub = makeHub({
      repoEventBridgeHealth: () => ({
        paused: false,
        lastSuccessfulPoll: "2026-06-28T20:00:00.000Z",
        deliveryFailing: true,
        lastSuccessfulDelivery: "2026-06-28T19:55:00.000Z",
      }),
    });
    await hub.start();
    const body = await (await fetch(`http://127.0.0.1:${hub.port}/health`)).json();
    expect(body.repoEventBridge).toMatchObject({
      deliveryFailing: true,
      lastSuccessfulDelivery: "2026-06-28T19:55:00.000Z",
    });
  });

  it("reports repoEventBridge: null on /health when no bridge is wired (local dev / tests)", async () => {
    hub = makeHub();
    await hub.start();
    const body = await (await fetch(`http://127.0.0.1:${hub.port}/health`)).json();
    expect(body.repoEventBridge).toBeNull();
  });

  // ── work-589 / bug-398 (D1): the list-admission gate must be READABLE ──────
  //
  // getListAdmissionSnapshot() shipped with ZERO consumers, so "why did the
  // gate saturate" was unanswerable by anyone. The gate is GLOBAL and strict
  // FIFO, so a two-row identity lookup can be refused behind someone else's
  // 500-row scan — which is how a handshake read fails and a seat degrades to
  // `anonymous-<role>`. These pin the counters to a caller-facing surface.

  it("reports listAdmission: null on /health when the substrate exposes no gate", async () => {
    hub = makeHub();
    await hub.start();
    const body = await (await fetch(`http://127.0.0.1:${hub.port}/health`)).json();
    expect(body.listAdmission).toBeNull();
  });

  it("EXPOSES the list-admission gate snapshot on /health when wired (work-589)", async () => {
    hub = makeHub({
      listAdmissionHealth: () => ({
        active: 3, queued: 7, maxActive: 8, maxQueued: 128,
        highWaterActive: 8, highWaterQueued: 40,
        admitted: 1234, rejectedQueueFull: 2, rejectedTimeout: 5,
      }),
    });
    await hub.start();
    const body = await (await fetch(`http://127.0.0.1:${hub.port}/health`)).json();
    // rejectedQueueFull vs rejectedTimeout is the load-bearing pair: it
    // distinguishes an instantaneous burst from sustained congestion, which
    // the truncated StorageAdmissionError text cannot.
    expect(body.listAdmission).toMatchObject({
      active: 3, queued: 7, maxActive: 8, maxQueued: 128,
      admitted: 1234, rejectedQueueFull: 2, rejectedTimeout: 5,
    });
  });

  it("🔴 the counters MOVE — /health reflects real gate traffic, not a frozen zero snapshot", async () => {
    // The falsifier that a static getter cannot pass. A REAL AdmissionGate is
    // driven with genuine admit + reject traffic (in-process, ephemeral, no
    // infrastructure), and /health must report the CHANGED counters. A getter
    // wired to a constant, or wired once at boot instead of read per request,
    // fails here while passing every assertion above.
    const gate = new AdmissionGate(1, 0, 1_000);
    hub = makeHub({ listAdmissionHealth: () => gate.snapshot() });
    await hub.start();

    const before = await (await fetch(`http://127.0.0.1:${hub.port}/health`)).json();
    expect(before.listAdmission).toMatchObject({ admitted: 0, rejectedQueueFull: 0, active: 0 });

    // Occupy the single slot, then force a queue-full rejection against it.
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const inFlight = gate.run(() => held);
    await expect(gate.run(async () => "second")).rejects.toThrow(/queue full/);

    const during = await (await fetch(`http://127.0.0.1:${hub.port}/health`)).json();
    expect(during.listAdmission).toMatchObject({ active: 1, admitted: 1, rejectedQueueFull: 1 });
    // Strictly moved, not merely non-zero.
    expect(during.listAdmission.admitted).toBeGreaterThan(before.listAdmission.admitted);
    expect(during.listAdmission.rejectedQueueFull).toBeGreaterThan(before.listAdmission.rejectedQueueFull);

    release();
    await inFlight;
    const after = await (await fetch(`http://127.0.0.1:${hub.port}/health`)).json();
    // Released slot is observable too — proves the value is read per request,
    // not captured once at wiring time.
    expect(after.listAdmission.active).toBe(0);
    expect(after.listAdmission.highWaterActive).toBe(1);
  });
});
