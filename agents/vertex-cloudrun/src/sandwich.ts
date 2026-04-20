/**
 * Sandwich Handlers — deterministic FETCH → LLM REASON → deterministic EXECUTE
 *
 * Each handler fetches data from the Hub, passes it to the LLM for reasoning,
 * then executes the result back on the Hub. The LLM only handles the
 * non-deterministic middle step.
 */

import { HubAdapter } from "./hub-adapter.js";
import { ContextStore } from "./context.js";
import {
  MAX_TOOL_ROUNDS_SENTINEL,
  filterToolsByName,
  generateText,
  generateWithTools,
  mcpToolsToFunctionDeclarations,
  type ToolExecutor,
} from "./llm.js";
import { pruneThreadMessages } from "./prune.js";
import { architectTelemetry } from "./telemetry.js";

/**
 * Phase 2b ckpt-A — Sandwich scope override builder.
 *
 * The sandwich thread-reply path filters tool *declarations* to an
 * allowlist, but `ARCHITECT_SYSTEM_PROMPT` in llm.ts names 20+ tools by
 * role tag ([Architect] / [Any]). Gemini reads the system prompt and
 * calls tools from it that aren't in the filtered declarations — each
 * call returns an error and burns a round. Pass-2 baseline measurement
 * observed 12 MAX_TOOL_ROUNDS attempts across 6 driven threads; 82% of
 * architect Gemini spend (~3.05M tokens) went to these failed attempts.
 *
 * Fix: prepend an explicit override to the system instruction naming
 * the allowlisted tools and the commonly-leaked out-of-scope tools the
 * LLM tries to call. The override is built from the same allowlist the
 * declarations use, so the two stay in sync.
 */
export function buildSandwichScopeOverride(
  allowlist: readonly string[],
): string {
  // Tools the general system prompt advertises (by role tag) that the
  // sandwich rejects. Keeping this list explicit — not computed from
  // the system prompt — because the rejection surface is stable and
  // explicit is easier for the LLM to follow.
  const candidateLeaks = [
    "list_audit_entries",
    "get_idea",
    "list_ideas",
    "update_idea",
    "get_engineer_status",
    "create_proposal_review",
    "create_review",
    "resolve_clarification",
    "get_report",
    "list_documents",
    "list_proposals",
    "get_review",
    "create_thread",
  ];
  const leaks = candidateLeaks.filter((t) => !allowlist.includes(t));
  const allowLines = allowlist.map((t) => `  - ${t}`).join("\n");
  const leakLines = leaks.map((t) => `  - ${t}`).join("\n");
  return (
    `SANDWICH SCOPE OVERRIDE — THREAD-REPLY CONTEXT\n` +
    `\n` +
    `This reply operates under a restricted tool scope. You may ONLY call these tools:\n` +
    `${allowLines}\n` +
    `\n` +
    `All other tools mentioned in the general system prompt below are NOT AVAILABLE in this sandwich context. ` +
    `Calling them returns an error and burns a round. Specifically, these tools from the general directory are OUT-OF-SCOPE here:\n` +
    `${leakLines}\n` +
    `\n` +
    `Post your reply via create_thread_reply in as few rounds as possible. ` +
    `Do not browse, audit, query, or inspect beyond the allowlisted tools above.`
  );
}

// ── Sandwich retry topology (M25-SH-T1, ADR-014) ──────────────────────
//
// Observed failure mode (thread-125 round 5): sandwich LLM emits prose
// output with finishReason=STOP but never calls create_thread_reply. The
// guard catches it, writes an audit entry, and returns. The only path
// back to healthy behaviour was the 300s EventLoop poll — 5+ minutes of
// latency on a live design thread.
//
// Retry policy: after a transient failure (LLM tool-call miss, upstream
// throw, MAX_TOOL_ROUNDS) enqueue ONE immediate retry with jittered
// 5-15s backoff before falling through to the 300s EventLoop poll
// fallback. One attempt per notification; no exponential compounding.
//
// Permanent failures (missing tool surface, deterministic Hub rejection,
// missing entity) skip retry — a second attempt would produce the same
// outcome.
//
// Failure audit entries are still written per-attempt by the inner
// handler. A first-attempt + retry that both fail will produce two
// audit entries; that's intentional — it surfaces the retry pattern in
// the audit log rather than masking it.

