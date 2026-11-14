import { defineText } from "@/app/_i18n/lang";

/** What the kitchen's agent says about the "Try everything" guide in the conversation (server/demo/thread.ts). */
export const DEMO_SAY_TEXT = defineText({
  en: {
    next: (title: string, shows: string) => `Next on your list: ${title.charAt(0).toLowerCase()}${title.slice(1)}. ${shows}`,
    tryWords: (words: string) => `Try saying: “${words}”`,
    doThis: (what: string) => what,
    allDone: (n: number) => `You've tried all ${n} things on the list. The operations portal shows how the wholesaler sees it; its passcode is with the team.`,
    guide: "Everything is listed under Try everything.",
    staged: (summary: string) => `Done, staged for the demo: ${summary}`,
    stagedThen: (words: string) => `Now ask me: “${words}”`,
    notDemo: "Staging is only for demo accounts' own kitchens.",
    failed: (why: string) => `I couldn't set that up: ${why}`,
  },
  fi: {
    next: (title: string, shows: string) => `Seuraavaksi listallasi: ${title.charAt(0).toLowerCase()}${title.slice(1)}. ${shows}`,
    tryWords: (words: string) => `Kokeile sanoa: ”${words}”`,
    doThis: (what: string) => what,
    allDone: (n: number) => `Olet kokeillut kaikki ${n} asiaa listalta. Operatiivinen portaali näyttää, miltä se näyttää tukkurille; tunnuskoodi on tiimillä.`,
    guide: "Kaikki on listattu kohdassa Kokeile kaikkea.",
    staged: (summary: string) => `Valmis, lavastettu demoa varten: ${summary}`,
    stagedThen: (words: string) => `Kysy nyt minulta: ”${words}”`,
    notDemo: "Lavastus on vain demotilien omille keittiöille.",
    failed: (why: string) => `En pystynyt valmistelemaan sitä: ${why}`,
  },
  sv: {
    next: (title: string, shows: string) => `Nästa på din lista: ${title.charAt(0).toLowerCase()}${title.slice(1)}. ${shows}`,
    tryWords: (words: string) => `Prova att säga: ”${words}”`,
    doThis: (what: string) => what,
    allDone: (n: number) => `Du har prövat alla ${n} saker på listan. Driftportalen visar hur grossisten ser det; lösenkoden finns hos teamet.`,
    guide: "Allt finns under Pröva allt.",
    staged: (summary: string) => `Klart, iscensatt för demon: ${summary}`,
    stagedThen: (words: string) => `Fråga mig nu: ”${words}”`,
    notDemo: "Iscensättning finns bara för demokontons egna kök.",
    failed: (why: string) => `Jag kunde inte förbereda det: ${why}`,
  },
});
