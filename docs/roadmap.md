# OIS Roadmap — current state

*The single strategic dashboard for the agentic-network: the standing answer to **"what are we working on, and why?"** Read by the Director (status at a glance) and the architect (cold-pickup handover). **Arc-level, current-state only** — no history (decisions → `docs/decisions/` DR-ledger; per-arc scope → `docs/designs/`). **Interim** until coordination is further mechanised. Refreshed at gate-points (Survey / Release / Retro).*

**As of:** 2026-06-29 · **Prod (Hub):** `5c64f58` · **Kernel:** `@apnex/network-adapter@0.1.4` on ALL hosts (claude shim `0.1.9` / opencode shim `0.2.1`) · **Headline:** the adapter substrate is **CONSOLIDATED** — idea-355/mission-95 closed + verified: ONE kernel, thin shims, and the work-queue now **self-wakes BOTH lineages** (claude + opencode/steve), with honest version + liveness. **Autonomous stint in flight** (Director full-authority); idea-325 ledger-reconciliation done (backlog rebased — was ~52% stale). · **2026-06-29:** the **ASR** ran → Director-ratified **stint-6 = idea-388** (Director-work-queue); a new **Design-Process methodology v1.0 RATIFIED** (Phase-4 = a 6-node 3-agent work-graph blueprint with a verifier red-team gate); **M-Adapter-Modernization Design v1.0 RATIFIED** (containerise claude+opencode harnesses — advances C2/D-2) with the **claude-pilot blueprint SAVED-NOT-SEEDED** (Director paused: "not begun yet").

