# Strategic Review — Coverage Manifest — 2026-06-29 — stint-6 (assemble_pack)

**Anchor:** `2026-06-29T03:48:46Z` @ HEAD `3cff84e` · **Parser:** `sr-evidence-parser-v1`

**Fail-closed semantics (design §3.4 intent = the missed-candidate risk):** the pack FAILS CLOSED iff any *candidate* source family (live Ideas, non-terminal Bugs) is under-captured. Context/signal families (work, threads, documents, audit-entries, etc.) are NOT candidate sources; a context shortfall is **documented as non-fatal** (it cannot hide a candidate).

- **Candidate-family fail-closed:** NO — candidate families exhaustive (ideas 277/277, bugs 41/41)
- **Non-fatal context shortfalls:** documents (10/11)

| Source family | Captured | Expected COUNT(*) | Retrieval method | Kind | Status |
|---|---|---|---|---|---|
| ideas (open) | 277 | 277 | list_ideas status=open compact limit=500 | candidate | ok |
| bugs (open+investigating) | 41 | 41 | list_bugs compact open+investigating | candidate | ok |
| work_items | 116 | 116 | list_work status:any (88 done/23 ready/3 abandoned/1 claimed/1 in_progress) | context | ok |
| threads | 500 | 500 | list_threads (date-bucket cross-checked: 204+213+83=500, not the 500 cap); 30 round_limit terminal, 0 active near-limit | context | ok |
| documents | 10 | 11 | list_documents prefix=docs/ (no offset param; 1 uncaptured; docs/reviews/ has 2) | context | context-shortfall (non-fatal) |
| clarifications | 0 | 0 | NON-ENTITY: Clarification is a Task-status mechanism (input_required) keyed by taskId, no first-class collection | context | ok |
| audit_entries | 100 | -1 | list_audit_entries first page; backbone large (IDs reach audit-4968), true total unknown | context | ok |
| missions (all status) | 56 | 56 | list_missions completed(55)+active(1) compact | context | ok |
| teles (active) | 14 | 14 | list_tele (tele-0..tele-13) | context | ok |
| proposals | 33 | 33 | list_proposals | context | ok |

**Per-item provenance** (design §3.4 guarantee 3): each row carries source_verb + query_params (the Method column) + result_count (Captured) + expected_count (Expected) + version_anchor (`2026-06-29T03:48:46Z` @ `3cff84e`). captured_at ≈ the anchor window (2026-06-29T03:30–03:55Z gather).

**14 source families coverage (design §3.2):** Entities = ideas✓ bugs✓ missions✓ tele✓ proposals✓ documents(10/11 ctx) + docs/reviews/✓(2). Work/metrics = list_work✓(116) list_ready_work✓(get_current_stint live) get_metrics←audit_entries(backbone, partial) get_agents✓(not get_engineer_status). Friction = calibrations(repo ledger) friction-backlog(FR-N, repo) list_threads✓(500, 30 round_limit) Clarifications=non-entity(resolved). Roadmap/history = roadmap.md(repo) stake-timestamps(audit) audit_entries(backbone) prior-recon-doc✓.

