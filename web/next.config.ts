import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // src/proxy.ts makes Next.js buffer request bodies; cap that buffer (Dock's JSON bodies are at most 64 KB).
  experimental: { proxyClientMaxBodySize: "128kb" },
  // The partner catalogue index is read with fs at runtime; ship it with the server functions when it was built.
  outputFileTracingIncludes: { "/*": ["./.data/valio/**/*"] },
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
