# Autonomous Stint-2 — Decision Record (DR) Log

**Provenance:** Director granted the stint-2 away-stint 2026-06-21 ("Away stint. Full authority to drive. Try and utilise Greg and Steve, and even yourself between tasks to minimise long periods of idle") immediately after ratifying the stint-2 arc roadmap at the consolidated gate.
**Acting-Director:** lily (architect, agent-40903c59). **Peers:** greg (agent-0d2c690e, engineer/build), Steve (agent-f148389d, gpt-5.5/OpenCode, verifier).
**Framework:** triangulate-against-teles → record DR → execute-or-defer → **never-halt** (halt only when gated on a timer/script + team deliverables). Authority bounds: prod-deploy under **DR-002** (TESTED + REVERSIBLE + VERIFIER-GATED); prod-infra ops per-occasion judgment per **DR-008**. **Hard-lines:** no tele edits; no irreversible/destructive prod ops; no constitutional-ledger (teles/calibrations) merges to main without strong cause; verifier stays advisory-not-gating; calibration filings architect↔Director-bilateral (never LLM-autonomous).
**This log seeds C4-R1** (the autonomy-charter + DR-ledger). Markdown now; C4-R1 formalizes into the calibrations-mold YAML+CLI+Skill.

---

## DR-S2-001 — Adopt the away-stint framework + drive Wave-0
- **Decision:** Accept the away-stint grant; drive the ratified stint-2 Wave-0 (C3 opener + C2 capability-spike + C4-R1 charter + D-1 R0/R1) with greg + Steve in parallel; minimize idle (the Director's explicit utilization directive — keep greg, Steve, AND self loaded between tasks).
- **Tele:** tele-13 (Director-attention-amplification: the Director steps fully out, the org self-drives), tele-6 (frictionless multi-agent collaboration via active utilization).
- **Status:** RATIFIED (the Director grant is explicit + standing for the stint).

## DR-S2-002 — Wave-0 dispatch plan + the architect-decided gate leans
- **Decision (dispatch):** greg → C3-R1 M-Roll-Signal (thread-681, same-day deploy-truth bank); Steve → standing cross-lineage verify leg + C2-W0 OpenCode capability-matrix (thread-682); lily → D-1-R0 charter+conventions+identity-seam verdict (delegated draft, architect-owned) + C2-W0 Claude-side probe + C4-R1.
- **Decision (architect-leans the Director did not override at the gate, now operative):** governance-batch = ONE batched proposal before any auto-path arms; C1 work-queue lands AFTER D-1-R3 (write/actuate); D-1 credentials = token-bound role via mission-86 TokenStore; oisctl = thin TS client reusing Hub zod; root-layout = `api/` + `cli/` + `hub/src/rest/`; API version `core.ois/v1` (flagged as an idea-121 coordination point).
- **Tele:** tele-6, tele-3, tele-12.
- **Status:** EXECUTED (threads opened; D-1-R0 draft in flight; PR #347 publishes the roadmap to main).

## DR-S2-003 — C3-R1 roll-confirm SLA = 600s timeout / 15s poll (tunable var)
- **Decision:** Approve greg's proposed roll-confirm SLA — 600s timeout, 15s poll cadence, wired as a tunable workflow var. Rationale: watchtower `--interval 300` + ~140s roll (pull+restart+substrate-reconnect) + margin ≈ ~480s worst-case healthy, so 600s cleanly separates a slow-but-healthy roll from the bug-107 token-race stall. R1 = positive-signal + fail-loud (ALARM via loud workflow fail) only; NO auto-revert (auto-rollback is R3, behind the governance-batch).
- **Reversible?** Yes — a tunable workflow var; tighten from real roll-time data; R2/R3 formalize it as a first-class signal/field.
- **Tele:** tele-4 (no-silent-failure), tele-8 (gated integrity).
- **Status:** RATIFIED (architect authority; reversible config; recorded in thread-681).

## DR-S2-004 — Open: prod /health external reachability (load-bearing for the observer model)
- **Surface (not yet a decision):** R1's CI roll-confirm + R2's external prober both require prod `/health` reachable from outside the Hub (GitHub runner). greg referenced a "Cloud Run nginx proxy URL"; my model is VM+watchtower. Flagged to greg (thread-681) to confirm external reachability + the real prod ingress topology. If `/health` is NOT externally reachable, that's a design-level finding (ingress decision) — escalate to a DR, do not let R1 hard-code around it.
- **Status:** OPEN — awaiting greg's ground-truth.
