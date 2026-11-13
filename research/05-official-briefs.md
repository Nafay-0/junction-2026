# Junction 2026: official briefs and rules (from the participant platform)

Read on Fri 13 Nov 2026, about 21:30 EET, from the logged-in Junction Platform (Challenges, Guide, Developer Tools and Assets). This supersedes the teaser-based guesses in `02-challenges.md` wherever they differ.

## Rules that are now confirmed

- **Main prize: €10,000.** Total pool €100,000.
- **Peer review:** Sun 10:30–13:00 (guide also says until 14:00). Each participant reviews the projects **assigned to them**, at the teams' assigned tables. Reviewers can press "not present" if a team is not at its table. A team that does not take part in peer reviewing is **not eligible for the main prize**.
- **Peer criteria:** Innovation (new or different), Impact (significant effect on society and on the people who have the problem), Implementation (realistic, viable, feasible).
- **Top 5** by peer review pitch at the closing ceremony: exactly 3 minutes (mics cut), then 3 minutes of questions, then seven judges vote. You can demo from your own computer on stage; one handheld mic.
- **Final submission, Sun 10:00, set to FINAL (drafts are not reviewed):** name, punchline, description, challenge, technologies, a video pitch of at most 2:00 (public on YouTube or Vimeo, strictly enforced), demo link, source code link, pitch deck (PDF), team phone numbers, Discord username.
- **Fri 23:59:** submit a draft naming the challenge you plan to tackle. It can be changed later. A project may be submitted to multiple challenges.
- Teams of 1–4. Sleeping at the venue is not allowed.

## Credits (Developer Tools and Assets)

Verda €200 (compute and inference API; claim by form, shareable with team). Modal $100 per participant. OpenAI $100 Codex credits per participant. Anthropic $20 API credits per participant. Gemini API credits. Exa $50 per participant. Context.dev 50,000 API credits per team. Featherless $50 API credits. Aiven $50. CRACI €1,000 platform credits per team. IronShard hosts challenge datasets in read-only buckets (S3-compatible and MCP) and takes large artifacts for submission. "Best use of Modal" and "best use of MariaDB" are tech challenges that stack on a main challenge.

## The 19 challenges

