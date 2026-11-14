import { Suspense, type ReactNode } from "react";
import { LangProvider } from "../_i18n/provider";
import type { Lang } from "../_i18n/lang";
import { chosenLang } from "../_i18n/server";
import { PhoneShell } from "./phone";

type Props = { children: ReactNode; context?: string | Record<Lang, string>; tone?: "plain" | "gate" };

/**
 * A phone page in the buyer's language. The language comes from the cookie, which is request-time data, so it is read
 * inside Suspense: the static shell shows the empty phone frame (its words picked from the cookie in the browser),
 * and the page itself streams in with the right language on the first paint.
 */
export function PhonePage({ children, context, tone }: Props) {
  return (
    <Suspense
      fallback={
        <LangProvider>
          <PhoneShell context={context} tone={tone}>
            {null}
          </PhoneShell>
        </LangProvider>
      }
    >
      <Chosen context={context} tone={tone}>
        {children}
      </Chosen>
    </Suspense>
  );
}

async function Chosen({ children, context, tone }: Props) {
  return (
    <LangProvider initial={await chosenLang()}>
      <PhoneShell context={context} tone={tone}>
        {children}
      </PhoneShell>
    </LangProvider>
  );
}
