/**
 * P1e-2 standalone test-Hub — the network-servable TestHub (real HubNetworking over memory
 * stores) run as a PROCESS on the VM for the live docker-L2 restart e2e, plus a thin control
 * HTTP server exposing the silent-wedge inject. ZERO prod surface — TEST code only.
 *
 * PACKAGED via esbuild -> a self-contained .mjs (inlines hub/src + network-adapter; memory-mode
 * = no `pg` native dep), so it runs on plain node:22 with NO repo + NO tsx on the VM:
 *   esbuild test/p1e2-standalone-hub.mts --bundle --platform=node --format=esm \
 *     --target=node22 --outfile=p1e2-test-hub.mjs
 *   docker run --network p1e2-net --name p1e2-test-hub -p $CONTROL_PORT:$CONTROL_PORT \
 *     -v $PWD/p1e2-test-hub.mjs:/app/th.mjs node:22-alpine node /app/th.mjs
 *
 * Ports (env-overridable): MCP_PORT 8080 (/mcp, on the docker network for the adapter) +
 * CONTROL_PORT 8090 (/wedge + /health, published to the host for the bash harness). The
 * container adapter sets OIS_HUB_URL=http://p1e2-test-hub:8080/mcp and probes get_task (the
 * tool TestHub serves — NOT get_agents).
 */
import http from "node:http";
import { TestHub } from "./helpers/test-hub.js";
import { sustainedWedge } from "./helpers/wedge-inject.js";

const MCP_PORT = Number(process.env.MCP_PORT) || 8080;
const CONTROL_PORT = Number(process.env.CONTROL_PORT) || 8090;
const BIND = process.env.BIND || "0.0.0.0";
const WEDGE_TTL_MS = Number(process.env.WEDGE_TTL_MS) || 10_000;

const hub = new TestHub({
  port: MCP_PORT,
  bindAddress: BIND, // 0.0.0.0 so a docker container can reach it (vs the 127.0.0.1 test default)
  autoStartTimers: true, // keepalive flows (the wedge condition) + reaper runs
  sessionTtl: 3_600_000, // 1h — never reap the adapter session during the run
  orphanTtl: 3_600_000,
  quiet: false,
});
await hub.start();
console.log(`[p1e2-hub] MCP up: ${hub.url} (bind ${BIND}:${MCP_PORT}) — adapter probes get_task`);

// Control server — the silent-wedge inject. POST /wedge evicts the adapter's session from the
// real transports map every 50ms for WEDGE_TTL_MS WITHOUT closing the SSE -> each probe 400s ->
// L1.5 budget exhausts -> sentinel -> exit 75 -> docker restart -> (TTL lifts) fresh container
// re-handshakes. One POST, no host-side loop. GET /health for readiness.
const control = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/wedge") {
    sustainedWedge(hub, WEDGE_TTL_MS);
    console.log(`[p1e2-hub] WEDGE applied: evicting sessions from transports every 50ms for ${WEDGE_TTL_MS}ms (SSE untouched)`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ wedged: true, ttlMs: WEDGE_TTL_MS, sessions: hub.sessionCount }));
  } else if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, mcpUrl: hub.url, sessions: hub.sessionCount, sseActive: hub.sseActiveCount }));
  } else {
    res.writeHead(404);
    res.end("not found");
  }
});
control.listen(CONTROL_PORT, BIND, () => {
  console.log(`[p1e2-hub] control up: POST http://${BIND}:${CONTROL_PORT}/wedge (TTL ${WEDGE_TTL_MS}ms) | GET /health`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[p1e2-hub] ${sig} -> stopping`);
    void hub.stop().finally(() => process.exit(0));
  });
}
