"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Check, Copy, KeyRound, LoaderCircle, MoreHorizontal, Search, ShieldCheck, Sparkles, Trash2, UserPlus, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, errorOf } from "@/lib/auth/fetch";
import { AccountChange, MIN_PASSWORD, NewAccount, firstProblem } from "@/lib/auth/validation";
import type { Account } from "@/lib/db/admin";
import { useHydrated } from "@/lib/use-client";
import { AccountBadge } from "@/components/account/account-menu";
import { Field } from "@/components/account/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, PageHeading, Panel } from "./admin-shell";
import { ago, count, dateOf, usd } from "./format";

type Doing = { kind: "add" } | { kind: "password"; account: Account } | { kind: "delete"; account: Account } | null;

const pill = "h-9 rounded-full px-4 text-[0.85rem] font-medium transition-colors disabled:opacity-60";
const quiet = cn(pill, "border border-border bg-card hover:bg-muted");
const primary = cn(pill, "flex items-center justify-center gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90");
const danger = cn(pill, "flex items-center justify-center gap-1.5 bg-destructive/10 text-destructive hover:bg-destructive/20");

/** A password nobody has to think up: 14 characters, without the ones that look alike. */
function makePassword(): string {
  const letters = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const picks = new Uint32Array(14);
  crypto.getRandomValues(picks);
  return Array.from(picks, (n) => letters[n % letters.length]).join("");
}

/**
 * Every account, and the three things the admin can do to one: block it, give it a new password,
 * delete it. Adding one is the only way an account comes to exist: there is no sign-up.
 */
