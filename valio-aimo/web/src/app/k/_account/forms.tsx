"use client";

import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../../_client/api";
import { useLang, useText } from "../../_i18n/provider";
import { ArrowRight, CircleAlert, Check, KeyRound, QrCode } from "lucide-react";
import { Button, Card, Checkbox, ErrorPlate, IconDisc, Input, Panel, Select, Skeleton } from "../../_ui/kit";
import { passkeyProblemL } from "../../_ui/passkey.text";
import { DEPARTMENT_NAME } from "../[kitchen]/catalogue.text";
import { ACCOUNT_TEXT } from "../[kitchen]/account.text";
import { DOOR_TEXT } from "../door.text";

/**
 * The account's forms, built from the shared kit (web/docs/DESIGN.md). Every text is in door.text.ts or
 * account.text.ts.
 */

export type AccountView = { username: string; restaurant: string; kind: "own" | "demo" | "test"; kitchen?: string; shared: boolean; terms?: Terms };
export type Terms = {
  perOrderLimitEur: number;
  weeklyBudgetEur: number;
  groups: string[];
  require: string[];
  forbid: string[];
  signer: string;
  substitution: string;
  maxLeadDays: number;
};
type MandateInfo = {
  account: AccountView;
  defaults: Terms;
  current: Terms | null;
  vocabulary: { groups: { id: string; name: string }[]; require: string[]; forbid: string[]; substitution: string[] };
  editable: boolean;
};

/** A form's own error: what went wrong, in the field's colours, under the fields. */
function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-bad/20 bg-bad-soft px-3.5 py-2.5 text-[0.95rem] leading-snug">
      <CircleAlert aria-hidden size={18} className="mt-0.5 shrink-0 text-bad" />
      <span>{children}</span>
    </p>
  );
}

export function TextField({ id, name, labelText, hintText, type = "text", autoComplete, value, onChange, minLength, maxLength, required = true }: { id: string; name: string; labelText: string; hintText?: string; type?: string; autoComplete?: string; value: string; onChange: (v: string) => void; minLength?: number; maxLength?: number; required?: boolean }) {
  return <Input id={id} name={name} label={labelText} hint={hintText} type={type} autoComplete={autoComplete} value={value} onChange={onChange} minLength={minLength} maxLength={maxLength} required={required} autoCapitalize="none" spellCheck={false} />;
}

/** Sign in with a username and password; on success go where the server says (the shop, or step 2 of sign-up). */
export function SignInForm({ prefill }: { prefill?: string }) {
  const tx = useText(DOOR_TEXT);
  const router = useRouter();
  const [username, setUsername] = useState(prefill ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const r = await api<{ next: string }>("POST", "/ui-api/account/signin", { username, password });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    router.push(r.data.next);
    router.refresh();
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label={tx.signInTitle}>
      <TextField id="signin-username" name="username" labelText={tx.username} autoComplete="username" value={username} onChange={setUsername} maxLength={64} />
      <TextField id="signin-password" name="password" labelText={tx.password} type="password" autoComplete="current-password" value={password} onChange={setPassword} maxLength={200} />
      {error && <FormError>{error}</FormError>}
      <Button kind="go" type="submit" size="lg" busy={busy} className="mt-1 w-full">
        {busy ? tx.signingIn : tx.signInButton}
      </Button>
    </form>
  );
}

