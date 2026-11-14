"use client";

import { ArrowUp, Camera, Check, ChevronDown, Mic, ScanFace, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Fragment, useState, type ReactNode } from "react";
import { CONVERSATIONS, LANDING, UI, agentWords, type Choice, type Lang, type Think, type Turn } from "./script";

/**
 * A design proposal, not wired to anything: three directions for the buyer's conversation with their agent.
 *
 *   /design/conversation?d=a|b|c&c=landing|working|milk|lunch|oat|reorder&lang=en|fi&open=1&frame=panel
 *
 * a  Paper    the conversation as set type: no containers, the agent's words are the page
 * b  Thread   one live line runs down the conversation; the agent's work hangs off it as branches
 * c  Stage    dark and focused: the newest reply is large, the past recedes, the thinking is a drawer of light
 */

type AgentTurn = Extract<Turn, { who: "agent" }>;
type Dir = "a" | "b" | "c";

const CSS = `
@keyframes cq-in { from { opacity: 0; transform: translateY(6px); } }
@keyframes cq-word { from { opacity: 0; filter: blur(3px); } }
@keyframes cq-sheen { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@keyframes cq-draw { from { transform: scaleY(0); } }
@keyframes cq-pulse { 0%,100% { box-shadow: 0 0 0 0 rgb(192 224 33 / .55); } 50% { box-shadow: 0 0 0 7px rgb(192 224 33 / 0); } }
@keyframes cq-caret { 50% { opacity: 0; } }
.cq-in { animation: cq-in .45s cubic-bezier(.2,.8,.2,1) both; }
.cq-sheen { background: linear-gradient(90deg, currentColor 0%, currentColor 40%, rgb(255 255 255 / .9) 50%, currentColor 60%, currentColor 100%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: cq-sheen 2.4s linear infinite; }
.cq-sheen-dark { background: linear-gradient(90deg, #5b6b72 0%, #5b6b72 40%, #c0e021 50%, #5b6b72 60%, #5b6b72 100%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: cq-sheen 2.4s linear infinite; }
.cq-draw { transform-origin: top; animation: cq-draw .9s cubic-bezier(.2,.8,.2,1) both; }
.cq-pulse { animation: cq-pulse 1.6s ease-in-out infinite; }
.cq-caret { animation: cq-caret 1s steps(1) infinite; }
nextjs-portal { display: none; }
@media (prefers-reduced-motion: reduce) { .cq-in, .cq-draw, .cq-pulse, .cq-caret, .cq-sheen, .cq-sheen-dark { animation: none !important; } .cq-sheen, .cq-sheen-dark { color: inherit; background: none; } }
`;

/** Agent text: **figure** and {{day}} marks, set inside the sentence. */
function Rich({ text, dir }: { text: string; dir: Dir }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\{\{[^}]+\}\})/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**"))
          return (
            <strong key={i} className={`whitespace-nowrap font-semibold tabular ${dir === "c" ? "text-paper" : "text-ink"}`}>
              {p.slice(2, -2)}
            </strong>
          );
        if (p.startsWith("{{"))
          return (
            <span key={i} className={`whitespace-nowrap ${dir === "c" ? "text-lime" : dir === "b" ? "font-medium text-petrol" : "font-medium text-petrol-deep bg-[linear-gradient(transparent_60%,rgb(192_224_33/.5)_60%)] px-0.5 -mx-0.5"}`}>
              {p.slice(2, -2)}
            </span>
          );
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

// ---------- thinking ----------

const TONE_MARK: Record<NonNullable<Think["tone"]> | "plain", string> = {
  plain: "bg-ink-soft/40",
  kept: "bg-good",
  left: "bg-notice",
  rule: "bg-petrol",
  live: "bg-lime",
  memory: "bg-lavender-deep",
};

