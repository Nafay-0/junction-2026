"use client";

import { STAFF_ONLY, useViewer } from "./role";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../_client/api";
import { useLive } from "../../_client/use-live";
import { Check, ChevronRight } from "lucide-react";
import { buttonClass } from "../../_ui/kit";
import { Target } from "../../_ui/target";
import { VIA, envOut, type Via } from "./format";

/**
 * The operations portal's building blocks, in the shared system's language (web/docs/DESIGN.md): white cards with
 * hairlines on mist, the display face for titles and figures, quiet status marks. Safety yellow and the hazard stripe
 * appear only on refusals, suspensions and sign-offs waiting on a person. Ids, codes and hashes sit behind <Details>.
 */

/** Live data from /ops-api: refetched on every order/approval event and polled underneath. 401 sends to the entry. */
export function useOps<T>(path: string | null, { pollMs = 2500 }: { pollMs?: number } = {}) {
  const router = useRouter();
  return useLive<T>(
    async () => {
      const r = await api<T>("GET", path!);
      if (!r.ok) {
        if (r.status === 401) router.replace(`/ops/enter?next=${encodeURIComponent(location.pathname)}`);
        throw new Error(r.error.message);
      }
      return r.data;
    },
    { events: path ? "/api/v1/events" : null, enabled: !!path, pollMs, pollMsStreaming: pollMs + 1500 },
  );
}

