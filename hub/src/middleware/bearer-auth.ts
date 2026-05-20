/**
 * mission-86 W3 — bearer-token auth middleware (Design v2.2 §4.13).
 *
 * Validates `Authorization: Bearer <token>` on the `/mcp` routes against the
 * postgres-backed `TokenStore` (cached, hash-lookup — no per-request DB
 * round-trip). Replaces the single-static-`HUB_API_TOKEN` check the Hub
 * shipped with.
 *
 * Attached per-route to POST/GET/DELETE `/mcp` (mirrors the prior
 * `requireAuth` wiring) — so `/health` and `/admin/*` skip it without any
 * in-middleware path matching. `/admin/*` has its own admin-token guard.
 *
 * Legacy grandfather: `HUB_API_TOKEN` is still accepted as a valid `/mcp`
 * bearer (when set) — the bootstrap/transition token alongside the issued
 * token-store tokens. Avoids a cutover cliff (existing `HUB_API_TOKEN`-
 * configured clients keep working until migrated to issued tokens) and
 * keeps the live local-Hub reachable through the Adapter-Restart verify.
 * Conscious sign-off — surfaced in the Sub-PR B PR body for cross-approval;
 * a one-line flip to pure-token-store if the architect prefers.
 *
 * Audit: every authenticated call logs `[Auth] {token-id, name, method,
 * path, tool, caller-ip, ts}` to stdout — captured by Cloud Logging on the
 * COS VM (AG-W3.6).
 */
import type { Request, Response } from "express";
import type { TokenStore, TokenIdentity } from "../storage-substrate/token-store.js";

export interface BearerAuthOptions {
  tokenStore: TokenStore;
  /** HUB_API_TOKEN — grandfathered as a valid bearer when non-empty. */
  legacyToken?: string;
  /** Log sink — defaults to console.log. */
  log?: (msg: string) => void;
}

const LEGACY_IDENTITY: TokenIdentity = {
  tokenId: "legacy-hub-api-token",
  name: "HUB_API_TOKEN",
};

type Middleware = (req: Request, res: Response, next: () => void) => void;

/**
 * Build the `/mcp` bearer-auth middleware. Returns 401 (JSON-RPC error shape)
 * on a missing / malformed / unknown token; calls `next()` + audit-logs on a
 * valid token.
 */
export function createBearerAuth(opts: BearerAuthOptions): Middleware {
  const log = opts.log ?? ((m: string) => console.log(m));

  return function bearerAuth(req: Request, res: Response, next: () => void): void {
    const reject = (message: string): void => {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: `Unauthorized: ${message}` },
        id: null,
      });
    };

    const authHeader = req.headers["authorization"];
    if (!authHeader) {
      reject("Missing Authorization header");
      return;
    }
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
      reject("malformed Authorization header (expected 'Bearer <token>')");
      return;
    }
    const presented = parts[1];

    let identity = opts.tokenStore.validate(presented);
    if (!identity && opts.legacyToken && presented === opts.legacyToken) {
      identity = LEGACY_IDENTITY;
    }
    if (!identity) {
      reject("Invalid token");
      return;
    }

    // AG-W3.6 audit-log — stdout → Cloud Logging on the COS VM.
    const callerIp =
      (req.headers["x-forwarded-for"] as string | undefined) ??
      req.socket.remoteAddress ??
      "unknown";
    const body = req.body as { method?: unknown; params?: { name?: unknown } } | undefined;
    const tool =
      typeof body?.params?.name === "string"
        ? body.params.name
        : typeof body?.method === "string"
          ? body.method
          : "-";
    log(
      `[Auth] ${new Date().toISOString()} token=${identity.tokenId} ` +
        `name=${JSON.stringify(identity.name)} ${req.method} ${req.path} ` +
        `tool=${tool} ip=${callerIp}`,
    );
    next();
  };
}
