# mission-90 W8 — Decode-to-Flat Structural Close (validation + audit inputs)

**Engineer:** greg · **Date:** 2026-06-19 · **Branch:** `agent-greg/m90-w8-tolerant-retirement`
**Status:** decode-to-flat GREEN — full hub suite 1960 passed / 7 skipped, 0 failures, tsc clean (from 193 failing at the faithful-harness baseline).

This is the input document for the Director-mandated adversarial audit. It enumerates (§1) the live prod-defects the read-decode closes, (§2) the decode architecture, (§3) the judgment-spots for deep review, and (§4) bug-146.

---

## §0 — What W8 is

W8 retires the envelope dual-shape. The faithful test-migration (the test substrate now stores ENVELOPE like prod, via the memory factory-default-envelope + testcontainer setWriteEncoder) revealed that **bug-138's READ side was never closed**: 9+ kinds relocate fields under the K8s envelope partition, but most repos returned RAW envelope from get()/list()/CAS, so production code reading the flat domain fields silently got `undefined`/`{phase}`-object. The legacy-flat test fixtures masked this mission-wide (the calibration-#19 false-green).

**Resolution (Director-confirmed END-STATE 2):** decode-to-flat at every repo read boundary AND the CAS path → one flat domain shape above the substrate membrane. `decodeEnvelopeToFlat` (generic, renameMap+partition reverse) is the base; kinds with extra leaf-renames layer a bespoke decoder on it (the thread/tele/agent pattern). This **resolves idea-327** (output is now uniformly decode-to-flat) and **structurally eliminates bug-138** (no recurrence surface — in `hub/src`, every domain consumer reads the decoded flat shape; the audit's silent-miss sweep confirmed no above-membrane raw relocated-field read remains). **Scope:** the "consumers read flat" claim is `hub/src`; the adapter tier (`adapters/claude-plugin`) consumes the decoded MCP-tool JSON output (the Hub read tools decode), not raw substrate rows, so it is unaffected by the storage shape.

idea-327 → **incorporated** against mission-90 (alongside 318/320/324). The verified 9/9 list-FILTER parity (W7) is unaffected: decode runs AFTER the substrate filter-translate.

---

## §1 — Live prod-defects the read-decode CLOSES (the concrete bug-138-read-side impact)

Each was a real production state-machine defect, silently degraded (caught/no-op'd) and masked by legacy-flat fixtures. The faithful harness exposed them; the decode fixes them (each has a now-green proving test).

| # | Site (file:line) | Relocated field (read raw) | Prod symptom (before) | Proving test |
|---|---|---|---|---|
| 1 | message-repo allocateSequence | sequenceInThread@metadata | **every message in a thread allocated seq 0** (dup seqs / broken ordering) | message-repository.test, message-helpers |
| 2 | message-repo claimMessage / ackMessage | status@status.phase | claim & ack **always no-op** (status-bucket ≠ string) → comms claim/ack broken | message-repository, message-policy, comms-reliability |
| 3 | message-repo markScheduledState | scheduledState@status | idempotency guard never fires | scheduled-message-sweeper |
| 4 | pending-action listExpired | state@status.phase + deadlines@spec | **watchdog escalation path entirely DEAD** (empty list; NaN deadlines) | comms-reliability |
| 5 | pending-action listStuck | enqueuedAt@metadata.createdAt | **no stuck items ever detected** (NaN age) | pending-action-prune, gcs-pending-action |
| 6 | pending-action enqueue dedup | state@status.phase | fresh enqueue **reuses a stale completed/errored item** | bug-57, pending-action tests |
| 7 | pending-action receiptAck/completionAck/abandon/saveContinuation/resumeContinuation | state / targetAgentId | FSM gates mis-evaluate → settle/abandon/continuation no-op or wrongly-reject | comms-reliability, gcs-pending-action |
| 8 | pending-action incrementAttempt | attemptCount@status | `undefined+1 = NaN` → watchdog attempt-count broken | comms-reliability |
| 9 | mission markPlannedTaskIssued / markPlannedTaskCompleted | plannedTasks@spec | **planned-task slots NEVER flip; mission auto-advance never progresses** | task-316-mission-advancement, mission-pulse-schema |
| 10 | proposal closeProposal | status@status.phase | **a proposal can NEVER be closed/implemented** (all guard branches true → always TransitionRejected) | e2e-workflows, wave3a |
| 11 | task unblockDependents / cancelDependents | dependsOn@spec | **dependency unblock/cancel cascade fully broken** (preview + CAS) | task-316, e2e-workflows |
| 12 | task getNextDirective | labels@metadata | **Mission-19 label-scoped claim routing bypassed** (claimability vs `{}`); get_task response.title undefined | policy-router, mission-19/p2p, mission-19/labels |
| 13 | task submitReview | revisionCount@metadata | **3-strikes review circuit-breaker NEVER escalates** (count always 0) | e2e-review-gated, INV-T4 |
| 14 | task getNextReport | report@status | report filter ineffective; "report cleared" guard never fires | wave3a |
| 15 | task getReview | reviewAssessment/reviewRef@status | **always returns null** | wave3a |
| 16 | turn hydrate | title@metadata.name, status@status.phase, scope@spec | turn.status emitted as `{phase}` object; turn.title undefined in responses | wave2 |
| 17 | dispatchTaskSpawned (cascade) | directive@spec (+ correlationId/dependsOn/sourceThreadId) | **`task.directive.substring` CRASH** → silent task_issued dispatch-degrade (the bug-146 dispatch-half) | wave3b, e2e-convergence-spawn, e2e-fsm-enforcement |

These are not test artifacts — they are live defects fixed by the decode membrane. (Whether any warrant individual ledger bug-entries is a retro decision per the architect; not proliferating mid-execution.)

---

## §2 — Decode architecture

- **Generic base — `decodeEnvelopeToFlat` (hub/src/entities/shape-helpers.ts):** flattens metadata/spec/status partitions to top-level (leaf-preserving), maps status.phase→top-level `status` string, strips envelope artifacts (kind/apiVersion/phase/name), and surfaces the cascade `sourceThreadSummary` annotation. Exact for the 5 leaf-preserving-except-status kinds: Task / Idea / Bug / Mission / Proposal.
- **Bespoke decoders (generic base + extra leaf-renames the generic can't reverse):**
  - Message: `kind ← metadata.messageKind` (the §1.7 collision-rename).
  - PendingAction: `state ← status.phase`, `enqueuedAt ← metadata.createdAt`.
  - Turn: `title ← metadata.name`.
  - Audit: `timestamp ← metadata.createdAt`.
  - Document: `category ← metadata.labels.category` (nested in the K8s labels map).
  - Notification (`event ← spec.eventType`, `timestamp`), ArchitectDecision / DirectorHistory / ReviewHistory / ThreadHistory (`timestamp`).
  - Thread / Tele / Agent: KEPT bespoke normalizers (normalizeThreadShape / normalizeTele / normalizeAgentShape) — extra domain logic (convergenceActions / proposer-shape / participants); NOT regressed.
- **Application:** every repo decodes at get/list/findBy* AND in its casUpdate/tryCasUpdate (so transforms operate on flat + the write-encoder re-envelopes on put). idea/bug derive `tags` from the metadata.labels map (cluster-1 array↔map) at the boundary.
- **Test-harness faithfulness:** the memory substrate now defaults to envelope-encoding (`createMemoryStorageSubstrate`; `{rawWrites:true}` opt-out for substrate-PRIMITIVE/conformance tests) + testcontainer repo tests wire setWriteEncoder — so tests store the prod shape (kills the legacy-flat false-green footgun).

---

## §3 — Judgment-spots for the adversarial audit (highest scrutiny: CAS + FSM guards)

- **19 CAS transforms** now decode `existing.entity` → flat before the transform (decode-once in the shared casUpdate/tryCasUpdate per repo): Task (unblockDependents, cancelDependents, getNextDirective, submitReport, getNextReport, submitReview), Mission (updateMission/pulses, markPlannedTaskIssued, markPlannedTaskCompleted), Proposal (closeProposal), Message (claimMessage, ackMessage, markScheduledState), PendingAction (receiptAck, completionAck, incrementAttempt, abandon, saveContinuation, resumeContinuation).
- **6 bespoke-decoder design decisions** (§2) — verify each reversal is exact vs the kind's renameMap.
- **Task renameMap completeness** — added createdAt/createdBy/updatedAt (psql-verified they live in metadata on real prod Task rows — no location-mismatch, pure filter/sort/decode fix).
- **PATTERN-G test updates** (assert correct-strict, not made-green): shape-helpers test repointed to the 2 survivors (phaseFromEntity + decodeEnvelopeToFlat, both directly unit-tested); substrate-counter.race — a **~5-line update** (one legacy-flat counter-read fixture → envelope `status.counters`), NOT a wholesale rewrite; memory-substrate matchesFilter fixtures → envelope-shaped; removed the obsolete legacy-flat findByCascadeKey dual-lookup test (envelope path covered by bug-repo + cascade tests); renameMap-contract Task expected updated.

**Helper-deletion (END-STATE 2 final step) — DONE, architect ruling (A):** deleted `fieldFromEntity`/`tagsFromEntity`/`arrayFieldFromEntity` (the latter two had zero live importers); swapped the ~29 policy accessor call-sites (idea/mission/task/thread) to direct flat access — entities guaranteed-flat post-repo-decode, validated by the testcontainer layer-B accessor sweep against real envelope rows. `phaseFromEntity` KEPT: it is the decode-mechanism the decoders + kept normalizers call BELOW the membrane, AND it is reused ABOVE the membrane in the policy status-accessors + a handful of CAS callbacks for a graceful status read — safe per (A) (the entity is flat there, and it degrades gracefully on a stray `{phase}`), so it is NOT a dual-shape recurrence surface even where reused.

---

## §4 — bug-146 (dispatch-half)

The envelope-read crash in dispatchTaskSpawned (`task.directive.substring` on a spec-relocated field) was silently degrading task_issued dispatch mission-wide (caught → poll-recovery) — the reason we leaned on thread-dispatch-equivalence. The decode fixes it: e2e-fsm-enforcement 22→0 failing; mission-19 p2p/labels (label-scoped claim routing) + e2e-workflows (cancel cascade) green. Task dispatch + claim + label-routing now work end-to-end at the test level. The caller-login-labeling axis is to be confirmed dispositively at the post-deploy LIVE audit.

---

## §5 — Audit response (gaps closed; the deep audit found ZERO blockers)

The deep adversarial audit verified the core SOUND (all 19 CAS decode-before-transform, every relocating domain kind decodes at its membrane, the 3 helpers gone, the anti-false-green core holds, Task createdAt/createdBy leaf-preserving → no old/new-row mismatch — the data-location caveat was refuted). It returned 2 major gaps + 5 minors + an adapter-scope note, all addressed here (tighten-and-close, not redo):

- **MG1 — sweeper skeletons + overstated claim.** 4 unwired `*-sweeper-substrate.ts` files (pulse / cascade-replay / scheduled-message / message-projection) were mission-83 W3.x SPIKES ("minimal substrate-API skeleton", stubbed business logic) that read relocated fields off RAW envelope rows. They were NOT live (index.ts wires the FS-version decoding-facade sweepers; the planned "W5 cutover swap" never happened) and only self-tested. **DELETED** all 8 files (4 impl + 4 test) — this is the cleanup wave; a future substrate-native sweeper (idea-300) builds complete envelope-aware ones, not these broken stubs. The §0 "consumers read flat" claim is now scoped to `hub/src` (+ the adapter note).
- **MG2 — postgres-path decode coverage hole (message/turn/agent/audit).** Those 4 repo testcontainer tests built `createPostgresStorageSubstrate` with no encoder/translator → seeded legacy-FLAT → flat→flat passthrough → the envelope→flat decode was never exercised on the real Postgres-JSONB path (PROD is postgres). **Wired `setFieldTranslator` + `setWriteEncoder(buildEnvelopeWriteEncoder())`** into all 4 (mirroring the W8 idea/mission/proposal fix) so they seed ENVELOPE + exercise the real decode (incl. Message `kind↔messageKind` collision + Turn `title` pre-flatten). All pass — no postgres-specific divergence.
- **m1** — report + shape-helpers wording scoped: `phaseFromEntity` is the below-membrane decode-mechanism AND is reused above the membrane (policy status-accessors + CAS callbacks), safe per (A) (see §3).
- **m2** — `decodeEnvelopeToFlat` now `delete flat.annotations` after lifting `sourceThreadSummary` (the K8s annotations map no longer leaks onto the flat shape).
- **m3** — substrate-counter.race corrected to a ~5-line update (not a wholesale PATTERN-G rewrite) (§3).
- **m4** — added a dedicated positive-proof test for `incrementAttempt` (attemptCount 0→1→2, asserts NOT NaN, persisted + re-read) — the watchdog NaN-class fix.
- **m5** — trimmed the stale `fieldFromEntity` mentions from the 4 policy comment-blocks (grep-ghost removed).
- **adapter note** — the audit was `hub/src`-scoped; the adapter tier reads decoded MCP-tool JSON output (no raw-substrate refs), so the claim holds there; report claim scoped to `hub/src` regardless.
