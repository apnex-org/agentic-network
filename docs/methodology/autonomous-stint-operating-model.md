# Autonomous-Stint Operating Model

**Status:** living · **Version:** v2 · **Owner:** architect · **Established:** 2026-06-27 (Director-directed) · **Last refresh:** 2026-06-28 (v2 — work-19 engine folded durable, stint FOCUS + (B) forward-investment framework added, stint-3 lessons banked, §8 set to STINT-4) · **Refresh cadence:** re-run the strategic-review + ledger-reconciliation instruments when the backlog thins or goes stale.

The standing reference for how the architect drives a **fully-autonomous stint**: declare a FOCUS, then prioritise, seed, rank, and continuously drive mission arcs + defects through the work-queue, utilising engineer (greg) and verifier (steve). Referenced throughout the stint. The **live stint** (§8) is the only section that churns; the model (§0–§7) is stable — each stint's lessons fold back into §0–§7 at retrospective (§9).

---

## 0. The self-drive loop (the anchor)

- **work-19** = the autonomous-stint **driver anchor** (`freeform` / `critical` / architect-only). The architect holds it **claimed**, **renews the lease each active turn** (the heartbeat), and **never completes it until the stint-end retrospective**. Its payload carries the engine config (§2) and the ratified **stint FOCUS** (§1) — the FOCUS seeds the anchor.
- **Backstop (validated live):** if the architect stalls/idles past the lease window (~15 min) → the sweeper requeues work-19 → the idea-353 claimable-digest re-wakes the architect → re-engagement. **The queue is the architect's event-driven loop — no external timer.** (Director-designed.) Proven in anger at stint-3: `leaseExpiryCount=2`, queue re-woke the architect with zero manual intervention.
- "Never-complete" is a **documented convention** (the work-19 payload `leaseDiscipline` + the `stint-closed` evidence-requirement + memory), not a Hub-enforced lock. Hardening path (a `refResolvable` Director-gated completion) is banked.
- Recover the lease token any time via `get_work work-19` → `lease.token`, then `renew_lease(work-19, token)`.

## 1. The stint FOCUS (the opener — and the through-line it banks toward)

**Every autonomous stint OPENS by declaring a single FOCUS** — a forward-investment-ranked (§3), SubstrateBanked-checked direction that:

- **(a) SEEDS** the work-19 driver-anchor payload (§0) — the FOCUS is the anchor's stated intent for the stint.
- **(b) BOUNDS scope** — names what is *in* this stint vs what is *deferred* or *banked* (with revivalTrigger, per §3).
- **(c) NAMES the staked summits it banks toward** — the +1 / +2 arcs the base is provably being banked *for*, so the base is never banked indefinitely (the staking-decay term, §3 refinement 4).

The FOCUS is **produced by the engine's ranking (§2)** then **ratified by council and/or Director**, and **recorded in §8 + the work-19 payload**. A stint without an explicit, ratified FOCUS is an anti-pattern — it lets seeding drift toward whatever is cheapest rather than what banks the highest forward value.

- *Examples:* **stint-3** FOCUS = "consolidate the substrate + cleanup conflicting tooling" (implicit — never named as such, a lesson). **stint-4** FOCUS = "**Bank-the-Base** — observability + selection substrate" (the first EXPLICIT, ratified FOCUS; staked summits **C2** [+1], **D-1** [+2]).

