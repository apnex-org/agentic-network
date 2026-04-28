/**
 * Enriched register_role handshake.
 *
 * After the bare `register_role({role})` call in `McpAgentClient.runHandshake`
 * (which proves the wire is alive and the session is bound), the agent
 * performs this enriched handshake on entry to the `synchronizing` state. It:
 *
 *   1. Re-calls `register_role` with full payload (globalInstanceId,
 *      clientMetadata, advisoryTags).
 *   2. Parses the response for `agentId`/`sessionEpoch`/`wasCreated`.
 *   3. Tracks epoch displacement across reconnects.
 *   4. Halts on fatal codes (`agent_thrashing_detected`, `role_mismatch`).
 *
 * Fatal halt is delegated to a caller-provided `onFatalHalt` callback so
 * each engineer can implement its own shutdown path (Claude: stdio drain +
 * `process.exit(2)`; OpenCode: OpenCode lifecycle shutdown).
 */

import { hostname, platform as osPlatform } from "node:os";
import type { ILogger, LegacyStringLogger } from "../logger.js";
import { normalizeToILogger } from "../logger.js";

export const FATAL_CODES: ReadonlySet<string> = new Set([
  "agent_thrashing_detected",
  "role_mismatch",
]);

export interface HandshakeClientMetadata {
  clientName: string;
  clientVersion: string;
  proxyName: string;
  proxyVersion: string;
  transport: string;
  sdkVersion: string;
  hostname?: string;
  platform?: string;
  pid?: number;
}

export interface HandshakeAdvisoryTags {
  /** Best-effort, drift-prone. Hub MUST NOT route on this. */
  llmModel?: string;
  [key: string]: unknown;
}

export interface HandshakePayload {
  role: string;
  globalInstanceId: string;
  clientMetadata: HandshakeClientMetadata;
  advisoryTags: HandshakeAdvisoryTags;
  labels?: Record<string, string>;
}

export interface HandshakeResponse {
  agentId: string;
  sessionEpoch: number;
  wasCreated: boolean;
}

export interface HandshakeFatalError {
  code: string;
  message: string;
}

/**
 * Parse an MCP CallTool result for a structured handshake error payload.
 * Returns the fatal error if the result matches `{isError:true, content:[{text: <json>}]}`
 * and the JSON body has a `code` in `FATAL_CODES`. Returns null otherwise.
 */
export function parseHandshakeError(result: unknown): HandshakeFatalError | null {
  try {
    const r = result as { content?: Array<{ text?: string }>; isError?: boolean };
    if (!r || r.isError !== true || !Array.isArray(r.content) || !r.content[0]?.text) {
      return null;
    }
    const body = JSON.parse(r.content[0].text);
    if (body && typeof body.code === "string" && FATAL_CODES.has(body.code)) {
      return { code: body.code, message: String(body.message ?? "") };
    }
  } catch {
    /* not a structured error — fall through */
  }
  return null;
}

/**
 * Parse a successful handshake response. The adapter's executeTool returns
 * parsed JSON directly, but some code paths deliver the raw `{content:[{text}]}`
 * envelope — handle both.
 */
