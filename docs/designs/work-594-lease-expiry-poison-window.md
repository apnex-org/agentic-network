# work-594 (B6) — closing bug-406 by construction: the poison counter becomes a *window*

**Seat:** engineer `agent-0d2c690e` · **Tree:** `origin/main@1fdd2bb7` (B5 merged) · **Date:** 2026-07-28
**Target:** bug-406 · **Written BEFORE the change**, per the node's `design`-before-`commit` ordering.

---

## 1. WHAT `poisonCap` IS PROTECTING AGAINST — named before touching it

**A row that consumes seat after seat without ever progressing.** Unbounded, such a row cycles
forever: claim → lapse → requeue → claim → lapse. Each cycle costs a seat a full lease window
of capacity and produces nothing. `poisonCap` converts that infinite loop into a bounded one —
at the price of terminality.

🔴 **IT IS NOW THE ONLY BRAKE LEFT ON THAT CYCLE.** It was the **depth** half of a pair;
quarantine bounded **reach**, and **B5 (`work-593`, merged `1fdd2bb7`) removed quarantine
earlier tonight.** So this node carries an obligation the runbook states plainly: **if this
change makes poison-abandon effectively unreachable, both halves are gone in one arc.**

**§5 is the assertion that it is still reachable, and it is a test, not a claim.**

---

## 2. THE DEFECT, RE-DERIVED IN THIS TREE

`work-item-repository-substrate.ts:4074-4076`:
```ts
const poisonEligible = POISON_ELIGIBLE_PHASES.includes(w.status);   // :255 = ["claimed","in_progress"]
const nextCount = poisonEligible ? w.leaseExpiryCount + 1 : w.leaseExpiryCount;
const poisoned  = poisonEligible && nextCount >= poisonCap;
```
`leaseExpiryCount` has **no reset path anywhere in `hub/src`** (`:3385` documents `releaseWork`
deliberately preserving it). So:

> ### THE 3-LAPSE BUDGET IS CUMULATIVE OVER THE ROW'S WHOLE LIFETIME AND SHARED ACROSS EVERY HOLDER IT HAS EVER HAD.

A row that lapsed twice weeks ago sits permanently one lapse from irreversible abandon, and
whoever draws it next inherits that invisibly.

**The live instance** — `work-bp-seatrec0-arc_driver`, the previous planning arc's controller
node, terminally consumed:

| lapse | at | outcome |
|---|---|---|
| 1 | 2026-07-26T21:21:37Z | requeued |
| 2 | 2026-07-26T22:31:54Z | requeued |
| 3 | 2026-07-27T00:30:39Z | **poison-abandoned** |

Its `recallHistory` shows `heartbeatAt 00:15:39` — **the holder renewed on schedule**, degraded
~00:20, and could not renew when the next renewal fell due. **It was not absent, negligent or
slow. It had lost the ability to prove who it was** — bug-398, the identity fault this same arc
closed in B1–B4. **The counter cannot represent that, and spent a life on it anyway.**

---

## 3. 🔴 THE ENABLING FIND — the data already exists, and nothing reads it

**bug-384 (merged 2026-07-26) already writes a per-lapse record.** `expireLease` appends a
`recallHistory` entry on every expiry (`:4095-4122`) carrying:

```
operationId:  `lease-expiry:${workId}:${token}`     <- a stable discriminator for THIS event class
recalledAt:   nowISO                                 <- 🔴 A PER-LAPSE TIMESTAMP
before.lease: { holder, claimedAt, expiresAt, heartbeatAt, tokenFingerprint }
```

**So the counter can be made time-aware with NO SCHEMA CHANGE** — no new field, no `renameMap`
governor inventory cost, no envelope migration. The repair reads data bug-384 already durably
persists for a different purpose.

⚠️ **This is why the design is cheap, and it is worth naming: a repair shipped for one reason
laid the substrate for a repair nobody had scoped yet.** It is also the reason to check what is
already stored *before* proposing a new field — my first instinct was to add one.

---

## 4. CHOSEN DESIGN — a WINDOWED poison count, with the window DERIVED

**The cap is evaluated against lapses inside a recent window, not against the lifetime total.**

```
window        = poisonCap × leaseTtlMsFor(w)          // leaseTtlMsFor already exists at :159
windowedCount = count of lease-expiry recallHistory entries with recalledAt >= now − window
poisoned      = poisonEligible && (windowedCount + 1) >= poisonCap
```

`leaseExpiryCount` **keeps incrementing as the lifetime total** and becomes a pure metric —
exactly the shape B5 gave `thrashCount` hours ago (**keep the measurement, remove the
consequence**). Nothing branches on the lifetime value any more.

### 🔴 WHY THE WINDOW IS `poisonCap × leaseWindow` AND NOT A ROUND NUMBER

**Because it is derived from what it must discriminate.** A genuinely poisonous row burns its
budget on *consecutive* lapses:

```
claim @0h  →  lapse @1h        (lapse 1)
claim @1h  →  lapse @2h        (lapse 2)
claim @2h  →  lapse @3h        (lapse 3)   first→last span = 2h = (poisonCap−1) × leaseWindow
```

So a window of `poisonCap × leaseWindow` (**3h** at the default 1h lease) contains a truly
consecutive burn **with a full lease window of slack** for re-claim delay. Measured against the
live instance:

