import type { Lang } from "@/app/_i18n/lang";
import { isDockError } from "@/core/errors";
import type { Runtime } from "../runtime";
import { addressIn } from "./address";
import { ADDRESS_CHANGES_PER_HOUR, addressOf, askedInThread, receiptStatus, removeAddress, setAddress, transportOf } from "./service";
import { MAIL_SAY_TEXT } from "./say.text";

/**
 * Email in the kitchen's own conversation: data and actions, no card. The thread (owned by the conversation engineer)
 * decides where it is said; this module gives it the words and does what the buyer's words ask.
 *
 *   mailFactAfterOrder(rt, k, order, { lang, threadId })   after an order is placed (or sent for an OK): one clause
 *        -> string | undefined                             to add to the agent's line, or undefined to say nothing.
 *                                                          No address yet: "Shall I email the receipt? I'd need an
 *                                                          address", at most once per conversation (threadId).
 *   mailWordsOf(words)                                     the buyer's words about email, or undefined:
 *        -> { kind: "set", address } | { kind: "stop" } | { kind: "which" } | { kind: "set_invalid" }
 *           | { kind: "ask" }  ("can you email me the receipts?": where they go now, or "tell me the address")
 *   answerMailWords(rt, k, intent, { person, via, lang })  does it and returns { reply } in the kitchen's language.
 *                                                          Setting an address needs the kitchen's signed-in person
 *                                                          (run.person, not a call-only session); it sends only the
 *                                                          confirmation mail.
 *
 * The address is said masked (m•••@example.com) except to the kitchen's own signed-in person asking which it is.
 */

/** What the thread already has as `run.k` (server/kitchen-portal.ts Kitchen) is enough. */
export type ThreadKitchen = { info: { slug: string; orgId: string; name: string } };
export type ThreadPerson = { name: string; callOnly?: boolean } | undefined;

export type MailIntent = { kind: "set"; address: string } | { kind: "set_invalid" } | { kind: "stop" } | { kind: "which" } | { kind: "ask" };

