/**
 * constitution-sync.ts — mission-103 P3-S1: the A1 poll loop (design v1.0 §3).
 *
 * The pipeline per tick, in order, with the commit point LAST:
 *   HEAD-sha check (1 API call — steady-state cost)
 *   → unchanged? done : rate-budget check (skip fetch-all under headroom floor)
 *   → fetch-all (tree + blobs at the PINNED sha — never a moving ref)
 *   → PARSE GATE      (fail-closed WHOLE snapshot: malformed axiom file)
 *   → REFERENTIAL GATE (fail-closed: live charter bindings must resolve in-candidate)
 *   → build candidate (contentHash per file, manifestHash over the manifest)
 *   → single-row CAS swap — THE commit point (a roll anywhere above this line
 *     leaves the prior good snapshot serving; roll-durable by construction)
 *   → post-commit best-effort constitution-updated-notification (broadcast;
 *     loss costs latency never correctness — the bug-231 lesson applied at
 *     birth: every serve carries provenance, so consumers converge without it).
 *
 * Failure posture (design §3 / memo §d): repo/API unreachable → serve stays
 * on the last-good snapshot (provenance goes stale:true past threshold —
 * fail-open with honesty); malformed/unreferential candidate → whole-snapshot
 * reject, loud log, prior serves (fail-closed on the SYNC, open on the SERVE).
 *
 * GitHub access mirrors the RepoEventBridge discipline: PAT auth, rate-limit
 * headers tracked per response, fetch injectable for contract tests.
 */
import { createHash } from "node:crypto";
import type { AxiomManifestEntry } from "../entities/constitution.js";
import type { ConstitutionRepositorySubstrate } from "../entities/constitution-repository-substrate.js";
import type { IOrgCharterStore } from "../entities/constitution.js";
import { manifestHashOf } from "../entities/constitution-repository-substrate.js";

export const CONSTITUTION_UPDATED_EVENT = "constitution-updated-notification";

// The live mission-kit filename shape is SLUGGED (axioms/A14-compounding-
// learning.md); the bare form (axioms/A7.md) is tolerated too. The id is the
// A<N> prefix either way (audit-10754: the bare-only regex matched zero real
// files — a real tick would have parse-gate-rejected as empty forever).
const AXIOM_PATH_RE = /^axioms\/(A\d+)(?:-[A-Za-z0-9-]+)?\.md$/;

export type TickResult =
  | { result: "unchanged"; sha: string }
  | { result: "synced"; sha: string; axioms: number }
  | { result: "skipped_rate_budget"; remaining: number; limit: number }
  | { result: "rejected_parse"; reason: string }
  | { result: "rejected_referential"; reason: string }
  | { result: "error"; reason: string };

export interface ConstitutionSyncOptions {
  /** "owner/repo" (e.g. "apnex/mission-kit"). */
  repo: string;
  token: string;
  cadenceMs: number;
  /** Fraction of the rate limit the sync may consume; below (1-pct)·limit
   *  remaining, fetch-all is skipped and serving stays stale-honest. */
  rateBudgetPct: number;
  store: ConstitutionRepositorySubstrate;
  /** Referential gate input: live charter bindings must resolve in-candidate. */
  charterStore?: IOrgCharterStore;
  /** Post-commit announcement closure (wired to emitAndPush at composition). */
  announce?: (payload: Record<string, unknown>) => Promise<void>;
  /** Injectable for contract tests. */
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

export class ConstitutionSync {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly opts: ConstitutionSyncOptions) {}

