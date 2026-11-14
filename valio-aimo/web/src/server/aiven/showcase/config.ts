/**
 * Settings of the Aiven showcase (the operations portal's Platform section). Everything is optional: with none
 * set, every view still renders and says which setting would light it up.
 *
 *   AIVEN_PROJECT, AIVEN_ORGANIZATION_ID   which project and organisation to read
 *   AIVEN_READONLY_TOKEN                   token of the application user dock-grafana-reader (project role
 *                                          read-only): service state, plans, prices, balance, Managed Agent
 *                                          session messages, and the Aiven MCP server (as a Bearer token)
 *   DOCK_AIVEN_LAUNCH_TOKEN                token of the application user dock-agent-launcher (project role
 *                                          read-only as well; Managed Agents accepts it for sessions and for
 *                                          rotating the showcase integration's credential). Only the launcher uses it.
 *   DOCK_COPILOT_PG_URL                    dock-pg as the service user dock_copilot: SELECT on one view
 *                                          (telemetry.ops_events), read-only sessions, 3 s statements, 2 connections
 *   DOCK_SHOWCASE_LAUNCHES_PER_DAY=12      how many times staff may start the Aiven buyer per UTC day
 *   DOCK_SHOWCASE_LAUNCH_GAP_S=45          seconds between two starts
 *   DOCK_SHOWCASE_DOCK_URL                 the Dock the Managed Agent connects to (default DOCK_PUBLIC_URL, else the
 *                                          deployed app). The agent runs on Aiven, so it can only reach a public URL.
 *   DOCK_AIVEN_MCP=off                     never call the Aiven MCP server (the copilot uses the direct path)
 *   DOCK_AIVEN_MCP_URL                     default https://mcp.aiven.live/mcp
 */
const value = (name: string): string | undefined => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};
const int = (name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number.parseInt(value(name) ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export const DEPLOYED_DOCK_URL = "https://aimopilot.zeroanomaly.tech";

export const showcaseConfig = () => ({
  project: value("AIVEN_PROJECT"),
  organization: value("AIVEN_ORGANIZATION_ID"),
  readToken: value("AIVEN_READONLY_TOKEN"),
  launchToken: value("DOCK_AIVEN_LAUNCH_TOKEN"),
  copilotPgUrl: value("DOCK_COPILOT_PG_URL"),
  launchesPerDay: int("DOCK_SHOWCASE_LAUNCHES_PER_DAY", 12, 0, 200),
  launchGapMs: int("DOCK_SHOWCASE_LAUNCH_GAP_S", 45, 0, 3600) * 1000,
  dockUrl: (value("DOCK_SHOWCASE_DOCK_URL") ?? value("DOCK_PUBLIC_URL") ?? DEPLOYED_DOCK_URL).replace(/\/$/, ""),
  mcpUrl: value("DOCK_AIVEN_MCP_URL") ?? "https://mcp.aiven.live/mcp",
  mcpOff: /^(0|off|false|no)$/i.test(value("DOCK_AIVEN_MCP") ?? ""),
  /** The $50 trial credit the project started with (the API's billing-group credits need an admin token). */
  creditUsd: Number(value("DOCK_SHOWCASE_CREDIT_USD") ?? 50),
});

export type ShowcaseConfig = ReturnType<typeof showcaseConfig>;

/** Names of the settings that are missing for a feature, for the "what would light this up" line. */
export function missing(cfg: ShowcaseConfig, need: (keyof ShowcaseConfig)[]): string[] {
  const names: Partial<Record<keyof ShowcaseConfig, string>> = {
    project: "AIVEN_PROJECT",
    organization: "AIVEN_ORGANIZATION_ID",
    readToken: "AIVEN_READONLY_TOKEN",
    launchToken: "DOCK_AIVEN_LAUNCH_TOKEN",
    copilotPgUrl: "DOCK_COPILOT_PG_URL",
  };
  return need.filter((k) => !cfg[k]).map((k) => names[k] ?? String(k));
}
