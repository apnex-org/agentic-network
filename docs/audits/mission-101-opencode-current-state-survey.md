# Mission-101 OpenCode current-state survey

**WorkItem:** `work-bp-opencode_refactor_dist1-survey`  
**Mission:** `mission-101` — M-OpenCode-Plugin-Refactor-Distribution  
**Survey head:** `d86e9c2` (`release: claude-plugin 0.1.12 (mission-100 restoration)`)  
**Date:** 2026-07-03  
**Scope:** survey only. No OpenCode implementation refactor performed.

## 1. Executive summary

OpenCode is live and test-green, but it is not yet in the post-mission-100 architecture family.

Current state on fresh main:

- `@apnex/opencode-plugin` workspace version is `0.2.1`.
- `npm view @apnex/opencode-plugin` returns `E404`; it is not published on npm.
- Director/operator confirmed live OpenCode GPT-5.5 testing is available for this mission; work-110 should be planned as downstream live evidence after the selected runtime/distribution path is ready, not treated as default-deferred.
- `adapters/opencode-plugin/src/shim.ts` still imports directly from `@apnex/message-router` and `@apnex/cognitive-layer`.
- `adapters/opencode-plugin/package.json` and root `package-lock.json` still declare direct deps on `@apnex/cognitive-layer`, `@apnex/message-router`, and `@apnex/network-adapter`.
- There is no importable `createOpenCodeRuntime(...)` seam. Production owns a module-init singleton dispatcher plus large module state in `shim.ts`.
- `MockOpenCodeClient` still constructs its own dispatcher/agent harness instead of consuming a production runtime factory.
- OpenCode distribution currently has two divergent shapes:
  - source/GitHub quickstart path (`github` + `path: adapters/opencode-plugin/src/shim.ts`), and
  - self-contained esbuild release bundle (`scripts/build/release-opencode-plugin.sh`) that inlines `@apnex/*` source.
- The shared npm publish flow explicitly excludes OpenCode from publication, although CI installs/tests the workspace.
- Baseline is green for build/test/bundle, but the OpenCode release script currently fails its version-bump assert because `src/` advanced after the last `0.2.1` bump.

The main implementation risk is false-green test coverage: current OpenCode tests exercise real shared dispatcher behavior, but they do not prove a single production runtime seam because no such seam exists. This is the same class mission-100 fixed for Claude by extracting `createClaudeRuntime(...)` and moving `MockClaudeClient` onto it.

## 2. Evidence commands

Executed on branch `greg/opencode-current-state-survey-w1` at `d86e9c2`.

```text
npx tsc -p adapters/opencode-plugin/tsconfig.json --noEmit
  -> PASS

npm test --workspace=@apnex/opencode-plugin
  -> PASS: 6 files / 44 tests

npm run bundle --workspace=@apnex/opencode-plugin
  -> PASS: dist/shim.js bundled; kernel @apnex/network-adapter@0.1.6 inlined

npm pack --workspace=@apnex/opencode-plugin --dry-run --ignore-scripts --json
  -> PASS: apnex-opencode-plugin-0.2.1.tgz, 19 entries, includes dist/, src/, test/, QUICKSTART.md, AGENTS.md

scripts/build/release-opencode-plugin.sh
  -> FAIL at version-bump assert:
     @apnex/opencode-plugin@0.2.1 src/ advanced past version bump
     version-bump commit: 7295220...
     latest src/ commit: 5843fdd...

npm view @apnex/opencode-plugin version
  -> E404 Not Found

npm view @apnex/claude-plugin version dependencies --json
  -> 0.1.12, deps: @modelcontextprotocol/sdk 1.29.0 + @apnex/network-adapter ^0.1.6

npm view @apnex/pi-plugin version dependencies peerDependencies --json
  -> 0.1.2, deps: @apnex/network-adapter ^0.1.6, pi peers present
```

Bundle sanity:

```text
adapters/opencode-plugin/dist/shim.js bytes: 828744
ES import references to @apnex/*: 0
export block: HubPlugin only
literal @apnex strings remain only as data/comments/version identity strings
```

