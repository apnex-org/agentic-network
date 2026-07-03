import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createOpenCodeRuntime,
  _testOnly,
  makeOpenCodeFetchHandler,
} from "../src/shim.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("opencode runtime factory", () => {
  let tmp: string | null = null;

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it("creates isolated runtime instances with their own dispatcher and tool-refresh server set", async () => {
    const r1 = createOpenCodeRuntime();
    const r2 = createOpenCodeRuntime();

    expect(r1.plugin).toBeTypeOf("function");
    expect(r1.makeOpenCodeFetchHandler).toBeTypeOf("function");
    expect(r1.testOnly.dispatcher).not.toBe(r2.testOnly.dispatcher);

    const s1 = fakeServer();
    const s2 = fakeServer();
    r1.testOnly.pushProxyServer(s1 as any);
    r2.testOnly.pushProxyServer(s2 as any);

    const r1Reconciler = r1.testOnly.buildToolSurfaceReconciler(
      "https://hub.example/mcp",
      vi.fn<() => Promise<string | null>>()
        .mockResolvedValueOnce("rev-a")
        .mockResolvedValueOnce("rev-b"),
    );

    expect((await r1Reconciler.reconcile("seed")).emitted).toBe(false);
    expect((await r1Reconciler.reconcile("drift")).emitted).toBe(true);

    expect(s1.sendToolListChanged).toHaveBeenCalledOnce();
    expect(s2.sendToolListChanged).not.toHaveBeenCalled();
  });

  it("shim.ts delegates to the default runtime instead of owning dispatcher/module wiring", () => {
    const shimSource = readFileSync(resolve(root, "src", "shim.ts"), "utf-8");

    expect(shimSource).toContain("from \"./runtime.js\"");
    expect(shimSource).toContain("const defaultRuntime = createOpenCodeRuntime()");
    expect(shimSource).toContain("defaultRuntime.plugin");
    expect(shimSource).toContain("defaultRuntime.makeOpenCodeFetchHandler");
    expect(shimSource).toContain("defaultRuntime.testOnly");

    // Guard against regressing to the pre-W3 false-green shape where shim.ts
    // itself owned the dispatcher and module-global runtime state.
    expect(shimSource).not.toContain("createSharedDispatcher({");
    expect(shimSource).not.toContain("let hubAdapter");
    expect(shimSource).not.toContain("Bun.serve");

    const separate = createOpenCodeRuntime();
    expect(_testOnly.dispatcher).not.toBe(separate.testOnly.dispatcher);
    expect(makeOpenCodeFetchHandler).toBe(_testOnly.makeOpenCodeFetchHandler);
  });

  it("HubPlugin uses runtime-owned scheduler/startup delay while preserving async background init", async () => {
    tmp = mkdtempSync(join(tmpdir(), "opencode-runtime-factory-"));
    const scheduled: Array<{ delay: number; callback: () => void }> = [];
    const runtime = createOpenCodeRuntime({
      startupDelayMs: 17,
      setTimeoutFn: ((callback: () => void, delay?: number) => {
        scheduled.push({ delay: delay ?? 0, callback });
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
    });

    const pluginResult = await runtime.plugin({
      directory: tmp,
      client: fakeOpenCodeClient(),
    } as any);

    expect(pluginResult).toHaveProperty("event");
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].delay).toBe(17);
    // Do not invoke the scheduled callback here: this test pins that startup is
    // still asynchronous/deferred, not that live Hub/OpenCode side effects run.
  });
});

function fakeServer() {
  return { sendToolListChanged: vi.fn(async () => {}) };
}

function fakeOpenCodeClient() {
  return {
    session: {
      list: vi.fn(async () => ({ data: [] })),
      promptAsync: vi.fn(async () => {}),
    },
    tui: { showToast: vi.fn(async () => {}) },
    mcp: { add: vi.fn(async () => {}) },
  };
}
