# Mission-49 M-Audit-Notification-Repository-Migration — Architect Retrospective

**Status:** engineer-side complete (3 tasks shipped on the working tree); PR open + merge cadence pending; architect-side mission-status flip gated on PR merge.
**Authored:** 2026-04-25 post-T3 landing. For Director discussion next session.
**Provenance:** mission-49 follows mission-47's wave pattern as W8+W9 continuation; design round in thread-304 with Director-ratified β sequencing on 2026-04-25.

---

## 1. What shipped

**3 tasks shipped same day** as mission-47. Mission-49 is the W8/W9 continuation that closes the entity-store migration arc opened by mission-47.

| Task | Scope | Outcome |
|---|---|---|
| task-350 | T1/W8 — AuditStore → AuditRepository | Approved |
| task-351 | (cascade misfire — duplicate of T1) | Approved as duplicate-detection per bug-31 workaround |
| task-352 | T2/W9 — NotificationStore → NotificationRepository | Approved |
| task-353 | T3 — Closing audit + engineer-side hygiene | Approved |

**Architectural deliverables:**
- `hub/src/entities/audit-repository.ts` — counter-based unpadded `audit-${N}` IDs via `StorageBackedCounter`; writes to `audit/v2/${id}.json`; 20 cross-provider tests
- `hub/src/entities/notification-repository.ts` — ULID IDs preserved; `notifications/v2/` namespace preserved byte-identically; 22 cross-provider tests
- `MemoryAuditStore` + `GcsAuditStore` + `MemoryNotificationStore` + `GcsNotificationStore` — all four legacy classes deleted
- `IAuditStore` + `INotificationStore` interfaces preserved; consumers untouched
- ADR-024 unchanged (contract held)
- Closing report at `docs/audits/m-audit-notification-repository-migration-closing-report.md`
- `deploy/README.md` §Hub GCS state layout — archaeology pointers for legacy + v2 namespaces

**Quantitative outcomes:**
- Hub test suite 748/753 pass (was 706/711 pre-mission-49) — +42 tests, 0 regressions across 9 (W1-W9) entity-store migrations end-to-end
- Net production code: −186 LOC (deletion of dual-implementation overhead exceeded new repository code)
- Net test code: +655 LOC across 4 new files
- Zero behavioral regressions in GCS prod path
- Zero contract leaks

**Operational state at write-time:**
- All three PRs (W8, W9, T3) sit on greg's working tree as uncommitted work; no PRs opened yet
- Mission-48 M-Local-FS-Cutover blocked from activation until W8 + W9 PRs merge (inherited-verification dependency)
- Mission-49 status flip to `completed` gated on the same PR merge

---

## 2. What worked (architectural wins)

### 2.1 Contract held its 12th entity migration

The 6-primitive `StorageProvider` surface — `get / list / delete / put / createOnly / putIfMatch` with capability flags — was sufficient for two more entity migrations spanning two distinct ID schemes (counter-based for Audit, ULID-based for Notification). No primitive added; no primitive widened; no escape hatches.

This is the contract's third extended load test:
1. Mission-47 W1-W7 — 10 entity migrations, 60 CAS sites
2. Mission-49 W8 — counter-based ID with collision-class elimination via CAS
3. Mission-49 W9 — ULID-based ID with TTL/cleanup/listSince composition

