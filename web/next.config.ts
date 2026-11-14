import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Only in the hosted image build (web/Dockerfile sets this): skip `next build`'s own type check, which ran out of
  // the build's 4 GB there. Everywhere else the build checks types as usual, and `pnpm typecheck` gates every merge.
  typescript: { ignoreBuildErrors: process.env.DOCK_BUILD_SKIP_TYPES === "1" },
  // src/proxy.ts makes Next.js buffer request bodies; cap that buffer (Dock's JSON bodies are at most 64 KB).
  // DOCK_BUILD_WORKERS (set in web/Dockerfile): how many workers `next build` may use. The hosted build machine
  // reports many cores but has 4 GB, and fifteen workers ran it out of memory on 14 Nov.
  experimental: { proxyClientMaxBodySize: "128kb", ...(Number(process.env.DOCK_BUILD_WORKERS) > 0 ? { cpus: Number(process.env.DOCK_BUILD_WORKERS) } : {}) },
  // Read with fs at runtime, so shipped with the server functions: the partner catalogue index when it was built,
  // and the published crash-test results (the wall and the Agents page show them on a server that ran none itself).
  outputFileTracingIncludes: { "/*": ["./.data/valio/**/*", "./src/crash/results/*.json", "./src/crash/*.md", "./docs/*.md"] },
  partialPrefetching: true,
  // Loaded from node_modules at run time, not bundled: bundled, iovalkey's command table (a 3.4 MB JSON string in
  // the module source) was kept once per server chunk that reaches the Aiven adapters, about 20 copies, roughly
  // 70 MB of a 1 GB server before the first request.
  serverExternalPackages: ["iovalkey", "kafkajs", "@opensearch-project/opensearch"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
