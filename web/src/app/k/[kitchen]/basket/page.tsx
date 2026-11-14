import type { Metadata } from "next";
import { BasketPage } from "../basket";
import { requestLang } from "../../../_i18n/server";
import { LAYOUT_TEXT } from "../layout.text";

export async function generateMetadata(): Promise<Metadata> {
  return { title: LAYOUT_TEXT[await requestLang()].title.basket };
}

export default function Basket() {
  return <BasketPage />;
}
