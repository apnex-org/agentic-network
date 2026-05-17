# mission-83 W0 spike

Scratch directory for W0 spike artifacts. Isolated from W1's `hub/src/storage-substrate/` module location to avoid cross-wave confusion; W0 spike is exploratory/measurement-only and may be retired or absorbed at W1+.

## Scope (per Design v1.1 §4 W0 row)

W0 spike deliverables (6 enumerated per architect directive in thread-565):

1. **W0.1 — Postgres-container local-dev compose-up** — `docker-compose.yml` (this directory) + operator-DX cookbook at `docs/operator/hub-storage-substrate-local-dev.md`
2. ✅ **W0.2 — Filesystem-grep entity-kinds enumeration** — shipped at `hub/scripts/entity-kinds.json` (commits `7d2f34f` + `2102bf2` v1.1 alignment); 20 substrate-mediated kinds locked per Design v1.1
3. **W0.3 — Synthetic-state migration `<60s TOTAL OBSERVED DOWNTIME` measurement** — prototype `migrate-fs-to-substrate.ts` against ~10k-entity synthetic dataset; measurement output captured in spike report
4. **W0.4 — Testcontainers harness boot-time + flakiness baseline** — `testcontainers` npm package install + minimal harness validation; fallback to docker-compose if flaky per §2.7 architect-lean
5. ✅ **W0.5 — Engineer counterpart branch** `agent-greg/m-hub-storage-substrate` (commit `4bb9bbe`)
6. ✅ **W0.6 — Work-trace initialization** `docs/traces/mission-83-m-hub-storage-substrate-work-trace.md` (commit `4bb9bbe`)
7. **W0.7 — Spike report consolidation** — synthesizes findings + architect-blind kinds surfaced (already 5 surfaced + 1 NEW added at v1.1 bilateral cycle) + downtime measurement + testcontainers baseline

## Cross-references

- **Design v1.1:** `docs/designs/m-hub-storage-substrate-design.md` (commit `11ce0ba`; 20-kind inventory LOCKED)
- **Work-trace:** `docs/traces/mission-83-m-hub-storage-substrate-work-trace.md`
- **Entity-kinds source-of-truth:** `hub/scripts/entity-kinds.json` (v1.1 schema)
- **Operator-DX cookbook:** `docs/operator/hub-storage-substrate-local-dev.md`
- **Coordination thread:** thread-566 (durable W0-W7 coord)
- **Mission entity:** mission-83 (Hub-side; `active` state)

## Disposition at W7

W0 spike artifacts retire at mission-end:
- `docker-compose.yml` → migrate to canonical `hub/storage-substrate/docker-compose.yml` (or substrate-module-internal location) per W6/W7 finalize
- Synthetic-state migration prototype → absorbed into real `migrate-fs-to-substrate.ts` per §3.1 (W5 wave deliverable)
- Testcontainers harness → absorbed into real test infrastructure per §2.7 (W1 wave deliverable)
- Spike report → archived to `docs/spikes/mission-83-W0-spike-report.md` (or equivalent post-mission-doc location)

This directory may be deleted at W7 ship-time once all artifacts have canonical homes.
