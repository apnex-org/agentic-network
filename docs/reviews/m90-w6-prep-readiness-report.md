# mission-90 W6-PREP — Cutover Readiness Report (task-420)

**Engineer:** greg · **Date:** 2026-06-19 · **Branch:** `agent-greg/m90-w6-prep-cutover-readiness` (off `428db4c`)
**Posture:** CLONE-ONLY / ZERO prod-touch. **The cutover EXECUTION (Hub-stop → re-migrate prod → strict-flip → manual IAP-SSH redeploy) is the Phase 7 Release GATE — DIRECTOR-GATED. Nothing in this prep touched prod.**

This report is the readiness EVIDENCE the architect surfaces to the Director for the cutover-go.

---

## Verdict: see the EMPIRICAL ADDENDUM (bottom) — SUPERSEDES this pre-empirical verdict

> **UPDATE 2026-06-19:** the empirical run on the real prod snapshot (Director-authorized read-only) is DONE — see the ADDENDUM at the bottom. It found a SECOND latent data-loss bug (offset-pagination silent-skip) beyond the dirty-cursor trap (both now FIXED + validated on real data), and that the re-migration time now exceeds the <60s budget. Revised verdict: **NO-GO until the downtime-mitigation decision (E4)**; the two data-loss bugs are fixed. The §1–§8 below + the gate table are the pre-empirical (synthetic) state; the ADDENDUM (E1–E7) is authoritative for prod-state, the trapped-row counts, the stuck-Message root-cause, timing, and the corrected bug-151/152 liveness.

The W6 re-migration tooling + the shadow-read parity gate mechanism are BUILT and self-validated on synthetic clones. Self-review surfaced that the §3.2 dirty-cursor-trap mitigation was **specified but never wired into the cutover path** — now fixed. The empirical run (ADDENDUM) then validated this on real data AND found the offset-skip bug.

---

## Gate-item status (Design §3.2 W6-prep gate)

| # | Gate item | Status | Evidence |
|---|-----------|--------|----------|
| 1 | W1–W5 integration green at HEAD | ✅ DONE | full hub suite 1960 passed / 7 skipped (160 files), tsc clean |
| 2 | Shadow-read parity harness PASSED offline (§3.3) | ✅ BUILT + self-validated (synthetic) · ⏳ empirical pending snapshot | `shadow-read-parity-w6.test.ts` (3 green): every-entry coverage + list==oracle==seeded for all 49/21 |
| 3 | Re-migration cursor discipline (resetCheckpoint-ALL + loop-to-0 + exemptions) | ✅ BUILT + proven (was a GAP) | `--reset-checkpoints` + `resetAllCheckpoints()` + `--list-kinds`; `migration-cursor-discipline-w6.test.ts` (2 green) reproduces the c2 trap + proves the mitigation converges |
| 4 | KINDS-array reconciliation done | ✅ TOOLING DONE (`--list-kinds`) · ⚠️ script-array still 21 (see §3) | run-envelope-migration `--list-kinds` is the single-authority; the mission-88 shell array is stale (Notification) |
| 5 | Writer-closure re-verified (zero bare newer than W4-ship) | ✅ STRUCTURAL · ⏳ empirical pending snapshot | W4 no-new-bare canary on main (`write-encoder-and-watch-w4.test.ts`); empirical row-scan needs the snapshot |
| 6 | stuck-Message-40 root-caused | ⏳ PENDING SNAPSHOT | needs the real rows (40 Message survived 4 runs, errored=0 — silent decoder-skip suspect) |
| 7 | Measured re-migration time within budget | ⏳ PENDING SNAPSHOT | preflight measured 47-57s on 9-day-old data; a FRESH measure de-risks the thin margin |
| 8 | Rollback rehearsed on the clone | ✅ MECHANISM (resetAllCheckpoints) · ⏳ pg_restore leg pending snapshot | reset leg tested; the `pg_restore` leg needs a snapshot to rehearse end-to-end |
| 9 | bug-151/152 prod-liveness | ✅ ANSWERED — empirically LATENT (0 currently-affected) | §4 is pre-empirical; ADDENDUM E5 is authoritative (corrected the "broken today" overclaim) |

