"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CornerDownLeft, MessageCircleQuestionMark, PenLine, WandSparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClarifyAnswer, ClarifyInput, ClarifyQuestion } from "@/lib/widgets/types";
import { Shimmer } from "./frame";

type ClarifyProps = {
  input: ClarifyInput;
  /** Set once answered: renders the read-only answered state. */
  answer?: ClarifyAnswer;
  onSubmit?: (answer: ClarifyAnswer) => void;
  /** The question is still streaming in; `input` may be partial. */
  loading?: boolean;
};

type QState = { selected: string[]; other: boolean; otherText: string; text: string };

const EMPTY: QState = { selected: [], other: false, otherText: "", text: "" };

function cleanQuestions(input: ClarifyInput | undefined): ClarifyQuestion[] {
  return (input?.questions ?? [])
    .filter((q): q is ClarifyQuestion => Boolean(q && q.id && q.question))
    .map((q) => ({
      ...q,
      type: q.type === "multi" || q.type === "text" ? q.type : "single",
      options: (q.options ?? []).filter((o) => o && o.label),
    }));
}

function isAnswered(q: ClarifyQuestion, s: QState) {
  if (q.type === "text") return s.text.trim().length > 0;
  const hasOther = s.other && s.otherText.trim().length > 0;
  return s.selected.length > 0 || hasOther;
}

function valueOf(q: ClarifyQuestion, s: QState): string | string[] {
  if (q.type === "text") return s.text.trim();
  const other = s.other && s.otherText.trim() ? [s.otherText.trim()] : [];
  if (q.type === "multi") return [...s.selected, ...other];
  return other[0] ?? s.selected[0] ?? "";
}

