/**
 * Director Chat API — Express routes for multi-turn conversation
 * with function calling.
 *
 * Endpoints:
 *   POST /chat/session  — create a new session
 *   POST /chat/message   — send a message (multi-turn, function calling)
 */

import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { HubAdapter } from "./hub-adapter.js";
import { ContextStore } from "./context.js";
import { architectTelemetry } from "./telemetry.js";
import {
  generateWithTools,
  mcpToolsToFunctionDeclarations,
  MAX_TOOL_ROUNDS_SENTINEL,
  type ToolExecutor,
} from "./llm.js";
import type { Content, FunctionDeclaration } from "@google/genai";

interface Session {
  id: string;
  history: Content[];
  createdAt: string;
  /**
   * ISO timestamp of the last model response in this session. Used by
   * the "Since we last spoke" digest (notification-gap option A) to
   * fetch audit entries created since the Director was last looking.
   */
  lastResponseAt?: string;
}

interface AuditEntryLite {
  id?: string;
  timestamp: string;
  actor: string;
  action: string;
  details: string;
  relatedEntity: string | null;
}

/**
 * Unwrap a Hub MCP tool-call result. `hub.callTool` may return the
 * MCP-shaped envelope `{content: [{type, text}]}` (text is a JSON
 * string) or the unwrapped object directly depending on adapter
 * version. Handle both paths.
 */
function unwrapToolResult(result: unknown): any {
  const r = result as any;
  if (r?.content?.[0]?.text && typeof r.content[0].text === "string") {
    try { return JSON.parse(r.content[0].text); } catch { /* fall through */ }
  }
  return r;
}

/**
 * Filter audit actions we surface to the Director. The Architect
 * logs every autonomous decision to the audit store via
 * `create_audit_entry`, and the Hub logs lifecycle events like
 * `admin_force_close`. The Director wants to know about those; not
 * about Engineer-side bookkeeping.
 */
const DIRECTOR_RELEVANT_ACTORS = new Set(["architect", "hub"]);

async function fetchRecentAuditEntries(
  hub: HubAdapter,
  sinceIso: string | undefined,
  limit: number,
): Promise<AuditEntryLite[]> {
  try {
    const raw = await hub.callTool("list_audit_entries", { limit });
    const parsed = unwrapToolResult(raw);
    const entries = (parsed?.entries ?? []) as AuditEntryLite[];
    const filtered = entries.filter((e) => DIRECTOR_RELEVANT_ACTORS.has(e.actor));
    if (!sinceIso) return filtered;
    return filtered.filter((e) => e.timestamp > sinceIso);
  } catch (err) {
    console.warn("[DirectorChat] Failed to fetch audit entries for digest:", err);
    return [];
  }
}

function formatAuditLine(e: AuditEntryLite): string {
  const t = e.timestamp.slice(11, 16); // HH:MM
  const entity = e.relatedEntity ? ` [${e.relatedEntity}]` : "";
  const details = e.details.length > 140 ? e.details.slice(0, 137) + "..." : e.details;
  return `• ${t} \`${e.actor}/${e.action}\`${entity} — ${details}`;
}

/**
 * Option A (next-message prefix): build a "Since we last spoke"
 * digest of recent audit entries for the Director. Returns null when
 * there's nothing worth surfacing (first message, no activity, etc).
 */
async function buildSinceDigest(hub: HubAdapter, sinceIso: string | undefined): Promise<string | null> {
  if (!sinceIso) return null;
  const entries = await fetchRecentAuditEntries(hub, sinceIso, 25);
  if (entries.length === 0) return null;
  const shown = entries.slice(0, 10);
  const more = entries.length > shown.length ? `\n_…and ${entries.length - shown.length} more. Type \`/status\` for a full digest._` : "";
  const lines = shown.map(formatAuditLine).join("\n");
  return `**Since we last spoke:**\n${lines}${more}\n\n---\n\n`;
}

/**
 * Option B (/status slash command): compose an on-demand dashboard
 * — recent audit entries, active threads awaiting the Architect,
 * recent tasks. Zero Gemini tokens — runs entirely off Hub state.
 */
