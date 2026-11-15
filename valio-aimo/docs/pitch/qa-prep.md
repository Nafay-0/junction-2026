# Questions and answers (jury and Valio Aimo's judges)

Each answer is two or three sentences, in words you can say. Numbers come from `claims.md`. If a question goes past
what is written here, say "we have not tested that" rather than guess. Both of you should be able to give every
answer in the first section.

## Last year's four (the 2025 jury asked all of them)

**1. "What did each of you do, and how did you make decisions?"**
> "One of us is the product owner and design engineer, the other is the developer. AI coding agents wrote the code,
> under our direction. We decided together: the challenge, the pitch and the demo path were written down on Friday
> evening in `CLAUDE.md`, and everything after was checked against Valio Aimo's five criteria."
>
> If a juror looks at Git: almost every commit is under one account, and most carry an AI co-author line. That
> matches the answer above; say so if asked. (Recount on Sunday morning before giving a figure; the Saturday 01:30
> count is stale.)

**2. "Was all of this built this weekend?"**
> "Yes. The first line of app code was committed on Friday at 21:41, after hacking started at 19:30. Before that we
> committed only research notes about the event. We won this partner's challenge last year, but nothing from that
> project's code is in here. We use open-source libraries, and the partner's synthetic data and test API."

**3. "What is the real-world use? Think one step ahead."**
> "A wholesaler like Valio Aimo puts this door in front of its ordering systems. Then any kitchen's purchasing agent,
> from any vendor, can order without a custom integration, and the wholesaler still knows which person allowed each
> order. One step ahead: the same mandate becomes what a kitchen's manager approves when they connect ChatGPT or
> Claude to the wholesaler."

**4. "What would you do with the next 48 hours?"**
> "First, close what our own testing found: the stand-alone menu planner's mandate does not yet carry a kitchen's
> allergen rules. Second, switch on the crash-test licence at the
> live gate: the gate can already enforce it, but the hosted site has no licences published to it. Third, ask Valio
> Aimo for a test account on the real webshop and try the sign-off and the voice on real phones in a real kitchen."

## The questions this brief invites

**"How is this different from an MCP server in front of a webshop?"**
> "An MCP server in front of a webshop lets an agent click 'buy'. Here the agent cannot buy anything its kitchen did
> not sign for: every order is checked in plain code against a signed mandate, a fixed price signed by the
> wholesaler, and the kitchen's budget, and anything beyond it waits for a named person's passkey. MCP is only one of
> the doors; the same gate sits behind REST, the store's conversation, hands-free voice, a photo of a list and the
> basket."

**"The brief says it is not a chatbot. So what is the assistant?"**
> "It is a conversation, but the model only writes one short line per turn. Prices, stock, amounts and dates appear
> only in cards built from data: the options, the order sheet, the sign-off. The agent's steps are shown open, in
> plain words, and it asks only when the answer changes the order. The model reads the chef's words into a
> structured request; it does not decide or approve anything."

**"What stops the model from making things up?"**
> "Nothing it says can become an order on its own. The price must be the wholesaler's signed quote, the order must
> match that quote exactly, and the rules are code, not a prompt. Where a person's answer matters and the agent only
> relays it, the record says 'relayed by the agent, not verified' and the order goes to a person anyway. In voice,
> the voice model only relays: it has one tool, it is given the words to say, and it cannot place or approve
> anything."

**"What happens when the agent is wrong?"**
> "Three things. If it breaks a rule, the gate refuses it and names the rule. If it is unusual, such as ten times the
> kitchen's normal amount, the kitchen is asked before anything is priced. And if it slips through all of that, the
> record shows exactly which step, which data and which person, so it can be found and the agent suspended from the
> wholesaler's desk."

**"Why would a wholesaler open its systems to outside agents?"**
> "Because the buyers' agents are coming anyway, and today the choice is to block them, or let them scrape the
> webshop with no rules. A door with a standard mandate lets the wholesaler accept those orders and still know who
> allowed each one. That is Valio Aimo's own reason for setting this challenge; we did not have to invent the demand."

