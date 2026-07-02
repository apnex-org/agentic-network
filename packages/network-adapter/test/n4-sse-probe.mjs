// n4 SSE probe — reproduce the direct-localhost SSE-keepalive drop WITHOUT a nested claude
// (no quota). Uses the SAME MCP SDK StreamableHTTPClientTransport the shim's wire uses, connects
// to the n4 test-Hub, and logs keepalive notifications + disconnects over ~45s (past the 30s
// keepalive). If the SSE stays alive 45s -> the test-Hub keepalive delivers; if it drops at ~30s
// -> reproduces the agent's "sse_watchdog / Maximum reconnection attempts" drop. Diagnostic; rm after.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ts = () => new Date().toISOString().slice(11, 23);
const url = new URL(process.env.HUB_URL || "http://127.0.0.1:18080/mcp");
const RUN_MS = Number(process.env.RUN_MS || 45000);

const transport = new StreamableHTTPClientTransport(url);
transport.onerror = (e) => console.log(`[${ts()}] TRANSPORT onerror: ${e?.message ?? e}`);
transport.onclose = () => console.log(`[${ts()}] TRANSPORT onclose`);

const client = new Client({ name: "n4-sse-probe", version: "1.0.0" }, { capabilities: {} });
client.onerror = (e) => console.log(`[${ts()}] CLIENT onerror: ${e?.message ?? e}`);
client.fallbackNotificationHandler = async (n) => {
  const p = JSON.stringify(n.params ?? {}).slice(0, 90);
  console.log(`[${ts()}] NOTIFICATION ${n.method} ${p}`);
};

const start = Date.now();
await client.connect(transport);
console.log(`[${ts()}] CONNECTED (sessionId=${transport.sessionId})`);

let dropped = false;
transport.onclose = () => { dropped = true; console.log(`[${ts()}] TRANSPORT onclose @ ${Math.round((Date.now() - start) / 1000)}s`); };

const iv = setInterval(() => {
  console.log(`[${ts()}] alive ${Math.round((Date.now() - start) / 1000)}s (dropped=${dropped})`);
}, 5000);

await new Promise((r) => setTimeout(r, RUN_MS));
clearInterval(iv);
console.log(`[${ts()}] DONE after ${Math.round((Date.now() - start) / 1000)}s — dropped=${dropped}`);
try { await client.close(); } catch {}
process.exit(0);
