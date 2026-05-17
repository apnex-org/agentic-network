-- mission-83 W1 substrate-shell — migration 003: JSONB 1.5MB CHECK constraint
--
-- Per Survey outcome 4 (Director-ratified 1.5MB per-entity payload cap) +
-- Design v1.1 §2.2 (enforced at substrate write-boundary).
-- 1572864 bytes = 1.5MB.
--
-- W0.1 smoke validated TOAST compression on JSONB makes 1.5MB cap comfortable
-- (1MB raw → 11kb on disk for repetitive content; ~99% compression).
--
-- Idempotent: drop-and-recreate to allow re-runs on schema-evolution.

ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_data_size_check;
ALTER TABLE entities ADD CONSTRAINT entities_data_size_check
  CHECK (pg_column_size(data) < 1572864);
