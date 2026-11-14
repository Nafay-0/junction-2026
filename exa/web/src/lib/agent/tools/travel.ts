import "server-only";

import { tool } from "ai";
import { z } from "zod";
import type { FlightLeg, FlightOption, FlightsData, HotelOption, HotelsData } from "@/lib/widgets/types";
import { errorMessage, type ToolContext } from "./context";
import { runStructured, slug, whileWaiting } from "./structured";

/*
 * Live fares and room rates come from Jinko through Exa Connect: the Exa Agent queries the
 * partner's inventory and returns structured, cited results. Nothing here is cached data
 * from a model's memory.
 *
 * These tools are async generators: each `yield` replaces what the widget shows, and the last
 * value yielded is the tool's result (a generator's `return` value is ignored by the AI SDK).
 */

const legSchema = {
  type: "object",
  required: ["fromAirport", "toAirport", "departAt", "arriveAt", "stops"],
  properties: {
    fromAirport: { type: "string", description: "IATA code of the departure airport" },
    toAirport: { type: "string", description: "IATA code of the arrival airport" },
    departAt: { type: "string", description: "Local departure time, ISO format YYYY-MM-DDTHH:mm" },
    arriveAt: { type: "string", description: "Local arrival time, ISO format YYYY-MM-DDTHH:mm" },
    durationMinutes: { type: "number" },
    stops: { type: "number", description: "0 for a direct flight" },
    flightNumber: { type: "string" },
  },
};

const flightsSchema = {
  type: "object",
  required: ["options"],
  properties: {
    options: {
      type: "array",
      items: {
        type: "object",
        required: ["airline", "price", "currency", "outbound"],
        properties: {
          airline: { type: "string" },
          price: { type: "number", description: "Total price for all passengers" },
          currency: { type: "string", description: "ISO currency code" },
          outbound: legSchema,
          inbound: legSchema,
          fareNote: { type: "string", description: "Fare class and what it includes, one short phrase" },
          bookingUrl: { type: "string" },
        },
      },
    },
    note: { type: "string", description: "One sentence the traveller should know, for example about baggage or price trends" },
  },
};

type RawLeg = { fromAirport: string; toAirport: string; departAt: string; arriveAt: string; durationMinutes?: number; stops?: number; flightNumber?: string };
type RawFlights = {
  options?: Array<{ airline: string; price: number; currency: string; outbound: RawLeg; inbound?: RawLeg; fareNote?: string; bookingUrl?: string }>;
  note?: string;
};

function toLeg(raw: RawLeg, airline: string): FlightLeg {
  const minutes = raw.durationMinutes ?? undefined;
  return {
    from: raw.fromAirport,
    to: raw.toAirport,
    departAt: raw.departAt,
    arriveAt: raw.arriveAt,
    durationMinutes: minutes,
    stops: raw.stops ?? 0,
    airline,
    flightNumber: raw.flightNumber,
  };
}

/** A link that opens this exact search, for when the fare source gives no booking page of its own. */
function flightSearchUrl(from: string, to: string, departDate: string, returnDate?: string): string {
  const q = `Flights from ${from} to ${to} on ${departDate}${returnDate ? ` through ${returnDate}` : ""}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

function hotelSearchUrl(name: string, location: string, checkIn: string, checkOut: string, guests: number): string {
  const params = new URLSearchParams({ ss: `${name}, ${location}`, checkin: checkIn, checkout: checkOut, group_adults: String(guests), no_rooms: "1" });
  return `https://www.booking.com/searchresults.html?${params.toString()}`;
}

