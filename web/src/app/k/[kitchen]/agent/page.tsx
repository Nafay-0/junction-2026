import type { Metadata } from "next";
import { PRODUCT_NAME } from "../../../_ui/brand";
import { AgentRules } from "../agent-rules";

export const metadata: Metadata = { title: `${PRODUCT_NAME}: agent and rules` };

export default function Agent() {
  return <AgentRules />;
}