## 3. Direct `@apnex/*` imports and dependencies

### 3.1 Source imports

`grep -RIn "from ['\"]@apnex/" adapters/opencode-plugin/src adapters/opencode-plugin/test` shows production drift in `src/shim.ts`:

```text
adapters/opencode-plugin/src/shim.ts:49  from "@apnex/network-adapter";
adapters/opencode-plugin/src/shim.ts:53  from "@apnex/message-router";
adapters/opencode-plugin/src/shim.ts:54  import { CognitivePipeline } from "@apnex/cognitive-layer";
```

Tests import `@apnex/network-adapter` only.

### 3.2 Package deps

`adapters/opencode-plugin/package.json`:

```json
"dependencies": {
  "@modelcontextprotocol/sdk": "1.29.0",
  "@apnex/cognitive-layer": "*",
  "@apnex/message-router": "*",
  "@apnex/network-adapter": "*"
}
```

Root `package-lock.json` matches this direct-dep shape.

### 3.3 Facade status

`packages/network-adapter/src/index.ts` already re-exports `CognitivePipeline`, so the cognitive import can be rerouted the same way mission-100 rerouted Claude.

`NotificationCoalescer` and `CoalescedNotification` are exported by `@apnex/message-router` but are not currently re-exported by `@apnex/network-adapter`. OpenCode cannot become facade-clean until the network-adapter facade exports these first.

**Survey conclusion:** The facade cleanup is straightforward but must be sequenced:

1. add `NotificationCoalescer` and `CoalescedNotification` exports to `@apnex/network-adapter`;
2. reroute OpenCode shim imports through `@apnex/network-adapter`;
3. remove direct OpenCode deps on cognitive/message-router;
4. update lockfile;
5. add a guard test/lint so this drift cannot recur.

## 4. Runtime and dispatcher lifecycle

### 4.1 Current production shape

OpenCode production runtime is concentrated in `adapters/opencode-plugin/src/shim.ts`:

- Exports `HubPlugin` plus test-only helpers (`_testOnly`, `makeOpenCodeFetchHandler`) from `shim.ts`.
- Release bundle entry `src/plugin-entry.ts` re-exports only `HubPlugin` to satisfy OpenCode 1.3.x loader constraints.
- Creates a singleton `dispatcher = createSharedDispatcher(...)` at module init.
- Uses late-bound module state (`hubAdapter`, `config`, `sdkClient`, `currentSessionId`, `currentRole`, `reconciler`, `activeProxyServers`).
- `HubPlugin` defers startup in a `setTimeout(..., 3000)` background init:
  1. read current OpenCode session;
  2. read required agent name;
  3. `connectToHub(...)` creates/starts `McpAgentClient`;
  4. `startProxyServer()` starts `Bun.serve` local MCP proxy;
  5. registers the proxy with OpenCode via `sdkClient.mcp.add(...)`.
- `makeOpenCodeFetchHandler(...)` creates one MCP `Server` per initialize request using `dispatcher.createMcpServer()` and `WebStandardStreamableHTTPServerTransport`.
- `ToolSurfaceReconciler` is lazy-built in `connectToHub(...)` because `config.hubUrl` is unavailable at module init.

### 4.2 Legitimate OpenCode-specific divergences

Not every divergence from Claude/Pi is drift:

- OpenCode consumes MCP over local HTTP (`Bun.serve` + Streamable HTTP), not stdio.
- OpenCode has session event handling, prompt queue/coalescer, `promptAsync`, `showToast`, and `sdkClient.mcp.add(...)` last-mile behavior.
- OpenCode has no persistent tool-catalog cache; its `ToolSurfaceReconciler` uses `readServedRevision: () => null`. This is documented in code as a deliberate shim-boundary difference.
- Release bundle must export `HubPlugin` only; `plugin-entry.ts` enforces this.

### 4.3 Runtime seam gap

There is no `createOpenCodeRuntime(...)` analogous to Claude's `createClaudeRuntime(...)`.

The likely seam should own reusable production wiring while accepting host-specific injections:

- agent/client construction or late-bound `McpAgentClient` injection;
- dispatcher creation and callbacks;
- notification hooks / coalescer binding;
- tool-surface reconciler construction and heartbeat hook;
- fetch handler / per-session server factory;
- session event handlers or their state object;
- logger/config/sdk client dependencies.

The design checkpoint must decide how much module-init state can move safely. The current module-init dispatcher exists because OpenCode config loads later; a runtime seam may need a two-phase construction (`createOpenCodeRuntimeSkeleton` + `connect`) or dependency thunks rather than a pure Claude-style factory.

## 5. MockOpenCodeClient fidelity risks

`adapters/opencode-plugin/test/mocks/MockOpenCodeClient.ts` is useful and green, but it is not yet mission-100-trustworthy.

Current mock shape:

- Builds `PolicyLoopbackHub`, architect agent, engineer agent.
- Creates its own `createSharedDispatcher(...)` in the mock.
- Wires InMemory MCP client to `dispatcher.createMcpServer()`.
- Wires only a subset of callbacks:
  - actionable event path calls `dispatcher.callbacks.onActionableEvent`;
  - informational event is a no-op.
- Does not consume a production OpenCode runtime factory because none exists.
- Does not exercise `NotificationCoalescer`, prompt queue, `promptLLM`, `injectContext`, `showToast`, session activity pacing, `makeOpenCodeFetchHandler`, `Bun.serve`, or OpenCode SDK registration.

This is materially similar to the pre-mission-100 Claude false-green: the mock exercises real dispatcher behavior but recreates enough production wiring that production/mock drift can hide.

Recommended uplift:

1. extract a production runtime seam first;
2. move MockOpenCodeClient onto that seam;
3. add static guard tests preventing `MockOpenCodeClient` from reintroducing inline `createSharedDispatcher(...)` construction outside the runtime seam;
4. add OpenCode-specific conformance tests after the mock uses the real runtime.

## 6. Package, bundle, release, and registry state

### 6.1 Package metadata

`@apnex/opencode-plugin@0.2.1` package currently declares:

- `main: dist/shim.js`;
- `files: ["dist/", "src/", "test/", "tsconfig.json", "QUICKSTART.md", "AGENTS.md"]`;
- build scripts: `prebuild`, `build`, `bundle`, `start`, `dev`, `test`;
- direct deps on cognitive/message-router/network-adapter.

If published as-is to npm, the package would expose source and test files and retain direct internal deps. That is not aligned with Claude/Pi graph-publish shape.

### 6.2 Bundle path

`scripts/build/bundle-opencode.js` creates a self-contained ESM bundle from `src/plugin-entry.ts`:

- aliases `@apnex/cognitive-layer`, `@apnex/message-router`, and `@apnex/network-adapter` to workspace `src/index.ts` files;
- inlines `__OPENCODE_BUILD_INFO__` and `__NETWORK_ADAPTER_VERSION__`;
- externalizes `@opencode-ai/plugin` because the host provides it;
- emits `dist/shim.js`.

`scripts/build/release-opencode-plugin.sh` then gates:

1. version-bump `--assert`;
2. clean `dist/`;
3. bundle;
4. verify no `from "@apnex/..."` imports remain;
5. verify export surface is `HubPlugin` only.

The bundle path is currently coherent and self-contained, but its aliases hard-code the direct internal package topology the mission wants to eliminate from the shim boundary.

### 6.3 Release gate current finding

`release-opencode-plugin.sh` fails before bundling because the version gate detects that `src/` advanced after `0.2.1`:

```text
[build-info:assert] FAIL — @apnex/opencode-plugin@0.2.1: src/ advanced PAST the version bump.
version-bump commit: 7295220...
latest src/ commit:  5843fdd...
```

This is good hygiene: it prevents shipping a bundle without a version bump. It also means any release decision must include a version bump/lockfile/changelog step.

### 6.4 Registry state

`npm view @apnex/opencode-plugin` returns `E404`. OpenCode is not part of the published `@apnex/*` npm family.

By contrast:

