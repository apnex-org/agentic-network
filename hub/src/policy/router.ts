/**
 * PolicyRouter — Registry-based command router for Layer 7.
 *
 * Domain policies register their handlers during initialization.
 * The router dispatches tool calls, drains internal events, and
 * provides observability.
 */

import type { ZodType } from "zod";
import type { IPolicyContext, PolicyHandler, PolicyResult, DomainEvent } from "./types.js";

type Role = "architect" | "engineer" | "director" | "any";
export type RoleSet = ReadonlySet<Role>;

interface RegisteredTool {
  description: string;
  schema: Record<string, ZodType>;
  handler: PolicyHandler;
  deprecatedAlias?: string;
  /**
   * Set of roles permitted to call this tool. The sentinel "any" member
   * bypasses the RBAC check entirely (Phase 2x P2-6 made the role set
   * an actual Set so composite tags like `[Architect|Director]` are
   * first-class — no more inline role checks inside handlers for
   * admin-shared tools).
   */
  roles: RoleSet;
}

/**
 * Parse the role tag(s) from a tool description.
 * Looks for `[Role]` or `[Role1|Role2|...]` at the start. Known role
 * tokens: Architect, Engineer, Director, Any (case-insensitive).
 * Missing or unrecognised tokens fall back to { "any" }.
 */
function parseRoleTag(description: string): RoleSet {
  const m = /^\[([^\]]+)\]/.exec(description);
  if (!m) return new Set<Role>(["any"]);
  const roles = new Set<Role>();
  for (const token of m[1].split("|")) {
    const t = token.trim().toLowerCase();
    if (t === "architect" || t === "engineer" || t === "director" || t === "any") {
      roles.add(t);
    }
  }
  return roles.size > 0 ? roles : new Set<Role>(["any"]);
}

// Internal event handler type
type InternalEventHandler = (event: DomainEvent, ctx: IPolicyContext) => Promise<void>;

export class PolicyRouter {
  private tools = new Map<string, RegisteredTool>();
  private internalHandlers = new Map<string, InternalEventHandler[]>();
  private log: (msg: string) => void;

  constructor(logger?: (msg: string) => void) {
    this.log = logger || ((msg) => console.log(`[PolicyRouter] ${msg}`));
  }

  // ── Registration ──────────────────────────────────────────────────

  register(
    name: string,
    description: string,
    schema: Record<string, ZodType>,
    handler: PolicyHandler,
    deprecatedAlias?: string
  ): void {
    const roles = parseRoleTag(description);
    this.tools.set(name, { description, schema, handler, deprecatedAlias, roles });
  }

  /**
   * Register a deprecated alias that delegates to the canonical handler.
   */
  registerAlias(aliasName: string, canonicalName: string): void {
    const canonical = this.tools.get(canonicalName);
    if (!canonical) {
      throw new Error(`Cannot create alias '${aliasName}': canonical tool '${canonicalName}' not registered`);
    }
    this.tools.set(aliasName, {
      ...canonical,
      deprecatedAlias: canonicalName,
      roles: canonical.roles,
      handler: async (args, ctx) => {
        this.log(`[DEPRECATION] Tool '${aliasName}' invoked. Consumers must migrate to '${canonicalName}'.`);
        return canonical.handler(args, ctx);
      },
    });
  }

  /**
   * Register a handler for internal domain events.
   */
  onInternalEvent(eventType: string, handler: InternalEventHandler): void {
    const handlers = this.internalHandlers.get(eventType) || [];
    handlers.push(handler);
    this.internalHandlers.set(eventType, handlers);
  }

  // ── Execution ─────────────────────────────────────────────────────

