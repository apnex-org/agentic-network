# Work-Trace — Adapter-Modernization Pilot P1e-1 (work-103, the env-independent slice)

**Task:** `work-103` (engineer: greg / `agent-0d2c690e`) — P1e-1, the ENV-INDEPENDENT slice of Design §9 P1e (split from `p1e_containerise` = P1e-2, the runtime-bound live e2e).
**Provenance pin:** **idea-398** → Design v1.0 **@36fd8a2** (has the §9 dep-prune amendment + F1/F2 folds). Director-direct.
**Branch:** `agent-greg/adapter-p1e1-supervisor` (off `origin/main`, which has P1a #435 + P1c #436 merged).
**Why split:** local docker 20.10.3 core-dumps node images → the real docker-L2 restart e2e is runtime-bound (P1e-2, on lily's provisioned surface). ~90% of P1e is env-independent and ships now.

## Evidence (4): ev_seam_consume + ev_compose_authored + ev_dep_prune_repro + ev_runbooks. A1-A8.

## ⚠ Convention edge (I own holding it)
P1e-2 (`p1e_containerise`) depends on this slice by CONVENTION, not a graph edge (lily couldn't block_work an unclaimed/ready node — bug-205 family). The queue shows `p1e_containerise` as ready. **I will NOT claim it until (1) work-103 lands AND (2) lily signals the runtime is provisioned.**

## Log
- **00:19Z** — claimed + started work-103. Keystone authored (cleared-to-start-in-parallel): `deploy/adapter-image/supervisor.mjs` — the thin PID-1 CONSUME-half (watchFile /run/adapter-wedged → SIGTERM child [grace] → exit 75; §6 SIGTERM-from-docker → clean exit 0). Thin by design (no kernel import); contract constants parity-asserted against P1c.
- **00:21Z** — **ev_seam_consume GREEN (3/3)**: `packages/network-adapter/test/integration/supervisor-seam.test.ts` — PARITY (SUPERVISOR_EXIT_CODE===WEDGED_RESTART_EXIT_CODE 75 + sentinel default; drift fails CI, tele-4) + sentinel→exit-75 + clean-SIGTERM→exit-0. Env-independent (spawns the supervisor as a real process; NO docker). (Fixed a `?? .. ||` paren syntax error first.)
- **next** — A3 docker-compose (ev_compose_authored) + A4 dep-prune Dockerfile + Cloud-Build repro/cred-free verify (ev_dep_prune_repro) + A5-A7 runbooks (ev_runbooks) + A8 dialect-nit fold (needs P1b in main; folds on rebase).
