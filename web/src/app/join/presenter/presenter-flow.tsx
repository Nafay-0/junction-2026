"use client";

import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, passkeyProblem } from "../../_client/api";

type Role = { slug: string; kitchenName: string; role: string; name: string; maxApprovalCents: number; enrolled: boolean };
type Begin = { options: PublicKeyCredentialCreationOptionsJSON; approver: Role; replaces?: string };

const eur = (c: number) => `€${(c / 100).toLocaleString("en-GB")}`;

export function PresenterFlow() {
  const router = useRouter();
  const q = useSearchParams();
  const kitchen = q.get("kitchen") ?? "laakso";
  const next = q.get("next") ?? "/approver";
  const [roles, setRoles] = useState<Role[]>();
  const [role, setRole] = useState(q.get("role") ?? "");
  const [passcode, setPasscode] = useState("");
  const [presenter, setPresenter] = useState("");
  const [begin, setBegin] = useState<Begin>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    queueMicrotask(() => setSupported(browserSupportsWebAuthn() && window.isSecureContext));
    void api<{ roles: Role[] }>("GET", `/ui-api/presenter/enrol?kitchen=${encodeURIComponent(kitchen)}`).then((r) => {
      if (!r.ok) return setProblem(r.error.message);
      setRoles(r.data.roles);
      setRole((cur) => (r.data.roles.some((x) => x.role === cur) ? cur : r.data.roles[0]?.role ?? ""));
    });
  }, [kitchen]);

  // Step 1: the passcode. Only then does Dock prepare a passkey prompt (Safari wants the prompt to open straight from a tap).
  async function check() {
    setBusy(true);
    setProblem(undefined);
    const r = await api<Begin>("POST", "/ui-api/presenter/enrol", { kitchen, role, passcode, presenter });
    setBusy(false);
    if (!r.ok) return setProblem(r.error.message);
    setBegin(r.data);
  }

  // Step 2: the passkey, made on this phone.
  async function create() {
    if (!begin) return;
    setBusy(true);
    setProblem(undefined);
    let response;
    try {
      response = await startRegistration({ optionsJSON: begin.options });
    } catch (err) {
      setBusy(false);
      setBegin(undefined);
      return setProblem(passkeyProblem(err).body);
    }
    const r = await api<{ approver: Role }>("POST", "/ui-api/presenter/enrol/verify", { response });
    setBusy(false);
    if (!r.ok) {
      setBegin(undefined);
      return setProblem(r.error.message);
    }
    router.replace(next);
  }

  const chosen = roles?.find((r) => r.role === role);
  return (
    <div className="flex flex-1 flex-col gap-4">
      <h1 className="text-3xl font-bold">Sign for a demo kitchen</h1>
      <p>
        {chosen ? `${chosen.name} at ${chosen.kitchenName}` : "This kitchen's approver"} is made up for the demo. With the operations passcode you can take their place on this
        phone: AimoPilot stores a passkey made here, and every sign-off needs it, exactly as for a real approver.
      </p>
      {roles && roles.length > 1 && (
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Sign as</span>
          <select className="h-12 rounded-xl border border-neutral-300 px-3" value={role} onChange={(e) => setRole(e.target.value)} disabled={!!begin}>
            {roles.map((r) => (
              <option key={r.role} value={r.role}>
                {r.name}, {r.role.replaceAll("_", " ")} (up to {eur(r.maxApprovalCents)}){r.enrolled ? ", taken" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {!begin ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Operations passcode</span>
            <input className="h-12 rounded-xl border border-neutral-300 px-3" type="password" autoComplete="off" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Your name (for the audit log)</span>
            <input className="h-12 rounded-xl border border-neutral-300 px-3" value={presenter} maxLength={60} onChange={(e) => setPresenter(e.target.value)} />
          </label>
          <button type="button" className="h-14 rounded-xl bg-neutral-900 text-lg font-semibold text-white disabled:opacity-50" disabled={busy || !role} onClick={() => void check()}>
            {busy ? "Checking…" : "Continue"}
          </button>
        </>
      ) : (
        <>
          {begin.replaces && <p className="rounded-xl border-2 border-amber-500 p-3 text-base">This replaces the passkey {begin.replaces} was signed with before.</p>}
          <button type="button" className="h-14 rounded-xl bg-neutral-900 text-lg font-semibold text-white disabled:opacity-50" disabled={busy || !supported} onClick={() => void create()}>
            {busy ? "Waiting for the passkey…" : "Create my passkey"}
          </button>
        </>
      )}
      {!supported && <p className="text-red-800">This browser can&apos;t make passkeys here. Use Safari on iPhone or Chrome on Android, over https.</p>}
      {problem && <p className="text-red-800" role="alert">{problem}</p>}
    </div>
  );
}
