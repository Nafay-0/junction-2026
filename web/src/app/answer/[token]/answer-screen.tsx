"use client";

import { useEffect, useState } from "react";
import { Check, Link2Off, Sparkles } from "lucide-react";
import { Card, IconDisc, Input, Panel, Spinner } from "../../_ui/kit";
import { PhoneNotice, PhoneProblem, PhoneSkeleton, bigButton } from "../../_ui/phone";

type Ask = {
  kitchenName: string;
  need?: string;
  concerns: { key: string; message: string; confirmable: boolean; corrections: { id: string; label: string }[] }[];
  questions: { id: string; text: string; options: { id: string; label: string }[] }[];
  signedInAs: string | null;
};

/** Dock's fixed choices for one waiting step, one tap each; nothing is typed but the buyer's name. */
export function AnswerScreen({ token }: { token: string }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const url = `/ui-api/answer/${encodeURIComponent(token)}`;

  useEffect(() => {
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (r.ok) setAsk(j as Ask);
        else setProblem(j?.error?.message ?? "This link cannot be used.");
      })
      .catch(() => setProblem("Dock could not be reached. Try again in a moment."));
  }, [url]);

  if (problem)
    return (
      <div className="mt-2">
        <IconDisc tone="muted" size={56}>
          <Link2Off size={25} />
        </IconDisc>
        <PhoneProblem title="This link cannot be used" body={problem} />
      </div>
    );
  if (done)
    return (
      <PhoneNotice
        title="Answer sent"
        body={done}
        mark={
          <IconDisc tone="good" size={60}>
            <Check size={28} strokeWidth={2.4} />
          </IconDisc>
        }
      />
    );
  if (!ask) return <PhoneSkeleton label="Opening the question…" />;

  const items = ask.concerns.length
    ? ask.concerns.map((c) => ({ id: c.key, text: c.message, choices: [...(c.confirmable ? [{ id: "confirm", label: "Yes, as I asked" }] : []), ...c.corrections] }))
    : ask.questions.map((q) => ({ id: q.id, text: q.text, choices: q.options }));
  const ready = items.every((i) => picked[i.id]) && (ask.signedInAs || name.trim());

  async function send() {
    setBusy(true);
    const by = ask!.signedInAs ?? name.trim();
    const body = ask!.concerns.length ? { by, responses: items.map((i) => ({ key: i.id, choice: picked[i.id] })) } : { by, answers: items.map((i) => ({ questionId: i.id, optionId: picked[i.id] })) };
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (r?.ok) setDone(j.message ?? "Thank you.");
    else setProblem(j?.error?.message ?? "Dock could not take the answer.");
  }

  return (
    <div className="flex flex-1 flex-col">
      <Panel tone="agent" className="flex gap-3.5 p-4">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-lavender-deep">
          <Sparkles size={19} />
        </span>
        <p className="min-w-0 leading-snug">
          {ask.kitchenName}&apos;s purchasing agent asked Dock for {ask.need ? <q className="font-semibold">{ask.need}</q> : "an order"}. Dock needs your own answer before it goes on.
        </p>
      </Panel>
      {items.map((i) => (
        <section key={i.id} className="mt-7">
          <h2 className="text-[1.1rem] font-semibold leading-snug">{i.text}</h2>
          <Card className="mt-3">
            <ul className="divide-y divide-line">
              {i.choices.map((c) => {
                const on = picked[i.id] === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPicked((p) => ({ ...p, [i.id]: c.id }))}
                      className={`flex min-h-14 w-full items-center gap-3.5 rounded-none px-4 py-3 text-left transition-colors duration-150 ${on ? "bg-petrol-soft font-semibold text-petrol-deep" : "hover:bg-mist"}`}
                    >
                      <span aria-hidden className={`flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] ${on ? "border-petrol bg-petrol text-paper" : "border-line-strong bg-paper"}`}>
                        {on && <Check size={14} strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 leading-snug">{c.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      ))}
      <div className="mt-7">
        {ask.signedInAs ? (
          <p className="text-ink-soft">Answering as {ask.signedInAs} (signed in on this phone).</p>
        ) : (
          <Input label="Your name" value={name} onChange={setName} maxLength={120} autoComplete="name" />
        )}
      </div>
      <div className="mt-auto pt-8">
        <button type="button" className={bigButton("go")} disabled={!ready || busy} onClick={() => void send()} aria-busy={busy || undefined}>
          {busy && <Spinner size={18} />}
          Send my answer
        </button>
        <p className="mt-3 text-center text-[0.84rem] leading-snug text-ink-soft">This link works once. Your answer is written to the order&apos;s audit trail as given on this page.</p>
      </div>
    </div>
  );
}
