"use client";

import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../../_client/api";
import { useLang, useText } from "../../_i18n/provider";
import { Button, ErrorPlate } from "../../_ui/kit";
import { passkeyProblemL } from "../../_ui/passkey.text";
import { DEPARTMENT_NAME } from "../[kitchen]/catalogue.text";
import { ACCOUNT_TEXT } from "../[kitchen]/account.text";
import { DOOR_TEXT } from "../door.text";

/**
 * The account's forms, built from the shared kit with plain, semantic markup (the visual system is being redone on
 * claude/design-v2; these move into it). Every text is in door.text.ts or account.text.ts.
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

const input = "min-h-11 w-full border-2 border-line bg-paper px-3 text-[1rem] focus:border-petrol focus:outline-none";
const label = "block text-[0.95rem] font-semibold";
const hint = "mt-0.5 block text-[0.85rem] text-ink-soft";

export function TextField({ id, name, labelText, hintText, type = "text", autoComplete, value, onChange, minLength, maxLength, required = true }: { id: string; name: string; labelText: string; hintText?: string; type?: string; autoComplete?: string; value: string; onChange: (v: string) => void; minLength?: number; maxLength?: number; required?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className={label}>
        {labelText}
      </label>
      <input id={id} name={name} type={type} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} minLength={minLength} maxLength={maxLength} required={required} className={`mt-1 ${input}`} aria-describedby={hintText ? `${id}-hint` : undefined} autoCapitalize="none" spellCheck={false} />
      {hintText && (
        <span id={`${id}-hint`} className={hint}>
          {hintText}
        </span>
      )}
    </div>
  );
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
    <form onSubmit={(e) => void submit(e)} className="space-y-3" aria-label={tx.signInTitle}>
      <TextField id="signin-username" name="username" labelText={tx.username} autoComplete="username" value={username} onChange={setUsername} maxLength={64} />
      <TextField id="signin-password" name="password" labelText={tx.password} type="password" autoComplete="current-password" value={password} onChange={setPassword} maxLength={200} />
      {error && <p role="alert" className="border-l-4 border-ink bg-mist px-3 py-2 text-[0.95rem]">{error}</p>}
      <Button kind="go" type="submit" busy={busy} className="w-full sm:w-auto">
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
      <Button kind="primary" busy={busy} onClick={() => void go()}>
        {tx.testUse(name)}
      </Button>
      {error && (
        <p role="alert" className="mt-1 text-[0.9rem] text-ink-soft">
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const r = await api("POST", "/ui-api/account/signup", { restaurant, username, password });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    onDone();
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label={tx.step1}>
      <TextField id="su-restaurant" name="restaurant" labelText={tx.restaurant} hintText={tx.restaurantHint} autoComplete="organization" value={restaurant} onChange={setRestaurant} minLength={2} maxLength={80} />
      <TextField id="su-username" name="username" labelText={tx.username} hintText={tx.usernameHint} autoComplete="username" value={username} onChange={(v) => setUsername(v.toLowerCase())} minLength={3} maxLength={32} />
      <TextField id="su-password" name="password" labelText={tx.password} hintText={tx.passwordHint} type="password" autoComplete="new-password" value={password} onChange={setPassword} minLength={10} maxLength={200} />
      <p className="text-[0.85rem] text-ink-soft">{tx.noEmail}</p>
      {error && <p role="alert" className="border-l-4 border-ink bg-mist px-3 py-2 text-[0.95rem]">{error}</p>}
      <Button kind="go" type="submit" busy={busy}>
        {busy ? tx.creating : tx.continue}
      </Button>
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
  if (!info || !t) return <div className="h-64 animate-pulse bg-mist" />;
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
    <form onSubmit={(e) => void submit(e)} className="space-y-6" aria-label={tx.step2}>
      {!change && <p className="max-w-[70ch] leading-snug">{tx.mandateIntro(info.account.restaurant)}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField id="m-per-order" labelText={tx.perOrder} hintText={tx.perOrderHint} value={t.perOrderLimitEur} min={0} max={50000} onChange={(v) => setT({ ...t, perOrderLimitEur: v })} />
        <NumberField id="m-weekly" labelText={tx.weekly} hintText={tx.weeklyHint} value={t.weeklyBudgetEur} min={10} max={200000} onChange={(v) => setT({ ...t, weeklyBudgetEur: v })} />
      </div>
      <Checks legend={tx.groups} items={info.vocabulary.groups.map((g) => ({ id: g.id, label: groupName(g) }))} chosen={t.groups} onToggle={(v) => toggle("groups", v)} name="groups" />
      <fieldset className="space-y-4">
        <legend className="display text-[1.4rem]">{tx.rulesTitle}</legend>
        <Checks legend={tx.require} items={info.vocabulary.require.map((id) => ({ id, label: tx.claims[id] ?? id }))} chosen={t.require} onToggle={(v) => toggle("require", v)} name="require" />
        <Checks legend={tx.forbid} items={info.vocabulary.forbid.map((id) => ({ id, label: tx.allergens[id] ?? id }))} chosen={t.forbid} onToggle={(v) => toggle("forbid", v)} name="forbid" />
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="m-signer" name="signer" labelText={tx.signer} hintText={tx.signerHint} value={t.signer} onChange={(v) => setT({ ...t, signer: v })} minLength={2} maxLength={60} />
        <NumberField id="m-lead" labelText={tx.leadDays} value={t.maxLeadDays} min={1} max={30} onChange={(v) => setT({ ...t, maxLeadDays: v })} />
      </div>
      <div>
        <label htmlFor="m-subs" className={label}>
          {tx.substitution}
        </label>
        <select id="m-subs" value={t.substitution} onChange={(e) => setT({ ...t, substitution: e.target.value })} className={`mt-1 ${input}`}>
          {info.vocabulary.substitution.map((s) => (
            <option key={s} value={s}>
              {tx.subs[s] ?? s}
            </option>
          ))}
        </select>
      </div>
      <p className="border-l-4 border-lavender-deep bg-lavender px-3 py-2 text-[0.95rem] leading-snug">{tx.keyNote}</p>
      {error && <p role="alert" className="border-l-4 border-ink bg-mist px-3 py-2 text-[0.95rem]">{error}</p>}
      <Button kind="go" type="submit" busy={busy}>
        {busy ? tx.signing : change ? tx.saveChanges : tx.sign}
      </Button>
    </form>
  );
}

function NumberField({ id, labelText, hintText, value, min, max, onChange }: { id: string; labelText: string; hintText?: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label htmlFor={id} className={label}>
        {labelText}
      </label>
      <input id={id} type="number" inputMode="numeric" min={min} max={max} step={1} required value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Math.round(Number(e.target.value)))} className={`mt-1 tabular ${input}`} aria-describedby={hintText ? `${id}-hint` : undefined} />
      {hintText && (
        <span id={`${id}-hint`} className={hint}>
          {hintText}
        </span>
      )}
    </div>
  );
}

function Checks({ legend, items, chosen, onToggle, name }: { legend: string; items: { id: string; label: string }[]; chosen: string[]; onToggle: (id: string) => void; name: string }) {
  return (
    <fieldset>
      <legend className={label}>{legend}</legend>
      <ul className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <li key={i.id}>
            <label className="flex min-h-10 cursor-pointer items-center gap-2">
              <input type="checkbox" name={name} value={i.id} checked={chosen.includes(i.id)} onChange={() => onToggle(i.id)} className="size-5 accent-petrol" />
              <span>{i.label}</span>
            </label>
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
  return (
    <section id="devices" aria-labelledby="devices-title" className="space-y-3 bg-paper p-5">
      <h2 id="devices-title" className="display text-[1.6rem]">
        {heading ?? atx.devicesTitle}
      </h2>
      {intro !== false && d?.signer && <p className="max-w-[72ch] leading-snug">{atx.devicesIntro(d.signer.name)}</p>}
      {d && <p className="text-ink-soft">{n === 0 ? atx.devicesNone : atx.devicesList(n)}</p>}
      {d && n > 0 && (
        <ul className="space-y-0.5 text-[0.92rem] text-ink-soft">
          {d.devices.map((x) => (
            <li key={x.createdAt}>
              {atx.deviceAdded(new Date(x.createdAt).toLocaleString(lang === "sv" ? "sv-FI" : lang === "fi" ? "fi-FI" : "en-GB", { timeZone: "Europe/Helsinki", dateStyle: "short", timeStyle: "short" }))}
              {x.lastUsedAt ? atx.deviceUsed(new Date(x.lastUsedAt).toLocaleString("fi-FI", { timeZone: "Europe/Helsinki", dateStyle: "short", timeStyle: "short" })) : ""}
            </li>
          ))}
        </ul>
      )}
      {added && <p role="status" className="border-l-4 border-petrol bg-petrol-soft px-3 py-2">{atx.added}</p>}
      {error && <ErrorPlate title={error.title} message={error.body} />}
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" busy={busy === "this"} disabled={!!busy} onClick={() => void addThis()}>
          {atx.addThis}
        </Button>
        <Button kind="secondary" busy={busy === "phone"} disabled={!!busy} onClick={() => void addPhone()}>
          {atx.addPhone}
        </Button>
      </div>
      {phone && (
        <figure className="max-w-[16rem]">
          <div className="aspect-square w-full bg-paper [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: phone.qrSvg }} />
          <figcaption className="mt-2 text-[0.92rem] leading-snug">
            {atx.phoneScan}{" "}
            <a href={phone.url} className="break-all font-semibold text-petrol underline decoration-2 underline-offset-4">
              {atx.phoneOpen}
            </a>
          </figcaption>
        </figure>
      )}
    </section>
  );
}
