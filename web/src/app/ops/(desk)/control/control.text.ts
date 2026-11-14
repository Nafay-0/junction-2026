import { defineText } from "../../../_i18n/lang";

/** The operations portal's Control page. The portal renders English; Finnish and Swedish are kept ready. */
export const CONTROL_TEXT = defineText({
  en: {
    title: "Control",
    purpose: "Stop an agent or a whole organisation with a reason, and see what waits for a person. A stopped agent's next call over any door is refused; resume it here at any time.",
    emptyTitle: "Nothing waiting",
    empty: "Orders over an agent's own limit, or with a substitute, wait here until the named person signs off. Ask a test kitchen's agent for a large order and it appears here.",
    suspendedTitle: "No agent is suspended",
    suspended: "Every agent with a valid mandate can call the gate, and the gate still checks every order. Suspend one below to see its next call refused.",
  },
  fi: {
    title: "Hallinta",
    purpose: "Pysäytä agentti tai koko organisaatio perusteltuna ja näe, mikä odottaa ihmistä. Pysäytetyn agentin seuraava kutsu millä tahansa ovella torjutaan; palauta se täältä milloin tahansa.",
    emptyTitle: "Mikään ei odota",
    empty: "Tilaukset, jotka ylittävät agentin oman rajan tai sisältävät korvaavan tuotteen, odottavat tässä, kunnes nimetty henkilö hyväksyy ne. Pyydä testikeittiön agentilta iso tilaus, niin se näkyy tässä.",
    suspendedTitle: "Yhtään agenttia ei ole pysäytetty",
    suspended: "Jokainen agentti, jolla on voimassa oleva valtakirja, voi kutsua porttia, ja portti tarkistaa silti jokaisen tilauksen. Pysäytä agentti alla, niin näet sen seuraavan kutsun torjuttuna.",
  },
  sv: {
    title: "Styrning",
    purpose: "Stoppa en agent eller en hel organisation med ett skäl och se vad som väntar på en person. En stoppad agents nästa anrop via någon dörr avvisas; återuppta den här när som helst.",
    emptyTitle: "Inget väntar",
    empty: "Beställningar över agentens egen gräns, eller med en ersättande produkt, väntar här tills den namngivna personen godkänner dem. Be ett testköks agent om en stor beställning så syns den här.",
    suspendedTitle: "Ingen agent är stoppad",
    suspended: "Varje agent med giltig fullmakt kan anropa grinden, och grinden kontrollerar ändå varje beställning. Stoppa en nedan för att se dess nästa anrop avvisas.",
  },
});
