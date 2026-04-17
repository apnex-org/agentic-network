# Mission-20 Phase 1 — Confirmed GCS RMW Audit

**Status:** Complete — delivered under task-225
**Author:** Claude Code (engineer-claude-1, `eng-6889bc8b6932`)
**Date:** 2026-04-17
**Origin:** Phase 1 deliverable for Mission-20 (mission brief at `docs/history/mission-20-gcs-concurrency-hardening.md`)
**Relationship to pre-audit:** The mission brief § 4.1 contained a pre-audit seed inventory. This document is the confirmed version: each row validated with evidence, borderline rows resolved, missed sites surfaced.

---

## 1. Executive summary

The pre-audit inventory held up on classification structure (P1 / P2 / P3), but three findings change the remediation plan:

1. **Turn.linkMission / Turn.linkTask are dead code.** Defined on the store interface and in both Memory/GCS implementations, never called from the policy layer. `Turn.missionIds` and `Turn.taskIds` are never populated in production today. Recommendation: remove the dead methods outright, or if Turn should surface its missions/tasks, migrate to virtual-view as the first (and cheapest) P1 fix since there are zero existing writers.

2. **The audit markdown rollup is write-only.** `audit/log-YYYY-MM-DD.md` is appended on every audit event but never read by any code path. The JSON-per-entry files at `audit/{id}.json` are already the authoritative record. Recommendation: delete the rollup-write entirely rather than harden it.

3. **`getAndIncrementCounter`, `getNextDirective`/`getNextReport`, and the `auditLock` markdown path are all P3 under the current deployment model** (Hub pinned to `max-instances=1` per ADR-009 and `scripts/deploy-local.sh:67-68`). They become P2/P1 the moment that pin is lifted. Track as "latent risk, re-evaluate on backplane introduction" rather than urgent P2 work.

One new P1-class site was found outside `hub/src`: the architect agent (`agents/vertex-cloudrun/src/context.ts`) has private `readJson`/`writeJson` helpers that do naked RMW on history files. Flagged as out-of-scope for Mission-20 but worth a sibling remediation.

The confirmed scope for Phase 3 migration work is:

- **P1 (virtual-view):** 2 sites — `Thread.messages` (genuine race) and `audit rollup` (delete, not migrate).
- **P1 dead-code resolution:** 2 sites — `Turn.linkMission` / `Turn.linkTask` (decide: delete or pre-migrate to virtual-view).
- **P2 (CAS via `updateExisting`):** 15 sites across Task / Idea / Turn / Mission / Proposal / Thread stores.
- **P3 (under max-instances=1 constraint):** 5 sites — single-replica-safe today, latent if deployment constraint lifts.

Total sites confirmed: **24** in `hub/src` + **1** missed site in `agents/vertex-cloudrun/src`.

---

## 2. P1 sites — confirmed

### 2.1 `GcsTurnStore.linkMission` / `GcsTurnStore.linkTask` — dead code

**File:line:** `hub/src/entities/gcs/gcs-turn.ts:79-101`, `hub/src/entities/turn.ts:122-141`

**Evidence:** `grep -n "linkMission\|linkTask" hub/src/policy` returns zero matches. Policy handlers call `createTurn`, `getTurn`, `listTurns`, `updateTurn` only. `Turn.missionIds` and `Turn.taskIds` fields exist on the entity but are initialised to `[]` at creation and never mutated by any caller. `turn-policy.ts:76` only *reads* them into the response payload.

**Race shape if wired up:** Identical to the task-223 bug — naked `readJson` → `push` → `writeJson` on `turns/{turnId}.json`. Would lose writes under concurrent auto-linkage.

**Classification:** **Dead code — not P1 in production today.**

**Recommendation:**
- Option A (simpler): delete the `linkMission` / `linkTask` methods from the store interface and both implementations. Accept that Turn no longer surfaces its missions/tasks. Policy layer already doesn't populate them.
- Option B (if Turn-mission/task linkage is needed): pre-migrate Turn to virtual-view *before* wiring up any writers. Add `turnId` fields to Mission and Task, compose in `getTurn` / `listTurns` via store deps (same shape as the task-223 `GcsMissionStore.hydrate` helper). This is the cheapest P1 migration in the mission because there are no legacy writers to coordinate with.

Decision should be made during Task D kickoff. My recommendation is **Option B** — consistent entity shape across Mission and Turn, and the work is under an hour.

