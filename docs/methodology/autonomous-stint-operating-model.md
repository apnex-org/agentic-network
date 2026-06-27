# Autonomous-Stint Operating Model

**Status:** living · **Owner:** architect · **Established:** 2026-06-27 (Director-directed) · **Refresh:** re-run the strategic-review + ledger-reconciliation instruments when the backlog thins or goes stale.

The standing reference for how the architect drives a **fully-autonomous stint**: prioritise, seed, rank, and continuously drive mission arcs + defects through the work-queue, utilising engineer (greg) and verifier (steve). Referenced throughout the stint. The **live backlog** (§8) is the only section that churns; the model (§0–§7) is stable.

---

## 0. The self-drive loop (the anchor)

- **work-19** = the autonomous-stint **driver anchor** (`freeform` / `critical` / architect-only). The architect holds it **claimed**, **renews the lease each active turn** (the heartbeat), and **never completes it until the stint-end retrospective**.
- **Backstop:** if the architect stalls/idles past the lease window (~15 min) → the sweeper requeues work-19 → the idea-353 claimable-digest re-wakes the architect → re-engagement. **The queue is the architect's event-driven loop — no external timer.** (Director-designed.)
- "Never-complete" is a **documented convention** (the work-19 payload `leaseDiscipline` + the `stint-closed` evidence-requirement + memory), not a Hub-enforced lock. Hardening path (a `refResolvable` Director-gated completion) is banked.
- Recover the lease token any time via `get_work work-19` → `lease.token`, then `renew_lease(work-19, token)`.

## 1. The through-line

