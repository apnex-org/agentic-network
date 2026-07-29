# bug-448 — correctable failed nodes: successor-arc design packet

**Node:** `work-bp-nodestate0-impl_correctability` (id is a lie — it produces this packet, it does not
ship bug-448) · **Author:** lily (`agent-40903c59`) · **Date:** 2026-07-29
**Status:** Rev 1 — DESIGN ONLY. No capability-predicate code ships from `nodestate0`.

**Inputs consumed:**
- `docs/verification/nodestate0-prebuild-failure-mode-audit.md` — steve (`agent-f148389d`),
  verdict **CORRECTIONS REQUIRED BEFORE IMPLEMENTATION**, criteria A–H treated as requirements
- `docs/design/nodestate0-guard-site-classification.md` — greg (`agent-0d2c690e`)
- Director rulings, 2026-07-29, verbatim throughout
- `bug-448`, `bug-450`, `bug-453`, `idea-640`, `idea-704`

---

## 0. Why this is a design packet and not an implementation

Two audit findings killed the implementation framing outright.

**F1 — the anti-gameability counter-control does not hold.** The claim was: rewriting a contract is
safe because reset leaves the row evidence-free. That proves only that **row-local pointers** were
deleted. The commit, PR, Hub doc and test log all survive. Then:

- `allowPreClaim:true` re-admits the same artifact under a weakened requirement;
- `evidenceAuthority:"verifier-attestation"` can be replaced with executor evidence;
- `kind` / `refResolvable` can be weakened, or several conjunctive requirements collapsed to one
  freeform locator;
- `targetRef` becomes movable again, because its freeze keys on `attestationHistory` — which reset
  clears.

```
target A / contract A -> verifier FAIL -> scar(A)
-> pause -> reset (attestationHistory = [])
-> targetRef = B + easier contract B
-> unpause -> complete -> done
```

A scar recording that contract A failed can coexist with the row reaching `done` under contract B,
and no predicate compares them.

**F4 — there is no retry transition to unblock.** Even with every `assertNotFailedSealed` call
deleted: `pauseWork` accepts only `ready|claimed|in_progress|blocked`; `unpauseWork` preserves the
current phase; `claimWorkItem` requires `ready`; `attestEvidence` refuses both the seal and an active
FAIL, before and inside CAS; `getLegalMoves` hard-returns all eleven verbs illegal.

> **Removing guards does not create a transition.** greg, on finding the second refusal eight lines
> below the first: *"I classified the locks and did not check there was a door behind them."*

---

## 1. Governing rulings

| # | Ruling (verbatim) |
|---|---|
| R1 | *"If a node is marked incorrect (fails) - then it must be able to be corrected, if desired."* |
| R2 | *"reset must function on any paused node."* |
| R3 | *"seals / evidence etc dont matter. If you (the architect) want to reset a node and clear the lease, you can pause it then do so."* |
| R4 | *"the definition of a reset is to zero out any changes the node since it was first released"* |
| R5 | *"constructing node content or using 'modify' to edit it is the 'base' state, then any changes while it gets 'worked' can be restored against that 'spec'"* |
| R6 | *"updates via 'worked' operations become 'delta' to the configured spec"* |
| R7 | *"perhaps we simply make an exception for a fail to keep a note of it on the node when its reset"* |

⚠️ **R3 is not authority to erase a failure.** steve drew this distinction and refused to act on the
architect's paraphrase without it: *"'seal/evidence do not block reset' and 'seal/evidence may be
erased' are different rulings."* R3 answers whether reset has **preconditions** — it does not. R7 is
what preserves the failure. Both hold simultaneously.

---

## 2. The spec / delta model (from R4–R6)

```
SPEC    configured intent. Set by construction or by modify. Re-baselined on every
        legitimate edit — NOT a frozen origin snapshot.
DELTA   what worked operations accumulate: claim, lease, evidence, attestations,
        verdicts, dwell.
RESET   discard the delta, restore the spec.
```

