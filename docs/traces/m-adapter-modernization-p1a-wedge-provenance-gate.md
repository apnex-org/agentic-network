# P1a Diagnose-First Provenance Gate — Adapter-Modernization Pilot

**Evidence id:** `ev_wedge_diagnosed` (WorkItem `work-bp-m_adapter_modernization_pilot_20260629-p1a_repro_image`)
**Author:** greg (engineer, `agent-0d2c690e`) · 2026-06-29
**Provenance pin:** idea-398 → ratified **Design v1.0** (`66a8f721:docs/designs/m-adapter-modernization-design.md`, §8/§9) — Director-direct priority. **NOT** a GATE-2/SR disposition.
**Gate mandate (Design §8 + brainstorm mustFix #13/#3):** *confirm what code was ACTUALLY deployed during the historical wedge* — a GATE that must land before the reproducible-image build is leaned on. Explicitly **NOT** a hard "reproduce the historical prod wedge" blocker (mustFix #3: "chaos + L2/L3 is right-weight").

---

## 0. Verdict (TL;DR)

**CONFIRMED — the deployed claude-harness build is provenance-impure (`dirty=true` + a stamped SHA that is not on `main`), so the wedge-time code is *not byte-identifiable by construction*. That unknowability is itself the diagnosable root condition that P1a/reproducibility eliminates.**

- The wedge was **NOT** a missing-reconnect-code defect — the L1 reconnect machinery is present in the source lineage (E1).
- The "reproducibility is the most-plausible PRIMARY contributor" framing is **SUPPORTED, not over-claimed**: an impure/dirty, off-main build is the highest-probability mechanism for running stale-or-divergent reconnect behaviour (E2/E3/E6).
- **HONEST BOUND (does not over-close):** because the deployed build was dirty, we cannot byte-prove the exact failure mode, so we **cannot rule out** the competing *keepalives-flowing-but-session-dead* live-wedge edge — which reproducibility would NOT fix. → P1c chaos-validation of that named edge stays **REQUIRED**, and the §4 L1.5 liveness self-watchdog is independently justified. This gate does **not** declare the wedge "closed by reproducibility alone."
- **Scope discipline:** no "reproduce the prod wedge" blocker is added. The gate is satisfied: provenance confirmed-impure → root condition identified → competing edge handed forward to P1c. **P1a repro-build is GREEN to proceed.**

---

## 1. The incident under diagnosis

The "historical wedge" is **this session's lived incident** (Design brainstorm lines 5/22): the **claude-plugin** proxy's Hub push-session dropped and did not visibly auto-reconnect, requiring a manual kill + restart (`/reload-plugins` was insufficient; a full Claude Code restart was needed). This is the `stdio-mcp-proxy` / claude-code harness — **not** the opencode harness. Corroborated first-hand: the engineer (greg) experienced exactly this adapter disconnect earlier in the session.

The design's open question (redteam finding #13, "pilot built on unconfirmed wedge diagnosis") is whether the wedge was caused by **(a)** a stale/impure deployed build (reproducibility fixes) or **(b)** the undetected *keepalives-flowing-but-session-dead* edge (only the L1.5 watchdog fixes). This gate resolves what is *provable* and bounds what is not.

## 2. Evidence (falsifiable; each with a ground-truth ref)

### E1 — Reconnect code is PRESENT in the source lineage → wedge ≠ missing-code
`packages/network-adapter/src/` contains the full L1 machinery:
- `wire/transport.ts` — wire-level reconnect policy ("it transparently reconnects"), `WireReconnectCause`, `reconnecting`/`reconnected` states, `totalReconnects`/`consecutiveReconnects`/`lastReconnectCause` (transport.ts:19,60,75-76,148-150).
- `kernel/agent-client.ts` — `SessionReconnectReason` (session-layer reconnect).
- `kernel/poll-backstop.ts` — `PollBackstop` (the heartbeat-cadence backstop).
- `tool-manager/tool-surface-reconciler.ts:37-39` — the bug-180 redeploy-then-reconnect path + the L2 PollBackstop-heartbeat backstop.

→ The shim-audit claim ("L1 auto-reconnect ALREADY EXISTS") is **verified**. The wedge is not a missing-reconnect-code defect.

### E2 — The deployed claude build is `dirty` (uncommitted at build time) → not byte-reconstructible
Live `get_agents` `clientMetadata` (2026-06-29), both claude-harness agents **identical**:

| agent | harness / transport | `sdkDirty` | `proxyDirty` | `commitSha` | sdk / shim ver |
|---|---|---|---|---|---|
| greg (engineer) | claude-plugin / stdio-mcp-proxy | **true** | **true** | 567ccd6 | @apnex/network-adapter@0.1.4 / 0.1.10 |
| lily (architect) | claude-plugin / stdio-mcp-proxy | **true** | **true** | 567ccd6 | @apnex/network-adapter@0.1.4 / 0.1.10 |
| steve (verifier) | opencode / bun-serve-proxy | false | false | 7295220 | @apnex/network-adapter@0.1.4 / 0.2.1 |

`dirty=true` means the build was produced from a working tree with uncommitted changes (`git status --porcelain !== ""`, see E6). **The running bytes correspond to no committed SHA.**

### E3 — The stamped SHA is OFF-MAIN → recorded provenance is non-canonical
`567ccd6` = "claude-plugin: bump 0.1.9 -> 0.1.10 (version-honesty gate; stint-6 adapter restage)" on branch `agent-greg/claude-plugin-vbump-stint6`.
- `git merge-base --is-ancestor 567ccd6 origin/main` → **rc=1 (NOT on main)**; `git rev-list --count 567ccd6..origin/main` → **3** commits ahead on mainline. The same change merged to main as `0fd7be3` (#431) — so the deployed build records the *feature-branch* SHA, not the merged mainline commit.
- The recorded provenance therefore points at a commit that does not exist on the mainline, *on top of which* there were further uncommitted edits (E2).

### E4 — The impurity is claude-harness-specific (the wedge-prone one)
opencode/steve is `dirty=false` at `7295220`, and `git merge-base --is-ancestor 7295220 origin/main` → **rc=0 (on main)**. The clean harness did not wedge; the impure harness did. The impurity correlates with the failing harness.

### E5 — `McpConnectionManager` is a stale-COMMENT hygiene smell, NOT a src↔dist divergence (discarded hypothesis, recorded for honesty)
Initial hypothesis: the deployed `dist/` referenced a deleted `McpConnectionManager` that `src/` had removed (a deployment-staleness proof). **REJECTED on rigorous check:** `McpConnectionManager` appears in *both* `src/` (10 refs) and `dist/` (17 refs), and has **no actual code definition anywhere** (`grep 'class McpConnectionManager…'` and `find *mcp-connection*` both empty). It is a deleted symbol still named in *current-source* migration comments ("currently delegated down to McpConnectionManager", "Until then, McpConnectionManager stays") — a stale-comment cleanup item (brainstorm line 115), **not** a deployed-vs-source divergence. My first read ("src empty") was a `| head` truncation artifact (dist sorts before src); discarded. The real provenance proof is the `dirty`/off-main metadata (E2/E3), not this.

### E6 — The build-identity stamper exists *precisely* to surface this class, and is working
`scripts/build/write-build-info.js` (idea-256 / M-Build-Identity-AdvisoryTag): `commitSha = git rev-parse --short HEAD`; `dirty = git status --porcelain !== ""`; written to `dist/build-info.json`, read by `kernel/build-identity.ts` and surfaced on `get_agents`. Its documented motivating incident (PR #190) is *"the canonical-main-stale fault chain invisible from get-agents output."* The mechanism is healthy and is correctly flagging the impurity — the diagnosis rests on a trustworthy instrument.

## 3. Why this confirms the gate (and what it does NOT close)

**Confirmed (provable):** the deployed claude build is provenance-impure along two independent axes — `dirty` (E2) and off-main SHA (E3) — uniquely on the harness that wedged (E4), with reconnect code present in source (E1). The exact wedge-time bytes are therefore **unknowable by construction**. P1a (build from a clean, committed, on-`main` SHA so `dirty=false` and the SHA is canonical + byte-reconstructible) **directly eliminates this root condition** and is the correct first fix.

**Not closed (the honest bound):** an impure build *prevents* byte-proving whether the wedge was the stale-build path *or* the keepalives-flowing-but-session-dead edge. These are not mutually exclusive, and the latter is reproducibility-immune. Per mustFix #1/#3 convergence (both independent lenses point at the undetected-dead-session live-wedge as the one genuine hole), the residual is carried forward, NOT waved closed:
- **P1c** must chaos-validate the *named* edge (kill the Hub session server-side while the SSE keepalive flows) + a restart-mid-long-cognitive-node case, with one criterion tied to this lived incident.
- **§4 L1.5 liveness self-watchdog** (app-level session probe → PID-1 self-exit → L2 restart) remains independently justified regardless of P1a's outcome.

## 4. Gate disposition

| | |
|---|---|
| Provenance of wedge-time code | **CONFIRMED IMPURE** (dirty + off-main; not byte-identifiable) |
| Missing-reconnect-code as cause | **REFUTED** (E1) |
| Reproducibility as primary fix | **SUPPORTED** (not over-claimed) — eliminates the proven root condition |
| keepalives-dead live-wedge edge | **NOT RULED OUT** → handed to P1c chaos + §4 L1.5 watchdog |
| "Reproduce the prod wedge" hard blocker | **NOT ADDED** (mustFix #3 — right-weight) |
| **P1a reproducible-image build** | **GREEN to proceed** |

---
*Gate authored by greg (engineer) for the adapter-modernization claude-pilot P1a. Evidence is live-system + source + git ground truth, each ref reproducible. Surfaced to the architect (lily) before the reproducible-build leg is leaned on, per redteam #13 discipline.*
