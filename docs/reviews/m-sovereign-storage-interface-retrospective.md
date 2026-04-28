# Mission-47 M-Sovereign-Storage-Interface — Architect Retrospective

**Status:** engineer-side complete (11 PRs merged); T5 architect-side closing audit + mission-status flip remain as fresh-session work.
**Authored:** 2026-04-24 post-T4 landing. For Director discussion next session.
**Scope of this doc:** architect's reflection on what shipped, what worked, what broke, and what to discuss. Separate from greg's engineer-side T5 closing audit (which lives at `docs/audits/m-sovereign-storage-interface-closing-report.md`, pending).

---

## 1. What shipped

**11 PRs merged in one day** — the whole mission-47 core + T3 + T4:

| PR | Scope | Merged |
|---|---|---|
| #10 | T1 — contract + 3 providers + conformance suite + ADR-024 | earlier session |
| #11 | T2-W1 — tele repository | earlier session |
| #12 | T2-W2 — bug + idea | 10:51 |
| #13 | T2-W3 — director-notification | 11:36 |
| #14 | T2-W4 — mission | 11:46 |
| #15 | T2-W5 — task + proposal | 11:49 |
| #16 | T2-W6 — thread | 11:52 |
| #17 | T2-W7a — turn + pending-action | 11:53 |
| #18 | T2-W7b — agent + INV-COMMS-L03 correctness fix | 11:55 |
| #19 | T3 — sync script + `STORAGE_BACKEND=local-fs` wiring | 11:56 |
| #20 | T4 — comparative latency measurement | 12:18 |

**Architectural deliverables:**
- `packages/storage-provider/` — third sovereign package alongside `@apnex/network-adapter` + `@apnex/cognitive-layer`
- Six-primitive `StorageProvider` contract (`get / list / delete / put / createOnly / putIfMatch`) with capability-gating (`cas / durable / concurrent`)
- 11 entity stores unified under a single `*Repository` pattern over the provider; `hub/src/entities/gcs/` directory eliminated
- Bonus **INV-COMMS-L03 correctness fix** (Memory/Gcs read-time liveness-recompute divergence closed as emergent property of unification)
- Local-fs backend usable end-to-end via `STORAGE_BACKEND=local-fs` + `scripts/state-sync.sh` (gsutil rsync mirror)
- T4 per-op latency decomposition published at `docs/history/mission-47-t4-latency-results.md`
- ADR-024 ratifies the sovereign StorageProvider pattern

**Quantitative outcomes:**
- Hub test suite 706/711 pass throughout (725 pre-mission; -15 delta is obsolete `Gcs*Store` P2 reproductions removed — equivalent coverage now in storage-provider conformance suite)
- Zero behavioral regressions in GCS prod path
- Zero contract leaks across 7 waves
- Honest-flag never triggered
- Memory → local-fs latency ratio: 5× (list-small) to **148× (putIfMatch-contention)**. CAS-contention is the headline.

---

## 2. What worked (architectural wins)

### 2.1 Contract survived its load-bearing test

The success criterion was: *"if entity code needs to know anything backend-specific after the refactor, the abstraction has leaked and we've failed the sovereign property."*

Across 11 entity migrations, the contract required zero escape hatches. No `instanceof GcsStorageProvider`. No non-contract method calls. No entity-specific provider wrappers. The 6-primitive surface held — including for the three entities with the most concurrency (turn, pending-action, agent) that drove the L-escalation-pre-authorization clause.

This is tele-3 Sovereign Composition's first empirical validation beyond Universal Adapter. Two sovereign packages × two successful pattern-instantiations → the pattern is repeatable, not one-off.

### 2.2 Design round surfaced the right contract

Thread-290 (idea-189 → mission-47 design round) took ~90 minutes of architect+engineer brainstorming. Engineer's audit found ~60 CAS sites across 8 entities I hadn't enumerated correctly. Three material changes to my initial sketch came from that round:

1. `createOnly` added as first-class primitive (not overloaded via `putIfMatch(token="<nonexistent>")`)
2. Capability-gated CAS reframed as prod-floor discipline (cas:false is dev-only, not a deployment option)
3. Counter management kept at repository layer (composition of `get + putIfMatch + retry`), not contract-level

