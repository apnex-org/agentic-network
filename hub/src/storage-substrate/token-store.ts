/**
 * mission-86 W3 — bearer-token store (Design v2.2 §4.13).
 *
 * Postgres-backed store for Hub-issued bearer tokens (the `bearer_tokens`
 * table — migration `004-tokens-table.sql`). Backs the bearer-auth middleware
 * + the `/admin/tokens` endpoints.
 *
 * Security: only the sha-256 hash of a token is stored. The raw token is
 * returned to the caller exactly once (at `issue()`) and never persisted — a
 * DB read cannot recover a usable token. `validate()` hashes the presented
 * token and looks it up by hash.
 *
 * Cache: the Hub is single-instance, and this store is the sole writer +
 * reader of `bearer_tokens`, so an in-memory hash→{tokenId,name} map kept in
 * sync on issue/revoke is authoritative for the hot validate path — no
 * per-request DB round-trip, no file-mtime/SIGHUP reload (Design §4.13).
 * `refresh()` re-syncs from postgres (defensive; called once at init).
 *
 * Own `pg.Pool` — the HubStorageSubstrate pool is private + entity-model
 * only; `bearer_tokens` is a plain auth table outside the SchemaDef model.
 */
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { attachPgErrorHandler } from "./pg-error-handler.js";

const { Pool } = pg;

/** A token as surfaced to operators — never includes the raw token or hash. */
export interface TokenSummary {
  tokenId: string;
  name: string;
  note: string;
  createdAt: string;
}

/** The one-time issue result — `token` is the raw value; save it now or lose it. */
export interface IssuedToken extends TokenSummary {
  token: string;
}

/** What `validate()` resolves a presented token to (for audit attribution). */
export interface TokenIdentity {
  tokenId: string;
  name: string;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export class TokenStore {
  private readonly pool: pg.Pool;
  /** hot-path cache: token_hash → identity. Authoritative for a single Hub. */
  private readonly cache = new Map<string, TokenIdentity>();

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
    // bug-110 — pg Pool without an 'error' listener crashes the process on an
    // idle-connection backend error.
    attachPgErrorHandler(this.pool, "TokenStore pool");
  }

  /** Load all live token hashes into the cache. Call once at Hub bootstrap. */
  async refresh(): Promise<void> {
    const { rows } = await this.pool.query<{
      token_id: string;
      token_hash: string;
      name: string;
    }>(`SELECT token_id, token_hash, name FROM bearer_tokens`);
    this.cache.clear();
    for (const r of rows) {
      this.cache.set(r.token_hash, { tokenId: r.token_id, name: r.name });
    }
  }

  /**
   * Issue a new bearer token. Returns the raw token ONCE — it is not
   * recoverable afterward (only its hash is stored).
   */
  async issue(name: string, note = ""): Promise<IssuedToken> {
    const token = `hubt_${randomBytes(24).toString("base64url")}`;
    const tokenId = `tok-${randomBytes(6).toString("hex")}`;
    const tokenHash = hashToken(token);
    const { rows } = await this.pool.query<{ created_at: Date }>(
      `INSERT INTO bearer_tokens (token_id, token_hash, name, note)
       VALUES ($1, $2, $3, $4) RETURNING created_at`,
      [tokenId, tokenHash, name, note],
    );
    this.cache.set(tokenHash, { tokenId, name });
    return {
      tokenId,
      token,
      name,
      note,
      createdAt: rows[0]!.created_at.toISOString(),
    };
  }

  /** Revoke a token by id. Returns true iff a token was removed. */
  async revoke(tokenId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ token_hash: string }>(
      `DELETE FROM bearer_tokens WHERE token_id = $1 RETURNING token_hash`,
      [tokenId],
    );
    if (rows.length === 0) return false;
    this.cache.delete(rows[0]!.token_hash);
    return true;
  }

  /** List tokens — token-id + name + note + created_at; never the raw/hash. */
  async list(): Promise<TokenSummary[]> {
    const { rows } = await this.pool.query<{
      token_id: string;
      name: string;
      note: string;
      created_at: Date;
    }>(`SELECT token_id, name, note, created_at FROM bearer_tokens ORDER BY created_at`);
    return rows.map((r) => ({
      tokenId: r.token_id,
      name: r.name,
      note: r.note,
      createdAt: r.created_at.toISOString(),
    }));
  }

  /**
   * Validate a presented raw token. Returns the token identity (for audit
   * attribution) or null if the token is unknown/revoked. Synchronous —
   * hot-path cache lookup, no DB round-trip.
   */
  validate(rawToken: string): TokenIdentity | null {
    return this.cache.get(hashToken(rawToken)) ?? null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
