# Exa demos, past Exa-prize winners, Exa's taste, and the Junction 2026 judges

Research date: 13 Nov 2026. About 20 web calls. Labels: **confirmed** means a fetched page or a search result shows it (URL given). **Snippet** means the claim comes only from a search-result summary; the page itself was not fetched (x.com returned 402, LinkedIn needs a login). **Inferred** means it is my reasoning.

## 1. Exa's own demos and open-source example apps (what not to rebuild)

### Takeaway
demos.exa.ai lists 21 demos in six groups: Assist, Build & Evaluate, Discover, Enrich, Monitor and Research. Most are B2B (GTM, enrichment, candidate sourcing, adverse media, market monitoring). The consumer demos closest to "Internet Butler" are **Exa Places**, which already covers "date-night restaurant near me" and "parks for a picnic with kids" from a map, plus **Voice Search**, **Shopping Search** and **Web Chatbot**. A generic chat UI, a place finder, a shopping finder or a morning brief would look derivative.

### Cited Findings
- The demos.exa.ai index lists these 21 demos (confirmed, [demos.exa.ai](https://demos.exa.ai)). Paths are relative to demos.exa.ai. The index gives no descriptions or repo links.
  - Assist: Exa vs Native Search (`/exa-vs-native-search`), Token Savings (`/tokencalculator`), Web Chatbot (`/chatbot-demo`), Voice Search (`/voice`)
  - Build & Evaluate: Search Terminal (`/exa-terminal`), Grounding Comparison (`/gemini-exa-grounding`), Content Retrieval (`/content-retrieval`), Agent Ultra Replay (`/agent-ultra-replay`)
  - Discover: Shopping Search (`/shopping-demo`), Image Search (`/image-search-demo`), Exa Places (`/places-demo`), Candidate Sourcing (`/candidate-sourcing`), Network Planning (`/network-intel`)
  - Enrich: People Enrichment (`/people-enrichment`), Company Enrichment (`/enrichment-demo`), GTM Intelligence (`/gtm-intelligence`), Adverse Media (`/adverse-media-screen`)
  - Monitor: Market Monitor (`/market-monitor`), Morning Briefs (`/morning-briefs`)
  - Research: Paper Search (`/paper-search`), Research Map (`/research-map-demo`)
- **Exa Places demo** (confirmed, [demos.exa.ai/places-demo](https://demos.exa.ai/places-demo))
  - You drag a car on a map (San Francisco, Detroit, Tokyo or your own location), then ask by voice or text.
  - Place queries return hours, ratings and phone numbers from one `/search` call, with `type: "lite"`, `numResults: 10`, highlights capped at 300 characters, and `userLocation` set to country, latitude and longitude.
  - Built-in example queries: "Cozy restaurants near me for a date night", "Quiet cafes near me to read a book", "Parks near me for a picnic with kids", "EV chargers near me", "Who won the Lakers game last night".
  - The page has no GitHub link.
- **Morning Briefs demo** (confirmed, [demos.exa.ai/morning-briefs](https://demos.exa.ai/morning-briefs))
  - A synthetic "executive intelligence" briefing. Stories are pulled from the index, filtered for relevance and freshness, and deduplicated.
  - Items are grouped into company signals, competitor news, and housing and industry news.
  - It is B2B, not personal.
- The other 19 demos' functions are inferred from their names only; the pages were not opened. Agent Ultra Replay probably replays an Exa Agent Ultra deep-research run. Candidate Sourcing and People Enrichment probably use people search. Market Monitor probably uses Monitors.
- **exa-labs GitHub** (confirmed, [github.com/orgs/exa-labs/repositories](https://github.com/orgs/exa-labs/repositories?type=source&sort=stargazers)). 107 repos; the top 60 by stars were read. The example apps are:
  - company-researcher (1.5k stars, "Tool for quickly understanding any company")
  - exa-deepseek-chat (730)
  - exa-hallucination-detector (335, checks LLM output against sources)
  - exa-o3mini-chat and gpt-oss-exa-chat (chat apps)
  - jfk-files-app (chat with the JFK files, archived)
  - exa-writing-assist (writing and citation assistant)
  - websets-news-monitor (watches the web for articles on a topic)
  - answer-chat-app (Answer endpoint)
  - research-paper-app
  - roast-my-website
  - substack-exa-search
  - opus-v-oai (live analysis of engineers' reactions to two model launches)
  - Page 2 adds startup-idea-validator, company-enrichment-demo, demo-moltbook-search, and an `openclaw` "Personal AI assistant" fork. Source: the [page-2 listing](https://github.com/orgs/exa-labs/repositories?type=source&sort=stargazers&page=2).
  - Infrastructure repos: exa-mcp-server (5.2k), websets-mcp-server, agent-skills, and integrations for Vercel AI SDK, Sheets, n8n, Convex, DSPy, Haystack, Cursor, Zed and Grok.

### Inferences
- The recurring patterns are (a) chat with LLM X plus Exa, (b) company or person research and enrichment, (c) watch a topic over time, (d) a niche corpus (JFK files, Substack, papers, podcasts), and (e) fact-checking or citations. Any project that boils down to one of these will look like a re-skin to Exa staff.
- None of the official demos is a personal "butler" that finishes a household or bureaucratic task end to end, for example a rent-law check, a benefits finder, or a travel-disruption claim. That space looks open.
- Exa Places already covers "find a restaurant for an occasion". An anniversary-vegan-restaurant demo needs more than search: checking it is open, cross-checking reviews against menus, planning the evening, and drafting the booking message.

### Gaps
- One-line descriptions and repos for 19 of the 21 demos; the individual pages were not fetched. A demo page may need a sign-in (the index carries a sign-in callback).
- I did not reach the docs cookbook (docs.exa.ai examples), the Websets example gallery, or customer stories.

## 2. Past hackathon projects that won an Exa prize

### Takeaway
Public winner write-ups are scarce. The confirmed ones are personal-utility apps that pull live, specific facts: a cover letter tailored to a company, a learning roadmap from curated resources, a wearable that researches the person you are talking to, and a restaurant recommender. No found winner is a generic research chatbot. Exa typically gives $500 to $1,000 in credits or cash, or a top-3 award.

### Cited Findings
- **PennApps (Sept 2023, Exa's own blog)**: more than 20 apps were built with LLMs and Exa in 48 hours ([exa.ai blog](https://exa.ai/blog/best-pennapps-projects-with-exa-search)). The post gives no judging reasons beyond projects "showcasing the power LLMs have when connected to the Internet".
  - 1st, **Hire-Me-Pls**: LinkedIn profile plus target company produces a tailored cover letter, with Exa finding facts about the company.
  - 2nd, **SkillTree**: a personalised roadmap for learning a skill, with Exa curating resources.
  - 3rd, **SourceScanner**: adds definitions and Exa-found links to hard texts.
- **SuperAI NEXT 2026 (Singapore, Marina Bay Sands)**: the prize was $1,000 in Exa credits for the top 3 teams ([hackathonradar listing, snippet](https://www.hackathonradar.com/database/hackathon/superai-next-hackathon-2026)). Two teams claim the award:
  - **Relevnt**, by Kuan Yu's team, won "Best Use Case of Exa AI": "one wearable second brain for real conversations". It clips conversations and uses Exa people search and content retrieval to research the person you are about to meet. Source: [X post, snippet; the page returned 402](https://x.com/kuanyu/status/2065484534603489475).
  - **TableFor** won the "Best Use of Exa Award". It used Exa for "relevant, up-to-date information" and "context-aware recommendations", which reads like a restaurant or table recommender. Source: [LinkedIn, snippet](https://sg.linkedin.com/in/juninho-yeu).
- **Zero Human Company Hackathon (Terac x Whop, NYC, 24 Oct 2026)**: **Orit** won "best use of exa", $1,000. It simulates how a product would perform in the market, for ecommerce and local companies. This is self-reported on [anayshekhar.com](https://www.anayshekhar.com/) (snippet). **LaunchRoast**, which roasts landing pages, entered the same track and is not a confirmed winner ([GitHub](https://github.com/mdbabumiamssm/launchroast)).
- Other "Best use of Exa" prizes without found winners (confirmed prize pages):
  - WeaveHacks / W&B: $750 plus a month of Websets on [Devpost](https://weavehacks-1.devpost.com/); [Luma](https://luma.com/weavehacks1) says a Meta Quest 3s plus $1k of credits instead, so the two pages conflict.
  - Vertical Specific AI Agents Hackathon: $500 in credits ([Devpost](https://vertical-specific-ai-agents.devpost.com/)).
  - LotusHacks x HackHarvard Vietnam 2026: $500 in credits ([Devpost](https://lotushacks2026.devpost.com/)).
- Exa and Anthropic co-hosted an "AI Nobel Prize Hackathon" (May 2025) to "discover something new about the world", with prizes for the top 5 ([Exa on X](https://x.com/ExaAILabs/status/1920962757182067190)). I did not find the winners.
- "Exa Hacks 2025" on Commudle is run by Exa Protocol, an unrelated company. Ignore it ([Commudle](https://www.commudle.com/communities/exa-protocol/hackathons/exa-hacks-2025/prizes)).

### Inferences
- What the winners share: a named user with a concrete moment of need (a job applicant, a learner, someone walking into a meeting, a diner), live facts no model could know, and an output you can act on (a letter, a roadmap, a briefing, a booking), not a chat transcript. Relevnt also brings hardware or ambient input plus people search, which is novel input combined with a new Exa feature.
- I found no evidence of losing projects. Generic research or chat apps are probably the bulk losers (inferred): Exa's own repos already contain several of them, so a judge has seen them.

### Gaps
- No Devpost winner pages were found for TreeHacks, HackMIT, Cal Hacks, Hack the North, HackGT, LA Hacks, AI Engineer, YC or MLH events with an Exa prize. Either Exa did not sponsor them, or the winners are not indexed.
- No stated judging rationale beyond the PennApps line.
- No earlier Junction edition with an Exa challenge was found.

## 3. What Exa's team likes, and which new features they would like to see used

### Takeaway
Exa's story is "perfect search for AIs": search that understands complex meaning-heavy queries, returns structured and current data, and lets agents act. Its 2026 launches add new data types (Places, Podcasts, past snapshots of the web) and agentic endpoints (Deep, Deep Max, Agent, Agent Ultra, Monitors v2). The newest launches are the least likely to have been used by other teams: Monitors v2 and Podcasts (29 Oct), Exa 3.0 and Lite (19 Oct), Places (5 Oct), Agent Ultra (25 Sep) and Snapshot (17 Sep). Firefox (Aug) and the EU launch (13 Nov, today) are distribution and region news, not features.

### Cited Findings
- Will Bryk's "A Perfect Search Engine" (7 Jan 2025) ([exa.ai/blog/perfect-search](https://exa.ai/blog/perfect-search)):
  - He wants a search engine "that can actually understand you like an LLM does".
  - He calls search "a database of humanity's collective knowledge".
  - His example queries: "shirts without stripes" and "find the substack articles about climate change with the most comments".
  - The post does not cover citations.
- 2026 timeline from the [Exa blog index](https://exa.ai/blog), all confirmed:
  - Exa Instant: 12 Feb
  - Exa Deep relaunch: 4 Mar
  - Deep Max: 20 Apr
  - Highlights: 22 Apr
  - Google partnership: 28 Apr
  - $250M Series C: 20 May
  - Exa Agent: 16 Jun
  - Bryk talk "Perfect Search for a World of Agents" at SuperAI: 17 Jun
  - Academic search: 23 Jul
  - Firefox: 17 Aug
  - Dynamic Highlights: 28 Aug
  - Snapshot: 17 Sep
  - Agent Ultra: 25 Sep
  - Places: 5 Oct
  - ATLAS agent benchmark: 8 Oct
  - $100M annualised revenue: 13 Oct
  - Exa 3.0 plus Lite, and #1 on the Artificial Analysis Search Index: 19 Oct
  - Monitors v2 and Podcasts: 29 Oct
  - "Exa Search, now in the EU": 13 Nov
  - 2025 also had People Search benchmarks (17 Dec 2025) and Company Search benchmarks (22 Jan 2026).
- **Exa Snapshot** is a research preview: "Given a date, Exa returns results from the web as it was at that point in time." It covers more than 400B archived pages over about 20 years, through `snapshotAsOf` on `/search` and `/contents`. The stated uses are RL leak prevention and finance backtesting, both non-consumer ([exa.ai/blog/exa-snapshot](https://exa.ai/blog/exa-snapshot)).
- **Monitors v2** runs scheduled searches in three stages: Retrieve, then Judge (dedup, relevance, legitimacy, novelty), then Compose (a summary or outputSchema JSON with sources and per-field confidence). It pushes results to a webhook at $2 per 1k runs, down from $15. Example uses: price drops and restocks, "cheap flights", following a news story, executive job changes, and adverse media ([exa.ai/blog/monitors-v2](https://exa.ai/blog/monitors-v2)).
- **Exa Podcasts** searches 3.2M episodes with full transcripts ([exa.ai/blog/podcast-search](https://exa.ai/blog/podcast-search)).
- The index now holds 211M businesses, 1.27B product listings and 130B+ pages ([Monitors v2 post](https://exa.ai/blog/monitors-v2)).
- **Exa Places** (5 Oct 2026) covers 211M places with structured fields: hours, operating status, phone, website and ratings. It works on every endpoint at no extra cost, and the post says a personal assistant "can check if a place is open before recommending". It also says: "The structured fields are efficient for giving agents information they can work with directly." The benchmark F1 is Exa 0.800, Perplexity 0.529, Parallel 0.333 ([exa.ai/blog/exa-places](https://exa.ai/blog/exa-places)).

### Inferences
- **Fresh to Exa judges** (inferred):
  - A consumer use of Snapshot, for example proving a landlord's listing, price or terms changed ("what did this page say on the date I signed?"), or a rule that was in force at a past date. Snapshot's launch post only mentions RL and finance, so a personal-rights use would be new to them.
  - Monitors v2 as a butler that keeps watching after the demo: benefit deadlines, a rebooking window, a rent-regulation change. The webhook "it messages you later" pattern shows the agent working.
  - Places plus web search combined in one task, for example a vegan restaurant that is open on the date, with menu evidence from its website.
  - Podcasts as an unusual evidence source.
  - Per-field sources and confidence (Monitors' Compose stage) fit the "clearly show sources" judging criterion directly.
  - A European or Finnish setting (Kela benefits, Finnish rental law, VR or Finnair disruption) fits today's EU launch and Exa's interest in non-US coverage.
- **Derivative**:
  - Chat-plus-Exa UIs, company or person research, morning briefs and market monitors.
  - A "near me" place finder on its own (Exa Places already does this).
  - A plain deep-research report generator (Agent and Agent Ultra already do this).
- Because Exa now benchmarks agents on "search-intensive tasks" (ATLAS), judges will probably value multi-hop, verifiable answers over one-shot summaries (inferred).

### Gaps
- I found no direct quotes from Jeff Wang, engineers or DevRel on what is creative versus boring, or on citations. The a16z and SuperAI 2026 talks are YouTube links and were not transcribed.
- The EU launch post URL was guessed and returned 404; its content is unknown.

## 4. Exa at Junction 2026: the people, the workshop and the announcement

### Takeaway
I found no public post naming the Exa staff attending, judging or running the workshop at Junction 2026.

### Cited Findings
- Searches for "Exa" with Junction, Espoo and "Internet Butler" returned nothing relevant ([search](https://hackernoon.com/12-hackathons-worth-your-fall-and-winter) returned only general Junction coverage). Junction runs 13 to 15 Nov 2026 in Espoo with about 2,000 builders ([City of Espoo event page](https://www.espoo.fi/en/events/espooevents:agp767vqb4)).
- 2026.hackjunction.com/challenges returned 404 for WebFetch.
- The repo's own `research/05-official-briefs.md` records the challenge: Exa, "The Internet Butler", $2,500 + $5,000 credits / $1,500 / $500, judged on use of Exa, usefulness to a specific group, shown sources, originality and a live demo.
- The repo's own `research/02-challenges.md` records the Exa workshop on Sat 16:30 to 17:00 in the Loft.

### Inferences
- The judges will probably be the "Exa engineers on site" named in the brief, not executives (inferred). Ask at the workshop who is judging and which features they built; pitching their own feature back to them is a known hackathon tactic.
- The EU launch on the event's first day suggests Exa may want demos of EU or Finnish queries (inferred).

### Gaps
- Names of the Exa attendees and judges, the workshop agenda, and the LinkedIn/X wording of the challenge announcement; LinkedIn and X need a login or returned 402.
- Whether Exa ran an "Internet Butler"-style brief at any other 2026 hackathon. Only generic "Best use of Exa" bounties were found.
