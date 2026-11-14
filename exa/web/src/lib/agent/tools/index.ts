import "server-only";

import type { InferUITools, LanguageModel, UIMessage } from "ai";
import type { RunStats } from "../models";
import { browserActTool, browserCloseTool, browserLookTool, browserOpenTool, browserReadTool, requestUserActionTool } from "./browser";
import { askUserTool, requestLocationTool, showActionsTool, showComparisonTool, showKeyFactsTool, showWidgetTool, updatePlanTool } from "./compose";
import type { ToolContext } from "./context";
import { getPredictionMarketTool, getStocksTool } from "./markets";
import { findPlacesTool, getWeatherTool } from "./places";
import { deepResearchTool } from "./research";
import { readPagesTool, searchImagesTool, webSearchTool } from "./search";
import { searchProductsTool } from "./shopping";
import { siftTool } from "./sift";
import { searchFlightsTool, searchHotelsTool } from "./travel";

/**
 * The agent's tools for one request. Each tool's output is the payload its widget renders.
 *
 * The live browser belongs to the desktop app. Asked from the web (a browser tab, the installed
 * web app, a phone) the agent can search, read and show, and its browser tools are left out: it
 * cannot act on websites there, and says so. The type is the same either way, because both kinds
 * of client show conversations that used the browser.
 */
export function createTools(ctx: ToolContext, mainModel: LanguageModel) {
  const all = allTools(ctx, mainModel);
  if (ctx.client === "desktop") return all;
  const reading: Partial<typeof all> = { ...all };
  for (const name of DESKTOP_ONLY) delete reading[name];
  return reading as typeof all;
}

/** The tools that act in the live browser. Only the desktop app has one. */
export const DESKTOP_ONLY = ["browserOpen", "browserAct", "browserRead", "browserLook", "browserClose", "requestUserAction"] as const;

function allTools(ctx: ToolContext, mainModel: LanguageModel) {
  return {
    webSearch: webSearchTool(ctx),
    readPages: readPagesTool(ctx),
    findPlaces: findPlacesTool(ctx),
    searchFlights: searchFlightsTool(ctx),
    searchHotels: searchHotelsTool(ctx),
    searchProducts: searchProductsTool(ctx),
    sift: siftTool(ctx),
    getStocks: getStocksTool(ctx),
    getPredictionMarket: getPredictionMarketTool(ctx),
    searchImages: searchImagesTool(ctx),
    getWeather: getWeatherTool(ctx),
    deepResearch: deepResearchTool(ctx, mainModel),
    showComparison: showComparisonTool(),
    showKeyFacts: showKeyFactsTool(),
    showWidget: showWidgetTool(),
    showActions: showActionsTool(),
    updatePlan: updatePlanTool(),
    askUser: askUserTool(),
    requestLocation: requestLocationTool(),
    browserOpen: browserOpenTool(),
    browserAct: browserActTool(),
    browserRead: browserReadTool(),
    browserLook: browserLookTool(),
    browserClose: browserCloseTool(),
    requestUserAction: requestUserActionTool(),
  };
}

export type ButlerTools = ReturnType<typeof createTools>;

/** The chat message type shared by the route and the browser: typed tool parts plus run stats as metadata. */
export type ButlerMessage = UIMessage<RunStats, never, InferUITools<ButlerTools>>;
