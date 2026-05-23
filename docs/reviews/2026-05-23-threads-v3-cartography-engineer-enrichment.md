# Threads v3 — Cartography Engineer Enrichment Pass (2026-05-23)

**Companion to:** `docs/reviews/2026-05-23-threads-v3-cartography.md` (v1.0, merged 0d22d84).
**Method:** engineer-side code-trace + lineage cross-ref + friction-inventory introspection per architect dispatch (thread-619 + Director-flagged Item 6 addendum + thread-622 Path 1 retrospective sub-task 1).
**Author:** apnex-greg (engineer).
**Anchor:** idea-312 (M-Threads-v3 umbrella).
**Status:** **v1.1 input** — architect to integrate or supersede when scoping the SR.

This pass executes the architect's six sub-tasks on thread-619 + Director-flagged Item 6 + thread-622 Path 1 retrospective sub-task 1 (substantive lineage cross-ref using PR #258 standing psql capability). It treats v1.0 as load-bearing (no contradictions); it adds (a) code-state findings the ledger-grep missed, (b) substrate refinement for W5, (c) ledger-currency, (d) the friction inventory the cartography alone could not produce, and (e) the lineage-graph substantiation that was structurally PARTIAL in v1.0 of this companion.

**v1.1 / 2026-05-23 retrospective pass updates:**
- §1 PARTIAL → **FULL** (substantive lineage table; 0/118 bugs have sourceThreadId; substrate-wide gap surfaced)
- §2 mission-41 W3 partition revised via code-trace against `workflow-registry.md` + `hub/test/e2e/workflows/WF-005.test.ts` (architect's 6-FOLD has one swap: idea-171 → idea-169)
- §2.X new — cluster-surfacing additions (4 new COMPOSES candidates: idea-69, idea-240, idea-241, idea-304)
- §3.1 confirms bug-106 entity flipped to `resolved` (architect post-merge action landed)
- §3.2 confirms bug-117 filed as substrate-anchor for the `list_*` cap finding (W5)
- §5 ledger-currency refreshed (47 bugs / 214 ideas / +bug-117 +bug-118)
- §6.1 F-2 / §6.2 DSV-3 **scope-revised** — the gap is substrate-wide bug-lineage (0/118 = 100% gap), broader than "cascade-action handlers" framing; bug-118's title should be re-scoped accordingly

---

## §1 · Sub-task 1 — psql cross-ref (FULL — Path 1 retrospective)

**Result:** FULL. Exhaustive lineage cross-ref completed via `scripts/local/get-entities.sh` remote-mode (PR #258, Substrate-DX A.2) against the production substrate's `hub_reader` role. The engineer-side substrate-DX gap that made this PARTIAL in the original v1.0 pass is now resolved standing-capability.

### §1.1 · v3 catalogued bugs — lineage table (FULL)

Batch SQL pull against 16 v3-catalogued bugs (12 v1.0 + bug-115 already-shipped + bug-106 resolved + bug-117 / bug-118 architect-filed post-PR-#257):

| Bug | Status | `sourceThreadId` | `sourceMissionId` | `linkedMissionId` | `sourceIdeaId` | `sourceActionId` |
|---|---|---|---|---|---|---|
| bug-23 | investigating | null | null | null | null | null |
| bug-25 | open | null | null | null | null | null |
| bug-27 | open | null | null | null | null | null |
| bug-40 | open | null | null | null | null | null |
| bug-41 | open | null | null | null | null | null |
| bug-42 | open | null | null | null | null | null |
| bug-48 | open | null | null | null | null | null |
| bug-57 | open | null | null | null | null | null |
| bug-60 | open | null | null | null | null | null |
| bug-61 | open | null | null | null | null | null |
| bug-94 | open | null | null | null | null | null |
| bug-96 | open | null | null | null | null | null |
| bug-106 | **resolved** | null | null | null | null | null |
| bug-115 | resolved | null | null | null | null | null |
| bug-117 | open | null | null | null | null | null |
| bug-118 | open | null | null | null | null | null |

**Substantive finding 1 — substrate-wide bug-lineage gap (broader than v1.0 framing):**

All 16 v3-catalogued bugs have **all** lineage fields `null`. A global query against the substrate confirms this is **substrate-wide, not v3-subset-specific**:

```sql
SELECT COUNT(*) FROM entities WHERE kind = 'Bug';                                  -- 118 total
SELECT COUNT(*) FROM entities WHERE kind = 'Bug' AND data->>'sourceThreadId' IS NOT NULL;  -- 0 (zero)
SELECT COUNT(*) FROM entities WHERE kind = 'Bug' AND data->>'linkedMissionId' IS NOT NULL; -- 14 (manual)
```

**0 of 118 bugs in the entire substrate have `sourceThreadId` populated.** This is uniform across all filing paths (cascade-action, MCP-tool-direct, Hub-system-emit). Compare with ideas:

```sql
SELECT COUNT(*) FROM entities WHERE kind = 'Idea';                                  -- 312 total
SELECT COUNT(*) FROM entities WHERE kind = 'Idea' AND data->>'sourceThreadId' IS NOT NULL; -- 63 (20%)
SELECT COUNT(*) FROM entities WHERE kind = 'Idea' AND data->>'missionId' IS NOT NULL;      -- 36 (12%)
```

**Ideas: 63 of 312 (20%) have `sourceThreadId`.** The per-kind asymmetry is dispositive — the substrate's bug-handling code is structurally broken w.r.t. lineage capture, whereas the idea-handling code captures lineage for ~20% of ideas (the subset filed via cascade convergence paths).

**Code-trace** (`hub/src/policy/cascade-actions/create-bug.ts`:39-50 + `hub/src/entities/bug-repository-substrate.ts`:80-82) shows the cascade-action code DOES pass `backlink` to the repository AND the repository DOES persist `sourceThreadId: options.backlink?.sourceThreadId ?? null`. The code looks correct; the gap is empirical (0 bugs in production have it). Hypotheses (all engineer-side; substrate investigation owed):

1. **Bugs are never filed via cascade `create_bug` action in production.** All 14 of the v3-relevant bugs I sampled have `createdBy: system / hub-system` with `surfacedBy` ∈ {integration-test, prod-audit, code-review, llm-self-review}. None are cascade-spawned from threads. The cascade path may exist in code but be unused operationally.
2. **The Hub-system-emit path and the MCP `create_bug` tool path both bypass the backlink-capture code.** Worth code-trace to verify.

**This substantively re-scopes v1.0 companion §6.1 F-2 / §6.2 DSV-3.** The v1.0 framing claimed "cascade-action handlers drop lineage fields silently"; this is too narrow. The actual finding is: **bugs filed via every observable path get `sourceThreadId: null`, regardless of whether they originate from a thread context or not.** bug-118's title ("Cascade-action handlers silently drop lineage fields") inherited the over-narrow framing from the original companion — it should be **re-scoped to "Bug entity lineage is unset across all filing paths (substrate-wide gap)"** with the cascade-path code-trace included as a sub-investigation.

### §1.2 · v3 catalogued ideas — lineage table (FULL)

Batch SQL pull against 39 v3-catalogued ideas (35 v1.0 FOLD/COMPOSES + idea-312 umbrella + idea-248 + idea-282 + idea-216 + idea-20 + idea-56 + idea-114). Showing only the **4 with non-null sourceThreadId**; the other 35 have `sourceThreadId: null`:

| Idea | Status | `sourceThreadId` | `sourceActionId` | Note |
|---|---|---|---|---|
| idea-86 | open | thread-135 | action-2 | Director Integration Handshake & Notification Path |
| idea-214 | open | thread-382 | action-1 | Note-kind primitive surface gap |
| idea-222 | open | thread-413 | (null) | Relax thread turn-taking to advisory |
| idea-262 | open | thread-503 | (null) | Cognitive-wake-on-arriving-message |

**Finding 2 — idea-lineage capture is per-cascade-action-spec-honoured but partial.** The 4 thread-linked v3-relevant ideas are all filed via `create_idea` cascade action with backlink propagation working correctly. The 35 others are filed via older paths (pre-cascade-policy, direct submission, manual creation). The 20%-global-rate matches this pattern — newer ideas have lineage, older ones don't. The substrate code-path for ideas IS working; the gap is historical.

### §1.3 · §2.8 mission-41 W3 cluster — lineage table (FULL)

Batch SQL pull against the 23-entity §2.8 cluster (idea-159 through idea-181):

| Range | Count | `sourceThreadId` | Note |
|---|---|---|---|
| idea-159 → idea-181 | 23 | **thread-266** (all 23) | Single cohesive cluster — confirms architect's §2.8 framing |

**Confirmation:** all 23 §2.8 entities trace to **thread-266** as their single source thread (the mission-41 W3 invariant-coverage ideation thread). The cluster is empirically cohesive at the lineage level, not just title-grep. This validates v1.0 §2.8's partition framing AND provides the substantive evidence for the architect's "~5–8 thread-touching" estimate (refined below in §2).

### §1.4 · Substantive disposition

- Sub-task 1 is now FULL.
- Cartography v1.0's §1 partition (FOLD/COMPOSES) holds — title-grep was the right tool given lineage-graph sparseness for bugs.
- **bug-118 needs scope-revision** per §1.1 finding 1 (substrate-wide gap, not cascade-handler-drop). Surfacing to architect for the v1.1 fold.
- **Sub-task 1's standing capability (PR #258 / `get-entities.sh` remote-mode) enables future enrichment cycles** without engineer-side substrate-DX rework.

---

## §2 · Sub-task 2 — mission-41 W3 invariant partition (FULL — code-trace substantiated)

Exhaustive partition of the idea-159→181 cluster, code-trace-substantiated against `docs/specs/workflow-registry.md` + `hub/test/e2e/workflows/WF-005.test.ts` + `hub/test/e2e/invariants/` (10 existing invariant fixtures: INV-I2, INV-M4, INV-P1, INV-P2, INV-P4, INV-T4, INV-TH6, INV-TH7, INV-TH18, INV-TH19) + `hub/scripts/invariant-coverage.ts`.

### §2.1 · Code-trace findings for the architect's named candidates

The architect's v1.0 §2.8 named 6 thread-touching candidates: idea-159, idea-170, idea-171, idea-172, idea-173, idea-174. Code-trace against `workflow-registry.md` revises this:

| Idea | Invariant | Spec-classification per workflow-registry.md | Verdict |
|---|---|---|---|
| idea-159 | INV-TH8 | "Thread invariant (not in ratified v1 subset)" (hub/scripts/invariant-coverage.ts:49) | **FOLD ✓** thread-touching |
| idea-169 | WF-005a | "Thread — Convergence to Auto-Directive (Architect LLM Path)" — Path B if no `convergenceAction` exists, Architect LLM auto-decides | **FOLD (NEW)** thread-convergence path; architect's set MISSED this |
| idea-170 | WF-005b | "Thread — Convergence via Hub Cascade (convergenceAction Path)" — Hub-deterministic, pre-declared action | **FOLD ✓** thread-touching |
| idea-171 | WF-006 | **"Mission Lifecycle"** — mission FSM, not thread substrate | **DEFER (RECLASSIFY)** mission-41 W3 coverage program, not v3 thread |
| idea-172 | WF-008 | "Event Loop Catch-Up (Agent-Side)" — *"polling backup for `thread_converged` SSE events"* | **FOLD ✓** thread-touching (catch-up for thread events) |
| idea-173 | XD-006a | "Thread Convergence → Auto-Action (Hub Cascade)" | **FOLD ✓** thread-touching |
| idea-174 | XD-006b | "Thread Convergence → Auto-Directive (Architect LLM)" | **FOLD ✓** thread-touching |

**Revised 6-FOLD set:** idea-159, **idea-169** (NEW), idea-170, idea-172, idea-173, idea-174. Net swap: **idea-171 (WF-006 Mission Lifecycle) DEFER → idea-169 (WF-005a Architect LLM convergence) FOLD**. Count unchanged at 6.

**Why the swap matters:** WF-005a + WF-005b are the two halves of the thread-convergence workflow (per WF-005.test.ts header: *"§WF-005 (happy-path thread convergence) has two: WF-005a — Architect LLM auto-directive path … WF-005b — Hub cascade path"*). v1.0 caught the cascade half (idea-170) but missed the LLM half (idea-169). v3 W4 (cascade FSM) needs both halves to be substrate-covered.

### §2.2 · Adjacent finding — INV-SYS-018 (convergence dedup) is not in the §2.8 cluster

Workflow-registry.md row 18 of system invariants names **INV-SYS-018**: *"Thread convergence dedup: Hub cascade (WF-005b) and Architect LLM (WF-005a) never both fire for the same thread. `hasAction` flag gates the SSE path; thread status `closed` gates the polling path."* — flagged as `Tested By: NONE (requires integration test)`.

The §2.8 cluster has **idea-168** covering "INV-SYS-010 through INV-SYS-017 (8 consecutive system invariants)" but does NOT extend to INV-SYS-018. INV-SYS-018 is the dedup invariant that compose-glues WF-005a and WF-005b — and it doesn't have an idea filed. **Surfacing for architect**: file a new idea for INV-SYS-018 coverage gap, FOLD into v3 W4 scope. This is a substantive cluster-surfacing find (sub-task 2 deliverable).

### §2.3 · v1.1 update for cartography v1.0 §2.8

Replace v1.0 §2.8 framing with:

> **"6 FOLD (code-trace substantiated): idea-159 (INV-TH8), idea-169 (WF-005a), idea-170 (WF-005b), idea-172 (WF-008), idea-173 (XD-006a), idea-174 (XD-006b). Residual 17 ideas (idea-160..168, idea-171, idea-175..181) DEFER — mission-41 W3 coverage program owns them; non-thread-touching invariants. Adjacent gap: INV-SYS-018 (convergence dedup) is not in §2.8 cluster + has no filed idea — new idea-candidate for v3 W4 scope."**

---

## §2.X · Sub-task 2 (continued) — cluster-surfacing additions (NEW for v1.1)

Title-grep against v1.0 cartography enumerated 35 v3-relevant ideas + 23 §2.8 candidates. Lineage-walk against the substrate's 63 thread-linked open ideas surfaces **4 additional COMPOSES candidates** the title-grep missed:

| Idea | Source thread | Title (truncated) | v1.1 disposition | Rationale |
|---|---|---|---|---|
| **idea-69** | thread-112 | "MCP proxy list/get-surface standardisation — consistent by-ID, by-label, and by-filter" | **COMPOSES** | Tool-surface modernization for MCP `list_*` / `get_*` standardisation; composes with idea-121 (API v2.0); directly load-bearing for v3 W1 wire-contract |
| **idea-240** | thread-472 | "M-Agnostic-Transport-Adapter-Hub — Vision/umbrella idea: confine MCP to a single Shim↔Hub leg" | **COMPOSES** | Transport-substrate carve-out; the Shim↔Hub agnostic-transport surface that v3 W1 wire-contract must compose with; vision-level peer to idea-152 (Smart NIC) |
| **idea-241** | thread-472 | "M-Transport-WebSocket-Adapter-Hub — replace MCP wire format on Adapter↔Hub path with WebSocket" | **COMPOSES** | Concrete-impl candidate for idea-240; specific transport choice that interacts with v3 wire-contract |
| **idea-304** | thread-587 | "M-Commit-Push-Mission-Broadcast — broadcast commit-push visibility at mission-context" | **COMPOSES** | Concrete consumer of broadcast routing; v3 W3 (routing modes) must serve this surface |

**Why these were missed by title-grep:** their titles use vocabulary the cartography's title-grep didn't index — "MCP proxy", "Agnostic-Transport", "WebSocket", "Commit-Push-Broadcast" — none of which contain "thread" / "message" / "convergence" / "cascade". Lineage-walk surfaces them via cluster co-occurrence (thread-472 is a transport-vision ideation thread; thread-587 is a broadcast-routing thread).

**Bidirectional check — current v1.0 FOLDs that lineage might reclassify:** none surfaced. All v1.0 FOLD/COMPOSES entities remain correctly classified after the lineage cross-ref. The 35 v3-relevant ideas (v1.0 §2.1 through §2.7) hold their classifications.

**v1.1 update for cartography v1.0 §2:** add idea-69 to §2.4 (Wire / payload / envelope COMPOSES); add idea-240 + idea-241 to §2.4 (transport-substrate COMPOSES, paired with idea-152); add idea-304 to §2.3 (Dispatch / cognitive-wake / notification COMPOSES, as broadcast-consumer).

---

## §3 · Sub-task 3 — code-grep completeness review

Engineer code-trace findings that the architect ledger-grep could not surface:

### §3.1 · bug-106 is structurally FIXED IN CODE; entity status now `resolved` (v1.1 update)

**Finding (load-bearing for the cartography's bug-106 framing):**

`packages/cognitive-layer/src/middlewares/response-summarizer.ts:201-204` carries the exact bug-106 fix:

```typescript
// bug-106: internal-machinery calls (poll-backstop catch-up, heartbeat)
// need the raw, full result — the summarizer exists for the LLM's
// context budget, not for machinery. Skip the summarize step entirely.
if (isInternalCall(ctx.tags)) return result;
```

Landed via commit `f35b08a` (PR #224, mission-86 bug-103 slice, 2026-05-20, author apnex-greg). The fix is the exact "machinery-vs-LLM split" the architect proposed as the W5 refinement direction. **The substrate primitive `isInternalCall(ctx.tags)` already exists in `contract.ts:43`.**

**v1.1 update:** the bug entity is now `status: resolved` (architect post-merge action landed per thread-620). For the cartography's purposes:

- Cartography v1.0 §1.3 lists bug-106 as FOLD with the framing "Cognitive ResponseSummarizer summarizes internal-machinery agent.call." That framing is now historical — **the machinery-vs-LLM split is shipped + ledger reconciled**.
- The "bug-25 sibling pathology" framing is still valid as a class observation; bug-25's locus is stdio/buffer transport per its own body, distinct from cognitive pipeline.
- bug-106 should be cataloged in cartography v1.1 as **already-shipped v3 building block** (a fourth entry alongside bug-115 + mission-83 + idea-66 in §3).

### §3.2 · bug-115's "latent design smell" is the LIVE friction for list_* tools

Bug-115's resolved-status note explicitly flagged: *"the ResponseSummarizer's generic behavior — first-N (oldest) truncation of time-ordered arrays + an unconditional `Use offset=N` hint — is a real but latent design smell. `get_thread` was the only demonstrated victim and is fixed here; for the other tools it touches (`list_*`) it is messy-but-functional. Not separately filed — revisit only if a second large-array tool surfaces as a victim."*

**Observed during this enrichment pass:** `list_ideas` with `limit: 50` returns 10 items; `list_ideas` with `limit: 500` returns 10 items; `list_bugs` with `limit: 500` returns 10 items. The persisted tool-result confirms the server-returned-array has exactly 10 items — the cap is at the cognitive-layer `ResponseSummarizer` (which fires because the request asks for >`maxItems`=10 and the response shape `{ideas: [...], count: 50}` triggers the heuristic). The summarizer's caller-`limit`-respect path (response-summarizer.ts:220-226) only bypasses when `limit ≤ maxItems`; upward asks (`limit > maxItems`) still get truncated.

**This is the predicted "second victim."** Every exhaustive-cross-ref / batch-pull workflow against `list_ideas` / `list_bugs` / `list_threads` / `list_tasks` / `list_proposals` / `list_audit_entries` / `list_missions` / `list_documents` / `list_tele` / `list_pending_actions` / `list_director_notifications` / `list_turns` hits this cap. Engineer-side enrichment work (this very pass), Director-side audit work, and any future LLM-facing operator workflow that needs cross-entity scope all degrade against this cap.

**v1.1 update:** bug-117 was filed by architect post-PR-#257 (verified via psql; `status: open`, severity major, class "cognitive-pipeline conflation — caller-limit upward asks not honored on list_* tools"). The cartography v1.1 should anchor bug-117 in §1 as the W5 substrate-anchor for the `list_*` cap class.

### §3.3 · idea-292 cross-ref against current substrate

Idea-292 enumerates "long-thread context-discipline" concerns. Of its 5 historical dimensions:
- **Dimension #3 (paginated `get_thread`):** closed by bug-115 / PR #248 / commit `3d9b0b1` (2026-05-22). ✓
- **Dimension #4 (thread-metadata-accumulation):** still open; substrate-side concern — projections / `Notification` / `PendingActionItem` / `DirectorNotification` accumulate over a thread's lifetime. Folds into idea-201 (substrate carve-out).
- **Dimensions #1, #2, #5:** not code-traced this pass; defer to a focused idea-292 audit cycle if v3 W2 scope demands it.

### §3.4 · Other code-surface observations

- **No standalone `ResponseSummarizer`-bypass mechanism for engineer-LLM list workflows.** The `perToolMaxItems: null` config exists but is adapter-startup config, not per-call. The engineer-LLM cannot opt out per call. Composes with §3.2 finding.
- **`packages/cognitive-layer/src/contract.ts:37`** explicitly documents this constraint: *"context budget — notably `ResponseSummarizer` — MUST NOT transform an internal-machinery call result."* Internal-machinery is well-defined; LLM-facing batch-pull is not.
- **`message-projection-sweeper.ts` + `cascade-replay-sweeper-substrate.ts` + `scheduled-message-sweeper-substrate.ts` + `pulse-sweeper-substrate.ts`** in `hub/src/policy/` constitute substantial post-substrate event-machinery surface that the cartography doesn't enumerate — they are mission-83 carved-out, not catalogued as v3 surface. Worth a quick architect read to confirm none warrant FOLD treatment for routing-modes (W3) or cascade FSM (W4) waves.

---

## §4 · Sub-task 4 — W5 disposition refinement (post-§3 sharper framing)

The architect proposed (in thread-618 cross-approval): a `ResponseSummarizer` machinery-vs-LLM factor-split closing bug-106 directly + retiring bug-115's latent design smell, ahead of the longer idea-152 (Smart NIC) horizon.

**Engineer-side refinement post-§3:**

- **bug-106's machinery-vs-LLM split is SHIPPED.** The `isInternalCall(ctx.tags)` check is wired (§3.1). Close the bug entity; treat as already-built v3 building block.
- **bug-115's latent design smell is now the active W5 substrate:** the `list_*` first-N cap (§3.2) is the immediate-impact friction for engineer-side + LLM-facing batch-pulls. The W5 disposition should be **"extend the `get_thread` pattern (caller pagination honored end-to-end) to all `list_*` tools that take time-ordered or query-shape paginated data."**
- **Concrete W5 scope refinement:** (a) `list_*` tools negotiate `limit` honestly with the cognitive layer (caller-limit upward-respect, not just downward), OR (b) a per-call `unsummarized: true` opt-out flag the LLM can request, OR (c) a Hub-side substrate primitive that materializes pages without summarizer involvement at all. The W5 design phase picks among these; idea-152 (Smart NIC, target-state) survives as the longer horizon that absorbs whichever residue.

**Net:** W5's scope shrinks (one of the framing's two bug-anchors is closed) BUT its substrate work clarifies (the residual is well-named + bounded). Cartography v1.0's W5 framing ("Size / response-shape structural fix") is still correct; the specific bugs/ideas it anchors should be updated for v1.1.

---

## §5 · Sub-task 5 — ledger-currency fix (v1.1 refreshed)

| Field | v1.0 claim | Actual (post-PR-#257 ledger state, 2026-05-23) | Note |
|---|---|---|---|
| Open bugs | 47 (or "45 + 1 investigating") | **46 open + 1 investigating = 47** | bug-117 + bug-118 filed by architect post-PR-#257; bug-106 flipped resolved; net +1 |
| Open ideas | 213 | **214** | unchanged since v1.0 of this companion |
| FOLD/COMPOSES bug surface | 10 + 3 = 13 of 47 | **11 + 3 = 14 of 47** (bug-106 promoted to §3; bug-117 + bug-118 added as W5 + W4 anchors) | net +1 (bug-106 out, 117 + 118 in; 117 is new W5 anchor, 118 is new W4 anchor with scope-revision per §1.1) |
| FOLD/COMPOSES idea surface | 24 + 11 = 35 | **24 + 15 = 39** (4 cluster-surfaced COMPOSES per §2.X: idea-69, idea-240, idea-241, idea-304) | net +4 from sub-task 2 cluster-surfacing |
| Already-shipped v3 building blocks (§3) | 3 (bug-115, mission-83, idea-66) | **4** (add bug-106) | per §3.1 ledger-flip landed |

**Mechanical edits for v1.1 (cartography v1.0):**
1. v1.0 header: "47 open" → "47 open (46 + 1 investigating)" — math now consistent; correct count via psql verification.
2. v1.0 §2 intro: "213 open total" → "214 open total" — one site.
3. v1.0 §3: add bug-106 row to "Already-shipped v3 building blocks" table.
4. v1.0 §1.3: move bug-106 from FOLD (was open with isInternalCall fix shipped) to §3 (resolved + entity flipped).
5. v1.0 §1.x: add bug-117 (W5 anchor: `list_*` first-N cap) + bug-118 (W4 anchor: bug-lineage substrate-wide gap; **scope-revision per §1.1 of this companion**).
6. v1.0 §2.x: add the 4 cluster-surfaced ideas per §2.X of this companion (idea-69, idea-240, idea-241, idea-304).
7. v1.0 §2.8: replace the architect's named-6 set with the code-trace-substantiated 6 per §2.3 of this companion (swap idea-171 → idea-169).
8. v1.0 §4 tele primary mapping: lift tele-6 anchor per §6.2 DSV pattern (DSV-1..6 structural footprint per §6 of this companion).

---

## §6 · Sub-task 6 — friction inventory (Director-flagged addendum)

Unfiled lived-experience pain. Annotated by category, with workaround + suspected substrate cause + suggested fold path.

### §6.1 · Recurring frictions in current Threads-2 + substrate usage

| # | Friction | Workaround today | Suspected substrate cause | Fold path |
|---|---|---|---|---|
| F-1 | **`list_*` first-N=10 cap blocks exhaustive cross-ref** (engineer-side enrichment this pass; calibration #82-class) | Per-entity `get_*` paginate (220+ calls for 214 ideas) | `ResponseSummarizer` `maxItems: 10` + caller-limit only honored downward | New bug per §3.2; **W5 substrate** |
| F-2 | **Bug-entity lineage is substrate-wide unset (0 of 118 bugs have sourceThreadId; 100% gap)** — v1.0 framing of "cascade-action handlers drop" was too narrow; gap spans all filing paths. Compare ideas: 63/312 = 20% have sourceThreadId. | None — lineage filed inline in body text | code path looks correct (cascade handler passes `backlink`; repository persists it) — gap is operational: bugs are filed via Hub-system-emit paths that don't carry thread context. Substrate-side fix needed: capture thread context from calling session OR backfill from `surfacedBy` thread association. | bug-118 filed by architect post-PR-#257 (scope-revision needed per §1.1); **W4 cascade FSM (broader scope: bug-lineage substrate-wide gap, not cascade-handler-specific)** |
| F-3 | **`docs/operator/psql-cookbook.md` is escape-hatch but engineer-inaccessible** (no local psql binary; no cloud Hub psql connection string; substrate is sovereign architect-side only) | Use MCP-tool surface (hits F-1) | substrate-DX asymmetry — architect has cloud psql; engineer doesn't | Director-decidable: expose engineer-side read-only psql, OR architect-execute these enrichment passes |
| F-4 | **`create_thread_reply` parameter-ordering / antml-prefix slips** (bug-96 — 7+ instances cross-session per memory; this session: zero — discipline-substituted) | Manual XML-prefix discipline on every parameter | Tool validation accepts the mal-shaped XML silently; substrate doesn't enforce the parameter-tag prefix invariant | **bug-96 already filed; methodology-bypass-amplification class — W1 wire-contract** |
| F-5 | **Adapter-Restart Protocol doesn't extend to Hub container automatically** (per memory `feedback_adapter_restart_protocol_hub_container.md`) | Engineer-side discipline: build-hub.sh + start-hub.sh on Hub/src PRs | adapter-restart machinery doesn't recursively trigger Hub rebuild | Substrate gap — not v3-thread-relevant; cross-ref to mission-83 follow-ons |
| F-6 | **Schema-rename PRs silently break persisted state without migration scripts** (per memory `feedback_schema_rename_requires_state_migration.md`) | Pre-PR state-migration audit | substrate doesn't enforce schema-vs-state coherence; rename without migration is silently-broken | Substrate gap — composes with idea-295 (M-Hub-Storage-ResourceVersion) |
| F-7 | **`drain_pending_actions` filters to `enqueued` only**, hiding `receipt_acked` items from fresh-session pickup (per memory `reference_pending_action_queue_disk_inspection.md`) | Direct `local-state/pending-actions/*.json` inspection for full state | drain projection elides receipt_acked items; intentional but invisible | Composes with bug-60 (already FOLD); **W3 routing modes** |
| F-8 | **Thread-side `converged: true` ≠ GitHub-side `gh pr review --approve`** (per memory `feedback_thread_vs_github_approval_decoupled.md`) | Discipline: every PR cross-approval thread → also run `gh pr review --approve` | branch-protection last-pusher rule isn't reflected in the thread-converge mechanism | Methodology-side; **not v3-substrate** but flag in W5 docs |
| F-9 | **`get_engineer_status` reports `connected:0` + `status:offline` despite active sessions** (bug-40) | Direct `get-agents.sh` query | presence-projection drift | bug-40 (FOLD/COMPOSES §1.5); **already catalogued** |
| F-10 | **`list_tasks` sort by `id` is lexicographic, not numeric** (bug-13) | Sort by `createdAt` instead | `applyQuerySort` uses string comparison on `prefix-N` IDs | bug-13 (DEFER §1.6); **already catalogued** |
| F-11 | **`create_message`-style note-reply tool referenced in event-handler templates but absent from engineer tool surface** (this session: arch's note via event-handler said "respond via mcp__plugin_agent-adapter_proxy__create_message kind=note"; tool not found) | None — surfaced via subsequent thread or no response | tool-surface drift between adapter versions; event-handler templates assume tool-surface that doesn't exist | File new bug or absorb into idea-121 (API v2.0) |

### §6.2 · Discipline-substituting-for-substrate-validation patterns

These are instances of the `feedback_methodology_bypass_amplification_loop.md` 3-component test (methodology-bypass + render-gap + tool-surface-authority-boundary):

- **DSV-1 — bug-96 (canonical)**: `create_thread_reply` stagedActions XML tag must use `antml-prefixed` parameter tag; substrate accepts the malformed shape silently and discards. Discipline substitutes for substrate validation. **Already filed (bug-96, FOLD §1.1).**
- **DSV-2 — `list_*` first-N cap (§3.2)**: substrate silently caps results without honoring caller-`limit` upward; LLM-side discipline (paginate) substitutes. Engineer dogfooded this during the very enrichment pass.
- **DSV-3 — bug-entity lineage substrate-wide gap (§6.1 F-2; v1.1 scope-revised)**: substrate silently fails to populate `sourceThreadId` on ALL bug entities (0/118 = 100% gap), regardless of filing path. Distinct from bug-27 `documentRef`-drop (which is cascade-handler-specific). Lineage-in-body discipline substitutes universally for bugs.
- **DSV-4 — thread-vs-GitHub approval decoupling (F-8)**: substrate enforces thread convergence; GitHub branch-protection enforces last-pusher rule; the two don't compose. Discipline (run both) substitutes for a composed approval primitive.
- **DSV-5 — schema-rename without state-migration (F-6)**: substrate doesn't enforce schema-state coherence; engineer-side state-migration discipline substitutes.
- **DSV-6 — adapter-restart-doesn't-rebuild-Hub-container (F-5)**: adapter-restart-protocol doesn't compose with Hub-source PR class; engineer-side build+start discipline substitutes.

**Pattern observation:** the substrate's "deterministic invincibility" tele (tele-6) is undercounted in the cartography's tele primary mapping (v1.0 §4). Each DSV-N is a tele-6 violation by construction — substrate silently accepts the failure mode that discipline then has to catch. The cartography's tele-6 anchor cites 2 bugs + 2 ideas; the actual DSV footprint is 6+ — and most of the W1 (wire-contract) wave's scope IS retiring DSV instances structurally.

### §6.3 · Round-budget pressure

- **RB-1 — `maxRounds: 10` default with no easy mid-cycle bump.** Director-direct scope-expansion needs new thread (per memory `feedback_director_direct_scope_expansion_maxrounds.md` notes `maxRounds=15+` for substrate-rewrite cycles). idea-248 is the methodology-side fix; the substrate-side friction is the rigid default + no in-thread bump.
- **RB-2 — `bug-48` (FOLD §1.1) round_limit-vs-converged accounting** — convergence-at-final-round still classified `round_limit`; architect must independently reason "but converged=true so it's actually ratified." Catalogued.
- **RB-3 — Strict turn-taking blocks post-commit milestone replies** (per memory `feedback_pattern_a_engineer_turn_discipline.md`). idea-222 (relax to advisory) is filed FOLD §2.2.
- **RB-4 — Bilateral seal race** (bug-23, investigating §1.1) — engineer reply rejected after architect unilateral-converge triggers cascade-driven closure. Catalogued.
- **RB-5 — Ack-only courtesy rounds historically burned ~30% of round budget** (per memory `feedback_bilateral_audit_round_budget_discipline.md`). idea-248 is filed; methodology-side fix; substrate-side composes by NOT counting ack-only-no-stagedAction replies against the round budget (potential idea).
- **RB-6 — Engineer-pulse on ratify-direct missions is template-carryover** (per memory `feedback_engineer_pulse_template_carryover.md`). idea-247 (or similar) absorbs this; methodology-side.

### §6.4 · Other lived-experience friction (anything else)

- **AE-1 — Thread-engaged engineer dispatches missing scope sometimes need engineer-Director-consult surfacing** (per memory `feedback_ambiguity_class_triage_substrate_vs_mechanism.md`). When dispatch ambiguity touches operator-DX or wave-spanning architecture, engineer-side surfacing for Director-consult is load-bearing. Methodology-side; not v3-substrate but worth mention in §7 of cartography v1.1.
- **AE-2 — Per-mission work-trace as a standing engineer obligation** (per memory `feedback_per_mission_work_trace_obligation.md`). Engineer maintains `docs/traces/*-work-trace.md` live per mission; the substrate doesn't track this — discipline. Could compose with a Hub-side trace-entity primitive (idea candidate) but not v3-substrate scope.
- **AE-3 — Bug entity status doesn't auto-close on fix-commit** (§3.1 — bug-106 fix commit landed; entity still `status: open`). Substrate-side: cascade from `linkCommits` → entity status FSM doesn't auto-advance. Methodology-side: engineer-side close-after-merge discipline substitutes. Sibling of idea-282 (M-Automated-post-merge-cascade) which is filed DEFER §2.7.
- **AE-4 — Cognitive-layer ResponseSummarizer + ToolResultCache compose with non-obvious semantics.** The bypass logic (caller-`limit`, internal-call, `perToolMaxItems`) is in `response-summarizer.ts:198-228` — caller has to know all three escape hatches to predict whether their list call will be truncated. Engineer-side, this is opaque without code-grep. Documentation surface gap.
- **AE-5 — `create_message kind=note` referenced in event-handler templates but absent from current tool surface** (F-11 instance). Tool-surface drift between adapter version (which the templates were authored against) and the current engineer adapter. Composes with idea-121 (API v2.0 tool-surface modernization).

### §6.5 · Synthesis — what the friction inventory tells the SR

1. **The cartography's tele-6 anchor is undercounted.** DSV-1..6 is the structural list; cartography v1.0 lists bug-96, bug-48, bug-61 + 2 ideas. v3 W1 (wire-contract) is the natural home for DSV retirement.
2. **The "predicted second victim" from bug-115 is realized.** §3.2 is the W5 substrate work; idea-152 is the longer horizon.
3. **Lineage-graph sparseness blocks ledger-driven analysis.** §6.1 F-2 + DSV-3 says the cartography's reliance on title-grep is structural, not engineer-laziness — the substrate doesn't populate the lineage graph for cascade-spawned entities.
4. **Substrate-DX asymmetry between architect (cloud psql) and engineer (MCP only) is real.** §6.1 F-3 is Director-decidable; either expose psql engineer-side OR formally split the cartography labour (architect = ledger-anchored; engineer = code-anchored).
5. **Round-budget pressure (§6.3) is composed of methodology-side fixes (already filed) + a residual substrate gap** (mid-cycle bump primitive). The residual is small but worth naming in W4 (cascade FSM) scope.

---

## §7 · Recommended v1.1 integration

For the architect's mechanical v1.1 in-place fold of cartography v1.0:

1. **Promote bug-106 to "already-shipped"** (§3 of v1.0) per §3.1 — entity status confirmed `resolved`.
2. **Anchor bug-117 + bug-118 in v1.0 §1** per §3.2 + §1.1 — bug-117 is the W5 anchor (`list_*` cap class); bug-118 needs **scope-revision** per §1.1 finding 1 (substrate-wide bug-lineage gap, not cascade-handler-specific).
3. **Replace v1.0 §2.8 named-6 with code-trace-substantiated 6** per §2.3 — swap idea-171 (WF-006 Mission Lifecycle) → idea-169 (WF-005a Architect LLM convergence).
4. **Add 4 cluster-surfaced COMPOSES ideas** per §2.X — idea-69, idea-240, idea-241, idea-304.
5. **File new idea for INV-SYS-018 coverage gap** per §2.2 — currently uncovered; thread-convergence dedup invariant.
6. **Update §4 tele primary mapping** to elevate tele-6 — DSV-1..6 is the structural footprint, not 2+2.
7. **Update §6 W5 scope** per §4 here — `list_*` caller-limit honesty (bug-117) is the named substrate work; complements the broader idea-152 (Smart NIC) horizon.
8. **Fix ledger-currency counts** per §5 — 47 bugs (46 + 1 investigating); 214 ideas; +bug-117 +bug-118 in v3 surface; +4 cluster-surfaced ideas.

Engineer's recommendation: companion file (this one, now v1.1-current) stays on its own as the durable engineer-side input — preserves the friction inventory + DSV pattern surface + lineage-graph substantiation + cluster-surfacing analysis. v1.1 in-place edit of v1.0 absorbs (1)–(8) above. SR follows the v1.1 fold.

---

## Provenance

- **v1.0 / 2026-05-23**: Architect dispatch thread-619 (sub-tasks 1–5) + Director-flagged Item 6 addendum (note `01KS9189ZJK9YTFYS1TAWQE4VJ`); engineer (apnex-greg); PR #257 merged as `c644838`.
- **v1.1 / 2026-05-23 retrospective sub-task 1 pass**: Director-approved Path 1 commission dispatched by architect on thread-622; engineer-side substrate-DX A.2 capability shipped via PR #258 (`2858d0f`) unblocks the substantive lineage cross-ref that was structurally PARTIAL in v1.0. This v1.1 revision lands as a separate PR + cross-approval thread.
- Anchor: idea-312 (M-Threads-v3 umbrella).
- Authoring window: 2026-05-23 AEST (single session, post-PR-#258 merge).
