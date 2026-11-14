"use client";

import * as React from "react";
import Link from "next/link";
import { MotionConfig, motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { ArrowRight, Check, Command, Download as DownloadIcon, Grid2x2, Menu, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EFFORTS, MODES, type Effort, type ModeId } from "@/lib/agent/modes";
import { APP_NAME } from "@/lib/brand";
import { DOWNLOADS, FIRST_LAUNCH, downloadHref } from "@/lib/downloads";
import { useClientValue } from "@/lib/use-client";
import { ThemeToggle } from "@/components/account/theme-toggle";
import { Logo } from "@/components/brand/logo";
import { ModeIcon } from "@/components/butler/mode-icon";

/* The parts of the landing page that need the browser: the bar at the top, everything that moves,
   the download picker (which looks at the visitor's system) and the demo video. */

const EASE = [0.2, 0.8, 0.2, 1] as const;

/* ───────── Movement ─────────
 * Things rise into place the first time they are scrolled to, groups one after another, and the
 * layered pictures drift a little against each other as the page moves. Someone who has asked
 * their system for less motion gets none of it: the page is simply there.
 */

/** Everything inside follows the visitor's "reduce motion" setting. */
export function Motion({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Content that rises into place the first time it scrolls into view. */
export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "0px 0px -60px 0px" }} transition={{ duration: 0.55, delay, ease: EASE }} className={className}>
      {children}
    </motion.div>
  );
}

/** The same, at once: for what is on screen when the page opens. */
export function Rise({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, delay, ease: EASE }} className={className}>
      {children}
    </motion.div>
  );
}

/** A group whose members come in one after another. Use `StaggerItem` for each member. */
export function Stagger({ children, className, gap = 0.07 }: { children: React.ReactNode; className?: string; gap?: number }) {
  return (
    <motion.div initial="out" whileInView="in" viewport={{ once: true, margin: "0px 0px -80px 0px" }} variants={{ out: {}, in: { transition: { staggerChildren: gap } } }} className={className}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div variants={{ out: { opacity: 0, y: 18 }, in: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } } }} className={className}>
      {children}
    </motion.div>
  );
}

/**
 * A layer that drifts as the page scrolls past it: `by` pixels up over the time it is on screen
 * (negative drifts down). Layers with different amounts read as being at different depths.
 */
export function Drift({ children, by = 24, className }: { children: React.ReactNode; by?: number; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [by, -by]);
  return (
    <motion.div ref={ref} style={still ? undefined : { y }} className={className}>
      {children}
    </motion.div>
  );
}

/** Bars that move like a voice. Decoration beside the call. */
export function VoiceBars({ className }: { className?: string }) {
  return (
    <span className={cn("flex h-10 items-center gap-[5px]", className)} aria-hidden>
      {[0.5, 0.9, 0.65, 1, 0.75, 0.45, 0.85, 0.6, 0.95, 0.5, 0.7].map((peak, i) => (
        <span key={i} className="voice-wave w-[3px] rounded-full bg-brand" style={{ height: `${Math.round(peak * 100)}%`, animationDelay: `${(i * 137) % 900}ms` }} />
      ))}
    </span>
  );
}

/* ───────── The bar at the top ───────── */

/** In the order the sections come down the page. */
const LINKS = [
  { id: "watch", label: "Watch" },
  { id: "ask", label: "What it does" },
  { id: "desktop", label: "Desktop app" },
  { id: "jobs", label: "Jobs" },
  { id: "download", label: "Download" },
];

/** Which of the page's sections is in the middle of the screen right now. */
function useSection(ids: string[]): string | null {
  const [current, setCurrent] = React.useState<string | null>(null);
  const key = ids.join(",");
  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, boolean>();
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
        // The furthest-down section that has reached the middle band is the one being read.
        const all = [...document.querySelectorAll<HTMLElement>("main section[id]")].map((el) => el.id);
        const at = all.filter((id) => seen.get(id)).at(-1) ?? null;
        setCurrent(at);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    document.querySelectorAll<HTMLElement>("main section[id]").forEach((el) => watcher.observe(el));
    return () => watcher.disconnect();
  }, [key]);
  return current;
}

/** Where each section of the page belongs in the bar: the ones it does not name count under the one before them. */
const UNDER: Record<string, string> = { ask: "ask", desktop: "desktop", voice: "desktop", jobs: "jobs", sift: "jobs", research: "jobs", more: "jobs", watch: "watch", anywhere: "watch", download: "download", powered: "download" };

