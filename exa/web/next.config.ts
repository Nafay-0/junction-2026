import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Keys live one level up in exa/.env.local (shared with scripts). Load them for local runs;
// on a host such as Vercel they come from the project's environment settings instead.
const sharedEnv = resolve(process.cwd(), "../.env.local");
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const nextConfig: NextConfig = {
  // The live browser drives a real Chrome through Playwright, which must run as plain Node code.
  serverExternalPackages: ["playwright-core"],
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