  async handle(toolName: string, args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${toolName}` }) }],
        isError: true,
      };
    }

    // RBAC enforcement: resolve caller's role and check against the
    // tool's permitted role set. The "any" sentinel bypasses the check.
    // Unknown callers (pre-register_role) also bypass — parity with the
    // prior behaviour. Composite tags like [Architect|Director] let
    // admin-shared tools declare their audience declaratively without
    // inline handler checks.
    const callerRole = ctx.stores.engineerRegistry.getRole(ctx.sessionId);
    if (!tool.roles.has("any") && callerRole !== "unknown") {
      if (!tool.roles.has(callerRole as Role)) {
        const permittedList = Array.from(tool.roles).join("|");
        this.log(`[RBAC] Rejected ${toolName}: requires [${permittedList}], caller is [${callerRole}]`);
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Authorization denied: tool '${toolName}' requires role '${permittedList}', but caller is '${callerRole}'` }) }],
          isError: true,
        };
      }
    }

    // ── M-Session-Claim-Separation (mission-40) T2: first-tools/call auto-claim ──
    //
    // Back-compat hook for adapters that haven't migrated to the explicit
    // claim_session call. If the caller's session has asserted identity
    // (via register_role) but has not yet claimed a session — and the
    // incoming tool is not one of the identity-establishing tools that
    // would create a chicken-and-egg loop — auto-claim via the T1 single
    // claimSession helper with trigger="first_tool_call". Emits
    // agent_session_implicit_claim audit (and agent_session_displaced
    // when evicting a prior session). The §10 deprecation-runway
    // dashboard tracks this trigger separately from sse_subscribe.
    //
    // Skip-list: register_role (establishes identity; can't pre-claim)
    // and claim_session (does the claim itself; auto-claiming first
    // would double-claim and emit confusing audits).
    if (toolName !== "register_role" && toolName !== "claim_session") {
      const agent = await ctx.stores.engineerRegistry.getAgentForSession(ctx.sessionId);
      if (agent && agent.currentSessionId !== ctx.sessionId) {
        const autoClaim = await ctx.stores.engineerRegistry.claimSession(
          agent.id,
          ctx.sessionId,
          "first_tool_call",
        );
        if (autoClaim.ok) {
          try {
            await ctx.stores.audit.logEntry(
              "hub",
              "agent_session_implicit_claim",
              `Agent ${autoClaim.agentId} session implicitly claimed (trigger=first_tool_call, epoch=${autoClaim.sessionEpoch}, originatingTool=${toolName})`,
              autoClaim.agentId,
            );
          } catch (err) {
            this.log(`[T2] agent_session_implicit_claim audit write failed for ${autoClaim.agentId}: ${(err as Error).message ?? err}`);
          }
          if (autoClaim.displacedPriorSession) {
            try {
              await ctx.stores.audit.logEntry(
                "hub",
                "agent_session_displaced",
                `Agent ${autoClaim.agentId} session displaced (priorSessionId=${autoClaim.displacedPriorSession.sessionId}, priorEpoch=${autoClaim.displacedPriorSession.epoch}, newEpoch=${autoClaim.sessionEpoch}, trigger=first_tool_call)`,
                autoClaim.agentId,
              );
            } catch (err) {
              this.log(`[T2] agent_session_displaced audit write failed for ${autoClaim.agentId}: ${(err as Error).message ?? err}`);
            }
          }
        }
        // Auto-claim failure (thrashing / unknown_engineer) does NOT block
        // the tool call. Best-effort, matches T1's audit-emission philosophy.
        // The handler may itself error if it requires a claimed session;
        // that surfaces to the caller via the normal MCP error channel.
      }
    }

    const startTime = Date.now();
    let result: PolicyResult;
    let emittedCount = 0;
    let cascadeCount = 0;

    // Wrap ctx.emit to count emissions
    const originalEmit = ctx.emit;
    ctx.emit = async (event, data, roles) => {
      emittedCount++;
      return originalEmit(event, data, roles);
    };

    try {
      // Execute the primary handler
      result = await tool.handler(args, ctx);

      // Drain internal events synchronously
      let safety = 0;
      while (ctx.internalEvents.length > 0 && safety < 100) {
        const event = ctx.internalEvents.shift()!;
        try {
          await this.dispatchInternalEvent(event, ctx);
        } catch (cascadeErr) {
          this.log(`[CRITICAL] Cascade failure for ${event.type}: ${cascadeErr}`);
          // Emit cascade_failure notification but don't fail the primary request
          try {
            await ctx.emit("cascade_failure", {
              originalTool: toolName,
              failedEvent: event.type,
              error: String(cascadeErr),
            }, ["architect"]);
          } catch {
            // Best effort — don't let notification failure crash the request
          }
        }
        safety++;
      }
      cascadeCount = safety;

      if (safety >= 100) {
        this.log(`[WARN] Internal event drain hit safety limit (100 events) for tool ${toolName}`);
      }

    } catch (err) {
      const elapsed = Date.now() - startTime;
      this.log(`[ERROR] ${toolName} failed after ${elapsed}ms (role: ${ctx.role}): ${err}`);
      throw err;
    }

    // Observability
    const elapsed = Date.now() - startTime;
    this.log(`[EXEC] ${toolName} completed in ${elapsed}ms (role: ${ctx.role}, emitted: ${emittedCount}, cascades: ${cascadeCount})`);

    // Restore original emit
    ctx.emit = originalEmit;

    return result;
  }

  // ── Internal Event Dispatch ───────────────────────────────────────

  private async dispatchInternalEvent(event: DomainEvent, ctx: IPolicyContext): Promise<void> {
    const handlers = this.internalHandlers.get(event.type);
    if (!handlers || handlers.length === 0) {
      this.log(`[WARN] No handler registered for internal event: ${event.type}`);
      return;
    }
    for (const handler of handlers) {
      await handler(event, ctx);
    }
  }

  // ── Introspection ─────────────────────────────────────────────────

  /**
   * Get the list of registered tool names (excluding deprecated aliases).
   */
  getRegisteredTools(): string[] {
    return Array.from(this.tools.entries())
      .filter(([_, t]) => !t.deprecatedAlias)
      .map(([name]) => name);
  }

  /**
   * Get all registered tool names including aliases.
   */
  getAllToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get the total number of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Check if a tool is registered.
   */
  has(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * Get a tool's registration for MCP binding.
   */
  getToolRegistration(toolName: string): RegisteredTool | undefined {
    return this.tools.get(toolName);
  }
}
