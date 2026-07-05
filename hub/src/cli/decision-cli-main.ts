/**
 * decision-cli-main.ts — the thin standalone wrapper for the SC5 spike
 * (work-121): readline IO + the Hub's MCP/HTTP endpoint. No logic here — the
 * contract lives in decision-cli.ts and is CI-proven in-process; this wrapper
 * exists so the same core demonstrably runs against a LIVE Hub.
 *
 *   HUB_URL=https://<hub> HUB_ARCHITECT_TOKEN=<bearer> HUB_DIRECTOR_TOKEN=<bearer> \
 *     npx tsx src/cli/decision-cli-main.ts        (HUB_TOKEN = both, dev fallback)
 */
import { createInterface } from "node:readline/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { runDecisionCli, twoIdentityCaller, type VerbCaller } from "./decision-cli.js";

async function connectClient(url: string, token: string): Promise<Client> {
  const client = new Client({ name: "ois-decision-cli", version: "0.0.1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

function callerFor(client: Client): VerbCaller {
  return async (tool, args) => {
    const r = (await client.callTool({ name: tool, arguments: args })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    const body = JSON.parse(r.content[0].text) as Record<string, unknown>;
    if (r.isError) throw new Error(`${tool} rejected: ${String(body.error)}`);
    return body;
  };
}

async function main(): Promise<void> {
  // Live-Hub RBAC needs BOTH identities (audit-10168): the architect-proxy
  // surface token for render/mint/echo/resolve and the registered Director
  // ingress token for capture_director_signal. HUB_TOKEN alone is the
  // single-identity fallback for dev hubs with RBAC relaxed.
  const url = process.env.HUB_URL;
  const architectToken = process.env.HUB_ARCHITECT_TOKEN ?? process.env.HUB_TOKEN;
  const directorToken = process.env.HUB_DIRECTOR_TOKEN ?? process.env.HUB_TOKEN;
  if (!url || !architectToken || !directorToken) {
    throw new Error("HUB_URL plus HUB_ARCHITECT_TOKEN+HUB_DIRECTOR_TOKEN (or HUB_TOKEN for both) are required");
  }

  const surfaceClient = await connectClient(url, architectToken);
  const directorClient = directorToken === architectToken ? surfaceClient : await connectClient(url, directorToken);
  const call = twoIdentityCaller(callerFor(surfaceClient), callerFor(directorClient));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await runDecisionCli(call, {
      prompt: (q) => rl.question(q),
      print: (line) => console.log(line),
    });
  } finally {
    rl.close();
    await surfaceClient.close();
    if (directorClient !== surfaceClient) await directorClient.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
