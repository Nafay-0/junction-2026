import { numbersHeard, yesOrNo, languageOf } from "@/server/channels/speech";
import { calls, type Call } from "@/server/channels/voice/calls";
import type { Kitchen } from "@/server/kitchen-portal";
import { getRuntime } from "@/server/runtime";
import { submitTurn, threadStore } from "./engine";
import type { SpokenReadBack } from "./pipeline";
import type { AgentTurn } from "./types";
import { ackOf, milestoneOf, sayAmount, spokenOf, spokenReply, stillOf, type Lang } from "./voice-spoken";

/**
 * The voice call is the ears and the mouth of the kitchen's one conversation, nothing more (docs/doors.md).
 *
 * Ears: what the buyer said, as the live transcript heard it, goes into the SAME turn function the typed thread uses
 * (engine.ts submitTurn, door "voice", via "speech"): the same reading, plain-code checks, tools, subject carried
 * across turns, "nothing left out silently" check and refusals. The voice model has one tool, relay, and its own
 * rendering of the words is only compared with the transcript; it never decides, places, approves or changes anything.
 *
 * Mouth: what the engine's turn says (its line and its cards) is made speakable by plain code (voice-spoken.ts): a
 * short true acknowledgement at once from the engine's real step, milestones of long work, then the reply.
 *
 * What only a voice door needs, all plain code here: the words-already-used guard (a turn number per utterance), the
 * echo guard (the door's own words heard back), a yes heard while its own question was still playing, two hearings
 * of a number that disagree, "stop" and "goodbye".
 */

export type Heard = {
  /** The live transcript of the buyer's utterance: the evidence, recorded with the turn. */
  text: string;
  /** The utterance's number in this call: the same words never act twice. */
  turn: number;
  /** The voice model's own rendering of the words (relay's argument): only compared, never acted on. */
  modelWords?: string;
  /** The buyer started speaking while the door's own question was still playing. */
  overlap?: boolean;
  /** The words began while the agent's voice was playing (the only time the device's speaker can be heard back). */
  duringAgent?: boolean;
  /** The store's language, when the words do not say which. */
  lang?: Lang;
};

export type Spoken = {
  /** working: the engine is on it (more follows); reply: the engine's answer; asked: the door asks (nothing sent);
   *  ignored: nothing to say; stopped; goodbye (the screen hangs up after saying it). */
  state: "working" | "reply" | "waiting" | "asked" | "ignored" | "stopped" | "goodbye";
  say: string;
  lang: Lang;
  agentTurnId?: string;
  /** Why nothing was sent to the engine (asked or ignored), for the ledger and the tests. */
  why?: string;
  /** waiting: the named person whose OK the order waits for. */
  waitingFor?: string;
  /** What the words were made from (the turn's cards): the facts the grounding check holds the voice model's speech to. */
  facts?: unknown;
};

/** How long the first answer to an utterance waits for the engine before it says what the engine is doing. */
const ACK_MS = Number(process.env.DOCK_VOICE_ACK_MS ?? 250);
/** Long work is never silent: a new step is said once the last words are this old; the same step, after STILL_MS. */
const PROGRESS_GAP_MS = 2_500;
const STILL_MS = 4_500;

const STOP = /^(please\s+)?(stop|never ?mind|cancel( that)?|forget (it|that)|hold on|lopeta|seis|anna olla|unohda (se|koko juttu)?|ei mitään|sluta|strunta i det|glöm det|avbryt)(\s+(please|now|thanks|kiitos|tack))?[.!]*$/i;
const BYE = /^((ok(ay)?|thanks|thank you|kiitos|tack)[,.!]?\s+)?(bye|good ?bye|bye ?bye|that'?s all|that is all|hei hei|moi moi|heippa|näkemiin|kiitos,? siinä kaikki|hej då|det var allt)([,.!]?\s+(thanks|thank you|kiitos|tack))?[.!]*$/i;

const say3 = (lang: Lang, t: Record<Lang, string>) => t[lang];

function langOf(call: Call, h: Pick<Heard, "text" | "lang">): Lang {
  const spoken = h.text.trim().split(/\s+/).length >= 2 ? languageOf(h.text) : undefined;
  if (spoken) call.desk.lang = spoken;
  return call.desk.lang ?? h.lang ?? "en";
}

const tokens = (s: string) => s.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1);

