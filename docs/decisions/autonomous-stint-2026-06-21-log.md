# Autonomous Stint — Decision Log (2026-06-21)

**Authority:** the Director granted lily (architect) **temporary Director authority** to drive the organisation (lily + greg + steve) autonomously — advancing current arcs and improving the system per the Teles — until the Director returns from an extended absence. This log is the durable record of every decision made under that grant, for Director review on return.

**Operating principle:** lily does **not halt**. When gated on a team deliverable or a deferred decision, lily parks the block and progresses other non-blocked work (the move-on queue). A cron heartbeat + event-driven peer wakes keep the stint moving.

---

## Framework

### Decision protocol (any decision that would normally be flagged "Director input")
1. **Triangulate** against ALL relevant Teles (cite which + how each bears).
2. **Lean:** pick the best option; if the Tele review reveals a better-shaped option, adjust the option set.
3. **Record** here as DR-NNN (context · tele-triangulation · options · lean · disposition).
4. **Sufficiency:** is there enough information for lily to make + execute?
5. **If yes →** decide + execute; mark `lily-executed`.
6. **If it absolutely must be Director (a hard line) →** mark `director-deferred` and **MOVE ON** — do not halt.

### Hard lines (always Director — record + defer + move on; never autonomous)
- **Editing Tele content** — constitutional; immutable without Director ratification. (May *propose* via a DR.)
- **Irreversible / destructive / data-loss-risking prod actions** — data migrations, deletions, anything not cleanly reversible.
- **Merging the constitutional ledgers to main** (teles, calibrations) without strong cause — prepare as a PR + defer.
- **New outward-facing / published surfaces beyond the established pattern** — new external repos, public releases, sending to new external services.

### Within authority (decide + execute; record)
- **Arc + submission lifecycle** per current RACI — PRs, merges (via peer cross-approval), mission/idea/bug lifecycle, task issuance, thread coordination.
- **Prod Hub deploy** of changes that are **TESTED** (suite-green) **+ REVERSIBLE** (redeploy/rollback) **+ VERIFIER-GATED** (Steve / R3 post-roll verification). [DR-002]
- **Tasking + coordinating greg + steve**; convening councils; brainstorms; reviews.
- **Audits, bug-resolution design (vs Teles), documentation, mission-arc adjustments.**

### Move-on queue (when gated — never idle)
Strategic audits (bugs / ideas / mission-arcs); bug-resolution design + execution; parked-decision critique vs Teles (with greg/steve); doc review+update; councils w/ greg+steve to brainstorm new ideas + mission arcs; hardening; sovereign-duties / modularity / deduplication audit; interface/component improvements. Keep greg + steve on valuable work; never let them idle.

### Continuation
Cron heartbeat (~15 min, session-scoped) + event-driven wakes from peer responses. The stint never halts on a block; it parks + progresses elsewhere.

---

## Decision Records

### DR-001 — Adopt the autonomous-stint framework · `lily-executed`
- **Context:** Director away (extended); granted lily temporary Director authority + asked lily to design + run this framework.
- **Tele-triangulation:** tele-13 (Director-intent amplification — economise the non-scalable Director-attention resource; this grant *is* tele-13 in action); tele-3 (sovereign composition — lily owns arc/merge per RACI); tele-6 (frictionless collaboration — keep the org moving); tele-8/9 (integrity — bounded by the hard lines + verifier-gating). No tele conflict; the guardrails ARE the tele-8/9 integrity backstop on the authority.
- **Disposition:** ADOPT. The log + the memory anchor + the Hub ledger are the Director's review trail.

### DR-002 — Prod Hub deploy authority under the grant · `lily-executed` (standing policy)
- **Context:** the verifier-cutover-fixes deploy (+ future Hub/shim deploys) would normally need per-occasion Director auth; Director is away.
- **Tele-triangulation:** tele-8/9 (gated/validated deployment — *supports* deploying WITH verification; this is exactly R3's thesis); tele-4 (no silent failure — requires reversibility + post-deploy verification); tele-13 (don't make the Director the deploy bottleneck); tele-10 (deploy is mechanised/watchtower — first-class + observable). The risk (an unverified/irreversible prod change with no human oversight) is mitigated because the org now HAS a verifier (Steve) + an acceptance-gate contract (R3).
- **Options (tele-adjusted):** (a) defer all prod deploys → stalls every arc, violates the grant's intent; (b) deploy freely → integrity risk (tele-8); (c) **deploy TESTED + REVERSIBLE + VERIFIER-GATED changes; defer irreversible/destructive ones.**
- **Disposition:** **(c)**, standing policy. Each actual deploy is recorded as its own DR with suite-status + post-roll verification result. Irreversible/destructive prod actions remain a hard line (director-deferred).

---

*(Subsequent decisions appended as DR-003, DR-004, … during the stint.)*
