"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../_client/api";
import { useLive } from "../../_client/use-live";
import { buttonClass, Spinner } from "../../_ui/kit";
import { Target } from "../../_ui/target";
import { VIA, type Via } from "./format";

/**
 * The operations portal's building blocks, in the shared system's language (web/docs/DESIGN.md): paper plates on
 * mist, petrol for structure, the display face for titles and figures. Safety yellow and the hazard stripe appear only
 * on refusals, suspensions and sign-offs waiting on a person. Ids, codes and hashes sit behind <Details>.
 * What this adds beside the system is listed in web/docs/DESIGN-OPS.md.
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

/** The page's title, the one question it answers, and on the right whether it is live. */
export function PageHead({ title, purpose, right }: { title: string; purpose: string; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-4">
      <div className="min-w-0">
        <h1 className="display text-[2.5rem] text-ink">{title}</h1>
        <p className="mt-2 max-w-[70ch] text-[1rem] leading-snug text-ink-soft">{purpose}</p>
      </div>
      {right && <div className="flex items-center gap-3 text-[0.88rem] text-ink-soft">{right}</div>}
    </header>
  );
}

/** "Live, updated 14.05.32": a small square that breathes while the stream is up. */
export function LiveMark({ at, error }: { at?: string; error?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <span aria-hidden className={`size-2.5 ${error ? "border border-ink-soft" : "breathe bg-petrol"}`} />
      {error ? "Reconnecting…" : at ? `Live, updated ${at}` : "Connecting…"}
    </span>
  );
}

export function Section({ title, aside, children, id, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; id?: string; className?: string }) {
  return (
    <section aria-labelledby={id} className={`mt-8 ${className}`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="display text-[1.6rem] text-ink">
          {title}
        </h2>
        {aside && <div className="text-[0.88rem] text-ink-soft">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** A paper plate. `rule` adds the petrol top rule that marks a document. */
export function Panel({ children, className = "", rule = false }: { children: ReactNode; className?: string; rule?: boolean }) {
  return <div className={`bg-paper ${rule ? "border-t-[3px] border-petrol" : ""} ${className}`}>{children}</div>;
}

/** The door an agent came through. Same shape for all three: they meet the same gate. */
export function ViaTag({ via, className = "", short = false }: { via?: Via; className?: string; short?: boolean }) {
  if (!via) return <span className={`text-[0.85rem] text-ink-soft ${className}`}>Door not recorded</span>;
  return (
    <span title={VIA[via].how} className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[0.85rem] font-semibold text-petrol ${className}`}>
      <DoorGlyph via={via} />
      {short ? VIA[via].short : VIA[via].label}
    </span>
  );
}

/** Three marks, one per door: a filled square (on-site), a split square (MCP), an open square (REST). */
export function DoorGlyph({ via, size = 11, color = "currentColor" }: { via: Via; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden className="shrink-0">
      <rect x="0.75" y="0.75" width="8.5" height="8.5" fill={via === "onsite" ? color : "none"} stroke={color} strokeWidth="1.5" />
      {via === "mcp" && <path d="M0.75 9.25 L9.25 0.75 L9.25 9.25 Z" fill={color} />}
    </svg>
  );
}

export type Tone = "plain" | "safety" | "done";

/**
 * Outcome words. The gate's mark and yellow only when a person must act or the gate refused; a signed order gets a
 * petrol square, anything still moving an open one.
 */
export function Outcome({ kind, label, size = "sm" }: { kind: string; label: string; size?: "sm" | "md" }) {
  const gate = kind === "waiting" || kind === "refused" || kind === "declined";
  const text = size === "md" ? "text-[0.98rem]" : "text-[0.88rem]";
  return (
    <span className={`inline-flex items-start gap-1.5 font-semibold leading-snug ${text} ${kind === "committed" ? "text-petrol" : gate ? "text-ink" : "text-ink-soft"}`}>
      <span className="mt-[0.2em] shrink-0">
        {gate ? <Target size={14} tone="safety" /> : <span aria-hidden className={`block size-3 ${kind === "committed" ? "bg-petrol" : "border-[1.5px] border-current"}`} />}
      </span>
      <span>{label}</span>
    </span>
  );
}

export function Licence({ licence }: { licence: { level: string; name: string; rating?: number } | null | undefined }) {
  if (!licence) return <span className="text-[0.85rem] text-ink-soft">Not crash-tested yet</span>;
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap text-[0.88rem] font-semibold">
      <span className="bg-petrol px-1 text-[0.78rem] text-paper">{licence.level}</span>
      {licence.name}
      {licence.rating !== undefined && <span className="font-normal text-ink-soft tabular">{licence.rating.toFixed(1).replace(".", ",")}</span>}
    </span>
  );
}

/** Ids, codes and hashes: there when someone asks, out of the way otherwise. */
export function Details({ summary = "Details", children, className = "" }: { summary?: string; children: ReactNode; className?: string }) {
  return (
    <details className={`group text-[0.82rem] ${className}`}>
      <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-ink-soft hover:text-ink">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">
          ▸
        </span>
        <span className="underline decoration-line underline-offset-2">{summary}</span>
      </summary>
      <div className="mt-1.5 space-y-1 break-all font-mono text-[0.76rem] leading-relaxed text-ink-soft">{children}</div>
    </details>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-ink-soft/80">{k}</span>
      <span className="text-ink">{v}</span>
    </div>
  );
}

/** An empty state is a direction: what is not here yet, and what makes it appear. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-line bg-paper/70 px-5 py-5">
      <p className="text-[1.08rem] font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-[70ch] text-[0.95rem] leading-snug text-ink-soft">{children}</div>}
      {action && <div className="mt-3 flex flex-wrap gap-3">{action}</div>}
    </div>
  );
}

export function LoadError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="status" className="mt-3 border-l-[6px] border-petrol bg-paper px-4 py-2.5 text-[0.95rem]">
      <b>Could not refresh from Dock.</b> {message} The view shows the last data it had and keeps trying.
    </p>
  );
}

/** Loading, in the shape of what is coming: a title bar and a few rows. */
export function Loading({ label = "Reading the gate…" }: { label?: string }) {
  return (
    <div className="mt-2" role="status" aria-label={label}>
      <div className="h-10 w-72 animate-pulse bg-concrete-deep/70 motion-reduce:animate-none" />
      <div className="mt-3 h-4 w-[34rem] max-w-full animate-pulse bg-concrete-deep/50 motion-reduce:animate-none" />
      <div className="mt-6 space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse bg-paper motion-reduce:animate-none" />
        ))}
      </div>
      <p className="mt-3 flex items-center gap-2 text-[0.9rem] text-ink-soft">
        <Spinner size={14} className="text-petrol" /> {label}
      </p>
    </div>
  );
}

/** A figure: the number in the display face, its meaning under it. `safety` only when a person must act. */
export function Num({ n, label, sub, safety = false }: { n: ReactNode; label: string; sub?: ReactNode; safety?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="flex items-center gap-2 display text-[2.4rem] tabular">
        {n}
        {safety && <span aria-hidden className="hazard-thin inline-block size-3.5" />}
      </p>
      <p className="mt-1 text-[0.88rem] leading-snug text-ink-soft">{label}</p>
      {sub && <p className="text-[0.82rem] text-ink-soft">{sub}</p>}
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
}) {
  const k = kind === "primary" ? "primary" : kind === "stop" ? "safety" : kind === "go" ? "go" : kind === "quiet" ? "quiet" : "secondary";
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel} className={`${buttonClass(k, size, className)} disabled:opacity-45`}>
      {children}
    </button>
  );
}