async function buildStatusDigest(hub: HubAdapter): Promise<string> {
  const [auditRaw, tasksRaw, threadsRaw, pendingRaw] = await Promise.all([
    hub.callTool("list_audit_entries", { limit: 15 }).catch(() => null),
    hub.callTool("list_tasks", { limit: 500 }).catch(() => null),
    hub.callTool("list_threads", { status: "active", limit: 20 }).catch(() => null),
    hub.callTool("get_pending_actions", {}).catch(() => null),
  ]);

  const audits = (unwrapToolResult(auditRaw)?.entries ?? []) as AuditEntryLite[];
  const tasks = (unwrapToolResult(tasksRaw)?.tasks ?? []) as Array<{id: string; title: string | null; status: string; updatedAt: string}>;
  const threads = (unwrapToolResult(threadsRaw)?.threads ?? []) as Array<{id: string; title: string; status: string; currentTurn: string; roundCount: number; outstandingIntent: string | null}>;
  const pending = unwrapToolResult(pendingRaw) ?? {};

  const parts: string[] = [];
  parts.push(`**Status digest** — ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC\n`);

  // Pending actions (Architect-focused but tells the Director what's queued)
  const pendingTotal = typeof pending.total === "number" ? pending.total : 0;
  if (pendingTotal > 0) {
    parts.push(`**Pending for Architect (${pendingTotal}):**`);
    const pendingSummary: string[] = [];
    if (pending.unreviewedReports?.length) pendingSummary.push(`• ${pending.unreviewedReports.length} unreviewed report(s)`);
    if (pending.pendingProposals?.length) pendingSummary.push(`• ${pending.pendingProposals.length} proposal(s) awaiting review`);
    if (pending.activeThreadsAwaitingReply?.length) pendingSummary.push(`• ${pending.activeThreadsAwaitingReply.length} thread(s) awaiting Architect reply`);
    if (pending.openClarifications?.length) pendingSummary.push(`• ${pending.openClarifications.length} open clarification(s)`);
    if (pending.convergedThreads?.length) pendingSummary.push(`• ${pending.convergedThreads.length} converged thread(s)`);
    parts.push(pendingSummary.length > 0 ? pendingSummary.join("\n") : "• (no categorised pending items)");
    parts.push("");
  } else {
    parts.push("**Pending for Architect:** none\n");
  }

  // Active threads
  if (threads.length > 0) {
    parts.push(`**Active threads (${threads.length}):**`);
    for (const t of threads.slice(0, 10)) {
      const intent = t.outstandingIntent ? ` — intent: ${t.outstandingIntent}` : "";
      parts.push(`• \`${t.id}\` (turn: ${t.currentTurn}, round ${t.roundCount}) ${t.title}${intent}`);
    }
    parts.push("");
  }

  // Tasks — focus on non-terminal or recently-touched
  const nonTerminal = tasks.filter((t) => !["completed", "cancelled", "escalated", "failed"].includes(t.status));
  if (nonTerminal.length > 0) {
    parts.push(`**Tasks in flight (${nonTerminal.length}):**`);
    const sorted = [...nonTerminal].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    for (const t of sorted.slice(0, 10)) {
      parts.push(`• \`${t.id}\` [${t.status}] ${t.title ?? "(no title)"}`);
    }
    parts.push("");
  }

  // Recent audit entries (activity feed)
  const relevant = audits.filter((e) => DIRECTOR_RELEVANT_ACTORS.has(e.actor));
  if (relevant.length > 0) {
    parts.push(`**Recent activity (last ${Math.min(relevant.length, 12)}):**`);
    for (const e of relevant.slice(0, 12)) {
      parts.push(formatAuditLine(e));
    }
  }

  return parts.join("\n");
}

// In-memory session store (GCS-backed history provides persistence)
const sessions = new Map<string, Session>();

// Cap in-memory session.history to keep token cost bounded. Each
// Director exchange can add 3-20 Content entries due to tool-loop
// rounds; without a cap, a long session (or a reload-then-continue)
// sends the full transcript back to Gemini on every message.
const MAX_SESSION_HISTORY_ENTRIES = 150;

/**
 * Trim a Content[] to the last `max` entries while keeping the
 * result a valid Gemini conversation: must start with a user turn
 * whose first part is text (not a functionResponse), so we never
 * orphan a model functionCall or leave dangling tool-response parts.
 */
