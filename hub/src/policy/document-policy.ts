/**
 * Document Policy — GCS document read/write/list.
 *
 * Tools: get_document, create_document, list_documents
 * Uses ctx.config for storage backend detection.
 */

import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { readDocument, writeDocument, listDocuments } from "../gcs-document.js";
import { LIST_PAGINATION_SCHEMA, paginate } from "./list-filters.js";

// ── Handlers ────────────────────────────────────────────────────────

async function getDocument(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const path = args.path as string;

  if (ctx.config.storageBackend !== "gcs") {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: "get_document is only available with GCS storage backend" }) }],
      isError: true,
    };
  }

  try {
    const result = await readDocument(ctx.config.gcsBucket, path);
    if (!result) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Document not found: ${path}` }) }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text" as const, text: result.content }],
    };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: `Failed to read document: ${error instanceof Error ? error.message : error}` }) }],
      isError: true,
    };
  }
}

async function createDocument(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const path = args.path as string;
  const content = args.content as string;

  if (!path.startsWith("docs/")) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: "Path must start with 'docs/' to use create_document. Other namespaces (reports/, proposals/, tasks/) are managed by their respective workflows." }) }],
      isError: true,
    };
  }

  if (ctx.config.storageBackend !== "gcs") {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: "create_document is only available with GCS storage backend" }) }],
      isError: true,
    };
  }

  try {
    const result = await writeDocument(ctx.config.gcsBucket, path, content);
    console.log(`[DocumentPolicy] Document written: ${path} (${result.size} bytes)`);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: true, path: result.path, size: result.size, message: `Document written to ${path}` }) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: `Failed to write document: ${error instanceof Error ? error.message : error}` }) }],
      isError: true,
    };
  }
}

async function listDocs(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const prefix = args.prefix as string;

  if (ctx.config.storageBackend !== "gcs") {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: "list_documents is only available with GCS storage backend" }) }],
      isError: true,
    };
  }

  try {
    const docs = await listDocuments(ctx.config.gcsBucket, prefix);
    const page = paginate(docs, args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ documents: page.items, count: page.count, total: page.total, offset: page.offset, limit: page.limit }, null, 2) }],
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
    "[Any] Read a document from the Hub's state storage. Use this to read full engineering reports, proposals, or other stored documents. Pass the path from a reportRef or proposalRef field.",
    { path: z.string().describe("The document path (e.g., 'reports/task-1-report.md')") },
    getDocument,
  );

  router.register(
    "create_document",
    "[Any] Write a document to the Hub's state storage. Path must start with 'docs/'. Overwrites if file already exists. Use for collaborative authoring, mission briefs, and shared documents.",
    {
      path: z.string().describe("The document path (must start with 'docs/', e.g., 'docs/planning/mission-1.md')"),
      content: z.string().describe("The document content (Markdown)"),
    },
    createDocument,
  );

  router.register(
    "list_documents",
    "[Any] List documents in a directory of the Hub's state storage with pagination. Returns file paths, sizes, and timestamps.",
    {
      prefix: z.string().describe("The directory prefix to list (e.g., 'reports/', 'proposals/', 'tasks/')"),
      ...LIST_PAGINATION_SCHEMA,
    },
    listDocs,
  );
}
