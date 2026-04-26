/**
 * Ephemeral architect client for admin scripts.
 *
 * Most admin tooling (migrate_agent_queue, cleanup jobs, ad-hoc reconciliation)
 * needs an architect-role session to call `[Architect]`-gated tools. Each
 * script was re-implementing the same bootstrap: read `.ois/adapter-config.json`,
 * mint a random `globalInstanceId`, construct `McpAgentClient`, start it.
 * This helper collapses that into one call.
 *
 * Usage:
 *   import { withArchitectClient } from "./lib/architect-client.js";
 *
 *   await withArchitectClient("admin-migrate", async (client) => {
 *     const result = await client.call("migrate_agent_queue", { ... });
 *     console.log(result);
 *   });
 *
 * Reads credentials from `.ois/adapter-config.json` or
 * `OIS_HUB_URL` / `OIS_HUB_TOKEN` env vars (env overrides file).
 */

import { McpAgentClient } from "../../packages/network-adapter/src/index.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface ArchitectClientOptions {
  /** Short identifier that shows up in Hub audit logs as proxyName / clientInfo. */
  scriptName: string;
  /** Override config path (default: `<cwd>/.ois/adapter-config.json`). */
  configPath?: string;
  /** Optional logger — defaults to silent. */
  logger?: (line: string) => void;
}

export function loadHubConfig(configPath?: string): { hubUrl: string; hubToken: string } {
  const path = configPath ?? resolve(process.cwd(), ".ois", "adapter-config.json");
  if (!existsSync(path)) {
    throw new Error(`No hub config at ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const hubUrl = process.env.OIS_HUB_URL || raw.hubUrl;
  const hubToken = process.env.OIS_HUB_TOKEN || raw.hubToken;
  if (!hubUrl) throw new Error("hubUrl missing (set OIS_HUB_URL or .ois/adapter-config.json)");
  return { hubUrl, hubToken };
}

/**
 * Construct, start, and tear down an ephemeral architect-role session
 * around the caller's `fn`. Guarantees `client.stop()` runs even on throw.
 */
export async function withArchitectClient<T>(
  scriptName: string,
  fn: (client: McpAgentClient) => Promise<T>,
  options: Omit<ArchitectClientOptions, "scriptName"> = {},
): Promise<T> {
  const { hubUrl, hubToken } = loadHubConfig(options.configPath);
  const client = new McpAgentClient(
    {
      role: "architect",
      handshake: {
        globalInstanceId: `admin-${randomUUID()}`,
        proxyName: scriptName,
        proxyVersion: "0.0.0",
        transport: "http",
        sdkVersion: "0.0.0",
        getClientInfo: () => ({ name: scriptName, version: "0.0.0" }),
      },
      logger: options.logger ?? (() => {}),
    },
    { transportConfig: { url: hubUrl, token: hubToken } },
  );
  client.setCallbacks({});
  await client.start();
  try {
    return await fn(client);
  } finally {
    await client.stop();
  }
}
