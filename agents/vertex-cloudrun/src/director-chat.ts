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
import {
  generateWithTools,
  mcpToolsToFunctionDeclarations,
  type ToolExecutor,
} from "./llm.js";
import type { Content, FunctionDeclaration } from "@google/genai";

interface Session {
  id: string;
  history: Content[];
  createdAt: string;
}

// In-memory session store (GCS-backed history provides persistence)
const sessions = new Map<string, Session>();

// Cached function declarations from Hub tools
let cachedFunctionDeclarations: FunctionDeclaration[] = [];

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

    // Discover tools (cache after first call)
    if (cachedFunctionDeclarations.length === 0 && hub.isConnected) {
      try {
        const tools = await hub.listTools();
        cachedFunctionDeclarations = mcpToolsToFunctionDeclarations(
          tools as Array<{
            name: string;
            description?: string;
            inputSchema?: Record<string, unknown>;
          }>
        );
        console.log(
          `[DirectorChat] Cached ${cachedFunctionDeclarations.length} function declarations`
        );
      } catch {
        console.warn("[DirectorChat] Failed to discover tools");
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
        session.history = persistedHistory;
      }

      const { text, history } = await generateWithTools(
        session.history,
        message,
        cachedFunctionDeclarations,
        executeToolCall,
        contextSupplement
      );

      // Update session history
      session.history = history;

      // Store model response in context
      await context.appendDirectorMessage("model", text);

      console.log(`[DirectorChat] Response: ${text.substring(0, 100)}...`);

      res.json({
        session_id: session.id,
        response: text,
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
