/** The outside buyer that runs on Aiven Managed Agents (see launcher.ts). Light on purpose: the ops views import it for the label. */
export const AIVEN_BUYER = {
  agentId: "agent_laakso_aiven_01",
  label: "Laakso's buyer on Aiven Managed Agents",
  integration: "dock-aiven",
  agentName: "Dock showcase buyer (Laakso Catering)",
  model: "gemini-3.8-flash",
  mandateMinutes: 20,
} as const;