**"What did the AI coding agents do, and what did you do?"**
> "The coding agents wrote the code, under our direction: one of us as product owner and design engineer, the other
> as developer. About four in five of our commits carry an AI co-author line. We chose the challenge and the design,
> wrote down the rules the agents had to follow, decided what to cut, and ran a separate QA agent whose job was to
> break the product; its findings went back to the builders."

## Other likely questions

**"Is any of the data real?"**
> "The product records are the partner's synthetic ones: 17,546 products, served live on our site. Prices and stock
> come from the partner's test API, queried for a short list only. The kitchens, people and order histories are made
> up, the screens say 'demo on synthetic data', and no order reaches a real order system. The operations pages also
> show a sample week, each item marked, which you can hide."

**"What exactly is in the mandate?"**
> "Which product groups the agent may buy, required claims such as lactose-free, forbidden allergens, how far ahead
> it may order, the per-order limit, a weekly budget that no sign-off can lift, how substitutes are handled, and who
> may sign off up to which amount. The kitchen signs it with its own key; we hold only the public key."

**"Can I trust the wholesaler's claims about stock, price and origin?"**
> "Each one can come as a signed statement, a W3C Verifiable Credential, that an outside agent checks offline against
> the wholesaler's published keys, and a quote lists the statements it rests on. The signature proves who said it and
> that nothing was changed; it does not make the underlying data true, which still depends on the wholesaler's own
> systems."

**"How good is the voice?"**
> "On 36 recorded clips we did not tune on, with accents, hall noise and three languages, it heard the request right
> in 33. In 27 hands-free conversations with real audio, every utterance went through the same engine as typed words,
> and 25 ended exactly as the typed run did. A misheard number is read back or shown on a card before anything is
> priced. We have not recorded a test on a real phone in a real kitchen yet."

**"How good is the photo of a handwritten list?"**
> "On our set of twelve lists with 37 item lines, the reader we chose got 33 lines right in the first run and all 37
> in the second, after a prompt fix. It never invented a quantity, and the five traps we planted, such as a smudged
> amount and a written instruction to the AI, never came out ready to order."

**"How good is the search?"**
> "We measured it on 189 test requests over the same 17,546 products. The right product came first for standard
> BM25 in 31 % of them, keyword search 40 %, a standard hybrid 58 %, semantic search 72 %, ours 97 %. The difference
> is the kitchen's hard rules in code and a decision model judging the candidates, with code checking the judge.
> These are set-ups we built and ran ourselves, not other companies' products."

**"How good are your substitutes?"**
> "We built a map of alternatives by kitchen use over all 17,546 products, with hard rules in code for dietary claims
> and allergens. Against the partner's own substitution list, our first suggestion matched theirs about one time in
> five, and 22% of the partner's own pairs fail the partner's own data, for example a lactose-free product listed with
> one that is not. So we treat it as a ranked suggestion a person confirms, never as an automatic swap."

**"Is it secure? Can anyone read the orders?"**
> "Our QA agent found that the ledger and pending sign-offs were readable by anyone on Friday; that is fixed and
> re-tested. Every kitchen is now an account: the three test kitchens are shared on purpose, a fresh kitchen is
> private to its browser, and the operations portal shows viewers no one's own words. Nobody but the named person can
> approve. Our QA agent's final run had 907 cases with no server errors."

**"Why eight Aiven services? Isn't that a lot?"**
> "Each one has one job: Runtime hosts the app, PostgreSQL is the system of record and the Time machine's history,
> Kafka carries every action in order, Valkey caches live prices, OpenSearch does product search and the agent's
> recall, Grafana is the dashboard and its alert rules, Managed Agents runs an outside buyer we do not run, and
> Aiven's MCP server feeds the operations copilot. It is all on `/ops/platform`, with what we considered and did not
> use."