function Thinking({ steps, dir, lang, defaultOpen }: { steps: Think[]; dir: Dir; lang: Lang; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const t = UI[lang];
  if (dir === "a")
    return (
      <div className="mt-3">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="group inline-flex min-h-9 items-center gap-2 text-[0.82rem] text-ink-soft transition-colors hover:text-petrol">
          <span className="flex gap-[3px]" aria-hidden>
            {steps.map((s, i) => (
              <span key={i} className={`size-[5px] rounded-full ${TONE_MARK[s.tone ?? "plain"]}`} />
            ))}
          </span>
          <span className="underline decoration-line-strong underline-offset-4 group-hover:decoration-petrol">{open ? t.hide : t.how}</span>
        </button>
        {open && (
          <ol className="cq-in mt-2 space-y-3 border-l border-line-strong pl-4">
            {steps.map((s, i) => (
              <li key={i} className="relative">
                <span aria-hidden className={`absolute -left-[1.3rem] top-[0.45em] size-[7px] rounded-full ring-2 ring-mist ${TONE_MARK[s.tone ?? "plain"]}`} />
                <p className="text-[0.88rem] font-medium leading-snug text-ink">{s.label}</p>
                {s.detail && <p className="text-[0.84rem] leading-snug text-ink-soft">{s.detail}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  if (dir === "b")
    return (
      <div className="mt-2.5">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full text-[0.8rem] font-medium text-ink-soft transition-colors hover:text-petrol">
          <span className="tabular">
            {steps.length} {t.steps}
          </span>
          <ChevronDown aria-hidden size={14} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <ol className="mt-1 space-y-2.5">
            {steps.map((s, i) => (
              <li key={i} className="cq-in relative pl-5" style={{ animationDelay: `${i * 50}ms` }}>
                <span aria-hidden className="absolute -left-[1.62rem] top-[0.62em] h-px w-[2.6rem] bg-line-strong" />
                <span aria-hidden className={`absolute left-0 top-[0.42em] size-2 rounded-full ${TONE_MARK[s.tone ?? "plain"]}`} />
                <p className="text-[0.86rem] leading-snug text-ink">
                  <span className="font-medium">{s.label}.</span> <span className="text-ink-soft">{s.detail}</span>
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  return (
    <div className="mt-4">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex min-h-9 items-center gap-2 text-[0.8rem] text-paper/55 transition-colors hover:text-lime">
        <Sparkles aria-hidden size={14} />
        {open ? t.hide : t.how}
      </button>
      {open && (
        <div className="cq-in mt-2 overflow-hidden rounded-2xl bg-[linear-gradient(160deg,rgb(238_232_245/.13),rgb(238_232_245/.04))] p-4 ring-1 ring-paper/10 backdrop-blur">
          <ol className="grid gap-3">
            {steps.map((s, i) => (
              <li key={i} className="grid grid-cols-[1.4rem_1fr] gap-2">
                <span className="display pt-0.5 text-[0.8rem] text-lime/80 tabular">{String(i + 1).padStart(2, "0")}</span>
                <p className="text-[0.86rem] leading-snug">
                  <span className="text-paper">{s.label}</span>
                  {s.detail && <span className="block text-paper/55">{s.detail}</span>}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ---------- choices ----------

function Choices({ choices, dir, ask, lang }: { choices: Choice[]; dir: Dir; ask?: string; lang: Lang }) {
  const [picked, setPicked] = useState<number>();
  const t = UI[lang];
  if (dir === "a")
    return (
      <div className="mt-3">
        <ol className="divide-y divide-line border-y border-line">
          {choices.map((c, i) => (
            <li key={c.title}>
              <button type="button" onClick={() => setPicked(i)} className={`grid w-full grid-cols-[1.5rem_1fr_auto] items-baseline gap-x-2 py-2.5 text-left transition-colors ${picked === i ? "text-ink" : picked !== undefined ? "text-ink-soft/60" : "text-ink hover:text-petrol"}`}>
                <span className="display text-[0.95rem] text-petrol tabular">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[0.98rem] font-medium leading-snug">{c.title}</span>
                  <span className="block text-[0.82rem] leading-snug text-ink-soft">{c.differs}</span>
                </span>
                <span className="text-[0.88rem] tabular">{c.price}</span>
              </button>
            </li>
          ))}
        </ol>
        {ask && (
          <p className="mt-2.5 text-[1.05rem] leading-relaxed text-ink">
            {ask} <span className="text-[0.82rem] text-ink-soft">{t.words}</span>
          </p>
        )}
      </div>
    );
  if (dir === "b")
    return (
      <div className="mt-3">
        <div className="flex flex-col gap-1.5">
          {choices.map((c, i) => (
            <button key={c.title} type="button" onClick={() => setPicked(i)} className={`group flex items-baseline gap-3 rounded-xl px-3 py-2 text-left transition-colors ${picked === i ? "bg-petrol text-paper" : "bg-paper/70 hover:bg-paper"}`}>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.95rem] font-medium leading-snug">{c.title}</span>
                <span className={`block text-[0.8rem] leading-snug ${picked === i ? "text-paper/75" : "text-ink-soft"}`}>{c.differs}</span>
              </span>
              <span className="shrink-0 text-[0.86rem] tabular">{c.price}</span>
            </button>
          ))}
        </div>
        {ask && (
          <p className="mt-2.5 text-[1.02rem] leading-relaxed">
            {ask} <span className="text-[0.8rem] text-ink-soft">{t.words}</span>
          </p>
        )}
      </div>
    );
  return (
    <div className="mt-4">
      <ol className="grid gap-px overflow-hidden rounded-2xl bg-paper/10">
        {choices.map((c, i) => (
          <li key={c.title}>
            <button type="button" onClick={() => setPicked(i)} className={`grid w-full grid-cols-[2rem_1fr_auto] items-baseline gap-x-2 px-4 py-3 text-left transition-colors ${picked === i ? "bg-lime text-ink" : "bg-petrol-deep hover:bg-[#0a4556]"}`}>
              <span className={`display text-[1.15rem] tabular ${picked === i ? "text-ink" : "text-lime"}`}>{i + 1}</span>
              <span className="min-w-0">
                <span className="block text-[0.98rem] leading-snug">{c.title}</span>
                <span className={`block text-[0.8rem] leading-snug ${picked === i ? "text-ink/70" : "text-paper/55"}`}>{c.differs}</span>
              </span>
              <span className="text-[0.86rem] tabular">{c.price}</span>
            </button>
          </li>
        ))}
      </ol>
      {ask && (
        <p className="mt-3 text-[1.05rem] leading-relaxed text-paper/90">
          {ask} <span className="text-[0.8rem] text-paper/45">{t.words}</span>
        </p>
      )}
    </div>
  );
}

// ---------- the list, the memory line, the one action ----------

function ShortList({ list, dir, lang }: { list: NonNullable<AgentTurn["list"]>; dir: Dir; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const t = UI[lang];
  const dark = dir === "c";
  return (
    <div className="mt-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`inline-flex min-h-9 items-center gap-1.5 text-[0.84rem] font-medium ${dark ? "text-paper/60 hover:text-lime" : "text-petrol"}`}>
        {open ? t.hideList : `${t.list} (${list.label})`}
        <ChevronDown aria-hidden size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <table className={`cq-in mt-1 w-full text-[0.88rem] ${dark ? "text-paper/85" : ""}`}>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r.item} className={dark ? "border-b border-paper/10" : "border-b border-line"}>
                <td className="py-1.5 pr-2 leading-snug">{r.item}</td>
                <td className="py-1.5 pr-3 text-right tabular opacity-70">{r.amount} ×</td>
                <td className="py-1.5 text-right tabular">{r.total}</td>
              </tr>
            ))}
            <tr>
              <td className="pt-2 font-semibold" colSpan={2}>
                {t.total}
              </td>
              <td className="pt-2 text-right font-semibold tabular">{list.total}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function Memory({ text, dir, lang }: { text: string; dir: Dir; lang: Lang }) {
  return (
    <p className={`mt-3 flex items-start gap-2 text-[0.88rem] leading-snug ${dir === "c" ? "text-[#cbbbe6]" : "text-lavender-deep"}`}>
      <Sparkles aria-hidden size={15} className="mt-[0.15em] shrink-0" />
      <span>
        <span className="font-medium">{UI[lang].remembered}:</span> {text}
      </span>
    </p>
  );
}

/** The one necessary action: a person approves an exact order with their face or finger. The yellow lives here only. */
function SignOff({ s, dir, lang, done }: { s: NonNullable<AgentTurn["signoff"]>; dir: Dir; lang: Lang; done?: boolean }) {
  const t = UI[lang];
  return (
    <div className={`cq-in mt-4 overflow-hidden rounded-[1.4rem] ${dir === "c" ? "bg-[#0e1316] ring-1 ring-safety/30" : "bg-safety-ink"} text-paper`}>
      <div className="hazard-thin h-1.5" />
      <div className="p-4 pt-3.5">
        <p className="text-[0.78rem] font-medium tracking-wide text-safety">{t.signHeader}</p>
        <p className="display mt-1.5 text-[2.1rem] leading-none tabular">{s.total}</p>
        <p className="mt-2 text-[0.92rem] leading-snug text-paper/85">{s.what}</p>
        <p className="text-[0.86rem] leading-snug text-paper/55">
          {s.when.replace(/\.$/, "")}. {s.why}
        </p>
        {done ? (
          <p className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-full bg-paper/10 text-[0.95rem] font-semibold text-lime">
            <Check aria-hidden size={18} strokeWidth={2.6} /> {s.done}
          </p>
        ) : (
          <button type="button" className="mt-4 flex min-h-13 w-full items-center justify-center gap-2.5 rounded-full bg-lime text-[1rem] font-semibold text-ink transition-transform active:scale-[0.98]">
            <ScanFace aria-hidden size={21} />
            {t.ok}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- turns, per direction ----------

function BuyerLine({ text, dir, via, last }: { text: string; dir: Dir; via?: "voice"; last?: boolean }) {
  if (dir === "a")
    return (
      <div className="cq-in flex justify-end">
        <p className="max-w-[80%] border-r-2 border-lime pr-3 text-right text-[0.95rem] leading-snug text-ink-soft">
          {via === "voice" && <Mic aria-hidden size={13} className="mr-1 inline -translate-y-px" />}
          {text}
        </p>
      </div>
    );
  if (dir === "b")
    return (
      <div className="cq-in -ml-7 flex items-start gap-3">
        <span aria-hidden className="relative z-10 mt-[0.45em] size-2.5 shrink-0 rounded-full border-2 border-petrol bg-mist" />
        <p className="display text-[1.2rem] leading-tight text-petrol-deep">
          {via === "voice" && <Mic aria-hidden size={15} className="mr-1.5 inline -translate-y-0.5 text-ink-soft" />}
          {text}
        </p>
      </div>
    );
  return (
    <p className={`cq-in text-right leading-snug ${last ? "text-[1rem] text-lime" : "text-[0.86rem] text-paper/40"}`}>
      {via === "voice" && <Mic aria-hidden size={13} className="mr-1 inline -translate-y-px" />}
      {text}
    </p>
  );
}

function AgentBlock({ turn, dir, lang, openThinking, latest, signed }: { turn: AgentTurn; dir: Dir; lang: Lang; openThinking?: boolean; latest?: boolean; signed?: string }) {
  const words = agentWords(turn);
  const body = (
    <>
      <p
        data-agent-words={words}
        className={
          dir === "a"
            ? "max-w-[36ch] text-[1.12rem] leading-[1.6] text-ink [text-wrap:pretty]"
            : dir === "b"
              ? "max-w-[38ch] text-[1.02rem] leading-[1.6] text-ink [text-wrap:pretty]"
              : `${latest ? "display text-[1.45rem] leading-[1.3] text-paper" : "text-[0.92rem] leading-snug text-paper/45"} max-w-[30ch] [text-wrap:pretty]`
        }
      >
        <Rich text={turn.text} dir={dir} />
      </p>
      {turn.choices && (dir !== "c" || latest) && <Choices choices={turn.choices} dir={dir} ask={turn.orWords} lang={lang} />}
      {turn.list && (dir !== "c" || latest) && <ShortList list={turn.list} dir={dir} lang={lang} />}
      {turn.memory && <Memory text={turn.memory} dir={dir} lang={lang} />}
      {turn.signoff && (dir !== "c" || latest || signed) && <SignOff s={{ ...turn.signoff, done: signed }} dir={dir} lang={lang} done={!!signed} />}
      {turn.thinking && (dir !== "c" || latest) && <Thinking steps={turn.thinking} dir={dir} lang={lang} defaultOpen={openThinking} />}
    </>
  );
  if (dir === "b")
    return (
      <div className="cq-in relative">
        <span aria-hidden className="absolute -left-[1.94rem] top-[0.4em] flex size-[1.15rem] items-center justify-center rounded-full bg-petrol">
          <span className="size-1.5 rounded-full bg-lime" />
        </span>
        {body}
      </div>
    );
  return <div className="cq-in">{body}</div>;
}

// ---------- the first second ----------

function Working({ dir, lang, line }: { dir: Dir; lang: Lang; line: string }) {
  const t = UI[lang];
  if (dir === "b")
    return (
      <div className="relative">
        <span aria-hidden className="cq-pulse absolute -left-[1.94rem] top-[0.3em] size-[1.15rem] rounded-full bg-lime" />
        <p className="cq-sheen text-[1.02rem] font-medium text-petrol">{line}</p>
      </div>
    );
  if (dir === "c")
    return (
      <p className="display text-[1.45rem] leading-[1.3]">
        <span className="cq-sheen-dark">{line}</span>
      </p>
    );
  return (
    <p className="text-[1.12rem] leading-[1.6] text-ink-soft" aria-label={t.working}>
      {line}
      <span aria-hidden className="cq-caret ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-petrol" />
    </p>
  );
}

// ---------- the composer: the only permanent control ----------

function Composer({ dir, lang }: { dir: Dir; lang: Lang }) {
  const t = UI[lang];
  const dark = dir === "c";
  return (
    <div className={`flex items-center gap-1 rounded-full p-1.5 pl-5 ${dark ? "bg-paper/8 ring-1 ring-paper/15" : dir === "b" ? "bg-paper shadow-[0_8px_30px_-12px_rgb(0_54_70/.35)]" : "border border-line-strong bg-paper"}`}>
      <span className={`min-w-0 flex-1 truncate text-[0.98rem] ${dark ? "text-paper/45" : "text-ink-soft"}`}>{t.placeholder}</span>
      <span className={`flex size-11 items-center justify-center rounded-full ${dark ? "text-paper/60" : "text-ink-soft"}`}>
        <Camera aria-hidden size={19} />
      </span>
      <span className={`flex size-11 items-center justify-center rounded-full ${dark ? "text-paper/60" : "text-ink-soft"}`}>
        <Mic aria-hidden size={19} />
      </span>
      <span className="flex size-11 items-center justify-center rounded-full bg-lime text-ink">
        <ArrowUp aria-hidden size={20} strokeWidth={2.4} />
      </span>
    </div>
  );
}

// ---------- a whole surface ----------

function Surface({ dir, lang, conv, open, panel, still }: { dir: Dir; lang: Lang; conv: string; open: boolean; panel: boolean; still?: boolean }) {
  const data = CONVERSATIONS[lang].find((c) => c.id === conv) ?? CONVERSATIONS.en.find((c) => c.id === conv);
  const landing = LANDING[lang];
  const ground = dir === "c" ? "bg-petrol-deep text-paper" : dir === "b" ? "bg-mist" : "bg-[#fbfcfc]";
  const name = lang === "fi" ? "Ostoagentti" : "Your buying agent";

  let content: ReactNode;
  if (conv === "landing" || conv === "working") {
    const first = (CONVERSATIONS[lang][0] ?? CONVERSATIONS.en[0]).turns[0];
    content = (
      <div className={`flex flex-1 flex-col ${conv === "landing" ? "justify-end" : ""} gap-6`}>
        {conv === "landing" ? (
          <div className="cq-in">
            <h1 className={`display text-[2.2rem] leading-[1.05] ${dir === "c" ? "text-paper" : "text-ink"}`}>{landing.greeting}</h1>
            <p className={`mt-3 max-w-[34ch] text-[1.1rem] leading-[1.6] ${dir === "c" ? "text-paper/80" : "text-ink"}`}>
              <Rich text={landing.today} dir={dir} />
            </p>
            <ul className="mt-6 flex flex-col gap-1.5">
              {landing.examples.map((e) => (
                <li key={e} className={`text-[0.92rem] ${dir === "c" ? "text-paper/40" : "text-ink-soft"}`}>
                  “{e}”
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            {first.who === "buyer" && <BuyerLine text={first.text} dir={dir} last />}
            <Working dir={dir} lang={lang} line={lang === "fi" ? "Katson tavallista maitoasi ja maanantain toimituksia" : "Looking at your usual milk and Monday's deliveries"} />
          </>
        )}
      </div>
    );
  } else if (data) {
    const turns = data.turns;
    const lastAgent = turns.map((t, i) => (t.who === "agent" ? i : -1)).filter((i) => i >= 0).pop();
    const firstThinking = turns.findIndex((t) => t.who === "agent" && t.thinking);
    const signedLater = (i: number) => {
      const t = turns[i];
      if (t.who !== "agent" || !t.signoff) return undefined;
      return turns.slice(i + 1).some((x) => x.who === "agent") ? (lang === "fi" ? "Hyväksytty klo 07.04" : "OK'd at 07.04") : undefined;
    };
    const lastBuyer = turns.map((t, i) => (t.who === "buyer" ? i : -1)).filter((i) => i >= 0).pop();
    content = (
      <div className={`flex flex-col ${dir === "c" ? "gap-5" : "gap-7"}`}>
        {turns.map((t, i) =>
          t.who === "buyer" ? (
            <BuyerLine key={i} text={t.text} dir={dir} via={t.via} last={i === lastBuyer} />
          ) : (
            <AgentBlock key={i} turn={t} dir={dir} lang={lang} openThinking={open && i === firstThinking} latest={i === lastAgent || (dir === "c" && open && i === firstThinking)} signed={signedLater(i)} />
          ),
        )}
      </div>
    );
  }

  return (
    <div className={`flex min-h-dvh flex-col ${ground} ${panel ? "w-[27rem] shrink-0 border-l border-line" : "w-full"}`}>
      <header className={`flex items-center gap-2.5 px-5 pb-2 pt-4 ${dir === "c" ? "text-paper/70" : "text-ink-soft"}`}>
        <span className={`size-2.5 rounded-full ${dir === "c" ? "bg-lime" : "bg-petrol"}`} />
        <span className="text-[0.86rem] font-medium">{name}</span>
        <span className="ml-auto text-[0.76rem] opacity-70">{lang === "fi" ? "Hotel Lumo" : "Hotel Lumo"}</span>
      </header>
      <main className={`flex flex-1 flex-col px-5 pb-5 pt-4 ${dir === "b" ? "relative pl-12" : ""}`}>
        {dir === "b" && <span aria-hidden className={`cq-draw absolute bottom-0 left-[1.62rem] top-0 w-px ${conv === "working" ? "bg-gradient-to-b from-petrol via-petrol to-lime" : "bg-petrol/30"}`} />}
        {content}
      </main>
      <footer className={`${still ? "" : "sticky bottom-0"} px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 ${dir === "c" ? "bg-gradient-to-t from-petrol-deep via-petrol-deep to-transparent" : dir === "b" ? "bg-gradient-to-t from-mist via-mist to-transparent" : "bg-gradient-to-t from-[#fbfcfc] via-[#fbfcfc] to-transparent"}`}>
        <Composer dir={dir} lang={lang} />
      </footer>
    </div>
  );
}

export function Proposal() {
  const q = useSearchParams();
  const dir = (["a", "b", "c"].includes(q.get("d") ?? "") ? q.get("d") : "a") as Dir;
  const lang = (q.get("lang") === "fi" ? "fi" : "en") as Lang;
  const conv = q.get("c") ?? "milk";
  const open = q.get("open") === "1";
  const panel = q.get("frame") === "panel";
  // For screenshots of a whole conversation: the composer sits at the end instead of floating over it.
  const still = q.get("still") === "1";
  return (
    <>
      <style>{CSS}</style>
      {panel ? (
        <div className="flex min-h-dvh bg-mist">
          <div aria-hidden className="hidden flex-1 flex-col gap-5 p-8 md:flex">
            <div className="h-9 w-56 rounded-full bg-paper" />
            <div className="h-40 rounded-3xl bg-petrol-deep/85" />
            <div className="grid grid-cols-3 gap-4">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-36 rounded-2xl bg-paper" />
              ))}
            </div>
          </div>
          <Surface dir={dir} lang={lang} conv={conv} open={open} panel still={still} />
        </div>
      ) : (
        <Surface dir={dir} lang={lang} conv={conv} open={open} panel={false} still={still} />
      )}
    </>
  );
}