Without those three, the contract would have accumulated ceremony + leaked semantics. The Idea → Design → Mission workflow earned its cost here — this is the ratified flow's first real test on a complex scope.

### 2.3 INV-COMMS-L03 emergent correctness

`MemoryEngineerRegistry` wrapped `getAgent / getAgentForSession / listAgents` with `computeLivenessState` read-time recompute. `GcsEngineerRegistry` didn't. The Memory-path tests masked the divergence. Production was silently broken against INV-COMMS-L03 for however long the split implementations persisted.

Unification surfaced it. Greg's W7b ported the Memory semantics to `AgentRepository` as a bonus correctness-fix. This is the cleanest possible architectural argument for Sovereign Composition: *the unified contract produced a bug fix as an emergent property of removing the silent divergence between backends*.

### 2.4 Engineer audit discipline

Greg's design-round audit didn't just answer my questions — it made the contract provably cheaper. His "cas:false is dev-only" reframe tightened the capability system. His counter-as-repository-helper call kept provider surface minimal. His migration sequencing (tele first as contract-validation ground) caught the risk concentration correctly. His per-wave ship-green discipline across 7 waves produced zero regressions.

This is the engineer mode we want. It's also the mode that makes architect design-rounds worth attending honestly — pushback is a feature, not friction.

---

## 3. What broke (process + workflow failures)

### 3.1 Merge cadence drifted (the big one)

The intended flow: each wave completes → PR opens → CODEOWNERS review → merge → stack auto-flips → next wave. We agreed to this in thread-291 §routine-waves as "Option C hybrid."

What actually happened: PR #12 merged. Then waves W3-W6 + W7a + W7b + T3 all shipped as stacked PRs without any merging between. Stack hit 7 deep (#13-#19) before anyone noticed. When merging finally started (post Director flag), PR #13 was conflicting with main (classic stacked-PR post-squash divergence).

**Root cause — engineer + architect both contributed:**
- Greg treated "merge #12" as a one-off commitment rather than a cadence-start.
- Thread-297 → thread-298 (workflow diagnostic about "fresh session" + W7b) interrupted the merge cycle; neither of us returned to it.
- Architect didn't track outstanding unmerged PRs proactively; assumed each wave would land as it was reviewed.

**Recovery took ~1 hour:** rebase cascade + 6 re-approvals + batch-retarget misfire + reopen PR #15 after head==base auto-close + coverage-report-drift on T4.

**Lesson captured:** greg saved `feedback_stacked_pr_merge_cadence.md` — "default fresh-off-main per task; stacked only when real dependency forces it; if stacked, merge cadence is n commitments not one." Convention adopted for T4 (shipped fresh-off-main; no issues).

### 3.2 Session-wake primitive doesn't exist (human-in-the-loop is the only kickoff)

Thread-298 diagnosed this fully. Greg's mechanical truth: Claude Code instances exist only inside active user conversations. Hub notifications deliver only during active turns. There is no way for the Hub to wake an agent. "Fresh session" = human types into Claude Code CLI.

Consequences seen in this mission:
- Greg's "defer to fresh session" for W7b was self-imposed budget-prudence, not a mechanical session-end. Director's interrogation surfaced the over-caution.
- Thread-301 needed me to ping greg after a mid-cascade PR-approval dismissal; he had stopped waiting silently rather than flagging.
- Thread-295 routing mismatch (`recipientAgentId: "lily"` vs `eng-40903c59d19f`) required a fresh thread to unblock because Hub accepted the alias at open but turn-check rejected strict engineer-id.

The structural fix is not in mission-47's scope. It's the pending ACP / universal-adapter rework territory (idea-121 tool-surface v2.0 + idea-187 CI/process-architecture). This mission captured the gap; it didn't close it.

**Calibration landed meanwhile:** "defer" is for mechanical session-end, not self-estimated budget-tight. If engineer feels budget-tight, flag explicitly in a thread for Director/architect decision. Don't unilaterally pause.

### 3.3 CI infrastructure gaps compounded

Three separate CI-infrastructure incidents during this mission:

1. **PR #11 W1 — `prepare: tsc` trap.** `packages/storage-provider/` ran `tsc` during hub's `npm ci`, hit missing `@types/node` + `@google-cloud/storage`. Took two fix iterations to resolve (first attempt commit-dist-alone was insufficient; second removed `prepare: tsc` + committed dist).
2. **PR #4 earlier (mission-46 adjacent) — merge queue hang.** Branch protection ruleset required merge queue; workflows didn't subscribe to `merge_group` events. PR sat indefinitely in AWAITING_CHECKS. Director removed the merge-queue rule; captured in idea-187.
3. **PR #20 T4 — coverage-report scanner drift.** `docs/audits/workflow-test-coverage.md` drifted because test-sweep shifted line numbers on `INV-T4` and `INV-TH6` assertions. Mechanical regen fixed it.

All three are idea-187 strategic-review territory. Mission-47 revealed them; didn't fix them. Note: the `--delete-branch` race (branch not deleted post-merge when recent force-push happened) is adjacent to this class and appeared 6+ times during the cascade unwind.

### 3.4 Director had to intervene three times

- Thread-294: CI stuck red on PR #11; architect was waiting passively for a signal that wasn't coming.
- Thread-298: greg's "queued" language obscured that he was already in-session + over-cautious on budget.
- Thread-300: stack accumulated without merging; neither of us noticed until Director flagged.

Each intervention surfaced a real calibration gap. But in a truly autonomous mission, Director shouldn't need to flag at all — the intervention rate is the signal that autonomous discipline is imperfect.

**Calibration commitments landed in this mission:**
- 5-min architect proactive-ping when CI stuck red with no push
- Decidable-by-counterparty rule: engineer flags budget-tight explicitly rather than unilaterally pausing
- Wave-completes → merge-cascade: n commitments, not one
- Asymmetric escalation: engineer owns PR CI; architect backstops at 5-min threshold

---

## 4. Empirical findings worth strategic discussion

### 4.1 T4 latency decomposition

Memory baseline → local-fs, p50:

| Op | Ratio | Implication |
|---|---|---|
| `createOnly` | 64× | new-entity-ID writes pay 64× per call |
| `get` | 35× | reads are the "cheapest" slow-path |
| `put` | 54× | unconditional writes |
| `putIfMatch` happy | 52× | normal CAS |
| **`putIfMatch` contention** | **148×** | **hottest path — headline finding** |
| `list-small` (20) | 5× | list is sublinearly sensitive |
| `list-large` (200) | 16× | bug-29 territory at scale |

**Idea-188 sizing input:** adapter-local lazy-sync with a sync-queue to Hub-remote would trade a ~50-150× memory→local-fs cost for local microsecond-class operations + periodic sync. That's materially different from "fix the slow storage" — it reframes idea-188 as "keep operations on the microsecond side of the 50-150× wall."

**GCS measurement deferred** (session lacked bucket credentials). Harness supports `gcs <bucket>` for operator-run; expected GCS adds another network-RTT dimension (~ms to tens-of-ms) on top of the local-fs profile.

### 4.2 CAS is the prod floor

Greg's audit found ~60 CAS sites across 8 entities. `cas:false` providers are dev-only, not a deployment option — the practical truth is every real backend needs CAS. The capability-gate stays in the type system for design discipline + dev-backend support (memory, tests), but the "minimum viable prod backend" bar is cas:true + durable:true.

**Implication for future backends:** sqlite? cas-trivial (transaction). Redis? cas via WATCH/MULTI. Postgres? cas via row-version or generation columns. The abstraction filters out backends that can't CAS — correctly.

### 4.3 Contract surface held at 6 primitives

The design round resisted the temptation to add `watch` (no entity needed it), `batch` (no cross-blob transactions surfaced), `incrementCounter` (kept at repository layer). The minimal surface survived 11 migrations. Worth restating in future sovereign-package work: **contract minimalism is earned, not designed — start minimal, resist additions until a real consumer demands it.**

---

## 5. Ideas filed or reinforced this mission

- **idea-189** (filed → mission-47, shipped) — Sovereign StorageProvider
- **idea-188** (MCP entity latency lazy-sync) — now has empirical T4 data as sizing input
- **idea-187** (CI + merge-gate redesign) — three incidents in this mission reinforce it (prepare:tsc trap, merge-queue hang, scanner drift, --delete-branch race)
- **idea-121** (tool-surface v2.0) — session-wake primitive + alias-resolution + create_task role-gate all feed this