/** A clock that ticks, for "waited 3 min" and countdowns. Undefined until mounted, so hydration matches. */
export function useNow(ms = 1000): number | undefined {
  const [now, setNow] = useState<number>();
  useEffect(() => {
    const tick = () => setNow(Date.now());
    queueMicrotask(tick);
    const t = setInterval(tick, ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * The page's top, the same on every operations page: the title, one line saying what the page is for, and on the right
 * whether it is live (or the page's one action). The longer explanation, when there is one, waits behind "How this
 * page works".
 */
export function PageHead({ title, purpose, about, right }: { title: string; purpose: string; about?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-6">
      <div className="min-w-0 max-w-[72ch]">
        <h1 className="display text-[1.9rem] leading-[1.1] text-ink sm:text-[2.2rem]">{title}</h1>
        <p className="mt-2 text-[1rem] leading-relaxed text-ink-soft">{purpose}</p>
        {about && (
          <details className="group mt-1 text-[0.92rem]">
            <summary className="inline-flex min-h-9 max-sm:min-h-11 cursor-pointer select-none list-none items-center gap-1 rounded-full pr-2 font-medium text-petrol hover:underline [&::-webkit-details-marker]:hidden">
              <ChevronRight aria-hidden size={15} className="transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
              How this page works
            </summary>
            <p className="mt-1 max-w-[68ch] leading-relaxed text-ink-soft">{about}</p>
          </details>
        )}
      </div>
      {right && <div className="flex flex-wrap items-center gap-3 text-[0.86rem] text-ink-soft">{right}</div>}
    </header>
  );
}

/** "Live, updated 14.05.32": a dot that breathes while the stream is up. */
export function LiveMark({ at, error }: { at?: string; error?: string }) {
  return (
    <span className={`inline-flex min-h-8 items-center gap-2 whitespace-nowrap rounded-full px-3 text-[0.82rem] font-medium tabular ${error ? "bg-surface text-ink-soft" : "bg-good-soft text-good"}`} role="status">
      <span aria-hidden className={`size-2 rounded-full ${error ? "border border-ink-soft" : "breathe bg-good"}`} />
      {error ? "Reconnecting…" : at ? `Live, updated ${at}` : "Connecting…"}
    </span>
  );
}

export function Section({ title, aside, children, id, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; id?: string; className?: string }) {
  return (
    <section aria-labelledby={id} className={`mt-10 ${className}`}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="display text-[1.35rem] text-ink sm:text-[1.45rem]">
          {title}
        </h2>
        {aside && <div className="text-[0.86rem] text-ink-soft">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** A card. `rule` once drew a petrol top rule; the new system has none, so it is accepted and ignored. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string; rule?: boolean }) {
  return <div className={`overflow-hidden rounded-xl border border-line bg-paper ${className}`}>{children}</div>;
}

/** The door an agent came through. Same shape for all three: they meet the same gate. */
export function ViaTag({ via, className = "", short = false }: { via?: Via; className?: string; short?: boolean }) {
  if (!via) return <span className={`text-[0.85rem] text-ink-soft ${className}`}>Door not recorded</span>;
  return (
    <span title={VIA[via].how} className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[0.86rem] font-medium text-petrol-deep ${className}`}>
      <DoorGlyph via={via} />
      {short ? VIA[via].short : VIA[via].label}
    </span>
  );
}

/** Three marks, one per door: a filled square (on-site), a split square (MCP), an open square (REST). */
export function DoorGlyph({ via, size = 11, color = "currentColor" }: { via: Via; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden className="shrink-0">
      <rect x="0.75" y="0.75" width="8.5" height="8.5" rx="2" fill={via === "onsite" ? color : "none"} stroke={color} strokeWidth="1.5" />
      {via === "mcp" && <path d="M1.6 8.4 L8.4 1.6 L8.4 7 Q8.4 8.4 7 8.4 Z" fill={color} />}
    </svg>
  );
}

export type Tone = "plain" | "safety" | "done";

/**
 * Outcome words. The gate's mark and yellow only when a person must act or the gate refused; a signed order gets a
 * green tick, anything still moving an open ring.
 */
export function Outcome({ kind, label, size = "sm" }: { kind: string; label: string; size?: "sm" | "md" }) {
  const gate = kind === "waiting" || kind === "refused" || kind === "declined";
  const text = size === "md" ? "text-[0.98rem]" : "text-[0.88rem]";
  return (
    <span className={`inline-flex items-start gap-2 font-medium leading-snug ${text} ${kind === "committed" ? "text-good" : gate ? "text-ink" : "text-ink-soft"}`}>
      <span className="mt-[0.15em] shrink-0">
        {gate ? (
          <Target size={15} tone="safety" />
        ) : kind === "committed" ? (
          <span aria-hidden className="flex size-[15px] items-center justify-center rounded-full bg-good text-paper">
            <Check size={10} strokeWidth={3.5} />
          </span>
        ) : (
          <span aria-hidden className="block size-[13px] rounded-full border-[1.5px] border-current" />
        )}
      </span>
      <span>{label}</span>
    </span>
  );
}

export function Licence({ licence }: { licence: { level: string; name: string; rating?: number } | null | undefined }) {
  if (!licence) return <span className="text-[0.85rem] text-ink-soft">Not crash-tested yet</span>;
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap text-[0.88rem] font-medium">
      <span className="rounded-full bg-petrol-soft px-2 text-[0.76rem] font-semibold leading-5 text-petrol-deep">{licence.level}</span>
      {licence.name}
      {licence.rating !== undefined && <span className="font-normal text-ink-soft tabular">{licence.rating.toFixed(1).replace(".", ",")}</span>}
    </span>
  );
}

/** Ids, codes and hashes: there when someone asks, out of the way otherwise. `dark` on the gate's slab. */
export function Details({ summary = "Details", children, className = "", dark = false }: { summary?: string; children: ReactNode; className?: string; dark?: boolean }) {
  return (
    <details className={`group text-[0.82rem] ${className}`}>
      <summary className={`inline-flex min-h-8 max-sm:min-h-11 cursor-pointer select-none list-none items-center gap-1 rounded-full pr-2 [&::-webkit-details-marker]:hidden ${dark ? "text-paper/70 hover:text-paper" : "text-ink-soft hover:text-ink"}`}>
        <ChevronRight aria-hidden size={14} className="transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
        <span>{summary}</span>
      </summary>
      <div className={`mt-1.5 space-y-1 break-all rounded-md px-3 py-2 font-mono text-[0.75rem] leading-relaxed ${dark ? "bg-paper/8 text-paper/75" : "bg-surface text-ink/85"}`}>{children}</div>
    </details>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 opacity-75">{k}</span>
      <span>{v}</span>
    </div>
  );
}

/** An empty state is a direction: what is not here yet, and what makes it appear. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-paper/60 px-5 py-5 sm:px-6">
      <p className="text-[1.05rem] font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-[70ch] text-[0.95rem] leading-relaxed text-ink-soft">{children}</div>}
      {action && <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2">{action}</div>}
    </div>
  );
}

export function LoadError({ message }: { message?: string }) {
  if (!message) return null;
  const said = envOut(message);
  // A service this server does not have is not a failure: say so calmly, the setting's name behind a detail.
  if (said.names.length)
    return (
      <div role="status" className="mb-4 rounded-lg border border-line bg-surface px-4 py-3 text-[0.95rem]">
        <Said text={message} />
      </div>
    );
  return (
    <p role="status" className="mb-4 rounded-lg border border-bad/20 bg-bad-soft px-4 py-3 text-[0.95rem]">
      <b className="font-semibold">Could not refresh from AimoPilot.</b> {message} The view shows the last data it had and keeps trying.
    </p>
  );
}

/** A server note in words; environment variable names it carries wait behind "Setting". */
export function Said({ text, className = "" }: { text?: string | null; className?: string }) {
  const said = envOut(text);
  return (
    <span className={className}>
      {said.text}
      {said.names.length > 0 && (
        <Details summary="Setting" className="mt-0.5">
          {said.names.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </Details>
      )}
    </span>
  );
}

/** Loading, in the shape of what is coming: a diagram and a few rows. */
export function Loading({ label = "Reading the gate…" }: { label?: string }) {
  return (
    <div className="mt-2" role="status" aria-label={label}>
      <div className="skeleton h-44 !rounded-[20px]" />
      <div className="skeleton mt-8 h-6 w-56" />
      <div className="mt-4 space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-14" />
        ))}
      </div>
      <p className="sr-only">{label}</p>
    </div>
  );
}

/** A figure: the number in the display face, its meaning under it. `safety` only when a person must act. */
export function Num({ n, label, sub, safety = false }: { n: ReactNode; label: string; sub?: ReactNode; safety?: boolean }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <p className="display flex items-center gap-2 text-[2.1rem] tabular">
        {n}
        {safety && <Target size={18} tone="safety" />}
      </p>
      <p className="mt-1 text-[0.86rem] leading-snug text-ink-soft">{label}</p>
      {sub && <p className="text-[0.8rem] text-ink-soft">{sub}</p>}
    </div>
  );
}

/** The operations button, on the system's button: plain = secondary, primary = petrol, go = lime, stop = gate. */
export function Button({
  children,
  onClick,
  kind = "plain",
  disabled,
  type = "button",
  className = "",
  title,
  ariaLabel,
  size = "sm",
  staff = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "plain" | "primary" | "stop" | "go" | "quiet";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
  ariaLabel?: string;
  size?: "sm" | "md" | "lg";
  /** An action (it changes something, costs money or calls outside): disabled for a viewer, with "Staff only". */
  staff?: boolean;
}) {
  const viewer = useViewer();
  const k = kind === "primary" ? "primary" : kind === "stop" ? "safety" : kind === "go" ? "go" : kind === "quiet" ? "quiet" : "secondary";
  const off = staff && viewer;
  const button = (
    <button type={type} onClick={off ? undefined : onClick} disabled={disabled || off} title={off ? `${STAFF_ONLY}: sign in with the passcode to act` : title} aria-label={ariaLabel} className={`${buttonClass(k, size, className)} disabled:opacity-45`}>
      {children}
    </button>
  );
  if (!off) return button;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      {button}
      <StaffOnlyNote />
    </span>
  );
}

/** A plain button that acts (a link-styled one, a pill): disabled for a viewer, with "Staff only". */
export function StaffButton({ children, onClick, disabled, className, title, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const viewer = useViewer();
  const button = (
    <button {...rest} type="button" onClick={viewer ? undefined : onClick} disabled={disabled || viewer} title={viewer ? `${STAFF_ONLY}: sign in with the passcode to act` : title} className={`${className ?? ""} disabled:opacity-45`}>
      {children}
    </button>
  );
  return viewer ? (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      {button}
      <StaffOnlyNote />
    </span>
  ) : (
    button
  );
}

/** The one line beside an action a viewer may not take. */
export function StaffOnlyNote({ className = "" }: { className?: string }) {
  return <span className={`text-[0.78rem] font-medium text-ink-soft ${className}`}>{STAFF_ONLY}</span>;
}
