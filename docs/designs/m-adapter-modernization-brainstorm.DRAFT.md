# M-Adapter-Modernization — Brainstorm (DRAFT, accumulating)

**Status:** brainstorm-in-progress (Director priority, post-stint-6-SR, 2026-06-29). Multi-session "figure it out" BEFORE a formal Idea→Design. **Scope: Adapters FIRST, then Agent harnesses. Hub + Transport-protocol PARKED.**

**Origin:** the stint-6 strategic-review under-represented infra/deployment (candidate_A = the adapter membrane; deployment/containerisation never summited = a backlog gap). Director prioritized adapter-modernization directly. Live pain this session: the proxy *wedged* (Hub-session dropped, no auto-reconnect → manual kill+restart) + bug-203 tool-surface staleness + directory-source provenance-impurity (`sdkDirty`).

## North-star (Director, 2026-06-29) — ALL THREE, not a trade-off
1. **Pure resilience** — self-healing adapter; no silent wedge; no manual kill+restart; survives Hub blips/redeploys by construction. [tele-7 Resilient Ops · tele-9 Chaos-Validated]
2. **Clean reproducible distribution** — versioned / npm-published / reproducible installs; no directory-source / hand-rebuild / `sdkDirty`; provenance-honest. [tele-2 Isomorphic · tele-1 State-Transparency]
3. **Maximal shared core regardless of harness** — ONE adapter brain; per-harness pieces are thin glue. [tele-3 Sovereign Composition]

## Target architecture (implied) — thin-shim / fat-resilient-kernel / npm-distributed
- **`@apnex/network-adapter` = fat shared kernel:** ALL MCP↔Hub logic + the connection lifecycle (establish / heartbeat / **auto-reconnect** / self-heal) + version-honesty. Resilience lives here, ONCE, for every harness.
- **`@apnex/claude-plugin` / `@apnex/opencode-plugin` = THIN shims:** only the harness-specific binding (how the host mounts MCP tools + spawns the runtime). No brains. A new harness (cursor / a CLI / …) = a new thin shim over the same kernel — zero kernel duplication.
- **Distribution:** npm, pinned + reproducible (shim depends on a pinned kernel version; lockfile); provenance-honest (running version = kernel-sha + shim-sha, truthfully surfaced); directory-source becomes a **dev-only** affordance, never prod.

