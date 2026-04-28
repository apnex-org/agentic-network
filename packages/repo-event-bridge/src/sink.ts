/**
 * MessageSink — sovereign-package contract for repo-event delivery.
 *
 * Mission-52 T1. Defines the contract that an EventSource consumer
 * uses to deliver translated `RepoEvent`s into the Hub. T1 ships the
 * interface + a stub implementation that calls mission-51 W6's
 * `create_message` MCP verb via an injected callable; T3 wires the
 * real Hub-side sink (in-process or out-of-process MCP transport,
 * authentication, retries) per the sovereign-package activation
 * directive.
 *
 * Why a stub at T1: the contract is the load-bearing artifact —
 * downstream T3 work composes any concrete `create_message` caller
 * against this surface, and T2 (PollSource) can wire its iterator
 * straight into a stub for end-to-end fixture replay without
 * standing up Hub transport.
 *
 * The stub deliberately avoids importing `@apnex/network-adapter` or
 * any MCP-transport surface — keeping the package dep graph minimal
 * (per directive) and letting T3 choose the concrete transport
 * (in-process vs. MCP-stdio vs. MCP-HTTP) without re-shaping the
 * contract.
 */

import type { RepoEvent } from "./event-source.js";

// ── Sink contract ─────────────────────────────────────────────────────

/**
 * The contract every sink implementation satisfies. `emit` consumes
 * one `RepoEvent` and is responsible for delivery to the Hub. Errors
 * propagate; consumers (PollSource / WebhookSource / fixture replay)
 * decide retry policy.
 *
 * Sinks SHOULD be idempotent at the upstream-event-id level — the
 * consumer may call `emit` more than once for the same upstream
 * event under failure recovery. Idempotency belongs in the sink
 * (call-side) so the source can stay simple.
 */
export interface MessageSink {
  emit(event: RepoEvent): Promise<void>;
}

// ── Stub: create_message-calling sink ────────────────────────────────

/**
 * Shape of the `create_message` MCP verb argument envelope. Mirrors
 * the W6 verb's parameter schema (see
 * `hub/src/policy/message-policy.ts`). Reproduced here as a literal
 * type so the package stays dep-free against `hub/`; T3 will adapt
 * if the Hub-side schema evolves.
 */
export interface CreateMessageArgs {
  kind: string;
  target: { role?: string; agentId?: string } | null;
  delivery?: "push-immediate" | "queued" | "scheduled";
  payload: unknown;
  intent?: string;
  semanticIntent?: string;
  fireAt?: string;
  precondition?: unknown;
  priorAuthorAgentId?: string;
}

/**
 * Caller-supplied function that invokes the Hub's `create_message`
 * MCP verb. T1 leaves the wire-up abstract — T3 can pass an
 * in-process policy invocation, an MCP-stdio call, or an HTTP MCP
 * call without changing the sink contract.
 */
export type CreateMessageInvoker = (
  args: CreateMessageArgs,
) => Promise<{ messageId?: string } & Record<string, unknown>>;

/**
 * Configuration for the stub sink. `target` defaults to broadcast
 * (`null`) — repo events are typically routed to whichever subscribers
 * the Hub has registered, not pinpointed. `messageKind` defaults to
 * `"external-injection"` — the W1 Message-kind whose axes (no turn
 * required, any author) match a system-emitted upstream event.
 */
export interface CreateMessageSinkOptions {
  /** MCP-verb invoker (T3 wires the concrete transport). */
  readonly invoke: CreateMessageInvoker;
  /** Message.kind on the Hub side. Defaults to `"external-injection"`. */
  readonly messageKind?: string;
  /** Message.target audience. Defaults to `null` (broadcast). */
  readonly target?: { role?: string; agentId?: string } | null;
  /** Optional intent metadata stamped on every emitted message. */
  readonly intent?: string;
  /** Optional semanticIntent metadata stamped on every emitted message. */
  readonly semanticIntent?: string;
}

/**
 * Stub sink that maps `RepoEvent` → `create_message` invocation. The
 * full `RepoEvent` envelope (`{kind, subkind, payload}`) is nested
 * under the Hub Message's `payload` field — sink-side dispatch in
 * the Hub reads `payload.kind === "repo-event"` to route, then
 * `payload.subkind` for per-type semantics.
 *
 * Concrete production sink (T3) may add: dedupe via
 * StorageProvider-backed seen-ids set, retry with backoff, batched
 * delivery, etc. The stub is deliberately minimal — it proves the
 * contract end-to-end via fixture replay.
 */
export class CreateMessageSink implements MessageSink {
  private readonly invoke: CreateMessageInvoker;
  private readonly messageKind: string;
  private readonly target: { role?: string; agentId?: string } | null;
  private readonly intent?: string;
  private readonly semanticIntent?: string;

  constructor(options: CreateMessageSinkOptions) {
    this.invoke = options.invoke;
    this.messageKind = options.messageKind ?? "external-injection";
    this.target = options.target ?? null;
    this.intent = options.intent;
    this.semanticIntent = options.semanticIntent;
  }

  async emit(event: RepoEvent): Promise<void> {
    await this.invoke({
      kind: this.messageKind,
      target: this.target,
      delivery: "push-immediate",
      payload: event,
      intent: this.intent,
      semanticIntent: this.semanticIntent,
    });
  }
}
