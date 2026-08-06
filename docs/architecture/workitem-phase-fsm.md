# The WorkItem phase FSM — complete taxonomy

**Measured first-party against `origin/main` @ `7efbac35` on 2026-08-06.**
**Director-requested: *"a full matrix/table describing each of the FSM states, so that we can reason with the taxonomy of the whole."***

> ## 🔴 THIS DOCUMENT DESCRIBES CODE, SO IT LIVES WITH THE CODE.
> A Hub document is invisible to a PR: when someone adds a phase, the reviewer sees the diff and **does not see a Hub doc going stale**. Three descriptions outlived what they described in a single day (`:2809`'s comment, `bug-518`'s note, a survey asserting a gap its own author had closed). **A repo doc drifts visibly, in a diff, in front of a reviewer.**

**Columns marked ✅ are asserted by `workitem-phase-fsm-conformance.test.ts` — this document fails the build when they lie. Columns marked 📝 are prose and are NOT machine-checked.**

---

## §1 — 🔴 NODE STATE IS REPRESENTED THREE WAYS, AND TWO CAN DISAGREE WITH THE FIRST

**This is the finding that made the table necessary. A table of `status` alone reproduces the blindness it exists to remove.**

| axis | kind | where |
|---|---|---|
| **`status`** | STORED phase, 9 values | `work-item.ts:49`, derived from `WORK_ITEM_PHASES` |
| **`suspended`** | **ATTRIBUTE — orthogonal to phase** | `pause_work` sets it and **leaves `status` untouched** |
| **`effectiveDisposition`** | **DERIVED**, `"failed_sealed" \| null` | `isFailedGateSealed()` |

🔴 **`suspended:true` + `status:"ready"` IS A REAL STATE THAT NO PHASE LIST SHOWS YOU.** That is `bug-454`'s root: a dormant row is invisible to `list_work(status="paused")` **and is counted as `ready`.** Under- and over-report from one defect, and **the totals still reconcile.**

🔴 **`effectiveDisposition` HAS ALREADY DRIFTED FROM `status` ONCE** — `work-item.ts:42` records the stored phase and the derivation disagreeing; `bug-371` began storing the terminal phase so filter and display agree **by construction rather than by a derivation someone has to keep in step.**

⚠️ **AND IT IS SELF-SUSTAINING: `isFailedGateSealed` (`:1047`) is `effectiveDisposition === "failed_sealed" || failedGateSeal != null || hasActiveVerifierFail(item)` — the derivation READS the stored value as one of three OR'd inputs. Once set, it holds even if the other two clear.** *Not a defect; a property worth knowing before anyone edits it.*

---

## §2 — THE NINE PHASES

### ✅ DERIVABLE — GENERATED FROM THE CODE. This block is an OUTPUT, not a description.

🔴 **Do not hand-edit. `fsm-table-generator.ts` emits it and the conformance test requires a BYTE-FOR-BYTE match, so drift surfaces as a diff in a PR.** *This is to a document what #748's D6 fix was to the storage enum: asserting leaves two artifacts someone must keep in step; **generating leaves one**.*

<!-- BEGIN GENERATED: derived from code. Do not hand-edit. -->

| phase | dependent effect | counts as WIP | holds a lease | releasable | terminal |
|---|---|---|---|---|---|
| `ready` | pending | – | – | – | – |
| `claimed` | pending | yes | yes | yes | – |
| `in_progress` | pending | yes | yes | yes | – |
| `blocked` | pending | yes | yes | yes | – |
| `paused` | pending | – | – | – | – |
| `review` | pending | yes | yes | – | – |
| `done` | satisfied | – | – | – | yes |
| `abandoned` | dropped_abandoned | – | – | – | yes |
| `failed_sealed` | pending | – | – | – | yes |

<!-- END GENERATED -->

**`done` is the ONLY phase that satisfies a `dependsOn` edge.** `abandoned` DROPS OUT (Director, 2026-07-29: *"fail-closed is the right posture toward the UNKNOWN; it is the wrong posture toward the DECIDED"*). **`failed_sealed` BLOCKS, deliberately** — *"a gate that drops its own failures is not a gate."*

