"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { api } from "../../_client/api";
import { useFormat, useText } from "../../_i18n/provider";
import { Chip, buttonClass } from "../../_ui/kit";
import { AgentTurn, BuyerTurn, QuestionCard, Thread, ThreadCard } from "../../_ui/thread";
import type { InterviewStep } from "@/server/accounts/interview-run";
import type { InterviewAnswers, InterviewQuestion } from "@/server/accounts/interview";
import { Stepper } from "../[kitchen]/thread-rules";
import { DOOR_TEXT } from "../door.text";
import { INTERVIEW_TEXT } from "./thread-interview.text";

/**
 * The set-up interview, in the agent's thread form (docs/agent-thread.md "Set-up interview"): the new account's
 * second step. The server picks each question and its suggestion (server/accounts/interview.ts); this page words it,
 * shows the fitting answer widget (chips, weekday chips, a stepper, a short text) and sends the answers back. The
 * last card is the mandate as it will be signed; signing it is the account's own signing, then the device step.
 */
export function SetUpInterview({ onSigned }: { onSigned: (r: { next: string; first: boolean }) => void }) {
  const tx = useText(INTERVIEW_TEXT);
  const dx = useText(DOOR_TEXT);
  const f = useFormat();
  const [answers, setAnswers] = useState<InterviewAnswers>({});
  const [step, setStep] = useState<InterviewStep>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [askKind, setAskKind] = useState(false);
  const t0 = useRef<number>(0);
  const end = useRef<HTMLDivElement>(null);

  async function load(next: InterviewAnswers) {
    setBusy(true);
    setError(undefined);
    const r = await api<InterviewStep>("POST", "/ui-api/account/interview", { answers: next });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    if (r.data.done) return onSigned({ next: r.data.done.next, first: false });
    setAnswers(r.data.answers);
    setStep(r.data);
  }
  useEffect(() => {
    t0.current = Date.now();
    void api<InterviewStep>("POST", "/ui-api/account/interview", { answers: {} }).then((r) => {
      if (!r.ok) return setError(r.error.message);
      if (r.data.done) return onSigned({ next: r.data.done.next, first: false });
      setAnswers(r.data.answers);
      setStep(r.data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);
  useEffect(() => {
    // A block body: scrollIntoView returns a promise in newer browsers, and an effect may only return its cleanup.
    end.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [step]);

  const answer = (id: keyof InterviewAnswers, v: unknown) => void load({ ...answers, [id]: v });
  async function sign() {
    setBusy(true);
    setError(undefined);
    const r = await api<{ next: string; first: boolean }>("POST", "/ui-api/account/interview", { answers, finish: true, ms: Date.now() - t0.current });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    onSigned(r.data);
  }

  const kindName = (k: string) => tx.kinds[k] ?? k;
  const said = (id: keyof InterviewAnswers): ReactNode => {
    const v = answers[id];
    if (Array.isArray(v) && !v.length) return tx.answerNone;
    switch (id) {
      case "kind":
        return kindName(v as string);
      case "diet":
        return (v as string[]).map((c) => dx.claims[c] ?? c).join(", ");
      case "allergens":
        return (v as string[]).map((a) => dx.allergens[a] ?? a).join(", ");
      case "days":
        return f.weekdays(v as number[]);
      case "usualEur":
      case "limitEur":
      case "budgetEur":
        return tx.eur(f.num(v as number));
      default:
        return String(v);
    }
  };

  const asked = (step?.plan ?? []).filter((q) => answers[q as keyof InterviewAnswers] !== undefined && q !== step?.question?.id) as (keyof InterviewAnswers)[];
  const known = step?.known.kind && !answers.kind ? step.known.kind : undefined;
  return (
    <Thread label={tx.label}>
      <AgentTurn text={step ? tx.opening(step.restaurant) : undefined} pending={!step && !error}>
        {known && (
          <ThreadCard kind={tx.kind} tone="agent" mark={<Check aria-hidden size={14} strokeWidth={2.6} />}>
            <p className="text-[0.98rem]">{tx.knownKind(step!.restaurant, tx.kindArticle[known.value] ?? known.value, known.words)}</p>
            {!askKind ? (
              <button type="button" className={buttonClass("quiet", "sm", "mt-2")} onClick={() => setAskKind(true)}>
                {tx.notRight}
              </button>
            ) : (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.keys(tx.kinds).map((k) => (
                  <Chip key={k} on={k === known.value} onClick={() => answer("kind", k)}>
                    {kindName(k)}
                  </Chip>
                ))}
              </div>
            )}
          </ThreadCard>
        )}
      </AgentTurn>
      {asked.map((q) => (
        <Pair key={q} question={tx.q[q]} answer={said(q)} />
      ))}
      {step?.question && (
        <AgentTurn>
          <Ask key={step.question.id} q={step.question} busy={busy} onAnswer={(v) => answer(step.question!.id, v)} />
        </AgentTurn>
      )}
      {step?.terms && (
        <AgentTurn>
          <ThreadCard
            kind={tx.review}
            tone="agent"
            mark={<Check aria-hidden size={14} strokeWidth={2.6} />}
            actions={
              <button type="button" disabled={busy} className={buttonClass("go", "md")} onClick={() => void sign()}>
                {busy ? tx.signing : tx.sign}
              </button>
            }
          >
            <p className="text-[0.9rem] text-ink-soft">{tx.reviewWhy}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
              <Fact label={tx.perOrder} value={tx.eur(f.num(step.terms.perOrderLimitEur))} />
              <Fact label={tx.weekly} value={tx.eur(f.num(step.terms.weeklyBudgetEur))} />
              <Fact label={tx.always} value={step.terms.require.map((c) => dx.claims[c] ?? c).join(", ") || tx.answerNone} />
              <Fact label={tx.never} value={step.terms.forbid.map((a) => dx.allergens[a] ?? a).join(", ") || tx.answerNone} />
              <Fact label={tx.signs} value={step.terms.signer} />
            </dl>
            <p className="mt-3 text-[0.86rem] text-ink-soft">{tx.remembered}</p>
          </ThreadCard>
        </AgentTurn>
      )}
      {error && (
        <AgentTurn>
          <p role="alert" className="px-1 text-[0.95rem] font-semibold text-bad">
            {error}
          </p>
        </AgentTurn>
      )}
      <div ref={end} />
    </Thread>
  );
}

function Pair({ question, answer }: { question: ReactNode; answer: ReactNode }) {
  return (
    <>
      <AgentTurn text={question} />
      <BuyerTurn via="typed">{answer}</BuyerTurn>
    </>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.76rem] text-ink-soft">{label}</dt>
      <dd className="mt-0.5 text-[0.95rem] font-semibold leading-snug">{value}</dd>
    </div>
  );
}

/** One question with its answer widget, started at the server's suggestion; one tap on Next accepts it. */
function Ask({ q, busy, onAnswer }: { q: InterviewQuestion; busy: boolean; onAnswer: (v: unknown) => void }) {
  const tx = useText(INTERVIEW_TEXT);
  const dx = useText(DOOR_TEXT);
  const f = useFormat();
  const [picked, setPicked] = useState<string[]>(Array.isArray(q.suggested) ? q.suggested : []);
  const [amount, setAmount] = useState<number>(typeof q.suggested === "number" ? q.suggested : (q.options[0]?.amount ?? 0));
  const [text, setText] = useState("");
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const label = (id: string) => (q.id === "kind" ? (tx.kinds[id] ?? id) : q.id === "diet" ? (dx.claims[id] ?? id) : q.id === "allergens" ? (dx.allergens[id] ?? id) : q.id === "days" ? f.weekdays([Number(id)]) : id);
  const why = tx.why[q.because ?? q.id];
  const next = (
    <button
      type="button"
      disabled={busy || (q.input.kind === "text" && text.trim().length < 2) || (q.input.kind === "weekdays" && !picked.length)}
      className={buttonClass("go", "sm", "mt-3")}
      onClick={() => onAnswer(q.input.kind === "amount" ? amount : q.input.kind === "text" ? text.trim() : q.input.kind === "weekdays" ? picked.map(Number) : picked)}
    >
      {tx.next}
    </button>
  );
  const head = (
    <span className="tabular" aria-hidden>
      {tx.progress(q.n, q.of)}
    </span>
  );
  if (q.input.kind === "choice" && !q.input.multi) {
    return <QuestionCard kind={<>{tx.kind} · {head}</>} question={tx.q[q.id]} why={why} choices={q.options.map((o) => ({ id: o.id, label: label(o.id) }))} onChoose={busy ? undefined : (id) => onAnswer(id)} />;
  }
  return (
    <QuestionCard kind={<>{tx.kind} · {head}</>} question={tx.q[q.id]} why={why}>
      {(q.input.kind === "choice" || q.input.kind === "weekdays") && (
        <div className="flex flex-wrap gap-1.5">
          {q.options.map((o) => (
            <Chip key={o.id} on={picked.includes(o.id)} onClick={() => toggle(o.id)}>
              {label(o.id)}
            </Chip>
          ))}
        </div>
      )}
      {q.input.kind === "amount" && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {q.options.map((o) => (
              <Chip key={o.id} on={amount === o.amount} onClick={() => setAmount(o.amount!)}>
                {tx.eur(f.num(o.amount!))}
              </Chip>
            ))}
          </div>
          <div className="mt-3">
            <Stepper label={tx.q[q.id]} value={amount} step={q.input.step} min={q.input.min} max={q.input.max} onChange={setAmount} />
          </div>
        </>
      )}
      {q.input.kind === "text" && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {tx.roles.map((r) => (
              <Chip key={r} on={text === r} onClick={() => setText(r)}>
                {r}
              </Chip>
            ))}
          </div>
          <input aria-label={tx.q[q.id]} name="signer" value={text} onChange={(e) => setText(e.target.value)} maxLength={q.input.max} autoComplete="name" className="mt-3 min-h-11 w-full rounded-lg border border-line-strong bg-paper px-3 text-[0.98rem]" />
        </>
      )}
      {next}
    </QuestionCard>
  );
}
