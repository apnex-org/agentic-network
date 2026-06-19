# mission-90 (M-Envelope-Substrate-Completion) — Phase 7 Release-Gate

**Authored:** 2026-06-20 / lily (architect; agent-40903c59)
**Surfaced to Director for:** `update_mission(missionId="mission-90", status="completed")` per RACI — **CONDITIONAL on the post-deploy LIVE audit clearing** (see §6; redeploy in flight at authoring).
**Branch:** `agent-greg/m90-w8-tolerant-retirement` — all waves merged to `main`; W8 HEAD `7550cfd` (PR #323).
**Production state at authoring:** W8 code-only redeploy **IN FLIGHT** (greg, Director-authorized) — recreating `ois-hub-prod` onto the W8 image off `7550cfd`. Pre-redeploy prod ran `edc4792` (W6 cutover + bug-158). The MCP coordination relay is comms-dark for the recreate window (the Hub *is* the channel, bug-157); the post-deploy live-audit + this doc's §6 finalize when it reconnects.

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
| **W8 deployed to prod + post-deploy live-audit clean** | ⏳ **PENDING — §6 (redeploy in flight)** |

---

## §6 — Deploy + post-deploy LIVE audit — PENDING (finalize on channel reconnect)

W8 is a CODE-ONLY redeploy (decode logic; no migration, data already all-envelope). Director authorized; greg executes (IAP-SSH recreate of `ois-hub-prod`, the established greg-solo code-only-redeploy class). Rollback = re-tag the pre-W8 image `edc4792` → recreate (zero data risk).

**To be confirmed live and folded in here when the channel reconnects:**
- Boot clean: STRICT, reconciler 23/23, 71 tools, relay up (the relay reconnecting *is* this signal).
- bug-146 dispatch live-half + end-to-end task-claim → if green, **retire thread-dispatch-equivalence + close the dispatch half of bug-146**.
- bug-146 caller-login-labeling axis (dispositive).
- The 5 prod-defects fixed live (circuit-breaker escalates / mission auto-advance / proposal closes / watchdog escalates / msg-seq increments).
- 9/9 list parity holds vs psql oracle; no regression.

**Release-gate recommendation:** on a clean live-audit, ratify `update_mission(mission-90, status="completed")` → Phase 9 Close → Phase 10 Retrospective (Walkthrough). If the live-audit surfaces a regression, greg rolls back to `edc4792` and the gap loops back before any close.

---

## Open items / follow-ons (not blocking close)

- **bug-149** — non-hot JSONB index parity (HOT indexes landed W4); separate follow-on.
- **bug-148** — Notification.recipientAgentId phantom (repo↔SchemaDef divergence); minor.
- **idea-300** (M-Hub-Storage-FS-Retirement) — the 4 deleted sweeper-substrate spikes are NOT a regression (prod uses the FS-version decoding facades); a future substrate-native sweeper should be built envelope-aware, not resurrected from the stubs. Noted for that mission.
- **bug-146 caller-login-labeling** — distinct from the dispatch-half; confirm/track at the live-audit.
- **Calibration candidates** — see the Phase 10 Retrospective (`docs/reviews/m-envelope-substrate-completion-retrospective.md`). Filing is Director-direct / architect-Director-bilateral.
