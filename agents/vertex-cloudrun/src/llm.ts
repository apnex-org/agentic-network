/**
 * LLM Module — Gemini 3.1 Pro via @google/genai
 *
 * Two invocation patterns:
 * - generateText(): single-shot text generation (sandwich handlers)
 * - generateWithTools(): multi-turn with function calling (Director chat)
 */

import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  createPartFromFunctionResponse,
  type Content,
  type FunctionDeclaration,
  type Part,
  Type,
} from "@google/genai";

const MODEL = "gemini-3-flash-preview";
const MAX_TOOL_ROUNDS = 10; // Prevent infinite tool-calling loops

/**
 * Sentinel returned by `generateWithTools` when the tool-loop hits
 * `MAX_TOOL_ROUNDS`. Exported so downstream code can recognise it and
 * refuse to persist it into replayed context — otherwise the model
 * reads its own past error responses back and hallucinates them as
 * fresh answers (observed 2026-04-18; see ADR-012 pollution note).
 */
export const MAX_TOOL_ROUNDS_SENTINEL =
  "I reached the maximum number of tool-calling rounds. Please try a more specific request.";

let ai: GoogleGenAI | null = null;

function getAI(): GoogleGenAI {
  if (!ai) {
    ai = new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT || "labops-389703",
      location: process.env.GOOGLE_CLOUD_LOCATION || "global",
    });
  }
  return ai;
}

// ── System Prompt ──────────────────────────────────────────────────

export const ARCHITECT_SYSTEM_PROMPT = `You are the Architect, a persistent AI agent that helps the Director (a human software architect) plan and execute software engineering tasks.

Your role:
1. When the Director describes a coding task, translate it into a clear, specific task for the Engineer using the create_task tool (with title and description fields).
2. Check for completed reports using the get_report tool. Reports include a summary and a reportRef path — use get_document to read the full report when you need details.
3. Review Engineer proposals using list_proposals, get_document, and create_proposal_review.
4. Use list_documents to browse historical reports, proposals, and other documents.
5. Use list_tasks to see all task statuses.
6. Use get_engineer_status to check which Engineers are currently connected.
7. Report results back to the Director in clear summaries.

Communication modes:
- When the Director asks you to DISCUSS, ANALYSE, or REVIEW something, provide your analysis and recommendations directly. Do NOT issue directives to the Engineer unless the Director explicitly asks you to.
- When the Director asks you to IMPLEMENT, BUILD, CREATE, or EXECUTE something, then create tasks for the Engineer.
- When unsure, ask the Director for clarification before creating tasks.

Tool role tags:
- Tools tagged [Architect] are for your use (create_task, get_report, get_engineer_status, create_proposal_review, create_review, close_thread, get_pending_actions, create_audit_entry, resolve_clarification, cancel_task).
- Tools tagged [Engineer] are for the Engineer's use. Do not call these.
- Tools tagged [Any] can be used by either role (list_tasks, list_documents, get_document, list_proposals, get_review, create_thread, create_thread_reply, get_thread, list_threads, list_audit_entries).

Guidelines:
- Be precise in your task descriptions. The Engineer is a coding agent that will interpret your instructions literally.
- Always check for the Engineer's report after creating a task.
- Keep your responses concise and focused on the task at hand.
- When reviewing reports or proposals, provide substantive architectural feedback.
- Log all autonomous actions via create_audit_entry.`;

// ── Single-Shot Text Generation (Sandwich Pattern) ────────────────

const GENERATE_MAX_RETRIES = 3;
const GENERATE_RETRY_BASE_MS = 2000;

