/**
 * mission-86 W3 — /admin/tokens endpoints (Design v2.2 §4.13).
 *
 * Operator-facing token management — issue / revoke / list bearer tokens.
 * Driven by the `hub-token` CLI (`scripts/cloud/hub-token`).
 *
 * Admin-auth (OQ-16 → (b), architect-confirmed): a bootstrap admin token
 * (`HUB_ADMIN_TOKEN`, provisioned as a Secret Manager secret) — SEPARATE
 * from the issued bearer tokens, avoiding a chicken-and-egg at first issue.
 * Compared constant-time (sha-256 + timingSafeEqual). GCP IAM-SA identity-
 * token validation is the v1.1 fold.
 *
 * `/admin/*` is NOT behind the `/mcp` bearer-auth middleware — each route
 * here carries its own `requireAdminAuth` guard.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { TokenStore } from "../storage-substrate/token-store.js";

/** Constant-time string compare (sha-256 digests are always equal length). */
function constantTimeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

export interface AdminRoutesOptions {
  tokenStore: TokenStore;
  /** HUB_ADMIN_TOKEN — guards every /admin/* route; empty disables /admin/*. */
  adminToken: string;
  /** Log sink — defaults to console.log. */
  log?: (msg: string) => void;
}

/**
 * Register the `/admin/tokens` routes on the Hub Express app. Each route is
 * guarded by `requireAdminAuth` (the bootstrap admin token).
 */
export function registerAdminRoutes(app: Express, opts: AdminRoutesOptions): void {
  const log = opts.log ?? ((m: string) => console.log(m));

  const requireAdminAuth = (req: Request, res: Response, next: () => void): void => {
    const reject = (msg: string): void => {
      res.status(401).json({ error: `Unauthorized: ${msg}` });
    };
    if (!opts.adminToken) {
      // Fail closed — no admin token configured ⇒ /admin/* is unusable.
      reject("admin endpoints disabled (HUB_ADMIN_TOKEN not set)");
      return;
    }
    const authHeader = req.headers["authorization"];
    if (!authHeader) {
      reject("Missing Authorization header");
      return;
    }
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
      reject("malformed Authorization header (expected 'Bearer <admin-token>')");
      return;
    }
    if (!constantTimeEqual(parts[1], opts.adminToken)) {
      reject("Invalid admin token");
      return;
    }
    next();
  };

  // POST /admin/tokens — issue a new bearer token. Returns the raw token ONCE.
  app.post("/admin/tokens", requireAdminAuth, (req: Request, res: Response): void => {
    void (async () => {
      const body = req.body as { name?: unknown; note?: unknown } | undefined;
      if (typeof body?.name !== "string" || body.name.length === 0) {
        res.status(400).json({ error: "body.name (non-empty string) is required" });
        return;
      }
      const note = typeof body.note === "string" ? body.note : "";
      try {
        const issued = await opts.tokenStore.issue(body.name, note);
        log(
          `[Admin] ${new Date().toISOString()} token issued id=${issued.tokenId} ` +
            `name=${JSON.stringify(issued.name)}`,
        );
        res.status(201).json(issued); // body includes the raw `token` — once
      } catch (err) {
        res.status(500).json({ error: `issue failed: ${(err as Error)?.message ?? String(err)}` });
      }
    })();
  });

  // DELETE /admin/tokens/:tokenId — revoke a token.
  app.delete("/admin/tokens/:tokenId", requireAdminAuth, (req: Request, res: Response): void => {
    void (async () => {
      const tokenId = String(req.params.tokenId ?? "");
      try {
        const revoked = await opts.tokenStore.revoke(tokenId);
        if (!revoked) {
          res.status(404).json({ error: `no token with id ${tokenId}` });
          return;
        }
        log(`[Admin] ${new Date().toISOString()} token revoked id=${tokenId}`);
        res.json({ revoked: true, tokenId });
      } catch (err) {
        res.status(500).json({ error: `revoke failed: ${(err as Error)?.message ?? String(err)}` });
      }
    })();
  });

  // GET /admin/tokens — list tokens (token-id + name + note + created_at;
  // NEVER the raw token or its hash).
  app.get("/admin/tokens", requireAdminAuth, (_req: Request, res: Response): void => {
    void (async () => {
      try {
        const tokens = await opts.tokenStore.list();
        res.json({ tokens });
      } catch (err) {
        res.status(500).json({ error: `list failed: ${(err as Error)?.message ?? String(err)}` });
      }
    })();
  });

  log(
    `[Admin] /admin/tokens endpoints registered ` +
      `(admin-auth ${opts.adminToken ? "enabled" : "DISABLED — HUB_ADMIN_TOKEN unset"})`,
  );
}
