import { defineText } from "../../_i18n/lang";

/** "Call your agent": the voice call control in the assistant panel. */
export const CALL_AGENT_TEXT = defineText({
  en: {
    call: "Call your agent",
    checking: "Checking…",
    connecting: "Voice is being connected.",
    scan: (agent: string) => `Scan with your phone to talk to ${agent}.`,
  },
  fi: {
    call: "Soita agentille",
    checking: "Tarkistetaan…",
    connecting: "Puheyhteyttä otetaan vielä käyttöön.",
    scan: (agent: string) => `Skannaa koodi puhelimella, niin pääset puhumaan agentin ${agent} kanssa.`,
  },
  sv: {
    call: "Ring din agent",
    checking: "Kontrollerar…",
    connecting: "Röstsamtal kopplas in snart.",
    scan: (agent: string) => `Skanna med telefonen för att prata med ${agent}.`,
  },
});
