/**
 * Document Policy — substrate-backed (mission-84 W6 re-introduction).
 *
 * Tools: create_document / get_document / list_documents
 *
 * Per Design v1.0 §2.7 + mission-84 W6 plannedTask: re-introduces 3 Document
 * MCP tools retired during mission-83 W6 narrowed-deletion-cascade (which
 * deleted the GCS-backed gcs-document.ts + this policy module). The substrate-
 * version uses DocumentRepository over HubStorageSubstrate (Document SchemaDef
 * already in inventory at all-schemas.ts:152).
 *
 * Tool-schema mirrors pre-retirement surface (path-as-id; consumers continue
 * using `docs/<dir>/<file>.md` paths as the substrate entity-id). Substrate
 * stores Document entities with id=path, content=markdown body, optional
 * category for filtering.
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";

// ── Handlers ────────────────────────────────────────────────────────

async function getDocument(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const id = args.path as string;
  if (!ctx.stores.document) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: "Document store not configured for this Hub" }) }],
      isError: true,
    };
  }
  try {
    const doc = await ctx.stores.document.get(id);
    if (!doc) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Document not found: ${id}` }) }],
        isError: true,
      };
    }
    return { content: [{ type: "text" as const, text: doc.content }] };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: `Failed to read document: ${error instanceof Error ? error.message : error}` }) }],
      isError: true,
    };
  }
}

async function createDocument(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const id = args.path as string;
  const content = args.content as string;
  const category = args.category as string | undefined;

  if (!ctx.stores.document) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: "Document store not configured for this Hub" }) }],
      isError: true,
    };
  }
  try {
    const now = new Date().toISOString();
    const existing = await ctx.stores.document.get(id);
    // bug-237: the docs/-namespace gate applies ONLY to NEW-path CREATION. An
    // EXISTING document — including a legacy BARE-PATH doc predating the docs/
    // convention (e.g. `teles`, `policy-network-v1`) — may be OVERWRITTEN
    // (tombstone / migrate / cleanup). Without this, legacy bare-path docs were
    // live-readable via get_document but UNCLEANABLE (no overwrite/delete/migrate).
    if (!existing && !id.startsWith("docs/")) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Path must start with 'docs/' to CREATE a new document (existing documents at any path may be overwritten). Other namespaces (reports/, proposals/, tasks/) are managed by their respective workflows." }) }],
        isError: true,
      };
    }
    const result = await ctx.stores.document.put({
      id,
      content,
      category,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    console.log(`[DocumentPolicy] Document written: ${id} (${content.length} bytes; rv=${result.resourceVersion})`);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: true, path: id, size: content.length, resourceVersion: result.resourceVersion, message: `Document written to ${id}` }) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: `Failed to write document: ${error instanceof Error ? error.message : error}` }) }],
      isError: true,
    };
  }
}

async function listDocs(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const prefix = args.prefix as string | undefined;
  const category = args.category as string | undefined;
  if (!ctx.stores.document) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: "Document store not configured for this Hub" }) }],
      isError: true,
    };
  }
  try {
    // Substrate-side filter by category if provided; client-side prefix-filter
    // on returned items (substrate doesn't have prefix-on-id query primitive)
    const docs = await ctx.stores.document.list(category ? { category } : undefined);
    const filtered = prefix ? docs.filter(d => d.id.startsWith(prefix)) : docs;
    const summary = filtered.map(d => ({
      path: d.id,
      size: d.content?.length ?? 0,
      category: d.category,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ documents: summary, count: summary.length }, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: `Failed to list documents: ${error instanceof Error ? error.message : error}` }) }],
      isError: true,
    };
  }
}

// ── Registration ────────────────────────────────────────────────────

export function registerDocumentPolicy(router: PolicyRouter): void {
  router.register(
    "get_document",
    "[Any] Read a document from the Hub's substrate storage. Use this to read full engineering reports, proposals, or other stored documents. Pass the path used at create_document time.",
    { path: z.string().describe("The document path (e.g., 'docs/planning/mission-1.md')") },
    getDocument,
  );

  router.register(
    "create_document",
    "[Any] Write a document to the Hub's substrate storage. Path must start with 'docs/'. Overwrites if file already exists (preserves createdAt; bumps updatedAt + resourceVersion). Use for collaborative authoring, mission briefs, and shared documents.",
    {
      path: z.string().describe("The document path (must start with 'docs/', e.g., 'docs/planning/mission-1.md')"),
      content: z.string().describe("The document content (Markdown)"),
      category: z.string().optional().describe("Optional category tag for filtering at list_documents (e.g., 'planning', 'design', 'retrospective')"),
    },
    createDocument,
  );

  router.register(
    "list_documents",
    "[Any] List documents in the Hub's substrate storage. Optional prefix-filter on path + optional category-filter (substrate-side). Returns paths, sizes, category, timestamps.",
    {
      prefix: z.string().optional().describe("Optional path prefix-filter (e.g., 'docs/planning/')"),
      category: z.string().optional().describe("Optional category filter (e.g., 'planning')"),
    },
    listDocs,
  );
}