export function Clarify({ input, answer, onSubmit, loading }: ClarifyProps) {
  const questions = React.useMemo(() => cleanQuestions(input), [input]);
  const [state, setState] = React.useState<Record<string, QState>>({});
  const [submitted, setSubmitted] = React.useState<ClarifyAnswer | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  const final = answer ?? submitted;
  const get = (id: string) => state[id] ?? EMPTY;
  const update = (id: string, fn: (s: QState) => QState) =>
    setState((prev) => ({ ...prev, [id]: fn(prev[id] ?? EMPTY) }));

  const answeredCount = questions.filter((q) => isAnswered(q, get(q.id))).length;
  const canSubmit = !loading && questions.length > 0 && answeredCount === questions.length;

  const finish = (result: ClarifyAnswer) => {
    setSubmitted(result);
    onSubmit?.(result);
  };

  const submit = () => {
    if (!canSubmit) return;
    const answers: ClarifyAnswer["answers"] = {};
    for (const q of questions) answers[q.id] = valueOf(q, get(q.id));
    finish({ answers });
  };

  const heading = questions.length > 1 ? "A few quick questions" : "A quick question";

  return (
    <div className="w-full animate-rise overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-card">
      <div className="flex items-center gap-2.5 border-b border-brand/15 bg-brand-soft/55 px-4 py-2.5 sm:px-5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand/12 text-brand">
          {final ? <Check className="size-3.5" strokeWidth={2.75} /> : <MessageCircleQuestionMark className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.85rem] font-medium text-foreground">
          {final ? (final.skipped ? "Going with my best guess" : "Thanks, that helps") : heading}
        </span>
        {!final && questions.length > 1 ? (
          <span className="nums shrink-0 text-[0.75rem] text-muted-foreground">
            {answeredCount} of {questions.length}
          </span>
        ) : null}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {final ? (
          <motion.div
            key="answered"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <AnsweredSummary questions={questions} answer={final} />
          </motion.div>
        ) : (
          <motion.form
            key="form"
            ref={formRef}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="px-4 pt-3.5 pb-4 sm:px-5"
            aria-busy={loading || undefined}
          >
            {input?.intro ? (
              <p className="mb-3.5 text-[0.88rem] leading-relaxed text-muted-foreground">{input.intro}</p>
            ) : null}

            <div className="flex flex-col gap-5">
              {questions.map((q, i) => (
                <motion.fieldset
                  key={q.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.05, ease: "easeOut" }}
                  className="min-w-0"
                >
                  <legend className="mb-2.5 flex w-full items-baseline gap-2 text-[0.9rem] leading-snug font-medium">
                    {questions.length > 1 ? (
                      <span
                        className={cn(
                          "nums flex size-5 shrink-0 translate-y-[-1px] items-center justify-center self-center rounded-full text-[0.68rem] font-semibold transition-colors",
                          isAnswered(q, get(q.id)) ? "bg-brand text-primary-foreground dark:text-background" : "bg-muted text-muted-foreground",
                        )}
                        aria-hidden
                      >
                        {isAnswered(q, get(q.id)) ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1">{q.question}</span>
                    {q.type === "multi" ? (
                      <span className="shrink-0 text-[0.72rem] font-normal text-subtle">Choose any</span>
                    ) : null}
                  </legend>

                  {q.type === "text" ? (
                    <TextField
                      value={get(q.id).text}
                      placeholder={q.placeholder || "Type your answer"}
                      label={q.question}
                      onChange={(text) => update(q.id, (s) => ({ ...s, text }))}
                    />
                  ) : (
                    <ChoiceGroup
                      question={q}
                      state={get(q.id)}
                      onChange={(fn) => update(q.id, fn)}
                      onEnter={() => {
                        if (canSubmit) {
                          submit();
                          return true;
                        }
                        return false;
                      }}
                    />
                  )}
                </motion.fieldset>
              ))}

              {loading ? <QuestionSkeleton compact={questions.length > 0} /> : null}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => finish({ answers: {}, skipped: true })}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-[0.82rem] text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:-ml-3"
              >
                <WandSparkles className="size-3.5" aria-hidden />
                Skip, use your best guess
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="group/continue inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[0.85rem] font-medium text-primary-foreground shadow-card transition-[background-color,opacity,transform,box-shadow] outline-none hover:bg-primary/90 hover:shadow-float focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
              >
                Continue
                <kbd className="hidden items-center rounded border border-primary-foreground/25 px-1 py-px font-sans text-[0.65rem] text-primary-foreground/80 sm:inline-flex">
                  <CornerDownLeft className="size-3" aria-label="Enter" />
                </kbd>
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────────── Choices ───────────── */

const OTHER = "__other__";

function ChoiceGroup({
  question,
  state,
  onChange,
  onEnter,
}: {
  question: ClarifyQuestion;
  state: QState;
  onChange: (fn: (s: QState) => QState) => void;
  /** Returns true when Enter submitted the form. */
  onEnter: () => boolean;
}) {
  const multi = question.type === "multi";
  const options = question.options ?? [];
  const asList = options.some((o) => o.description);
  const items = [...options.map((o) => ({ key: o.label, label: o.label, description: o.description })), { key: OTHER, label: "Other", description: undefined }];

  const isOn = (key: string) => (key === OTHER ? state.other : state.selected.includes(key));
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const otherInput = React.useRef<HTMLInputElement>(null);
  const focusOther = React.useRef(false);

  const firstOn = items.findIndex((it) => isOn(it.key));
  const [focusIndex, setFocusIndex] = React.useState(-1);
  const tabStop = focusIndex >= 0 ? focusIndex : firstOn >= 0 ? firstOn : 0;

  const toggle = (key: string, fromKeyboardMove = false) => {
    if (key === OTHER && !fromKeyboardMove) focusOther.current = true;
    onChange((s) => {
      if (multi) {
        if (key === OTHER) return { ...s, other: !s.other };
        return {
          ...s,
          selected: s.selected.includes(key) ? s.selected.filter((k) => k !== key) : [...s.selected, key],
        };
      }
      // Single choice: picking replaces; clicking the picked option again keeps it.
      if (key === OTHER) return { ...s, selected: [], other: true };
      return { ...s, selected: [key], other: false };
    });
  };

  React.useEffect(() => {
    if (state.other && focusOther.current) {
      focusOther.current = false;
      otherInput.current?.focus();
    }
  }, [state.other]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = items.length - 1;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "Enter") {
      e.preventDefault();
      if (!onEnter()) toggle(items[index].key);
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    setFocusIndex(next);
    refs.current[next]?.focus();
    // Radios follow focus, except into "Other", which waits for an explicit pick.
    if (!multi && items[next].key !== OTHER) toggle(items[next].key, true);
  };

  const role = multi ? "checkbox" : "radio";

  return (
    <div>
      <div
        role={multi ? "group" : "radiogroup"}
        aria-label={question.question}
        className={cn(asList ? "flex flex-col gap-1.5" : "flex flex-wrap gap-2")}
      >
        {items.map((it, i) => {
          const on = isOn(it.key);
          const common = {
            ref: (el: HTMLButtonElement | null) => {
              refs.current[i] = el;
            },
            type: "button" as const,
            role,
            "aria-checked": on,
            tabIndex: i === tabStop ? 0 : -1,
            onClick: () => {
              setFocusIndex(i);
              toggle(it.key);
            },
            onFocus: () => setFocusIndex(i),
            onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => onKeyDown(e, i),
          };

          if (asList) {
            return (
              <button
                key={it.key}
                {...common}
                className={cn(
                  "flex min-h-11 w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  on ? "border-brand/50 bg-brand-soft/60" : "border-border bg-card hover:border-ring/40 hover:bg-surface",
                )}
              >
                <Indicator on={on} multi={multi} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[0.86rem] leading-5 font-medium">
                    {it.key === OTHER ? <PenLine className="size-3.5 text-subtle" aria-hidden /> : null}
                    {it.label}
                  </span>
                  {it.description ? (
                    <span className="mt-0.5 block text-[0.78rem] leading-snug text-muted-foreground">{it.description}</span>
                  ) : null}
                </span>
              </button>
            );
          }

          return (
            <button
              key={it.key}
              {...common}
              className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-[0.84rem] transition-[background-color,border-color,color,box-shadow] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9",
                on
                  ? "border-brand/55 bg-brand-soft text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--brand)_35%,transparent)]"
                  : "border-border bg-card text-foreground/85 hover:border-ring/45 hover:bg-surface hover:text-foreground",
                it.key === OTHER && !on && "border-dashed text-muted-foreground",
              )}
            >
              <AnimatePresence initial={false}>
                {on ? (
                  <motion.span
                    key="check"
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: "auto", opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                    className="-mr-0.5 flex overflow-hidden text-brand"
                  >
                    <Check className="size-3.5" strokeWidth={2.75} aria-hidden />
                  </motion.span>
                ) : it.key === OTHER ? (
                  <PenLine className="size-3.5" aria-hidden />
                ) : null}
              </AnimatePresence>
              {it.label}
            </button>
          );
        })}
      </div>

      <AnimatePresence initial={false}>
        {state.other ? (
          <motion.div
            key="other"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="pt-2">
              <TextField
                ref={otherInput}
                value={state.otherText}
                placeholder="Your own answer"
                label={`${question.question}: other`}
                onChange={(otherText) => onChange((s) => ({ ...s, otherText }))}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Indicator({ on, multi }: { on: boolean; multi: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex size-4 shrink-0 items-center justify-center border-[1.5px] transition-colors duration-150",
        multi ? "rounded-[5px]" : "rounded-full",
        on ? "border-brand bg-brand text-primary-foreground dark:text-background" : "border-subtle/60 bg-card",
      )}
    >
      {on ? (
        multi ? (
          <Check className="size-3" strokeWidth={3.25} />
        ) : (
          <span className="size-1.5 rounded-full bg-current" />
        )
      ) : null}
    </span>
  );
}

function TextField({
  ref,
  value,
  placeholder,
  label,
  onChange,
}: {
  ref?: React.Ref<HTMLInputElement>;
  value: string;
  placeholder: string;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      ref={ref}
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={label}
      maxLength={300}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-lg border border-input bg-card px-3 text-[0.88rem] text-foreground transition-[border-color,box-shadow] outline-none placeholder:text-subtle hover:border-ring/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 dark:bg-input/20"
    />
  );
}

function QuestionSkeleton({ compact }: { compact: boolean }) {
  return (
    <div aria-hidden className="space-y-2.5">
      {!compact ? <p className="text-shimmer text-[0.82rem]">Thinking of what to ask</p> : null}
      <Shimmer className="h-4 w-3/5" />
      <div className="flex flex-wrap gap-2">
        {[5.5, 7, 4.5, 6].map((w, i) => (
          <div key={i} style={{ width: `${w}rem` }}>
            <Shimmer className="h-9 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────── Answered ───────────── */

function AnsweredSummary({ questions, answer }: { questions: ClarifyQuestion[]; answer: ClarifyAnswer }) {
  const entries = Object.entries(answer.answers ?? {}).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
  const byId = new Map(questions.map((q) => [q.id, q]));
  // Keep the order the questions were asked in.
  entries.sort(([a], [b]) => {
    const ia = questions.findIndex((q) => q.id === a);
    const ib = questions.findIndex((q) => q.id === b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  if (answer.skipped || entries.length === 0) {
    return (
      <p className="px-4 py-3 text-[0.84rem] text-muted-foreground sm:px-5">
        Skipped. I will pick sensible defaults and say which ones I chose.
      </p>
    );
  }

  return (
    <dl className="divide-y divide-border/60 px-4 sm:px-5">
      {entries.map(([id, value]) => {
        const values = Array.isArray(value) ? value : [value];
        return (
          <div key={id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
            <dt className="shrink-0 text-[0.78rem] text-muted-foreground sm:w-2/5 sm:truncate">
              {byId.get(id)?.question ?? id}
            </dt>
            <dd className="flex min-w-0 flex-wrap gap-1.5">
              {values.map((v, i) => (
                <span
                  key={`${v}-${i}`}
                  className="inline-flex max-w-full items-center rounded-full bg-muted px-2.5 py-0.5 text-[0.8rem] leading-5 text-foreground"
                >
                  <span className="truncate">{v}</span>
                </span>
              ))}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
