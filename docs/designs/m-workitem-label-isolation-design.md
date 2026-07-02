# M-WorkItem-Label-Isolation — Design v0.1 (FINDINGS + future mission arc)

**Status:** v0.1 — FINDINGS captured; NOT yet scoped for implementation. This
documents a real isolation gap discovered while onboarding the pi harness for
multi-agent (greg/lily/steve) testing against the **production** Hub. Full
closure is suspected to be a **mission arc requiring the team** (architect owns
the WorkItem contract shape per the c1 arc RACI). A **lightweight interim
mitigation** is being applied separately to unblock testing now (see §6); this
doc is the uplift target.
**Mission class:** control-plane correctness / multi-tenant isolation of the live
work substrate.
**Discovered by:** pi-harness onboarding, 2026-07-02 (greg-pi / steve-pitest /
lily-pitest sandboxes connected to prod Hub).
**Axioms in force (audit, not generator):**
- A8 Gated Recursive Integrity — an isolation claim that is not *enforced* is a
  false gate; the audit below establishes reality before any fix is designed.
- A11 Cognitive Minimalism — the fix must add ONE coherent isolation primitive,
  not a second parallel label system alongside the legacy Task path.
- A2 Isomorphic Specification — Task and WorkItem should not diverge on a
  safety-critical dimension (claim scoping) without a decision recording why.
**Governing prior:** `docs/designs/c1-sovereign-work-control-plane-arc-design.md`
(the WorkItem keystone; R2 built the kind + verbs + FSM; §"Not-built rungs" is
where deferred dimensions are auditable). This gap belongs as a NAMED deferred
rung of that arc.

---

## §1 The finding (ground truth, verified 2026-07-02)

While onboarding the three agents onto the pi harness for coordinated multi-mission
work, each sandbox was configured `labels: {env: test}` on the belief that this
would isolate it from **production** work on the shared prod Hub. **It does not.**

**Verified by inspection of the live code + a live read (`list_ready_work` from
`lily-pitest`, an `{env:test}` architect):**

1. **`lily-pitest` (env:test) saw 4 REAL prod WorkItems** as claimable —
   `work-83` (S1-PILOT merge-queue), `work-5` (bug-180 smoke), `work-76`
   (tele-refresh), `work-81` (triage). All live backlog. `claimable=4` in the
   agent-status log. The env:test label had **zero** effect on this pull view.

2. **The `WorkItem` type has NO `labels` field.**
   `hub/src/entities/work-item.ts` (`interface WorkItem`, `IWorkItemStore.createWorkItem`)
   defines claim-gating fields as `roleEligibility[] · dependsOn · completionDependsOn
   · status · lease · quarantine` — and nothing else. The v2-envelope schema comment
   is explicit: *"WorkItem has no array→map (Bug.tags→labels)…"* (WorkItem.ts:12).

3. **The claim eligibility predicate references labels ZERO times.**
   `hub/src/entities/work-item-repository-substrate.ts` gates claim on
   `role + deps + WIP-cap + quarantine + status=ready`. There is no label
   dimension to enforce because the field does not exist.

## §2 Why the gap exists (the Task ↔ WorkItem divergence)

The **legacy `Task`/directive path IS label-aware:**
- `taskClaimableBy(taskLabels, claimantLabels)` — claim allowed iff task labels
  are a **subset** of the claimant's labels (`hub/src/state.ts`).
