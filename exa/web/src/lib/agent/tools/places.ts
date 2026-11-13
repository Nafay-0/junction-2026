import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { exaSearch, type ExaEntity, type ExaResult } from "@/lib/exa/client";
import { toSource, type Place, type PlacesData, type WeatherData, type WeatherDay } from "@/lib/widgets/types";
import { errorMessage, type ToolContext } from "./context";

/*
 * Exa indexes 211M places and a weather feed as structured records under exa.ai/library.
 * Restricting a search to that domain returns them in about a second: place records come
 * back as `entities` with coordinates, hours, phone and rating; weather comes back as a
 * forecast table. No separate maps or weather API is needed.
 */

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function placeFromEntity(e: ExaEntity): Place | null {
  const p = e.properties as {
    name?: string;
    description?: string | null;
    categories?: string[];
    address?: { street?: string | null; locality?: string | null; postcode?: string | null; country?: string | null };
    location?: { latitude?: number; longitude?: number };
    phoneNumbers?: string[];
    websites?: string[];
    status?: string;
    hours?: Record<string, string>;
    rating?: { score?: number; count?: number };
  };
  const lat = p.location?.latitude;
  const lng = p.location?.longitude;
  if (!p.name || typeof lat !== "number" || typeof lng !== "number") return null;
  const category = p.categories?.[0]?.split(">").pop()?.trim();
  const address = [p.address?.street, [p.address?.postcode, p.address?.locality].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const website = (p.websites ?? []).find((w) => /^https?:\/\//.test(w) && !/[?&](rwg_token|aid)=/.test(w));
  const hours = p.hours ? DAYS.filter((d) => p.hours![d]).map((d) => ({ day: titleCase(d), hours: p.hours![d] })) : undefined;
  return {
    id: e.id.split("/").pop() ?? e.id,
    name: p.name,
    category,
    description: p.description ?? undefined,
    address: address || undefined,
    area: p.address?.locality ?? undefined,
    lat,
    lng,
    rating: p.rating?.score,
    reviewCount: p.rating?.count,
    status: p.status ? titleCase(p.status.replace(/_/g, " ")) : undefined,
    hours: hours?.length ? hours : undefined,
    phone: p.phoneNumbers?.[0],
    website,
    url: e.id,
  };
}

/** Fallback: read a place page's markdown when no structured record came with it. */
function placeFromPage(r: ExaResult): Place | null {
  const text = r.text ?? "";
  const field = (label: string) => text.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`))?.[1]?.trim();
  const coords = field("Coordinates")?.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (!coords) return null;
  const rating = field("Rating")?.match(/([\d.]+) out of 5(?: from ([\d,]+) reviews)?/);
  const hours = [...text.matchAll(/^\|\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*\|\s*([^|]+?)\s*\|/gm)]
    .slice(0, 7)
    .map((m) => ({ day: m[1], hours: m[2] }));
  const paragraphs = text.split(/\n\n+/).filter((p) => p && !p.startsWith("#") && !p.startsWith("-") && !p.startsWith("|"));
  return {
    id: r.url.split("/").pop() ?? r.url,
    name: text.match(/^#\s+(.+)/m)?.[1]?.trim() ?? r.title ?? "Place",
    category: field("Categories")?.split(",")[0]?.trim(),
    description: paragraphs[1]?.trim(),
    address: field("Address"),
    area: field("Area")?.split(",")[0]?.trim(),
    lat: Number(coords[1]),
    lng: Number(coords[2]),
    rating: rating ? Number(rating[1]) : undefined,
    reviewCount: rating?.[2] ? Number(rating[2].replace(/,/g, "")) : undefined,
    status: field("Status"),
    hours: hours.length ? hours : undefined,
    url: r.url,
  };
}

export function findPlacesTool(ctx: ToolContext) {
  return tool({
    description:
      "Find real places (restaurants, cafes, bars, shops, hotels, attractions, services, parks) and show them on an interactive map with ratings, opening hours, phone and directions. " +
      "Use it for anything location-based. Describe the place like you would ask a local, and always name the area or city.",
    inputSchema: z.object({
      query: z.string().describe('What kind of place and its qualities, for example "cosy vegan-friendly restaurant for an anniversary dinner".'),
      near: z.string().describe('Neighbourhood, city and country, for example "Kamppi, Helsinki, Finland".'),
    }),
    execute: async ({ query, near }, { abortSignal }): Promise<PlacesData> => {
      const base = { kind: "places" as const, query, area: near };
      try {
        const res = await exaSearch(
          { query: `${query} in ${near}`, numResults: 10, includeDomains: ["exa.ai"], contents: { text: { maxCharacters: 1600 } } },
          { meter: ctx.meter, signal: abortSignal },
        );
        const byId = new Map<string, Place>();
        for (const r of res.results) {
          for (const e of r.entities ?? []) {
            if (e.type !== "place") continue;
            const place = placeFromEntity(e);
            if (place && !byId.has(place.id)) byId.set(place.id, place);
          }
        }
        // Individual place pages are ranked by relevance to the query: keep that order first.
        const ordered: Place[] = [];
        for (const r of res.results) {
          if (!r.url.includes("/library/place/")) continue;
          const id = r.url.split("/").pop() ?? "";
          const place = byId.get(id) ?? placeFromPage(r);
          if (place && !ordered.some((p) => p.id === place.id)) ordered.push(place);
        }
        for (const place of byId.values()) if (!ordered.some((p) => p.id === place.id)) ordered.push(place);
        const places = ordered.filter((p) => p.status?.toLowerCase() !== "permanently closed").slice(0, 8);
        return {
          ...base,
          places,
          sources: places.map((p) => toSource({ url: p.url, title: `${p.name} (Exa Places)` })),
          exaCostUsd: res.costDollars?.total,
          error: places.length === 0 ? `No places found for "${query}" near ${near}. Try a broader description or a larger area.` : undefined,
        };
      } catch (err) {
        return { ...base, places: [], sources: [], error: errorMessage(err) };
      }
    },
    toModelOutput: ({ output }) => {
      if (output.error) return { type: "text", value: output.error };
      const today = new Date().toLocaleDateString("en-US", { weekday: "long" });
      const lines = output.places.map((p, i) => {
        const bits = [
          p.category,
          p.rating ? `${p.rating}/5 (${p.reviewCount ?? "?"} reviews)` : undefined,
          p.status,
          p.address,
          p.hours?.find((h) => h.day === today) ? `${today}: ${p.hours.find((h) => h.day === today)!.hours}` : undefined,
          p.phone,
          p.website,
        ].filter(Boolean);
        return `${i + 1}. ${p.name}: ${bits.join("; ")}${p.description ? `. ${p.description}` : ""}`;
      });
      return {
        type: "text",
        value:
          `These ${output.places.length} places are now shown to the user on a map with hours, phone, website and directions buttons. ` +
          `Do not repeat the list. Say which one or two you would pick and why, in two or three sentences.\n\n${lines.join("\n")}`,
      };
    },
  });
}

const F_TO_C = (f: number) => Math.round(((f - 32) * 5) / 9);
const MPH_TO_KPH = (mph: number) => Math.round(mph * 1.609);

export function parseWeather(text: string, url: string): WeatherDay[] {
  const start = url.match(/[?&]date=(\d{4}-\d{2}-\d{2})/)?.[1];
  const first = start ? new Date(`${start}T12:00:00Z`) : new Date();
  const rows = [...text.matchAll(/^\|\s*[A-Z][a-z]{2}\s+\d{1,2}\s*\|\s*([^|]+?)\s*\|\s*(-?\d+)°F\s*\|\s*(-?\d+)°F\s*\|\s*(\d+)%\s*\|\s*([\d.]+)mm\s*\|\s*(\d+)\s*mph\s*([A-Z]*)\s*\|/gm)];
  return rows.map((m, i) => {
    const date = new Date(first.getTime() + i * 86_400_000);
    return {
      date: date.toISOString().slice(0, 10),
      condition: m[1],
      highC: F_TO_C(Number(m[2])),
      lowC: F_TO_C(Number(m[3])),
      rainChance: Number(m[4]),
      precipMm: Number(m[5]),
      windKph: MPH_TO_KPH(Number(m[6])),
      windDirection: m[7] || undefined,
    };
  });
}

export function getWeatherTool(ctx: ToolContext) {
  return tool({
    description: "Get the weather forecast for a place (up to 14 days ahead) and show it as a forecast widget. Use it when weather affects a plan.",
    inputSchema: z.object({
      location: z.string().describe('City and country, for example "Espoo, Finland".'),
      when: z.string().optional().describe('The period in plain words, for example "this weekend", "next 10 days", "tomorrow". Default: the next 7 days.'),
    }),
    execute: async ({ location, when }, { abortSignal }): Promise<WeatherData> => {
      const base = { kind: "weather" as const, location };
      try {
        const res = await exaSearch(
          { query: `weather forecast in ${location} ${when ?? "next 7 days"}`, numResults: 3, includeDomains: ["exa.ai"], contents: { text: { maxCharacters: 3500 } } },
          { meter: ctx.meter, signal: abortSignal },
        );
        const page = res.results.find((r) => r.url.includes("/library/weather/"));
        const days = page ? parseWeather(page.text ?? "", page.url) : [];
        const name = page?.text?.match(/Forecast for (.+?) - /)?.[1] ?? location;
        return {
          ...base,
          location: name,
          days,
          sources: page ? [toSource({ url: page.url, title: `${name} forecast (Open-Meteo via Exa)` })] : [],
          exaCostUsd: res.costDollars?.total,
          error: days.length === 0 ? `No forecast found for ${location}.` : undefined,
        };
      } catch (err) {
        return { ...base, days: [], sources: [], error: errorMessage(err) };
      }
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.error
        ? output.error
        : `The forecast for ${output.location} is now shown to the user. Do not repeat it day by day; mention only what matters for their plan.\n` +
          output.days.map((d) => `${d.date}: ${d.condition}, ${d.lowC} to ${d.highC} C, rain ${d.rainChance ?? "?"}%, wind ${d.windKph ?? "?"} km/h`).join("\n"),
    }),
  });
}
