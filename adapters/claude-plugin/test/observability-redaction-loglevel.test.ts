/**
 * Mission-66 W1+W2 commit 4 — adapter logger formalization tests.
 *
 * Closes calibration #M6 observability formalization scope per Design §2.2:
 * - Redaction discipline (token + secret keys → `<redacted>` at FileBackedLogger
 *   emit boundary; ADR-031 §5)
 * - OIS_SHIM_LOG_LEVEL filter (DEBUG < INFO < WARN < ERROR; default INFO;
 *   ADR-031 §3)
 *
 * Per spec `docs/specs/shim-observability-events.md` §3 (common fields) +
 * §5 (redaction discipline) + ADR-031 §3 + §5.
 */

import { describe, it, expect } from "vitest";
import {
  redactFields,
  shouldEmitLevel,
  parseLogLevel,
  LOG_LEVELS,
} from "../src/observability.js";

describe("Mission-66 commit 4 — redaction discipline (ADR-031 §5)", () => {
  it("redacts token + secret keys (case-insensitive) to <redacted>", () => {
    const result = redactFields({
      token: "sk-secret-abc123",
      hubToken: "tok-xyz",
      Authorization: "Bearer X",
      bearer: "Y",
      apiKey: "Z",
      api_key: "W",
      secret: "V",
      password: "U",
    });
    expect(result.token).toBe("<redacted>");
    expect(result.hubToken).toBe("<redacted>");
    expect(result.Authorization).toBe("<redacted>");
    expect(result.bearer).toBe("<redacted>");
    expect(result.apiKey).toBe("<redacted>");
    expect(result.api_key).toBe("<redacted>");
    expect(result.secret).toBe("<redacted>");
    expect(result.password).toBe("<redacted>");
  });

  it("preserves non-sensitive keys verbatim", () => {
    const result = redactFields({
      pid: 1234,
      eventName: "shim.lifecycle.shim_started",
      proxyVersion: "0.1.4",
      role: "engineer",
    });
    expect(result.pid).toBe(1234);
    expect(result.eventName).toBe("shim.lifecycle.shim_started");
    expect(result.proxyVersion).toBe("0.1.4");
    expect(result.role).toBe("engineer");
  });

  it("redacts case-insensitively (HUBTOKEN / hubToken / hubtoken all match)", () => {
    expect(redactFields({ HUBTOKEN: "x" }).HUBTOKEN).toBe("<redacted>");
    expect(redactFields({ hubToken: "x" }).hubToken).toBe("<redacted>");
    expect(redactFields({ hubtoken: "x" }).hubtoken).toBe("<redacted>");
  });
});

describe("Mission-66 commit 4 — OIS_SHIM_LOG_LEVEL filter (ADR-031 §3)", () => {
  describe("parseLogLevel", () => {
    it("parses canonical levels case-insensitively", () => {
      expect(parseLogLevel("DEBUG")).toBe("DEBUG");
      expect(parseLogLevel("debug")).toBe("DEBUG");
      expect(parseLogLevel("Info")).toBe("INFO");
      expect(parseLogLevel("WARN")).toBe("WARN");
      expect(parseLogLevel("ERROR")).toBe("ERROR");
    });

    it("defaults to INFO for undefined / empty / unknown", () => {
      expect(parseLogLevel(undefined)).toBe("INFO");
      expect(parseLogLevel("")).toBe("INFO");
      expect(parseLogLevel("verbose")).toBe("INFO");
      expect(parseLogLevel("trace")).toBe("INFO");
    });
  });

  describe("shouldEmitLevel — threshold INFO (default)", () => {
    it("DEBUG event is suppressed", () => {
      expect(shouldEmitLevel("DEBUG", "INFO")).toBe(false);
    });
    it("INFO event emits", () => {
      expect(shouldEmitLevel("INFO", "INFO")).toBe(true);
    });
    it("WARN event emits", () => {
      expect(shouldEmitLevel("WARN", "INFO")).toBe(true);
    });
    it("ERROR event emits", () => {
      expect(shouldEmitLevel("ERROR", "INFO")).toBe(true);
    });
    it("unlevelled event emits (default INFO behavior)", () => {
      expect(shouldEmitLevel(undefined, "INFO")).toBe(true);
    });
  });

  describe("shouldEmitLevel — threshold WARN", () => {
    it("DEBUG suppressed", () => {
      expect(shouldEmitLevel("DEBUG", "WARN")).toBe(false);
    });
    it("INFO suppressed", () => {
      expect(shouldEmitLevel("INFO", "WARN")).toBe(false);
    });
    it("WARN emits", () => {
      expect(shouldEmitLevel("WARN", "WARN")).toBe(true);
    });
    it("ERROR emits", () => {
      expect(shouldEmitLevel("ERROR", "WARN")).toBe(true);
    });
    it("unlevelled event STILL emits (unlevelled bypasses threshold)", () => {
      expect(shouldEmitLevel(undefined, "WARN")).toBe(true);
    });
  });

  describe("shouldEmitLevel — threshold ERROR (strictest)", () => {
    it("DEBUG/INFO/WARN all suppressed; only ERROR emits", () => {
      expect(shouldEmitLevel("DEBUG", "ERROR")).toBe(false);
      expect(shouldEmitLevel("INFO", "ERROR")).toBe(false);
      expect(shouldEmitLevel("WARN", "ERROR")).toBe(false);
      expect(shouldEmitLevel("ERROR", "ERROR")).toBe(true);
    });
  });

  describe("shouldEmitLevel — threshold DEBUG (most-permissive)", () => {
    it("all canonical levels emit", () => {
      for (const level of LOG_LEVELS) {
        expect(shouldEmitLevel(level, "DEBUG")).toBe(true);
      }
    });
  });

  describe("shouldEmitLevel — unknown level field treated as unlevelled", () => {
    it("unknown 'verbose' level emits at any threshold", () => {
      expect(shouldEmitLevel("verbose", "INFO")).toBe(true);
      expect(shouldEmitLevel("verbose", "ERROR")).toBe(true);
    });
  });
});
