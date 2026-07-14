/**
 * wake-manifest.test.ts — bug-266: pi wakes must name the REAL (raw) registered tool,
 * not the stale `architect-hub_` prefix. Proves (1) pi's harness manifest declares
 * toolPrefix "" (raw registration), and (2) the wake path threads that prefix so a
 * task-issued wake tells the model to call `get_task`, never `architect-hub_get_task`.
 */
import { describe, it, expect } from "vitest";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { loadHarnessManifest } from "@apnex/network-adapter";
import { buildPiNotificationHooks } from "../src/wake.js";

const manifestPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "agent-adapter.manifest.json");

describe("pi harness manifest + wake tool-naming (bug-266)", () => {
  it("pi's manifest declares toolPrefix \"\" (raw registration) + harness pi (loads via the kernel)", () => {
    const m = loadHarnessManifest(manifestPath);
    expect(m.harness).toBe("pi");
    expect(m.toolPrefix).toBe(""); // THE fix: pi registers tools raw, no host prefix
    expect(m.transport).toBe("pi-native");
    expect(m.serverName).toBe("hub-proxy");
  });

  it("a wake names the RAW registered tool, not the stale architect-hub_ fossil", () => {
    const sent: string[] = [];
    const deps = {
      pi: { sendUserMessage: (text: string) => { sent.push(text); return Promise.resolve(); } },
      isIdle: () => true, // idle ⇒ deliver immediately via sendUserMessage
      log: () => {},
      notificationLogPath: join(tmpdir(), "pi-wake-bug266.log"),
      // Threaded from the manifest in production; here we assert the manifest's own value drives it.
      toolPrefix: loadHarnessManifest(manifestPath).toolPrefix,
    } as unknown as Parameters<typeof buildPiNotificationHooks>[0];

    const hooks = buildPiNotificationHooks(deps);
    hooks.onActionableEvent({ event: "task_issued", data: { taskId: "t1" } } as Parameters<typeof hooks.onActionableEvent>[0]);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("get_task"); // the real, registered tool name
    expect(sent[0]).not.toContain("architect-hub_"); // the fossil is gone
  });
});
