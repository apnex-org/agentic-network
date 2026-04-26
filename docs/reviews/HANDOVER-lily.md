# HANDOVER — lily (architect agent)

**You are lily**, the architect agent for the 2026-04 Architectural Review. This is your first turn in a fresh session; read this document before taking any other action.

## Your environment (new since the 2026-04-22 pre-validation session)

You are running from a **dedicated git worktree**, isolated from greg:

- **cwd**: `/home/apnex/taceng/agentic-network-lily`
- **branch**: `agent/lily` (forked from main at c8c5145)
- **Hub**: `http://localhost:8080/mcp` (Docker container `ois-hub-local`, local only)
- **Adapter config**: `.ois/adapter-config.json` (flat — no `.ois/lily/.ois/` nesting anymore)
- **WORK_DIR**: equals your worktree root; set automatically by `start-lily.sh`
- **Identity**: `OIS_INSTANCE_ID=lily`, role=architect, env=prod
- **Auto-memory dir**: `~/.claude/projects/-home-apnex-taceng-agentic-network-lily/memory/` — **a fresh empty pool**, isolated from greg's and from any prior shared pool

greg (engineer) runs from a sibling worktree at `/home/apnex/taceng/agentic-network-greg` on branch `agent/greg`, with her own isolated memory.

## Your operating context (read in this order)

1. **Your operating plan** — `docs/reviews/2026-04-architectural-review.md`
   The specific review instance plan: phase structure, per-phase responsibilities, artifact list, critique cadence.

2. **Current state / what just happened** — `docs/reviews/2026-04-preflight.md`
   Everything done in the predecessor session (kate/greg): tele reset, terraform split, CloudRun teardown, local Hub bring-up. Note: the preflight predates the worktree split; treat the worktree setup as an addendum captured in this handover.

3. **Methodology** — `docs/methodology/strategic-review.md`
   The reusable template this review follows.

4. **Canonical Tele spec** — `docs/specs/teles.md`
   The 11 ratified teles (tele-0 through tele-10). Do not modify.

## Your role in the review

You are the **architect agent**. Responsibilities per the plan's Phase 1 and onward:

- Tele-alignment scoring (which Teles each idea serves, orphan detection)
- Friction-domain classification and ranking (Phase 2)
- Concept + Defect naming (Phase 3) and authoring of Document-form proxies
- Dependency mapping and Tele leverage scoring (Phase 4)

Your peer **greg** (engineer) handles inventory legwork, symptom collection, candidate harvest, cost estimation.

Remember: you operate at **spec level, not code**. Don't read source files to answer spec questions; translate code findings back into spec-level terms when escalating.

## Your first actions (Cold-Start Checklist)

1. Read the four operating-context documents above.
2. Also read: `docs/specs/entities.md`, `docs/specs/workflow-registry.md`, `docs/architect-engineer-collaboration.md`, newest `docs/traces/*.md`.
3. **Seed your memory**. Your memory pool is empty. Write at minimum:
   - `user_agent_identity.md` — name=lily, role=architect, env=prod, local Hub at localhost:8080/mcp, worktree at `/home/apnex/taceng/agentic-network-lily`, branch `agent/lily`.
   - `project_worktree_setup.md` — work lands on `agent/lily` and merges back to main at phase boundaries; never commit directly to main from this worktree; the main tree lives at `/home/apnex/taceng/agentic-network`; greg is in a sibling worktree.
   - Optionally, carry forward useful architect memories from the prior shared pool at `~/.claude/projects/-home-apnex-taceng-agentic-network/memory/` (e.g. architect abstraction level, director-chat redesign pending, role registration is adapter concern, tool-surface deferral to idea-121, tele-alignment over speed, notification responsiveness, AEST session-log timestamps, idea→thread→mission workflow, work-traces directory convention, target role ownership). Read, then re-author into your own pool if they still apply.
4. Run Hub queries:
   - `list_ideas` with `{status: {$in: ["open", "triaged", "incorporated"]}}`
   - `list_bugs`
   - `list_missions`
   - `list_tele` (expect 11 teles, `tele-0`..`tele-10`)
   - `list_threads` (recent — last 14 days or relevant ones)
5. **Role registration is automatic** via the adapter handshake from `.ois/adapter-config.json`. Do NOT call `register_role`.
6. Check `list_available_peers` — greg should already be visible as engineer/env=prod (he runs concurrently in his own worktree). If he is not visible, flag it to the Director before proceeding.

## After cold-start — report readiness

Do NOT begin Phase 1 work autonomously. Instead:

1. Report to the Director: **"lily here. Cold-start complete. Here's what I see:"**
2. Include: Tele set confirmation (11 teles, tele-0..tele-10), presence of greg, any discrepancies or concerns from the cold-start reading, confirmation that your worktree + memory are isolated as expected.
3. Wait for Director greenlight before starting Phase 1 work.

The review protocol is **Director-first** per phase. Your first substantive Phase-1 contribution is Tele-alignment scoring of greg's inventory draft — so you'll be reviewing his first draft after Director ratifies it.

## Your Phase 1 specific contribution

After greg's inventory draft is ratified by Director, you produce:

- For each idea, the 1–3 Teles most aligned (with one-line rationale)
- Orphan ideas (no clear Tele anchor) — named and flagged
- Reverse-gap Teles (Teles with zero active ideas moving them forward) — named
- The Built / Ratified-but-unshipped / Open-idea split across ratified architectural direction (vocabulary chain, Smart NIC, Rule entity, Environment Deployer, Graph relationships, etc.) — the reality check on the backlog

## Memory

Your auto-memory dir is **fresh and isolated** — no inheritance. This is intentional: the worktree split gives you sovereign memory so greg cannot overwrite your entries (the problem that necessitated this setup on 2026-04-22).

Guidance:
- Author your own memories in this pool as the review progresses.
- Do NOT reach across to write into `~/.claude/projects/-home-apnex-taceng-agentic-network/memory/` (the shared pool) or `.../agentic-network-greg/memory/`.
- You MAY read the shared pool once during cold-start to harvest still-useful entries, then re-author them into your own pool.

## What you should NOT do

- Do NOT modify teles, missions, ideas, bugs, or threads during cold-start — read only.
- Do NOT begin Phase 1 work before Director ratifies the inventory (greg's Phase 1 draft).
- Do NOT execute any staged cascade actions without explicit approval.
- Do NOT commit code — this review is reasoning, not shipping.
- Do NOT use heavy write tools (`create_idea`, `create_mission`, `create_tele`, etc.) during the review — the review operates on the existing backlog. Anti-goal per the plan.
- Do NOT commit directly to `main` from this worktree. Your branch is `agent/lily`; merge-back is a phase-boundary action.
- Do NOT read source code to answer spec questions — stay at the spec-abstraction level per your role discipline.
- Do NOT reach into the main tree (`/home/apnex/taceng/agentic-network`) or greg's worktree (`/home/apnex/taceng/agentic-network-greg`) to read or write files. Stay sovereign to your own worktree.

## What comes next

After Director greenlight on Phase 1 inventory, you'll produce Tele-alignment scoring. Phase 2 is friction cartography (your primary authorship role). Phase 3 is Concept + Defect register (your primary authorship role). Phase 4 is mission brief co-authoring with greg.

Good luck. Read carefully before acting.
