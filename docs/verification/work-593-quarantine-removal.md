# work-593 (B5) — removing the `[A]` agent claim-thrash quarantine

**Seat:** engineer `agent-0d2c690e` · **Tree:** branched from `origin/main@50b01e96` · **Date:** 2026-07-28
**Target:** idea-675 · **B6 (`work-594`) stands on this.**

---

## 1. WHICH MECHANISM — established before anything was removed

`quarantined` names **two unrelated mechanisms** in this repo. The runbook made establishing
which one the first obligation, and it is the failure mode most likely to go unnoticed,
because a text search cannot tell them apart.

| | `[A]` **agent claim-thrash** | `[C84]` **cal-84 bare-envelope** |
|---|---|---|
| Subject | an **Agent** | a **row** (WorkItem, Message, …) |
| Trigger | N consecutive lease expiries without evidence | a structurally undecodable stored envelope |
| Field | `Agent.quarantined` | per-row terminal quarantine |
| Escape | `clear_work_quarantine` (architect-only) | escalation + repair |
| **This node** | 🔴 **REMOVED** | ✅ **UNTOUCHED** |

They collide in one file. `work-item-lease-sweeper.ts` has a `result.quarantined` counter
that is **`[C84]`** and a `result.agentsQuarantined` counter that is **`[A]`** — adjacent, in
the same result object. Only `agentsQuarantined` was touched (renamed `agentsThrashed`).

⚠️ **`[C84]` files deliberately left alone:** `bare-envelope-error.ts`,
`bare-envelope-escalation.ts`, `cascade-replay-sweeper.ts`, `scheduled-message-sweeper.ts`,
`message-projection-sweeper.ts`, `thread-repository-substrate.ts`, and their suites.

---

## 2. WHY — the alarm, not the annoyance

`work-580` found that quarantine **suppresses the liveness alarm exactly when it matters**.
The chain, re-derived in this tree:

```
agent quarantined
  → get_next_action returns {nextAction: null, emptyReason: "quarantined"}
  → driver-liveness-watchdog hasCallerGate() === true
  → verdict: suppressed / caller_gated
  → NOBODY IS TOLD
```

**The mechanism that locked a seat out also silenced the only alarm that would have reported
it.** A seat that could not work at all produced the same watchdog verdict as a seat that was
merely busy. bug-382 measured the aggravating case: a seat quarantined by a lease expiry it
did **not** cause, with `[architect|director]` RBAC standing between it and any escape — an
engineer could not self-clear.

**The watchdog will get louder after this lands. That is the point, not a regression.**
No replacement suppression was added.

---

## 3. WHAT WAS REMOVED / KEPT / LEFT ALONE

**Removed (`[A]` only):** the `claim_work` gate · the `list_ready_work(scopeToCaller)` digest
short-circuit · the `get_next_action` caller gate · the `clear_work_quarantine` handler **and
its registration** · the `message-consumption-projection` evaluator overlay + context
short-circuit · the sweeper's cap→quarantine branch and its audit · `clearWorkItemQuarantine`
from the substrate and `IEngineerRegistry` · `"quarantined"` from the `ReadyEmptyReason` union
and from `hasCallerGate`.

**KEPT — `thrashCount` still writes.** Director ruling: useful as a metric. `recordWorkItemThrash`
still increments on every claim→expire-without-evidence, and `resetWorkItemThrash` still zeroes
it on demonstrated progress — **the reset is load-bearing: a counter that only climbs measures
tenure, not thrash**, and would poison idea-675's successor design.

**Improved while there:** the only thrash metric used to fire **at the cap** — i.e. thrash was
observable exclusively at the moment it had already become a lockout, the least useful moment
and part of why nobody saw bug-382 coming. It now emits on **every increment**
(`workitem_thrash.recorded`) and the sweep result reports `agentsThrashed`. *A counter nothing
can read is not a metric*, so "keep it as a metric" is only honoured if something observes it.

**KEPT INERT:** `Agent.quarantined` remains a **stored field with no writer and no reader**.
Not dropped, deliberately — removing a stored field is a schema change carrying a renameMap
governor inventory cost, and the historical values are the only surviving record of whom the
retired mechanism caught. It is commented as a fossil in `state.ts` and
`agent-repository-substrate.ts`.

---

## 4. BLAST RADIUS — measured, and where measurement failed

### 4.1 Callers of the retired verb — zero, from the right corpus
```
git grep -n "clear_work_quarantine\|clearWorkItemQuarantine" origin/main \
  -- 'adapters/**' 'packages/**' 'ois/**' 'scripts/**' '*.md'
```
**Zero code callers.** Three hits, all documentation prose:
`docs/designs/c1-r2-workitem-construction-design.md:162`,
`docs/designs/m-stint-lifecycle-design.md:138`, `docs/traces/c1-r2-workitem-work-trace.md:59`.
Searched **outside** `hub/**` on purpose — a zero found only inside the package being edited
would be a zero from the wrong corpus.

