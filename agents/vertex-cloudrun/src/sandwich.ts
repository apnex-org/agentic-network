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
  threadId: string
): Promise<void> {
  try {
    // 1. FETCH
    const thread = await hub.getThread(threadId);
    if (!thread) {
      console.warn(`[Sandwich] Could not read thread ${threadId}`);
      return;
    }

    const messages = (thread.messages || []) as Array<{
      author: string;
      text: string;
    }>;
    const messagesText = messages
      .map((m) => `\n[${m.author}]: ${m.text}\n`)
      .join("");

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
      "create_mission",
      "create_task",
      "create_audit_entry",
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
      return;
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

    let result: string;
    try {
      const out = await generateWithTools(
        [],
        prompt,
        functionDeclarations,
        executeToolCall,
        contextSupplement,
      );
      result = out.text;
    } catch (err) {
      console.error(`[Sandwich] LLM generation failed for thread ${threadId}:`, err);
      await hub.createAuditEntry(
        "auto_thread_reply_failed",
        `Thread reply LLM failed for ${threadId}: ${err instanceof Error ? err.message : String(err)}`,
        threadId,
      );
      return;
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
      return;
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
      return;
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
      return;
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
  } catch (err) {
    console.error(`[Sandwich] Thread reply failed for ${threadId}:`, err);
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
    const messagesText = messages
      .map((m) => `\n[${m.author}]: ${m.text}\n`)
      .join("");

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
