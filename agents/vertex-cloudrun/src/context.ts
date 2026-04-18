/**
 * Context Store — Unified GCS-backed memory for the Architect.
 *
 * Provides institutional memory across Director chats, reviews, threads,
 * and decisions. Two access patterns:
 * - buildDirectorContext(): full conversation history for multi-turn Director chat
 * - buildAutonomousContext(): compressed project summary for sandwich handlers
 */

import { Storage } from "@google-cloud/storage";

const storage = new Storage();

export interface Message {
  role: "user" | "model";
  text: string;
  timestamp: string;
}

export interface ContextConfig {
  bucket: string;
  prefix: string; // e.g., "architect-context/"
}

const SYSTEM_CONTEXT_PATH = "system-context.md";
const DIRECTOR_HISTORY_PATH = "director-history.json";
const REVIEW_HISTORY_PATH = "review-history.json";
const THREAD_HISTORY_PATH = "thread-history.json";
const DECISIONS_PATH = "decisions.json";
// processed-events.json REMOVED — State-Based Reconnect replaces
// GCS-persisted dedup. The event loop's getPendingActions() is the
// sole catch-up mechanism, which is naturally idempotent.

// Short TTL so bursts of sandwich handlers within one EventLoop tick
// reuse a single assembled context, while the cache still invalidates
// between the 300s ticks and before any stale data lingers in the
// Director chat path.
const AUTONOMOUS_CONTEXT_TTL_MS = 30_000;

export class ContextStore {
  private bucket: string;
  private prefix: string;
  private autonomousContextCache: { text: string; expiresAt: number } | null = null;

  constructor(config: ContextConfig) {
    this.bucket = config.bucket;
    this.prefix = config.prefix;
  }

  private path(file: string): string {
    return `${this.prefix}${file}`;
  }

