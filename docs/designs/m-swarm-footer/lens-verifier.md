# Swarm-Aware Footer — Verifier Lens (W4)

**Status:** verifier lens for W5 council.  
**WorkItem:** `work-bp-swarmfooter1-lens_verifier` / mission-97.  
**Author:** steve (verifier), 2026-07-02.  
**Inputs read:** `docs/designs/m-swarm-footer/design-inputs.md` and `docs/designs/m-swarm-footer/design-brief.md` from the Hub substrate.

## 0. Verifier verdict

**Recommended D1 shape:** adopt **C-prime-fixed-height**: Option C's severity-driven content model, but **do not let the footer's physical row count collapse/expand**. Render a stable two-line footer at all times; line 1 carries the compact local + population glance, line 2 is dim/near-empty when nominal and flares when action/alert exists.

If the council must choose one of the literal W1 options unchanged, pick **Option B** for the first shipped slice. It is the safest fixed-height layout and best action surface. Pure Option C is not verifier-approved until a TUI reflow harness proves that 1-line⇄2-line transitions do not move the editor/prompt or create perceptual jank.

**Hard gates for any option:**
1. **No Tier-C MCP/tool call inside `render(width)`.** Render consumes only an in-memory cache and pi-local state.
2. **Every emitted line passes `truncateToWidth(..., width)` / `visibleWidth` discipline.** Width tests at 120/100/80/64/50 columns are required.
3. **Unknown/stale is not nominal.** A Hub hiccup renders `?`/stale-age in dim/amber; it must never collapse into `all clear`.
4. **The footer must not use `drain_pending_actions` as a passive read.** It is a write/ack primitive; calling it from a background footer poll would mutate queue state and hide work. Use read-only/event-fed state for the HUD.

## 1. Option scorecard

Scores are 1–5 where 5 is best. Risk/test cost scores are inverted: 5 = low risk / cheap to verify.

| Option | Tele-5 parity | Tele-11 hot-path cost | Tele-12 density/width | Fail-quiet safety | Blast-radius risk | Verification cost | Overall |
|---|---:|---:|---:|---:|---:|---:|---|
| **A — Me / Swarm** | 5 | 4 | 3 | 4 | 5 | 5 | **SAFE but noisy** |
| **B — State / Needs-doing** | 4 | 4 | 4 | 4 | 5 | 5 | **Best unchanged ship candidate** |
| **C — Severity-collapsing** | 3 nominal / 5 alert | 5 | 5 | 2 unless fixed | 2 | 2 | **High upside, needs mitigation** |
| **C-prime-fixed-height** | 5 | 5 | 5 | 4 | 4 | 4 | **Recommended hybrid** |

### Option A — Me / Swarm

**Conformance:** strong tele-5: the population/inbox line is always visible, so the agent passively perceives the network. Tele-11 is acceptable if Tier-C is cached. Tele-12 is weaker: line 2 spends pixels on nominal swarm state even when nothing needs the agent.

**Risk:** low implementation blast radius. Fixed two-line shape means no row-count transitions. The mental model is simple and snapshot-testable.

**Testability:** easiest: deterministic renderer tests can assert line 1 local cells and line 2 swarm cells under width degradation.

**Fail-quiet gap:** moderate. Because line 2 is always present, unknown Hub state can be displayed explicitly (`▲? ✎?` or `swarm stale 52s`). This is safer than hiding the line. Require stale-age on any cached Tier-C payload older than 2 poll intervals.

**Verifier disposition:** acceptable fallback, but not ideal. It optimizes "see the dashboard" over "know what needs attention."

### Option B — State / Needs-doing

**Conformance:** best literal W1 option. It gives tele-13 a dedicated action line while preserving tele-5 through line-1 population. It avoids C's reflow risk and is denser than A because line 2 has a single semantic job: needs/action.

**Risk:** low. Fixed two-line renderer. Width degradation is clear: line 2 labels drop before glyph/counts.

**Testability:** cheap. Snapshot states: nominal, needs-me, alert, Hub-stale, narrow. The action line can have explicit precedence rules: alert > needs-me > claimable > all-clear.

