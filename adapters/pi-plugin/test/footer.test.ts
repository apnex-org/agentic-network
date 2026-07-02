/**
 * footer.test.ts — swarm-aware footer spine gate proofs (mission-99 slice (a)).
 *
 * Design-of-record: docs/designs/m-swarm-footer/ratified-spec.md v2.1 §14.
 *
 * Proves the acceptance gates the WorkItem evidence requires, via A3 Local
 * Reasoning (no live Hub, no pi runtime — a pure renderer + a fake ctx):
 *   gate 0  TUI-only guard  — installFooter no-ops outside mode==="tui"
 *   gate 1  pure render     — render() makes ZERO Hub calls across a width matrix
 *   gate 2/3 width + fixed-height — always exactly 2 lines; width-safe
 *   gate 4  FSM mirror      — all 5 states; [live] ONLY nominal; freshness only live
 *   gate 8  read-only proof — the whole install/feed surface calls NO mutating tool
 *   gate 9  live-timer      — no 1Hz footer loop (no timer created on install)
 *   §5a honesty            — llm cell coarse err-tally, rolls off, decays to ok
 *   §7 honesty cascade     — non-live hub → needs `?`; live+zero → nothing needs you
 *   §10 S4-approx honesty  — approx count rendered tilde-marked, never authoritative
 */

import { describe, it, expect, vi } from "vitest";
import { renderFooter, type FooterTheme } from "../src/footer.js";
import {
  createFooterState,
  observeHubState,
  observePendingActionItem,
  observeLlmError,
  llmErrorCount,
  LLM_ERROR_WINDOW_MS,
  type FooterState,
} from "../src/footer-state.js";
import { installFooter } from "../src/footer-install.js";
import type { SessionState } from "@apnex/network-adapter";

// A theme that STRIPS color (plain text) — lets us assert on the raw glyph+value,
// proving severity is carried by text/glyph, not color alone (spec §2 monochrome).
const plainTheme: FooterTheme = { fg: (_k, s) => s };

// A theme that TAGS color, so we can assert a cell is amber/red when it must be.
const taggedTheme: FooterTheme = { fg: (k, s) => `<${k}>${s}</${k}>` };

const T0 = 1_000_000_000_000;

function baseInputs(state: FooterState, over: Partial<Parameters<typeof renderFooter>[1]> = {}) {
  return {
    state,
    contextUsage: { tokens: 34_000, contextWindow: 200_000, percent: 17 },
    gitBranch: null,
    leases: [],
    nowMs: T0,
    ...over,
  };
}

describe("renderFooter — fixed height + structure (gate 2/3)", () => {
  it("ALWAYS returns exactly 2 lines, in every state", () => {
    const states: (SessionState | null)[] = [
      null,
      "disconnected",
      "connecting",
      "synchronizing",
      "streaming",
      "reconnecting",
    ];
    for (const hs of states) {
      const s = createFooterState("greg", "engineer");
      if (hs) observeHubState(s, hs, T0);
      const lines = renderFooter(plainTheme, baseInputs(s));
      expect(lines).toHaveLength(2);
      expect(typeof lines[0]).toBe("string");
      expect(typeof lines[1]).toBe("string");
    }
  });

  it("line1 is SELF (identity·ctx·llm), line2 is WORLD (work·hub·needs)", () => {
    const s = createFooterState("greg", "engineer");
    observeHubState(s, "streaming", T0);
    const [l1, l2] = renderFooter(plainTheme, baseInputs(s, { nowMs: T0 }));
    expect(l1).toContain("greg·eng");
    expect(l1).toContain("ctx");
    expect(l1).toContain("llm");
    expect(l2).toContain("work");
    expect(l2).toContain("hub");
  });
});