| | first→last lapse span | inside a 3h window? |
|---|---|---|
| consecutive burn (genuinely poisonous) | **2h00m** | ✅ yes → **still dies** |
| `work-bp-seatrec0-arc_driver` (spread) | **3h09m** | ❌ no → **survives** |

**The window separates the two cases on a measured 1h09m margin, and the boundary is not a
number I chose — it falls out of the cap and the lease window.** It also makes the window
**self-scaling**: a node type with a 10-minute lease gets a 30-minute window automatically.

### Secondary, adopted because it is nearly free
**Surface the remaining budget** — the windowed count is computed anyway, so exposing it costs
one field. Today nothing tells a claimant the row they just picked up is one lapse from death.

---

## 5. WHAT IS PRESERVED, WHAT IS LOST

**PRESERVED — and this is the load-bearing claim of the whole node:**
**poison-abandon remains REACHABLE.** A row that burns `poisonCap` lapses inside the window is
still terminally abandoned. §7's second falsifier asserts exactly this, because **an
implementation that quietly made the cap unreachable would satisfy every other test here** and
would mean this arc deleted both halves of the protection pair.

**LOST — deliberately, because it *is* the defect:** poison-abandon for lapses spread beyond
the window. A row that lapses three times over three weeks no longer dies. That is the intended
behaviour change, not a side effect.

**UNCHANGED:** `review`/`blocked` lapses remain poison-exempt (`:255`, audit-4103 #3).

---

## 6. ALTERNATIVES REJECTED — with reasons, not preferences

**(a) Reset on successful renew — REJECTED, and it is the trap in this node.**
🔴 **`work-bp-seatrec0-arc_driver` RENEWED ON SCHEDULE.** So did every working holder. Resetting
on renew clears the counter for essentially any row whose holder renews even once, which is
nearly all of them — **making the cap unreachable and removing the depth protection outright.**
This is the most natural-sounding candidate and it is the one that would have quietly deleted
the second half of the pair.

**(b) Reset on completion — REJECTED as inert.** A completed row is terminal; the counter is
already moot. It would read as a fix and change nothing.

**(c) Distinguish holder-fault from environment-fault — REJECTED, with the reason stated
rather than deferred.** **The substrate cannot observe *why* a holder stopped.** The one
available signal is `heartbeatAt > claimedAt` (the holder proved liveness at least once), and
it does **not** mean the cause was environmental: **a row whose own content crashes its holder
produces exactly that signature** — claim, heartbeat, die. Exempting on it would exempt
precisely the poisonous rows the cap exists to catch. **Windowing reaches the right outcome for
the motivating case without having to infer intent from a signal that cannot carry it.**

**(d) A fixed global decay window (e.g. 24h) — REJECTED as arbitrary AND insufficient.** It
would **not** have saved the live instance: 3h09m is far inside 24h. A number chosen for
roundness rather than derived from the mechanism fails the case that motivated the node.

---

## 7. FALSIFIERS — two clauses doing different work (idea-677)

**Clause 1 — must go RED against today's code.** Replay the live instance's timings: three
lapses spanning 3h09m at a 1h lease. **Today: `abandoned`. After: `requeued`.** A test that
merely exercises the counter passes both before and after and proves nothing.

**Clause 2 — must be observed to CHANGE, in BOTH directions:**
1. the spread-lapse row **survives** and is claimable again, and
2. 🔴 **the consecutive-burn row STILL DIES.** Without (2), deleting the cap entirely passes (1).
   **(2) is the assertion that this arc did not remove both halves of the protection pair.**

Plus the M0 control and a restore-the-old-comparison mutation, per the matrix method B5
established — attribution, not just a red count.

---

## 8. ⚠️ RETROACTIVITY — a de-facto amnesty, stated rather than discovered

Rows carrying `leaseExpiryCount > 0` whose lapses predate **bug-384** have **no
`recallHistory` lease-expiry entries at all**. Their windowed count is therefore **0**: they
receive a clean budget.

**This is an amnesty, and I am naming it rather than letting it be found later.** It is
acceptable because it errs in the safe direction — toward *not* terminating rows — and because
the blast radius is measured: **the complete census of all 43 non-terminal rows at planning
time found ZERO at `lec>=2`, max live = 1.** No live row is near the cap, so no live row is
materially amnestied.

**No migration is required, and none is written.** Prevention-only, stated.

---

## 9. WHAT I COULD NOT DETERMINE

1. **The true historical population at `lec>=2`.** The planning scan **hit the 500-row cap and
   reported itself incomplete** — 8 rows visible at `lec>=2`, three of them abandoned arc
   drivers. **That is a FLOOR, unbounded above.** I did not re-run it; the live census (§8) is
   what bounds the risk, and it is complete for non-terminal rows.
2. **Whether any already-abandoned row would have survived this change.** Not reconstructible:
   pre-bug-384 rows have no per-lapse record, so the counterfactual cannot be evaluated for
   exactly the rows most likely to be affected.
3. **Whether `poisonCap = 3` is still the right number** under windowed semantics. I changed the
   *semantics* and left the *value* alone deliberately — changing both at once would make an
   observed change unattributable to either.
4. **Runtime behaviour on the live hub.** Delivery layer for this node is **MERGED, not
   deployed.**
