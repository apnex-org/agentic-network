/**
 * mission-86 W3 — bearer-auth middleware unit test (Design v2.2 §4.13).
 * AG-W3.2 (invalid token → 401) + AG-W3.3 (valid token → next()).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createBearerAuth } from "../bearer-auth.js";
import type { TokenStore, TokenIdentity } from "../../storage-substrate/token-store.js";

/** Minimal TokenStore stub — the middleware only calls validate(). */
function stubStore(valid: Record<string, TokenIdentity>): TokenStore {
  return {
    validate: (raw: string): TokenIdentity | null => valid[raw] ?? null,
  } as unknown as TokenStore;
}

interface MockRes {
  statusCode: number;
  body: unknown;
  status(c: number): MockRes;
  json(b: unknown): MockRes;
}
function mockRes(): MockRes {
  return {
    statusCode: 0,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
function mockReq(authHeader?: string): Record<string, unknown> {
  return {
    headers: authHeader === undefined ? {} : { authorization: authHeader },
    socket: { remoteAddress: "10.0.0.1" },
    method: "POST",
    path: "/mcp",
    body: {},
  };
}

describe("createBearerAuth — /mcp bearer-token gate", () => {
  let nextCalls: number;
  const auth = () =>
    createBearerAuth({
      tokenStore: stubStore({ "hubt_good": { tokenId: "tok-1", name: "client-a" } }),
      legacyToken: "legacy-xyz",
      log: () => {},
    });

  beforeEach(() => { nextCalls = 0; });
  const next = () => { nextCalls++; };

  it("rejects a missing Authorization header → 401", () => {
    const res = mockRes();
    auth()(mockReq() as never, res as never, next);
    expect(res.statusCode).toBe(401);
    expect(nextCalls).toBe(0);
  });

  it("rejects a malformed Authorization header → 401", () => {
    const res = mockRes();
    auth()(mockReq("Token hubt_good") as never, res as never, next);
    expect(res.statusCode).toBe(401);
    expect(nextCalls).toBe(0);
  });

  it("rejects an unknown token → 401 (AG-W3.2)", () => {
    const res = mockRes();
    auth()(mockReq("Bearer hubt_nope") as never, res as never, next);
    expect(res.statusCode).toBe(401);
    expect(nextCalls).toBe(0);
  });

  it("accepts a valid token-store token → next() (AG-W3.3)", () => {
    const res = mockRes();
    auth()(mockReq("Bearer hubt_good") as never, res as never, next);
    expect(res.statusCode).toBe(0);
    expect(nextCalls).toBe(1);
  });

  it("accepts the grandfathered legacy HUB_API_TOKEN → next()", () => {
    const res = mockRes();
    auth()(mockReq("Bearer legacy-xyz") as never, res as never, next);
    expect(nextCalls).toBe(1);
  });

  it("rejects when no legacyToken is configured and the token is unknown", () => {
    const res = mockRes();
    const a = createBearerAuth({
      tokenStore: stubStore({}),
      log: () => {},
    });
    a(mockReq("Bearer legacy-xyz") as never, res as never, next);
    expect(res.statusCode).toBe(401);
    expect(nextCalls).toBe(0);
  });
});
