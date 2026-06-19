# mission-90 W7 — Post-Cutover Validation Report (LIVE strict substrate)

**Engineer:** greg · **Date:** 2026-06-19 · **Branch:** `agent-greg/m90-w7-post-cutover-validation`
**Substrate:** prod Hub, envelope-STRICT, all-envelope. W6 cutover @ ~08:09Z (image f02a9bb); bug-158 code-only redeploy @ ~08:58Z (image **edc4792** = W6+bug-158). All checks read-only against live prod via `hub_reader` unless noted.

---

## Verdict: cutover correct + stable; the one residual bug-138 (bug-158) caught, fixed, DEPLOYED LIVE, and re-verified — 9/9 list-tools envelope-correct; ledger parity confirmed

W7 live-validation did its job: the substrate-self-dogfood parity-vs-oracle caught a residual envelope-blind list tool (`list_missions`) that the strict cutover exposed and no test had — fixed (bug-158), fast-tracked through an isolated hotfix PR + a code-only redeploy, and re-verified live. **bug-138's silent-filter-miss class is now FULLY closed on the live substrate.** Everything else validated clean.

---

## §1 — 9 list-tools envelope-correct on the LIVE substrate (the bug-138-closed-live proof)

Method: run the MCP list tool with a **relocated-key filter** (the bug-138 surface) on live prod, compare the count/ids vs a direct-psql oracle on the envelope path.

| Tool | Relocated-key filter | MCP result | psql oracle | Verdict |
|---|---|---|---|---|
| list_ideas | status=open (→status.phase) | 218 | 218 | ✅ MATCH |
| list_bugs | status=open (→status.phase) | 59 | 59 | ✅ MATCH |
| list_bugs | severity=major (→spec.severity) | 10/page, all major (architect-confirmed) | 80 total | ✅ correct filter |
| list_threads | status=active (→status.phase) | 0 | 0 | ✅ MATCH |
| list_tele | (status guard →status.phase) | 0 active | 0 active | ✅ MATCH |
| list_tasks | status=working / cancelled (→status.phase) | 4 / 116 | 4 / 116 | ✅ MATCH |
| list_proposals | status (push-down → W2 translate) | W2 translate-point | — | ✅ (W2) |
| list_audit_entries | actor (scalar) | scalar path | — | ✅ |
| **list_missions** | **status=active/completed/abandoned (→status.phase)** | **1 / 50 / 39 (total 90)** | **1 / 50 / 39 (total 90)** | **✅ MATCH (post-redeploy)** |

**9/9 list-tools envelope-correct on the LIVE strict substrate.** (The Idea/Bug deltas vs the pre-redeploy capture — open 217→218, 58→59 — are exactly the W7-filed entities idea-327 + bug-158, an internal-consistency cross-check.)