### 📝 PROSE — NOT MACHINE-CHECKED. Treat with the scepticism the ✅ half does not need.

| phase | live assignment sites | `suspended` reachable here? | `effectiveDisposition` |
|---|---|---|---|
| `ready` | 7 | **YES — and it is the DEFAULT dormant appearance** | `null` |
| `claimed` | 2 | yes | `null` |
| `in_progress` | 4 | yes | `null` |
| `blocked` | 2 | yes | `null` |
| `paused` | **0** 🔴 | n/a — legacy rows only | `null` |
| `review` | 3 | unmeasured | `null` |
| `done` | 3 | no | `null` |
| `abandoned` | 6 | cleared on abandon (`:3933`) | `null` |
| `failed_sealed` | 3 | no | **`"failed_sealed"`** |

⚠️ **Counts are assignment sites with comment lines excluded, two-sidedly controlled (`paused` must be 0 — it is; `review` must be non-zero — it is 3). They are a FLOOR on assignment sites, NOT a live-vs-migration split.**

## §3 — 🔴 `paused` IS VESTIGIAL

**Zero live writers. All five "sites" are comments describing a LEGACY population.** `idea-640` made suspension an attribute and **`status` is deliberately not written**; `isSuspended` (`:242`) ORs the legacy phase *"for the guards that protect."*

⇒ **The retention was DELIBERATE. Only its REMOVAL was never scheduled.** The type declares it, the storage enum allows it, `list_work` offers it as a filter value, `stateDurations` keeps a bucket for it — **and no row can newly enter it.**

---

## §4 — 📝 WHAT IS NOT HERE, AND WHY

**`stopped` IS NOT A WorkItem CONCEPT.** Measured with a control: every hit is prose, or `repo-event-handler.ts`'s **own unrelated FSM**. *The next person will ask; this is the answer.*

**`cancelled` WAS NEVER BUILT.** Considered 2026-07 and fenced as new scope. A Mission migration note says *"Design v0.2 'cancelled' was wrong."*

---

## §5 — ⚠️ NON-CLAIMS. READ THESE BEFORE CITING THE TABLE.

· 🔴 **"ROWS TODAY" IS DELIBERATELY ABSENT.** Both available instruments return zero for different reasons: `list_work(status=X)` cannot see a suspended row (`bug-454`), and `stateDurations` accrues **on exit** so a row *currently* in a phase reports zero. **Their agreement looks like corroboration.** Two cells are known from earlier today — `paused` = 0, `failed_sealed` = 16 — **and completing the column is ~7 calls against an instrument known-broken for at least one cell. NOT MEASURED, NOT INFERRED, NOT BLANK-BY-OVERSIGHT.**
· **Live-writer counts are ASSIGNMENT SITES with comment lines excluded, two-sidedly controlled** (`paused` must be 0 — it is; `review` must be non-zero — it is 3). ⚠️ **They are NOT separated into live-vs-migration for seven of nine phases.** `paused` (0) and `failed_sealed` (attest path + one in-file migration) are resolved; **the rest are a floor on "assignment sites", not a claim about live paths.**
· 🔴 **`WIP_PHASES` AND `LEASE_HELD_PHASES` ARE IDENTICAL** — both `["claimed","in_progress","blocked","review"]`, two hand-maintained lists with a comment saying one "mirrors" the other. **Same shape as the D6 enum/type split that `#748` fixed by derivation. NOT FIXED HERE — filed, not chased.**
· **The `suspended` column is PROSE.** Which phases a suspended row can occupy is not asserted anywhere; only `abandoned` is measured to clear it.
· ⚠️ **EXHAUSTIVENESS: `#748` made `classifyGateChild` an exhaustive `Record`, so THAT site fails to compile when a phase is added. Every other `status === "literal"` comparison remains a silent fall-through** (`work-item.ts:53`, still accurate). **So a grep-based survey of the remaining sites still cannot be proven complete.**
