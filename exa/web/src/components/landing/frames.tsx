import { cn } from "@/lib/utils";

/*
 * Real screenshots of the app, and the frames they sit in. Every picture exists twice, once per
 * theme, and the page shows the one that matches. The frames are drawn in CSS: a browser window,
 * the desktop app's window and a phone.
 *
 * A frame never crops its picture. The picture is shown whole, at its own proportions, and the
 * frame is built around it: the phone adds a status bar above and a home bar below, so the app's
 * own edges (its top bar, its message box) sit clear of the phone's rounded corners.
 */

/** Screenshots of the full window are 1680 by 998, the phone ones 780 by 1624 (a 390 by 812 screen, twice over). */
export const WIDE = { width: 1680, height: 998 } as const;
export const TALL = { width: 780, height: 1624 } as const;

/** One screenshot, in the theme the page is in. `className` goes on both pictures. */
export function Shot({ name, alt, size = WIDE, eager, className }: { name: string; alt: string; size?: { width: number; height: number }; /** For a picture on screen when the page opens. */ eager?: boolean; className?: string }) {
  const shared = { width: size.width, height: size.height, loading: eager ? ("eager" as const) : ("lazy" as const), decoding: "async" as const };
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/landing/${name}-light.jpg`} alt={alt} {...shared} className={cn("block h-auto w-full dark:hidden", className)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/landing/${name}-dark.jpg`} alt={alt} {...shared} className={cn("hidden h-auto w-full dark:block", className)} />
    </>
  );
}

const Dots = () => (
  <span className="flex shrink-0 items-center gap-1.5" aria-hidden>
    {[0, 1, 2].map((i) => (
      <span key={i} className="size-2.5 rounded-full bg-foreground/15" />
    ))}
  </span>
);

const WINDOW = "overflow-hidden rounded-2xl border border-border bg-card shadow-float";

/** A browser window: three dots and an address bar. */
export function BrowserFrame({ address, children, className }: { /** What the address bar says. */ address?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(WINDOW, className)}>
      <div className="flex h-9 items-center gap-3 border-b border-border bg-muted/60 px-3.5 sm:h-10">
        <Dots />
        <span className="flex h-5 min-w-0 flex-1 items-center justify-center truncate rounded-full bg-background/80 px-3 text-[0.68rem] text-subtle sm:mx-auto sm:h-6 sm:max-w-[22rem]" aria-hidden>
          {address}
        </span>
        <span className="hidden w-[2.6rem] sm:block" aria-hidden />
      </div>
      {children}
    </div>
  );
}

/** The desktop app's own window: a title bar with its name. */
export function WindowFrame({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(WINDOW, className)}>
      <div className="relative flex h-9 items-center border-b border-border bg-muted/60 px-3.5 sm:h-10">
        <Dots />
        <span className="absolute inset-x-0 text-center text-[0.72rem] font-medium text-muted-foreground">{title}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * A phone. Everything is sized from the frame's own width (container units), so it keeps its
 * proportions at any size. The screen has a status bar and a home bar of its own, in the app's
 * background colour: the screenshot sits between them, whole, away from the rounded corners.
 */
export function PhoneFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("[container-type:inline-size]", className)}>
      <div className="rounded-[15cqw] bg-[oklch(0.24_0.012_170)] p-[2.6cqw] shadow-float ring-1 ring-foreground/10 dark:bg-[oklch(0.32_0.012_170)]">
        <div className="overflow-hidden rounded-[12.6cqw] bg-background">
          <div className="relative flex h-[9.5cqw] items-end justify-between px-[8cqw] pb-[1.2cqw] text-[3.3cqw] leading-none font-semibold text-foreground/80" aria-hidden>
            <span className="nums">9:41</span>
            <span className="absolute top-[2.4cqw] left-1/2 h-[5.4cqw] w-[23cqw] -translate-x-1/2 rounded-full bg-[oklch(0.16_0.01_170)]" />
            <span className="flex items-center gap-[1.2cqw]">
              <span className="flex items-end gap-[0.5cqw]">
                {[1.4, 2, 2.6, 3.2].map((h) => (
                  <span key={h} className="w-[0.75cqw] rounded-full bg-current" style={{ height: `${h}cqw` }} />
                ))}
              </span>
              <span className="relative h-[2.9cqw] w-[5.6cqw] rounded-[0.9cqw] border border-current/60">
                <span className="absolute inset-[0.35cqw] right-[1.2cqw] rounded-[0.4cqw] bg-current" />
              </span>
            </span>
          </div>
          {children}
          <div className="flex h-[6cqw] items-center justify-center" aria-hidden>
            <span className="h-[1.15cqw] w-[32cqw] rounded-full bg-foreground/35" />
          </div>
        </div>
      </div>
    </div>
  );
}
