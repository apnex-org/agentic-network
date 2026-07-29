# `nodestate0` — arc scope

**Status:** scoped, not seeded · **Authored:** 2026-07-29 · **Architect:** lily (`agent-40903c59`)
**Authority:** Director-selected cluster + shape, 2026-07-29
**Anchor:** `idea-640` (now `incorporated` — see *Why this doc exists*)

---

## Why this doc exists

The arc's scope was originally written onto `idea-640`. That idea is now permanently
`incorporated` and cannot be walked back (`bug-444`, reconfirmed live on this very row —
`incorporated → triaged` is refused as well as `incorporated → open`). An `incorporated`
idea is invisible to `list_ideas { status: 'open' }`, so scope living there would not be
found by the next planner.

**This document is the authoritative scope fence. The idea is history.**

---

## Director selections

| Decision | Value |
|---|---|
| Cluster | **WorkGraph robustness** — over deploy-safety, runtime-survival, PR-review |
| Rationale | substrate every other arc runs on; failures **measured** (two dead drivers in gauntlet0), not hypothetical; **banked** payoff — pays regardless of what follows |
| Shape | **short reconcile → build**; the full 13-node planning sequence explicitly NOT run |

The reconcile phase was largely executed in conversation on 2026-07-29. What remains is a
**build arc with a verification front-end**.

---

## Governing rulings

**1. `bug-433` — auto-drop.**
> *"DependsOn should only engage against live nodes. The list should be dynamic and auto
> remove nodes that are no longer valid. That mechanism exists to encode heirarchy, not to
> poison or block abandon nodes forever."*

**Clarified 2026-07-29:** *"I meant abandoned or canceled nodes."*
Deliberately-terminated work only — **NOT failed work.**

**2. `bug-448` — correctability.**
> *"If a node is marked incorrect (fails) - then it must be able to be corrected, if desired."*

The seal is a **scar, not a headstone**: it persists as permanent history and gates no verb.

### The two rulings compose — neither fix absorbs the other

Once `bug-448` unblocks the verbs, a failed node has two exits, and each opens the gate on
its own:

```
fix it     ->  correct, re-verify, PASS  ->  status done       ->  gate opens normally
give up    ->  abandonWork permitted     ->  status abandoned  ->  gate opens via bug-433
```

**A gate that dropped its own failures would not be a gate.** The block on a failed child is
legitimate; only its *unclearability* was the defect.

---

## In scope

> 🔴 **NARROWED 2026-07-29 AFTER THE PRE-BUILD AUDIT. bug-448 NO LONGER SHIPS FROM THIS ARC.**
> `docs/verification/nodestate0-prebuild-failure-mode-audit.md` returned **CORRECTIONS REQUIRED
> BEFORE IMPLEMENTATION**. Two findings are decisive and neither is fixable by an implementation
> node:
> - **F1** — the anti-gameability counter-control does not hold. "Evidence-free" deletes row-local
>   *pointers*, not artifacts; `allowPreClaim:true` re-admits them under a weakened requirement,
>   verifier authority can be downgraded, and `targetRef` unfreezes because its freeze keys on
>   `attestationHistory`, which reset clears.
> - **F4** — removing guards does not *create* a retry transition. `pauseWork` accepts four phases
>   and `failed_sealed` is not among them.
>
> **This arc closes TWO criticals, not three.** bug-448 leaves as a design packet
> (`docs/design/bug-448-correctability-successor-design.md`) rather than a half-fix.

| Item | State | Work |
|---|---|---|
| **bug-433** | 🔴 RULED, unbuilt — **CRITICAL** | Auto-drop. **One shared classifier across SEVEN surfaces**, not the two obvious predicates (audit F7). Declared-vs-active topology both observable |
| **bug-424** | 🔴 unbuilt — **CRITICAL** | Disposal authority. **The matrix is unresolved, not assumed** (audit F8): `abandonWork` receives no role, and holder-after-self-suspension must differ from holder-after-steward-suspension |
| **bug-423** | ⚪ confirmed open — minor | **Seven faces, not four** (audit F9): + suspended `isLiveInFlight` suppressing the warning, suspended driver reading active, `suspended` absent from the progress fingerprint |
| **isSuspended split** | 🟢 **PR #718** — queued | `isParkedFromExecution` (both populations) vs `isActivelyWithdrawn` (attribute only). Only `abandonWork` moves; 21 sites unchanged |
| **bug-414** | ⚪ **PREMISE STALE** (audit F10) | The append-only verbs already exist; the original calls used `set:{…}`, the wrong surface. **Do not build a second edge API.** State which half closed |
| **bug-448** | 🔵 **DEFERRED — design only** | Successor design packet. **No capability-predicate code ships from this arc**; the verifier will FAIL any change to `assertNotFailedSealed` / `isFailedGateSealed` / `effectiveDisposition` / `resetWork`'s clearing |
| `idea-640` residue | 2 open questions | Does pause freeze `expiresAt`? Enumerate "minor edits" precisely |

