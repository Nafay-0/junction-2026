"use client";

import { buttonClass } from "../../../../_ui/kit";

import { useEffect, useState } from "react";
import type { McpStatus } from "@/server/aiven/showcase/aiven-mcp";
import type { AnswerCard } from "@/server/aiven/showcase/copilot";
import { api } from "../../../../_client/api";
import { fi, whenSeconds } from "../../../_ui/format";
import { Button, LoadError, PageHead, Panel, Said, useOps, StaffButton } from "../../../_ui/kit";
import { Mono, PlatformTabs, Rows, Status } from "../_parts/parts";

type Info = { mcp: McpStatus; direct: boolean; suggestions: string[] };
const PIN_KEY = "dock.ops.platform.pinned";

const PATH_WORD: Record<AnswerCard["path"], string> = { "aiven-mcp": "Aiven MCP server", direct: "direct read-only path", mixed: "Aiven MCP + direct read-only", none: "nothing ran" };

/**
 * Ask the platform: one question box, answers as cards. Each card shows the path that answered, the query exactly
 * as it ran and the rows it returned. Cards can be pinned (kept in this browser).
 */
export function Copilot() {
  const info = useOps<Info>("/ops-api/platform/copilot", { pollMs: 60_000 });
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<AnswerCard[]>([]);
  const [pinned, setPinned] = useState<AnswerCard[]>([]);
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PIN_KEY);
      if (raw) queueMicrotask(() => setPinned(JSON.parse(raw) as AnswerCard[]));
    } catch {
      /* no storage: pins last for this page only */
    }
  }, []);
  const savePins = (next: AnswerCard[]) => {
    setPinned(next);
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify(next.slice(0, 12)));
    } catch {
      /* ignore */
    }
  };

  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true);
    setProblem(undefined);
    const r = await api<AnswerCard>("POST", "/ops-api/platform/copilot", { question });
    setBusy(false);
    if (!r.ok) return setProblem(r.error.message);
    setCards((c) => [r.data, ...c].slice(0, 10));
  }

  const m = info.data?.mcp;
  return (
    <>
      <PageHead title="Ask the platform" purpose="Questions in plain words, answered by code from the data on Aiven."
        about="Questions in plain words, answered from the data on Aiven. Not a chat: every answer is computed by code from the rows a read-only query returned, and the query and rows sit under it. If no query covers the question, it says the data does not say." />
      <PlatformTabs />
      <LoadError message={info.error} />
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(q);
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <label className="sr-only" htmlFor="copilot-q">
              Question
            </label>
            <input id="copilot-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder="How many orders were refused in the last hour, and by which rule?" className="field !min-h-12 min-w-0 flex-1 !rounded-full !px-5 !text-[1.02rem]" />
            <Button staff type="submit" kind="go" size="lg" disabled={busy}>
              {busy ? "Reading…" : "Ask the platform"}
            </Button>
          </form>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(info.data?.suggestions ?? []).map((s) => (
              <StaffButton
                key={s}
                onClick={() => {
                  setQ(s);
                  void ask(s);
                }}
                className="rounded-full border border-line-strong bg-paper px-3.5 py-1.5 text-left text-[0.86rem] transition-colors hover:border-petrol hover:bg-petrol-soft"
              >
                {s}
              </StaffButton>
            ))}
          </div>
          {problem && <p role="alert" className="mt-2 rounded-lg border border-bad/20 bg-bad-soft px-4 py-3 text-[0.92rem]">{problem}</p>}
          {pinned.length > 0 && (
            <section className="mt-5">
              <h2 className="display text-[1.5rem]">Pinned</h2>
              <div className="mt-2 space-y-3">
                {pinned.map((c) => (
                  <Card key={c.id} c={c} pinned onPin={() => savePins(pinned.filter((p) => p.id !== c.id))} onAgain={() => void ask(c.question)} />
                ))}
              </div>
            </section>
          )}
          <div className="mt-5 space-y-3">
            {cards.map((c) => (
              <Card key={c.id} c={c} pinned={pinned.some((p) => p.id === c.id)} onPin={() => (pinned.some((p) => p.id === c.id) ? savePins(pinned.filter((p) => p.id !== c.id)) : savePins([c, ...pinned]))} onAgain={() => void ask(c.question)} />
            ))}
          </div>
        </div>
        <aside className="space-y-3">
          <Panel className="p-5 text-[0.92rem] leading-snug">
            <h2 className="display text-[1.3rem]">Who answers</h2>
            <p className="mt-1.5 flex items-center justify-between gap-2">
              <b>Aiven MCP server</b> <Status ok={m ? (m.orgEnabled === false ? false : m.reachable) : null} label={!m ? "…" : m.orgEnabled === false ? "off" : m.reachable ? `on, ${m.tools} tools` : "not answering"} />
            </p>
            <p className="text-ink-soft">Service state, logs and metrics, with the read-only token. {m?.sql === false && "Its SQL tool needs a PG Editor permission the read-only token lacks, so SQL goes the direct way."}</p>
            {m?.instruction && <p className="mt-1 rounded-md bg-surface px-3 py-2 font-semibold">{m.instruction}</p>}
            <p className="mt-2 flex items-center justify-between gap-2">
              <b>Direct read-only path</b> <Status ok={info.data ? info.data.direct : null} label={info.data?.direct ? "configured" : "not configured"} />
            </p>
            <p className="text-ink-soft">PostgreSQL as dock_copilot. The same limits on both paths.</p>
          </Panel>
          <Panel className="p-5 text-[0.92rem] leading-snug">
            <h2 className="display text-[1.3rem]">Hard limits</h2>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>One SELECT at a time; writes, comments, catalogues and file or session functions are refused before anything is sent.</li>
              <li>
                The database user can read one view, <Mono>telemetry.ops_events</Mono>, in read-only sessions: not the orders, not kitchen memory, not partner data.
              </li>
              <li>3 seconds per statement, 200 rows per answer, 2 connections.</li>
              <li>No secrets or connection strings: every answer is scrubbed before it leaves the server.</li>
              <li>Answers are built from the rows, never written by a model.</li>
            </ul>
            <p className="mt-1.5 text-ink-soft">Try a write: type <Mono>delete from telemetry.events</Mono>.</p>
          </Panel>
        </aside>
      </div>
    </>
  );
}

