/**
 * The words of the landing page (/), second version. Half the words of the first: a headline of at most eight words
 * and one sentence per section; anything longer sits behind "More" or a link to /docs. Figures are not typed here:
 * they come from their sources at build time (search-eval.json, the crash test's summary.json, the presenter's
 * recorded attacks, the gate's rule list, the captured conversation in reel-thread.json).
 */

export const L2 = {
  meta: {
    title: "AimoPilot: your AI buyer orders, plain code decides",
    description:
      "Any company's purchasing agent can order from a food-service wholesaler under a mandate it signed. Plain code checks every order; a named person signs anything beyond it on their phone. Built for Valio Aimo's Trusted Trade Agents challenge at Junction 2026.",
  },
  skip: "Skip to the content",
  demoNote: "A demo on synthetic data, built for the Junction 2026 Valio Aimo challenge. Not the wholesaler's own shop.",
  nav: {
    talk: "Talk to the agent",
    login: "Log in",
    signup: "Sign up your restaurant",
    wholesaler: "For the wholesaler",
    connect: "Connect your own agent",
    live: "Watch it live",
    docs: "Docs",
    classic: "The first version of this page",
    more: "More",
  },

  hero: {
    title: "Your AI buyer orders. Plain code decides.",
    line: "Any company's purchasing agent orders from the wholesaler under a mandate it signed; anything beyond it waits for a named person's passkey.",
    built: "Built for Valio Aimo's Trusted Trade Agents challenge, Junction 2026.",
    reelLabel: "The real conversation, playing itself: 1,000 litres of lactose-free milk by Monday, from the request to the signed order.",
    pause: "Pause",
    play: "Play",
    replay: "Replay",
  },

  facts: {
    label: "Four things to know",
    pause: "Pause",
    play: "Play",
  },

  story: {
    title: "Watch the agent work",
    line: "One request, the partner's own example. Scroll, and the agent says what it does while the phone shows it.",
    request: "I need 1,000 litres of lactose-free milk by Monday",
    counters: {
      priced: "Products priced live",
      of: (n: string) => `of ${n}`,
      rules: "Rules checked by plain code",
      model: "Orders the model may approve",
    },
    signoffNote: "The sign-off page on the approver's phone, from the same order on another test kitchen.",
  },

  search: {
    title: "Search that reads the requirement",
    line: "The same 189 requests over the same 17,546 products, scored the same way: standard set-ups we built and ran, not other companies' products.",
    oursLabel: "AimoPilot",
    rightFirst: "right product first",
    counters: { dropped: "Requirement broken", standin: "Stand-in shown as the thing", notSold: "“We do not sell that”, right" },
    theirs: "theirs",
    ours: "ours",
    more: "Every approach, every column",
  },

  crash: {
    title: "The crash test",
    line: (n: number) => `${n} hard purchasing situations, three runs each, every model through the same harness and the same gate.`,
    worst: "worst run",
    ours: "our agent's model",
    more: "Every agent, with its licence",
  },

  gate: {
    title: "Never trust the model",
    line: (rules: number) => `A pure function of ${rules} rules decides every order: no model, no clock, the same answer every time.`,
    stations: [
      { name: "Mandate", who: "signed by the buyer" },
      { name: "Quote", who: "signed by the wholesaler" },
      { name: "Gate", who: "plain code" },
      { name: "Sign-off", who: "a named person's passkey" },
      { name: "Ledger", who: "hash-chained, verifiable" },
    ],
    order: "order",
    attack: "replayed price",
    attacksTitle: (n: number, held: number) => `${n} attacks thrown at the gate, ${held} held`,
    howHeld: { refused: "refused", person: "sent to a named person", stopped: "stopped before any price" },
    rulesTitle: (n: number) => `The ${n} rules`,
    standards: "MCP · OpenAPI 3.1 · W3C Verifiable Credentials · JWS with Ed25519 · WebAuthn passkeys",
  },

  agents: {
    title: "Six agents, one gate",
    trackTitle: "Each one, at work",
    line: "Each does a real job. None can place an order the gate has not passed.",
    list: [
      { id: "buyer", name: "The kitchen's buying agent", fact: "Heard right in 33 of 36 held-out voice clips, in hall noise and three languages.", href: "/docs/doors", shot: "agent-voice", kind: "phone", alt: "Voice mode on a phone: the agent speaking, a large Hold to talk button and End call." },
      { id: "seller", name: "The wholesaler's selling agent", fact: "At most two signed offers a kitchen in seven days. An offer never buys.", href: "/docs/offers", shot: "agent-seller-phone", kind: "phone", alt: "The kitchen's agent showing the wholesaler's offer: the same milk 0,37 € less per litre, the price held until a stated time." },
      { id: "watch", name: "The watch", fact: "Notices a stock-out before the kitchen does, and asks before it switches.", href: "/docs/connect-an-agent", shot: "agent-watch", kind: "phone", alt: "The agent on a phone: Monday's milk cannot come, here is the substitute, it needs a sign-off. Staged for the demo, and marked so." },
      { id: "menu", name: "The menu planner", fact: "Swaps by the ingredient's job in the dish, each checked against the kitchen's rules.", href: "/docs/connect-an-agent", shot: "agent-menu-sheet", kind: "crop", alt: "The agent after planning a lunch for ten: nothing arrives Monday so Tuesday, a salmon soup lunch at 31,43 €, about 3,14 € a cover." },
      { id: "outside", name: "Any outside agent", fact: "Seven agent frameworks reached a person's sign-off with only the address and a signed mandate.", href: "/docs/runtime-results", shot: "agent-outside", kind: "desktop", alt: "The page for outside agents: one address for your assistant, or one command; MCP and the OpenAPI document." },
      { id: "ops", name: "The operations copilot", fact: "Answers from rows, never written by a model; a write is refused before it is sent.", href: "/ops/platform", shot: "ops-agents", kind: "desktop", alt: "The operations agents page: the scorecard with each agent performing or failing, and the orders waiting for a person." },
    ],
  },

  screens: {
    title: "One product, every screen",
    line: "The same moment on a phone and on a desk.",
    pairs: [
      { name: "The conversation", phone: "thread-waiting", desktop: "screen-thread-desktop", alt: "The conversation at the moment the order needs the kitchen manager's OK, on a phone and then on a desktop." },
      { name: "The sign-off", phone: "flow-signoff", desktop: "screen-approve-desktop", alt: "The sign-off page, stopped at the gate at 1 010,00 €, on a phone and then in a desktop browser." },
      { name: "The store", phone: "screen-store-phone", desktop: "hero-desktop-store", alt: "The catalogue's dairy department, on a phone with the tab bar, then on a desktop with the agent docked beside it." },
      { name: "Operations", phone: "screen-ops-phone", desktop: "ops-live", alt: "The operations portal's Live page: three doors, one gate, on a phone and then on a desktop." },
    ],
  },

  business: {
    title: "Run it like a business",
    line: "Every agent at the door, how each is doing and why, and what waits for a person.",
    items: ["Agent scorecard with a proposed action", "Orders waiting for a person, oldest first", "Every rule and how often it fired", "The audit trail, searchable in words", "Every decision on Kafka, replayable"],
    alt: "The safeguards page: what the agent decided alone, what a named person signed, what was refused, and how often each rule fired.",
    aivenTitle: "On Aiven, one job per service",
    aiven: [
      ["Runtime", "the gate, MCP, REST, the portals"],
      ["PostgreSQL", "orders, the hash-chained ledger, memory, telemetry"],
      ["Kafka", "every action and decision, in order"],
      ["Valkey", "live-price cache, lookup budgets"],
      ["OpenSearch", "17,546 products in three languages, the audit trail"],
      ["Grafana", "the dashboard, read-only"],
      ["Managed Agents", "an outside buyer we do not run"],
      ["MCP server", "the copilot's read-only view"],
    ],
  },

  mail: {
    title: "Mail a business would send",
    line: "A receipt when an order is placed, and a plain mail when something changes.",
    receipt: "The receipt: order placed, the line, VAT and total, a link to check the signed receipt.",
    changed: "A product cannot come: what happened, what was done, best, better and good substitutes. Staged for the demo, and marked so.",
  },

  film: {
    title: "The two-minute film",
    note: "Coming here soon. Until then, every picture on this page is the product itself.",
    label: "AimoPilot in two minutes",
  },

  honest: {
    title: "Honest about what it is",
    line: "The partner's synthetic data, real gate decisions and signatures; orders never reach a real order system.",
    more: "Assumptions and next steps",
  },

  end: {
    title: "Talk to the agent",
    line: "Open a test kitchen in one click and ask for 1,000 litres of lactose-free milk by Monday.",
  },

  missing: "Screenshot coming",
};
