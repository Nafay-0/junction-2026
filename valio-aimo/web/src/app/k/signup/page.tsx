import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { ACCOUNT_COOKIE } from "@/server/accounts/http";
import { getRuntime } from "@/server/runtime";
import { LangProvider } from "../../_i18n/provider";
import { DEFAULT_LANG } from "../../_i18n/lang";
import { chosenLang, requestLang } from "../../_i18n/server";
import { DOOR_TEXT } from "../door.text";
import { DoorShell } from "../_account/shell";
import { SignUpFlow } from "./flow";

export async function generateMetadata(): Promise<Metadata> {
  return { title: DOOR_TEXT[await requestLang()].signupTitle };
}

/** /k/signup: step 1 the restaurant (name, username, password), step 2 the mandate it signs, then a signing device. */
export default function SignUp() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-mist" />}>
      <Loaded />
    </Suspense>
  );
}

async function Loaded() {
  await connection();
  const [jar, rt, chosen] = await Promise.all([cookies(), getRuntime(), chosenLang()]);
  const lang = chosen ?? DEFAULT_LANG;
  const s = await rt.accounts.session(jar.get(ACCOUNT_COOKIE)?.value);
  const me = s ? rt.accounts.view(s.account) : undefined;
  return (
    <LangProvider initial={chosen}>
      <DoorShell lang={lang}>
        <SignUpFlow signedIn={me ? { restaurant: me.restaurant, kitchen: me.kitchen, kind: me.kind } : undefined} />
      </DoorShell>
    </LangProvider>
  );
}
