import type { Lang } from "@/app/_i18n/lang";
import { money } from "@/app/_ui/plain";
import type { Product } from "@/core/catalog";
import { DockError } from "@/core/errors";
import type { AgentSession } from "@/core/orders";
import { yesOrNo } from "../channels/speech";
import type { Runtime } from "../runtime";
import { BACKUP_SAY_TEXT } from "./say.text";
import { declineBackup, markBackupSaid, offerBackups, setBackup, type Backup, type OrderLine, type Who } from "./service";

/**
 * A backup "in case this is not delivered", as the kitchen's own conversation uses it: data and actions, no card.
 *
 *   backupMomentForThread(rt, session, { orderId } | { requestId, lines }, lang)
 *        at order time (a quote shown, an order placed, a menu's sheet, an offer accepted, a recurring order):
 *        undefined when no product on it has a poor delivery record; else ONE moment for the worst product:
 *        { id, say, ask, answers, others, steps, facts }   ("One thing: the X has arrived as ordered about 7 times
 *        in 10. Want a backup lined up in case it doesn't come? The Y is the closest, 0,40 € more per kilo.")
 *        `others`: the other poor-record products and every alternative, for "Show the list"
 *   backupAnswerOf(moment, words)       "yes" (the closest) | "pick:<productId>" (that one / the second / the third)
 *                                       | "you_choose" | "no" | undefined
 *   answerBackup(rt, session, id, answer, { by, via, lang })   records it (nothing is bought) and returns the reply
 *
 * When the product later cannot come, the watch orders the backup by itself (server/reliability/service.ts
 * useBackup) and the watch's moment reports it in one sentence (server/watch/thread.ts, kind substitute_placed,
 * facts.backup = true).
 */

export type BackupMoment = {
  id: string;
  say: string;
  ask: string;
  /** "yes", "pick:<productId>" for each alternative, "you_choose", "no". */
  answers: string[];
  /** The other products with a poor record on this order, and the alternatives, for the list behind the sentence. */
  others: { productId: string; name: string; words: string; backupId: string }[];
  alternatives: { rank: string; productId: string; name: string; why: string; record?: string; insidePreferences: boolean; gate?: string }[];
  steps: string[];
  facts: Record<string, unknown>;
};

const nameIn = (p: Product | undefined, fallback: string, lang: Lang) => p?.names?.[lang] ?? p?.name ?? fallback;

/** One moment for the order's worst product, or undefined. Each poor product is recorded as offered (ledger). */
export async function backupMomentForThread(rt: Runtime, session: AgentSession, ref: { orderId: string } | { requestId: string; lines: OrderLine[] }, lang: Lang = "en"): Promise<BackupMoment | undefined> {
  let input: { requestId?: string; orderId?: string; lines: OrderLine[] };
  if ("orderId" in ref) {
    const o = await rt.dock.getOrder(session, ref.orderId);
    input = { orderId: o.orderId, requestId: o.requestId, lines: o.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceCents: l.unitPriceCents, deliveryDate: l.deliveryDate })) };
  } else input = ref;
  const backups = (await offerBackups(rt, session, input)).filter((b) => b.state === "offered" && !b.saidAt);
  const b = backups[0];
  if (!b) return undefined;
  const t = BACKUP_SAY_TEXT[lang];
  const ps = new Map((await rt.catalog.searchProducts({ ids: [b.product.productId, ...b.alternatives.map((a) => a.productId)], limit: 10 })).map((p) => [p.id, p]));
  const what = nameIn(ps.get(b.product.productId), b.product.name, lang);
  const best = b.alternatives[0];
  let diff = "";
  if (best?.tradeOff.perUnitDiffCents !== null && best?.tradeOff.perUnitDiffCents !== undefined) {
    const u = best.tradeOff.unit === "kg" ? t.kilo : t.litre;
    const d = Math.round(best.tradeOff.perUnitDiffCents);
    diff = d === 0 ? t.same(u) : (d > 0 ? t.more : t.less)(money(Math.abs(d)), u);
  }
  const bestName = best ? nameIn(ps.get(best.productId), best.name, lang) : undefined;
  return {
    id: b.backupId,
    // "One thing: the X has arrived as ordered about 7 times in 10." + "Want a backup lined up in case it doesn't come? The Y is the closest, 0,40 € more per kilo."
    say: [t.record(what, b.record.n, b.record.of), backups.length > 1 ? t.others(backups.length - 1) : "", bestName ? "" : t.noneCloser].filter(Boolean).join(" "),
    ask: bestName ? `${t.want} ${t.closest(bestName, diff)}` : "",
    answers: best ? ["yes", ...b.alternatives.map((a) => `pick:${a.productId}`), "you_choose", "no"] : ["no"],
    others: backups.slice(1).map((x) => ({ productId: x.product.productId, name: x.product.name, words: x.record.words, backupId: x.backupId })),
    alternatives: b.alternatives.map((a) => ({ rank: a.rank, productId: a.productId, name: a.name, why: a.why, ...(a.record ? { record: a.record.words } : {}), insidePreferences: a.insidePreferences, ...(a.gate ? { gate: a.gate.outcome } : {}) })),
    steps: [
      `${b.product.name} ${b.record.words} (the wholesaler's delivery history, ${Math.round(b.record.share * 100)} %; flagged below ${Math.round((Number(process.env.DOCK_RELIABILITY_WARN) || 0.9) * 100)} %). History, not a forecast.`,
      ...b.alternatives.map((a) => `${a.rank}: ${a.name}: ${a.why}; ${a.record ? a.record.words : "no delivery figure"}; ${a.insidePreferences ? "inside the kitchen's preferences" : `needs a person: ${a.outside.join("; ")}`}${a.gate ? `; the gate's preview: ${a.gate.outcome}` : ""}.`),
      "Lining one up buys nothing now. If the product cannot come, the agent orders the backup through the gate by itself (alone within the mandate and the kitchen's preferences, otherwise for sign-off) and says so in one sentence.",
    ],
    facts: { backup: b },
  };
}