/** One click into a shared test account: the credentials are public (server/accounts/test-accounts.ts). */
export function TestSignIn({ username, password, name }: { username: string; password: string; name: string }) {
  const tx = useText(DOOR_TEXT);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function go() {
    setBusy(true);
    setError(undefined);
    const r = await api<{ next: string }>("POST", "/ui-api/account/signin", { username, password });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    router.push(r.data.next);
    router.refresh();
  }
  return (
    <div>
      <Button kind="primary" busy={busy} onClick={() => void go()} className="w-full">
        <span className="min-w-0 text-balance">{tx.testUse(name)}</span>
        {!busy && <ArrowRight aria-hidden size={17} className="shrink-0" />}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-[0.9rem] leading-snug text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

export function SignOutButton({ kind = "quiet", next = "/k" }: { kind?: "quiet" | "secondary"; next?: string }) {
  const tx = useText(ACCOUNT_TEXT);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      kind={kind}
      busy={busy}
      onClick={async () => {
        setBusy(true);
        await api("POST", "/ui-api/account/signout", {});
        try {
          for (const k of Object.keys(sessionStorage)) if (k.startsWith("dock-")) sessionStorage.removeItem(k); // this tab's basket and agent panel
        } catch {
          // private window
        }
        router.push(next);
        router.refresh();
      }}
    >
      {busy ? tx.signingOut : tx.signOut}
    </Button>
  );
}

/** Step 1 of sign-up: the restaurant's name, a username and a password. Nothing else. */
export function SignUpForm({ onDone }: { onDone: () => void }) {
  const tx = useText(DOOR_TEXT);
  const [restaurant, setRestaurant] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const { lang } = useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const r = await api("POST", "/ui-api/account/signup", { restaurant, username, password, email, lang });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    onDone();
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label={tx.step1}>
      <TextField id="su-restaurant" name="restaurant" labelText={tx.restaurant} hintText={tx.restaurantHint} autoComplete="organization" value={restaurant} onChange={setRestaurant} minLength={2} maxLength={80} />
      <TextField id="su-email" name="email" labelText={tx.email} hintText={tx.emailHint} type="email" autoComplete="email" value={email} onChange={setEmail} minLength={3} maxLength={254} />
      <TextField id="su-username" name="username" labelText={tx.username} hintText={tx.usernameHint} autoComplete="username" value={username} onChange={(v) => setUsername(v.toLowerCase())} minLength={3} maxLength={32} />
      <TextField id="su-password" name="password" labelText={tx.password} hintText={tx.passwordHint} type="password" autoComplete="new-password" value={password} onChange={setPassword} minLength={10} maxLength={200} />
      <p className="text-[0.86rem] leading-snug text-ink-soft">{tx.noEmail}</p>
      {error && <FormError>{error}</FormError>}
      <ThumbBar>
        <Button kind="go" type="submit" size="lg" busy={busy} className="w-full sm:w-auto sm:min-w-[12rem]">
          {busy ? tx.creating : tx.continue}
          {!busy && <ArrowRight aria-hidden size={18} />}
        </Button>
      </ThumbBar>
    </form>
  );
}

/** What the agent may do: the mandate's terms with sensible defaults, signed by the button. Step 2, and Agent and rules. */
export function MandateForm({ onSigned, change = false }: { onSigned: (r: { next: string; first: boolean }) => void; change?: boolean }) {
  const tx = useText(DOOR_TEXT);
  const atx = useText(ACCOUNT_TEXT);
  const { lang } = useLang();
  const [info, setInfo] = useState<MandateInfo>();
  const [t, setT] = useState<Terms>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<MandateInfo>("GET", "/ui-api/account/mandate").then((r) => {
      if (!r.ok) return setError(r.error.message);
      setInfo(r.data);
      setT(r.data.current ?? r.data.defaults);
    });
  }, []);
  if (error && !info) return <ErrorPlate title={tx.failed} message={error} />;
  if (!info || !t)
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-5 w-3/4" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-40" />
      </div>
    );
  if (!info.editable) return <p className="text-ink-soft">{atx.mandateFixed}</p>;
  const toggle = (k: "groups" | "require" | "forbid", v: string) => setT({ ...t, [k]: t[k].includes(v) ? t[k].filter((x) => x !== v) : [...t[k], v] });
  const groupName = (g: { id: string; name: string }) => (lang === "en" ? g.name : (DEPARTMENT_NAME[lang][g.id] ?? g.name));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const r = await api<{ next: string; first: boolean }>("POST", "/ui-api/account/mandate", { terms: t });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    onSigned(r.data);
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-8" aria-label={tx.step2}>
      {!change && <p className="max-w-[64ch] text-[1.02rem] leading-relaxed text-ink-soft">{tx.mandateIntro(info.account.restaurant)}</p>}
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <NumberField id="m-per-order" labelText={tx.perOrder} hintText={tx.perOrderHint} value={t.perOrderLimitEur} min={0} max={50000} suffix="€" onChange={(v) => setT({ ...t, perOrderLimitEur: v })} />
        <NumberField id="m-weekly" labelText={tx.weekly} hintText={tx.weeklyHint} value={t.weeklyBudgetEur} min={10} max={200000} suffix="€" onChange={(v) => setT({ ...t, weeklyBudgetEur: v })} />
      </div>
      <Checks legend={tx.groups} items={info.vocabulary.groups.map((g) => ({ id: g.id, label: groupName(g) }))} chosen={t.groups} onToggle={(v) => toggle("groups", v)} name="groups" />
      <fieldset className="space-y-6">
        <legend className="display mb-4 text-[1.35rem]">{tx.rulesTitle}</legend>
        <Checks legend={tx.require} items={info.vocabulary.require.map((id) => ({ id, label: tx.claims[id] ?? id }))} chosen={t.require} onToggle={(v) => toggle("require", v)} name="require" short />
        <Checks legend={tx.forbid} items={info.vocabulary.forbid.map((id) => ({ id, label: tx.allergens[id] ?? id }))} chosen={t.forbid} onToggle={(v) => toggle("forbid", v)} name="forbid" short />
      </fieldset>
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <TextField id="m-signer" name="signer" labelText={tx.signer} hintText={tx.signerHint} value={t.signer} onChange={(v) => setT({ ...t, signer: v })} minLength={2} maxLength={60} />
        <NumberField id="m-lead" labelText={tx.leadDays} value={t.maxLeadDays} min={1} max={30} onChange={(v) => setT({ ...t, maxLeadDays: v })} />
        <Select id="m-subs" label={tx.substitution} className="sm:col-span-2" value={t.substitution} onChange={(v) => setT({ ...t, substitution: v })}>
          {info.vocabulary.substitution.map((s) => (
            <option key={s} value={s}>
              {tx.subs[s] ?? s}
            </option>
          ))}
        </Select>
      </div>
      <Panel className="flex items-start gap-3 p-4">
        <KeyRound aria-hidden size={18} className="mt-0.5 shrink-0 text-petrol" />
        <p className="text-[0.92rem] leading-snug text-ink-soft">{tx.keyNote}</p>
      </Panel>
      {error && <FormError>{error}</FormError>}
      <ThumbBar sticky={!change}>
        <Button kind="go" type="submit" size="lg" busy={busy} className="w-full sm:w-auto">
          {busy ? tx.signing : change ? tx.saveChanges : tx.sign}
        </Button>
      </ThumbBar>
    </form>
  );
}