function Card({ c, pinned, onPin, onAgain }: { c: AnswerCard; pinned: boolean; onPin: () => void; onAgain: () => void }) {
  return (
    <Panel className={c.refused ? "!border-safety-ink/20" : ""}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3">
        <p className="text-[0.92rem] text-ink-soft">&ldquo;{c.question}&rdquo;</p>
        <div className="flex gap-2">
          <StaffButton onClick={onAgain} className={buttonClass("quiet", "sm", "!min-h-8 text-[0.88rem]")}>
            Ask again
          </StaffButton>
          <button type="button" onClick={onPin} className={buttonClass("secondary", "sm")} aria-pressed={pinned}>
            {pinned ? "Unpin" : "Pin"}
          </button>
        </div>
      </div>
      <p className="display px-4 pt-1 text-[1.6rem] leading-[1.1]">{fi(c.answer)}</p>
      <p className="px-4 pt-1.5 text-[0.85rem] text-ink-soft">
        <b className="text-ink">{PATH_WORD[c.path]}</b>; {c.pathNote}; {whenSeconds(c.at)}
      </p>
      {c.steps.map((s, i) => (
        <div key={i} className="mt-2 border-t border-line/70 px-4 py-2">
          <p className="text-[0.85rem] text-ink-soft">
            <b className="text-ink">{s.label}</b>: {s.kind === "mcp" ? "an Aiven MCP tool call" : s.kind === "api" ? "the Aiven API" : "SQL"}, {s.path === "aiven-mcp" ? "through Aiven MCP" : "direct"}
            {s.as ? `, as ${s.as}` : ""}
            {s.ms !== undefined ? `, ${s.ms} ms` : ""}
            {s.truncated ? ", cut at the row cap" : ""}
          </p>
          <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface px-3 py-2.5 font-mono text-[0.76rem] leading-snug">{s.query}</pre>
          {s.error ? <Said text={s.error} className="mt-1 block text-[0.84rem] text-ink-soft" /> : <div className="mt-1.5"><Rows columns={s.columns} rows={s.rows} /></div>}
        </div>
      ))}
      <div className="h-2" />
    </Panel>
  );
}