- `create_task` **propagates the caller's Agent labels onto the new Task**
  (`hub/src/policy/task-policy.ts:105`, "Mission-19: propagate caller's Agent
  labels onto the new Task").

The newer **WorkItem spine (c1 arc / work-94)** — which is what is actually LIVE
and what agents claim today — was built role-first and **dropped the label
dimension entirely.** So the two work systems diverge on a safety-critical axis:
Task claim is env-scopable; WorkItem claim is not.

This is an **A2 (isomorphic spec) violation with a safety consequence**: an
operator's reasonable mental model ("env:test walls me off from prod work") holds
for Task but silently fails for WorkItem.

## §3 What `{env:test}` labels DO isolate (so the picture is honest)

Labels are NOT useless — they gate the **push-dispatch** path:
- Notification routing uses `matchLabels` equality (`hub/src/state.ts` `labelsMatch`).
  `env:test ≠ env:prod` → an env:test sandbox does **not receive** prod
  push-dispatched notifications / directive_acknowledged / role-targeted notes.

So the gap is precisely: **PUSH is isolated by labels; PULL (WorkItem claim) is
NOT.** Any agent that can reach the pull surface can claim any role-eligible,
dep-met, ready WorkItem regardless of env.

## §4 Blast radius / severity

- **Severity: high for multi-tenant/test-on-prod use.** A test or experimental
  agent on the prod Hub can claim and lease REAL work, silently starving the
  intended claimant and holding a lease it will not complete.
- **Not currently exploited in normal operation** because prod agents all share
  the same env and self-pick legitimately. It only bites when someone introduces
  an agent that is *meant* to be isolated (exactly the pi-onboarding case).
- Adjacent smell: the 4 prod WorkItems carry `label/slice/kind` **inside their
  `payload`** (advisory), giving a false impression of labeling — but `payload`
  is opaque to the claim predicate.

## §5 Proposed fix (the uplift — team mission arc)

Add ONE coherent isolation primitive to the WorkItem spine, at parity with Task
(A11: extend the existing primitive, do NOT build a second system):

1. **Schema:** add `labels?: Record<string,string>` to `WorkItem` (envelope
   spec-partitioned, GIN-indexed for the subset query) + `createWorkItem`
   param.
2. **`create_work` label source:** propagate the **caller's Agent labels** onto
   the new WorkItem (mirror `task-policy.ts:105`). Optionally allow an explicit
   `labels` arg that must be a subset of the caller's (no privilege escalation).
3. **Claim predicate:** extend `work-item-repository-substrate` eligibility with
   `workItemClaimableBy(item.labels, claimant.labels)` — subset semantics
   identical to `taskClaimableBy`. **Unlabeled item ⇒ claimable by anyone**
   (back-compat; matches Task's `taskKeys.length===0 ⇒ true`).
4. **`list_ready_work`:** apply the same filter so the digest never over-reports.
5. **Migration:** existing WorkItems have no labels ⇒ remain universally
   claimable (no behavior change for prod). The isolation is opt-in via labeled
   agents creating labeled items.
6. **Tests:** parity suite mirroring the Task claim-eligibility tests; a
   cross-env negative test (env:test agent CANNOT claim an env:prod item; CAN
   claim its own env:test item; CAN still claim an unlabeled item — the residual
   documented, not silently closed).

**RACI (per c1 arc):** architect OWNS the WorkItem contract shape (SchemaDef +
renameMap + verb semantics); greg LEADS construction. Lands via PR + merge queue
+ the version-bump/assert gates. Envelope migration ⇒ this is a schema-touching
mission, not a one-file patch — hence "arc requiring the team."

**Open questions for the team:**
- Q1: subset semantics (Task parity) vs exact-match — subset is the incumbent;
  keep it unless a multi-label case argues otherwise.
- Q2: should an explicit `labels` arg on `create_work` be allowed, or always
  inherit-from-caller (simpler, spoof-proof)? Lean: inherit-only for v1.
- Q3: do we also want a HARD env-guard (a "test agent may NEVER claim an
  unlabeled prod item") — i.e. close the unlabeled-is-universal residual for
  explicitly-scoped agents? That is stricter than Task and worth a decision.

## §6 Interim mitigation (applied NOW, separate from this mission)

Until the fix lands, the ONLY safe WorkItem isolation is **operator discipline +
narrow primitives**, NOT labels:
- **Claim by specific `workId` only** (`claim_work` takes a WorkItem id — it is
  NOT a blind "claim next"), never the blind digest.
- **Scope test items via `roleEligibility`** to the intended test claimant.
- **Mark test items `PI-TEST …`** in the title + clean them up (`abandon_work` /
  complete) so they do not pollute the prod backlog.
- **Never claim** `work-83 / work-5 / work-76 / work-81` (or any non-PI-TEST id)
  from a sandbox.

This lets pi multi-agent messaging/notes/work-lifecycle testing proceed safely
today while the real isolation primitive is a scheduled uplift.

## §6.5 Adjacent findings from the pi multi-agent smoke (2026-07-02)

Surfaced while running the guardrailed lifecycle + messaging test (work-109
create→claim→start→complete + lily↔steve note round-trip, both confirmed). Not
blocking, but worth a triage — filed here to avoid loss (A4):

1. **`list_messages` has no name-based recipient filter.** It filters by raw
   `targetAgentId` (e.g. `agent-379325fa`), `targetRole`, `authorAgentId`,
   `threadId`, `status`, `delivery`, `since`. `create_message` accepts a
   friendly `target.name` (resolved server-side), but the READ side offers no
   symmetric `name`/`recipientName` filter — so an agent that knows a peer by
   name cannot filter its inbox by that name; it must first resolve name→agentId.
   A `targetName` filter (or auto-resolving `targetAgentId` when a name is
   passed) would restore read/write symmetry (A2). Cost: an LLM agent wastes a
   turn "not finding" a message that IS there (observed live).
2. **Inbox noise: 500 anonymous messages** (`anonymous-engineer` /
   `anonymous-architect`, thread/smoke traffic) dominate an unfiltered
   `list_messages` for a new agent — makes the default inbox view low-signal
   without a target filter. Pairs with #1: the fix is good default filtering
   (inbox = messages targeted to me), not just more filter knobs.

## §7 Definition of done (for the future mission)

- WorkItem carries enforced `labels`; claim + list predicates honor subset scope.
- An `{env:test}` agent provably CANNOT claim an `{env:prod}` WorkItem (negative
  test + a live cross-env dogfood on the prod Hub).
- Task ↔ WorkItem no longer diverge on claim-scoping (A2 restored), or a decision
  records why they intentionally differ.
- This doc's §6 interim discipline is retired; env-scoping becomes a real
  isolation primitive for multi-agent testing on shared Hubs.