### 2.2 `GcsThreadStore.replyToThread` — confirmed P1

**File:line:** `hub/src/gcs-state.ts:1071-1101`

**Evidence:** The handler reads the thread, checks `thread.currentTurn !== author`, mutates `thread.messages`, flips `currentTurn`, and writes. The gate check and the write are in the same naked RMW — two concurrent replies from the same `author` both pass the gate against a stale `currentTurn`, both mutate and write, the second clobbers the first.

**Race shape:**
```
R1: read → currentTurn="engineer", author="engineer" → pass gate
R2: read → currentTurn="engineer", author="engineer" → pass gate
R1: push message, flip currentTurn="architect", write
R2: push message (onto R1's pre-write snapshot), flip currentTurn="architect", write → clobbers R1's message
```

**In-practice exposure:** FSM serialisation *mostly* prevents this because only one party holds the turn. But with M18 multi-engineer + label-routed threads, two engineers with matching labels could both have the "engineer" role for the same thread, and both could reply before either read the updated `currentTurn`. Not observed in prod yet, but not structurally impossible.

**Classification:** **P1 confirmed** — genuine race on a collection-shaped field (`Thread.messages`).

**Recommendation:** Split remediation into two primitives:
- **Message append:** store each message as its own file (`threads/{threadId}/messages/{seq}.json` or ULID-keyed). New paths are single-writer by construction; use `createOnly` from Phase 2.
- **Thread state (status / currentTurn / roundCount / outstandingIntent):** remains a scalar RMW — wrap with `updateExisting` (CAS). The gate check moves inside the transform; CAS retry re-applies the gate against fresh state.

Convergence detection (requires reading the last two messages) shifts to the read side and composes across the message-file collection plus the thread-state scalar.

### 2.3 `GcsAuditStore.logEntry` — delete, don't migrate

**File:line:** `hub/src/gcs-state.ts:1170-1199`

**Evidence:** `grep -n "audit/log" hub` returns only the three writer references (`logPath` string, the download-for-append read, the `writeMarkdown` call). Zero readers. The rollup markdown file is never loaded by the Hub, by any policy, by any dashboard, by any test.

**Per-entry JSON:** `audit/{id}.json` is already single-writer (new file per entry, timestamp-based ID). Safe as-is.

**Classification:** **P1 in structure, but the fix is deletion, not migration.**

**Recommendation:** Remove the `logPath` / `existing` / `writeMarkdown` block from `logEntry` entirely (lines ~1173-1195). Keep the `audit/{id}.json` write. Retire the in-process `auditLock` that protected the rollup append — no longer needed. If a human-readable daily rollup is ever wanted, regenerate on-demand from the JSON files.

---

## 3. P2 sites — confirmed

All entries below use the same race shape: naked `readJson(path)` → mutate → `writeJson(path)` on a single-entity file, no precondition check. Remediation is mechanical: replace with `updateExisting(path, transform)` where the transform body is the old mutation. In-process locks stay.

### 3.1 Task store (9 sites)

| # | Method | File:line | Fields updated |
|---|--------|-----------|----------------|
| 1 | `submitReport` | `gcs-state.ts:446-484` | `status`, `report`, `reportSummary`, `reportRef`, `verification`, `updatedAt` |
| 2 | `cancelTask` | `gcs-state.ts:527-537` | `status`, `updatedAt` (gated on current `status === "pending"`) |
| 3 | `requestClarification` | `gcs-state.ts:539-549` | `status`, `clarificationQuestion`, `updatedAt` (gated on `status === "working"`) |
| 4 | `respondToClarification` | `gcs-state.ts:551-561` | `status`, `clarificationAnswer`, `updatedAt` (gated on `status === "input_required"`) |
| 5 | `submitReview` | `gcs-state.ts:563-604` | `status`, `revisionCount`, `reviewAssessment`, `reviewRef`, `updatedAt` |
| 6 | `unblockDependents` (inner per-task) | `gcs-state.ts:378-406` | `status → "pending"` on blocked dependents |
| 7 | `cancelDependents` (inner per-task) | `gcs-state.ts:408-423` | `status → "cancelled"` on blocked dependents |
| 8 | `getNextDirective` | `gcs-state.ts:425-444` | `status → "working"`, `assignedEngineerId` — under in-process `taskLock` (P3 under max-instances=1, P2 otherwise) |
| 9 | `getNextReport` | `gcs-state.ts:486-511` | `status → "reported_*"` — under in-process `taskLock` (same note) |