function trimSessionHistory(history: Content[], max: number): Content[] {
  if (history.length <= max) return history;
  // Scan forward from the earliest acceptable cut point for the next
  // fresh user-text turn (a new Director message boundary).
  for (let i = history.length - max; i < history.length; i++) {
    const entry = history[i];
    if (entry.role !== "user") continue;
    const hasText = entry.parts?.some((p: any) => typeof p.text === "string");
    if (hasText) return history.slice(i);
  }
  // No safe boundary in the tail — drop everything but the most recent
  // user turn we can find. Rare; only happens if the whole tail is a
  // single pathological tool-loop burst.
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.role !== "user") continue;
    const hasText = entry.parts?.some((p: any) => typeof p.text === "string");
    if (hasText) return history.slice(i);
  }
  return [];
}

// Function declarations discovered from Hub tools. Cached with a short
// TTL so schema changes on Hub redeploy propagate without an Architect
// restart — lifetime caching previously pinned Director-chat to the
// tools/list snapshot taken at container boot, which broke the moment
// the Hub added new fields (e.g. Threads 2.0 stagedActions/summary).
let cachedFunctionDeclarations: FunctionDeclaration[] = [];
let functionDeclarationsRefreshedAt = 0;
const FUNCTION_DECLARATIONS_TTL_MS = 60_000;

