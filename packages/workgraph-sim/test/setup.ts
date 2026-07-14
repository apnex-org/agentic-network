/**
 * setup.ts — vitest setup: mute the hub's verbose diagnostic logging (console.log /
 * console.error) during sim runs. The hub engine logs every transition + a benign
 * "emit failed" for out-of-boundary notification delivery (the sim has no message-router
 * per design-of-record §1); vitest's own reporter is unaffected, so failures still surface.
 */
import { beforeAll, afterAll } from "vitest";

const original = { log: console.log, error: console.error, warn: console.warn };

beforeAll(() => {
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
});
afterAll(() => {
  console.log = original.log;
  console.error = original.error;
  console.warn = original.warn;
});
