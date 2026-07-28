/**
 * Enriched register_role handshake.
 *
 * After the bare `register_role({role})` call in `McpAgentClient.runHandshake`
 * (which proves the wire is alive and the session is bound), the agent
 * performs this enriched handshake on entry to the `synchronizing` state. It:
 *
 *   1. Re-calls `register_role` with full payload (name, clientMetadata,
 *      advisoryTags). idea-251 D-prime Phase 2: name IS identity (was
 *      globalInstanceId pre-D-prime; that field RETIRED).
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
  // M-Build-Identity-AdvisoryTag (idea-256): build-identity wire fields
  // sourced from each package's dist/build-info.json (written by the
  // shared scripts/build/write-build-info.js prepack hook). Hub
  // deriveAdvisoryTags projects these into AgentAdvisoryTags.
  proxyCommitSha?: string;
  proxyDirty?: boolean;
  sdkCommitSha?: string;
  sdkDirty?: boolean;
}

export interface HandshakeAdvisoryTags {
  /** Best-effort, drift-prone. Hub MUST NOT route on this. */
  llmModel?: string;
  [key: string]: unknown;
}

export interface HandshakePayload {
  role: string;
  clientMetadata: HandshakeClientMetadata;
  advisoryTags: HandshakeAdvisoryTags;
  labels?: Record<string, string>;
  /**
   * idea-251 D-prime Phase 2: name IS identity. REQUIRED. Sourced from the
   * `OIS_AGENT_NAME` env var by the host process; passed through here. Drives
   * agentId derivation `agent-{8-hex-of-sha256(name)}` on the Hub side.
   * (`globalInstanceId` field RETIRED in D-prime — name replaces it.)
   */
  name: string;
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

function parseJsonObject(text: string): Record<string, unknown> | null {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function parseHandshakeBody(result: unknown): { body: Record<string, unknown>; envelopeError: boolean } | null {
  if (typeof result === "string") {
    const body = parseJsonObject(result);
    return body ? { body, envelopeError: false } : null;
  }
  if (!result || typeof result !== "object") return null;

  const r = result as { content?: Array<{ text?: string }>; isError?: boolean } & Record<string, unknown>;
  if (Array.isArray(r.content) && r.content[0]?.text) {
    const body = parseJsonObject(r.content[0].text);
    return body ? { body, envelopeError: r.isError === true } : null;
  }

  // Parsed-body-directly shape: executeTool unwraps the envelope on some
  // transports (e.g. bun-serve-proxy / opencode), dropping the isError
  // flag — so the body-level `ok:false` is the failure signal. mission-93:
  // this unwrapped path is exactly why a role_mismatch rejection fell
  // through to parse_failed + silent engineer/offline degrade for Steve.
  return { body: r, envelopeError: false };
}

/**
 * Parse an MCP CallTool result for a structured handshake error payload.
 * Returns the fatal error if the result matches `{isError:true, content:[{text: <json>}]}`
 * and the JSON body has a `code` in `FATAL_CODES`. Returns null otherwise.
 */
export function parseHandshakeError(result: unknown): HandshakeFatalError | null {
  try {
    const parsed = parseHandshakeBody(result);
    if (!parsed) return null;
    const { body, envelopeError } = parsed;
    const isFailure = envelopeError || body.ok === false;
    if (isFailure && typeof body.code === "string" && FATAL_CODES.has(body.code)) {
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
 *
 * mission-63 W3: reads canonical envelope per Design v1.0 §3.1 + ADR-028 —
 * `body.agent.id` + `body.session.epoch` (not `body.agentId` + `body.sessionEpoch`).
 * The Hub-side flat-field shape is gone post-mission-63 W1+W2 (anti-goal §8.1
 * clean cutover). Adapter parses the canonical shape only.
 */
export function parseHandshakeResponse(result: unknown): HandshakeResponse | null {
  try {
    const parsed = parseHandshakeBody(result);
    if (!parsed) return null;
    const { body } = parsed;
    const agent = body.agent as Record<string, unknown> | undefined;
    const session = body.session as Record<string, unknown> | undefined;
    if (
      agent &&
      typeof agent.id === "string" &&
      session &&
      typeof session.epoch === "number"
    ) {
      return {
        agentId: agent.id,
        sessionEpoch: session.epoch,
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
  clientInfo: { name: string; version: string };
  proxyName: string;
  proxyVersion: string;
  transport: string;
  sdkVersion: string;
  // M-Build-Identity-AdvisoryTag (idea-256): build-identity from each
  // package's dist/build-info.json. Optional — host shim sets when
  // build-info.json is present; absent for older shims or extracted
  // tarballs without git context.
  proxyCommitSha?: string;
  proxyDirty?: boolean;
  sdkCommitSha?: string;
  sdkDirty?: boolean;
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
  /**
   * idea-251 D-prime Phase 2: name IS identity. REQUIRED. Operator sets via
   * `OIS_AGENT_NAME` env var; host shim passes through. Hub derives
   * `agent-{8-hex-of-sha256(name)}` agentId from this.
   */
  name: string;
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
  /**
   * True when register_role was REJECTED by a structured fatal error
   * (FATAL_CODES — e.g. role_mismatch). The caller MUST HALT, not silently
   * degrade to streaming with a fallback role. mission-93 cutover: that
   * silent degrade masked a role-change rejection for an hour.
   */
  fatal?: boolean;
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
 * the proxy identity (`@apnex/claude-plugin` / `@apnex/vertex-cloudrun` / etc.)
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
 * idea-251 D-prime Phase 2 + idea-355 SLICE-1 dedup: read the REQUIRED
 * OIS_AGENT_NAME identity (name IS identity per idea-251). Reads + trims +
 * loud-errors if absent (returns null) so misconfiguration surfaces at startup
 * rather than a silent Hub-side identity collision. The caller keeps the
 * one-line host-specific abort (claude `process.exit(2)`; opencode `return` —
 * it can't kill the TUI).
 */
export function readRequiredAgentName(log: (m: string) => void): string | null {
  const agentName = process.env.OIS_AGENT_NAME?.trim();
  if (!agentName) {
    log(
      "[Handshake] FATAL: OIS_AGENT_NAME env var required (idea-251 D-prime). Set in ~/.config/apnex-agents/{name}.env.",
    );
    return null;
  }
  log(`[Handshake] OIS_AGENT_NAME=${agentName}`);
  return agentName;
}

/**
 * Build the enriched register_role payload.
 */
export function buildHandshakePayload(config: HandshakeConfig): HandshakePayload {
  const payload: HandshakePayload = {
    role: config.role,
    name: config.name,
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
      // M-Build-Identity-AdvisoryTag (idea-256): forward build-identity
      // when host provided it; omit otherwise (Hub gracefully treats
      // absent as legacy / unknown).
      ...(config.proxyCommitSha !== undefined && { proxyCommitSha: config.proxyCommitSha }),
      ...(config.proxyDirty !== undefined && { proxyDirty: config.proxyDirty }),
      ...(config.sdkCommitSha !== undefined && { sdkCommitSha: config.sdkCommitSha }),
      ...(config.sdkDirty !== undefined && { sdkDirty: config.sdkDirty }),
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
    return { response: null, epoch: ctx.previousEpoch, fatal: true };
  }

  const response = parseHandshakeResponse(result);
  if (!response) {
    // mission-63 W3 diagnostic — capture envelope + body shape for parse
    // failures. Post-mission-63 the canonical shape is `body.agent.id` +
    // `body.session.epoch`; legacy flat fields (body.agentId + body.sessionEpoch)
    // surfacing here would indicate the Hub is on a pre-mission-63 build.
    let envelope = "unknown";
    let bodyKeys = "none";
    let nestedAgentKeys = "none";
    let nestedSessionKeys = "none";
    let legacyAgentIdType = "absent";
    let legacySessionEpochType = "absent";
    try {
      const r = result as
        | { content?: Array<{ text?: string }> }
        | Record<string, unknown>;
      let body: Record<string, unknown> = {};
      if (typeof result === "string") {
        envelope = "raw-string";
        body = parseJsonObject(result) ?? {};
      } else if (Array.isArray((r as { content?: unknown[] }).content)) {
        envelope = "content-array";
        const text = (r as { content: Array<{ text?: string }> }).content[0]
          ?.text;
        body = text ? (parseJsonObject(text) ?? {}) : {};
      } else {
        envelope = "raw-object";
        body = r as Record<string, unknown>;
      }
      bodyKeys = Object.keys(body).sort().join(",");
      if (body.agent && typeof body.agent === "object" && body.agent !== null) {
        nestedAgentKeys = Object.keys(body.agent as Record<string, unknown>)
          .sort()
          .join(",");
      }
      if (body.session && typeof body.session === "object" && body.session !== null) {
        nestedSessionKeys = Object.keys(body.session as Record<string, unknown>)
          .sort()
          .join(",");
      }
      legacyAgentIdType =
        body.agentId === undefined
          ? "undefined"
          : body.agentId === null
            ? "null"
            : typeof body.agentId;
      legacySessionEpochType =
        body.sessionEpoch === undefined
          ? "undefined"
          : body.sessionEpoch === null
            ? "null"
            : typeof body.sessionEpoch;
    } catch (err) {
      envelope = `parse-error:${(err as Error)?.message ?? String(err)}`;
    }
    // 🔴 work-598 (B4b) — ONE EXPRESSION DRIVES THE MESSAGE, THE STRUCTURED FIELD AND THE
    // RETURNED FLAG. It is declared HERE, above the log, for exactly that reason.
    //
    // WHAT WENT WRONG IN B4: the message was rewritten to assert FATAL, then fatality became
    // CONDITIONAL a few lines below, and the log did not follow. A shape-mismatch seat logged
    // "FATAL: identity was NOT bound" and kept running perfectly well — so AN OPERATOR
    // GREPPING FOR `FATAL` GOT A HIT ON A HEALTHY SEAT, and the one signal distinguishing the
    // two outcomes read identically for both.
    //
    // ⚠️ THE SHAPE OF THE DEFECT MATTERS MORE THAN THE LINE: two independent conditionals
    // describing one decision WILL drift, because nothing forces them to be edited together.
    // Deriving both from this single binding makes the drift unrepresentable rather than
    // merely fixed. (My own B3 principle, applied to my own regression: report the ACTUAL
    // effect, never the intended one — idea-681.)
    const bodyWasUnparseable = envelope.startsWith("parse-error:");
    log.log(
      "agent.handshake.parse_failed",
      // `fatal` is emitted STRUCTURALLY so an operator can filter on the field instead of
      // grepping prose — the prose is what drifted.
      { envelope, bodyKeys, nestedAgentKeys, nestedSessionKeys, legacyAgentIdType, legacySessionEpochType, fatal: bodyWasUnparseable },
      // ⚠️ BOTH branches keep the phrase "parse failed". The finding was about the FATALITY
      // CLAIM, not about the event's name — and operators (and a test) already grep that
      // phrase. Rewording it too would have been a second, unasked-for interface change
      // riding along with the fix.
      //
      // 🔴 AND THE NON-FATAL BRANCH SAYS "RECOVERABLE", NOT "NON-FATAL" — DELIBERATELY.
      // The stated harm is that AN OPERATOR GREPPING FOR `FATAL` GETS A HIT ON A HEALTHY
      // SEAT. "NON-FATAL" CONTAINS "FATAL", so `grep FATAL` would still match and the harm
      // would survive a fix that reads correct to a human. The word must be absent, not
      // negated. (My first attempt used "NON-FATAL"; the test below — which is literally the
      // operator's grep — caught it. Reasoning about the message did not.)
      bodyWasUnparseable
        ? "[Handshake] response parse failed (body was not JSON) — FATAL: identity was NOT bound, seat halts"
        : "[Handshake] response parse failed (shape not recognised) — RECOVERABLE: identity not bound this cycle, seat continues"
    );
    // 🔴 work-592 / bug-398 — AN UNPARSEABLE RESPONSE IS FATAL. THIS CLOSES THE HOLE IN THE
    // FAIL-LOUD GUARD THAT ALREADY EXISTS.
    //
    // MECHANICS: `mcp-agent-client.ts` throws on `result.fatal` (mission-93). But `fatal` was
    // only ever set by `parseHandshakeError`, which requires the error to PARSE. A response that
    // could not be parsed therefore took the NON-FATAL path BY DEFAULT, and the caller's
    // `if (result.response)` skipped the identity binding with no else, no log and no throw.
    // AN ERROR THAT CANNOT BE PARSED COULD NOT BE CLASSIFIED AS FATAL, SO MALFORMED ERRORS
    // BYPASSED THE GUARD BUILT TO CATCH BAD ERRORS.
    //
    // RATIONALE: this is bug-398's root cause. A StorageAdmissionError arrived as plaintext,
    // the parse failed, this returned success-shaped, and the session kept its ROLE while never
    // binding its AGENT ID — a live seat silently became `anonymous-<role>` with full role
    // authority and an intact registry row. `handshake.ts:99-104` has documented this exact
    // fall-through degrading a THIRD seat since mission-93, filed as a parsing nuance. It is an
    // identity-loss class, and this is the line that made it silent.
    //
    // CONSEQUENCE: the seat halts loudly at handshake instead of running unbound. That is the
    // correct trade — B3 (work-591) made hub errors parseable JSON, so reaching this line now
    // means something genuinely unexpected, not routine backpressure.
    //
    // ⚠️ SCOPE: only the PARSE failure becomes fatal. The transport-failure return above stays
    // non-fatal — a call that never completed is a retry case, and conflating the two would halt
    // seats on an ordinary reconnect.
    // ⚠️ NARROWED AFTER A FULL-SUITE FINDING — SEE THE DISCRIMINATOR BELOW.
    //
    // Marking EVERY parse failure fatal was too broad and would have halted seats on a
    // response that is valid JSON but simply not the NESTED shape this parser wants
    // (`body.agent.id` + `body.session.epoch`).
    //
    // 🔴 work-598 (B4b) — THE WARRANT, CORRECTED. THE NARROWING STANDS; ITS ORIGINAL
    // JUSTIFICATION DID NOT.
    //
    // B4 cited `LoopbackHub` as evidence that the legacy FLAT shape (`{agentId, sessionEpoch}`)
    // is emitted in production. IT IS NOT: at `50b01e96` the verifier enumerated all 21
    // references and found ZERO outside test and bench (`packages/cognitive-layer/bench/**`).
    // ⚠️ A TEST DOUBLE HAD BEEN RECORDED AS THE WITNESS FOR A PRODUCTION COMPATIBILITY CLAIM.
    // The three red integration tests proved the FIXTURE would break — not that a deployment
    // would. `LoopbackHub` is hereby dropped as the witness.
    //
    // THE ACTUAL JUSTIFICATION, which does not depend on any in-tree emitter: THIS ADAPTER
    // SHIPS TO CONSUMERS WE CANNOT OBSERVE, and an older Hub deployment may exist. That is a
    // compatibility argument about unobservable deployments, and it is the honest one —
    // precisely because it cannot be settled by grepping this tree. `legacyAgentIdType`
    // recording the flat shape shows the parser was BUILT expecting it; it does not prove
    // anyone still sends it.
    //
    // ⚠️ AND THE PROMISE WAS OVERSTATED. B4's record claimed such a hub stays "degraded but
    // running". The honest statement is DEGRADED BUT RUNNING FOR 60 SECONDS, THEN REFUSED —
    // the hub-side identity-window guard added in the SAME commit refuses that seat once
    // IDENTITY_HANDSHAKE_WINDOW_MS elapses. NO TEST EXERCISES ADAPTER AND HUB TOGETHER ON THIS
    // PATH: the adapter suite proves the seat stays up in the one package where the refusal
    // does not exist, and the hub suite never sees the adapter. That cross-package gap is
    // STATED, not closed here (idea-449's territory).
    //
    // THE DISCRIMINATOR IS WHETHER THE BODY IS JSON AT ALL. bug-398's specimen was
    // `Unexpected token 's', "storage li"... is not valid JSON` — a PLAINTEXT error where an
    // envelope was contracted, which is unambiguously wrong and unambiguously not an identity.
    // A shape mismatch is a compatibility gap; a non-JSON body is a broken contract.
    return { response: null, epoch: ctx.previousEpoch, ...(bodyWasUnparseable ? { fatal: true } : {}) };
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
