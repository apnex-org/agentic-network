-- mission-86 W3 — bearer-token auth gate (Design v2.2 §4.13).
--
-- Postgres-backed store for Hub-issued bearer tokens (MCP-API client auth).
-- Replaces the single static HUB_API_TOKEN check + the architect-preliminary
-- /etc/hub/tokens.txt — issuable + revocable per-client, persists across
-- container restart, revocation is one DELETE.
--
-- Applied at Hub bootstrap by migration-runner.ts (the bug-101 mechanism) —
-- idempotent (IF NOT EXISTS), so re-running every boot is a no-op.
--
-- token_hash: the sha-256 hex of the raw token. The raw token is returned to
-- the caller exactly once at POST /admin/tokens and is NEVER stored — a DB
-- read cannot recover a usable token. The bearer-auth middleware hashes the
-- presented token and looks it up by hash.

CREATE TABLE IF NOT EXISTS bearer_tokens (
  token_id   TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: the middleware validates every MCP call by token_hash.
CREATE INDEX IF NOT EXISTS bearer_tokens_token_hash_idx ON bearer_tokens (token_hash);
