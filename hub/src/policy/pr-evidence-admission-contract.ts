/**
 * pr-evidence-admission-contract.ts — pr_evidence_admission0 contract/parser.
 *
 * This module is deliberately PURE: it only recognizes explicit PR locators and
 * normalizes them into the typed admission contract. It does NOT assert that the
 * PR is authoritative, delivered, reviewed, or Hub-bound. Later admission nodes
 * must join this parsed locator with Hub-owned PR↔WorkGraph binding truth before
 * opening any WorkGraph gate.
 */

export type PrEvidenceLocatorSource = "github_pr_url" | "repo_pr_number";

export interface PrEvidenceLocator {
  /** Canonical repo slug: owner/repo. */
  repo: string;
  /** Positive GitHub PR number. */
  prNumber: number;
  /** Which explicit locator form was accepted. */
  source: PrEvidenceLocatorSource;
  /** Original user-supplied string/object for diagnostics. */
  raw: unknown;
  /** Present when the accepted input was a GitHub PR URL. */
  url?: string;
}

export type PrEvidenceParseErrorCode =
  | "empty_input"
  | "unsupported_input"
  | "invalid_repo"
  | "invalid_pr_number"
  | "not_explicit_pr_locator";

export interface PrEvidenceParseError {
  ok: false;
  code: PrEvidenceParseErrorCode;
  message: string;
  raw: unknown;
}

export type PrEvidenceParseResult =
  | { ok: true; locator: PrEvidenceLocator }
  | PrEvidenceParseError;

const OWNER_OR_REPO_SEGMENT = "[A-Za-z0-9_.-]+";
const REPO_SLUG_RE = new RegExp(`^${OWNER_OR_REPO_SEGMENT}/${OWNER_OR_REPO_SEGMENT}$`);
const REPO_HASH_RE = new RegExp(`^(${OWNER_OR_REPO_SEGMENT}/${OWNER_OR_REPO_SEGMENT})#([1-9][0-9]*)$`);

function fail(code: PrEvidenceParseErrorCode, message: string, raw: unknown): PrEvidenceParseError {
  return { ok: false, code, message, raw };
}

export function isValidPrEvidenceRepo(repo: string): boolean {
  return REPO_SLUG_RE.test(repo);
}

function normalizePrNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value.trim())) return Number(value.trim());
  return null;
}

function parseGithubPrUrl(raw: string): PrEvidenceLocator | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.hostname.toLowerCase() !== "github.com") return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 4) return null;
  const [owner, repoName, kind, numberText] = parts;
  if (kind !== "pull") return null;
  const repo = `${owner}/${repoName}`;
  const prNumber = normalizePrNumber(numberText);
  if (!isValidPrEvidenceRepo(repo) || prNumber == null) return null;
  return { repo, prNumber, source: "github_pr_url", raw, url: raw };
}

function parseRepoHash(raw: string): PrEvidenceLocator | null {
  const match = raw.match(REPO_HASH_RE);
  if (!match) return null;
  const prNumber = normalizePrNumber(match[2]);
  if (prNumber == null) return null;
  return { repo: match[1], prNumber, source: "repo_pr_number", raw };
}

function parseObjectLocator(raw: Record<string, unknown>): PrEvidenceParseResult | null {
  const repo = typeof raw.repo === "string" ? raw.repo.trim() : "";
  const numberCandidate = raw.prNumber ?? raw.number;
  if (!repo && numberCandidate === undefined) return null;
  if (!repo) return fail("invalid_repo", "PR evidence object must include repo as owner/repo", raw);
  if (!isValidPrEvidenceRepo(repo)) return fail("invalid_repo", `invalid PR evidence repo '${repo}' (expected owner/repo)`, raw);
  const prNumber = normalizePrNumber(numberCandidate);
  if (prNumber == null) return fail("invalid_pr_number", "PR evidence object must include a positive integer prNumber", raw);
  return { ok: true, locator: { repo, prNumber, source: "repo_pr_number", raw } };
}

/**
 * Parse only explicit PR locators. In particular, prose/body markers such as
 * "work-123", "PR #123", or "see pull request" are intentionally rejected:
 * they may be human hints, but they are never authority for WorkGraph evidence.
 */
export function parsePrEvidenceLocator(input: unknown): PrEvidenceParseResult {
  if (input == null) return fail("empty_input", "PR evidence input is empty", input);

  if (typeof input === "string") {
    const raw = input.trim();
    if (!raw) return fail("empty_input", "PR evidence ref is empty", input);
    const url = parseGithubPrUrl(raw);
    if (url) return { ok: true, locator: url };
    const repoHash = parseRepoHash(raw);
    if (repoHash) return { ok: true, locator: repoHash };
    return fail(
      "not_explicit_pr_locator",
      "PR evidence must be an explicit GitHub PR URL or owner/repo#number locator; raw prose/body markers are not authority",
      input,
    );
  }

  if (typeof input === "object" && !Array.isArray(input)) {
    const objectResult = parseObjectLocator(input as Record<string, unknown>);
    if (objectResult) return objectResult;
  }

  return fail("unsupported_input", "PR evidence must be a string locator or { repo, prNumber } object", input);
}
