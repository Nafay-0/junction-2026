import { cn } from "@/lib/utils";

/*
 * Real screenshots of the app, and the frames they sit in. Every picture exists twice, once per
 * theme, and the page shows the one that matches. The frames are drawn in CSS: a browser window,
 * the desktop app's window and a phone.
 */

/** Screenshots of the full window are 1680 by 998, the phone ones 640 by 1332. */
export const WIDE = { width: 1680, height: 998 } as const;
export const TALL = { width: 640, height: 1332 } as const;

/** One screenshot, in the theme the page is in. `className` goes on both pictures. */
export function Shot({ name, alt, size = WIDE, className, style }: { name: string; alt: string; size?: { width: number; height: number }; className?: string; style?: React.CSSProperties }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/landing/${name}-light.jpg`} alt={alt} width={size.width} height={size.height} loading="lazy" decoding="async" style={style} className={cn("block h-auto w-full dark:hidden", className)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/landing/${name}-dark.jpg`} alt={alt} width={size.width} height={size.height} loading="lazy" decoding="async" style={style} className={cn("hidden h-auto w-full dark:block", className)} />
    </>
  );
}

/**
 * A part of a screenshot, large enough to read. The picture fills the box, is enlarged by `zoom`,
 * and `at` says which point of it stays put: "100% 60%" keeps the right edge, a little below the middle.
 */
export function Crop({ name, alt, at = "100% 50%", zoom = 1, className }: { name: string; alt: string; at?: string; zoom?: number; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-card shadow-float", className)}>
      <Shot name={name} alt={alt} className="h-full object-cover" style={{ objectPosition: at, transformOrigin: at, transform: zoom === 1 ? undefined : `scale(${zoom})` }} />
    </div>
  );
}

const Dots = () => (
  <span className="flex shrink-0 items-center gap-1.5" aria-hidden>
    {[0, 1, 2].map((i) => (
      <span key={i} className="size-2.5 rounded-full bg-foreground/15" />
    ))}
  </span>
);

/** A browser window: three dots and an address bar. */
export function BrowserFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-card shadow-float", className)}>
      <div className="flex h-9 items-center gap-3 border-b border-border bg-muted/60 px-3.5 sm:h-10">
        <Dots />
        <span className="h-5 min-w-0 flex-1 rounded-full bg-background/80 sm:mx-auto sm:max-w-[22rem]" aria-hidden />
        <span className="hidden w-[2.6rem] sm:block" aria-hidden />
      </div>
      {children}
    </div>
  );
}

/** The desktop app's own window: a title bar with its name. */
export function WindowFrame({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-card shadow-float", className)}>
      <div className="relative flex h-9 items-center border-b border-border bg-muted/60 px-3.5 sm:h-10">
        <Dots />
        <span className="absolute inset-x-0 text-center text-[0.72rem] font-medium text-muted-foreground">{title}</span>
      </div>
      {children}
    </div>
  );
}

/** A phone: a dark bezel with rounded corners. */
export function PhoneFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-[2.4rem] bg-foreground/90 p-[0.45rem] shadow-float dark:bg-border", className)}>
      <div className="overflow-hidden rounded-[2rem] bg-background">{children}</div>
    </div>
  );
}
