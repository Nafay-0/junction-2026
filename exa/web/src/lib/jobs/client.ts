"use client";

import { api, errorOf } from "@/lib/auth/fetch";
import { USAGE_CAP_CODE, USAGE_CAP_SENTENCE } from "@/lib/usage-cap";
import { markCapReached } from "@/lib/usage-cap-client";
import type { JobDetail, JobItem, JobList, JobRunDetail } from "./types";

/*
 * The Jobs page's side of /api/jobs. Jobs are made in a chat; here they are read, renamed,
 * paused, deleted and run once by hand. Nothing throws: every call answers with what came back
 * or with a sentence that says what went wrong.
 */

export type Answer<T> = { ok: true; value: T } | { ok: false; problem: string; gone?: boolean };

const OFFLINE = "The server could not be reached. Check your connection and try again.";

async function ask<T>(path: string, init: Parameters<typeof api>[1], read: (body: unknown) => T): Promise<Answer<T>> {
  try {
    const response = await api(path, init);
    if (response.ok) return { ok: true, value: read(await response.json()) };
    if (response.status === 402) {
      // The usage limit: the rest of the app learns of it too.
      const body = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
      if (body.code === USAGE_CAP_CODE) markCapReached();
      return { ok: false, problem: body.error ?? USAGE_CAP_SENTENCE };
    }
    return { ok: false, problem: await errorOf(response), gone: response.status === 404 };
  } catch {
    return { ok: false, problem: OFFLINE };
  }
}

/** Every job of the signed-in account, newest first. */
export const fetchJobs = () => ask("/api/jobs", { cache: "no-store" }, (body) => (body as JobList).jobs);

/** One job with its runs, newest first. */
export const fetchJob = (id: string) => ask(`/api/jobs/${encodeURIComponent(id)}`, { cache: "no-store" }, (body) => body as JobDetail);

/** Rename a job, change what it is for or what it is told to do, or pause and resume it. */
export const changeJob = (id: string, change: { title?: string; description?: string; prompt?: string; status?: "active" | "paused" }) =>
  ask(`/api/jobs/${encodeURIComponent(id)}`, { method: "PATCH", json: change }, (body) => (body as { job: JobItem }).job);

/** Delete a job and its runs. */
export const removeJob = (id: string) => ask(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }, () => true as const);

/** "Run now": start one run right away. Answers with the new run's id as soon as it has started. */
export const runJobNow = (id: string) => ask(`/api/jobs/${encodeURIComponent(id)}/run`, { method: "POST" }, (body) => (body as { runId: string }).runId);

/** One run in full. */
export const fetchRun = (runId: string) => ask(`/api/jobs/runs/${encodeURIComponent(runId)}`, { cache: "no-store" }, (body) => body as JobRunDetail);

/* ───────── Saying times ─────────
 * A job's times are said in the job's own time zone: "every weekday at 08:00" was meant there,
 * wherever the page is opened. */

/** "Mon 16 Nov, 08:00" in the given time zone; the year is added when it is not this one. */
export function sayWhen(ts: number, timeZone: string): string {
  const date = new Date(ts);
  const zone = safeZone(timeZone);
  const year = (d: Date) => new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: zone }).format(d);
  const text = date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: zone });
  return year(date) === year(new Date()) ? text : text.replace(",", ` ${year(date)},`);
}

/** The time zone this browser is in. */
export const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** "Helsinki time" for "Europe/Helsinki": how to name a zone in passing. */
export function zoneName(timeZone: string): string {
  if (timeZone === "UTC" || timeZone === "Etc/UTC") return "UTC";
  const city = timeZone.split("/").pop() ?? timeZone;
  return `${city.replace(/_/g, " ")} time`;
}

/** True when the job's clock is not the one on this device, so times need the zone said with them. */
export const elsewhere = (timeZone: string): boolean => {
  if (timeZone === browserZone()) return false;
  // Two names for the same clock right now (Europe/Helsinki and Europe/Kyiv, say) need no remark.
  const at = (zone: string) => new Date().toLocaleString("en-GB", { timeZone: safeZone(zone), hour: "2-digit", minute: "2-digit", day: "numeric" });
  return at(timeZone) !== at(browserZone());
};

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(ts: number, now = Date.now()): string {
  const minutes = Math.round((now - ts) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** How long something took: "8 s", "1 min 20 s". */
export function took(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** Dollars for a run: "$0.012", "$0.34", "$1.20". */
export function usd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n < 0.1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}
