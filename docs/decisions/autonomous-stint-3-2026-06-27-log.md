# Autonomous Stint-3 — Decision-Record Ledger (2026-06-27)

**Stint:** lily acting-architect under Director-delegated autonomous authority.
**Opened:** 2026-06-27. Director: *"Autonomous. Let's consolidate the substrate. Consider cleanup of conflicting tooling also."*
**FOCUS:** idea-355 — shared-adapter (network-adapter kernel) consolidation + conflicting-tooling cleanup.
**Peers:** greg=agent-0d2c690e (engineer, online), Steve=agent-f148389d (verifier/opencode, cognitively-unresponsive at open).

DR format: `DR-S3-NNN — <decision> — <rationale> — <provenance>`.

---

## DR-S3-001 — Stint-3 opened; FOCUS = consolidate the substrate (idea-355)
The Director re-delegated autonomous authority and SET the focus to idea-355 ("consolidate the substrate") with an explicit add: "Consider cleanup of conflicting tooling also." Carry-over context from stint-2 close (DR-S2-028): C1 work-queue proven by two dogfoods; idea-355 was the named next focus; platform-hygiene cluster filed (idea-354, bug-182/183/184/185).
**Provenance:** Director message 2026-06-27; memory project_autonomous_stint_2_state.md handover.

## DR-S3-002 — idea-355 SIZING: NO fork; "kernel 2.1.0" is a phantom; MEDIUM structural-cleanup
The idea-355 text's "claude 0.1.4 vs opencode kernel 2.1.0 = suspected fork" framing is WRONG. Triangulated via (a) architect repo ground-truth, (b) greg's authoritative audit (thread-727), (c) an Explore boundary-map, (d) Director pointer ("opencode-hub-plugin repo"):
- **No source fork.** Both shims already import the single `@apnex/network-adapter@0.1.4` kernel (workspace `*`). Source is already consolidated.
- **"4.3.0 / network-adapter@2.1.0" are HARDCODED phantom constants** in `adapters/opencode-plugin/src/shim.ts:43-44`. The claude shim had the identical hardcode, fixed in mission-66 #40 (`readPackageVersion`); the port to opencode never happened. = **bug-183**.
- **History reconciled:** network-adapter WAS on a 2.x line in April (mission-64 dogfood bumped 2.0.0→2.0.1); a later monorepo reorg reset it to 0.1.x. The deployed opencode bundle (`apnex/opencode-hub-plugin`, a dist artifact) froze on the old 2.1.0/4.3.0 line and was never rebuilt onto 0.1.x.
- **Real dedup surface confirmed:** each shim carries ~300–400 LOC of generic infra that drifted independently; genuinely host-unique = transport wiring only.
- **SIZE: MEDIUM, structural-cleanup class.** NOT merge-two-codebases.

**Architect correction (folded, greg-confirmed on ground truth):** the idea-353 wake/stall ORCHESTRATION (`runWakeStallReconcile`) + bug-180 live-refresh wiring live in the CLAUDE SHIM, not the kernel (only the trackers + seams are kernel-resident; opencode references NONE of them — zero hits, fully dormant). So redeploying opencode onto 0.1.4 alone ships dormant machinery. greg's refinement: SLICE-1 must hoist not just the FUNCTION but its INVOCATION onto the kernel PollBackstop heartbeat tick (kernel-driven), so every host gets wake/stall + live-refresh with zero per-shim wiring — else the drift re-opens. Same shape for bug-180.

**Agreed 5-slice decomposition (thread-727, converged implementation_ready):**
- SLICE-0 (trivial, independent): port mission-66 #40 version-fix to opencode shim — kill the 4.3.0/2.1.0 hardcodes → `readPackageVersion`. Closes bug-183 reported-half.
- SLICE-1 (structural ANCHOR): hoist duplicated generic infra shim→kernel + `runWakeStallReconcile` + its tick-drive + bug-180 live-refresh wiring. Shims reduce to transport-wiring only.
- SLICE-2 (functional WIN, deps SLICE-1): rebuild + redeploy opencode onto the current kernel → steve gets live-refresh + wake/stall for real.
- SLICE-3 (versioning hygiene): unify version scheme + auto-bump (bug-182) + port idea-256 commit-identity wire (SHIM_COMMIT/ADAPTER_COMMIT) to opencode.
- SLICE-4 (conflicting-tooling cleanup — Director-named): retire deprecated `get_engineer_status` (bug-184) + sweep the live tool surface for other deprecated-but-exposed verbs.

**Provenance:** thread-727 (converged 2026-06-27); Explore boundary-map; idea-355 updated text.

## DR-S3-003 — RECONCILIATION: idea-355 must LAND parked mission-92/93 work, not duplicate it
Ledger-reconciliation catch before proposing a mission. Two ACTIVE missions are parked with substantial unmerged work that overlaps idea-355's SLICE-1:
- **mission-92 (M-OpenCode-Shim-Sovereign-Deduplication, idea-331):** `origin/agent-greg/opencode-shim-dedup` = **17 commits ahead of main, unmerged** (#337). Step-2a hoist isPulseEvent→core, Step-2b hoist bug-108→core, Step-2c notificationHooks delegation + DELETE buildPluginCallbacks, de-any fence. = most of SLICE-1's generic-infra dedup, already BUILT.
- **mission-93 (M-Verifier-Role, idea-330):** `origin/agent-greg/opencode-shim-deany` = **19 commits ahead, unmerged**. Superset of the 92 work + mission-93 cutover hardening (verifier in classifyEvent, fail-loud register_role) + bug-161 completion.
Both parked ~2026-06-20 when the stint pivoted to C1 dogfooding. **mission-64 (M-Adapter-Streamline)** is DONE (npm-publish distribution) and is idea-354's lineage, distinct from idea-355.

**Decision:** idea-355 is NOT greenfield — it is "land the parked dedup + add what post-dates it." Vehicle reconciliation in flight with greg (thread-728); options weighed: (A) idea-355 umbrella completes+merges 92/93 as first slices then adds new work; (B) revive+expand mission-92 into the full consolidation; (C) land 92/93 as a quick merge+deploy first (clear parked debt), then idea-355 = clean follow-on for the new work only. Architect lean: **(A) or (C)** — both respect the built work (zero-loss / tele-4) + the Director's "idea-355" naming. Final vehicle pends greg's ground truth on branch state + 92/93 separability + rebase pain vs current main (the branches predate #362/#363).

**FRICTION observed (for the deferred council):** built work stranded by a mid-stint pivot — mission-92/93 carried 17–19 unmerged commits parked 7 days; near-miss duplicate because parked-active missions weren't surfaced at the new-focus framing. Reinforces the ledger-reconciliation-before-proposing discipline.

**Provenance:** list_missions (active/proposed) + get_mission mission-64/92/93; git branch forensics; thread-728 (open).