---

## §1 Shadow-read parity harness (§3.3) — the W6 release-gate mechanism, BUILT

`hub/src/storage-substrate/__tests__/shadow-read-parity-w6.test.ts`. Mechanism per Design §3.3:
- **Corpus** built generically from the all-schemas `renameMap` authority — one filter per entry (all 49 / 21 kinds) + a non-renamed control key. Coverage is cross-checked against the raw inventory (no entry silently un-exercised).
- **Parity (per entry):** the production read-path `substrate.list({[bareKey]: v})` (which translates `bareKey → envelope-path` via the reconciler's renameMap table) is compared against an independent direct-psql `data#>>'{...}'` ORACLE.
- **Dispositive guard (beyond the design's list==oracle):** each query is asserted to return the EXACT seeded match-ids. This catches a renameMap entry whose claimed path DIVERGES from the encoder's actual placement (the oracle on a wrong path returns 0 ≠ the seeded 2) — NOT a both-empty false-pass.

**Result: 100% parity, every entry, on synthetic envelope data.** One finding during the build, RESOLVED-as-expected: `Notification.event` is enum-coerced at migrate-time (W8 Q1 — unknown → `"unknown"`), so the corpus uses a known eventType; the `event→spec.eventType` translation itself is correct. Nested filter keys (`target.role`/`target.agentId` → `spec.target.*`, the only two) are seeded as nested objects.

**Cutover use:** at cutover-prep the IDENTICAL harness runs against the restored prod snapshot (hub-snapshot.sh → testcontainers clone); only the data source changes. **100% parity on the real snapshot is the strict-flip gate** (Design §3.3) and remains pending the snapshot (§7).

---

## §2 Re-migration cursor discipline (§3.2 step-3) — was an UNWIRED GAP, now BUILT + proven

**Self-review finding (flagged to architect):** the §3.2 dirty-cursor-trap mitigation was specified but **never implemented in the cutover path**:
- `resetCheckpoint` reset only ONE kind (`migration-cursor-repository.ts:89`); there was **no reset-ALL** capability and the cutover script **never called it**.
- the cutover script ran a **single** `envelope-migrate` (no loop-until-migrated=0).
- `--list-kinds` did not exist (the cutover KINDS array was hand-maintained → 21-vs-22 Notification drift).

The trap is real (`migration-runner.ts:107` `row.id <= resumeFromId` skips lexically-smaller ids; preflight c2: "bug-137" <= "bug-99" string-ordered). A single-pass migrate on a dirty cursor silently under-migrates.

**Built (single-authority, no hand-lists):**
- `MigrationRunner.resetAllCheckpoints()` — loops `registeredKinds()`, resets each cursor; returns the kinds reset.
- CLI `--reset-checkpoints` — exposes it (run BEFORE the loop-migrate).
- CLI `--list-kinds` — prints `registeredKinds()` one-per-line; the single-authority source for the cutover KINDS array (kills the hand-maintained drift).

**Proven:** `migration-cursor-discipline-w6.test.ts` (2 green) — (a) `resetAllCheckpoints()` clears every registered kind's cursor; (b) the dirty-cursor trap is REPRODUCED (a bare `bug-137` skipped under a stale `bug-99` checkpoint → `rowsMigrated=0`, stays bare) then MITIGATED (`resetAllCheckpoints` + loop-until-migrated=0 converges in 2 passes: 1 productive + 1 zero).

---

## §3 KINDS-array reconciliation — tooling done; script-array still drifted

`--list-kinds` is the single-authority derivation. The mission-88 cutover script `scripts/operator/m-k8s-envelope-cutover.sh:54-66` still hand-lists **21** kinds, MISSING `Notification`. **Nuance (verified):** the migrate iterates `registeredKinds()` = **22**, so Notification IS migrated — but the script's Step-4 shape-probe + Step-5 verify SKIP it → a **verification blind-spot** (Notification migrated-but-never-shape-verified), not a migration miss. The new runbook (`docs/operator/envelope-substrate-cutover-runbook.md`) derives the array from `--list-kinds` and verifies all 22. **Recommendation:** the cutover uses the runbook's `--list-kinds`-derived loop, OR patch the mission-88 script's array — a W6-execution call.

---

## §4 bug-151 / bug-152 prod-liveness — IS prod broken today? YES (code + repro)

Prod runs the **last manually-deployed code, which predates mission-90** (the W1–W5 deploy is batched to W6) — i.e. envelope-BLIND (the bug-138 era). The 2026-05-25 cutover + ongoing migration enveloped rows; the design documents envelope rows exist in prod (idea-318/320 enveloped). Therefore, for any envelope row, prod's current code mishandles it:

- **bug-151 (scheduled-Message-sweeper):** the pre-W4 sweeper filters Message `{delivery, scheduledState}` as BARE keys, but on envelope rows those live at `spec.delivery` / `status.scheduledState` → the filter never matches → **envelope scheduled-Messages never fire** (stuck-unfired). The W4 watch-matchesFilter regression (on main) demonstrates the pre-W4 path misses envelope rows.
- **bug-152 (envelope-thread-reply / envelope-tele-retire):** the pre-W4 `normalizeThreadShape` reads `status` as the envelope OBJECT and force-defaults relocated fields → `replyToThread`'s `status !== "active"` gate throws on envelope threads → **reply/convergence broken**; `normalizeTele` likewise → **retire/supersede gates never fire**. The W4/W5 bug-152 regression tests (now on main) were RED against the pre-W4 code = prod's code.

**Liveness verdict: prod is SILENTLY broken today for (a) firing envelope scheduled-Messages, (b) replying to/converging envelope threads, (c) retiring/superseding envelope teles.** The W6 cutover (re-migrate-all + deploy the envelope-correct W1–W5) is the FIX. **The COUNT of currently-degraded rows (go-urgency signal) needs the snapshot (§7).**

---

## §5 Writer-closure — structural at HEAD; empirical pending snapshot

W4 closed all bare-shape writers at the central write-encoder chokepoint, test-enforced by the no-new-bare canary + the bidirectional registry-completeness backstop (`write-encoder-and-watch-w4.test.ts`, on main). So **structurally**, no envelope-correct (post-W4) Hub can emit a bare row for a modelled kind. The **empirical** gate ("zero bare rows newer than W4-ship") is a snapshot row-scan (`SELECT ... WHERE NOT (data ? 'metadata') AND created_at > <W4-ship>`) — pending the snapshot. NOTE: prod has NOT yet deployed W4, so prod IS still bare-writing until the W6 deploy — the "zero bare newer than W4-ship" check is meaningful only AFTER the W6 deploy; pre-deploy, the re-migration handles the accumulated bare rows.

---

## §6 Rollback rehearsal — reset leg tested; restore leg pending snapshot

Abort path (Design §3.2): pre-cutover `pg_dump` snapshot → on abort, `pg_restore` via `hub-snapshot.sh` + `resetAllCheckpoints()` → restart. The **resetAllCheckpoints leg is tested** (§2). The **pg_restore leg** needs a snapshot to rehearse end-to-end on the clone (§7). Mechanism is documented in the runbook.

---

## §7 The EMPIRICAL half — needs a prod snapshot (Director decision)

The preflight snapshot (`/tmp/m90-preflight.dump`) is GONE (env cleared since 2026-06-10). `hub-snapshot.sh` acquires a snapshot via `docker exec` into `ois-postgres-prod` ON hub-vm → a real clone requires IAP-SSH to the prod host = outside "zero prod touch" / Director-gated. The following are READY-TO-RUN against a snapshot but cannot complete without one:
- shadow-read 100% parity on REAL data (the strict-flip gate);
- re-migration TIMING vs the <60s budget (thin 3-13s margin; prod has bare-written ~50 Msg/day for 9+ days since the last measure — a FRESH measure de-risks the window);
- stuck-Message-40 forensics;
- empirical writer-closure row-scan;
- end-to-end rollback (pg_restore) rehearsal;
- bug-151/152 degraded-row COUNTS (go-urgency).

**Options:** (a) operator/Director drops a fresh `hub-snapshot.sh save` dump where I can reach it; (b) explicit authorization for me to IAP-SSH read-only; (c) defer the empirical run to the cutover-window's first step (the re-migrate→shadow-verify→THEN-flip sequence is the safety net either way). Architect leans (a)/(b) for a fresh pre-cutover timing measure; the Director's call is pending.

---

## §8 Image pre-pull (mandatory, <60s budget) — cutover-window ops step

Image pre-pull is a hub-vm ops action (watchtower is non-functional; manual). Not doable from this env (no prod touch); documented in the runbook as a MANDATORY pre-Hub-stop step (the downtime margin is thin).

---

## Deliverables produced (this branch)
- `hub/src/storage-substrate/migrations/v2-envelope/migration-runner.ts` — `resetAllCheckpoints()`.
- `hub/src/scripts/run-envelope-migration.ts` — `--list-kinds`, `--reset-checkpoints`.
- `hub/src/storage-substrate/__tests__/shadow-read-parity-w6.test.ts` — the §3.3 harness (3 green).
- `hub/src/storage-substrate/__tests__/migration-cursor-discipline-w6.test.ts` — the §3.2 cursor discipline (2 green).
- `docs/operator/envelope-substrate-cutover-runbook.md` — the cutover runbook (corrected procedure).
- this report.

Full hub suite GREEN (1960 passed / 7 skipped); tsc clean. Zero prod touch.

---

# ADDENDUM — EMPIRICAL RUN on the real prod snapshot (2026-06-19; Director-authorized read-only IAP-SSH)

Director authorized option (b): read-only IAP-SSH. Acquired a fresh read-only snapshot (`pg_dump -Fc -U hub_reader -t entities`, 12.3MB, ZERO mutation) → restored into a LOCAL throwaway clone → ran all analysis on the clone. No writes/cursor-advance/Hub-stop/deploy on prod.

## Revised verdict: NO-GO until the downtime-mitigation decision — TWO latent data-loss bugs found + fixed; timing now marginally over budget

The empirical run found that, as-was, the cutover would have caused **silent data-loss** via TWO independent mechanisms (both now fixed), and that the re-migration time now exceeds the <60s budget due to 9 days of bare-write growth.

## E1 — Prod state (real)
25,240 entities. **1,488 non-cursor bare rows** (re-migration scope; grew from preflight's ~790 — the live-bare-writers, +~700 in 9 days): Message 1143, Audit 304, Bug 17, PendingAction 8, Task 6, Thread 4, Idea 4, Mission 2. Everything else fully envelope. (Counter/MigrationCursor/SchemaDef etc. as expected.)

## E2 — DIRTY-CURSOR TRAP is LIVE (bug-154 validated with hard numbers)
**27 rows are dirty-cursor-trapped RIGHT NOW** — bare rows whose ids sort lexically `<=` their stale checkpoint, which a single-pass migrate SKIPS:
- Bug: 17 trapped (`cursor-Bug=bug-99`; bug-100..bug-154 sort before "bug-99")
- Task: 6 trapped (`cursor-Task=task-97`)
- Idea: 4 trapped (`cursor-Idea=idea-54`)

Had the cutover run without `resetCheckpoint`-ALL, these 27 stay bare → the strict-flip makes them envelope-blind-UNREADABLE = **27 rows of silent data-loss** (17 bugs, 6 tasks, 4 ideas). **VALIDATED FIX:** `--reset-checkpoints` + re-migrate → all 27 recovered to envelope (Bug 154/0 bare, Task 420/0 bare, Idea 326/0 bare on the clone).

## E3 — OFFSET-PAGINATION SILENT-SKIP — a SECOND, previously-unknown data-loss bug, found + FIXED
The empirical re-migration left **104 bare rows un-migrated** (Message 85, Audit 19) even after the loop reported `migrated=0` (rowsErrored=0 — the preflight "stuck-Message" class, now ROOT-CAUSED). Cause: `MigrationRunner.runKind` lists with `{limit, offset}` and **no sort** → the substrate emits no `ORDER BY` → postgres returns rows in unstable heap order; because the loop `put`s (mutates) rows during OFFSET pagination, the heap shifts and the offset window silently SKIPS ~6-7% of rows per pass; the cursor then advances past them so subsequent passes resume-skip them too → the loop terminates with bare rows remaining = silent data-loss at the strict-flip. This is a PRE-EXISTING migration bug (would have under-migrated at every run, incl. 2026-05-25).

**FIX (this PR):** `runKind` now lists with a stable `sort:[{field:"id",order:"asc"}]` — a migrated row keeps its id, so the order is stable under in-loop mutation → every row visited exactly once. **VALIDATED:** with the fix, a single productive pass migrated ALL 1,491 bare rows, 0 errored, **0 bare outside exemptions** (the strict-flip gate). FILE AS A NEW BUG (architect to assign — call it the runKind-offset-skip / stuck-Message root-cause).

## E4 — Re-migration TIMING (real data, fixed runKind) — MARGINALLY OVER the <60s budget
Measured on the clone: reset + loop-migrate-until-0 = **~40s wall-clock** (1 productive pass migrating 1,491 + 1 confirm pass; 0 errored; 0 bare after). Composite downtime estimate: pg_dump (~20s) + re-migrate (~40s) + SQL verify (<1s) + runbook bookends (~15s) ≈ **~66-75s — OVER the <60s budget** (the 9-days bare-write growth: 1,488 bare now vs preflight's 686 migrated). Pre-fix, the reset-before-each-pass workaround was ~80s+; the fix nearly halved it but it remains over budget. **DECISION NEEDED before GO:** (a) the §R11 parallel-per-kind lever (held in reserve); (b) deploy W4 first to stop the bare-writers, let the backlog migrate incrementally, then a small cutover; (c) accept ~70s downtime. The re-migration is now CORRECT (no data-loss) regardless of which.

## E5 — bug-151/152 liveness — CORRECTED to LATENT (my earlier code-reasoning overclaimed)
Empirically: **0 scheduled-Messages pending**; **653 envelope threads but 0 ACTIVE**; **13 envelope teles but 0 active** → **0 currently-affected rows**. The code-gaps (bug-151/152, fixed in W4/W5) are real but no live data is in the affected state — threads have been converging throughout the mission (the reply path works on prod's envelope threads). My §4 "prod IS broken today" was an overclaim; the empirical check corrected it to "latent — 0 currently-affected; the fixes prevent the bugs when the affected states recur." This LOWERS the go-urgency from bug-151/152 — the REAL active risk was the two data-loss bugs (E2/E3), now fixed.

## E6 — Strict-flip gate + exemptions (real data) — MET
With both fixes, the re-migration converges to **0 bare rows outside the exemption set** (MigrationCursor 22, by-design; SchemaDef 0 — the W1 boot-put fix holds, confirmed no bare SchemaDef). The §3.2-step-4 verification (zero-legacy-outside-exemptions) passes on real data.

## E7 — Rollback
The 12.3MB read-only snapshot IS the abort restore-path. `resetAllCheckpoints` leg tested; `pg_restore` leg is standard (data-only restore into the clone succeeded — 25,240 rows).

## Net
The empirical run was decisive: it caught a SECOND silent-data-loss bug (offset-skip, E3) beyond the dirty-cursor trap (E2) — both would have lost rows at the cutover — and surfaced that the downtime budget is now exceeded. Both data-loss bugs are FIXED + validated on real prod data. The remaining GO blocker is the downtime-mitigation decision (E4).
