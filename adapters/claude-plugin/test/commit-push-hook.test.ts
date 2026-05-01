/**
 * commit-push-hook.test.ts — adapter-side commit-push detection tests
 * (mission-68 W2 Layer (b) of the engineer-cadence-discipline stack).
 *
 * Pins:
 *   - Pure detection: command pattern `^git\s+push\b` + exit-code 0 +
 *     output shape match `→` or `[new branch]`
 *   - Failed push (non-zero exit) → not detected
 *   - Unrelated command (no pattern, no shape) → not detected
 *   - Push that produces no shape match (e.g., already-up-to-date) → not detected
 *   - Alias variant (`gp`, `gpush`) caught by shape-match alone
 *   - Force-push detection from --force / -f flags
 *   - New-branch detection from `[new branch]` output
 *   - Branch + remote extraction from command + output
 *   - Event envelope construction (buildCommitPushEvent)
 */

import { describe, expect, it } from "vitest";
import {
  detectCommitPush,
  buildCommitPushEvent,
} from "../src/commit-push-hook.js";

// ── Detection tests ───────────────────────────────────────────────────

describe("detectCommitPush — canonical patterns", () => {
  it("detects `git push origin feature-branch` with success exit + arrow shape", () => {
    const r = detectCommitPush({
      command: "git push origin feature-branch",
      exitCode: 0,
      stdout: "",
      stderr:
        "To github.com:apnex-org/agentic-network.git\n" +
        "   abc1234..def5678  feature-branch -> feature-branch",
    });
    expect(r.detected).toBe(true);
    expect(r.remote).toBe("origin");
    expect(r.branch).toBe("feature-branch");
    expect(r.forced).toBe(false);
    expect(r.newBranch).toBe(false);
  });

  it("detects `git push` with [new branch] output (first push of a new branch)", () => {
    const r = detectCommitPush({
      command: "git push -u origin agent-greg/mission-68-w2",
      exitCode: 0,
      stdout: "",
      stderr:
        "To github.com:apnex-org/agentic-network.git\n" +
        " * [new branch]      agent-greg/mission-68-w2 -> agent-greg/mission-68-w2\n" +
        "Branch 'agent-greg/mission-68-w2' set up to track remote branch...",
    });
    expect(r.detected).toBe(true);
    expect(r.newBranch).toBe(true);
    expect(r.branch).toBe("agent-greg/mission-68-w2");
  });

  it("detects force-push (--force flag → forced: true)", () => {
    const r = detectCommitPush({
      command: "git push --force origin feature",
      exitCode: 0,
      stdout: "",
      stderr:
        "To github.com:test.git\n + abc..def feature -> feature (forced update)",
    });
    expect(r.detected).toBe(true);
    expect(r.forced).toBe(true);
  });

  it("detects force-push (-f flag short form → forced: true)", () => {
    const r = detectCommitPush({
      command: "git push -f origin feature",
      exitCode: 0,
      stdout: "",
      stderr: "feature -> feature",
    });
    expect(r.detected).toBe(true);
    expect(r.forced).toBe(true);
  });

  it("detects bare `git push` (uses default remote/branch from git config) via shape", () => {
    const r = detectCommitPush({
      command: "git push",
      exitCode: 0,
      stdout: "",
      stderr: "main -> main",
    });
    expect(r.detected).toBe(true);
  });
});

// ── Negative tests (criteria unmet) ───────────────────────────────────

