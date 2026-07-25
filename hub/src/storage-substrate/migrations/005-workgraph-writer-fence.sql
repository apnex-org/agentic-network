-- Mission-140 / V6 topology transaction fence.
--
-- Once the singleton WorkGraphTopologyHead exists, every physical WorkItem
-- INSERT/UPDATE/DELETE must run on the PostgreSQL session that holds the one
-- global WorkGraph advisory writer lock: (class=5, key=FNV1a32('global-v1')).
-- This is the old-binary fence: a pre-V4 Hub process can still speak the old
-- WorkItem CAS protocol, but PostgreSQL rejects its write after activation.
-- Draft topology/family/operation rows stay outside this trigger and inert;
-- publication remains the WorkGraphTopologyHead CAS.

CREATE OR REPLACE FUNCTION enforce_workgraph_writer_v4()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected_kind TEXT;
BEGIN
  affected_kind := CASE WHEN TG_OP = 'DELETE' THEN OLD.kind ELSE NEW.kind END;
  IF affected_kind <> 'WorkItem' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF EXISTS (
    SELECT 1 FROM entities
    WHERE kind = 'WorkGraphTopologyHead' AND id = 'global-v1'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_locks
    WHERE locktype = 'advisory'
      AND pid = pg_backend_pid()
      AND granted
      AND classid = 5::oid
      AND objid = 36511236::oid
      AND objsubid = 2
  ) THEN
    RAISE EXCEPTION 'workgraph.currentness.writer_protocol_required: WorkItem mutation requires advisory lock (5, global-v1) after topology activation'
      USING ERRCODE = '55000';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS entities_workgraph_writer_v4 ON entities;
CREATE TRIGGER entities_workgraph_writer_v4
BEFORE INSERT OR UPDATE OR DELETE ON entities
FOR EACH ROW EXECUTE FUNCTION enforce_workgraph_writer_v4();
