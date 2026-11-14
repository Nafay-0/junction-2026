/* eslint-disable @typescript-eslint/no-explicit-any -- eval harness: checks read untyped JSON replies. */
/**
 * The partner's two menu scenarios as buyer-experience cases (server/agent/menu/scenarios.ts):
 *
 *   seasonal-menu-en/fi   "a chef plans a menu around a seasonal ingredient; the agent suggests recipes, works out what
 *                         is missing, and orders"
 *   event-tomorrow-en/fi  "an unexpected booking for tomorrow; the agent flags what cannot be sourced in time and proposes
 *                         substitutions through recipe logic"
 *
 * The wholesaler's side runs in `before`, against the same server, as an outside agent with a menu mandate Kaari signed
 * (REST /api/v1/menus: the same code the kitchen's own agent calls through server/agent/menu/thread.ts). Those checks
 * pass without the conversation. "The agent said it" reads the conversation and fails until the thread calls
 * seasonalForThread / eventForThread.
 */
import type { Check, Scenario } from "./scenarios";

type Json = any;
const ok = (cond: unknown, why: string): true | string => (cond ? true : why);

const facts: { seasonal?: Json; event?: Json; seasonalOrder?: Json; eventOrder?: Json; error?: string } = {};

/** A menu mandate for Kaari's own outside agent, signed with Kaari's key (the server trusts it), and one REST call. */
async function asOutsideAgent(url: string, path: string, body: Json): Promise<{ status: number; body: Json }> {
  const { loadLocalEnv } = await import("../../scripts/lib/env");
  loadLocalEnv();
  const { signMandate } = await import("@/core/mandate");
  const { demoKitchenKeyPair } = await import("@/server/demo-kitchen");
  const { resolveMenuKitchen } = await import("@/server/agent/menu/kitchens");
  const { getRuntime } = await import("@/server/runtime");
  // The same catalogue index as the server (the checkout's .data): the menu mandate allows every food category it has.
  const k = (await resolveMenuKitchen("kaari", await getRuntime()))!;
  const agentId = "agent_kaari_outside_eval";
  const token = await signMandate({ ...k.mandate, mandateId: `${k.mandate.mandateId}_eval`, agentId }, await demoKitchenKeyPair());
  const r = await fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "dock-agent-id": agentId }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function seasonalBefore(url: string, lang: string): Promise<void> {
  const text = lang === "fi" ? "Suunnittele lounas 40 annokselle perjantaiksi sesongin raaka-aineen ympärille. Meillä on voita." : "Plan a lunch for 40 on Friday around what is in season. I have butter.";
  const r = await asOutsideAgent(url, "/api/v1/menus/seasonal", { text, by: "Eval head chef" });
  facts.seasonal = r.body.result;
  if (r.status !== 200) facts.error = `seasonal ${r.status}: ${r.body?.error?.message ?? ""}`;
  if (facts.seasonal?.planId) facts.seasonalOrder = (await asOutsideAgent(url, `/api/v1/menus/${facts.seasonal.planId}/order`, { by: "Eval head chef" })).body;
}

async function eventBefore(url: string, lang: string): Promise<void> {
  const text = lang === "fi" ? "Yllättävä 40 hengen varaus tiistaiksi, kolmen ruokalajin illallinen." : "Unexpected booking for 40 on Tuesday, a three-course dinner.";
  const r = await asOutsideAgent(url, "/api/v1/menus/event", { text, by: "Eval head chef" });
  facts.event = r.body.result;
  if (r.status !== 200) facts.error = `event ${r.status}: ${r.body?.error?.message ?? ""}`;
  const ev = facts.event;
  if (ev?.planId && !ev.allLate) {
    const choices = (ev.cannotArrive ?? []).flatMap((x: Json) => (ev.options?.[x.lineId]?.[0] ? [{ lineId: x.lineId, optionId: ev.options[x.lineId][0].optionId }] : []));
    facts.eventOrder = (await asOutsideAgent(url, `/api/v1/menus/${ev.planId}/order`, { choices, by: "Eval head chef" })).body;
  }
}

// ---------- checks ----------

