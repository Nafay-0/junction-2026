"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
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
          className="fixed bottom-6 right-6 z-30 hidden min-h-13 items-center gap-2.5 rounded-full bg-lavender-deep pl-4 pr-5 text-[0.95rem] font-semibold text-paper shadow-lg transition-transform duration-150 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 lg:inline-flex"
        >
          <AgentIcon size={20} />
          {tx.open}
        </button>
      )}
      {open && <div aria-hidden className="fade-in fixed inset-0 z-40 bg-petrol-deep/45 backdrop-blur-[2px] xl:hidden" onClick={() => agent.setPanelOpen(false)} />}
      {/* A sheet from the bottom edge on a phone, a side sheet on a tablet, docked beside the page on a wide screen. */}
      <aside
        id="assistant"
        aria-label={tx.panel}
        className={`${open ? "flex" : "hidden"} sheet-up fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] flex-col rounded-t-2xl bg-lavender shadow-lg sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-h-none sm:w-[26rem] sm:rounded-none sm:rounded-l-2xl xl:z-40 xl:w-[25rem] xl:animate-none xl:rounded-none xl:border-l xl:border-lavender-mid xl:shadow-none`}
      >
        <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-lavender-mid sm:hidden" />
        <header className="flex items-center gap-3 px-4 pb-3 pt-3 sm:pt-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lavender-deep text-paper">
            <AgentIcon size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="display text-[1.2rem] leading-tight">{kitchen.agentName}</h2>
            <p className="line-clamp-2 text-[0.8rem] leading-snug text-ink-soft">{tx.buysFor(kitchen.name)}</p>
          </div>
          <button type="button" onClick={() => agent.setPanelOpen(false)} className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-lavender-mid hover:text-ink" aria-label={tx.close}>
            <X aria-hidden size={20} />
          </button>
        </header>

        <ol className="min-h-24 flex-1 space-y-4 overflow-y-auto px-4 py-2" aria-live="polite">
          {turns.length === 0 && (
            <li className="space-y-3">
              <p className="text-[0.95rem] leading-relaxed text-ink">{tx.intro}</p>
              <div className="flex flex-col items-stretch gap-2">
                {[...suggestions(productId, orderId, lang), kitchen.examples[1] ?? kitchen.examples[0]].filter(Boolean).map((s, i, all) => (
                  <button key={s} type="button" onClick={() => void submit(s)} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-paper px-3.5 py-2 text-left text-[0.92rem] shadow-xs ring-1 ring-lavender-mid/70 transition-shadow duration-150 hover:shadow-sm hover:ring-lavender-deep/40">
                    <span>{s}</span>
                    {i === all.length - 1 && <span className="shrink-0 rounded-full bg-lavender px-2 text-[0.74rem] font-semibold leading-5 text-lavender-deep">{tx.anOrder}</span>}
                  </button>
                ))}
              </div>
            </li>
          )}
          {turns.map((t) => (
            <li key={t.id} className="space-y-2">
              <p className="ml-10 w-fit max-w-[calc(100%-2.5rem)] justify-self-end rounded-2xl rounded-br-md bg-lavender-deep px-3.5 py-2 text-[0.95rem] leading-snug text-paper [margin-left:auto]">{t.q}</p>
              {t.kind === "pending" && (
                <div role="status" className="space-y-2 rounded-2xl rounded-bl-md bg-paper px-3.5 py-3 shadow-xs">
                  <span className="skeleton block h-3 w-4/5" />
                  <span className="skeleton block h-3 w-3/5" />
                  <span className="block text-[0.8rem] text-ink-soft">{tx.lookingUp}</span>
                </div>
              )}
              {t.kind === "error" && <p className="rounded-xl bg-bad-soft px-3.5 py-2.5 text-[0.92rem]">{tx.failed(t.message)}</p>}
              {t.kind === "order" && (
                <div className="rounded-2xl rounded-bl-md bg-paper px-3.5 py-3 text-[0.92rem] leading-snug shadow-xs ring-1 ring-lavender-mid/70">
                  <p className="font-semibold">{tx.onLane}</p>
                  <p className="mt-0.5 text-ink-soft">
                    {tx.followA}
                    <Link href={`${base}/order`} className="font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
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
          className="border-t border-lavender-mid/70 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:pb-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(agent.draft);
          }}
        >
          {(agent.followUp || agent.product) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {agent.followUp && (
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-paper py-0.5 pl-3 pr-1 text-[0.85rem] ring-1 ring-lavender-mid">
                  <span className="shrink-0 font-semibold text-lavender-deep">{tx.changing}</span>
                  <span className="truncate">{requestLabel(agent.followUp, lang)}</span>
                  <button type="button" className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-lavender hover:text-ink" aria-label={tx.stopChanging} onClick={() => agent.setFollowUp(undefined)}>
                    <X aria-hidden size={15} />
                  </button>
                </span>
              )}
              {agent.product && (
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-paper py-0.5 pl-3 pr-1 text-[0.85rem] ring-1 ring-lavender-mid">
                  <span className="shrink-0 font-semibold text-lavender-deep">{tx.product}</span>
                  <span className="truncate">{shortProduct(lang === "en" ? (agent.product.names?.en ?? agent.product.name) : nameIn(agent.product, lang))}</span>
                  <button type="button" className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-lavender hover:text-ink" aria-label={tx.removeProduct} onClick={() => agent.setProduct(undefined)}>
                    <X aria-hidden size={15} />
                  </button>
                </span>
              )}
            </div>
          )}
          <label htmlFor="need" className="px-1 text-[0.82rem] font-medium text-lavender-deep">
            {agent.followUp ? tx.labelChange : agent.product ? tx.labelProduct : tx.labelAsk}
          </label>
          <div className="mt-1.5 flex items-center gap-0.5 rounded-[1.6rem] bg-paper p-1 shadow-xs ring-1 ring-lavender-mid transition-shadow duration-150 focus-within:ring-2 focus-within:ring-lavender-deep">
            <input
              id="need"
              ref={fieldRef}
              value={agent.draft}
              onChange={(e) => agent.setDraft(e.target.value)}
              placeholder={agent.followUp ? tx.phChange : agent.product ? tx.phProduct : tx.phAsk}
              autoComplete="off"
              enterKeyHint="send"
              className="min-h-11 min-w-0 flex-1 rounded-full bg-transparent px-3 text-[1rem] placeholder:text-ink-soft focus:outline-none"
            />
            {/* Microphone and "add a photo or document" mount here (see channel-slot.tsx). */}
            <ChannelSlot kitchen={kitchen.slug} lang={SPEECH[lang]} disabled={busy} onText={agent.setDraft} onSubmit={(t) => void submit(t)} />
            <button type="submit" disabled={busy} aria-busy={busy || undefined} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-lime px-4 text-[0.95rem] font-semibold text-ink transition-colors duration-150 hover:bg-lime-hover disabled:opacity-60">
              {busy && <Spinner size={14} />}
              {tx.send}
            </button>
          </div>
          <p className="mt-2 px-1 text-[0.78rem] leading-snug text-ink-soft">{tx.footnote}</p>
          <div className="mt-2.5 border-t border-lavender-mid/70 pt-2.5">
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
    <div className="rounded-2xl rounded-bl-md bg-paper px-3.5 py-3 shadow-xs">
      <p className={`text-[0.95rem] leading-relaxed ${reply.kind === "no_model" ? "text-ink-soft" : ""}`}>{reply.answer}</p>
      {reply.dataMissing && reply.kind === "answer" && <p className="mt-1.5 inline-block rounded-xs border border-dashed border-line-strong px-1.5 text-[0.8rem] italic text-ink-soft">{tx.noData}</p>}
      {reply.citations.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={tx.sources}>
          {reply.citations.map((c) => {
            const href = c.productId ? `${base}/catalogue/${encodeURIComponent(c.productId)}` : c.orderId && !c.orderId.startsWith("ord_hist") ? `${base}/orders/${c.orderId}` : c.kind === "memory" || c.kind === "mandate" ? `${base}/agent` : undefined;
            const label = `${c.kind === "live" ? tx.live : c.kind === "memory" ? tx.memory : ""}${c.label}`;
            const chip = "inline-block max-w-[20rem] truncate rounded-full bg-lavender px-2.5 py-0.5 text-[0.78rem] text-lavender-deep";
            return (
              <li key={c.id}>
                {href ? (
                  <Link href={href} className={`${chip} underline decoration-lavender-deep/30 underline-offset-2 hover:decoration-lavender-deep`}>
                    {label}
                  </Link>
                ) : (
                  <span className={chip}>{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[0.74rem] leading-snug text-ink-soft">
        {tx.looked(reply.looked.products, reply.looked.orders)}
        {reply.liveCalls ? tx.liveChecks(reply.liveCalls) : tx.noLive}
        {reply.model ? tx.wordedBy(reply.model) : "."}
      </p>
    </div>
  );
}
