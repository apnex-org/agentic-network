/**
 * Hub Adapter — typed wrapper around McpAgentClient.
 *
 * Provides typed methods for Hub tools. All connection lifecycle is
 * delegated to McpAgentClient from @apnex/network-adapter. Uses manualSync
 * mode: the Architect owns its own state-sync pipeline and drives
 * `completeSync()` externally via `onSync()`.
 *
 * Phase 7 of the L4/L7 refactor: retired UniversalClientAdapter +
 * IClientShim in favour of McpAgentClient + AgentClientCallbacks.
 */

import {
  McpAgentClient,
  McpTransport,
  type AgentClientCallbacks,
  type AgentEvent,
  type SessionState,
  type SessionReconnectReason,
} from "@apnex/network-adapter";
import { CognitivePipeline } from "@apnex/cognitive-layer";
import { architectTelemetrySink } from "./telemetry.js";

export type HubEventHandler = (eventData: Record<string, unknown>) => void;

export interface HubAdapterOptions {
  /**
   * Mission-19 routing labels (e.g. {env:"prod"}). Only take effect
   * when an enriched handshake runs (i.e. `globalInstanceId` is also
   * provided); otherwise the Hub's bare-path register_role drops them.
   */
  labels?: Record<string, string>;
  /**
   * Stable client identifier. When set, the architect runs the M18
   * enriched handshake so an Agent entity is created/updated with
   * `labels` and routing selectors can exclude it. In Cloud Run, set
   * this via a terraform-managed env var so Agent identity survives
   * revision churn.
   */
  globalInstanceId?: string;
  /** Human-readable client name surfaced in clientMetadata. Defaults to "architect-cloudrun". */
  serviceName?: string;
  /** Proxy version surfaced in clientMetadata. Defaults to "0.0.0". */
  proxyVersion?: string;
  /**
   * ADR-017: durable-wake HTTP endpoint. Hub POSTs here on queue-deadline
   * miss to cold-start the architect from Cloud Run scale-to-zero. In
   * production this is the architect's own Cloud Run service URL (set
   * via ARCHITECT_WAKE_ENDPOINT env var from terraform).
   */
  wakeEndpoint?: string;
}

export class HubAdapter {
  private agent: McpAgentClient;

  /** @deprecated Use onActionable/onInformational instead. Kept for backward compat. */
  public onEvent: HubEventHandler | null = null;

  private onSyncRequired: (() => void) | null = null;

  constructor(
    hubUrl: string,
    hubToken: string,
    role: string = "architect",
    opts: HubAdapterOptions = {}
  ) {
    const serviceName = opts.serviceName ?? "architect-cloudrun";
    const proxyVersion = opts.proxyVersion ?? "0.0.0";
    const handshake = opts.globalInstanceId
      ? {
          globalInstanceId: opts.globalInstanceId,
          proxyName: "@apnex/vertex-cloudrun",
          proxyVersion,
          transport: "http",
          sdkVersion: "@apnex/network-adapter@2.0.0",
          getClientInfo: () => ({ name: serviceName, version: proxyVersion }),
          wakeEndpoint: opts.wakeEndpoint,
        }
      : undefined;

    // Phase 2b ckpt-C — wire the cognitive pipeline into the architect
    // McpAgentClient so ResponseSummarizer trims oversized Hub responses
    // (e.g. get_idea on idea-102 returns 72k tokens pre-trim), ToolResultCache
    // collapses repeated reads within a sandwich, and WriteCallDedup
    // collapses concurrent duplicate writes. Tool-call telemetry lands
    // on the same `[ArchitectTelemetry]` log pipe as the llm_usage events
    // from the sandwich bridge.
    this.agent = new McpAgentClient(
      {
        role,
        labels: opts.labels,
        logger: (msg) => console.log(`[HubAdapter] ${msg}`),
        handshake,
      },
      {
        transportConfig: { url: hubUrl, token: hubToken },
        manualSync: true,
        cognitive: CognitivePipeline.standard({
          telemetry: { sink: architectTelemetrySink },
          // Task-311 (M-Hypervisor-Adapter-Mitigations Task 2): ToolResultCache
          // is enabled by standard() with a 30s default TTL and
          // FlushAllOnWriteStrategy (prefix-detected write-action
          // invalidation). Override the TTL via HUB_ADAPTER_CACHE_TTL_MS
          // env var for tunability without a redeploy-code-change cycle.
          toolResultCache: {
            ttlMs: parseInt(process.env.HUB_ADAPTER_CACHE_TTL_MS ?? "30000", 10),
          },
        }),
      }
    );

    const callbacks: AgentClientCallbacks = {
      onActionableEvent: (event: AgentEvent) => {
        if (this.onEvent) {
          this.onEvent({
            event: event.event,
            data: event.data,
            timestamp: event.timestamp,
            id: event.id,
          });
        }
      },
      onInformationalEvent: (event: AgentEvent) => {
        if (this.onEvent) {
          this.onEvent({
            event: event.event,
            data: event.data,
            timestamp: event.timestamp,
            id: event.id,
          });
        } else {
          console.log(`[HubAdapter] Informational: ${event.event}`);
        }
      },
      onStateChange: (
        state: SessionState,
        prev: SessionState,
        reason?: SessionReconnectReason
      ) => {
        console.log(`[HubAdapter] Connection: ${prev} → ${state}${reason ? ` (${reason})` : ""}`);
        if (state === "synchronizing" && this.onSyncRequired) {
          this.onSyncRequired();
        }
      },
    };
    this.agent.setCallbacks(callbacks);
  }