/** The bar at the top: the name, where to jump to, the theme, and the way in. */
export function TopNav({ signedIn }: { signedIn: boolean }) {
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const section = useSection(LINKS.map((l) => l.id));
  const active = section ? UNDER[section] : null;
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <header className={cn("sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl transition-colors", scrolled || open ? "border-border" : "border-transparent")}>
      <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center gap-2 px-5 sm:px-8">
        <a href="#top" className="flex shrink-0 items-center gap-2.5 rounded-lg py-1 pr-2 transition-opacity hover:opacity-80" aria-label={`${APP_NAME}, back to the top`}>
          <Logo size={32} className="rounded-[0.6rem] shadow-card" />
          <span className="font-display text-[1.3rem] leading-none">{APP_NAME}</span>
        </a>
        <nav aria-label="On this page" className="ml-5 hidden items-center gap-0.5 lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              aria-current={active === link.id ? "true" : undefined}
              className={cn("rounded-full px-3 py-2 text-[0.88rem] transition-colors hover:bg-muted hover:text-foreground", active === link.id ? "bg-muted text-foreground" : "text-muted-foreground")}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle className="size-10" />
          <Link href={signedIn ? "/" : "/login"} className="flex h-10 items-center rounded-full bg-primary px-4 text-[0.88rem] font-medium text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]">
            {signedIn ? `Open ${APP_NAME}` : "Sign in"}
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="landing-menu"
            aria-label={open ? "Close the menu" : "Open the menu"}
            className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {open ? (
        <nav id="landing-menu" aria-label="On this page" className="border-t border-border/70 px-5 pt-2 pb-4 sm:px-8 lg:hidden">
          <ul className="mx-auto grid max-w-[1180px] gap-0.5">
            {LINKS.map((link) => (
              <li key={link.id}>
                <a href={`#${link.id}`} onClick={() => setOpen(false)} className={cn("flex h-11 items-center rounded-xl px-3 text-[0.95rem] transition-colors hover:bg-muted", active === link.id ? "font-medium text-foreground" : "text-muted-foreground")}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
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

const SYSTEMS = [
  { os: "mac", label: "Mac", icon: Command },
  { os: "windows", label: "Windows", icon: Grid2x2 },
] as const;

/**
 * The desktop app, for the system the visitor picks. It starts on their own system when the
 * browser says which that is. Under the buttons: how to open the app the first time, for that system.
 */
export function DownloadPicker() {
  const system = useClientValue<System | null>(readSystem, null);
  const [picked, setPicked] = React.useState<"mac" | "windows" | null>(null);
  const os = picked ?? (system === "windows" ? "windows" : "mac");
  const files = DOWNLOADS.filter((d) => d.os === os);
  const guide = FIRST_LAUNCH[os];
  const steps = [...guide.install, ...guide.open];
  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card sm:p-7">
      <div role="tablist" aria-label="Your computer" className="inline-flex rounded-full bg-muted p-1">
        {SYSTEMS.map(({ os: id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`download-tab-${id}`}
            aria-selected={os === id}
            aria-controls="download-panel"
            onClick={() => setPicked(id)}
            className={cn(
              "relative flex h-10 items-center gap-2 rounded-full px-5 text-[0.9rem] font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
              os === id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {os === id ? <motion.span layoutId="download-pill" className="absolute inset-0 rounded-full bg-card shadow-card" transition={{ duration: 0.25, ease: EASE }} /> : null}
            <Icon className="relative size-4" aria-hidden />
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>

      <div id="download-panel" role="tabpanel" aria-labelledby={`download-tab-${os}`} className="mt-6">
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap">
          {files.map((file, i) => (
            <a
              key={file.id}
              href={downloadHref(file.id)}
              className={cn(
                "flex h-14 items-center justify-center gap-3 rounded-2xl px-6 transition-[opacity,transform,border-color] active:scale-[0.98] sm:justify-start",
                i === 0 ? "bg-primary text-primary-foreground shadow-float hover:opacity-90" : "border border-border bg-card shadow-card hover:border-ring/50",
              )}
            >
              <DownloadIcon className={cn("size-5 shrink-0", i === 0 ? "" : "text-muted-foreground")} aria-hidden />
              <span className="text-left leading-tight">
                <span className="block text-[0.98rem] font-medium">{file.label}</span>
                <span className={cn("block text-[0.78rem]", i === 0 ? "opacity-80" : "text-muted-foreground")}>{file.detail}</span>
              </span>
            </a>
          ))}
        </div>
        <p className="mt-3 text-[0.82rem] leading-relaxed text-subtle">
          {os === "mac" ? "Not sure which? Open the Apple menu and choose About This Mac. “Chip: Apple” means Apple silicon. Needs macOS 13 or later." : `Needs ${files[0]?.requires ?? "Windows 10 or 11"}.`}
          {system === "phone" ? ` The desktop app is for computers. On your phone, open ${APP_NAME} in the browser and add it to your home screen.` : ""}
        </p>

        <div className="mt-6 border-t border-border/70 pt-5">
          <h3 className="text-[0.95rem] font-semibold tracking-tight">Opening it the first time on {os === "mac" ? "a Mac" : "Windows"}</h3>
          <p className="mt-1.5 text-[0.86rem] leading-relaxed text-muted-foreground">{guide.why}</p>
          <ol className="mt-4 grid gap-2.5">
            {steps.map((step, i) => (
              <li key={step} className="flex items-start gap-3 text-[0.88rem] leading-relaxed">
                <span className="nums mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[0.72rem] font-semibold text-brand">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          {guide.otherwise ? <p className="mt-4 text-[0.82rem] leading-relaxed text-subtle">{guide.otherwise}</p> : null}
        </div>
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

/** The still shown before a video file is played: a frame of the film itself. Retake it when the film changes. */
const DEMO_POSTER = "/landing/demo-poster.jpg";

/**
 * The demo. `src` is a YouTube link or the address of a video file; it comes from the
 * BERYL_DEMO_VIDEO setting on the server. Until there is one, the frame says the video is coming.
 * Nothing of the video is fetched until the visitor presses play.
 */
export function DemoVideo({ src }: { src: string }) {
  const [playing, setPlaying] = React.useState(false);
  const film = React.useRef<HTMLVideoElement>(null);
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
      <video ref={film} src={src} poster={DEMO_POSTER} controls={playing} playsInline preload="none" onPlay={() => setPlaying(true)} className="absolute inset-0 size-full bg-black object-contain" />
      {playing ? null : (
        <button
          type="button"
          aria-label="Play the demo"
          className="group/play absolute inset-0 flex items-center justify-center bg-black/30 transition-colors hover:bg-black/20"
          onClick={() => {
            setPlaying(true);
            void film.current?.play().catch(() => {});
          }}
        >
          <span className="relative flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-float transition-transform group-hover/play:scale-105 sm:size-20">
            <Play className="size-6 translate-x-0.5 sm:size-7" aria-hidden />
          </span>
        </button>
      )}
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