**Gate notes:** Entries 2-4 have status-gated transitions. CAS retry semantics preserve the gate — the transform reads fresh state and returns `throw GatedTransitionRejected` or similar if the gate no longer holds; `updateExisting` doesn't retry on thrown business errors (retry is precondition-failure only).

### 3.2 Idea / Turn / Mission / Proposal / Thread stores (6 sites)

| # | Method | File:line | Fields updated |
|---|--------|-----------|----------------|
| 10 | `GcsIdeaStore.updateIdea` | `entities/gcs/gcs-idea.ts:61-77` | `status`, `missionId`, `tags`, `updatedAt` |
| 11 | `GcsTurnStore.updateTurn` | `entities/gcs/gcs-turn.ts:61-77` | `status`, `scope`, `tele`, `updatedAt` |
| 12 | `GcsMissionStore.updateMission` | `entities/gcs/gcs-mission.ts:72-88` | `status`, `description`, `documentRef`, `updatedAt` |
| 13 | `GcsProposalStore.reviewProposal` | `gcs-state.ts:994-1007` | `status`, `decision`, `feedback`, `updatedAt` |
| 14 | `GcsProposalStore.closeProposal` | `gcs-state.ts:1009-1019` | `status → "implemented"` (gated on current `status ∈ {"approved","rejected","changes_requested"}`) |
| 15 | `GcsProposalStore.setScaffoldResult` | `gcs-state.ts:1021-1029` | `scaffoldResult`, `updatedAt` |

### 3.3 Thread scalar state (2 sites — partial overlap with P1)

| # | Method | File:line | Notes |
|---|--------|-----------|-------|
| 16 | `GcsThreadStore.closeThread` | `gcs-state.ts:1121-1130` | `status`, `updatedAt`. Pure scalar RMW, no collection touched. |
| 17 | `GcsThreadStore.setConvergenceAction` | `gcs-state.ts:1132-1140` | `convergenceAction`, `updatedAt`. Scalar RMW. |

Entries 16 and 17 remain P2 even after the P1 split of `replyToThread` — they mutate the thread-state scalar, not the messages collection. They migrate to `updateExisting` like any other P2 site. After the Phase 3 work, the thread-state scalar is CAS-protected and the message collection is write-once-per-file.

---

## 4. P3 sites — single-replica-safe today

All entries below are safe under the current deployment constraint (Hub pinned to `max-instances=1` per ADR-009 and `scripts/deploy-local.sh:67-68`). They become P2 or P1 when/if a Pub/Sub backplane is introduced and the pin is lifted. Not urgent. Do not migrate in Phase 3.

| # | Site | File:line | Current protection | Becomes |
|---|------|-----------|--------------------|---------|
| 18 | `getAndIncrementCounter` | `gcs-state.ts:194-229` | In-process `counterLock` (AsyncLock) | P2 at scale — duplicate IDs possible on cross-replica concurrent increments |
| 19 | `reconcileCounters` | `gcs-state.ts:236-302` | In-process `counterLock`; only runs at startup | P3 still — startup-only, effectively single-writer |
| 20 | `GcsEngineerRegistry.registerAgent` | `gcs-state.ts:687-795` | Already OCC with explicit retry loop | P3 — no change needed |
| 21 | `GcsEngineerRegistry.touchAgent` | `gcs-state.ts:846-872` | Already OCC, skip-on-conflict | P3 — no change needed |
| 22 | `GcsEngineerRegistry.markAgentOffline` | `gcs-state.ts:879-901` | Already OCC, skip-on-conflict | P3 — no change needed |

Task-store entries 8-9 (`getNextDirective` / `getNextReport`) could reasonably be listed here as "P3 today, P2 otherwise" — I've left them in the P2 table because their lock doesn't use the GCS generation primitive at all; migrating to `updateExisting` is the mechanically correct fix regardless of the deployment pin. Flag for architect preference.

---

## 5. Missed sites

### 5.1 Architect agent history RMW — `agents/vertex-cloudrun/src/context.ts`

**File:line:** `agents/vertex-cloudrun/src/context.ts:49-123, 125-151, 155-180, 184-198`