export function AccountsScreen({ accounts, renderedAt }: { accounts: Account[]; renderedAt: number }) {
  const router = useRouter();
  const [doing, setDoing] = React.useState<Doing>(null);
  const [query, setQuery] = React.useState("");
  const [working, setWorking] = React.useState<string | null>(null);

  const others = accounts.filter((a) => a.role !== "admin");
  const blocked = others.filter((a) => a.status === "blocked").length;
  const q = query.trim().toLowerCase();
  const shown = q ? accounts.filter((a) => a.name.toLowerCase().includes(q) || a.email.includes(q)) : accounts;

  const setStatus = async (account: Account, status: "active" | "blocked") => {
    setWorking(account.id);
    try {
      const response = await api(`/api/admin/users/${account.id}`, { method: "PATCH", json: { status } });
      if (response.ok) {
        toast.success(status === "blocked" ? `${account.name} is blocked and signed out everywhere.` : `${account.name} can sign in again.`);
        router.refresh();
      } else toast.error(await errorOf(response));
    } catch {
      toast.error("The server could not be reached.");
    }
    setWorking(null);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        title="Accounts"
        lead="Everyone who can sign in, on the web and in the desktop app. Only you can add, block or remove them."
        action={
          <button type="button" onClick={() => setDoing({ kind: "add" })} className={cn(primary, "h-10 px-4 shadow-card")}>
            <UserPlus className="size-4" />
            Add an account
          </button>
        }
      />

      <Panel>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[0.84rem] text-muted-foreground">
            {others.length === 0 ? "Only you so far." : `${others.length === 1 ? "One account" : `${others.length} accounts`} besides yours${blocked ? `, ${blocked} blocked` : ""}.`}
          </p>
          {accounts.length > 6 ? (
            <label className="relative block w-full sm:w-64">
              <span className="sr-only">Find an account</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find by name or email"
                className="h-9 w-full rounded-full border border-input bg-background pr-3 pl-9 text-[0.85rem] outline-none transition-[border-color,box-shadow] placeholder:text-subtle focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
              />
            </label>
          ) : null}
        </div>

        {others.length === 0 ? (
          <div className="mb-4">
            <Empty icon={<Users />} title="No accounts yet, besides yours">
              Add one for each person who should use the app. They sign in with the email and password you give them, on the web or in the desktop app.
            </Empty>
          </div>
        ) : null}

        {shown.length === 0 ? (
          <p className="py-8 text-center text-[0.86rem] text-muted-foreground">No account matches &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          <>
            {/* Wide screens: a table. */}
            <div className="hidden md:block">
              <table className="w-full border-separate border-spacing-0 text-[0.86rem]">
                <thead>
                  <tr className="text-left text-[0.7rem] font-medium tracking-wider text-subtle uppercase">
                    <th className="pb-2.5 pl-1 font-medium">Account</th>
                    <th className="px-3 pb-2.5 font-medium">Status</th>
                    <th className="px-3 pb-2.5 font-medium">Added</th>
                    <th className="px-3 pb-2.5 font-medium">Last sign-in</th>
                    <th className="px-3 pb-2.5 text-right font-medium">Conversations</th>
                    <th className="px-3 pb-2.5 text-right font-medium">Cost</th>
                    <th className="w-10 pb-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => (
                    <tr key={a.id} className={cn("transition-colors hover:bg-muted/40", a.status === "blocked" && "text-muted-foreground")}>
                      <td className="max-w-0 border-t border-border py-3 pl-1">
                        <Who account={a} />
                      </td>
                      <td className="border-t border-border px-3 py-3">
                        <Status account={a} />
                      </td>
                      <td className="nums border-t border-border px-3 py-3 whitespace-nowrap text-muted-foreground">
                        <When ts={a.createdAt} renderedAt={renderedAt} date />
                      </td>
                      <td className="nums border-t border-border px-3 py-3 whitespace-nowrap text-muted-foreground">{a.lastLoginAt ? <When ts={a.lastLoginAt} renderedAt={renderedAt} /> : "Never"}</td>
                      <td className="nums border-t border-border px-3 py-3 text-right">{count(a.conversations)}</td>
                      <td className="nums border-t border-border px-3 py-3 text-right font-medium text-foreground">{usd(a.costUsd)}</td>
                      <td className="border-t border-border py-3 pr-1 text-right">
                        <Actions account={a} busy={working === a.id} onStatus={setStatus} onDo={setDoing} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phones: one card per account. */}
            <ul className="flex flex-col gap-2.5 md:hidden">
              {shown.map((a) => (
                <li key={a.id} className="rounded-xl border border-border bg-background/60 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <Who account={a} />
                    </div>
                    <Actions account={a} busy={working === a.id} onStatus={setStatus} onDo={setDoing} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.78rem]">
                    <Fact label="Status">
                      <Status account={a} />
                    </Fact>
                    <Fact label="Last sign-in">{a.lastLoginAt ? <When ts={a.lastLoginAt} renderedAt={renderedAt} /> : "Never"}</Fact>
                    <Fact label="Conversations">{count(a.conversations)}</Fact>
                    <Fact label="Cost">{usd(a.costUsd)}</Fact>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <AddDialog open={doing?.kind === "add"} onClose={() => setDoing(null)} onDone={() => router.refresh()} />
      <PasswordDialog account={doing?.kind === "password" ? doing.account : null} onClose={() => setDoing(null)} />
      <DeleteDialog account={doing?.kind === "delete" ? doing.account : null} onClose={() => setDoing(null)} onDone={() => router.refresh()} />
    </div>
  );
}

function Who({ account }: { account: Account }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <AccountBadge user={account} className={account.status === "blocked" ? "opacity-50 grayscale" : undefined} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-foreground">{account.name}</span>
          {account.role === "admin" ? <span className="shrink-0 rounded-full bg-brand-soft px-1.5 py-px text-[0.62rem] font-semibold tracking-wider text-brand uppercase">Admin · you</span> : null}
        </div>
        <div className="truncate text-[0.76rem] text-muted-foreground">{account.email}</div>
      </div>
    </div>
  );
}

function Status({ account }: { account: Account }) {
  const blocked = account.status === "blocked";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.74rem] font-medium whitespace-nowrap", blocked ? "bg-destructive/10 text-destructive" : "bg-brand-soft text-brand")}>
      <span className={cn("size-1.5 rounded-full", blocked ? "bg-destructive" : "bg-brand")} />
      {blocked ? "Blocked" : "Active"}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.68rem] tracking-wider text-subtle uppercase">{label}</dt>
      <dd className="nums mt-0.5 truncate">{children}</dd>
    </div>
  );
}

/* The time now, to the minute: one clock for the whole page, started when something first asks for it. */
let clock = 0;
let ticking: ReturnType<typeof setInterval> | undefined;
const watchers = new Set<() => void>();
function watchClock(onTick: () => void) {
  watchers.add(onTick);
  if (!ticking) {
    clock = Date.now();
    ticking = setInterval(() => {
      clock = Date.now();
      watchers.forEach((w) => w());
    }, 60_000);
  }
  return () => {
    watchers.delete(onTick);
    if (watchers.size === 0) {
      clearInterval(ticking);
      ticking = undefined;
    }
  };
}