export async function generateText(
  userPrompt: string,
  contextSupplement: string = ""
): Promise<string> {
  const client = getAI();

  const systemInstruction =
    ARCHITECT_SYSTEM_PROMPT +
    (contextSupplement ? "\n\n" + contextSupplement : "");

  const promptChars = userPrompt.length + systemInstruction.length;
  console.log(`[LLM] generateText: prompt=${promptChars} chars (system=${systemInstruction.length}, user=${userPrompt.length})`);

  for (let attempt = 1; attempt <= GENERATE_MAX_RETRIES; attempt++) {
    try {
      const response = await client.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction,
          temperature: 0.2,
        },
      });

      // Diagnose empty/blocked responses
      const candidate = response.candidates?.[0];
      const finishReason = candidate?.finishReason;
      const safetyRatings = candidate?.safetyRatings;
      const promptFeedback = (response as any).promptFeedback;
      const usage = (response as any).usageMetadata;
      const text = response.text || "";

      // Always log token usage when available
      if (usage) {
        console.log(`[LLM] Token usage: input=${usage.promptTokenCount || "?"}, output=${usage.candidatesTokenCount || usage.totalTokenCount ? (usage.totalTokenCount - (usage.promptTokenCount || 0)) : "?"}, total=${usage.totalTokenCount || "?"}`);
      }

      if (!text) {
        console.error(`[LLM] Empty response from Gemini (attempt ${attempt}/${GENERATE_MAX_RETRIES})`);
        console.error(`[LLM]   finishReason: ${finishReason || "none"}`);
        console.error(`[LLM]   promptFeedback: ${JSON.stringify(promptFeedback || null)}`);
        console.error(`[LLM]   safetyRatings: ${JSON.stringify(safetyRatings || null)}`);
        console.error(`[LLM]   candidateCount: ${response.candidates?.length || 0}`);
        console.error(`[LLM]   usageMetadata: ${JSON.stringify(usage || null)}`);

        // Safety block — no point retrying
        if (finishReason === "SAFETY" || promptFeedback?.blockReason) {
          console.error(`[LLM] Response blocked by safety filter — not retrying`);
          throw new Error(`Gemini response blocked: ${finishReason || promptFeedback?.blockReason}`);
        }

        // Context too large or unknown failure — no point retrying with same input
        if (finishReason === "OTHER") {
          console.error(`[LLM] Possible context overflow or unknown failure (finishReason: OTHER) — not retrying`);
          throw new Error(`Gemini unknown failure: finishReason=OTHER, inputTokens=${usage?.promptTokenCount || "unknown"}`);
        }

        // Retry on empty response (possible transient issue)
        if (attempt < GENERATE_MAX_RETRIES) {
          const delay = GENERATE_RETRY_BASE_MS * attempt;
          console.log(`[LLM] Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        throw new Error(`Gemini returned empty response after ${GENERATE_MAX_RETRIES} attempts (finishReason: ${finishReason}, inputTokens: ${usage?.promptTokenCount || "unknown"})`);
      }

      console.log(`[LLM] generateText: got ${text.length} chars (finishReason: ${finishReason})`);
      return text;
    } catch (err: any) {
      // Handle 429 rate limiting with retry
      const status = err?.status || err?.code || err?.response?.status;
      if ((status === 429 || err?.message?.includes("429") || err?.message?.includes("RESOURCE_EXHAUSTED")) && attempt < GENERATE_MAX_RETRIES) {
        const delay = GENERATE_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.warn(`[LLM] Rate limited (429) on attempt ${attempt}/${GENERATE_MAX_RETRIES} — retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // Re-throw non-retryable errors
      throw err;
    }
  }

  // Should not reach here, but just in case
  throw new Error("generateText: exhausted all retries");
}

// ── Multi-Turn with Function Calling (Director Chat) ──────────────

export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>
) => Promise<Record<string, unknown>>;

/**
 * Convert MCP tool schemas to Gemini FunctionDeclaration format.
 * Transforms JSON Schema properties into Gemini's Schema type system.
 */
interface GeminiSchema {
  type: Type;
  description?: string;
  enum?: string[];
  items?: GeminiSchema;
}

/**
 * Recursively build a Gemini Schema from a JSON Schema node. Arrays
 * MUST carry an `items` schema under Vertex's validator — without it
 * the whole GenerateContent request is rejected with
 * `function_declarations[N].parameters.properties[field].items:
 * missing field` 400 INVALID_ARGUMENT (observed 2026-04-18).
 */
function buildGeminiSchema(prop: Record<string, unknown>): GeminiSchema {
  const schema: GeminiSchema = {
    type: mapJsonSchemaType(prop.type as string | undefined),
  };
  if (prop.description) schema.description = prop.description as string;
  if (prop.enum) schema.enum = prop.enum as string[];
  if (prop.type === "array") {
    // Fallback to string element when items is missing on the incoming
    // schema — Vertex requires *something*, and Hub-side schemas have
    // historically been string[] where items is present.
    const itemsNode = (prop.items as Record<string, unknown> | undefined) ?? { type: "string" };
    schema.items = buildGeminiSchema(itemsNode);
  }
  return schema;
}

