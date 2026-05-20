/**
 * mission-86 W3 — TokenStore test (Design v2.2 §4.13).
 *
 * Testcontainer postgres + the real migrations (004-tokens-table.sql).
 * Covers issue / list / validate / revoke + the hot-path cache + refresh.
 * AG-W3.1 (issue produces a token) + AG-W3.5 (revoke → subsequent invalid)
 * + AG-W3.8 (postgres-backed table).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "../migration-runner.js";
import { TokenStore } from "../token-store.js";

describe("TokenStore — bearer-token store", () => {
  let container: StartedPostgreSqlContainer;
  let connStr: string;
  let store: TokenStore;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine")
      .withUsername("hub").withPassword("hub").withDatabase("hub")
      .start();
    connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
    await applyMigrations(connStr, () => {}); // creates bearer_tokens (004)
    store = new TokenStore(connStr);
    await store.refresh();
  }, 90_000);

  afterAll(async () => {
    await store?.close();
    await container?.stop();
  }, 30_000);

  it("issue() produces a token, persists it, and validates (AG-W3.1)", async () => {
    const issued = await store.issue("client-a", "first client");
    expect(issued.token).toMatch(/^hubt_/);
    expect(issued.tokenId).toMatch(/^tok-/);
    expect(issued.name).toBe("client-a");

    // validate() resolves the raw token to its identity (hot-path cache).
    const id = store.validate(issued.token);
    expect(id).not.toBeNull();
    expect(id?.tokenId).toBe(issued.tokenId);
  });

  it("rejects an unknown token", () => {
    expect(store.validate("hubt_neverissued")).toBeNull();
  });

  it("list() returns summaries without raw token or hash (AG-W3.8)", async () => {
    const issued = await store.issue("client-b");
    const list = await store.list();
    const entry = list.find((t) => t.tokenId === issued.tokenId);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe("client-b");
    expect(JSON.stringify(list)).not.toContain(issued.token); // no raw token leaked
  });

  it("revoke() removes the token — subsequent validate fails (AG-W3.5)", async () => {
    const issued = await store.issue("client-c");
    expect(store.validate(issued.token)).not.toBeNull();

    const revoked = await store.revoke(issued.tokenId);
    expect(revoked).toBe(true);
    expect(store.validate(issued.token)).toBeNull();

    expect(await store.revoke(issued.tokenId)).toBe(false); // already gone
  });

  it("refresh() rebuilds the cache from postgres (restart-safety)", async () => {
    const issued = await store.issue("client-d");
    const fresh = new TokenStore(connStr); // a cold store — empty cache
    expect(fresh.validate(issued.token)).toBeNull();
    await fresh.refresh();
    expect(fresh.validate(issued.token)?.tokenId).toBe(issued.tokenId);
    await fresh.close();
  });
});
