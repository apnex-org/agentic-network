/**
 * commit-pushed handler — mission-68 W1.
 *
 * First repo-event handler in the mission-68 routing substrate. Closes
 * #54 (commit-push visibility gap) for engineer-pushes-to-architect
 * direction; #55 partial closure (engineer-cadence-discipline
 * mechanization Layer (c) Hub-side; composes with adapter-side
 * Layer (b) hook in W2 + methodology Layer (a) doc fold).
 *
 * Per Design v1.0 §3:
 *   - Trigger: external-injection Message with payload.kind=repo-event
 *     + payload.subkind=commit-pushed (mission-52 RepoEventBridge emits)
 *   - Logic:
 *       1. Extract pusher (GH login) + ref (branch) + commits[] from
 *          payload.payload (the bridge's normalizePush envelope)
 *       2. lookupRoleByGhLogin(pusher) → role
 *       3. If engineer: emit kind=note + target.role=architect with
 *          terse body + structured payload sub-fields (per M2 fold)
 *       4. If architect: NO emission (architect-pushes covered by AG-7
 *          / idea-227 symmetric-coverage scope; not this mission)
 *       5. If unknown: log + skip (non-fatal)
 *
 * Body shape per M2 + #41 STRUCTURAL ANCHOR (mission-66 commit 5;
 * triggers.ts:108-119 canonical): terse `body: string` + structured
 * payload sub-fields for adapter-side `source-attribute.ts` rendering.
 */

import type { Message } from "../entities/index.js";
import type { IPolicyContext } from "./types.js";
import type { MessageDispatch, RepoEventHandler } from "./repo-event-handlers.js";
import { lookupRoleByGhLogin } from "./repo-event-author-lookup.js";

/** Strip `refs/heads/` prefix from a Git ref to get the short branch name. */
function shortBranchName(ref: unknown): string {
  if (typeof ref !== "string") return "<unknown>";
  if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
  return ref;
}

/**
 * Handler implementation. Returns 0 or 1 MessageDispatch entries —
 * 0 when push-author is architect (AG-7 skip) or unknown (log + skip);
 * 1 when push-author is engineer (synthesized note → architect).
 */
async function handleCommitPushed(
  inbound: Message,
  ctx: IPolicyContext,
): Promise<MessageDispatch[]> {
  // The bridge wraps RepoEvent under Message.payload — see
  // packages/repo-event-bridge/src/sink.ts CreateMessageSink.emit.
  // Shape: { kind: "repo-event", subkind: "commit-pushed", payload: { repo, ref, pusher, commitCount, commits } }
  const repoEvent = inbound.payload as
    | { payload?: { pusher?: unknown; ref?: unknown; commitCount?: unknown; commits?: unknown; repo?: unknown } }
    | undefined;
  const inner = repoEvent?.payload;
  if (!inner || typeof inner !== "object") {
    console.warn(
      `[repo-event-commit-pushed-handler] inbound message ${inbound.id} missing payload.payload; skipping`,
    );
    return [];
  }

  const pusher = typeof inner.pusher === "string" ? inner.pusher : null;
  if (!pusher) {
    console.warn(
      `[repo-event-commit-pushed-handler] inbound message ${inbound.id} missing pusher; skipping`,
    );
    return [];
  }

  const role = await lookupRoleByGhLogin(pusher, ctx);
  if (role === null) {
    console.warn(
      `[repo-event-commit-pushed-handler] no role mapping for gh-login=${pusher} (no agent has label ois.io/github/login=${pusher}); skipping`,
    );
    return [];
  }
  if (role !== "engineer") {
    // Architect-push or director-push: no engineer-cadence-discipline
    // alert needed (AG-7; symmetric coverage deferred to idea-227).
    return [];
  }

  const branch = shortBranchName(inner.ref);
  const commitCount =
    typeof inner.commitCount === "number" ? inner.commitCount : 0;
  const commits = Array.isArray(inner.commits) ? inner.commits : [];
  const repo = typeof inner.repo === "string" ? inner.repo : null;

  return [
    {
      kind: "note",
      target: { role: "architect" },
      delivery: "push-immediate",
      payload: {
        body: `Engineer pushed ${commitCount} commit${commitCount === 1 ? "" : "s"} to ${branch}`,
        pusher,
        branch,
        commitCount,
        commits,
        repo,
        sourceMessageId: inbound.id,
      },
      intent: "commit-push-thread-heartbeat",
    },
  ];
}

export const COMMIT_PUSHED_HANDLER: RepoEventHandler = {
  subkind: "commit-pushed",
  name: "commit_pushed_engineer_to_architect",
  handle: handleCommitPushed,
};
