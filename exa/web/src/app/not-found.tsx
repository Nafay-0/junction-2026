import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ThemeToggle } from "@/components/account/theme-toggle";
import { Logo } from "@/components/brand/logo";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `Page not found · ${APP_NAME}` };

/**
 * An address that leads nowhere: a mistyped link, a page that was never there, or the admin area
 * for someone who is not the admin. It says so plainly and offers the one way on. It knows
 * nothing about who is asking, so it works signed in and signed out alike.
 */
export default function NotFound() {
  return (
    <div className="backdrop-room flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/40" aria-label={`${APP_NAME}, home`}>
          <Logo size={32} className="rounded-[0.6rem] shadow-card" />
          <span className="font-display text-[1.3rem] leading-none">{APP_NAME}</span>
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pt-6 pb-[max(env(safe-area-inset-bottom),4rem)] sm:px-6">
        <div className="w-full max-w-[30rem] animate-rise text-center">
          <p className="nums text-[0.8rem] font-medium tracking-[0.18em] text-brand uppercase">Error 404</p>
          <h1 className="font-display mt-3 text-[2.2rem] leading-[1.1] text-balance sm:text-[2.9rem]">This page isn&apos;t here.</h1>
          <p className="mx-auto mt-4 max-w-[24rem] text-[0.98rem] leading-relaxed text-muted-foreground">The link may be old or mistyped. Nothing is lost: your chats and jobs are where you left them.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
            <Link
              href="/"
              className="flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[0.92rem] font-medium text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]"
            >
              Go to {APP_NAME}
              <ArrowRight className="size-4" />
            </Link>
            <Link href="/about" className="flex h-11 items-center rounded-full border border-border bg-card px-5 text-[0.92rem] font-medium text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground">
              What {APP_NAME} is
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
