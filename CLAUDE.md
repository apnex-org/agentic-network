# CLAUDE.md — agentic-network repo guidance

**Version:** v1.2 (mission-83 W7 substrate-notes fold-in)

Project-level context binding all Claude Code instances on this repository.

## Commit message policy

**Do not add `Co-Authored-By: Claude ...` trailers to commit messages on this repo.** No `Co-Authored-By: Claude Opus`, `Co-Authored-By: Claude Sonnet`, or any `Co-Authored-By: Claude ...` form. Write plain commit messages.

**Why:** the trailer surfaces on GitHub's Contributors view as a co-author; want a clean contributor graph without AI attribution.

**How to apply:** every commit on every branch, every Claude Code session. Applies to direct `git commit` and any tool-mediated commit path.

## Calibration ledger discipline

**Query the calibration ledger via the calibration Skill rather than recalling from narrative-doc memory.** Calibration metadata + named architectural-pathology patterns live at `docs/calibrations.yaml`.

**Why:** defeats LLM-state-fidelity drift — narrative-doc recall produces hallucinated cross-references; ledger queries return ground truth.

**How to apply:** `python3 scripts/calibrations/calibrations.py {list,show,status}` (read surface). Calibrations are **architect-fileable, not Director-gated** (relaxed 2026-06-27): file when evidence-anchored (origin + surfaced_at + cross_refs) and — for substrate/architectural entries — peer-verified (bilateral architect+engineer concur, or an adversarial-verify pass); methodology/working-discipline entries the architect may file solo. IDs are next-monotonic-integer (deterministic; a Phase-2 write-verb will mechanize filing + validation). The **Director curates** — retire / downgrade / re-class authority + periodic review — rather than gating each filing (Director-direct filing remains for Director-originated entries). **Why relaxed:** removes the Director-as-minting-bottleneck so the org self-records its learning; the Director curates the high-signal ledger instead (tele-13 — amplify Director attention, don't gate on it). **Still true:** query the ledger via the Skill rather than narrative recall (ground-truth, not hallucinated cross-refs).

## Mission RACI

**Architect drives mission; engineer surfaces ambiguity through architect (NOT Director-direct); Director engages at gate-points only** — Phase 3 Survey, Phase 7 Release-gate, Phase 10 Retrospective.

**Why:** prevents engineer-routing-to-Director-direct anti-pattern (silent between-commit pauses; Director-relay confusion).

**How to apply:** engineer-side autonomous-stop is anti-pattern UNLESS thread-engaged with architect on a surfaced action. Full RACI matrix + decision-routing rules at `docs/methodology/mission-lifecycle.md` §1.5 + §1.5.1.

## Cold-pickup primary surfaces

**Cold-session pickup loads work-trace + companion-policies index + role-runtime overlay before mission-engagement.** Closes the engineer-runtime-rules-invisible class.

**How to apply** (cold-pickup load-order):
- Work-trace location: `docs/traces/trace-management.md` — canonical how-to; engineer-owned `docs/traces/<task-or-mission>-work-trace.md` per task
- Engineer-runtime overlay: `docs/methodology/engineer-runtime.md` — INDEX of engineer-runtime concerns (Pass 10 rebuild, schema-rename migration, thread-vs-GitHub approval, commit-push heartbeat, work-trace discipline, etc.)
- Architect-runtime overlay: `docs/methodology/architect-runtime.md` — INDEX of architect-runtime concerns (mission-driving authority, categorised-concerns surface, Idea Triage Protocol, pulse coordination, substrate-self-dogfood, etc.)
- Tele glossary: `docs/methodology/tele-glossary.md` — tele-N → short-name → mandate lookup (load-bearing decoder for inline tele references)

## Hub storage substrate (post-mission-83 W5 cutover)

**Production Hub uses `HubStorageSubstrate` (postgres + LISTEN/NOTIFY + JSONB + SchemaDef-reconciler) as the sovereign state-backplane.** FS-mode (gcs/local-fs) + memory-mode retired from production-prod path; substrate is the only production cloud-path.

**Why:** bug-93 sweeper-poll-pressure (74% sustained Hub CPU) STRUCTURALLY ELIMINATED at W5 cutover (substrate-watch primitive replaces FS-walk poll-loop per Design v1.4 §2.4); idea-294 Director-direct surface closed.

**How to apply:**
- **Production:** `STORAGE_BACKEND=substrate` + `POSTGRES_CONNECTION_STRING=postgres://hub:hub@host:5432/hub` (env-driven at Hub bootstrap)
- **Local dev:** `STORAGE_BACKEND=local-fs` or `memory` modes preserved as test/dev affordances (FS-version repositories preserved as test-only fixtures per W6-narrowed); see `docs/operator/hub-storage-substrate-local-dev.md`
- **Operator-DX surfaces:** `scripts/local/get-entities.sh` (daily-driver direct-psql CLI) + `docs/operator/psql-cookbook.md` (escape-hatch forensic queries) + `scripts/local/hub-snapshot.sh` (pg_dump-Fc wrapper for backup/restore)
- **Cutover runbook:** `docs/operator/hub-storage-cutover-runbook.md` (production cutover orchestration; image-pre-build at W5-prep window achieves <30s effective downtime)
- **Substrate Design:** `docs/designs/m-hub-storage-substrate-design.md` (architect-side; v1.4 RATIFIED)
- **SchemaDef inventory:** `hub/scripts/entity-kinds.json` (v1.1; 20 kinds LOCKED)

**Follow-on missions filed at mission-83:**
- idea-295 M-Hub-Storage-ResourceVersion (k8s-style optimistic-concurrency)
- idea-296 M-Hub-Storage-Audit-History
- idea-297 M-Hub-Storage-FK-Enforcement
- idea-298 M-Hub-Storage-Cloud-Deploy
- idea-299 M-Hub-Storage-BlobBody-Substrate (Proposal/Task body-storage + Document MCP tools re-introduction)
- idea-300 M-Hub-Storage-FS-Retirement-And-MemoryHubStorageSubstrate (full FS-version-repo retirement + test-architecture migration)

## Envelope substrate — STRICT + decode-to-flat (post-mission-90)

**The substrate is envelope-ONLY at the storage layer, and ONE flat domain shape above the repo membrane.** mission-90 (M-Envelope-Substrate-Completion) migrated every kind to the K8s envelope (`{apiVersion, kind, metadata, spec, status:{phase}}`), cut the production Hub to STRICT (W6, 2026-06-19), and retired the dual-shape tolerance entirely (W8).

**Why:** the bug-137/bug-138 class — Hub consumer code reading relocated fields off a raw envelope row got `undefined` / a `{phase}` object, silently degrading FSM guards, CAS transforms, and list-filters. The structural fix is a single shape boundary: storage is envelope; repos decode at the read + CAS boundary; everything above reads flat. No dual-shape recurrence surface remains.

**How to apply:**
- **No tolerance flag:** `SUBSTRATE_ENVELOPE_TOLERANT` is GONE (W8). Boot logs `envelope substrate: STRICT`. Storage holds envelope rows only; there is no legacy-flat write path.
- **Decode-to-flat read contract:** every repo decodes envelope→flat on `get`/`list`/`findBy*` AND inside `casUpdate`/`tryCasUpdate` (transform on flat → write-encoder re-envelopes). The generic decoder is `decodeEnvelopeToFlat` (`hub/src/entities/shape-helpers.ts`, renameMap+partition reverse); kinds with extra leaf-renames layer a bespoke decoder on it (Message/PendingAction/Turn/Audit/Document/Notification/the histories), and Thread/Tele/Agent keep their bespoke normalizers.
- **phaseFromEntity is the below-membrane decode-mechanism** (the status-extractor the decoders call) — KEEP it. The W3-era above-membrane dual-layer readers (`fieldFromEntity` / `tagsFromEntity` / `arrayFieldFromEntity`) are DELETED; policy + consumers read flat fields directly. Do NOT reintroduce a dual-shape reader above the membrane.
- **renameMap is the single authority:** write-ENCODE + filter-TRANSLATE + read-DECODE all derive from each kind's `renameMap` in `hub/src/storage-substrate/schemas/all-schemas.ts`. A new relocated field needs only its renameMap entry.
- **Cutover runbook:** `docs/operator/envelope-substrate-cutover-runbook.md` (includes the CODE-ONLY redeploy class + the COS-portability + comms-dark lessons, bug-156/157).

## Companion policies

Methodology + role-runtime + glossary docs (load when phase-engaged or role-engaged):

- `docs/methodology/mission-lifecycle.md` — formal lifecycle phases (Concept → Retrospective) + RACI matrix + decision-routing rules
- `docs/methodology/idea-survey.md` — Director-intent Survey methodology (3+3 pick-list); canonical for Idea→Design transition
- `docs/methodology/strategic-review.md` — backlog triage + mission prioritization; Idea Triage Protocol (per-idea routing)
- `docs/methodology/ledger-reconciliation.md` — entity-ledger status-reconciliation; the factual peer to strategic-review.md (5-step process + disposition buckets)
- `docs/methodology/multi-agent-pr-workflow.md` — per-PR integration gate; cross-approval pattern; Pass 10 rebuild + schema-rename state-migration disciplines
- `docs/methodology/mission-preflight.md` — activation gate (proposed → active); 6-category audit + verdict
- `docs/methodology/entity-mechanics.md` — per-entity FSM + status transitions + cascade behaviors
- `docs/methodology/engineer-runtime.md` — engineer-runtime concerns INDEX
- `docs/methodology/architect-runtime.md` — architect-runtime concerns INDEX
- `docs/methodology/tele-glossary.md` — tele-N lookup
- `.github/CODEOWNERS` — directory-ownership map; mechanized review routing
