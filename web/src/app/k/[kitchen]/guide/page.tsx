import type { Metadata } from "next";
import { pick } from "../../../_i18n/lang";
import { requestLang } from "../../../_i18n/server";
import { PRODUCT_NAME } from "../../../_ui/brand";
import { TryEverything } from "../guide";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${PRODUCT_NAME}: ${pick(await requestLang(), { en: "try everything", fi: "kokeile kaikkea", sv: "pröva allt" })}` };
}

/** A demo account's "Try everything" (server/demo/service.ts): every capability, in order, ticked from the ledger. */
export default function Guide() {
  return <TryEverything />;
}