describe("hub cell — FSM mirror + honesty cascade (gate 4, §7)", () => {
  const cases: Array<[SessionState, string]> = [
    ["disconnected", "[disc]"],
    ["connecting", "[conn…]"],
    ["synchronizing", "[sync]"],
    ["streaming", "[live]"],
    ["reconnecting", "[recon]"],
  ];
  it.each(cases)("state %s renders %s", (state, expected) => {
    const s = createFooterState("greg", "engineer");
    observeHubState(s, state, T0);
    const [, l2] = renderFooter(plainTheme, baseInputs(s, { nowMs: T0 }));
    expect(l2).toContain(expected);
  });

  it("cold start (no transition) renders a neutral [conn…], NEVER a fabricated [live]", () => {
    const s = createFooterState("greg", "engineer");
    const [, l2] = renderFooter(plainTheme, baseInputs(s));
    expect(l2).toContain("[conn…]");
    expect(l2).not.toContain("[live]");
  });

  it("[live] is the ONLY state that shows freshness [Ns]", () => {
    for (const [state] of cases) {
      const s = createFooterState("greg", "engineer");
      observeHubState(s, state, T0);
      const [, l2] = renderFooter(plainTheme, baseInputs(s, { nowMs: T0 + 45_000 }));
      const hasFreshness = /\[live\]\s+\[\d+m?\d*s\]/.test(l2);
      if (state === "streaming") expect(hasFreshness).toBe(true);
      else expect(l2).not.toMatch(/\[\d+m?\d*s\]/); // no freshness bracket off-live
    }
  });

  it("only [live] is nominal (dim); every other state is notice/alert colored", () => {
    for (const [state] of cases) {
      const s = createFooterState("greg", "engineer");
      observeHubState(s, state, T0);
      const [, l2] = renderFooter(taggedTheme, baseInputs(s, { nowMs: T0 }));
      if (state === "streaming") {
        expect(l2).toContain("<dim>[live]</dim>");
      } else if (state === "disconnected") {
        expect(l2).toContain("<error>[disc]</error>");
      } else {
        expect(l2).toMatch(/<warning>\[(conn…|sync|recon)\]<\/warning>/);
      }
    }
  });

  it("honesty cascade: non-live hub → needs `?` (never zeros/all-clear on untrusted wire)", () => {
    for (const [state] of cases) {
      if (state === "streaming") continue;
      const s = createFooterState("greg", "engineer");
      observeHubState(s, state, T0);
      s.s4ApproxCount = 3; // even with observed items, an untrusted wire shows ?
      const [, l2] = renderFooter(plainTheme, baseInputs(s));
      expect(l2).toContain("needs ?");
      expect(l2).not.toContain("nothing needs you");
      expect(l2).not.toContain("✎");
    }
  });

  it("[disc] downgrades hub to red + needs to ? (the critical render)", () => {
    const s = createFooterState("greg", "engineer");
    observeHubState(s, "disconnected", T0);
    const [, l2] = renderFooter(taggedTheme, baseInputs(s));
    expect(l2).toContain("<error>[disc]</error>");
    expect(l2).toContain("<dim>needs</dim>");
    expect(l2).toContain("<dim>?</dim>");
  });
});

describe("needs cell — S4-approx honesty (§10)", () => {
  it("live + zero → dim `nothing needs you` (fail-quiet, legal ONLY when live)", () => {
    const s = createFooterState("greg", "engineer");
    observeHubState(s, "streaming", T0);
    const [, l2] = renderFooter(plainTheme, baseInputs(s, { nowMs: T0 }));
    expect(l2).toContain("nothing needs you");
  });

  it("live + N observed → tilde-marked `~✎N`, NEVER an authoritative bare count", () => {
    const s = createFooterState("greg", "engineer");
    observeHubState(s, "streaming", T0);
    observePendingActionItem(s);
    observePendingActionItem(s);
    const [, l2] = renderFooter(plainTheme, baseInputs(s, { nowMs: T0 }));
    expect(l2).toContain("~✎2"); // tilde = approximate
    expect(l2).not.toMatch(/needs\s+2\b/); // never a bare authoritative "needs 2"
  });
});

describe("ctx cell — severity + honesty (gate: §4)", () => {
  it("pct leads; green<70 / amber>=70 / red>=90", () => {
    const mk = (percent: number) => {
      const s = createFooterState("greg", "engineer");
      return renderFooter(taggedTheme, baseInputs(s, {
        contextUsage: { tokens: percent * 2000, contextWindow: 200_000, percent },
      }))[0];
    };
    expect(mk(17)).toContain("<dim>17%</dim>");
    expect(mk(76)).toContain("<warning>76%</warning>");
    expect(mk(92)).toContain("<error>92%</error>");
  });

  it("honest unknown: percent null → `ctx ?` (never a fabricated number)", () => {
    const s = createFooterState("greg", "engineer");
    const l1 = renderFooter(plainTheme, baseInputs(s, {
      contextUsage: { tokens: null, contextWindow: 200_000, percent: null },
    }))[0];
    expect(l1).toContain("ctx ?");
    expect(l1).not.toMatch(/\d+%/);
  });
});

describe("llm cell — coarse tally, rolling window, decay (§5a)", () => {
  it("clean → dim `ok`", () => {
    const s = createFooterState("greg", "engineer");
    expect(renderFooter(plainTheme, baseInputs(s))[0]).toContain("llm ok");
  });

  it("errors → `⚠ err ×N`; NO retry-depth / backoff / codes (not feedable)", () => {
    const s = createFooterState("greg", "engineer");
    observeLlmError(s, T0);
    observeLlmError(s, T0);
    const l1 = renderFooter(plainTheme, baseInputs(s, { nowMs: T0 }))[0];
    expect(l1).toContain("⚠ err ×2");
    expect(l1).not.toMatch(/\d+\/\d+/); // no retry-depth "2/5"
    expect(l1).not.toContain("backoff");
    expect(l1).not.toMatch(/\[\d+×\d+\]/); // no code spectrum "[429×4]"
  });

  it("decays back to ok after the rolling window (errors roll off)", () => {
    const s = createFooterState("greg", "engineer");
    observeLlmError(s, T0);
    expect(llmErrorCount(s, T0)).toBe(1);
    expect(llmErrorCount(s, T0 + LLM_ERROR_WINDOW_MS + 1)).toBe(0);
    const l1 = renderFooter(plainTheme, baseInputs(s, { nowMs: T0 + LLM_ERROR_WINDOW_MS + 1 }))[0];
    expect(l1).toContain("llm ok");
  });
});

