import { redirect } from "next/navigation";

/** /k on its own: the returning demo kitchen. */
export default function KitchenIndex() {
  redirect("/k/kaari");
}
