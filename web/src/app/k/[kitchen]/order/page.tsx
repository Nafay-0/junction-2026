import type { Metadata } from "next";
import { PRODUCT_NAME } from "../../../_ui/brand";
import { pick } from "../../../_i18n/lang";
import { requestLang } from "../../../_i18n/server";
import { Console } from "../console";

export async function generateMetadata(): Promise<Metadata> {
  const lang = await requestLang();
  return { title: `${PRODUCT_NAME}: ${pick(lang, { en: "order", fi: "tilaa", sv: "beställ" })}` };
}

/** Order: the agent's staged work on one request, with the kitchen's earlier requests beside it. */
export default function OrderPage() {
  return <Console />;
}
