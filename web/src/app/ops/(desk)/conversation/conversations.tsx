"use client";

import Link from "next/link";
import type { ConversationSummary, ConversationView } from "@/server/ops/conversation";
import { fi, when } from "../../_ui/format";
import { Details, Empty, KV, LoadError, Loading, PageHead, Section, useOps } from "../../_ui/kit";

const DOOR: Record<string, string> = { typed: "typed in the store", voice: "voice", photo: "photo" };
const ms = (n?: number) => (n === undefined ? "–" : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);
const usd = (n?: number | null) => (n == null ? "–" : `$${n.toFixed(4)}`);
const time = (iso: string) => when(iso);
/** A ledger entry's kind in words: "watch_said" -> "watch said". */
const kind = (k: string) => fi(k).replaceAll("_", " ");

export function Conversations() {
  const live = useOps<{ conversations: ConversationSummary[] }>("/ops-api/conversation", { pollMs: 3000 });
  return (
    <>
      <PageHead title="Conversations" purpose="Each kitchen's conversation with its own agent, as one record."
        about="Each kitchen's conversation with its own agent, typed or spoken, as one record: every turn, model call, tool call and gate decision." />
      <LoadError message={live.error} />
      {!live.data ? (
        <Loading />
      ) : live.data.conversations.length === 0 ? (
        <Empty title="No conversation yet">
          When a buyer talks to their agent in the store, the conversation appears here. Try{" "}
          <Link className="underline" href="/k/kaari?agent=open">
            /k/kaari/order
          </Link>
          .
        </Empty>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-paper">
          {live.data.conversations.map((c) => (
            <li key={c.threadId} className="px-4 py-3">
              <Link className="font-semibold underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol" href={`/ops/conversation/${c.threadId}`} title={c.threadId}>
                {c.orgName ?? c.kitchen ?? "A kitchen"}
              </Link>
              {c.lastWords && <p className="mt-0.5 line-clamp-2 leading-snug">“{c.lastWords}”</p>}
              <p className="mt-0.5 text-[0.86rem] text-ink-soft">
                {c.turns} {c.turns === 1 ? "turn" : "turns"} · {c.doors.map((d) => DOOR[d] ?? d).join(", ")} · last {time(c.lastAt)}
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
      <PageHead title="Conversation" purpose="One kitchen's conversation with its own agent, turn by turn, from the hash-chained ledger." />
      <LoadError message={live.error} />
      {!v ? (
        <Loading />
      ) : (
        <>
          <p className="text-[0.95rem] text-ink-soft">
            {v.totals.turns} {v.totals.turns === 1 ? "turn" : "turns"} · {v.totals.modelCalls} model calls ({usd(v.totals.costUsd)}) · {v.totals.toolCalls} tool calls · {v.totals.groundingRefusals} {v.totals.groundingRefusals === 1 ? "sentence" : "sentences"} held back by the grounding check · ledger {v.chain.ok ? "verifies" : "BROKEN"} ({v.chain.length} entries)
          </p>
          <ol className="mt-4 space-y-4">
            {v.turns.map((t, i) => (
              <li key={t.turnId}>
                <Section title={`Turn ${i + 1} · ${DOOR[t.door] ?? t.door} · ${time(t.at)}`} aside={t.status ? `${t.status.replace(/_/g, " ")}${t.ms !== undefined ? ` · ${ms(t.ms)}` : ""}` : undefined}>
                  <p className="text-[1.05rem]">{t.said ? `“${t.said}”` : t.tapped ? `Tapped: ${JSON.stringify(t.tapped)}` : "Engine follow-up"}</p>
                  <p className="mt-1 text-[0.86rem] text-ink-soft">
                    Understood {ms(t.marks?.understood)} · options {ms(t.marks?.options)} · placed {ms(t.marks?.placed ?? t.marks?.waiting)} · model {t.model.calls} calls, {ms(t.model.ms)}, {t.model.inputTokens} in ({t.model.cachedTokens} cached) / {t.model.outputTokens} out, {usd(t.model.costUsd)}
                  </p>
                  {t.requests.length > 0 && (
                    <p className="mt-1 text-[0.9rem]">
                      Requests:{" "}
                      {t.requests.map((r) => (
                        <Link key={r} className="mr-3 underline" href={`/ops/trace/${r}`} title={r}>
                          trace {t.requests.indexOf(r) + 1}
                        </Link>
                      ))}
                    </p>
                  )}
                  <ol className="mt-2 space-y-1 border-l-2 border-line pl-3 text-[0.9rem]">
                    {t.entries.map((e) => (
                      <li key={e.seq}>
                        <span className="tabular text-ink-soft" title={`Ledger entry ${e.seq}: ${e.event ?? e.type}`}>{time(e.at)}</span> <span className="font-semibold">{kind(e.event ?? e.type)}</span> {fi(e.summary)}
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
