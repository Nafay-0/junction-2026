import type { Metadata } from "next";
import { pick } from "../../_i18n/lang";
import { requestLang } from "../../_i18n/server";
import { PRODUCT_NAME } from "../../_ui/brand";
import { ThreadPage } from "./thread";
import { GuideLink } from "./guide-link";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${PRODUCT_NAME}: ${pick(await requestLang(), { en: "your agent", fi: "agenttisi", sv: "din agent" })}` };
}

/**
 * Where a signed-in kitchen lands: its agent (docs/DESIGN.md §7b). The day's opening card says what needs the kitchen
 * today, from records, each acted on in place; then the composer and the starting points. One front page, not two.
 */
export default function KitchenHome() {
  return (
    <>
      <GuideLink />
      <ThreadPage />
    </>
  );
}