- `@apnex/claude-plugin@0.1.12` is published and depends only on `@modelcontextprotocol/sdk@1.29.0` and `@apnex/network-adapter@^0.1.6`.
- `@apnex/pi-plugin@0.1.2` is published and depends on `@apnex/network-adapter@^0.1.6` with Pi packages as peers.

### 6.5 Publish workflow state

`.github/workflows/publish-npm.yml` installs `@apnex/opencode-plugin` for workspace graph closure but does not publish it.

`scripts/publish-packages.sh` explicitly publishes only:

1. `@apnex/cognitive-layer`
2. `@apnex/message-router`
3. `@apnex/network-adapter`
4. `@apnex/claude-plugin`
5. `@apnex/pi-plugin`

The script comment says OpenCode remains on the GitHub channel and npm cutover is deferred to the Claude/OpenCode refactor mission.

## 7. Quickstart / install path

`adapters/opencode-plugin/QUICKSTART.md` documents:

- GitHub no-clone config:

```jsonc
{
  "plugins": {
    "hub-notifications": {
      "github": "apnex/agentic-network",
      "path": "adapters/opencode-plugin/src/shim.ts"
    }
  }
}
```

- developer install from a local clone:

```jsonc
{
  "plugins": {
    "hub-notifications": {
      "path": "/path/to/agentic-network/adapters/opencode-plugin/src/shim.ts"
    }
  }
}
```

- credential config via `.ois/adapter-config.json` or env.

It does not document npm install/update, bundle install, canonical version verification, package migration, or source/GitHub-to-npm cutover. This is correct for current state but must change before an npm/package release.

## 8. Current test coverage and gaps

### 8.1 Existing test coverage

`npm test --workspace=@apnex/opencode-plugin` passes: 6 files / 44 tests.

Existing tests cover:

- shared dispatcher behavior via OpenCode lens;
- full loopback E2E for MCP listTools/callTool, thread queue item injection, completion ack, cognitive middlewares;
- fetch handler routing branches;
- session event status handling (`busy`/`retry`/`idle`, error/deleted flush);
- ToolSurfaceReconciler seed/drift/fanout and heartbeat trigger;
- MockOpenCodeClient smoke/tape path.

CI includes `adapters/opencode-plugin` in `vitest-non-hub`, with scoped workspace install and topological sovereign package build.

### 8.2 Gaps relative to mission-101 target

Missing or insufficient:

- No `createOpenCodeRuntime(...)` factory test because no runtime factory exists.
- MockOpenCodeClient does not consume production runtime wiring.
- No facade-boundary test proving OpenCode imports only `@apnex/network-adapter` from `@apnex/*`.
- No package integrity test proving intended npm/bundle artifacts.
- No test asserting `plugin-entry.ts`/bundle export surface at the package level beyond release script behavior.
- No offline conformance suite covering OpenCode-specific runtime startup ordering end-to-end.
- No pack/install-from-registry-or-tarball proof because no registry package exists.
- No migration test for GitHub/source config to npm or bundled package config.
- No live OpenCode smoke evidence in this survey yet; however, work-110 now provides a planned live GPT-5.5 certification node after `distribution_standardization`, `offline_conformance`, and `package_integrity`.

## 9. Distribution standardisation options

### Option A — Graph-published npm package like Claude/Pi

Shape:

- OpenCode publishes `@apnex/opencode-plugin` to npm.
- Package declares `@apnex/network-adapter` dependency only from the `@apnex/*` graph.
- OpenCode host resolves package dependencies through its plugin/npm install mechanism.

Pros:

- Standardises on ADR-029 family graph.
- Reuses `publish-npm.yml` and `publish-packages.sh` after adding OpenCode to explicit publish list.
- Aligns with post-mission-100 Claude and Pi.
- Makes facade boundary maximally meaningful.

Risks/questions:

- Must verify OpenCode's plugin loader can consume npm package deps cleanly in the intended deployment path.
- Must define canonical OpenCode config syntax for npm package install/update.
- May require package files whitelist change to avoid shipping tests/source unnecessarily.

### Option B — Bundled npm package

Shape:

