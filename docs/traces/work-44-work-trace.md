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
