// plugin-entry.ts — the RELEASE BUNDLE entry point.
//
// OpenCode 1.3.x iterates a plugin module's exports and requires EVERY export to
// be a plugin function; a non-function export (e.g. `_testOnly`) makes the loader
// throw "Plugin export is not a function" (surfaced live at Steve's first
// onboarding, thread-667). shim.ts intentionally also exports test/internal
// symbols (_testOnly, buildPluginCallbacks, makeOpenCodeFetchHandler) for vitest.
//
// This entry re-exports ONLY `HubPlugin`, so the esbuild bundle's export surface
// is exactly one plugin function — the SDK's single-named-plugin-export convention.
// The internal helpers HubPlugin uses are still bundled (as internal symbols),
// just not re-exported. The release script's bundle entry points HERE, not at
// shim.ts; shim.ts stays the dev/test entry (`dev`/`test` scripts) with its full
// export surface.
export { HubPlugin } from "./shim.js";
