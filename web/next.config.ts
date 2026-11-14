import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // src/proxy.ts makes Next.js buffer request bodies; cap that buffer (Dock's JSON bodies are at most 64 KB).
  experimental: { proxyClientMaxBodySize: "128kb" },
  // Read with fs at runtime, so shipped with the server functions: the partner catalogue index when it was built,
  // and the published crash-test results (the wall and the Agents page show them on a server that ran none itself).
  outputFileTracingIncludes: { "/*": ["./.data/valio/**/*", "./src/crash/results/*.json"] },
  partialPrefetching: true,
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
