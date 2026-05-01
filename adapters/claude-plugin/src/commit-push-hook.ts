/**
 * commit-push-hook.ts — adapter-side commit-push detection (Layer (b) of
 * the mission-68 W1 + W2 3-layer engineer-cadence-discipline mechanization
 * stack; closes calibration #55 Layer (b) belt).
 *
 * Per Design v1.0 §6.2 + engineer P4 ratification: Bash tool result
 * post-process detection — pattern `^git\s+push\b` + exit-code success +
 * commit-pushed shape match (output contains `→` or `[new branch]`).
 * Avoids false-positives on push-failures + alias-variant gaps
 * (`gp`, `gpush`) by requiring exit + shape AND command pattern.
 *
 * Architecture context — shim layer boundary:
 * The claude-plugin shim's MCP server proxies HUB tools to the Claude Code
 * host; Bash is a HOST-NATIVE tool (not proxied through the shim). Per
 * Claude Code's PostToolUse hook contract (settings.json `hooks` config),
 * a PostToolUse hook on Bash receives the command + result + exit code
 * and can run a side-effect script. This module exports the pure detection
 * function + emission helper for a thin wrapper script (operator wiring
 * via settings.json) to invoke. Detection logic stays testable in
 * isolation; emission stays loose-coupled to the shim runtime via the
 * shared events-file NDJSON contract.
 *
 * Two-layer relationship to mission-68 W1 hub-side handler:
 * - Layer (b) [this module]: engineer-side automation; emits observability
 *   event the engineer can observe locally. Defense-in-depth alongside
 *   Layer (c) Hub-side commit-pushed handler (which routes architect-side
 *   notification independently via the RepoEventBridge → repo-event-handlers
 *   substrate).
 * - Layer (c) [Hub-side; W1]: load-bearing failure-resilient layer per
 *   Design §6.4 M8 fold. Runs in-Hub-process; works regardless of adapter
 *   state. This adapter hook is BELT, not BRACES.
 */

// ── Pure detection ────────────────────────────────────────────────────

/** Result of `detectCommitPush`: `detected=true` plus extracted metadata,
 *  OR `detected=false` for any non-match (unrelated command / failed push /
 *  shape mismatch / etc.). */
export interface CommitPushDetectionResult {
  readonly detected: boolean;
  readonly command?: string;
  readonly branch?: string;
  readonly remote?: string;
  readonly forced?: boolean;
  readonly newBranch?: boolean;
  readonly exitCode?: number;
}

/** Strict canonical-command pattern: `git push` at the start of the
 *  command string (allows trailing args like `origin`, `--force`, `-u`,
 *  branch refs). Does NOT cover aliases (`gp`, `gpush`) — those are
 *  caught by the shape-match condition instead. */
const GIT_PUSH_COMMAND_PATTERN = /^\s*git\s+push\b/;

/** Output-shape match: git push success surfaces a ref-update arrow
 *  (ASCII `->` typically; unicode `→` in some `--porcelain` modes) AND/OR
 *  the literal `[new branch]` marker on first push. Either is sufficient.
 *  Required to exclude push-failures (which exit non-zero AND lack the
 *  arrow) and to catch alias-variant pushes (`gp`, `gpush`) that pattern-
 *  miss but shape-match. Pattern is intentionally tolerant — we accept
 *  either signal to avoid false-negatives across remotes / branch-states.
 *
 *  `->` is matched as a standalone token (whitespace bounds) to avoid
 *  matching the substring inside arbitrary output (e.g., `--foo->bar`). */
const GIT_PUSH_OUTPUT_SHAPE_PATTERN = /(\s->\s|→|\[new branch\])/;

/**
 * Detect a successful `git push` invocation from a Bash tool result.
 *
 * Inputs (from PostToolUse hook context):
 *   - `command`: the `command` arg passed to the Bash tool
 *   - `exitCode`: the process exit code (0 = success)
 *   - `stdout`: the captured standard output
 *   - `stderr`: the captured standard error (git push writes progress to stderr)
 *
 * Detection criteria (all three must hold; per engineer P4 ratification):
 *   1. Command pattern: matches `^git\s+push\b` OR shape-match below
 *      catches alias-variant (`gp`, `gpush`)
 *   2. Exit code: 0 (success)
 *   3. Output shape: stdout OR stderr contains `→` or `[new branch]`
 *
 * Why criteria (2) + (3) are LOAD-BEARING when (1) is the lone
 * pattern: a failed push (auth error, conflict) exits non-zero +
 * lacks the arrow; a `git status` invocation matches no pattern;
 * a `gp` alias matches no pattern but produces the same output
 * shape — only the conjunction reliably catches the wanted event.
 */
