import { redirect } from "next/navigation";

/** The first big screen lived here; the wall at / now shows the join code and the live feed. */
export default function ScreenPage() {
  redirect("/");
}
