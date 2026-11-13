import type { Metadata } from "next";
import { PRODUCT_NAME } from "../../../_ui/brand";
import { BasketPage } from "../basket";

export const metadata: Metadata = { title: `${PRODUCT_NAME}: basket` };

export default function Basket() {
  return <BasketPage />;
}
