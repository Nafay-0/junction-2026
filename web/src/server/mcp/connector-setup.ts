import { CONNECTOR_LIMITS } from "./connectors";

/**
 * Ready-to-paste setup steps for a kitchen's connector address, per assistant, for the portal's "connect your own
 * agent" section. Written from each vendor's own documentation as read on 2026-11-13 (sources in
 * docs/connect-an-agent.md); menus move, so the docs page is the place to re-check.
 */

export type AssistantSetup = {
  id: "claude" | "chatgpt" | "claude-code" | "gemini-cli" | "gemini-app" | "any";
  name: string;
  /** yes: works with only the URL. limited: works on some plans or only partly. no: cannot be connected today. */
  works: "yes" | "limited" | "no";
  /** Plan, region or platform needs, in one line. */
  needs: string;
  steps: string[];
  /** A command or config to paste, when there is one. */
  paste?: string;
  docs: string;
};

export type ConnectorSetup = { url: string; name: string; prompt: string; assistants: AssistantSetup[]; limits: typeof CONNECTOR_LIMITS };

export function connectorSetup({ url, kitchenName }: { url: string; kitchenName: string }): ConnectorSetup {
  const name = `Dock (${kitchenName})`.slice(0, 60);
  const prompt = "Using Dock, order 1,000 litres of lactose-free milk for our kitchen, delivered by Monday.";
  return {
    url,
    name,
    prompt,
    limits: CONNECTOR_LIMITS,
    assistants: [
      {
        id: "claude",
        name: "Claude (claude.ai, Claude Desktop; then also the mobile app)",
        works: "yes",
        needs: "Any plan, Free included (Free allows one custom connector). Team/Enterprise: an owner adds it under Organization settings > Connectors.",
        steps: [
          "Open claude.ai (or Claude Desktop) and sign in.",
          "Open Customize > Connectors, click Add, then Add custom connector.",
          `Name: ${name}. Remote MCP server URL: paste the address. Click Continue.`,
          "If Claude asks how to sign in, choose No sign-in (Dock needs none: the address is the key). Click Add, then Connect.",
          "Start a new chat. Under + > Connectors, make sure Dock is switched on.",
          `Type: "${prompt}" When Claude asks to use a Dock tool, click Allow once (or Always allow).`,
          "Connectors added on the web or Desktop also appear in the Claude mobile app after it next signs in.",
        ],
        docs: "https://claude.com/docs/connectors/custom/add-unlisted",
      },
      {
        id: "chatgpt",
        name: "ChatGPT (web)",
        works: "limited",
        needs: "Web only. Ordering needs a Business or Enterprise/Edu workspace (on Business, an admin or owner creates it); Pro connects read/fetch tools only.",
        steps: [
          "Open chatgpt.com in a browser and sign in to the workspace.",
          "Open Plugins, click +, then Add custom MCP server.",
          `Name: ${name}. Server URL: paste the address. Authentication: No authentication.`,
          'Tick "I understand and want to continue", click Create as a plugin, then install it.',
          "Start a new chat, type @ in the prompt box and pick Dock.",
          `Type: "${prompt}" ChatGPT asks you to confirm each ordering step (write actions): click Confirm.`,
        ],
        docs: "https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt",
      },
      {
        id: "claude-code",
        name: "Claude Code (terminal)",
        works: "yes",
        needs: "Any Claude Code install.",
        steps: ["Paste the command in a terminal, start claude, and type the request."],
        paste: `claude mcp add --transport http dock ${url}`,
        docs: "https://docs.claude.com/en/docs/claude-code/mcp",
      },
      {
        id: "gemini-cli",
        name: "Gemini CLI",
        works: "limited",
        needs: "A paid Gemini API key or a Code Assist Standard/Enterprise licence (free and Google One users moved to Antigravity CLI on 18 June 2026).",
        steps: ["Paste the command, start gemini, and type the request."],
        paste: `gemini mcp add --transport http dock ${url}`,
        docs: "https://geminicli.com/docs/tools/mcp-server",
      },
      {
        id: "gemini-app",
        name: "Gemini app",
        works: "no",
        needs: "Custom apps are for personal accounts in the US, in English, and the documented sign-in is OAuth only; not available here.",
        steps: [],
        docs: "https://support.google.com/gemini/answer/17209137",
      },
      {
        id: "any",
        name: "Any other MCP client",
        works: "yes",
        needs: "Streamable HTTP (MCP 2025-03-26 or later, including 2026-07-28). No headers, no sign-in.",
        steps: ["Give the client the address as its server URL."],
        paste: url,
        docs: "https://modelcontextprotocol.io/specification/latest/basic/transports",
      },
    ],
  };
}
