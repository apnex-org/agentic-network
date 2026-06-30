# Work-trace — M-Real-CLI-Harness n4 (connect + ready-for-work)

**Node:** `work-bp-real_cli_harness_20260630-n4_connect_ready_for_work` (engineer; arc idea-405). **Evidence:** `ev_engineer_ready` (test-run). **Branch:** `agent-greg/real-cli-n4-ready` off main.
**Lease token (full):** `7e45dc2b-7c35-41d9-a654-ff592d670e58` (renew with the FULL token, not the prefix).

## Goal (the marquee — the behavioral net-new)
The pilot (idea-398) had NO real LLM. n4 proves a **real `claude` CLI** reliably **ACTS** on an injected `work_claimable_digest`:
- **(a) connect-as-engineer:** the kernel handshake `register_role(engineer)` fires (config-driven, reused verbatim); `get_agents` shows **the container** as a role=engineer agent.
- **(b) ready-for-work:** the idea-353 self-wake (heartbeat → `list_ready_work` → `work_claimable_digest` injected via `notifications/claude/channel`) drives the REAL CLI through `claim_work → start_work → execute → complete_work + renew_lease` on a **SEEDED** trivial item, **ZERO human**.
- **BOOTSTRAP-PROMPT finding (the headline):** test **unprimed FIRST** (digest action-hint alone). Add MINIMAL engineer priming (a CLAUDE.md / system-prompt) ONLY if the raw model doesn't reliably claim+execute — and **report which**. (lily brings the raw-self-drive-vs-needs-priming result to the Director.)

## Faithfulness bar — the vacuity-guard (lily, msg 01KWBF6AGJ9ADRHZBYCSXSKG43) — LOAD-BEARING
The idea-353 self-wake **DIGEST must be constructed by the REAL shim/kernel (reused verbatim)**. The test-Hub provides ONLY the work-policy **SURFACE** the real self-wake loop QUERIES (`list_ready_work`/`claim_work`/`start_work`/`complete_work`/`renew_lease`/`get_agents` + a SEEDED item). A test-Hub that **FAKES or injects the digest itself** would make the headline finding **VACUOUS** — you'd be testing the test-Hub's fake digest, not the real `self-wake → real-CLI-acts` path. So the split MUST be:
- **REAL (reused, NOT re-implemented in the test):** the heartbeat timer, the `list_ready_work` call, the `work_claimable_digest` construction, the `notifications/claude/channel` injection.
- **Test-Hub provides:** the queryable work-policy surface + a seeded engineer-claimable item. Nothing else. It must NOT short-circuit the digest.

This is THE acceptance criterion for the substrate-map (Explore): confirm the digest-construction lives in the kernel/shim (reusable), not the Hub. If the map finds it Hub-side, the test-Hub must run the REAL Hub digest logic (memory-mode), not a hand-rolled fake.

## Ratified run-shape (lily GREEN 2026-06-30, msg 01KWBF3YE1XFS8NV2A06ZM0FBN)
**Two seams, split by risk:**

### Seam 1 — LOCAL injection-RECEIPT + flag-semantics proof (low-risk, no acting)
- Throwaway HOME + `CLAUDE_CONFIG_DIR` (n3 preseed + an isolated creds-COPY) + the REAL shim via a **plain `.mcp.json`** (NO `--dangerously-load-development-channels`) + the test-Hub-with-work emitting a digest → observe `<channel>` renders in the pane.
- **`--dangerously-skip-permissions` OFF** here = no auto-acting = no autonomous Bash → can't reach the real cred/repo even with a creds-copy present. Bounded: throwaway `CLAUDE_CONFIG_DIR` (copy, not real `~/.claude`) + test-Hub (not prod).
- **HARDENING (lily):** remove-after the creds-copy via an **EXIT + ERR trap** (not a trailing `rm`) so it can't linger on any error path.
- **Why local is allowed:** the render needs the LLM authed (n1-era finding — `<channel>` only SURFACES when the LLM processes it), but auth ≠ acting; skip-permissions OFF keeps it inside the low-risk line.
- **Deliverable:** the definitive empirical flag-answer (below) + the render-seam de-risked, isolated from the container plumbing.

### Seam 2 — VM acting-confirm (the faithful `ev_engineer_ready`)
- **Why VM not throwaway-user:** `ev_engineer_ready` IS literally "get_agents shows THE CONTAINER as engineer" → acting-IN-the-container produces the faithful evidence directly + honors the Director's "container is the boundary" decision. A throwaway-user run is a non-faithful proxy I'd re-prove in the container anyway. (The local host can't sandbox it — docker 20.10.3 core-dumps node images, the whole reason the VM exists; a bare-host skip-permissions LLM as my user could reach the real `~/.claude` cred + repo via absolute-path Bash, which an "isolated dir" doesn't bound.)
- Rebuild the n5 image (claude-code@2.1.196 + the n3 preseed) via the pilot's **Cloud Build** path (local docker-run core-dumps). Supervisor child = tmux + `claude --dangerously-skip-permissions` + plain `.mcp.json`. n2 `docker-compose.sandbox.yml`. The test-Hub-with-work as the network-scoped Hub.
- lily **restarts the parked VM on my ping at step 4** (no idle VM).

## Flag-semantics capture (the Director's precise question — why does start-lily use `--dangerously-load-development-channels` if it's not required?)
**Two paths to the SAME native `<channel>` render:**
- **PLUGIN path** (start-greg/start-lily): `--dangerously-load-development-channels plugin:agent-adapter` — the flag gates **plugin-LOAD** (loading the dev-channels plugin which ships the shim MCP server). The flag has NEVER gated the render.
- **`.mcp.json` path** (the container): a plain project `.mcp.json` registers the same shim, which **declares** `experimental.claude/channel` at MCP-init (manifest `injectionChannel: "claude/channel"` → `serverCapabilitiesFromManifest`). The render is claude-code NATIVE, **capability-gated**, so it fires with **NO flag**.
- **Empirical proof = Seam 1's render-receipt** (plain `.mcp.json` + capability-declaring shim renders `<channel>`, no flag). lily closes the Director's question with this.

## Build order (no idle VM)
1. **Common test-Hub-with-work** — extend the P1e-2 standalone bundle: the full work-policy MCP surface (register_role/get_agents/list_ready_work/claim_work/start_work/complete_work/renew_lease/list_messages) + the idea-353 self-wake digest emit + a SEEDED trivial verifiable item. Needed by BOTH seams. *(Build shape gated on the substrate map — see Log.)*
2. **Seam 1 local render-receipt** → the flag-answer + render de-risk.
3. **Cloud-Build the n5 image** (claude-code@2.1.196 + preseed) — in parallel with 1-2.
4. **Ping lily for the VM restart** → **Seam 2 acting-confirm** → `complete_work` ev_engineer_ready.

## Log
- **2026-06-30 ~05:12Z** — n4 claimed + plan surfaced; lily GREEN on the whole plan (VM-for-acting airtight; local receipt inside the low-risk line + trap/cleanup hardening; flag-answer to be captured crisply; build-order good; unprimed-first stands). Lease renewed (expires ~05:27Z; full token noted above). Dispatched a read-only substrate map (Explore) of the test-Hub-with-work: does the standalone memory-mode TestHub already serve the full work-policy surface, or must I wire it; + exactly where the self-wake digest is constructed (real-shim-reused vs test-Hub-implements). Awaiting that finding to shape step 1.
