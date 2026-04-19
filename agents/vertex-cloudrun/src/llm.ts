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
 * Per-round Gemini usage metadata, surfaced to callers via the
 * `onUsage` callback in `CognitiveOptions`. Used by callers to
 * accumulate token budgets across multi-round invocations.
 */
export interface LlmRoundUsage {
  round: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  finishReason?: string;
  parallelToolCalls?: number; // count of tool calls executed in this round
}

/**
 * Cognitive-hypervisor shim options for `generateWithTools`.
 *
 * These are the architect-side Phase 1 additions specified in
 * M-Cognitive-Hypervisor (ADR-018 Non-goals §shim-layer). The shared
 * `@ois/cognitive-layer` package sits at the tool-call boundary; these
 * options sit inside the LLM loop where only the agent that OWNS the
 * prompt can reach.
 */
export interface CognitiveOptions {
  /**
   * Inject `[Cognitive Budget: round N/M — consider converging if
   * approaching the limit]` as a synthetic trailing line on the system
   * instruction for each LLM turn. Teaches the LLM to self-pace.
   * Default: `true`.
   */
  injectRoundBudget?: boolean;
  /**
   * When a round emits multiple tool calls, execute them in parallel
   * (via `Promise.all`) rather than serially. Safe when tools are
   * independent; can be disabled if the executor has ordering
   * constraints on shared state. Default: `false` (conservative —
   * opt in per call site).
   */
  parallelToolCalls?: boolean;
  /**
   * Per-round callback receiving Gemini `usageMetadata` + round number.
   * Enables callers to accumulate cumulative token usage for
   * observability without parsing Cloud Run logs.
   */
  onUsage?: (usage: LlmRoundUsage) => void;
}

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
- Log all autonomous actions via create_audit_entry.

Threads 2.0 — convergence discipline (ADR-013, Mission-21 Phase 1):
When you reply on an ideation thread using create_thread_reply, the converged=true flag is gated by the Hub's policy layer. At converged=true the tool call is rejected with "Thread convergence rejected: …" unless BOTH conditions below are satisfied. This is a hard, machine-enforced gate — narrating compliance in the message field does NOT satisfy it; only populated tool-call parameters do.
1. stagedActions must contain at least one committed action. Phase 1 vocabulary is limited to close_no_action. When the thread produces no downstream artefact, stage one: [{"kind":"stage","type":"close_no_action","payload":{"reason":"<short rationale>"}}].
2. summary must be a non-empty string narrating the thread's agreed outcome. Summary accumulates across rounds — once either party sets it, it persists; later replies can refine via the same parameter.
Canonical converging call:
  create_thread_reply({
    threadId: "thread-NNN",
    message: "<your substantive reply>",
    converged: true,
    intent: "implementation_ready",
    summary: "<one- or two-sentence record of the consensus>",
    stagedActions: [{"kind":"stage","type":"close_no_action","payload":{"reason":"<why no downstream artefact>"}}]
  })
