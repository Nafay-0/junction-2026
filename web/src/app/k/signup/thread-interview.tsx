"use client";

import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useEffect, useRef, useState } from "react";
import { api } from "../../_client/api";
import { useFormat, useLang, useText } from "../../_i18n/provider";
import { buttonClass } from "../../_ui/kit";
import { passkeyProblemL } from "../../_ui/passkey.text";
import { AmountAnswer, ChoiceAnswer } from "../../_ui/widgets";
import { RulesSheet, SetupDone, SetupStep, SetupWelcome } from "../../_ui/widgets-more";
import type { InterviewStep } from "@/server/accounts/interview-run";
import type { InterviewAnswers, InterviewQuestion } from "@/server/accounts/interview";
import { DevicePanel } from "../_account/forms";
import { DOOR_TEXT } from "../door.text";
import { INTERVIEW_TEXT } from "./thread-interview.text";

/**
 * The set-up interview, the new account's second step (docs/agent-thread.md "Set-up interview"), with the design kit
 * (docs/DESIGN.md §7b): a welcome, one question at a time with its answer already chosen (the server picks each
 * question and its suggestion, server/accounts/interview.ts), "These are your rules" with one button that signs them
 * and adds this device's passkey to OK orders, then done and into the agent. Back loses nothing: the answers are
 * the browser's until the rules are confirmed.
 */
