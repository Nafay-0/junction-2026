"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "../../_ui/kit";
import { shortProduct } from "../../_ui/plain";
import { useText } from "../../_i18n/provider";
import type { Lang } from "../../_i18n/lang";
import { ASSISTANT_TEXT } from "./assistant.text";
import { CallAgent } from "./call-agent";
import { ChannelSlot } from "./channel-slot";
import { AgentIcon, requestLabel, usePortal } from "./portal";
import { nameIn } from "./shop";
import type { AskReply } from "@/server/kitchen-assistant";

/**
 * The kitchen's purchasing agent, present on every page as a panel. Two jobs, kept apart:
 *   a question   answered only from the shop's records (product data, the kitchen's orders and memory), each
 *                answer citing the records it rests on, "no data" where they are silent;
 *   a need       handed to the staged order flow on the Order page: understood, mistake check, options, fixed
 *                price, the gate. Nothing is ordered from this conversation alone.
 */
export type Turn = { id: number; q: string } & ({ kind: "pending" } | { kind: "answer"; reply: AskReply } | { kind: "order" } | { kind: "error"; message: string });

const QUESTION = /\?\s*$|^\s*(is|are|does|do|did|what|what's|which|why|how|when|where|who|can|could|should|has|have|tell|show|explain|compare|onko|ovatko|mikä|mitkä|mitä|miksi|miten|milloin|kuka|voiko|paljonko|kerro|är|vad|varför|hur|när|vilken|vilka|finns|kan)\b/i;

export function isQuestion(text: string): boolean {
  return QUESTION.test(text);
}

const SPEECH: Record<string, string> = { en: "en-GB", fi: "fi-FI", sv: "sv-SE" };

function screenOf(path: string, base: string): { screen: string; productId?: string; orderId?: string } {
  const rest = path.slice(base.length);
  const prod = /^\/catalogue\/([^/]+)/.exec(rest)?.[1];
  if (prod) return { screen: `the product page of product ${decodeURIComponent(prod)}`, productId: decodeURIComponent(prod) };
  const ord = /^\/orders\/([^/]+)/.exec(rest)?.[1];
  if (ord) return { screen: `the page of order ${ord}`, orderId: ord };
  const page = rest.split("/")[1] ?? "";
  return { screen: { "": "the kitchen's home page", order: "the order page", catalogue: "the catalogue", orders: "the order list", agent: "the agent and rules page", basket: "the basket" }[page] ?? "the shop" };
}

function suggestions(productId?: string, orderId?: string, lang: Lang = "en"): string[] {
  const t = ASSISTANT_TEXT[lang];
  if (productId) return t.suggestProduct;
  if (orderId) return t.suggestOrder;
  return t.suggestHome;
}

export function AssistantPanel() {
  const { agent, base, kitchen, ui, lang, fieldRef } = usePortal();
  const tx = useText(ASSISTANT_TEXT);
  const pathname = usePathname() ?? base;
  const { productId, orderId, screen } = screenOf(pathname, base);
  const [asking, setAsking] = useState(false);
  const nextId = useRef(1);
  const endRef = useRef<HTMLLIElement>(null);
  const { turns, setTurns } = agent;
  const open = agent.panelOpen;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length]);

  const toOrder = (text: string, id?: number) => {
    agent.send({ kind: "ask", text, followUp: agent.followUp, product: agent.product });
    // On a phone the panel covers the page: close it so the order cards are in view.
    if (!window.matchMedia("(min-width: 1280px)").matches) agent.setPanelOpen(false);
    setTurns((t) => (id ? t.map((x) => (x.id === id ? { id, q: text, kind: "order" as const } : x)) : [...t, { id: nextId.current++, q: text, kind: "order" as const }]));
  };

  const submit = async (raw: string) => {
    const text = raw.trim();
    if (!text) return fieldRef.current?.focus();
    agent.setDraft("");
    // A need goes to the order cards; a question gets a grounded answer.
    if (agent.followUp || agent.product || !isQuestion(text)) return toOrder(text);
    const id = nextId.current++;
    setTurns((t) => [...t, { id, q: text, kind: "pending" }]);
    setAsking(true);
    const history = turns.flatMap((t) => (t.kind === "answer" ? [{ q: t.q, a: t.reply.answer }] : [])).slice(-4);
    const r = await ui<AskReply>("POST", "assistant", { question: text, productId, orderId, screen, history });
    setAsking(false);
    if (r.ok && r.data.kind === "order_request") return toOrder(text, id);
    setTurns((t) => t.map((x) => (x.id === id ? (r.ok ? { id, q: text, kind: "answer", reply: r.data } : { id, q: text, kind: "error", message: r.error.message }) : x)));
  };

  const busy = asking || agent.busy;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={agent.open}
          aria-keyshortcuts="Control+K Meta+K"
          className="fixed bottom-4 right-4 z-30 flex min-h-14 items-center gap-2 bg-lavender-deep px-5 font-semibold text-paper shadow-[0_6px_0_rgba(35,40,45,0.18)] hover:bg-ink"
        >
          <AgentIcon size={22} />
          {tx.open}
        </button>
      )}
      {open && <div aria-hidden className="fixed inset-0 z-30 bg-ink/40 xl:hidden" onClick={() => agent.setPanelOpen(false)} />}
      <aside
        id="assistant"
        aria-label={tx.panel}
        className={`${open ? "flex" : "hidden"} fixed inset-y-0 right-0 z-40 w-full max-w-[26rem] flex-col bg-lavender shadow-[-8px_0_0_rgba(35,40,45,0.06)] xl:w-[25rem]`}
      >
        <header className="on-dark flex items-start gap-3 bg-lavender-deep px-4 py-3 text-paper">
          <span className="mt-1 flex size-9 shrink-0 items-center justify-center bg-paper/15">
            <AgentIcon size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="display text-[1.5rem]">{kitchen.agentName}</h2>
            <p className="text-[0.85rem] leading-snug text-paper/80">{tx.buysFor(kitchen.name)}</p>
          </div>
          <button type="button" onClick={() => agent.setPanelOpen(false)} className="min-h-11 min-w-11 text-[1.5rem] font-bold leading-none hover:bg-paper/10" aria-label={tx.close}>
            ×
          </button>
        </header>

        <ol className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
          {turns.length === 0 && (
            <li className="space-y-3">
              <p className="text-[0.98rem] leading-snug text-ink">{tx.intro}</p>
              <div className="flex flex-col items-stretch gap-1.5">
                {[...suggestions(productId, orderId, lang), kitchen.examples[1] ?? kitchen.examples[0]].filter(Boolean).map((s, i, all) => (
                  <button key={s} type="button" onClick={() => void submit(s)} className="flex min-h-10 items-center justify-between gap-2 bg-paper px-3 py-1.5 text-left text-[0.95rem] hover:bg-paper/70 hover:outline-2 hover:outline-lavender-deep">
                    <span>{s}</span>
                    {i === all.length - 1 && <span className="shrink-0 text-[0.78rem] font-semibold text-lavender-deep">{tx.anOrder}</span>}
                  </button>
                ))}
              </div>
            </li>
          )}
          {turns.map((t) => (
            <li key={t.id} className="space-y-2">
              <p className="ml-8 bg-paper px-3 py-2 text-[0.98rem] leading-snug">{t.q}</p>
              {t.kind === "pending" && (
                <p className="flex items-center gap-2 text-[0.92rem] text-lavender-deep">
                  <Spinner size={14} /> {tx.lookingUp}
                </p>
              )}
              {t.kind === "error" && <p className="border-l-4 border-ink pl-2 text-[0.95rem]">{tx.failed(t.message)}</p>}
              {t.kind === "order" && (
                <div className="border-l-4 border-petrol bg-paper/60 py-1.5 pl-3 pr-2 text-[0.95rem] leading-snug">
                  <p className="font-semibold">{tx.onLane}</p>
                  <p className="text-ink-soft">
                    {tx.followA}
                    <Link href={`${base}/order`} className="font-semibold text-petrol underline decoration-2 underline-offset-4">
                      {tx.orderPage}
                    </Link>
                    {tx.followB}
                  </p>
                </div>
              )}
              {t.kind === "answer" && <Answer reply={t.reply} base={base} />}
            </li>
          ))}
          <li ref={endRef} aria-hidden />
        </ol>

        <form
          className="border-t border-lavender-deep/20 bg-lavender p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(agent.draft);
          }}
        >
          {(agent.followUp || agent.product) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {agent.followUp && (
                <span className="inline-flex max-w-full items-center gap-1.5 bg-paper px-2 py-0.5 text-[0.88rem]">
                  <span className="shrink-0 font-semibold text-lavender-deep">{tx.changing}</span>
                  <span className="truncate">{requestLabel(agent.followUp, lang)}</span>
                  <button type="button" className="min-h-8 shrink-0 px-1 font-bold" aria-label={tx.stopChanging} onClick={() => agent.setFollowUp(undefined)}>
                    ×
                  </button>
                </span>
              )}
              {agent.product && (
                <span className="inline-flex max-w-full items-center gap-1.5 bg-paper px-2 py-0.5 text-[0.88rem]">
                  <span className="shrink-0 font-semibold text-lavender-deep">{tx.product}</span>
                  <span className="truncate">{shortProduct(lang === "en" ? (agent.product.names?.en ?? agent.product.name) : nameIn(agent.product, lang))}</span>
                  <button type="button" className="min-h-8 shrink-0 px-1 font-bold" aria-label={tx.removeProduct} onClick={() => agent.setProduct(undefined)}>
                    ×
                  </button>
                </span>
              )}
            </div>
          )}
          <label htmlFor="need" className="text-[0.88rem] font-semibold text-lavender-deep">
            {agent.followUp ? tx.labelChange : agent.product ? tx.labelProduct : tx.labelAsk}
          </label>
          <div className="mt-1 flex bg-paper outline-2 outline-lavender-deep focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-petrol">
            <input
              id="need"
              ref={fieldRef}
              value={agent.draft}
              onChange={(e) => agent.setDraft(e.target.value)}
              placeholder={agent.followUp ? tx.phChange : agent.product ? tx.phProduct : tx.phAsk}
              autoComplete="off"
              enterKeyHint="send"
              className="min-h-12 min-w-0 flex-1 bg-transparent px-3 text-[1.05rem] font-semibold placeholder:font-normal placeholder:text-ink-soft focus:outline-none"
            />
            {/* Microphone and "add a photo or document" mount here (see channel-slot.tsx). */}
            <ChannelSlot kitchen={kitchen.slug} lang={SPEECH[lang]} disabled={busy} onText={agent.setDraft} onSubmit={(t) => void submit(t)} />
            <button type="submit" disabled={busy} aria-busy={busy || undefined} className="inline-flex min-h-12 shrink-0 items-center gap-2 bg-lime px-4 font-semibold text-ink hover:bg-lime-hover disabled:opacity-60">
              {busy && <Spinner size={14} />}
              {tx.send}
            </button>
          </div>
          <p className="mt-1.5 text-[0.8rem] leading-snug text-ink-soft">{tx.footnote}</p>
          <div className="mt-2 border-t border-lavender-deep/20 pt-2">
            <CallAgent compact />
          </div>
        </form>
      </aside>
    </>
  );
}