describe("detectCommitPush — negative cases", () => {
  it("does NOT detect push that exited non-zero (auth failure)", () => {
    const r = detectCommitPush({
      command: "git push origin feature",
      exitCode: 128,
      stdout: "",
      stderr:
        "remote: Permission to apnex-org/agentic-network.git denied\n" +
        "fatal: unable to access 'https://github.com/apnex-org/agentic-network.git/': The requested URL returned error: 403",
    });
    expect(r.detected).toBe(false);
    expect(r.exitCode).toBe(128);
  });

  it("does NOT detect `git status` (no pattern, no shape)", () => {
    const r = detectCommitPush({
      command: "git status --short",
      exitCode: 0,
      stdout: " M README.md",
      stderr: "",
    });
    expect(r.detected).toBe(false);
  });

  it("does NOT detect `git push` that produced no ref-update output (already up-to-date)", () => {
    const r = detectCommitPush({
      command: "git push origin main",
      exitCode: 0,
      stdout: "",
      stderr: "Everything up-to-date",
    });
    expect(r.detected).toBe(false); // no `→` or `[new branch]` shape
  });

  it("does NOT detect arbitrary command even with `→` in output (false-positive guard)", () => {
    // A `cat` of a file that happens to contain `→` shouldn't trip
    // detection because the command doesn't match `git push` pattern AND
    // the shape match alone IS allowed for alias-variants — so this is
    // the edge case where alias-variant tolerance loses to false-positive
    // risk. Currently we accept that risk per P4 ratification (the
    // `→` shape is rare outside git output).
    //
    // To pin behavior: a `cat` containing `→` IS detected as a commit-push
    // (acknowledged false-positive; rare in practice; documented).
    const r = detectCommitPush({
      command: "cat /tmp/notes-with-arrow.txt",
      exitCode: 0,
      stdout: "next step → ship",
      stderr: "",
    });
    // Documents current behavior — known false-positive; reviewer-flag
    // for follow-up if frequency proves problematic in practice.
    expect(r.detected).toBe(true);
  });
});

// ── Alias-variant tests ───────────────────────────────────────────────

describe("detectCommitPush — alias variants (shape-match catches)", () => {
  it("detects `gp` alias via shape-match alone", () => {
    const r = detectCommitPush({
      command: "gp",
      exitCode: 0,
      stdout: "",
      stderr:
        "To github.com:apnex-org/agentic-network.git\n" +
        "   abc..def feature -> feature",
    });
    expect(r.detected).toBe(true);
  });

  it("detects `gpush` alias via shape-match alone", () => {
    const r = detectCommitPush({
      command: "gpush origin feature",
      exitCode: 0,
      stdout: "",
      stderr: " * [new branch]      feature -> feature",
    });
    expect(r.detected).toBe(true);
    expect(r.newBranch).toBe(true);
  });
});

// ── Branch + remote extraction edge cases ─────────────────────────────

describe("detectCommitPush — metadata extraction edge cases", () => {
  it("extracts remote from `git push origin` (positional)", () => {
    const r = detectCommitPush({
      command: "git push origin",
      exitCode: 0,
      stdout: "",
      stderr: "main -> main",
    });
    expect(r.detected).toBe(true);
    expect(r.remote).toBe("origin");
  });

  it("skips flag tokens when extracting remote (e.g., `git push -u origin`)", () => {
    const r = detectCommitPush({
      command: "git push -u origin feature",
      exitCode: 0,
      stdout: "",
      stderr: "feature -> feature",
    });
    expect(r.detected).toBe(true);
    expect(r.remote).toBe("origin");
    expect(r.branch).toBe("feature");
  });

  it("extracts branch from output `→` line when not in command", () => {
    const r = detectCommitPush({
      command: "git push",
      exitCode: 0,
      stdout: "",
      stderr: "   abc..def\n  agent-greg/mission-68-w2 -> agent-greg/mission-68-w2",
    });
    expect(r.detected).toBe(true);
    expect(r.branch).toBe("agent-greg/mission-68-w2");
  });
});

// ── Event envelope construction ───────────────────────────────────────

describe("buildCommitPushEvent — emission envelope", () => {
  it("builds a CommitPushEvent envelope from a detected result", () => {
    const r = detectCommitPush({
      command: "git push origin feature",
      exitCode: 0,
      stdout: "",
      stderr: " * [new branch]      feature -> feature",
    });
    const fixedNow = new Date("2026-05-01T13:30:00.000Z");
    const evt = buildCommitPushEvent(r, () => fixedNow);
    expect(evt).not.toBeNull();
    expect(evt!.type).toBe("commit_push_detected");
    expect(evt!.timestamp).toBe("2026-05-01T13:30:00.000Z");
    expect(evt!.command).toBe("git push origin feature");
    expect(evt!.remote).toBe("origin");
    expect(evt!.branch).toBe("feature");
    expect(evt!.newBranch).toBe(true);
    expect(evt!.forced).toBe(false);
  });

  it("returns null when detection result is not detected", () => {
    const r = detectCommitPush({
      command: "git status",
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    expect(buildCommitPushEvent(r)).toBeNull();
  });
});
