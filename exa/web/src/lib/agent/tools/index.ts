import "server-only";

import type { InferUITools, LanguageModel, UIMessage } from "ai";
import type { RunStats } from "../models";
import { browserActTool, browserOpenTool, browserReadTool, requestUserActionTool } from "./browser";
import { askUserTool, requestLocationTool, showActionsTool, showComparisonTool, showKeyFactsTool, showWidgetTool, updatePlanTool } from "./compose";
import type { ToolContext } from "./context";
import { getPredictionMarketTool, getStocksTool } from "./markets";
import { findPlacesTool, getWeatherTool } from "./places";
import { deepResearchTool } from "./research";
import { readPagesTool, searchImagesTool, webSearchTool } from "./search";
import { searchProductsTool } from "./shopping";
import { searchFlightsTool, searchHotelsTool } from "./travel";

/** The agent's tools for one request. Each tool's output is the payload its widget renders. */
export function createTools(ctx: ToolContext, mainModel: LanguageModel) {
  return {
    webSearch: webSearchTool(ctx),
    readPages: readPagesTool(ctx),
    findPlaces: findPlacesTool(ctx),
    searchFlights: searchFlightsTool(ctx),
    searchHotels: searchHotelsTool(ctx),
    searchProducts: searchProductsTool(ctx),
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
    browserOpen: browserOpenTool(ctx),
    browserAct: browserActTool(ctx),
    browserRead: browserReadTool(ctx),
    requestUserAction: requestUserActionTool(ctx),
  };
}

export type ButlerTools = ReturnType<typeof createTools>;

/** The chat message type shared by the route and the browser: typed tool parts plus run stats as metadata. */
export type ButlerMessage = UIMessage<RunStats, never, InferUITools<ButlerTools>>;
