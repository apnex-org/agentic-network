# ois — the operator CLI

`ois` is the Director's operator surface for the agentic network: fleet
lifecycle (`launch` / `up` / `attach` / `down` / `ps` / `doctor`), durable
Director messaging (`say`), and — since mission-102 — the **decision surface**:

| verb | what it does |
|------|--------------|
| `ois decisions [status]` | the Director's routed decision queue (default `routed`) |
| `ois show <decision-id>` | full render-before-confirm: options, routing, resolution, plan |
| `ois confirm <decision-N\|dconf-N> <answer>` | answers through the B4 proof path (`capture_director_signal`, authenticated director identity) |

Every hub-touching verb registers the **director messaging identity**
(`role:director, name:apnex`) before acting, so Director-originated signals
carry authenticated provenance — the B4 rail refuses unregistered captures by
design.

## Why a first-class directory (Director-ratified, 2026-07-05)

This directory is the seed of the design's deferred **S2.1 standalone Director
surface** (M-Director-Interface, constraint #4: presentation-agnostic
payloads). `confirm` / `decisions` / `show` are its first three verbs — they
render hub verb outputs verbatim and send answers back raw, the same
zero-transformation contract the SC5 CLI spike (contract test in
`hub/src/policy/__tests__/decision-cli-contract.test.ts`) regression-checks.
As the Director surface grows beyond the fleet launcher, it grows here.

## Deployment contract

- **`ois/bin/ois` in this repo is the SOURCE OF TRUTH.** Patches land here
  first, through a verifier-gated PR.
- The live copy runs at `~/.config/apnex-agents/bin/ois` on the Director's
  workstation. Deploy with `ois/deploy.sh` (takes a pre-overwrite backup).
- The workstation's `~/.config/apnex-agents` repo stays **remote-less by
  design** — it sits adjacent to `secrets/`; adding a remote there is a
  Director-rail decision, not a self-disposal.
- Config/secrets/state layout (`config/fleet.json`, `secrets/<ref>`,
  `state/<agent>/`) is documented in the script header and lives only on the
  workstation.
