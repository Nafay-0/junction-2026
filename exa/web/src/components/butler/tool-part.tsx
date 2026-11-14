"use client";

import * as React from "react";
import type { ButlerMessage } from "@/lib/agent/tools";
import type {
  ActionsData,
  ClarifyAnswer,
  ClarifyInput,
  ExactLocation,
  LocationAnswer,
  LocationRequestInput,
  ComparisonData,
  FlightsData,
  HotelsData,
  ImagesData,
  KeyFactsData,
  PlacesData,
  PredictionMarketData,
  ProductsData,
  ResearchData,
  StocksData,
  WeatherData,
} from "@/lib/widgets/types";
import { Actions } from "@/components/widgets/actions";
import { Clarify } from "@/components/widgets/clarify";
import { Comparison } from "@/components/widgets/comparison";
import { KeyFacts } from "@/components/widgets/facts";
import { Flights } from "@/components/widgets/flights";
import { Hotels } from "@/components/widgets/hotels";
import { Images } from "@/components/widgets/images";
import { LocationRequest } from "@/components/widgets/location-request";
import { PredictionMarket } from "@/components/widgets/market";
import { PlacesMap } from "@/components/widgets/places-map";
import { Products } from "@/components/widgets/products";
import { Research } from "@/components/widgets/research";
import { Stocks } from "@/components/widgets/stocks";
import { Weather } from "@/components/widgets/weather";

export type ButlerPart = ButlerMessage["parts"][number];
export type ToolPart = Extract<ButlerPart, { type: `tool-${string}` }>;

export function isToolPart(part: ButlerPart): part is ToolPart {
  return part.type.startsWith("tool-");
}

/** Tools shown as quiet activity rows instead of cards. */
export const ACTIVITY_TOOLS = new Set(["tool-webSearch", "tool-readPages"]);

/** A widget crashing must never take the conversation down with it. */
class WidgetBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[widget] render failed", error);
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-xl border border-border bg-surface px-4 py-3 text-[0.85rem] text-muted-foreground">
          This result could not be displayed. The answer below still stands.
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Work out what a widget should render for a tool call at any point in its life:
 * arguments still streaming, tool running (preliminary results), finished, or failed.
 */
function resolve<T extends { sources: unknown[]; error?: string; stage?: string }>(
  part: ToolPart,
  fallback: (input: Record<string, unknown>) => T,
  stage: string,
): { data: T; loading: boolean } {
  const input = (part.input ?? {}) as Record<string, unknown>;
  if (part.state === "output-available") {
    const output = part.output as unknown as T;
    return { data: output, loading: part.preliminary === true };
  }
  if (part.state === "output-error") {
    return { data: { ...fallback(input), error: part.errorText || "This lookup failed." }, loading: false };
  }
  if (part.state === "output-denied") {
    return { data: { ...fallback(input), error: "This step was skipped." }, loading: false };
  }
  return { data: { ...fallback(input), stage }, loading: true };
}

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v.filter((x) => x != null) as T[]) : []);

/** What the widgets that talk back to the agent need from the chat. */
export type WidgetHandlers = {
  /** Called when the user answers a clarifying question. */
  onAnswer?: (toolCallId: string, answer: ClarifyAnswer) => void;
  /** Called when the user answers a request for their location. */
  onLocation?: (toolCallId: string, answer: LocationAnswer) => void;
  /** The place assumed when no exact location is shared, for example "Helsinki, Finland". */
  approximatePlace?: string;
  /** The exact location saved in this browser, if any. */
  savedLocation?: ExactLocation | null;
};

export function ToolWidget({ part, handlers }: { part: ToolPart; handlers: WidgetHandlers }) {
  return <WidgetBoundary>{renderWidget(part, handlers)}</WidgetBoundary>;
}

