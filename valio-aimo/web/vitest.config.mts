import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // Tests that go through the server runtime expect the seed catalogue, whatever the shell exports.
    env: { DOCK_CATALOG: "seed" },
    // Several engineers build on one laptop: under that load a test that takes 2 s alone passes 5 s. The slow
    // limit keeps a real hang visible; a test that needs a tighter bound sets its own.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
