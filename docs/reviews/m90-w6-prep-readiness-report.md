# mission-90 W6-PREP — Cutover Readiness Report (task-420)

**Engineer:** greg · **Date:** 2026-06-19 · **Branch:** `agent-greg/m90-w6-prep-cutover-readiness` (off `428db4c`)
**Posture:** CLONE-ONLY / ZERO prod-touch. **The cutover EXECUTION (Hub-stop → re-migrate prod → strict-flip → manual IAP-SSH redeploy) is the Phase 7 Release GATE — DIRECTOR-GATED. Nothing in this prep touched prod.**

This report is the readiness EVIDENCE the architect surfaces to the Director for the cutover-go.

---

## Verdict: CONDITIONAL-GO — mechanism READY; one empirical step + the gaps-now-fixed need final sign-off

The W6 re-migration tooling + the shadow-read parity gate mechanism are BUILT and self-validated on synthetic clones. Self-review surfaced that the §3.2 dirty-cursor-trap mitigation was **specified but never wired into the cutover path** — now fixed. The remaining hard requirement is the **empirical run on a real prod snapshot** (count parity + timing + stuck-Message-40 forensics), which is a Director-gated prod-touch (snapshot acquisition) — see §7.

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
| 9 | bug-151/152 prod-liveness | ✅ ANSWERED (code+repro): prod IS broken today | see §4 |

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