**"What does it cost to run?"**
> "On Aiven, about nine US cents an hour for the whole system, about four dollars for the weekend. Each test buyer on
> the seven frameworks cost between about one and five cents in model fees for Valio's example."

**"What if your service is down?"**
> "Then no agent can order through it, which is the safe failure. The records, passkeys and orders are in PostgreSQL
> and survived a restart in our test; a live lookup that fails gets a named refusal, never a guessed price."

**"Who are your competitors? How big is the market?"**
> "We have not researched the market this weekend, so we will not give you a number. What we know is that Valio Aimo
> set this challenge because they expect agent buyers."

## The hardest question for each juror

**Kia Kanninen** (Founders House: "a problem worth solving, not just a feature that's easy to build")
- Q: "Do any kitchens buy through AI agents today? Isn't this a solution waiting for a problem?"
> "Today almost none, and we will not pretend otherwise. But the wholesaler is the one asking, and the hard part is
> not the agent, it is deciding what an agent may do alone and who answers for it. That is a problem the wholesaler
> has the day the first agent orders."

**Daksh Raghuvanshi** (AfterQuery: "explain exactly why an agent fails in their world, and whose reward holds when
someone tries to break it")
- Q: "Your reference is a script that beats every model. Your colleague's StoreBench already showed scripted
  operators beat frontier models. What is new, and did your reward survive attack?"
> "Each of our thirteen scenarios isolates one decision a careless buyer gets wrong, like 'by Monday' when the
> cheapest milk's cut-off has passed. The score comes from the gate's own records, never from the agent's report.
> Every model ran three times through the same harness, and the licence is set by its worst run. We ran scripted
> agents against our own scoring, baselines and exploits; two found real holes, always picking the first product and
> scanning every price, and we fixed both. The suite has thirteen scenarios, so it says nothing about situations
> outside them."

**Otto Söderlund** (Supercell: "a real user problem, something people want to come back to")
- Q: "Why would a chef come back to this tomorrow?"
> "Because it remembers the kitchen: the usual order is one tap, it catches the slip of a zero before it is priced,
> and it remembers who said 'always lactose-free' and when. We have not put it in front of a real chef yet; that is
> the first thing we would do."

**Timo Ahopelto** (Lifeline Ventures; no stated criterion)
- Q: "Who pays for this, and is it a company or a feature for one wholesaler?"
> "The wholesaler pays, because it is the one taking orders from machines and carrying the risk. Because the door
> uses open standards, the same gate can stand in front of other wholesalers too. We have not tested pricing with
> anyone, and we would not claim a business yet."

**Umar Noor** (Google DeepMind; "first prototype to real-world impact")
- Q: "What does Gemini actually do here, and what would it take to reach a real kitchen?"
> "Gemini Live is the ears and the mouth of hands-free voice, with OpenAI's realtime model as the fallback: it relays
> the chef's words to the same engine as typed ones and says what it is given. On 36 held-out clips it heard 33
> right. To reach a real phone line we documented the Twilio route, but did not build it."

**Hubertus van der Drift** (Context.dev: "that one unique insight that solves a problem 10x faster or better")
- Q: "What is the one insight? Everyone is building agent guardrails."
> "The agent's freedom should be a document the buyer signs, checked by code at the seller's door, not a prompt
> inside the agent. That makes the model replaceable: seven frameworks used the same door unchanged, and the same
> rules held for all of them."

**Arturs Polis** (Verda: "the hardest challenges, prototypes with a clear path to production and scale")
- Q: "What breaks first at a thousand kitchens?"
> "Some per-connector limits and the operations sign-in are still held in one process's memory, and consumer
> assistants connect through a secret address instead of proper OAuth. The orders, ledger and passkeys are already in
> PostgreSQL, events go through Kafka, and the path to OAuth with the mandate as the consent screen is written down
> in `web/docs/connect-an-agent.md`."

## If you do not know

> "We have not tested that. Here is what we did test." Then give the closest verified fact.
