"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Composer, ThreadDock } from "../../_ui/thread";
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

  const chip = "inline-flex max-w-full items-center gap-1.5 rounded-full bg-paper py-0.5 pl-3 pr-1 text-[0.85rem] ring-1 ring-lavender-mid";
  const drop = "flex size-8 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-lavender hover:text-ink";
  const composer = (
    <>
      {(agent.followUp || agent.product) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {agent.followUp && (
            <span className={chip}>
              <span className="shrink-0 font-semibold text-lavender-deep">{tx.changing}</span>
              <span className="truncate">{requestLabel(agent.followUp, lang)}</span>
              <button type="button" className={drop} aria-label={tx.stopChanging} onClick={() => agent.setFollowUp(undefined)}>
                <X aria-hidden size={15} />
              </button>
            </span>
          )}
          {agent.product && (
            <span className={chip}>
              <span className="shrink-0 font-semibold text-lavender-deep">{tx.product}</span>
              <span className="truncate">{shortProduct(lang === "en" ? (agent.product.names?.en ?? agent.product.name) : nameIn(agent.product, lang))}</span>
              <button type="button" className={drop} aria-label={tx.removeProduct} onClick={() => agent.setProduct(undefined)}>
                <X aria-hidden size={15} />
              </button>
            </span>
          )}
        </div>
      )}
      <Composer
        value={agent.draft}
        onChange={agent.setDraft}
        onSubmit={() => void submit(agent.draft)}
        inputRef={fieldRef}
        busy={busy}
        label={agent.followUp ? tx.labelChange : agent.product ? tx.labelProduct : tx.labelAsk}
        placeholder={agent.followUp ? tx.phChange : agent.product ? tx.phProduct : tx.phAsk}
        hint={tx.footnote}
        // Microphone and "add a photo or document" mount here (see channel-slot.tsx).
        tools={<ChannelSlot kitchen={kitchen.slug} lang={SPEECH[lang]} disabled={busy} onText={agent.setDraft} onSubmit={(t) => void submit(t)} />}
      />
      <div className="mt-2.5 border-t border-lavender-mid/70 pt-2.5">
        <CallAgent compact />
      </div>
    </>
  );

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
      <ThreadDock open={open} onClose={() => agent.setPanelOpen(false)} name={kitchen.agentName} sub={tx.buysFor(kitchen.name)} label={tx.panel} footer={composer}>
        <ol className="space-y-4" aria-live="polite">
          {turns.length === 0 && (
            <li className="space-y-3">
              <p className="px-1 text-[0.95rem] leading-relaxed text-ink">{tx.intro}</p>
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
            <li key={t.id} className="flex flex-col gap-2">
              <p className="max-w-[85%] self-end rounded-[1.25rem] rounded-br-md bg-lavender-deep px-4 py-2.5 text-[0.95rem] leading-snug text-paper">{t.q}</p>
              {t.kind === "pending" && (
                <div role="status" className="space-y-2 rounded-xl bg-paper px-4 py-3.5 shadow-xs">
                  <span className="skeleton block h-3 w-4/5" />
                  <span className="skeleton block h-3 w-3/5" />
                  <span className="block text-[0.8rem] text-ink-soft">{tx.lookingUp}</span>
                </div>
              )}
              {t.kind === "error" && <p className="rounded-xl bg-bad-soft px-4 py-3 text-[0.92rem]">{tx.failed(t.message)}</p>}
              {t.kind === "order" && (
                <div className="rounded-xl bg-paper px-4 py-3.5 text-[0.92rem] leading-snug shadow-xs ring-1 ring-lavender-mid/70">
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
      </ThreadDock>
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
