import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Mission-52 T3 revision v4 + methodology calibration #20: hub
    // depends on @ois/repo-event-bridge via `file:../packages/...`.
    // npm install symlinks the package; without preserveSymlinks,
    // Node resolves transitive deps from the symlink TARGET (the
    // package source dir), whose `node_modules/` is empty in CI
    // (npm only installs in hub/, not in the package dir). With
    // preserveSymlinks, Node resolves from the SYMLINK location
    // (hub/node_modules/...), so peer-deps satisfied at hub-level
    // resolve correctly. @ois/storage-provider is declared as a
    // peerDependency on the package + a real dep on hub. Sunsets
    // when idea-186 (npm workspaces) lands.
    server: {
      deps: {
        // Inline @ois/repo-event-bridge so vitest applies the
        // preserveSymlinks resolution to its imports too.
        inline: ["@ois/repo-event-bridge"],
      },
    },
  },
  resolve: {
    preserveSymlinks: true,
  },
});
