/**
 * Unit tests for computeToolSurfaceRevision (bug-114).
 *
 * The revision is a Hub-owned ETag over the router's tool registrations.
 * It MUST be:
 *   - deterministic    — same surface → same revision (repeatable)
 *   - order-stable     — registration order doesn't move the revision
 *   - drift-sensitive  — tool add/remove, description change, schema
 *                        change, tier change all move the revision
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { PolicyRouter, type ToolTier } from "../src/policy/router.js";
import { computeToolSurfaceRevision } from "../src/policy/tool-surface-revision.js";
import { registerWorkItemPolicy } from "../src/policy/work-item-policy.js";

const noop = () => {};
const handler = async () => ({ content: [{ type: "text" as const, text: "ok" }] });

function routerWith(
  tools: Array<{
    name: string;
    description: string;
    schema: Record<string, z.ZodType>;
    tier?: ToolTier;
  }>,
): PolicyRouter {
  const router = new PolicyRouter(noop);
  // tier passed through register()'s 6th param; undefined → defaults to
  // "llm-callable" (PolicyRouter.register default).
  for (const t of tools) router.register(t.name, t.description, t.schema, handler, undefined, t.tier);
  return router;
}

const BASE = [
  { name: "create_thread", description: "[Any] Open a thread", schema: { title: z.string() } },
  { name: "list_axioms", description: "[Any] List axioms", schema: {} },
];

describe("computeToolSurfaceRevision", () => {
  it("produces a stable, short hex digest", () => {
    const rev = computeToolSurfaceRevision(routerWith(BASE));
    expect(rev).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic — same surface yields the same revision", () => {
    expect(computeToolSurfaceRevision(routerWith(BASE))).toBe(
      computeToolSurfaceRevision(routerWith(BASE)),
    );
  });

  it("is order-stable — registration order does not move the revision", () => {
    const forward = routerWith(BASE);
    const reversed = routerWith([...BASE].reverse());
    expect(computeToolSurfaceRevision(forward)).toBe(
      computeToolSurfaceRevision(reversed),
    );
  });

  it("moves when a tool is added", () => {
    const before = computeToolSurfaceRevision(routerWith(BASE));
    const after = computeToolSurfaceRevision(
      routerWith([...BASE, { name: "get_bug", description: "[Any] Get a bug", schema: { bugId: z.string() } }]),
    );
    expect(after).not.toBe(before);
  });

  it("moves when a tool is removed", () => {
    const before = computeToolSurfaceRevision(routerWith(BASE));
    const after = computeToolSurfaceRevision(routerWith(BASE.slice(0, 1)));
    expect(after).not.toBe(before);
  });

  it("moves when a description changes", () => {
    const before = computeToolSurfaceRevision(routerWith(BASE));
    const after = computeToolSurfaceRevision(
      routerWith([
        { ...BASE[0], description: "[Any] Open a thread (revised)" },
        BASE[1],
      ]),
    );
    expect(after).not.toBe(before);
  });

  it("moves when a tool's schema changes (param added)", () => {
    const before = computeToolSurfaceRevision(routerWith(BASE));
    const after = computeToolSurfaceRevision(
      routerWith([
        { ...BASE[0], schema: { title: z.string(), labels: z.array(z.string()) } },
        BASE[1],
      ]),
    );
    expect(after).not.toBe(before);
  });

  it("moves when a param's type changes (string → number)", () => {
    const before = computeToolSurfaceRevision(routerWith(BASE));
    const after = computeToolSurfaceRevision(
      routerWith([{ ...BASE[0], schema: { title: z.number() } }, BASE[1]]),
    );
    expect(after).not.toBe(before);
  });

  it("moves when a param's optionality changes", () => {
    const before = computeToolSurfaceRevision(routerWith(BASE));
    const after = computeToolSurfaceRevision(
      routerWith([{ ...BASE[0], schema: { title: z.string().optional() } }, BASE[1]]),
    );
    expect(after).not.toBe(before);
  });

  it("moves when a tool's tier changes (llm-callable ↔ adapter-internal)", () => {
    // A tier flip shifts the adapter-advertised surface — bindRouterToMcp
    // marks adapter-internal tools, the shim filters on it — while
    // leaving name/description/schema untouched. The revision must move.
    const before = computeToolSurfaceRevision(routerWith(BASE)); // both default llm-callable
    const after = computeToolSurfaceRevision(
      routerWith([{ ...BASE[0], tier: "adapter-internal" }, BASE[1]]),
    );
    expect(after).not.toBe(before);
  });
});

// S2b (idea-456) — L1 left-edge of the two-victim reachability oracle.
// The generic tests above prove the ETag is drift-sensitive with SYNTHETIC
// tools; this proves it against the REAL registration that caused the
// incident — the [Any] verbs update_work + pause_work entering the live hub
// surface must move R. Both victims (not just one) crossing the boundary is
// the false-green killer the oracle's downstream reconciler leg relies on:
// a single-verb delta could pass while the real multi-verb registration
// regressed.
describe("computeToolSurfaceRevision — S2b two-victim L1 (real registration delta)", () => {
  const VICTIMS = ["update_work", "pause_work"] as const;

  it("both update_work AND pause_work are absent pre-registration, present post — and R moves", () => {
    const before = new PolicyRouter(noop); // baseline surface: no work-item verbs
    const after = new PolicyRouter(noop);
    registerWorkItemPolicy(after); // the redeploy that registers the [Any] work verbs

    const beforeTools = new Set(before.getAllToolNames());
    const afterTools = new Set(after.getAllToolNames());
    for (const v of VICTIMS) {
      expect(beforeTools.has(v)).toBe(false); // not in the stale surface
      expect(afterTools.has(v)).toBe(true); // in the live surface
    }

    // The real registration delta moves the ETag — the signal the reconciler
    // downstream diffs to decide whether to emit tools/list_changed.
    expect(computeToolSurfaceRevision(after)).not.toBe(computeToolSurfaceRevision(before));
  });
});