/** True for a link to a specific page, false for a bare home page such as https://gojinko.com. */
function isDeepLink(url: string | undefined): url is string {
  if (!url || !/^https?:\/\//.test(url)) return false;
  try {
    const u = new URL(url);
    return u.pathname.length > 1 || u.search.length > 1;
  } catch {
    return false;
  }
}

function tagFlights(options: FlightOption[]): FlightOption[] {
  if (options.length < 2) return options;
  const total = (o: FlightOption) => (o.outbound.durationMinutes ?? 9e9) + (o.inbound?.durationMinutes ?? 0);
  const cheapest = options.reduce((a, b) => (b.price < a.price ? b : a));
  const fastest = options.reduce((a, b) => (total(b) < total(a) ? b : a));
  return options.map((o) => ({
    ...o,
    tag: o === cheapest ? "Cheapest" : o === fastest && total(fastest) < 9e9 ? "Fastest" : undefined,
  }));
}

export function searchFlightsTool(ctx: ToolContext) {
  return tool({
    description:
      "Search live flight fares between two cities or airports and show the options as fare cards with times, stops, price and a booking link. Takes about 20 seconds. " +
      "Ask the user for dates first if they gave none.",
    inputSchema: z.object({
      origin: z.string().describe('City or airport, for example "Helsinki (HEL)".'),
      destination: z.string().describe('City or airport, for example "London".'),
      departDate: z.string().describe("ISO date, YYYY-MM-DD."),
      returnDate: z.string().optional().describe("ISO date for a round trip; omit for one way."),
      adults: z.number().int().min(1).max(9).optional(),
      preferences: z.string().optional().describe('For example "direct only", "morning departure", "business class", "with checked bag".'),
    }),
    async *execute(input, { abortSignal }): AsyncGenerator<FlightsData> {
      const adults = input.adults ?? 1;
      const base = {
        kind: "flights" as const,
        origin: input.origin,
        destination: input.destination,
        departDate: input.departDate,
        returnDate: input.returnDate,
        adults,
      };
      try {
        const work = runStructured<RawFlights>(
          ctx,
          {
            query:
              `Find the 6 best flight options from ${input.origin} to ${input.destination}, departing ${input.departDate}` +
              (input.returnDate ? `, returning ${input.returnDate}` : " (one way)") +
              `, for ${adults} adult${adults > 1 ? "s" : ""}.` +
              (input.preferences ? ` Preferences: ${input.preferences}.` : "") +
              " Include the cheapest, the fastest and a good balance of the two. Use live fares from the flight search.",
            schema: flightsSchema,
            providers: ["jinko"],
          },
          abortSignal,
        );
        const result = yield* whileWaiting(work, (s) => ({
          ...base,
          options: [],
          sources: [],
          stage: s < 6 ? "Asking Jinko for live fares" : s < 14 ? "Comparing airlines and times" : "Checking fare conditions",
        }));
        const options: FlightOption[] = (result.data.options ?? [])
          .filter((o) => o?.airline && typeof o.price === "number" && o.outbound)
          .map((o, i) => ({
            id: slug(o.airline, o.outbound.departAt, i),
            airline: o.airline,
            price: o.price,
            currency: o.currency || "EUR",
            outbound: toLeg(o.outbound, o.airline),
            inbound: o.inbound ? toLeg(o.inbound, o.airline) : undefined,
            fareNote: o.fareNote,
            bookingUrl: isDeepLink(o.bookingUrl) ? o.bookingUrl : flightSearchUrl(o.outbound.fromAirport, o.outbound.toAirport, input.departDate, input.returnDate),
          }))
          .sort((a, b) => a.price - b.price);
        yield {
          ...base,
          options: tagFlights(options),
          note: result.data.note,
          sources: result.sources,
          exaCostUsd: result.costUsd,
          error: options.length === 0 ? "No flights came back for those dates. Try nearby dates or airports." : undefined,
        };
      } catch (err) {
        yield { ...base, options: [], sources: [], error: errorMessage(err) };
      }
    },
    toModelOutput: ({ output }) => {
      if (output.stage) return { type: "text", value: "Searching flights." };
      if (output.error) return { type: "text", value: output.error };
      const lines = output.options.map((o, i) => {
        const leg = (l: FlightLeg) => `${l.from} ${l.departAt.slice(11, 16)} to ${l.to} ${l.arriveAt.slice(11, 16)}, ${l.stops === 0 ? "direct" : `${l.stops} stop(s)`}`;
        return `${i + 1}. ${o.airline}, ${o.price} ${o.currency}${o.tag ? ` (${o.tag})` : ""}: out ${leg(o.outbound)}${o.inbound ? `; back ${leg(o.inbound)}` : ""}${o.fareNote ? `. ${o.fareNote}` : ""}`;
      });
      return {
        type: "text",
        value:
          `These ${output.options.length} live fares are now shown to the user as cards with booking links. Do not repeat the list. ` +
          `Recommend one in a sentence or two and mention anything they should check before booking.\n\n${lines.join("\n")}${output.note ? `\nNote: ${output.note}` : ""}`,
      };
    },
  });
}

const hotelsSchema = {
  type: "object",
  required: ["options"],
  properties: {
    options: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "pricePerNight", "currency"],
        properties: {
          name: { type: "string" },
          address: { type: "string" },
          area: { type: "string", description: "Neighbourhood" },
          latitude: { type: "number" },
          longitude: { type: "number" },
          stars: { type: "number" },
          rating: { type: "number", description: "Guest rating out of 10" },
          reviewCount: { type: "number" },
          pricePerNight: { type: "number" },
          totalPrice: { type: "number", description: "Total for the whole stay" },
          currency: { type: "string", description: "ISO currency code" },
          imageUrl: { type: "string" },
          amenities: { type: "array", items: { type: "string" } },
          bookingUrl: { type: "string" },
          note: { type: "string", description: "One short sentence on why it suits this trip" },
        },
      },
    },
    note: { type: "string" },
  },
};