export function createDirectorChatRouter(
  hub: HubAdapter,
  context: ContextStore
): Router {
  const router = Router();

  // ── Create Session ─────────────────────────────────────────────

  router.post("/chat/session", async (_req: Request, res: Response) => {
    const session: Session = {
      id: randomUUID(),
      history: [],
      createdAt: new Date().toISOString(),
    };
    sessions.set(session.id, session);
    console.log(`[DirectorChat] New session: ${session.id}`);
    res.json({ id: session.id });
  });

  // ── Send Message ───────────────────────────────────────────────

  router.post("/chat/message", async (req: Request, res: Response) => {
    const { session_id, message } = req.body as {
      session_id?: string;
      message?: string;
    };

    if (!message) {
      res.status(400).json({ error: "Missing message" });
      return;
    }

    // Get or create session
    let session = session_id ? sessions.get(session_id) : undefined;
    if (!session) {
      session = {
        id: session_id || randomUUID(),
        history: [],
        createdAt: new Date().toISOString(),
      };
      sessions.set(session.id, session);
    }

    // ── Slash-command short-circuit (Option B — /status) ────────────
    // Zero Gemini tokens. Runs off Hub state only. Does NOT update
    // lastResponseAt so the next real message's "since we last spoke"
    // digest still covers the same window.
    const trimmedMessage = message.trim();
    if (trimmedMessage.toLowerCase() === "/status") {
      try {
        const digest = await buildStatusDigest(hub);
        console.log(`[DirectorChat] /status digest: ${digest.length} chars`);
        res.json({ session_id: session.id, response: digest });
        return;
      } catch (err: any) {
        console.error("[DirectorChat] /status digest failed:", err);
        res.json({
          session_id: session.id,
          response: `Failed to build status digest: ${err?.message || String(err)}`,
          error: true,
        });
        return;
      }
    }

    // Discover tools — refresh whenever cache is empty or older than TTL.
    const now = Date.now();
    const cacheStale =
      cachedFunctionDeclarations.length === 0 ||
      now - functionDeclarationsRefreshedAt > FUNCTION_DECLARATIONS_TTL_MS;
    if (cacheStale && hub.isConnected) {
      try {
        const tools = await hub.listTools();
        cachedFunctionDeclarations = mcpToolsToFunctionDeclarations(
          tools as Array<{
            name: string;
            description?: string;
            inputSchema?: Record<string, unknown>;
          }>
        );
        functionDeclarationsRefreshedAt = now;
        console.log(
          `[DirectorChat] Refreshed ${cachedFunctionDeclarations.length} function declarations`
        );
      } catch {
        console.warn("[DirectorChat] Failed to refresh tools");
      }
    }

    // Build tool executor that dispatches to Hub adapter
    const executeToolCall: ToolExecutor = async (name, args) => {
      try {
        const result = await hub.callTool(name, args);
        return typeof result === "object" && result !== null
          ? (result as Record<string, unknown>)
          : { output: result };
      } catch (err: any) {
        return { error: err.message || String(err) };
      }
    };

    // Build context supplement
    const contextSupplement = await context.buildAutonomousContext();

    // Store user message in context
    await context.appendDirectorMessage("user", message);

    try {
      // Load persisted history for this session
      const persistedHistory = await context.buildDirectorContext();

      // Merge: use persisted history if in-memory is empty
      if (session.history.length === 0 && persistedHistory.length > 0) {
        session.history = trimSessionHistory(persistedHistory, MAX_SESSION_HISTORY_ENTRIES);
      }

      // M-Cognitive-Hypervisor Phase 1 shim: budget injection + usage
      // emission. Parallel tool calls intentionally disabled for director-
      // chat — session history order assumptions are not yet audited.
      //
      // Phase 2a ckpt-C: emit per-round usage through the shared
      // architectTelemetry sink alongside the cumulative console.log.
      let cumPromptTokens = 0;
      let cumCompletionTokens = 0;
      let finalRound = 0;
      const { text, history } = await generateWithTools(
        session.history,
        message,
        cachedFunctionDeclarations,
        executeToolCall,
        contextSupplement,
        {
          injectRoundBudget: true,
          parallelToolCalls: false,
          onUsage: (u) => {
            cumPromptTokens += u.promptTokens;
            cumCompletionTokens += u.completionTokens;
            finalRound = u.round;
            architectTelemetry.emitLlmUsage(u, {
              sessionId: session.id,
              tags: { sandwich: "director-chat" },
            });
          },
        },
      );
      console.log(
        `[DirectorChat] session ${session.id}: ${finalRound} rounds, ` +
          `${cumPromptTokens}+${cumCompletionTokens}=${cumPromptTokens + cumCompletionTokens} Gemini tokens`,
      );

      // Update session history — trim to cap so tool-loop rounds
      // don't compound across messages.
      const trimmed = trimSessionHistory(history, MAX_SESSION_HISTORY_ENTRIES);
      if (trimmed.length < history.length) {
        console.log(`[DirectorChat] Trimmed session history ${history.length} → ${trimmed.length} entries`);
      }
      session.history = trimmed;

      // Store model response in context — EXCEPT the MAX_TOOL_ROUNDS
      // sentinel. Persisting it pollutes future replayed history and
      // causes the model to hallucinate the same string on subsequent
      // sessions (observed 2026-04-18; see ADR-012).
      if (text !== MAX_TOOL_ROUNDS_SENTINEL) {
        await context.appendDirectorMessage("model", text);
      } else {
        console.warn("[DirectorChat] Skipped persisting MAX_TOOL_ROUNDS sentinel to director-history.json");
      }

      // Option A (next-message prefix): if there was Director-
      // relevant activity since the last response in this session,
      // surface it above the main response. First message of a
      // session has no `lastResponseAt` so this is a no-op there.
      const digest = await buildSinceDigest(hub, session.lastResponseAt);
      const responseText = digest ? digest + text : text;

      // Advance the watermark for the next round.
      session.lastResponseAt = new Date().toISOString();

      console.log(`[DirectorChat] Response: ${text.substring(0, 100)}...${digest ? " (with since-digest)" : ""}`);

      res.json({
        session_id: session.id,
        response: responseText,
      });
    } catch (err: any) {
      console.error("[DirectorChat] Error:", err);

      // Classify the error and surface a human-readable message as a
      // 200 chat response so the UI shows the reason instead of a
      // transport error that it interprets as "session expired".
      const status = err?.status || err?.code || err?.response?.status;
      const msg = err?.message || String(err);
      let friendly: string;
      if (status === 429 || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
        friendly = `Gemini quota exhausted (429). Retry shortly or check Vertex AI quota for \`${process.env.GOOGLE_CLOUD_PROJECT || "labops-389703"}\`.`;
      } else if (status === 400 || msg.includes("400") || msg.includes("INVALID_ARGUMENT")) {
        friendly = `Gemini rejected the request (400 INVALID_ARGUMENT). See the \`[LLM] generateWithTools round … 400 INVALID_ARGUMENT\` diagnostics in Cloud Run logs. If it persists, start a new session.`;
      } else if (status === 404 || msg.includes("NOT_FOUND")) {
        friendly = `Gemini model or resource not found (404): ${msg}`;
      } else if (msg.toLowerCase().includes("safety") || msg.toLowerCase().includes("blocked")) {
        friendly = `Gemini blocked the response (safety filter).`;
      } else {
        friendly = `Architect error: ${msg}`;
      }

      // Keep the session alive — the UI treats HTTP 5xx as session loss.
      res.status(200).json({
        session_id: session.id,
        response: friendly,
        error: true,
      });
    }
  });

  return router;
}
