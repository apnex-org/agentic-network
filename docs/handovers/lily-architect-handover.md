# Lily-the-Architect — Handover Doc

**Status:** LIVING — current as of 2026-06-30 ~09:10Z. **n5 COMPLETE (both ACs cleared); n6 (steve accept-gate) in flight — arc near-close.**
**For:** the NEW lily — architect, now running on an **opencode** harness (locally, like steve), succeeding the claude-lily that drove this arc.
**Why a written doc:** opencode does NOT inherit claude-lily's Claude-Code memory files (the memory system is harness-specific), so this transport-agnostic repo doc is your come-up-to-speed. It is the **manual** precursor to the **automatic** graph/arc-crawl handover (idea-407) — "manual now, mechanise later" (Director, 2026-06-30).
**Fastest self-serve:** run the arc-context crawl in §7 against runId `real_cli_harness_20260630`.

> **⚠️ WHERE THINGS LIVE — you have NO worktree.** Your cwd is the opencode harness dir (`~/taceng/lily` for lily, `~/taceng/greg` for greg) — just `opencode.json` + `.ois/` + the start script, **NOT a repo checkout**. The **agentic-network repo is a PEER directory: `/home/apnex/taceng/agentic-network`** (on `main`). ALL repo work — git, reading `docs/traces/`, `CLAUDE.md`, `docs/calibrations.yaml`, *this doc*, the arc-crawl, the reorg — is against that peer path: `cd /home/apnex/taceng/agentic-network` (or `git -C /home/apnex/taceng/agentic-network …`), and **`git pull` first** to get latest `main`. The old per-agent worktrees (`agentic-network-lily` / `-greg`) belonged to the *claude* sessions and are going away — don't rely on them. lily + greg now **share the single peer checkout** (no per-agent worktree isolation) — coordinate git work, or `git worktree add` your own isolated branch dir if you need one.

---

## 1. Who you are + the org

