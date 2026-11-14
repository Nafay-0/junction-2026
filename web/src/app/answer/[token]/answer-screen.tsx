"use client";

import { useEffect, useState } from "react";
import { Button, Field } from "../../_ui/kit";
import { PhoneNotice, PhoneProblem } from "../../_ui/phone";

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

  if (problem) return <PhoneProblem title="This link cannot be used" body={problem} />;
  if (done) return <PhoneNotice title="Answer sent" body={done} />;
  if (!ask) return <p className="mt-20 text-center text-ink-soft">Opening the question…</p>;

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
    <div className="flex flex-col gap-5">
      <p>
        {ask.kitchenName}&apos;s purchasing agent asked Dock for {ask.need ? <q>{ask.need}</q> : "an order"}. Dock needs your own answer before it goes on.
      </p>
      {items.map((i) => (
        <section key={i.id} className="flex flex-col gap-2">
          <p className="font-semibold">{i.text}</p>
          {i.choices.map((c) => (
            <Button key={c.id} kind={picked[i.id] === c.id ? "primary" : "secondary"} pressed={picked[i.id] === c.id} onClick={() => setPicked((p) => ({ ...p, [i.id]: c.id }))}>
              {c.label}
            </Button>
          ))}
        </section>
      ))}
      {ask.signedInAs ? (
        <p className="text-ink-soft">Answering as {ask.signedInAs} (signed in on this phone).</p>
      ) : (
        <Field label="Your name">
          <input className="h-12 w-full rounded-xl border border-neutral-300 px-3" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" />
        </Field>
      )}
      <Button kind="primary" busy={busy} disabled={!ready} onClick={send}>
        Send my answer
      </Button>
      <p className="text-[0.85rem] text-ink-soft">This link works once. Your answer is written to the order&apos;s audit trail as given on this page.</p>
    </div>
  );
}