  get isConnected(): boolean {
    return this.agent.isConnected;
  }

  async connect(): Promise<void> {
    await this.agent.start();
  }

  async close(): Promise<void> {
    await this.agent.stop();
  }

  // ── Generic Tool Call ────────────────────────────────────────────

  async callTool(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<unknown> {
    return await this.agent.call(name, args);
  }

  // ── Typed Tool Methods ───────────────────────────────────────────

  async getPendingActions(): Promise<Record<string, unknown>> {
    return (await this.callTool("get_pending_actions")) as Record<
      string,
      unknown
    >;
  }

  /**
   * ADR-017: drain the architect's pending-actions queue. Returns items
   * that were enqueued by the Hub (owed responses); each carries an `id`
   * that must be passed as `sourceQueueItemId` on the settling tool call
   * (e.g., create_thread_reply) to complete-ACK. Absent drain + settle-ack
   * the watchdog escalates after 3× receiptSla.
   */
  async drainPendingActions(): Promise<{
    items: Array<{
      id: string;
      dispatchType: string;
      entityRef: string;
      payload: Record<string, unknown>;
    }>;
  }> {
    const result = await this.callTool("drain_pending_actions");
    if (result && typeof result === "object" && Array.isArray((result as any).items)) {
      return result as any;
    }
    return { items: [] };
  }

  async createReview(taskId: string, assessment: string): Promise<unknown> {
    return await this.callTool("create_review", { taskId, assessment });
  }

  async createAuditEntry(
    action: string,
    details: string,
    relatedEntity?: string
  ): Promise<unknown> {
    const args: Record<string, unknown> = { action, details };
    if (relatedEntity) args.relatedEntity = relatedEntity;
    return await this.callTool("create_audit_entry", args);
  }

  async getDocument(path: string): Promise<string | null> {
    try {
      const result = await this.callTool("get_document", { path });
      return typeof result === "string" ? result : null;
    } catch {
      return null;
    }
  }

  async createThreadReply(args: Record<string, unknown>): Promise<unknown> {
    return await this.callTool("create_thread_reply", args);
  }

  async getThread(threadId: string): Promise<Record<string, unknown> | null> {
    try {
      return (await this.callTool("get_thread", {
        threadId,
      })) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async closeThread(threadId: string): Promise<boolean> {
    try {
      await this.callTool("close_thread", { threadId });
      return true;
    } catch {
      return false;
    }
  }

  async resolveClarification(
    taskId: string,
    answer: string
  ): Promise<unknown> {
    return await this.callTool("resolve_clarification", {
      taskId,
      answer,
    });
  }

  async createProposalReview(
    proposalId: string,
    decision: string,
    feedback: string
  ): Promise<unknown> {
    return await this.callTool("create_proposal_review", {
      proposalId,
      decision,
      feedback,
    });
  }

  async getReport(): Promise<Record<string, unknown> | null> {
    try {
      return (await this.callTool("get_report")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async createTask(
    title: string,
    description: string,
    correlationId?: string,
    sourceThreadId?: string
  ): Promise<unknown> {
    const args: Record<string, unknown> = { title, description };
    if (correlationId) args.correlationId = correlationId;
    if (sourceThreadId) args.sourceThreadId = sourceThreadId;
    return await this.callTool("create_task", args);
  }

  async listTools(): Promise<unknown[]> {
    const transport = this.agent.getTransport() as McpTransport;
    return await transport.listToolsRaw();
  }

  /**
   * Complete the synchronization phase.
   * Transitions from "synchronizing" to "streaming" and flushes
   * any events buffered during synchronization.
   */
  completeSync(): void {
    this.agent.completeSync();
  }

  /**
   * Set callback for when synchronizing state is entered.
   * Used to trigger immediate get_pending_actions polling.
   */
  onSync(callback: () => void): void {
    this.onSyncRequired = callback;
  }
}
