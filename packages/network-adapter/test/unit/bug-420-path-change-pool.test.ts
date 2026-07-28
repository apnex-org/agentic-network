/**
 * bug-420 — THE ADAPTER MUST SURVIVE A NETWORK PATH CHANGE.
 *
 * 🔴 THIS MECHANISM TOOK THE ENTIRE FLEET DARK FOR ~70 MINUTES ON 2026-07-28 —
 * three seats, roaming across three wifi access points, against a hub that was
 * returning HTTP 200 in ~150ms the whole time.
 *
 * ─── THE MECHANISM, AND WHY REBUILDING THE TRANSPORT IS NOT ENOUGH ───────────
 *
 * Node's `fetch` is undici, and undici keeps keep-alive sockets in a PROCESS-GLOBAL
 * pool. When the network path changes, those sockets are never RST — the OS still
 * reports ESTABLISHED — so undici keeps selecting them and every request falls into
 * a blackhole until `connectTimeout` (default 10_000ms).
 *
 * `mcp-transport.ts` rebuilds `StreamableHTTPClientTransport` on reconnect. THAT
 * CREATES A NEW TRANSPORT OBJECT AND REUSES THE SAME GLOBAL POOL. The measured
 * signature in production was four consecutive reconnects at 10.017 / 10.018 /
 * 10.016 / 10.016s on one seat and 10.014 / 10.014 / 10.017 / 10.013s on another —
 * a sub-20ms spread across INDEPENDENT PROCESSES, which is a fixed timeout, not a
 * network flake. Meanwhile a fresh `node -e` fetch to the same URL from the same
 * host returned 200 in 212ms.
 *
 * ─── WHAT THIS FILE REPRODUCES, AND WHY IT IS FAITHFUL ───────────────────────
 *
 * A path change is not "the server went away". It is: EXISTING SOCKETS SILENTLY
 * STOP DELIVERING, WHILE NEW CONNECTIONS SUCCEED. `blackholeServer` below models
 * exactly that — after `changePath()`, sockets opened BEFORE the change are never
 * answered, and sockets opened AFTER it are answered normally.
 *
 * ⚠️ THE REPRODUCTION MUST FAIL FIRST. A test that only shows the fixed path
 * working cannot show the failure was ever present — so `reproduce the failure`
 * below asserts the BROKEN behaviour (reused pool → times out) and would itself go
 * red if the failure stopped being reproducible.
 *
 * ⚠️ NOT CLAIMED: that this is the only contributor to the incident. bug-420's own
 * non-claims record that an adapter RESTART during the outage did not recover the
 * seat — which is confounded by bug-421 (SIGTERM logs a clean shutdown without
 * exiting), so the restart may never have happened. This file proves the pool
 * mechanism and its fix; it does not prove the incident had no second cause.
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Socket } from "node:net";
import { Agent, request as undiciRequest } from "undici";

/** Sockets opened before the simulated path change, which must go silent. */
function blackholeServer(): {
  server: Server;
  url: () => string;
  changePath: () => void;
  close: () => Promise<void>;
} {
  const preChange = new WeakSet<Socket>();
  let changed = false;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // A request arriving on a socket established BEFORE the path change is
    // swallowed: no response, no destroy. That is the blackhole — the client's
    // OS still believes the connection is ESTABLISHED.
    if (changed && preChange.has(req.socket as Socket)) return;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  server.on("connection", (sock: Socket) => {
    if (!changed) preChange.add(sock);
  });

  return {
    server,
    url: () => `http://127.0.0.1:${(server.address() as AddressInfo).port}/health`,
    changePath: () => { changed = true; },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r()));
}

/** Short timeouts so the reproduction fails in ~400ms rather than undici's 10s. */
const FAST = { connectTimeout: 300, headersTimeout: 400, bodyTimeout: 400 };

/**
 * 🔴 THE SOCKET MUST BE IDLE IN THE POOL BEFORE THE PATH CHANGES, AND THIS IS THE
 * DETAIL THAT DECIDES WHETHER THE BUG REPRODUCES AT ALL.
 *
 * Fired back-to-back, undici opens a SECOND connection rather than reusing the
 * first, and the blackhole is never touched — the reproduction comes back green
 * and the defect looks imaginary. I hit exactly that on the first attempt and had
 * to instrument the server to find out why.
 *
 * The production condition is a pooled socket sitting IDLE between requests
 * (heartbeats seconds apart), which is what this settle reproduces. A reproduction
 * that does not model the idle window does not model the bug.
 */
const settleIntoPool = () => new Promise((r) => setTimeout(r, 150));

