/**
 * Adapter configuration — the generic `.ois/adapter-config.json` + env loader.
 *
 * idea-355 SLICE-1 single-home: both shims hand-rolled a near-identical
 * HubConfig + parseLabels + loadConfig. They diverged only in host specifics —
 * the default hubUrl, whether `autoPrompt` is carried, the warn sink, and the
 * missing-creds policy (claude `process.exit(1)`; opencode can't kill the TUI).
 * Those host specifics are INJECTED here; the load mechanism lives once in the
 * kernel so it can't drift (the M18-scar class). Credential VALIDATION stays in
 * the shim (the last-mile abort).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface HubConfig {
  hubUrl: string;
  hubToken: string;
  role: string;
  /**
   * Mission-19 routing labels. Stamped onto the Agent entity via the enriched
   * register_role handshake; scoped dispatches filter by these. Read from
   * adapter-config.json `labels` or the `OIS_HUB_LABELS` env var (JSON). Omit
   * for broadcast.
   */
  labels?: Record<string, string>;
  /** OpenCode-only: auto-prompt the host on actionable events. Claude omits it. */
  autoPrompt?: boolean;
}

/**
 * Parse a JSON-encoded label map (string→string only). Returns undefined for
 * empty/absent/invalid input; warns via the injected sink on parse failure.
 */
export function parseLabels(
  raw: string | undefined,
  source: string,
  warn: (m: string) => void = () => {},
): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    }
  } catch (err) {
    warn(`WARNING: Failed to parse labels from ${source}: ${err}`);
  }
  return undefined;
}

export interface LoadConfigOptions {
  /** Parent dir of `.ois/` — WORK_DIR/cwd for claude, the host-supplied dir for opencode. */
  directory: string;
  /** Host defaults layered under file + env (e.g. opencode's relay hubUrl + autoPrompt:true). */
  defaults?: Partial<HubConfig>;
  /** Warn sink (claude console.error; opencode log()). */
  warn?: (m: string) => void;
  /** Read `autoPrompt` from file + `HUB_PLUGIN_AUTO_PROMPT` env (opencode only). */
  readAutoPrompt?: boolean;
}

/**
 * Load HubConfig from `<directory>/.ois/adapter-config.json` layered under env
 * overrides (OIS_HUB_URL/OIS_HUB_TOKEN/OIS_HUB_ROLE/OIS_HUB_LABELS, plus
 * HUB_PLUGIN_AUTO_PROMPT when readAutoPrompt). Precedence: defaults < file < env.
 * Does NOT validate credentials — the caller (shim) does its host-specific abort.
 */
export function loadConfig(opts: LoadConfigOptions): HubConfig {
  const { directory, defaults = {}, warn = () => {}, readAutoPrompt = false } = opts;

  const cfg: HubConfig = {
    hubUrl: defaults.hubUrl ?? "",
    hubToken: defaults.hubToken ?? "",
    role: defaults.role ?? "engineer",
  };
  if (defaults.labels) cfg.labels = defaults.labels;
  if (defaults.autoPrompt !== undefined) cfg.autoPrompt = defaults.autoPrompt;

  try {
    const raw = JSON.parse(
      readFileSync(join(directory, ".ois", "adapter-config.json"), "utf-8"),
    ) as Partial<HubConfig>;
    if (typeof raw.hubUrl === "string") cfg.hubUrl = raw.hubUrl;
    if (typeof raw.hubToken === "string") cfg.hubToken = raw.hubToken;
    if (typeof raw.role === "string") cfg.role = raw.role;
    if (raw.labels && typeof raw.labels === "object") {
      cfg.labels = raw.labels as Record<string, string>;
    }
    if (readAutoPrompt && typeof raw.autoPrompt === "boolean") cfg.autoPrompt = raw.autoPrompt;
  } catch (err) {
    // Silent on a missing file (the common case); warn on a real read/parse
    // failure of a PRESENT file (preserves claude's prior behavior; opencode
    // gains the diagnostic to its log).
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      warn(`WARNING: Failed to read/parse ${join(directory, ".ois", "adapter-config.json")}: ${err}`);
    }
  }

  if (process.env.OIS_HUB_URL) cfg.hubUrl = process.env.OIS_HUB_URL;
  if (process.env.OIS_HUB_TOKEN) cfg.hubToken = process.env.OIS_HUB_TOKEN;
  if (process.env.OIS_HUB_ROLE) cfg.role = process.env.OIS_HUB_ROLE;
  if (readAutoPrompt && process.env.HUB_PLUGIN_AUTO_PROMPT) {
    cfg.autoPrompt = process.env.HUB_PLUGIN_AUTO_PROMPT.toLowerCase() !== "false";
  }
  const envLabels = parseLabels(process.env.OIS_HUB_LABELS, "OIS_HUB_LABELS env var", warn);
  if (envLabels) cfg.labels = envLabels;

  return cfg;
}
