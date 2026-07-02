/**
 * index.ts — @apnex/pi-plugin extension entry (pi ExtensionAPI factory).
 *
 * The pi host binding for the OIS agentic network. Registers lifecycle handlers
 * ONLY at factory time (no connect, no timers, no background resources — pi's
 * documented rule: defer to session_start). All real work is in shim.ts.
 *
 * Role: architect (default; override via OIS_HUB_ROLE / config.role).
 *
 * Design: docs/designs/m-pi-plugin-adapter-design.md §6
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { startSession, shutdownSession } from "./shim.js";

export default function (pi: ExtensionAPI): void {
  // Defer ALL background work to session_start (pi factory must be inert).
  pi.on("session_start", async (_event, ctx) => {
    await startSession(pi, ctx);
  });

  pi.on("session_shutdown", async () => {
    await shutdownSession();
  });
}
