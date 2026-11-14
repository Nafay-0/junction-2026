/**
 * Scripted conversations for the design proposal at /design/conversation. Nothing here talks to the server.
 *
 * Agent lines use two marks: **bold** for a figure the eye should find (a price, an amount), and {{…}} for a day or
 * a time. Everything the agent did in the background lives in `thinking`, written for a person.
 */

export type Choice = { title: string; price: string; differs: string };

export type Think = { label: string; detail?: string; tone?: "kept" | "left" | "rule" | "live" | "memory" };

export type Turn =
  | { who: "buyer"; text: string; via?: "voice" }
  | {
      who: "agent";
      text: string;
      thinking?: Think[];
      choices?: Choice[];
      /** "or tell me in words" line under choices. */
      orWords?: string;
      list?: { label: string; rows: { item: string; amount: string; total: string }[]; total: string };
      signoff?: { who: string; what: string; when: string; total: string; why: string; done?: string };
      memory?: string;
    };

export type Conversation = { id: string; title: string; turns: Turn[] };

export type Lang = "en" | "fi";

export const UI: Record<Lang, Record<string, string>> = {
  en: {
    how: "How I got this",
    steps: "steps",
    hide: "Hide",
    words: "or just tell me",
    list: "Show the list",
    hideList: "Hide the list",
    total: "Total",
    ok: "OK with Face ID",
    placeholder: "Tell me what the kitchen needs",
    working: "Working on it",
    signHeader: "Needs your OK",
    remembered: "Remembered",
  },
  fi: {
    how: "Näin päädyin tähän",
    steps: "vaihetta",
    hide: "Piilota",
    words: "tai kerro omin sanoin",
    list: "Näytä lista",
    hideList: "Piilota lista",
    total: "Yhteensä",
    ok: "Hyväksy Face ID:llä",
    placeholder: "Kerro, mitä keittiö tarvitsee",
    working: "Työn alla",
    signHeader: "Tarvitsee hyväksyntäsi",
    remembered: "Muistan",
  },
};

export const LANDING: Record<Lang, { greeting: string; today: string; examples: string[] }> = {
  en: {
    greeting: "Good morning, Aino.",
    today: "One order is waiting for your OK: **1 000 L** of milk for {{Monday}}. Monday's milk otherwise closes at {{17.00 today}}, and I can order the usual 400 L whenever you say.",
    examples: ["Same as last Thursday", "Plan lunch for 40 on Friday", "What did we spend this week?"],
  },
  fi: {
    greeting: "Huomenta, Aino.",
    today: "Yksi tilaus odottaa hyväksyntääsi: **1 000 l** maitoa {{maanantaiksi}}. Maanantain maidon tilausaika päättyy {{tänään klo 17.00}}, ja tilaan tavallisen 400 l heti kun sanot.",
    examples: ["Sama kuin viime torstaina", "Lounas 40 hengelle perjantaiksi", "Paljonko käytimme tällä viikolla?"],
  },
};

const MILK_THINKING_EN: Think[] = [
  { label: "Read your request", detail: "1 000 litres, lactose-free, delivered by Monday 16.11." },
  { label: "Looked at your history", detail: "You usually order about 400 L. 1 000 L is 2.5 times that: worth mentioning, not worth stopping for.", tone: "memory" },
  { label: "Searched the assortment", detail: "17 546 products, 12 lactose-free milks. Narrowed to 3 before asking the wholesaler anything." },
  { label: "Checked live price and delivery for 3", detail: "All three can arrive Monday. The cheapest is 1,01 € a litre.", tone: "live" },
  { label: "Left out 10 L boxes, your usual", detail: "Their order time for Monday was Thursday 15.00. It has passed.", tone: "left" },
  { label: "Checked your rules", detail: "Lactose-free, no nuts, within the week's budget. Over the 500 € I may spend alone, so it needs a person.", tone: "rule" },
  { label: "Price held until 07.26", detail: "Signed by the wholesaler. Anyone can check it against their published key.", tone: "kept" },
];