export function mcpToolsToFunctionDeclarations(
  mcpTools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>
): FunctionDeclaration[] {
  return mcpTools
    .filter((tool) => tool.name && tool.inputSchema)
    .map((tool) => {
      const schema = tool.inputSchema!;
      const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
      const required = (schema.required || []) as string[];

      const geminiProperties: Record<string, GeminiSchema> = {};
      for (const [name, prop] of Object.entries(properties)) {
        geminiProperties[name] = buildGeminiSchema(prop);
      }

      return {
        name: tool.name,
        description: tool.description || `Hub tool: ${tool.name}`,
        parameters: {
          type: Type.OBJECT,
          properties: geminiProperties,
          required: required.length > 0 ? required : undefined,
        },
      };
    });
}

/**
 * Dry-run validation of Gemini FunctionDeclarations against Vertex's
 * schema validator. Sends a minimal generateContent request with just
 * the declarations attached; if Vertex rejects, the 400 error body
 * names the offending `function_declarations[N].*` path. Maps those
 * indices back to tool names for a readable failure.
 *
 * Intended for startup — if the declarations are malformed the
 * Architect crashes before accepting chat traffic, so the bad
 * revision fails Cloud Run's health check and rolls back instead of
 * leaking 400s into the Director's session two rounds deep
 * (observed 2026-04-18 — missing `items` field regression).
 */
export async function validateToolDeclarations(
  functionDeclarations: FunctionDeclaration[]
): Promise<void> {
  if (functionDeclarations.length === 0) return;
  const client = getAI();
  try {
    await client.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: "ping" }] }],
      config: {
        tools: [{ functionDeclarations }],
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
        },
        temperature: 0.0,
      },
    });
    console.log(
      `[LLM] validateToolDeclarations: OK — ${functionDeclarations.length} declarations accepted by Vertex`,
    );
  } catch (err: any) {
    const status = err?.status || err?.code || err?.response?.status;
    const msg = err?.message || String(err);
    if (status === 400 || msg.includes("INVALID_ARGUMENT")) {
      const failedIndices = Array.from(msg.matchAll(/function_declarations\[(\d+)\]/g))
        .map((m: any) => Number(m[1]));
      const uniqueIndices = [...new Set(failedIndices)];
      const failedNames = uniqueIndices
        .map((i) => functionDeclarations[i as number]?.name ?? `[idx ${i}]`)
        .join(", ");
      console.error(`[LLM] validateToolDeclarations: REJECTED by Vertex`);
      console.error(`[LLM]   Failed tools: ${failedNames || "(none parseable)"}`);
      console.error(`[LLM]   Raw error: ${msg}`);
      throw new Error(
        `Vertex rejected tool declarations (tools: ${failedNames || "unknown"}): ${msg}`,
      );
    }
    // Non-400 error (auth, network, quota) — propagate without claiming schema is broken
    console.error(`[LLM] validateToolDeclarations: non-schema error (${status}) — not failing startup:`, msg);
    throw err;
  }
}

function mapJsonSchemaType(type: string | undefined): Type {
  switch (type) {
    case "number":
    case "integer":
      return Type.NUMBER;
    case "boolean":
      return Type.BOOLEAN;
    case "array":
      return Type.ARRAY;
    case "string":
    default:
      return Type.STRING;
  }
}

/**
 * Run a multi-turn conversation with function calling.
 * Returns the final text response after all tool calls are resolved.
 */