  start(): void {
    if (this.timer) return;
    // Sync-on-start: makes the first-boot not_synced window seconds (design §2).
    void this.safeTick("startup");
    this.timer = setInterval(() => void this.safeTick("cadence"), this.opts.cadenceMs);
    this.timer.unref?.();
    console.log(`[ConstitutionSync] started: repo=${this.opts.repo} cadence=${this.opts.cadenceMs}ms budget=${this.opts.rateBudgetPct}`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async safeTick(trigger: string): Promise<void> {
    if (this.ticking) return; // no overlapping ticks
    this.ticking = true;
    try {
      const r = await this.tick();
      if (r.result !== "unchanged") console.log(`[ConstitutionSync] tick(${trigger}): ${JSON.stringify(r)}`);
    } catch (e) {
      console.error(`[ConstitutionSync] tick(${trigger}) failed (serving stays on last-good): ${e instanceof Error ? e.message : e}`);
    } finally {
      this.ticking = false;
    }
  }

  async tick(): Promise<TickResult> {
    let head: { sha: string; remaining: number; limit: number };
    try {
      head = await this.headSha();
    } catch (e) {
      return { result: "error", reason: `HEAD check failed: ${e instanceof Error ? e.message : e}` };
    }
    const current = await this.opts.store.getCurrent();
    if (current?.sha === head.sha) return { result: "unchanged", sha: head.sha };

    // Rate budget: keep (1-pct)·limit headroom for the rest of the Hub.
    const floor = Math.floor((1 - this.opts.rateBudgetPct) * head.limit);
    if (head.limit > 0 && head.remaining < floor) {
      console.warn(`[ConstitutionSync] rate budget floor hit (${head.remaining}/${head.limit} < ${floor}) — fetch-all skipped, serving stays stale-honest`);
      return { result: "skipped_rate_budget", remaining: head.remaining, limit: head.limit };
    }

    let files: Record<string, string>;
    try {
      files = await this.fetchAxiomFiles(head.sha);
    } catch (e) {
      return { result: "error", reason: `fetch-all failed: ${e instanceof Error ? e.message : e}` };
    }

    // PARSE GATE — fail-closed on the whole snapshot.
    let manifest: AxiomManifestEntry[];
    try {
      manifest = parseGate(files);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[ConstitutionSync] PARSE GATE rejected candidate ${head.sha} (prior snapshot keeps serving): ${reason}`);
      return { result: "rejected_parse", reason };
    }

    // REFERENTIAL GATE — live charter bindings must resolve in-candidate.
    if (this.opts.charterStore) {
      const charter = await this.opts.charterStore.getCurrentCharter();
      const ids = new Set(manifest.map((m) => m.id));
      const dangling = (charter?.bindings ?? []).filter((b) => b.status === "bound" && !ids.has(b.axiom));
      if (dangling.length > 0) {
        const reason = `candidate ${head.sha} drops axiom(s) with LIVE charter bindings: ${dangling.map((b) => `${b.axiom} (ratified by ${b.ratifiedBy})`).join(", ")}`;
        console.error(`[ConstitutionSync] REFERENTIAL GATE rejected (prior snapshot keeps serving): ${reason}`);
        return { result: "rejected_referential", reason };
      }
    }

    const committed = await this.opts.store.swapSnapshot({
      sha: head.sha,
      syncedAt: new Date().toISOString(),
      manifestHash: manifestHashOf(manifest),
      files,
      manifest,
    });

    // Post-commit, best-effort — never unwinds the swap.
    if (this.opts.announce) {
      try {
        await this.opts.announce({
          notificationEvent: CONSTITUTION_UPDATED_EVENT,
          old_sha: current?.sha ?? null,
          new_sha: committed.sha,
          manifest_hash: committed.manifestHash,
          axioms: committed.manifest.length,
          body: `Constitution updated: ${current?.sha?.slice(0, 7) ?? "(first sync)"} → ${committed.sha.slice(0, 7)} (${committed.manifest.length} axioms)`,
        });
      } catch (e) {
        console.warn(`[ConstitutionSync] update announcement failed (non-fatal; provenance converges consumers): ${e instanceof Error ? e.message : e}`);
      }
    }
    return { result: "synced", sha: committed.sha, axioms: committed.manifest.length };
  }

  // ── GitHub REST (PAT; rate headers tracked; injectable fetch) ────────────

  private async gh(path: string, accept = "application/vnd.github+json"): Promise<Response> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const base = this.opts.apiBase ?? "https://api.github.com";
    const response = await fetchImpl(`${base}${path}`, {
      headers: {
        authorization: `Bearer ${this.opts.token}`,
        accept,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub ${path} → ${response.status}`);
    }
    return response;
  }

  private rate(response: Response): { remaining: number; limit: number } {
    return {
      remaining: parseInt(response.headers.get("x-ratelimit-remaining") ?? "-1", 10),
      limit: parseInt(response.headers.get("x-ratelimit-limit") ?? "0", 10),
    };
  }

  private async headSha(): Promise<{ sha: string; remaining: number; limit: number }> {
    const response = await this.gh(`/repos/${this.opts.repo}/branches/main`);
    const body = (await response.json()) as { commit?: { sha?: string } };
    if (!body.commit?.sha) throw new Error("branches/main response has no commit sha");
    return { sha: body.commit.sha, ...this.rate(response) };
  }

  private async fetchAxiomFiles(sha: string): Promise<Record<string, string>> {
    // Tree at the PINNED sha — the fetch set can never straddle two commits.
    const treeResponse = await this.gh(`/repos/${this.opts.repo}/git/trees/${sha}?recursive=1`);
    const tree = (await treeResponse.json()) as { truncated?: boolean; tree?: Array<{ path: string; type: string }> };
    if (tree.truncated) throw new Error("git tree response truncated — cannot guarantee a complete axiom set");
    const paths = (tree.tree ?? []).filter((t) => t.type === "blob" && AXIOM_PATH_RE.test(t.path)).map((t) => t.path);
    const files: Record<string, string> = {};
    for (const path of paths) {
      const blob = await this.gh(`/repos/${this.opts.repo}/contents/${path}?ref=${sha}`, "application/vnd.github.raw+json");
      files[path] = await blob.text();
    }
    return files;
  }
}

/** The parse gate (design §3): id from the filename, title from the first
 *  markdown heading, non-empty body — ANY failure rejects the WHOLE
 *  candidate (never a partial constitution), including an empty axiom set. */
export function parseGate(files: Record<string, string>): AxiomManifestEntry[] {
  const paths = Object.keys(files);
  if (paths.length === 0) throw new Error("candidate has zero axiom files (axioms/A*.md) — an empty constitution is a malformed one");
  const manifest: AxiomManifestEntry[] = [];
  const seen = new Map<string, string>();
  for (const path of paths) {
    const m = AXIOM_PATH_RE.exec(path);
    if (!m) throw new Error(`unexpected path in candidate: ${path}`);
    if (seen.has(m[1])) throw new Error(`duplicate axiom id ${m[1]}: ${seen.get(m[1])} and ${path} both claim it — an ambiguous constitution is a malformed one`);
    seen.set(m[1], path);
    const content = files[path];
    if (!content || content.trim().length === 0) throw new Error(`${path} is empty`);
    const heading = content.split("\n").find((line) => /^#\s+\S/.test(line));
    if (!heading) throw new Error(`${path} has no top-level markdown heading (# Title) — the parse gate requires one`);
    manifest.push({
      id: m[1],
      title: heading.replace(/^#\s+/, "").trim(),
      path,
      contentHash: createHash("sha256").update(content, "utf8").digest("hex"),
    });
  }
  manifest.sort((a, b) => parseInt(a.id.slice(1), 10) - parseInt(b.id.slice(1), 10));
  return manifest;
}
