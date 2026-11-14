"use client";

import * as React from "react";
import { motion } from "motion/react";
import { ArrowRight, Globe, LayoutGrid, LoaderCircle, MousePointerClick, TriangleAlert } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { api, errorOf } from "@/lib/auth/fetch";
import { Logo } from "@/components/brand/logo";
import { Field, PasswordField } from "./field";
import { ThemeToggle } from "./theme-toggle";

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** What the product does, in three short lines under the form. */
const POINTS = [
  { icon: <Globe />, text: "Searches the live web with Exa" },
  { icon: <LayoutGrid />, text: "Answers as maps, charts and cards" },
  { icon: <MousePointerClick />, text: "Books and buys for you in the desktop app" },
];

/**
 * The sign-in screen: an email, a password, one button. There is no sign-up, because accounts are
 * made by the admin. The same screen opens in a browser tab, on a phone and in the desktop app.
 */
export function LoginScreen({
  next,
  problem,
}: {
  /** Where to go after signing in: a path on this site. */
  next: string;
  /** Set when the server cannot reach its database: signing in cannot work until that is fixed. */
  problem: string | null;
}) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      setError("Enter your email address and your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api("/api/auth/login", { method: "POST", json: { email, password } });
      if (response.ok) {
        // A full page load, so the server renders the app for the account that just signed in.
        window.location.assign(next);
        return;
      }
      setError(await errorOf(response, "Signing in did not work. Try again."));
    } catch {
      setError("The server could not be reached. Check your connection and try again.");
    }
    setBusy(false);
  };

  return (
    <div className="backdrop-room flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Logo size={32} className="rounded-[0.6rem] shadow-card" />
          <span className="font-display text-[1.3rem] leading-none">{APP_NAME}</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pt-6 pb-[max(env(safe-area-inset-bottom),2.5rem)] sm:px-6">
        <div className="w-full max-w-[25.5rem]">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
            <p className="text-[0.74rem] font-medium tracking-[0.14em] text-brand uppercase sm:text-[0.8rem]">{APP_NAME}, your internet butler</p>
            <h1 className="font-display mt-3 text-[2rem] leading-[1.12] text-balance sm:text-[2.5rem]">
              Welcome back.
              <br />
              <span className="text-muted-foreground">Sign in to continue.</span>
            </h1>
          </motion.div>

          <motion.form
            onSubmit={submit}
            // If Enter is pressed before the page has taken the form over, the browser sends it
            // itself: as a POST the sign-in route understands, so the password never ends up in
            // the address bar or a log, and the sign-in still works.
            method="post"
            action="/api/auth/login"
            noValidate
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1, ease: EASE }}
            className="mt-8 flex flex-col gap-4 rounded-2xl border border-border bg-card/70 p-5 shadow-card backdrop-blur-sm sm:p-6"
          >
            {problem ? (
              <div role="alert" className="flex gap-2.5 rounded-xl border border-brass/40 bg-brass/10 px-3.5 py-3 text-[0.82rem] leading-snug">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-brass" />
                <span>
                  <span className="font-medium">Signing in is not possible right now.</span> {problem}
                </span>
              </div>
            ) : null}

            <Field
              label="Email"
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
            <PasswordField name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} />

            {error ? (
              <motion.p role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="text-[0.84rem] leading-snug text-destructive">
                {error}
              </motion.p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="group/go mt-1 flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-[0.95rem] font-medium text-primary-foreground shadow-card transition-[background-color,transform] hover:bg-primary/90 active:translate-y-px disabled:opacity-70"
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {busy ? "Signing in" : "Sign in"}
              {busy ? null : <ArrowRight className="size-4 transition-transform duration-200 group-hover/go:translate-x-0.5" />}
            </button>

            <p className="text-center text-[0.78rem] leading-snug text-muted-foreground">Accounts are by invitation. Ask your admin for one.</p>
          </motion.form>

          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-7 flex flex-col gap-2.5 px-1 text-[0.82rem] text-muted-foreground"
          >
            {POINTS.map((point) => (
              <li key={point.text} className="flex items-center gap-2.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand [&_svg]:size-3.5">{point.icon}</span>
                {point.text}
              </li>
            ))}
          </motion.ul>
        </div>
      </main>
    </div>
  );
}
