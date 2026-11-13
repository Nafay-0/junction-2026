# Junction 2026: partner challenges

Research cut-off: Fri 13 Nov 2026, about 19:00 EET (17:00 UTC), during the opening ceremony.

## Read this first

**The official challenge list is not public.** The Junction Platform page for the event returns an empty challenge list to anyone not logged in (`"challenges":[]` in the page data, checked at 16:55 UTC). The 2025 event page does the same, so briefs stay behind the participant login even after the event. The 2026 site names six tracks and the partners, but no briefs, no per-challenge prizes and no partner judging criteria.

What this report contains is therefore everything that leaked out through public channels: Junction's LinkedIn partner posts, the 2026 site, partner blogs, and three public GitHub sources (S-Pankki dataset, MariaDB starter repos, a Tieto repo). For about half of the 19 challenges there is no brief at all, only a partner name. **Open the Challenges tab on the platform after the challenge videos (Fri 19:10 to 19:30) and correct this file against it before committing to a choice.**

Provenance tags used throughout:

- **CONFIRMED**: I read it myself on an official or partner-owned source for 2026. URL given.
- **SECONDHAND**: text of an official Junction LinkedIn post that I could only read through a participant's scrape (`github.com/Lemonterminator/Junction-2026`, file `docs/2026/bronze/en/linkedin_posts_raw.md`). I verified 14 other posts from the same scrape word for word against LinkedIn, so the scrape is reliable, but these particular posts I could not open directly.
- **INFERRED**: my reading of evidence. The evidence is named.
- **HINT (other year or event)**: not about Junction 2026.

## Event mechanics that affect the choice

| Fact | Status |
|---|---|
| 13 to 15 Nov 2026, Hype Areena, Espoo. About 2,000 builders, teams of 1 to 4, €100,000 total prize pool, "Full prize breakdown coming soon." | CONFIRMED, https://2026.hackjunction.com/ |
| Six tracks: Hardware (by Arduino), Healthcare, AI Infrastructure (by Verda), FinTech, Agentic AI, Data. Only Arduino and Verda are named as track owners. | CONFIRMED, same |
| "Tech challenges run across every track, so any team can take them on alongside their track." Tech partners give credits and some give "best use" prizes. | CONFIRMED, same |
| "Each Challenge Partner chooses their own track winners against their own criteria." | CONFIRMED, same |
| Main prize: "face-to-face peer review to select the top 5 projects", then "The top 5 pitch in front of a live audience, and a grand jury chooses the overall winner." Seven judges. | CONFIRMED, same. The platform data also shows `physicalPeerReview: true`, `hasGavelVoting: false`, `hasFinalistVoting: false`. |
| So the final decision is a jury decision, not a participant vote. Peer review only gets you into the top 5. | INFERRED from the two lines above |
| Deadlines: preliminary submission Fri 23:59 (platform says 23:55), submissions open Sat 12:00, final Sun 10:00, challenge winners Sun 15:10, Junction winner 15:50. | CONFIRMED, site and https://hackjunction.app/hackathons/junction-2026 |
| Submissions are open-sourced under MIT; partners may reuse them. | CONFIRMED, site FAQ |
| Platform allows multiple submissions per team (`allowMultipleSubmissions: true`). | CONFIRMED in page data; what it means for entering several challenges is not stated |
| Whole team must attend peer review Sun 10:30 to 13:00 to be eligible for the main prize; pitch video max 2:00; top-5 pitch is 3 min plus 3 min questions; generic Junction criteria are Innovation, Impact, Implementation. | SECONDHAND-UNVERIFIED: a participant's notes (`github.com/ApsiApina71/junction-2026`, `docs/context/challenge.md`). Check the participant guide. |
| 3,555 registrations on the platform. | CONFIRMED, platform page data |

What the grand jury says it wants (CONFIRMED, judge bios on the 2026 site):

- Kia Kanninen, Founders House: "teams that start from a problem worth solving, not just a feature that's easy to build."
- Daksh Raghuvanshi, AfterQuery: "teams that can explain exactly why an agent fails in their world, and whose reward holds when someone tries to break it."
- Otto Söderlund, Supercell: "a real user problem" and "something people want to come back to."
- Beer van der Drift, Context.dev: "that one unique insight that solves a problem 10x faster or better."
- Arturs Polis, Verda: "the hardest challenges" and "prototypes with a clear path to production and scale."
- Timo Ahopelto (Lifeline Ventures) and Umar Noor (Google DeepMind): no criteria stated.

HINT (past years): the 2025 main prize went to WAVELET, "a real-time electromagnetic (radio-wave) simulation built in C++ and OpenGL"; 2024 went to BREAKDANCE by Frank Sandqvist (Wikipedia, Junction (hackathon)). Both were technically deep and visual. Neither was a chat wrapper.

## Challenge list at a glance

