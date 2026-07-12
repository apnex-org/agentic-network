# Cloud-Deploy Plugin Release Notes

**Mission:** mission-86 M-Hub-Storage-Cloud-Deploy (W5)
**Audience:** operator tracking `m-github-releases-plugin-distribution` releases
**Distribution:** `gh release` on `apnex-org/agentic-network` (HISTORICAL — see banner)

> **npmdeliver0 (idea-492, 2026-07-11): the current claude-plugin install path is npm** —
> `npm install -g @apnex/claude-plugin` (see `adapters/claude-plugin/QUICKSTART.md`).
> Channel-2 (the `gh release` vendored tarball built by `release-plugin.yml`) is RETIRED;
> the dated entries below are a historical record of that channel.

---

## v0.1.4 — 2026-05-21

First real `m-github-releases-plugin-distribution` release — prior pipeline runs cut
`v0.0.0-test` tags only. Built from `main @ 359738f` (`release-plugin.yml` run
`26197827376`).

- Carries the **bug-103 adapter-half**: `firstTimerEnabled` poll-backstop +
  adapter reconnect-hook (kind:note delivery-recovery, mechanism D).
- Carries the **bug-106 fix**: `INTERNAL_CALL_TAG` / `isInternalCall` in the
  cognitive layer.
- Bundles the three sovereign tarballs: `@apnex/network-adapter`,
  `@apnex/cognitive-layer`, `@apnex/message-router`.

Operator reinstall (per session, restart after) — **⚠ RETIRED Channel-2 recipe — historical only.** The current operator path is `npm install -g @apnex/claude-plugin` then the npm-installed `install.sh` (see the banner at the top + `adapters/claude-plugin/QUICKSTART.md`, or `scripts/operator/update-claude-plugin.sh`). The `gh release download` recipe below no longer works — npmdeliver0 deleted the Channel-2 producer:

```
gh release download v0.1.4 --repo apnex-org/agentic-network --pattern 'apnex-claude-plugin-*.tgz'
tar xzf apnex-claude-plugin-*.tgz && bash package/install.sh
```
