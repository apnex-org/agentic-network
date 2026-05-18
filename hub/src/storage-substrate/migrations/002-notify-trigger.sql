-- mission-83 W1 substrate-shell — migration 002: LISTEN/NOTIFY trigger + function
--
-- Per Design v1.1 §2.4 (architect-pick LISTEN/NOTIFY watch primitive).
-- Substrate-watch primitive validated at W0.1 smoke (NOTIFY/LISTEN end-to-end PASS).
-- Idempotent (CREATE OR REPLACE FUNCTION + DROP+CREATE TRIGGER) per §2.3.

CREATE OR REPLACE FUNCTION entities_notify() RETURNS TRIGGER AS $$
BEGIN
  -- Payload limit: NOTIFY messages capped at ~8KB; carry only routing metadata.
  -- Subscribers do substrate.get(kind, id) to fetch the full entity (per §2.4 design note).
  PERFORM pg_notify('entities_change', json_build_object(
    'op',               CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'put' END,
    'kind',             COALESCE(NEW.kind, OLD.kind),
    'id',               COALESCE(NEW.id, OLD.id),
    'resource_version', COALESCE(NEW.resource_version, OLD.resource_version)
  )::text);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS entities_notify_trg ON entities;
CREATE TRIGGER entities_notify_trg
  AFTER INSERT OR UPDATE OR DELETE ON entities
  FOR EACH ROW EXECUTE FUNCTION entities_notify();

-- R9 (LISTEN/NOTIFY write-amplification per Design v1.1 §7.1 R9; B2 fold-in):
-- W1 measurement deliverable validates sustained 1k+ writes/sec without degradation;
-- mitigation trigger at ≥10k writes/sec (switch to logical-replication if observed).
