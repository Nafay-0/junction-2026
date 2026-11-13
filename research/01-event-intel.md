# Junction 2026: Event Intel (verified facts)

Compiled 2026-11-13. Every fact carries a provenance tag:

- **[C26]** = CONFIRMED FOR 2026, with source URL
- **[P-YYYY]** = INFERRED FROM PAST EDITIONS (year given, with URL). These are not guaranteed to apply in 2026.

## Primary sources used

| Key | Source | Notes |
|---|---|---|
| SITE | https://2026.hackjunction.com/ | Official 2026 event site. Single page (sitemap lastmod 2026-11-12). Sections: Schedule, Workshops, This Year, Partners, Judges, Investors, FAQ. |
| PLAT | https://hackjunction.app/hackathons/junction-2026 | Official Junction Platform event page (public view). I pulled the event config embedded in the page source (fields such as `physicalPeerReview`, `maxTeamSize`). The challenge list is **empty in the public view** (`"challenges":[]`), and the participant dashboard needs a login. |
| TERMS | https://www.hackjunction.com/terms-of-service | Junction Oy Terms & Conditions, which include "General Event Rules" (section 8). The page is JS-rendered; I read the text from the site bundle. |
| NB24 | https://junctionhq.notion.site/Participant-Guidebook-Junction-2024-10559a11813780389e0fc382f7ec6ea8 | Junction's public Notion guidebook for **2024**. Subpages: Reviewing, Project Submission, Pitching, Junction Rules, Schedule, Summary, Communication Channels, Hackerpack. |
| PLAT25 | https://hackjunction.app/hackathons/junction-2025 | 2025 platform event page, used for comparison. |