export function SetUpInterview({ onFinished }: { onFinished: (next: string) => void }) {
  const tx = useText(INTERVIEW_TEXT);
  const dx = useText(DOOR_TEXT);
  const f = useFormat();
  const { lang } = useLang();
  const [started, setStarted] = useState(false);
  const [pickKind, setPickKind] = useState(false);
  const [answers, setAnswers] = useState<InterviewAnswers>({});
  const [step, setStep] = useState<InterviewStep>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ next: string; device: boolean; limit: string }>();
  const t0 = useRef<number>(0);

  async function load(next: InterviewAnswers) {
    setBusy(true);
    setError(undefined);
    const r = await api<InterviewStep>("POST", "/ui-api/account/interview", { answers: next });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    if (r.data.done) return onFinished(r.data.done.next);
    setAnswers(r.data.answers);
    setStep(r.data);
  }
  useEffect(() => {
    void api<InterviewStep>("POST", "/ui-api/account/interview", { answers: {} }).then((r) => {
      if (!r.ok) return setError(r.error.message);
      if (r.data.done) return onFinished(r.data.done.next);
      setAnswers(r.data.answers);
      setStep(r.data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  const answer = (id: keyof InterviewAnswers, v: unknown) => void load({ ...answers, [id]: v });
  /** Back to the question before: its answer is dropped, so the server asks it again, with that answer chosen. */
  const back = (current?: string) => {
    const plan = (step?.plan ?? []) as (keyof InterviewAnswers)[];
    const i = current ? plan.indexOf(current as keyof InterviewAnswers) : plan.length;
    const prev = plan[i - 1];
    if (!prev) return setStarted(false);
    const next = { ...answers };
    delete next[prev];
    void load(next);
  };

  async function confirm() {
    if (!step?.terms) return;
    setBusy(true);
    setError(undefined);
    const r = await api<{ next: string; first: boolean }>("POST", "/ui-api/account/interview", { answers, finish: true, ms: Date.now() - t0.current });
    if (!r.ok) {
      setBusy(false);
      return setError(r.error.message);
    }
    // The rules are the kitchen's now; the same tap adds this device's passkey to OK orders above the limit.
    let device = false;
    if (browserSupportsWebAuthn()) {
      const begin = await api<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("POST", "/ui-api/account/device", { step: "begin" });
      if (begin.ok) {
        try {
          // A device with no passkey support can leave the prompt open for ever: after two minutes the rules stand
          // and the done screen offers the device again (or a phone).
          const response = await Promise.race([startRegistration({ optionsJSON: begin.data.options }), new Promise<never>((_, no) => setTimeout(() => no(Object.assign(new Error("timeout"), { name: "NotAllowedError" })), 120_000))]);
          device = (await api("POST", "/ui-api/account/device", { step: "verify", response })).ok;
        } catch (err) {
          setError(passkeyProblemL(err, lang).body);
        }
      }
    }
    setBusy(false);
    setDone({ next: r.data.next, device, limit: tx.eur(f.num(step.terms.perOrderLimitEur)) });
  }

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const claim = (c: string) => cap(dx.claims[c] ?? c);
  const allergen = (a: string) => cap(dx.allergens[a] ?? a);
  const list = (xs: string[], word: (x: string) => string) => (xs.length ? xs.map(word).join(", ") : tx.answerNone);

  if (done)
    return (
      <div className="space-y-4">
        <SetupDone
          title={tx.doneTitle}
          lines={[tx.doneLimit(done.limit), done.device ? tx.doneDevice : tx.noDevice, tx.doneChange]}
          start={tx.firstOrder}
          onStart={() => onFinished(done.next)}
        />
        {!done.device && <DevicePanel intro={false} />}
      </div>
    );

  const known = step?.known.kind;
  if (!started)
    return (
      <div className="space-y-3">
        <SetupWelcome
          title={tx.welcome(step?.restaurant ?? "")}
          lead={`${tx.lead}${known && !answers.kind ? ` ${tx.knownKind(tx.kindArticle[known.value] ?? known.value, known.words)}` : ""}`}
          points={tx.points}
          time={tx.time}
          start={tx.start}
          onStart={() => {
            // A tap before the first question arrived still starts: the question shows as soon as it is here.
            t0.current = Date.now();
            setStarted(true);
          }}
        />
        {known && !answers.kind && (
          <div className="px-1">
            {!pickKind ? (
              <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setPickKind(true)}>
                {tx.notRight}
              </button>
            ) : (
              <ChoiceAnswer
                kind={tx.kind}
                question={tx.q.kind}
                choices={Object.keys(tx.kinds).map((k) => ({ id: k, label: tx.kinds[k] }))}
                chosen={[known.value]}
                onChoose={(k) => {
                  t0.current = Date.now();
                  setStarted(true);
                  answer("kind", k);
                }}
              />
            )}
          </div>
        )}
        {error && <Problem text={error} />}
      </div>
    );

  if (step?.terms) {
    const t = step.terms;
    const days = answers.days ?? [];
    return (
      <div className="space-y-3">
        <SetupStep step={step.plan.length + 1} of={step.plan.length + 1} onBack={() => back()}>
          <RulesSheet
            kind={tx.rulesKind}
            title={tx.rulesTitle}
            rows={[
              { id: "limit", label: tx.perOrder, value: tx.perOrderValue(tx.eur(f.num(t.perOrderLimitEur))), detail: tx.perOrderDetail(t.signer) },
              { id: "budget", label: tx.weekly, value: tx.eur(f.num(t.weeklyBudgetEur)) },
              ...(t.require.length ? [{ id: "always", label: tx.always, value: list(t.require, claim) }] : []),
              { id: "never", label: tx.never, value: list(t.forbid, allergen) },
              ...(days.length ? [{ id: "days", label: tx.days, value: cap(f.weekdays(days)) }] : []),
              { id: "signer", label: tx.signs, value: t.signer },
            ]}
            footer={
              <button type="button" disabled={busy} onClick={() => void confirm()} className={`${buttonClass("go", "lg")} mt-1 w-full`}>
                {busy ? tx.confirming : tx.confirm}
              </button>
            }
          />
        </SetupStep>
        {error && <Problem text={error} />}
      </div>
    );
  }

  const q = step?.question;
  if (!q) return error ? <Problem text={error} /> : null;
  return (
    <div className="space-y-3">
      <Question key={q.id} q={q} busy={busy} onAnswer={(v) => answer(q.id, v)} onBack={() => back(q.id)} />
      {error && <Problem text={error} />}
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <p role="alert" className="px-1 text-[0.95rem] font-semibold text-bad">
      {text}
    </p>
  );
}

/** One question with the kit's answer widget, started at the server's suggestion; one tap on the way on accepts it. */
function Question({ q, busy, onAnswer, onBack }: { q: InterviewQuestion; busy: boolean; onAnswer: (v: unknown) => void; onBack: () => void }) {
  const tx = useText(INTERVIEW_TEXT);
  const dx = useText(DOOR_TEXT);
  const f = useFormat();
  const [picked, setPicked] = useState<string[]>(Array.isArray(q.suggested) ? q.suggested : []);
  const [amount, setAmount] = useState<number>(typeof q.suggested === "number" ? q.suggested : (q.options[0]?.amount ?? 0));
  const [role, setRole] = useState<string>(tx.roles[1]);
  const [name, setName] = useState("");
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const label = (id: string) => (q.id === "kind" ? (tx.kinds[id] ?? id) : q.id === "diet" ? cap(dx.claims[id] ?? id) : q.id === "allergens" ? cap(dx.allergens[id] ?? id) : q.id === "days" ? f.weekdays([Number(id)]) : id);
  const why = tx.why[q.because ?? q.id];
  const question = tx.q[q.id];

  if (q.input.kind === "choice" && !q.input.multi)
    return (
      <SetupStep step={q.n} of={q.of + 1} onBack={onBack}>
        <ChoiceAnswer kind={tx.kind} question={question} why={why} choices={q.options.map((o) => ({ id: o.id, label: label(o.id) }))} onChoose={(id) => !busy && onAnswer(id)} />
      </SetupStep>
    );
  if (q.input.kind === "choice" || q.input.kind === "weekdays") {
    const days = q.input.kind === "weekdays";
    return (
      <SetupStep step={q.n} of={q.of + 1} onBack={onBack} next={!days && !picked.length ? tx.none : tx.next} onNext={() => !busy && (!days || picked.length) && onAnswer(days ? picked.map(Number) : picked)}>
        <ChoiceAnswer kind={tx.kind} multiple question={question} why={why} choices={q.options.map((o) => ({ id: o.id, label: label(o.id) }))} chosen={picked} onChoose={toggle} />
      </SetupStep>
    );
  }
  if (q.input.kind === "amount") {
    const unit = q.id === "limitEur" ? tx.perOrderUnit : q.id === "budgetEur" ? tx.perWeekUnit : tx.eurUnit;
    return (
      <SetupStep step={q.n} of={q.of + 1} onBack={onBack}>
        <AmountAnswer
          kind={tx.kind}
          question={question}
          why={why}
          value={amount}
          onChange={setAmount}
          unit={unit}
          step={q.input.step}
          min={q.input.min}
          max={q.input.max}
          presets={q.options.map((o) => ({ value: o.amount!, label: tx.eur(f.num(o.amount!)) }))}
          confirm={tx.isRight(tx.eur(f.num(amount)))}
          onConfirm={() => !busy && onAnswer(amount)}
        />
      </SetupStep>
    );
  }
  // Who OKs: a role is already chosen; a name typed in replaces it.
  const signer = name.trim().length >= 2 ? name.trim() : role;
  return (
    <SetupStep step={q.n} of={q.of + 1} onBack={onBack} next={tx.next} onNext={() => !busy && onAnswer(signer)}>
      <ChoiceAnswer kind={tx.kind} multiple question={question} why={why} choices={tx.roles.map((r) => ({ id: r, label: r }))} chosen={name.trim().length >= 2 ? [] : [role]} onChoose={(r) => { setRole(r); setName(""); }} />
      <label className="block px-1">
        <span className="text-[0.84rem] text-ink-soft">{tx.orName}</span>
        <input aria-label={question} name="signer" value={name} onChange={(e) => setName(e.target.value)} maxLength={q.input.kind === "text" ? q.input.max : 60} autoComplete="name" className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-paper px-3 text-[0.98rem]" />
      </label>
    </SetupStep>
  );
}
