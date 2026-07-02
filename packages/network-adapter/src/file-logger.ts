/**
 * file-logger.ts — file-backed logging primitives shared by host shims.
 *
 * idea-355 SLICE-1 single-home: the claude shim's `FileBackedLogger` (NDJSON
 * events + text-log + stderr fan-out, size-rotation, redaction, level-filter)
 * and the opencode shim's simple text-append `log()` are two points on one
 * spectrum. `createFileLogger` parameterizes both — a host supplies its file
 * paths and which fan-out targets it wants, and gets back:
 *   - `log(msg)`     — the human-readable text sink (claude: + stderr mirror)
 *   - `appendEvent`  — the NDJSON structured-events writer (no-op when no
 *                      `eventsFile`; opencode never sets one)
 *   - `logger`       — a concrete `ILogger` fanning out to both of the above
 *
 * Behavior-preserving by construction: each host injects its exact line
 * format via `formatLine`, so no cosmetic drift vs the pre-hoist shims.
 *
 * Filesystem side-effects only; no module-init config read (unit-test safe).
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { ILogger, LogFields } from "./logger.js";
import { redactFields, shouldEmitLevel, type LogLevel } from "./observability.js";

function ensureDir(path: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    /* best-effort */
  }
}

function rotateIfNeeded(file: string, rotateBytes: number): void {
  try {
    const stat = statSync(file);
    if (stat.size > rotateBytes) {
      renameSync(file, `${file}.${Date.now()}`);
    }
  } catch {
    /* file doesn't exist yet, that's fine */
  }
}

// The claude `FileBackedLogger`'s per-field renderer: each field prefixed with
// a leading space, joined with no separator. Kept verbatim so the rendered
// text-log lines are byte-identical to the pre-hoist shim.
function renderFields(fields: LogFields): string {
  const parts: string[] = [];
  for (const k of Object.keys(fields)) {
    const v = fields[k];
    parts.push(` ${k}=${Array.isArray(v) ? `[${v.join(",")}]` : String(v)}`);
  }
  return parts.join("");
}

export interface FileLoggerOptions {
  /** Text log file: timestamped human-readable lines. Required. */
  textFile: string;
  /**
   * NDJSON structured-events file. When set, `appendEvent` + `logger` fan out
   * here; when absent (opencode), `appendEvent` is a no-op.
   */
  eventsFile?: string;
  /** Rotate textFile + eventsFile once either exceeds this many bytes. */
  rotateBytes?: number;
  /** Mirror every text line to process.stderr (claude: true; opencode: omit). */
  mirrorToStderr?: boolean;
  /**
   * Suppress NDJSON events tagged with `fields.level` below this threshold
   * (ADR-031 §3). Unlevelled events always emit. Default INFO.
   */
  logLevel?: LogLevel;
  /** pid stamped into the NDJSON envelope. Default `process.pid`. */
  pid?: number;
  /** Fields pre-bound to every `logger` emission (root bind). */
  bound?: LogFields;
  /**
   * Render a text-log line (including trailing newline) from a message.
   * Default: `[<ISO with T/Z stripped>] <msg>\n` (claude's format). opencode
   * injects `<raw ISO> <msg>\n`.
   */
  formatLine?: (msg: string) => string;
}

export interface FileLogger {
  /** Append a human-readable line to textFile (+ optional stderr mirror). */
  log(msg: string): void;
  /**
   * Append a structured NDJSON event (redacted, level-filtered). No-op when
   * no `eventsFile` was configured.
   */
  appendEvent(event: string, fields: LogFields, message?: string): void;
  /** Concrete ILogger fanning out to NDJSON events + the text log. */
  logger: ILogger;
}

const defaultFormatLine = (msg: string): string =>
  `[${new Date().toISOString().replace("T", " ").replace("Z", "")}] ${msg}\n`;

export function createFileLogger(opts: FileLoggerOptions): FileLogger {
  const formatLine = opts.formatLine ?? defaultFormatLine;
  const logLevel: LogLevel = opts.logLevel ?? "INFO";
  const pid = opts.pid ?? process.pid;

  ensureDir(opts.textFile);
  if (opts.eventsFile) ensureDir(opts.eventsFile);
  if (opts.rotateBytes) {
    rotateIfNeeded(opts.textFile, opts.rotateBytes);
    if (opts.eventsFile) rotateIfNeeded(opts.eventsFile, opts.rotateBytes);
  }

  function log(msg: string): void {
    const line = formatLine(msg);
    if (opts.mirrorToStderr) process.stderr.write(line);
    try {
      appendFileSync(opts.textFile, line);
    } catch {
      /* best-effort — never disturb the call loop */
    }
  }

  function appendEvent(event: string, fields: LogFields, message?: string): void {
    if (!opts.eventsFile) return;
    // OIS_SHIM_LOG_LEVEL filter (ADR-031 §3): events tagged with `fields.level`
    // below threshold are suppressed; unlevelled events always emit.
    if (!shouldEmitLevel(fields.level as string | undefined, logLevel)) {
      return;
    }
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        event,
        fields: redactFields(fields),
        message: message ?? null,
        pid,
      }) + "\n";
    try {
      appendFileSync(opts.eventsFile, line);
    } catch {
      /* best-effort */
    }
  }

  // FileBackedLogger — concrete ILogger fanning out to: (1) NDJSON events file
  // (structured fields preserved) and (2) text log + optional stderr (rendered
  // friendly form). Bound fields apply to every emission; `child()` scopes a
  // logger to a session / reconnect without threading context.
  function makeLogger(bound: LogFields): ILogger {
    return {
      log(event: string, fields?: LogFields, message?: string): void {
        const merged: LogFields = { ...bound, ...(fields ?? {}) };
        appendEvent(event, merged, message);
        if (message) {
          log(`[${event}] ${message}`);
        } else {
          const fieldsStr = renderFields(merged);
          log(fieldsStr ? `[${event}]${fieldsStr}` : `[${event}]`);
        }
      },
      child(fields: LogFields): ILogger {
        return makeLogger({ ...bound, ...fields });
      },
    };
  }

  return { log, appendEvent, logger: makeLogger(opts.bound ?? {}) };
}