**bug-158 (CLOSED LIVE, was major):** `list_missions({status:<any>})` returned 0 for every status (oracle: 90 — active:1, completed:50, abandoned:39). Root cause: the W3 Layer-B accessor sweep converted IDEA/TASK/THREAD accessors to phaseFromEntity/fieldFromEntity but **MISSED MISSION_ACCESSORS** (raw `m.status` etc.). Every Mission field relocates (status→status.phase; createdAt/createdBy/correlationId/sourceThreadId/sourceActionId/updatedAt→metadata; turnId→status), so on an envelope mission `m.status` was the `{phase}` OBJECT → 0 matches. The policy filters in-memory via these accessors after a no-statusFilter repo fetch (bypassing the repo's correct status.phase translation), so the accessors must be envelope-aware. Tolerant/mixed-shape data masked it pre-cutover; the strict all-envelope cutover exposed it. **FIXED** (MISSION_ACCESSORS → phaseFromEntity/fieldFromEntity, mirroring IDEA_ACCESSORS) + regression test in `layerb-accessor-sweep-w3.test.ts` (envelope missions: status filter-object + legacy scalar + relocated correlationId/turnId/createdBy.role + non-match `_ois_query_unmatched`). **SHIPPED:** isolated FAST-TRACK hotfix (Director-ruled) — PR #322 (squash `9f579f6`) → code-only container-recreate redeploy off merged-main (image `edc4792`, no migration/reset/shadow-gate) → post-redeploy live re-verify (the table above). bug-158 closed live.

---

## §2 — bug-151 / bug-152 live spot-checks

**bug-152 (envelope read-decoders) — LIVE-CONFIRMED (read-side):**
- `get_thread(thread-658)` (envelope thread, status.phase="closed") returned **fully decoded**: `status: "closed"` (string), 3 messages, 2 participants, summary, convergenceActions[1] with `proposer` shape-normalized, routingMode, currentTurn — the W4 `normalizeThreadShape` full-decoder works live.
- `get_tele(tele-3)` (envelope tele) returned decoded: `status: "active"` (string), name/description/successCriteria/createdBy — the W4 `normalizeTele` decoder works live.

**bug-152 write-side (reply/retire FSM gates):** the gates read the decoded status, which the read-side confirms decodes correctly to a string → the gates evaluate correctly. A full live reply-on-active-envelope-thread needs an *active* thread + two-party turn alternation (prod has 0 active threads; not solo-testable). Covered by: the read-decoder being live-correct + the W4/W5 regression tests (thread reply+convergence, tele retire+supersede on envelope-backed storage) + the clean reconciler boot. Offered as a paired live check if required.

**bug-151 (scheduled-Message-sweeper):** the W4 sweeper `matchesFilter` envelope-fix is live (W6 deploy includes W4). Empirical (W6-prep): **0 scheduled-Messages pending** in prod (env or bare) → no stuck backlog. Covered by the W4 watch-matchesFilter regression test + the live sweeper. A live fire-test (create scheduled-Message → sweeper-wait → assert fires) is a prod-write + timing-bound; offered as a follow-up if a live fire is required.

---

## §3 — Output-shape drift → idea-327 (consumer-contract follow-on)

Architect-flagged. Post-cutover the read tools emit **inconsistent** output shapes:
- **get_X DECODE to flat** — get_thread/get_tele output top-level `status: "closed"` (string), flat fields (the W4 decoders run on read).
- **list_X return RAW ENVELOPE** — list_ideas/list_bugs/list_missions output `status: {phase}`, `spec: {...}`, `metadata: {...}` (no decode). list_messages/list_tele were already envelope.

NOT data-loss, NOT a filter-correctness bug (filters are envelope-correct post-bug-158), NOT W7-blocking. It's a consumer-contract decision: **(a) envelope-canonical output** (list+get return envelope; consumers adapt) vs **(b) flat-projection at the read-tool boundary** (both decode to flat), applied UNIFORMLY. Filed as **idea-327**; its first task is the full per-tool output-shape enumeration across all read tools, then ratify (a)/(b).

---

## §4 — Ledger-reconciliation parity — CONFIRMED LIVE (post-redeploy)

`list_missions` is the ledger's core read; bug-158 broke it on live prod until the redeploy. Re-run post-redeploy as the W7 closeout — MCP list-tool `total` vs the direct-psql `status.phase` oracle across the ledger kinds:

| Kind | filter | MCP total | psql oracle | Verdict |
|---|---|---|---|---|
| Mission | status=active | 1 (mission-90) | 1 | ✅ |
| Mission | status=completed | 50 | 50 | ✅ |
| Mission | status=abandoned | 39 | 39 | ✅ |
| Mission | (no filter) | 90 | 90 | ✅ |
| Idea | status=open | 218 | 218 | ✅ |
| Bug | status=open | 59 | 59 | ✅ |
| Task | status=working | 4 | 4 | ✅ |
| Task | status=cancelled | 116 | 116 | ✅ |

Full parity. **idea-325 (ledger-reconciliation / Survey, blocked on `list_missions`) is unblocked** — the ledger reads are envelope-correct on the live substrate.

---

## §5 — Closure notes
- **bug-138** — structurally closed reads (W2/W3) + writes (W4) + deployed live (W6 cutover); the ONE residual (bug-158, list_missions accessors) caught here, fixed, redeployed live, and re-verified. **bug-138 is FULLY closed on the live substrate.**
- **bug-143** (phaseFromEntity at task FSM-guards) — shipped pre-mission-90 (53b2ae3); the live task FSM operates on the strict substrate (reconciler clean; list_tasks envelope-correct).
- **bug-156 / bug-157** (cutover false-halt grep -oP / comms-dark in-window-GO) — architect-filed; CI-hygiene/protocol follow-ons. The bug-156 lesson directly shaped the bug-158 recreate (stdin-piped `sudo bash -s`, no Perl-regex parsing) — ran clean, no false-halt. Folded into the cutover runbook.
- **bug-158** (list_missions MISSION_ACCESSORS) — caught W7, fixed + shipped via the FAST-TRACK isolated hotfix + code-only redeploy. Closed live.

## §6 — Stability-confirmed pending
Rollback assets RETAINED until the architect calls stability-confirmed: **primary rollback `sha256:f02a9bb`** (the prior W6 image — the code-only-redeploy revert target), the deeper full-unwind last-resort `sha256:dd61d96` (pre-cutover) + rollback dump `/tmp/m90-cutover-rollback.dump`. stability-confirmed now waits on: this W7 PR merge + a brief live-stability soak. Then shred.
