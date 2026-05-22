/**
 * tool-surface-revision.ts — stable fingerprint of the Hub's MCP tool surface.
 *
 * bug-114: the network-adapter's tool-catalog cache invalidated on the
 * `hubVersion` reported by `/health` — but `/health` returned a hardcoded
 * `"1.0.0"` literal that never changed, so the cache never invalidated on
 * intra-version tool-surface drift (tools added/removed, description or
 * schema changes). The validity key conflated a *deploy-release identity*
 * with the *tool-surface identity* the cache actually needs.
 *
 * This module computes a Hub-owned revision token over the router's tool
 * registrations. The adapter treats it as an opaque ETag: record the
 * revision seen at fetch-time, compare against the live revision, mismatch
 * → re-bootstrap. The Hub never interprets it; only equality matters.
 *
 * Determinism: tools are sorted by name; each contributes
 * `{ name, description, schema, tier }` — the complete advertised-surface
 * tuple (`bindRouterToMcp` advertises nothing else). `schema` is the
 * recursively key-sorted JSON Schema of the registered zod shape; `tier`
 * is the `adapter-internal`/`llm-callable` classification — a tier flip
 * shifts the adapter-advertised surface (`bindRouterToMcp` prepends a
 * marker for adapter-internal tools; the shim filters on it) without
 * touching name/description/schema. The digest is sha256-hex truncated —
 * collision-irrelevant for an equality check over a tool set of this size.
 *
 * The router is a stateless singleton fixed at boot, so callers compute
 * this once at startup and serve it as a constant.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import type { PolicyRouter } from "./router.js";

/**
 * Recursively sort object keys so `JSON.stringify` output is order-stable
 * regardless of property-insertion order in the source object.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(src)
        .sort()
        .map((k) => [k, canonicalize(src[k])]),
    );
  }
  return value;
}

/**
 * Compute the tool-surface revision for a PolicyRouter.
 *
 * Iterates every registered tool name (including deprecated aliases —
 * `getAllToolNames()` is exactly what `bindRouterToMcp` advertises), in
 * sorted order, and hashes `{ name, description, schema, tier }` per tool.
 *
 * A zod shape that won't convert to JSON Schema falls back to its sorted
 * parameter-name set for that tool — still deterministic, still moves the
 * revision when parameters are added or removed.
 */
export function computeToolSurfaceRevision(router: PolicyRouter): string {
  const tools = router
    .getAllToolNames()
    .slice()
    .sort()
    .map((name) => {
      const reg = router.getToolRegistration(name);
      if (!reg) return { name };
      let schema: unknown;
      try {
        schema = canonicalize(z.toJSONSchema(z.object(reg.schema)));
      } catch {
        schema = { __unconvertible: Object.keys(reg.schema).sort() };
      }
      return { name, description: reg.description, schema, tier: reg.tier };
    });

  return createHash("sha256")
    .update(JSON.stringify(tools))
    .digest("hex")
    .slice(0, 16);
}
