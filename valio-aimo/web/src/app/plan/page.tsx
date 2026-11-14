import { redirect } from "next/navigation";

/** /plan: the menu planner preview, for the restaurant kitchen by default. */
export default function PlanIndex() {
  redirect("/plan/kaari");
}
