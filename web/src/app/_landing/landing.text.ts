/**
 * Every word on the landing page (/), in one place. English first; Finnish and Swedish can be added as further keys
 * with the same shape. Figures that come from a measurement are not typed here: they are read from their source at
 * build time (search-eval.json, the crash test's summary.json, the gate's rule list), and the sentences that carry
 * them are functions.
 *
 * Every claim names where it was measured or where it lives (`source`), and the page links it.
 */

export type Source = { label: string; href: string };

/** One agent on the page. `crop` shows a band of a wide screenshot (x and width as fractions); `asks` replaces a picture. */
export type AgentEntry = {
  id: string;
  name: string;
  what: string;
  fact: string;
  source: Source;
  shots: string[];
  alts: string[];
  crop?: readonly [number, number];
  asksTitle?: string;
  asks?: string[];
  refused?: string;
  refusedWhy?: string;
};

const S = {
  search: { label: "How we measured", href: "/docs/smart-search" },
  doors: { label: "Voice and photo evaluation", href: "/docs/doors" },
  offers: { label: "The selling agent", href: "/docs/offers" },
  runtimes: { label: "Runtime results", href: "/docs/runtime-results" },
  connect: { label: "Connect an agent", href: "/docs/connect-an-agent" },
  assumptions: { label: "Assumptions and next steps", href: "/docs/assumptions" },
  crash: { label: "Crash-test leaderboard", href: "/docs/crash-test" },
  mail: { label: "Email to the kitchen", href: "/docs/mail" },
} satisfies Record<string, Source>;

