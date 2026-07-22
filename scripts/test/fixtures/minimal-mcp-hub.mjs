import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const result = (body) => ({ content: [{ type: "text", text: JSON.stringify(body) }] });

export async function startMinimalMcpHub() {
  const app = express();
  app.use(express.json());
  const transports = new Map();
  const servers = new Map();
  const calls = [];

  function createServer() {
    const server = new McpServer({ name: "claude-plugin-product-smoke-hub", version: "1.0.0" });
    const handlers = {
      register_role: (args) => ({
        ok: true,
        agent: { id: "agent-product-smoke", name: String(args.name ?? "product-smoke") },
        session: { epoch: 1 },
        wasCreated: true,
      }),
      claim_session: () => ({ ok: true, agent: { id: "agent-product-smoke" }, session: { epoch: 1, claimed: true, trigger: "fixture" } }),
      list_missions: () => ({ missions: [], total: 0 }),
      get_pending_actions: () => ({ pendingProposals: [], activeThreads: [], totalPending: 0 }),
      drain_pending_actions: () => ({ items: [] }),
    };
    for (const [name, handler] of Object.entries(handlers)) {
      server.registerTool(
        name,
        { description: `fixture ${name}`, inputSchema: z.object({}).passthrough() },
        async (args) => {
          calls.push({ name, args });
          return result(handler(args));
        },
      );
    }
    return server;
  }

  app.get("/health", (_request, response) => response.json({ status: "ok", toolSurfaceRevision: "fixture-v1" }));
  app.post("/mcp", async (request, response) => {
    const sessionId = request.headers["mcp-session-id"];
    if (typeof sessionId === "string" && transports.has(sessionId)) {
      await transports.get(sessionId).handleRequest(request, response, request.body);
      return;
    }
    if (!sessionId && isInitializeRequest(request.body)) {
      let server;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports.set(newSessionId, transport);
          servers.set(newSessionId, server);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
          servers.delete(transport.sessionId);
        }
      };
      server = createServer();
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
      return;
    }
    response.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "invalid fixture session" }, id: null });
  });
  app.get("/mcp", async (request, response) => {
    const sessionId = request.headers["mcp-session-id"];
    if (typeof sessionId !== "string" || !transports.has(sessionId)) {
      response.status(400).send("invalid fixture session");
      return;
    }
    await transports.get(sessionId).handleRequest(request, response);
  });
  app.delete("/mcp", async (request, response) => {
    const sessionId = request.headers["mcp-session-id"];
    if (typeof sessionId !== "string" || !transports.has(sessionId)) {
      response.status(400).send("invalid fixture session");
      return;
    }
    await transports.get(sessionId).handleRequest(request, response);
  });

  const httpServer = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("fixture Hub did not bind a TCP port");

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    calls,
    async close() {
      await Promise.all([...transports.values()].map((transport) => transport.close().catch(() => {})));
      await Promise.all([...servers.values()].map((server) => server.close().catch(() => {})));
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}
