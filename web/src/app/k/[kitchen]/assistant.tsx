"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Target } from "../../_ui/target";
import { shortProduct } from "../../_ui/plain";
import { CallAgent } from "./call-agent";
import { ChannelSlot } from "./channel-slot";
import { requestLabel, usePortal } from "./portal";
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

function suggestions(productId?: string, orderId?: string): string[] {
  if (productId) return ["Is this gluten-free?", "What is a lactose-free alternative to this?", "What does it cost and when can it come?"];
  if (orderId) return ["Why did this order need a sign-off?", "Who signed it, and how?"];
  return ["What did we order last week?", "Why was the last order held?", "What may the agent buy alone?"];
}

export function AssistantPanel() {
  const { agent, base, kitchen, ui, lang, fieldRef } = usePortal();
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
          className="fixed bottom-4 right-4 z-30 flex min-h-14 items-center gap-2 bg-ink px-5 font-semibold text-paper shadow-[0_4px_0_rgba(26,29,33,0.25)]"
        >
          <Target size={22} tone="chalk" />
          Ask the purchasing agent
        </button>
      )}
      {open && <div aria-hidden className="fixed inset-0 z-30 bg-ink/30 xl:hidden" onClick={() => agent.setPanelOpen(false)} />}
      <aside
        id="assistant"
        aria-label="Purchasing agent"
        className={`${open ? "flex" : "hidden"} fixed inset-y-0 right-0 z-40 w-full max-w-[26rem] flex-col border-l-[3px] border-ink bg-paper xl:w-[24rem]`}
      >
        <header className="flex items-start gap-3 border-b border-ink/15 px-4 py-3">
          <Target size={30} tone="ink" className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1.3rem] font-bold leading-tight">Purchasing agent</h2>
            <p className="text-[0.85rem] leading-snug text-ink-soft">
              {kitchen.agentName}, working in the shop for {kitchen.name}. Answers come from the shop&apos;s records; orders go through the order cards and the kitchen&apos;s sign-off.
            </p>
          </div>
          <button type="button" onClick={() => agent.setPanelOpen(false)} className="min-h-11 min-w-11 text-[1.4rem] font-bold" aria-label="Close the agent panel">
            ×
          </button>
        </header>

        <ol className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
          {turns.length === 0 && (
            <li className="space-y-2">
              <p className="text-[0.95rem] leading-snug text-ink-soft">Ask about what is on screen, the catalogue or the kitchen&apos;s orders, or say what the kitchen needs.</p>
              <div className="flex flex-col items-start gap-1.5">
                {[...suggestions(productId, orderId), kitchen.examples[1] ?? kitchen.examples[0]].filter(Boolean).map((s) => (
                  <button key={s} type="button" onClick={() => void submit(s)} className="min-h-9 border border-ink/40 px-2.5 text-left text-[0.92rem] hover:border-ink">
                    {s}
                  </button>
                ))}
              </div>
            </li>
          )}
          {turns.map((t) => (
            <li key={t.id} className="space-y-1.5">
              <p className="ml-6 bg-concrete px-3 py-2 text-[0.98rem] leading-snug">{t.q}</p>
              {t.kind === "pending" && (
                <p className="flex items-center gap-2 text-[0.92rem] text-ink-soft">
                  <Target size={16} tone="hollow" spin /> Looking it up in the shop&apos;s records…
                </p>
              )}
              {t.kind === "error" && <p className="border-l-4 border-ink pl-2 text-[0.95rem]">That did not work: {t.message}</p>}
              {t.kind === "order" && (
                <div className="border-l-4 border-ink pl-3 text-[0.95rem] leading-snug">
                  <p className="font-semibold">Taken as an order request.</p>
                  <p className="text-ink-soft">
                    The agent sets it up as cards on the{" "}
                    <Link href={`${base}/order`} className="font-semibold text-ink underline decoration-2 underline-offset-4">
                      Order page
                    </Link>
                    : what it understood, the mistake check, options and a fixed price. Nothing is ordered until the gate passes it.
                  </p>
                </div>
              )}
              {t.kind === "answer" && <Answer reply={t.reply} base={base} />}
            </li>
          ))}
          <li ref={endRef} aria-hidden />
        </ol>

        <form
          className="border-t-[3px] border-ink p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(agent.draft);
          }}
        >
          {(agent.followUp || agent.product) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {agent.followUp && (
                <span className="inline-flex max-w-full items-center gap-1.5 border-2 border-ink px-2 py-0.5 text-[0.88rem]">
                  <span className="shrink-0 font-semibold">Changing</span>
                  <span className="truncate">{requestLabel(agent.followUp)}</span>
                  <button type="button" className="shrink-0 px-1 font-bold" aria-label="Stop changing that request" onClick={() => agent.setFollowUp(undefined)}>
                    ×
                  </button>
                </span>
              )}
              {agent.product && (
                <span className="inline-flex max-w-full items-center gap-1.5 border-2 border-ink px-2 py-0.5 text-[0.88rem]">
                  <span className="shrink-0 font-semibold">Product</span>
                  <span className="truncate">{shortProduct(agent.product.names?.en ?? agent.product.name)}</span>
                  <button type="button" className="shrink-0 px-1 font-bold" aria-label="Remove the product" onClick={() => agent.setProduct(undefined)}>
                    ×
                  </button>
                </span>
              )}
            </div>
          )}
          <label htmlFor="need" className="text-[0.88rem] font-semibold">
            {agent.followUp ? "What changes?" : agent.product ? "How much, and for when?" : "Ask, or say what the kitchen needs"}
          </label>
          <div className="mt-1 flex border-[3px] border-ink focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-ink">
            <input
              id="need"
              ref={fieldRef}
              value={agent.draft}
              onChange={(e) => agent.setDraft(e.target.value)}
              placeholder={agent.followUp ? "200 litres, for Thursday" : agent.product ? "40 cases for Monday" : "100 L lactose-free milk for Thursday"}
              autoComplete="off"
              enterKeyHint="send"
              className="min-h-12 min-w-0 flex-1 bg-transparent px-3 text-[1.05rem] font-semibold placeholder:font-normal placeholder:text-ink-soft/80 focus:outline-none"
            />
            {/* Microphone and "add a photo or document" mount here (see channel-slot.tsx). */}
            <ChannelSlot kitchen={kitchen.slug} lang={SPEECH[lang]} disabled={busy} onText={agent.setDraft} onSubmit={(t) => void submit(t)} />
            <button type="submit" disabled={busy} aria-busy={busy || undefined} className="inline-flex min-h-12 shrink-0 items-center gap-2 bg-ink px-4 font-semibold text-paper hover:bg-ink-soft disabled:opacity-60">
              {busy && <Target size={16} tone="hollow" spin className="text-paper" />}
              Send
            </button>
          </div>
          <p className="mt-1.5 text-[0.8rem] leading-snug text-ink-soft">Questions are answered from the product data and this kitchen&apos;s records only. A request to buy becomes order cards; it is not ordered from here.</p>
          <div className="mt-2 border-t border-ink/15 pt-2">
            <CallAgent compact />
          </div>
        </form>
      </aside>
    </>
  );
}