type RawHotels = {
  options?: Array<{
    name: string;
    address?: string;
    area?: string;
    latitude?: number;
    longitude?: number;
    stars?: number;
    rating?: number;
    reviewCount?: number;
    pricePerNight: number;
    totalPrice?: number;
    currency: string;
    imageUrl?: string;
    amenities?: string[];
    bookingUrl?: string;
    note?: string;
  }>;
  note?: string;
};

export function searchHotelsTool(ctx: ToolContext) {
  return tool({
    description:
      "Search live hotel availability and prices for a destination and dates, and show the options as cards with photos, rating, price per night and a booking link. Takes about 20 seconds. " +
      "Ask the user for dates first if they gave none.",
    inputSchema: z.object({
      location: z.string().describe('City or area, for example "Helsinki city centre, Finland".'),
      checkIn: z.string().describe("ISO date, YYYY-MM-DD."),
      checkOut: z.string().describe("ISO date, YYYY-MM-DD."),
      guests: z.number().int().min(1).max(8).optional(),
      preferences: z.string().optional().describe('For example "under 150 EUR a night", "with sauna", "near the train station", "boutique".'),
    }),
    async *execute(input, { abortSignal }): AsyncGenerator<HotelsData> {
      const guests = input.guests ?? 2;
      const base = { kind: "hotels" as const, location: input.location, checkIn: input.checkIn, checkOut: input.checkOut, guests };
      try {
        const work = runStructured<RawHotels>(
          ctx,
          {
            query:
              `Find 6 good hotels in ${input.location} available from ${input.checkIn} to ${input.checkOut} for ${guests} guest${guests > 1 ? "s" : ""}.` +
              (input.preferences ? ` Preferences: ${input.preferences}.` : "") +
              " Use live prices from the hotel search. Include a range of prices, and a photo URL for each when one is available.",
            schema: hotelsSchema,
            providers: ["jinko"],
            deadlineMs: 110_000,
          },
          abortSignal,
        );
        const result = yield* whileWaiting(work, (s) => ({
          ...base,
          options: [],
          sources: [],
          stage:
            s < 8
              ? "Asking Jinko for live room rates"
              : s < 22
                ? "Comparing hotels and locations"
                : s < 40
                  ? "Checking availability for your dates"
                  : "Still checking: live hotel inventory can take a minute",
        }));
        const options: HotelOption[] = (result.data.options ?? [])
          .filter((o) => o?.name && typeof o.pricePerNight === "number")
          .map((o, i) => ({
            id: slug(o.name, i),
            name: o.name,
            address: o.address,
            area: o.area,
            lat: o.latitude,
            lng: o.longitude,
            stars: o.stars,
            rating: o.rating,
            reviewCount: o.reviewCount,
            pricePerNight: Math.round(o.pricePerNight),
            totalPrice: typeof o.totalPrice === "number" ? Math.round(o.totalPrice) : undefined,
            currency: o.currency || "EUR",
            image: o.imageUrl && /^https?:\/\//.test(o.imageUrl) ? o.imageUrl : undefined,
            amenities: o.amenities?.slice(0, 6),
            bookingUrl: isDeepLink(o.bookingUrl) ? o.bookingUrl : hotelSearchUrl(o.name, input.location, input.checkIn, input.checkOut, guests),
            note: o.note,
          }));
        if (options.length > 1) {
          const cheapest = options.reduce((a, b) => (b.pricePerNight < a.pricePerNight ? b : a));
          const best = options.filter((o) => o.rating).reduce<HotelOption | undefined>((a, b) => (!a || (b.rating ?? 0) > (a.rating ?? 0) ? b : a), undefined);
          for (const o of options) o.tag = o === cheapest ? "Lowest price" : o === best ? "Top rated" : undefined;
        }
        yield {
          ...base,
          options,
          note: result.data.note,
          sources: result.sources,
          exaCostUsd: result.costUsd,
          error: options.length === 0 ? "No hotels came back for those dates. Try different dates or a wider area." : undefined,
        };
      } catch (err) {
        yield { ...base, options: [], sources: [], error: errorMessage(err) };
      }
    },
    toModelOutput: ({ output }) => {
      if (output.stage) return { type: "text", value: "Searching hotels." };
      if (output.error) return { type: "text", value: output.error };
      const lines = output.options.map(
        (o, i) =>
          `${i + 1}. ${o.name}${o.area ? `, ${o.area}` : ""}: ${o.pricePerNight} ${o.currency}/night${o.rating ? `, rated ${o.rating}/10` : ""}${o.stars ? `, ${o.stars} stars` : ""}${o.tag ? ` (${o.tag})` : ""}${o.note ? `. ${o.note}` : ""}`,
      );
      return {
        type: "text",
        value:
          `These ${output.options.length} hotels with live prices are now shown to the user as cards with booking links. Do not repeat the list. ` +
          `Recommend one or two in a couple of sentences.\n\n${lines.join("\n")}`,
      };
    },
  });
}
