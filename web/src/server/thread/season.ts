import { addDaysIso, localNow } from "@/core/kitchen";
import { inSeason, langOf, seasonText, type Lang, type SeasonItem } from "@/server/agent/menu/season";
import { cardId } from "./cards";
import { record, step, type TurnRun } from "./pipeline";
import type { RecordsCard } from "./types";

/**
 * "What is in season next week?": the season calendar (server/agent/menu/season.ts) for the days asked, each item
 * with a product of the wholesaler's that the kitchen's menu may buy (master data only, no live call), as a records
 * card. Plain code; the model only asks for it and points at the card.
 */

const WORDS: Record<Lang, { inSeason: (span: string) => string; outside: string }> = {
  en: { inSeason: (s) => `in season ${s}`, outside: "outside what your rules let the agent buy" },
  fi: { inSeason: (s) => `sesongissa ${s}`, outside: "sääntösi eivät salli agentin ostaa tätä" },
  sv: { inSeason: (s) => `i säsong ${s}`, outside: "dina regler låter inte agenten köpa detta" },
};

/** The categories the kitchen's menu may buy (its menu mandate: food of every kind), else the store's own. */
async function allowedCategories(run: TurnRun): Promise<string[]> {
  try {
    const { menuKitchen } = await import("@/server/agent/menu/runtime");
    const { kitchen } = await menuKitchen(run.k.info.slug);
    if (kitchen) return kitchen.mandate.allowedCategories;
  } catch {
    // no menu planner for this kitchen: the store's mandate
  }
  return run.session.mandate.allowedCategories;
}

export async function seasonCard(run: TurnRun, words: string, from?: string, to?: string): Promise<RecordsCard> {
  const st = step(run, "records", "Looking at what is in season");
  const lang = langOf(words);
  const today = localNow(new Date()).date;
  const a = from ?? addDaysIso(today, 1);
  const b = to ?? addDaysIso(a, 6);
  const seen = new Map<string, SeasonItem>();
  for (const d of [a, b]) for (const x of inSeason(d)) seen.set(x.key, x);
  const allowed = new Set(await allowedCategories(run));
  const rows: RecordsCard["rows"] = [];
  for (const item of [...seen.values()].slice(0, 12)) {
    const found = await run.rt.catalog.searchProducts({ text: item.search[0], limit: 6 }).catch(() => []);
    const p = found.find((x) => allowed.has(x.category)) ?? found[0];
    if (!p) continue;
    const w = WORDS[lang];
    rows.push({ kind: "product", label: `${item.names[lang]}: ${p.names?.[lang] ?? p.name}`, detail: allowed.has(p.category) ? w.inSeason(seasonText(item, lang)) : `${w.inSeason(seasonText(item, lang))}; ${w.outside}`, ref: p.id });
    if (rows.length >= 8) break;
  }
  st.done(`${rows.length}`);
  const card: RecordsCard = { type: "records", cardId: cardId("records", `${run.turnId}:season`), question: words.slice(0, 200), rows };
  run.store.card(run.thread, run.turnId, card);
  run.facts.push(card);
  record(run, "season", `In season ${a}..${b} (Finland): ${[...seen.values()].map((x) => x.key).join(", ")}; ${rows.length} with a product in the catalogue.`, { from: a, to: b, items: [...seen.keys()], products: rows.map((r) => r.ref) });
  return card;
}