function Answer({ reply, base }: { reply: AskReply; base: string }) {
  return (
    <div className="border-l-4 border-ink pl-3">
      <p className={`text-[0.98rem] leading-snug ${reply.kind === "no_model" ? "text-ink-soft" : ""}`}>{reply.answer}</p>
      {reply.dataMissing && reply.kind === "answer" && <p className="mt-1 inline-block border border-dashed border-ink-soft px-1.5 text-[0.82rem] italic text-ink-soft">The records do not say: no data</p>}
      {reply.citations.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Sources">
          {reply.citations.map((c) => {
            const href = c.productId ? `${base}/catalogue/${encodeURIComponent(c.productId)}` : c.orderId && !c.orderId.startsWith("ord_hist") ? `${base}/orders/${c.orderId}` : c.kind === "memory" || c.kind === "mandate" ? `${base}/agent` : undefined;
            const label = `${c.kind === "live" ? "Live: " : c.kind === "memory" ? "Memory: " : ""}${c.label}`;
            return (
              <li key={c.id}>
                {href ? (
                  <Link href={href} className="inline-block max-w-[20rem] truncate bg-concrete px-1.5 py-0.5 text-[0.8rem] underline decoration-1 underline-offset-2">
                    {label}
                  </Link>
                ) : (
                  <span className="inline-block max-w-[20rem] truncate bg-concrete px-1.5 py-0.5 text-[0.8rem]">{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-1 text-[0.76rem] text-ink-soft">
        Looked at {reply.looked.products} product{reply.looked.products === 1 ? "" : "s"}, {reply.looked.orders} order{reply.looked.orders === 1 ? "" : "s"} and the kitchen&apos;s memory
        {reply.liveCalls ? `; ${reply.liveCalls} live price check` : "; no live call"}
        {reply.model ? `. Worded by ${reply.model}.` : "."}
      </p>
    </div>
  );
}
