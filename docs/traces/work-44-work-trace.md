# work-44 work-trace — Arc-B slice 1: bug-190 (A)+(d) repo-event-bridge poll+deliver coupling

**Owner:** greg (engineer). **Arc:** Arc-B (PR/event/orchestration). **Verify:** lily adversarial-verify (cal #98).
**Structure:** ONE work-item, 2 PRs (architect-greenlit split). complete_work on PR-2's merge (bind both PRs + failure-injection test-run).

## The 2 defects (ground-truthed)
- **(a)** poll-source.ts pollOnce (~314-360): events `push`'d to the internal queue, then markSeen + writeCursor(etag) advance — cursor advances on ENQUEUE, before delivery.
- **(b)** hub/src/policy/repo-event-handler.ts `RepoEventBridge`: `drainTasks = [drainSource(pollSource), drainSource(workflowRunPollSource)]`, fire-and-forget (awaited only in stop()). `drainSource` (205-224): `for await(ev of source){ try{sink.emit}catch{LOG+continue} }` → a sink failure is logged + the event DROPPED (cursor already advanced = silent loss); if the iterator throws, the drainer returns (no restart).

## (A)+(d) fix (ratified) — split into 2 PRs
- **PR-1 (this) = de-dup, BEHAVIOR-PRESERVING.** PollSource (ETag-conditional+filterUnseen) + WorkflowRunPollSource (timestamp-window+pagination+LRU) are STRATEGY-different but share the whole lifecycle + pollOnce skeleton → extracted as a template-method `BasePollSource` (base-poll-source.ts). Sources supply strategy hooks: fetchEvents (fetch + empty-semantics + a commit closure), idOf, translate, hydrateCursor, createState. The EMIT-loop + COMMIT-ORDER live in the base → PR-2's (A) coupling lands ONCE.
  - FAITHFUL to the empty divergence: PollSource-200-empty → {events,[]} (runs filterUnseen, matches); WorkflowRun-empty → {no-events} (skips filterUnseen, matches) — no dedupe-token drift.
  - GATE = behavior-preservation: both source suites GREEN 27/27 (unchanged — exercise pollOnce + iterator); full package 146/146; tsc clean (package + hub); 971→752 lines (−219 dup). Two-loop model UNCHANGED.
- **PR-2 = the (A)+(d) coupling.** On the shared base: emit-via-sink-INLINE in the poll loop; advance markSeen+cursor ONLY on DELIVERED (post-retry failure → cursor UNadvanced → next poll 304→200 re-fetches+re-emits = auto-recovery; poll-loop backoff = supervision). DELETE the queue/iterator + drainSource/drainTasks. (d) wire sink-delivery health → /health. (A) rationale in the PR. The 3 faithful real-failure-injection tests (mutation-non-vacuous): (i) advance-anyway→event-lost→fails; (ii) remove-survive→loop-dies→fails; (iii) health-unhealthy-on-persistent-delivery-failure. + the cursor-gated-ONLY-on-delivery invariant + no-silent-failure-BY-CONSTRUCTION.

## Architecture decision (greenlit)
SPLIT (not 1 atomic PR): the atomicity is the COUPLING (PR-2 atomic); PR-1 leaves the known-buggy two-loop behavior UNCHANGED → safe refactor, no broken intermediate state. De-risks + concentrates the verify on PR-2's semantic diff. Template-method (not flat-config) because the sources are strategy-different (cal #85).

## Closeout — DONE (2026-06-29)
- **PR-1 #429** (de-dup → BasePollSource, behavior-preserving) merged `17b54b2`.
- **PR-2 #430** ((A)+(d) coupling) merged `db2e64e` (squash). **Prod-VERIFIED LIVE** (not just merged): lily confirmed `/health` gitSha flipped to `db2e64e` + the new `repoEventBridge` delivery-health block is live (`paused:false, deliveryFailing:false`). Auto-deployed via watchtower (deploy-hub.yml → :latest → roll → /health roll-confirm; merge = the single prod-write — the "manual/non-functional" note was stale, watchtower re-verified live).
- **steve verifier-gate:** PASS/APPROVED @ `1d8543a` (review 4588267237, audit-5024). FI-1/FI-2/FI-3/M4 mutation probes confirmed NON-VACUOUS on the gated head. Two CHANGES_REQUESTED blockers cleared: (1) /health delivery-health exposure (`5b63859` — lazy `repoEventBridgeHealth` getter index.ts → hub-networking.ts + health-endpoint.test 5/5); (2) full doc-scrub of the removed async-iterator/queue/drainer prose to the inline-sink reality — README + 4 module headers (`b030aff`) + `docs/webhook-source-design.md` (`1d8543a`, the docs/ surface the first grep missed; defect-class-scope lesson: widen the grep to the whole package). Architect bilateral approval: lily review 4588271257.
- **complete_work** bound `{ pr → #430/db2e64e, tests → FI mutation test-run @1d8543a, review → steve 4588267237/audit-5024 }` → **work-44 done → bug-190 CLOSED → Arc-B slice 1 DONE.** (Dogfood: idea-384 Part-A recorded the in_progress bucket at ~9.89M ms — per-FSM-state timer live on the prod substrate.)
- **Next:** HOLD per the Director-directed wind-down — no new arc work; not claiming off the idle-wake digest; standing by for the Director.
