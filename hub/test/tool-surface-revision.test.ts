/**
 * Unit tests for computeToolSurfaceRevision (bug-114).
 *
 * The revision is a Hub-owned ETag over the router's tool registrations.
 * It MUST be:
 *   - deterministic    — same surface → same revision (repeatable)
 *   - order-stable     — registration order doesn't move the revision
 *   - drift-sensitive  — tool add/remove, description change, schema
 *                        change all move the revision
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { PolicyRouter } from "../src/policy/router.js";
import { computeToolSurfaceRevision } from "../src/policy/tool-surface-revision.js";

const noop = () => {};
const handler = async () => ({ content: [{ type: "text" as const, text: "ok" }] });

function routerWith(
  tools: Array<{ name: string; description: string; schema: Record<string, z.ZodType> }>,
): PolicyRouter {
  const router = new PolicyRouter(noop);
  for (const t of tools) router.register(t.name, t.description, t.schema, handler);
  return router;
}

const BASE = [
  { name: "create_thread", description: "[Any] Open a thread", schema: { title: z.string() } },
  { name: "list_tele", description: "[Any] List teles", schema: {} },
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
});
