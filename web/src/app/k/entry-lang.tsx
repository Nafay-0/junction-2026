"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LangSwitch, useLang } from "../_i18n/provider";
import type { Lang } from "../_i18n/lang";

/**
 * The language switch on the kitchen picker. The picker's words are written on the server from the cookie, so when
 * the choice changes here (or an earlier choice is picked up from local storage) the page is fetched again.
 */
export function EntryLangSwitch({ rendered }: { rendered: Lang }) {
  const { lang } = useLang();
  const router = useRouter();
  useEffect(() => {
    if (lang !== rendered) router.refresh();
  }, [lang, rendered, router]);
  return <LangSwitch tone="dark" />;
}
