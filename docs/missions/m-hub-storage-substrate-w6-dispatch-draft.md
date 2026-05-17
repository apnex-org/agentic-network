# mission-83 W6 dispatch — FS+GCS+gcs-*.ts retirement (cleanup wave)

**Status:** architect-pre-staged dispatch content (ready-fire on W5 cutover completion)
**Dispatch target:** current active coord thread
**Dispatch shape:** thread-content directive per bug-94 workaround pattern
**Authored:** 2026-05-17 / lily (architect)
**Trigger:** W5 cutover ratify-completion

---

## Dispatch content (paste when W5 cutover ratifies)

W5 cutover RATIFIED ✓ — Hub running on substrate; bug-93 observed-eliminated; <60s downtime budget met. **W6 retirement dispatch — cleanup phase.**

### W6 — FS+GCS retirement + hub/src/gcs-*.ts deletion

**Mission:** mission-83 (M-Hub-Storage-Substrate) — Wave W6
**Design ref:** Design v1.x §5.2 (`packages/storage-provider/` SHRINK-not-delete + `hub/src/gcs-*.ts` cleanup per round-1 audit M1)
**Branch:** continue on `agent-greg/m-hub-storage-substrate`
**Pre-W6 verify:** W5 ratified; Hub running on substrate authoritative; substrate-versioned repositories serving all production reads + writes; FS-version repositories present-but-dormant

### W6 deliverables (3 substantive + 1 verification)

#### 1. `packages/storage-provider/` SHRINK (NOT delete)

Per Design §5.2:
- **Keep:** `StorageProvider` interface (used by `MemoryStorageProvider`'s type contract) — `packages/storage-provider/src/contract.ts`
- **Keep:** `MemoryStorageProvider` — still consumed by `repo-event-bridge` tests + runtime — `packages/storage-provider/src/memory.ts`
- **Delete:** `LocalFsStorageProvider` (`packages/storage-provider/src/local-fs.ts`) + its tests
- **Delete:** `GcsStorageProvider` (`packages/storage-provider/src/gcs.ts`) + its tests
- **Delete:** any other `Local*` / `Gcs*` provider variants
- Update `packages/storage-provider/src/index.ts` exports to drop deleted classes

#### 2. `hub/src/` cleanup (per round-1 audit M1 — separate from packages)

- **Delete:** `hub/src/gcs-state.ts` (535 LoC) — GCS-specific Hub state-loading code path
- **Delete:** `hub/src/gcs-document.ts` (102 LoC) — GCS-specific Hub document code path
- **Delete:** `HUB_STORAGE=fs` and `HUB_STORAGE=gcs` config branches in Hub bootstrap (substrate-mode becomes only mode)
- **Delete:** 12 FS-version repositories (siblings from W4 disposition (B); replaced by substrate-versioned siblings now serving authoritatively)
- Update Hub bootstrap (`hub/src/index.ts` or wherever instantiates repositories) — substrate-versioned repositories already authoritative since W5

#### 3. CODEOWNERS update

- `hub/src/storage-substrate/` ownership: substrate-architect (new entry)
- `packages/storage-provider/` ownership: unchanged (existing entry; slimmer scope)

### W6 acceptance criteria (per Design §5.2)

- [ ] `packages/storage-provider/` shrunk: only contract.ts + memory.ts + tests remain; local-fs.ts + gcs.ts deleted
- [ ] `hub/src/gcs-state.ts` deleted; `hub/src/gcs-document.ts` deleted
- [ ] 12 FS-version repositories deleted (siblings retired); substrate-versioned repositories sole production path
- [ ] HUB_STORAGE=fs/gcs config branches removed; substrate-only mode
- [ ] **`cd packages/repo-event-bridge && npm test` passes** (regression-net against accidental `rm -rf packages/storage-provider/` per round-1 audit M1)
- [ ] `grep -rn 'gcs-state\|gcs-document\|HUB_STORAGE' hub/src/` returns empty (or only test-fixture references)
- [ ] CI green at HEAD; no broken imports anywhere in monorepo
- [ ] CODEOWNERS updated
- [ ] Bilateral surface report with: deletion summary + repo-event-bridge regression-gate result + any architect-blind dependency surfaced

### Substrate state during W6

**LIVE.** No data motion; cleanup-only wave. Hub continues serving on substrate (live since W5). W6 just removes the dormant FS-version code that became unreachable at W5 cutover.

### Hand-off

Engineer-side W6 cleanup execution; surface W6 commits per per-wave handshake. **W7 dispatch (ship + operator runbook finalize + bug-93 close + Phase 7 release-gate prep) follows W6 ratify.**

---

## Pre-dispatch checklist (architect-side, pre-fire)

- [ ] W5 ratified (cutover executed; substrate live; bug-93 observed-eliminated)
- [ ] Hub running on substrate authoritative for N hours (operator-judgment on stability window before triggering W6 deletions)
- [ ] Pre-cutover snapshot retention period satisfied OR explicit waive

## Companion follow-ups (architect-side, post-W6-ship)

- W7 dispatch fires (ship + operator runbook + bug-93 close)
- repo-event-bridge regression-gate verified on engineer-side
- Phase 10 retrospective draft updates (substrate-cleanup-wave characteristic confirmed)
