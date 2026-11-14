import type { Metadata } from "next";
import { pick } from "../../_i18n/lang";
import { requestLang } from "../../_i18n/server";
import { PRODUCT_NAME } from "../../_ui/brand";
import { Home } from "./home";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${PRODUCT_NAME}: ${pick(await requestLang(), { en: "kitchen home", fi: "keittiön etusivu", sv: "kökets startsida" })}` };
}

/** Home: what needs the buyer now, what the agent did this week, and the standing orders. */
export default function KitchenHome() {
  return <Home />;
}
