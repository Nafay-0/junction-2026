import { answerBackup, backupAnswerOf, backupMomentForThread } from "@/server/reliability/thread";
import { cardId } from "./cards";
import { byLine, record, type TurnRun } from "./pipeline";
import { readable } from "./refusal";
import type { BackupCard } from "./types";
import { shortName } from "./watch";

/**
 * A backup "in case this is not delivered" (server/reliability), in the conversation: at most one sentence per order,
 * after the order's own reply, only for a product whose delivery record is poor (most orders say nothing). The
 * product is said as a chef says it ("Peltolan blue cheese"), the record as history ("has arrived as ordered about
 * 8 times in 10"), the closest backup with its one trade-off, then the question. A no is taken in two words and the
 * product is never raised again in this conversation.
 */

type Lang = "en" | "fi" | "sv";

/** After a quote or an order in this turn: the moment for its worst product, said beneath the turn's reply. */
export async function sayBackup(run: TurnRun, ref: { orderId: string } | { requestId: string; lines: { productId: string; quantity: number; unitPriceCents: number; deliveryDate: string }[] }, lang: Lang): Promise<BackupCard | undefined> {
  const said = run.store.cards(run.thread).map((x) => x.card).filter((c): c is BackupCard => c.type === "backup");
  const m = await backupMomentForThread(run.rt, run.session, ref as never, lang).catch((err) => {
    console.error("[thread] backup", err);
    return undefined;
  });
  if (!m || said.some((c) => c.momentId === m.id)) return undefined;
  const b = m.facts.backup as { product?: { productId: string; name: string }; alternatives?: { productId: string; name: string }[] } | undefined;
  // Each catalogue name said as a chef says it.
  let text = `${m.say} ${m.ask}`.trim();
  for (const n of [b?.product?.name, ...(b?.alternatives ?? []).map((a) => a.name)].filter((x): x is string => !!x).sort((a, z) => z.length - a.length)) text = text.split(n).join(shortName(n));
  const card: BackupCard = {
    type: "backup",
    cardId: cardId("backup", `${run.turnId}:${m.id}`),
    momentId: m.id,
    ...("orderId" in ref ? { orderId: ref.orderId } : {}),
    text: readable(text, lang),
    answers: m.answers,
    others: [...m.alternatives.map((a) => `${shortName(a.name)}: ${a.why}${a.record ? `, ${a.record}` : ""}`), ...m.others.map((o) => `${shortName(o.name)}: ${o.words}`)].slice(0, 8),
    steps: m.steps,
    state: "open",
  };
  run.store.card(run.thread, run.turnId, card);
  run.facts.push(card, m.facts);
  record(run, "backup_said", `A backup was offered for a product with a poor delivery record (${m.id}).`, { backupId: m.id });
  return card;
}

/** The open backup question said in the last reply, if any. */
export function openBackup(run: TurnRun): BackupCard | undefined {
  const last = [...run.thread.turns].reverse().find((x) => x.role === "agent" && x.turnId !== run.turnId && x.replyTo !== "");
  const c = last?.role === "agent" ? last.cards.find((x): x is BackupCard => x.type === "backup" && x.state === "open") : undefined;
  return c;
}

/** The buyer's short answer to the backup question: recorded (nothing is bought), the agent's line back. */
export async function answerBackupIn(run: TurnRun, words: string, lang: Lang): Promise<string | undefined> {
  if (words.trim().split(/\s+/).length > 8) return undefined;
  const card = openBackup(run);
  if (!card) return undefined;
  const answer = backupAnswerOf({ answers: card.answers }, words);
  if (!answer) return undefined;
  const r = await answerBackup(run.rt, run.session, card.momentId, answer, { by: byLine(run), via: run.door, lang });
  run.store.card(run.thread, run.turnId, { ...card, state: answer === "no" ? "declined" : "set" });
  record(run, "backup_answer", `The buyer answered the backup question (${card.momentId}): ${answer}.`, { backupId: card.momentId, answer });
  // Each catalogue name said as a chef says it, as in the question.
  const rb = r.backup as { product?: { name: string }; chosen?: { name: string } } | undefined;
  let reply = r.reply;
  for (const n of [rb?.product?.name, rb?.chosen?.name].filter((x): x is string => !!x).sort((a, z) => z.length - a.length)) reply = reply.split(n).join(shortName(n));
  return readable(reply, lang);
}