⚠️ **RESIDUAL:** those three docs now describe a verb that does not exist. Prose-only, so it
does not block the cut, but a reader will believe them. Recorded, not silenced.

### 4.2 🔴 Rows already carrying the attribute — **I COULD NOT ENUMERATE THEM**

Stated plainly because the runbook demands it and because an unverifiable claim must not ride
as if checked.

`get_agents({includeAll: true})` returned **37 of 37 agents, projecting neither `quarantined`
nor `thrashCount`** (run this session). That is bug-410's neighbourhood, confirmed by
measurement rather than assumed. The only other reader was `clear_work_quarantine`, which
**clears and never lists**, and it is the verb being retired. From this seat there is no
surface that can enumerate the quarantined population.

**So: I do not know how many agents currently carry `quarantined: true`, and I could not find
out.** A verifier cannot independently confirm it either — the same projection gap applies.

**Why prevention-only is nonetheless sufficient here, and it is not a hand-wave:** after this
change the field has **no reader in the codebase**. A stale `true` therefore cannot affect any
decision — it is **inert data, not latent state**. **Migration cost: zero, because there is
nothing to migrate to.**

> ### 🔴 THE RE-CHECK TRIGGER, STATED SO THIS STAYS A JUSTIFICATION RATHER THAN AN ASSUMPTION WITH A GOOD DAY
> **This entire argument rests on the reader count being ZERO. IF ANYONE ADDS A READER OF
> `Agent.quarantined`, THAT ARGUMENT DIES** — the stale rows stop being inert data and become
> latent state, with an unknown population that no surface can enumerate (§4.2) and no
> migration ever written. **The re-check is not "is the field still there"; it is "does
> anything read it".** §4.4 measures exactly that, and it is the measurement to repeat.

### 4.3 Test-estate population — two instruments, two different answers

| instrument | files flagged |
|---|---|
| `tsc --noEmit` | **3** |
| `git grep quarantin` over suites | **14** (6 `[A]`, 8 `[C84]`) |

**Compiler-red found half the `[A]` population.** It is blind to `router.handle("clear_work_quarantine", …)`
(a string) and to structural stubs like `getAgent: async () => ({ quarantined: true })`, which
type-check perfectly. `bug-175-rbac-matrix.test.ts` and `work-item-policy.test.ts` were
invisible to it and would have failed only at runtime.

🔴 **AND ONE SITE BOTH INSTRUMENTS' *SUMMARIES* MISSED — my error, not theirs.**
`message-consumption-projection.test.ts` was flagged by *both*. I fixed the two lines tsc named
and moved on, **treating the compiler's per-file hit list as that file's complete site list**.
It is not: tsc saw the two sites that broke a **type** and was blind to a third that broke only
a **value**. The full-file grep named it; running the suite proved it.
**A per-file compiler hit is not a per-file census.**

### 4.4 Reader count after the change
```
git grep "clear_work_quarantine\|clearWorkItemQuarantine\|agentsQuarantined\|thrashCap" \
  -- 'hub/**' 'packages/**' 'adapters/**'
```
→ only test prose and one comment. **No live code path reads or writes `Agent.quarantined`.**
`recordWorkItemThrash` still present at 4 non-test sites (the counter, as required).

---

## 5. FALSIFIERS — two clauses doing different work (idea-677)

### 5.1 🔴 The first version of the reachability test was VACUOUS, and the mutation caught it

v1 hand-built a projection with a non-null `nextAction` and asserted `warning`. It passed —
**and passed identically with the quarantine term restored in `hasCallerGate`**, because a
non-null `nextAction` never reaches that branch at all. It tested pre-existing behaviour and
would have shipped as proof of a change it never exercised.

**Reasoning about it did not catch this. Running the mutation did.** The test was rewritten to
drive the **policy seam** — `router.handle("get_next_action", …)` with a stale-quarantined
registry — because that is the only construction where the diff changes the outcome:

```
BEFORE  {nextAction: null, emptyReason: "quarantined"}  -> suppressed / caller_gated
AFTER   {nextAction: child}                              -> warning / no_progress_with_ready_action
```

### 5.2 Mutation matrix — with attribution

| # | mutation | result | which test |
|---|---|---|---|
| **M0** | *(none — control)* | **14 pass** | — instrument is not saturated |
| **M1** | restore the quarantine gate in `get_next_action` | **1 fail** | `REACHABLE … now WARNS` |
| **M2** | delete `hasCallerGate` entirely (the lazy fix) | **1 fail** | `DISCRIMINATOR: WIP-CAP survives` |

Each mutation reds **precisely** the test that targets it and no others. **M0 is run and
reported** — a matrix without its unmutated control cannot distinguish a guard that fires from
one that is saturated red.

