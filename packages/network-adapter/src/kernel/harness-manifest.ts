/**
 * Harness manifest — the per-harness STANDARD config as schema-validated DATA
 * (M-Adapter-Modernization Design §3, P1b — the #1 shim-audit structural gap).
 *
 * The per-harness config (proxyName, transport, serverName, tool-prefix/dialect,
 * injection-mechanism, the 3-valued capability-matrix, auth-order, env-template)
 * was hardcoded inline in each shim. This single-homes it as a schema-validated
 * JSON manifest the shim LOADS, so per-harness variation is DATA (references, not
 * topology) and a new harness is a manifest + thin glue. Per-AGENT INSTANCE values
 * (hubUrl/token/name/labels) stay in ENV — the manifest lists only the var NAMES
 * (envTemplate), never the values.
 *
 * Validation is HAND-ROLLED (no zod — it is a dev-dep only; the kernel's existing
 * validators — parseLabels, parseHandshakeResponse — are hand-rolled too) so the
 * published package carries no extra runtime dep. parseHarnessManifest throws a
 * field-named error on any violation (fail-closed; a malformed manifest must not
 * boot a mis-shaped adapter).
 */
import { readFileSync } from "node:fs";

/** A 3-valued capability cell (scion-steelman: yes/partial/no + REASON + per-capability unevenness). */
export interface HarnessCapability {
  value: "yes" | "partial" | "no";
  reason: string;
}

export interface HarnessManifest {
  /** Schema version (forward-compat). */
  manifestVersion: 1;
  /** Harness id, e.g. "claude" | "opencode". */
  harness: string;
  /** npm package name of the shim, e.g. "@apnex/claude-plugin". */
  proxyName: string;
  /** Transport id reported on handshake, e.g. "stdio-mcp-proxy". */
  transport: string;
  /** MCP server name, e.g. "proxy". */
  serverName: string;
  /** Tool-prefix / dialect the host sees, e.g. "mcp__plugin_agent-adapter_proxy__". */
  toolPrefix: string;
  /**
   * Last-hop injection mechanism (capability-matrix seed). For claude this is the
   * MCP server-notification method exposed as an experimental server capability
   * (e.g. "claude/channel"); the shim builds serverCapabilities from it.
   */
  injectionChannel: string;
  /** Free-form mechanism descriptor, e.g. "mcp-server-notification". */
  injectionMechanism: string;
  /** Optional protocol dialect descriptor (e.g. "mcp"). (P1e A8 — folds the manifest's dialect field.) */
  dialect?: string;
  /** The 3-valued per-capability matrix (capability-name -> cell). */
  capabilityMatrix: Record<string, HarnessCapability>;
  /** Credential resolution order, e.g. ["defaults","file","env"]. */
  authOrder: string[];
  /** Per-agent ENV var NAMES (instance config); values live in the environment, never here. */
  envTemplate: string[];
}

function fail(msg: string): never {
  throw new Error(`harness-manifest: ${msg}`);
}
function str(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) fail(`field '${key}' must be a non-empty string`);
  return v as string;
}
function strArray(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) fail(`field '${key}' must be a string[]`);
  return v as string[];
}

/**
 * Validate + parse a raw object into a HarnessManifest. Throws a field-named
 * Error on any violation (fail-closed). Returns the typed manifest on success.
 */
export function parseHarnessManifest(raw: unknown): HarnessManifest {
  if (typeof raw !== "object" || raw === null) fail("manifest must be a JSON object");
  const o = raw as Record<string, unknown>;
  if (o.manifestVersion !== 1) fail("manifestVersion must be 1");

  const cmRaw = o.capabilityMatrix;
  if (typeof cmRaw !== "object" || cmRaw === null || Array.isArray(cmRaw)) {
    fail("field 'capabilityMatrix' must be an object map");
  }
  const capabilityMatrix: Record<string, HarnessCapability> = {};
  for (const [name, cell] of Object.entries(cmRaw as Record<string, unknown>)) {
    if (typeof cell !== "object" || cell === null) fail(`capability '${name}' must be an object`);
    const c = cell as Record<string, unknown>;
    if (c.value !== "yes" && c.value !== "partial" && c.value !== "no") {
      fail(`capability '${name}'.value must be one of yes|partial|no (got ${JSON.stringify(c.value)})`);
    }
    if (typeof c.reason !== "string" || c.reason.length === 0) {
      fail(`capability '${name}'.reason must be a non-empty string (the per-capability unevenness rationale)`);
    }
    capabilityMatrix[name] = { value: c.value, reason: c.reason };
  }

  return {
    manifestVersion: 1,
    harness: str(o, "harness"),
    proxyName: str(o, "proxyName"),
    transport: str(o, "transport"),
    serverName: str(o, "serverName"),
    toolPrefix: str(o, "toolPrefix"),
    injectionChannel: str(o, "injectionChannel"),
    injectionMechanism: str(o, "injectionMechanism"),
    ...(typeof o.dialect === "string" ? { dialect: o.dialect } : {}),
    capabilityMatrix,
    authOrder: strArray(o, "authOrder"),
    envTemplate: strArray(o, "envTemplate"),
  };
}

/** Read + validate a manifest JSON file. Throws on read or validation failure (fail-closed). */
export function loadHarnessManifest(path: string): HarnessManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    fail(`cannot read/parse manifest at ${path}: ${(err as Error)?.message ?? String(err)}`);
  }
  return parseHarnessManifest(raw);
}

/**
 * Build the MCP serverCapabilities object from a manifest's injectionChannel —
 * the experimental server-notification capability the host negotiates (e.g.
 * { tools: {}, experimental: { "claude/channel": {} } }).
 */
export function serverCapabilitiesFromManifest(m: HarnessManifest): {
  tools: Record<string, never>;
  experimental: Record<string, Record<string, never>>;
} {
  return { tools: {}, experimental: { [m.injectionChannel]: {} } };
}