**The substrate already partitions exactly this way.** `v2-envelope/kinds/WorkItem.ts` routes fields
to `spec` ("declared intent") and `status` ("lifecycle") — and **`failedGateSeal` and
`effectiveDisposition` are both in `status`**.

`resetWork:3242` does not consult the partition. It enumerates four of eighteen `status` fields.
Everything else survives by accident. That is how `effectiveDisposition` was missed (bug-450) and how
`failedGateSeal` came to survive holding `attestationHistoryIndex` — an index into the array the same
call empties.

> **Reset is stated as a list. The storage layer already states it as a rule. They disagree, and the
> list is the one in production.**

**Design direction:** define reset against the partition, not a field list. Two named carve-outs:
**provenance** (`recallHistory`, `executorHistory`, `stateDurations`, `leaseExpiryCount`) and the
**failure note** (§3). Nothing survives by accident. Full argument in `idea-704`.

---

## 3. Append-only failure notes (R7)

**Where a FAIL lives today, measured at `attestEvidence:3784`:**

```
attestationHistory   <- [...w.attestationHistory, attestation]     THE REAL RECORD
failedGateSeal       <- seal { …, attestationHistoryIndex: len }   A POINTER INTO IT
status               <- "failed_sealed"
effectiveDisposition <- "failed_sealed"                            derived + latched
```

**All 12 live `failed_sealed` rows carry `failedGateSeal: null`** (measured independently by architect
and verifier, `truncated:false`). Their FAIL lives *only* in `attestationHistory`. Reset sets it to
`[]`. **The failure is erased completely, today, for the entire population that exists.**

**Three required properties, each closing a defect found in this arc:**

| Property | Closes |
|---|---|
| **Append-only** | steve F2 — a singular field cannot represent `FAIL→repair→FAIL→repair→PASS` without either losing a failure or being erasable |
| **Self-contained** | copy verdict / requirement / verifier / timestamp *in*. Never index into `attestationHistory` — that is the existing seal's bug, live and latent right now |
| **Read by no capability predicate** | greg — *"a field cannot be both the memorial and the lock"* |

⚠️ **F3 — do not forge a V2 receipt for the legacy twelve.** The existing seal is an *exact pre-clear*
receipt binding original phase, holder, lease timestamps, token fingerprint, blocker, state hash and
resourceVersion. Those facts are unrecoverable for the migrated population. A legacy-backfill note
must bind only what still exists and label the rest unavailable. **Manufacturing precision is worse
than admitting its absence.**

---

## 4. Contract and target lineage; the authority floor (F1 / B)

The minimum that makes R1 safe:

1. **A historical FAIL permanently freezes `targetRef` on that physical row.** Today the freeze keys
   on `attestationHistory`, which reset clears — so the freeze evaporates exactly when it is needed.
2. **A failed verifier-attestation requirement cannot be removed, renamed, or downgraded to executor
   authority** by an ordinary architect reset.
3. **Contract revision is append-only and attributable** — binding old and new requirement hashes plus
   actor, authority and reason.
4. **`allowPreClaim:true` cannot re-admit a pre-reset artifact under a weakened requirement** without
   a separately recorded higher-authority approval.
5. **Old-contract FAIL and new-contract PASS remain separately queryable.** `done` never relabels the
   earlier verdict.

This does **not** forbid authorized correction. It requires correction to be an *attributable contract
revision* rather than a same-row verdict rewrite.

---

## 5. The correction FSM (F4 / C)

Three exits must be **mechanically defined and tested**, not inferred from removed guards:

```
MINOR CORRECTION   preserve executor evidence and the failure note; reopen into a
                   re-verifiable phase; mark the prior active FAIL historical/superseded;
                   permit a new independent attestation.

FULL RESET         persist/backfill the note; discard the forward-satisfying delta;
                   restore spec; remain suspended; permit contract revision under §4.

GIVE UP            failed -> abandoned under explicit steward authority, retaining every note.
```

**Also decide the `review` phase.** `pauseWork` excludes `review` today, so a contract discovered
wrong while awaiting a verifier has no pause/reset route **even before a FAIL**. Support it or rule
it out explicitly.