**Fail-quiet gap:** manageable. The key rule is that `all clear` is legal only when the cache is fresh and the relevant read succeeded. On stale/error, line 2 must render `needs ?` or `swarm stale`, not `all clear`.

**Verifier disposition:** **safe to ship unchanged** if the council rejects hybrids. It is the best low-risk first slice.

### Option C — Severity-driven / collapsing

**Conformance:** strongest tele-11/12 philosophy in the abstract: no pixels on green, deviation draws the eye, nominal footprint is minimal. But it weakens passive tele-5 in nominal periods if the swarm dashboard disappears; W1's C-prime lean corrects this by keeping S3 on line 1.

**Blast-radius risk:** high if implemented as variable row count. The pi TUI `setFooter` API accepts `render(width): string[]`; variable line counts are possible, but W4 finds no guarantee that row-count transitions are visually stable. A 1-line→2-line footer can move the editor, shift scrollback framing, and create attention through motion even for low-severity amber notices.

**Reflow-jank stress test required before pure C ships:**
- Simulate nominal→notice→alert→nominal transitions while typing in the editor.
- Assert cursor position and editor row remain stable or intentionally adjusted.
- Repeat at 120/80/64 columns and during model streaming.
- Verify rapid S4 churn (turn count 0↔1) does not flicker line height.
- Verify stale/error state does not collapse to a single nominal line.

**Fail-quiet gap:** largest. If a Hub read fails while line 2 is hidden, the user can falsely perceive "all clear." Mitigation: unknown/stale must force a visible notice (`? swarm stale`) even when counts are zero.

**Verifier disposition:** **do not ship pure variable-height C in W1**. Ship its severity grammar only if row count is fixed or if the above integration harness passes.

### C-prime-fixed-height — verifier-recommended hybrid

```
line 1: ~/… ⑂branch · ctx 21% · ◉hub · ▲3 ●1 ⏸1
line 2 nominal: dim "✓ all clear" or blank reserved segment with stale-age suppressed only when fresh
line 2 notice:  ⟶ ✎2 ⚑1 ⊘1 · ⚒2
line 2 alert:   ‼ ⚠steve lease · hub down · ctx 91%
```

This keeps C's information economics without relying on terminal reflow. The appearance of red/amber still draws attention; the terminal layout does not jump.

## 2. Tele-conformance findings

### tele-11 / tele-12 — zero hot-path cognitive budget

All options are compliant **only under a cache-first implementation**:
- `render(width)` must be synchronous, pure, and bounded: format cached values, width-truncate, return strings.
- Tier-C refresh runs in a background cadence with jitter/backoff and updates a small footer-state store.
- Refresh must coalesce calls; `get_agents` should feed both S3 and S8.
- No render-triggered calls to `get_agents`, `get_pending_actions`, `list_ready_work`, `list_work`, or notifications.
- No footer call to `drain_pending_actions`; it mutates queue state.

Acceptance test: instrument a fake Hub client and assert `render()` performs **zero** Hub-client invocations across repeated renders and width changes.

### tele-5 — measurable parity gain

Parity gain is measurable if W1 defines metrics before implementation:

| Metric | Expected movement if footer works | Measurement method |
|---|---|---|
| Manual status probes | Down | Count explicit `get_agents` / pending-action status checks per session before/after. |
| Action detection latency | Down | Time from thread/work/notification becoming actionable to agent acknowledgment/reply. |
| False-idle intervals | Down | Time an agent is idle while role-claimable work or needs-me count is >0. |
| Peer-risk detection | Down | Time from peer unresponsive/quota-blocked with live work to visible footer alert. |
| Stale-awareness correctness | Up | Inject Hub read failures and verify footer shows unknown/stale instead of nominal. |

Without these measures, the HUD is visually richer but not proven as a perceptual-parity instrument.

## 3. Fail-quiet requirements

A footer is an always-on truth surface; silent optimism is worse than no footer.