**The through-line the FOCUS banks toward** is **"k8s + cognitive continuity"**: a sovereign REST control-plane (**D-1** — Hub = apiserver, oisctl = kubectl, agents = controllers) that **observes + actuates** via the **C1** work-queue, over **containerised, context-aware agents** (**C2 / D-2**), shipped through a **self-verifying, fail-loud** path (**C3**), **bounded by governed autonomy** (**C4**). North-stars: **A13** (amplify the Director's non-scalable attention — the org self-drives) + **A4** (nothing completes silently or masks its own failure). Every FOCUS must name which of these summits it banks toward.

## 2. The engine (prioritise → seed → rank → drive)

*This is the durable codification of the autonomous-stint engine. It previously lived transiently in the work-19 WorkItem payload; it is now canonical here. The work-19 payload carries only the per-stint engine **config** (the FOCUS + the seeded rungs); the engine **spec** is this section.*

**Inputs** (scanned continuously): open ideas (raw candidates), open bugs (defects), open frictions (the friction backlog), in-flight missions, the roadmap (committed arcs), the teles (the value bar), the calibration ledger (pathologies to avoid).

**Instruments** — each a bounded ANALYSIS-RUN convened when the queue thins or a decision-point arises:
- **ledger-reconciliation** — verify open ideas/bugs vs current code; close fixed-but-open + obsolete; **MANDATORY stint-open pre-flight gate** (§7) — RUN THIS FIRST before trusting a stale backlog.
- **strategic-review** — triage + rank the reconciled backlog vs tele.
- **tele-audit** — audit ideas/bugs/code against *one* specific tele.
- **code-audit (CDACC-style)** — spec↔reality conformance drift against a tele.
- **council** — multi-agent adversarial deliberation on a high-uncertainty arc/decision (and the canonical instrument for ratifying a FOCUS, §1).
- **brainstorm** — generate net-new candidate arcs.

**Ranking** — a two-axis judgment, never auto-derived:
1. **tele-alignment FIRST** (which teles it advances + how strongly) — the primary axis.
2. **forward-investment (§3) SECOND** — the hand-computed forward-investment score as a tie-breaker and **base-surfacer**: it surfaces SubstrateBanked base fixes that feature-shaped ideas would otherwise out-rank.
3. Then structural-leverage (kills a pathology class / unblocks other arcs), criticality/dependency, dogfood-value, safety-before-leverage.

**Never rank by speed/effort.** The numeric score is **advisory to a gated rank — it informs, it never auto-ranks** (§3).

**Seeding** — across the three planes (§4), kept sovereign; seed only **verified-live** work (ground-truth from code, §7), and seed the FOCUS's banked rungs first.

**Drive** — keep greg + steve continuously utilised (§5); NO-AGENT-IDLE, NO-MANUAL-PINGS (§5).

The engine's output at stint-open is the **ratified FOCUS** (§1); its output mid-stint is the continuously-reseeded queue.

## 3. The (B) forward-investment framework

The model for *which forward value a candidate banks* — orthogonal to the tele axis, and the second ranking input (§2). Grounded in the Director's shipped `taceng/arc-core` semantics and expressed **natively on Hub entities** (NOT a tool import).

**The payoff axis (value-contingency, orthogonal to lifecycle/commitment):**
- **banked** = no-regret — it cashes regardless of any later bet.
- **staked** = a bet — it only cashes via a summit landing.
- **mixed** = both (a banked half + a staked half).

This is distinct from the **lifecycle/commitment** axis (`candidate` / resourced / option-held). "Not-yet-built" is a lifecycle reading, not a payoff reading — do not conflate them. The graph calculations key off value-contingency.

**The SubstrateBanked invariant (the decisive structural rule):** *a forward / `buildsOn` edge may rest ONLY on shipped+banked substrate, never on a bet.* This **orders the program** — base-before-summit: you may not legally stake a summit's forward edges onto an un-banked (un-shipped or unobservable) base. It is an invariant, not a judgment call.

**The forward-investment SCORE:** `score = in-degree over enablement edges (dependsOn / cashesInto / buildsOn / reCashes) × downstream-summit-value (1–5)`. **Hand-computed** at stint-open, recorded as a field/tag, **advisory to a gated rank — never auto-ranks** (the boundary arc-core draws around "judgment the model can't encode"). Base-of-DAG nodes carry the highest in-degree by topology, which is *why* the score surfaces base work the tele-axis alone would bury.

**The Bug/Idea/Friction→rung enablement BRIDGE:** corrective and structural work (a bug, a friction, a reconciliation verb) draws a forward edge into an arc rung via `enables` / `cashesInto`, and thereby **earns a forward score**. This **dissolves the corrective-vs-forward false dichotomy** — corrective work was never low-value, it was *invisible to ranking because no bridge existed*. (bug-195 "the roll-signal rung", FR-23→#365, idea-357 are the first customers.)

**BUILD NOW (minimal native expression — NO engine):**
1. Native fields on Idea / Bug / Mission: **`payoff`** (banked/staked/mixed) + **`cashesInto`** (summit/arc tag).
2. **`enables` / `forwardEdges`** (list-of-IDs) — the bridge; the minimal expression that lets corrective work accrue in-degree.
3. **`revivalTrigger` + `rationale` REQUIRED on every deferral** — anti-amnesia as a filing discipline.
4. The **hand-computed score-tag** at stint-open, recorded in the stint-report.
5. The **stint-report schema** (idea-369): MIX-by-nature, gen:incorp, tele-coverage gaps, banked-rung inventory, staked/banked balance, the score-ranked next-stint menu (reusing arc's delta-ledger `kind` vocab `[create/ship/park/revive/retire/…]`).

**BANKED (do NOT build — idea-371):** the mechanised arc-engine — auto-`traverse` / score computation, automated park/cut cascade, generated rollups, `@apnex/arc-core` as an org tenant. **revivalTrigger:** "forward-investment concepts proven over ≥3 stints" OR "a stint demonstrably mis-ranked despite the manual score."

**Four autonomous-stint-native refinements (adopt):**
1. **`dogfoodProves` / `validatedBy` edge** — the org is its own first customer (work-19 validated live at `leaseExpiryCount=2`); an edge from a shipped rung to the stint that exercised it *upgrades confidence in its banked status*.
2. **Observability-multiplier on summit-value** — a banked rung you cannot *observe* is effectively a bet; rungs that convert assumed-state→ground-truth (idea-357, C1-widen, idea-364, telemetry) get a multiplier because they raise the reliability of *every other rung's* banked status. (This is why observability is co-equal with incorporation in stint-4's FOCUS.)
3. **Director-attention negative-edge (A13)** — items that *reduce Director-gating in-degree* (C2/FR-23, governance relaxation) earn forward-investment via attention-saved; the autonomous org has a human-attention budget arc-core does not.
4. **Staking-obligation / summit-liveness decay** — banked base substrate that **no summit stakes within N stints** is dead capital; its score must **decay**. The dual of SubstrateBanked: bank the base, but re-price it down when its intended summit stays dormant. **This is the structural cure for the generation-skew** (the org banking inward forever) — it makes indefinite banking impossible and forces the stake.

## 4. The three planes + the architect-deliverable taxonomy

**The three planes (kept sovereign — A3):**
1. **Project state (entities)** — Ideas / Missions / Bugs / Designs / Teles / Agents = the durable truth (A1).
2. **Work items (the queue)** — the claimable execution / work-assignment plane.
3. **Comms (threads / councils / notes / events)** — deliberation + signal.

The queue does **not** replace comms. Threads & councils remain where agents *deliberate* — **except** a forward-**scheduled** agent-led discussion/brainstorm/council, which is an **ANALYSIS-RUN WorkItem** (the *schedule + close-evidence*), with the deliberation still happening in the thread. Planes interlock (a WorkItem's `targetRef`→entity; a thread discusses a WorkItem; a digest is a comms-event carrying a work-plane signal) but stay sovereign.

**Architect-deliverable taxonomy (WorkItem shapes):**
- **PRODUCE-ARTIFACT** (`task`) — build a doc/design/spec.
- **REVIEW-DELTA** (`review`) — review a change.
- **ANALYSIS-RUN** (`freeform`) — a workflow / council / audit (the forward-scheduled deliberation).
- **VERIFY-GATE** (`verifier-gate`) — steve's adversarial verification.
- **GATE-ASSESS** (`task`/`freeform`) — a phase/release-gate assessment.

**The no-WorkItem meta-layer** (the controller reads/writes the queue, isn't *on* it): continuous mission-driving, threading/dispatch, queue-watch, cross-approval/merge. **Boundary test:** bounded + closable + evidenceable → WorkItem; else meta-layer.

## 5. Driving greg + steve + the controller

- **greg (engineer):** keep the build-queue seeded **1–2 slices ahead** — no idle gaps. He self-wakes off the claimable-digest (pulse-free). Seed only **verified-live** work (§7).
- **steve (verifier, opencode):** seed verifier-gate + adversarial-review items in **parallel** with greg's builds. The verifier-gate is **MANDATORY-to-run + generative + release-decision-critical** on every Hub / backplane / deploy-gating slice (it caught real substrate bugs pre-merge at stint-3), with an expected **proof-bar** — faithful real-substrate probes when the risk is substrate semantics, and **mutation-verify the critical invariant's own test** (a green test that still passes under a deliberately-broken invariant is a non-test). **BUT the verifier stays ADVISORY in authority:** the verdict *informs* the architect's merge/deploy decision — it is never a hard veto, and a merge-block is mutual discipline, not verifier authority (the Director-ratified verifier-role §1/§2.3; any move to verifier hard-gating authority needs Director re-ratification). (Live since the idea-355 consolidation: self-wakes off the queue + honest liveness.)
- **controller (architect):** reconcile → run an instrument when the queue thins → seed/rank → cross-approve/merge/deploy → drive. **Run ahead so neither waits.**

**Two standing invariants:**
- **NO-MANUAL-PINGS** — the claimable-digest + lease-expiry backstop are the substrate; manually pinging a peer to wake it is an anti-pattern (it masks a queue/liveness gap that should be fixed at the substrate).
- **NO-AGENT-IDLE** — no agent (greg, steve, *or the architect*) sits idle while another's deliverable is pending; give each a parallel queue and let the awaited gate jump the queue when it lands.

**Mid-stint-pivot discipline:** when a new FOCUS or re-framing arrives mid-stint, **surface + disposition ALL in-flight work** (each WorkItem: carry / park-with-revivalTrigger / cut) before reseeding — a silent pivot strands built-but-unmerged work and produces future drift. **Pivot, don't pause** (§6): re-aim the queue, don't stall the agents.

## 6. Deploy posture (Director-approved for the solo stint)

- **Flow autonomously:** tested + cross-approved + steve-adversarial-verified + **reversible** work — DR-record every step + **roll-confirm** each deploy.
- **Prod Hub deploys** (auto-triggered by `deploy-hub.yml` on `hub/**` merge → watchtower rolls the VM): flow the **safety-critical / well-bounded** ones with full care; **QUEUE large or backplane-risky** changes as director-gate WorkItems for Director review.
- **Director-gated DECISIONS** (not buildable work) — surface as director-gate WorkItems on the Director's queue; do **not** decide solo: the C1 widen, the C2 next-arc focus, idea-121, and decision-gated bugs (e.g. Task-retire-vs-fix).
- **The opencode bundle** redeploy is architect-publishable + reversible (rollback = revert the bundle-repo); the **steve restart** is the operator touch-point.

**Reusable deploy/ship primitives (validated):**
- **CI-gated merge-train** — stack PRs through the CI gate in dependency order; the gate catches cross-package / wiring breaks the author's own test-run misses.
- **Vehicle-C** — the consolidation-vehicle pattern (a single integrating PR/branch that absorbs a cluster of related slices) for substrate-consolidation arcs.
- **pivot-not-pause** — re-aim the queue on a new focus rather than stalling agents (pairs with §5 mid-stint-pivot).
- **held-time-verify** — verify a built-but-held change against current `main` at the moment it is released, not only at author-time (held work goes stale).

## 7. Operating axioms

- **Reconciliation is a MANDATORY stint-open pre-flight gate** — run ledger-reconciliation BEFORE strategic-review / seeding. Zero-build; it deleted ~52% of wasted seed-candidates at stint-3 *after the fact*. Never trust a stale backlog.
- **Ground-truth-over-assumption (4-surface)** — ground-truth an item from *code* before acting on it, across all four surfaces: **sizing / seeding / audit-promotion / deploy-diagnosis** (cal #85, generalised). Never act on ledger-recall or assumed state.
- **Fix-the-class, not-the-instance** (A8; cal #88 corollary) — when a defect is one of a class, sweep the class (claim-time path-enumeration + blast-radius grep) rather than patching the single instance.
- **Standing post-stint Idea Triage + backlog-health metric** — close the incorporation funnel: triage the open-idea cohort (keep-vs-CUT, triage tags) and track a backlog-health metric every stint-close (the gen:incorp constraint).
- Mechanise + declare before any imperative path · tele-alignment over speed · safety before leverage · NARROW adoption first, widen after dogfood · flow verifier-gated, reversible deploys autonomously (pre-gate only genuine hard-lines) · **verifier-gate is mandatory-to-run + generative + release-critical on backplane/deploy slices, yet the verifier stays advisory-in-authority (never a hard veto — ratified verifier-role)** · thin-shim / shared-kernel · `get_agents` is the canonical roster · decisions → DR-ledger, calibrations → architect-fileable / Director-curates · **version-bump co-commits with the final src PR of a ship** (the version-gate fired 3× at stint-3 from split bumps) · **never bypass the ship-path gate.**

## 8. The live stint — STINT-4 (ratified 2026-06-28)

**Ratified FOCUS: "Bank-the-Base" — ground-truth observability + selection substrate.** Convert the org's two named binding constraints — **incorporation** and **observability** — from un-banked bets into shipped+banked substrate, in one DAG layer, with the cheap ship-integrity rung co-shipped to satisfy SubstrateBanked. (Seat-1 ∩ Seat-3 council fusion; the forward-investment score + SubstrateBanked rule *dictate* this ordering, they do not merely permit it.)

**Named staked summits (the base is banked *for* these):**
- **C2** (agent-lifecycle / unattended runtime) — **+1**, executes NEXT stint on the banked observability base (C2 Survey/Design grafts INTO this stint as the on-ramp).
- **D-1** (R1 REST read-binding — the outward "k8s" half) — **+2**, NEXT-after-C2 once observability + ship-integrity are banked (SubstrateBanked would be *violated* by staking it now).

**BANKED base rungs (this stint — no-regret, seeded ready):**
- **idea-357** — `list_work` + push-events (the KEYSTONE, highest in-degree ~30; controller reads ground-truth CI/deploy/WI state). Sequence the `list_work` part FIRST as the cheap MCP cash, then push-events.
- **idea-364** — reconciliation-verb (the ROOT, ~20; deletes stale-candidates before waste; doubles as seed-gen).
- **bug-195** — deploy roll-confirm + concurrency-cancel (the SubstrateBanked ship-integrity rung every code arc rests on).
- **idea-363** — funnel-triage + backlog-health metric (triage tags + keep-vs-CUT over the open-idea cohort).
- **idea-369** (+ **idea-368** close-packet) — stint-report-schema (mechanises this very artifact; the persistence home for score + deferrals).
- **bug-185** — durable park-state (ends lease-churn; completes the ship-integrity loop).
- **cal #85-discipline** — ground-truth-over-assumption (4-surface), zero-build cognitive overlay so the ground-truth signals get *used*.

**Mixed rungs (banked half now, staked half carried):** idea-370 (forward-investment framework — fields + score-tag banked; ranking-value staked) · idea-367 (generative-telemetry — instrumentation banked; tele-ranking half staked).

**The staking-decay note:** stint-3 was a textbook BANKED stint — high no-regret cash, **near-zero forward-summit in-degree created** (~0 summits staked). The staking-decay clock (§3 refinement 4) now runs: stint-4 banks the base, and the **+1 (C2) / +2 (D-1) summits MUST stake** in the following stints, or the banked base re-prices down as dead capital. This is the structural cure for the generation-skew — naming the summits makes the base provably banked *for* a stake, not as an inward dead-end.

**Engine banked-with-trigger:** the mechanised arc-engine (**idea-371**) stays BANKED — build only the §3 native fields + hand-computed score + report-schema this stint. **revivalTrigger:** forward-investment concepts proven over ≥3 stints, OR a stint demonstrably mis-ranked despite the manual score.

**Director-gate queue for return:** C1-widen go/no-go (3 dogfoods now proven — council rec: GO) · C2 next-arc focus · idea-121 focus · bug-107 fold-into-bug-195 decision · the decision-gated bugs.

## 9. Lessons fold-back (the only durable note)

Each stint's lessons fold back into §0–§7 at the retrospective — they are not accumulated here. **§8 is the only churning section.** (Stint-3's lessons — reconciliation-first, ground-truth-from-code, version-bump co-commits, keep adversarial-review + the CI gate in the deploy-gating loop — are now folded into §2, §5, §6, and §7.)

---
*Sources: the engine + anchor are now canonical here (§0, §2), no longer transient in the work-19 payload; the (B) framework is grounded in `taceng/arc-core` and the stint-3 next-stint council judge's output; the strategic-review + ledger-reconciliation outputs are the backlog provenance; decisions → `docs/decisions/` DR-ledger; the roadmap → `docs/roadmap.md`.*