/**
 * The door's own recent words heard back through the microphone (a speaker, no headset): only while the agent's
 * voice was playing, at least four words, nearly all of them the door's own in the same order. A buyer who repeats a
 * few words of the question ("the first one") is not an echo.
 */
export function isEcho(heard: string, said: { text: string; at: number }[], now = Date.now()): boolean {
  const h = tokens(heard);
  if (h.length < 4) return false;
  return said.some((s) => {
    if (now - s.at > 30_000) return false;
    const w = tokens(s.text);
    let j = 0;
    let hit = 0;
    for (const x of h) {
      const k = w.indexOf(x, j);
      if (k >= 0) {
        hit += 1;
        j = k + 1;
      }
    }
    return hit / h.length >= 0.8;
  });
}

const FILLER = new Set(["the", "a", "an", "and", "or", "so", "but", "uh", "um", "er", "erm", "hmm", "mm", "eh", "öö", "äh", "niin", "tota", "että", "och", "eller", "den", "det"]);

/**
 * Words too few to act on: no yes or no in them, and either three letters or fewer in all, or only filler words
 * ("the", "um"). "Yes", "no", "ok", "joo", "ei", "ja" are answers, not fragments.
 */
export function isFragment(text: string): boolean {
  const t = text.trim();
  if (yesOrNo(t) !== "unclear") return false;
  if (/\d/.test(t)) return false;
  const ws = tokens(t);
  const letters = t.replace(/[^\p{L}]/gu, "").length;
  return letters <= 3 || ws.every((w) => FILLER.has(w));
}

/** Two hearings of the numbers in one utterance: the transcript and the voice model's rendering. */
export function numbersDisagree(transcript: string, model: string | undefined): { heard: number[]; model: number[] } | undefined {
  if (!model?.trim()) return undefined;
  const a = [...new Set(numbersHeard(transcript))].sort((x, y) => x - y);
  const b = [...new Set(numbersHeard(model))].sort((x, y) => x - y);
  if (!a.length || !b.length) return undefined;
  if (a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-6)) return undefined;
  return { heard: a, model: b };
}

function said(call: Call, text: string) {
  if (!text) return;
  call.desk.said = [...call.desk.said.filter((s) => Date.now() - s.at < 30_000), { text, at: Date.now() }].slice(-8);
}

async function slugOf(k: Kitchen | string): Promise<string> {
  return typeof k === "string" ? k : k.info.slug;
}

/** The kitchen's thread's agent turn, as the store holds it now. */
async function agentTurnOf(slug: string, agentTurnId: string): Promise<AgentTurn | undefined> {
  const store = await threadStore();
  const t = store.peek(slug);
  return t ? store.agentTurn(t, agentTurnId) : undefined;
}

async function holdOf(slug: string): Promise<SpokenReadBack | undefined> {
  const store = await threadStore();
  return (store.peek(slug) as unknown as { spokenReadBack?: SpokenReadBack } | undefined)?.spokenReadBack;
}

function ledger(kind: string, summary: string, call: Call, data: Record<string, unknown>) {
  void getRuntime().then((rt) => rt.dock.ledger.append({ type: "agent", actor: "door:voice", summary, data: { event: kind, door: "voice", callId: call.callId, ...data } }));
}

/**
 * One utterance of the buyer, heard. Guards first (plain code); then the words go to the engine as a voice turn, and
 * the first answer comes back: the engine's reply when it is that quick, otherwise what the engine is doing now.
 * `k` is the kitchen as the store route resolved it for this browser (who the person is), or the slug.
 */
