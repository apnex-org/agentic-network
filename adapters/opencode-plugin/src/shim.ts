// shim.ts — thin OpenCode host binding over the production runtime seam.

import type { Plugin } from "@opencode-ai/plugin";
import { createOpenCodeRuntime } from "./runtime.js";

export { createOpenCodeRuntime };
export type { OpenCodeRuntime, OpenCodeRuntimeOptions } from "./runtime.js";

const defaultRuntime = createOpenCodeRuntime();

export const HubPlugin: Plugin = defaultRuntime.plugin;
export const makeOpenCodeFetchHandler = defaultRuntime.makeOpenCodeFetchHandler;
export const _testOnly = defaultRuntime.testOnly;