const anchored: Check = {
  name: "anchored on an ingredient in season now, from the calendar (with its source) and products the range really has",
  run: async (_o, c) => {
    const a = facts.seasonal?.anchor;
    if (!a) return `no anchor (${facts.error ?? "no result"})`;
    const month = Number(c.today.slice(5, 7));
    const known = await Promise.all(a.products.slice(0, 3).map((p: Json) => c.catalogue.product(p.productId)));
    return ok(a.months.includes(month) && a.source?.url && known.every(Boolean), `anchor ${a.kind} months ${a.months} source ${a.source?.url}; products known ${known.map(Boolean)}`);
  },
};
const dishesOnAnchor: Check = {
  name: "two or three dishes, at least two built on the seasonal ingredient",
  run: () => {
    const d = facts.seasonal?.dishes ?? [];
    return ok(d.length >= 2 && d.length <= 3 && d.filter((x: Json) => x.anchorLine).length >= 2, `dishes: ${d.map((x: Json) => `${x.name} [${x.anchorLine ?? "-"}]`).join("; ")}`);
  },
};
const missingOnly: Check = {
  name: "buys only what is missing: what the chef has is left off, every on-hand figure says where it came from",
  run: () => {
    const lines = facts.seasonal?.lines ?? [];
    const butter = lines.find((l: Json) => /butter|voi\b/i.test(l.ingredient));
    const labelled = lines.every((l: Json) => !l.onHand || ["said", "pantry", "bought"].includes(l.onHand.source));
    const estimatesSaySo = lines.filter((l: Json) => l.onHand?.source === "bought").every((l: Json) => l.onHand.estimate && /^estimate/.test(l.onHand.text));
    return ok((!butter || !butter.toBuy) && labelled && estimatesSaySo, `butter ${butter ? `to buy ${butter.toBuy}` : "not planned"}; labelled ${labelled}; estimates labelled ${estimatesSaySo}`);
  },
};
const smallestPack: Check = {
  name: "each line's pack covers the shortfall, and what is left over is said when the pack is far larger",
  run: () => {
    const lines = (facts.seasonal?.lines ?? []).filter((l: Json) => l.product);
    const bad = lines.filter((l: Json) => l.product.totalCents <= 0);
    return ok(lines.length >= 3 && !bad.length, `${lines.length} lines bought; bad ${bad.map((l: Json) => l.ingredient).join(", ")}`);
  },
};
const seasonalOrdered: Check = {
  name: "ordered through the gate (committed, or waiting for a named person)",
  run: () => ok(["committed", "pending_approval"].includes(facts.seasonalOrder?.order?.status), `order ${facts.seasonalOrder?.order?.status ?? facts.seasonalOrder?.error?.message ?? "none"}`),
};
const flagged: Check = {
  name: "says what cannot arrive by the day, with why (cut-off, stock, no delivery) and the earliest day where there is one",
  run: () => {
    const ev = facts.event;
    if (!ev) return `no result (${facts.error ?? ""})`;
    const stuck = ev.cannotArrive ?? [];
    const why = stuck.every((x: Json) => x.arrival?.why && x.arrival?.code);
    return ok(why && (stuck.length > 0 || (ev.lines ?? []).every((l: Json) => l.arrival === null || l.arrival.ok)), `${stuck.length} cannot arrive by ${ev.deliverBy}${ev.allLate ? ` (nothing can; earliest ${ev.allLate.earliest})` : ""}`);
  },
};
const byRole: Check = {
  name: "substitutes by the ingredient's role, verified, ranked best-better-good with trade-offs (or the day is the fix)",
  run: () => {
    const ev = facts.event;
    if (!ev) return "no result";
    if (ev.allLate) return ok(ev.allLate.earliest && Object.keys(ev.options ?? {}).length === 0, `nothing can arrive; earliest ${ev.allLate.earliest}`);
    const all = Object.values(ev.options ?? {}).flat() as Json[];
    const verified = all.every((o) => o.kind === "technique" || o.checks.every((c: Json) => c.product && c.arrival.ok && c.rules.ok));
    const ranked = Object.values(ev.options ?? {}).every((os: any) => os.every((o: Json, i: number) => o.rank === ["best", "better", "good"][i] && o.tradeoff?.taste));
    return ok(all.length > 0 && verified && ranked && (ev.cannotArrive ?? []).every((x: Json) => x.role), `${all.length} options; verified ${verified}; ranked ${ranked}`);
  },
};
const eventOrdered: Check = {
  name: "ordered through the gate with substitutes declared (or nothing ordered when nothing can come)",
  run: () => (facts.event?.allLate ? true : ok(["committed", "pending_approval"].includes(facts.eventOrder?.order?.status), `order ${facts.eventOrder?.order?.status ?? facts.eventOrder?.error?.message ?? "none"}`)),
};
const said = (what: () => string[]): Check => ({
  name: "the kitchen's agent said it in the conversation",
  run: (o) => {
    const words = what().map((w) => w.toLowerCase()).filter(Boolean);
    const text = [...o.answers.map((a) => a.text), ...o.notes, ...o.notices.map((n) => n.message)].join(" ").toLowerCase();
    return ok(words.length > 0 && words.some((w) => text.includes(w)), `said: ${text.slice(0, 160) || "nothing"}; looked for ${words.join(" | ")}`);
  },
});
const saidSeason = said(() => [facts.seasonal?.anchor?.label?.en, facts.seasonal?.anchor?.label?.fi].filter(Boolean));
/**
 * The conversation plans the booking itself (its own plan, not the one `before` made through REST, so the ingredients
 * can differ): it said what cannot arrive by the day and the stand-in, or that nothing can and the earliest day.
 */