| Partner | Challenge | What they ask for | Judging | Prizes |
|---|---|---|---|---|
| Stoa | Make Blueprints Talk | A program that answers natural-language questions about construction drawings and building information models, correctly, showing where in the drawing the answer came from so a human can verify in seconds. Dataset of real drawings in many formats and languages plus example questions. They want approaches next year's frontier models won't make obsolete: hybrids of frontier models, computer vision, 3D, geometry, small fine-tuned models. | Not itemised | €1,000 + work trial / €750 / €250 |
| AfterQuery | Break the Agent | A reinforcement-learning environment where a frontier agent measurably falls short of a stronger reference run the team can reproduce. Harness and model credits provided. Optional: train a smaller model on the environment and show it improves (also the tiebreaker). | Gap 30, meaningful difficulty 30, reward integrity 25, craft 15. 10-minute demo; judges rerun with reference, three agent runs, do-nothing and stop-early baselines, then spend 15 minutes hunting reward exploits. One-command reproduction from the README. | €3,000 + work trial / €1,500 / €500 |
| Valio Aimo | Trusted Trade Agents | The interface and operating model that lets an external purchasing agent work with Valio Aimo's (mocked) webshop, on open, verifiable standards. Core: product, price and availability lookup; inquiry to order on fixed prices; permission and human-approval management. Optional: delivery and sustainability comparison, substitutions, traceability. Explicitly not a chatbot over the webshop. | Not itemised | €4,000 / €2,000 / €1,000 |
| Ignite Next x Intel | Physical AI Challenge | Own station with an SO-101 arm, leader arm and two cameras. Teach it to pick Duplo bricks, inspect them and sort good from defective, fully autonomously, running on an Intel laptop with OpenVINO. | Not itemised | €5,000 / €3,000 / €2,000 |
| Hostinger | Decode the Noise | A tool that detects propaganda, bots or bad actors from text, social content or traffic patterns. Must be live on Hostinger infrastructure with a public URL. Honest detection logic and false-positive handling over front-end polish. | As described | €2,000 / €1,000, plus hosting |
| Tieto | Earned Trust in AI Code | A concept and reference implementation for AI review of AI-written code that lets a named human accept a change without a full read. Sample agent-written branches in `te-industry-tech-office/junction26-messagepack-csharp`. Concept weighs more than implementation. | Concept card, live walkthrough, lessons log | €2,000 / €1,000 / €500 |
| Cala | Make Unicorns Real | One real need of founders or investors solved on Cala's data, usable the day after (Slush follows). | Real need, execution, originality, use of Cala: 25% each | Hackathon travel worth about €5,000 + €1,000 credits / €500 |
| Bahn Express | Spread | Run a simulated car-transport company for a week through an API; score is gross margin with at least 90% on-time. Shared leaderboard. Final run Sun 08:00; top 10 present to a jury. `spread.bahnexpress.com` | Margin to reach top 10, then elegance, clarity, creativity, robustness | €2,000 / €1,000 / €500 |
| Exa | The Internet Butler | A personal agent that takes a tedious real-life task off someone's hands using live web search, demoed on a real case, including queries the judges try. | Use of Exa, usefulness to a specific group, shown sources, originality, live demo | $2,500 + $5,000 credits / $1,500 / $500 |
| Context.dev | The Web Is Your Real-Time Database | A product that turns live web data into decisions, actions or experiences. | Not itemised | €2,000 / €500 / swag |
| MariaDB | Wikipedia Through Time | A missing Wikipedia tool on MariaDB vector search (RAG track), system-versioned tables (SVT track), or both. | Creative use of MariaDB, execution and scalability, usefulness, demo; extra credit for SVT or both | €1,000 + credits / €500 / €250 |
| S-Pankki | Personal Economic Trainer | Chat with your own bank data, with a teaching angle built on three spending baskets (mandatory regular, mandatory irregular, everyday). Mobile-first. No mention of the mortgage files. | Not itemised | Airbnb gift cards €2,000 / €1,000 / €500 |
| AstraZeneca | Equal Care Across Finland | AI system that finds gaps in cancer-care access, locates them in the care pathway, and recommends concrete actions, on public data with sources. Working demo required. | As described | €1,000 / €750 / €250 |
| Aalto University | Beyond the Clinic | A product for at-home maintenance after depression treatment (TMS), ideally closed-loop: sense, respond, learn. | Not itemised | €2,000 + lab visit |
| Aalto University | Aaltonomous Humanoid | A policy that makes a Unitree G1 sort coloured objects into boxes, in Isaac Sim first; top ~5 run on the real robot. Docker submission. | Simulation score, then real-robot score | €2,000 + lab visit |
| Rokoko | Robot Teleoperation Challenge | Use mocap suits and gloves to control robot hands, arms or humanoids, real or simulated. | "Surprise us" | Hardware worth €4,990 / €2,295 / €1,095 |
| Meta | AI Glasses for Everyone, Everyday | An everyday first-person use case on Meta AI glasses, inclusive by design, with prototype and deck. | Creativity, execution, impact, inclusive design | Ray-Ban Meta glasses per member |
| Arduino | The Green European Renaissance | Edge AI on the Arduino UNO Q for local, green solutions. | Not itemised | Hardware |
| City of Espoo | Rethinking Recruitment | How Espoo's recruitment and matchmaking events can connect companies and talent when applications and screening are AI-generated. | Not itemised | €1,500 / €1,000 / €500 |

There is no separate Verda track challenge on the platform; Verda appears as credits plus its "Best use of Verda" bounty (see `02-challenges.md`).
