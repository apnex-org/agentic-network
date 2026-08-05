-- bug-487 migration 006: text_pattern_ops index on entities(kind, id)
--
-- WHY: docenum1 pushes prefix enumeration into the storage layer as
-- `starts_with(id, $n)`. That predicate is CORRECT WITHOUT THIS INDEX — correctness
-- comes from starts_with()'s byte-wise semantics, not from any index — but without
-- the index the planner degrades to a filtered scan.
--
-- MEASURED (two ephemeral postgres:15 instances differing only in initdb --locale):
--   without text_pattern_ops : BOTH collations -> Bitmap Heap Scan + Filter
--   with    text_pattern_ops : BOTH collations -> Index Only Scan,
--                              Index Cond: ((id ~>=~ 'p') AND (id ~<~ 'p<next>'))
-- The ~>=~ / ~<~ operators are the PATTERN operators — byte-wise by definition — which
-- is why the plan is identical under lc_collate=C and en_US.UTF-8. INDEX USE DEPENDS
-- ON THE OPCLASS, NOT ON THE DATABASE COLLATION.
--
-- 🔴 THE DEFAULT entities_pkey CANNOT SERVE THIS. Its `id` column uses the database's
-- default collation, so under a non-C collation a pattern predicate cannot use it.
-- text_pattern_ops is the opclass that makes the pattern range indexable regardless.
--
-- CONCURRENTLY is deliberately NOT used: the migration runner executes inside a
-- transaction and CREATE INDEX CONCURRENTLY cannot run there. This table is small
-- enough at present scale that a brief lock is acceptable; if that stops being true,
-- move this to the reconciler's CONCURRENTLY path rather than relaxing it here.

CREATE INDEX IF NOT EXISTS entities_kind_id_pattern_idx
  ON entities (kind, id text_pattern_ops);