export function parseHandshakeResponse(result: unknown): HandshakeResponse | null {
  try {
    const r = result as { content?: Array<{ text?: string }> } | Record<string, unknown>;
    let body: Record<string, unknown>;
    if (Array.isArray((r as { content?: unknown[] }).content)) {
      const text = (r as { content: Array<{ text?: string }> }).content[0]?.text;
      body = text ? JSON.parse(text) : {};
    } else {
      body = r as Record<string, unknown>;
    }
    if (typeof body.agentId === "string" && typeof body.sessionEpoch === "number") {
      return {
        agentId: body.agentId,
        sessionEpoch: body.sessionEpoch,
        wasCreated: Boolean(body.wasCreated),
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export interface HandshakeConfig {
  role: string;
  globalInstanceId: string;
  clientInfo: { name: string; version: string };
  proxyName: string;
  proxyVersion: string;
  transport: string;
  sdkVersion: string;
  llmModel?: string;
  /**
   * Mission-19 routing labels. Forwarded as the `labels` arg on the
   * enriched register_role call. Hub persists them on the Agent entity
   * (immutable after first create — INV-AG1), and subsequent
   * `task.labels` / dispatch selectors inherit from the Agent. Omit to
   * keep legacy broadcast semantics (labels = {}).
   */
  labels?: Record<string, string>;
  /**
   * ADR-017: optional durable-wake HTTP endpoint. When set, the Hub
   * POSTs here on queue-deadline miss to cold-start scaled-to-zero
   * agents. For Cloud Run architects, this is the service URL. Absent
   * for interactive CLI agents — watchdog skips Stage 1 re-dispatch and
   * escalates directly to Director notification.
   */
  wakeEndpoint?: string;
  /**
   * ADR-017: optional per-agent receipt-SLA override in milliseconds.
   * When omitted, Hub uses DEFAULT_AGENT_RECEIPT_SLA_MS (30000).
   */
  receiptSla?: number;
}

export interface HandshakeContext {
  /** Tool executor — typically `transport.request.bind(transport)`. */
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  config: HandshakeConfig;
  /** Previous session epoch for displacement detection. 0 if unknown. */
  previousEpoch: number;
  /**
   * Structured logger for diagnostics + the canonical `[Handshake] Registered as …`
   * line. A legacy `(msg: string) => void` is auto-bridged for tests and
   * shims that haven't migrated to `ILogger` yet.
   */
  log: ILogger | LegacyStringLogger;
  /** Invoked on fatal codes. Implementations should terminate the process. */
  onFatalHalt?: (err: HandshakeFatalError) => void;
}

export interface HandshakeResult {
  /** Parsed response, or null if the handshake failed (non-fatally). */
  response: HandshakeResponse | null;
  /** New epoch to persist for the next reconnect's displacement check. */
  epoch: number;
}

/**
 * bug-17 fix: resolve clientName / clientVersion with proxy-fallback.
 *
 * The MCP `initialize` handshake is supposed to carry the host's `clientInfo`
 * (name + version), but some hosts — notably the claude-plugin dev-channel
 * load path (`claude --dangerously-load-development-channels`) — don't
 * forward clientInfo through the stdio transport. The Hub then persists
 * `clientName: "unknown"` + `clientVersion: "0.0.0"` into the Agent record,
 * losing the identity signal entirely.
 *
 * Fallback policy: when either field is missing/empty/sentinel, substitute
 * the proxy identity (`@ois/claude-plugin` / `@ois/vertex-cloudrun` / etc.)
 * which is authoritative at the adapter layer. The Agent record then
 * surfaces a meaningful identity even when MCP clientInfo is absent.
 *
 * Exported for unit-test access.
 */
export function resolveClientName(raw: string | undefined, proxyName: string): string {
  if (!raw || raw === "unknown") return proxyName;
  return raw;
}

export function resolveClientVersion(raw: string | undefined, proxyVersion: string): string {
  if (!raw || raw === "0.0.0") return proxyVersion;
  return raw;
}

/**
 * Build the enriched register_role payload.
 */
export function buildHandshakePayload(config: HandshakeConfig): HandshakePayload {
  const payload: HandshakePayload = {
    role: config.role,
    globalInstanceId: config.globalInstanceId,
    clientMetadata: {
      clientName: resolveClientName(config.clientInfo.name, config.proxyName),
      clientVersion: resolveClientVersion(config.clientInfo.version, config.proxyVersion),
      proxyName: config.proxyName,
      proxyVersion: config.proxyVersion,
      transport: config.transport,
      sdkVersion: config.sdkVersion,
      hostname: hostname(),
      platform: osPlatform(),
      pid: process.pid,
    },
    advisoryTags: {
      llmModel: config.llmModel ?? "unknown",
    },
  };
  if (config.labels) payload.labels = config.labels;
  if (config.wakeEndpoint) (payload as unknown as Record<string, unknown>).wakeEndpoint = config.wakeEndpoint;
  if (typeof config.receiptSla === "number") (payload as unknown as Record<string, unknown>).receiptSla = config.receiptSla;
  return payload;
}

/**
 * Perform the enriched handshake. Never throws on tool-call failure — a
 * transport or session error is logged and returned as
 * `{response:null, epoch:previousEpoch}` so the caller can continue state
 * sync. A fatal code (`agent_thrashing_detected`, `role_mismatch`) triggers
 * `onFatalHalt` and then also returns null.
 */
export async function performHandshake(
  ctx: HandshakeContext
): Promise<HandshakeResult> {
  const log = normalizeToILogger(ctx.log, "Handshake");
  const payload = buildHandshakePayload(ctx.config);

  let result: unknown;
  try {
    result = await ctx.executeTool("register_role", payload as unknown as Record<string, unknown>);
  } catch (err) {
    log.log(
      "agent.handshake.tool_call_failed",
      { error: String(err) },
      `[Handshake] tool-call failed (non-fatal, retry on reconnect): ${err}`
    );
    return { response: null, epoch: ctx.previousEpoch };
  }

  const fatal = parseHandshakeError(result);
  if (fatal) {
    log.log(
      "agent.handshake.fatal",
      { code: fatal.code, message: fatal.message },
      `[Handshake] FATAL ${fatal.code}: ${fatal.message}`
    );
    if (ctx.onFatalHalt) ctx.onFatalHalt(fatal);
    return { response: null, epoch: ctx.previousEpoch };
  }

  const response = parseHandshakeResponse(result);
  if (!response) {
    // P0 triage 2026-04-28 — capture the actual envelope + body shape
    // we failed to parse. bodyKeys + agentIdType + sessionEpochType pin
    // Hub-side schema drift; nestedAgentKeys surfaces if wire migrated
    // to entity-shaped form (`body.agent.id` instead of `body.agentId`).
    let envelope = "unknown";
    let bodyKeys = "none";
    let agentIdType = "absent";
    let sessionEpochType = "absent";
    let nestedAgentKeys = "none";
    try {
      const r = result as
        | { content?: Array<{ text?: string }> }
        | Record<string, unknown>;
      let body: Record<string, unknown> = {};
      if (Array.isArray((r as { content?: unknown[] }).content)) {
        envelope = "content-array";
        const text = (r as { content: Array<{ text?: string }> }).content[0]
          ?.text;
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } else {
        envelope = "raw-object";
        body = r as Record<string, unknown>;
      }
      bodyKeys = Object.keys(body).sort().join(",");
      agentIdType =
        body.agentId === undefined
          ? "undefined"
          : body.agentId === null
            ? "null"
            : typeof body.agentId;
      sessionEpochType =
        body.sessionEpoch === undefined
          ? "undefined"
          : body.sessionEpoch === null
            ? "null"
            : typeof body.sessionEpoch;
      if (body.agent && typeof body.agent === "object" && body.agent !== null) {
        nestedAgentKeys = Object.keys(body.agent as Record<string, unknown>)
          .sort()
          .join(",");
      }
    } catch (err) {
      envelope = `parse-error:${(err as Error)?.message ?? String(err)}`;
    }
    log.log(
      "agent.handshake.parse_failed",
      { envelope, bodyKeys, agentIdType, sessionEpochType, nestedAgentKeys },
      "[Handshake] response parse failed (non-fatal)"
    );
    return { response: null, epoch: ctx.previousEpoch };
  }

  // M-Session-Claim-Separation (mission-40) T3 HC #1: post-T2 register_role
  // is pure identity assertion — does NOT increment sessionEpoch. The
  // previousEpoch vs response.sessionEpoch comparison no longer detects
  // "I just took over" (that signal lives on claim_session's response
  // shape: sessionClaimed + displacedPriorSession). It still detects
  // "someone else claimed our identity between our last register_role
  // and this one": any positive delta means an out-of-band claim happened.
  // Pre-T2 the threshold was `> 1` (because register_role itself bumped
  // by 1 on every call). Post-T2 the threshold is `> 0`.
  //
  // Takeover detection inside the adapter (claude-plugin shim.ts T3) keys
  // on the claim_session response fields, NOT on this delta — see
  // mission-40 brief §3 T3 + anti-goal §7.5.
  if (ctx.previousEpoch > 0 && response.sessionEpoch - ctx.previousEpoch > 0) {
    log.log(
      "agent.handshake.epoch_jump",
      { from: ctx.previousEpoch, to: response.sessionEpoch },
      `[Handshake] sessionEpoch advanced from ${ctx.previousEpoch} to ${response.sessionEpoch} between register_role calls — an external claim_session has displaced our prior session; in-flight RPCs from prior epoch may be abandoned`
    );
  }
  log.log(
    "agent.handshake.registered",
    {
      agentId: response.agentId,
      epoch: response.sessionEpoch,
      wasCreated: response.wasCreated,
    },
    `[Handshake] Registered as ${response.agentId} (epoch=${response.sessionEpoch}${response.wasCreated ? ", newly created" : ""})`
  );

  return { response, epoch: response.sessionEpoch };
}

/**
 * Build a fatal-halt function with a stdio drain delay. Engineers that use
 * stdio transports (Claude) MUST use this to avoid losing the halt message
 * to an unflushed buffer. Engineers that do not (OpenCode) can implement
 * their own `onFatalHalt` directly.
 */
export function makeStdioFatalHalt(
  log: (msg: string) => void,
  exit: (code: number) => void = process.exit.bind(process) as (code: number) => void,
  drainMs = 100
): (err: HandshakeFatalError) => void {
  return (err) => {
    const text = `[FATAL:${err.code}] ${err.message}`;
    log(text);
    setTimeout(() => exit(2), drainMs);
  };
}