## Why — the through-line
Convert the proven-once autonomous operating model into **durable substrate**, shaped as **"k8s + cognitive continuity"**: a sovereign REST control-plane (**D-1** — Hub = apiserver, oisctl = kubectl, agents = controllers) that **observes + actuates** (**C1** work-queue) over **containerised, context-aware agents** (**C2 / D-2**), shipped through a **self-verifying, fail-loud** delivery path (**C3**), **bounded by governed autonomy** (**C4**). North-stars: **tele-13** (amplify the Director's non-scalable attention — the org self-drives) + **tele-4** (nothing completes silently or masks its own failure). The arcs are facets of **one** architecture, not separate programs.

## What we're working on now
- **✅ C1 dogfood — PROVEN (2 missions E2E through the queue).** dogfood-1 (bug-180 tool-surface fix) + dogfood-2 (idea-353 wake/stall reconciliation) both ran design→build→verify→release *on the work-queue*; the inbound digest now **self-wakes** idle claude agents (no manual nudge). DR-S2-024 one-mission gate passed (twice).
- **✅ Shared-adapter consolidation (idea-355 / mission-95) — DONE + verified.** ONE `@apnex/network-adapter@0.1.4` kernel + thin shims; opencode/steve redeployed (bundle `93c84b1`), self-wakes off the queue, honest version+liveness. The widen-prereq ("don't widen onto a forked adapter") is now cleared.
- **▶ NEXT — the widen decision** *(Director-gated)*: make the queue the default work-assignment plane for mission-level coordination. Now fully unblocked (wake-primitive live + consolidation done + bug-181/185 queue-honesty reconciled); **staged as a director-gate for the Director's return**.
- **then ▶ C2 Survey** (retires the Director-as-restart-bottleneck) + **D-1 R1** (REST read-binding via idea-357) + **idea-121** (API v2.0, ratified survey) — all director-gate / Survey-gated.
- **▶ 2026-06-29 — Adapter-modernization + a new Design-Process substrate** (Director-priority brainstorm → ratified): **M-Adapter-Modernization Design v1.0 RATIFIED** (`docs/designs/m-adapter-modernization-design.md` — containerise claude+opencode harnesses: fat-kernel/thin-shim, EMBEDDED topology, 4-actor resilience, reproducibility-first; **advances C2/D-2**). The **claude-pilot work-graph is SAVED-NOT-SEEDED** (`blueprints/m-adapter-modernization.blueprint.json` — Director paused, "not begun yet"). Produced via a new **Design-Process methodology v1.0** (RATIFIED — Phase-4 as a 6-node work-graph blueprint with a verifier red-team gate + conformance-matrix; `docs/methodology/design-process.md` + `blueprints/design-process.blueprint.json`), itself first-dogfooded on this design (its own gate caught real flaws at each layer). Inputs: scion deep-audit + shim ground-truth audit. Follow-ons filed: **bug-205** (director_ratify uncompletable → motivates **idea-388**), **idea-396** (tele→axiom retirement), **idea-397** (normalised reference-syntax); **work-102** (steve cross-lineage Design re-run, queued).

## Operating axioms
Mechanise + declare before any imperative path · tele-alignment over speed · **safety before leverage** · NARROW adoption first, widen after dogfood · flow verifier-gated, reversible deploys autonomously (pre-gate only genuine hard-lines) · **verifier stays advisory, never gating** · **RBAC tighten-only** (a Hub-grant may only *tighten* the local ceiling, never loosen) · **thin shim / shared kernel** (host-unique code lives only in the per-host *shim*; all logic in the *adapter* = `@apnex/network-adapter`, identical code on every host; shims version independently but report honest sdkVersion+shimVersion) · **`get_agents`** is the canonical roster (`get_engineer_status` RETIRED, bug-184) · **run ledger-reconciliation before trusting a backlog; ground-truth from code before seeding** · decisions → DR-ledger, calibrations → architect-fileable / Director-curates.

## Recently completed (this stint)
- **C1 on-ramp + 2 dogfoods** — `create_work` on-ramp (#361) → **dogfood-1** bug-180 tool-surface fix (#362) + Hub bug-181 (#363) → **dogfood-2** idea-353 wake/stall (#363); claude agents hopped to adapter `0.1.9`/`8556b99`; the **queue self-wakes** (proven live). (bug-180's literal AC1 smoke = `work-5`, riding the next natural surface change.)
- **C1-R2 keystone** — built → hardened → RBAC-fail-closed, all deployed + roll-confirmed. The marquee.
- **C3 Wave-0 opener** — roll-signal (R1) + renameMap shape-governor (R4) LIVE; **D-1 R0** charter merged (#348).

## Arcs at a glance

**Capability**
- **C1 · Sovereign Work-Control Plane** — claimable work-queue (claim/lease/actuate/evidence-to-close + signals) — 🟢 **keystone LIVE + adoption PROVEN** (2 dogfoods E2E; queue self-wakes claude agents) → **widen pending Director** *(R2 sealed; R1/R3/R4 banked)*
- **C2 · Agent-Lifecycle Substrate** — context as a measured resource + harnesses restartable from outside the LLM (the supervisor that retires the Director-as-restart-bottleneck) — 🟡 **spike passed; arc-design DRAFT, not yet surveyed** *(next: C2 Survey → ratify → build L1)*
- **C3 · Ship-Integrity Spine** — a positive completion + fail-loud signal on every merge→deploy→read step — 🟢 **partial: 2/6 rungs live** (roll-signal + shape-governor) *(R2/R3/R5/R6 banked)*
- **C4 · Governed-Autonomy Substrate** — the autonomy model made repeatable + reviewable (record-first, advisory-only) — 🟡 **R1 partial** (charter ratified + governing; mechanization pending)

**Directive foundations**
- **D-1 · Sovereign REST Control-Plane** — the REST spine every arc exposes through (one authority, two bindings) — 🟡 **R0 charter merged; R1 (read-binding) next; zero REST runtime yet**
- **D-2 · Containerised agent runtime + context as a monitored/actuated resource** — realised *through* C2 (no separate doc) — 🟡 **W0 spike passed; build banked**
- **D-3 · First-class centralised agent telemetry** — realised as C1-R4 + C2-L1 (Option B: gauge-on-Agent + audit-append) — 🟡 **direction set + folded; build banked** *(motivated by the verifier dying on quota with zero org-visibility — twice)*

**Platform hygiene (surfaced this stint — Director-flagged)**
- **Shared-adapter reconciliation** (**idea-355 / mission-95**) — 🟢 **DONE + verified (closed 2026-06-27).** ONE `@apnex/network-adapter@0.1.4` kernel + thin shims (claude `0.1.9` / opencode `0.2.1`); opencode/steve redeployed (bundle `93c84b1`) → self-wakes off the queue (idea-353 reaches both lineages), honest sdkVersion+shimVersion, honest liveness; kernel ToolSurfaceReconciler + tick-drive. Closed bug-182/183/184/186/4/161/163. **Follow-ons:** idea-354 (auto-refresh distribution — incl. the still-manual opencode republish), idea-360 (both-versions-inline), idea-361 (missioncraft cross-repo bug routing).

## What's next — 3 waves, safety before leverage
1. **Wave-0 ✅** — C3 opener + D-1 R0 (de-risk the path every arc ships through; the shape-governor lands before any new kind is born).
2. **Wave-1 ▶ (here)** — C1 keystone + 2 dogfoods + **shared-adapter consolidation DONE (idea-355)** + **idea-325 backlog reconciled** → **widen decision** (Director-gated, staged) → C2 Survey + D-1 R1 next. *(Autonomous stint driving the reconciled live backlog — the engine + backlog live in `docs/methodology/autonomous-stint-operating-model.md`; next-arc focus is a director-gate for the Director's return.)*
3. **Wave-2** — C3-R6 release-verification + deeper C1/C2 rungs, all converging on **ONE telemetry spine** (D-3). C4 enforcement is **evidence-gated** behind a *second* stint that surfaces a real discipline failure.

---
*Sources behind this summary: scope → `docs/designs/<arc>-arc-design.md` · decisions → `docs/decisions/` (DR-ledger) · cross-arc prioritisation → `docs/methodology/strategic-review.md` + `docs/reviews/autonomous-stint-arc-shortlist.md`. Arc-design doc headers may read DRAFT — the roadmap was ratified at the 2026-06-21 consolidated gate; trust the DR-ledger over stale headers.*
