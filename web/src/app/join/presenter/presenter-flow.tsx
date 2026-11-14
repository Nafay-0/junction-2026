"use client";

import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { KeyRound, ScanFace } from "lucide-react";
import { api, passkeyProblem } from "../../_client/api";
import { Card, IconDisc, Input, Select, Skeleton, Spinner } from "../../_ui/kit";
import { moneyShort } from "../../_ui/plain";
import { PhoneProblem, bigButton } from "../../_ui/phone";
import { JOIN_TEXT } from "../join-flow.text";

type Role = { slug: string; kitchenName: string; role: string; name: string; maxApprovalCents: number; enrolled: boolean };
type Begin = { options: PublicKeyCredentialCreationOptionsJSON; approver: Role; replaces?: string };

const eur = (c: number) => moneyShort(c);

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
    <div className="flex flex-1 flex-col">
      <IconDisc size={56}>
        <KeyRound size={25} />
      </IconDisc>
      <h1 className="display mt-5 text-[2.1rem] leading-[1.05] text-ink">Sign for a demo kitchen</h1>
      <p className="mt-3 leading-relaxed text-ink-soft">
        <strong className="font-semibold text-ink">{chosen ? `${chosen.name} at ${chosen.kitchenName}` : "This kitchen's approver"}</strong> is made up for the demo. With the operations passcode
        you can take their place on this phone: AimoPilot stores a passkey made here, and every sign-off needs it, exactly as for a real approver.
      </p>
      <Card className="mt-6 space-y-4 p-4">
        {roles && roles.length > 1 && (
          <Select label="Sign as" value={role} onChange={setRole} disabled={!!begin}>
            {roles.map((r) => (
              <option key={r.role} value={r.role}>
                {r.name}, {r.role.replaceAll("_", " ")} (up to {eur(r.maxApprovalCents)}){r.enrolled ? ", taken" : ""}
              </option>
            ))}
          </Select>
        )}
        {!roles && !problem && <Skeleton className="h-12" />}
        {!begin ? (
          <>
            <Input label="Operations passcode" type="password" autoComplete="off" value={passcode} onChange={setPasscode} />
            <Input label="Your name (for the audit log)" value={presenter} maxLength={60} onChange={setPresenter} />
          </>
        ) : null}
        {begin?.replaces && <p className="rounded-md bg-notice-soft px-3.5 py-2.5 text-[0.95rem] leading-snug text-notice">This replaces the passkey {begin.replaces} was signed with before.</p>}
      </Card>
      {!supported && <PhoneProblem quiet title={JOIN_TEXT.en.noPasskeyTitle} body="This browser can't make passkeys here. Use Safari on iPhone or Chrome on Android, over https." />}
      {problem && <PhoneProblem title={JOIN_TEXT.en.failed} body={problem} />}
      <div className="mt-auto pt-8">
        {!begin ? (
          <button type="button" className={bigButton("dark")} disabled={busy || !role} onClick={() => void check()}>
            {busy && <Spinner size={18} />}
            {busy ? "Checking…" : "Continue"}
          </button>
        ) : (
          <button type="button" className={bigButton("go")} disabled={busy || !supported} onClick={() => void create()}>
            {busy ? <Spinner size={18} /> : <ScanFace aria-hidden size={22} strokeWidth={2.1} />}
            {busy ? "Waiting for the passkey…" : "Create my passkey"}
          </button>
        )}
      </div>
    </div>
  );
}
