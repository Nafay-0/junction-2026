import { familyL } from "@/app/k/[kitchen]/family.text";
import { answerWatchMoment, markWatchSaid, watchAnswerOf, watchMomentForThread, type WatchMoment } from "@/server/watch/thread";
import { cardId } from "./cards";
import { codeLeaks, readable } from "./refusal";
import { byLine, record, step, type TurnRun } from "./pipeline";
import type { WatchCard } from "./types";

/**
 * The wholesaler's watch over the kitchen's key products, in the conversation (server/watch): at most one moment (a
 * stock-out with its closest substitute, a standing order held because it drifted, or a report of what was renewed),
 * said on the day's opening or when the buyer asks about this week's orders, never in the middle of another request.
 * The adapter's sentences carry full catalogue names; here they are said with the kitchen's short names ("your Monday
 * lactose-free milk", "Valio Arki Eila"), under 60 words, the other substitutes behind the steps.
 */

type Lang = "en" | "fi" | "sv";
const LANGS: Lang[] = ["en", "fi", "sv"];

/** A catalogue name as people say it: the brand and the line, no marks, no pack size ("Valio Arki Eila"). */
export function shortName(name: string): string {
  const words = name.replace(/[®™©]/g, "").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (/\d/.test(w) || /^(x|l|kg|g|ml|dl|cl)$/i.test(w) || out.length >= 4) break;
    // Marketing words a chef does not say ("Peltolan hand made churned butter" is the Peltolan churned butter).
    if (/^(hand|made|handmade|käsintehty|gourmet)$/i.test(w) && out.length) continue;
    out.push(w);
  }
  return out.join(" ") || name;
}

/** The product the kitchen orders, as it calls it: "lactose-free milk", "laktoositon maito". */
function kitchenName(product: { name: string; family: string }, lang: Lang): string {
  const lf = /lactose[ -]free|laktoositon|laktosfri/i.test(product.name);
  const fam = familyL(product.family, lang).toLowerCase();
  // A family with no word of its own (a partner category, "cat 17403"): the product's short name, as people write it.
  if (!fam || /^cat[ _]?\d/.test(fam) || codeLeaks(fam).length) return readable(shortName(product.name), lang);
  return lf ? `${lang === "fi" ? "laktoositon" : lang === "sv" ? "laktosfri" : "lactose-free"} ${fam}` : fam;
}

/** The moment's sentence with the short names in place of the catalogue's, and the staged note kept short. */
async function shorten(run: TurnRun, m: WatchMoment, lang: Lang): Promise<string> {
  const f = (m.facts.finding ?? m.facts.renewal) as { product: { productId: string; name: string; family?: string }; substitutes?: { productId: string; name: string }[]; outcome?: { substitute?: { productId: string; name: string } } } | undefined;
  let say = m.say;
  if (f) {
    // Every product the moment can name: its own substitutes, and those of an open stock-out of the same product.
    const { watchForOrg } = await import("@/server/watch/service");
    const w = await watchForOrg(run.rt, run.session.mandate.issuer.orgId).catch(() => undefined);
    const related = (w?.findings ?? []).filter((x) => x.product.productId === f.product.productId).flatMap((x) => x.substitutes.slice(0, 3));
    const subs = [...(f.substitutes ?? []), ...(f.outcome?.substitute ? [f.outcome.substitute] : []), ...related];
    const ids = [f.product.productId, ...subs.map((s) => s.productId)];
    const ps = await run.rt.catalog.searchProducts({ ids, limit: 10 }).catch(() => []);
    const namesOf = (id: string, fallback: string) => {
      const p = ps.find((x) => x.id === id) as { name: string; names?: Partial<Record<Lang, string>> } | undefined;
      return [...new Set([p?.names?.[lang], p?.names?.en, p?.name, fallback].filter((x): x is string => !!x))].sort((a, b) => b.length - a.length);
    };
    const family = f.product.family ?? (ps.find((x) => x.id === f.product.productId)?.category as string | undefined) ?? "";
    const own = (ps.find((x) => x.id === f.product.productId) as { names?: Partial<Record<Lang, string>> } | undefined)?.names?.[lang] ?? f.product.name;
    for (const n of namesOf(f.product.productId, f.product.name)) say = say.split(n).join(family ? kitchenName({ name: own, family }, lang) : shortName(n));
    for (const s of subs) for (const n of namesOf(s.productId, s.name)) say = say.split(n).join(shortName(n));
  }
  // A short name can now open the sentence ("voi ei voinut tulla"): its first letter in capitals.
  say = say.charAt(0).toUpperCase() + say.slice(1);
  return say
    .replace(/\(This is a staged stock-out for the demo\.\)|\(This trend is staged for the demo\.\)/g, "(staged for the demo)")
    .replace(/\((Tämä|Detta)[^)]*(demo|demoa|demon)[^)]*\)/gi, (x) => (/^\(Tämä/.test(x) ? "(lavastettu demoa varten)" : "(iscensatt för demon)"));
}

