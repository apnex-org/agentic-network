# Strategic Review — Coverage Manifest — 2026-06-29 — stint-6 (assemble_pack)

**Anchor:** `2026-06-29T03:48:46Z` @ HEAD `3cff84e` · **Parser:** `sr-evidence-parser-v1`

**Fail-closed semantics (audit-5088 ruling, folding into design §3.4):** the pack FAILS CLOSED iff any *candidate* source family — **{live Ideas, non-terminal Bugs, Teles}** (the complete missed-candidate surface; reverse-gap Teles are candidates) — is under-captured. These stay exhaustive-by-construction (bounded + psql-cheap). All OTHER families are **CONTEXT** (documents, audit_entries, missions, proposals, work/ready_work, metrics, agents, threads, clarifications, calibrations, friction-backlog, roadmap) = exhaustive-best-effort with retrieval-method + any limit EXPLICITLY documented; **non-fatal** (cannot hide a candidate).

- **Candidate-family fail-closed:** NO — candidate families exhaustive + psql-confirmed (Ideas 277/277, Bugs 41/41, Teles 14/14)
- **Non-fatal context shortfalls:** documents (9/10)

| Source family | Captured | Expected COUNT(*) | Retrieval method | Kind | Status |
|---|---|---|---|---|---|
| ideas (open) | 277 | 277 | list_ideas status=open compact limit=500; PSQL-CONFIRMED 277/277 (get-entities.sh Idea status.phase=open); <500 prefetch-cap => no truncation possible | candidate | ok |
| bugs (open+investigating) | 41 | 41 | list_bugs open+investigating compact; PSQL-CONFIRMED 40 open + 1 investigating = 41 (get-entities.sh Bug) | candidate | ok |
| teles (active + reverse-gap) | 14 | 14 | list_tele active; PSQL-CONFIRMED tele-0..tele-13 = 14/14 (get-entities.sh Tele); reverse-gap teles = 0 (all 14 served) | candidate | ok |
| work_items | 116 | 116 | list_work status:any (88 done/23 ready/3 abandoned/1 claimed/1 in_progress) | context | ok |
| threads | 500 | 500 | list_threads (date-bucket cross-checked 204+213+83=500, NOT the 500 cap); 30 round_limit terminal, 0 active near-limit | context | ok |
| documents | 9 | 10 | ANCHOR-PINNED @2026-06-29T03:48:46Z: 9 of ~10 live-at-anchor docs/-prefix Hub Documents (the run's OWN 3 outputs recon/pack/manifest, all created post-anchor, EXCLUDED per anchor-pinning); 1 further doc in an unqueried category uncaptured (list_documents caps at 10/no-offset; psql-supplemented via per-category enumeration). CONTEXT family => non-fatal (cannot hide a candidate) | context | context-shortfall (non-fatal) |
| clarifications | 0 | 0 | NON-ENTITY: Clarification is a Task-status mechanism (input_required) keyed by taskId; no first-class collection to count | context | ok |
| audit_entries | 100 | 100 | RECENT-WINDOW history-slice: most-recent 100 entries (audit-1703..audit-4968, 2026-05-16..2026-06-28) for get_metrics reconstruction + history-slice. THE BY-DESIGN SCOPE (NOT the full ~5000 backbone). CONTEXT family => non-fatal | context | ok |
| missions (all status) | 56 | 56 | list_missions completed(55)+active(1) compact | context | ok |
| proposals | 33 | 33 | list_proposals | context | ok |

**Per-item provenance** (design §3.4 guarantee 3): each row carries source_verb + query_params (the Method column) + result_count (Captured) + expected_count (Expected) + version_anchor (`2026-06-29T03:48:46Z` @ `3cff84e`). captured_at ≈ the anchor window (2026-06-29T03:30–03:55Z gather).

**14 source families coverage (design §3.2):** Candidate = ideas✓(277) bugs✓(41) tele✓(14). Context = missions✓(56) proposals✓(33) documents(9/10 anchor-pinned ctx, non-fatal) + docs/reviews/. Work/metrics = list_work✓(116) list_ready_work✓(get_current_stint live) get_metrics←audit_entries(backbone, partial) get_agents✓(not get_engineer_status). Friction = calibrations(repo ledger) friction-backlog(FR-N, repo) list_threads✓(500, 30 round_limit) Clarifications=non-entity(resolved). Roadmap/history = roadmap.md(repo) stake-timestamps(audit) audit_entries(backbone) prior-recon-doc✓.

