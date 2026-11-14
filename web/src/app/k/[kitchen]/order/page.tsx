import type { Metadata } from "next";
import { PRODUCT_NAME } from "../../../_ui/brand";
import { pick } from "../../../_i18n/lang";
import { requestLang } from "../../../_i18n/server";
import { ThreadPage } from "../thread";

export async function generateMetadata(): Promise<Metadata> {
  const lang = await requestLang();
  return { title: `${PRODUCT_NAME}: ${pick(lang, { en: "order", fi: "tilaa", sv: "beställ" })}` };
}

/** The agent, full page: the same conversation the dock shows on every other page (one thread, one engine). */
export default function OrderPage() {
  return <ThreadPage />;
}
