/**
 * shim.ts — Claude Code ↔ Hub last-mile shim (platform entry).
 *
 * Claude-specific wiring only: stdio transport, config loading, process
 * lifecycle. All MCP tool dispatching + Hub event bridging lives in
 * dispatcher.ts (host-independent and testable).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpAgentClient, loadOrCreateGlobalInstanceId, appendNotification, makeStdioFatalHalt, } from "@ois/network-adapter";
import { CognitivePipeline } from "@ois/cognitive-layer";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDispatcher, makePendingActionItemHandler } from "./dispatcher.js";
import { isEagerWarmupEnabled, parseClaimSessionResponse, formatSessionClaimedLogLine } from "./eager-claim.js";
import { readCache, writeCache } from "./tool-catalog-cache.js";
function parseLabels(raw, source) {
    if (!raw)
        return undefined;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const out = {};
            for (const [k, v] of Object.entries(parsed)) {
                if (typeof v === "string")
                    out[k] = v;
            }
            return Object.keys(out).length > 0 ? out : undefined;
        }
    }
    catch (err) {
        console.error(`WARNING: Failed to parse labels from ${source}: ${err}`);
    }
    return undefined;
}
function loadConfig() {
    const workDir = process.env.WORK_DIR || process.cwd();
    const configPath = resolve(workDir, ".ois", "adapter-config.json");
    let fileConfig = {};
    if (existsSync(configPath)) {
        try {
            const raw = JSON.parse(readFileSync(configPath, "utf-8"));
            fileConfig = {
                hubUrl: raw.hubUrl,
                hubToken: raw.hubToken,
                role: raw.role,
                labels: raw.labels,
            };
        }
        catch (err) {
            console.error(`WARNING: Failed to parse ${configPath}: ${err}`);
        }
    }
    const hubUrl = process.env.OIS_HUB_URL || fileConfig.hubUrl || "";
    const hubToken = process.env.OIS_HUB_TOKEN || fileConfig.hubToken || "";
    const role = process.env.OIS_HUB_ROLE || fileConfig.role || "engineer";
    const labels = parseLabels(process.env.OIS_HUB_LABELS, "OIS_HUB_LABELS env var") ?? fileConfig.labels;
    if (!hubUrl || !hubToken) {
        console.error("ERROR: Hub credentials not found. Checked .ois/adapter-config.json and OIS_HUB_URL/OIS_HUB_TOKEN env vars");
        process.exit(1);
    }
    return { hubUrl, hubToken, role, labels };
}
const config = loadConfig();
const WORK_DIR = process.env.WORK_DIR || process.cwd();
const LOG_FILE = join(WORK_DIR, ".ois", "claude-notifications.log");
const SHUTDOWN_TIMEOUT_MS = 3000;
const PROXY_VERSION = "1.1.0";
const SDK_VERSION = "@ois/network-adapter@2.0.0";
// ── Logging (stderr + shared structured log) ────────────────────────
function log(msg) {
    const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
    process.stderr.write(`[${ts}] ${msg}\n`);
}
// ── Graceful Shutdown ───────────────────────────────────────────────
let agent = null;
let shuttingDown = false;
async function shutdown() {
    if (shuttingDown)
        return;
    shuttingDown = true;
    log("Shutting down...");
    const timeout = setTimeout(() => {
        log("Shutdown timeout — force exit");
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    try {
        if (agent)
            await agent.stop();
    }
    catch (err) {
        log(`Shutdown error: ${err}`);
    }
    clearTimeout(timeout);
    log("Clean shutdown complete");
    process.exit(0);
}
// ── Main ────────────────────────────────────────────────────────────
async function main() {
    log("=== Claude Plugin Agent Adapter starting ===");
    log(`Hub: ${config.hubUrl}`);
    log(`Role: ${config.role}`);
    log(`Log: ${LOG_FILE}`);
    const globalInstanceId = loadOrCreateGlobalInstanceId({ log });
    log(`[Handshake] globalInstanceId=${globalInstanceId}`);
    const fatalHalt = makeStdioFatalHalt(log);
    if (config.labels) {
        log(`Labels: ${JSON.stringify(config.labels)}`);
    }
    // Dispatcher-first, agent-second wiring: the dispatcher owns the MCP
    // Server instance + captured clientInfo + pendingActionMap. The agent
    // receives dispatcher.getClientInfo as its handshake callback so
    // clientInfo flows through whenever it's captured from Claude Code.
    // We create a forward reference the agent can close over before it
    // exists.
    let dispatcherRef = null;
    const getClientInfo = () => (dispatcherRef ? dispatcherRef.getClientInfo() : { name: "unknown", version: "0.0.0" });
    agent = new McpAgentClient({
        role: config.role,
        labels: config.labels,
        logger: log,
        handshake: {
            globalInstanceId,
            proxyName: "@ois/claude-plugin",
            proxyVersion: PROXY_VERSION,
            transport: "stdio-mcp-proxy",
            sdkVersion: SDK_VERSION,
            getClientInfo,
            llmModel: process.env.HUB_LLM_MODEL,
            onFatalHalt: fatalHalt,
            onHandshakeComplete: (r) => {
                // M-Session-Claim-Separation (mission-40) T3: structured-parseable
                // [Handshake] log lines for dashboard / diagnostic tooling
                // consumption. Format pinned by brief §3 T3 HC #5.
                log(`[Handshake] Identity asserted: ${r.engineerId}`);
                // Resolve early-phase gate so ListTools unblocks now (~500ms
                // post-spawn) instead of waiting for the full sync phase.
                resolveIdentityReady();
                // T3 lazy-claim semantics:
                //  - eager mode (OIS_EAGER_SESSION_CLAIM=1): kick off explicit
                //    claim_session in the background; resolve sessionReady on
                //    claim success (not before — CallTool gate blocks until
                //    the Hub confirms the explicit claim).
                //  - lazy mode (env unset, default): resolve sessionReady
                //    immediately. Hub-side T2 auto-claim hooks (SSE-subscribe
                //    + first-tools/call) handle the actual claim server-side
                //    when the next observable event happens; the adapter does
                //    not need to intervene. CallTool gate unblocks immediately.
                //
                // Probes (e.g. claude mcp list) inherit env from parent shell
                // but do NOT set OIS_EAGER_SESSION_CLAIM, so they land on the
                // lazy branch — they exit before any tool call or SSE subscribe
                // fires, leaving session state untouched (bug-26 resolution
                // at the adapter layer; Hub-side closure landed in T2).
                if (eagerWarmup) {
                    const a = agent;
                    if (!a) {
                        log("[Handshake] Eager claim_session aborted — agent reference null (should be impossible)");
                        rejectSessionReady(new Error("eager claim_session: agent reference null"));
                        return;
                    }
                    a.call("claim_session", {})
                        .then((wrapper) => {
                        // Pure helpers in eager-claim.ts handle response unwrapping +
                        // log-line formatting (testable without spinning up shim main()).
                        // HC #1: takeover detection keys on sessionClaimed +
                        // displacedPriorSession surfaced through parseClaimSessionResponse,
                        // NOT on epoch delta against any prior register_role response.
                        const parsed = parseClaimSessionResponse(wrapper);
                        log(formatSessionClaimedLogLine(parsed));
                        resolveSessionReady();
                    })
                        .catch((err) => {
                        log(`[Handshake] Eager claim_session failed: ${err}`);
                        rejectSessionReady(err);
                    });
                }
                else {
                    // Lazy mode: resolve sessionReady immediately. Hub auto-claims
                    // when first SSE-subscribe or first-tools/call happens (T2).
                    log("[Handshake] Session claim deferred (lazy mode; Hub auto-claim on first SSE-subscribe / first-tools/call)");
                    resolveSessionReady();
                }
            },
            onPendingTask: (task) => {
                appendNotification({ event: "task_issued", data: task, action: "Pick up with get_task" }, { logPath: LOG_FILE, mirror: (block) => process.stderr.write(block) });
            },
            onPendingActionItem: (item) => {
                if (dispatcherRef) {
                    makePendingActionItemHandler(dispatcherRef, {
                        logPath: LOG_FILE,
                        mirror: (block) => process.stderr.write(block),
                    })(item);
                }
            },
        },
    }, {
        transportConfig: {
            url: config.hubUrl,
            token: config.hubToken,
        },
        // M-Cognitive-Hypervisor Phase 2x P1-5 — engineer-side pipeline
        // wiring. Mirrors the architect's ckpt-C change (commit 0d08a33):
        // ResponseSummarizer trims oversized Hub responses, ToolResultCache
        // collapses repeated reads within a conversation, WriteCallDedup
        // collapses concurrent duplicate writes, CircuitBreaker fast-fails
        // on repeated Hub failures. Telemetry events land on stderr via
        // the existing `log()` channel for observability parity with
        // other plugin-side diagnostics.
        cognitive: CognitivePipeline.standard({
            telemetry: {
                sink: (event) => {
                    try {
                        log(`[ClaudePluginTelemetry] ${JSON.stringify(event)}`);
                    }
                    catch {
                        /* never disturb the tool-call loop */
                    }
                },
            },
        }),
    });
    // M-Session-Claim-Separation (mission-40) T3: three-phase ready signal.
    //
    //   identityReady (was handshakeComplete) — resolves when register_role
    //     returns (transport connected + identity asserted). ~500ms typical.
    //     Gates ListTools so the host's catalog fetch unblocks fast.
    //
    //   sessionReady (NEW) — resolves when:
    //     (a) eager mode: claim_session MCP tool returns sessionClaimed=true
    //     (b) lazy mode: identityReady resolves (Hub auto-claims server-side
    //         when first SSE-subscribe or first-tools/call fires; the adapter
    //         doesn't need to intervene).
    //     Gates CallTool so tool dispatch waits until the session is
    //     either explicitly claimed or known-to-be-claim-eligible.
    //
    //   syncReady (was agentReady) — resolves when full agent.start() returns
    //     (handshake + runSynchronizingPhase + initial drain). Multi-second
    //     for architects with non-empty pending-action queues. Tracked for
    //     diagnostic logging only — CallTool gates on sessionReady (faster
    //     and semantically correct) per T3 brief §3.
    //
    // Eager-warmup env hint: OIS_EAGER_SESSION_CLAIM=1 → adapter calls
    // claim_session explicitly in parallel with agent.start(). Wrapper
    // scripts (start-greg.sh, start-lily.sh) set this. Probes inherit env
    // from parent shell but do NOT set the var, so they stay lazy and
    // never trigger an explicit claim — the declarative boundary that
    // preserves bug-26 resolution at the adapter layer (Hub-side closure
    // landed in T2 commit a011fcd).
    //
    // Why split (originally bug from 3bf3bdd): single-phase agentReady gate
    // on ListTools produced empty tool surfaces for architects whose drain
    // ran longer than the host's tools/list patience. T3 generalizes the
    // 3bf3bdd fix into the three-phase model.
    //
    // The MCP `initialize` handler is intentionally NOT gated — Claude
    // Code's initialize timeout is tighter than the 600–1200ms handshake,
    // and a missed initialize ACK is a deterministic startup failure
    // (see docs/reviews/bug-candidate-adapter-startup-race.md, HC #3).
    const eagerWarmup = isEagerWarmupEnabled(process.env);
    log(`[Handshake] Eager-warmup: ${eagerWarmup ? "ON (OIS_EAGER_SESSION_CLAIM=1)" : "OFF (lazy mode; Hub will auto-claim on first SSE / first tools/call)"}`);
    let resolveIdentityReady;
    let rejectIdentityReady;
    const identityReady = new Promise((resolve, reject) => {
        resolveIdentityReady = resolve;
        rejectIdentityReady = reject;
    });
    identityReady.catch(() => { });
    let resolveSessionReady;
    let rejectSessionReady;
    const sessionReady = new Promise((resolve, reject) => {
        resolveSessionReady = resolve;
        rejectSessionReady = reject;
    });
    sessionReady.catch(() => { });
    let resolveSyncReady;
    let rejectSyncReady;
    const syncReady = new Promise((resolve, reject) => {
        resolveSyncReady = resolve;
        rejectSyncReady = reject;
    });
    syncReady.catch(() => { });
    // ── M-Session-Claim-Separation (mission-40) T4 — tool-catalog cache wiring ──
    //
    // identityReady-resolved flag (sync-readable for the dispatcher's cache
    // fallback to peek without awaiting). Set by a .then() chained off
    // identityReady so the value becomes true on the same microtask as the
    // promise resolves — no spinning, no race.
    let identityReadyResolved = false;
    identityReady.then(() => { identityReadyResolved = true; }).catch(() => { });
    // Hub version source for cache invalidation. Fetch /health once at
    // startup in the background; cache the version in-memory. Probes that
    // fire before the fetch completes get `null` and trust the cache
    // (probe-friendly default per tool-catalog-cache.isCacheValid). Real
    // sessions get the version within ~50ms (well before any tool call).
    let cachedHubVersion = null;
    const healthUrl = config.hubUrl.replace(/\/mcp(\/.*)?$/, "/health");
    (async () => {
        try {
            const res = await fetch(healthUrl);
            if (res.ok) {
                const json = await res.json();
                if (typeof json.version === "string") {
                    cachedHubVersion = json.version;
                    log(`[Cache] Hub version resolved: ${cachedHubVersion}`);
                }
                else {
                    log(`[Cache] /health returned no version field — cache invalidation will trust existing cache`);
                }
            }
            else {
                log(`[Cache] /health fetch returned status ${res.status} — cache invalidation will trust existing cache`);
            }
        }
        catch (err) {
            log(`[Cache] /health fetch failed (non-fatal): ${err.message ?? err}`);
        }
    })();
    const dispatcher = createDispatcher({
        agent,
        proxyVersion: PROXY_VERSION,
        log,
        notification: {
            logPath: LOG_FILE,
            mirror: (block) => process.stderr.write(block),
        },
        // T3 semantic remap (DispatcherOptions param names preserved for
        // back-compat with existing tests + the optional/legacy back-compat
        // path in dispatcher.ts):
        //   - dispatcher.handshakeComplete (gates ListTools) ← shim's identityReady
        //   - dispatcher.agentReady       (gates CallTool)  ← shim's sessionReady
        handshakeComplete: identityReady,
        agentReady: sessionReady,
        // T4 cache hooks (probe-safe ListTools).
        getCachedCatalog: () => readCache(WORK_DIR, log),
        getIsIdentityReady: () => identityReadyResolved,
        getCurrentHubVersion: () => cachedHubVersion,
        persistCatalog: (catalog) => {
            // Best-effort persist. Skip if we don't yet have a Hub version to
            // tag — better to let the next live-fetch (with version known)
            // populate the cache than to write a hubVersion-less entry that
            // would never invalidate cleanly.
            if (cachedHubVersion === null) {
                log("[Cache] Skipping persistCatalog — Hub version not yet resolved");
                return;
            }
            writeCache(WORK_DIR, catalog, cachedHubVersion, log);
        },
    });
    dispatcherRef = dispatcher;
    agent.setCallbacks(dispatcher.callbacks);
    // Open stdio FIRST so the host's MCP `initialize` request is ACKed
    // within its timeout, then run the Hub handshake. Tool-dispatch
    // handlers wait on `agentReady` if they fire before the handshake
    // resolves.
    const transport = new StdioServerTransport();
    transport.onclose = () => {
        shutdown();
    };
    await dispatcher.server.connect(transport);
    log("MCP stdio server ready — Claude Code can call initialize/listTools/callTool");
    try {
        await agent.start();
        resolveSyncReady();
        log("Hub connection established (full sync done)");
    }
    catch (err) {
        // Reject all three gates so any awaiting handler surfaces a real
        // error rather than hanging. Resolved deferreds are immutable
        // (post-resolve reject is a no-op on the Promise) so this is safe
        // regardless of which phase failed.
        rejectIdentityReady(err);
        rejectSessionReady(err);
        rejectSyncReady(err);
        throw err;
    }
    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => {
            log(`Received ${signal}`);
            shutdown();
        });
    }
}
main().catch((err) => {
    console.error(`Fatal: ${err}`);
    process.exit(1);
});