export async function heardTurn(k: Kitchen | string, call: Call, h: Heard): Promise<Spoken> {
  const text = h.text.trim().slice(0, 2000);
  const lang = langOf(call, h);
  if (!text) return { state: "ignored", say: "", lang, why: "no_words" };
  // The same words never act twice (a repeated tool call, a reconnect replaying the last turn).
  if (h.turn <= call.desk.lastTurnUsed) return { state: "ignored", say: "", lang, why: "words_already_used" };
  call.desk.lastTurnUsed = h.turn;
  // The door's own words, heard back from the device's speaker, are never the buyer's.
  if (h.duringAgent && isEcho(text, call.desk.said)) {
    ledger("echo_ignored", `The voice door ignored words that were its own, heard back: "${text.slice(0, 120)}".`, call, { heard: text.slice(0, 500) });
    return { state: "ignored", say: "", lang, why: "echo" };
  }
  // A yes that began while the door's own confirmation question was still playing is not taken as the answer.
  if (h.overlap && yesOrNo(text) === "yes" && text.split(/\s+/).length <= 3) {
    const ask = say3(lang, { en: "Sorry, I was still talking. Was that a yes?", fi: "Anteeksi, puhuin vielä. Oliko se kyllä?", sv: "Förlåt, jag pratade fortfarande. Var det ett ja?" });
    said(call, ask);
    ledger("overlap_asked", `A yes heard while the door's question was still playing was not taken: "${text.slice(0, 80)}".`, call, { heard: text });
    return { state: "asked", say: ask, lang, why: "overlap" };
  }
  // A fragment (a word cut off by talking over the agent, "The"): asked again, never acted on as an answer.
  if (isFragment(text)) {
    const ask = say3(lang, { en: `Sorry, I only caught "${text}". Could you say that again?`, fi: `Anteeksi, kuulin vain "${text}". Sanoisitko uudelleen?`, sv: `Förlåt, jag hörde bara "${text}". Kan du säga det igen?` });
    said(call, ask);
    ledger("fragment_asked", `Only a fragment was heard ("${text.slice(0, 20)}"): asked again, nothing sent.`, call, { heard: text });
    return { state: "asked", say: ask, lang, why: "fragment" };
  }
  const slug = await slugOf(k);
  if (BYE.test(text)) {
    const bye = say3(lang, { en: "Goodbye.", fi: "Hei hei.", sv: "Hej då." });
    return { state: "goodbye", say: bye, lang };
  }
  if (STOP.test(text)) {
    // The engine cannot stop a turn midway (a price being fixed, an order at the gate, a plan being drafted): said
    // plainly, and the result is still said when it comes, so nothing happens unheard.
    const working = [...call.desk.turns].reverse()[0];
    const a = working ? await agentTurnOf(slug, working) : undefined;
    ledger("stopped", `The buyer said "${text.slice(0, 40)}"${a?.status === "working" ? ": the work in progress cannot be stopped midway, and the buyer was told so" : ""}.`, call, { heard: text, agentTurnId: a?.turnId });
    const stop = say3(lang, a?.status === "working" ? { en: "I can't stop this one midway. I'll finish it and tell you how it ended.", fi: "En voi keskeyttää tätä kesken. Teen sen loppuun ja kerron, miten kävi.", sv: "Jag kan inte avbryta det här mitt i. Jag gör klart det och säger hur det gick." } : { en: "OK.", fi: "Selvä.", sv: "Okej." });
    said(call, stop);
    return { state: "stopped", say: stop, lang };
  }
  // A number heard one way by the transcript and another by the voice model: asked, never guessed.
  const nums = numbersDisagree(text, h.modelWords);
  if (nums) {
    const both = [...new Set([...nums.heard, ...nums.model])].slice(0, 3);
    const unit = /\b(litr|l\b|liter)/i.test(text) ? "L" : /\bkil|kg\b/i.test(text) ? "kg" : "";
    const list = both.map((n) => (unit ? sayAmount(n, unit, lang) : String(n)));
    const ask = say3(lang, { en: `I heard ${list.join(" or ")}. Please say it again with the amount.`, fi: `Kuulin ${list.join(" tai ")}. Sano se uudelleen määrän kanssa.`, sv: `Jag hörde ${list.join(" eller ")}. Säg det igen med mängden.` });
    said(call, ask);
    ledger("numbers_disagree", `Two hearings of the numbers disagreed (transcript ${nums.heard.join(", ")}, voice model ${nums.model.join(", ")}): asked again, nothing sent.`, call, { heard: text, model: h.modelWords?.slice(0, 500) });
    return { state: "asked", say: ask, lang, why: "numbers_disagree" };
  }
  // One turn works at a time: a new request while one is still working is answered next, and the buyer is told.
  const prev = [...call.desk.turns].reverse()[0];
  const busy = prev ? (await agentTurnOf(slug, prev))?.status === "working" : false;
  // The words go to the engine, exactly as typed words do; the transcript is the evidence (the engine records it).
  const reply = await submitTurn(k, { door: "voice", via: "speech", text, lang, clientTurnId: `${call.callId}:${h.turn}` });
  call.desk.turns = [...call.desk.turns, reply.agentTurnId].slice(-40);
  ledger("heard", `The voice door heard the buyer and sent their words to the conversation: "${text.slice(0, 200)}".`, call, { step: "heard", heard: text, ...(h.modelWords ? { model: h.modelWords.slice(0, 500) } : {}), agentTurnId: reply.agentTurnId, threadId: reply.threadId });
  if (busy) {
    const next = say3(lang, { en: "I'll finish the one before first, then this.", fi: "Teen ensin edellisen loppuun, sitten tämän.", sv: "Jag gör klart det förra först, sedan det här." });
    call.desk.progress[reply.agentTurnId] = { keys: [], at: Date.now(), last: next };
    said(call, next);
    return { state: "working", say: next, lang, agentTurnId: reply.agentTurnId };
  }
  return nextSpoken(k, call, reply.agentTurnId, ACK_MS, true);
}