**What it does:** The architect-agent service maintains four history files in GCS (`director history`, `review history`, `thread history`, `decisions`). Each `append*` method reads the full array, pushes one entry, slices to a bounded tail (200 / 50 / 50 / 100), and writes the full array back. Naked RMW via private `readJson`/`writeJson` helpers inside the class (not the Hub's `gcs-state.ts` primitives).

**Race shape:** The architect-agent runs on Cloud Run with the same `max-instances=1` pin as the Hub, so cross-replica races are not live. However, within the process, SSE event handlers can fire concurrently (e.g., `task_updated` + `proposal_created` arriving back-to-back), and each handler can `appendDecision` or similar. Two concurrent async handlers racing on `appendReview` could drop a review entry.

**Classification:** **P1-class behaviour (race-prone collection append), but out of scope for Mission-20 as framed.** The mission brief § 9 explicitly excludes `packages/network-adapter`; `agents/vertex-cloudrun` is a different directory but follows the same "it's an agent, not the Hub" reasoning.

**Recommendation:** Flag as a separate follow-up. Cleanest fix: one-entry-per-file under each history prefix (`director-history/{ulid}.json`), with the slice happening on read. Mirrors the Thread.messages P1 fix from § 2.2. Estimated 1-2 hours; could ride as a sibling task after Phase 3 completes.

### 5.2 No missed sites within `hub/src`

`grep -n "readJson\|writeJson\|writeMarkdown\|storage\.bucket.*save" hub/src` confirmed. All GCS RMW paths are covered by the pre-audit inventory. The `gcs-document.ts` file handles document upload/download only and has no RMW pattern.

---

## 6. Phase 3 scope — confirmed

After this audit, the Phase 3 work lists:

**P1 migrations (3 sites, 1 deletion):**
1. `GcsThreadStore.replyToThread` — split into per-message file + CAS on thread-state scalar.
2. `audit/log-YYYY-MM-DD.md` rollup — delete the write.
3. Decision on `Turn.linkMission` / `Turn.linkTask` — delete the dead code, OR pre-migrate Turn to virtual-view (recommended: virtual-view for shape consistency with Mission).

**P2 migrations (15 sites, mechanical):**
All rows in § 3.1 / 3.2 / 3.3. Each becomes a single `updateExisting` call. Group by entity store to keep commits reviewable.

**P3 sites (5 sites):**
No migration. Document the "P3 under max-instances=1" status in the GCS Concurrency Model ADR so the constraint is load-bearing rather than implicit.

**Missed site (1, out-of-scope):**
Architect agent history RMW — file a sibling task after Mission-20 completes.

---

## 7. Classification decisions (explicit)

For audit traceability, the three borderline rows from the pre-audit resolved as follows:

| Pre-audit row | Pre-audit label | Confirmed label | Reason |
|---------------|-----------------|-----------------|--------|
| `Thread.messages` | P1 (hypothesis) | **P1 confirmed** | Gate-check and write are in the same RMW; M18 + labels makes the "one party owns the turn" invariant defensible at the role level but not at the handler level. Migration splits into per-message file + CAS on scalar. |
| `getAndIncrementCounter` | P3 (borderline P2) | **P3 under current constraint** | Hub pinned to `max-instances=1` (ADR-009, `scripts/deploy-local.sh`). Latent P2 if pin lifts. Flag in ADR, don't migrate. |
| `audit markdown rollup` | P1 (borderline P3) | **Delete, not migrate** | Write-only — zero readers in the codebase. Remove the write entirely; per-entry JSON is already authoritative. |

---

## 8. Appendix: audit methodology

- Ran `grep -n "readJson\|writeJson\|writeMarkdown" hub` and `grep -n "storage\.bucket.*save" hub/src`.
- For each hit, read the enclosing method to identify: (a) path shape (new file vs. existing path), (b) mutation pattern (append to collection vs. scalar update vs. pure create), (c) writer cardinality (how many concurrent callers can hit this path).
- For the three borderline rows, followed the call graph from the entity method up to the policy layer to confirm FSM / serialisation assumptions.
- For the `max-instances=1` check, grepped for `max-instances` / `max_instances` / `minInstances` across the repo and cross-referenced `docs/decisions/009-sse-liveness-monitoring.md`, `deploy/main.tf`, and `scripts/deploy-local.sh`.
- For the audit rollup readers check, grepped for `audit/log` across the entire repo — zero readers found.
- Re-ran the RMW grep across `packages/` and `agents/` to surface any missed sites outside `hub/src`.

---

*End of Phase 1 audit.*
