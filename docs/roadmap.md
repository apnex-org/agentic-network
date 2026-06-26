# OIS Roadmap — current state

*The single strategic dashboard for the agentic-network: the standing answer to **"what are we working on, and why?"** Read by the Director (status at a glance) and the architect (cold-pickup handover). **Arc-level, current-state only** — no history (decisions → `docs/decisions/` DR-ledger; per-arc scope → `docs/designs/`). **Interim** until coordination is further mechanised. Refreshed at gate-points (Survey / Release / Retro).*

**As of:** 2026-06-27 · **Prod:** `2fa4723` · **Headline:** C1 work-control-plane keystone sealed + live (dormant); entering NARROW adoption.

## Why — the through-line
Convert the proven-once autonomous operating model into **durable substrate**, shaped as **"k8s + cognitive continuity"**: a sovereign REST control-plane (**D-1** — Hub = apiserver, oisctl = kubectl, agents = controllers) that **observes + actuates** (**C1** work-queue) over **containerised, context-aware agents** (**C2 / D-2**), shipped through a **self-verifying, fail-loud** delivery path (**C3**), **bounded by governed autonomy** (**C4**). North-stars: **tele-13** (amplify the Director's non-scalable attention — the org self-drives) + **tele-4** (nothing completes silently or masks its own failure). The arcs are facets of **one** architecture, not separate programs.

## What we're working on now
- **▶ C1 adoption + dogfood** *(keystone is live but dormant)* — switch the work-queue on NARROW-first (coordinate the next arc's missions *through* it) and pass the mandatory **dogfood gate**. **Why:** prove the plane on its own work before widening — it's the substrate C2 + dispatcher-removal build on.
- **then ▶ D-1 R1** (REST read-binding) and **the C2 Survey** (ratify the lifecycle arc) — the two foundations the next wave needs.

## Operating axioms
Mechanise + declare before any imperative path · tele-alignment over speed · **safety before leverage** · NARROW adoption first, widen after dogfood · flow verifier-gated, reversible deploys autonomously (pre-gate only genuine hard-lines) · **verifier stays advisory, never gating** · **RBAC tighten-only** (a Hub-grant may only *tighten* the local ceiling, never loosen) · decisions → DR-ledger, calibrations → Director-direct.

## Recently completed (this stint)
- **C1-R2 keystone** — built → hardened → RBAC-fail-closed, all deployed + roll-confirmed (`2fa4723`). The marquee.
- **C3 Wave-0 opener** — roll-signal (R1) + renameMap shape-governor (R4) LIVE; **D-1 R0** charter merged (#348).

## Arcs at a glance

**Capability**
- **C1 · Sovereign Work-Control Plane** — claimable work-queue (claim/lease/actuate/evidence-to-close + signals) — 🟡 **keystone LIVE, dormant → adoption next** *(R2 sealed; R1/R3/R4 banked)*
- **C2 · Agent-Lifecycle Substrate** — context as a measured resource + harnesses restartable from outside the LLM (the supervisor that retires the Director-as-restart-bottleneck) — 🟡 **spike passed; arc-design DRAFT, not yet surveyed** *(next: C2 Survey → ratify → build L1)*
- **C3 · Ship-Integrity Spine** — a positive completion + fail-loud signal on every merge→deploy→read step — 🟢 **partial: 2/6 rungs live** (roll-signal + shape-governor) *(R2/R3/R5/R6 banked)*
- **C4 · Governed-Autonomy Substrate** — the autonomy model made repeatable + reviewable (record-first, advisory-only) — 🟡 **R1 partial** (charter ratified + governing; mechanization pending)

**Directive foundations**
- **D-1 · Sovereign REST Control-Plane** — the REST spine every arc exposes through (one authority, two bindings) — 🟡 **R0 charter merged; R1 (read-binding) next; zero REST runtime yet**
- **D-2 · Containerised agent runtime + context as a monitored/actuated resource** — realised *through* C2 (no separate doc) — 🟡 **W0 spike passed; build banked**
- **D-3 · First-class centralised agent telemetry** — realised as C1-R4 + C2-L1 (Option B: gauge-on-Agent + audit-append) — 🟡 **direction set + folded; build banked** *(motivated by the verifier dying on quota with zero org-visibility — twice)*

## What's next — 3 waves, safety before leverage
1. **Wave-0 ✅** — C3 opener + D-1 R0 (de-risk the path every arc ships through; the shape-governor lands before any new kind is born).
2. **Wave-1 ▶ (here)** — C1 keystone (done) → **dogfood + NARROW adoption** (the #1 next action) → C2 lifecycle consumes C1's verbs.
3. **Wave-2** — C3-R6 release-verification + deeper C1/C2 rungs, all converging on **ONE telemetry spine** (D-3). C4 enforcement is **evidence-gated** behind a *second* stint that surfaces a real discipline failure.

---
*Sources behind this summary: scope → `docs/designs/<arc>-arc-design.md` · decisions → `docs/decisions/` (DR-ledger) · cross-arc prioritisation → `docs/methodology/strategic-review.md` + `docs/reviews/autonomous-stint-arc-shortlist.md`. Arc-design doc headers may read DRAFT — the roadmap was ratified at the 2026-06-21 consolidated gate; trust the DR-ledger over stale headers.*
