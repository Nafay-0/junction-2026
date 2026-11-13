"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../_client/api";
import { useLive } from "../../_client/use-live";
import { Target } from "../../_ui/target";
import { VIA, type Via } from "./format";

/**
 * The operations portal's building blocks. Dense, calm, monochrome; the safety yellow appears only on refusals and
 * on decisions a person must make. Ids, codes and hashes sit behind <Details>.
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

export function PageHead({ title, purpose, right }: { title: string; purpose: string; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-2 border-ink pb-3">
      <div className="min-w-0">
        <h1 className="font-display text-[1.9rem] font-bold leading-none tracking-tight">{title}</h1>
        <p className="mt-1.5 max-w-[72ch] text-[0.95rem] text-ink-soft">{purpose}</p>
      </div>
      {right && <div className="flex items-center gap-3 text-[0.85rem] text-ink-soft">{right}</div>}
    </header>
  );
}

export function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="mt-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id={id} className="font-display text-[1.25rem] font-bold leading-tight">
          {title}
        </h2>
        {aside && <div className="text-[0.85rem] text-ink-soft">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`border border-concrete-deep bg-paper ${className}`}>{children}</div>;
}

/** The door an agent came through. Same shape for all three: they meet the same gate. */
export function ViaTag({ via, className = "" }: { via?: Via; className?: string }) {
  if (!via) return <span className={`text-[0.8rem] text-ink-soft ${className}`}>unknown door</span>;
  return (
    <span title={VIA[via].how} className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[0.8rem] font-semibold ${className}`}>
      <DoorGlyph via={via} />
      {VIA[via].label}
    </span>
  );
}

/** Three small marks, one per door: a filled square (on-site), a split square (MCP), an open square (REST). */
export function DoorGlyph({ via, size = 10 }: { via: Via; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden className="shrink-0">
      <rect x="0.75" y="0.75" width="8.5" height="8.5" fill={via === "onsite" ? "var(--color-ink)" : "none"} stroke="var(--color-ink)" strokeWidth="1.5" />
      {via === "mcp" && <path d="M0.75 9.25 L9.25 0.75 L9.25 9.25 Z" fill="var(--color-ink)" />}
    </svg>
  );
}

export type Tone = "plain" | "safety" | "done";

/** Outcome words. Safety only when a person must act or the gate refused. */
export function Outcome({ kind, label }: { kind: string; label: string }) {
  const safety = kind === "waiting" || kind === "refused" || kind === "declined";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[0.85rem] font-semibold ${safety ? "" : kind === "committed" ? "text-ink" : "text-ink-soft"}`}>
      <Target size={13} tone={safety ? "safety" : kind === "committed" ? "ink" : "hollow"} />
      <span className={safety ? "bg-safety px-1 text-safety-ink" : ""}>{label}</span>
    </span>
  );
}

export function Licence({ licence }: { licence: { level: string; name: string; rating?: number } | null | undefined }) {
  if (!licence) return <span className="text-[0.8rem] text-ink-soft">Not crash-tested yet</span>;
  return (
    <span className="whitespace-nowrap text-[0.85rem] font-semibold">
      {licence.level} {licence.name}
      {licence.rating !== undefined && <span className="font-normal text-ink-soft"> ({licence.rating.toFixed(1).replace(".", ",")})</span>}
    </span>
  );
}

/** Ids, codes and hashes: there when someone asks, out of the way otherwise. */
export function Details({ summary = "Details", children, className = "" }: { summary?: string; children: ReactNode; className?: string }) {
  return (
    <details className={`group text-[0.8rem] ${className}`}>
      <summary className="cursor-pointer select-none text-ink-soft underline decoration-concrete-deep underline-offset-2 hover:text-ink">{summary}</summary>
      <div className="mt-1.5 space-y-1 break-all font-mono text-[0.75rem] leading-relaxed text-ink-soft">{children}</div>
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

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border border-dashed border-concrete-deep bg-paper/60 px-5 py-6">
      <p className="font-display text-[1.1rem] font-bold">{title}</p>
      {children && <div className="mt-1 max-w-[70ch] text-[0.9rem] text-ink-soft">{children}</div>}
    </div>
  );
}

export function LoadError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="status" className="mt-3 border-l-4 border-ink bg-paper px-3 py-2 text-[0.9rem]">
      Could not refresh from Dock: {message} The view shows the last data it had and keeps trying.
    </p>
  );
}

export function Loading() {
  return <p className="mt-6 text-[0.9rem] text-ink-soft">Reading the gate…</p>;
}

export function Num({ n, label, sub, safety = false }: { n: ReactNode; label: string; sub?: ReactNode; safety?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="flex items-center gap-2 font-display text-[2rem] font-bold leading-none tabular">
        {n}
        {safety && <span aria-hidden className="inline-block h-2.5 w-2.5 bg-safety ring-1 ring-ink" />}
      </p>
      <p className="mt-1 text-[0.82rem] leading-snug text-ink-soft">{label}</p>
      {sub && <p className="text-[0.78rem] text-ink-soft">{sub}</p>}
    </div>
  );
}

export function Button({ children, onClick, kind = "plain", disabled, type = "button", className = "" }: { children: ReactNode; onClick?: () => void; kind?: "plain" | "primary" | "stop"; disabled?: boolean; type?: "button" | "submit"; className?: string }) {
  const look =
    kind === "primary"
      ? "bg-ink text-paper hover:bg-ink/90"
      : kind === "stop"
        ? "bg-safety text-safety-ink ring-2 ring-ink hover:brightness-95"
        : "bg-paper text-ink ring-1 ring-ink hover:bg-concrete";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 px-3 py-1.5 text-[0.9rem] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${look} ${className}`}>
      {children}
    </button>
  );
}