The minimal-surface design (which we deliberately resisted expanding during mission-47's design round — no `watch`, no `batch`, no `incrementCounter`) continues to pay dividends. **Sovereign Composition is now empirically the dominant entity-storage pattern in the Hub** — every store except DirectorNotification (already migrated mission-47 W3) follows this shape.

### 2.2 Emergent correctness: same-ms collision class eliminated

The legacy `GcsAuditStore.logEntry` had a latent bug — same-millisecond ID collisions, with the `await createOnly(...)` ignoring the `{ok}` return so a failed write looked successful. Hadn't fired in prod (audit calls ms-spaced) but was real.

`AuditRepository.logEntry` eliminates the class structurally: the counter+CAS pattern guarantees ID uniqueness; checking `{ok}` and throwing on `false` is the natural code path, not a defensive afterthought. **Same lesson as mission-47's INV-COMMS-L03 fix** — unification produces correctness wins as emergent properties of removing duplication.

This is now the second documented "emergent correctness via repository pattern" finding. The pattern is structurally producing better code by collapsing dual-implementation drift.

### 2.3 Design round caught the scope before activation

Greg's pre-mission audit on thread-304 surfaced two material findings before any code was written:
- **Flag #1** — AuditStore + NotificationStore aren't migrated; flipping local-fs default ships durability regression
- **Flag #1b** — `NODE_ENV=production` hard-refuses local-fs; the cutover is an architectural reclassification, not a config flip

Both findings reshaped the mission scope (β split: migration mission first, cutover second; ADR-024 amendment in-scope). Same pattern as mission-47 thread-290 — engineer audit produced material contract refinements before activation.

The Idea → Design → Mission discipline keeps earning its latency cost.

### 2.4 Pattern-replication speed

Mission-49 was sized M-low (1–1.25 eng-days) at design round. Actual: ~5.5h single-session engineer time. **Pattern-replication missions consistently trend toward the lower edge of the sizing band.** Mission-47 W1-W7 also outran their estimates.

Calibration data point for future repository-pattern continuations: size at S, not M-low. Design-round overhead is fixed cost; per-wave execution time drops as the pattern beds in.

---

## 3. What broke (process + workflow failures)

### 3.1 Cascade-bookkeeping bugs (bug-31 + amendment)

Two distinct cascade-bookkeeping anomalies on a single mission:

**Variant 1 (manual-create + cascade-duplicate):** I manually issued task-350 for plannedTasks[0] via `create_task`. On approval, the cascade saw `plannedTasks[0].status="unissued"` (since manual create_task doesn't bind to a plannedTask slot) and auto-issued task-351 as a duplicate. Greg caught via defensive duplicate-detection.

**Variant 2 (timeout-disrupts-atomicity):** My `create_review` for task-352 hit an MCP client-side timeout. The review write persisted (verified — task status went to `completed`, reviewAssessment populated). But the cascade side-effects — flipping plannedTasks[1] to completed and auto-issuing plannedTasks[2] T3 — did not run. ~7+ minutes elapsed with no self-healing. I worked around by manually issuing T3 as task-353 (Director-approved, accepting bug-31 trap risk).

**Combined finding:** the cascade-advancement path has at least two atomicity gaps:
- Manual-create-vs-cascade-issue mismatch (no binding mechanism)
- Review-write-vs-cascade-side-effects transactionality (no retry/replay trigger)

bug-31 captures both variants. Severity stayed minor on this mission (engineer caught variant 1, architect caught variant 2 via direct bookkeeping audit, Director was in-session for the manual-issue workaround). But the frequency — two events on a single mission — escalates priority. **Recommend Director consider promoting bug-31 to major if it recurs on mission-49 PR-merge close or mission-50.**

### 3.2 PR cadence drift (still)

Mission-47 retrospective §3.1 captured the stacked-PR-merge-cadence drift as a calibration commitment ("merge cadence is n commitments, not one"). Mission-49 made it worse: at T3 ship time, **all three tasks' work sits uncommitted on greg's working tree**. No PRs even opened, let alone merged.

This is structurally worse than mission-47's stacked-PR case because:
- Mission-47 had open PRs awaiting merge — visible state, recoverable
- Mission-49 has uncommitted code on a working tree — invisible to anyone but greg

Calibration commitments from mission-47 didn't hold in mission-49. The 5-min architect-ping rule wasn't operationalized until I caught it in T3 review. **Discipline drifted again under cadence pressure** — exactly the meta-pattern mission-47 §3.1 named.

**Cause:** I didn't track outstanding PR state per task. I trusted the mission-47 retrospective commitments would propagate. They didn't. I needed to ask "is W8 PR open and merged?" at task-352 review time, not at T3 review time. The 5-min ping rule remains aspirational; the operational habit isn't formed.

This is the same root cause class as the cascade-bookkeeping bugs in §3.1 — workflow primitives don't exist; humans-in-the-loop fill the gaps; humans drift. **idea-191 (GH event bridge) + idea-192 (Hub triggers + inbox) priority reinforced.** The structural fix is the only durable fix.

### 3.3 Mission-status flip blocked on operational state

Conceptually mission-49 is engineer-side complete (3 tasks shipped + reviewed; closing report landed; deliverables met). Operationally it can't close because the work isn't merged. The mission-status flip is gated on PR merges, not on Hub-tracked task completion.

**Lesson:** task `completed` status doesn't equal "shipped to main." The Hub-side bookkeeping and the GitHub-side reality drift, and the architect's mission-flip-to-completed call is the bridge. Until mission-191 (GH event bridge) closes that gap, this is permanent overhead.

For mission-49 specifically: I'll flag explicitly to Director that I'm holding the flip pending PR merges, and surface PR state at next checkpoint. Mission-48 cannot activate until this resolves.

---

## 4. Empirical findings worth strategic discussion

### 4.1 ADR-024 contract validated across 12 entities

Two extended load tests, three ID schemes, 60+ CAS sites, zero contract changes. The 6-primitive surface is now empirically robust.

This validates one of mission-47's anti-goals — "NOT expanding the StorageProvider contract" — held across a second mission. **Contract minimalism is not just a design ideal; it's now an empirical pattern.** Future sovereign packages should adopt the same discipline: minimum viable contract, expand only when a real consumer demands it.

### 4.2 Pattern-replication sizing calibration

Repository-pattern missions consistently size lower than initial estimate:
- Mission-47 W1-W7: 4-5 eng-days estimated, ~1 day actual
- Mission-49: M-low (1-1.25 eng-days) estimated, ~5.5h actual

**Calibration:** when a mission is "apply pattern X to N entities," size at S (or less) per wave. Design-round overhead is fixed; per-wave cost is genuinely small once the pattern beds in.

### 4.3 Workflow-primitive gap is now load-bearing on every mission

Mission-49 surfaced two cascade-bookkeeping bugs, one PR-cadence drift, and one architect-mission-flip operational gap — all classes the workflow-primitives missions (idea-191 + idea-192) would close. The workflow primitives aren't a "nice to have"; they're now the primary friction limiting mission velocity.

**Strategic implication:** prioritize idea-191 + idea-192 design rounds aggressively after mission-49 + mission-48 close. Each mission shipped under current workflow burns ~10–15% of architect+engineer cycle time on bookkeeping correction, escalation drafts, and stall recovery.

---

## 5. Ideas filed or reinforced this mission

- **idea-195** (O(N) cleanup optimization) — filed by greg per design-round agreement. Range-scan via timestamp-prefixed keys can replace the read-scan-and-filter pattern. Out of mission-49 scope; sized as future small mission.
- **bug-31** (cascade-bookkeeping divergence) — filed during mission with two variants observed. Class: cascade-bookkeeping. Severity: minor (for now).
- **idea-191** (GH event bridge) — priority reinforced. PR-merge-state being invisible to Hub is now a recurring friction class.
- **idea-192** (Hub triggers + inbox) — priority reinforced. Cascade-atomicity gaps would be addressed by transactional state-transition triggers.

---

## 6. Points for Director discussion next session

Ordered by my opinion of importance:

1. **PR merge state on mission-49.** Greg needs to open W8 + W9 + T3 PRs and get them through merge. Mission-48 activation depends on it. Worth a direct check-in if greg's session ended without the PRs opened.

2. **bug-31 priority.** Two cascade-bookkeeping anomalies on a single mission is a meaningful frequency. Promote to major if it recurs on mission-49 close cadence (PR-merge → mission-status flip path) or on the next mission. Currently `minor / open`.

3. **Workflow-primitive priority sequencing.** With mission-49 closing the storage-provider arc, idea-191 + idea-192 are now the dominant friction. Confirm β split sequencing still holds (mission-48 cutover first, then primitives), or pivot to primitives-first if cascade-bookkeeping continues to bite.

4. **Mission-49 close mechanics.** Once PRs merge, I write the architect-side mission-status flip. If cascade-bookkeeping anomaly recurs there too, we'll need a manual-flip + bug-31 escalation path.

5. **Pattern-replication sizing.** Calibrating future repository-pattern continuations to S not M-low. Worth applying to any future "apply pattern X to N entities" mission shape.

---

## 7. What I'd do differently (architect self-critique)

- **Tracked PR state per task, not just per mission.** Mission-47 retrospective committed to "merge cadence is n commitments." I didn't operationalize a per-task PR-state check — should have asked "is W8 PR merged?" at task-352 review time, not at T3 review time. Adopting: at every report review, confirm-or-flag PR state for prior task in the same mission.
- **Avoided manual create_task on activation.** I issued task-350 manually at mission-49 activation; this triggered bug-31 variant 1. Lesson saved as memory; future missions: don't manual-create when plannedTasks exists. Either coordinate via thread or wait for cascade-recovery (whatever the right path is post-bug-31 resolution).
- **Verified cascade advance after each review.** Bug-31 variant 2 (the timeout) sat undetected for ~7 minutes because I assumed cascade had fired. Adopting: after every approve, confirm `mission.plannedTasks[N].status` advanced before moving on.
- **Surfaced uncommitted-work-on-tree earlier.** Greg's task-352 report mentioned "stacked together on working tree" — I flagged it as a calibration check, not a blocker. By T3 it was three pieces of uncommitted work. Adopting: any mention of "uncommitted on working tree" is a hard blocker on next-task-issue, not a soft flag.

---

## 8. What went surprisingly well (architect's honest take)

- **Greg's defensive duplicate-detection.** task-351 was a Hub bug. Greg caught it cold via title+correlationId+scope match against task-350, cross-walked the full requirement-to-deliverable map, and declined to redo the work. Saved a duplicate PR and surfaced bug-31 cleanly. This is engineer behavior that *makes architect mistakes recoverable* — exactly the right defensive posture.
- **Speed.** 3 tasks + closing report in one session. Mission-47-pattern execution is now a polished discipline.
- **No contract drift across the second extended load test.** This is the strongest possible validation of the original ADR-024 design choices. The 6-primitive surface continues to be sufficient.
- **Director in-session throughout.** Different cadence than mission-47 (intermittent Director engagement). Continuous Director presence enabled the β-split call to happen during the design round, the bug-31 workarounds to be approved in real-time, and the cascade-stall manual-issue to land without delay. Worth carrying forward as a session-pattern preference for fast missions.

---

## 9. Mission-49 closing state — final

- Engineer-side work: **complete** (3 tasks shipped + reviewed + approved; closing report + deploy/README addition delivered)
- PR cadence: **complete** — PR #21 (W8) merged at `19997cc`, PR #22 (W9) merged at `60654f8`, PR #23 (T3) merged at `3fcb19a`
- Architect-side retrospective: **this document** (complete)
- Architect-side mission-status flip: **complete** — mission-49 → `completed` 2026-04-25
- Mission-48 M-Local-FS-Cutover: **activation-ready** (inherited-verification dependency satisfied)

## 10. PR-cadence calibration (post-merge addendum)

Director directed me 2026-04-25 to take direct ownership of PR + closure coordination on this mission rather than holding for escalation. Result: 3 PRs from open to merged in ~9 minutes wall-clock under thread-305 coordination with greg.

Per-PR turnaround (open → CI complete → architect approve+merge):
- PR #21 (W8): ~3 min, with ~5 min added for first-occurrence triage of bug-32 cross-package CI debt
- PR #22 (W9): ~3 min, no triage (pattern known)
- PR #23 (T3): ~3 min, no triage (pattern known)

**Carries forward as calibration data:**
- Manual PR cadence is fast enough when both architect + engineer are in-session and CI debt is pre-classified — the recurring bug class is the bottleneck, not the architect-merge step
- First-PR-of-mission triage cost (~5 min) is non-trivial; **classifying CI debt as a bug as soon as it surfaces is high-leverage** (subsequent PRs ride pre-classification for free)
- Auto-merge would have removed ~15s × 3 of architect manual-merge work; trivial save vs the triage time. idea-191/idea-192 obsolete the pattern entirely

**bug-32** (`ci-architecture` class, severity major) captures the pre-existing cross-package CI failures (network-adapter / claude-plugin / opencode-plugin red on every PR; umbrella `test` job rolls up to success via `if: always()` masking the matrix failures). Two distinct failure modes documented:
- `MemoryEngineerRegistry is not a constructor` — stale cross-package import (mission-47 W7b deletion never propagated to network-adapter test-hub helper)
- `Cannot find package '@google-cloud/storage'` — same pattern as mission-47 retrospective §3.3 trap #1 (cross-package source imports pull deps that don't resolve)

This is the biggest CI-side friction class on every PR review and deserves its own focused mission alongside idea-191/idea-192 (workflow primitives) — recommend Director consider both bug-31 (cascade-bookkeeping) and bug-32 (CI architecture) for priority sequencing in the next strategic-review pass.

---

*Mission-49 closed 2026-04-25. For Director discussion next session.*

---

*For discussion next session.*
