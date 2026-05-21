/**
 * bug-110 — regression guard for the canonical pg error handler.
 *
 * The bug: pg `Pool` / `Client` constructed without an `'error'` listener turn
 * an idle-connection backend error into an UNCAUGHT exception that crashes the
 * process (Node's EventEmitter contract: emitting `'error'` with no listener
 * throws). `vitest (hub)` flaked on exactly this — a testcontainer teardown
 * racing pool shutdown delivered a `57P01` to a still-idle connection.
 *
 * These tests pin the contract of `attachPgErrorHandler` directly (no
 * container, fully deterministic): once attached, an `'error'` event is
 * handled, not thrown.
 */

import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { attachPgErrorHandler } from "../pg-error-handler.js";

describe("attachPgErrorHandler (bug-110)", () => {
  it("an 'error' event after attach is handled, NOT thrown as an uncaught exception", () => {
    const emitter = new EventEmitter();
    attachPgErrorHandler(emitter, "test pool");
    // Pre-fix (no listener) this emit would throw — the bug-110 crash. The
    // handler must make it a no-throw.
    expect(() =>
      emitter.emit("error", new Error("57P01: terminating connection due to administrator command")),
    ).not.toThrow();
  });

  it("a bare emitter with no handler still throws — confirms the test exercises the real gap", () => {
    const emitter = new EventEmitter();
    expect(() => emitter.emit("error", new Error("57P01"))).toThrow(/57P01/);
  });

  it("logs the error as non-fatal with the resource label (operator-visible; process survives)", () => {
    const emitter = new EventEmitter();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      attachPgErrorHandler(emitter, "watch LISTEN client");
      emitter.emit("error", new Error("57P01"));
      expect(spy).toHaveBeenCalledOnce();
      const line = String(spy.mock.calls[0]![0]);
      expect(line).toContain("watch LISTEN client");
      expect(line).toContain("non-fatal");
    } finally {
      spy.mockRestore();
    }
  });
});
