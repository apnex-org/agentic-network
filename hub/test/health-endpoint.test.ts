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

  it("defaults version to 1.0.0 and toolSurfaceRevision to empty when unconfigured", async () => {
    // Empty toolSurfaceRevision → the adapter reads it as "unknown" and
    // falls back to its probe-friendly trust-cache default.
    hub = makeHub();
    await hub.start();

    const body = await (await fetch(`http://127.0.0.1:${hub.port}/health`)).json();
    expect(body.version).toBe("1.0.0");
    expect(body.toolSurfaceRevision).toBe("");
  });
});