const MAIL_WORD = /\b(e-?mails?|mails?|mejl\w*|e-post\w*|sähköpost\w*|s-?posti\w*|meili\w*|receipts?|kuit\w*|kvitt\w*|address|osoit\w*|adress\w*)\b/iu;
const STOP = /\b(stop|no more|unsubscribe|don'?t (send|email)|do not (send|email)|turn off|lopeta|lopettakaa|älä (lähetä|enää)|ei enää|pois päältä|sluta|inga (fler|mer)|avsluta|stäng av)\b/iu;
const WHICH = /\b(which|what|whose)\b.*\b(e-?mail|address|mail)\b|\bwhere do you (send|email)\b|\bmi(hin|kä|tä)\b.*\b(osoit|sähköpost)\w*|\bvilken\b.*\b(adress|mejl|e-post)\w*|\bvart (skickar|mejlar)\b/iu;
/** Email itself (not "address" or "receipt" alone, which an order can say), and words that ask for it. */
const EMAIL_WORD = /\b(e-?mails?|e-?mail(ed|ing)?|mejl\w*|e-post\w*|sähköpost\w*|s-?posti\w*|meili\w*)\b/iu;
const ASK = /\b(can you|could you|please|i want|we want|i'?d like|we'?d like|send|email (me|us)|let (me|us) know|notify|tell (me|us)|inform|alert|haluan|haluaisin|haluamme|voitko|voisitko|lähetä|lähettäkää|ilmoita|ilmoittakaa|kerro|kertokaa|kan du|kan ni|vill|skicka|meddela)\b/iu;
const SET = /\b(send|email|e-mail|mail|use|set|to|lähetä|lähettäkää|käytä|osoitteeseen|skicka|mejla|använd|till)\b/iu;

/** The buyer's words about email, in English, Finnish or Swedish; undefined for anything else. */
export function mailWordsOf(words: string): MailIntent | undefined {
  const w = words.trim();
  if (!w || w.length > 400) return undefined;
  const address = addressIn(w);
  if (address && (SET.test(w) || MAIL_WORD.test(w) || w.replace(address, "").trim().length < 3)) return { kind: "set", address };
  if (!MAIL_WORD.test(w)) return undefined;
  if (STOP.test(w)) return { kind: "stop" };
  if (WHICH.test(w)) return { kind: "which" };
  // "email receipts to chef@" with a broken address: say so rather than order something
  if (/@/.test(w) && SET.test(w)) return { kind: "set_invalid" };
  // "Can you email me the receipts?", "email us when an order is placed": where they go, or ask for the address.
  // Words that also order something ("20 l milk for Friday and email me the receipt") go to the order, not here.
  if (EMAIL_WORD.test(w) && ASK.test(w) && !/@/.test(w) && !/\d/.test(w) && w.length <= 160) return { kind: "ask" };
  return undefined;
}

/** The clause after an order: emailed, waiting for confirmation, or the one-time offer. Undefined: say nothing. */
export async function mailFactAfterOrder(rt: Runtime, k: ThreadKitchen, order: { orderId: string; status: string }, opts: { lang?: Lang; threadId: string }): Promise<string | undefined> {
  const t = MAIL_SAY_TEXT[opts.lang ?? "en"];
  if (order.status !== "committed" && order.status !== "pending_approval") return undefined;
  if (!transportOf(rt)) return undefined; // never claim a mail that cannot go
  const a = await addressOf(rt, k.info.orgId, { own: false });
  if (a.state === "confirmed" && a.masked) {
    if (order.status === "pending_approval") return t.waitingEmailed(a.masked);
    const r = await receiptStatus(rt, { orderId: order.orderId, orgId: k.info.orgId, status: order.status });
    return r.status === "sent" || r.status === "sending" ? t.emailed(a.masked) : undefined;
  }
  if (a.state === "pending" && a.masked) return t.pendingConfirm(a.masked);
  if (a.state === "none" && !(await askedInThread(rt, opts.threadId, true))) return t.offer;
  return undefined;
}

/** Act on the buyer's words about email; returns the reply in the kitchen's language. */
export async function answerMailWords(rt: Runtime, k: ThreadKitchen, intent: MailIntent, who: { person: ThreadPerson; via: string; lang?: Lang }): Promise<{ reply: string; changed: boolean }> {
  const lang = who.lang ?? "en";
  const t = MAIL_SAY_TEXT[lang];
  const own = !!who.person && !who.person.callOnly;
  const ref = { orgId: k.info.orgId, slug: k.info.slug, name: k.info.name };
  switch (intent.kind) {
    case "set_invalid":
      return { reply: t.invalid, changed: false };
    case "set": {
      if (!own) return { reply: t.setNotPerson, changed: false };
      if (!transportOf(rt)) return { reply: t.notConfigured, changed: false };
      try {
        const r = await setAddress(rt, ref, intent.address, { by: who.person!.name, via: who.via, lang });
        return { reply: t.setOk(r.contact.masked ?? ""), changed: true };
      } catch (err) {
        if (isDockError(err) && err.code === "invalid_address") return { reply: t.invalid, changed: false };
        if (isDockError(err) && err.code === "mail_address_changes") return { reply: t.tooMany(ADDRESS_CHANGES_PER_HOUR), changed: false };
        throw err;
      }
    }
    case "stop": {
      const a = await addressOf(rt, k.info.orgId, { own: false });
      if (a.state !== "confirmed" && a.state !== "pending") return { reply: t.stopNone, changed: false };
      if (!own) return { reply: t.setNotPerson, changed: false };
      await removeAddress(rt, k.info.orgId, { by: who.person!.name, via: who.via });
      return { reply: t.stopOk(a.masked ?? ""), changed: true };
    }
    case "ask": {
      if (!transportOf(rt)) return { reply: t.notConfigured, changed: false };
      const a = await addressOf(rt, k.info.orgId, { own: false });
      if (a.state === "confirmed") return { reply: t.whichConfirmed(a.masked ?? ""), changed: false };
      if (a.state === "pending") return { reply: t.whichPending(a.masked ?? ""), changed: false };
      return { reply: t.askNone, changed: false };
    }
    case "which": {
      const a = await addressOf(rt, k.info.orgId, { own });
      const shown = a.address ?? a.masked ?? "";
      if (a.state === "confirmed") return { reply: t.whichConfirmed(shown), changed: false };
      if (a.state === "pending") return { reply: t.whichPending(shown), changed: false };
      if (a.state === "stopped" || a.state === "bounced") return { reply: t.whichStopped(a.masked ?? ""), changed: false };
      return { reply: t.whichNone, changed: false };
    }
  }
}
