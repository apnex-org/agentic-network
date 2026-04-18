/**
 * Shared filter + pagination helpers for `list_*` policy handlers.
 *
 * Motivation (idea-70): every `list_*` tool returned unbounded result
 * sets by default, causing MCP payloads to exceed the 87k-char wire cap
 * on realistic backlogs. Standardising on `limit` / `offset` plus
 * optional label and tag filters makes every list tool paginated and
 * queryable without reworking per-entity filter logic.
 */

import { z } from "zod";

export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 500;

/** Zod schema fragment — spread into any `list_*` tool registration. */
export const LIST_PAGINATION_SCHEMA = {
  limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional()
    .describe(`Cap the result set size (max ${MAX_LIST_LIMIT}, default ${DEFAULT_LIST_LIMIT}).`),
  offset: z.number().int().nonnegative().optional()
    .describe("Skip the first N entries for pagination (default 0)."),
};

/** Label-match-all filter — use on entities with `labels: Record<string, string>`. */
export const LIST_LABELS_SCHEMA = {
  labels: z.record(z.string(), z.string()).optional()
    .describe("Match-all label filter: only entries whose labels include every provided key=value pair."),
};

/** Tag-match-any filter — use on entities with `tags: string[]`. */
export const LIST_TAGS_SCHEMA = {
  tags: z.array(z.string()).optional()
    .describe("Match-any tag filter: only entries whose tags include at least one of the provided tags."),
};

export function applyLabelFilter<T extends { labels?: Record<string, string> }>(
  items: T[],
  labels?: Record<string, string>,
): T[] {
  if (!labels || Object.keys(labels).length === 0) return items;
  return items.filter((item) => {
    const have = item.labels ?? {};
    for (const [k, v] of Object.entries(labels)) {
      if (have[k] !== v) return false;
    }
    return true;
  });
}

export function applyTagFilter<T extends { tags?: string[] }>(
  items: T[],
  tags?: string[],
): T[] {
  if (!tags || tags.length === 0) return items;
  return items.filter((item) => {
    const have = item.tags ?? [];
    return tags.some((t) => have.includes(t));
  });
}

export interface PaginatedResult<T> {
  items: T[];
  count: number;
  total: number;
  offset: number;
  limit: number;
}

export function paginate<T>(items: T[], args: Record<string, unknown>): PaginatedResult<T> {
  const total = items.length;
  const rawOffset = args.offset as number | undefined;
  const rawLimit = args.limit as number | undefined;
  const offset = Math.max(0, rawOffset ?? 0);
  const limit = Math.min(MAX_LIST_LIMIT, rawLimit ?? DEFAULT_LIST_LIMIT);
  const sliced = items.slice(offset, offset + limit);
  return { items: sliced, count: sliced.length, total, offset, limit };
}