const SECOND = /\b(second|other one|toinen|toista|andra)\b/iu;
const THIRD = /\b(third|kolmas|kolmatta|tredje)\b/iu;
const THAT = /\b(that one|that|the closest|closest|first|se|sitä|ensimmäinen|lähin|den|första|närmaste)\b/iu;
const YOU_CHOOSE = /(you choose|you pick|your choice|up to you|whichever|valitse sinä|valitse itse|sinä päätät|välj du|du väljer)/iu;

/** The buyer's words as an answer: yes (the closest), the one named by its place, "you choose", or no. */
export function backupAnswerOf(m: Pick<BackupMoment, "answers">, words: string): string | undefined {
  const w = words.trim();
  if (!w) return undefined;
  const picks = m.answers.filter((a) => a.startsWith("pick:"));
  if (YOU_CHOOSE.test(w)) return "you_choose";
  if (THIRD.test(w) && picks[2]) return picks[2];
  if (SECOND.test(w) && picks[1]) return picks[1];
  const yn = yesOrNo(w);
  if (yn === "no") return "no";
  if (yn === "yes") return m.answers.includes("yes") ? "yes" : undefined;
  if (THAT.test(w) && picks[0]) return picks[0];
  return undefined;
}

/** Record the answer (nothing is bought now) and return the agent's line back. */
export async function answerBackup(rt: Runtime, session: AgentSession, id: string, answer: string, who: Who & { lang?: Lang }): Promise<{ reply: string; backup?: Backup }> {
  const t = BACKUP_SAY_TEXT[who.lang ?? "en"];
  const signer = session.mandate.approvers[0]?.name ?? "a person";
  await markBackupSaid(rt, id);
  if (answer === "no") {
    const b = await declineBackup(rt, session, id, who);
    return { reply: t.declined, backup: b };
  }
  try {
    const choice = answer === "you_choose" ? ("best" as const) : answer === "yes" ? undefined : { productId: answer.replace(/^pick:/, "") };
    const { backupsForOrg } = await import("./service");
    const current = (await backupsForOrg(rt, session.mandate.issuer.orgId)).find((b) => b.backupId === id);
    const b = await setBackup(rt, session, id, choice ?? { productId: current?.alternatives[0]?.productId ?? "" }, who);
    const ps = new Map((await rt.catalog.searchProducts({ ids: [b.product.productId, b.chosen!.productId], limit: 2 })).map((p) => [p.id, p]));
    return { reply: t.set(nameIn(ps.get(b.product.productId), b.product.name, who.lang ?? "en"), nameIn(ps.get(b.chosen!.productId), b.chosen!.name, who.lang ?? "en"), b.chosen!.insidePreferences, signer), backup: b };
  } catch (err) {
    if (err instanceof DockError && err.code === "no_backup_inside_preferences") {
      const { backupsForOrg } = await import("./service");
      const b = (await backupsForOrg(rt, session.mandate.issuer.orgId)).find((x) => x.backupId === id);
      return { reply: t.noneInside(b?.product.name ?? "") };
    }
    throw err;
  }
}