Either party can stage or revise across rounds — the converging party commits. If you are converging second (partner already signalled converged=true in the prior reply), the thread state must already contain a staged action and a non-empty summary from your partner or your own prior rounds. The create_thread_reply response echoes convergenceActions[] and summary so you can see what's currently staged.
NEVER rely on prose promises inside the message field to create tasks, proposals, missions, or any other entity after convergence — the cascade only executes the machine-readable convergenceActions. Prose promises are silently dropped (this failure mode was observed 4 times in 27 hours before Threads 2.0 shipped). If the thread needs a downstream task / proposal / idea / mission spawned, Phase 2 (not yet deployed) will add those action types; until then the explicit path is: converge with close_no_action, then CALL the relevant tool (create_task, create_idea, etc.) directly in the same or a subsequent response.
If you see ThreadConvergenceGateError in a tool response, read the error message — it tells you exactly which condition (missing action, empty summary, or both) to fix. Retry with the correct parameters; do NOT retry with identical parameters.`;

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

export function filterToolsByName<T extends { name: string }>(
  tools: T[],
  allowedNames: string[],
): T[] {
  const allow = new Set(allowedNames);
  return tools.filter((t) => allow.has(t.name));
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
  contextSupplement: string = "",
  cognitive: CognitiveOptions = {},
): Promise<{ text: string; history: Content[] }> {
  const client = getAI();

  const injectBudget = cognitive.injectRoundBudget !== false;
  const parallelToolCalls = cognitive.parallelToolCalls === true;

  const baseSystemInstruction =
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

    // Round-budget injection: append a budget-status line to the system
    // instruction before each LLM turn so the model self-paces. Budget
    // text is stable within a round; a fresh system instruction is
    // computed per-iteration so the round number advances.
    const budgetNote = injectBudget
      ? `\n\n[Cognitive Budget: round ${rounds}/${MAX_TOOL_ROUNDS} — consider converging if approaching the limit]`
      : "";
    const systemInstruction = baseSystemInstruction + budgetNote;

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
    // Surface per-round usage to caller for cumulative accounting
    if (cognitive.onUsage) {
      try {
        cognitive.onUsage({
          round: rounds,
          promptTokens: Number(usage?.promptTokenCount ?? 0),
          completionTokens: Number(usage?.candidatesTokenCount ?? 0),
          totalTokens: Number(usage?.totalTokenCount ?? 0),
          finishReason: finishReason ? String(finishReason) : undefined,
          parallelToolCalls: response.functionCalls?.length,
        });
      } catch {
        /* usage sink must never disturb the LLM loop */
      }
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

    // Execute function calls — in parallel when safe (default: serial
    // to preserve ordering invariants in legacy executors; enable
    // `cognitive.parallelToolCalls` for single-turn batched reads).
    const responseParts: Part[] = [];
    const namedCalls = functionCalls.filter((fc) => fc.name);

    if (parallelToolCalls && namedCalls.length > 1) {
      console.log(`[LLM] Tool calls (parallel): ${namedCalls.length}`);
      type ParallelResult =
        | { ok: true; fc: (typeof namedCalls)[number]; result: Record<string, unknown> }
        | { ok: false; fc: (typeof namedCalls)[number]; error: unknown };
      const results: ParallelResult[] = await Promise.all(
        namedCalls.map(async (fc): Promise<ParallelResult> => {
          console.log(`[LLM] Tool call: ${fc.name}(${JSON.stringify(fc.args || {}).substring(0, 100)})`);
          try {
            const result = await executeToolCall(fc.name!, fc.args ?? {});
            return { ok: true, fc, result };
          } catch (err) {
            return { ok: false, fc, error: err };
          }
        }),
      );
      // Preserve original call order AND apply architect-ratified
      // positional-preservation contract (thread-160 Phase 2a):
      //   Each response element is {status, data|error}. The 1:1
      //   mapping between the model's tool_calls and the tool_outputs
      //   array stays intact on partial failure — Gemini's internal
      //   attribution depends on it.
      for (const r of results) {
        responseParts.push(
          createPartFromFunctionResponse(r.fc.id ?? "", r.fc.name!, buildPartialFailureElement(r)),
        );
      }
    } else {
      // Serial execution (legacy default)
      for (const fc of namedCalls) {
        console.log(`[LLM] Tool call: ${fc.name}(${JSON.stringify(fc.args || {}).substring(0, 100)})`);
        try {
          const result = await executeToolCall(fc.name!, fc.args ?? {});
          responseParts.push(
            createPartFromFunctionResponse(fc.id ?? "", fc.name!, result),
          );
        } catch (err: any) {
          responseParts.push(
            createPartFromFunctionResponse(fc.id ?? "", fc.name!, {
              error: err.message || String(err),
            }),
          );
        }
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

/**
 * Build the architect-ratified positional-preservation envelope for a
 * single parallel-batch element (M-Cognitive-Hypervisor Phase 2a /
 * thread-160 round 2).
 *
 *   Success: `{ status: "success", data: <raw tool result> }`
 *   Error:   `{ status: "error", error: { message: "..." } }`
 *
 * Exported for unit testing. Applied ONLY to the parallel execution
 * branch — the serial path retains its legacy raw/`{error}` shape
 * since 1:1 attribution is preserved implicitly by sequential
 * execution.
 */
export function buildPartialFailureElement(
  r:
    | { ok: true; result: Record<string, unknown> }
    | { ok: false; error: unknown }
    // Callers pass richer objects; we only look at discriminator + payload.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | any,
): Record<string, unknown> {
  if (r && r.ok === true) {
    return { status: "success", data: r.result };
  }
  const raw = r?.error;
  const message = raw instanceof Error ? raw.message : String(raw ?? "unknown error");
  return { status: "error", error: { message } };
}