- Publish `@apnex/opencode-plugin` as an npm fetch channel for the existing self-contained `dist/shim.js` bundle.
- Runtime has no `@apnex/*` dependencies; bundle inlines network-adapter source.

Pros:

- Closest to current source-free bundle design.
- Avoids OpenCode dependency-resolution unknowns.
- Keeps one-file runtime artifact and `HubPlugin`-only export surface.

Risks/questions:

- Diverges from Claude/Pi graph-publish shape.
- Requires publish tooling to understand bundle-specific gates.
- Bundle aliases can hide facade drift unless source-level guards are added.
- Version/build identity must remain carefully inlined and tested.

### Option C — Dual channel temporarily

Shape:

- Keep GitHub/source path while introducing npm package behind a documented migration gate.
- Release states clearly which channel is certified.

Pros:

- Safest operational cutover.
- Allows live/cross-lineage smoke before retiring GitHub path.

Risks/questions:

- Two channels can drift unless one is explicitly deprecated and timeboxed.
- Documentation must be very clear to avoid users installing the wrong artifact.

### Survey recommendation

Do not publish the current package as-is.

The design node should prefer **Option A (graph-published npm)** if OpenCode's plugin loader can resolve package dependencies reliably, because it best matches the post-mission-100 family and the A3 facade rule. If loader constraints make graph publish unreliable, choose **Option B (bundled npm)** deliberately and encode bundle-specific integrity gates. Option C is acceptable only as a short, explicit migration bridge.

Live certification is now available, so W2 should not frame live OpenCode smoke as a default deferral. Instead, design the runtime/distribution path so `work-110` can certify the selected artifact with GPT-5.5 after distribution, package integrity, and offline conformance are in place.

## 10. Live GPT-5.5 evidence plan

Mission brief §10 and `work-110` establish a downstream live certification node:

- **WorkItem:** `work-110` — Live OpenCode GPT-5.5 smoke certification.
- **Dependencies:** after `distribution_standardization`, `offline_conformance`, and `package_integrity`.
- **Execution posture:** live smoke should exercise the selected OpenCode plugin artifact/path, not the current pre-refactor path by default.
- **Evidence target:** version/build identity; Hub agent registration/role/name; tool list availability; at least one safe tool call through shared dispatch; notification/prompt behavior if feasible; tool-surface refresh/list_changed behavior if a safe surface-change trigger is available.
- **Honesty rule:** explicitly document any skipped live sub-check with rationale. Keep live certification distinct from offline conformance.

## 11. Proposed next gated slices

1. **Design decision node:** ratify runtime seam and artifact shape before implementation, including how the selected path will be live-smoked by `work-110`.
2. **Facade prerequisite:** export `NotificationCoalescer` / `CoalescedNotification` via `@apnex/network-adapter` if graph/facade path is chosen.
3. **Runtime seam:** extract `createOpenCodeRuntime(...)` or a two-phase equivalent that respects delayed config/OpenCode SDK constraints.
4. **MockOpenCodeClient v2:** consume the production runtime seam; add guard against inline dispatcher recreation.
5. **Facade fold-in:** reroute imports/deps and add boundary guard tests.
6. **Distribution standardisation:** implement chosen npm/bundle artifact path and update quickstart/migration docs.
7. **Package integrity:** prove the selected artifact/package shape before live certification.
8. **Offline conformance:** after runtime/mock uplift, test real runtime path for listTools/callTool, sourceQueueItemId, signal wrapper, coalescer/prompt queue, session events, work leases, reconciler/list_changed, and no live-cert overclaim.
9. **Live GPT-5.5 smoke (`work-110`):** run after distribution/package/offline gates to certify the selected artifact/path with real OpenCode.
10. **Release decision:** version bump, lockfile sync, changelog, pack/bundle proof, registry verification if published, work-110 disposition, and explicit offline-vs-live claim boundary.

## 12. Completion/audit note

This survey is complete as an engineer-authored current-state document. The WorkItem requires a bindable audit with `relatedEntity=mission-101`; engineer role cannot create that audit entry. Architect or verifier must bind an audit referencing this document before the WorkItem can be completed.
