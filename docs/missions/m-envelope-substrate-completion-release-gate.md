# mission-90 (M-Envelope-Substrate-Completion) — Phase 7 Release-Gate

**Authored:** 2026-06-20 / lily (architect; agent-40903c59)
**Surfaced to Director for:** `update_mission(missionId="mission-90", status="completed")` per RACI — **CONDITIONAL on the post-deploy LIVE audit clearing** (see §6; redeploy in flight at authoring).
**Branch:** `agent-greg/m90-w8-tolerant-retirement` — all waves merged to `main`; W8 HEAD `7550cfd` (PR #323).
**Production state (updated 2026-06-20):** W8 is **LIVE on prod** — image `sha256:0294ddc`, **watchtower auto-deployed** on the `build-hub.sh` push to AR `:latest` (~40s after push; NOT the manual IAP-SSH path the original runbook described — see the watchtower correction in the cutover runbook topology + Design §4). Boot clean: `envelope substrate: STRICT`, reconciler 23/23 (0 failures), 71 tools, relay listening, 0 boot errors. Rollback target = pre-W8 `sha256:267548d7` (edc4792-era). The **read-side live-audit is GREEN** (§6); the behavioral dispositive checks are running (Director chose the full set).

---

## Mission outcome — PRIMARY OBJECTIVES HIT

### bug-138 (+ bug-137 class) STRUCTURAL CLOSURE ✅

Originating concern (idea-323): substrate filter-translation + entity-read silent-failure — Hub consumer code reading a relocated field off a raw K8s-envelope row got `undefined` / a `{phase}` object, silently degrading list-filters, FSM guards, and CAS transforms. No error surfaced; the cascade `try/catch` masked it (degrade-then-poll-recover).

**Architectural change delivered — ONE flat shape above the repo membrane:**
- **Filter-side (W2/W3):** `renameMap` promoted to a first-class runtime `SchemaDef` field; the substrate translate-point + the policy-layer FieldAccessor sweep made all 9 list tools filter-correct on the envelope path. Verified live post-cutover: 9/9 list-tools parity vs the psql oracle (W7).
- **Read-side decode (W8):** every repo decodes envelope→flat at `get`/`list`/`findBy*` **and** inside `casUpdate`/`tryCasUpdate` (transform on flat → write-encoder re-envelopes). Generic `decodeEnvelopeToFlat` (renameMap+partition reverse) + bespoke decoders for the leaf-rename kinds. The W3-era above-membrane dual-shape readers (`fieldFromEntity`/`tagsFromEntity`/`arrayFieldFromEntity`) deleted; `phaseFromEntity` kept as the below-membrane decode-mechanism.
- **No recurrence surface:** `SUBSTRATE_ENVELOPE_TOLERANT` retired (W8); storage is envelope-only; nothing above the membrane sees envelope.

**`renameMap` is now the single field-translation authority** — write-ENCODE + filter-TRANSLATE + read-DECODE all derive from it. A new relocated field needs only its renameMap entry. This is the saga close: mission-88 (K8s-envelope) → mission-89 (OCC) → **mission-90 (completion)**.

### Live prod-defect class discovered + fixed ✅

The W8 faithful test-harness migration (test substrate now stores envelope like prod) exposed that the read-side gap had been causing **live production state-machine defects**, silently degraded since the envelope migration, masked by the cascade `try/catch`. The decode-before-transform fix closes them (each with positive-proof tests over a real Postgres testcontainer):
- **3-strikes review circuit-breaker** never escalated (`revisionCount` @ metadata → always 0).
- **Mission auto-advance** never progressed (`plannedTasks` @ spec → slots never flipped).
- **Proposals could never close** (status-bucket read raw).
- **PendingAction watchdog** escalation dead (`attemptCount` → NaN; `listExpired` ineffective).
- **Message sequence** always 0 (`sequenceInThread` read raw).

### bug-146 dispatch-half fixed ✅

`dispatchTaskSpawned` crashed on `task.directive.substring` (a spec-relocated field) → silent task-dispatch degradation mission-wide → the reason coordination leaned on the thread-dispatch-equivalence workaround. The decode fixes it: e2e-fsm-enforcement 22→0, label-routing + cancel-cascade green. End-to-end live confirmation (and the caller-login-labeling axis) is the live-audit's job (§6).

---

## Wave-by-wave delivery summary

| Wave | Delivery | Merge |
|---|---|---|
| Design | v1.1 → v1.3 (renameMap = complete field-movement authority; 8-wave plan; preflight GREEN) | #311 / #312 / #315 |
| **W1** | `renameMap` runtime contract + SchemaDef boot-put envelope-correctness; testcontainer boot-proof | `0ba9707` (#313) |
| **W2** | substrate translate-point + COMPLETE relocation authority (49 entries / 21 kinds); sentinel-probe faithfulness oracle; bug-147 fix | `483cbf4` (#314) |
| **W3** | Layer-B FieldAccessor sweep (`fieldFromEntity` accessor bodies) — 9 list tools envelope-correct | `b63a1d6` (#316) |
| **W4** | repo/sweeper/watch envelope-native + CLOSE ALL bare-writers (`setWriteEncoder` chokepoint); decoders for Thread/Tele; idea-324 | `aa06501` (#317) |
| **W5** | idea-318 reconciler status-write loop (converge-then-stop + spec-equality guard + index-failure surfacing) | `428db4c` (#318) |
| **W6-prep** | empirical run on a prod snapshot — caught + fixed 2 latent silent-data-loss classes (bug-154 dirty-cursor, bug-155 offset-skip) before the strict-flip | `4dd22c3` (#319) |
| **W6 cutover** | re-migration + envelope-only STRICT flip on live prod (2026-06-19); runbook | image `f02a9bb`; runbook `2173d6e` (#320) |
| **W6 hotfix** | bug-158 — `MISSION_ACCESSORS` envelope-blindness exposed live by the strict flip; fast-track redeploy | `9f579f6` (#322); image `edc4792` |
| **W7** | post-cutover validation — 9/9 list-tools live parity + ledger parity (idea-325 unblocked); code-only-redeploy runbook class | `cd89a23` (#321) |
| **W8** | decode-to-flat structural close (idea-320 FINAL) — ~9-repo read+CAS decode, helper deletion, the prod-defect fixes, idea-327 incorporated; CLAUDE.md strict-only | `7550cfd` (#323) |

**Tests at W8 HEAD:** 1925 hub passed / 7 skipped; tsc clean; CI all-green.

**Absorbed ideas (retired as follow-on missions):** idea-323 (source) · idea-318 → W5 · idea-324 → W4 · idea-320 → W8 · **idea-327 → incorporated (W8 decode-to-flat resolves the output-shape question toward decode-to-flat)**.

---

## Director-mandated deep-audit trail (mission-90-specific gate)

The Director mandated a deep adversarial audit before W8 shipped ("triple check with deep audit after work done"). Executed as a 9-agent adversarial workflow on the merge-candidate, biased against a premature all-clear:

- **Verdict: ZERO blockers.** Core verified sound — all 19 CAS transforms decode-before-transform (postgres-testcontainer positive-proof on the 5 headline defects); every relocating domain kind decodes at its repo membrane; the 3 helpers deleted with zero live refs; the anti-false-green core holds (the test harness wires the envelope encoder so the real decode is exercised); Task `createdAt/createdBy` leaf-preserving (no old/new-row mismatch).
- **2 major gaps found** (which the self-report had glossed) → looped back → fixed → **re-audit clean**:
  - **MG1:** 4 unwired `*-sweeper-substrate` skeletons (mission-83 W3.x spikes, never wired — prod uses the FS-version decoding facades) read relocated fields raw, refuting the report's blanket "consumers always see flat" claim. **Deleted** (8 files, −1404 lines); claim scoped to `hub/src`.
  - **MG2:** message/turn/agent/audit repo tests seeded legacy-flat on postgres → their envelope decode was never exercised on the real Postgres-JSONB path. **Wired** `setFieldTranslator`+`setWriteEncoder` (mirrors the W8 idea/mission/proposal fix) — decode now exercised, Message collision + Turn pre-flatten pass, no divergence.
  - 5 minors + an adapter-scope note all addressed; report §5 documents the response.

The audit cycle is the Director-mandated triple-check delivering: it caught real coverage + accuracy gaps that would otherwise have shipped as "complete."

---

## Acceptance criteria

| Gate | Status |
|---|---|
| bug-138 filter-side closed network-wide (9 list tools) | ✅ (W2/W3; live-verified W7) |
| bug-138 read-side closed (decode-to-flat, all relocating kinds) | ✅ (W8; deep-audit-verified) |
| `SUBSTRATE_ENVELOPE_TOLERANT` retired; strict-only | ✅ (W6 flip; W8 deletion) |
| `renameMap` = universal encode/translate/decode authority | ✅ |
| Live prod re-migration + strict cutover executed | ✅ (2026-06-19; W6) |
| Rollback insurance (data dump + prior images) retained through stability | ✅ then released (stability-confirmed; dump shredded) |
| Deep adversarial audit clean (Director mandate) | ✅ (zero blockers; gaps fixed; re-audit clean) |
| Absorbed ideas incorporated (318/320/324/327) | ✅ |
| CLAUDE.md envelope-strict guidance | ✅ (W8) |
| W8 deployed to prod (watchtower auto-deploy, image `0294ddc`, boot clean) | ✅ (2026-06-20) |
| Post-deploy **read-side** live-audit (9/9 parity + decode-to-flat on real prod data) | ✅ GREEN (§6) |
| Post-deploy **behavioral** dispositive checks | ✅ as-feasible (§6): bug-146 (both axes) + proposal-close + message-seq LIVE-PASS; 3-strikes / auto-advance / watchdog testcontainer-proven, live-blocked by bug-159 (a tooling gap, not a fix defect) |

---

## §6 — Deploy + post-deploy LIVE audit

**Deploy — DONE (2026-06-20).** W8 is a CODE-ONLY change (decode logic; no migration — data already all-envelope). Director lifted the HOLD + authorized; greg pushed the W8 image (`build-hub.sh` off `7550cfd`) to AR `:latest` → **watchtower auto-deployed** it (~40s; image `0294ddc`). Boot clean: STRICT, reconciler 23/23 (0 failures), 71 tools, relay up. Rollback target = pre-W8 `267548d7`. (Deploy went via watchtower, NOT the manual IAP-SSH path — the runbook's "watchtower non-functional / manual" claim was corrected this PR.)

**Read-side live-audit — ✅ GREEN.** On real prod data: 9/9 list-parity vs the psql oracle (Mission 1/90, Bug-open 59, Idea-open 217, Task-working 7, Thread-active 0, Tele 13, Proposal 32 — all = oracle) AND every list result is decode-to-flat (status a STRING not `{phase}`; fields flat; tags arrays). **bug-138 read-side + idea-325 (list_missions) + idea-327 (output-shape) confirmed correct LIVE.**

**Behavioral dispositive checks — CONCLUDED (2026-06-20, co-driven architect+engineer; full set, Director-chosen).** LIVE PASS: **bug-146 both axes** (dispatch crash gone — a 485-char directive decoded intact — AND caller-login-labeling claim-routing now correctly *enforced*, where pre-W8 it was bypassed), **proposal-close** CAS, **message-seq** (0,1,2,3 monotonic). The other three — 3-strikes review circuit-breaker, mission auto-advance, PA watchdog — could NOT be live-tested: the live testing surfaced **bug-159 (major)** — there is no architect tool-path to dispatch an engineer-CLAIMABLE task (`create_task` + `create_mission(plannedTasks)` both inherit the architect's login-label with no assignee param → un-claimable by the engineer). Those three each require the engineer to *claim* an architect-dispatched task, so they're blocked. Their FIXES are already proven on the deep-audit real-Postgres testcontainer + confirmed by the live read-decode (the CAS transforms share that decode path); the live re-test is blocked by bug-159 — an unrelated tooling gap, NOT a fix defect. **thread-dispatch-equivalence RETIREMENT: DEFERRED** — bug-146 (the workaround's original driver) is fixed + live-confirmed, but bug-159 now blocks the formal architect→engineer claim flow end-to-end; the workaround stays until bug-159 lands an assignee/label-scoping fix.

**Release-gate recommendation:** on a clean behavioral set, ratify `update_mission(mission-90, status="completed")` → Phase 9 Close → Phase 10 Retrospective (Walkthrough). A behavioral regression (a prod-specific divergence from the testcontainer-proven behavior) loops back before close, with rollback to `267548d7` available.

---

## Open items / follow-ons (not blocking close)

- **bug-149** — non-hot JSONB index parity (HOT indexes landed W4); separate follow-on.
- **bug-148** — Notification.recipientAgentId phantom (repo↔SchemaDef divergence); minor.
- **idea-300** (M-Hub-Storage-FS-Retirement) — the 4 deleted sweeper-substrate spikes are NOT a regression (prod uses the FS-version decoding facades); a future substrate-native sweeper should be built envelope-aware, not resurrected from the stubs. Noted for that mission.
- **bug-146** — FULLY resolved (both the dispatch-half crash and the caller-login-labeling axis confirmed live at W8).
- **bug-159 (major; SURFACED at the W8 live behavioral testing)** — architect-created tasks are un-claimable by the engineer (`create_task` / `create_mission(plannedTasks)` inherit the creator's login-label, no assignee param). Tagged `blocks-formal-fsm-dispatch` / `blocks-thread-dispatch-equivalence-retirement`. The clean post-mission-90 follow-on: it re-enables formal architect→engineer task dispatch, which in turn unblocks the thread-dispatch-equivalence retirement (held open by the workaround until then). OUTSIDE mission-90's envelope-substrate scope.
- **Calibration candidates** — see the Phase 10 Retrospective (`docs/reviews/m-envelope-substrate-completion-retrospective.md`). Filing is Director-direct / architect-Director-bilateral.
