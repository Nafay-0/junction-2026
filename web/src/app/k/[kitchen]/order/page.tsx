import type { Metadata } from "next";
import { PRODUCT_NAME } from "../../../_ui/brand";
import { pick } from "../../../_i18n/lang";
import { requestLang } from "../../../_i18n/server";
import { ThreadPage } from "../thread";

export async function generateMetadata(): Promise<Metadata> {
  const lang = await requestLang();
  return { title: `${PRODUCT_NAME}: ${pick(lang, { en: "order", fi: "tilaa", sv: "beställ" })}` };
}

/** Order: the kitchen's conversation with its agent, full width (the same thread the dock shows on other pages). */
export default function OrderPage() {
  return <ThreadPage />;
}
