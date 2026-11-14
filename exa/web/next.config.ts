import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Keys live one level up in exa/.env.local (shared with scripts). Load them for local runs;
// on a host such as Vercel they come from the project's environment settings instead.
const sharedEnv = resolve(process.cwd(), "../.env.local");
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const nextConfig: NextConfig = {
  // The build leaves a self-contained server in .next/standalone: that is what the container runs (see Dockerfile).
  output: "standalone",
  // The desktop app's installers sit under desktop/release when they have been built here. They
  // are hosted elsewhere and must never be pulled into the server's files.
  outputFileTracingExcludes: { "*": ["desktop/release/**", "desktop/dist/**", "scripts/**"] },
  // Next's development badge sits on the account row at the bottom left and takes its clicks.
  devIndicators: false,
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
