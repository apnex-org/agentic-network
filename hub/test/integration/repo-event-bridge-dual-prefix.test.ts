/**
 * bug-99 fix integration test (mission-84 post-mortem; D3 deliverable per
 * architect §5 disposition) — RepoEventBridgeSubstrateAdapter dual-prefix
 * accept-list.
 *
 * ─── bug-99 root-cause ────────────────────────────────────────────────────
 *
 * mission-84 W3 ship initially constructed RepoEventBridgeSubstrateAdapter with
 * single `pathPrefix: "repo-event-bridge"` accept. workflow-run-poll-source (per
 * idea-255 M-Workflow-Run-Events-Hub-Integration) constructs its own CursorStore
 * with distinct `pathPrefix: "repo-event-bridge-workflow-runs"` for namespace
 * isolation — adapter's path-validation threw at startup, halting the entire
 * RepoEventBridge subsystem.
 *
 * ─── What this test verifies (D1 + D3 SCOPE) ──────────────────────────────
 *
 * (1) Both prefixes accept writes via shared adapter (bug-99 startup-survival)
 * (2) Negative-test: out-of-list paths still rejected
 *
 * ─── Known secondary defect surfaced by D3 implementation (architect surface) ──
 *
 * The adapter's current id-mapping strips the prefix and uses bare `<repoId>` as
 * substrate id. Both prefixes therefore share the SAME (kind=RepoEventBridgeCursor,
 * id=<repoId>) substrate key — when PollSource + WorkflowRunPollSource are wired
 * with overlapping repo-lists (current production wiring at hub/src/index.ts:755
 * passes SAME `OIS_REPO_EVENT_BRIDGE_REPOS` to both sources via repo-event-
 * handler.ts:109+118), their cursor writes COLLIDE in substrate.
 *
 * Surface-area: this is a substrate-id-scheme decision (composite-id `prefix:repoId`
 * vs separate-kinds-per-prefix `RepoEventBridgeWorkflowRunsCursor`); architect-
 * ratify needed before engineer expansion. NOT autonomously fixed in this PR per
 * `feedback_design_audit_survey_anchor` discipline + `feedback_bilateral_audit_
 * round_budget_discipline` (scope-bound autonomous execution to architect-intent).
 *
 * Skip-test below DOCUMENTS the collision-class; flip to `.it` after architect
 * surface + namespacing-scheme ratify.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createTestPool } from "../../src/storage-substrate/__tests__/_pg-test-pool.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createPostgresStorageSubstrate, createSchemaReconciler, ALL_SCHEMAS } from "../../src/storage-substrate/index.js";
import { RepoEventBridgeSubstrateAdapter } from "../../src/storage-substrate/repo-event-bridge-adapter.js";
import type { HubStorageSubstrate } from "../../src/storage-substrate/types.js";
import { CursorStore, type RepoCursor } from "@apnex/repo-event-bridge";

const MAIN_PREFIX = "repo-event-bridge";
const WORKFLOW_RUN_PREFIX = "repo-event-bridge-workflow-runs";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "src", "storage-substrate", "migrations");
const MIGRATION_FILES = [
  "001-entities-table.sql",
  "002-notify-trigger.sql",
  "003-jsonb-size-check.sql",
];

let container: StartedPostgreSqlContainer;
let connStr: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:15-alpine")
    .withUsername("hub")
    .withPassword("hub")
    .withDatabase("hub")
    .start();
  connStr = `postgres://hub:hub@${container.getHost()}:${container.getPort()}/hub`;
  const pool = createTestPool(connStr, "repo-event-bridge-dual-prefix");
  for (const f of MIGRATION_FILES) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
    await pool.query(sql);
  }
  await pool.end();
}, 60_000);

afterAll(async () => {
  if (container) await container.stop();
}, 30_000);

async function bootDualPrefixStack(): Promise<{
  substrate: HubStorageSubstrate;
  mainCursorStore: CursorStore;
  workflowCursorStore: CursorStore;
  close: () => Promise<void>;
}> {
  const substrate = createPostgresStorageSubstrate(connStr);
  const reconciler = createSchemaReconciler(substrate, connStr, {
    initialSchemas: ALL_SCHEMAS,
    log: () => { /* silent */ },
    warn: () => { /* silent */ },
  });
  await reconciler.start();

  // SHARED adapter with dual-prefix accept-list — mirrors hub/src/index.ts production wire-up
  const adapter = new RepoEventBridgeSubstrateAdapter({
    substrate,
    pathPrefixes: [MAIN_PREFIX, WORKFLOW_RUN_PREFIX],
  });

  // TWO CursorStore instances — each constructs paths with its own prefix
  const mainCursorStore = new CursorStore({ storage: adapter, pathPrefix: MAIN_PREFIX });
  const workflowCursorStore = new CursorStore({ storage: adapter, pathPrefix: WORKFLOW_RUN_PREFIX });

  return {
    substrate,
    mainCursorStore,
    workflowCursorStore,
    close: async () => {
      await reconciler.close();
      await (substrate as unknown as { close: () => Promise<void> }).close();
    },
  };
}

