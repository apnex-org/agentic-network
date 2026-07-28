/**
 * work-591 / bug-398 — an UNENUMERATED error class must reach the client as a
 * JSON envelope, not as prose.
 *
 * 🔴 THIS IS HALF OF bug-398's ROOT CAUSE, not a cosmetic gap.
 *
 * `router.handle` formatted its OWN refusals as JSON (unknown-tool, RBAC) but
 * its outer catch logged and RETHREW, and `mcp-binding.ts` returns
 * `router.handle(...)` with no catch — so anything not enumerated in a policy's
 * `mapVerbError` escaped to the SDK as plaintext. A `StorageAdmissionError`
 * arrived at the adapter handshake as `storage list admission ...`, the JSON
 * parse failed, the failure was treated as NON-FATAL, and the session bound its
 * role while never binding its agentId — a live seat silently became
 * `anonymous-<role>`.
 *
 * ─── TWO FALSIFIERS, DOING DIFFERENT WORK (idea-677) ─────────────────────────
 *   1 NEGATIVE  what must this go RED against?   -> binds the test to the diff
 *   2 POSITIVE  what must be observed to CHANGE? -> binds the diff to behaviour
 *
 * Clause 1 alone is satisfied by asserting "it did not throw". That is why
 * clause 2 asserts the envelope's CONTENT — specifically that `transience` and
 * `retryAfterMs` arrive, since those are the fields whose absence let the shim
 * misclassify a fatal condition as ignorable. A handler returning a constant
 * `{error: "..."}` would pass clause 1 and fail clause 2.
 */

import { describe, it, expect } from "vitest";
import { PolicyRouter } from "../router.js";
import { createTestContext } from "../test-utils.js";
import { StorageAdmissionError } from "../../storage-substrate/admission-gate.js";
import { toErrorEnvelope } from "../error-envelope.js";

/** A class the policy layer has never heard of — the general case. */
class WhollyUnknownError extends Error {
  constructor() {
    super("something the policy layer does not enumerate");
    this.name = "WhollyUnknownError";
  }
}

function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

function routerThrowing(err: unknown) {
  const router = new PolicyRouter(() => {});
  router.register(
    "explode",
    "[Any] test tool that raises an unenumerated error class",
    {},
    async () => { throw err; },
  );
  return router;
}

describe("work-591: the error envelope — general case", () => {
  it("🔴 an UNENUMERATED error class returns PARSEABLE JSON, not prose", async () => {
    const router = routerThrowing(new WhollyUnknownError());
    const res = await router.handle("explode", {}, createTestContext({ role: "engineer" }));

    // Clause 1 — it must not escape as a throw. (Alone, this is weak: a bare
    // `{error: "..."}` would satisfy it.)
    expect(res.isError).toBe(true);
    // The load-bearing part: the payload must PARSE. This is precisely what
    // failed in production — `Unexpected token 's', "storage li"...`.
    expect(() => body(res)).not.toThrow();

    // Clause 2 — the envelope must carry the contract, not just a string.
    const b = body(res);
    expect(b.errorKind).toBe("WhollyUnknownError");        // machine-stable, branchable
    expect(b.transience).toBe("unknown");                   // honest, not guessed
    expect(typeof b.mechanics).toBe("string");
    expect(typeof b.route).toBe("string");
  });

  it("🔴 an unclassifiable throw reports transience UNKNOWN — it does NOT guess", async () => {
    // The whole root cause is a caller MISCLASSIFYING a failure. The router
    // cannot know whether an unenumerated throw is retryable, and saying so is
    // the correct answer — a confident wrong classification is what cost two
    // seats. This asserts the router does not invent one.
    const router = routerThrowing(new WhollyUnknownError());
    const b = body(await router.handle("explode", {}, createTestContext({ role: "engineer" })));
    expect(b.transience).toBe("unknown");
    expect(b.transience).not.toBe("transient");
    expect(b.transience).not.toBe("permanent");
  });

  it("🔴 NEVER claims atomicity it cannot verify", async () => {
    // Stamping "nothing was changed" on an arbitrary throw would be a FALSE
    // guarantee — the handler may have committed before failing. A false
    // atomicity claim is worse than an absent one, because a caller may retry a
    // partially-applied write on the strength of it.
    const router = routerThrowing(new WhollyUnknownError());
    const b = body(await router.handle("explode", {}, createTestContext({ role: "engineer" })));
    expect(String(b.atomicity)).toMatch(/UNKNOWN/);
    expect(String(b.atomicity)).not.toMatch(/^Nothing was changed/);
  });

  it("🔴 StorageAdmissionError — the bug-398 specimen — arrives as JSON carrying TRANSIENT + retry terms", async () => {
    // The exact class that broke the handshake. Its `code` and `retryAfterMs`
    // ALREADY existed on the class and were destroyed by the serialisation;
    // this proves they now survive to the client.
    const router = routerThrowing(new StorageAdmissionError("storage list admission queue full (8 active, 128 queued)", 30_000));
    const res = await router.handle("explode", {}, createTestContext({ role: "engineer" }));
    const b = body(res);

    expect(b.errorKind).toBe("storage_admission_backpressure");
    // THE FIELD WHOSE ABSENCE IS HALF THE ROOT CAUSE: the shim could not tell
    // whether to retry, halt, or proceed. Now it can.
    expect(b.transience).toBe("transient");
    expect(b.retryAfterMs).toBe(30_000);
    // Backpressure refuses BEFORE issuing the query, so this class can honestly
    // promise atomicity where the general case cannot.
    expect(String(b.atomicity)).toMatch(/Nothing was changed/);
    expect(String(b.route)).toMatch(/[Rr]etry/);
  });

  it("the message survives — diagnosis is not lost to structure", async () => {
    const router = routerThrowing(new StorageAdmissionError("storage list admission timed out after 30000ms", 30_000));
    const b = body(await router.handle("explode", {}, createTestContext({ role: "engineer" })));
    expect(String(b.error)).toContain("storage list admission timed out");
  });

  it("toErrorEnvelope handles a non-Error throw without inventing a contract", async () => {
    // `throw "a string"` is legal JS and must not produce a malformed envelope.
    const b = toErrorEnvelope("a bare string throw");
    expect(b.errorKind).toBe("internal_error");
    expect(b.transience).toBe("unknown");
    expect(b.error).toContain("a bare string throw");
  });
});
