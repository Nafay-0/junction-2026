"use client";

import Link from "next/link";
import type { ConversationSummary, ConversationView } from "@/server/ops/conversation";
import { Details, Empty, KV, LoadError, Loading, PageHead, Section, useOps } from "../../_ui/kit";
import { CONVERSATIONS_TEXT } from "./conversations.text";

const DOOR: Record<string, string> = { typed: "typed in the store", voice: "voice", photo: "photo" };
const ms = (n?: number) => (n === undefined ? "–" : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);
const usd = (n?: number | null) => (n == null ? "–" : `$${n.toFixed(4)}`);
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Helsinki" });

export function Conversations() {
  const live = useOps<{ conversations: ConversationSummary[] }>("/ops-api/conversation", { pollMs: 3000 });
  return (
    <>
      <PageHead title={CONVERSATIONS_TEXT.en.title} purpose={CONVERSATIONS_TEXT.en.purpose} />
      <LoadError message={live.error} />
      {!live.data ? (
        <Loading />
      ) : live.data.conversations.length === 0 ? (
        <Empty title={CONVERSATIONS_TEXT.en.emptyTitle}>
          {CONVERSATIONS_TEXT.en.empty} Try{" "}
          <Link className="underline" href="/k/kaari?agent=open">
            /k/kaari/order
          </Link>
          .
        </Empty>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-paper">
          {live.data.conversations.map((c) => (
            <li key={c.threadId} className="px-4 py-3">
              <Link className="font-semibold underline decoration-1 underline-offset-4" href={`/ops/conversation/${c.threadId}`}>
                {c.lastWords ? `“${c.lastWords}”` : c.threadId}
              </Link>
              <p className="text-[0.86rem] text-ink-soft">
                {c.turns} turns · {c.doors.map((d) => DOOR[d] ?? d).join(", ")} · last at {time(c.lastAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ConversationScreen({ threadId }: { threadId: string }) {
  const live = useOps<ConversationView>(`/ops-api/conversation/${threadId}`, { pollMs: 2500 });
  const v = live.data;
  return (
    <>
      <PageHead title="Conversation" purpose={`One kitchen's conversation with its agent${v?.kitchen ? ` (${v.kitchen})` : ""}, from the hash-chained ledger.`} />
      <LoadError message={live.error} />
      {!v ? (
        <Loading />
      ) : (
        <>
          <p className="text-[0.95rem] text-ink-soft">
            {v.totals.turns} turns · {v.totals.modelCalls} model calls ({usd(v.totals.costUsd)}) · {v.totals.toolCalls} tool calls · {v.totals.groundingRefusals} {v.totals.groundingRefusals === 1 ? "sentence" : "sentences"} held back by the grounding check · ledger {v.chain.ok ? "verifies" : "BROKEN"} ({v.chain.length} entries)
          </p>
          <ol className="mt-4 space-y-4">
            {v.turns.map((t, i) => (
              <li key={t.turnId}>
                <Section title={`Turn ${i + 1} · ${DOOR[t.door] ?? t.door} · ${time(t.at)}`} aside={t.status ? `${t.status.replace(/_/g, " ")} · ${ms(t.ms)}` : undefined}>
                  <p className="text-[1.05rem]">{t.said ? `“${t.said}”` : t.tapped ? `Tapped: ${JSON.stringify(t.tapped)}` : "Engine follow-up"}</p>
                  <p className="mt-1 text-[0.86rem] text-ink-soft">
                    Understood {ms(t.marks?.understood)} · options {ms(t.marks?.options)} · placed {ms(t.marks?.placed ?? t.marks?.waiting)} · model {t.model.calls} calls, {ms(t.model.ms)}, {t.model.inputTokens} in ({t.model.cachedTokens} cached) / {t.model.outputTokens} out, {usd(t.model.costUsd)}
                  </p>
                  {t.requests.length > 0 && (
                    <p className="mt-1 text-[0.9rem]">
                      Requests:{" "}
                      {t.requests.map((r) => (
                        <Link key={r} className="mr-2 underline" href={`/ops/trace/${r}`}>
                          {r}
                        </Link>
                      ))}
                    </p>
                  )}
                  <ol className="mt-2 space-y-1 border-l-2 border-line pl-3 text-[0.9rem]">
                    {t.entries.map((e) => (
                      <li key={e.seq}>
                        <span className="tabular text-ink-soft">#{e.seq}</span> <span className="font-semibold">{e.event ?? e.type}</span> {e.summary}
                      </li>
                    ))}
                  </ol>
                  <Details summary="Ids">
                    <KV k="turn" v={t.turnId} />
                    <KV k="orders" v={t.orders.join(", ") || "none"} />
                  </Details>
                </Section>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}
