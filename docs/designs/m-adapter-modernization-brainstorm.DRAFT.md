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
- **NEXT:** deep-read scion internals (Dockerfile/entrypoint · config+creds+worktree injection · server/runtime + restart handling · tmux/session mechanics) → concrete adopt/adapt/avoid vs our open instance-decisions.

## Image model (Director, 2026-06-29)
- **Single image per harness-TYPE** (`@apnex/claude-harness`, later `@apnex/opencode-harness`); per-AGENT (lily/greg/…) = pure ENV injection (identity/role · Hub URL+token · git creds · worktree/branch · model/quota) — NOT separate images. Reproducible + uniform + scalable (spin an agent = run the image with ENV).
- **Entrypoint script** does the uniform boot: register (register-SPI) → establish Hub connection (kernel) → start tmux → launch the CLI.
- **tmux** for the detached / re-attachable / observable long-running session (adopt from scion).
- **Message-injection (our differentiator) must survive IN the container + be resilient** → the adapter-kernel (P1 connection-resilience) keeps the pushed Hub→harness channel alive inside the containerised, tmux'd CLI. P1 (kernel) ⟂ P2 (container) interlock.

## Related entities
mission-64 (M-Adapter-Streamline; `update-adapter.sh`, the npm-model) · bug-203 (host won't re-enumerate tool-surface) · idea-392 (live auto-refresh / no-stale-caches / opencode-parity) · idea-391 (system CLI→Hub REST) · idea-390 (agent⟂project separation) · bug-184 (version-honesty) · candidate_A (the SR adapter summit) · `@apnex` npm namespace.

---
*Brainstorm log — appended as discussions progress. Becomes a formal Idea→Design once the shape settles.*