export type SandwichOutcome =
  | { kind: "success" }
  | { kind: "transient_failure"; reason: string }
  | { kind: "permanent_failure"; reason: string };

export async function withSandwichRetry(
  label: string,
  attempt: () => Promise<SandwichOutcome>,
): Promise<void> {
  const first = await attempt();
  if (first.kind !== "transient_failure") return;

  const delay = 5000 + Math.floor(Math.random() * 10000);
  console.log(
    `[Sandwich] ${label} transient failure — retrying in ${delay}ms (${first.reason})`,
  );
  await new Promise((r) => setTimeout(r, delay));

  const second = await attempt();
  if (second.kind === "transient_failure") {
    console.warn(
      `[Sandwich] ${label} retry exhausted — 300s EventLoop poll will retry (${second.reason})`,
    );
  }
}

export async function sandwichReviewReport(
  hub: HubAdapter,
  context: ContextStore,
  taskId: string,
  reportRef: string
): Promise<void> {
  try {
    // 1. FETCH
    const report = await hub.getDocument(reportRef);
    if (!report) {
      console.warn(`[Sandwich] Could not read report ${reportRef}`);
      return;
    }

    const contextSupplement = await context.buildAutonomousContext();

    // 2. REASON
    const prompt =
      `You are reviewing an engineering report for task ${taskId}.\n\n` +
      `--- REPORT START ---\n${report}\n--- REPORT END ---\n\n` +
      `Provide a concise architectural review assessment. Evaluate:\n` +
      `- Did the Engineer complete the directive fully?\n` +
      `- Are there any concerns about the implementation?\n` +
      `- Any follow-up actions needed?\n\n` +
      `Respond with ONLY your assessment text.`;

    let assessment: string;
    try {
      assessment = await generateText(prompt, contextSupplement);
    } catch (err) {
      console.error(`[Sandwich] LLM generation failed for report review ${taskId}:`, err);
      await hub.createAuditEntry(
        "auto_review_failed",
        `Report review LLM failed for ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
        taskId
      );
      return;
    }

    if (!assessment || !assessment.trim()) {
      console.error(`[Sandwich] LLM returned empty assessment for ${taskId} — skipping review`);
      await hub.createAuditEntry(
        "auto_review_empty",
        `Report review skipped for ${taskId}: LLM returned empty response`,
        taskId
      );
      return;
    }

    // 3. EXECUTE
    await hub.createReview(taskId, assessment);
    await hub.createAuditEntry("auto_review", `Reviewed report for ${taskId}`, taskId);
    await context.appendReview(taskId, assessment);

    console.log(`[Sandwich] Report review complete for ${taskId}`);
  } catch (err) {
    console.error(`[Sandwich] Report review failed for ${taskId}:`, err);
  }
}

export async function sandwichReviewProposal(
  hub: HubAdapter,
  context: ContextStore,
  proposalId: string,
  title: string,
  summary: string,
  proposalRef: string
): Promise<void> {
  try {
    // 1. FETCH
    const proposal = await hub.getDocument(proposalRef);
    if (!proposal) {
      console.warn(`[Sandwich] Could not read proposal ${proposalRef}`);
      return;
    }

    const contextSupplement = await context.buildAutonomousContext();

    // 2. REASON — let the LLM provide detailed analysis
    const prompt =
      `You are the Architect reviewing an engineering proposal: '${title}' (${proposalId}).\n` +
      `Summary: ${summary}\n\n` +
      `--- PROPOSAL START ---\n${proposal}\n--- PROPOSAL END ---\n\n` +
      `Provide a thorough architectural review of this proposal. Evaluate the technical ` +
      `approach, identify risks or concerns, suggest improvements, and explain your reasoning.\n\n` +
      `After your full review, add this metadata line at the very end:\n` +
      `DECISION: approved or rejected or changes_requested`;

    let result: string;
    try {
      result = await generateText(prompt, contextSupplement);
    } catch (err) {
      console.error(`[Sandwich] LLM generation failed for proposal review ${proposalId}:`, err);
      await hub.createAuditEntry(
        "auto_proposal_review_failed",
        `Proposal review LLM failed for ${proposalId}: ${err instanceof Error ? err.message : String(err)}`,
        proposalId
      );
      return;
    }

    if (!result || !result.trim()) {
      console.error(`[Sandwich] LLM returned empty review for proposal ${proposalId} — skipping`);
      await hub.createAuditEntry(
        "auto_proposal_review_empty",
        `Proposal review skipped for ${proposalId}: LLM returned empty response`,
        proposalId
      );
      return;
    }

    // Parse decision from the end, use full text as feedback
    let decision = "approved";
    let feedback = result;
    const lines = result.split("\n");

    for (let i = Math.max(0, lines.length - 3); i < lines.length; i++) {
      const stripped = lines[i].trim();
      if (stripped.startsWith("DECISION:")) {
        const d = stripped.split(":")[1].trim().toLowerCase();
        if (["approved", "rejected", "changes_requested"].includes(d)) {
          decision = d;
        }
        // Feedback is everything before the DECISION line
        feedback = lines.slice(0, i).join("\n").trim();
      }
    }

    // 3. EXECUTE
    await hub.createProposalReview(proposalId, decision, feedback);
    await hub.createAuditEntry(
      "auto_proposal_review",
      `Reviewed proposal ${proposalId}: ${decision}`,
      proposalId
    );
    await context.appendDecision(
      `Proposal ${proposalId} (${title}): ${decision}`,
      feedback.substring(0, 200)
    );

    console.log(`[Sandwich] Proposal review complete for ${proposalId}: ${decision}`);
  } catch (err) {
    console.error(`[Sandwich] Proposal review failed for ${proposalId}:`, err);
  }
}

export async function sandwichThreadReply(
  hub: HubAdapter,
  context: ContextStore,
  threadId: string,
  sourceQueueItemId?: string
): Promise<void> {
  // M25-SH-T1: wrap the attempt in the retry orchestrator so a transient
  // LLM failure (tool-call miss, upstream throw, MAX_TOOL_ROUNDS) fires
  // an immediate one-shot retry instead of waiting for the 300s poll.
  await withSandwichRetry(
    `thread reply ${threadId}`,
    () => attemptThreadReply(hub, context, threadId, sourceQueueItemId),
  );
}

async function attemptThreadReply(
  hub: HubAdapter,
  context: ContextStore,
  threadId: string,
  sourceQueueItemId?: string
): Promise<SandwichOutcome> {
  try {
    // 1. FETCH
    const thread = await hub.getThread(threadId);
    if (!thread) {
      console.warn(`[Sandwich] Could not read thread ${threadId}`);
      return { kind: "permanent_failure", reason: "thread not found" };
    }

    const messages = (thread.messages || []) as Array<{
      author: string;
      text: string;
    }>;
    // M25-SH-T2: prune long thread histories so the prompt stays within
    // token budget. Strategy: retain opener + recent tail, drop the
    // middle with an omitted-marker, truncate any single huge message.
    const pruned = pruneThreadMessages(messages);
    const messagesText = pruned.text;
    if (pruned.omittedCount > 0 || pruned.anyTruncated) {
      console.log(
        `[Sandwich] thread ${threadId} history pruned: retained=${pruned.retainedCount}, omitted=${pruned.omittedCount}, anyTruncated=${pruned.anyTruncated}`,
      );
    }

    // Pre-fetch documents referenced in thread messages.
    // Scan for document paths (docs/*.md patterns) and load them via Hub.
    // This enriches the context so the LLM doesn't need tool access.
    const allText = messages.map(m => m.text).join(" ");
    const docPaths = extractDocumentPaths(allText);
    let documentContext = "";
    if (docPaths.length > 0) {
      console.log(`[Sandwich] Pre-fetching ${docPaths.length} documents for thread ${threadId}`);
      const docs: string[] = [];
      const MAX_DOC_CHARS = 8000; // Per-doc limit to prevent context overflow
      const MAX_TOTAL_CHARS = 50000; // Total document context limit
      let totalChars = 0;
      for (const path of docPaths) {
        if (totalChars >= MAX_TOTAL_CHARS) {
          console.log(`[Sandwich] Document context limit reached (${totalChars} chars), skipping remaining`);
          break;
        }
        const content = await hub.getDocument(path);
        if (content) {
          const truncated = content.length > MAX_DOC_CHARS
            ? content.substring(0, MAX_DOC_CHARS) + "\n... [truncated]"
            : content;
          docs.push(`--- ${path} ---\n${truncated}\n--- END ${path} ---`);
          totalChars += truncated.length;
          console.log(`[Sandwich]   Loaded ${path} (${content.length} chars${content.length > MAX_DOC_CHARS ? ", truncated" : ""})`);
        } else {
          console.log(`[Sandwich]   Could not load ${path}`);
        }
      }
      if (docs.length > 0) {
        documentContext = "\n\n--- REFERENCED DOCUMENTS ---\n" + docs.join("\n\n") + "\n--- END DOCUMENTS ---\n";
      }
    }

    const contextSupplement = await context.buildAutonomousContext();

    // Determine cognitive framing from semantic intent
    const semanticIntent = (thread.currentSemanticIntent as string) || null;
    let framingInstruction = `Provide a thorough, detailed response to the Engineer's latest message. ` +
      `Be substantive — explain your reasoning, raise concerns, propose alternatives, ` +
      `and give specific technical recommendations. Do not be brief.`;

    if (semanticIntent) {
      const framings: Record<string, string> = {
        seek_rigorous_critique: "Critically evaluate this. Challenge assumptions, find edge cases, identify risks, and point out weaknesses. Be thorough and uncompromising in your analysis.",
        seek_approval: "Evaluate this for approval. Give a clear yes/no decision with specific rationale. Focus on whether it meets requirements and is architecturally sound.",
        collaborative_brainstorm: "Build on these ideas. Suggest alternatives, explore possibilities, think expansively. Add to the conversation rather than constraining it.",
        inform: "This is informational. Acknowledge receipt and ask clarifying questions if needed. No decision required.",
        seek_consensus: "Work toward a shared position. Find common ground, address disagreements constructively, and propose compromises where needed.",
        rubber_duck: "Help the Engineer think through this problem. Ask probing questions rather than giving answers. Be interrogative, not declarative.",
        educate: "Break this down clearly. Provide foundational context, explain the reasoning, and ensure understanding before moving forward.",
        mediate: "Objectively analyze competing approaches. Present trade-offs for each without taking a side. Help the team make an informed decision.",
        post_mortem: "Analyze this failure. Focus on systemic root causes and preventative measures. Assume positive intent from all actors.",
      };
      framingInstruction = framings[semanticIntent] || framingInstruction;
    }

    // 2. REASON — tool-driven: the LLM drives convergence by invoking
    // create_thread_reply with the real Hub schema (Threads 2.0, ADR-013).
    // Tool surface includes a small workflow-action set so the Architect
    // can execute mission/task management from within a thread reply
    // (Phase 2 anticipated via stagedActions; this allow-list is the
    // interim bridge until Phase 2 cascade vocabulary ships). The cascade
    // guard in sandwichThreadConverged still suppresses auto-directive
    // spawn on close_no_action threads, so this doesn't reintroduce the
    // double-action class we fixed in commit f2f3799.
    const THREAD_REPLY_TOOLS = [
      "create_thread_reply",
      "get_document",
      // Mission orchestration (workflow-action set; interim bridge until
      // Phase 2 cascade vocabulary ships):
      "create_mission",
      "update_mission",
      "create_task",
      "create_audit_entry",
      // Read-only inspection + stewardship (added 2026-04-18 after
      // thread-130 fix-up surfaced the gap — Architect needs these to
      // audit task decompositions and close stranded threads without
      // Director intervention):
      "list_tasks",
      "get_task",
      "get_thread",
      "list_threads",
      "close_thread",
      "cancel_task",
      "get_pending_actions",
    ];
    const allTools = (await hub.listTools()) as Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;
    const functionDeclarations = mcpToolsToFunctionDeclarations(
      filterToolsByName(allTools, THREAD_REPLY_TOOLS),
    );
    if (functionDeclarations.length === 0) {
      console.error(
        `[Sandwich] No thread-reply tools available for ${threadId} — aborting`,
      );
      await hub.createAuditEntry(
        "auto_thread_reply_failed",
        `Thread reply aborted for ${threadId}: Hub advertised no create_thread_reply tool`,
        threadId,
      );
      return { kind: "permanent_failure", reason: "no create_thread_reply tool advertised" };
    }

    // Capture the actual create_thread_reply invocation so we can log the
    // committed payload and update context summary on convergence.
    let replyArgs: Record<string, unknown> | null = null;
    let replyResult: Record<string, unknown> | null = null;

    const allowSet = new Set(THREAD_REPLY_TOOLS);
    const executeToolCall: ToolExecutor = async (name, args) => {
      // Defensive allow-list: Gemini occasionally reaches for tools named
      // in the system prompt even when not declared here (observed 2026-04-18
      // with create_audit_entry). Reject them at the executor so the LLM
      // sees the error and self-corrects back to the intended surface.
      if (!allowSet.has(name)) {
        console.warn(
          `[Sandwich] thread-reply LLM attempted out-of-scope tool ${name} — rejecting`,
        );
        return {
          error: `Tool ${name} is not available in this context. Only [${THREAD_REPLY_TOOLS.join(", ")}] are permitted on a thread reply. Post your reply via create_thread_reply.`,
        };
      }
      try {
        if (name === "create_thread_reply") {
          // ADR-017: inject sourceQueueItemId into the reply args so the
          // Hub completion-ACKs the drained queue item atomically with
          // the reply. LLM doesn't need to know about queue identity —
          // this is a system-level concern pinned at the boundary.
          if (sourceQueueItemId && !("sourceQueueItemId" in args)) {
            args = { ...args, sourceQueueItemId };
          }
          replyArgs = args;
        }
        const result = await hub.callTool(name, args);
        const wrapped =
          typeof result === "object" && result !== null
            ? (result as Record<string, unknown>)
            : { output: result };
        const succeeded =
          !("error" in wrapped) && (wrapped as Record<string, unknown>).success !== false;
        if (name === "create_thread_reply" && succeeded) {
          replyResult = wrapped;
        }
        return wrapped;
      } catch (err: any) {
        return { error: err.message || String(err) };
      }
    };

    const prompt =
      `You are the Architect participating in ideation thread '${thread.title || ""}' (${threadId}).\n` +
      `Round ${thread.roundCount || "?"}/${thread.maxRounds || "?"}.\n\n` +
      `--- THREAD HISTORY ---${messagesText}--- END HISTORY ---\n` +
      (documentContext
        ? `\nThe following documents were referenced in the thread and have been pre-loaded for your review:${documentContext}\n`
        : "") +
      `\n${framingInstruction}\n\n` +
      `You MUST post your reply by calling the create_thread_reply tool exactly once for this thread. ` +
      `Compose the reply in the tool's \`message\` parameter — do NOT write a free-form response. ` +
      `Set \`converged: true\` only when you fully agree with the Engineer's latest position; otherwise omit or set false. ` +
      `When converging, you MUST also populate \`stagedActions\` (at minimum [{"kind":"stage","type":"close_no_action","payload":{"reason":"<short rationale>"}}]) ` +
      `AND author a non-empty \`summary\` narrating the thread's agreed outcome — the Hub gate will reject the call otherwise. ` +
      `Set \`intent\` to one of decision_needed, agreement_pending, director_input, implementation_ready when appropriate. ` +
      `If you need additional document context beyond what's pre-loaded, call get_document first, then call create_thread_reply.`;

    // Cumulative per-sandwich LLM usage accounting (M-Cognitive-Hypervisor
    // Phase 1 shim-layer add). Per-round Gemini usageMetadata is surfaced
    // via onUsage and aggregated so the sandwich logs a single summary
    // line at completion — makes per-reply cost legible without grepping.
    //
    // Phase 2a ckpt-C: also emit each round through the shared
    // architectTelemetry sink as an `llm_usage` event so Gemini token
    // accounting lands in the same pipe as tool-call telemetry.
    let cumPromptTokens = 0;
    let cumCompletionTokens = 0;
    let finalRound = 0;

    let result: string;
    try {
      const out = await generateWithTools(
        [],
        prompt,
        functionDeclarations,
        executeToolCall,
        contextSupplement,
        {
          injectRoundBudget: true,
          parallelToolCalls: true, // thread-reply allow-list tools are independent; safe to batch
          scopeOverride: buildSandwichScopeOverride(THREAD_REPLY_TOOLS),
          historyTrimEnabled: true, // Phase 2b ckpt-B — cap round-to-round history growth
          historyTrimWindow: 3,
          historyTrimMinTokens: 500,
          onUsage: (u) => {
            cumPromptTokens += u.promptTokens;
            cumCompletionTokens += u.completionTokens;
            finalRound = u.round;
            architectTelemetry.emitLlmUsage(u, {
              sessionId: threadId,
              tags: { sandwich: "thread-reply" },
            });
          },
        },
      );
      result = out.text;
      console.log(
        `[Sandwich] thread-reply ${threadId}: ${finalRound} rounds, ` +
          `${cumPromptTokens} prompt + ${cumCompletionTokens} completion = ` +
          `${cumPromptTokens + cumCompletionTokens} total Gemini tokens`,
      );
    } catch (err) {
      console.error(`[Sandwich] LLM generation failed for thread ${threadId}:`, err);
      await hub.createAuditEntry(
        "auto_thread_reply_failed",
        `Thread reply LLM failed for ${threadId}: ${err instanceof Error ? err.message : String(err)}`,
        threadId,
      );
      // Transient: upstream throw from Vertex / network / quota — retry
      // may succeed against a transient fault.
      return { kind: "transient_failure", reason: `LLM generation threw: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (result === MAX_TOOL_ROUNDS_SENTINEL) {
      console.error(
        `[Sandwich] Thread reply for ${threadId} hit MAX_TOOL_ROUNDS before completing`,
      );
      await hub.createAuditEntry(
        "auto_thread_reply_failed",
        `Thread reply for ${threadId} exceeded tool-call rounds without converging`,
        threadId,
      );
      // Transient: LLM stuck in a tool-call loop on this attempt; a fresh
      // invocation may sample differently. One-shot retry.
      return { kind: "transient_failure", reason: "MAX_TOOL_ROUNDS exhausted" };
    }

    if (!replyArgs) {
      console.error(
        `[Sandwich] LLM did not call create_thread_reply for ${threadId} — skipping`,
      );
      await hub.createAuditEntry(
        "auto_thread_reply_skipped",
        `Thread reply skipped for ${threadId}: LLM finished without invoking create_thread_reply`,
        threadId,
      );
      // Transient: the thread-125 round-5 failure shape. LLM emitted
      // prose with finishReason=STOP but never invoked the tool. Fresh
      // sampling on retry has good odds of correcting this.
      return { kind: "transient_failure", reason: "LLM finished without calling create_thread_reply" };
    }

    const committedArgs: Record<string, unknown> = replyArgs;
    if (!replyResult) {
      console.error(
        `[Sandwich] create_thread_reply for ${threadId} did not succeed; see tool response in LLM history`,
      );
      await hub.createAuditEntry(
        "auto_thread_reply_failed",
        `Thread reply for ${threadId} rejected by Hub — args: ${JSON.stringify(committedArgs).substring(0, 500)}`,
        threadId,
      );
      // Permanent: Hub rejected with these specific args (e.g. gate
      // refusal). A second attempt with the same LLM-chosen args will
      // fail the same way. Retry skipped.
      return { kind: "permanent_failure", reason: "Hub rejected create_thread_reply args" };
    }

    const converged = committedArgs.converged === true;
    const replyMessage = typeof committedArgs.message === "string" ? committedArgs.message : "";

    await hub.createAuditEntry(
      "auto_thread_reply",
      `Replied to thread ${threadId} (converged=${converged})`,
      threadId,
    );

    if (converged) {
      await context.appendThreadSummary(
        threadId,
        (thread.title as string) || "",
        `Converged. Last response: ${replyMessage.substring(0, 200)}`,
      );
    }

    console.log(
      `[Sandwich] Thread reply complete for ${threadId} (${replyMessage.length} chars, converged=${converged})`,
    );
    return { kind: "success" };
  } catch (err) {
    console.error(`[Sandwich] Thread reply failed for ${threadId}:`, err);
    // Unhandled exception — classify transient so the retry gets one
    // shot at cleanup. Common causes: transient GCS errors, fleeting
    // network blips reading the thread.
    return { kind: "transient_failure", reason: `unhandled exception: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function sandwichThreadConverged(
  hub: HubAdapter,
  context: ContextStore,
  threadId: string,
  intent: string | null
): Promise<void> {
  try {
    // 1. FETCH — read the converged thread
    const thread = await hub.getThread(threadId);
    if (!thread) {
      console.warn(`[Sandwich] Could not read converged thread ${threadId}`);
      return;
    }

    // Guard: skip if Hub cascade already handled this thread (closed it)
    if (thread.status === "closed") {
      console.log(`[Sandwich] Thread ${threadId} already closed (Hub cascade handled) — skipping`);
      return;
    }

    // Threads 2.0: defer to committed convergenceActions when present.
    // The Hub's policy-layer cascade (handleThreadConvergedWithAction)
    // owns the authoritative post-convergence work for each action type;
    // the Architect must not synthesise a secondary directive when the
    // thread explicitly agreed on close_no_action. When Phase 2 adds
    // create_task / create_proposal action types the Hub cascade will
    // also execute those directly, making this sandwich redundant for
    // any machine-readable convergence.
    const committedActions = Array.isArray(thread.convergenceActions)
      ? (thread.convergenceActions as Array<{ type?: string; status?: string }>).filter(
          (a) => a.status === "committed",
        )
      : [];
    if (committedActions.length > 0) {
      const types = committedActions.map((a) => a.type ?? "unknown").join(", ");
      console.log(
        `[Sandwich] Thread ${threadId} converged with committed actions [${types}] — Hub cascade owns follow-up; skipping legacy directive spawn`,
      );
      return;
    }

    const messages = (thread.messages || []) as Array<{
      author: string;
      text: string;
    }>;
    // M25-SH-T2: prune long thread histories so the prompt stays within
    // token budget. Strategy: retain opener + recent tail, drop the
    // middle with an omitted-marker, truncate any single huge message.
    const pruned = pruneThreadMessages(messages);
    const messagesText = pruned.text;
    if (pruned.omittedCount > 0 || pruned.anyTruncated) {
      console.log(
        `[Sandwich] thread ${threadId} history pruned: retained=${pruned.retainedCount}, omitted=${pruned.omittedCount}, anyTruncated=${pruned.anyTruncated}`,
      );
    }

    const contextSupplement = await context.buildAutonomousContext();

    // 2. REASON — determine what action to take based on the convergence intent
    const prompt =
      `Thread "${thread.title || ""}" (${threadId}) has converged with intent: ${intent || "none"}.\n\n` +
      `--- THREAD HISTORY ---${messagesText}--- END HISTORY ---\n\n` +
      `Based on this converged thread:\n` +
      `- If intent is "implementation_ready": Write a clear, specific directive for the Engineer to implement what was agreed. ` +
      `Start with "Implement..." or "Build..." and include all key requirements from the thread.\n` +
      `- If intent is "director_input": Summarize what the Director needs to decide.\n` +
      `- If intent is "decision_needed": State the decision that needs to be made.\n` +
      `- Otherwise: State what follow-up action, if any, is needed.\n\n` +
      `Respond with ONLY the directive text (if implementation_ready) or the summary text. No preamble.`;

    let result: string;
    try {
      result = await generateText(prompt, contextSupplement);
    } catch (err) {
      console.error(`[Sandwich] LLM generation failed for converged thread ${threadId}:`, err);
      await hub.createAuditEntry(
        "convergence_llm_failed",
        `Convergence LLM failed for ${threadId}: ${err instanceof Error ? err.message : String(err)}`,
        threadId
      );
      return;
    }

    if (!result || !result.trim()) {
      console.error(`[Sandwich] LLM returned empty response for converged thread ${threadId} — skipping`);
      await hub.createAuditEntry(
        "convergence_llm_empty",
        `Convergence handling skipped for ${threadId}: LLM returned empty response`,
        threadId
      );
      return;
    }

    // 3. EXECUTE — issue directive if implementation_ready, otherwise log
    if (intent === "implementation_ready") {
      const correlationId = (thread.correlationId as string) || undefined;
      await hub.createTask(result.trim().substring(0, 100), result.trim(), correlationId, threadId);
      await hub.createAuditEntry(
        "auto_directive_from_convergence",
        `Issued directive from converged thread ${threadId}: ${result.trim().substring(0, 100)}`,
        threadId
      );
      console.log(`[Sandwich] Directive issued from converged thread ${threadId}`);
    } else {
      await hub.createAuditEntry(
        "convergence_noted",
        `Thread ${threadId} converged with intent "${intent}": ${result.trim().substring(0, 200)}`,
        threadId
      );
      console.log(`[Sandwich] Convergence noted for ${threadId} (intent: ${intent})`);
    }

    // Close the thread to prevent reprocessing on next event loop poll
    const closed = await hub.closeThread(threadId);
    if (closed) {
      console.log(`[Sandwich] Thread ${threadId} closed after convergence processing`);
    } else {
      console.warn(`[Sandwich] Failed to close thread ${threadId} — may be reprocessed`);
    }
  } catch (err) {
    console.error(`[Sandwich] Thread convergence handling failed for ${threadId}:`, err);
  }
}

export async function sandwichClarification(
  hub: HubAdapter,
  context: ContextStore,
  taskId: string,
  question: string
): Promise<void> {
  try {
    const contextSupplement = await context.buildAutonomousContext();

    // 1. REASON (no fetch needed — question is in the event data)
    const prompt =
      `An Engineer has requested clarification on task ${taskId}.\n` +
      `Their question: '${question}'\n\n` +
      `Provide a clear, concise answer. Respond with ONLY your answer text.`;

    let answer: string;
    try {
      answer = await generateText(prompt, contextSupplement);
    } catch (err) {
      console.error(`[Sandwich] LLM generation failed for clarification ${taskId}:`, err);
      await hub.createAuditEntry(
        "auto_clarification_failed",
        `Clarification LLM failed for ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
        taskId
      );
      return;
    }

    if (!answer || !answer.trim()) {
      console.error(`[Sandwich] LLM returned empty answer for clarification ${taskId} — skipping`);
      await hub.createAuditEntry(
        "auto_clarification_empty",
        `Clarification skipped for ${taskId}: LLM returned empty response`,
        taskId
      );
      return;
    }

    // 2. EXECUTE
    await hub.resolveClarification(taskId, answer);
    await hub.createAuditEntry(
      "auto_clarification",
      `Answered clarification for ${taskId}`,
      taskId
    );

    console.log(`[Sandwich] Clarification answered for ${taskId}`);
  } catch (err) {
    console.error(`[Sandwich] Clarification failed for ${taskId}:`, err);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Extract document paths from thread message text.
 * Matches patterns like docs/something.md, get_document("path"), etc.
 */
function extractDocumentPaths(text: string): string[] {
  const paths = new Set<string>();

  // Match docs/*.md paths (with optional subdirectories)
  const docPathRegex = /docs\/[\w\-\/]+\.md/g;
  let match;
  while ((match = docPathRegex.exec(text)) !== null) {
    paths.add(match[0]);
  }

  // Match get_document("path") or get_document('path') calls
  const getDocRegex = /get_document\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = getDocRegex.exec(text)) !== null) {
    paths.add(match[1]);
  }

  return Array.from(paths);
}