/**
 * What to say next about an agent turn: its reply once the engine is done (or waits on the buyer or a sign-off), a
 * milestone of long work, or, the first time, what the engine is doing now. Waits up to `waitMs` for something new.
 * A turn waiting for a sign-off is spoken again when the sign-off lands.
 */
export async function nextSpoken(k: Kitchen | string, call: Call, agentTurnId: string, waitMs: number, first = false): Promise<Spoken> {
  const slug = await slugOf(k);
  const store = await threadStore();
  const lang = call.desk.lang ?? "en";
  const p = (call.desk.progress[agentTurnId] ??= { keys: [], at: 0 });
  const until = Date.now() + Math.max(0, waitMs);
  for (;;) {
    const a = await agentTurnOf(slug, agentTurnId);
    if (!a) return { state: "ignored", say: "", lang, why: "no_turn" };
    const muted = call.desk.muted.includes(agentTurnId);
    if (a.status !== "working" && a.status !== p.status) {
      const before = p.status;
      p.status = a.status;
      if (muted) return { state: "reply", say: "", lang, agentTurnId, why: "stopped" };
      let words: string;
      if (before === "waiting_approver") words = afterSignOff(a, lang);
      else {
        const r = spokenReply(a, lang, await holdOf(slug));
        words = r.say;
        // The spoken question asks about one order: the buyer's yes orders exactly that (engine.ts, as the read-back).
        if (r.hold) {
          const t = store.peek(slug) as unknown as { spokenReadBack?: SpokenReadBack } | undefined;
          if (t) t.spokenReadBack = r.hold;
        }
      }
      said(call, words);
      const facts = { cards: a.cards, line: a.line ?? "" };
      if (a.status === "waiting_approver") {
        const gate = a.cards.find((c) => c.type === "gate" && c.outcome === "waiting");
        return { state: "waiting", say: words, lang, agentTurnId, facts, ...(gate?.type === "gate" && gate.approver ? { waitingFor: gate.approver.name } : {}) };
      }
      return { state: "reply", say: words, lang, agentTurnId, facts };
    }
    // Already said, and nothing more will come (a turn waiting for a sign-off is followed until it lands).
    if (a.status !== "working" && a.status === p.status && a.status !== "waiting_approver") return { state: "reply", say: "", lang, agentTurnId };
    // A turn still queued behind another (no step yet) says nothing of its own: the one working speaks.
    if (a.status === "working" && !muted && !first && a.steps.length) {
      const next = progressFor(a, p, Date.now(), lang);
      if (next) {
        p.keys.push(next.key);
        p.at = Date.now();
        p.last = next.say;
        said(call, next.say);
        return { state: "working", say: next.say, lang, agentTurnId };
      }
    }
    const left = until - Date.now();
    if (left <= 0) {
      if (first) {
        // The first answer: what the engine is doing now (true: from its running step), so the buyer hears something at once.
        const ack = ackOf(a, lang);
        const m = milestoneOf(a, new Set(p.keys), lang);
        if (m) p.keys.push(m.key);
        p.at = Date.now();
        p.last = ack;
        said(call, ack);
        return { state: "working", say: ack, lang, agentTurnId };
      }
      return { state: a.status === "waiting_approver" ? "waiting" : "working", say: "", lang, agentTurnId };
    }
    // Wait for the next change to this kitchen's thread (or the time left).
    await new Promise<void>((resolve) => {
      const t = setTimeout(done, Math.min(left, 1_000));
      const off = store.subscribe(slug, (e) => {
        if ("turnId" in e && e.turnId === agentTurnId) done();
      });
      function done() {
        clearTimeout(t);
        off();
        resolve();
      }
    });
  }
}