function renderWidget(part: ToolPart, handlers: WidgetHandlers): React.ReactNode {
  const { onAnswer } = handlers;
  switch (part.type) {
    case "tool-requestLocation": {
      const answered = part.state === "output-available" ? (part.output as LocationAnswer) : undefined;
      return (
        <LocationRequest
          input={(part.input ?? {}) as LocationRequestInput}
          loading={part.state === "input-streaming"}
          answer={answered}
          approximatePlace={handlers.approximatePlace ?? ""}
          saved={handlers.savedLocation}
          onResult={handlers.onLocation ? (answer) => handlers.onLocation?.(part.toolCallId, answer) : undefined}
        />
      );
    }
    case "tool-findPlaces": {
      const { data, loading } = resolve<PlacesData>(
        part,
        (i) => ({ kind: "places", query: str(i.query), area: str(i.near) || undefined, places: [], sources: [] }),
        "Looking up places in Exa's index",
      );
      return <PlacesMap data={data} loading={loading} />;
    }
    case "tool-searchFlights": {
      const { data, loading } = resolve<FlightsData>(
        part,
        (i) => ({
          kind: "flights",
          origin: str(i.origin, "…"),
          destination: str(i.destination, "…"),
          departDate: str(i.departDate),
          returnDate: str(i.returnDate) || undefined,
          adults: typeof i.adults === "number" ? i.adults : 1,
          options: [],
          sources: [],
        }),
        "Asking Jinko for live fares",
      );
      return <Flights data={data} loading={loading} />;
    }
    case "tool-searchHotels": {
      const { data, loading } = resolve<HotelsData>(
        part,
        (i) => ({
          kind: "hotels",
          location: str(i.location, "…"),
          checkIn: str(i.checkIn),
          checkOut: str(i.checkOut),
          guests: typeof i.guests === "number" ? i.guests : 2,
          options: [],
          sources: [],
        }),
        "Asking Jinko for live room rates",
      );
      return <Hotels data={data} loading={loading} />;
    }
    case "tool-searchProducts": {
      const { data, loading } = resolve<ProductsData>(part, (i) => ({ kind: "products", query: str(i.query), products: [], sources: [] }), "Searching shops and reviews");
      return <Products data={data} loading={loading} />;
    }
    case "tool-getStocks": {
      const { data, loading } = resolve<StocksData>(part, () => ({ kind: "stocks", quotes: [], sources: [] }), "Fetching live prices");
      return <Stocks data={data} loading={loading} />;
    }
    case "tool-getPredictionMarket": {
      const { data, loading } = resolve<PredictionMarketData>(
        part,
        (i) => ({ kind: "market", title: str(i.query, "Prediction market"), url: "https://polymarket.com", outcomes: [], historyLabel: "", sources: [] }),
        "Reading live odds",
      );
      return <PredictionMarket data={data} loading={loading} />;
    }
    case "tool-searchImages": {
      const { data, loading } = resolve<ImagesData>(part, (i) => ({ kind: "images", query: str(i.query), images: [], sources: [] }), "Finding images");
      return <Images data={data} loading={loading} />;
    }
    case "tool-getWeather": {
      const { data, loading } = resolve<WeatherData>(part, (i) => ({ kind: "weather", location: str(i.location, "…"), days: [], sources: [] }), "Fetching the forecast");
      return <Weather data={data} loading={loading} />;
    }
    case "tool-deepResearch": {
      const { data, loading } = resolve<ResearchData>(
        part,
        (i) => ({
          kind: "research",
          question: str(i.question),
          status: "planning",
          agents: arr<string>(i.angles).map((title, n) => ({ id: `r${n + 1}`, title: str(title), status: "queued" as const, steps: [], sources: [] })),
          sources: [],
        }),
        "Briefing the researchers",
      );
      return <Research data={data} loading={loading} />;
    }
    case "tool-showComparison": {
      // The table fills in as the model writes it: the partial arguments are the data.
      const { data, loading } = resolve<ComparisonData>(
        part,
        (i) => {
          const columns = arr<string>(i.columns).map((c) => str(c));
          return {
            kind: "comparison",
            title: str(i.title, "Comparison"),
            columns,
            rows: arr<{ label?: unknown; values?: unknown }>(i.rows)
              .filter((r) => typeof r.label === "string")
              .map((r) => ({ label: str(r.label), values: columns.map((_, n) => str(arr<string>(r.values)[n])) })),
            winner: typeof i.winner === "number" ? i.winner : undefined,
            note: str(i.note) || undefined,
            sources: [],
          };
        },
        "Lining up the options",
      );
      return <Comparison data={data} loading={loading} />;
    }
    case "tool-showKeyFacts": {
      const { data, loading } = resolve<KeyFactsData>(
        part,
        (i) => ({
          kind: "facts",
          title: str(i.title, "Key facts"),
          facts: arr<Record<string, unknown>>(i.facts)
            .filter((f) => typeof f.label === "string" && typeof f.value === "string")
            .map((f) => ({ label: str(f.label), value: str(f.value), detail: str(f.detail) || undefined, sourceUrl: str(f.sourceUrl) || undefined })),
          sources: [],
        }),
        "Pulling out the key facts",
      );
      return <KeyFacts data={data} loading={loading} />;
    }
    case "tool-showActions": {
      const { data, loading } = resolve<ActionsData>(
        part,
        (i) => ({
          kind: "actions",
          title: str(i.title) || undefined,
          actions: arr<Record<string, unknown>>(i.actions)
            .filter((a) => typeof a.label === "string" && typeof a.href === "string" && typeof a.type === "string")
            .map((a) => ({
              label: str(a.label),
              description: str(a.description) || undefined,
              type: a.type as ActionsData["actions"][number]["type"],
              href: str(a.href),
              primary: a.primary === true,
            })),
          sources: [],
        }),
        "Preparing next steps",
      );
      return <Actions data={data} loading={loading} />;
    }
    case "tool-askUser": {
      const input = (part.input ?? { questions: [] }) as ClarifyInput;
      const answered = part.state === "output-available" ? (part.output as ClarifyAnswer) : undefined;
      return (
        <Clarify
          input={{ intro: input.intro, questions: Array.isArray(input.questions) ? input.questions : [] }}
          loading={part.state === "input-streaming"}
          answer={answered}
          onSubmit={(answer) => onAnswer?.(part.toolCallId, answer)}
        />
      );
    }
    default:
      return null;
  }
}