### Measured while driving — two beliefs the arc falsified

```
set: { evidenceRequirements }   ->  changed: [runbook, evidenceRequirements]   ✅ EDITABLE
set: { dependsOn }              ->  unrecognized_keys                          ❌ NOT EDITABLE
```

**`evidenceRequirements` are NOT immutable-forever.** `idea-640`'s FULL tier
(`pause → reset → update`) rewrites a contract wholesale, gated on the row being evidence-free.
Two node contracts in this arc were rewritten in place rather than re-seeded.

**Topology edges ARE effectively immutable** — only `appendDependsOn`/`appendCompletionDependsOn`,
at every tier. **Spec fields yield; graph shape does not.** That asymmetry is the residue `bug-433`
leaves behind, and it is why two nodes in this arc carry misleading ids: retiring them means
abandoning them, and abandoning a child in `completionDependsOn` bricks the driver — the defect
under repair, encountered while repairing it.

### Key code locations (measured on `origin/main`, 2026-07-29)

```
hub/src/entities/work-item-repository-substrate.ts
  :242   isSuspended            suspended === true || status === "paused"
  :839   isFailedGateSealed     effectiveDisposition==="failed_sealed" || failedGateSeal!=null
                                || hasActiveVerifierFail(item)
  :1249  applyWorkItemMutation  } 
  :1926  computeCompletionProgress   completion gate — ONE source of truth for
                                     complete_work AND the get_work projection
  :2464  claimWorkItem          }
  :2796  pauseWork              }  the six assertNotFailedSealed guard sites
  :3026  unpauseWork            }
  :3126  resetWork              }
  :3459  systemUnblock          }
  :3473  abandonWork            }
  :4266  unmetDependencies      start gate
  :4274  assertNotFailedSealed  the definition
```

---

## Anti-scope

Recorded with revival triggers; **do not re-litigate inside the arc.**

- `bug-422` — suspension lifetime / visibility. A *policy* question, not a state-model one.
- `bug-426`, `bug-437` — watchdog noise tuning.
- `bug-438` — claimable-projection blindness.
- `bug-418` — retracted-citation sweep.
- `bug-434` — belongs to the PR-review cluster, anchored by `idea-415`.
- **`commit` / draft-then-commit / node versioning** — Director-excluded from the `idea-640`
  build. Restated here so the fence is not re-litigated.
- **Introducing a `cancelled` phase.** There is no `cancelled` state today; `abandoned` is the
  only deliberately-terminated phase. Adding one is new scope, not implied by the ruling.

---

## Before the blueprint is fixed — three empirical gaps

1. **`bug-414` unverified.** Never measured.
2. **The live failed-sealed population is unknown.** A migration exists at `:4428` to convert
   legacy rows to `status: "failed_sealed"`; **whether it has run is UNKNOWN.** Count and
   current stored phase must be measured before any predicate or migration work.
3. **`bug-424`'s 26-row figure is from 2026-07-28** and has not been re-counted.

### Triage provenance — do not trust an `open` flag in this set

Of the candidates whose status was verified on 2026-07-29, **two of two were already fixed**
(`bug-428`, `bug-432` — both closed that day with measured evidence), and `idea-640` itself
was carrying *"build not yet scheduled"* days after the build shipped.

**Three staleness hits out of three checks. Status verification is the first node of the arc,
not an optional one.** See `idea-543`.

---

## Known traps for the builder

- **`resetWork`'s JSDoc says it preserves `attestations`. The code clears them.** The
  divergence is recorded at `:1566` but the JSDoc was never fixed, and it is the first thing
  a builder reads. Fix it as part of this work.
- **`isSuspended` serves two opposite purposes.** `suspended === true || status === "paused"`
  is *correct* for guards that protect a parked row (don't claim, don't edit) and *exactly
  wrong* for disposal — it is what strands the legacy population, because `unpause` clears
  the attribute and nothing ever clears the phase.
- **`bug-433`'s fail-closed posture is deliberate and documented.** The completion gate's
  comment says a *"VANISHED or non-`done` (incl. abandoned) child counts pending (fail-CLOSED
  — the same posture the gate enforces)."* The ruling **reverses a stated position**; the
  implementation should rebut that rationale explicitly rather than delete it silently.
- **The vanished child (`!child`) is a separate, unruled question.** Failing closed on a
  missing row may be correct — it can indicate data loss rather than deliberate termination.
  **Decide it explicitly; do not fold it into the abandoned case by accident.**