/**
 * What to say about work still going, if anything: a new step once the last words are two and a half seconds old; the
 * same step gone on for four and a half seconds, once ("Still waiting for the wholesaler's live prices."); never the same words twice
 * in a row; nothing for a turn still queued behind another.
 */
export function progressFor(a: AgentTurn, p: { keys: string[]; at: number; last?: string }, now: number, lang: Lang): { key: string; say: string } | undefined {
  if (a.status !== "working" || !a.steps.length) return undefined;
  const quiet = now - p.at;
  const m = milestoneOf(a, new Set(p.keys), lang);
  const next = m && quiet >= PROGRESS_GAP_MS ? m : quiet >= STILL_MS ? stillOf(a, new Set(p.keys), lang) : undefined;
  return next && next.say !== p.last ? next : undefined;
}

/** The sign-off a turn waited for, decided: said once, from the gate card. */
function afterSignOff(a: AgentTurn, lang: Lang): string {
  const gate = [...a.cards].reverse().find((c) => c.type === "gate");
  const who = gate?.type === "gate" ? (gate.approver?.name ?? "") : "";
  if (gate?.type === "gate" && gate.outcome === "approved") return say3(lang, { en: `${who || "The approver"} signed it: it's ordered.`, fi: `${who || "Hyväksyjä"} hyväksyi sen: tilaus on tehty.`, sv: `${who || "Godkännaren"} har godkänt den: den är beställd.` });
  if (gate?.type === "gate" && gate.outcome === "declined") return say3(lang, { en: `${who || "The approver"} declined it, so nothing was ordered.`, fi: `${who || "Hyväksyjä"} hylkäsi sen, joten mitään ei tilattu.`, sv: `${who || "Godkännaren"} avböjde den, så inget beställdes.` });
  return spokenOf(a, lang);
}

/** Where things stand, for a reconnect: the newest reply of this call, said again. */
export async function standing(k: Kitchen | string, call: Call): Promise<string> {
  const slug = await slugOf(k);
  const lang = call.desk.lang ?? "en";
  const last = [...call.desk.turns].reverse()[0];
  const a = last ? await agentTurnOf(slug, last) : undefined;
  if (!a) return say3(lang, { en: "I'm back. What do you need?", fi: "Olen taas linjoilla. Mitä tarvitset?", sv: "Jag är tillbaka. Vad behöver du?" });
  if (a.status === "working") return say3(lang, { en: "I'm back, and still working on that.", fi: "Olen taas linjoilla, ja työ on vielä kesken.", sv: "Jag är tillbaka och arbetar fortfarande med det." });
  return `${say3(lang, { en: "I'm back.", fi: "Olen taas linjoilla.", sv: "Jag är tillbaka." })} ${spokenOf(a, lang)}`;
}

export { calls };
