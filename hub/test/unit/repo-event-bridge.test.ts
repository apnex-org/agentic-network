/**
 * RepoEventBridge — Hub integration tests (SKIPPED).
 *
 * TODO(idea-186): Unskip when npm workspaces land.
 *
 * This file's tests import @apnex/repo-event-bridge which transitively
 * imports @apnex/storage-provider. Without npm workspaces, cross-package
 * symlink resolution from packages/repo-event-bridge/dist/cursor-store.js
 * does not reach hub/node_modules where @apnex/storage-provider is
 * installed. The 18 RepoEventBridge integration tests still run on
 * engineer-side local installs (where node_modules co-residency happens
 * to work) but fail in CI's clean-install environment.
 *
 * Sunset: when idea-186 (npm workspaces adoption) ratifies + lands, the
 * hoisted node_modules layout makes cross-package resolution natural.
 * Restore the original 18 tests + remove the stub below; CI passes.
 *
 * Background: mission-52 T3 attempted three resolution mechanisms across
 * revisions 1-3 (committed dist; prepare-script; preserveSymlinks); each
 * hit a different failure mode. Director directed Path 2 (skip + TODO)
 * 2026-04-25 ~22:35Z to ship T3 today; idea-186 is the structural fix.
 *
 * See also: idea-202 (Revisit CI value vs friction) — Director-flagged
 * at this same incident; may converge on tier-strategy that obsoletes
 * the skip even before idea-186 lands.
 *
 * Original 18-test bodies preserved in git history at PR #54 commit
 * 90998a0 (revision-2 final state). Restoration:
 *
 *     git show 90998a0:hub/test/unit/repo-event-bridge.test.ts \
 *       > hub/test/unit/repo-event-bridge.test.ts
 *
 * The stub below is a placeholder so vitest still counts this file in
 * the suite; without it, the 18 tests would silently disappear from
 * the test inventory. The describe.skip annotation makes the suspended
 * status visible in vitest output.
 *
 * NOTE on mechanism: a literal `describe.skip(...)` wrapping the live
 * test bodies does NOT work — vitest fails the file at module-load
 * time when the cursor-store.js → @apnex/storage-provider resolution
 * fails, before the describe call runs. This stub keeps the file
 * import-clean (vitest is the only import) while preserving the
 * placeholder semantic.
 */
import { describe } from "vitest";

describe.skip(
  "RepoEventBridge — Hub integration (skipped: idea-186 sunsets)",
  () => {
    // Placeholder. See TODO(idea-186) comment block above for restoration.
  },
);