export const CONVERSATIONS: Record<Lang, Conversation[]> = {
  en: [
    {
      id: "milk",
      title: "1,000 L by Monday",
      turns: [
        { who: "buyer", text: "I need 1,000 litres of lactose-free milk by Monday." },
        {
          who: "agent",
          text: "I can have **1 000 L** of lactose-free semi-skimmed with you on {{Monday 16.11.}} for **1 010 €**. Your usual 10 L boxes have missed their order time, so these come in 1 L cartons. It's over your 500 € limit, so it needs your OK.",
          thinking: MILK_THINKING_EN,
          signoff: { who: "Aino", what: "1 000 L lactose-free semi-skimmed milk, 1 L cartons", when: "Monday 16.11.", total: "1 010,00 €", why: "Over the 500 € your agent may spend alone." },
        },
        { who: "buyer", text: "ok" },
        { who: "agent", text: "Done, you OK'd it at {{07.04}}. It arrives {{Monday between 8 and 10}}. I'll tell you if anything changes before then." },
      ],
    },
    {
      id: "lunch",
      title: "Lunch for 10 tomorrow",
      turns: [
        { who: "buyer", text: "Plan a lunch for 10 people tomorrow." },
        {
          who: "agent",
          text: "Nothing can reach you tomorrow: there are no Sunday deliveries and Saturday's order time has passed. The earliest I can do is {{Monday 16.11.}} Shall I plan it for Monday, or cook from what you have?",
          thinking: [
            { label: "Read your request", detail: "Lunch, 10 covers, tomorrow (Sunday 15.11.)." },
            { label: "Checked delivery days", detail: "No deliveries on Sundays. Saturday's order time was Friday 15.00.", tone: "live" },
            { label: "Found the first possible day", detail: "Monday 16.11., if ordered by Sunday 17.00." },
            { label: "Did not plan yet", detail: "A menu for a day you might not want would waste your time. Asked first.", tone: "left" },
          ],
        },
        { who: "buyer", text: "Monday is fine. Something with salmon, no nuts." },
        {
          who: "agent",
          text: "Three lunches for 10 on Monday, all without nuts:",
          choices: [
            { title: "Salmon soup with rye bread", price: "4,10 € a cover", differs: "Quickest to make" },
            { title: "Oven salmon, dill potatoes", price: "5,60 € a cover", differs: "Most filling" },
            { title: "Salmon pasta, green salad", price: "3,20 € a cover", differs: "Cheapest" },
          ],
          orWords: "Which one?",
          thinking: [
            { label: "Kept your rule: no nuts", detail: "Every dish and ingredient checked against it.", tone: "rule" },
            { label: "Matched ingredients to products", detail: "18 products, all arriving Monday. Priced live." , tone: "live" },
            { label: "Left out a salmon tartare", detail: "Its fresh salmon only arrives Tuesday.", tone: "left" },
          ],
        },
        { who: "buyer", text: "the soup" },
        {
          who: "agent",
          text: "Salmon soup for 10 comes to **41,00 €**, all arriving {{Monday}}. It's well inside your limit, so I'll order it as soon as you say.",
          list: {
            label: "6 items",
            rows: [
              { item: "Salmon fillet, 1,5 kg", amount: "1", total: "22,40 €" },
              { item: "Potatoes, 2 kg", amount: "1", total: "3,10 €" },
              { item: "Leek", amount: "2", total: "2,60 €" },
              { item: "Lactose-free cooking cream, 1 l", amount: "1", total: "3,90 €" },
              { item: "Dill, bunch", amount: "2", total: "2,20 €" },
              { item: "Rye bread, 10 slices", amount: "1", total: "6,80 €" },
            ],
            total: "41,00 €",
          },
        },
        { who: "buyer", text: "go ahead" },
        { who: "agent", text: "Ordered. It arrives {{Monday 16.11. between 8 and 10}}." },
      ],
    },
    {
      id: "oat",
      title: "Oat drink for coffee",
      turns: [
        { who: "buyer", text: "oat drink for coffee", via: "voice" },
        {
          who: "agent",
          text: "No barista oat drink can arrive before {{Wednesday}}. For {{Monday}}, these are the closest:",
          choices: [
            { title: "Oat drink 1 l, not barista", price: "1,79 €", differs: "Foams, but less firmly" },
            { title: "Soy drink barista 1 l", price: "2,05 €", differs: "Foams like barista; soy, not oat" },
            { title: "Oat barista on Wednesday", price: "1,89 €", differs: "The real thing, two days later" },
          ],
          orWords: "Which would you like, and how many?",
          thinking: [
            { label: "Searched oat drinks", detail: "4 barista oat drinks. None can arrive Monday: two are out of stock, two missed their order time.", tone: "live" },
            { label: "Looked for stand-ins by use, not by name", detail: "What foams for coffee and keeps your rules: lactose-free, no nuts." },
            { label: "Left out almond barista", detail: "Your rule is no nuts.", tone: "rule" },
          ],
        },
        { who: "buyer", text: "the soy one, 12 cartons" },
        {
          who: "agent",
          text: "**12 cartons** of soy barista for {{Monday}}, **24,60 €**. Ordered.",
          memory: "When the oat barista is out, you'll take soy barista. Say so if that's wrong.",
        },
      ],
    },
    {
      id: "reorder",
      title: "Same as last week, +20 %",
      turns: [
        { who: "buyer", text: "same as last week but 20% more" },
        {
          who: "agent",
          text: "Last Thursday you had 400 L of milk and 24 cartons of oat drink. 20 % more is **480 L** and **29 cartons**, **530,74 €** for {{Monday}}. That's just over your 500 € limit, so it needs your OK.",
          thinking: [
            { label: "Found last week's order", detail: "Thursday 12.11.: 400 L lactose-free milk, 24 × oat drink barista.", tone: "memory" },
            { label: "Added 20 %", detail: "480 L. 28,8 cartons rounded up to 29: oat drink comes in whole cartons." },
            { label: "Checked live price and delivery", detail: "Both arrive Monday. Milk is 2 cents a litre cheaper than last week.", tone: "live" },
            { label: "Checked your rules", detail: "Within the week's budget. Over the 500 € alone, so it needs a person.", tone: "rule" },
          ],
          signoff: { who: "Aino", what: "480 L lactose-free milk, 29 × oat drink barista", when: "Monday 16.11.", total: "530,74 €", why: "Over the 500 € your agent may spend alone." },
        },
      ],
    },
  ],
  fi: [
    {
      id: "milk",
      title: "1 000 l maanantaiksi",
      turns: [
        { who: "buyer", text: "Tarvitsen 1000 litraa laktoositonta maitoa maanantaiksi." },
        {
          who: "agent",
          text: "Saan **1 000 l** laktoositonta kevytmaitoa perille {{maanantaina 16.11.}} hintaan **1 010 €**. Tavallisten 10 l laatikoidesi tilausaika on mennyt, joten nämä tulevat 1 l tölkeissä. Summa ylittää 500 € rajasi, joten tarvitsen hyväksyntäsi.",
          thinking: [
            { label: "Luin pyyntösi", detail: "1 000 litraa, laktoositon, perillä maanantaina 16.11." },
            { label: "Katsoin historiasi", detail: "Tilaat yleensä noin 400 l. 1 000 l on 2,5-kertainen: mainitsemisen arvoinen, ei pysäyttämisen.", tone: "memory" },
            { label: "Hain valikoimasta", detail: "17 546 tuotetta, 12 laktoositonta maitoa. Rajasin kolmeen ennen kuin kysyin tukulta mitään." },
            { label: "Tarkistin hinnan ja toimituksen kolmelle", detail: "Kaikki ehtivät maanantaiksi. Halvin on 1,01 € litralta.", tone: "live" },
            { label: "Jätin pois 10 l laatikot", detail: "Niiden tilausaika maanantaiksi oli torstaina klo 15.00.", tone: "left" },
            { label: "Tarkistin sääntösi", detail: "Laktoositon, ei pähkinöitä, viikkobudjetin sisällä. Yli 500 €, jonka saan käyttää yksin.", tone: "rule" },
            { label: "Hinta voimassa klo 07.26 asti", detail: "Tukun allekirjoittama. Kuka tahansa voi tarkistaa sen.", tone: "kept" },
          ],
          signoff: { who: "Aino", what: "1 000 l laktoositonta kevytmaitoa, 1 l tölkit", when: "maanantai 16.11.", total: "1 010,00 €", why: "Yli 500 €, jonka agenttisi saa käyttää yksin." },
        },
        { who: "buyer", text: "ok" },
        { who: "agent", text: "Valmis, hyväksyit sen klo {{07.04}}. Se saapuu {{maanantaina klo 8–10}}. Kerron, jos jokin muuttuu." },
      ],
    },
  ],
};

/** The words on screen in an agent turn: its text and, when present, the choices. Thinking is closed by default. */
export function agentWords(t: Extract<Turn, { who: "agent" }>): number {
  const plain = t.text.replace(/\*\*|\{\{|\}\}/g, "");
  const extra = (t.choices ?? []).map((c) => `${c.title} ${c.price} ${c.differs}`).join(" ") + " " + (t.orWords ?? "") + " " + (t.memory ?? "");
  return `${plain} ${extra}`.split(/\s+/).filter(Boolean).length;
}
