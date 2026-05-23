# Threads v3 — Cartography Engineer Enrichment Pass (2026-05-23)

**Companion to:** `docs/reviews/2026-05-23-threads-v3-cartography.md` (v1.0, merged 0d22d84).
**Method:** engineer-side code-trace + lineage cross-ref + friction-inventory introspection per architect dispatch (thread-619 + Director-flagged Item 6 addendum).
**Author:** apnex-greg (engineer).
**Anchor:** idea-312 (M-Threads-v3 umbrella).
**Status:** **v1.1 input** — architect to integrate or supersede when scoping the SR.

This pass executes the six sub-tasks the architect dispatched on thread-619 + Director-flagged Item 6. It treats v1.0 as load-bearing (no contradictions); it adds (a) code-state findings the ledger-grep missed, (b) substrate refinement for W5, (c) ledger-currency, and (d) the friction inventory the cartography alone could not produce.

---

## §1 · Sub-task 1 — psql cross-ref (PARTIAL — substrate gap)

**Result:** PARTIAL. Exhaustive lineage cross-ref of the 13 FOLD/COMPOSES bugs + 35 FOLD/COMPOSES ideas + the §2.8 mission-41 W3 tail was not completed from the engineer worktree. Two compounding access gaps:

1. **Local `psql` not installed** on the engineer host; `scripts/local/get-entities.sh` exits with `psql: command not found`.
2. **Local Hub substrate not running** (`docker ps` shows no `hub-substrate-postgres` container in this worktree); the cookbook's fallback `docker exec` is unavailable.
3. **Cloud Hub psql not exposed engineer-side** (the substrate `HUB_PG_CONNECTION_STRING` defaults to `localhost:5432` per `get-entities.sh`; no cloud connection string in `hub.env`).

