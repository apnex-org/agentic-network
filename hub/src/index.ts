/**
 * MCP Relay Hub — Entrypoint
 *
 * A lightweight MCP Server (Streamable HTTP transport) that routes
 * Directives and Reports between an Architect agent and an Engineer CLI.
 *
 * Deployed to Cloud Run as a containerized Express application.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// mission-84 W5: fs + path + cutover-sentinel imports DELETED — sole consumers
// were the local-fs dispatch-branch (writability assertion + cutover-sentinel
// guard) which W4 deleted along with the dispatch. cutover-sentinel.{ts,test.ts}
// retired in this same PR (W5) per coordinated-upgrade-discipline.
import type { ITaskStore, IEngineerRegistry, IProposalStore, IThreadStore, IAuditStore } from "./state.js";
// mission-83 W6-narrowed: gcs-state.js DELETED (substrate replaces GCS at
// production-prod); reconcileCounters + cleanupOrphanedFiles startup hooks
// were GCS-only and have no substrate-mode equivalent.
// mission-84 W4: FS-version repository imports DELETED (12 *-repository.ts + counter.ts
// removed from the codebase; substrate-version repos are sole production path).
import {
  type IIdeaStore, type IMissionStore, type ITurnStore, type ITeleStore, type IBugStore,
  type IPendingActionStore, type IMessageStore,
} from "./entities/index.js";
// mission-83 W6-narrowed: GcsStorageProvider DELETED (substrate replaces GCS
// at production-prod); LocalFsStorageProvider + MemoryStorageProvider preserved
// as test/dev affordances.
// mission-84 W4: MemoryStorageProvider + LocalFsStorageProvider + StorageProvider
// production-Hub imports DELETED — substrate is sole production storage path per
// mission-83 W5.4 cutover + Design v1.0 §2.5 (W5 retires STORAGE_BACKEND env var
// entirely). Remaining @apnex/storage-provider consumer is the published
// repo-event-bridge package (test fixtures + cursor-store interface).
// mission-83 W5.4-Hub-bootstrap-flip — STORAGE_BACKEND=substrate dispatch path
import {
  createPostgresStorageSubstrate,
  createSchemaReconciler,
  ALL_SCHEMAS,
  buildEnvelopeWriteEncoder,
  type PostgresSubstrate,
  type SchemaReconciler,
} from "./storage-substrate/index.js";
import { applyMigrations } from "./storage-substrate/migration-runner.js";
import { TokenStore } from "./storage-substrate/token-store.js";
import { armBareEnvelopeDetector } from "./storage-substrate/bare-envelope-error.js";
import { SubstrateCounter } from "./entities/substrate-counter.js";
import { AgentRepositorySubstrate } from "./entities/agent-repository-substrate.js";
import { AuditRepositorySubstrate } from "./entities/audit-repository-substrate.js";
import { BugRepositorySubstrate } from "./entities/bug-repository-substrate.js";
import { IdeaRepositorySubstrate } from "./entities/idea-repository-substrate.js";
import { MessageRepositorySubstrate } from "./entities/message-repository-substrate.js";
import { MissionRepositorySubstrate } from "./entities/mission-repository-substrate.js";
import { PendingActionRepositorySubstrate } from "./entities/pending-action-repository-substrate.js";
import { ProposalRepositorySubstrate } from "./entities/proposal-repository-substrate.js";
import { TaskRepositorySubstrate } from "./entities/task-repository-substrate.js";
import { TeleRepositorySubstrate } from "./entities/tele-repository-substrate.js";
import { ThreadRepositorySubstrate } from "./entities/thread-repository-substrate.js";
import { TurnRepositorySubstrate } from "./entities/turn-repository-substrate.js";
import { WorkItemRepositorySubstrate } from "./entities/work-item-repository-substrate.js";
import { DecisionRepositorySubstrate } from "./entities/decision-repository-substrate.js";
import { DirectorProofRepositorySubstrate } from "./entities/director-proof-repository-substrate.js";
import { ClassGrantRepositorySubstrate } from "./entities/class-grant-repository-substrate.js";
import { ArrivalSurfaceRepositorySubstrate } from "./entities/arrival-surface-repository-substrate.js";
import { CurationRepositorySubstrate } from "./entities/curation-repository-substrate.js";
import { DocumentRepository } from "./storage-substrate/new-repositories.js";
// Legacy registerAllTools REMOVED — all 43 tools now served by PolicyRouter
import { PolicyRouter, registerTaskPolicy, computeToolSurfaceRevision } from "./policy/index.js";
import { registerSystemPolicy } from "./policy/system-policy.js";
import { registerTelePolicy } from "./policy/tele-policy.js";
import { registerAuditPolicy } from "./policy/audit-policy.js";
// mission-84 W6: registerDocumentPolicy RE-INTRODUCED with substrate-backed
// DocumentRepository per Design v1.0 §2.7 (mission-83 W6-narrowed retired the
// GCS-backed version; mission-84 W6 restores via substrate).
import { registerDocumentPolicy } from "./policy/document-policy.js";
import { registerSessionPolicy } from "./policy/session-policy.js";
import { registerIdeaPolicy } from "./policy/idea-policy.js";
import { registerMissionPolicy } from "./policy/mission-policy.js";
import { registerTurnPolicy } from "./policy/turn-policy.js";
import { registerClarificationPolicy } from "./policy/clarification-policy.js";
import { registerReviewPolicy } from "./policy/review-policy.js";
import { registerProposalPolicy } from "./policy/proposal-policy.js";
import { registerThreadPolicy } from "./policy/thread-policy.js";
import { registerMessagePolicy } from "./policy/message-policy.js";
import { registerBugPolicy } from "./policy/bug-policy.js";
import { registerWorkItemPolicy } from "./policy/work-item-policy.js";
import { registerDecisionPolicy } from "./policy/decision-policy.js";
import { registerDirectorProofPolicy } from "./policy/director-proof-policy.js";
import { registerClassGrantPolicy } from "./policy/class-grant-policy.js";
import { registerArrivalSurfacePolicy } from "./policy/arrival-surface-policy.js";
import { registerCurationPolicy } from "./policy/curation-policy.js";
import { registerSc3FunnelPolicy } from "./policy/sc3-funnel-policy.js";
import { runCurationSloSweep } from "./policy/curation-policy.js";
import { runDecisionAgingSweep } from "./policy/arrival-surface-policy.js";
import { registerPendingActionPolicy } from "./policy/pending-action-policy.js";
import { registerTransportHeartbeatPolicy } from "./handlers/transport-heartbeat-handler.js";
import { Watchdog } from "./policy/watchdog.js";
import { MessageProjectionSweeper } from "./policy/message-projection-sweeper.js";
import { ScheduledMessageSweeper } from "./policy/scheduled-message-sweeper.js";
import { CascadeReplaySweeper } from "./policy/cascade-replay-sweeper.js";
import { PulseSweeper } from "./policy/pulse-sweeper.js";
import { WorkItemLeaseSweeper } from "./policy/work-item-lease-sweeper.js";
import {
  RepoEventBridge,
  createPolicyRouterInvoker,
  parseReposEnvVar,
} from "./policy/repo-event-handler.js";
import { bindRouterToMcp } from "./policy/mcp-binding.js";
import { RepoEventBridgeSubstrateAdapter } from "./storage-substrate/repo-event-bridge-adapter.js";
import type { AllStores } from "./policy/index.js";
import { createMetricsCounter } from "./observability/metrics.js";

// ── Global State ──────────────────────────────────────────────────────
// mission-84 W5: STORAGE_BACKEND env var RETIRED entirely per Design v1.0 §2.5
// (substrate-only-everywhere; Survey Q2c uncompromising; Director-direct
// "Approved" 2026-05-18 ratified pre-ship per §5.1 Out-of-scope-risks).
// Production-Hub locked to substrate via mission-83 W5.4 cutover; W5 collapses
// the ceremony. POSTGRES_CONNECTION_STRING is now the sole required env var.
// mission-83 W6-narrowed: GCS_BUCKET env var + STORAGE_BACKEND=gcs guard
// DELETED (GCS-mode removed; substrate is sole production cloud-path).
// mission-84 W4: OIS_LOCAL_FS_ROOT + local-fs/memory dispatch DELETED.
const POSTGRES_CONNECTION_STRING = process.env.POSTGRES_CONNECTION_STRING;
if (!POSTGRES_CONNECTION_STRING) {
  throw new Error(
    "[hub] POSTGRES_CONNECTION_STRING env var is required. " +
    "Example: postgres://hub:hub@localhost:5432/hub. " +
    "Local-dev: docker-compose up postgres (per scripts/local/start-hub.sh). " +
    "Migration script: npm run migrate-fs-to-substrate -- --source=<fs> --target=<conn> --backup=<tar>.",
  );
}

// mission-90 W8 (idea-320): the SUBSTRATE_ENVELOPE_TOLERANT flag is RETIRED.
// The substrate is envelope-only (strict) — all writes land envelope (the W4
// write-encoder) and reads are envelope-native; the dual-shape reader-parse +
// the flag (which W6 had already defaulted to STRICT and nothing consumed at
// runtime) are gone. Logged for operability.
console.log(`[Hub] envelope substrate: STRICT (envelope-only; dual-shape tolerance retired at mission-90 W8)`);

let taskStore: ITaskStore;
let engineerRegistry: IEngineerRegistry;
let proposalStore: IProposalStore;
let threadStore: IThreadStore;
let auditStore: IAuditStore;
let ideaStore: IIdeaStore;
let missionStore: IMissionStore;
let turnStore: ITurnStore;
let teleStore: ITeleStore;
let bugStore: IBugStore;
// ADR-017: comms reliability layer. GCS-backed in Phase 2x P0-1 (was
// memory-only in v1 — Hub restarts wiped the queue, observed twice
// during Phase 2b-B measurement). Queue state now survives restart
// identically to other entities.
let pendingActionStore: IPendingActionStore;
// Mission-51 W1: universal Message primitive store.
let messageStore: IMessageStore;

// Mission-47 W1: tele store is now `TeleRepository` composed over a
// `StorageProvider`. Provider is selected per STORAGE_BACKEND and
// shared with the counter helper. Future waves will migrate the
// other entities to the same pattern; during mission-47 in-flight
// period, legacy `*Store` classes continue to coexist with
// TeleRepository (both read/write the same GCS keyspace safely via
// CAS on shared meta/counter.json).
// mission-84 W5: substrate-only-unconditional per Design v1.0 §2.5; STORAGE_BACKEND
// env-var ceremony fully retired. Hub bootstrap reduces to: createPostgresStorage
// Substrate + reconciler-start. No dispatch logic; no env-var-fallback fatal.
const connRedacted = POSTGRES_CONNECTION_STRING.replace(/:[^:@]+@/, ":***@");
console.log(`[Hub] substrate-mode active; postgres=${connRedacted}`);
const substrate: PostgresSubstrate = createPostgresStorageSubstrate(POSTGRES_CONNECTION_STRING);
// mission-90 W4 (idea-324): wire the write-side envelope encoder BEFORE any write
// (incl. the reconciler boot-put + repos) so EVERY write lands envelope-shape —
// the close-all-bare-writers chokepoint, complete-by-construction. Idempotent:
// already-envelope rows (e.g. the W1 boot-put) pass through byte-identical.
substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
// mission-86 W2 (bug-101): apply substrate migrations before the reconciler —
// the Hub bootstraps a fresh empty postgres with no manual SQL.
await applyMigrations(POSTGRES_CONNECTION_STRING, (msg) => console.log(`[Hub:migrations] ${msg}`));
const reconciler: SchemaReconciler = createSchemaReconciler(substrate, POSTGRES_CONNECTION_STRING, {
  initialSchemas: ALL_SCHEMAS,
  log: (msg) => console.log(`[Hub:reconciler] ${msg}`),
  warn: (msg) => console.warn(`[Hub:reconciler] ${msg}`),
});
await reconciler.start();
console.log(`[Hub] substrate reconciler settled (${ALL_SCHEMAS.length} SchemaDefs applied)`);

// mission-90 W2 (Design §2.3): wire the reconciler's field-translation into the
// substrate so substrate.list rewrites bare filter/sort keys → envelope JSONB
// paths (fixes bug-138 Layer-A envelope-blind filters with no per-tool code).
// Late-bound here — AFTER reconciler.start() built the translation map and BEFORE
// any repository serves a list() below — to break the substrate↔reconciler
// construction cycle. No-rename keys pass through unchanged.
//
// PRECONDITION: the translate-point assumes ENVELOPE-shaped rows (it rewrites to
// envelope JSONB paths). Correct only POST-W6 re-migration; W2 deploys batched
// WITH W6 (never standalone) per the cutover discipline — the batched-deploy
// ordering IS the guard (no runtime migration-state check by design).
substrate.setFieldTranslator((kind, bareKey) => reconciler.getFieldTranslation(kind, bareKey));
// C3-R4b (piece 1): arm FilterTranslationGapError — a filter/sort on a known
// envelope-partitioned kind's domain field with NO renameMap entry now fails LOUD
// at filter-translate, rather than silently mis-pathing the JSONB query (the
// bug-138/bug-170 silent-filter-miss class). Inert without this wiring (tests/dev).
substrate.setPartitionedKindCheck((kind) => reconciler.hasTranslations(kind));
// C3-R4b (piece 2): arm the 0-bare detector — the DECODE-side twin of piece 1.
// A row that reaches a consumer STILL enveloped (a skipped/broken decode, never a
// legit row post-W8-STRICT) now fails LOUD at the repo decode-to-flat boundary
// (BareEnvelopeError), instead of silently degrading then poll-recovering (cal-84).
// Same oracle as piece 1 (reconciler.hasTranslations) → armed only for known
// partitioned kinds; inert without this wiring (tests/dev/ad-hoc kinds).
armBareEnvelopeDetector((kind) => reconciler.hasTranslations(kind));

// Mission-47 W1-W7 + Mission-49 W8-W9: instantiate StorageProvider-backed
// repositories. Counter is shared-by-design across all repositories —
// issues a monotonic ID sequence per entity-type field via a single
// meta/counter.json blob.
//
// mission-83 W5.4-Hub-bootstrap-flip: when STORAGE_BACKEND=substrate, instantiate
// substrate-versioned siblings (W4.x.1-11 existing + W4.x.12-17 new-repo)
// composing HubStorageSubstrate per Option Y disposition (B). I*Store interfaces
// unchanged; handler call-sites work transparently.
// mission-84 W4: substrate is unconditional post-dispatch fatal-exit (non-substrate
// values exit before reaching here); non-null assertion + drop if-guard. FS-version-
// repository instantiation else-branch DELETED (FS-version repos retired entirely).
const substrateCounter = new SubstrateCounter(substrate!);
auditStore = new AuditRepositorySubstrate(substrate!, substrateCounter);
taskStore = new TaskRepositorySubstrate(substrate!, substrateCounter);
proposalStore = new ProposalRepositorySubstrate(substrate!, substrateCounter);
ideaStore = new IdeaRepositorySubstrate(substrate!, substrateCounter);
bugStore = new BugRepositorySubstrate(substrate!, substrateCounter);
teleStore = new TeleRepositorySubstrate(substrate!, substrateCounter);
threadStore = new ThreadRepositorySubstrate(substrate!, substrateCounter);
pendingActionStore = new PendingActionRepositorySubstrate(substrate!, substrateCounter);
// MessageRepositorySubstrate uses ULID + substrate-native sequence (no counter).
messageStore = new MessageRepositorySubstrate(substrate!);
// AgentRepositorySubstrate has no counter (fingerprint-derived ids).
engineerRegistry = new AgentRepositorySubstrate(substrate!);
// MissionRepositorySubstrate takes counter + taskStore + ideaStore for hydration.
missionStore = new MissionRepositorySubstrate(substrate!, substrateCounter, taskStore, ideaStore);
// TurnRepositorySubstrate takes counter + missionStore + taskStore for hydration.
turnStore = new TurnRepositorySubstrate(substrate!, substrateCounter, missionStore, taskStore);
// mission-84 W6: DocumentRepository (substrate-backed; W2.4 stub now production)
const documentStore = new DocumentRepository(substrate!);
// C1-R2 (mission-94): WorkItem work-queue store (claim/lease/FSM verbs + complete_work).
const workItemStore = new WorkItemRepositorySubstrate(substrate!, substrateCounter);
// mission-102 P3-B1: Decision authority-resolution store (raise/curate/route/resolve/exits).
// mission-102 P3-B2: curation trail store — constructed FIRST so the decision
// repo can leave raw captures + records at the repo layer (un-bypassable).
const curationStore = new CurationRepositorySubstrate(substrate!, substrateCounter);
const decisionStore = new DecisionRepositorySubstrate(substrate!, substrateCounter, curationStore);
// mission-102 P3-B4: Director proof-path store (DirectorSignal + DirectorConfirmation).
const directorProofStore = new DirectorProofRepositorySubstrate(substrate!, substrateCounter);
// mission-102 P3-B3: ClassGrant store (typed-constraint delegation + evaluator).
const classGrantStore = new ClassGrantRepositorySubstrate(substrate!, substrateCounter);
// mission-102 P3-B6: arrival-surface store (snapshots/receipts/presence).
const arrivalSurfaceStore = new ArrivalSurfaceRepositorySubstrate(substrate!, substrateCounter);
console.log("[Hub] substrate-mode repositories instantiated (13 substrate-versions + Document store)");

// ── Aggregate Store Object ────────────────────────────────────────────
const allStores: AllStores = {
  task: taskStore,
  engineerRegistry,
  proposal: proposalStore,
  thread: threadStore,
  audit: auditStore,
  idea: ideaStore,
  mission: missionStore,
  turn: turnStore,
  tele: teleStore,
  bug: bugStore,
  pendingAction: pendingActionStore,
  message: messageStore,
  document: documentStore,
  workItem: workItemStore,
  decision: decisionStore,
  directorProof: directorProofStore,
  classGrant: classGrantStore,
  arrivalSurface: arrivalSurfaceStore,
  curation: curationStore,
};

// ── PolicyRouter Singleton ───────────────────────────────────────────
// The router is stateless — it holds only handler registrations.
// All mutable state lives in the stores (injected via IPolicyContext).
const policyRouter = new PolicyRouter();
registerTaskPolicy(policyRouter);
registerSystemPolicy(policyRouter);
registerTelePolicy(policyRouter);
registerAuditPolicy(policyRouter);
// mission-84 W6: registerDocumentPolicy RE-INTRODUCED (substrate-backed); 3 tools
// (create_document / get_document / list_documents); PolicyRouter tool count 68 → 71.
registerDocumentPolicy(policyRouter);
// mission-83 W6-narrowed historical note: registerDocumentPolicy was DELETED with document-policy.ts;
// document MCP tools deferred to idea-300 follow-on (substrate-backed
// DocumentRepository W4.x.12 stub available for re-introduction).
registerSessionPolicy(policyRouter);
registerIdeaPolicy(policyRouter);
registerMissionPolicy(policyRouter);
registerTurnPolicy(policyRouter);
registerClarificationPolicy(policyRouter);
registerReviewPolicy(policyRouter);
registerProposalPolicy(policyRouter);
registerThreadPolicy(policyRouter);
registerBugPolicy(policyRouter);
// C1-R2 (mission-94): WorkItem work-queue verbs (claim_work / list_ready_work / start /
// block / resume / renew / release / abandon / complete_work). idea-121 finalizes the
// tool surface; the keystone is dormant-until-assembled on the integration branch.
registerWorkItemPolicy(policyRouter);
// mission-102 P3-B1: the Decision verb surface (raise/curate/route/resolve/exits + events).
registerDecisionPolicy(policyRouter);
// mission-102 P3-B4: the Director proof-path verbs (signal ingress + confirmation + proxy resolve).
registerDirectorProofPolicy(policyRouter);
// mission-102 P3-B3: the ClassGrant verb surface (mint/get/list/revoke).
registerClassGrantPolicy(policyRouter);
// mission-102 P3-B6: the Director arrival surface (render/ack/presence).
registerArrivalSurfacePolicy(policyRouter);
// mission-102 P3-B2: the anti-laundering curation queries.
registerCurationPolicy(policyRouter);
// mission-102 B8-R2: the SC3 funnel + gaming flag (contract 6).
registerSc3FunnelPolicy(policyRouter);
registerPendingActionPolicy(policyRouter);
// mission-75 v1.0 §3.3 — adapter-internal periodic transport-liveness
// signal; tier="adapter-internal" excludes it from shim's LLM tool catalogue.
registerTransportHeartbeatPolicy(policyRouter);
// Mission-51 W6: list_messages + create_message MCP verbs.
registerMessagePolicy(policyRouter);
console.log(`[Hub] PolicyRouter initialized with ${policyRouter.size} tool(s): ${policyRouter.getRegisteredTools().join(", ")}`);

// bug-114 — tool-surface ETag. The router is a stateless singleton fixed
// at boot (all register*Policy calls above are complete), so compute the
// revision once here and serve it as a constant via `/health`. The
// network-adapter keys its tool-catalog cache off this token so the cache
// invalidates on intra-version tool-surface drift.
const toolSurfaceRevision = computeToolSurfaceRevision(policyRouter);
console.log(`[Hub] Tool-surface revision: ${toolSurfaceRevision}`);

// bug-114 — `/health` `version`, formerly a hardcoded "1.0.0" literal that
// never tracked anything. Wired to hub/package.json so it stops lying.
// dist/index.js → ../package.json (and tsx src/index.ts → ../package.json)
// both resolve to hub/package.json.
const HUB_VERSION: string = (() => {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// C3-R1 M-Roll-Signal (idea-340) — deploy-truth bank. scripts/local/build-hub.sh
// stamps hub/build-info.json {gitSha, builtAt} into the image (the Dockerfile
// COPYs it to /app); /health reports it so an external observer (the
// deploy-hub.yml roll-confirm step) can prove the new image actually rolled,
// closing the bug-107/DR-011 silent-deploy class. Read once at boot via the
// same ../build-info.json resolution as HUB_VERSION (dist/index.js → /app).
// Graceful empty-fallback when the file is absent (local dev / tests) —
// mirrors the bug-114 toolSurfaceRevision "" fallback; never crashes boot.
const BUILD_INFO: { gitSha: string; builtAt: string } = (() => {
  try {
    const biPath = join(dirname(fileURLToPath(import.meta.url)), "..", "build-info.json");
    const bi = JSON.parse(readFileSync(biPath, "utf8")) as { gitSha?: unknown; builtAt?: unknown };
    return {
      gitSha: typeof bi.gitSha === "string" ? bi.gitSha : "",
      builtAt: typeof bi.builtAt === "string" ? bi.builtAt : "",
    };
  } catch {
    return { gitSha: "", builtAt: "" };
  }
})();
console.log(`[Hub] build-info: gitSha=${BUILD_INFO.gitSha || "(none)"} builtAt=${BUILD_INFO.builtAt || "(none)"}`);

// ADR-017: start the comms-reliability watchdog. Stateless scanner over
// the pending-actions queue; enforces deadlines + escalation ladder. The
// injectable wake-client uses fetch (best-effort); failures are logged but
// never block watchdog progress — the queue is the truth.
//
// WATCHDOG_ENABLED feature flag (default true). Set to "false" during
// migration windows (e.g., rolling out adapter drain-on-wake) to pause the
// escalation ladder. Queue still enqueues + completion-acks still work;
// only re-dispatch + demotion + Director-notification are suspended.
const WATCHDOG_ENABLED = (process.env.WATCHDOG_ENABLED ?? "true").toLowerCase() !== "false";
const watchdog = new Watchdog({
  stores: allStores,
  log: (msg) => console.log(msg),
  wakeClient: async (wakeEndpoint, item) => {
    try {
      await fetch(wakeEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queueItemId: item.id, dispatchType: item.dispatchType, entityRef: item.entityRef }),
      });
    } catch (err: any) {
      console.log(`[Hub] Watchdog wake-POST failed for ${wakeEndpoint}: ${err?.message ?? err}`);
    }
  },
});
if (WATCHDOG_ENABLED) {
  watchdog.start();
  console.log("[Hub] ADR-017 comms-reliability watchdog started");
} else {
  console.log("[Hub] ADR-017 watchdog PAUSED (WATCHDOG_ENABLED=false) — queue still operational, escalation ladder suspended");
}

// ── MCP Server Factory ───────────────────────────────────────────────
// Each session gets its own McpServer instance connected to its transport.
// The PolicyRouter is shared; the ctxFactory provides per-connection context.

function createMcpServer(
  getSessionId: () => string,
  getClientIp: () => string,
  notifyEvent: (event: string, data: Record<string, unknown>, targetRoles?: string[]) => Promise<void>,
  dispatchEvent: (event: string, data: Record<string, unknown>, selector: import("./state.js").Selector) => Promise<void>,
): McpServer {
  const server = new McpServer(
    {
      name: "mcp-relay-hub",
      version: "1.0.0",
    },
    {
      capabilities: {
        logging: {},
      },
    }
  );

  // Layer 7: PolicyRouter-bound tools (Task + System domains)
  // Shared per-process metrics counter — all ctx instances share it so
  // counter state accumulates across requests (see Phase 2d CP1).
  const metrics = createMetricsCounter();
  const ctxFactory = () => ({
    stores: allStores,
    emit: notifyEvent,
    dispatch: dispatchEvent,
    sessionId: getSessionId(),
    clientIp: getClientIp(),
    role: "unknown", // resolved at handler level via engineerRegistry
    internalEvents: [],
    metrics,
  });

  bindRouterToMcp(server, policyRouter, ctxFactory);

  // All 43 tools now served exclusively via PolicyRouter (Layer 7).
  // The Great Decoupling is complete.

  return server;
}

// ── Hub Networking (production instance) ─────────────────────────────
// All networking logic (session management, SSE, keepalive, reaper,
// notification broadcast) is handled by the extracted HubNetworking class.
// This ensures production and tests run the exact same networking code.

import { HubNetworking } from "./hub-networking.js";
import type { CreateMcpServerFn } from "./hub-networking.js";

const HUB_API_TOKEN = process.env.HUB_API_TOKEN || "";
// mission-86 W3 — admin token guarding /admin/tokens (OQ-16 → (b);
// provisioned as the `hub-admin-token` Secret Manager secret).
const HUB_ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || "";
const ARCHITECT_WEBHOOK_URL = process.env.ARCHITECT_WEBHOOK_URL || "";
const PORT = parseInt(process.env.PORT || "8080", 10);

// The createMcpServer factory adapts the production tool registration
// to the HubNetworking's CreateMcpServerFn interface.
const createMcpServerFactory: CreateMcpServerFn = (getSessionId, getClientIp, notifyEvent, dispatchEvent) => {
  return createMcpServer(getSessionId, getClientIp, notifyEvent, dispatchEvent);
};

// mission-86 W3 — bearer-token store (Design v2.2 §4.13). The `bearer_tokens`
// table is created by migration 004 (already applied above); refresh() loads
// the hot-path validate cache.
const tokenStore = new TokenStore(POSTGRES_CONNECTION_STRING);
await tokenStore.refresh();

const hub = new HubNetworking(
  engineerRegistry,
  createMcpServerFactory,
  {
    port: PORT,
    apiToken: HUB_API_TOKEN,
    adminToken: HUB_ADMIN_TOKEN,
    webhookUrl: ARCHITECT_WEBHOOK_URL,
    keepaliveInterval: 30_000,
    sessionTtl: 180_000,
    reaperInterval: 60_000,
    orphanTtl: 60_000,
    autoStartTimers: true,
    quiet: false,
    version: HUB_VERSION,
    toolSurfaceRevision,
    gitSha: BUILD_INFO.gitSha,
    builtAt: BUILD_INFO.builtAt,
    // work-44/bug-190 (d): lazy getter — repoEventBridge is created further below; the closure
    // reads its health at /health-request time so deliveryFailing/lastSuccessfulDelivery surface
    // in production (closes the "bridge.health() has zero prod consumers" gap).
    repoEventBridgeHealth: () => repoEventBridge?.health(),
  },
  // M-Session-Claim-Separation (mission-40) T2: thread audit store through
  // for SSE-subscribe auto-claim hook to emit agent_session_implicit_claim
  // + agent_session_displaced audits.
  auditStore,
  // Mission-56 W1b: Message store for SSE Last-Event-ID + cold-start
  // replay paths. Hub-internal cursor query (replayFromCursor) emits
  // backfill via sendLoggingMessage before transport.handleRequest
  // takes over for live emit. Coexists with state-based-reconnect.
  messageStore,
  // mission-75 §3.3 / bug-55: wire the dispatcher-entry cognitive-bump
  // gate to canonical PolicyRouter tier annotations (positive-list:
  // bump iff tools/call to llm-callable tier).
  (toolName: string) => policyRouter.getToolTier(toolName),
  // mission-86 W3 — bearer-token store: /mcp uses token-store bearer-auth +
  // /admin/tokens is mounted.
  tokenStore,
);

// ── Start Server ─────────────────────────────────────────────────────

async function startupSequence(): Promise<void> {
  // mission-83 W6-narrowed: GCS startup maintenance (cleanupOrphanedFiles +
  // reconcileCounters) DELETED — GCS-mode removed; substrate-mode is sole
  // production cloud-path; no FS-orphan class exists in postgres substrate.
  // Hook kept as no-op placeholder for future substrate-mode startup tasks.
}

// ── Thread Reaper (M24-T7, INV-TH21) ─────────────────────────────────
// Periodic task: scans active threads whose idle time exceeds
// `thread.idleExpiryMs` (or the deployment default), transitions them
// to `abandoned`, retracts any staged actions, audits with action
// `thread_reaper_abandoned`, and dispatches `thread_abandoned`
// participant-scoped to any remaining participants with resolved
// agentIds. Hourly cadence by default; configurable via env for tests
// and for deployments that want tighter/looser sweeping.

const THREAD_IDLE_EXPIRY_MS = parseInt(
  process.env.HUB_THREAD_IDLE_EXPIRY_MS || String(7 * 24 * 60 * 60 * 1000),
  10,
);
const THREAD_REAPER_INTERVAL_MS = parseInt(
  process.env.HUB_THREAD_REAPER_INTERVAL_MS || String(60 * 60 * 1000),
  10,
);

let threadReaperHandle: NodeJS.Timeout | null = null;

async function runThreadReaperTick(): Promise<void> {
  try {
    const reaped = await threadStore.reapIdleThreads(THREAD_IDLE_EXPIRY_MS);
    if (reaped.length === 0) return;
    console.log(`[Reaper] thread reaper: ${reaped.length} idle thread(s) transitioned to abandoned`);
    for (const t of reaped) {
      await auditStore.logEntry(
        "hub",
        "thread_reaper_abandoned",
        `Thread ${t.threadId} reaped after ${Math.round(t.idleMs / 1000)}s idle (threshold ${Math.round(THREAD_IDLE_EXPIRY_MS / 1000)}s). Title: ${t.title}.`,
        t.threadId,
      );
      if (t.participantAgentIds.length > 0) {
        await hub.dispatchEvent("thread_abandoned", {
          threadId: t.threadId,
          title: t.title,
          leaverAgentId: null,
          reason: "idle_expiry",
          idleMs: t.idleMs,
          retractedActionCount: 0, // counted in-store; keep payload tight
        }, {
          agentIds: t.participantAgentIds,
          matchLabels: t.labels,
        });
      }

      // Phase 2d CP3 C1 — bidirectional integrity: abandon any
      // non-terminal queue items bound to this reaped thread so they
      // don't sit forever in receipt_acked waiting for a reply that
      // will never come. Per thread-224 consensus: the queue is truth,
      // but when the referenced thread goes away, the queue items
      // referencing it must also terminate (state: errored, reason
      // names the reap).
      try {
        const tied = await pendingActionStore.listNonTerminalByEntityRef(t.threadId);
        for (const item of tied) {
          const abandoned = await pendingActionStore.abandon(
            item.id,
            `thread_reaper_abandoned: thread ${t.threadId} reaped after ${Math.round(t.idleMs / 1000)}s idle`,
          );
          if (abandoned && abandoned.state === "errored") {
            await auditStore.logEntry(
              "hub",
              "queue_item_abandoned_via_thread_reaper",
              `Queue item ${item.id} abandoned because its parent thread ${t.threadId} was reaped (dispatchType=${item.dispatchType}, targetAgentId=${item.targetAgentId}).`,
              item.id,
            );
          }
        }
        if (tied.length > 0) {
          console.log(`[Reaper] thread ${t.threadId}: ${tied.length} tied queue item(s) abandoned via bidirectional wiring`);
        }
      } catch (queueErr) {
        console.error(`[Reaper] failed to abandon queue items for reaped thread ${t.threadId}:`, queueErr);
      }
    }
  } catch (err) {
    console.error("[Reaper] thread reaper tick failed:", err);
  }
}

function startThreadReaper(): void {
  if (threadReaperHandle) return;
  console.log(`[Hub] Starting thread reaper: interval=${THREAD_REAPER_INTERVAL_MS}ms, default-idle-expiry=${THREAD_IDLE_EXPIRY_MS}ms`);
  threadReaperHandle = setInterval(() => {
    void runThreadReaperTick();
  }, THREAD_REAPER_INTERVAL_MS);
  // Allow process exit even if interval is pending.
  threadReaperHandle.unref?.();
}

function stopThreadReaper(): void {
  if (threadReaperHandle) {
    clearInterval(threadReaperHandle);
    threadReaperHandle = null;
  }
}

// ── Agent Reaper (CP3 C4, bug-16 part 1) ─────────────────────────────
// Periodic background task symmetric to the thread reaper: scans
// offline Agent records and permanently deletes those whose lastSeenAt
// is older than HUB_AGENT_STALE_THRESHOLD_MS. Before each delete, any
// thread whose currentTurnAgentId pins to the victim is unpinned
// (cascade unpin per thread-234 architect direction) so the thread
// remains replyable by its other participants. Default threshold: 7
// days; default interval: 1 hour.
const HUB_AGENT_STALE_THRESHOLD_MS = parseInt(
  process.env.HUB_AGENT_STALE_THRESHOLD_MS || String(7 * 24 * 60 * 60 * 1000),
  10,
);
const HUB_AGENT_REAPER_INTERVAL_MS = parseInt(
  process.env.HUB_AGENT_REAPER_INTERVAL_MS || String(60 * 60 * 1000),
  10,
);

let agentReaperHandle: NodeJS.Timeout | null = null;

async function runAgentReaperTick(): Promise<void> {
  try {
    const stale = await engineerRegistry.listOfflineAgentsOlderThan(HUB_AGENT_STALE_THRESHOLD_MS);
    if (stale.length === 0) return;
    console.log(`[Reaper] agent reaper: ${stale.length} stale agent(s) to delete (threshold ${Math.round(HUB_AGENT_STALE_THRESHOLD_MS / 1000)}s)`);
    for (const agent of stale) {
      const staleMs = Date.now() - Date.parse(agent.lastSeenAt);
      // CP3 C4 cascade unpin — strip the stale agentId from any thread
      // that still pins them to its currentTurnAgentId. Audited per
      // thread so forensic readers can trace the transition.
      try {
        const unpinned = await threadStore.unpinCurrentTurnAgent(agent.id);
        for (const threadId of unpinned) {
          await auditStore.logEntry(
            "hub",
            "thread_currentturn_unpinned_via_agent_reaper",
            `Thread ${threadId} currentTurnAgentId cleared because pinned agent ${agent.id} (role=${agent.role}) was reaped after ${Math.round(staleMs / 1000)}s offline.`,
            threadId,
          );
        }
        if (unpinned.length > 0) {
          console.log(`[Reaper] agent ${agent.id}: ${unpinned.length} thread(s) unpinned via cascade`);
        }
      } catch (unpinErr) {
        console.error(`[Reaper] cascade unpin failed for agent ${agent.id}:`, unpinErr);
      }

      try {
        const deleted = await engineerRegistry.deleteAgent(agent.id);
        if (deleted) {
          await auditStore.logEntry(
            "hub",
            "agent_reaper_deleted",
            `Agent ${agent.id} (role=${agent.role}, fingerprint=${agent.fingerprint.slice(0, 12)}…) deleted after ${Math.round(staleMs / 1000)}s offline (threshold ${Math.round(HUB_AGENT_STALE_THRESHOLD_MS / 1000)}s). lastSeenAt=${agent.lastSeenAt}.`,
            agent.id,
          );
        }
      } catch (deleteErr) {
        console.error(`[Reaper] deleteAgent failed for ${agent.id}:`, deleteErr);
      }
    }
  } catch (err) {
    console.error("[Reaper] agent reaper tick failed:", err);
  }
}

function startAgentReaper(): void {
  if (agentReaperHandle) return;
  console.log(`[Hub] Starting agent reaper: interval=${HUB_AGENT_REAPER_INTERVAL_MS}ms, stale-threshold=${HUB_AGENT_STALE_THRESHOLD_MS}ms`);
  agentReaperHandle = setInterval(() => {
    void runAgentReaperTick();
  }, HUB_AGENT_REAPER_INTERVAL_MS);
  agentReaperHandle.unref?.();
}

function stopAgentReaper(): void {
  if (agentReaperHandle) {
    clearInterval(agentReaperHandle);
    agentReaperHandle = null;
  }
}

// ── Continuation Sweep (task-314, mission-38 Task 1b) ────────────────
// Periodic background task symmetric to the reapers. Picks queue items
// in `continuation_required` state (set by agents calling
// save_continuation when round-budget runs low), transitions them back
// to `enqueued` via IPendingActionStore.resumeContinuation, and re-
// dispatches them to the target agent with the saved continuationState
// embedded in the outbound payload. The adapter can then resume from
// the snapshot rather than restart from scratch. Default cadence: 15s
// (faster than the 1h reapers because continuation delivery is
// user-latency-sensitive).

const HUB_CONTINUATION_SWEEP_INTERVAL_MS = parseInt(
  process.env.HUB_CONTINUATION_SWEEP_INTERVAL_MS || String(15 * 1000),
  10,
);

let continuationSweepHandle: NodeJS.Timeout | null = null;

async function runContinuationSweepTick(): Promise<void> {
  try {
    const items = await pendingActionStore.listContinuationItems();
    if (items.length === 0) return;
    console.log(`[Sweep] continuation: ${items.length} item(s) to re-dispatch`);
    for (const item of items) {
      try {
        const resumed = await pendingActionStore.resumeContinuation(item.id);
        if (!resumed) continue; // Race: another sweep or admin action drained it first.
        const { item: refreshed, continuationState } = resumed;
        // Re-emit the original dispatchType with continuationState embedded
        // so the adapter routes via its existing event-router path.
        try {
          await hub.dispatchEvent(
            refreshed.dispatchType,
            {
              ...refreshed.payload,
              sourceQueueItemId: refreshed.id,
              continuationState,
            },
            { agentIds: [refreshed.targetAgentId] },
          );
          await auditStore.logEntry(
            "hub",
            "queue_item_continuation_resumed",
            `Queue item ${refreshed.id} re-dispatched from continuation_required (kind=${typeof continuationState.kind === "string" ? continuationState.kind : "unspecified"}, target=${refreshed.targetAgentId}).`,
            refreshed.id,
          );
        } catch (dispatchErr) {
          console.error(
            `[Sweep] continuation re-dispatch failed for ${refreshed.id}:`,
            dispatchErr,
          );
        }
      } catch (err) {
        console.error(`[Sweep] continuation tick failed on item ${item.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[Sweep] continuation tick failed:", err);
  }
}

function startContinuationSweep(): void {
  if (continuationSweepHandle) return;
  console.log(`[Hub] Starting continuation sweep: interval=${HUB_CONTINUATION_SWEEP_INTERVAL_MS}ms`);
  continuationSweepHandle = setInterval(() => {
    void runContinuationSweepTick();
  }, HUB_CONTINUATION_SWEEP_INTERVAL_MS);
  continuationSweepHandle.unref?.();
}

function stopContinuationSweep(): void {
  if (continuationSweepHandle) {
    clearInterval(continuationSweepHandle);
    continuationSweepHandle = null;
  }
}

// Mission-51 W2: bounded-shadow message-projection sweeper. Runs a
// full-sweep on Hub startup (catches anything orphaned mid-projection
// by the previous Hub instance dying), then ticks every 5s as a
// backstop to the in-process W1 migration shim. Idempotent via
// findByMigrationSourceId; safe under concurrent thread-reply commits.
const messageProjectionSweeper = new MessageProjectionSweeper(
  threadStore,
  messageStore,
  // mission-84 W7: PR #203 revert — OIS_MESSAGE_PROJECTION_SWEEPER_INTERVAL_MS
  // env-var dropped; restored to pre-PR-#203 default (5s per git commit a940a38).
  // Substrate-backed list-queries are O(N_due) via indexes (bug-93 closure at
  // mission-83 W5.4 cutover); the 74% CPU pressure that motivated PR #203 was
  // structurally eliminated. Sweeper continues to poll (substrate-watch
  // subscription is W8/W9 architectural-future-leverage; v1 keeps polling).
  // C3-R4b piece 2: audit = durable queryable 0-bare-violation sink.
  { intervalMs: 5000, audit: auditStore, metrics: createMetricsCounter() },
);

// Mission-51 W4: scheduled-message sweeper. Polls every 1s for
// scheduled+pending messages whose fireAt has been reached; evaluates
// optional precondition; transitions scheduledState pending→delivered
// (fire) or pending→precondition-failed (cancel + audit-entry).
// Hub-startup full-sweep catches anything pending across restart.
const scheduledMessageSweeper = new ScheduledMessageSweeper(
  messageStore,
  auditStore,
  {
    forSweeper: () => ({
      stores: allStores,
      metrics: createMetricsCounter(),
      emit: async () => {},
      dispatch: async () => {},
      sessionId: "scheduled-message-sweeper",
      clientIp: "127.0.0.1",
      role: "system",
      internalEvents: [],
    } as unknown as import("./policy/types.js").IPolicyContext),
  },
  // mission-84 W7: PR #203 revert — OIS_SCHEDULED_MESSAGE_SWEEPER_INTERVAL_MS
  // env-var dropped; restored to pre-PR-#203 default (1s; same as the env-var-
  // pre-default since the env-var-default itself was already 1s; the override
  // at start-hub.sh:274 = 30000 is what PR #203 actually changed).
  { intervalMs: 1000 },
);

// Mission-51 W5: cascade-replay sweeper (closes bug-31). Runs once
// on Hub startup (before serving traffic). Lists threads with
// cascadePending=true; re-runs runCascade for each. Per-action
// idempotency (existing findByCascadeKey short-circuit) prevents
// duplication on replay. No periodic ticking — process death is the
// only way the marker stays set, and Hub-startup is the natural
// retry boundary.
const cascadeReplaySweeper = new CascadeReplaySweeper(
  threadStore,
  {
    forSweeper: () => ({
      stores: allStores,
      metrics: createMetricsCounter(),
      emit: async () => {},
      dispatch: async () => {},
      sessionId: "cascade-replay-sweeper",
      clientIp: "127.0.0.1",
      role: "system",
      internalEvents: [],
    } as unknown as import("./policy/types.js").IPolicyContext),
  },
  // C3-R4b piece 2: durable queryable sink for 0-bare-violation audit entries.
  { audit: auditStore },
);

// C1-R2 (mission-94) sub-PR-4a: WorkItem lease-expiry sweeper. Periodic tick (well
// under LEASE_TTL_MS 15min) re-queues a crashed/wedged holder's lapsed lease to ready
// (leaseExpiryCount++) and POISON-ABANDONS an item that has lapsed poisonCap (3) times.
// Inherits the cal-84 bare-row escalation (audit + metric). Cadence configurable.
const WORKITEM_LEASE_SWEEP_INTERVAL_MS = Number(process.env.OIS_WORKITEM_LEASE_SWEEP_INTERVAL_MS ?? 60_000);
const workItemLeaseSweeper = new WorkItemLeaseSweeper(
  workItemStore,
  {
    forSweeper: () => ({
      stores: allStores,
      metrics: createMetricsCounter(),
      emit: async () => {},
      // work-54 (idea-357 pt-2): the sweeper emits lease-expiry transition events
      // via emitAndPush — a no-op dispatch would persist them but never SSE-push
      // (the mission-60 Gap #1 / pulse-sweeper lesson; same bind as pulseSweeper below).
      dispatch: hub.dispatchEvent.bind(hub),
      sessionId: "workitem-lease-sweeper",
      clientIp: "127.0.0.1",
      role: "system",
      internalEvents: [],
    } as unknown as import("./policy/types.js").IPolicyContext),
  },
  // 4b-ii: agentStore drives the per-AGENT thrash-quarantine (claim→expire-without-
  // evidence → increment holder's counter; quarantine at thrashCap=3, the C2 seam).
  { audit: auditStore, agentStore: engineerRegistry, thrashCap: 3 },
);

// Mission-57 W2: PulseSweeper — single-instance recurring sweeper that
// drives declarative per-mission pulse coordination. 60s tick; iterates
// active missions with `pulses.{engineerPulse, architectPulse}` config;
// per-pulse evaluates fire-due / missed-threshold / precondition; emits
// pulse Messages via the existing message-store; observes acks via the
// `message-policy.ts:ackMessage` webhook hook (Item-2 composition).
const pulseSweeper = new PulseSweeper(
  missionStore,
  messageStore,
  {
    forSweeper: () => ({
      stores: allStores,
      metrics: createMetricsCounter(),
      emit: async () => {},
      // Mission-61 W1 Fix #1: wire dispatch through HubNetworking so
      // PulseSweeper-fired Messages reach operator sessions via SSE.
      // Previously a no-op (mission-60 Gap #1 root cause at the wiring
      // layer): pulses were created in storage but no SSE push fired.
      // Path A symmetry with the MCP-tool boundary's `ctx.dispatch` at
      // `message-policy.ts:208-221`. The adapter is already wired for
      // `message_arrived` events with `payload.pulseKind` per mission-57
      // W3 (`adapters/claude-plugin/src/source-attribute.ts:80-141`);
      // this wire-up makes that adapter handler spring to life.
      dispatch: hub.dispatchEvent.bind(hub),
      sessionId: "pulse-sweeper",
      clientIp: "127.0.0.1",
      role: "system",
      internalEvents: [],
    } as unknown as import("./policy/types.js").IPolicyContext),
  },
  {
    intervalMs: parseInt(process.env.OIS_PULSE_SWEEPER_INTERVAL_MS ?? "60000", 10),
  },
);
allStores.pulseSweeper = pulseSweeper;

// Mission-52 T3: repo-event-bridge composition. Conditional on
// OIS_GH_API_TOKEN — absent → bridge skipped, Hub starts cleanly.
// PAT scope/auth failures are caught inside RepoEventBridge.start()
// (logged + bridge halts; Hub continues per directive).
const OIS_GH_API_TOKEN = process.env.OIS_GH_API_TOKEN;
const OIS_REPO_EVENT_BRIDGE_REPOS = parseReposEnvVar(
  process.env.OIS_REPO_EVENT_BRIDGE_REPOS,
);
const OIS_REPO_EVENT_BRIDGE_CADENCE_S = parseInt(
  process.env.OIS_REPO_EVENT_BRIDGE_CADENCE_S ?? "30",
  10,
);
const OIS_REPO_EVENT_BRIDGE_RATE_BUDGET_PCT = parseFloat(
  process.env.OIS_REPO_EVENT_BRIDGE_RATE_BUDGET_PCT ?? "0.8",
);

let repoEventBridge: RepoEventBridge | undefined;
if (OIS_GH_API_TOKEN && OIS_REPO_EVENT_BRIDGE_REPOS.length > 0) {
  // mission-84 W3 cluster #23 closure: in substrate-mode, wire repo-event-bridge
  // cursor + dedupe persistence through HubStorageSubstrate via the adapter (kinds
  // RepoEventBridgeCursor + RepoEventBridgeDedupe; both watchable: false per
  // Design v1.1 §2.3 Variant ii minimal-SchemaDef). mission-84 W4 retired FS-mode
  // fallback (FS-version-repos + storageProvider deleted); substrate is
  // unconditional post-W4 (production-Hub locked to substrate per mission-83 W5.4).
  repoEventBridge = new RepoEventBridge({
    // bug-99 fix: dual-prefix accept-list per idea-255 (workflow-run-poll-source
    // uses distinct pathPrefix from main events-poll-source). Pre-fix single-
    // prefix adapter halted bridge at workflow-run-poll-source startup.
    storage: new RepoEventBridgeSubstrateAdapter({
      substrate: substrate!,
      pathPrefixes: ["repo-event-bridge", "repo-event-bridge-workflow-runs"],
    }),
    token: OIS_GH_API_TOKEN,
    repos: OIS_REPO_EVENT_BRIDGE_REPOS,
    cadenceSeconds: OIS_REPO_EVENT_BRIDGE_CADENCE_S,
    budgetFraction: OIS_REPO_EVENT_BRIDGE_RATE_BUDGET_PCT,
    createMessageInvoke: createPolicyRouterInvoker(policyRouter, () => ({
      stores: allStores,
      metrics: createMetricsCounter(),
      emit: async () => {},
      dispatch: async () => {},
      sessionId: "repo-event-bridge",
      clientIp: "127.0.0.1",
      role: "system",
      internalEvents: [],
    } as unknown as import("./policy/types.js").IPolicyContext)),
  });
} else if (OIS_GH_API_TOKEN && OIS_REPO_EVENT_BRIDGE_REPOS.length === 0) {
  console.warn(
    "[Hub] OIS_GH_API_TOKEN set but OIS_REPO_EVENT_BRIDGE_REPOS empty/unset — repo-event-bridge skipped (configure repos to enable).",
  );
} else {
  console.log(
    "[Hub] OIS_GH_API_TOKEN not set — repo-event-bridge skipped (set token + OIS_REPO_EVENT_BRIDGE_REPOS to enable).",
  );
}

startupSequence().then(async () => {
  await hub.start();
  startThreadReaper();
  startAgentReaper();
  startContinuationSweep();
  // Mission-51 W2: full-sweep before announcing readiness so any
  // unprojected messages from the previous Hub instance are caught up
  // before traffic starts flowing.
  try {
    const swept = await messageProjectionSweeper.fullSweep();
    if (swept.messagesProjected > 0 || swept.errors > 0) {
      console.log(
        `[Hub] Startup message-projection sweep: scanned=${swept.threadsScanned} projected=${swept.threadsProjected} messages=${swept.messagesProjected} errors=${swept.errors}`,
      );
    }
  } catch (err) {
    console.warn("[Hub] Startup message-projection sweep failed; sweeper still starts:", err);
  }
  messageProjectionSweeper.start();
  // Mission-51 W4: full-sweep before announcing readiness so any
  // scheduled-pending messages that became due during the previous
  // Hub-down window fire promptly.
  try {
    const swept = await scheduledMessageSweeper.fullSweep();
    if (swept.fired > 0 || swept.cancelled > 0 || swept.errors > 0) {
      console.log(
        `[Hub] Startup scheduled-message sweep: scanned=${swept.scanned} fired=${swept.fired} cancelled=${swept.cancelled} errors=${swept.errors}`,
      );
    }
  } catch (err) {
    console.warn("[Hub] Startup scheduled-message sweep failed; sweeper still starts:", err);
  }
  scheduledMessageSweeper.start();
  // Mission-57 W2: PulseSweeper — drives declarative per-mission pulse
  // coordination. 60s tick (configurable via OIS_PULSE_SWEEPER_INTERVAL_MS).
  pulseSweeper.start();
  // Mission-51 W5: cascade-replay sweeper. Hub-startup full-sweep
  // catches threads orphaned mid-cascade by previous Hub instance
  // dying. Idempotent on already-completed actions (cascade-key
  // short-circuit). Hub-startup-only (no periodic ticking).
  try {
    const replayed = await cascadeReplaySweeper.fullSweep();
    if (replayed.scanned > 0 || replayed.errors > 0) {
      console.log(
        `[Hub] Startup cascade-replay sweep: scanned=${replayed.scanned} replayed=${replayed.replayed} errors=${replayed.errors}`,
      );
    }
  } catch (err) {
    console.warn("[Hub] Startup cascade-replay sweep failed; Hub still starts:", err);
  }
  // C1-R2 sub-PR-4a: WorkItem lease-expiry sweep — startup pass (catches leases that
  // lapsed during a Hub-down window) then periodic ticking.
  try {
    const swept = await workItemLeaseSweeper.fullSweep(new Date().toISOString());
    if (swept.requeued > 0 || swept.abandoned > 0 || swept.errors > 0 || swept.quarantined > 0) {
      console.log(`[Hub] Startup WorkItem lease sweep: scanned=${swept.scanned} requeued=${swept.requeued} abandoned=${swept.abandoned} skipped=${swept.skipped} errors=${swept.errors} quarantined=${swept.quarantined}`);
    }
  } catch (err) {
    console.warn("[Hub] Startup WorkItem lease sweep failed; sweeper still starts:", err);
  }
  workItemLeaseSweeper.start(WORKITEM_LEASE_SWEEP_INTERVAL_MS);

  // mission-102 P3-B6: EMIT-ONLY decision-aging sweep (S2.4) — reads dwell in
  // the routed queue, mints NudgeReceipts, emits decision-aging-notification.
  // NEVER transitions a Decision (the B1 no-timer invariant). Hourly default.
  const DECISION_AGING_SWEEP_INTERVAL_MS = Number(process.env.OIS_DECISION_AGING_SWEEP_INTERVAL_MS ?? 3_600_000);
  setInterval(() => {
    const sweepCtx = {
      stores: allStores,
      metrics: createMetricsCounter(),
      emit: async () => {},
      dispatch: hub.dispatchEvent.bind(hub),
      sessionId: "decision-aging-sweeper",
      clientIp: "127.0.0.1",
      role: "system",
      internalEvents: [],
    } as unknown as import("./policy/types.js").IPolicyContext;
    // B2: the 24h curation-SLO breach pass shares the interval (one sweep, §4).
    void runCurationSloSweep(sweepCtx).catch((e) =>
      console.error(`[curation-slo-sweep] tick failed (non-fatal): ${e instanceof Error ? e.message : e}`),
    );
    void runDecisionAgingSweep({
      stores: allStores,
      metrics: createMetricsCounter(),
      emit: async () => {},
      dispatch: hub.dispatchEvent.bind(hub),
      sessionId: "decision-aging-sweeper",
      clientIp: "127.0.0.1",
      role: "system",
      internalEvents: [],
    } as unknown as import("./policy/types.js").IPolicyContext).catch((e) =>
      console.error(`[decision-aging-sweep] tick failed (non-fatal): ${e instanceof Error ? e.message : e}`),
    );
  }, DECISION_AGING_SWEEP_INTERVAL_MS).unref();
  // Mission-52 T3: start repo-event-bridge if configured. PAT failures
  // are caught inside .start() — Hub continues with bridge in `failed`
  // state per directive (no Hub-crash on under-scoped tokens).
  if (repoEventBridge) {
    await repoEventBridge.start();
  }
  console.log(`[Hub] MCP Relay Hub listening on port ${PORT}`);
  console.log(`[Hub] MCP endpoint: POST/GET/DELETE /mcp`);
  console.log(`[Hub] Health check: GET /health`);
}).catch(async (err) => {
  console.error("[Hub] Startup sequence error:", err);
  // Start anyway
  await hub.start();
  startThreadReaper();
  startAgentReaper();
  startContinuationSweep();
  messageProjectionSweeper.start();
  scheduledMessageSweeper.start();
  pulseSweeper.start();
  console.log(`[Hub] MCP Relay Hub listening on port ${PORT} (with startup warning)`);
});

// ── Graceful Shutdown ────────────────────────────────────────────────
// mission-86 W2: SIGTERM handler mirrors SIGINT so `docker stop` (the W4
// production cutover) drains in-flight ops cleanly instead of falling
// through to SIGKILL. Both signals route to the same shutdown path.
async function shutdown(signal: string): Promise<void> {
  console.log(`[Hub] Shutting down (${signal})...`);
  stopThreadReaper();
  stopAgentReaper();
  stopContinuationSweep();
  messageProjectionSweeper.stop();
  scheduledMessageSweeper.stop();
  pulseSweeper.stop();
  // Mission-52 T3: stop the bridge before the Hub network so any
  // in-flight create_message dispatches land cleanly.
  if (repoEventBridge) {
    await repoEventBridge.stop();
  }
  await hub.stop();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
