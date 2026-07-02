/**
 * NotificationCoalescer — Layer-2 delivery-pacing for host notifications.
 *
 * idea-355 SLICE-1 single-home: the opencode shim's rate-limit / prompt-queue /
 * deferred-backlog machinery (bug-161 + R1 bounded-fallback history) is a
 * generic delivery-pacing concern that belongs beside the MessageRouter on the
 * Layer-2 dispatch path, not duplicated per host. This is an EXTENSION of
 * `@apnex/message-router` (the router decides WHAT to surface; the coalescer
 * decides WHEN — buffer while a session is mid-task, flush on idle, rate-limit
 * LLM prompts, coalesce a backlog).
 *
 * Host-injected render bindings (`CoalescerIO`) keep the last-mile surfacing
 * (opencode `promptLLM` / `injectContext` / `showToast`) in the shim. Session
 * activity is shim-FED: the host derives active/idle from its own session-event
 * stream and calls `setSessionActive`. The coalescer owns no transport, no SDK,
 * and no clock it can't be handed (`now` is injectable for test determinism).
 */

/**
 * A pending host notification awaiting delivery. `level` drives the surface
 * choice (actionable → LLM prompt; informational → silent context inject);
 * `message` is the transient toast text; `promptText` is the LLM-facing body.
 */
export interface CoalescedNotification {
  level: "actionable" | "informational";
  message: string;
  promptText: string;
}

/**
 * Last-mile render bindings injected by the host shim. The coalescer calls
 * these to actually surface; it never touches the host SDK directly.
 */
export interface CoalescerIO {
  /** Surface an actionable prompt that expects an LLM turn. */
  promptLLM(text: string): Promise<void>;
  /** Surface informational/silent context (no LLM turn). */
  injectContext(text: string): Promise<void>;
  /** Surface a transient toast. */
  showToast(message: string, variant?: string): Promise<void>;
  /** Live gate: whether auto-prompting is enabled (host `config.autoPrompt`). */
  autoPrompt(): boolean;
}

export interface NotificationCoalescerOptions {
  io: CoalescerIO;
  /** Rate-limit window (ms) between LLM prompts. Default 30_000. */
  rateLimitMs?: number;
  /**
   * Flush the active-session queue once it reaches this size — the R1 bounded
   * fallback so a never-idling session can't wedge the queue. Default 50.
   */
  flushCap?: number;
  /** Injected clock for test determinism. Default `Date.now`. */
  now?: () => number;
}

export class NotificationCoalescer {
  private readonly io: CoalescerIO;
  private readonly rateLimitMs: number;
  private readonly flushCap: number;
  private readonly now: () => number;

  private readonly queue: CoalescedNotification[] = [];
  private readonly backlog: CoalescedNotification[] = [];
  private lastPromptTime = 0;
  private sessionActive = false;

  constructor(opts: NotificationCoalescerOptions) {
    this.io = opts.io;
    this.rateLimitMs = opts.rateLimitMs ?? 30_000;
    this.flushCap = opts.flushCap ?? 50;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Diagnostics + host session-event tests. */
  getSessionActive(): boolean {
    return this.sessionActive;
  }

  /**
   * Shim-fed session-activity transition. On transition to inactive, drains the
   * buffered queue (or, if empty, the deferred backlog) — the host's session
   * just went idle/ended, so now is the moment to surface. On active, buffer.
   *
   * The field is set synchronously (before any await) so a host's sync test
   * setup observes it immediately.
   */
  async setSessionActive(active: boolean): Promise<void> {
    this.sessionActive = active;
    if (!active) {
      if (this.queue.length > 0) await this.flushQueue();
      else if (this.backlog.length > 0) await this.flushBacklog();
    }
  }

  /**
   * Route a notification through the pacer. While a session is active, buffer
   * onto the queue (with the optional bounded-flush cap); otherwise surface now.
   *
   * `capFlush` defaults true (the live SSE path's R1 bounded fallback). The
   * drained-pending-action path passes `false` to preserve its original
   * no-cap behavior.
   */
  async enqueue(
    n: CoalescedNotification,
    opts?: { capFlush?: boolean },
  ): Promise<void> {
    if (this.sessionActive) {
      this.queue.push(n);
      if ((opts?.capFlush ?? true) && this.queue.length >= this.flushCap) {
        await this.flushQueue();
      }
    } else {
      await this.processNotification(n);
    }
  }

  private isRateLimited(): boolean {
    return this.now() - this.lastPromptTime < this.rateLimitMs;
  }

  /** Surface an LLM prompt and stamp the rate-limit clock. */
  private async prompt(text: string): Promise<void> {
    this.lastPromptTime = this.now();
    await this.io.promptLLM(text);
  }

  private buildBacklogSuffix(): string {
    if (this.backlog.length === 0) return "";
    const lines = [
      "",
      `--- Deferred Backlog (${this.backlog.length} event${this.backlog.length > 1 ? "s" : ""}) ---`,
      "The following actionable events arrived while you were busy and were deferred.",
      "Please review and address them after your current task:",
    ];
    for (let i = 0; i < this.backlog.length; i++) {
      lines.push(`${i + 1}. ${this.backlog[i].promptText}`);
    }
    return lines.join("\n");
  }

  private drainBacklog(): string {
    const suffix = this.buildBacklogSuffix();
    this.backlog.length = 0;
    return suffix;
  }

  private async flushBacklog(): Promise<void> {
    if (this.backlog.length === 0) return;
    if (!this.io.autoPrompt()) {
      this.backlog.length = 0;
      return;
    }
    const lines = ["You have deferred Hub events that need attention:"];
    for (let i = 0; i < this.backlog.length; i++) {
      lines.push(`${i + 1}. ${this.backlog[i].promptText}`);
    }
    lines.push("\nPlease review and address these items.");
    this.backlog.length = 0;

    if (!this.isRateLimited()) {
      await this.prompt(lines.join("\n"));
    } else {
      await this.io.injectContext(lines.join("\n"));
    }
  }

  private async processNotification(n: CoalescedNotification): Promise<void> {
    await this.io.showToast(n.message);
    if (!this.io.autoPrompt()) return;

    if (n.level === "actionable") {
      if (this.isRateLimited()) {
        this.backlog.push(n);
        await this.io.showToast("Rate limited: queued for follow-up", "warning");
      } else {
        const backlog = this.drainBacklog();
        await this.prompt(n.promptText + backlog);
      }
    } else {
      await this.io.injectContext(n.promptText);
    }
  }

  private async flushQueue(): Promise<void> {
    if (this.queue.length === 0) return;
    const items = this.queue.splice(0);
    if (items.length === 1) {
      await this.processNotification(items[0]);
      return;
    }
    for (const item of items) await this.io.showToast(item.message);
    if (!this.io.autoPrompt()) return;

    const lines = ["While you were working, the following Hub events occurred:"];
    for (let i = 0; i < items.length; i++) {
      lines.push(`${i + 1}. ${items[i].promptText}`);
    }
    const hasActionable = items.some((i) => i.level === "actionable");
    if (hasActionable) {
      lines.push("\nPlease address the actionable items above.");
      if (!this.isRateLimited()) {
        const backlog = this.drainBacklog();
        await this.prompt(lines.join("\n") + backlog);
      } else {
        for (const item of items) {
          if (item.level === "actionable") this.backlog.push(item);
        }
        await this.io.showToast("Rate limited: queued for follow-up", "warning");
      }
    } else {
      await this.io.injectContext(lines.join("\n"));
    }
  }
}
