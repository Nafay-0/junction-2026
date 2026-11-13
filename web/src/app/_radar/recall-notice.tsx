"use client";

import { useState } from "react";
import { api } from "../_client/api";
import { useLive } from "../_client/use-live";

/**
 * The recall notice a buyer sees in the kitchen's shop when something they ordered, are ordering or regularly order
 * is named in an authority's recall notice. Plain words, the authority's own sentence of what to do (in its
 * language, with an English line under it when the reader gave one), and the original notice one tap away.
 * Drills say DRILL on every line. Renders nothing when nothing concerns this kitchen.
 *
 *   <RecallNotice kitchen="kaari" />
 */

type Evidence = { value: string; sentence?: string; verified: boolean; english?: string };
export type KitchenRecallNotice = {
  noticeId: string;
  drill: boolean;
  title: string;
  publisher: string;
  publishedOn?: string;
  url: string;
  language: string;
  productId: string;
  productName: string;
  relation: "ordering" | "waiting" | "received" | "regular";
  relationText: string;
  held: boolean;
  hazard?: Evidence;
  allergens: string[];
  action?: Evidence;
  lots?: string;
  otherLanguage?: { language: string; url: string };
};

const fiDate = (iso?: string) => (iso ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}` : "");
const LANG: Record<string, string> = { fi: "suomeksi", sv: "på svenska", en: "in English" };

export function RecallNotice({ kitchen }: { kitchen: string }) {
  const live = useLive<{ notices: KitchenRecallNotice[] }>(
    async () => {
      const r = await api<{ notices: KitchenRecallNotice[] }>("GET", `/ui-api/radar/kitchens/${encodeURIComponent(kitchen)}`);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    { events: null, pollMs: 5000 },
  );
  const [hidden, setHidden] = useState<string[]>([]);
  const notices = (live.data?.notices ?? []).filter((n) => !hidden.includes(`${n.noticeId}:${n.productId}`));
  if (!notices.length) return null;
  return (
    <section aria-label="Recall notices" className="mt-4 space-y-3">
      {notices.map((n) => (
        <article key={`${n.noticeId}:${n.productId}`} className="border-2 border-ink bg-paper" role="alert">
          <div aria-hidden className="hazard h-3" />
          <div className="px-4 py-3 sm:px-5">
            {n.drill && <p className="mb-1 inline-block bg-ink px-2 py-0.5 text-[0.8rem] font-bold uppercase tracking-wide text-chalk">Drill: not a real recall</p>}
            <p className="text-[0.85rem] font-semibold text-ink-soft">
              {n.drill ? "Drill notice" : "Recall notice"} · {n.publisher}
              {n.publishedOn ? ` · ${fiDate(n.publishedOn)}` : ""}
            </p>
            <h2 className="mt-0.5 font-display text-[1.3rem] font-bold leading-tight">
              {n.drill ? "DRILL: " : ""}
              {n.productName}
            </h2>
            <p className="mt-1 text-[1rem] font-semibold">{n.relationText}</p>
            {n.hazard && (
              <p className="mt-2 text-[0.95rem]">
                <span className="font-semibold">Why: </span>
                {n.hazard.english ?? n.hazard.value}
                {n.allergens.length > 0 && ` (${n.allergens.join(", ")})`}
              </p>
            )}
            {n.action && (
              <div className="mt-2 border-l-4 border-ink pl-3">
                <p className="text-[0.82rem] font-semibold uppercase tracking-wide text-ink-soft">What the notice says to do</p>
                <p className="text-[0.98rem]" lang={n.language}>
                  “{n.action.sentence ?? n.action.value}”
                </p>
                {n.action.english && <p className="text-[0.88rem] text-ink-soft">{n.action.english}</p>}
              </div>
            )}
            {n.lots && <p className="mt-2 text-[0.9rem] text-ink-soft">Only packs {n.lots}.</p>}
            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.95rem]">
              <a href={n.url} target="_blank" rel="noreferrer" className="font-semibold underline decoration-2 underline-offset-4">
                Open the original notice ({LANG[n.language] ?? n.language})
              </a>
              {n.otherLanguage && (
                <a href={n.otherLanguage.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  {LANG[n.otherLanguage.language] ?? n.otherLanguage.language}
                </a>
              )}
              <button type="button" onClick={() => setHidden((h) => [...h, `${n.noticeId}:${n.productId}`])} className="ml-auto text-[0.85rem] text-ink-soft underline underline-offset-2">
                Hide for now
              </button>
            </p>
          </div>
        </article>
      ))}
    </section>
  );
}
