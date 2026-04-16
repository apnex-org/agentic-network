/**
 * Sandwich Handlers — deterministic FETCH → LLM REASON → deterministic EXECUTE
 *
 * Each handler fetches data from the Hub, passes it to the LLM for reasoning,
 * then executes the result back on the Hub. The LLM only handles the
 * non-deterministic middle step.
 */

import { HubAdapter } from "./hub-adapter.js";
import { ContextStore } from "./context.js";
import { generateText } from "./llm.js";

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

    // 2. REASON — let the LLM write freely, with metadata tags at the end
    const prompt =
      `You are the Architect participating in ideation thread '${thread.title || ""}' (${threadId}).\n` +
      `Round ${thread.roundCount || "?"}/${thread.maxRounds || "?"}.\n\n` +
      `--- THREAD HISTORY ---${messagesText}--- END HISTORY ---\n` +
      (documentContext ? `\nThe following documents were referenced in the thread and have been pre-loaded for your review:${documentContext}\n` : "") +
      `\n${framingInstruction}\n\n` +
      `IMPORTANT: You do NOT have access to tools in this context. All referenced documents have been pre-loaded above. ` +
      `Base your response on the thread history, any pre-loaded documents, and your project context.\n\n` +
      `After your full response, add these two metadata lines at the very end:\n` +
      `CONVERGED: true (if you fully agree) or false\n` +
      `INTENT: one of decision_needed, agreement_pending, director_input, implementation_ready, or none`;

    let result: string;
    try {
      result = await generateText(prompt, contextSupplement);
    } catch (err) {
      console.error(`[Sandwich] LLM generation failed for thread ${threadId}:`, err);
      await hub.createAuditEntry(
        "auto_thread_reply_failed",
        `Thread reply LLM failed for ${threadId}: ${err instanceof Error ? err.message : String(err)}`,
        threadId
      );
      return;
    }

    // Guard: never post empty replies
    if (!result || !result.trim()) {
      console.error(`[Sandwich] LLM returned empty text for thread ${threadId} — skipping reply`);
      await hub.createAuditEntry(
        "auto_thread_reply_empty",
        `Thread reply skipped for ${threadId}: LLM returned empty response`,
        threadId
      );
      return;
    }

    // Parse metadata from the end of the response, keep everything else as the reply
    let responseText = result;
    let converged = false;
    let intent: string | undefined;

    const lines = result.split("\n");

    // Scan from the bottom for metadata tags (last 5 lines)
    const metadataStart = Math.max(0, lines.length - 5);
    const metadataLines: number[] = [];

    for (let i = metadataStart; i < lines.length; i++) {
      const stripped = lines[i].trim();
      if (stripped.startsWith("CONVERGED:")) {
        converged = stripped.toLowerCase().includes("true");
        metadataLines.push(i);
      } else if (stripped.startsWith("INTENT:")) {
        const val = stripped.split(":")[1]?.trim().toLowerCase();
        if (
          val &&
          [
            "decision_needed",
            "agreement_pending",
            "director_input",
            "implementation_ready",
          ].includes(val)
        ) {
          intent = val;
        }
        metadataLines.push(i);
      }
    }

    // Remove metadata lines from the response text
    if (metadataLines.length > 0) {
      const firstMeta = Math.min(...metadataLines);
      responseText = lines.slice(0, firstMeta).join("\n").trim();
    }

    // Final guard after metadata stripping
    if (!responseText) {
      console.error(`[Sandwich] LLM response for thread ${threadId} was only metadata — skipping reply`);
      await hub.createAuditEntry(
        "auto_thread_reply_empty",
        `Thread reply skipped for ${threadId}: response was metadata-only`,
        threadId
      );
      return;
    }

    // 3. EXECUTE
    await hub.createThreadReply(threadId, responseText, converged, intent);
    await hub.createAuditEntry(
      "auto_thread_reply",
      `Replied to thread ${threadId} (converged=${converged})`,
      threadId
    );

    if (converged) {
      await context.appendThreadSummary(
        threadId,
        (thread.title as string) || "",
        `Converged. Last response: ${responseText.substring(0, 200)}`
      );
    }

    console.log(`[Sandwich] Thread reply complete for ${threadId} (${responseText.length} chars)`);
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
