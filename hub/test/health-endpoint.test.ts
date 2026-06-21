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
});