const saidEvent: Check = {
  name: "the kitchen's agent said it in the conversation: what cannot arrive, and the stand-in (or the earliest day)",
  run: (o) => {
    const text = [...o.answers.map((a) => a.text), ...o.notes, ...o.notices.map((n) => n.message)].join(" ").toLowerCase();
    const cannot = /cannot arrive|can't arrive|can't come|ei ehdi|hinner inte|nothing for this menu/.test(text);
    const way = /instead of|tilalle|i stället|earliest|aikaisin|tidigast|everything can arrive|kaikki ehtii/.test(text);
    return ok(cannot && way, `said: ${text.slice(0, 200) || "nothing"}`);
  },
};

const WIRING = "The conversation says these once the thread calls server/agent/menu/thread.ts (seasonalForThread, eventForThread, scenarioAnswerOf, actOnScenario); until then 'the agent said it' fails and the other checks (run through REST /api/v1/menus, the same code) pass.";

export const MENU_SCENARIO_CASES: Scenario[] = [
  {
    id: "seasonal-menu-en",
    title: "A menu around what is in season, buying only what is missing",
    tag: "need → recipe → order (seasonal)",
    kitchen: "kaari",
    lang: "en",
    before: (url) => seasonalBefore(url, "en"),
    turns: [{ say: "Plan a lunch for 40 on Friday around what is in season. I have butter." }],
    goal: "answer",
    expect: [anchored, dishesOnAnchor, missingOnly, smallestPack, seasonalOrdered, saidSeason],
    limitation: WIRING,
  },
  {
    id: "seasonal-menu-fi",
    title: "Sesongin menu suomeksi: vain puuttuvat tilataan",
    tag: "need → recipe → order (seasonal)",
    kitchen: "kaari",
    lang: "fi",
    before: (url) => seasonalBefore(url, "fi"),
    turns: [{ say: "Suunnittele lounas 40 annokselle perjantaiksi sesongin raaka-aineen ympärille. Meillä on voita." }],
    goal: "answer",
    expect: [anchored, dishesOnAnchor, missingOnly, smallestPack, seasonalOrdered, saidSeason],
    limitation: WIRING,
  },
  {
    id: "event-tomorrow-en",
    title: "An unexpected booking for tomorrow: what cannot come, substitutes by recipe logic",
    tag: "last-minute event (recipe logic)",
    kitchen: "kaari",
    lang: "en",
    before: (url) => eventBefore(url, "en"),
    turns: [{ say: "Unexpected booking for 40 on Tuesday, a three-course dinner." }],
    goal: "answer",
    expect: [flagged, byRole, eventOrdered, saidEvent],
    limitation: WIRING,
  },
  {
    id: "event-tomorrow-fi",
    title: "Yllättävä varaus huomiseksi: mikä ei ehdi, korvaavat reseptin logiikalla",
    tag: "last-minute event (recipe logic)",
    kitchen: "kaari",
    lang: "fi",
    before: (url) => eventBefore(url, "fi"),
    turns: [{ say: "Yllättävä 40 hengen varaus tiistaiksi, kolmen ruokalajin illallinen." }],
    goal: "answer",
    expect: [flagged, byRole, eventOrdered, saidEvent],
    limitation: WIRING,
  },
];
