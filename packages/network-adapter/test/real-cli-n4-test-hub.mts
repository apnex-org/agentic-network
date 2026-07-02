/**
 * M-Real-CLI-Harness n4 — standalone test-Hub-WITH-WORK entrypoint.
 *
 * Wraps createN4TestHub (real HubNetworking + the FULL production PolicyRouter bound via
 * bindRouterToMcp + a seeded ready engineer-claimable WorkItem) with a thin control HTTP
 * server, and runs it as a PROCESS — locally for the Seam-1 render-receipt, on the VM for
 * the Seam-2 container acting-confirm. The shim connects to MCP_PORT and proxies the REAL
 * Hub tool catalogue.
 *
 * VACUITY-GUARD: this Hub is ONLY the queryable work-surface + the seed. The
 * work_claimable_digest is constructed by the REAL shim/kernel (heartbeat ->
 * list_ready_work -> digest -> notifications/claude/channel), reused verbatim — NOT faked
 * here. A real claude-code CLI must autonomously ACT on it. See helpers/n4-work-hub.ts.
 *
 * PACKAGED via esbuild -> a self-contained .mjs (memory-mode = no `pg`), runs on plain
 * node:22 with NO repo + NO tsx on the VM (same model as the P1e-2 standalone). ZERO prod
 * surface — TEST code only.
 *
 * Ports (env-overridable): MCP_PORT 8080 (/mcp — the shim connects here) + CONTROL_PORT 8090
 * (/health + /workitem — readiness + the seeded item's FSM, for the harness/evidence).
 */
import http from "node:http";
import { createN4TestHub, seedSelfTestWorkItem } from "./helpers/n4-work-hub.js";

const MCP_PORT = Number(process.env.MCP_PORT) || 8080;
const CONTROL_PORT = Number(process.env.CONTROL_PORT) || 8090;
const BIND = process.env.BIND || "0.0.0.0";
// KEEPALIVE_MS — defaults to the prod-faithful 30_000 (see helpers/n4-work-hub.ts). Overridable
// ONLY for diagnosing the direct-localhost SSE-warmth gap (prod runs behind the Cloud Run nginx
// proxy that keeps the socket warm; a direct connection may need a warmer keepalive). Not for prod.
const KEEPALIVE_MS = process.env.KEEPALIVE_MS ? Number(process.env.KEEPALIVE_MS) : undefined;
// The container write-surface for the seeded self-test (n2 sandbox: /work is the only
// host write-mount). Overridable so a local Seam-1 run can target a throwaway dir.
const PROOF_PATH = process.env.SEEDED_PROOF_PATH || "/work/n4-proof.txt";
// n5 chaos: how long the silent-wedge sustains (evict every 50ms) — long enough to outlast the
// container's L1.5 reconnect attempts so the probe stays failed -> sentinel -> supervisor exit-75.
const WEDGE_TTL_MS = Number(process.env.WEDGE_TTL_MS) || 12_000;
// Eviction cadence during a wedge. Default 50ms (P1e-2). n5 finding: 50ms leaves gaps the agent's
// 2s liveness-probe slips through + the kernel L1 reconnect recovers between failures, so the
// watchdog never hits its 2-consecutive-failure budget → no sentinel → no L2. A tighter cadence
// (e.g. 5ms) closes the gap so the wedge DEFEATS L1 and drives the L1.5→sentinel→L2 path.
const WEDGE_INTERVAL_MS = Number(process.env.WEDGE_INTERVAL_MS) || 50;

const th = createN4TestHub({ port: MCP_PORT, bindAddress: BIND, quiet: false, keepaliveInterval: KEEPALIVE_MS });
await th.start();
console.log(`[n4-hub] MCP up: ${th.url} (bind ${BIND}:${MCP_PORT}) — FULL work-policy surface via bindRouterToMcp`);

const seededWorkId = await seedSelfTestWorkItem(th.workItem, PROOF_PATH);
console.log(`[n4-hub] seeded ready engineer work item: ${seededWorkId} (proof -> ${PROOF_PATH})`);

// Control server — readiness + the seeded item's FSM state (the evidence-observe surface:
// ready -> claimed -> in_progress -> done as the real CLI drives it). GET only; no mutation.
const control = http.createServer((req, res) => {
  void (async () => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, mcpUrl: th.url, seededWorkId, proofPath: PROOF_PATH }));
    } else if (req.method === "GET" && req.url === "/workitem") {
      const item = await th.workItem.getWorkItem(seededWorkId);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: seededWorkId,
        status: item?.status ?? "missing",
        leaseHolder: item?.lease?.holder ?? null,
        evidenceCount: item?.evidence?.length ?? 0,
        evidence: item?.evidence ?? [],
      }));
    } else if (req.method === "POST" && req.url === "/wedge") {
      // n5 chaos (b) — model an L1-UNRECOVERABLE session (architect steer; the faithful L2 test):
      // setWedged(true) makes every tool call THROW for the TTL, so the shim's L1 reconnect handshake
      // (register_role/claim_session) FAILS AND every get_task liveness-probe FAILS -> 2 CONSECUTIVE
      // failures (no recovery to reset the watchdog counter) -> /run/adapter-wedged -> supervisor
      // exit(75) -> docker-L2 restart -> fresh container re-boots + re-handshakes (zero-human, dialog
      // auto-accepted). Evict the current transports too (immediate drop). Keepalives (SSE) untouched
      // = the keepalives-flowing-but-session-DEAD edge L1.5 exists for. (Not (a) eviction-density —
      // that games the probe timing, an unfaithful test, cal #79/#82.)
      const evicted = th.evictAllTransports();
      th.setWedged(true);
      const iv = setInterval(() => th.evictAllTransports(), WEDGE_INTERVAL_MS);
      setTimeout(() => { clearInterval(iv); th.setWedged(false); }, WEDGE_TTL_MS);
      console.log(`[n5-hub] WEDGE (b): REJECTING tool-calls + handshake for ${WEDGE_TTL_MS}ms (evicted ${evicted}; SSE untouched — L1-unrecoverable)`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ wedged: true, evicted, ttlMs: WEDGE_TTL_MS, mode: "reject-handshake-and-probe" }));
    } else if (req.method === "POST" && req.url === "/reseed") {
      // n5 chaos re-claim: seed a FRESH ready item so the L2-recovered CLI has work to re-claim
      // (the original seed is already done from the first self-drive).
      const id = await seedSelfTestWorkItem(th.workItem, PROOF_PATH);
      console.log(`[n5-hub] RESEED: fresh ready engineer item ${id}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ reseeded: id }));
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  })();
});
control.listen(CONTROL_PORT, BIND, () => {
  console.log(`[n4-hub] control up: GET http://${BIND}:${CONTROL_PORT}/health | /workitem`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[n4-hub] ${sig} -> stopping`);
    void th.stop().finally(() => process.exit(0));
  });
}