- **lily = architect (you):** drive the mission at spec level (don't deep-read code — translate findings), cross-approve PRs peer-to-peer, coordinate the arc, file calibrations/ideas, engage the Director at gate-points.
- **greg = engineer** (`agent-0d2c690e`, claude adapter): builds, hands-on code.
- **steve = verifier** (`agent-f148389d`, opencode, cross-lineage gpt-5.5): adversarial gates, decorrelated lens.
- **Director = the human:** engages at gate-points + steers; runs the local harnesses.
- **Hub substrate** = the work-queue backplane (WorkItems / ideas / bugs / calibrations / messages / threads). Query via the proxy MCP verbs (`list_work`, `get_work`, `list_messages`, `get_idea`, `get_bug`, `list_audit_entries`, …). `get_agents` for the roster (NOT `get_engineer_status` / `list_available_peers` — both deprecated).
- **Disciplines:** NO `Co-Authored-By: Claude` commit trailer; merge = squash; per-PR branches off main; calibration ledger at `docs/calibrations.yaml` (read via `scripts/calibrations/calibrations.py {list,show,status}`); `CLAUDE.md` is the project binding.

## 2. The arc (real-CLI-harness, idea-405)

**Goal:** finalise a containerised Claude Code CLI harness runnable in docker on this host, configured to connect to a real Hub as an engineer ready for work.

- **runId:** `real_cli_harness_20260630`. Nodes n1–n6, plus **work-107** = the arc-driver anchor (your self-drive heartbeat + stall-backstop; `completionDependsOn` n1–n6). HOLD + `renew_lease` it each active turn; complete it ONLY at arc-close.
- **State (2026-06-30 ~09:10Z):** n1–n5 **DONE**; **n6 (steve accept-gate) in flight** — the terminal gate. PR **#444** (n4) APPROVED, held for in-order stack-merge.
- **n5 RESULT — the arc thesis PROVEN end-to-end, zero-human, real CLI in the middle:** the `<channel>` digest rendered → the UNPRIMED cold CLI self-drove the seeded item to done (claim→start→complete, *reasoning the FSM itself*) → then the faithful **(b) reject-handshake wedge** → L1 can't recover → L1.5 watchdog 2-consecutive-fail → sentinel `/run/adapter-wedged` → supervisor `exit(75)` → **docker-L2 restart** (RestartCount 0→1) → re-boot → launcher **auto-accepted** the dev-channels dialog (zero-human) → shim re-spawn → re-register (epoch=2) → the **recovered** CLI re-claimed + completed a fresh item (FSM-reasoned again). Both ACs cleared (`ev_engineer_ready`-behavioral + `ev_container_e2e`). Boot is fully unattended — 3 gates auto-handled (bypass, dev-channels auto-accept, shim-spawn).

## 3. Load-bearing learnings this arc

- **Channels-flag reversal:** the `claude/channel` render needs TWO gates — the shim's declared capability AND the server being in the session's `--channels` list. A plain `.mcp.json` does NOT render; `--dangerously-load-development-channels plugin:agent-adapter` is required. The container therefore carries **two** sandbox-bounded dangerous flags (`--dangerously-skip-permissions` + `--dangerously-load-development-channels`).
- **Cred-staging:** host OAuth on the bounded throwaway VM (Director-approved, **destroy-after**). The harness auto-mode classifier HARD-BLOCKS an agent from scp-ing the live OAuth (correct gate) → the Director stages it directly. Bind-mount uid gotcha: chown the cred to the container appuser (uid 10001), not the host dir owner.
- **Three headless boot gates:** (1) bypass-dialog (`settings.json{skipDangerousModePermissionPrompt}`); (2) dev-channels dialog (appears POST-login, persisted to `.claude.json`); (3) shim-spawn (packaging: the in-repo directory-marketplace plugin's deps aren't copied into the install-cache → symlink `/app/node_modules`; + the shim demands `OIS_HUB_TOKEN` present even for a no-auth Hub). All must be deterministic in the image for a reproducible harness.
- **bug-207 (delivery resilience, major, fix-soon, root-cause VERIFIED):** both adapter recovery nets — the poll-backstop AND the W1b SSE replay — scope the inbox by `targetRole` only, so they structurally cannot recover an **agent-direct** message (target = `{agentId}`, no role). 206 messages are stuck at `status:new` going back to April. Fix = `OR(role, agentId)` on both nets + a render-gated cursor. (This bit us live mid-arc — a greg→lily ping silently dropped for 23min.)

## 4. The opencode transition — YOU run differently now

- You're on the **opencode adapter** (`bun-serve-proxy`), not claude (`stdio-mcp-proxy`). Run locally like steve (a `start-steve` analog).
- **KEY DIFFERENCE:** opencode does NOT support claude/channels. Inbound messages reach you via the opencode plugin's **promptAsync injection**, not the `<channel>` render. So the entire channels-flag saga (§3, idea-406) is claude-specific — you sidestep it, but you rely on the injection path.
- **Carries over:** the same kernel (`@apnex/network-adapter`), the Hub substrate + all proxy verbs, your architect role + RACI, the work-graph, the calibrations/ideas.
- **Changes:** transport + injection + no-channels + no-memory-inheritance (hence this doc).
- **Your setup template = steve's opencode harness:** mission-95 / idea-355, work-16/17 (the opencode bundle, kernel-inlined esbuild build, the start script). Talk to steve.
- **Watch your own delivery:** as an opencode agent you depend on the same message-delivery substrate. steve's **work-108** CONFIRMED bug-207 is **substrate-wide** (opencode shares the role-blind-spot — shared kernel poll-backstop), so the fix is substrate-layer, not per-adapter.
- **Your harness is built + fixed:** `~/taceng/lily/` — `opencode.json` inherits the global `litellm-router` provider (→ Opus 4.8); `.ois/adapter-config.json` = architect role + prod Hub; launch via `start-lily.sh`. (Provider config cleaned 2026-06-30: per-agent provider block dropped, `HUB_LLM_MODEL=claude-opus-4-8`.)
- **How you pick up the arc-anchor (work-107) — the LEASE-LAPSE handoff (Director-chosen, dogfooding the stall-backstop):** claude-lily does NOT `release` work-107. When it stops, the lease lapses (~15 min) → the sweeper requeues work-107 → it surfaces on **your** claimable-digest → you re-claim it (a fresh agentId) and resume driving. Expect a bounded ~15-min architect-gap, then the anchor lands on your digest. The whole work-graph is on the prod Hub, so you see n6 / bug-207 / the ideas immediately.

## 5. Entities filed this session (your durable trail)

- **Ideas:** 406 (thin-container channels path — drop the marketplace-plugin dep), **407** (graph queryability for zero-knowledge agents — the automatic-handover mechanism; refs `github.com/apnex/mcp-portal`, do-NOT-ingest-yet), 408 (cross-agent peer-stall detection — mutual-silence bridge; 4 mechanisms).
- **Bug:** 207 (delivery-resilience role-blind-spot; major; fix-soon; root-cause verified — full analysis + a 7-item must-verify checklist on the bug).
- **Calibrations:** #104 (localize-before-fix / reproduce-at-the-faithful-layer — filed, PR **#445**). QUEUED (task #16): 2 coordination-gap cals (self-stall ≠ peer-stall conflation; recovery-net-selector-blind-spot).
- **Work:** 107 (your arc anchor), 108 (steve's bug-207 cross-lineage probe).
- **PRs:** #444 (n4, approved, held for stack-merge), #445 (cal-104, open).

## 6. Open threads — what to pick up (the work-queue is the truth)

1. **Finish the arc:** n5 **DONE** → **n6 (steve, in flight)** — criteria handed to steve (the 7 node-runbook ACs + amendments: both-dangerous-flags bounded-exposure cert, positive `<channel>` render, dir-source self-contained image, gate-3.5 auto-accept, the unprimed-first finding, the full 3-level seam). On n6 VALID → **close-out** (retro + cals + merge the #444→n5 stack). New cal-candidate from the wedge work: *faithful-chaos-test* — model the failure the recovery layer EXISTS FOR, don't tune intensity to beat the detector (add to task #16's batch).
2. **HOLD + renew work-107** each active turn; complete only at arc-close.
3. **bug-207 fix** — Director-prioritized "go after soon" (task #17): seed as a fix WorkItem for greg post-arc (root-cause + checklist ready).
4. **File the 2 queued coordination-gap calibrations** (task #16).
5. **Disposition steve's work-105/106** verifier deliverables (task #13 — verifier-posture audit + uncompletable-node sweep; bug-205 still unresolved → idea-388).
6. **idea-407 / idea-408** design (design-later).
7. **Finalize this handover doc** + build the automatic version (idea-407).
8. **Reorg the harness code → `harnesses/claude/`** (Director pref 2026-06-30; task #19): after the #444→#446 merge, `git mv` the claude-real-CLI files from `deploy/adapter-image/` → `harnesses/claude/`, **update the internal path-refs** (scripts/compose/cloudbuild cross-reference siblings), **re-verify the build** from the new home, and **sort claude-specific vs pilot-SHARED** files (base `Dockerfile`, `supervisor.mjs`, `prune-node-modules.cjs` are shared). NO creds (verified clean — only a dummy `"test"` token in a README). Anticipates `harnesses/opencode/`. Engineer task (it's not a blind move — needs ref-updates + re-test).

## 7. Come up to speed FAST — the arc crawl

There is no one-shot "whole arc" verb; reconstruction is a fan-out crawl (the full prompt template was produced by workflow `wf_a96578be`). Condensed steps:

1. **Enumerate nodes:** `list_work` has NO runId filter (status/role/holder only) — page it and client-filter on `blueprintRunId == real_cli_harness_20260630` (payloads are large → jq, don't eyeball; first page is non-representative). Shortcut: `get_work` each `work-bp-real_cli_harness_20260630-{n1_headless_boot_spike,n2_sandbox_exposure,n3_startup_automation,n4_connect_ready_for_work,n5_container_sentinel_e2e,n6_accept_gate}` directly.
2. **Read each node** (`get_work`): `dependsOn` + `completionDependsOn` (the DAG — build it yourself, no reverse-edge query), status, `evidence[]` refs, `references[]` (git-blob `<sha>:<path>`), `stateDurations` (`.in_progress` = real work; `.ready` conflates dep-wait + queue-wait).
3. **Pull the git "why":** `docs/traces/m-real-cli-harness-n*-work-trace.md` (greg's narrative — READ FIRST), the design doc / blueprint (may be on a feature branch / historical SHA — `git log --all`), `docs/calibrations.yaml`.
4. **Resolve evidence:** `get_idea`/`get_bug`/`get_review` by id; audits via `list_audit_entries(actor=verifier)` (no get-by-id); PRs via `gh`.
5. Also read: `CLAUDE.md` (project binding), `docs/roadmap.md` (arc-level status).

## 8. Director working-prefs

Live updates ALWAYS, NEVER markdown-report bloat, wants telemetry/metrics views. Engage at gate-points. Flow verifier-gated reversible deploys autonomously; pre-gate ONLY genuine hard-lines (credentials / external-registry / prod-Hub / the nested-acting-claude sandbox). The **container sandbox is the security boundary** — bound the container's exposure (mounts/network/caps/creds), not the in-CLI permission model.

---

*Maintained by claude-lily (agent-40903c59) for the opencode-lily transition. Pairs with idea-407 (the mechanised successor to this manual doc).*
