# Claude Harness Programmable Tool Surface

Status: implementation note for `claudeuplift0` / mission-118  
Decision: Claude uses MCP `notifications/tools/list_changed` plus cache repair; Pi HCAP is not extracted in this slice.

## Summary

Claude is the MCP binding of the shared adapter architecture. Its programmable tool surface is the MCP `ListTools`/`CallTool` surface served by `createSharedDispatcher().createMcpServer()`.

For this host, correctness is provided by the shared `ToolSurfaceReconciler` repair path:

1. Resolve the Hub live tool-surface revision.
2. Read the on-disk served catalog revision fresh.
3. If the served revision is stale, re-fetch the live catalog and atomically rewrite the cache.
4. Emit `notifications/tools/list_changed` as best-effort acceleration so the live host can re-enumerate.

The emit is not the correctness mechanism. Cache repair is.

## Why not HCAP extraction?

Pi HCAP exists because Pi has a native active tool set (`registerTool` / `setActiveTools`) that must be converged against a declared spec. Claude does not expose that native active-set seam in this adapter; the host-visible surface is MCP enumeration.

Under A3 Earned Exposure, Pi HCAP should remain Pi-local until another real consumer needs declared-spec/running-set convergence. Current Claude evidence does not show that need.

## Invariants

- Claude production source imports only `@apnex/network-adapter` from the `@apnex/*` graph.
- Claude MCP `CallTool` reaches shared `runToolDispatch`; host code does not own per-call Hub dispatch policy.
- `createClaudeRuntime` remains the importable runtime seam for production wiring and tests.
- Tool-surface convergence tests must prove disk repair/convergence, not just list_changed emission.
- Live Claude CLI behavior is a separate proof level from offline conformance.

## Tests

Load-bearing tests for this slice:

- `adapters/claude-plugin/test/facade-boundary.test.ts` rejects any production `@apnex/*` import other than `@apnex/network-adapter`.
- `adapters/claude-plugin/test/runtime-factory.test.ts` keeps runtime wiring importable and testable.
- `adapters/claude-plugin/test/offline-conformance.test.ts` proves the MCP path, dispatch wrapping, lease observation, and tool-surface cache repair plus best-effort list_changed emission.

## Non-claims

- This note does not claim live Claude CLI behavior.
- This note does not claim package publish/deploy.
- This note does not claim Pi/opencode behavior changed.
- This note does not forbid future HCAP extraction; it requires new evidence before extraction.