export const LANDING_TEXT = {
  en: {
    meta: {
      title: "AimoPilot: an AI buyer for every kitchen, and a gate it cannot talk its way past",
      description:
        "Any company's purchasing agent can order from a food-service wholesaler. A signed mandate says what it may buy, plain code checks every order, and a named person signs anything beyond it on their phone. Built for Valio Aimo's Trusted Trade Agents challenge at Junction 2026.",
    },
    skip: "Skip to the content",
    nav: {
      label: "Main",
      wholesaler: "For the wholesaler",
      connect: "Connect your own agent",
      live: "Watch it live",
      docs: "Docs",
      login: "Log in",
      signup: "Sign up your restaurant",
      talk: "Talk to the agent",
      more: "More",
    },
    demoNote: "A demo on synthetic data, built for the Junction 2026 Valio Aimo challenge. Not the wholesaler's own shop.",

    hero: {
      title: "An AI buyer for every kitchen, and a gate it cannot talk its way past.",
      promise:
        "Any company's purchasing agent can order from the wholesaler. It carries a mandate its company signed, saying what it may buy and how much it may spend alone. Plain code checks every order against it. Anything beyond it waits for a named person to sign on their phone.",
      built: "Built for Valio Aimo's Trusted Trade Agents challenge, Junction 2026.",
      watch: "Watch it live at the gate",
      phoneAlt:
        "The kitchen's agent on a phone. The buyer asked for 1,000 litres of lactose-free milk by Monday; the agent answers that the usual 10-litre boxes cannot arrive by Monday because the order cut-off has passed, and offers three ways in one-litre cartons with their prices.",
      desktopAlt:
        "The store on a desktop: the dairy and cheese department with the kitchen's agent docked beside it, showing the same conversation about 1,000 litres of lactose-free milk.",
      url: "aimopilot / store / Hotel Lumo kitchen",
    },

    film: {
      title: "Two minutes, from a sentence to a signed order",
      lead: "The film is in the edit. Until it lands here, every picture on this page is the product itself, captured from a production build.",
      posterLine: "1,000 litres of lactose-free milk by Monday.",
      posterNote: "The film is coming",
      label: "AimoPilot in two minutes",
      captions: "Captions",
    },

    flow: {
      title: "The challenge's own example, start to signed order",
      lead: "Request, lookup, order, approval: the four steps the challenge asks for, on the example it gives. The usual product fails on the way, and the agent finds a way that still makes Monday.",
      carousel: "The four steps, as screens. Scroll sideways.",
      steps: [
        {
          name: "Request",
          text: "The chef types one line. No form, no product code.",
          shot: "flow-request",
          alt: "The buyer's message, 'I need 1,000 litres of lactose-free milk by Monday', and the agent reading the request.",
        },
        {
          name: "Lookup",
          text: "It asks the live price service about three products, not the catalogue. The usual 10-litre boxes have missed their order cut-off.",
          shot: "flow-lookup",
          alt: "The agent's five steps opened: read the request, looked at the kitchen's history, searched the range, checked live price and delivery for three products, left out seventeen with the reasons, six of them because the order cut-off had passed.",
        },
        {
          name: "Order",
          text: "Three ways in one-litre cartons, each a fixed price the wholesaler signs: 1 010,00 €, 1 560,00 € and 1 574,48 €.",
          shot: "flow-options",
          alt: "The agent's reply with three options in one-litre cartons, each with its total, price per litre and delivery on Monday 16 November.",
        },
        {
          name: "Approval",
          text: "1 010 € is over the 500 € the agent may spend alone, so it stops at the gate and goes to the kitchen manager's phone.",
          shot: "flow-signoff",
          alt: "The sign-off page on a phone: stopped at the gate, 1 010,00 € for delivery on Monday, over the agent's 500 € per-order limit, a note that 1,000 litres is 2.5 times the usual 400, and the Approve button.",
        },
        {
          name: "Signed",
          text: "A passkey signs that exact order. The order is placed and the wholesaler signs the confirmation.",
          shot: "flow-signed",
          alt: "After approval: a 'Signed off' stamp with the approver's name and time, and 'Order placed', approved with a passkey.",
        },
      ],
    },

    agents: {
      title: "Six agents. Every one of them meets the same gate.",
      lead: "Each one does a real job in a kitchen or at the wholesaler. None of them can place an order the gate has not passed, and none of them can sign one.",
      list: [
        {
          id: "buyer",
          name: "The kitchen's buying agent",
          what: "The chef talks; the agent buys. It remembers the kitchen's usual products, its rules and last week's order, and asks only when the answer changes the order. Typed, spoken on a call, or a photo of the whiteboard.",
          fact: "Voice: 33 of 36 held-out clips heard right, in hall noise and accents, in three languages; a mis-hearing is read back and needs a yes. Photo: twelve test lists, no wrong quantity, nothing invented.",
          source: S.doors,
          shots: ["agent-home", "agent-voice"],
          alts: [
            "The agent's home on a phone: it noticed that Monday's usual milk missed its cut-off and asks once whether to switch.",
            "Voice mode on a phone: the agent speaking, with a large Hold to talk button and End call.",
          ],
        },
        {
          id: "seller",
          name: "The wholesaler's selling agent",
          what: "It speaks to the buyer's agent, not to the chef: a new or seasonal product, or the same thing cheaper, as a signed offer any agent can check offline. Plain code chooses what to offer. An offer never buys anything.",
          fact: "At most two offers a kitchen in seven days. Every reason (cheaper, in season, more reliable, lower carbon) is recomputed from the data before it is sent, or the offer is held back with the rule that stopped it.",
          source: S.offers,
          shots: ["agent-seller", "agent-seller-phone"],
          alts: [
            "The operations portal's selling agent page: offers sent, one held back by a guardrail, and a table of what was offered to whom and what happened.",
            "The kitchen's agent on a phone showing the wholesaler's offer: the same milk 0,37 € less per litre, the price held until a stated time.",
          ],
        },
        {
          id: "watch",
          name: "The watch",
          what: "It keeps an eye on what the kitchen buys every week and on orders still to come, so it notices a stock-out before the kitchen does. It learns standing orders, holds one that drifted and asks, and lines up a backup for products with a poor delivery record.",
          fact: "One live availability call for at most ten key products. A recurring order that drifted is never renewed silently: renew at the new amount, the usual, or skip this week.",
          source: S.connect,
          shots: ["ops-watch", "agent-watch"],
          alts: [
            "The operations portal's kitchen watch: a finding that a product cannot come on its day, with good, better and best substitutes, marked as staged for the demo.",
            "The kitchen's agent on a phone: Monday's milk cannot come, here is the substitute, it needs a sign-off. Staged for the demo, and marked so.",
          ],
        },
        {
          id: "menu",
          name: "The menu planner",
          what: "A seasonal menu, or a booking at short notice: dishes for the covers, what the kitchen already has, and only the shortfall bought. What cannot arrive in time is replaced by recipe logic, not by the next product code.",
          fact: "Substitutes by the ingredient's job in the dish (crème fraîche to smetana 1:1, fresh dill to dried 1:3), each checked to be in the range, in time, and within the kitchen's allergen and nutrition rules.",
          source: S.connect,
          shots: ["agent-menu-sheet"],
          crop: [0.27, 0.47],
          alts: [
            "The agent on a desktop after planning a lunch for ten: nothing arrives Monday so it moves to Tuesday, a salmon soup lunch at 31,43 €, about 3,14 € a cover.",
          ],
        },
        {
          id: "outside",
          name: "Any outside agent",
          what: "A hotel chain's own agent, a procurement system, Claude or ChatGPT with a connector address. They come in through MCP or REST described by OpenAPI 3.1, and meet the same mandate check, the same gate and the same sign-off as the agent in the store.",
          fact: "Seven agent frameworks we did not write (Pydantic AI, OpenAI Agents SDK, Google ADK, Claude Agent SDK, Vercel AI SDK, LangGraph, Semantic Kernel over OpenAPI) took the milk order to a person's sign-off with nothing but the address and a signed mandate.",
          source: S.runtimes,
          shots: ["agent-outside"],
          alts: ["The page for outside agents: copy one address into your assistant, or run one command; the MCP address and the OpenAPI document."],
        },
        {
          id: "ops",
          name: "The operations copilot, and an agent on Aiven",
          what: "Staff ask the platform in words: is anything unhealthy, which agents are failing, what is waiting for sign-off. Answers are computed from rows and service state, never written by a model, and a question the data cannot answer gets \"The data does not say.\"",
          fact: "A purchasing agent running on Aiven Managed Agents, with its own model in Aiven's environment, orders through the MCP door. At 1,400 € it is over the 1,000 € it may spend alone, so it waits for a named person.",
          source: { label: "The Platform page (operations)", href: "/ops/platform" },
          shots: [],
          alts: [],
          asks: ["Is anything unhealthy?", "Which agents are failing?", "What is waiting for sign-off?", "How many orders were refused in the last hour, and by which rule?"],
          refused: "delete from telemetry.events",
          refusedWhy: "Refused before it is sent: the copilot reads one view, as a user that can only select.",
          asksTitle: "Ask the platform",
        },
      ] as AgentEntry[],
      scenariosTitle: "The six situations the challenge names, each handled",
      scenariosLead: "Type the words into the agent, or open the page named.",
      scenarios: [
        { name: "Need, recipe, order", outcome: "A menu around what is in season: the anchor with its source, the dishes, what is on hand, and only the shortfall bought in the smallest pack that covers it.", say: "Plan a menu around what is in season", href: "/k" },
        { name: "Last-minute event", outcome: "A booking for tomorrow: what cannot arrive and why, the earliest day, and substitutes by the ingredient's role in the dish, best, better, good.", say: "Plan a lunch for 10 people tomorrow", href: "/k" },
        { name: "Supplier stock-out", outcome: "The watch finds Monday's milk cannot come, ranks good, better and best substitutes, and asks before it switches.", say: "Staff can stage one on the watch page", href: "/ops/watch" },
        { name: "Proactive selling agent", outcome: "A signed offer: the same milk cheaper per litre, the price held until a stated time. The kitchen can say no or mute that kind of offer.", say: "Open the selling agent's page", href: "/ops/offers" },
        { name: "Allergen-safe substitution", outcome: "A school kitchen without nuts: a product with no allergen data is not safe, and nutrition rules hold by the maker's declared figures.", say: "Sign in as Metsola school", href: "/k" },
        { name: "Standing order drift", outcome: "Portions creeping up or cost drifting: the renewal is held and the kitchen asked, at the new amount, the usual, or skip this week.", say: "Show my standing orders", href: "/k" },
      ],
      tryIt: "Try it",
      noShot: "In the operations portal, on the Platform page.",
    },

    security: {
      title: "Never trust the model",
      lead: (rules: number) =>
        `The model reads, searches and explains. It never decides whether an order is allowed. That is a pure function of ${rules} rules: the same mandate and the same order give the same answer, with no model and no clock inside.`,
      chain: [
        { name: "Mandate", who: "Signed by the buyer's company", what: "What the agent may buy, how much it may spend alone, and who signs above that.", std: "JWS, Ed25519" },
        { name: "Quote", who: "Signed by the wholesaler", what: "A fixed price for exact lines, for this buyer and this request, until a stated time.", std: "JWS, Ed25519" },
        { name: "Gate", who: "Plain code", what: "Every rule reports pass, needs a person, or refused, and why.", std: "No model inside", gate: true },
        { name: "Sign-off", who: "A named person", what: "A passkey on their own phone, bound to the digest of that exact order.", std: "WebAuthn passkey" },
        { name: "Ledger", who: "Anyone can check", what: "Hash-chained entries and a signed receipt that verifies offline against the published keys.", std: "SHA-256 chain, JWK Set" },
      ],
      diagramLabel: "The chain of trust: mandate, quote, gate, sign-off, ledger.",
      rulesTitle: (n: number) => `The gate's ${n} rules, by name`,
      facts: [
        { title: "Refuses, and says why", text: "Every refusal carries the rule that fired and a sentence a person can read. Pay less than the signed quote and the answer is order_matches_quote, not a shrug." },
        { title: "A mistake check that shows its working", text: "\"1,000 L is 2.5 times your usual 400 L (median of your last 8 milk orders).\" Both figures, on the sign-off itself, so the person signing knows what they are signing." },
        { title: "Allergens and nutrition by declared evidence", text: "No allergen data is not safe. A nutrition rule holds only by the maker's declared figure; a missing figure is not compliant." },
        { title: "A relayed yes is not a person", text: "\"The chef said yes\", passed on by a model, is recorded as relayed. Where it matters, the order goes to a named person's passkey." },
        { title: "Suspend an agent", text: "The wholesaler's staff can suspend any agent at the door. Its next call is refused, in every door, until they lift it." },
        { title: "Licences from the crash test", text: "An agent earns a licence on the crash test. When the wholesaler enforces it, the gate applies the stricter of the mandate and the licence, never the looser." },
      ],
      refusedAlt: "The presenter's 'Now try to break it' board: ten times too much, a forged mandate, a replayed fixed price, the agent approving its own order, one need split to dodge the limit, 'the chef said yes', and a suspension; each refused or held with its rule.",
      standardsTitle: "Open standards, all the way down",
      standards: [
        { name: "MCP", what: "Streamable HTTP, protocol 2026-07-28 and the 2025-era handshake" },
        { name: "OpenAPI 3.1", what: "The same operations over REST" },
        { name: "W3C Verifiable Credentials", what: "Signed stock, price and origin claims, and the offers" },
        { name: "JWS with Ed25519", what: "Mandates, quotes and receipts; keys published as a JWK Set" },
        { name: "WebAuthn passkeys", what: "A person's sign-off, bound to one order" },
        { name: "RFC 9727 API catalog", what: "So an agent that knows only the address can find the rest" },
      ],
    },

    thinking: {
      title: "You can see it think",
      lead: "Under every reply sits one quiet line: \"5 steps\". Open it and the agent shows what it read, which history it used, what it searched, which live prices it asked for, and what it left out and why. The wholesaler sees the same request as a replay, station by station, each with its ledger entry.",
      stepsAlt: "A reply on a phone with its five steps opened: read your request, looked at your history, searched the assortment, checked live price and delivery for three products, left out seventeen products with the reasons.",
      traceAlt: "The operations trace of the milk request: a transport bar to replay it, seventeen stations from the request to the signed order approved by the kitchen manager, and what the live price service saw.",
      stepsCaption: "The buyer's view: the steps behind one reply.",
      traceCaption: "The wholesaler's view: the same request, replayable.",
    },

    search: {
      title: "Search that understands a kitchen",
      lead: "A kitchen asks for \"laktositon maito\", \"something to whip\" or \"utan nötter\". Ordinary search matches the words. Ours reads the requirement, keeps it in plain code, and lets a decision model judge only what the rules allow.",
      chartTitle: (n: number, p: string) => `Right product first, on ${n} real-style requests over ${p} products`,
      chartLegendFirst: "Right first",
      chartLegendTop3: "In the top 3",
      tableTitle: "What a kitchen would notice",
      cols: { dropped: "Requirement broken", standin: "Stand-in shown as the thing", notSold: "\"We do not sell that\", right" },
      colsHelp: {
        dropped: "A top-3 product that misses a stated requirement or carries a forbidden allergen: ordinary milk for a lactose-free request.",
        standin: "Something that can do the job, shown as if it were the product asked for.",
        notSold: "Requests for things the range does not have, answered as such.",
      },
      facts: (hybrid: { first: number; dropped: number }, rules: { dropped: number }, ours: { first: number; notSold: number; of: number }) => [
        `Standard hybrid search, what most teams ship, put the right product first for ${hybrid.first} % of these requests, and ${hybrid.dropped} of its top-three results broke a requirement the kitchen stated.`,
        `Our requirements in plain code take that to ${rules.dropped}, before any model sees a product.`,
        `The judge on top takes right-first to ${ours.first} %. Only a judge says "we do not sell that" when the range does not have it: ours did, ${ours.notSold} of ${ours.of}.`,
      ],
      fair: (n: number, p: string) =>
        `The same ${n} requests in English, Finnish and Swedish, the same ${p} products, the same scoring code for every row. These are standard set-ups we built and ran on our own catalogue and evaluation set, not other companies' products.`,
      backends: "And the same 97 % whether recall runs in the server's memory or on Aiven OpenSearch.",
      oursLabel: "AimoPilot",
    },

    tested: {
      title: "Tested like it matters",
      crashLead: (n: number) =>
        `The crash test puts a buying agent through ${n} hard purchasing situations, three times each: litres to cases, a missed cut-off, partial stock, lactose-free that is not low-lactose, a school's allergen data, a price that expires, a standing order that drifted, an impossible deadline. Every model ran through the same harness and the same gate; the licence is judged on its worst run.`,
      crashTableLabel: "Crash-test ratings and the licence each agent earned",
      cols: { agent: "Agent", rating: "Rating", worst: "Worst run", licence: "Licence", unsafe: "Unsafe attempts" },
      ours: "the model our agent runs on",
      scripted: "scripted baseline",
      levels: "Licences: L0 Learner, every order to a person; L1 Supervised, up to 250 € alone; L2 Trusted, up to 1,000 €; L3 Autonomous, up to 2,500 € and like-for-like substitutes.",
      more: [
        { figure: "1,500+", text: "automated tests over the gate, the core, the server and the documents' own claims." },
        { figure: "61", text: "conversation scenarios scored against the expected end state, counting every correction the buyer had to make." },
        { figure: "13", text: "everyday tasks done by a scripted first-timer in a phone-sized browser, counting taps, typed messages and questions." },
        { figure: "66", text: "probes against a running server: who may do what, hostile and malformed calls, boundaries, floods." },
      ],
      browser: (n: string) => `${n} browser tests across Chromium, WebKit and Firefox at phone and desktop size, including the sign-off with a passkey, accessibility, reduced motion and a crowded room.`,
    },

    business: {
      title: "Run it like a business",
      lead: "The wholesaler's staff see every agent at the door, how each is doing and why, and what is waiting for a person. Everything an agent does is a record they can search in words and replay.",
      items: [
        { name: "Agent scorecard", text: "Each agent performing, escalating or failing, with the reason in words and a proposed action that a named person carries out." },
        { name: "Waiting for a person", text: "Every order waiting for sign-off, oldest first, why it needed one, and how long sign-offs take." },
        { name: "Safeguards", text: "Each rule of the gate and how often it fired: alone, a named person, refused." },
        { name: "Observe and alerts", text: "Orders, sign-offs, refusals by rule, model spend and search quality as panels, each showing its SQL; six thresholds checked by the app itself." },
        { name: "The audit trail, in words", text: "\"Refusals for allergens by outside agents today\" searches the trail; codes, counts and times only, no buyer text." },
        { name: "The stream", text: "Every agent action and gate decision on Kafka, keyed by order, so a request can be replayed in order." },
      ],
      agentsAlt: "The operations portal's agents page: the scorecard with one agent failing after the attacks and one performing, each with requests, refusals and its licence, and the orders waiting for a person.",
      safeguardsAlt: "The safeguards page: how many orders the agent decided alone, how many a named person signed, how many were refused, and the rule book with how often each rule fired.",
      aivenTitle: "On Aiven, every service has one job",
      aiven: [
        { name: "Aiven Runtime", job: "Hosts AimoPilot: the gate, its MCP door, REST, the portals." },
        { name: "PostgreSQL", job: "Orders, approvals, the hash-chained ledger, kitchen memory, telemetry; the scorecard is SQL over it." },
        { name: "Kafka", job: "Every agent action and gate decision, ordered and replayable." },
        { name: "Valkey", job: "The live-price cache and each agent's lookup budget." },
        { name: "OpenSearch", job: "Search over 17,546 products in three languages, the recall index and the audit trail." },
        { name: "Grafana", job: "The full dashboard, read-only over PostgreSQL." },
        { name: "Managed Agents", job: "An outside buyer AimoPilot does not run." },
        { name: "Aiven MCP server", job: "The copilot's read-only view of service state." },
      ],
    },

    screens: {
      title: "On every screen",
      lead: "A chef on the line has a phone; the purchasing manager has a desk. Every moment works on both, the same moment, the same data.",
      pairs: [
        { name: "The conversation", phone: "thread-waiting", desktop: "screen-thread-desktop", phoneAlt: "The conversation on a phone: the order needs the kitchen manager's OK, 1 010,00 €, with OK with Face ID.", desktopAlt: "The conversation on a desktop, the agent as the whole workspace, at the moment the kitchen manager OK'd the order." },
        { name: "The sign-off", phone: "flow-signoff", desktop: "screen-approve-desktop", phoneAlt: "The sign-off on a phone: stopped at the gate, 1 010,00 €, why you are asked, the Approve button.", desktopAlt: "The same sign-off page in a desktop browser." },
        { name: "The store", phone: "screen-store-phone", desktop: "hero-desktop-store", phoneAlt: "The catalogue on a phone: butter in the dairy department, two products, the tab bar with the agent in the middle.", desktopAlt: "The catalogue on a desktop with the agent docked beside it." },
        { name: "Operations", phone: "screen-ops-phone", desktop: "ops-live", phoneAlt: "The operations portal on a phone: live at the gate, three doors and one gate, with its tab bar.", desktopAlt: "The operations portal's Live page on a desktop: three doors, one gate, and what happened to each request." },
      ],
    },

    mail: {
      title: "Emails that look like a business sent them",
      lead: "A receipt the moment an order is placed, and a plain-spoken mail when something changes: a delay, a shortage, a substitute. Built for mail clients, in the kitchen's language, never sent twice.",
      receipt: { subject: "Order placed: 20,94 €, delivery Sun 15.11.2026", alt: "The receipt email: your order is placed, the order number, kitchen, placed and delivery dates, the product line, VAT and total, and a link to check the signed receipt." },
      changed: { subject: "A product on your order cannot come on Mon 16.11.2026", alt: "The change email: a product on your order cannot come, what happened, what was done, the figures, and best, better and good substitutes, marked as staged for the demo." },
      from: "From AimoPilot",
    },

    honest: {
      title: "Honest about what it is",
      lead: "A working demo on the partner's synthetic data, built in a weekend. Here is what is real, what is mocked, and what a production deployment needs next.",
      real: [
        "The partner's 17,546 products, with their delivery-reliability and carbon files.",
        "The partner's mock price and availability service, called live, for short lists only.",
        "Every gate decision, signature, passkey and ledger entry.",
      ],
      mocked: [
        "Orders are committed in AimoPilot's own store and ledger; nothing reaches the partner's order system.",
        "Supplier-shipped products report no real stock, so the agent says \"not reported\" and never prints a placeholder as stock.",
        "Kitchens are fictional; in the demo the server holds their keys. In production the kitchen holds its own.",
      ],
      next: [
        "A pilot with two or three real kitchens, every order still read by a person at first.",
        "OAuth 2.1 for consumer assistants, with the mandate as the consent screen.",
        "Contract prices and assortments per buyer from the wholesaler's ERP.",
        "Keys in an HSM or KMS, with rotation and a published key history.",
      ],
      realTitle: "Real",
      mockedTitle: "Mocked, and said so",
      nextTitle: "Next",
      more: "Read all assumptions and next steps",
    },

    footer: {
      title: "Talk to the agent",
      lead: "Open a test kitchen in one click, ask for 1,000 litres of lactose-free milk by Monday, and sign it on your phone.",
      event: "Junction 2026",
      docs: "Documents",
    },

    shotMissing: "Screenshot coming",
  },
};

export type LandingText = (typeof LANDING_TEXT)["en"];