| # | Partner | Challenge | Track | Brief status |
|---|---|---|---|---|
| 1 | S-Pankki | Personal Economic Trainer | FinTech (inferred) | Teaser CONFIRMED, dataset CONFIRMED |
| 2 | Valio Aimo | Trusted Trade Agents | Agentic AI (inferred) | SECONDHAND |
| 3 | Cala | Make Unicorns Real | Data or Agentic AI (inferred) | CONFIRMED (site) |
| 4 | MariaDB Foundation | Wikipedia Through Time | Data (inferred) | SECONDHAND name, CONFIRMED starter repos and booth material |
| 5 | Stoa | Verifiable Q&A on construction drawings | Data or Agentic AI (inferred) | Teaser CONFIRMED |
| 6 | AfterQuery | Agent environments and evals (title unknown) | Agentic AI (inferred) | Teaser CONFIRMED |
| 7 | Verda | AI Infrastructure track, plus "Best use of Verda" bounty | AI Infrastructure | Bounty CONFIRMED, track brief unknown |
| 8 | Arduino | Hardware track | Hardware | Brief unknown, lab kit CONFIRMED |
| 9 | Ignite Next x Intel | Robot arms and cameras | Hardware | Teaser CONFIRMED |
| 10 | Rokoko | Motion capture | Hardware (inferred) | SECONDHAND |
| 11 | Meta | AI glasses | Hardware (inferred) | Teaser CONFIRMED |
| 12 | AstraZeneca | Unknown | Healthcare (inferred) | No brief |
| 13 | Aalto University | "challenges straight from our research labs" | Healthcare (inferred) | No brief |
| 14 | City of Espoo | Unknown | Unknown | No brief |
| 15 | Hostinger | Unknown | Unknown | No brief |
| 16 | Bahn Express | Vehicle transport operations | Agentic AI or Data (inferred) | No brief |
| 17 | Tieto | Unknown | Agentic AI (inferred) | No brief, one GitHub lead |
| 18 | Exa | Search API for agents | Agentic AI (inferred) | SECONDHAND |
| 19 | Context.dev | Unknown | Data (inferred) | No brief |

Cross-track tech bounties: Verda, NVIDIA Nemotron, Modal, Cloudinary, Aiven, Atech, plus credits from OpenAI Codex, Featherless, Oxylabs and others. See the last challenge section.

The list of challenge partners is CONFIRMED from the "Challenge partners" logo row on https://2026.hackjunction.com/: Hostinger, Valio Aimo, S-Pankki, Aalto University, Cala, City of Espoo, Exa, MariaDB, AfterQuery, Bahn Express, AstraZeneca, Stoa, Intel, Context.dev, Rokoko, Ignite Next, Meta, Tieto. Main partners: Arduino, Verda. Google DeepMind is "teaming up" separately.

---

## 1. S-Pankki: Personal Economic Trainer

**Track:** FinTech (INFERRED: it is the only bank among the partners).

**Brief, in the partner's words** (CONFIRMED, Junction LinkedIn, 10 Nov 2026, https://www.linkedin.com/feed/update/urn:li:activity:7526026106781642752/):

> "Their Personal Economic Trainer challenge asks builders to create an AI experience that helps people understand their money through conversation. Using synthetic transaction data modelled on real banking activity, teams can explore questions like 'Where did my money go?' and 'How would my savings change if I spent less on eating out?'"