/** The open watch moment said in this thread (newest), if any. */
export function openWatch(run: TurnRun): WatchCard | undefined {
  const c = run.store.cards(run.thread).map((x) => x.card).filter((x): x is WatchCard => x.type === "watch").at(-1);
  return c?.state === "open" ? c : undefined;
}

/**
 * The watch's moment as a card in this turn, when there is one: said on the opening, or because the buyer asked.
 * `family`: only a moment about this product family (a direct request for a product the watch knows cannot come).
 */
export async function sayWatch(run: TurnRun, opts: { asked?: boolean; family?: string } = {}): Promise<WatchCard | undefined> {
  const open = openWatch(run);
  const asked = !!(opts.asked || opts.family);
  if (open && !asked) return undefined;
  const st = step(run, "watch", "Checked the week's key products");
  try {
    const moments = await Promise.all(LANGS.map((l) => watchMomentForThread(run.rt, run.session, l, { asked: !!(opts.asked || opts.family) })));
    const en = moments[0];
    // Asked again about the moment already on the table: the same card.
    if (open && (!en || en.id === open.momentId)) {
      st.done("said above");
      return open;
    }
    if (!en) {
      st.done("nothing to say");
      return undefined;
    }
    const fam = ((en.facts.finding ?? en.facts.renewal) as { product?: { family?: string } } | undefined)?.product?.family;
    if (opts.family && fam && fam !== opts.family) {
      st.done("nothing about this product");
      return undefined;
    }
    const text = {} as WatchCard["text"];
    for (const [i, l] of LANGS.entries()) {
      const m = moments[i] ?? en;
      text[l] = { say: readable(await shorten(run, m, l), l), ...(m.ask ? { ask: readable(m.ask, l) } : {}) };
    }
    const subs = ((en.facts.finding as { substitutes?: { name: string; why?: string }[] } | undefined)?.substitutes ?? []).map((s) => shortName(s.name));
    const card: WatchCard = {
      type: "watch",
      cardId: cardId("watch", `${run.turnId}:${en.id}`),
      momentId: en.id,
      kind: en.kind,
      text,
      steps: en.steps,
      ...(en.proof ? { proof: { token: en.proof.token, keysUrl: en.proof.keysUrl, simulated: en.proof.simulated } } : {}),
      answers: en.answers,
      ...(subs.length > 1 ? { others: subs.slice(1, 4) } : {}),
      staged: en.staged,
      ...(fam ? { family: fam } : {}),
      state: en.ask ? "open" : "reported",
    };
    run.store.card(run.thread, run.turnId, card);
    run.facts.push(card, en.facts);
    await markWatchSaid(run.rt, en.id);
    st.done(en.kind.replace("_", " "));
    record(run, "watch_said", `The watch's ${en.kind.replace("_", " ")} ${en.id} was said in the conversation${opts.asked ? ", as asked" : opts.family ? ", answering a request for the product" : ""}.`, { momentId: en.id, kind: en.kind });
    return card;
  } catch (err) {
    st.fail();
    console.error("[thread] watch", err);
    return undefined;
  }
}

/** The buyer's words as an answer to the open moment (plain code, server/watch/thread.ts watchAnswerOf). */
export function watchAnswerIn(card: WatchCard, words: string): string | undefined {
  return watchAnswerOf({ kind: card.kind, answers: card.answers }, words);
}

/** Act on the answer (through the gate) and return the agent's line. */
export async function answerWatchIn(run: TurnRun, card: WatchCard, answer: string, words: string | undefined, lang: Lang): Promise<string> {
  const r = await answerWatchMoment(run.rt, run.session, card.momentId, answer, { by: byLine(run), via: words ? `${run.door}: "${words.slice(0, 120)}"` : run.door, signedIn: !!run.person, lang });
  if (r.order) {
    run.orders.set(r.order.orderId, r.order);
    run.facts.push(r.order);
    const { gateCard, orderCard } = await import("./cards");
    run.store.card(run.thread, run.turnId, gateCard(r.order));
    run.store.card(run.thread, run.turnId, orderCard(r.order, []));
  }
  run.store.card(run.thread, run.turnId, { ...card, state: "answered", reply: r.reply });
  record(run, "watch_answer", `The buyer answered the watch's ${card.kind.replace("_", " ")} ${card.momentId}: ${answer}${words ? ` ("${words.slice(0, 80)}")` : ""}.`, { momentId: card.momentId, answer, ...(r.order ? { orderId: r.order.orderId } : {}) });
  return r.reply;
}

/**
 * "Switch auto-renew on for the weekly milk order" (or off): the kitchen's own choice for one of its recurring orders,
 * recorded with who said it (server/watch). Returns the agent's line, or undefined when the words are not about it.
 */
