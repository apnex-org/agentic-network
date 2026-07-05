/**
 * decision-cli-main.ts — the thin standalone wrapper for the SC5 spike
 * (work-121): readline IO + the Hub's MCP/HTTP endpoint. No logic here — the
 * contract lives in decision-cli.ts and is CI-proven in-process; this wrapper
 * exists so the same core demonstrably runs against a LIVE Hub.
 *
 *   HUB_URL=https://<hub> HUB_TOKEN=<bearer> npx tsx src/cli/decision-cli-main.ts
 */
import { createInterface } from "node:readline/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { runDecisionCli, type VerbCaller } from "./decision-cli.js";

async function main(): Promise<void> {
  const url = process.env.HUB_URL;
  const token = process.env.HUB_TOKEN;
  if (!url || !token) throw new Error("HUB_URL and HUB_TOKEN are required");

  const client = new Client({ name: "ois-decision-cli", version: "0.0.1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );

  const call: VerbCaller = async (tool, args) => {
    const r = (await client.callTool({ name: tool, arguments: args })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    const body = JSON.parse(r.content[0].text) as Record<string, unknown>;
    if (r.isError) throw new Error(`${tool} rejected: ${String(body.error)}`);
    return body;
  };

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await runDecisionCli(call, {
      prompt: (q) => rl.question(q),
      print: (line) => console.log(line),
    });
  } finally {
    rl.close();
    await client.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