## Key tension — "pure resilience" has TWO flavors that split on solvability
- **Connection-resilience** (this session's wedge: the proxy's Hub-session dropped + never reconnected) → **KERNEL-SOLVABLE.** Robust auto-reconnect / backoff / self-heal in the shared kernel; transport-protocol-agnostic (doesn't touch the parked transport theme).
- **Tool-surface-resilience** (bug-203: claude-code won't re-enumerate the tool-surface mid-session; opencode does) → **HOST-LIMITED, not fully kernel-solvable.** Even a perfect kernel can't make claude-code re-read tools without a restart. Needs either a clean/scripted restart OR idea-391 (system CLI→Hub REST, sidestepping the MCP tool-surface). The one place the north-star hits a host wall.

## Open forks (to brainstorm)
- **(i) shim↔kernel boundary** — minimal shim vs maximal kernel; makes "maximal shared core" precise. [the SPINE — likely first]
- **(ii) resilience contract** — what auto-reconnect / self-heal / version-honesty the kernel guarantees + how it handles the bug-203 tool-surface wall.
- **(iii) distribution + migration** — the npm-pinned model + how we move off directory-source without disruption.
- **framing Q:** is idea-391 (CLI→Hub REST) in-scope for this, or do we design resilience *around* the MCP host-limit and treat 391 separately?

## Decision log
- **2026-06-29 (Director) — tool-surface-resilience is solved at the HARNESS layer (containerisation + restarts), NOT the adapter (no hot-reload, no idea-391 on the critical path).** Mechanism: a tool-surface change → restart the containerised harness → the STARTUP-bootstrap path (which DOES honor the live surface — the path that worked today; bug-203 only blocks the *mid-session* re-enumerate) re-enumerates fresh. Containerisation makes the restart cheap/clean/reproducible + auto-fresh caches (no stale `.ois/tool-catalog.json` / plugin-cache → the manual clear+restart dance becomes automatic).
  - **Clean separation of concerns:** ADAPTER (priority 1) owns CONNECTION-resilience ONLY (auto-reconnect/self-heal on a live session); HARNESS-container (priority 2) owns TOOL-SURFACE-resilience (restart re-bootstraps) + reproducibility + cache-cleanliness.
  - **Harness-containerisation = triple win:** (1) tool-surface re-bootstrap, (2) cache-cleanliness (fresh container = clean slate), (3) provenance-purity (reproducible image kills `sdkDirty`).
  - **idea-391 (CLI→Hub REST) DE-SCOPED** from tool-surface-resilience → separate/optional track, not a dependency.
  - **Dependency: harness-restarts ⟂ cold-pickup quality.** A restart drops in-session context → the agent re-hydrates from durable state (memory-anchor pattern). VALIDATED this session: the SR run survived 2 restarts + a Hub-disconnect via cold-pickup. The restart-strategy rests on this substrate (already solid).
  - **Adapter resilience scope NARROWS to connection-resilience** → simpler adapter design (no hot-reload).

- **2026-06-29 (Director) — direction: CONTAINERISATION; claude-code CLI FIRST.** Containerisation SUBSUMES the distribution/update option-axes — the harness IMAGE becomes the single unit for distribution + update + tool-surface-refresh + reproducibility + cache-reset; **npm is just the SOURCE baked in.** So the big forks (npm vs marketplace vs dir-source; reinstall vs rebuild vs hot-reload) are RESOLVED by the container direction; only narrow instance-decisions remain.
  - **PLAN — design-for-both, build-claude-first:**
    - UP-FRONT DESIGN (generalizable spine, designed for BOTH harnesses so opencode is a drop-in — protects maximal-shared-core): kernel/shim split + npm packaging + a UNIFORM register-SPI + the image spec.
    - PHASE 1 — claude-code CLI container PILOT (worst-pain harness: bug-203 + the wedge). Acceptance: auto-reconnect (no silent wedge) · restart re-bootstraps tool-surface · reproducible image (no `sdkDirty`) · version-honest.
    - PHASE 2 — opencode drop-in (2nd thin shim over the same kernel + register-SPI) → PROVES uniformity + shared-core.
    - PHASE 3 — automate (CI publish npm + build image; watchtower-pull + restart).
  - **Narrow remaining decisions (claude-first):** (i) claude's register mechanism in-image (the (a)/(b), scoped to claude); (ii) image contents (claude-code + adapter + git + creds + repo-access); (iii) ephemerality model (disposable container; state via Hub+git+memory cold-pickup — PROVEN this session); (iv) update-trigger (watchtower-pull vs CI-push vs manual-first).
  - **METHODOLOGY:** graduate this brainstorm → a formal Idea (anchors the infra backlog-gap the SR flagged) + a Design (this doc), claude-code pilot = first mission-slice.

## Prior art — GoogleCloudPlatform/scion (Director-provided, 2026-06-29) — INSPIRATION not verbatim
SCION = experimental multi-agent orchestration testbed for "deep agents" (Claude Code / Gemini CLI / …): **container-per-agent + own git-worktree + own credentials**; runs local / VM / k8s; "less is more" — agents *invoke a CLI tool* + coordinate via NL (group/direct messaging + shared workspace); telemetry from messages + file-access. (scion = "a shoot cut for grafting" — apt.)
- **Differentiator confirmed (Director's hypothesis):** scion coordination is PULL (agent-invoked CLI tool); NO first-class network that PUSHES/injects messages into the harness. OUR core = the Hub *pushes* coordination into the live session. **FRAME: graft scion's container-deployment shell onto our push-injection coordination core.**
- **ADOPT (deployment shell):** container-per-agent + worktree + creds · off-the-shelf-harness wrapping · ENV/config-driven boot · multi-runtime (local/VM/k8s) · message/file telemetry.
- **ADAPT:** their agent-invoked coordination CLI → our pushed message-injection (kept alive + resilient in-container by the adapter-kernel, P1).
- **AVOID:** their "less-is-more / models freely coordinate" philosophy — we keep structured roles/RACI/work-queue-FSM/gates/teles.
- **DEEP-READ DONE (8-agent audit w2bjaeug5, 2026-06-29)** → next section. Full structured findings archived at `docs/designs/m-adapter-modernization-scion-audit.json` (headline/adopt/adapt/avoid/per-decision/divergences/open-questions). Decision-areas keyed D-img/D-boot/D-run/D-tmux/D-plugin/D-creds/D-coord.

## scion deep-audit — adopt / adapt / avoid (w2bjaeug5, 2026-06-29) — INSPIRATION not verbatim
8-agent seed-blueprint audit of scion internals (916k tokens; 7 area-auditors + synthesizer). Full JSON: `m-adapter-modernization-scion-audit.json`. The load-bearing distillation:

### The two biggest results
1. **STRONGEST VALIDATION — scion's 3-tier image cascade IS our fat-kernel/thin-shim in Docker layers.** OS+toolchain base (rarely changes) → org layer that multi-stage-BAKES the shared binary + sets a **PID-1 ENTRYPOINT** → a *tiny* per-harness leaf that only installs ONE agent CLI + sets CMD (their gemini leaf = 14 lines; claude leaf = a single `npm install`). One image per harness-TYPE; per-agent diffs (UID/creds/worktree) injected at **runtime, never baked**. This is our agreed architecture, already proven in someone else's Docker layers. **Map our layers straight onto it.**
2. **HIGHEST-VALUE NEGATIVE RESULT — scion BUILT then RIPPED OUT go-plugin RPC harness plugins.** Their verdict (`.design/decoupled-harness-implementation.md`): *"provisioning is a scripting problem, not a systems programming problem"* — go-plugin is "heavyweight… overkill for file-writing provisioning logic." Maps 1:1 to our shim decision: **our per-harness shim must be a declarative manifest + thin module, NEVER process-isolation RPC.** A wrong path we now skip for free.

### The four divergences that CONFIRM our differentiators (scion does the opposite of each pillar)
- **Kernel-owned injection (pillar-1):** scion injection is HOST-EXTERNAL — the orchestrator execs `tmux send-keys` into the live pane per message, **NO consumption ack**, papered with "300ms double-Enter to ensure input is accepted" + 2s debounce (`manager.go:316-321`). Coordination liveness is coupled to orchestrator exec-access → a blip wedges delivery, nothing self-heals. **OUR kernel-in-container owns injection with a real submit/ack + ordered queue → pushed messages survive blips by construction.** Net-new; nothing to reuse.
- **In-system self-heal (pure-resilience):** scion has NONE — k8s `RestartPolicyNever` (`k8s_runtime.go:1240`), no Restart verb (restart = Delete+Run by orchestrator code), heartbeat **reports-only**. **We put resilience INTO the system: kernel self-restart and/or native supervision + lease-expiry reclaim.**
- **Pin-everything reproducibility (no-drift):** scion has the right STRUCTURE (dual-tag :latest + :sha, immutable :sha as BASE_IMAGE, ldflags-stamp, multi-stage, content-hashed bundles) but **floats nearly everything to `latest` — claude has NO pin at all.** A rebuild of the same git SHA can yield different binaries. **Adopt the structure, then PIN EVERY dep + digest-pin bases.**
- **Structured-hook telemetry (not screen-scraping):** scion's telemetry is genuinely strong and reusable — a thin data-driven per-harness **dialect** (YAML event-name + dotted-path) → ONE OTEL `gen_ai.*` pipeline + baked-in field-redaction + file-touch swarm signal. **A new harness = a dialect file, not pipeline code.** (This is our shim/kernel split applied to observability.) Observe via hook-events, **never screen-scrape** the pane.

### ADOPT wholesale (proven, maps clean)
- **tmux model** — mandatory uniform detached session across all runtimes; fixed name; two-window (agent+shell); `new-session -d` then attach; attach/exec ALWAYS as session-owner; harness-exit-to-file wrapper + pane-exited→kill-session teardown; capture-pane as a *snapshot only*; SPDY-API PTY (no kubectl in-image). Treat tmux as **non-durable** (dies with the container; persist in volume/Hub).
- **Narrow Runtime seam** — ~12-verb interface + one config struct + factory(autodetect)+null-object + ALL shared logic in one helper, each backend a thin wrapper.
- **Thin-wrapper-over-declarative-manifest** per-harness adapter + a typed **3-valued capability matrix** (yes/partial/no + reason) so callers gate gracefully (harnesses genuinely differ — e.g. Claude has no model-end hook; OpenCode downgrades the system prompt into AGENTS.md).
- **ENV-injection as the single config contract** (identical across backends); **FAIL-CLOSED boot** (ValidateAuth before launch — serves no-silent-wedge).
- **Harness-agnostic 4-stage cred pipeline** (gather→overlay→resolve→fail-closed-validate) as a shared-kernel resolver; **token-from-FILE not env** (0600 atomic rename, env var deleted) + kernel-owned proactive refresh → long session survives cred churn with no restart.
- **Defense-by-ABSENCE isolation** (UID==host-UID makes chmod worthless); content-addressed config + MANDATORY hash verify; secret materialization at entrypoint (write 0600 BEFORE any process runs).
- **Build provenance** ldflags-stamp (kernel version+SHA self-reported by the running container); dual-tag + immutable-:sha-as-BASE_IMAGE; secret-safe `.dockerignore`; pre-chowned runtime dirs; lean minimal base.

### ADAPT (right shape, our ownership)
- **INVERT the baked-vs-mounted boundary:** scion bakes the CLI but *mounts* the provisioner (redeploy-without-rebuild). **We BAKE the @apnex kernel** (npm-as-source baked, so push-injection survival never depends on a runtime fetch); only per-agent ENV/creds external; update = rebuild + restart.
- **Centralize the pre-start provision contract in the KERNEL** (one impl) instead of N per-harness Python scripts; keep the "pre-start hook prepares native config + selects auth + fails closed" shape, but the shim is a JS/TS module/manifest.
- **Message-injection mechanics** (keep bracketed-paste so TUIs don't eat chars; harness-specific interrupt key) but **our kernel owns delivery** with explicit submit/ack — replacing the external exec + blind-timer debounce.
- **Heartbeat → kernel self-reporting inside a self-healing loop** (detect wedge → reconnect/restart); adopt the **sticky liveness FSM** (waiting_for_input/completed resist clobber by trailing tool events) to fix our known **false-idle reads**.
- **Per-agent worktree over a shared base .git** — but ALWAYS create host-side then mount (NEVER in-container: `--relative-paths` path-identity corruption); refcounted sharer registry for last-sharer teardown.
- **NET-NEW option:** since we HAVE a push channel, consider PULLING creds over it — eliminates the env-blob inspect/`/proc` exposure window scion accepts.

### AVOID (their explicit mistakes / anti-pillar choices)
- Floating `latest`/unpinned deps (the no-drift hole). · go-plugin/RPC for the adapter. · Compiling per-harness-varying logic into the shared binary (the **"dialect trap"** — forced kernel+image rebuild per new harness). · The whole scion coordination shape (pull + host-external no-ack injection + screen-scraping + closed 5-value status enum as the entire semantic surface — semantics live in the LLM's head). · One-shot pods + report-only heartbeat. · Exposing a half-built host-type (their CloudRunRuntime is an unimplemented stub). · Gratuitous per-runtime duplication (their podman = "duplicate from Docker"). · Live in-container file mutation as the update path. · Ephemeral state that doesn't survive restart (their Hub SQLite on /tmp — our postgres substrate already avoids this).

### Open design questions surfaced by the audit (next brainstorm fuel)
1. **Resilience authority (D-run):** self-heal in the kernel, platform-native (k8s/systemd/watchtower), or both layered — and how does it interact with our lease-expiry stall-detector so the two don't fight?
2. **Cross-harness target scope (D-plugin):** claude-only first, or claude+opencode+gemini+codex? Decides whether we need the full dialect + capability-matrix machinery now or can defer.
3. **Shim form/language (D-plugin):** declarative manifest ONLY, or manifest + a thin JS/TS adapter module loaded by the kernel? How much in data vs code?
4. **Secret transport (D-creds/D-coord):** PULL creds over the live push channel vs file-mount vs staged-env-blob?
5. **Tool-surface ↔ push relationship (D-plugin/D-coord):** is our tool surface an MCP server the kernel hosts, and how does push-injection relate to the harness MCP/tool plumbing without colliding with TUI input?
6. **Runtime target set + sequencing (D-run):** minimum viable FULLY-implemented host-type set (local + VM first?); commit to k8s/cloudrun later?
7. **Observability transport (D-tmux/D-coord):** ride telemetry on the same reconnecting channel as push-coordination, or keep them separate? (Our own memory warns against piggybacking coordination on a lossy pipeline.)

## Image model (Director, 2026-06-29)
- **Single image per harness-TYPE** (`@apnex/claude-harness`, later `@apnex/opencode-harness`); per-AGENT (lily/greg/…) = pure ENV injection (identity/role · Hub URL+token · git creds · worktree/branch · model/quota) — NOT separate images. Reproducible + uniform + scalable (spin an agent = run the image with ENV).
- **Entrypoint script** does the uniform boot: register (register-SPI) → establish Hub connection (kernel) → start tmux → launch the CLI.
- **tmux** for the detached / re-attachable / observable long-running session (adopt from scion).
- **Message-injection (our differentiator) must survive IN the container + be resilient** → the adapter-kernel (P1 connection-resilience) keeps the pushed Hub→harness channel alive inside the containerised, tmux'd CLI. P1 (kernel) ⟂ P2 (container) interlock.

## Related entities
mission-64 (M-Adapter-Streamline; `update-adapter.sh`, the npm-model) · bug-203 (host won't re-enumerate tool-surface) · idea-392 (live auto-refresh / no-stale-caches / opencode-parity) · idea-391 (system CLI→Hub REST) · idea-390 (agent⟂project separation) · bug-184 (version-honesty) · candidate_A (the SR adapter summit) · `@apnex` npm namespace.

---
*Brainstorm log — appended as discussions progress. Becomes a formal Idea→Design once the shape settles.*
