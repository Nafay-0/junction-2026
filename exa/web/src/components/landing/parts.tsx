"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, Check, ChevronDown, Download as DownloadIcon, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { EFFORTS, MODES, type Effort, type ModeId } from "@/lib/agent/modes";
import { APP_NAME } from "@/lib/brand";
import { DOWNLOADS, FIRST_LAUNCH, downloadHref, type Download } from "@/lib/downloads";
import { useClientValue } from "@/lib/use-client";
import { ThemeToggle } from "@/components/account/theme-toggle";
import { Logo } from "@/components/brand/logo";
import { ModeIcon } from "@/components/butler/mode-icon";

/* The parts of the landing page that need the browser: the bar at the top, the download buttons
   (which look at the visitor's system), the demo video, and the small things that move. */

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Content that rises into place the first time it scrolls into view. Still for people who ask for less motion. */
export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "0px 0px -60px 0px" }} transition={{ duration: 0.5, delay, ease: EASE }} className={className}>
      {children}
    </motion.div>
  );
}

const LINKS = [
  { href: "#features", label: "What it does" },
  { href: "#demo", label: "Demo" },
  { href: "#screens", label: "Screens" },
  { href: "#download", label: "Download" },
];

/** The bar at the top: the name, where to jump to, the theme, and the way in. */
export function TopNav({ signedIn }: { signedIn: boolean }) {
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={cn("sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl transition-colors", scrolled ? "border-border" : "border-transparent")}>
      <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center gap-2 px-5 sm:px-8">
        <a href="#top" className="flex shrink-0 items-center gap-2.5 rounded-lg py-1 pr-2 transition-opacity hover:opacity-80" aria-label={`${APP_NAME}, back to the top`}>
          <Logo size={32} className="rounded-[0.6rem] shadow-card" />
          <span className="font-display text-[1.3rem] leading-none">{APP_NAME}</span>
        </a>
        <nav aria-label="On this page" className="ml-6 hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} className="rounded-full px-3 py-2 text-[0.88rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle className="size-10" />
          <Link href={signedIn ? "/" : "/login"} className="flex h-10 items-center rounded-full bg-primary px-4 text-[0.88rem] font-medium text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]">
            {signedIn ? `Open ${APP_NAME}` : "Sign in"}
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ───────── Downloads ───────── */

type System = "mac" | "windows" | "phone" | "other";

/** Which system the visitor is on, as far as a browser will say. Not known until the page is in the browser. */
function readSystem(): System {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "phone";
  if (/Mac/i.test(ua)) return "mac";
  if (/Win/i.test(ua)) return "windows";
  return "other";
}

const useSystem = () => useClientValue<System | null>(readSystem, null);

/** The download that suits the visitor first: a Mac gets the Apple silicon one, with Intel beside it. */
function ordered(system: System | null): Download[] {
  const mine = DOWNLOADS.filter((d) => d.os === system);
  return mine.length ? [...mine, ...DOWNLOADS.filter((d) => d.os !== system)] : DOWNLOADS;
}

/** One button for the hero: the visitor's own system, or the download section when it cannot be told. */
export function HeroDownload() {
  const system = useSystem();
  const first = system === "mac" || system === "windows" ? ordered(system)[0] : null;
  const className =
    "flex h-12 items-center justify-center gap-2 rounded-full border border-border bg-card px-5 text-[0.95rem] font-medium shadow-card transition-[border-color,transform] hover:border-ring/50 active:scale-[0.98]";
  if (!first) {
    return (
      <a href="#download" className={className}>
        <DownloadIcon className="size-4" aria-hidden />
        Get the desktop app
      </a>
    );
  }
  return (
    <a href={downloadHref(first.id)} className={className}>
      <DownloadIcon className="size-4" aria-hidden />
      {first.label}
    </a>
  );
}

/** Every download, the visitor's own system first and largest, and how to open the app the first time. */
export function DownloadButtons() {
  const system = useSystem();
  const list = ordered(system);
  const main = system === "mac" || system === "windows" ? list[0] : null;
  const rest = main ? list.slice(1) : list;
  // The steps for the visitor's own system first; both when it cannot be told.
  const guides = main ? [FIRST_LAUNCH[main.os], FIRST_LAUNCH[main.os === "mac" ? "windows" : "mac"]] : [FIRST_LAUNCH.mac, FIRST_LAUNCH.windows];
  return (
    <div>
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {main ? (
          <a
            href={downloadHref(main.id)}
            className="flex h-14 items-center justify-center gap-3 rounded-2xl bg-primary px-6 text-primary-foreground shadow-float transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]"
          >
            <DownloadIcon className="size-5 shrink-0" aria-hidden />
            <span className="text-left leading-tight">
              <span className="block text-[1rem] font-medium">{main.label}</span>
              <span className="block text-[0.78rem] opacity-80">{main.detail}</span>
            </span>
          </a>
        ) : null}
        {rest.map((d) => (
          <a
            key={d.id}
            href={downloadHref(d.id)}
            className="flex h-14 items-center justify-center gap-3 rounded-2xl border border-border bg-card px-5 shadow-card transition-[border-color,transform] hover:border-ring/50 active:scale-[0.98]"
          >
            <DownloadIcon className="size-[1.1rem] shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-left leading-tight">
              <span className="block text-[0.92rem] font-medium">{d.os === "mac" ? "Mac" : "Windows"}</span>
              <span className="block text-[0.78rem] text-muted-foreground">{d.detail}</span>
            </span>
          </a>
        ))}
      </div>
      <p className="mt-4 text-[0.82rem] leading-relaxed text-subtle">
        {system === "phone" ? `The desktop app is for Mac and Windows. On your phone, open ${APP_NAME} in the browser and add it to your home screen.` : main ? `Needs ${main.requires}.` : "For Mac (macOS 13 or later) and Windows 10 or 11."}
      </p>

      <div className="mt-5 space-y-2">
        {guides.map((guide, i) => (
          <details key={guide.os} open={Boolean(main) && i === 0} className="group/guide rounded-2xl border border-border bg-card px-4 open:pb-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[0.9rem] font-medium outline-none focus-visible:underline [&::-webkit-details-marker]:hidden">
              Opening it the first time on {guide.os === "mac" ? "a Mac" : "Windows"}
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open/guide:rotate-180" aria-hidden />
            </summary>
            <p className="text-[0.86rem] leading-relaxed text-muted-foreground">{guide.why}</p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[0.86rem] leading-relaxed marker:text-subtle">
              {[...guide.install, ...guide.open].map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {guide.otherwise ? <p className="mt-3 text-[0.82rem] leading-relaxed text-subtle">{guide.otherwise}</p> : null}
          </details>
        ))}
      </div>
    </div>
  );
}

/* ───────── The demo video ───────── */

/** The id of a YouTube video, from any of the links people paste. */
function youtubeId(url: string): string | null {
  const match = url.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/);
  return match ? match[1] : null;
}

/**
 * The demo. `src` is a YouTube link or the address of a video file; it comes from the
 * BERYL_DEMO_VIDEO setting on the server. Until there is one, the frame says the video is coming.
 */
export function DemoVideo({ src }: { src: string }) {
  const [playing, setPlaying] = React.useState(false);
  const youtube = src ? youtubeId(src) : null;
  const frame = "relative aspect-video w-full overflow-hidden rounded-3xl border border-border bg-card shadow-float";

  if (!src) {
    return (
      <div className={cn(frame, "backdrop-room flex flex-col items-center justify-center gap-4 px-6 text-center")}>
        <span className="flex size-16 items-center justify-center rounded-full bg-brand-soft text-brand sm:size-20">
          <Play className="size-6 translate-x-0.5 sm:size-7" aria-hidden />
        </span>
        <div>
          <p className="font-display text-[1.15rem] sm:text-[1.4rem]">The demo video is on its way</p>
          <p className="mt-1 text-[0.9rem] text-muted-foreground">We&apos;re still recording it. Check back soon.</p>
        </div>
      </div>
    );
  }
  if (youtube) {
    return (
      <div className={frame}>
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${youtube}?autoplay=1&rel=0`}
            title={`${APP_NAME} demo`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            className="absolute inset-0 size-full"
          />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} aria-label="Play the demo" className="group/play absolute inset-0 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://i.ytimg.com/vi/${youtube}/maxresdefault.jpg`} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
            <span className="relative flex size-20 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-float transition-transform group-hover/play:scale-105">
              <Play className="size-7 translate-x-0.5" aria-hidden />
            </span>
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={frame}>
      <video src={src} controls playsInline preload="metadata" className="absolute inset-0 size-full bg-black object-contain" />
    </div>
  );
}

/* ───────── Small things that move ───────── */

/** The mode picker, small: the four modes and the effort dial, working, with nothing behind them. */
export function ModesDemo() {
  const [mode, setMode] = React.useState<ModeId>("smart");
  const [effort, setEffort] = React.useState<Effort>(2);
  const level = EFFORTS.find((e) => e.value === effort) ?? EFFORTS[0];
  return (
    <div className="rounded-2xl bg-surface p-3 hairline">
      <div role="radiogroup" aria-label="Mode" className="grid grid-cols-2 gap-1.5">
        {MODES.map((m) => {
          const on = m.id === mode;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setMode(m.id)}
              className={cn(
                "flex h-10 items-center gap-2 rounded-xl px-2.5 text-[0.82rem] font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                on ? "bg-brand-soft text-brand" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <ModeIcon mode={m.id} className="size-4 shrink-0" />
              {m.label}
              {on ? <Check className="ml-auto size-3.5" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
      <div className="mt-3 border-t border-border/70 px-1 pt-3">
        <div className="flex items-baseline justify-between text-[0.72rem]">
          <span className="font-medium tracking-wide text-subtle uppercase">Effort</span>
          <span className="text-[0.8rem] font-medium text-foreground">{level.label}</span>
        </div>
        <input
          type="range"
          min={1}
          max={EFFORTS.length}
          step={1}
          value={effort}
          onChange={(e) => setEffort(Number(e.target.value) as Effort)}
          aria-label="Effort"
          aria-valuetext={level.label}
          className="effort-range mt-1 block w-full"
          style={{ "--fill": `${((effort - 1) / (EFFORTS.length - 1)) * 100}%` } as React.CSSProperties}
        />
      </div>
    </div>
  );
}

/** The last word of the page: the way in. */
export function SignInLink({ signedIn, className }: { signedIn: boolean; className?: string }) {
  return (
    <Link href={signedIn ? "/" : "/login"} className={cn("group/in flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-6 text-[0.95rem] font-medium text-primary-foreground shadow-card transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]", className)}>
      {signedIn ? `Open ${APP_NAME}` : "Sign in"}
      <ArrowRight className="size-4 transition-transform group-hover/in:translate-x-0.5" aria-hidden />
    </Link>
  );
}