### 5.3 Why the discriminator exists

Deleting `hasCallerGate` outright would **also** make the alarm reachable — and would be
wrong: every WIP-capped driver would start warning about work it is already busy doing. So the
**WIP-cap suppression is asserted to survive**. Either assertion alone passes a wrong
implementation; only the pair pins the removal to the quarantine term.

### 5.4 Clause 2 — what must be observed to CHANGE (not just "did not break")
- watchdog emits `warning` / `no_progress_with_ready_action` **and names the action** — a
  warning without an action is unactionable.
- `claim_work` **reaches the repo** for a stale-quarantined agent (`store.calls > 0`) — not
  merely "returns no error", which an empty refusal would satisfy.
- `get_next_action` threads the **agentId** (WIP-cap still applies), not role-only.
- sweeper: `thrashCount` **still writes** at 99 (far past the retired cap of 3) **and emits no
  `agent_workitem_quarantined` audit**.
- a pre-existing `quarantined: true` row is **left untouched** by a thrash write + reset.
- `clear_work_quarantine` is **not in `getRegisteredTools()`** — asserted against the registry,
  because an unregistered verb and a broken one both return `isError`. Paired with a **control**
  asserting the surrounding verbs *are* registered, so the assertion cannot pass against a
  router that registered nothing.

### 5.5 RBAC coverage — substituted, not deleted
`clear_work_quarantine` was `bug-175-rbac-matrix.test.ts`'s **only** `[Architect|Director]`
exemplar. Deleting its four tests would have left a "RBAC fail-open closure matrix" containing
a single `[Any]` test — fully green, zero coverage of the fail-open it exists to prevent.
Substituted `reset_work`, which carries the identical composite tag; all four rows preserved.
**A test file named after an invariant does not protect that invariant; the specific verb it
drives does.**

---

## 6. TEST RUNS — each command's own exit line (bug-402)

Background-task notices report the **wrapper's** exit, not the suite's, and fail toward false
green. Every figure below is the command's own `EXIT=`.

```
hub — full suite
  Test Files  251 passed | 1 skipped (252)
       Tests  2987 passed | 5 skipped (2992)
  EXIT=0

packages/network-adapter — full suite (cross-package, required by the runbook)
  Test Files  47 passed (47)
       Tests  384 passed (384)
  EXIT=0

hub — tsc --noEmit -p tsconfig.json
  TSC_EXIT=0
```

The adapter suite is not incidental: **a node's own suite cannot catch the damage it does to
its siblings.** This change edits the sweeper B6 stands on.

---

## 7. WHAT I COULD NOT DETERMINE

1. **How many agents currently carry `quarantined: true`** — no surface projects it (§4.2).
   Mitigated, not resolved, by the field having zero readers after this change.
2. **Whether any agent is *presently* locked out** — same gap. If one is, this change releases
   it; I cannot name it.
3. **Whether the watchdog's increased volume is proportionate in production.** It will get
   louder by design. I measured that the alarm is *reachable*, not what its steady-state rate
   will be. **If it proves noisy, that is a scheduling or roster fact to surface — not a reason
   to re-mute the instrument.**
4. **Runtime behaviour on the live hub** — delivery layer for this node is **MERGED, not
   deployed**.

## 8. RESIDUALS

- ~~Three design/trace docs still describe `clear_work_quarantine` as live~~ — **CLOSED in this
  PR.** All three preserve text that was **true when written**, so none was rewritten; each got
  a dated superseding note instead. **"Prose-only" is exactly how bug-413's docstring and
  bug-412's comment acquired their standing** — a record asserting a feature exists is believed.
  - `docs/traces/c1-r2-workitem-work-trace.md` — pure historical record (sha-stamped `958df36`).
    **Marked superseded; the entry itself is untouched.**
  - `docs/designs/c1-r2-workitem-construction-design.md` — dated build blueprint (2026-06-22)
    that correctly records the contract *as designed*. **Marked superseded** (verb count back to 9).
  - `docs/designs/m-stint-lifecycle-design.md` — 🔴 **materially different, and the one that
    actually needed care.** It is a `v0.1` design still awaiting ratification, i.e. **ACTIVE
    GUIDANCE FOR UNBUILT WORK** — anyone implementing `get_next` from it would ship a reason
    code and a verb that no longer exist. The Director-dialogue text is kept verbatim (rewriting
    it would falsify a record of what was agreed) with a **correction** attached. **The
    principle it teaches survives untouched — an empty digest must explain itself and must never
    be a dark zero. Only the third arm of its example is stale.**
- `Agent.quarantined` is a stored field with no writer and no reader (§3) — intentional, and
  commented as such at both definition sites so a later reader knows it is a fossil.
  **See the re-check trigger in §4.2: the moment anything reads it, the prevention-only
  justification stops holding.**