| Condition | Required render |
|---|---|
| Hub connected, Tier-C fresh, counts zero | `✓ all clear` may be dim/quiet. |
| Hub connected, Tier-C fetch failed | `swarm ?` / `needs ?` with dim or amber; not all-clear. |
| Cache older than 2× poll interval | include stale age (`~75s`) or `stale`; not all-clear. |
| Hub reconnecting/down | S1 amber/red; Tier-C cells either stale-marked or hidden behind `hub down`, never nominal. |
| Partial failure (get_agents ok, needs read failed) | render known cells normally and failed cell as `?`; no whole-footer blanking. |
| Width too narrow for all cells | drop lower-priority cells; preserve S1 and the highest-severity/actionable cell. |

## 4. Verification plan

Minimum tests before implementation can be called safe:

1. **Pure render contract:** render from fixture state; assert zero Hub calls and max two lines.
2. **Width matrix:** 120/100/80/64/50 columns; visible width never exceeds width; priority drop order deterministic.
3. **State matrix:** nominal, needs-me, claimable-only, escalation, peer-aging, peer-unresponsive-with-lease, Hub reconnecting/down, stale cache, partial failure.
4. **Role matrix:** architect/engineer/verifier show the same framework with different priorities; no role sees producer-only concepts as actionable if unauthorized.
5. **Cadence anti-stampede:** timers are jittered by agent instance; background refresh backs off on errors; no synchronized poll burst in a multi-agent fake clock.
6. **C reflow harness if variable-height C is retained:** cursor/editor stability under 1-line⇄2-line transitions. This gate is unnecessary if the council adopts fixed-height C-prime or B.

## 5. Positions on D1–D6

### D1 — Layout doctrine

**Take:** **C-prime-fixed-height**. If no hybrid allowed, choose **B** for W1. Reject pure variable-height C until reflow is proven.

### D2 — Cadence & anti-stampede

**Take:** jittered ~30s base poll for Tier-C, with per-agent random phase and exponential backoff on failure. Coalesce refreshes; one tick should gather the shipped-MUST reads together. Piggyback on actionable events, state changes, and tool-completion points to invalidate/refresh opportunistically, but never block render.

Recommended initial SLOs:
- fresh: <=45s old;
- stale notice: >60s or after one failed refresh;
- alert if stale while Hub wire-state is down/reconnecting and needs/action state is unknown.

### D3 — Severity grammar

**Take:** adopt nominal/notice/alert and compound-alert. Use color as an accelerator, not the only carrier: glyph/count/text must carry the state for monochrome terminals.

Defer L3 burn-rate for W1; simple context % thresholds are enough (`>70%` notice, `>90%` alert). Add burn later once the local session metric is validated.

### D4 — Role specialization

**Take:** one renderer/framework with **role-conditional cell priority**, not separate implementations. Separate implementations multiply verification burden and drift risk. Role presets are data/config tables.

Verifier-specific note: verifier footer should emphasize gates/verdicts/threads requiring verifier action, not producer surfaces. The HUD must not imply create/produce authority the verifier role lacks.

### D5 — Push vs pull for Tier-C

**Take:** event-fed where already available; poll-fed for aggregate state.

- Event-fed: S1 wire-state; immediate local cache update from actionable/informational events; pending-action delivery can update a needs-me approximation.
- Poll-fed/reconciled: S3/S8 from `get_agents`; S4 from a read-only pending/inbox projection; S5/S6/S7 if included.
- Explicit prohibition: no passive `drain_pending_actions` in the footer.

### D6 — Shipped-MUST slice vs North-Star

**Take:** approve the proposed five-cell W1 slice with the fixed-height/fail-quiet gates:

**Ship first:** L1 cwd+branch, L3 ctx%, S1 hub-state, S3 population, S4 needs-me.

**Defer:** L2 model, L4 spend, S5 claimable, S6 arc progress, S7 escalation, S8 peer-health, L3 burn-rate, rich per-role presets. S7/S8 are important but widen blast radius by adding more reads/threshold semantics; they should land after the cache/fail-quiet spine is proven.

## 6. Council-ready summary

- **Best unchanged option:** B.
- **Best overall option:** C-prime-fixed-height.
- **Do not ship:** pure variable-height C without a reflow harness.
- **Main verifier hard line:** no Hub calls in render, no passive queue mutation, no all-clear on unknown/stale.
- **Measurability:** define passive-awareness metrics now, or tele-5 gain remains asserted rather than proven.
