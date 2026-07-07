import type { AgentRole } from "../state.js";
import type { IPolicyContext } from "./types.js";

export interface ExternalAgentIdentity {
  id: string;
  role: AgentRole;
  name?: string;
}

/**
 * Cardinality-explicit result for external identity → Hub agent lookup.
 *
 * External identities (GitHub login, future Slack/email/SCM actor ids, etc.)
 * are not Hub-authoritative. They may map to zero, one, or multiple Hub
 * Agents. Only `status: "unique"` is safe to use for a direct `target.agentId`
 * route; `none` and `ambiguous` are safe non-delivery states.
 */
export type ExternalAgentResolution =
  | {
      status: "none";
      identityKind: string;
      identityValue: string;
      matchCount: 0;
    }
  | {
      status: "ambiguous";
      identityKind: string;
      identityValue: string;
      matchCount: number;
      matchedAgentIds: string[];
    }
  | {
      status: "unique";
      identityKind: string;
      identityValue: string;
      matchCount: 1;
      agent: ExternalAgentIdentity;
    };

export interface ResolveUniqueAgentByLabelOptions {
  labelKey: string;
  labelValue: unknown;
  identityKind: string;
  /** Optional post-label-match role allowlist. Applied BEFORE cardinality. */
  allowedRoles?: AgentRole[];
}

function identityValueOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function none(identityKind: string, identityValue: string): ExternalAgentResolution {
  return { status: "none", identityKind, identityValue, matchCount: 0 };
}

/**
 * Resolve an external label identity to Hub Agent cardinality.
 *
 * This helper deliberately never chooses a first match. Direct-agent routing
 * code must branch on `status === "unique"`; every other status skips pinpoint
 * delivery or falls back to an explicitly-safe broader role/cohort route.
 */
export async function resolveUniqueAgentByLabel(
  ctx: IPolicyContext,
  options: ResolveUniqueAgentByLabelOptions,
): Promise<ExternalAgentResolution> {
  const identityValue = identityValueOrEmpty(options.labelValue);
  if (identityValue.length === 0) return none(options.identityKind, identityValue);

  const allowedRoles = options.allowedRoles ? new Set(options.allowedRoles) : null;
  const matches = (await ctx.stores.engineerRegistry.listAgents())
    .filter((agent) => agent.labels?.[options.labelKey] === identityValue)
    .filter((agent) => !allowedRoles || allowedRoles.has(agent.role))
    .map((agent): ExternalAgentIdentity => ({
      id: agent.id,
      role: agent.role,
      name: agent.name,
    }));

  if (matches.length === 0) return none(options.identityKind, identityValue);
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      identityKind: options.identityKind,
      identityValue,
      matchCount: matches.length,
      matchedAgentIds: matches.map((agent) => agent.id),
    };
  }

  return {
    status: "unique",
    identityKind: options.identityKind,
    identityValue,
    matchCount: 1,
    agent: matches[0],
  };
}