/**
 * Where a form's main action sits: full width under the fields on a phone (and, with `sticky`, held at the bottom
 * edge under the thumb while the form scrolls), an ordinary button on a desk.
 */
function ThumbBar({ children, sticky = false }: { children: ReactNode; sticky?: boolean }) {
  return <div className={sticky ? "sticky bottom-0 z-10 -mx-5 border-t border-line bg-paper/95 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none" : "pt-1"}>{children}</div>;
}

function NumberField({ id, labelText, hintText, value, min, max, suffix, onChange }: { id: string; labelText: string; hintText?: string; value: number; min: number; max: number; suffix?: string; onChange: (v: number) => void }) {
  return <Input id={id} type="number" inputMode="numeric" min={min} max={max} step={1} required label={labelText} hint={hintText} suffix={suffix} fieldClassName="tabular" value={Number.isFinite(value) ? value : ""} onChange={(v) => onChange(Math.round(Number(v)))} />;
}

function Checks({ legend, items, chosen, onToggle, name, short = false }: { legend: string; items: { id: string; label: string }[]; chosen: string[]; onToggle: (id: string) => void; name: string; short?: boolean }) {
  return (
    <fieldset>
      <legend className="flex w-full items-baseline justify-between gap-3 text-[0.95rem] font-semibold">
        {legend}
        <span className="text-[0.82rem] font-normal text-ink-soft tabular">
          {items.filter((i) => chosen.includes(i.id)).length}/{items.length}
        </span>
      </legend>
      <ul className={`mt-2.5 grid gap-2 ${short ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
        {items.map((i) => (
          <li key={i.id}>
            <Checkbox card name={name} value={i.id} checked={chosen.includes(i.id)} onChange={() => onToggle(i.id)} label={<span className="hyphens-auto">{i.label}</span>} className="h-full" />
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

type Devices = { signer?: { name: string; role: string }; devices: { createdAt: string; lastUsedAt?: string; deviceType: string }[] };

/**
 * Signing devices: this device's passkey, or a phone by QR code (a one-time link; the phone runs the same passkey
 * enrolment as a kitchen's approver). An order above the limit is signed only with one of these.
 */
export function DevicePanel({ heading, intro }: { heading?: ReactNode; intro?: boolean }) {
  const atx = useText(ACCOUNT_TEXT);
  const { lang } = useLang();
  const [d, setD] = useState<Devices>();
  const [busy, setBusy] = useState<"this" | "phone">();
  const [error, setError] = useState<{ title: string; body: string }>();
  const [phone, setPhone] = useState<{ url: string; qrSvg: string }>();
  const [added, setAdded] = useState(false);
  const load = () => void api<Devices>("GET", "/ui-api/account/device").then((r) => r.ok && setD(r.data));
  useEffect(load, []);
  async function addThis() {
    setBusy("this");
    setError(undefined);
    if (!browserSupportsWebAuthn()) {
      setBusy(undefined);
      return setError({ title: atx.deviceFailed, body: atx.noPasskeys });
    }
    const begin = await api<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("POST", "/ui-api/account/device", { step: "begin" });
    if (!begin.ok) {
      setBusy(undefined);
      return setError({ title: atx.deviceFailed, body: begin.error.message });
    }
    try {
      const response = await startRegistration({ optionsJSON: begin.data.options });
      const done = await api("POST", "/ui-api/account/device", { step: "verify", response });
      if (!done.ok) setError({ title: atx.deviceFailed, body: done.error.message });
      else setAdded(true);
    } catch (err) {
      setError(passkeyProblemL(err, lang));
    }
    setBusy(undefined);
    load();
  }
  async function addPhone() {
    setBusy("phone");
    const r = await api<{ url: string; qrSvg: string }>("POST", "/ui-api/account/device/link", {});
    setBusy(undefined);
    if (!r.ok) return setError({ title: atx.deviceFailed, body: r.error.message });
    setPhone(r.data);
  }
  const n = d?.devices.length ?? 0;
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "sv" ? "sv-FI" : lang === "fi" ? "fi-FI" : "en-GB", { timeZone: "Europe/Helsinki", dateStyle: "short", timeStyle: "short" });
  return (
    <section id="devices" aria-labelledby="devices-title" className="scroll-mt-28">
      <Card pad className="space-y-4">
        <div>
          <div className="flex items-center gap-3">
            <IconDisc size={40} tone={n > 0 ? "good" : "petrol"}>{n > 0 ? <Check size={19} strokeWidth={2.4} /> : <KeyRound size={18} />}</IconDisc>
            <h2 id="devices-title" className="display min-w-0 text-[1.45rem] leading-tight">
              {heading ?? atx.devicesTitle}
            </h2>
          </div>
          {intro !== false && d?.signer && <p className="mt-3 max-w-[64ch] leading-relaxed text-ink-soft">{atx.devicesIntro(d.signer.name)}</p>}
        </div>
        {!d ? (
          <Skeleton className="h-12" />
        ) : (
          <div className="rounded-lg bg-surface px-4 py-3">
            <p className={n === 0 ? "text-[0.95rem] leading-snug text-ink-soft" : "font-semibold"}>{n === 0 ? atx.devicesNone : atx.devicesList(n)}</p>
            {n > 0 && (
              <ul className="mt-1.5 space-y-1 text-[0.9rem] text-ink-soft">
                {d.devices.map((x) => (
                  <li key={x.createdAt} className="flex items-center gap-2">
                    <KeyRound aria-hidden size={15} className="shrink-0" />
                    <span className="tabular">
                      {atx.deviceAdded(when(x.createdAt))}
                      {x.lastUsedAt ? atx.deviceUsed(when(x.lastUsedAt)) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {added && (
          <p role="status" className="flex items-start gap-2 rounded-md bg-good-soft px-3.5 py-2.5 text-[0.95rem] leading-snug text-good">
            <Check aria-hidden size={18} strokeWidth={2.4} className="mt-0.5 shrink-0" />
            <span>{atx.added}</span>
          </p>
        )}
        {error && <ErrorPlate title={error.title} message={error.body} />}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
          <Button kind="primary" busy={busy === "this"} disabled={!!busy} onClick={() => void addThis()}>
            {busy !== "this" && <KeyRound aria-hidden size={17} />}
            {atx.addThis}
          </Button>
          <Button kind="secondary" busy={busy === "phone"} disabled={!!busy} onClick={() => void addPhone()}>
            {busy !== "phone" && <QrCode aria-hidden size={17} />}
            {atx.addPhone}
          </Button>
        </div>
        {phone && (
          <figure className="sheet-up flex flex-col gap-4 rounded-lg border border-line p-4 sm:flex-row sm:items-center">
            <div className="aspect-square w-full max-w-[13rem] shrink-0 rounded-md bg-paper p-1 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: phone.qrSvg }} />
            <figcaption className="text-[0.95rem] leading-relaxed">
              {atx.phoneScan}{" "}
              <a href={phone.url} className="mt-1 block break-all font-semibold text-petrol underline decoration-petrol/30 underline-offset-4 hover:decoration-petrol">
                {atx.phoneOpen}
              </a>
            </figcaption>
          </figure>
        )}
      </Card>
    </section>
  );
}