/**
 * A moment, as "3 hours ago" or as a date. The server and the browser must agree on the first
 * render, so until the page is alive it uses the time the server rendered at, and UTC for dates.
 */
function When({ ts, renderedAt, date }: { ts: number; renderedAt: number; date?: boolean }) {
  const alive = useHydrated();
  const now = React.useSyncExternalStore(
    watchClock,
    () => clock || renderedAt,
    () => renderedAt,
  );
  const zone = alive ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  return (
    <time dateTime={new Date(ts).toISOString()} title={alive ? new Date(ts).toLocaleString() : undefined}>
      {date ? dateOf(ts, zone) : ago(ts, now)}
    </time>
  );
}

function Actions({ account, busy, onStatus, onDo }: { account: Account; busy: boolean; onStatus: (account: Account, status: "active" | "blocked") => void; onDo: (doing: Doing) => void }) {
  // The admin's own account is set on the server (ADMIN_EMAIL, ADMIN_PASSWORD): nothing to do to it here.
  if (account.role === "admin") {
    return (
      <span title="This account comes from ADMIN_EMAIL and ADMIN_PASSWORD on the server." className="inline-flex size-8 items-center justify-center text-subtle">
        <ShieldCheck className="size-4" />
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Options for ${account.name}`}
        disabled={busy}
        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted data-[state=open]:bg-muted"
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => onDo({ kind: "password", account })}>
          <KeyRound className="size-4" />
          Set a new password
        </DropdownMenuItem>
        {account.status === "blocked" ? (
          <DropdownMenuItem onSelect={() => onStatus(account, "active")}>
            <Check className="size-4" />
            Unblock
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => onStatus(account, "blocked")}>
            <Ban className="size-4" />
            Block
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onDo({ kind: "delete", account })} className="text-destructive focus:text-destructive">
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ───────────────────────── Dialogs ───────────────────────── */

/** The password field of the admin's forms: typed or made up, and always visible, since the admin has to pass it on. */
function NewPasswordField({ value, onChange, invalid }: { value: string; onChange: (value: string) => void; invalid?: boolean }) {
  return (
    <Field
      label="Password"
      name="new-password"
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid || undefined}
      className="font-mono"
      hint={`At least ${MIN_PASSWORD} characters. You pass it on yourself: it is not sent to them.`}
      trailing={
        <button
          type="button"
          onClick={() => onChange(makePassword())}
          className="flex h-8 items-center gap-1 rounded-lg px-2 text-[0.76rem] font-medium text-brand transition-colors hover:bg-brand-soft"
        >
          <Sparkles className="size-3.5" />
          Make one
        </button>
      }
    />
  );
}

/** After an account is added or given a new password: what to pass on, once. */
function HandOver({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Email: ${email}\nPassword: ${password}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Copying is not allowed here. Select the text instead.");
    }
  };
  return (
    <>
      <dl className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface px-4 py-3.5 text-[0.86rem]">
        <div className="flex items-baseline gap-3">
          <dt className="w-20 shrink-0 text-[0.72rem] tracking-wider text-subtle uppercase">Email</dt>
          <dd className="min-w-0 break-all select-all">{email}</dd>
        </div>
        <div className="flex items-baseline gap-3">
          <dt className="w-20 shrink-0 text-[0.72rem] tracking-wider text-subtle uppercase">Password</dt>
          <dd className="min-w-0 font-mono break-all select-all">{password}</dd>
        </div>
      </dl>
      <p className="text-[0.8rem] leading-snug text-muted-foreground">Pass these on now. The password is not shown again: if it is lost, set a new one.</p>
      <DialogFooter>
        <button type="button" onClick={copy} className={cn(quiet, "flex items-center justify-center gap-1.5")}>
          {copied ? <Check className="size-4 text-brand" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy both"}
        </button>
        <button type="button" onClick={onClose} className={primary}>
          Done
        </button>
      </DialogFooter>
    </>
  );
}

function AddDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [made, setMade] = React.useState<{ email: string; password: string } | null>(null);

  const close = () => {
    onClose();
    // After the dialog has faded: start clean next time.
    setTimeout(() => {
      setName("");
      setEmail("");
      setPassword("");
      setError(null);
      setMade(null);
    }, 200);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const parsed = NewAccount.safeParse({ name, email, password });
    if (!parsed.success) {
      setError(firstProblem(parsed.error));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api("/api/admin/users", { method: "POST", json: parsed.data });
      if (response.ok) {
        setMade({ email: parsed.data.email, password: parsed.data.password });
        onDone();
      } else setError(await errorOf(response));
    } catch {
      setError("The server could not be reached.");
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-[1.5rem] leading-tight font-normal">{made ? "Account added" : "Add an account"}</DialogTitle>
          <DialogDescription>{made ? "They can sign in on the web and in the desktop app." : "An ordinary account: it can chat and hand over tasks, and sees only its own conversations."}</DialogDescription>
        </DialogHeader>
        {made ? (
          <HandOver email={made.email} password={made.password} onClose={close} />
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
            <Field label="Name" name="name" autoComplete="off" autoFocus placeholder="Ada Lovelace" value={name} onChange={(e) => setName(e.target.value)} />
            <Field label="Email" type="email" name="email" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="ada@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <NewPasswordField value={password} onChange={setPassword} />
            {error ? (
              <p role="alert" className="text-[0.84rem] leading-snug text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <button type="button" onClick={close} className={quiet}>
                Cancel
              </button>
              <button type="submit" disabled={busy} className={primary}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                Add the account
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ email: string; password: string } | null>(null);
  // The dialog fades out after `account` is gone: keep showing who it was about until then.
  const [shown, setShown] = React.useState<Account | null>(null);
  if (account && account !== shown) setShown(account);

  const close = () => {
    onClose();
    setTimeout(() => {
      setPassword("");
      setError(null);
      setDone(null);
    }, 200);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !account) return;
    const parsed = AccountChange.safeParse({ password });
    if (!parsed.success) {
      setError(firstProblem(parsed.error));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api(`/api/admin/users/${account.id}`, { method: "PATCH", json: { password } });
      if (response.ok) setDone({ email: account.email, password });
      else setError(await errorOf(response));
    } catch {
      setError("The server could not be reached.");
    }
    setBusy(false);
  };

  return (
    <Dialog open={account !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-[1.5rem] leading-tight font-normal">{done ? "Password changed" : `A new password for ${shown?.name ?? "this account"}`}</DialogTitle>
          <DialogDescription>{done ? `${shown?.name ?? "The account"} has been signed out everywhere and signs in with the new one.` : "The old password stops working at once, and the account is signed out everywhere."}</DialogDescription>
        </DialogHeader>
        {done ? (
          <HandOver email={done.email} password={done.password} onClose={close} />
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
            <NewPasswordField value={password} onChange={setPassword} invalid={Boolean(error)} />
            {error ? (
              <p role="alert" className="text-[0.84rem] leading-snug text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <button type="button" onClick={close} className={quiet}>
                Cancel
              </button>
              <button type="submit" disabled={busy} className={primary}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                Set the password
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ account, onClose, onDone }: { account: Account | null; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [shown, setShown] = React.useState<Account | null>(null);
  if (account && account !== shown) setShown(account);

  const close = () => {
    onClose();
    setTimeout(() => setError(null), 200);
  };

  const remove = async () => {
    if (busy || !account) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api(`/api/admin/users/${account.id}`, { method: "DELETE" });
      if (response.ok) {
        toast.success(`${account.name}'s account is deleted.`);
        onDone();
        close();
      } else setError(await errorOf(response));
    } catch {
      setError("The server could not be reached.");
    }
    setBusy(false);
  };

  const n = shown?.conversations ?? 0;
  return (
    <Dialog open={account !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-[1.5rem] leading-tight font-normal">Delete {shown?.name ?? "this account"}?</DialogTitle>
          <DialogDescription>
            {shown?.email} is signed out everywhere and can no longer sign in. {n === 0 ? "It has no saved conversations." : n === 1 ? "Its one saved conversation is deleted too." : `Its ${n} saved conversations are deleted too.`} This cannot be undone. What
            the account cost stays in the totals.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-[0.84rem] leading-snug text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <button type="button" onClick={close} className={quiet}>
            Keep the account
          </button>
          <button type="button" onClick={remove} disabled={busy} className={danger}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Delete the account
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
