# work-57 work-trace — bug-196: list_* COMPACT projection (429-storm root)

**Owner:** greg (engineer, agent-0d2c690e) · **Claimed:** 2026-06-28T04:11 · **Target:** bug-196 · **Gate:** verifier-gate (Hub MCP; deferred until bug-197 concurrency fix + steve back)

## Why (live incident)
The 2026-06-28 Cloud-Run 429 storm's BEHAVIORAL ROOT: list_bugs returns fat objects (no compact mode) → agents (steve, surveying the ledger for the #403 re-gate) fell back to MANY per-bug get_bug calls → overran the concurrency=1 proxy (bug-197). The compact projection removes the incentive to hammer individual calls. Pairs with bug-197 (concurrency). lily-confirmed mode = compact:true (fixed field-set; `fields:[]` is a LATER enhancement, not now).

## cal #88 path-enum — DONE
The 4 handlers (list_bugs/list_ideas/list_missions/list_audit_entries) are UNIFORM at the insertion point: each calls `paginate(items, args)` then returns `{<key>: page.items, count, total, offset, limit, [_ois_query_unmatched]}`. NO existing compact/fields mechanism (net-new). The clean shared move: a `compact` schema flag + wrap the `page.items` ref in a per-entity projection (the projection runs AFTER pagination, orthogonal to each tool's divergent filter path). Size: S/M (lean Small). #402's `repo` field is MERGED to main → the Bug compact set incl. repo is valid on this base.

## Implementation
- `list-filters.ts`: `LIST_COMPACT_SCHEMA = { compact: z.boolean().optional() }` (shared, spread into each registration — mirrors LIST_PAGINATION_SCHEMA).
- Each `*-policy.ts`: a per-entity `projectXCompact` + `args.compact === true ? page.items.map(projectXCompact) : page.items` + `...LIST_COMPACT_SCHEMA` in the registration + a `compact:true` flag in the response. Full-object mode preserved (omit/false).

**Per-entity compact field-sets (Bug = lily's exact spec; siblings = my analogous choices, documented for review):**
- **Bug:** `{id,title,status,severity,class,tags,fixCommits,repo,updatedAt}` (lily's fixed set). OMITS description, fixRevision, sourceThreadSummary, lineage, createdBy.
- **Idea:** `{id, textPreview, status, missionId, tags, updatedAt}` — Idea has NO title (`text` IS the body), so expose a truncated `textPreview` (140 chars + ellipsis) as the scannable label; OMIT full text + sourceThreadSummary.
- **Mission:** `{id, title, status, missionClass, tasksCount, ideasCount, updatedAt}` — the heaviest entity: virtual `tasks`/`ideas` ID-arrays → COUNTS; OMIT description, sourceThreadSummary, plannedTasks (per-task directive bodies), pulses (prompt strings).
- **Audit:** `{id, timestamp, actor, action, relatedEntity}` — OMIT `details` (the only free-text body). (Inline projection — audit-policy doesn't import the AuditEntry type.)

## Verification
- hub tsc clean; FULL hub suite GREEN (2138 passed / 7 skip) on the work-57 branch off origin/main.
- +4 compact tests (one per tool, in wave1/wave2/wave3b): assert the compact projection (exact field-set for bug/idea; targeted present+absent for mission/audit), the long-text OMISSION (description/text/details/fixRevision), the `compact:true` response flag, AND full-mode parity (no-compact → fat object preserved).
- MUTATION-verified non-vacuous: bug-policy wrap → always `page.items` (ignore compact) → description leaks into the projection → the exact-keys + omits assertions FAIL (restored, re-green).

## Status
PR'd. Gate: Hub MCP verifier-gate — lily sequences it AFTER bug-197 (concurrency) lands + steve's back from the 429 storm (build-now-gate-later, per her note). Siblings' field-sets documented for lily/steve review (the Bug set was her exact spec; Idea textPreview + Mission counts are my reasonable analogues).
