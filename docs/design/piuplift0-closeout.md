# piuplift0 closeout

Date: 2026-07-15  
Arc: `work-bp-piuplift0-arc_driver` / `idea-534`

## Result

`piuplift0` is complete. The PI harness uplift/parity arc closed with all 19 child WorkItems done and the arc completion gate open.

The fleet is now on PI for the active seats that were in scope:

- `greg/pi` live on GPT-5.5.
- `lily/pi` live on GPT-5.5.
- `steve/pi` controlled reset/relaunch completed after verifier work terminalized.
- `mp0bn` remained dormant/untouched.

## Delivered

- P0 correctness: PI raw tool naming / prefix fossil issue fixed and verified.
- P1 structural uplift: PI skills seeding/export and HCAP skills path completed with non-self gate.
- P2 robustness: PI liveness/eager-claim/facade/cognitive coverage completed with non-self gate.
- P3 hygiene: PI package-integrity test added, PR #615 merged, and `@apnex/pi-plugin@0.1.7` published through the GitHub CI tag path.
- Fleet config: PI config source-of-truth is under repo `config/` and live `/home/apnex/.config/apnex-agents/config/`; OIS renders/materializes.
- Visual/tmux parity: Greg-first live observations verified PI footer/status and tmux viewport artifact fix; Steve reset later picked up the per-seat PI launch path.
- Backport/deferred lists: produced at `docs/design/piuplift0-backport-and-deferred.md`.
- Standing verifier backstop: completed cleanly with no owner-credential, external-repo, destructive, or scope-creep breach.
- Controlled Steve relaunch: completed only after `p3_vg` and `backstop` were terminal.

## Key evidence

- PR #611: explicit PI model config / `bug-271`, merged at `8a0eafa`.
- PR #612: safe `list_work` defaults / `bug-269`, merged at `866c59b`.
- PR #613: PI fleet config/footer/status work / `bug-272`, merged at `669dc0b8f1aed413141eb2bc7c0b03ce786f4414`.
- PR #614: tmux viewport/status sizing / `bug-273`, merged at `7a8d639c1cfd3e1ef916ccb8343308372bbf1f8d`.
- PR #615: P3 package-integrity and PI plugin 0.1.7 bump, merged at `ed0c7bb2954dc1b8e9b80ea5bba496b794efc051`.
- npm publish: tag `npm-v0.1.7` peeled to `ed0c7bb2954dc1b8e9b80ea5bba496b794efc051`; `publish-npm` run `29390741964` succeeded; registry reports `@apnex/pi-plugin@0.1.7`.
- P3 verifier gate: `work-bp-piuplift0-p3_vg` done with Steve PASS attestation and `verify_attestation valid:true`.
- Backport/deferred artifact: `docs/design/piuplift0-backport-and-deferred.md`.
- Steve relaunch evidence: `work-225` done; Hub projection showed Steve online/idle on `@apnex/network-adapter@0.1.13`, `@apnex/pi-plugin@0.1.7`, clean/undirty, `proxyCommitSha ed0c7bb`.

## Scope discipline

The arc followed the Director’s “improve, do not photocopy” directive:

- Improvements were bounded to small+related slices.
- Transport-native PI divergences were preserved rather than wrongly ported: HubSpecSource latch, wake.ts/native wake path, no stdio, and raw tool naming.
- Broader distribution/mechanization/supervisor/OpenCode work was routed to follow-ups instead of hidden in the closeout.

## Follow-ups routed

- `idea-535`: PI npm-distribution north-star.
- `idea-536`: mechanize npm release path / CI tag helper and evidence output.
- `idea-537`: OpenCode harness overhaul/parity cleanup.
- `idea-538`: git-push/release-path hook.
- `idea-539`: container-supervisor LivenessWatchdog redesign.
- `bug-270`: PI footer model affordance polish remains separate.

## Operational notes

The npm publish miss was corrected by using the established CI tag path. The structural lesson is captured in `docs/planning/npm-publish-mechanization-plan.md` and `idea-536`: release operations should be mechanized so agents reason from commands/runbooks/evidence contracts rather than memory or local credentials.