export async function autoRenewFromWords(run: TurnRun, words: string): Promise<string | undefined> {
  const { autoRenewIntentOf, setAutoRenewFromThread } = await import("@/server/watch/thread");
  // A question ("is the milk going to renew by itself this week?") is answered with what is set, never set again.
  const asking = /\?\s*$/.test(words.trim()) || /^(is|will|does|do|are|has|have|onko|uusiutuuko|tuleeko|kommer|är|förnyas)\b/i.test(words.trim());
  const intent = asking ? undefined : autoRenewIntentOf(words);
  if (asking && /renew|uusi|förny|automatic|automaatti|automatisk/i.test(words)) return autoRenewStatus(run, words);
  if (!intent) return undefined;
  const { standing } = await import("@/server/kitchen-portal");
  const profile = await run.rt.kitchens.getProfile(run.session.mandate.issuer.orgId).catch(() => undefined);
  const rows = standing(profile, new Date().toISOString().slice(0, 10));
  const lang = run.lang ?? "en";
  const w = words.toLowerCase();
  const row = rows.find((r) => [r.family, familyL(r.family, "en"), familyL(r.family, "fi"), familyL(r.family, "sv")].some((x) => x && w.includes(x.toLowerCase()))) ?? (rows.length === 1 ? rows[0] : undefined);
  if (!row) {
    const names = rows.map((r) => familyL(r.family, lang).toLowerCase());
    return { en: `Which recurring order: ${names.join(" or ")}?`, fi: `Mikä vakiotilaus: ${names.join(" vai ")}?`, sv: `Vilken stående beställning: ${names.join(" eller ")}?` }[lang];
  }
  // Switching auto-renew ON widens what the agent may do (it orders without asking each time): never from words in
  // the chat, whoever types them. Switching it off narrows and is done at once.
  if (intent === "on") {
    const signer = run.session.mandate.approvers[0]?.name ?? (lang === "fi" ? "hyväksyjä" : lang === "sv" ? "den som signerar" : "the signer");
    const what = familyL(row.family, lang).toLowerCase();
    record(run, "auto_renew_refused", `Auto-renew on for ${row.family} was asked in the chat and not switched on: it widens what the agent may do and needs ${signer}'s sign-off.`, { family: row.family });
    return {
      en: `Renewing the ${what} by itself would let me order it without asking each time, so it needs ${signer}'s OK; I haven't switched it on. Until then I'll remind you before each order.`,
      fi: `Automaattinen uusinta (${what}) antaisi minun tilata kysymättä joka kerta, joten se tarvitsee hyväksynnän: ${signer}. En laittanut sitä päälle; siihen asti muistutan ennen jokaista tilausta.`,
      sv: `Att förnya ${what} automatiskt skulle låta mig beställa utan att fråga varje gång, så det behöver ${signer}s godkännande; jag har inte slagit på det. Tills dess påminner jag före varje beställning.`,
    }[lang];
  }
  // A person's name, never a username or an id in a sentence ("Hotel Lumo kitchen (hotel-lumo)" says "Hotel Lumo kitchen").
  const who = (run.person?.name ?? run.k.info.name).replace(/\s*\([^)]*\)/g, "").trim();
  const r = await setAutoRenewFromThread(run.rt, run.session, row.family, false, { by: who, via: `${run.door}: ${byLine(run)}`, lang, what: familyL(row.family, lang).toLowerCase() });
  record(run, "auto_renew", `Auto-renew ${intent} for ${row.family}, in the buyer's words "${words.slice(0, 80)}".`, { family: row.family, on: false });
  return r.reply;
}

/** "Is the milk going to renew by itself this week?": what is set for each recurring order, and what happens next. */
async function autoRenewStatus(run: TurnRun, words: string): Promise<string | undefined> {
  const { standingFor } = await import("@/server/watch/service");
  const rows = await standingFor(run.rt, run.session.mandate.issuer.orgId).catch(() => []);
  if (!rows.length) return undefined;
  const lang = run.lang ?? "en";
  const w = words.toLowerCase();
  const named = rows.filter((r) => [r.family, familyL(r.family, "en"), familyL(r.family, "fi"), familyL(r.family, "sv")].some((x) => x && w.includes(x.toLowerCase())));
  const pick = named.length ? named : rows;
  const { dayWords } = await import("./refusal");
  return pick
    .slice(0, 2)
    .map((r) => {
      const what = familyL(r.family, lang).toLowerCase();
      const day = r.next ? dayWords(r.next.date, lang) : "";
      if (lang === "fi") return r.autoRenew.on ? `Kyllä: ${what} uusitaan automaattisesti${day ? ` (${day})` : ""}, ellei mikään ole muuttunut; muutoksesta kysyn ensin.` : `Ei: ${what} ei uusiudu automaattisesti; muistutan sinua. Laitanko automaattisen uusinnan päälle?`;
      if (lang === "sv") return r.autoRenew.on ? `Ja: ${what} förnyas automatiskt${day ? ` (${day})` : ""} om inget har ändrats; har något ändrats frågar jag först.` : `Nej: ${what} förnyas inte automatiskt; jag påminner dig. Ska jag slå på automatisk förnyelse?`;
      return r.autoRenew.on ? `Yes: the ${what} renews by itself${day ? ` for ${day}` : ""} if nothing has changed; if something has, I ask you first.` : `No: the ${what} doesn't renew by itself; I remind you. Shall I switch auto-renew on?`;
    })
    .join(" ");
}
