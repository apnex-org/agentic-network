# @apnex/claude-plugin changelog

## 0.1.12 — mission-100 Claude Code shim restoration (offline-functional)

- Extracts an importable Claude runtime factory so MockClaudeClient and tests drive the real Claude shim runtime seam.
- Enforces the facade boundary: Claude shim imports the @apnex network-adapter facade only; direct cognitive-layer/message-router dependencies removed.
- Upgrades MockClaudeClient to consume the real runtime factory instead of recreating dispatcher wiring.
- Adds package/install integrity tests for the Claude plugin artifact.
- Adds offline conformance coverage for MCP initialize/listTools/callTool, shared dispatch, signal wrapping, channel notifications, queue item injection, work-lease observation, cache/reconciler list_changed, and no-live-certification boundary.

Caveat: this release is **offline-functional**. Live Claude LLM certification remains deferred until quota returns.
