import { Fragment, createElement, type ReactNode } from "react";
import { defineText } from "../_i18n/lang";

const r = (...xs: ReactNode[]) => createElement(Fragment, null, ...xs);

/** /approver: the approver's own screen on their phone. Clock times arrive already prefixed ("klo 14.05"). */
export const APPROVER_TEXT = defineText({
  en: {
    loading: "Opening your screen…",
    notJoined: "You haven't joined yet",
    notJoinedBody: "Scan the QR code on the big screen to become a kitchen's purchasing manager.",
    join: "Join on this phone",
    offline: "Can't reach AimoPilot",
    offlineBody: "Check the connection, then try again.",
    storeDown: "AimoPilot can't read its records right now",
    storeDownBody: "Its database is not answering. Nothing is lost; this screen tries again by itself and a request still opens here when it comes back.",
    storeDownStale: "AimoPilot's database is not answering. This screen shows what was there a moment ago and tries again by itself.",
    tryAgain: "Try again",
    youAre: "You are",
    agentIntro: (agent: ReactNode, limit: ReactNode) => r(agent, " buys for this kitchen. It may spend up to ", limit, " per order alone. Bigger orders and product swaps stop at the gate and come to you here."),
    noPasskey: "Demo only: you joined without a passkey, so your approvals are marked unverified.",
    openShop: "Open my kitchen's shop",
    waitingForYou: "Waiting for you",
    since: (t: string) => `since ${t}`,
    waitingRequests: "Waiting for requests",
    keepOpen: "Keep this screen open. A request opens here by itself.",
    earlier: "Earlier",
    status: { committed: "Placed", declined: "Declined", rejected: "Not placed" } as Record<string, string>,
    call: "Call your agent",
    asking: "Asking the agent…",
    demoAsk: "Demo: ask my agent for 1,000 L of milk",
    closesAt: (t: string) => `This demo kitchen closes at ${t}.`,
    notNeeded: (status: string) => `The agent's order was ${status.replace("_", " ")} without needing you.`,
  },
  fi: {
    loading: "Näkymääsi avataan…",
    notJoined: "Et ole vielä liittynyt",
    notJoinedBody: "Skannaa ison näytön QR-koodi, niin sinusta tulee keittiön hankintapäällikkö.",
    join: "Liity tällä puhelimella",
    offline: "AimoPilotiin ei saada yhteyttä",
    offlineBody: "Tarkista yhteys ja yritä uudelleen.",
    storeDown: "AimoPilot ei saa tietojaan juuri nyt",
    storeDownBody: "Sen tietokanta ei vastaa. Mitään ei ole kadonnut; näkymä yrittää uudelleen itse, ja pyyntö avautuu tähän, kun yhteys palaa.",
    storeDownStale: "AimoPilotin tietokanta ei vastaa. Näkymä näyttää hetki sitten olleet tiedot ja yrittää uudelleen itse.",
    tryAgain: "Yritä uudelleen",
    youAre: "Olet",
    agentIntro: (agent: ReactNode, limit: ReactNode) =>
      r(agent, " ostaa tälle keittiölle. Se saa tilata itsenäisesti enintään ", limit, " tilausta kohden. Suuremmat tilaukset ja tuotteiden vaihdot pysähtyvät portille ja tulevat tänne sinulle."),
    noPasskey: "Vain demo: liityit ilman pääsyavainta, joten hyväksyntäsi merkitään vahvistamat­tomiksi.",
    openShop: "Avaa keittiöni verkkokauppa",
    waitingForYou: "Odottaa sinua",
    since: (t: string) => `${t} alkaen`,
    waitingRequests: "Odotetaan pyyntöjä",
    keepOpen: "Pidä tämä näkymä auki. Pyyntö avautuu tähän itsestään.",
    earlier: "Aiemmat",
    status: { committed: "Lähetetty", declined: "Hylätty", rejected: "Ei lähetetty" } as Record<string, string>,
    call: "Soita agentillesi",
    asking: "Kysytään agentilta…",
    demoAsk: "Demo: pyydä agenttia tilaamaan 1 000 L maitoa",
    closesAt: (t: string) => `Tämä demokeittiö suljetaan ${t}.`,
    notNeeded: (status: string) =>
      status === "committed"
        ? "Agentin tilaus lähti ilman hyväksyntääsi: se pysyi agentin rajoissa."
        : status === "rejected"
          ? "Portti hylkäsi agentin tilauksen, joten hyväksyntääsi ei tarvittu."
          : `Agentin tilaus (${status.replace("_", " ")}) ei tarvinnut hyväksyntääsi.`,
  },
  sv: {
    loading: "Din vy öppnas…",
    notJoined: "Du har inte gått med än",
    notJoinedBody: "Skanna QR-koden på den stora skärmen, så blir du inköpschef för ett kök.",
    join: "Gå med på den här telefonen",
    offline: "AimoPilot går inte att nå",
    offlineBody: "Kontrollera anslutningen och försök igen.",
    storeDown: "AimoPilot kan inte läsa sina uppgifter just nu",
    storeDownBody: "Databasen svarar inte. Inget har gått förlorat; vyn försöker igen av sig själv och en förfrågan öppnas här när den är tillbaka.",
    storeDownStale: "AimoPilots databas svarar inte. Vyn visar det som fanns för en stund sedan och försöker igen av sig själv.",
    tryAgain: "Försök igen",
    youAre: "Du är",
    agentIntro: (agent: ReactNode, limit: ReactNode) =>
      r(agent, " köper in för det här köket. Den får beställa på egen hand för högst ", limit, " per beställning. Större beställningar och produktbyten stannar vid grinden och kommer till dig här."),
    noPasskey: "Endast demo: du gick med utan inloggnings­nyckel, så dina godkännanden märks som overifierade.",
    openShop: "Öppna mitt köks webbutik",
    waitingForYou: "Väntar på dig",
    since: (t: string) => `sedan ${t}`,
    waitingRequests: "Väntar på förfrågningar",
    keepOpen: "Håll den här vyn öppen. En förfrågan öppnas här av sig själv.",
    earlier: "Tidigare",
    status: { committed: "Skickad", declined: "Avslagen", rejected: "Inte skickad" } as Record<string, string>,
    call: "Ring din agent",
    asking: "Frågar agenten…",
    demoAsk: "Demo: be min agent beställa 1 000 L mjölk",
    closesAt: (t: string) => `Det här demoköket stängs ${t}.`,
    notNeeded: (status: string) =>
      status === "committed"
        ? "Agentens beställning gick iväg utan ditt godkännande: den höll sig inom agentens gränser."
        : status === "rejected"
          ? "Grinden avvisade agentens beställning, så ditt godkännande behövdes inte."
          : `Agentens beställning (${status.replace("_", " ")}) behövde inte ditt godkännande.`,
  },
});
