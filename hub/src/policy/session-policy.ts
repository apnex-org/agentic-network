/**
 * Session Policy — Role registration, agent handshake, and engineer status.
 *
 * Tools: register_role (with optional M18 Agent payload), get_engineer_status,
 *        migrate_agent_queue (Architect-only admin).
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import type { AgentRole, RegisterAgentPayload, AgentClientMetadata } from "../state.js";

// ── M18 Handshake: register_role ────────────────────────────────────

function coerceAgentRole(role: string): AgentRole | null {
  if (role === "engineer" || role === "architect" || role === "director") return role;
  return null;
}

async function registerRole(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const role = args.role as string;
  const sid = ctx.sessionId;
  const globalInstanceId = args.globalInstanceId as string | undefined;
  const clientMetadataArg = args.clientMetadata as AgentClientMetadata | undefined;
  const advisoryTags = args.advisoryTags as Record<string, unknown> | undefined;
  const labels = args.labels as Record<string, string> | undefined;

  // M18 path: the proxy sent the full Agent handshake payload.
  if (globalInstanceId && clientMetadataArg) {
    const tokenRole = coerceAgentRole(role);
    if (!tokenRole) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ ok: false, code: "role_mismatch", message: `Unknown role '${role}'` }),
        }],
        isError: true,
      };
    }
    const payload: RegisterAgentPayload = {
      globalInstanceId,
      role: tokenRole,
      clientMetadata: clientMetadataArg,
      advisoryTags: advisoryTags ?? {},
      labels: labels ?? {},
    };
    const result = await ctx.stores.engineerRegistry.registerAgent(sid, tokenRole, payload, ctx.clientIp);
    if (!result.ok) {
      // MCP tool-error channel: isError=true + structured JSON body the proxy inspects.
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ ok: false, code: result.code, message: result.message }),
        }],
        isError: true,
      };
    }
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          ok: true,
          engineerId: result.engineerId,
          sessionEpoch: result.sessionEpoch,
          wasCreated: result.wasCreated,
          clientMetadata: result.clientMetadata,
          advisoryTags: result.advisoryTags,
          labels: result.labels,
          message: `Registered agent ${result.engineerId} (epoch=${result.sessionEpoch}${result.wasCreated ? ", newly created" : ""})`,
        }),
      }],
    };
  }

  // Legacy path: bare {role} call, backwards-compatible with @ois/hub-connection <= 1.3.0.
  // Records the role in the sessionRoles map for RBAC; no Agent entity is created.
  ctx.stores.engineerRegistry.setSessionRole(sid, role as "engineer" | "architect");
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        success: true,
        role,
        sessionId: sid,
        message: `Registered as ${role}`,
      }),
    }],
  };
}

async function migrateAgentQueue(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const sourceEngineerId = args.sourceEngineerId as string;
  const targetEngineerId = args.targetEngineerId as string;
  const result = await ctx.stores.engineerRegistry.migrateAgentQueue(sourceEngineerId, targetEngineerId);
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        ok: true,
        sourceEngineerId,
        targetEngineerId,
        moved: result.moved,
        message: `Moved ${result.moved} pending notifications from ${sourceEngineerId} to ${targetEngineerId}`,
      }),
    }],
  };
}

async function getEngineerStatus(_args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const summary = await ctx.stores.engineerRegistry.getStatusSummary();
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(summary, null, 2),
    }],
  };
}

// ── Registration ────────────────────────────────────────────────────

export function registerSessionPolicy(router: PolicyRouter): void {
  router.register(
    "register_role",
    "[Any] Register this session's role and, optionally (M18), the full Agent handshake payload (globalInstanceId, clientMetadata, advisoryTags) to obtain a stable engineerId with displacement-safe session rebinding.",
    {
      role: z.enum(["engineer", "architect", "director"]).describe("The role of this session: 'engineer', 'architect', or 'director'"),
      globalInstanceId: z.string().optional().describe("M18: Client-side stable UUID from ~/.ois/instance.json. When present, triggers the Agent handshake path."),
      clientMetadata: z
        .object({
          clientName: z.string(),
          clientVersion: z.string(),
          proxyName: z.string(),
          proxyVersion: z.string(),
          transport: z.string().optional(),
          sdkVersion: z.string().optional(),
          hostname: z.string().optional(),
          platform: z.string().optional(),
          pid: z.number().optional(),
        })
        .optional()
        .describe("M18: Mutable metadata about the client driving this session."),
      advisoryTags: z.record(z.string(), z.unknown()).optional().describe("M18: Launch-time-only tags (e.g., llmModel). Explicitly drift-prone; do NOT route on these values."),
      labels: z.record(z.string(), z.string()).optional().describe("Mission-19: routing labels (e.g., {env: 'smoke-test', team: 'billing'}). Immutable after first registration. Reserved key 'ois.io/namespace' has no v1 semantics."),
    },
    registerRole,
  );

  router.register(
    "get_engineer_status",
    "[Any] Get the connection status of all registered Engineers, including their IDs, connection times, and task completion counts.",
    {},
    getEngineerStatus,
  );

  router.register(
    "migrate_agent_queue",
    "[Architect] M18 admin: move pending notifications from a source engineerId to a target engineerId (used for 'my laptop died, new globalInstanceId' recovery). Agents are append-only and are never deleted.",
    {
      sourceEngineerId: z.string().describe("Engineer ID whose queue should be drained"),
      targetEngineerId: z.string().describe("Engineer ID to receive the pending notifications"),
    },
    migrateAgentQueue,
  );
}
