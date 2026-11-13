import { toSource, type WeatherData } from "@/lib/widgets/types";

export const weatherFixture: WeatherData = {
  kind: "weather",
  location: "Espoo, Finland",
  days: [
    { date: "2026-11-14", condition: "Overcast", highC: 6, lowC: 3, rainChance: 20, precipMm: 0.2, windKph: 18, windDirection: "SW" },
    { date: "2026-11-15", condition: "Drizzle", highC: 7, lowC: 4, rainChance: 70, precipMm: 2.4, windKph: 24, windDirection: "SW" },
    { date: "2026-11-16", condition: "Light rain", highC: 8, lowC: 5, rainChance: 80, precipMm: 4.1, windKph: 29, windDirection: "S" },
    { date: "2026-11-17", condition: "Mostly cloudy", highC: 5, lowC: 2, rainChance: 30, precipMm: 0.4, windKph: 21, windDirection: "W" },
    { date: "2026-11-18", condition: "Partly sunny", highC: 4, lowC: 0, rainChance: 10, precipMm: 0, windKph: 14, windDirection: "NW" },
    { date: "2026-11-19", condition: "Fog, then clouds", highC: 3, lowC: 0, rainChance: 15, precipMm: 0.1, windKph: 8, windDirection: "N" },
    { date: "2026-11-20", condition: "Snow showers", highC: 2, lowC: -1, rainChance: 60, precipMm: 3.0, windKph: 26, windDirection: "N" },
    { date: "2026-11-21", condition: "Sleet and snow", highC: 1, lowC: -2, rainChance: 55, precipMm: 2.2, windKph: 22, windDirection: "NE" },
    { date: "2026-11-22", condition: "Overcast", highC: 2, lowC: -1, rainChance: 25, precipMm: 0.3, windKph: 12, windDirection: "E" },
    { date: "2026-11-23", condition: "Drizzle", highC: 4, lowC: 1, rainChance: 65, precipMm: 1.6, windKph: 19, windDirection: "SE" },
  ],
  sources: [
    toSource({ url: "https://en.ilmatieteenlaitos.fi/local-weather/espoo", title: "Espoo local weather | Finnish Meteorological Institute" }),
    toSource({ url: "https://www.yr.no/en/forecast/daily-table/2-660129/Finland/Uusimaa/Espoo/Espoo", title: "Espoo weather forecast | Yr" }),
  ],
};

export const weatherLoadingFixture: WeatherData = {
  kind: "weather",
  location: "Espoo, Finland",
  stage: "Reading the Finnish Meteorological Institute forecast",
  days: [],
  sources: [],
};
