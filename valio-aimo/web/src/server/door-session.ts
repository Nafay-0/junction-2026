import type { Door } from "@/core/orders";
import type { Via } from "./ops/door";

/**
 * The interface a door's calls come through, for the operations views: in-process doors (the store, its
 * assistant, voice, photo, the menu planner) are on-site; an outside agent's are MCP (also through a connector
 * address) or REST. Sessions for in-process doors come from ops/onsite.ts, which applies the operations check.
 */
export function viaOfDoor(door: Door): Via {
  return door === "mcp" || door === "connector" ? "mcp" : door === "rest" ? "rest" : "onsite";
}
