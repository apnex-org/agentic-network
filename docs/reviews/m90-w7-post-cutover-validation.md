# mission-90 W7 — Post-Cutover Validation Report (LIVE strict substrate)

**Engineer:** greg · **Date:** 2026-06-19 · **Branch:** `agent-greg/m90-w7-post-cutover-validation`
**Substrate:** prod Hub on the W6 image, envelope-STRICT, all-envelope (cutover @ ~08:09Z). All checks read-only against live prod via `hub_reader` unless noted.

---

## Verdict: cutover correct + stable; ONE residual bug-138 caught + fixed (bug-158, needs redeploy); ledger parity is the post-redeploy closeout

W7 live-validation did its job: the substrate-self-dogfood parity-vs-oracle caught a residual envelope-blind list tool (list_missions) that the strict cutover exposed and no test had — fixed in this branch, pending redeploy. Everything else validated clean.

---

## §1 — 9 list-tools envelope-correct on the LIVE substrate (the bug-138-closed-live proof)

Method: run the MCP list tool with a **relocated-key filter** (the bug-138 surface) on live prod, compare the count/ids vs a direct-psql oracle on the envelope path.

| Tool | Relocated-key filter | MCP result | psql oracle | Verdict |
|---|---|---|---|---|
| list_ideas | status=open (→status.phase) | 217 | 217 | ✅ MATCH |
| list_bugs | status=open (→status.phase) | 58 | 58 | ✅ MATCH |
| list_bugs | severity=major (→spec.severity) | 10/page, all major (architect-confirmed) | 80 total | ✅ correct filter |
| list_threads | status=active (→status.phase) | 0 | 0 | ✅ MATCH |
| list_tele | (status guard →status.phase) | 0 active | 0 active | ✅ MATCH |
| list_tasks | status (→status.phase) | W3-fixed accessor path | — | ✅ (W3) |
| list_proposals | status (push-down → W2 translate) | W2 translate-point | — | ✅ (W2) |
| list_audit_entries | actor (scalar) | scalar path | — | ✅ |
| **list_missions** | **status=active (→status.phase)** | **0** | **1 (mission-90)** | **❌ MISS → bug-158** |

**bug-158 (FILED, major):** `list_missions({status:<any>})` returned 0 for every status (oracle: 90 missions — active:1, completed:50, abandoned:39). Root cause: the W3 Layer-B accessor sweep converted IDEA/TASK/THREAD accessors to phaseFromEntity/fieldFromEntity but **MISSED MISSION_ACCESSORS** (raw `m.status` etc.). Every Mission field relocates (status→status.phase; createdAt/createdBy/correlationId/sourceThreadId/sourceActionId/updatedAt→metadata; turnId→status), so on an envelope mission `m.status` was the `{phase}` OBJECT → 0 matches. The policy filters in-memory via these accessors after a no-statusFilter repo fetch (bypassing the repo's correct status.phase translation), so the accessors must be envelope-aware. The tolerant/mixed-shape data masked it pre-cutover; the strict all-envelope cutover exposed it. **FIXED** (MISSION_ACCESSORS → phaseFromEntity/fieldFromEntity, mirroring IDEA_ACCESSORS) + regression test in `layerb-accessor-sweep-w3.test.ts` (envelope missions: status filter-object + legacy scalar + relocated correlationId/turnId/createdBy.role + non-match `_ois_query_unmatched`). Full suite green (1961). **CODE-only — needs a redeploy** to fix live prod (the W6 image lacks it); architect/Director gate it (default: code-only container-recreate off merged-main, no migration). Closes with this PR merge + the post-redeploy live re-verify.

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
- **list_X return RAW ENVELOPE** — list_ideas/list_bugs output `status: {phase}`, `spec: {...}`, `metadata: {...}` (no decode). list_messages/list_tele were already envelope.

NOT data-loss, NOT a filter-correctness bug (filters are envelope-correct post-bug-158), NOT W7-blocking. It's a consumer-contract decision: **(a) envelope-canonical output** (list+get return envelope; consumers adapt) vs **(b) flat-projection at the read-tool boundary** (both decode to flat), applied UNIFORMLY. Filed as **idea-327**; its first task is the full per-tool output-shape enumeration across all read tools, then ratify (a)/(b).

---

## §4 — Ledger-reconciliation parity — POST-REDEPLOY closeout

list_missions is the ledger's core read; it is fixed in-branch (bug-158) but **broken on live prod until the redeploy**. Therefore ledger-reconciliation list-tool parity (idea-325) is validated LIVE **after** the bug-158 redeploy, as the W7 closeout — not pre-merge.

---

## §5 — Closure notes
- **bug-138** — structurally closed reads (W2/W3) + writes (W4) + deployed live (W6); the ONE residual (bug-158, list_missions accessors) caught here + fixed, pending redeploy. After the redeploy + ledger re-verify, bug-138 is fully closed on the live substrate.
- **bug-143** (phaseFromEntity at task FSM-guards) — shipped pre-mission-90 (53b2ae3); the live task FSM operates on the strict substrate (reconciler clean; list_tasks envelope-correct).
- **bug-156 / bug-157** (cutover false-halt grep -oP / comms-dark in-window-GO) — architect-filed; CI-hygiene/protocol follow-ons (the cutover runbook records the learnings).

## §6 — Stability-confirmed pending
Rollback dump `/tmp/m90-cutover-rollback.dump` + PRIOR image `sha256:dd61d96` RETAINED until the architect calls stability-confirmed — which now waits on: this W7 PR merge + the bug-158 redeploy + the post-redeploy live re-verify (list_missions + ledger). Then shred.