describe("bug-99 fix: RepoEventBridgeSubstrateAdapter dual-prefix accept-list (D1 scope)", () => {
  let testCounter = 0;
  const uniqueRepo = () => `dual-prefix-test__repo-${++testCounter}`;

  it("BOTH prefixes accept writes via shared adapter (bug-99 startup-survival)", async () => {
    // Use DISJOINT repoIds per prefix (mirrors a deployment where main + workflow
    // poll-sources poll DIFFERENT repos) — proves the bug-99 startup-survival
    // dimension without triggering the known secondary collision-defect.
    const stack = await bootDualPrefixStack();
    const repoIdMain = `${uniqueRepo()}-main`;
    const repoIdWorkflow = `${uniqueRepo()}-workflow`;

    const mainCursor: RepoCursor = { etag: "main-v1", lastEventId: "evt-main-1", updatedAt: new Date().toISOString() };
    const workflowCursor: RepoCursor = { etag: "wf-v1", lastEventId: "evt-wf-1", updatedAt: new Date().toISOString() };

    // bug-99 repro: workflow-prefix would THROW before fix; verify both succeed
    const mainToken = await stack.mainCursorStore.writeCursor(repoIdMain, mainCursor, null);
    const workflowToken = await stack.workflowCursorStore.writeCursor(repoIdWorkflow, workflowCursor, null);

    expect(mainToken).not.toBeNull();
    expect(workflowToken).not.toBeNull();

    // Round-trip-read confirms persistence
    expect((await stack.mainCursorStore.readCursor(repoIdMain)).value).toEqual(mainCursor);
    expect((await stack.workflowCursorStore.readCursor(repoIdWorkflow)).value).toEqual(workflowCursor);

    await stack.close();
  }, 30_000);

  it("rejects out-of-list paths (negative-test guard against accept-list drift)", async () => {
    const stack = await bootDualPrefixStack();
    // Use the adapter directly to exercise its parsePath validation
    const adapter = new RepoEventBridgeSubstrateAdapter({
      substrate: stack.substrate,
      pathPrefixes: [MAIN_PREFIX, WORKFLOW_RUN_PREFIX],
    });
    await expect(adapter.get("some-other-subsystem/cursor/x")).rejects.toThrow(/outside accept-list/);
    await stack.close();
  }, 30_000);
});

// ─── Known secondary defect: dual-prefix substrate-id collision (architect surface) ──
//
// These tests are SKIPPED — they document the collision-class for future
// `.it` flip after architect ratifies the substrate-namespacing scheme
// (composite-id vs separate-kinds-per-prefix). See file-level header for context.
describe.skip("ARCHITECT-SURFACE: dual-prefix substrate-id collision (overlapping repoIds)", () => {
  let testCounter = 0;
  const uniqueRepo = () => `collision-test__repo-${++testCounter}`;

  it("isolation: same repoId across both prefixes should NOT collide in substrate", async () => {
    const stack = await bootDualPrefixStack();
    const repoId = uniqueRepo(); // SAME repoId across prefixes (current production wiring)

    const mainCursor: RepoCursor = { etag: "main", lastEventId: "evt-main", updatedAt: new Date().toISOString() };
    const workflowCursor: RepoCursor = { etag: "wf", lastEventId: "evt-wf", updatedAt: new Date().toISOString() };

    await stack.mainCursorStore.writeCursor(repoId, mainCursor, null);
    // CURRENT BEHAVIOR (broken): collides on substrate id; createOnly fails as conflict
    // EXPECTED BEHAVIOR (post-architect-fix): independent namespace via composite-id or separate-kinds
    await stack.workflowCursorStore.writeCursor(repoId, workflowCursor, null);

    expect((await stack.mainCursorStore.readCursor(repoId)).value).toEqual(mainCursor);
    expect((await stack.workflowCursorStore.readCursor(repoId)).value).toEqual(workflowCursor);

    await stack.close();
  }, 30_000);

  it("dedupe state isolated between prefixes (per-prefix LRU)", async () => {
    const stack = await bootDualPrefixStack();
    const repoId = uniqueRepo();
    const sharedIds = ["evt-A", "evt-B", "evt-C"];

    const { token: mainToken } = await stack.mainCursorStore.filterUnseen(repoId, sharedIds);
    await stack.mainCursorStore.markSeen(repoId, sharedIds, mainToken);

    // CURRENT (broken): workflow-prefix sees them as already-seen (shared dedupe-store key)
    // EXPECTED: workflow-prefix has independent LRU
    const { unseen: workflowSeed } = await stack.workflowCursorStore.filterUnseen(repoId, sharedIds);
    expect(workflowSeed).toEqual(sharedIds);

    await stack.close();
  }, 30_000);
});