The whole roadmap is **"k8s + cognitive continuity"**: a sovereign REST control-plane (**D-1** — Hub = apiserver, oisctl = kubectl, agents = controllers) that **observes + actuates** via the **C1** work-queue, over **containerised, context-aware agents** (**C2 / D-2**), shipped through a **self-verifying, fail-loud** path (**C3**), **bounded by governed autonomy** (**C4**). North-stars: **tele-13** (amplify the Director's non-scalable attention — the org self-drives) + **tele-4** (nothing completes silently or masks its own failure).

## 2. The engine (prioritise → seed → rank → drive)

**Inputs** (scanned continuously): open ideas (raw candidates), open bugs (defects), in-flight missions, the roadmap (committed arcs), the teles (the value bar), the calibration ledger (pathologies to avoid).

**Instruments** — each a bounded ANALYSIS-RUN convened when the queue thins or a decision-point arises:
- **ledger-reconciliation** — verify open ideas/bugs vs current code; close fixed-but-open + obsolete; **RUN THIS FIRST** before trusting a stale backlog (see §9).
- **strategic-review** — triage + rank the reconciled backlog vs tele.
- **tele-audit** — audit ideas/bugs/code against *one* specific tele.
- **code-audit (CDACC-style)** — spec↔reality conformance drift against a tele.
- **council** — multi-agent adversarial deliberation on a high-uncertainty arc/decision.
- **brainstorm** — generate net-new candidate arcs.

**Ranking** — **tele-alignment FIRST** (which teles it advances + how strongly), then structural-leverage (kills a pathology class / unblocks other arcs), criticality/dependency, dogfood-value, safety-before-leverage. **Never rank by speed/effort.**

**Seeding** — across the three planes (§3), kept sovereign.

**Drive** — keep greg + steve continuously utilised (§5).

## 3. The three planes (kept sovereign — tele-3)

1. **Project state (entities)** — Ideas / Missions / Bugs / Designs / Teles / Agents = the durable truth (tele-1).
2. **Work items (the queue)** — the claimable execution / work-assignment plane.
3. **Comms (threads / councils / notes / events)** — deliberation + signal.

The queue does **not** replace comms. Threads & councils remain where agents *deliberate* — **except** a forward-**scheduled** agent-led discussion/brainstorm/council, which is an **ANALYSIS-RUN WorkItem** (the *schedule + close-evidence*), with the deliberation still happening in the thread. Planes interlock (a WorkItem's `targetRef`→entity; a thread discusses a WorkItem; a digest is a comms-event carrying a work-plane signal) but stay sovereign.

## 4. Architect-deliverable taxonomy (WorkItem shapes)

- **PRODUCE-ARTIFACT** (`task`) — build a doc/design/spec.
- **REVIEW-DELTA** (`review`) — review a change.
- **ANALYSIS-RUN** (`freeform`) — a workflow / council / audit (the forward-scheduled deliberation).
- **VERIFY-GATE** (`verifier-gate`) — steve's advisory verification (never gating).
- **GATE-ASSESS** (`task`/`freeform`) — a phase/release-gate assessment.

**The no-WorkItem meta-layer** (the controller reads/writes the queue, isn't *on* it): continuous mission-driving, threading/dispatch, queue-watch, cross-approval/merge. **Boundary test:** bounded + closable + evidenceable → WorkItem; else meta-layer.

## 5. Driving greg + steve + the controller

- **greg (engineer):** keep the build-queue seeded **1–2 slices ahead** — no idle gaps. He self-wakes off the claimable-digest (pulse-free). Seed only **verified-live** work (§9).
- **steve (verifier, opencode):** seed verifier-gate + adversarial-review items (R3/R5 acceptance-gates) in **parallel** with greg's builds — **advisory, never gating**. (Live since the idea-355 consolidation: self-wakes off the queue + honest liveness.)
- **controller (architect):** reconcile → run an instrument when the queue thins → seed/rank → cross-approve/merge/deploy → drive. **Run ahead so neither waits.**

## 6. Deploy posture (Director-approved for the solo stint)

- **Flow autonomously:** tested + cross-approved + steve-advisory-verified + **reversible** work — DR-record every step + **roll-confirm** each deploy.
- **Prod Hub deploys** (auto-triggered by `deploy-hub.yml` on `hub/**` merge → watchtower rolls the VM): flow the **safety-critical / well-bounded** ones with full care; **QUEUE large or backplane-risky** changes as director-gate WorkItems for Director review.
- **Director-gated DECISIONS** (not buildable work) — surface as director-gate WorkItems on the Director's queue; do **not** decide solo: the C1 widen, the C2 next-arc focus, idea-121, and decision-gated bugs (e.g. Task-retire-vs-fix).
- **The opencode bundle** redeploy is architect-publishable + reversible (rollback = revert the bundle-repo); the **steve restart** is the operator touch-point.

## 7. Operating axioms

Mechanise + declare before any imperative path · tele-alignment over speed · safety before leverage · NARROW adoption first, widen after dogfood · flow verifier-gated, reversible deploys autonomously (pre-gate only genuine hard-lines) · **verifier stays advisory, never gating** · thin-shim / shared-kernel · `get_agents` is the canonical roster · decisions → DR-ledger, calibrations → architect-fileable / Director-curates · **run ledger-reconciliation before trusting a backlog** · **ground-truth an item from code before seeding work on it** · **version-bump co-commits with the final src PR of a ship** · **never bypass the ship-path gate.**

## 8. The live backlog (post idea-325 reconciliation, 2026-06-27)

The strategic-review (15 arcs) ran over a **~52%-stale** ledger; the idea-325 reconciliation rebased it. **Closed at reconciliation:** the storage cluster (bug-121/124/126/133/149), queue-honesty (bug-181/182), version (bug-183/184), + bug-4/22/27/40/41/42/48/62/63/94/157/159/164/186 — all fixed-but-open or obsolete/dup. So most of the strategic-review's ranked bugs were already done.

**Genuinely-live actionable backlog (19 bugs):**
- **Seeded to greg:** bug-117 (ResponseSummarizer cap — work-21), bug-61 (pinpoint matchLabels — work-22), bug-2 (DAG retroactive-unblock — work-23).
- **Next to seed (well-bounded, non-decision-gated):** bug-100 (schema-reconciler watch-reconnect), bug-118 (cascade lineage-field drop), bug-13 (numeric id sort), bug-6 (get_task by-id), bug-174 (substrate range-cast), bug-105 (start-hub.sh --network), bug-142 (prepack lockfile restore), bug-160 (circular dep), bug-148 (Notification phantom field).
- **opencode (rides the next opencode redeploy):** bug-173 (poll-backstop role-binding, folds bug-164).
- **Decision-gated (→ director-gate / defer):** bug-146 (Task-dispatch — gated on Task-retire-vs-fix), bug-185 (block_work durable park — idea-353/355), bug-162 (pulse false-escalate — pulses slated for retirement), bug-172 (verifier update_bug authority — policy decision), bug-25 (idea-152-scale).
- **Needs-investigation (banked):** bug-96, bug-171, bug-176, bug-177, bug-178.
- **External:** ~24 apnex/missioncraft bugs → **idea-361** (cross-repo reconciliation pass).

**Candidate arcs (strategic-review, tele-ranked — the survivors after reconciliation):** C2 Agent-Lifecycle Survey (tele-13, retires the Director-restart-bottleneck) · the C1 widen decision (Director-gated keystone) · D-1 R1 REST read-binding via idea-357 (design-first) · idea-121 API v2.0 (ratified survey, Director-focus) · C3 ship-spine remaining rungs · D-3 telemetry spine · C4 governed-autonomy R1.

**Director-gate queue for return:** C1 widen · C2 next-arc focus · idea-121 focus · the decision-gated bugs above.

## 9. Lessons banked this stint (the run-first discipline)

- The ledger was **~52% stale** (fixed-but-open + obsolete still marked open). **Reconciliation must run before seeding** — twice this stint a stale-ledger item (bug-161, bug-163) was nearly re-built as a duplicate.
- **Ground-truth from code, not the ledger** before acting on any ledger-derived item.
- The version-gate fired **3×** because version bumps split from their src PRs → **bump co-commits with the final src PR of a ship**; never bypass the ship-path gate.
- Adversarial review + the CI gate each caught cross-package / wiring breaks the author's own test-run missed — **keep them in the loop** for deploy-gating slices.

---
*Sources: the engine + anchor live in the work-19 payload; the strategic-review output + the idea-325 reconciliation output are the backlog provenance; decisions → `docs/decisions/` DR-ledger; the roadmap → `docs/roadmap.md`.*