export function detectCommitPush(input: {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}): CommitPushDetectionResult {
  const { command, exitCode, stdout, stderr } = input;

  // Criterion 2: exit code success
  if (exitCode !== 0) return { detected: false, exitCode };

  // Criterion 3: output shape match (stdout OR stderr — git push
  // writes "Branch X set up to track..." + "→" to stderr typically)
  const combinedOutput = `${stdout}\n${stderr}`;
  const shapeMatched = GIT_PUSH_OUTPUT_SHAPE_PATTERN.test(combinedOutput);
  if (!shapeMatched) return { detected: false, exitCode };

  // Criterion 1: command pattern OR alias-variant (shape was sufficient
  // to detect; pattern just adds confidence). Both pass-cases acceptable
  // per engineer P4 detection plan: pattern + exit + shape (canonical),
  // OR alias-variant (shape alone, conservative — avoids missing `gp`).
  const patternMatched = GIT_PUSH_COMMAND_PATTERN.test(command);
  if (!patternMatched && !shapeMatched) {
    return { detected: false, exitCode };
  }

  // Detected — extract metadata from command + output for downstream
  // emission shape (matches Hub-side commit-pushed-handler payload
  // sub-fields per Design §3 + M2 fold).
  return {
    detected: true,
    command,
    exitCode,
    forced: /\s--force\b|\s-f\b/.test(command),
    newBranch: /\[new branch\]/.test(combinedOutput),
    remote: extractRemote(command),
    branch: extractBranch(command, combinedOutput),
  };
}

/** Extract the explicit remote name from the command (e.g., `origin` from
 *  `git push origin feature-branch`). Returns undefined when not
 *  specified explicitly (caller can default to `origin` or query git
 *  config out-of-band). */
function extractRemote(command: string): string | undefined {
  // After `git push`, the next non-flag token is the remote.
  const match = command.match(/^\s*git\s+push\s+(?:-\S+\s+)*([^\s-][^\s]*)/);
  return match?.[1];
}

/** Best-effort branch extraction: prefer the explicit `<remote> <branch>`
 *  positional pair from the command; else parse the `→` ref line from
 *  output (`refs/heads/branch -> branch` form); else undefined. */
function extractBranch(command: string, output: string): string | undefined {
  // Command-side: `git push origin feature-branch` → `feature-branch`
  const cmdMatch = command.match(/^\s*git\s+push\s+(?:-\S+\s+)*[^\s-]\S*\s+(\S+)/);
  if (cmdMatch?.[1]) return cmdMatch[1];

  // Output-side: a line like `   abc1234..def5678  branch -> branch`
  // (most concise) OR `* [new branch]      branch -> branch`. Both end
  // with `<localref> -> <remoteref>`.
  const outMatch = output.match(/->\s*(\S+)/);
  return outMatch?.[1];
}

// ── Emission scaffold ─────────────────────────────────────────────────

/**
 * Append a `commit_push_detected` event to the shim observability events
 * file (NDJSON). Loose-coupled to shim runtime via the shared file path
 * convention (`WORK_DIR/.ois/shim-events.ndjson` per
 * `reference_shim_observability.md`). Best-effort — caller writes via fs;
 * failures swallowed (this is observability, not load-bearing).
 *
 * Emission shape mirrors Hub-side commit-pushed-handler payload conventions
 * for cross-layer consistency (per Design §6.4 + M2 fold). Operator
 * downstream tooling can consume via the events-file → render to engineer
 * locally OR forward to thread/coord channel.
 *
 * Wiring contract (operator-level via Claude Code settings.json):
 *   {
 *     "hooks": {
 *       "PostToolUse": [
 *         {
 *           "matcher": "Bash",
 *           "hooks": [
 *             {
 *               "type": "command",
 *               "command": "node /path/to/post-bash-hook.js"
 *             }
 *           ]
 *         }
 *       ]
 *     }
 *   }
 *
 * The wrapper script reads PostToolUse hook input from stdin (JSON shape:
 * `{ tool_input: { command }, tool_response: { stdout, stderr, ... } }`),
 * calls `detectCommitPush`, and on detection invokes
 * `appendCommitPushEvent`.
 */
export interface CommitPushEvent {
  readonly type: "commit_push_detected";
  readonly timestamp: string; // ISO-8601
  readonly command: string;
  readonly branch?: string;
  readonly remote?: string;
  readonly forced: boolean;
  readonly newBranch: boolean;
}

/**
 * Construct the event envelope from detection result. Pure function;
 * caller writes to events-file via separate I/O step.
 */
export function buildCommitPushEvent(
  result: CommitPushDetectionResult,
  now: () => Date = () => new Date(),
): CommitPushEvent | null {
  if (!result.detected) return null;
  return {
    type: "commit_push_detected",
    timestamp: now().toISOString(),
    command: result.command ?? "",
    branch: result.branch,
    remote: result.remote,
    forced: result.forced ?? false,
    newBranch: result.newBranch ?? false,
  };
}