**No 2026 Notion participant guidebook or 2026 submission guide was found.** The Notion pages that turn up (including "Project Submission" at https://junctionhq.notion.site/Project-Submission-fff59a11813781a38121ccc1a3fb14d4) belong to the 2024 guidebook. That submission page even says "Sunday the 12th", which looks like text carried over from 2023. If a 2026 guide exists, it is probably linked from the Discord or the logged-in platform dashboard.

---

## 1. Dates, venue, schedule

### Core facts
- **Dates:** Fri 13 to Sun 15 November 2026 **[C26, SITE, PLAT]**
- **Time zone:** Europe/Helsinki, UTC+02:00 (EET) **[C26, PLAT: "Timezone: Europe/Helsinki (+02:00)"]**
- **Venue:** Hype Areena, Kivenlahti, Espoo. The FAQ stresses "Espoo, not Helsinki". It is at the western end of the metro line, about 30 min from Helsinki Central. **[C26, SITE FAQ]**
- **Address:** Vanha Jorvaksentie, 02320 Espoo **[C26, PLAT]**. The house number "3" appears only in the City of Espoo listing seen in search results: https://www.espoo.fi/en/events/espooevents:agp767vqb4
- **Scale:** 2,000 builders, 48h, 100+ countries **[C26, SITE]**. The platform reports `participantCount: 3555` registrations **[C26, PLAT]**.
- **Junction Week:** pre-events start Mon 9 Nov **[C26, SITE]**
- **Venue hours:** open around the clock for the full 48h. There are **no dedicated sleeping areas**; the site points people to discounted partner hotels. **[C26, SITE FAQ]**
- **Floors named on the schedule:** registration on the 2nd floor; meals on the 2nd and 3rd floors; workshops in the Loft (4th floor); Hardware Lab on the 5th floor; Main Stage. **[C26, SITE]**

### Hour by hour (SITE says "Preliminary schedule. Times may still shift")

**Friday 13 Nov** [C26, SITE]
| Time | Item |
|---|---|
| 16:00 | Doors open. Registration on the 2nd floor |
| 18:00 | Opening Ceremony: opening words, practicalities, Google DeepMind keynote, challenge videos |
| 19:30 | **Hacking starts** (platform `startTime` = 17:30Z = 19:30 local) |
| 19:30 | Dinner (2nd and 3rd floors) |
| 20:00–20:30 | Google DeepMind workshop (Loft, 4th floor) |
| 20:30–21:00 | Verda workshop (Loft) |
| 20:30–21:00 | Arduino workshop "Getting started with the UNO Q" (Hardware Lab, 5th floor) |
| 21:00–21:30 | MLH x GitHub session (location TBA) |
| **23:59** | **Preliminary submission** (the PLAT schedule says **23:55**, so aim for 23:50) |

**Saturday 14 Nov** [C26, SITE]
| Time | Item |
|---|---|
| 11:00–11:30 | Cala workshop: "Make Unicorns Real" challenge briefing, including "what our judges are looking for" (Loft) |
| **12:00** | **Submissions open on the Junction Platform** (PLAT `submissionsStartTime` 10:00Z = 12:00) |
| 12:00–12:30 | Intel x Ignite Next: "Shaping the Future of Physical AI" (Hardware Lab, 5th floor) |
| 13:00 | Lunch |
| 13:00 | Hostinger keynote: "Vibe coding solved building. Now comes the hard part." (Main Stage) |
| 13:30–14:00 | Modal workshop (Loft) |
| 14:30–15:15 | Kiuas workshop (Loft) |
| 16:30–17:00 | Exa workshop (Loft) |
| 18:00–18:30 | Maria 01 workshop: how to start a venture-backable startup in Finland (Loft) |
| 18:00 | Dinner |

**Sunday 15 Nov** [C26, SITE unless noted]
| Time | Item |
|---|---|
| **10:00** | **Final submissions deadline** (PLAT `submissionsEndTime` 08:00Z = 10:00) |
| 10:30 | **Review time**, i.e. face-to-face peer review. PLAT lists a "Review time" entry at 14:00 local, which probably marks the end of the window. Ask on site. |
| 14:00 | **Final Ceremony**: Arduino and Verda keynotes, **top 5 pitches**, **challenge winners at 15:10**, **Junction winner at 15:50** |
| 17:00 | Event ends |
| 18:00 | Doors close |

The SITE has no separate demo-expo slot. The face-to-face peer review (10:30 to about 14:00) works as the expo.

---

## 2. Rules

| Topic | Finding | Provenance |
|---|---|---|
| Team size | **1–4** people. You can apply solo and form a team on site before hacking starts. | [C26, SITE FAQ, PLAT "Team size: 1-4", PLAT config `maxTeamSize: 4`]. In 2024 it was 1–5 [P-2024, NB24 Rules] and 2025 allowed 5 [P-2025, PLAT25]. |
| Pre-existing work | "Projects must be built primarily during the Event. Use of pre-existing code, datasets, or frameworks is permitted only if clearly identified in your Submission in the fields provided on the submission platform. Cheating, plagiarism, or misrepresentation is prohibited and may result in disqualification." | [C26-applicable general rules, TERMS §8.2]. The Terms apply to all Junction events unless event-specific rules override them (§5.2). The 2024 rules were stricter: "No code written before the event… If you use any code written specifically for this idea in advance, or work on a new project that is somehow related to an already existing company, you will be disqualified." [P-2024, NB24 Junction Rules] |
| Open source / IP | "Teams keep ownership of what they build. **Submissions are open-sourced under the MIT licence**, which means partners and the wider community are free to use and build on them, with your team credited as the authors." | [C26, SITE FAQ, stated twice in the participant and partner FAQ]. TERMS §7.1: work stays yours (or your employer's). §7.3: some challenges may set alternative IP terms in a separate agreement. §9.2: some challenges may require an NDA. |
| Source code access | 2024: "You must submit a link to your source… organizers must be able to access your source code." | [P-2024, NB24 Rules]. Given the MIT statement for 2026, expect a public repo. |
| Multiple challenges | The PLAT config has **`allowMultipleSubmissions: true`** for 2026 (it was `false` in 2025). TERMS §8.3: "A participant may belong to only one team per challenge." SITE: "Tech challenges run across every track, so any team can take them on alongside their track." | [C26, PLAT config + SITE]. How multi-submission works in the UI (one project tagged to several challenges, or several projects) is **unverified**. |
| Must enter a challenge | 2024: "You must participate in at least one challenge." | [P-2024, NB24 Rules] |
| AI coding tools | **No rule found either way.** OpenAI Codex is listed as a Tech Partner, Anthropic and OpenAI appear as platform sponsors, and the Hostinger keynote is titled "Vibe coding solved building…". This suggests AI tools are welcome, but it is not a written rule. | [C26, SITE partners, PLAT sponsors]. In 2025 some partner challenges explicitly required "fluent use of AI tools" (Harvia) [P-2025, hackjunction.com challenge archive] |
| Testing by judges | Junction, the jury and partners may run your submission, call demo endpoints, and use demo credentials you supply. Credentials must be demo/test only, with no live personal data. Teams must include the materials needed for evaluation (readme, dependencies, demo credentials). | [C26-applicable, TERMS §8.6–8.7] |
| Partner resources | Use APIs, data and hardware only within the communicated limits. No reverse-engineering, probing or circumventing partner systems. | [TERMS §8.4] |
| Disqualifiers | Pre-existing work you did not declare; cheating, plagiarism or misrepresentation; harassment or discrimination (MLH Code of Conduct applies: https://static.mlh.io/docs/mlh-code-of-conduct.pdf, linked from SITE footer); misuse of partner systems; illegal substances; late submissions ("may be rejected or considered at Junction's discretion"). Junction may disqualify "at any time and for any reason". | [TERMS §5.4, §8; SITE footer] |
| Prize decisions | "Winners are selected at Junction's (or its appointed jury's) sole discretion, and decisions are final. You are responsible for all taxes." | [TERMS §5.5] |
| Draft vs final | 2024: "Set your project to FINAL from DRAFT before the final deadline. Draft projects are not reviewed." No late submissions; the form closes automatically. | [P-2024, NB24 Project Submission] |
| Penalty for not reviewing | 2024: each participant should review at least 15 projects; "If your team does not participate in reviewing other projects, we reserve the right to apply a small penalty to your team's score." | [P-2024, NB24 Reviewing] |

---

## 3. Submission requirements

**Confirmed for 2026:**
- Platform: **Junction Platform** (hackjunction.app). "Built and judged on the Junction Platform." **[C26, SITE Judging; PLAT]**
- Timeline: preliminary submission Fri 23:59 (PLAT says 23:55); submissions open Sat 12:00; **final deadline Sun 10:00** **[C26, SITE + PLAT]**
- Pre-existing code, datasets and frameworks must be declared in dedicated fields on the submission form **[TERMS §8.2]**
- The project must be demonstrable in the specified format, with readme, dependencies and demo credentials included **[TERMS §8.6]**
- Submissions are open-sourced under MIT **[C26, SITE FAQ]**

**Not confirmed for 2026. Past-edition requirements [P-2024, NB24 Project Submission + Rules + Pitching]:**
- Up to 5 banner images
- Project name, punchline, description
- Challenge(s)
- Technologies used
- Pitch video. The 2024 guidebook contradicts itself: the Submission page says "3-minute long video pitch… not a second longer than 3 minutes, and we will be very strict", while the Rules page says "pitch video, maximum 2 minutes long". The video had to be on YouTube or Vimeo and publicly viewable. The alternative was a slide deck (pptx or Google Slides) for pitching on stage.
- Demo link and source-code link, plus a source-code publicity setting
- **Table number**, used for in-person review
- Stage pitch: slides **must be the pptx uploaded to the platform**. "You WILL NOT be showing the slides from your computer." Demos and videos have to be embedded in the slides.
- Video tutorial on creating a project: https://link.junction.so/create-project (redirects to Loom)

**Could not verify for 2026:** the exact required fields, video length and whether a video is required at all, deck format, table assignment, and whether a live demo is required at the peer review.

---

## 4. Main prize judging (the important part)

### Confirmed for 2026 [C26, SITE "Judging" + FAQ]
1. **Partner tracks:** "Each Challenge Partner chooses their own track winners against their own criteria."
2. **Top 5 peer review:** "The Main Event winner is decided first through **face-to-face peer review** to select the **top 5** projects."
3. **Live pitch & grand jury:** "The top 5 pitch in front of a live audience, and a **grand jury** chooses the overall winner."

**Grand jury, "Seven main judges"** [C26, SITE]. What each says they look for, quoted from their bios:
| Judge | Role | What they look for |
|---|---|---|
| Kia Kanninen | CEO, Founders House Helsinki (ex-Slush startup team) | "teams that start from a problem worth solving, not just a feature that's easy to build" |
| Daksh Raghuvanshi | RL Lead, AfterQuery | "teams that can explain exactly why an agent fails in their world, and whose reward holds when someone tries to break it" |
| Otto Söderlund | AI Lead, Supercell (Speechly founder, YC, acquired by Roblox) | "teams that start from a real user problem and ship something people want to come back to" |
| Timo Ahopelto | Managing Partner, Lifeline Ventures | (no stated criterion) |
| Umar Noor | Developer Experience / GTM, Google DeepMind | (no stated criterion; focus on "first prototype to real world impact") |
| Hubertus (Beer) van der Drift | CTO, Context.dev (YC S26) | "teams that move fast, stay pragmatic, and have a knack for finding that one unique insight that solves a problem 10x faster or better" |
| Arturs Polis | CTO, Verda | "teams willing to tackle the hardest challenges and build prototypes with a clear path to production and scale" |

**Platform configuration for Junction 2026** [C26, PLAT page source, event updated 2026-11-13 16:40]:
- `physicalPeerReview: true`, `hasGavelVoting: false`, `hasFinalistVoting: false`, `currentPeerReviewRound: null`, `reviewAnyChallenge: false`, `showScore: false`, `showFeedback: false`, `meetingsEnabled: false`, `galleryOpen: false`.
- Interpretation (mine, unverified):
  - This is a change from earlier years. The old online Gavel pairwise system is switched off and replaced by in-person review, possibly in rounds (the field `currentPeerReviewRound` exists).
  - The participant vote for the winner is gone; the jury decides.
  - `reviewAnyChallenge: false` may mean reviewers are assigned projects (perhaps within a challenge or track) rather than picking any project. Unconfirmed.
  - Scores and feedback are not shown to teams.
- For comparison, **Junction 2025** had `hasGavelVoting: true`, `hasFinalistVoting: true`, `physicalPeerReview: false`, `reviewAnyChallenge: true`. The 2025 schedule had peer reviewing from 10:00, Closing Ceremony at 14:00, **Top 5 Pitching at 14:40** and the Award Ceremony at 15:45 local. [P-2025, PLAT25]

### Past mechanics [P-2024, NB24 Reviewing + Pitching]
- Partner and peer review started in parallel right after the submission deadline.
- Peer review used Junction's modified **Gavel**: pairwise "better or worse than the previous one" comparisons, with a minimum of 15 reviews per participant. There was also a face-to-face "bonus": "follow the table numbers to visit and review projects in person."
- The **Top 10** by Gavel ranking pitched at the closing ceremony, **3 minutes each, mics cut at time**, from the uploaded pptx. Then **hackers voted** for the main winner. (2024 had Top 10 plus a hacker vote; 2026 has Top 5 plus a grand jury.)
- Pitching was one handheld mic per team; one person on stage was advised. Teams were collected right after the review period ended, with no time to rehearse.

### Could not verify for 2026
- Who exactly does the face-to-face peer review: all participants, one rep per team, or volunteers? How many projects each person or team reviews, and in what format (scores, rankings, pairwise)?
- How long each team gets in front of a reviewer, whether teams must staff their table, and whether not reviewing is penalised.
- Whether the top 5 come from all projects overall or one per track.
- **Top 5 pitch length**, Q&A with the jury, and slide format. A rough inference from the timing: the ceremony starts at 14:00 with two keynotes, and challenge winners are at 15:10, so 5 pitches fit in roughly 30–50 min.
- The jury's scoring criteria. None are published beyond the bios above.

---

## 5. Partner challenge judging

- **[C26, SITE]** "Each Challenge Partner chooses their own track winners against their own criteria." Partner tier description: "Challenge Partner: Set a challenge, shape a track, and choose your own winners."
- **[C26, SITE]** Tech challenges: "Companies provide credits to their platforms, and some of them award prizes to the best use cases of their technologies. Tech challenges run across every track, so any team can take them on alongside their track."
- **[TERMS §8.7]** Criteria are published per challenge and typically cover (i) relevance to the brief, (ii) novelty and creativity, (iii) technical quality, (iv) user experience, (v) completeness and demo-ability, and (vi) feasibility and impact.
- **[P-2024, NB24]** "Partners select the challenge winners and runner-ups." "Remember to check carefully the judging criteria of the challenge your team is doing, to ensure a great possibility of winning a challenge or the whole event."
- **Do challenge winners feed into the main prize?** **Not stated.** The SITE describes two independent paths: partner judging for challenges, and peer review followed by the jury for the main prize. In 2024 the two ran in parallel. Challenge winners are announced at 15:10, before the main winner at 15:50.

---

## 6. Prizes

- **Total pool: €100,000** "in prizes across the weekend. **Full prize breakdown coming soon.**" **[C26, SITE]**. No breakdown was published as of the 2026-11-12 site update.
- **Google DeepMind:** "Something special is planned for the winning teams. More on that soon." **[C26, SITE]**
- **Verda:** "Verda credits for all teams, solving any challenge" and "€10,000 credits for the winning team of our 'Best use of Verda' bounty". This comes from a Verda staff LinkedIn post (secondary source), https://fi.linkedin.com/in/alexander-rozhkov. A related Junction post reportedly lists the bounty prize as "TBA".
- Past main prize: 2024 had a top-5 pool of €20k (€10k / €5k / €2.5k / €1.5k / €1k) **[P-2024, NB24]**. The 2025 main prize amount was not found; the winner was team WAVELET (https://en.wikipedia.org/wiki/Junction_(hackathon)).
- Typical 2025 challenge prizes were €1–3k for the top team, usually split over the top 3 (e.g. Supercell €3k/2k/1k, Wolt €2k/1.5k/0.5k, Valio Aimo €2k/1.5k/0.5k, Figma €3k) **[P-2025, challenge archive in hackjunction.com bundle]**
- MLH: the event carries the MLH 2026-season trust badge, and there is an "MLH x GitHub session". MLH-specific prizes are **unverified**.

---

## 7. Tracks and partners (headline only)

**Tracks** [C26, SITE "Challenge Tracks"]:
1. **Hardware Track, by Arduino**
2. **Healthcare Track**
3. **AI Infrastructure Track, by Verda**
4. **FinTech Track**
5. **Agentic AI Track**
6. **Data Track**
7. Plus cross-track **Tech challenges** (credits and some prizes)

The PLAT description still says "Challenges span AI, hardware, sustainability, fintech, health, defence, quantum. Tracks are not locked yet." That is older text; the SITE track list is the current one.

**Main Partners** [C26, SITE]: Arduino, Verda. **Google DeepMind** is a featured partner (keynote and workshop).

**Challenge partners** [C26, SITE]: Hostinger, Valio Aimo, S-Pankki, Aalto University, Cala, City of Espoo, Exa, MariaDB, AfterQuery, Bahn Express, AstraZeneca, Stoa, Intel, Context.dev, Rokoko, Ignite Next (with Intel), Meta, Tieto.
- The only challenge named publicly: **Cala, "Make Unicorns Real"**: build a product that solves a real need for founders or VCs, powered by Cala's public data layer (companies, people, investors, funding rounds) [C26, SITE workshops].
- Likely mapping (inference): S-Pankki → FinTech; AstraZeneca → Healthcare; Cala, Exa, Context.dev → Data / Agentic AI; Intel x Ignite Next, Rokoko → Hardware / physical AI.

**Tech partners** [C26, SITE]: OpenAI Codex, NVIDIA, Featherless, Modal, Qualia, CRACI, Atech.dev, Scailab, IronShard, Cloudinary, Wendy, Aiven, Oxylabs. The PLAT sponsor list also includes **Anthropic**, OpenAI and Google DeepMind.

**Other supporters** [C26, SITE]: Lifeline Ventures, FR8, Wave Ventures, Aalto Robotics Club, Thinkin' Rocks, Founders House Helsinki, MLH, Aaltoes, XR Creator Con, 3Dkauppa.com, Fiest.

The full challenge briefs (text, criteria, prizes) are **not public**. The platform's public view has an empty challenge list, so they are presumably visible in the logged-in dashboard or shown in the opening-ceremony challenge videos.

---

## 8. Logistics that affect building

| Item | Finding | Provenance |
|---|---|---|
| Hardware | **Hardware Lab by Arduino** (5th floor), new for 2026: Arduino UNO Q boards, components, 3D printers, LeRobot arms "and much more", mentored by hardware-industry reps and founders. Intel contributes Core Ultra Series 3 processors and the open-source Robotics AI Suite (via Ignite Next). 3Dkauppa.com is a supporter. | [C26, SITE "This year"; PLAT sponsor text] |
| Credits | Tech partners provide platform credits. Verda gives credits to all teams (secondary source). Details of how to claim are **unverified**. | [C26, SITE tech challenges tooltip] |
| Hackerpack | In past years Junction ran a "Hackerpack" of partner tools and credits on the Junction Platform. | [P-2024, NB24 Hackerpack] |
| Workshops | See the schedule above: Google DeepMind, Verda, Arduino, MLH x GitHub, Cala, Intel x Ignite Next, Modal, Kiuas, Exa, Maria 01; Hostinger keynote. "Capacity is limited. Arrive early" / "Sign up early" (no sign-up link published). | [C26, SITE] |
| Mentors | Partner reps and hardware mentors are on site. **No mentor booking system found.** The platform has `meetingsEnabled: false`, so meeting booking through the platform looks switched off. | [C26, SITE; PLAT config] |
| Discord | **Junction Community** server: https://discord.gg/nDgvafhRU4 (SITE, lands in #tech-support) and https://discord.gg/Rv4DyHpwkJ (PLAT, lands in #hello). Both go to the same server (~5,200 members per the Discord invite API). The SITE says: "The fastest answers live in our community." | [C26] |
| Contact | hello@hackjunction.com (platform contact: Head of Communications). In 2024 participant questions went to participants@hackjunction.com [P-2024]. | [C26, SITE/PLAT] |
| Wifi | **No 2026 info.** In 2024 the SSID was "Junction", password "junction2024" (at a different venue, Dipoli). | [P-2024, NB24] |
| Power | **No info found.** | |
| Food | Dinner Fri, lunch and dinner Sat are on the SITE schedule; lots of refreshment sponsors (Valio, Nestlé, NOCCO…). 2024: "free food available during all three days". | [C26, SITE; P-2024] |
| Sleeping | Venue open 24h, no sleeping areas; discounted partner hotels nearby. | [C26, SITE FAQ] |
| Team finding | Find teammates on site before hacking starts. In 2024 there was platform matchmaking, a #teambuilding Discord channel and on-site team building after the opening. | [C26, SITE FAQ; P-2024, NB24 Summary] |
| Investors on the floor | A paid Investor Pass gives investors floor access all 48h and seats at the top 5 pitches. | [C26, SITE] |

---

## Discrepancies between official sources

1. **Preliminary submission time:** SITE says Fri 23:59; PLAT says Fri 23:55. Use 23:55.
2. **"Review time":** SITE has it at Sun 10:30; PLAT has a "Review time" entry at Sun 14:00, which probably marks the end. The Final Ceremony is at 14:00.
3. **Location wording:** PLAT says "Helsinki, Finland" and "Hype Arena… Helsinki region"; SITE insists on Espoo (Hype Areena, Kivenlahti).
4. **Track list:** PLAT still says "tracks are not locked yet" (AI, hardware, sustainability, fintech, health, defence, quantum); SITE lists 6 concrete tracks.
5. **IP:** SITE FAQ says MIT open source; TERMS say ownership stays with teams and allow challenge-specific IP terms. The two can coexist (you own it, but it is MIT-licensed), but check any challenge with special IP or NDA terms.

---

## Could not verify. Ask organisers on site (Discord #hello / info desk)

1. **Face-to-face peer review mechanics:** who reviews (every participant or one per team), how many projects each, the scoring format, rounds, how long each visit lasts, whether the team must stay at its table, and whether not reviewing is penalised.
2. Whether the **top 5 are picked overall or per track**, and whether challenge winners have any edge.
3. **Top 5 final pitch length**, format (live demo or slides from the platform only), jury Q&A, and the jury's scoring criteria.
4. **Exact submission form fields for 2026:** is a demo video required, and what is its max length (2024 sources said both 2 and 3 min)? Deck format? Is a repo link required to be public? Table-number assignment?
5. How **`allowMultipleSubmissions`** works: one project into several challenges, or separate projects?
6. **Prize breakdown** of the €100k: main prize amount, places, challenge prizes, Google DeepMind's "something special", MLH prizes, side awards.
7. **Full 2026 challenge briefs** and per-challenge criteria (public platform view is empty; likely in the logged-in dashboard or the opening videos).
8. Explicit **rule on AI coding tools** (none published) and the exact pre-existing-code policy for this event (general Terms allow declared pre-existing code; the 2024 event rules banned it).
9. **Wifi** credentials, **power** availability, hardware lending process (check-out and deposit rules at the Hardware Lab).
10. **Mentor booking** process (platform meetings appear disabled) and workshop sign-up method.
11. How to claim **partner credits / Hackerpack** for 2026.
12. Whether a **2026 participant guidebook** (Notion) exists. None found publicly.

## Pages behind login / not readable
- Junction Platform participant dashboard (challenges, submission form, peer-review UI): login required (Clerk auth); the public view shows no challenges.
- Junction LinkedIn company page: HTTP 403 to automated fetch. Some individual LinkedIn posts readable only via third-party summaries.
- Discord channel contents: requires joining.