🔴 **`getLegalMoves` must advertise exactly the callable transitions at every step.** A route that
exists but is not advertised is bug-451's shape; a route advertised but not callable is worse.

---

## 6. The ten `isFailedGateSealed` consumers (greg, measured)

```
:687   decode assignment (the latch)          :2400  listReadyForRole    FILTERS IT OUT
:835   misrepresentsAsClaimable  (+ :4410)    :3988  markFailedSealNoticeProjected
:1988  getNextAction  SKIPS THE CHILD         :4248  refRelatesToWork (WIP cap)
:2152  getLegalMoves                          :4256  refRelatesToWork (relate)
                                              :4275  assertNotFailedSealed  <- the guard
```

🔴 **Narrowing only the guard produces a row that is editable but absent from the ready queue —
correctable but invisible, failing silently rather than loudly.** A row nobody can find is not
meaningfully correctable.

- **`:3988` genuinely wants the memorial** and needs its own explicit `failedGateSeal != null` check
  rather than borrowing the shared predicate. Narrowed, it would reject exactly the rows whose notice
  path matters.
- **`:835`/`:4410` is `migrateSealedRowsToFailedPhase`'s match predicate** — narrowing changes what
  that migration matches, and its scan rationale already rests on the false `:4383` comment (bug-450).
- ⚠️ **`:4248`/`:4256` intent is UNMEASURED.** greg declined to guess it and it must not be guessed
  into an implementation.

---

## 7. Generation and currentness (F6)

For an active topology generation, `applyWorkItemMutation` rejects claimant-contract and edge edits as
`revision_required` regardless of suspension, and there is no public `revise_work` verb.

🔴 **`changesEvidenceContract` is separate from `changesClaimantAuthority`, and the active-generation
fence checks the latter.** So a suspended/reset row may replace `evidenceRequirements` in place while
target/runbook/topology require a semantic revision — and `evidenceRequirements` is part of the node
contract hash. **Physical contract bytes can diverge from the generation binding's frozen hash.**

Publish the full legacy-vs-current-generation matrix. Do not silently exempt failed rows from
currentness, and do not let FULL-tier evidence mutation bypass the generation fence.

---

## 8. State taxonomy (F5) — split from the rest

`TERMINAL_WORK_PHASES` includes `failed_sealed`; message-consumption and pulse logic import that
meaning; `stateDurations` has no failed bucket; `getStintProjection.statusCounts` omits
`failed_sealed` entirely while its `pending` list still includes the child.

⚠️ **steve's boundary, honoured:** projection omissions may be fixed independently, but **do not
reclassify `failed_sealed` as reopenable or add correction-dwell semantics ahead of this FSM.**
State-set changes must preserve today's terminal behaviour until the successor arc ships.

---

## 9. Non-claims

- **Source-read only.** No sealed production row was reset or probed.
- **Whether the twelve carry `effectiveDisposition` in storage is UNMEASURED** — no raw-row read
  exists from any seat. It does not change the fix: if stored, clearing is required; if not, clearing
  is a harmless no-op.
- **greg probed the memory substrate only**; production may differ, though the same object goes
  through the same `putIfMatch` and there is no strip in the file.
- **`:4248`/`:4256` intent unmeasured.**
- **No live instance of an arc blocked by a failed child was found or looked for.** The mechanism is
  measured; the incidence is not.
- **The audit store is not the answer** — Director: *"we don't use it properly and may be redesigned
  in a different arc."*
- ⚠️ **The architect made six wrong claims in the session that produced this packet**, every one a
  constraint believed and never re-measured. Four were caught by greg and steve, two by the Director.
  **Assume more remain in this document.**

---

## 10. What the successor arc must not repeat

**`done` is not clearance.** The audit that produced these requirements completed `done` carrying
CORRECTIONS-REQUIRED and released three implementation nodes into claimable state. Third instance;
`work-610`'s runbook had warned about it in writing, citing the instance before that. Filed as
**bug-453** — *a dependency edge can assert a child reached `done`; it cannot assert what the child
concluded.* **The successor arc must not gate its build on node completion alone.**
