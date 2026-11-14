import tzlookup from "tz-lookup";
import type { Place } from "@/lib/widgets/types";

/*
 * Is a place open right now? Exa's place records carry opening hours as text per weekday
 * ("11 AM–9 PM", "3–10 PM", "Open 24 hours", "Closed") and a status that only says whether the
 * business still exists. This works out the current moment in the place's own time zone (looked
 * up from its coordinates, so a search for London from Helsinki is still right) and checks it
 * against today's hours.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Range = { start: number; end: number };

/** Minutes since midnight for "9", "9:30", with the meridiem applied. */
function toMinutes(hour: number, minute: number, meridiem: "AM" | "PM" | undefined): number {
  let h = hour;
  if (meridiem === "AM" && h === 12) h = 0;
  else if (meridiem === "PM" && h !== 12) h += 12;
  return h * 60 + minute;
}

/**
 * Parse one day's hours. Returns "always" for 24 hours, an empty list for closed, and null
 * when the text is not understood (so the caller says nothing rather than something wrong).
 */
export function parseHours(text: string): Range[] | "always" | null {
  const clean = text.replace(/[  ]/g, " ").trim();
  if (!clean) return null;
  if (/24\s*hours/i.test(clean)) return "always";
  if (/^closed/i.test(clean)) return [];
  const ranges: Range[] = [];
  for (const piece of clean.split(/[,;]|\band\b/i)) {
    const m = piece.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*(?:–|—|-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!m) return null;
    const endMer = m[6]?.toUpperCase() as "AM" | "PM" | undefined;
    let startMer = m[3]?.toUpperCase() as "AM" | "PM" | undefined;
    // 24-hour clock ("11:00–21:00") has no meridiem at all.
    const end = toMinutes(Number(m[4]), Number(m[5] ?? 0), endMer);
    let start = toMinutes(Number(m[1]), Number(m[2] ?? 0), startMer ?? endMer);
    if (!startMer && endMer && start >= end) {
      // "11–2 PM" means 11 AM to 2 PM: the start takes the other half of the day.
      startMer = endMer === "PM" ? "AM" : "PM";
      start = toMinutes(Number(m[1]), Number(m[2] ?? 0), startMer);
    }
    ranges.push({ start, end });
  }
  return ranges;
}

function clock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h24 < 12 ? "AM" : "PM"}`;
}

/** The weekday and the minutes since midnight at these coordinates, right now. */
function localNow(lat: number, lng: number, at: Date): { day: number; minutes: number } | null {
  try {
    const timeZone = tzlookup(lat, lng);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const day = DAYS.indexOf(get("weekday"));
    if (day < 0) return null;
    return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
  } catch {
    return null;
  }
}

/**
 * A short status for a place at this moment: "Open until 9 PM", "Closed now", "Opens 11 AM",
 * or the record's own status when it says the place has shut down. Undefined when unknown.
 */
export function liveStatus(place: Pick<Place, "lat" | "lng" | "hours" | "status">, at: Date = new Date()): string | undefined {
  const recorded = place.status?.toLowerCase() ?? "";
  if (recorded && recorded !== "open" && recorded !== "operational") return place.status;
  if (!place.hours?.length) return undefined;
  const now = localNow(place.lat, place.lng, at);
  if (!now) return undefined;

  const hoursFor = (day: number) => {
    const entry = place.hours!.find((h) => h.day.toLowerCase().startsWith(DAYS[day].toLowerCase().slice(0, 3)));
    return entry ? parseHours(entry.hours) : null;
  };
  const today = hoursFor(now.day);
  if (today === null) return undefined;
  if (today === "always") return "Open 24 hours";

  // Yesterday's hours can run past midnight ("6 PM–2 AM").
  const yesterday = hoursFor((now.day + 6) % 7);
  if (Array.isArray(yesterday)) {
    const late = yesterday.find((r) => r.end <= r.start && now.minutes < r.end);
    if (late) return `Open until ${clock(late.end)}`;
  }
  for (const r of today) {
    const overnight = r.end <= r.start;
    if (now.minutes >= r.start && (overnight || now.minutes < r.end)) return `Open until ${clock(r.end)}`;
  }
  const next = today.filter((r) => r.start > now.minutes).sort((a, b) => a.start - b.start)[0];
  return next ? `Closed now, opens ${clock(next.start)}` : "Closed now";
}
