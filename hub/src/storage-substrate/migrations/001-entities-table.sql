-- mission-83 W1 substrate-shell — migration 001: entities table + sequence + base indexes
--
-- Per Design v1.1 §2.2 (single entities table + JSONB + per-kind expression indexes; Flavor A).
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE) per §2.3 restart-safety statement.

CREATE SEQUENCE IF NOT EXISTS entities_rv_seq;

CREATE TABLE IF NOT EXISTS entities (
  kind             TEXT NOT NULL,
  id               TEXT NOT NULL,
  data             JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resource_version BIGINT NOT NULL DEFAULT nextval('entities_rv_seq'),
  PRIMARY KEY (kind, id)
);

-- Watch-stream replay-from-position index (load-bearing for substrate.watch sinceRevision semantics)
CREATE INDEX IF NOT EXISTS entities_rv_idx ON entities (resource_version);

-- Recent-activity index (load-bearing for forensic queries + sweeper restart-without-state-loss)
CREATE INDEX IF NOT EXISTS entities_updated_at_idx ON entities (updated_at);

-- Per-kind expression indexes are emitted by the SchemaDef reconciler at W2 per Design §2.3
-- (CREATE INDEX CONCURRENTLY IF NOT EXISTS); NOT in this static migration.
