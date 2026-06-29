# Strategic Review — Evidence Pack — 2026-06-29 — stint-6 (assemble_pack)

## §0 Provenance

| Field | Value |
|---|---|
| Parser | `sr-evidence-parser-v1` |
| Reconciliation anchor | `2026-06-29T03:48:46Z` @ HEAD `3cff84e` |
| Candidates | 318 (277 ideas + 41 bugs) |
| Derivation | fixed versioned tag+body parser (deterministic); in-degree = tag+body id-reference scan; staking-decay = updatedAt-age proxy; tele-fit/value from audit:* tags where present else raw-tag fallback |
| Fail-closed (candidate-scoped, audit-5088) | NO — candidate families {Ideas, Bugs, Teles} exhaustive + psql-confirmed (277/41/14) |

**Signal != judgement.** This pack carries only the 6 mechanical signals, id-sorted, with NO rank, NO clustering, NO summit-pick (reserved for seal_candidates + the council).

## §1 Coverage manifest (per-source COUNT(*) vs captured; candidate-shortfall => FAIL CLOSED per audit-5088; context families = best-effort + documented, non-fatal)

| Source | Captured | Expected | Method | Kind | OK |
|---|---|---|---|---|---|
| ideas (open) | 277 | 277 | list_ideas status=open compact limit=500; PSQL-CONFIRMED 277/277 (get-entities.sh Idea status.phase=open); <500 prefetch-cap => no truncation possible | candidate | ok |
| bugs (open+investigating) | 41 | 41 | list_bugs open+investigating compact; PSQL-CONFIRMED 40 open + 1 investigating = 41 (get-entities.sh Bug) | candidate | ok |
| teles (active + reverse-gap) | 14 | 14 | list_tele active; PSQL-CONFIRMED tele-0..tele-13 = 14/14 (get-entities.sh Tele); reverse-gap teles = 0 (all 14 served) | candidate | ok |
| work_items | 116 | 116 | list_work status:any (88 done/23 ready/3 abandoned/1 claimed/1 in_progress) | context | ok |
| threads | 500 | 500 | list_threads (date-bucket cross-checked 204+213+83=500, NOT the 500 cap); 30 round_limit terminal, 0 active near-limit | context | ok |
| documents | 9 | 10 | ANCHOR-PINNED @2026-06-29T03:48:46Z: 9 of ~10 live-at-anchor docs/-prefix Hub Documents (the run's OWN 3 outputs recon/pack/manifest, all created post-anchor, EXCLUDED per anchor-pinning); 1 further doc in an unqueried category uncaptured (list_documents caps at 10/no-offset; psql-supplemented via per-category enumeration). CONTEXT family => non-fatal (cannot hide a candidate) | context | **SHORTFALL** |
| clarifications | 0 | 0 | NON-ENTITY: Clarification is a Task-status mechanism (input_required) keyed by taskId; no first-class collection to count | context | ok |
| audit_entries | 100 | 100 | RECENT-WINDOW history-slice: most-recent 100 entries (audit-1703..audit-4968, 2026-05-16..2026-06-28) for get_metrics reconstruction + history-slice. THE BY-DESIGN SCOPE (NOT the full ~5000 backbone). CONTEXT family => non-fatal | context | ok |
| missions (all status) | 56 | 56 | list_missions completed(55)+active(1) compact | context | ok |
| proposals | 33 | 33 | list_proposals | context | ok |

## §2 Candidate universe (id-sorted; signals only; NO RANK)

Legend: NS=north-star tele touch · *K*=keystone (in-degree>=5) · ROT=rot>90d · value=audit:value or bug pain-score · ready=audit:action or bug-status.

| id | kind | teles | status | in-deg | value | ready | risk |
|---|---|---|---|---|---|---|---|
| bug-6 | bug | - | open | 0 | pain=1 | open | - |
| bug-13 | bug | - | open | 0 | pain=1 | open | - |
| bug-23 | bug | - | investigating | 1 | pain=2 | investigating | race |
| bug-25 | bug | - | open | 2 | pain=2 | open | delivery-truncation |
| bug-60 | bug | - | open | 0 | pain=2 | open | missing-feature / session-continuity |
| bug-64 | bug | - | open | 0 | pain=1 | open | missing-feature |
| bug-65 | bug | - | open | 0 | pain=1 | open | missing-feature |
| bug-66 | bug | - | open | 0 | pain=1 | open | missing-feature |
| bug-67 | bug | - | open | 0 | pain=1 | open | cognitive |
| bug-74 | bug | - | open | 0 | pain=2 | open | drift |
| bug-76 | bug | - | open | 0 | pain=1 | open | cognitive |
| bug-77 | bug | - | open | 0 | pain=1 | open | schema-validation-gap |
| bug-78 | bug | - | open | 0 | pain=1 | open | missing-feature |
| bug-79 | bug | - | open | 0 | pain=1 | open | race |
| bug-80 | bug | - | open | 0 | pain=1 | open | dedup |
| bug-81 | bug | - | open | 0 | pain=1 | open | missing-feature |
| bug-82 | bug | - | open | 1 | pain=2 | open | schema-validation-gap |
| bug-83 | bug | - | open | 0 | pain=2 | open | schema-validation-gap |
| bug-84 | bug | - | open | 0 | pain=1 | open | missing-feature |
| bug-85 | bug | - | open | 0 | pain=2 | open | fsm-gap |
| bug-86 | bug | - | open | 0 | pain=1 | open | operator-dx |
| bug-87 | bug | - | open | 0 | pain=1 | open | operator-dx |
| bug-88 | bug | - | open | 1 | pain=1 | open | missing-feature |
| bug-89 | bug | - | open | 0 | pain=2 | open | shell-wrapper-defect |
| bug-90 | bug | - | open | 0 | pain=2 | open | silent-swallow |
| bug-91 | bug | - | open | 0 | pain=1 | open | parser-edge |
| bug-92 | bug | - | open | 0 | pain=2 | open | operator-dx |
| bug-146 | bug | - | open | 1 | pain=2 | open | identity-resolution |
| bug-148 | bug | - | open | 0 | pain=1 | open | drift |
| bug-162 | bug | - | open | 0 | pain=1 | open | liveness-signal-omission |
| bug-172 | bug | - | open | 0 | pain=1 | open | rbac |
| bug-174 | bug | - | open | 0 | pain=2 | open | silent-degrade |
| bug-183 | bug | - | open | 1 | pain=1 | open | telemetry-reporting |
| bug-184 | bug | - | open | 0 | pain=1 | open | deprecation-cleanup |
| bug-185 | bug | - | open | 0 | pain=1 | open | queue-semantics |
| bug-188 | bug | - | open | 0 | pain=3 | open | missing-feature |
| bug-189 | bug | t7 | open | 1 | pain=2 | open | identity-resolution |
| bug-194 | bug | t7 | open | 0 | pain=4 | open | silent-failure |
| bug-199 | bug | - | open | 0 | pain=2 | open | cache-invalidation |
| bug-202 | bug | - | open | 0 | pain=1 | open | drift |
| bug-203 | bug | - | open | 2 | pain=2 | open | host-conformance |
| idea-5 | idea | t5,t6 | open | 0 | L | needs-proposal | low |
| idea-6 | idea | t7 | open | 0 | M | ready | low |
| idea-11 | idea | t4,t5 | open | 1 | L | needs-research | low |
| idea-12 | idea | t6 | open | 0 | L | needs-research | low |
| idea-13 | idea | t5 | open | 0 | L | ready | med |
| idea-14 | idea | t10 | open | 0 | L | ready | low |
| idea-15 | idea | t7 | open | 0 | M | needs-research | low |
| idea-18 | idea | t7 | open | 0 | M | ready | low |
| idea-20 | idea | t3,t6 | open | 0 | M | ready | low |
| idea-23 | idea | t9 | open | 0 | L | needs-proposal | low |
| idea-24 | idea | t2 | open | 0 | M | ready | low |
| idea-25 | idea | t2,t6 | open | 1 | S | backlog | low |
| idea-27 | idea | t2 | open | 0 | XL | needs-proposal | low |
| idea-30 | idea | t2,t6 | open | 0 | M | needs-proposal | low |
| idea-33 | idea | t7 | open | 0 | L | ready | med |
| idea-35 | idea | t5 | open | 0 | M | ready | low |
| idea-39 | idea | t1 | open | 0 | M | needs-research | low |
| idea-42 | idea | t6 | open | 0 | M | needs-research | low |
| idea-43 | idea | t3 | open | 0 | L | needs-research | low |
| idea-45 | idea | t5 | open | 0 | M | needs-proposal | low |
| idea-46 | idea | t1,t3 | open | 0 | S | needs-research | low |
| idea-50 | idea | t3,t6 | open | 0 | M | needs-research | low |
| idea-55 | idea | t7,t9 | open | 0 | M | needs-proposal | low |
| idea-56 | idea | t5 | open | 0 | M | ready | low |
| idea-58 | idea | t5 | open | 0 | M | needs-research | low |
| idea-60 | idea | t1 | open | 0 | M | needs-proposal | low |
| idea-61 | idea | t5 | open | 0 | M | needs-research | low |
| idea-62 | idea | t5 | open | 0 | L | needs-research | low |
| idea-63 | idea | t1 | open | 0 | S | ready | low |
| idea-64 | idea | t4,t5 | open | 0 | S | backlog | low |
| idea-65 | idea | t4 | open | 0 | S | backlog | low |
| idea-67 | idea | t6 | open | 1 | M | needs-research | low |
| idea-68 | idea | t6 | open | 0 | M | ready | low |
| idea-69 | idea | t2 | open | 0 | M | needs-proposal | low |
| idea-70 | idea | t5 | open | 0 | L | ready | med |
| idea-71 | idea | t3,t6 | open | 0 | M | backlog | low |
| idea-72 | idea | t5,t12 | open | 0 | L | needs-research | low |
| idea-73 | idea | t6 | open | 1 | L | needs-proposal | low |
| idea-74 | idea | t9 | open | 0 | M | ready | low |
| idea-75 | idea | t6 | open | 0 | XL | needs-proposal | med |
| idea-78 | idea | t6,t7 | open | 0 | M | ready | low |
| idea-79 | idea | t3,t11 | open | 0 | S | backlog | low |
| idea-80 | idea | t2,t4 | open | 0 | M | needs-proposal | low |
| idea-81 | idea | t4 | open | 0 | L | needs-proposal | low |
| idea-82 | idea | t2,t3 | open | 0 | M | backlog | low |
| idea-83 | idea | t4 | open | 0 | S | ready | low |
| idea-84 | idea | t3,t5 | open | 1 | XL | needs-proposal | med |
| idea-85 | idea | t4 | open | 1 | L | needs-proposal | low |
| idea-86 | idea | t5 | open | 0 | L | needs-proposal | low |
| idea-90 | idea | t2 | open | 0 | S | backlog | low |
| idea-91 | idea | t2 | open | 1 | M | needs-proposal | low |
| idea-92 | idea | t2 | open | 0 | S | backlog | low |
| idea-93 | idea | t7 | open | 0 | M | ready | low |
| idea-94 | idea | t3,t7 | open | 0 | M | ready | low |
| idea-95 | idea | t3,t7 | open | 0 | M | ready | low |
| idea-96 | idea | t7 | open | 0 | M | ready | low |
| idea-97 | idea | t1 | open | 0 | L | ready | med |
| idea-98 | idea | t7 | open | 0 | M | needs-research | low |
| idea-99 | idea | t7 | open | 0 | L | ready | med |
| idea-102 | idea | t2,t3 | open | 3 | XL | needs-proposal | med |
| idea-103 | idea | t3 | open | 0 | S | backlog | low |
| idea-104 | idea | t6 | open | 2 | XL | ready | high |
| idea-105 | idea | t7 | open | 0 | M | ready | med |
| idea-107 | idea | t2,t6,t11 | open | 0 | - | - | - |
| idea-108 | idea | t2,t11 | open | 0 | - | - | - |
| idea-109 | idea | t4,t7,t11 | open | 0 | - | - | - |
| idea-110 | idea | t6,t11 | open | 0 | - | - | - |
| idea-111 | idea | t6 | open | 0 | - | - | - |
| idea-112 | idea | t2 | open | 0 | - | - | - |
| idea-113 | idea | t3,t11 | open | 0 | - | - | - |
| idea-114 | idea | t3,t7,t11 | open | 0 | - | - | - |
| idea-115 | idea | t3,t11 | open | 0 | - | - | - |
| idea-116 | idea | t11,t12 | open | 0 | - | - | - |
| idea-118 | idea | t7 | open | 0 | - | - | - |
| idea-119 | idea | t11,t12 | open | 1 | - | - | - |
| idea-122 | idea | t6,t7 | open | 0 | - | - | - |
| idea-124 | idea | t2,t6 | open | 0 | - | - | - |
| idea-125 | idea | t2,t6 | open | 0 | - | - | - |
| idea-127 | idea | t2,t6 | open | 0 | - | - | - |
| idea-128 | idea | t6,t9 | open | 0 | - | - | - |
| idea-129 | idea | t2,t4,t5 | open | 1 | - | - | - |
| idea-130 | idea | t2,t3,t5 | open | 0 | - | - | - |
| idea-131 | idea | t1,t5,t7,t9 | open | 0 | - | - | - |
| idea-133 | idea | t4,t7,t8,t9,t10 | open | 5*K* | - | - | - |
| idea-134 | idea | t2,t4,t7,t8,t10 | open | 0 | - | - | - |
| idea-135 | idea | t2,t4,t6,t7,t9 | open | 0 | - | - | - |
| idea-136 | idea | t2,t4,t8,t9,t10 | open | 0 | - | - | - |
| idea-137 | idea | t4,t6,t8,t9,t10 | open | 1 | - | - | - |
| idea-138 | idea | t2,t4,t6,t8,t9,t11 | open | 0 | - | - | - |
| idea-139 | idea | t2,t4,t7,t8,t9 | open | 3 | - | - | - |
| idea-140 | idea | t4,t10 | open | 0 | - | - | - |
| idea-141 | idea | t4,t10 | open | 0 | - | - | - |
| idea-142 | idea | t4,t10 | open | 0 | - | - | - |
| idea-143 | idea | t4,t10 | open | 0 | - | - | - |
| idea-145 | idea | t7,t12 | open | 0 | - | - | - |
| idea-146 | idea | t7,t12 | open | 0 | - | - | - |
| idea-147 | idea | t2,t4 | open | 0 | - | - | - |
| idea-148 | idea | t3 | open | 0 | - | - | - |
| idea-149 | idea | t4,t10 | open | 0 | - | - | - |
| idea-150 | idea | t6,t9 | open | 0 | - | - | - |
| idea-152 | idea | t1,t3 | open | 3 | - | - | - |
| idea-153 | idea | t3 | open | 0 | - | - | - |
| idea-154 | idea | t1,t7 | open | 0 | - | - | - |
| idea-155 | idea | t1,t4 | open | 0 | - | - | - |
| idea-156 | idea | t8 | open | 0 | - | - | - |
| idea-157 | idea | t8 | open | 0 | - | - | - |
| idea-158 | idea | t8 | open | 0 | - | - | - |
| idea-159 | idea | - | open | 0 | - | - | - |
| idea-160 | idea | - | open | 0 | - | - | - |
| idea-161 | idea | - | open | 0 | - | - | - |
| idea-162 | idea | - | open | 0 | - | - | - |
| idea-163 | idea | - | open | 0 | - | - | - |
| idea-164 | idea | - | open | 0 | - | - | - |
| idea-165 | idea | - | open | 0 | - | - | - |
| idea-166 | idea | - | open | 0 | - | - | - |
| idea-167 | idea | - | open | 0 | - | - | - |
| idea-168 | idea | - | open | 0 | - | - | - |
| idea-169 | idea | - | open | 0 | - | - | - |
| idea-170 | idea | - | open | 0 | - | - | - |
| idea-171 | idea | - | open | 0 | - | - | - |
| idea-172 | idea | - | open | 0 | - | - | - |
| idea-173 | idea | - | open | 0 | - | - | - |
| idea-174 | idea | - | open | 0 | - | - | - |
| idea-175 | idea | - | open | 0 | - | - | - |
| idea-176 | idea | - | open | 0 | - | - | - |
| idea-177 | idea | - | open | 0 | - | - | - |
| idea-178 | idea | - | open | 0 | - | - | - |
| idea-179 | idea | - | open | 0 | - | - | - |
| idea-180 | idea | - | open | 0 | - | - | - |
| idea-181 | idea | - | open | 0 | - | - | - |
| idea-182 | idea | - | open | 1 | - | - | - |
| idea-183 | idea | t6,t8 | open | 0 | - | - | - |
| idea-184 | idea | - | open | 0 | - | - | - |
| idea-185 | idea | t7 | open | 0 | - | - | - |
| idea-186 | idea | - | open | 1 | - | - | - |
| idea-187 | idea | - | open | 0 | - | - | - |
| idea-188 | idea | - | open | 0 | - | - | - |
| idea-192 | idea | - | open | 0 | - | - | - |
| idea-195 | idea | t7 | open | 0 | - | - | - |
| idea-196 | idea | - | open | 0 | - | - | - |
| idea-197 | idea | - | open | 0 | - | - | - |
| idea-199 | idea | - | open | 0 | - | - | - |
| idea-200 | idea | - | open | 1 | - | - | - |
| idea-201 | idea | - | open | 0 | - | - | - |
| idea-202 | idea | - | open | 0 | - | - | - |
| idea-203 | idea | - | open | 0 | - | - | - |
| idea-204 | idea | - | open | 0 | - | - | - |
| idea-205 | idea | - | open | 0 | - | - | - |
| idea-207 | idea | - | open | 0 | - | - | - |
| idea-208 | idea | - | open | 0 | - | - | - |
| idea-211 | idea | - | open | 0 | - | - | - |
| idea-214 | idea | - | open | 0 | - | - | - |
| idea-216 | idea | - | open | 0 | - | - | - |
| idea-218 | idea | - | open | 0 | - | - | - |
| idea-221 | idea | - | open | 0 | - | - | - |
| idea-222 | idea | - | open | 0 | - | - | - |
| idea-227 | idea | - | open | 2 | - | - | - |
| idea-229 | idea | - | open | 3 | - | - | - |
| idea-233 | idea | - | open | 0 | - | - | - |
| idea-234 | idea | - | open | 1 | - | - | - |
| idea-235 | idea | - | open | 1 | - | - | - |
| idea-236 | idea | - | open | 0 | - | - | - |
| idea-239 | idea | - | open | 0 | - | - | - |
| idea-240 | idea | - | open | 1 | - | - | - |
| idea-241 | idea | - | open | 0 | - | - | - |
| idea-242 | idea | - | open | 0 | - | - | - |
| idea-243 | idea | - | open | 0 | - | - | - |
| idea-244 | idea | - | open | 0 | - | - | - |
| idea-245 | idea | - | open | 0 | - | - | - |
| idea-247 | idea | - | open | 0 | - | - | - |
| idea-248 | idea | - | open | 0 | - | - | - |
| idea-249 | idea | - | open | 0 | - | - | - |
| idea-250 | idea | - | open | 0 | - | - | - |
| idea-254 | idea | - | open | 0 | - | - | - |
| idea-255 | idea | - | open | 0 | - | - | - |
| idea-256 | idea | - | open | 1 | - | - | - |
| idea-257 | idea | - | open | 0 | - | - | - |
| idea-259 | idea | - | open | 0 | - | - | - |
| idea-260 | idea | - | open | 0 | - | - | - |
| idea-262 | idea | - | open | 0 | - | - | - |
| idea-266 | idea | - | open | 0 | - | - | - |
| idea-270 | idea | - | open | 0 | - | - | - |
| idea-275 | idea | - | open | 0 | - | - | - |
| idea-276 | idea | - | open | 0 | - | - | - |
| idea-277 | idea | - | open | 0 | - | - | - |
| idea-278 | idea | - | open | 0 | - | - | - |
| idea-279 | idea | - | open | 0 | - | - | - |
| idea-280 | idea | - | open | 0 | - | - | - |
| idea-281 | idea | - | open | 0 | - | - | - |
| idea-282 | idea | - | open | 1 | - | - | - |
| idea-283 | idea | - | open | 0 | - | - | - |
| idea-284 | idea | - | open | 0 | - | - | - |
| idea-285 | idea | - | open | 0 | - | - | - |
| idea-286 | idea | - | open | 0 | - | - | - |
| idea-287 | idea | - | open | 0 | - | - | - |
| idea-288 | idea | - | open | 0 | - | - | - |
| idea-289 | idea | - | open | 0 | - | - | - |
| idea-290 | idea | - | open | 0 | - | - | - |
| idea-291 | idea | - | open | 1 | - | - | - |
| idea-293 | idea | - | open | 0 | - | - | - |
| idea-295 | idea | - | open | 0 | - | - | - |
| idea-296 | idea | - | open | 1 | - | - | - |
| idea-297 | idea | - | open | 0 | - | - | - |
| idea-299 | idea | - | open | 1 | - | - | - |
| idea-304 | idea | - | open | 0 | - | - | - |
| idea-306 | idea | - | open | 0 | - | - | - |
| idea-307 | idea | - | open | 0 | - | - | - |
| idea-310 | idea | - | open | 0 | - | - | - |
| idea-311 | idea | - | open | 0 | - | - | - |
| idea-312 | idea | - | open | 1 | - | - | - |
| idea-313 | idea | - | open | 0 | - | - | - |
| idea-316 | idea | - | open | 1 | - | - | - |
| idea-317 | idea | - | open | 0 | - | - | - |
| idea-319 | idea | - | open | 0 | - | - | - |
| idea-321 | idea | - | open | 0 | - | - | - |
| idea-325 | idea | - | open | 1 | - | - | - |
| idea-326 | idea | - | open | 0 | - | - | - |
| idea-328 | idea | - | open | 0 | - | - | - |
| idea-329 | idea | - | open | 0 | - | - | - |
| idea-332 | idea | - | open | 0 | - | - | - |
| idea-333 | idea | - | open | 0 | - | - | - |
| idea-334 | idea | - | open | 0 | - | - | - |
| idea-335 | idea | - | open | 0 | - | - | - |
| idea-336 | idea | t6 | open | 0 | - | - | - |
| idea-337 | idea | - | open | 0 | - | - | - |
| idea-338 | idea | - | open | 0 | - | - | - |
| idea-339 | idea | - | open | 0 | - | - | - |
| idea-340 | idea | - | open | 0 | - | - | - |
| idea-341 | idea | - | open | 0 | - | - | - |
| idea-342 | idea | - | open | 0 | - | - | - |
| idea-343 | idea | - | open | 1 | - | - | - |
| idea-344 | idea | - | open | 0 | - | - | - |
| idea-346 | idea | t2 | open | 0 | - | - | - |
| idea-347 | idea | - | open | 0 | - | - | - |
| idea-348 | idea | - | open | 0 | - | - | - |
| idea-349 | idea | - | open | 0 | - | - | - |
| idea-350 | idea | - | open | 1 | - | - | - |
| idea-351 | idea | - | open | 0 | - | - | - |
| idea-352 | idea | - | open | 0 | - | - | - |
| idea-353 | idea | t13 *NS* | open | 2 | - | - | - |
| idea-354 | idea | t3 | open | 0 | - | - | - |
| idea-356 | idea | t13 *NS* | open | 0 | - | - | - |
| idea-357 | idea | t13 *NS* | open | 2 | - | - | - |
| idea-358 | idea | t4 | open | 0 | - | - | - |
| idea-359 | idea | - | open | 0 | - | - | - |
| idea-360 | idea | - | open | 0 | - | - | - |
| idea-361 | idea | - | open | 0 | - | - | - |
| idea-362 | idea | t7 | open | 0 | - | - | - |
| idea-363 | idea | t13 *NS* | open | 0 | - | - | - |
| idea-364 | idea | t4 | open | 4 | - | - | - |
| idea-365 | idea | t3 | open | 0 | - | - | - |
| idea-366 | idea | t9 | open | 0 | - | - | - |
| idea-367 | idea | t13 *NS* | open | 1 | - | - | - |
| idea-368 | idea | t13 *NS* | open | 1 | - | - | - |
| idea-369 | idea | t13 *NS* | open | 2 | - | - | - |
| idea-370 | idea | t0 *NS* | open | 0 | - | - | - |
| idea-371 | idea | t11 | open | 0 | - | - | - |
| idea-372 | idea | t2 | open | 0 | - | - | - |
| idea-373 | idea | t10 | open | 0 | - | - | - |
| idea-374 | idea | t4,t7 | open | 0 | - | - | - |
| idea-375 | idea | t4 | open | 0 | - | - | - |
| idea-376 | idea | t7 | open | 0 | - | - | - |
| idea-377 | idea | t7 | open | 0 | - | - | - |
| idea-379 | idea | t4 | open | 0 | - | - | - |
| idea-381 | idea | t7 | open | 0 | - | - | - |
| idea-382 | idea | t7,t11,t13 *NS* | open | 0 | - | - | - |
| idea-383 | idea | - | open | 1 | - | - | - |
| idea-385 | idea | - | open | 0 | - | - | - |
| idea-386 | idea | - | open | 0 | - | - | - |
| idea-387 | idea | - | open | 0 | - | - | - |
| idea-388 | idea | - | open | 0 | - | - | - |
| idea-389 | idea | - | open | 0 | - | - | - |
| idea-390 | idea | - | open | 0 | - | - | - |
| idea-391 | idea | - | open | 1 | - | - | - |
| idea-392 | idea | - | open | 0 | - | - | - |
| idea-393 | idea | - | open | 0 | - | - | - |
| idea-394 | idea | - | open | 0 | - | - | - |

## §3 Signal context

- **Reverse-gap teles** (0 serving candidate => synthesise a propose-an-Initiative row): none
- **Umbrella-Ideas (Initiative proxies):** idea-50, idea-107, idea-229, idea-234, idea-235, idea-236, idea-240, idea-242, idea-244, idea-250, idea-312
- **Tele served-counts:** tele-0=1, tele-1=9, tele-2=27, tele-3=21, tele-4=28, tele-5=17, tele-6=28, tele-7=35, tele-8=10, tele-9=13, tele-10=11, tele-11=13, tele-12=5, tele-13=8

## §4 History slice

- Reconciliation anchor doc: `docs/reviews/2026-06-29-ledger-reconciliation-stint6-sr.md` (277 ideas / 41+1 bugs live; bug-190/195 flipped resolved).
- audit-entry history backbone: {"captured": 100, "total": 100, "method": "RECENT-WINDOW history-slice: most-recent 100 entries (audit-1703..audit-4968, 2026-05-16..2026-06-28) for get_metrics reconstruction + history-slice. THE BY-DESIGN SCOPE (NOT the full ~5000 backbone). CONTEXT family => non-fatal"}
- Prior SR/recon docs loaded for de-dup-of-prior-decisions (no prior SR run; this is the first autonomous SR).

## §5 Neutrality attestation (7 guarantees)

- **g1_deterministic:** signals computed by sr-evidence-parser-v1; no LLM judgement in any signal
- **g2_exhaustive_fail_closed:** candidate-scoped per audit-5088: {Ideas 277/277, Bugs 41/41, Teles 14/14} exhaustive + psql-confirmed -> NO candidate shortfall; context families best-effort + documented (non-fatal)
- **g3_provenance_per_source:** coverage_manifest carries source/captured/expected/method per family
- **g4_stable_ordering:** value-blind (kind, numeric-id) sort
- **g5_signal_not_judgement:** signals only; NO rank, NO clustering, NO top-candidates
- **g6_transparent_inclusion:** inclusion predicate = every live candidate (idea status=open + bug status in {open,investigating}) at the anchor + reverse-gap teles; no filter/steer
- **g7_reconciliation_gated:** stamps recon anchor 2026-06-29T03:48:46Z @ 3cff84e

