import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // Tests that go through the server runtime expect the seed catalogue, whatever the shell exports.
    env: { DOCK_CATALOG: "seed" },
  },
});