function Answer({ reply, base }: { reply: AskReply; base: string }) {
  const tx = useText(ASSISTANT_TEXT);
  return (
    <div className="bg-paper px-3 py-2.5">
      <p className={`text-[0.98rem] leading-snug ${reply.kind === "no_model" ? "text-ink-soft" : ""}`}>{reply.answer}</p>
      {reply.dataMissing && reply.kind === "answer" && <p className="mt-1 inline-block border border-dashed border-ink-soft px-1.5 text-[0.82rem] italic text-ink-soft">{tx.noData}</p>}
      {reply.citations.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1" aria-label={tx.sources}>
          {reply.citations.map((c) => {
            const href = c.productId ? `${base}/catalogue/${encodeURIComponent(c.productId)}` : c.orderId && !c.orderId.startsWith("ord_hist") ? `${base}/orders/${c.orderId}` : c.kind === "memory" || c.kind === "mandate" ? `${base}/agent` : undefined;
            const label = `${c.kind === "live" ? tx.live : c.kind === "memory" ? tx.memory : ""}${c.label}`;
            return (
              <li key={c.id}>
                {href ? (
                  <Link href={href} className="inline-block max-w-[20rem] truncate bg-lavender px-1.5 py-0.5 text-[0.8rem] text-lavender-deep underline decoration-1 underline-offset-2">
                    {label}
                  </Link>
                ) : (
                  <span className="inline-block max-w-[20rem] truncate bg-lavender px-1.5 py-0.5 text-[0.8rem] text-lavender-deep">{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-1 text-[0.76rem] text-ink-soft">
        {tx.looked(reply.looked.products, reply.looked.orders)}
        {reply.liveCalls ? tx.liveChecks(reply.liveCalls) : tx.noLive}
        {reply.model ? tx.wordedBy(reply.model) : "."}
      </p>
    </div>
  );
}
