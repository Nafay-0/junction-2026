import "server-only";

import { exaAgentRun, type ExaGrounding } from "@/lib/exa/client";
import { toSource, type Source } from "@/lib/widgets/types";
import type { ToolContext } from "./context";

/**
 * Ask the Exa Agent for structured, cited data, optionally through an Exa Connect data
 * partner (live flight and hotel prices from Jinko, for example). Takes 15 to 30 seconds,
 * so callers show a loading stage while it runs.
 */
export async function runStructured<T>(
  ctx: ToolContext,
  args: {
    query: string;
    schema: Record<string, unknown>;
    providers?: string[];
    effort?: "minimal" | "low" | "medium";
    /** Give up after this long. Live hotel inventory can take close to a minute. */
    deadlineMs?: number;
  },
  signal?: AbortSignal,
): Promise<{ data: T; sources: Source[]; costUsd: number }> {
  const run = await exaAgentRun(
    {
      query: args.query,
      effort: args.effort ?? "low",
      outputSchema: args.schema,
      systemPrompt: `Today is ${ctx.today}. Answer in English. Use live data and return only what the sources support; leave a field out rather than guess.`,
      dataSources: args.providers?.map((provider) => ({ provider })),
    },
    { meter: ctx.meter, signal, deadlineMs: args.deadlineMs },
  );
  const data = run.output?.structured as T | undefined;
  if (data === undefined || data === null) throw new Error("The lookup returned no structured data.");
  return { data, sources: sourcesFromGrounding(run.output?.grounding), costUsd: run.costDollars?.total ?? 0 };
}

export function sourcesFromGrounding(grounding: ExaGrounding[] | undefined): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const g of grounding ?? []) {
    for (const c of g.citations ?? []) {
      if (!c.url || seen.has(c.url)) continue;
      seen.add(c.url);
      out.push(toSource({ url: c.url, title: c.title }));
    }
  }
  return out;
}

/**
 * Yield a loading payload every few seconds while a slow lookup runs, then return its result.
 * Each yielded payload replaces the previous one in the UI.
 */
export async function* whileWaiting<T, P>(work: Promise<T>, loading: (elapsedSeconds: number) => P, everyMs = 3500): AsyncGenerator<P, T> {
  const started = Date.now();
  let settled = false;
  const guarded = work.finally(() => {
    settled = true;
  });
  // Avoid an unhandled rejection while we are between awaits.
  guarded.catch(() => {});
  yield loading(0);
  while (!settled) {
    await Promise.race([guarded.catch(() => {}), new Promise((r) => setTimeout(r, everyMs))]);
    if (!settled) yield loading(Math.round((Date.now() - started) / 1000));
  }
  return guarded;
}

export function slug(...parts: Array<string | number | undefined>): string {
  return parts
    .filter((p) => p !== undefined && p !== "")
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