  // ── GCS Read/Write ───────────────────────────────────────────────

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      const [content] = await storage
        .bucket(this.bucket)
        .file(this.path(file))
        .download();
      return JSON.parse(content.toString("utf-8")) as T;
    } catch (err: any) {
      if (err.code === 404) return null;
      console.error(`[Context] Failed to read ${file}:`, err);
      return null;
    }
  }

  private async writeJson(file: string, data: unknown): Promise<void> {
    await storage
      .bucket(this.bucket)
      .file(this.path(file))
      .save(JSON.stringify(data, null, 2), {
        contentType: "application/json",
      });
  }

  private async readText(file: string): Promise<string | null> {
    try {
      const [content] = await storage
        .bucket(this.bucket)
        .file(this.path(file))
        .download();
      return content.toString("utf-8");
    } catch (err: any) {
      if (err.code === 404) return null;
      console.error(`[Context] Failed to read ${file}:`, err);
      return null;
    }
  }

  private async writeText(file: string, text: string): Promise<void> {
    await storage
      .bucket(this.bucket)
      .file(this.path(file))
      .save(text, { contentType: "text/markdown" });
  }

  // ── System Context ───────────────────────────────────────────────

  async getSystemContext(): Promise<string> {
    const text = await this.readText(SYSTEM_CONTEXT_PATH);
    return text || DEFAULT_SYSTEM_CONTEXT;
  }

  async setSystemContext(text: string): Promise<void> {
    await this.writeText(SYSTEM_CONTEXT_PATH, text);
  }

  // ── Director History ─────────────────────────────────────────────

  async getDirectorHistory(): Promise<Message[]> {
    return (await this.readJson<Message[]>(DIRECTOR_HISTORY_PATH)) || [];
  }

  async appendDirectorMessage(
    role: "user" | "model",
    text: string
  ): Promise<void> {
    const history = await this.getDirectorHistory();
    history.push({
      role,
      text,
      timestamp: new Date().toISOString(),
    });
    // Keep last 200 messages to prevent unbounded growth
    const trimmed = history.slice(-200);
    await this.writeJson(DIRECTOR_HISTORY_PATH, trimmed);
  }

  // ── Review History ───────────────────────────────────────────────

  async appendReview(
    taskId: string,
    assessment: string,
    directive?: string
  ): Promise<void> {
    const reviews =
      (await this.readJson<
        Array<{
          taskId: string;
          assessment: string;
          directive?: string;
          timestamp: string;
        }>
      >(REVIEW_HISTORY_PATH)) || [];

    reviews.push({
      taskId,
      assessment: assessment.substring(0, 500), // Compress for context
      directive: directive?.substring(0, 200),
      timestamp: new Date().toISOString(),
    });

    // Keep last 50 reviews
    const trimmed = reviews.slice(-50);
    await this.writeJson(REVIEW_HISTORY_PATH, trimmed);
    this.invalidateAutonomousContext();
  }

  // ── Thread History ───────────────────────────────────────────────

  async appendThreadSummary(
    threadId: string,
    title: string,
    outcome: string
  ): Promise<void> {
    const threads =
      (await this.readJson<
        Array<{
          threadId: string;
          title: string;
          outcome: string;
          timestamp: string;
        }>
      >(THREAD_HISTORY_PATH)) || [];

    threads.push({
      threadId,
      title,
      outcome: outcome.substring(0, 500),
      timestamp: new Date().toISOString(),
    });

    const trimmed = threads.slice(-50);
    await this.writeJson(THREAD_HISTORY_PATH, trimmed);
    this.invalidateAutonomousContext();
  }

  // ── Decisions Log ────────────────────────────────────────────────

  async appendDecision(decision: string, context: string): Promise<void> {
    const decisions =
      (await this.readJson<
        Array<{ decision: string; context: string; timestamp: string }>
      >(DECISIONS_PATH)) || [];

    decisions.push({
      decision,
      context: context.substring(0, 300),
      timestamp: new Date().toISOString(),
    });

    const trimmed = decisions.slice(-100);
    await this.writeJson(DECISIONS_PATH, trimmed);
    this.invalidateAutonomousContext();
  }

  // ── Context Builders ─────────────────────────────────────────────

  /**
   * Build context for Director chat — full conversation history.
   * Returns contents array for Gemini multi-turn format.
   *
   * Defensive filter: strip any `model` turn that matches the
   * MAX_TOOL_ROUNDS sentinel string. Legacy pollution (pre-filter
   * writes) lingers in GCS; reading these back in as context causes
   * the model to hallucinate the sentinel on new queries. Write-path
   * filter in `director-chat.ts` prevents new pollution; this
   * read-path filter catches what's already persisted.
   */
  async buildDirectorContext(): Promise<
    Array<{ role: string; parts: Array<{ text: string }> }>
  > {
    const history = await this.getDirectorHistory();
    const MAX_ROUNDS_SENTINEL =
      "I reached the maximum number of tool-calling rounds. Please try a more specific request.";
    return history
      .filter((msg) => !(msg.role === "model" && msg.text === MAX_ROUNDS_SENTINEL))
      .map((msg) => ({
        role: msg.role,
        parts: [{ text: msg.text }],
      }));
  }

  /**
   * Build context for autonomous handlers (sandwich pattern).
   * Returns a compressed system prompt supplement with project knowledge.
   * Includes: architecture overview, ADRs, recent decisions, reviews, threads.
   *
   * Cached with a short TTL so a burst of sandwich handlers within one
   * EventLoop tick reuses the same assembly rather than each re-reading
   * GCS. State changes that matter (new decisions/reviews/threads) are
   * written by `appendDecision` / `appendReview` / `appendThreadSummary`
   * — those invalidate the cache explicitly.
   */
  async buildAutonomousContext(): Promise<string> {
    const now = Date.now();
    if (this.autonomousContextCache && this.autonomousContextCache.expiresAt > now) {
      return this.autonomousContextCache.text;
    }
    const text = await this.buildAutonomousContextUncached();
    this.autonomousContextCache = { text, expiresAt: now + AUTONOMOUS_CONTEXT_TTL_MS };
    return text;
  }

  /** Invalidate the autonomous-context cache (called after any write
   * that changes what the context would contain). */
  private invalidateAutonomousContext(): void {
    this.autonomousContextCache = null;
  }

  private async buildAutonomousContextUncached(): Promise<string> {
    const [architecture, adrFiles, reviews, threads, decisions] = await Promise.all([
      this.readText("wisdom/ARCHITECTURE.md"),
      this.listWisdomFiles("wisdom/decisions/"),
      this.readJson<
        Array<{
          taskId: string;
          assessment: string;
          directive?: string;
          timestamp: string;
        }>
      >(REVIEW_HISTORY_PATH),
      this.readJson<
        Array<{
          threadId: string;
          title: string;
          outcome: string;
          timestamp: string;
        }>
      >(THREAD_HISTORY_PATH),
      this.readJson<
        Array<{ decision: string; context: string; timestamp: string }>
      >(DECISIONS_PATH),
    ]);

    const sections: string[] = [];

    // Architecture overview (truncated to key sections for token efficiency)
    if (architecture) {
      // Extract Overview and Components sections, skip diagrams and tables
      const lines = architecture.split("\n");
      const summary: string[] = [];
      let capturing = false;
      let sectionCount = 0;
      for (const line of lines) {
        if (line.startsWith("# ") || line.startsWith("## ")) {
          capturing = true;
          sectionCount++;
          if (sectionCount > 4) break; // Only first 4 sections
        }
        if (capturing && !line.startsWith("```") && !line.startsWith("|")) {
          summary.push(line);
        }
      }
      if (summary.length > 0) {
        sections.push(summary.join("\n").substring(0, 2000));
      }
    }

    // ADRs (compact summaries)
    if (adrFiles && adrFiles.length > 0) {
      const adrSummaries: string[] = [];
      for (const file of adrFiles.slice(-6)) { // Latest 6 ADRs
        const content = await this.readText(`wisdom/decisions/${file}`);
        if (content) {
          // Extract title and decision lines only
          const titleMatch = content.match(/^# (.+)$/m);
          const decisionMatch = content.match(/## Decision\n\n(.+?)(\n\n|$)/s);
          if (titleMatch) {
            const decision = decisionMatch
              ? decisionMatch[1].substring(0, 150)
              : "";
            adrSummaries.push(`- ${titleMatch[1]}: ${decision}`);
          }
        }
      }
      if (adrSummaries.length > 0) {
        sections.push(
          "## Architecture Decision Records\n" + adrSummaries.join("\n")
        );
      }
    }

    // Recent runtime decisions (from appendDecision calls)
    if (decisions && decisions.length > 0) {
      const recent = decisions.slice(-10);
      sections.push(
        "## Recent Decisions\n" +
          recent.map((d) => `- ${d.decision} (${d.context})`).join("\n")
      );
    }

    if (reviews && reviews.length > 0) {
      const recent = reviews.slice(-5);
      sections.push(
        "## Recent Reviews\n" +
          recent
            .map(
              (r) =>
                `- ${r.taskId}: ${r.assessment.substring(0, 100)}...`
            )
            .join("\n")
      );
    }

    if (threads && threads.length > 0) {
      const recent = threads.slice(-5);
      sections.push(
        "## Recent Thread Outcomes\n" +
          recent.map((t) => `- ${t.title}: ${t.outcome.substring(0, 100)}...`).join("\n")
      );
    }

    return sections.length > 0
      ? "\n\n--- PROJECT CONTEXT ---\n" + sections.join("\n\n")
      : "";
  }

  // ── Wisdom File Listing ──────────────────────────────────────────

  private async listWisdomFiles(prefix: string): Promise<string[]> {
    try {
      const [files] = await storage
        .bucket(this.bucket)
        .getFiles({ prefix: this.path(prefix) });
      return files
        .map((f) => f.name.replace(this.path(prefix), ""))
        .filter((f) => f.endsWith(".md"));
    } catch {
      return [];
    }
  }
}

// ── Default System Context ───────────────────────────────────────────

const DEFAULT_SYSTEM_CONTEXT = `# OIS — Distributed Multi-Agent Software Engineering Platform

A platform with three roles:
- Director (human) — sets goals and architecture
- Architect (you) — plans, governs, issues directives, reviews work
- Engineer (OpenCode LLM) — executes coding tasks

The platform uses MCP (Model Context Protocol) for all agent-Hub communication.
The Hub is the central state store (GCS-backed) for tasks, proposals, threads, reviews, and audit trails.
`;
