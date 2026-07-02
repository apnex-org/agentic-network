/**
 * P1e-2 SILENT wedge inject — the FAITHFUL "keepalives-flowing-but-session-dead" condition
 * (M-Adapter-Modernization Design §4/§9; cal #81 the lived wedge, cal #82 faithful-harness).
 *
 * WHY NOT destroySession: destroySession -> cleanupSession does `await transport.close()`
 * (hub-networking.ts:812), which CLOSES the adapter's SSE. The adapter's L1 transport-watchdog
 * detects that drop and reconnects — so the e2e would test L1, NOT L1.5. A vacuous green.
 *
 * WHY NOT a tool-handler throw (injectToolError): a thrown handler error comes back as an MCP
 * isError RESULT (the call RESOLVES), so the watchdog probe `await call(); return true` returns
 * true — no failure counted. The probe only REJECTS on a transport-level 400.
 *
 * THE FAITHFUL WEDGE: evict the session from the REAL `transports` map (TestHub.evictAllTransports)
 * WITHOUT closing the SSE. The adapter's next get_task POST 400s (`transports.has` false at
 * hub-networking.ts:930) -> the probe REJECTS, WHILE `sendKeepalive` keeps flowing (it iterates
 * `servers` + `sseActive`, left intact) -> the transport-watchdog stays green -> ONLY L1.5
 * escalates. ZERO prod-Hub surface — all in TEST code (the safety-before-leverage reason
 * PATH 2-prime was chosen over a prod-Hub destroy endpoint).
 */
import type { TestHub } from "./test-hub.js";

/**
 * Sustained silent wedge for the LIVE e2e: evict the adapter's session from the real transports
 * map every `intervalMs` for `ttlMs`. Each watchdog probe finds an evicted session -> 400 ->
 * rejects (consecutive failures -> L1.5 fires), SSE/keepalive intact throughout. The aggressive
 * interval (default 50ms) << the probe interval (~2s) so a reconnect can't re-establish a session
 * that survives to a probe = effectively unrecoverable for the window. Auto-stops after `ttlMs`
 * so the post-restart FRESH container re-handshakes cleanly (recovery, not a crash-loop). Returns
 * stop() to lift early.
 */
export function sustainedWedge(hub: TestHub, ttlMs: number, intervalMs = 50): () => void {
  const evict = setInterval(() => {
    try {
      hub.evictAllTransports();
    } catch {
      /* hub stopped */
    }
  }, intervalMs);
  if (typeof evict.unref === "function") evict.unref();
  const stop = (): void => clearInterval(evict);
  const end = setTimeout(stop, ttlMs);
  if (typeof end.unref === "function") end.unref();
  return stop;
}