export async function generateWithTools(
  history: Content[],
  userMessage: string,
  functionDeclarations: FunctionDeclaration[],
  executeToolCall: ToolExecutor,
  contextSupplement: string = ""
): Promise<{ text: string; history: Content[] }> {
  const client = getAI();

  const systemInstruction =
    ARCHITECT_SYSTEM_PROMPT +
    (contextSupplement ? "\n\n" + contextSupplement : "");

  // Add user message to history
  const contents: Content[] = [
    ...history,
    { role: "user", parts: [{ text: userMessage }] },
  ];

  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    // 429 retry mirrors generateText; does NOT count against MAX_TOOL_ROUNDS
    let response: Awaited<ReturnType<typeof client.models.generateContent>> | null = null;
    for (let attempt = 1; attempt <= GENERATE_MAX_RETRIES; attempt++) {
      try {
        response = await client.models.generateContent({
          model: MODEL,
          contents,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations }],
            toolConfig: {
              functionCallingConfig: {
                mode: FunctionCallingConfigMode.AUTO,
              },
            },
            temperature: 0.2,
          },
        });
        break;
      } catch (err: any) {
        const status = err?.status || err?.code || err?.response?.status;
        const msg = err?.message || "";

        if ((status === 429 || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) && attempt < GENERATE_MAX_RETRIES) {
          const delay = GENERATE_RETRY_BASE_MS * Math.pow(2, attempt - 1);
          console.warn(`[LLM] generateWithTools round ${rounds}: Rate limited (429) attempt ${attempt}/${GENERATE_MAX_RETRIES} — retrying in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // 400 — dump payload shape. INVALID_ARGUMENT is almost always
        // a malformed contents/tools payload; we want to see what shape
        // we sent so we can narrow root cause without reproducing.
        if (status === 400 || msg.includes("400") || msg.includes("INVALID_ARGUMENT")) {
          console.error(`[LLM] generateWithTools round ${rounds}: 400 INVALID_ARGUMENT — request diagnostics`);
          console.error(`[LLM]   contents.length=${contents.length}`);
          console.error(`[LLM]   systemInstruction.length=${systemInstruction.length}`);
          const totalChars = contents.reduce(
            (sum, c) => sum + (c.parts?.reduce((s, p) => s + JSON.stringify(p).length, 0) ?? 0),
            0,
          );
          console.error(`[LLM]   contents total chars=${totalChars}`);
          console.error(`[LLM]   functionDeclarations.length=${functionDeclarations.length}`);
          // Role sequence — Gemini rejects certain patterns (e.g. two
          // consecutive same-role turns, or a tool turn that follows a
          // non-tool turn).
          console.error(`[LLM]   role sequence: ${contents.map((c) => c.role).join("→")}`);
          const last = contents[contents.length - 1];
          if (last?.parts) {
            for (const [i, part] of last.parts.entries()) {
              const keys = Object.keys(part);
              const preview = JSON.stringify(part).substring(0, 200);
              console.error(`[LLM]   last.parts[${i}] keys=[${keys.join(",")}] preview=${preview}`);
            }
          }
        }

        throw err;
      }
    }

    if (!response) throw new Error("generateWithTools: unreachable — empty response after retry loop");

    // Per-round usage + finish reason — previously only generateText logged this
    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const usage = (response as any).usageMetadata;
    if (usage) {
      console.log(`[LLM] generateWithTools round ${rounds}: input=${usage.promptTokenCount ?? "?"} output=${usage.candidatesTokenCount ?? "?"} total=${usage.totalTokenCount ?? "?"} finishReason=${finishReason ?? "none"}`);
    } else {
      console.log(`[LLM] generateWithTools round ${rounds}: finishReason=${finishReason ?? "none"}`);
    }

    // Add model response to history
    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) {
      contents.push(modelContent);
    }

    // Check for function calls
    const functionCalls = response.functionCalls;
    if (!functionCalls || functionCalls.length === 0) {
      // No function calls — final text response
      return { text: response.text || "", history: contents };
    }

    // Execute each function call
    const responseParts: Part[] = [];
    for (const fc of functionCalls) {
      if (!fc.name) continue;

      console.log(`[LLM] Tool call: ${fc.name}(${JSON.stringify(fc.args || {}).substring(0, 100)})`);

      try {
        const result = await executeToolCall(fc.name, fc.args ?? {});
        responseParts.push(
          createPartFromFunctionResponse(fc.id ?? "", fc.name, result)
        );
      } catch (err: any) {
        responseParts.push(
          createPartFromFunctionResponse(fc.id ?? "", fc.name, {
            error: err.message || String(err),
          })
        );
      }
    }

    // Add function responses
    contents.push({ role: "user", parts: responseParts });
  }

  // Hit max rounds
  return {
    text: MAX_TOOL_ROUNDS_SENTINEL,
    history: contents,
  };
}
