// MapLibre 6 runs its tile worker as a separate script that the bundler cannot resolve.
// Copy it into /public so the app can load it from "/maplibre-gl-worker.mjs".
// Runs before `dev` and `build`.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public", { recursive: true });
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre-gl-worker.mjs");
