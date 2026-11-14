import type { Metadata } from "next";
import { pick } from "../../../_i18n/lang";
import { requestLang } from "../../../_i18n/server";
import { PRODUCT_NAME } from "../../../_ui/brand";
import { AgentRules } from "../agent-rules";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${PRODUCT_NAME}: ${pick(await requestLang(), { en: "agent and rules", fi: "agentti ja säännöt", sv: "agent och regler" })}` };
}

export default function Agent() {
  return <AgentRules />;
}