---

## 6. Points for Director discussion next session

Ordered by my opinion of importance:

1. **Methodology v1.0 ratification status.** Mission-47 is the second worked-example after mission-43 / mission-46 for the trunk-based PR workflow. Ready to ratify v1.0 → v1.0-ratified with the specific additions this mission generated: stacked-PR cadence convention, --delete-branch race handling, coverage-regen-before-push discipline, dismiss_stale_reviews_on_push semantics, asymmetric-escalation rule (engineer-owns-CI, architect-5min-ping-backstop). Or is there more to learn before ratification?

2. **Session-wake primitive priority.** Three incidents this mission were downstream of "no session-wake exists." At what point does this become a prioritized mission rather than strategic-review-input? Is the pending ACP / universal-adapter rework the right home, or does it deserve a focused scope?

3. **idea-188 next-step.** T4's per-op decomposition is strong sizing data. Does that reshape idea-188's proposed shape (currently "entities adapter-local, lazy sync to Hub") or justify promoting it to mission-candidate? Or hold until idea-187 + methodology v1.0 are settled first?

4. **CI architecture.** Three incidents this mission + mission-46's merge-queue removal = a pattern. idea-187's scope is right; its priority relative to idea-188 + session-wake is the open question.

5. **T5 closing mechanics.** Mission-47 engineer-side is done but architect-side T5 (closing audit review + mission-status flip) remains. Does Director want T5 worked in a fresh session with me, or bundled into a broader strategic-review pass?

6. **GCS measurement.** Should we prioritize operator-run of the T4 harness against a test GCS bucket before T5 closes? The deferred measurement is a real gap for idea-188 sizing but not a mission-47-completion blocker.

7. **Packaging maturity** (not mission-47 scope but adjacent from our earlier conversation). Three sovereign packages now exist — network-adapter, cognitive-layer, storage-provider. When does workspace migration + selective publishing become a mission rather than a conversation?

---

## 7. What I'd do differently (architect self-critique)

- **Tracked outstanding-unmerged-PRs more proactively.** I assumed wave-by-wave merging would happen naturally. It didn't, and I didn't notice until Director flagged. Adopted for future: check the PR-open count at each checkpoint thread; flag non-zero-backlog explicitly.
- **Pushed back on greg's stack-compression earlier.** When W2-W6 shipped as a single stack without intermediate merges, that was the moment to ask "why are 5 PRs open at once?" I didn't, and it compounded into the cascade-unwind.
- **Faster on the 5-min ping rule.** I committed to it in thread-294, then didn't operationalize until Director flagged again in thread-300. Discipline drifted under the cadence; need to make the 5-min check genuinely automatic.
- **Better at detecting engineer-self-blocking language.** Greg's "queued" and "stopped" both masked an over-caution that a direct probe surfaced quickly. Would've caught these earlier with a "what's actually blocking you mechanically?" probe rather than waiting for Director flag.

---

## 8. What went surprisingly well (architect's honest take)

- **Speed.** 11 PRs in one session. Previous missions (mission-43, mission-46) took comparable wall-clock for materially smaller scope. The Idea → Design → Mission discipline paid its latency cost: once the design round landed, execution was fast.
- **No contract drift.** 7 waves is a lot of entity-migration opportunities for the contract to prove wrong. It didn't. That's a strong architectural signal.
- **INV-COMMS-L03 fix as a bonus.** You can't plan for emergent correctness. When it happens, it's the mission's most honest validation.
- **Greg's audit rigor in the design round.** The 60-CAS-site enumeration + capability-floor reframe + counter-layer call were all his, unsolicited. That's the engineer mode that makes sovereign contracts land correctly on first try.

---

## 9. Mission-47 closing state

- Engineer-side work: **complete** (11 PRs merged, zero open branches, 706/711 test baseline preserved)
- Architect-side T5: **pending** fresh-session (closing audit + mission-status flip to `completed`)
- Mission entity status: `active` (will flip to `completed` post-T5)
- Retrospective capture list for T5 closing audit: 7 items drafted inline in thread-302 for cold-session pickup

---

*For discussion next session.*