A second post the same day (https://www.linkedin.com/feed/update/urn:li:activity:7525875075997372416/): "That makes usability a concrete question: can someone understand what's happening and get something done with confidence?"

**Plain restatement:** a conversational assistant over a customer's bank transactions that explains spending and answers what-if questions, in a way an ordinary customer trusts.

**Judging criteria and prizes:** not published.

**Technology provided** (CONFIRMED, https://github.com/hackjunction/Junction-2026-S-pankki):

- This is the repo from the earlier lead. It belongs to 2026: it sits in the official `hackjunction` org, is named `Junction-2026-S-pankki`, was created 13 Nov 2026 14:10 UTC, and its description is "You can find the materials for the S-pankki challenge in this repository". It is public, no signup needed. It contains data and a download guide only: no brief, no criteria, no starter code.
- No other partner has a repo in the `hackjunction` org for 2026. The only comparable public repos are MariaDB's (section 4) and the possible Tieto one (see the Tieto row under "Partners with no public brief").
- `tx_junction_transactions.csv`, about 346 MB, stored with Git LFS. Columns: `customer_id`, `bank_account_id`, `tx_date`, `tx_timestamp`, `category`, `tx_amount_eur`, `balance_after_eur`, `transaction_type`, `merchant_id`, `mcc_code`. In the first 2,000 rows I sampled: dates from Oct 2024 to Sep 2026, 12 categories (Groceries, Restaurants, Utilities, Entertainment, Transportation, Health, Lifestyle, Salary, Housing, Invest Deposit, Home & Tech, Travel), 5 transaction types.
- `tx_customers_junction.csv`: 5,100 customers with postal code and age. Postal codes start with 00, 01, 02 (Helsinki, Vantaa, Espoo).
- `mtg_negotiation_history.csv`: 3,452 mortgage application events for 200 applicants. Event types include `customer_contact`, `property_added`, `collateral_valuation`, `loan_calculation`, `additional_collateral_requested`, `loan_decision`. Each event has a free-text note.
- `mtg_tx_customer_link_and_final_mtg_infio.csv`: links the 200 mortgage applicants to transaction customers and gives the outcome: 150 approved, 50 rejected (34 insufficient collateral, 8 insufficient income, 6 insufficient equity, 2 existing debt), with final price, loan, equity, collateral, `required_monthly_income_eur` and loan-to-value.
- Gotcha from the README: the CSVs start with a UTF-8 BOM (read with `utf-8-sig`), and "Download ZIP" may give you the LFS pointer instead of the data. Use `git lfs pull` or the per-file download button.

**The mortgage files are not mentioned in any public teaser.** INFERRED: the full brief has a mortgage dimension (readiness, affordability, or explaining a decision). Confirm on the platform.

**What the business cares about** (INFERRED from the two posts and S-Pankki's position as the S Group retail bank): a feature that could go into the S-mobiili app; numbers that are always right; plain language; nothing that looks like regulated investment advice; customers who feel informed, not judged.

**Constraints and gotchas:** synthetic data only. An LLM doing arithmetic on transactions will produce wrong totals, and a bank judge will check. Compute every number in SQL (DuckDB handles the 346 MB file easily on the M3 Pro) and let the model only phrase the answer.

**Assessment**

- Crowding: very high. Data is public, the task is "LLM over a CSV", and it appears to be the only FinTech challenge.
- Feasibility: high. Everything runs on a laptop.
- Demo potential: high. Everyone understands "where did my money go".
- Creative room: moderate. The obvious build (chat plus pie charts) will be submitted dozens of times.

Non-obvious directions:

1. **Mortgage flight simulator.** Use both datasets. Fit the bank's own decision pattern from the 200 applications (loan-to-value, required income, collateral), then show a customer from their real spending what stands between them and approval: "cut restaurants by €180 a month for 14 months and the equity gap closes." Most teams will ignore the mortgage files.
2. **Answers you can audit.** Every figure in a reply is clickable and opens the query and the transactions behind it. Add a test panel that shows the assistant refusing when the data cannot support an answer. This speaks to the bank and to the AfterQuery juror.
3. **Trainer, not chatbot.** Take the word "trainer" literally: a weekly session, one goal, one exercise, progress against people of the same age and postal area (the customer file supports cohort comparison). Voice first, three minutes a week.

---

## 2. Valio Aimo: Trusted Trade Agents

**Track:** Agentic AI (INFERRED from the title).

**Brief** (SECONDHAND, Junction LinkedIn post, date not captured):

> "Valio Aimo joins Junction as a challenge partner 2nd year in a row. Behind every professional kitchen are decisions about ingredients, prices, availability and deliveries. Their challenge, Trusted Trade Agents, explores what happens when AI agents help make those decisions. Builders will prototype ways for purchasing agents to find products, compare options and place orders, with clear rules for when a human needs to step in. Using synthetic data and mock APIs, teams can tackle everything from missing ingredients to explaining why an agent chose a particular product."

**Plain restatement:** build a purchasing agent for a restaurant or kitchen that shops Valio Aimo's wholesale catalogue, handles substitutions, explains its choices, and knows when to stop and ask a person.

**Judging criteria and prizes:** not published.

**Technology provided:** synthetic data and mock APIs (SECONDHAND). No public repo found. Expect access through the platform or the booth.

**What the business cares about:**

- CONFIRMED (platform sponsor text, https://hackjunction.app/hackathons/junction-2026): 20,000 professional customers, 25,000 products from 700 suppliers; "Aimo represents the cutting edge of how foodservice can be reinvented for the AI-driven age."
- HINT (2025): their Junction 2025 challenge was about delivery reliability and handling product shortages before the order reaches the customer; the winner was "Omni-Valio" (https://www.valioaimo.fi/artikkelit/junction-hackaton-2025/). Shortage and substitution handling is a standing concern.
- CONFIRMED (https://www.valioaimo.fi/valio-aimo-in-english): the site carries a notice about a "Data Breach in Valio's Systems" asking customers to be cautious about unexpected requests to change orders, deliveries or invoicing. INFERRED: "trusted" in the title is not decoration. They are thinking about agents being manipulated.
- INFERRED: what they would ship is a way for customers' agents to order from Aimo safely, with an audit trail a purchasing manager accepts.

**Constraints and gotchas:** mock APIs are mandatory in practice. Human-in-the-loop rules and explanations are named deliverables.

**Assessment**

- Crowding: medium to high. Agents are this year's default topic and mock APIs lower the entry bar. B2B wholesale is less attractive than banking or startups, which thins it a little.
- Feasibility: high.
- Demo potential: medium to high, if staged as a kitchen scene with a judge playing the chef.
- Creative room: high. "Trust" can be made concrete in several ways.

Non-obvious directions:

1. **Purchasing mandate.** The chef signs a small policy (budget, allergens, banned brands, maximum price change for a substitute). The agent can act only inside it; anything outside becomes a one-tap approval. Demo with an attack panel: a poisoned product description tries to make the agent overpay and is blocked. This links directly to their breach notice.
2. **Recipe-aware substitution.** When cream is out of stock, most teams will pick the nearest SKU. Start from the menu instead: what dish, how many covers, which allergens, what the substitute does to cost per plate. The explanation writes itself.
3. **Two agents, one receipt.** A buyer agent for the kitchen and a seller agent for Aimo negotiate; the output is a signed, human-readable receipt listing what was compared and why the choice was made.

---

## 3. Cala: Make Unicorns Real

**Track:** not stated. Data or Agentic AI (INFERRED).

**Brief** (CONFIRMED, workshop description on https://2026.hackjunction.com/):

> "the Make Unicorns Real challenge, where you'll build a product that solves a real need for founders or VCs, powered by reliable public data from Cala."
> "We'll show you how to get the most out of Cala, the public data layer for AI agents. You'll learn how to query companies, people, investors and funding rounds, and how to use the connections between them to build things web search can't. We'll also share what our judges are looking for."

SECONDHAND (LinkedIn): "Junction happens right before Slush, when thousands of founders and investors gather in Finland. Good timing to build something they'll want to use."

**Plain restatement:** a product for founders or investors that depends on Cala's structured data about companies, people, investors and rounds, and does something a web search cannot.

**Judging criteria and prizes:** not published. Criteria will be explained at the Cala workshop, Sat 11:00, Loft, 4th floor (CONFIRMED). That is 15 hours into the build.

**Technology provided** (CONFIRMED, https://cala.ai and https://docs.cala.ai):

- REST endpoints: `/v1/knowledge/search` (sourced answer in markdown), `/v1/knowledge/query` (typed rows), `/v1/entities`, `/v1/entities/lookup`, `/v1/entities/{id}`. Natural language or a dot-notation query language.
- MCP server at `https://api.cala.ai/mcp/` with an `X-API-KEY` header. Console at https://console.cala.ai/.
- Public free tier: 100 credits a month (1 credit is 1 query), 10 requests a minute. That is far too small for a weekend. INFERRED: hackathon keys or credits are handed out through the platform's Hackerpack or at the booth. Ask immediately.

**What the business cares about:** INFERRED from the brief: proof that the entity graph beats web search, with traceable sources, and something they can show to founders and VCs at Slush on 18 and 19 November. HINT (other event): at another 2026 hackathon their "Best Use of Cala" prize required "a Cala API key in your production build" and paid €1,000 plus a trip to Barcelona.

**Constraints and gotchas:** Cala data is mandatory. Coverage outside finance and well-known companies is unknown; test the entities you plan to demo before building around them.

**Assessment**

- Crowding: high. Easy API, startup theme, Slush next week.
- Feasibility: high.
- Demo potential: medium for peers, high for the jury. Two jurors (Lifeline Ventures, Founders House) are the target users.
- Creative room: medium. The obvious builds are "investor finder" and "company research agent".

Non-obvious directions:

1. **Deck fact-checker.** Paste a pitch deck. The tool extracts each checkable claim (round size, investors, founder history, customers) and marks it confirmed, contradicted or unknown, with Cala sources. Run it live on a well-known deck.
2. **Conflict map.** For a founder: which investors are already in a competitor, and which partners have funded this exact pattern before and lost. It uses graph connections, which is what Cala asked for.
3. **Slush route planner.** Given a startup, rank the attending investors by fit and produce the evidence line to open the conversation with. Usable next week, which is the partner's stated wish.

---

## 4. MariaDB Foundation: Wikipedia Through Time

**Track:** Data (INFERRED).

**Brief** (SECONDHAND, Junction LinkedIn post):

> "Wikipedia keeps changing. What could we learn by exploring how its knowledge has evolved? MariaDB's challenge, Wikipedia Through Time, asks builders to investigate that question using native vector search and system-versioned tables. Teams can explore new ways to search across time, understand changes in articles and connect answers to their sources. An AI research companion or a visual tool for exploring edit history could be just the beginning."

Corroboration (CONFIRMED): the booth screen built by Robert Silén of the MariaDB Foundation is titled "MariaDB's Wikipedia challenge" and shows the lines "What did Wikipedia say about your hometown in 2010? Explore MariaDB's system-versioned tables." and "Search by meaning, not by keywords. AI and RAG on Wikipedia with MariaDB's vector search." (https://github.com/robertsilen/junction2026, `script.md`, created 13 Nov 2026).

**Plain restatement:** build something that explores how Wikipedia articles changed over time, using two MariaDB features: vector search and tables that keep their own history.

**Judging criteria and prizes:** not published.

**Technology provided** (CONFIRMED, public, no account or API key):

- https://github.com/MariaDB/mariadb-wikipedia-datasets: "Made for hackathons and courses". Three ready-made datasets from Finnish Wikipedia. S (156 MB): History of Finland articles in Finnish, Swedish and English with bge-m3 vectors. M (315 MB): every saved version of 19,742 Finnish articles from 2003 to 1 Oct 2026, 862,076 versions, with editor, edit summary and text hash. L (495 MB): all 568,416 Finnish articles, current version, no vectors.
- https://github.com/MariaDB/mariadb-system-versioning-wikipedia: a working "Wikipedia Time Machine" on system-versioned tables, with measurements.
- https://github.com/MariaDB/mariadb-vector-wikipedia-rag: cross-language semantic search on MariaDB Vector. Its README lists what is not done yet: "hybrid search, chunks, and Ask (step 7)", and a known failure: questions about a single fact in a person's life miss because there is one vector per article.
- All three were created 19 and 20 Oct 2026. They do not use the word Junction, so the link to the challenge is INFERRED from timing, topic and author. Needs Docker, Python 3.11+, MariaDB 11.7+ for vectors. Runs on the M3 Pro.

**What the business cares about** (INFERRED from the repos and booth slogans): showing that one open-source database does vectors, time travel and SQL filters in a single statement, with no separate vector store. The foundation's people write measured, honest READMEs. A project that reports recall and query times, and that closes one of their listed gaps, will read as "we want to merge this".

**Constraints and gotchas:** MariaDB's native features are the point; a Postgres or Pinecone build would miss it. The history dataset is Finnish only and is raw wikitext. English full history is about 300 GB compressed, so it is out of reach; a handful of English articles pulled through the Wikipedia API is workable for a demo. Loading the full M dataset takes time; start with the 50-article subset.

**Assessment**

- Crowding: low to medium. It needs a specific database, Docker and patience with data loading. It is also not an "agent" challenge.
- Feasibility: high. Data, starter code and docs are available now.
- Demo potential: high. A date slider on a Wikipedia article is understood in five seconds.
- Creative room: high.

Non-obvious directions:

1. **Meaning drift.** Embed versions over time and plot when an article's meaning moved, as opposed to when its text was edited. Reverts and typo fixes vanish; real rewrites stand out. One SQL statement combines `FOR SYSTEM_TIME` with vector distance, which is exactly the pairing the partner wants shown.
2. **Answers with a date.** A question-answering tool where every answer is pinned to a moment: ask the same question as of 2008 and as of 2026 and see the two answers side by side with the diff and the edits responsible. Framed as a real problem: AI systems cite sources that have since changed.
3. **Guess the year.** A game for the peer-review table: show a snapshot, the visitor guesses the year, the tool reveals the answer and the edit that gives it away. It makes reviewers participants.

---

## 5. Stoa: verifiable answers about construction drawings

**Track:** not stated. Data or Agentic AI (INFERRED).

**Brief** (CONFIRMED, Junction LinkedIn, 9 Nov 2026, https://www.linkedin.com/feed/update/urn:li:activity:7525483509143232512/):

> "Their challenge takes on one of the hardest unsolved problems in construction tech: getting AI to answer questions about real construction drawings, accurately and with answers you can verify at a glance."

**Plain restatement:** given real construction drawings, answer questions about them correctly and show the evidence so a person can check the answer in a second.

**Judging criteria and prizes:** not published. INFERRED: accuracy on a question set and quality of the evidence display, because those are the two things the teaser names.

**Technology provided:** unknown. "Real construction drawings" implies a dataset handed out on site. No public repo found.

**What the business cares about** (CONFIRMED, https://stoabuild.com/): Stoa's product answers from a project's documents "with the document and page behind every sentence", runs on "more than twenty Nordic sites, from data halls to rail", and claims 2 to 8 hours saved per problem resolved. INFERRED: they are hiring and they want methods that work on drawings, where text extraction fails. A result that beats their internal baseline on their own questions is something they would ship.

**Constraints and gotchas:** drawings are large sheets with small text, symbols, legends and cross-references between sheets. A vision model given a whole sheet will miss details. Data may be under a use restriction; ask.

**Assessment**

- Crowding: low to medium. It is announced as hard and it is.
- Feasibility: medium. Doable on a laptop with hosted vision models (Verda inference or Gemini), but quality depends on tiling, OCR and reference resolution, which take time.
- Demo potential: high if the answer highlights the exact region on the sheet.
- Creative room: high, because most teams will try "send the PDF to a vision model".

Non-obvious directions:

1. **Index before asking.** Tile each sheet, OCR it, detect the title block and legend, and resolve callouts such as "see detail 3 on A-501" into links. Questions are then answered over this structure, and every answer returns boxes on the sheet.
2. **Count and show.** For counting and measuring questions ("how many fire doors on level 2"), return the count together with numbered highlights, so the checker sees all of them at once. Add an explicit "cannot determine" answer.
3. **Sheet disagreement finder.** Compare the same element across disciplines or revisions and flag mismatches. It answers a question nobody asked yet, which is where money is lost on site.

---

## 6. AfterQuery

**Track:** Agentic AI (INFERRED).

**Brief:** no title or brief published. Teaser (CONFIRMED, Junction LinkedIn, 4 Nov 2026, https://www.linkedin.com/feed/update/urn:li:activity:7523719475117064192/):

> "They're coming all the way to Espoo to meet builders figuring out what agents should learn next and building the environments to teach them."
> The juror "will be looking for teams that understand why their agents fail and whose reward systems hold up when someone tries to exploit them."

**Plain restatement** (INFERRED): build a training or evaluation environment for AI agents, with a scoring rule that cannot be gamed.

**Judging criteria and prizes:** not published.

**Technology provided:** unknown.

**What the business cares about** (CONFIRMED, https://www.afterquery.com/): they sell expert data, rubrics and "Agent Environments (API / MCP)" to frontier labs. Their RL lead authored StoreBench, "a live-commerce environment where no frontier model matched a simple scripted operator" (judge bio on the 2026 site). INFERRED: they want realistic environments in expert domains, with honest failure analysis. They are also recruiting.

**Constraints and gotchas:** the audience for this work is researchers. A peer reviewer may not see why it matters unless the demo makes the failure visible.

**Assessment**

- Crowding: low to medium. Niche, research-flavoured.
- Feasibility: medium to high for a team that has built evals before; low otherwise.
- Demo potential: medium. Raise it by showing an agent cheating live, then the fixed reward stopping it.
- Creative room: high. Also the only challenge whose partner sits on the grand jury with stated criteria.

Directions: an environment built from another partner's world (a kitchen purchasing simulator, a mortgage desk), so the domain is concrete; a public leaderboard where visitors try to break the reward during peer review; a failure taxonomy generated automatically from agent traces.

---

## 7. Verda: AI Infrastructure track and "Best use of Verda"

**Track:** AI Infrastructure (CONFIRMED owner).

**Track brief:** not published. SECONDHAND teaser: "From data center efficiency to model performance, there are hard problems to solve across the AI ecosystem."

**Bounty** (CONFIRMED, https://verda.com/blog/junction-2026, dated 9 Nov 2026):

- Any team solving a Junction 2026 challenge with Verda services is eligible. Teams document their process and submit through the Junction Platform.
- Judging looks for teams that take on hard problems and show the solution can "scale beyond early prototypes."
- Prizes: 1st €10,000 in cloud credits plus merch; 2nd and 3rd €2,500 in credits each.
- Every team gets credits that "unlock all services on our Cloud Platform." Amount not stated. Coupon codes come through the platform: Hackerpacks, find Verda, fill in the form. Redemption steps: https://docs.verda.com/resources/obtaining-free-credits/how-to-redeem-credits/. Each coupon works once per account, so each teammate redeems their own.

**Technology** (CONFIRMED, Junction LinkedIn 5 Nov, https://www.linkedin.com/feed/update/urn:li:activity:7524077008612487168/): Verda Inference with an OpenAI-compatible API ("Just change your base URL and API key"), models such as Kimi K3.1 Pro with a 1M-token context; fine-tuning on NVIDIA B200 GPUs; S3-compatible storage; and "NVIDIA's Nemotron 3.5 Super VL endpoint, hosted by Verda" for the NVIDIA bounty. Docs: https://docs.verda.com. Workshop Fri 20:30, Loft. Booth 6, 3rd floor.

**What the business cares about:** INFERRED from the judging line and the CTO's juror statement: real workloads on their cloud (fine-tuning, serving, storage together), not one API call.

**Assessment:** the track itself cannot be assessed without a brief. The bounty is a stacking prize: low extra effort, large field, and the prize is credits, not cash. Use Verda inference by default in whatever you build and write down what you ran.

---

## 8. Arduino: Hardware track

**Track:** Hardware (CONFIRMED owner).

**Brief:** not published.

**Technology provided** (CONFIRMED, 2026 site): Hardware Lab on the 5th floor with Arduino UNO Q boards ("Linux computing and real-time control on a single board"), components, 3D printers, LeRobot arms, mentors. SECONDHAND: NVIDIA Jetsons too. Workshop Fri 20:30, "Getting started with the UNO Q", including "how to run AI locally on the board".

**What the business cares about** (INFERRED): UNO Q adoption and edge AI on the board itself.

**Assessment:** crowding medium (new, heavily promoted, but capacity-limited by kit). Feasibility for a laptop-only software team: low to medium; lending rules are unknown. Demo potential: the highest of any track, since a moving object beats a screen at a peer-review table. Not recommended unless someone on the team has shipped hardware.

---

## 9. Ignite Next x Intel: robot arms and cameras

**Track:** Hardware (CONFIRMED: "a hardware challenge to the Hardware Lab by Arduino").

**Brief** (CONFIRMED, Junction LinkedIn, 10 Nov 2026, https://www.linkedin.com/feed/update/urn:li:activity:7525875222328299520/):

> "Teams will work with robot arms and cameras to connect their code to physical movement, with on-site support to help them get started. We're looking forward to that moment when a robot does something a team has just taught it."

**Technology** (CONFIRMED, workshop text on the site and platform sponsor text): Intel Core Ultra Series 3, OpenVINO, "Physical AI Studio", Intel's open-source Robotics AI Suite. Workshop Sat 12:00, Hardware Lab.

**What they care about** (CONFIRMED sponsor text): "We are at Junction to meet the builders behind Europe's next robotics companies." INFERRED: a robot that learns a task from demonstration and repeats it reliably.

**Assessment:** crowding low (limited arms). Feasibility medium to low: shared hardware, and teaching a policy takes hours you cannot parallelise. Demo potential very high. Criteria and prizes unknown.

---

## 10. Rokoko: motion capture

**Brief** (SECONDHAND, Junction LinkedIn): "Their motion capture technology turns human movement into data that builders can use in animation, robotics and new ways to interact with software. With motion capture gear and mentoring for participants, teams will be able to build and test experiences driven by real movement."

**Assessment:** crowding low. Feasibility depends on how many suits and gloves exist and how they are shared (unknown). Demo potential high. No criteria, prizes or SDK details published.

---

## 11. Meta: AI glasses

**Brief** (CONFIRMED, Junction LinkedIn, 3 Nov 2026, https://www.linkedin.com/feed/update/urn:li:activity:7523343578853437440/):

> "AI glasses give builders a different starting point: hands-free, point-of-view experiences. It's not about distracting you from the real world, but enhancing everyday moments. Whether you're leaning into web or mobile tech, display or displayless glasses, the best experiences keep you present."

**Plain restatement:** an experience for smart glasses that helps in the moment without pulling attention away.

**Technology:** not stated. INFERRED from "web or mobile tech, display or displayless": Meta's mobile toolkit for glasses and web apps for the display model. Whether devices are lent on site is unknown.

**Assessment:** crowding medium (strong brand, limited devices). Feasibility medium; needs mobile development. Demo potential high in person but hard to show to a table of reviewers without screen mirroring. Criteria and prizes unknown.

---

## 12 to 19. Partners with no public brief

For these, do not plan anything until you have read the platform.

| Partner | What is known for 2026 | Hint from other years or events | First question to ask at the booth |
|---|---|---|---|
| AstraZeneca | CONFIRMED challenge partner. LinkedIn 11 Nov: "the questions worth solving often involve people whose needs are complex and deeply personal." Likely Healthcare track (INFERRED). | None found. | Is there patient or trial data, and what may leave the building? |
| Aalto University | CONFIRMED, LinkedIn 12 Nov: "they bring real challenges straight from our research labs." Plural. | The platform sponsor text still describes AR4U, a voice AI companion for older adults, which was the 2025 challenge (https://www.aalto.fi/en/news/aalto-students-and-researchers-shape-together-how-we-age-with-ai-at-junction-hackathon-2025). | Which labs, and is it AR4U again? |
| City of Espoo | CONFIRMED challenge partner. | Platform text is unchanged from 2025: Business Espoo advisory services, "A great idea here could be the beginning of a real pilot in Espoo!" | Is a pilot on offer this year? |
| Hostinger | CONFIRMED, LinkedIn 2 Nov: "A working idea becomes much more interesting when someone else can actually use it." Keynote Sat 13:00: "Vibe coding solved building. Now comes the hard part", on attention, timing and testing an idea before building. | Hostinger's own contests (for example its 21-Day Startup Challenge in September 2026, $3,500 in prizes) reward products built and launched on Hostinger Horizons. | Is Horizons mandatory, and is real usage during the weekend part of the score? |
| Bahn Express | CONFIRMED, LinkedIn 9 Nov: "They use technology to coordinate vehicle transport across Europe, connecting bookings, drivers and delivery tracking." Site: 400+ dealers, orders by portal, API, email or Excel, driver app, live tracking (https://www.bahnexpress.fi). | At the Aaltoes Prompt Operations Hack on 25 Oct 2026 their challenge used a data snapshot of 47 tables, and teams built dispatch control rooms that surface only the orders needing a person (`github.com/tommy2006/bahndesk`). Bahn told teams the worst failure is "a car that could be delivered but isn't". | Same dataset as October? |
| Tieto | CONFIRMED challenge partner (logo only). | Lead, INFERRED: `github.com/te-industry-tech-office/junction26-messagepack-csharp`, created 11 Nov 2026, is a copy of the MessagePack-CSharp library with four branches named `ju26-issue-2129`, `-2234`, `-2283`, `-2297`, each one commit titled like "Agentic implementation of #2129". The issue numbers match open issues in the upstream project. This suggests a challenge about judging or improving AI-written changes in a real C# codebase. The owner account is not verified as Tieto. | Is the challenge about reviewing agent-written code? |
| Exa | CONFIRMED challenge partner; workshop Sat 16:30. SECONDHAND: "a research assistant that finds useful sources, a discovery tool that surfaces new opportunities, or an agent that gathers information for your next task." | "Best Use of Exa" awards at other 2026 hackathons. | Is it a bounty for any project using Exa, or a brief? |
| Context.dev | CONFIRMED challenge partner; CTO is a juror. Sponsor text: "what the next generation of builders creates when the whole web is one API call away." | None. | Same question as Exa. |

INFERRED for Exa and Context.dev: both read like "best use of our API" prizes that can be stacked on another challenge.

---

## Cross-track tech bounties

| Partner | What is on offer | Status |
|---|---|---|
| Verda | Credits for all teams; bounty €10,000 / €2,500 / €2,500 in credits | CONFIRMED, see section 7 |
| NVIDIA | "a tech challenge for the best use of Nemotron", open model weights, mentoring. Endpoint hosted by Verda. | CONFIRMED, https://www.linkedin.com/feed/update/urn:li:activity:7524456308872392705/ |
| Modal | "a tech challenge for the best use of its platform". Workshop Sat 13:30. | CONFIRMED, https://www.linkedin.com/feed/update/urn:li:activity:7522267032956932096/ |
| Cloudinary | "Best Use of Cloudinary tech challenge" | CONFIRMED, https://www.linkedin.com/feed/update/urn:li:activity:7524064590901428224/ |
| Aiven | "a tech challenge for the best use of its platform" (managed PostgreSQL, Kafka, OpenSearch) | SECONDHAND |
| Atech | "Atech Real World Challenge": hardware kits, platform access, mentoring, "prizes for the top teams". "No soldering, no breadboards, no embedded experience needed." | SECONDHAND. Docs at https://atech.dev/docs |
| Wendy | Open-source tool to deploy apps to Jetson, Raspberry Pi, ESP32, Arduino; simulator available | SECONDHAND |
| OpenAI Codex, Featherless, Oxylabs, Qualia, CRACI, Scailab, IronShard | Tech partners. Credits likely; prizes not stated. | Partner status CONFIRMED on the site |
| Google DeepMind | Keynote, workshop Fri 20:00, a juror. "Something special is planned for the winning teams." | CONFIRMED, site. Not a challenge. |
| MLH side prizes | ElevenLabs, Gemini API, Solana, MongoDB Atlas and others, small hardware prizes | SECONDHAND-UNVERIFIED (a participant's copy of an MLH email, `github.com/cufelix/hackjunction`) |

Prize amounts for everything except Verda are unpublished.

---

## Ranked shortlist

Assumptions: a small team, software only, laptops, no special skill in hardware. The ranking weighs two things: the chance of winning the partner's own prize, and whether the same project can survive face-to-face peer review and then a jury that asks for a real problem, a robust agent and a path to production.

### 1. MariaDB Foundation: Wikipedia Through Time

- **Challenge odds: best of the field.** It is the least crowded software challenge I can see, because it demands a specific database and some data plumbing. Everything needed is public now, with no key and no queue at a booth. The partner has published what they consider unfinished and where their own demo fails, so you know what a win looks like to them before talking to anyone.
- **Main-prize odds: moderate, and improvable.** The demo is the strongest table demo among the software challenges: a slider that shows what Wikipedia said on a given day needs no explanation. The weakness is the "problem worth solving" test. Fix it in the framing: AI answers cite sources that keep changing, and nobody can see what a source said when the answer was written.
- **Risks:** Finnish-only history data in front of an international crowd (translate on the fly, or pull a few English articles by API). The brief itself is SECONDHAND; confirm it.

### 2. Stoa: verifiable answers about construction drawings

- **Challenge odds: good for a strong team, poor for a weak one.** The difficulty keeps the field small, and the partner's two criteria are stated in the teaser: accurate, and checkable at a glance. A team that builds a real index of the sheets will stand out from teams that pass PDFs to a vision model.
- **Main-prize odds: highest ceiling of the software challenges.** It is a hard problem in a huge industry with an obvious buyer, which matches what several jurors say they want: a problem worth solving, the hardest challenges, a path to production. HINT: the 2024 and 2025 main winners were both technically deep projects.
- **Risks:** no dataset or brief seen yet. If the data is thin or the scoring is subjective, drop it. If someone on the team has document-vision experience, move this to first place.

### 3. Valio Aimo: Trusted Trade Agents

- **Challenge odds: fair.** More teams than the first two, but mock APIs and synthetic data mean you spend the weekend on the idea, and a second-year partner tends to run an orderly judging process. Making "trusted" concrete (a mandate, an attack panel, an audit receipt) separates you from the many plain ordering agents.
- **Main-prize odds: fair to good.** An agent that spends money safely is a general problem, not a wholesale problem, and it lines up with the AfterQuery juror's wish for agents that hold up under attack and the Verda juror's wish for a path to production.
- **Risks:** the brief is SECONDHAND. A kitchen ordering demo is less immediately gripping than the two above; stage it with a live attack.

### Why not the others

- **S-Pankki** is the most relatable and the data is already in hand, but it will be the most crowded challenge. Choose it only if the platform brief confirms a mortgage angle, since the two-dataset idea is the one way to stand apart. It is the fallback if Stoa and Valio Aimo disappoint.
- **Cala** has two target users on the jury, but it is crowded and its judging criteria arrive Saturday at 11:00.
- **AfterQuery** has the best jury alignment and a small field, but there is no brief, and the work is hard to show to non-experts.
- **Hardware challenges** have the best demos and the smallest fields, but depend on shared kit and skills the stated setup does not include.

### Whatever you choose

- Run inference on Verda and record what you ran. That enters the Verda bounty at no cost. If a vision or reasoning model fits, use the Nemotron endpoint and enter NVIDIA's as well.
- Redeem the Verda coupon tonight; the workshop is at 20:30.

## What I could not verify

1. **Every brief on the platform.** The challenge list is behind the participant login. Nothing here is the official brief text except the quoted teasers.
2. **Prizes** for every challenge except Verda's bounty. The site says the breakdown is "coming soon".
3. **Partner judging criteria**, apart from Verda's one line. Cala's come Saturday 11:00.
4. **Track assignment** of each challenge, apart from Arduino (Hardware) and Verda (AI Infrastructure).
5. **Eight LinkedIn posts** I could only read secondhand: Valio Aimo, MariaDB, Cala, Exa and Rokoko among challenge partners, and Aiven, Atech and Wendy among tech partners. LinkedIn blocked the company page, and I had no post IDs for these.
6. **Whether the S-Pankki mortgage files are part of the brief** or optional extra data.
7. **Whether the Tieto GitHub lead is really Tieto's challenge material.** The account is not labelled.
8. **Whether MariaDB's three Wikipedia repos are the official starter kit.** They fit in every respect but do not say so.
9. **Hardware lending rules** and device counts for Arduino, Intel, Rokoko and Meta.
10. **Credit amounts** from any tech partner, and whether Cala issues hackathon keys beyond its 100-query free tier.
11. **The participant rules quoted from other teams' notes** (2-minute video, whole team at peer review, 3 + 3 minute pitch). Check the participant guide.
12. Junction's Discord, Instagram and X were not readable. Announcements made only there are missing.

## Sources

Official and partner-owned:

- https://2026.hackjunction.com/ (tracks, partners, schedule, workshops, judging, judges, FAQ)
- https://hackjunction.app/hackathons/junction-2026 (schedule, sponsor texts, page data)
- https://github.com/hackjunction/Junction-2026-S-pankki
- https://github.com/MariaDB/mariadb-wikipedia-datasets
- https://github.com/MariaDB/mariadb-system-versioning-wikipedia
- https://github.com/MariaDB/mariadb-vector-wikipedia-rag
- https://github.com/robertsilen/junction2026
- https://verda.com/blog/junction-2026 and https://docs.verda.com/resources/obtaining-free-credits/how-to-redeem-credits/
- https://cala.ai and https://docs.cala.ai
- https://stoabuild.com/
- https://www.afterquery.com/
- https://www.bahnexpress.fi
- https://www.valioaimo.fi/valio-aimo-in-english and https://www.valioaimo.fi/artikkelit/junction-hackaton-2025/
- https://atech.dev
- https://www.espoo.fi/en/events/espooevents:agp767vqb4
- Junction LinkedIn posts, read directly: activity IDs 7526652524074938368 (Aalto), 7525875222328299520 (Ignite Next x Intel), 7526207603845238786 (AstraZeneca), 7526026106781642752 and 7525875075997372416 (S-Pankki), 7525514271112241152 (Bahn Express), 7525483509143232512 (Stoa), 7525211151287406593 (Oxylabs), 7524456308872392705 (NVIDIA), 7524077008612487168 (Verda), 7524064590901428224 (Cloudinary), 7523719475117064192 (AfterQuery), 7523343578853437440 (Meta), 7522976095198101504 (Hostinger), 7522267032956932096 (Modal), 7522266722456723456 (Featherless). URL pattern: `https://www.linkedin.com/feed/update/urn:li:activity:<ID>/`

Third-party, used as leads and labelled where used:

- https://github.com/Lemonterminator/Junction-2026 (scrape of Junction's LinkedIn posts)
- https://github.com/te-industry-tech-office/junction26-messagepack-csharp (possible Tieto material)
- https://github.com/ApsiApina71/junction-2026, https://github.com/cufelix/hackjunction, https://github.com/DKeAlvaro/junction-2026 (participants' notes)
- https://github.com/tommy2006/bahndesk (Bahn Express challenge at a different event)
- https://en.wikipedia.org/wiki/Junction_(hackathon) (past winners)