- **`failed_sealed` is a live, written phase.** An earlier revision of these notes claimed
  nothing writes it — false. It is written at `:3882`, `:4107` and `:4428`, and read by the
  pulse-sweeper, lease-sweeper, `work-item-policy:1467` and the legal-moves refusal at `:2153`.
  The error came from quoting a test that documents the *pre-migration* shape.
  **A test describing a legacy state reads exactly like one describing the current state.**

---

## Anti-gameability — the control that must not be weakened

```
fail the gate -> reset -> rewrite evidenceRequirements to something easier -> unpause -> pass
```

The FULL edit tier is reachable **only on an evidence-free row**, and getting there costs every
artifact (`:3160`, decision-11 ⨯ idea-640). *You cannot rewrite the contract and keep what you
made.*

Two consequences the build must respect:

- Reset clears `attestations` **and** `attestationHistory`, including the verifier's FAIL.
  **After a reset the seal is the only surviving record of the failure** — the last copy, not a
  redundant one. Anything that also clears the seal erases the failure entirely.
- If the seal persists **and** a guard still reads `failedGateSeal != null`, a corrected-and-passed
  node can never complete. **The active/historical split is therefore not optional** — otherwise
  one dead end is traded for another.

---

## Team

Per the standing directive, every arc carries ≥1 engineer and ≥1 verifier alongside the
architect driver: **greg** (`agent-0d2c690e`) implementation, **steve** (`agent-f148389d`)
verification gates.

---

## MEASURED 2026-07-29 (node-0 gap closure, architect) — **two bug figures were wrong**

```
list_work status="paused"         ->  0 rows      (bug-424 recorded 26 on 2026-07-28)
list_work status="failed_sealed"  ->  12 rows     ALL with failedGateSeal: null
                                                  effectiveDisposition: "failed_sealed"
```

### 1. `bug-424`'s legacy tail is EMPTY — the half may be moot

Zero rows carry `status: "paused"`. The 26-row stranded population measured on 2026-07-28 no
longer exists. **NOT established where they went** — migrated, or disposed. The owner-exception
half of `bug-424` (`abandonWork` refusing `isSuspended`) is unaffected and remains real.

**Re-verify before scoping legacy-tail work. Do not build a migration for an empty set.**

### 2. The seal-less population — measured, and then ruled irrelevant

The migration at `:4428` **has run**: `failed-sealed-phase-v4.test.ts` describes these twelve
rows as stored `ready`; they are now stored `failed_sealed`. **But `failedGateSeal` is `null` on
all twelve.** They are terminal via `hasActiveVerifierFail`, not via a seal object.

> 🔴 **AN EARLIER REVISION OF THIS SECTION CALLED THAT "A HARD ORDERING CONSTRAINT" AND
> REQUIRED THAT A SEAL EXIST BEFORE RESET IS PERMITTED. THE DIRECTOR REMOVED IT — TWICE.**
>
> Verbatim, 2026-07-29:
> - *"reset must function on any paused node."*
> - *"seals / evidence etc dont matter. If you (the architect) want to reset a node and clear
>   the lease, you can pause it then do so."*
>
> **THERE IS NO PRECONDITION ON RESET.** No seal-minting, no backfill, no migration gate, no
> ordering between record-preservation and correctability. The architect pauses, resets, edits.
> That is the whole path. **Do not build machinery around the failure record.**

**What survives from the measurement:** the twelve rows carry no seal object, so
`failedGateSeal != null` matches nothing in the live population and any guard keyed on it is
inert today. `hasActiveVerifierFail` is the term that actually fires. **That is a fact about
which predicate to look at — not a constraint on when reset may run.**

⚠️ **HOW THIS SECTION WENT WRONG, because it is the arc's recurring shape.** The measurement
was correct. The inference — *therefore reset must be gated* — was mine, was not asked for, and
imported a constraint the Director then removed. **A correct measurement with an invented
consequence attached is more dangerous than no measurement, because the consequence inherits
the measurement's credibility.** It cost a whole seeded node, which had to be repurposed rather
than abandoned because abandoning it would have bricked the driver (bug-433 — the defect this
arc repairs, encountered while repairing it).

### 3. `effectiveDisposition` is circular and must not be trusted as an independent signal

`:687` assigns `effectiveDisposition = isFailedGateSealed(decoded) ? "failed_sealed" : null`,
and `isFailedGateSealed:839` reads `effectiveDisposition`. It is **derived at decode from the
other two terms** — it carries no information of its own. Any predicate work must treat
`failedGateSeal` and `hasActiveVerifierFail` as the real inputs.
