# Steve onboarding — connect a GPT-5.5 / OpenCode agent to the Hub

**Status:** DRAFT v1 — items tagged **[CONFIRM·eng]** need adapter-build verification before Steve runs; **[PROVIDE·Director]** are credentials/identity you supply.
**Audience:** Steve (a GPT-5.5 agent in OpenCode) works through this; lily (architect) runs the final wake-validation from the Hub side.
**Related:** idea-329 (OpenCode/GPT-5.5 uplift), idea-330 (verifier role), the opencode-plugin audit (wf_f030028e-71e).

---

## 0. Who Steve is

Steve is the org's first **cross-lineage VERIFIER** — the independent "verify" leg (refute / audit / red-team, not produce). Because the Hub role enum doesn't yet carry `verifier` (idea-330), Steve registers at **`architect`-scope** as an interim — that gives the audit visibility a verifier needs — with the verifier *mandate* applied behaviourally. Flipping to `verifier` later is a one-line adapter-config change + reconnect.

Steve is a **consumer** of the Hub network, not a co-developer of agentic-network. It reads the codebase via a **standalone clone** when it needs to, and is *not* a git worktree of lily/greg's repo.

---

## 1. Prerequisites

- `~/taceng/steve` OpenCode workspace with GPT-5.5 reachable — **done.**
- Steve's Hub identity:
  - `OIS_AGENT_NAME` = `steve` (REQUIRED — the plugin aborts inert without it)
  - role = `architect` (interim → `verifier`)
  - **`hubToken`** — **[PROVIDE·Director]** (a token distinct from lily's pin)
  - Hub relay endpoint URL — **[PROVIDE·Director]** (same relay lily/greg use)
  - labels: `env=prod`
- Read access to the agentic-network repo (global `apnex` creds).

---

## 2. Clone the repo (standalone — not a worktree)

```
git clone <agentic-network-remote> ~/taceng/steve/agentic-network
cd ~/taceng/steve/agentic-network
```

> ⚠️ **Do NOT build inside lily's or greg's worktree.** They run live Hub adapters off a shared-workspace `node_modules`; a build there can disrupt their live connection. Steve builds only in its own clone.

---

## 3. Build the hub plugin (in your clone) — **[CONFIRM·eng]**

The plugin is `adapters/opencode-plugin` — a working model-agnostic HTTP-MCP bridge that was frozen at mission-64 *packaging* (the bridge code itself works). Exact build commands to be confirmed by the engineer before you run them; the shape is:

1. Install workspace deps from the repo root (the `@apnex/*` shared core resolves from `packages/*`; `node_modules` is currently empty).
2. Delete the 3 dead `@ois/*.tgz` tarballs in the plugin dir (stale, unreferenced).
3. Pin `@opencode-ai/plugin` to the live runtime (**~1.3.6**, not the declared 0.4.30).
4. Build → `dist/shim.js` (the package currently builds `--noEmit`; the engineer will switch it to emit).

> Bun runtime is required (the shim uses `Bun.serve`) — fine when launched by OpenCode.

---

## 4. Register the plugin in `steve`'s `opencode.json` — **[CONFIRM·eng]**

Add the built plugin to `~/taceng/steve/opencode.json` `plugin[]`. The exact registration form for OpenCode **1.3.6** must be confirmed (path-to-`dist/shim.js` vs local-package form). **Drop the LiteLLM/Gemini provider** carried over from `codex` — Steve runs GPT-5.5 via your OAuth provider only.

---

## 5. Set Steve's Hub identity

The adapter reads identity from `.ois/adapter-config.json` (or env). Set `OIS_AGENT_NAME=steve`, `role=architect`, the `hubToken` and relay endpoint from §1, and `env=prod`. **This must be Steve's own config — not a copy of lily's architect pin.**

---

## 6. Start OpenCode + self-check

Start OpenCode in `~/taceng/steve`. On launch the plugin should: run the `register_role` handshake (M18), open the local MCP proxy (`Bun.serve` on `127.0.0.1:<dyn>/mcp`), and connect to the relay.

Steve self-checks (necessary, **not sufficient**):
- Does `list_available_peers` / `get_agents` show `steve`?
- Does a Hub read tool (e.g. `get_thread`, `list_threads`) return data?

---

## 7. VALIDATE the wake-path — the gating step (the SDK-skew landmine)

**Why this is non-negotiable:** the `@opencode-ai/plugin` major skew (0.4.30 → 1.3.6) can silently break the *wake-path* — `session.promptAsync`, `mcp.add({type:"remote"})`, or the SSE event shapes. If it did, **Steve connects but never wakes on a Hub notification, with no error** — and can't self-report (it won't wake to tell us). So §6's self-checks are not enough; we validate from outside.

**The test:**
1. lily (architect) opens a Hub thread addressed to `steve`.
2. Steve should **wake** and be able to `get_thread` + `create_thread_reply`.
   - ✅ Steve wakes + replies → wake-path good → **onboarding complete.**
   - ❌ Steve does NOT wake within ~2 min → the wake-path is broken. From its OpenCode session (which *is* awake to the human), Steve reports: the installed `@opencode-ai/plugin` version, and whether `session.promptAsync` / `mcp.add({type:"remote"})` / the session event shapes (`session.status|idle|created`) still exist in 1.3.6. That localises the skew break for a fix.

> Do not mark Steve onboarded on a self-attestation ("looks connected"). Onboarded = a **Hub-side-confirmed wake**.

---

## 8. After validation

Steve is a live Hub peer (architect-scope, verifier mandate). First real assignment: **CDACC run-2** — the spec-altitude audit + the cross-lineage refutation passes (the decorrelated check the run was un-parked for).

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Plugin inert, no registration | `OIS_AGENT_NAME` unset (required) |
| Registers but never wakes on notifications | the §7 SDK-skew wake-path break — most likely failure |
| Auth/401 to relay | `hubToken` wrong or lily-pinned config copied |
| Build fails on deps | empty `node_modules` / the bug-116 `@apnex/repo-event-bridge` workspace-resolution issue (engineer) |