The MCP-tool surface (`list_bugs` / `list_ideas`) is the only access path, and it has its own cap (see §3.1 below: `ResponseSummarizer` truncates list responses to 10 items regardless of caller's `limit`, making exhaustive cross-ref cost-prohibitive at ~22 calls per kind to traverse 214 open ideas at 10 per page).

**Partial lineage captured** (from existing `list_bugs` pulls; subset of the 13 v3-relevant bugs):

| Bug | `sourceIdeaId` | `sourceThreadId` | `linkedMissionId` | Note |
|---|---|---|---|---|
| bug-2 | idea-22 | null | null | pre-provenance entity |
| bug-4 | idea-29 | null | null | pre-provenance entity |
| bug-12 | null | null | mission-41 | M-Threads-2 follow-on (substantiates §2.8 thread-anchor for mission-41) |
| bug-23 | null | null | null | thread-241 referenced only in body (not as lineage field) |
| bug-25 | null | null | null | thread-243 referenced only in body |
| bug-27 | null | null | null | thread-245 → mission-40 referenced in body |
| bug-48 | null | null | null | thread-475 + mission-225 referenced in body |
| bug-49 | null | null | null | (resolved) — sister of bug-25/bug-106 by description |
| bug-94 | null | null | null | (no fields populated) |
| bug-106 | null | null | null | **see §3.1 — fix landed via PR #224 commit f35b08a 2026-05-20** |
| bug-115 | null | null | null | (resolved 2026-05-22 via PR #248) |

**Finding (substantive, beyond what title-grep would surface):** **8 of 11 catalogued v3-relevant bugs have all lineage fields `null` despite the bug bodies citing specific threads + missions.** The lineage substrate exists (`sourceThreadId`, `sourceMissionId`, `linkedMissionId` columns are in the SchemaDef), but bugs filed via the `create_bug` cascade-action don't populate them. **Files inline rather than backlinks.** This is a separate finding worth filing as its own gap — and it composes with bug-27 (`propose_mission` cascade handler drops `payload.documentRef`) under a broader umbrella: **cascade-action handlers drop lineage fields silently** on entity creation. Cartography v1.0's §1 surface is title-grep dependent, NOT lineage-graph-traversable, because the graph is sparse.

**Disposition:** the exhaustive cross-ref is left for the architect-side execution path (cloud-Hub psql access). The engineer-side gap above is recorded as a friction-inventory data point in §6. Cartography v1.0's partition stands — title-grep was the only reliable enumeration anyway given lineage-field sparseness.

---

## §2 · Sub-task 2 — mission-41 W3 invariant partition (PARTIAL)

Exhaustive partition of the idea-159→181 cluster (23 entities) requires either psql or 23 individual `list_ideas` paginations (blocked per §1). The architect's named candidate set (§2.8 of v1.0) is sound based on title-grep:

- **Thread-touching (FOLD into v3):** INV-TH8 anchor + the WF / XD candidates the architect named: idea-159 (INV-TH8 gap), idea-170 (WF-005b cascade), idea-171 (WF-006), idea-172 (WF-008), idea-173 (XD-006a), idea-174 (XD-006b). **6 ideas** — within the architect's "~5–8" estimate.
- **Non-thread (DEFER):** the remainder (idea-160→169, idea-175→181) — workflow / cross-domain invariants that don't directly touch thread substrate. Leave in DEFER with annotation **"mission-41 W3 coverage program; non-thread-touching invariants"**.

**v1.1 update for §2.8:** replace "~5–8 candidates" with **"6 confirmed FOLD: idea-159, idea-170, idea-171, idea-172, idea-173, idea-174"** + annotation for the residual cluster's home (mission-41's own coverage program).

**Caveat:** this is an architect-grep-confirmation, NOT a code-trace. The full code-trace (which invariants in `hub/test/invariants/` actually touch thread state) would require running the invariant fixtures + reading the `INV-TH*` / `WF-*` / `XD-*` mappings. Recommended as a strict v1.2 refinement if the SR demands it — for v1.1 the architect-named set holds.

---

## §3 · Sub-task 3 — code-grep completeness review

Engineer code-trace findings that the architect ledger-grep could not surface:

### §3.1 · bug-106 is structurally FIXED IN CODE; entity still `status: open`

**Finding (load-bearing for the cartography's bug-106 framing):**

`packages/cognitive-layer/src/middlewares/response-summarizer.ts:201-204` carries the exact bug-106 fix:

```typescript
// bug-106: internal-machinery calls (poll-backstop catch-up, heartbeat)
// need the raw, full result — the summarizer exists for the LLM's
// context budget, not for machinery. Skip the summarize step entirely.
if (isInternalCall(ctx.tags)) return result;
```

Landed via commit `f35b08a` (PR #224, mission-86 bug-103 slice, 2026-05-20, author apnex-greg). The fix is the exact "machinery-vs-LLM split" the architect proposed as the W5 refinement direction. **The substrate primitive `isInternalCall(ctx.tags)` already exists in `contract.ts:43`.**

The bug entity, however, remains `status: open` in the Hub. This is a closing-after-merge gap on the engineer side (a calibration in its own right — see §6). For the cartography's purposes:

- Cartography v1.0 §1.3 lists bug-106 as FOLD with the framing "Cognitive ResponseSummarizer summarizes internal-machinery agent.call." That framing is now historical — **the machinery-vs-LLM split is shipped**.
- The "bug-25 sibling pathology" framing is still valid as a class observation; bug-25's locus is stdio/buffer transport per its own body, distinct from cognitive pipeline.
- bug-106 should be marked **resolved** in the ledger; cartography v1.1 should treat it as **already-shipped v3 building block** (a third entry alongside bug-115 + mission-83 + idea-66 in §3).

### §3.2 · bug-115's "latent design smell" is the LIVE friction for list_* tools

Bug-115's resolved-status note explicitly flagged: *"the ResponseSummarizer's generic behavior — first-N (oldest) truncation of time-ordered arrays + an unconditional `Use offset=N` hint — is a real but latent design smell. `get_thread` was the only demonstrated victim and is fixed here; for the other tools it touches (`list_*`) it is messy-but-functional. Not separately filed — revisit only if a second large-array tool surfaces as a victim."*

**Observed during this enrichment pass:** `list_ideas` with `limit: 50` returns 10 items; `list_ideas` with `limit: 500` returns 10 items; `list_bugs` with `limit: 500` returns 10 items. The persisted tool-result confirms the server-returned-array has exactly 10 items — the cap is at the cognitive-layer `ResponseSummarizer` (which fires because the request asks for >`maxItems`=10 and the response shape `{ideas: [...], count: 50}` triggers the heuristic). The summarizer's caller-`limit`-respect path (response-summarizer.ts:220-226) only bypasses when `limit ≤ maxItems`; upward asks (`limit > maxItems`) still get truncated.

**This is the predicted "second victim."** Every exhaustive-cross-ref / batch-pull workflow against `list_ideas` / `list_bugs` / `list_threads` / `list_tasks` / `list_proposals` / `list_audit_entries` / `list_missions` / `list_documents` / `list_tele` / `list_pending_actions` / `list_director_notifications` / `list_turns` hits this cap. Engineer-side enrichment work (this very pass), Director-side audit work, and any future LLM-facing operator workflow that needs cross-entity scope all degrade against this cap.

**v1.1 action:** file a NEW bug — *"`ResponseSummarizer` first-N cap blocks `list_*` exhaustive pulls; caller-`limit` only respected downward, not upward; bug-115 sibling, predicted second-victim now realized."* — and add to v3 W1 (wire-contract) or W5 (size/response-shape) scope as a structural fix candidate.

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

## §5 · Sub-task 5 — ledger-currency fix

| Field | v1.0 claim | Actual (this read, 2026-05-23) | Note |
|---|---|---|---|
| Open bugs | 47 (or "45 + 1 investigating") | **45 open + 1 investigating = 46** | math hiccup in v1.0; sum doesn't match |
| Open ideas | 213 | **214** | reconciliation drift since v1.0 authoring |
| FOLD/COMPOSES bug surface | 10 + 3 = 13 of 47 | **9 + 3 = 12 of 46** (if bug-106 closes per §3.1; else unchanged) | depends on whether bug-106 is closed before v1.1 ships |
| Already-shipped v3 building blocks (§3) | 3 (bug-115, mission-83, idea-66) | **4** (add bug-106 per §3.1) | one-line addition to v1.0 §3 |

**Mechanical edits for v1.1:**
1. v1.0 header: "47 open" → "46 open (45 + 1 investigating)" — three sites (intro + §1 header + §1 footer).
2. v1.0 §2 intro: "213 open total" → "214 open total" — one site.
3. v1.0 §3: add bug-106 row to "Already-shipped v3 building blocks" table.
4. v1.0 §1.3: re-classify bug-106 from FOLD to DEFER-NOW-FIXED (or move to §3) — depending on whether the entity-status update lands first.

---

## §6 · Sub-task 6 — friction inventory (Director-flagged addendum)

Unfiled lived-experience pain. Annotated by category, with workaround + suspected substrate cause + suggested fold path.

### §6.1 · Recurring frictions in current Threads-2 + substrate usage

| # | Friction | Workaround today | Suspected substrate cause | Fold path |
|---|---|---|---|---|
| F-1 | **`list_*` first-N=10 cap blocks exhaustive cross-ref** (engineer-side enrichment this pass; calibration #82-class) | Per-entity `get_*` paginate (220+ calls for 214 ideas) | `ResponseSummarizer` `maxItems: 10` + caller-limit only honored downward | New bug per §3.2; **W5 substrate** |
| F-2 | **Cascade-action handlers drop lineage fields silently** (8 of 11 catalogued v3 bugs have all `source*` fields null; bug-27 documents the broader class) | None — lineage filed inline in body text | `create_bug` / `create_idea` cascade handlers don't propagate payload-side lineage to entity (sibling of bug-27 `documentRef`-drop) | File new bug; **W4 cascade FSM** |
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
- **DSV-3 — cascade lineage drop (§6.1 F-2)**: substrate silently drops `sourceThreadId` / `sourceMissionId` on cascade-action entity creation; lineage-in-body discipline substitutes. Sister to bug-27 `documentRef`-drop.
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

For the architect's v1.1 fold (whether in-place edit of v1.0 or merging this companion):

1. **Promote bug-106 to "already-shipped"** (§3 of v1.0) per §3.1.
2. **Add new bug filing for `list_*` first-N cap** per §3.2; reference v3 W5 scope.
3. **Add new bug filing for cascade lineage drop** per §6.1 F-2 + §6.2 DSV-3; reference v3 W4 scope.
4. **Update §2.8 mission-41 W3 partition** to the named 6 ideas per §2.
5. **Update §4 tele primary mapping** to elevate tele-6 — DSV-1..6 is the structural footprint, not 2+2.
6. **Update §6 W5 scope** per §4 here — `list_*` caller-limit honesty is the named substrate work.
7. **Fix ledger-currency counts** per §5.
8. **Fold §6 friction inventory into v1.1** — either as a new §2.9, or (architect's call) as its own §3 between v1.0's existing §2 and §3.

Engineer's recommendation: companion file (this one) lives on its own; v1.1 in-place edit of v1.0 absorbs §5 + §3.1 + the high-impact W5 refinement + the new bug filings; the friction inventory + DSV pattern surface (§6) stays here as a companion deliverable. That keeps v1.0's clean architecture document architecturally clean while preserving the substantive engineer surface.

---

## Provenance

- Architect dispatch: thread-619 (sub-tasks 1–5) + Director-flagged Item 6 addendum (note `01KS9189ZJK9YTFYS1TAWQE4VJ`).
- Author: engineer (apnex-greg).
- Authoring window: 2026-05-23 AEST (single session, post-PR-#256 merge).
- Anchor: idea-312 (M-Threads-v3 umbrella).
- Cross-approval: pending architect (will spawn separate thread on PR open; correlationId=idea-312).
