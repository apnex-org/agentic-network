/**
 * Test utilities for hub-connection tests.
 */

import type { SessionState, SessionReconnectReason } from "../../src/kernel/agent-client.js";

/** Wait for a specified duration */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until a condition is true, with timeout */
export async function waitFor(
  condition: () => boolean,
  timeoutMs: number = 5000,
  pollMs: number = 50
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await wait(pollMs);
  }
}

/** Captures log messages from McpConnectionManager */
export class LogCapture {
  messages: string[] = [];

  logger = (msg: string): void => {
    this.messages.push(msg);
  };

  clear(): void {
    this.messages = [];
  }

  has(substring: string): boolean {
    return this.messages.some((m) => m.includes(substring));
  }

  count(substring: string): number {
    return this.messages.filter((m) => m.includes(substring)).length;
  }

  last(): string | undefined {
    return this.messages[this.messages.length - 1];
  }

  dump(): void {
    for (const m of this.messages) {
      console.log(`  [LOG] ${m}`);
    }
  }
}

/** Records state transitions */
export interface StateTransition {
  state: SessionState;
  previousState: SessionState;
  reason?: SessionReconnectReason;
  timestamp: number;
}

export class StateRecorder {
  transitions: StateTransition[] = [];

  handler = (
    state: SessionState,
    previousState: SessionState,
    reason?: SessionReconnectReason
  ): void => {
    this.transitions.push({
      state,
      previousState,
      reason,
      timestamp: Date.now(),
    });
  };

  clear(): void {
    this.transitions = [];
  }

  last(): StateTransition | undefined {
    return this.transitions[this.transitions.length - 1];
  }

  states(): SessionState[] {
    return this.transitions.map((t) => t.state);
  }

  hasTransition(from: SessionState, to: SessionState): boolean {
    return this.transitions.some(
      (t) => t.previousState === from && t.state === to
    );
  }

  reasons(): (SessionReconnectReason | undefined)[] {
    return this.transitions.map((t) => t.reason);
  }
}

/** Records received notifications */
export class NotificationRecorder {
  events: Record<string, unknown>[] = [];

  handler = (event: Record<string, unknown>): void => {
    this.events.push(event);
  };

  clear(): void {
    this.events = [];
  }

  count(): number {
    return this.events.length;
  }

  last(): Record<string, unknown> | undefined {
    return this.events[this.events.length - 1];
  }
}