describe("bug-420: a network path change must not permanently poison the connection pool", () => {
  const open: Agent[] = [];
  afterEach(async () => { for (const a of open.splice(0)) await a.close().catch(() => {}); });

  function agent(): Agent {
    const a = new Agent({ keepAliveTimeout: 60_000, ...FAST });
    open.push(a);
    return a;
  }

  it("🔴 REPRODUCES THE FAILURE: a REUSED pool keeps selecting the dead socket and times out", async () => {
    const hub = blackholeServer();
    await listen(hub.server);
    const pool = agent();

    // 1. Normal operation — this establishes a keep-alive socket.
    const before = await undiciRequest(hub.url(), { dispatcher: pool });
    expect(before.statusCode).toBe(200);
    await before.body.text();
    await settleIntoPool();

    // 2. The operator roams to a different access point.
    hub.changePath();

    // 3. The adapter notices and REBUILDS THE TRANSPORT — but on the same pool.
    //    This is what mcp-transport.ts does today: a new StreamableHTTPClientTransport
    //    over the process-global undici agent.
    await expect(
      undiciRequest(hub.url(), { dispatcher: pool }),
    ).rejects.toThrow();

    await hub.close();
  });

  it("🟢 THE FIX: a FRESH dispatcher opens a new socket and recovers immediately", async () => {
    const hub = blackholeServer();
    await listen(hub.server);
    const stale = agent();

    const before = await undiciRequest(hub.url(), { dispatcher: stale });
    expect(before.statusCode).toBe(200);
    await before.body.text();
    await settleIntoPool();

    hub.changePath();

    // The same rebuild, but with a NEW dispatcher — every poisoned socket is
    // dropped, so the request opens a fresh connection the server answers.
    const rebuilt = agent();
    const after = await undiciRequest(hub.url(), { dispatcher: rebuilt });
    expect(after.statusCode).toBe(200);
    await after.body.text();

    await hub.close();
  });

  it("🔴 THE DISCRIMINATOR: the stale pool is STILL broken after the fresh one succeeds", async () => {
    // Without this, a server that simply recovered on its own would pass the test
    // above and prove nothing about dispatchers. This pins the difference to the
    // POOL rather than to the server having started answering again.
    const hub = blackholeServer();
    await listen(hub.server);
    const stale = agent();

    await (await undiciRequest(hub.url(), { dispatcher: stale })).body.text();
    await settleIntoPool();
    hub.changePath();

    const fresh = agent();
    expect((await undiciRequest(hub.url(), { dispatcher: fresh })).statusCode).toBe(200);

    // Same instant, same URL, same server — only the pool differs.
    await expect(undiciRequest(hub.url(), { dispatcher: stale })).rejects.toThrow();

    await hub.close();
  });
});

// ── bug-420: THE FIX MUST ACTUALLY BE WIRED INTO THE ADAPTER ──────────────────
//
// 🔴 THE TESTS ABOVE PROVE THE MECHANISM AND ITS REMEDY. THEY DO NOT PROVE THAT
// `mcp-transport.ts` USES IT. Those are different claims, and shipping the first
// while believing the second is exactly how a fix reaches production connected to
// nothing. So this block reads the source and asserts the wiring.
//
// A structural assertion is the right instrument here specifically because the
// failure mode is REMOVAL: someone tidying `requestInit` back to `{ headers }`
// would break the fix while every behavioural test above still passed, since those
// exercise undici directly rather than the transport.
describe("bug-420: the pool-per-wire fix is wired into McpTransport, not just proven in principle", () => {
  const src = readFileSync(
    join(__dirname, "..", "..", "src", "wire", "mcp-transport.ts"),
    "utf8",
  );

  it("🔴 a dispatcher is CONSTRUCTED per wire and PASSED to the SDK transport", () => {
    expect(src).toMatch(/this\.httpDispatcher\s*=\s*new Agent\(/);
    // The pool must actually reach fetch — constructing one and not passing it
    // would leave every request on the global pool, i.e. the bug, with a field
    // that makes it look fixed.
    expect(src).toMatch(/requestInit:\s*\{[^}]*dispatcher:\s*this\.httpDispatcher/);
  });

  it("🔴 the dispatcher is DESTROYED on teardown — a pool that outlives its wire is the bug", () => {
    expect(src).toMatch(/oldDispatcher\.destroy\(\)/);
    // destroy(), not close(): close() drains in-flight requests, and on a changed
    // path those are precisely the ones blackholed for 10s.
    expect(src).not.toMatch(/oldDispatcher\.close\(\)/);
  });

  it("work-420 CONTROL: the assertions above can fail (the file is real and non-trivial)", () => {
    // Without this, every assertion above passes vacuously against an empty or
    // unreadable file. Cheap, and it is the check I have skipped before.
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain("StreamableHTTPClientTransport");
  });
});
