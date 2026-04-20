/**
 * ARCHITECT_SYSTEM_PROMPT regression pins.
 *
 * The system prompt is a single source of truth for ambient
 * behavioural protocol. These tests guard against accidental removal
 * of load-bearing sections — each assertion pins a specific behaviour
 * that has been observed (in production or in measurement) to fail
 * without the associated prompt text.
 */

import { describe, it, expect } from "vitest";
import { ARCHITECT_SYSTEM_PROMPT } from "../src/llm.js";

describe("ARCHITECT_SYSTEM_PROMPT", () => {
  it("documents Threads-2.0 convergence gate (stagedActions + summary)", () => {
    // Observed 4× before Threads 2.0 shipped: agents tried to narrate
    // convergence in the message field instead of populating the
    // machine-readable fields. The prompt teaches both conditions
    // explicitly and tells the LLM that prose promises are dropped.
    expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/stagedActions must contain/);
    expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/summary must be a non-empty string/);
    expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/Prose promises are silently dropped/);
  });

  it("teaches _ois_pagination cursor-following (Phase 2x P1-3, idea-117 follow-on)", () => {
    // Phase 2b ckpt-C measurement: Gemini ignored the _ois_pagination
    // next_offset cursor on summarized responses, either re-calling
    // identically (wasted round) or burning budget to "chase" missing
    // data instead of proceeding. This prompt section teaches:
    //   - the pagination shape (_ois_pagination.total / .count /
    //     .next_offset / .hint)
    //   - when to continue (re-call with offset: next_offset)
    //   - when to proceed (first page usually sufficient)
    //   - never re-call with identical args
    expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/_ois_pagination/);
    expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/next_offset/);
    expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/NEVER re-call the same tool with identical arguments/);
  });

  it("specifies role tags for tool discovery ([Architect], [Engineer], [Any])", () => {
    expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/\[Architect\]/);
    expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/\[Engineer\]/);
    expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/\[Any\]/);
  });

  it("names create_thread_reply as the canonical ideation reply path", () => {
    expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/create_thread_reply/);
  });
});
