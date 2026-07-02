# M-Real-CLI-Harness Retrospective (idea-405, runId real_cli_harness_20260630)

**Mode:** summary-review (clean, fully-verified arc; n6 VALID).
**Status:** arc closed-out — n1–n6 ALL DONE; n6 accept-gate VALID (steve cross-lineage, audit-5511); close-out PRs all merged warm by claude-lily before the lily-swap (#444 → #446 stack + #447 handover + #445 cal-104); the 3 queued cals filed (#105, #106, #107); e2e VM destroyed (audit-5580). work-107 arc-anchor still held; this retro is the last gate before complete_work.

---

## 1. Verdict (headline)

**ARC THESIS CERTIFIED END-TO-END, ZERO-HUMAN.** A containerised Claude Code CLI, running headless against a real Hub, **self-drove a Hub-seeded WorkItem to done** (claim → start → complete, *reasoning the FSM itself*); then the **faithful (b) reject-handshake wedge** triggered L1.5 watchdog → sentinel exit-75 → docker-L2 restart → **launcher auto-accepted the dev-channels dialog** (zero-human) → re-register (epoch=2) → the **recovered** CLI claimed + completed a fresh item. Both ACs cleared (`ev_engineer_ready`-behavioral + `ev_container_e2e`).

Boot is fully unattended — three headless gates auto-handled in the image (bypass-dialog, dev-channels auto-accept, shim-spawn).

Sandbox bounding posture confirmed: the container itself is the security boundary (mounts/network/caps/creds bounded), not the in-CLI permission model — so the two dangerous flags (`--dangerously-skip-permissions` + `--dangerously-load-development-channels`) are safely carried.

---

## 2. Arc — what shipped

| Node | Deliverable | Evidence |
|---|---|---|
| **n1 headless boot spike** | image boot + bypass-dialog persistence in `settings.json{skipDangerousModePermissionPrompt}` | trace; #444 prep |
| **n2 sandbox exposure** | bounded exposure for BOTH dangerous flags; in-repo dir-source plugin path resolved (the channels-flag reversal — plain `.mcp.json` does NOT render; the dev-channels flag is REQUIRED, not droppable) | trace |
| **n3 startup automation** | three headless gates deterministic in the image (bypass / dev-channels auto-accept / shim-spawn via `/app/node_modules` symlink + `OIS_HUB_TOKEN` even for no-auth) | trace |
| **n4 connect + ready-for-work** | test-Hub-with-work harness; channels-flag reversal; +552/-0 purely additive, hub/** untouched | #444 (merged) |
| **n5 container sentinel + e2e** | embedded harness + 3-level sentinel (L1 in-process / L1.5 watchdog 2-consecutive-fail / L2 docker restart-policy); UNPRIMED cold CLI self-drove a Hub-seeded item to done + auto-recovered the wedge; clean SIGTERM exit-0 | #446 (merged) |
| **n6 accept-gate** | steve (cross-lineage gpt-5.5 opencode) certified every criterion VALID | audit-5511 |
| **work-107 anchor** | architect self-drive heartbeat + stall-backstop (Director-flagged the gap: arc was being driven off Director+greg channel events with NO self-held completion-gated anchor) | this retro |
| **work-108 cross-lineage probe** | steve confirmed bug-207 is SUBSTRATE-WIDE (not claude-adapter-specific) | audit-5406 |

**Adjacent ledger work:** cal-104 (localize-before-fix / reproduce-at-the-faithful-layer) #445; the lily-architect handover doc #447 (manual precursor to the automatic graph/arc-crawl handover, idea-407).

---

## 3. Load-bearing learnings (banked)

The three diagnostic-discipline calibrations filed this arc each came from a distinct, live-proven failure (not a desk-named hypothetical):

- **#105 self-stall ≠ peer-stall ≠ channel-drop ≠ peer-busy — DO NOT CONFLATE.** Surfaced at n6 verifier session: bug-208 (opencode in-flight HANG, no self-recovery) collided with bug-207 (delivery role-blind-spot) — three repeat episodes looked alternately like every mode, the Director unblocked each. idea-408 names the absent disambiguation surface. **Sibling to #104** (localize-before-fix) on the diagnosis-before-action axis.

- **#106 RECOVERY-NET SELECTOR-BLIND-SPOT** (substrate class). Verified root-cause for bug-207: both adapter recovery nets (poll-backstop + W1b SSE-replay) scope inbox by `targetRole` only → agent-direct messages (`{agentId}` no role) stay `status=new` forever (206 stuck back to 2026-04-27). The hole has the exact shape of the un-watched selector. Cure: union-OR across selectors + cursor-advance only for RENDERED messages (the cursor-trap is independent of the OR-fix). Greg-fix-ready with the 7-item must-verify checklist on bug-207.

- **#107 FAITHFUL-CHAOS-TEST.** Bank-the-positive: n5 chose the **faithful (b) reject-handshake wedge** over a synthetic detector-trigger (force-write sentinel-file / fake-heartbeat-miss). Proved the recovery against the failure the layer EXISTS for, not just that the detector fires. Sibling to #79/#82 (faithful-harness — visibility axis) and #104 (localize-before-fix — diagnosis axis).

Together these three + #104 form a tight **diagnosis-faithfulness cluster** from this single arc: **localize before fix → disambiguate the silence → query the FULL selector taxonomy → exercise the faithful failure-shape**.

### Live coordination drop (the meta-learning)

bug-207 bit us live mid-arc — a greg→lily ping silently dropped for 23 min — and **directly caused** the verifier's repeat hangs by hiding the silence-modes from each other. The arc thesis was certified WITH the substrate's coordination-resilience demonstrably broken. The fix being prioritized is *because* of this arc, not despite it.

---

## 4. Verification model

Cross-lineage verifier (steve, opencode + gpt-5.5) decorrelated from the claude-lineage build chain. The verification certificate (audit-5511) covered every n6 criterion individually — headless long-lived boot, engineer test-Hub session, unattended work-1, L2-recovered work-2 (sentinel exit-75 / RestartCount=1), clean SIGTERM exit-0, file-mounted+removed OAuth, bounded exposure for BOTH dangerous flags, host /work mount, positive channel render, in-repo dir-source plugin path. No same-lineage shortcut.

The verifier's hang-loop (bug-208) was the work-108 SUBSTRATE-WIDE verdict on bug-207 (audit-5406) talking — the recovery-net blind-spot is identical in opencode (shared kernel). This loops back into cal #105 + #106.

---

## 5. Calibrations banked

Filed this arc (via dogfooded `scripts/calibrations/calibrations.py add` / closure: cal-104 in #445):
- **#104** Localize-before-fix / reproduce-at-the-lowest-faithful-layer *(open; #445 merged)*
- **#105** Self-stall ≠ peer-stall ≠ channel-drop ≠ peer-busy — DO NOT CONFLATE *(open)*
- **#106** RECOVERY-NET SELECTOR-BLIND-SPOT *(substrate; open — closes when bug-207 ships)*
- **#107** FAITHFUL-CHAOS-TEST *(open; bank-the-positive — practiced at n5)*

Ledger: 95 → 98 entries, VALID, all cross-links resolve.

### Frictions surfaced (not yet calibrations)

- **Lease-window gap** (handover §3): a long LOCAL work-node (e.g. a verifier inspection >15min, no Hub calls) lapses its lease even while legitimately working — local work doesn't auto-heartbeat (only Hub calls do). Bit n6 repeatedly (looked like a stall). Mitigation: explicit `renew_lease` periodically; fix is adapter auto-heartbeating a held lease (like the claude shim's transport_heartbeat). Candidate to fold into the bug-207 fix family or a sibling substrate cal.
- **No reverse-edge query / no per-runId arc filter** (handover §7): reconstructing an arc is a hand-stitched fan-out crawl. Hands-on cost paid this arc; the automatic mechanism is idea-407 (graph queryability for zero-knowledge agents).

---

## 6. Decision-queue for the Director's return

1. **RATIFY the arc close** — work-107 ready to complete on this retro landing.
2. **Bug-207 fix** — Director-prioritized "go after soon": seed as a WorkItem for greg with the 7-item must-verify checklist on bug-207 (handover §6.3 / task #17). Closes #106 structurally.
3. **Bug-208 (opencode in-flight HANG)** — investigate post-swap; the opencode harnesses (lily/greg/steve) have no analog to the claude container's 3-level sentinel self-recovery. Part of the opencode-resilience cluster (bug-207 + bug-208 + idea-408 + lease-window gap).
4. **harness reorg** (handover §6.8 / task #19) — `git mv deploy/adapter-image/` claude-real-CLI files → `harnesses/claude/`, update refs, re-verify build, sort claude-specific vs pilot-SHARED (Dockerfile, supervisor.mjs, prune-node-modules.cjs are shared). Anticipates `harnesses/opencode/`. Engineer task.
5. **steve work-105/106 disposition** (task #13) — verifier-posture audit + uncompletable-node sweep; bug-205 still unresolved → idea-388.
6. **idea-407 / idea-408 design** — design-later (the automatic-handover mechanism + the cross-agent peer-stall detection bridge).

---

## 7. Continuation

The opencode-lily swap is structurally clear — claude-lily ran the close-out warm (PR merge + cal-104 + handover doc + the wedge fix into main), lily's lease lapsed → sweeper requeued work-107 → opencode-lily re-claimed cleanly (same agentId per name-as-identity / idea-251; this retro authored on the opencode side, dogfooding the transport switch in real time). The automatic graph/arc-crawl handover (idea-407) is the mechanised successor to the manual handover doc.

The next arc kicks off from here.
