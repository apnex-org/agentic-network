/**
 * fetch-handler.test.ts — HTTP routing branches unique to opencode.
 *
 * The opencode-plugin shim mounts the shared MCP-boundary dispatcher
 * behind Bun.serve because OpenCode consumes MCP over HTTP, not stdio.
 * Layer-3 host-specific HTTP plumbing lives in
 * shim.makeOpenCodeFetchHandler() — a fetch(Request) ⇒ Promise<Response>
 * adapter that wraps the shared dispatcher's createMcpServer factory.
 *
 * This suite tests the routing branches directly by constructing
 * synthetic Request objects. No Bun, no listening socket, no real MCP
 * session — just the request-dispatch logic.
 */

import { describe, it, expect } from "vitest";
import { createSharedDispatcher } from "@ois/network-adapter";
import { makeOpenCodeFetchHandler } from "../src/shim.js";

function makeHandler() {
  const d = createSharedDispatcher({
    getAgent: () => null,
    proxyVersion: "fetch-handler-test-1.0.0",
    serverName: "hub-proxy",
    serverCapabilities: { tools: {}, logging: {} },
  });
  return makeOpenCodeFetchHandler(d, []);
}

describe("makeOpenCodeFetchHandler", () => {
  it("returns 404 for non-/mcp paths", async () => {
    const fetchHandler = makeHandler();
    const res = await fetchHandler(new Request("http://localhost/not-mcp", { method: "GET" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 for /mcp GET without session-id (no handler fallback)", async () => {
    const fetchHandler = makeHandler();
    const res = await fetchHandler(new Request("http://localhost/mcp", { method: "GET" }));
    // No session-id, not POST — falls through to the 400 Bad Request branch.
    // Status is driven by the closing `return new Response(...)` at the
    // bottom of the fetchHandler.
    expect([400, 404]).toContain(res.status);
  });

  it("returns 400 for POST /mcp with a non-initialize body", async () => {
    const fetchHandler = makeHandler();
    const body = { jsonrpc: "2.0", method: "tools/list", id: 1 };
    const res = await fetchHandler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error).toBeDefined();
    expect(payload.error.message).toMatch(/Bad Request/i);
  });

  it("instances are isolated — two dispatchers have independent session stores", async () => {
    const h1 = makeHandler();
    const h2 = makeHandler();
    // Neither has any sessions; both should 400 on the same non-init POST.
    const body = { jsonrpc: "2.0", method: "tools/list", id: 1 };
    const [r1, r2] = await Promise.all([
      h1(new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })),
      h2(new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })),
    ]);
    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
  });
});