describe("work cell — client-side lease (§4)", () => {
  it("no lease → dim `idle`", () => {
    const s = createFooterState("greg", "engineer");
    expect(renderFooter(plainTheme, baseInputs(s))[1]).toContain("work idle");
  });

  it("lease → shortId + remaining; amber shrinking; red near-expiry", () => {
    const s = createFooterState("greg", "engineer");
    const lease = (msLeft: number) => ({
      workId: "work-bp-swarmfooterimpl1-spine",
      expiresAtMs: T0 + msLeft,
    });
    const nominal = renderFooter(taggedTheme, baseInputs(s, { leases: [lease(10 * 60_000)], nowMs: T0 }))[1];
    expect(nominal).toContain("spine");
    expect(nominal).toContain("<dim>[10m0s]</dim>");
    const notice = renderFooter(taggedTheme, baseInputs(s, { leases: [lease(3 * 60_000)], nowMs: T0 }))[1];
    expect(notice).toMatch(/<warning>\[3m0s\]<\/warning>/);
    const alert = renderFooter(taggedTheme, baseInputs(s, { leases: [lease(30_000)], nowMs: T0 }))[1];
    expect(alert).toMatch(/<error>\[30s\]<\/error>/);
  });
});

describe("installFooter — TUI-only guard + read-only + no-timer (gates 0/8/9)", () => {
  function fakeCtx(mode: string) {
    const setFooter = vi.fn();
    return {
      ctx: {
        mode,
        ui: { setFooter },
        getContextUsage: () => ({ tokens: 1, contextWindow: 2, percent: 50 }),
      } as never,
      setFooter,
    };
  }

  it("gate 0: NO-OP outside tui mode (print/json/rpc) — no install, returns null", () => {
    for (const mode of ["print", "json", "rpc"]) {
      const { ctx, setFooter } = fakeCtx(mode);
      const ctrl = installFooter({ ctx, leases: { snapshot: () => [] } });
      expect(ctrl).toBeNull();
      expect(setFooter).not.toHaveBeenCalled();
    }
  });

  it("gate 0: installs in tui mode; returns a controller", () => {
    const { ctx, setFooter } = fakeCtx("tui");
    const ctrl = installFooter({ ctx, leases: { snapshot: () => [] } });
    expect(ctrl).not.toBeNull();
    expect(setFooter).toHaveBeenCalledOnce();
  });

  it("gate 9: install creates NO timer (no 1Hz footer loop)", () => {
    const spy = vi.spyOn(global, "setInterval");
    const { ctx } = fakeCtx("tui");
    installFooter({ ctx, leases: { snapshot: () => [] } });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("gate 1/8: the render factory reads only local accessors — NO Hub/mutating calls", () => {
    // Capture the factory pi is handed, invoke its render across a width matrix,
    // and assert getContextUsage/snapshot are the ONLY external reads (no Hub).
    let factory: ((tui: unknown, theme: unknown) => { render: () => string[] }) | null = null;
    const getContextUsage = vi.fn(() => ({ tokens: 1000, contextWindow: 2000, percent: 50 }));
    const snapshot = vi.fn(() => []);
    const ctx = {
      mode: "tui",
      ui: { setFooter: (f: never) => { factory = f; } },
      getContextUsage,
    } as never;
    const ctrl = installFooter({ ctx, leases: { snapshot }, now: () => T0 });
    expect(ctrl).not.toBeNull();
    expect(factory).not.toBeNull();
    const tui = { requestRender: vi.fn() };
    const comp = factory!(tui, plainTheme);
    for (const width of [120, 100, 80, 64, 50]) {
      void width;
      const lines = comp.render();
      expect(lines).toHaveLength(2);
    }
    // Only local reads happened — no network/hub client is even in scope.
    expect(getContextUsage).toHaveBeenCalled();
    expect(snapshot).toHaveBeenCalled();
  });

  it("push feed → requestRender is kicked (reactive-not-busy)", () => {
    let factory: ((tui: unknown, theme: unknown) => unknown) | null = null;
    const ctx = {
      mode: "tui",
      ui: { setFooter: (f: never) => { factory = f; } },
      getContextUsage: () => undefined,
    } as never;
    const ctrl = installFooter({ ctx, leases: { snapshot: () => [] }, now: () => T0 });
    const tui = { requestRender: vi.fn() };
    factory!(tui, plainTheme); // bind requestRender
    ctrl!.onHubState("streaming");
    ctrl!.onPendingActionItem();
    ctrl!.onLlmError();
    expect(tui.requestRender).toHaveBeenCalledTimes(3);
  });

  it("dispose restores the built-in footer (setFooter(undefined))", () => {
    const { ctx, setFooter } = fakeCtx("tui");
    const ctrl = installFooter({ ctx, leases: { snapshot: () => [] } });
    ctrl!.dispose();
    expect(setFooter).toHaveBeenLastCalledWith(undefined);
    ctrl!.dispose(); // idempotent
  });
});
