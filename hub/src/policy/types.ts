/**
 * Layer 7 Policy Router — Core Types
 */

import type { ZodType } from "zod";
import type { ITaskStore, IEngineerRegistry, IProposalStore, IThreadStore, IAuditStore, Selector } from "../state.js";
import type { IIdeaStore, IMissionStore, ITurnStore, ITeleStore } from "../entities/index.js";

// ── Domain Event (internal, synchronous) ────────────────────────────

export interface DomainEvent {
  type: string;
  payload: Record<string, unknown>;
}

// ── All Stores (pure CRUD DAOs) ─────────────────────────────────────

export interface AllStores {
  task: ITaskStore;
  engineerRegistry: IEngineerRegistry;
  proposal: IProposalStore;
  thread: IThreadStore;
  audit: IAuditStore;
  idea: IIdeaStore;
  mission: IMissionStore;
  turn: ITurnStore;
  tele: ITeleStore;
}

// ── Policy Context (the Layer 4 ↔ Layer 7 seam) ─────────────────────

export interface IPolicyContext {
  stores: AllStores;
  /** Emit an SSE notification to connected clients (role-based, legacy) */
  emit: (event: string, data: Record<string, unknown>, targetRoles?: string[]) => Promise<void>;
  /** Mission-19: dispatch by selector (role ∧ matchLabels equality). */
  dispatch: (event: string, data: Record<string, unknown>, selector: Selector) => Promise<void>;
  /** Current session identity */
  sessionId: string;
  clientIp: string;
  role: string;
  /** Internal domain events accumulated during handler execution */
  internalEvents: DomainEvent[];
  /** Hub configuration */
  config: {
    storageBackend: string;
    gcsBucket: string;
  };
}

// ── Policy Result (what handlers return) ────────────────────────────

export interface PolicyResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

// ── Policy Handler signature ────────────────────────────────────────

export type PolicyHandler = (args: Record<string, unknown>, ctx: IPolicyContext) => Promise<PolicyResult>;

// ── Tool Registration Entry ─────────────────────────────────────────

export interface ToolRegistration {
  name: string;
  description: string;
  schema: Record<string, ZodType>;
  handler: PolicyHandler;
  /** If this is a deprecated alias, the canonical name */
  deprecatedAlias?: string;
}

// ── FSM Transition ──────────────────────────────────────────────────

export interface FsmTransition {
  from: string;
  to: string;
}

export type FsmTransitionTable = FsmTransition[];

export function isValidTransition(table: FsmTransitionTable, from: string, to: string): boolean {
  return table.some(t => t.from === from && t.to === to);
}
