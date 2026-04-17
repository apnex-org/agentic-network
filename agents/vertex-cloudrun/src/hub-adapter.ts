/**
 * Hub Adapter — typed wrapper around McpAgentClient.
 *
 * Provides typed methods for Hub tools. All connection lifecycle is
 * delegated to McpAgentClient from @ois/network-adapter. Uses manualSync
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
} from "@ois/network-adapter";

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
          proxyName: "@ois/vertex-cloudrun",
          proxyVersion,
          transport: "http",
          sdkVersion: "@ois/network-adapter@2.0.0",
          getClientInfo: () => ({ name: serviceName, version: proxyVersion }),
        }
      : undefined;

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

  async createThreadReply(
    threadId: string,
    message: string,
    converged: boolean = false,
    intent?: string
  ): Promise<unknown> {
    const args: Record<string, unknown> = { threadId, message };
    if (converged) args.converged = true;
    if (intent) args.intent = intent;
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
