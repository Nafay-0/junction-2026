# Junction 2026: a winning playbook built from past winners

Research date: 2026-11-13, the first day of Junction 2026. Companion files: `01-event-intel.md` covers schedule, rules and platform config, and `02-challenges.md` covers this year's partner challenges.

**How to read this.** Every factual claim is tagged.
- **[D]** means documented, with a URL.
- **[W]** means the only source is the English Wikipedia table of main-prize winners (https://en.wikipedia.org/wiki/Junction_(hackathon)). Several rows have no citation and at least one is wrong (the 2017 and 2018 rows repeat the same team), so treat [W] as a lead, not a fact.
- **[I]** means my inference.

Where a year could not be verified, I say so.

---

## TL;DR

1. **The 2026 mechanism is different from what most "how to win Junction" advice assumes.** The official site says there are three stages. Partners pick their own track winners. Face-to-face peer review then picks a top 5. The top 5 pitch live, and a seven-person grand jury picks the winner. [D] https://2026.hackjunction.com
   - The platform config for 2026 has `physicalPeerReview: true`, `hasGavelVoting: false` and `hasFinalistVoting: false` (verified in the page source; see `01-event-intel.md`).
   - That means **two different audiences in sequence**. First, tired peers at your table decide whether you reach the stage. Then founders, investors and AI leads decide whether you win.
   - You need a project that lands in 60 seconds at a table **and** holds up to five minutes of expert questions.
2. **What has won.** Recent main-prize winners and finalists share four traits [I, from the evidence below]:
   - a live, visibly working demo of something that looks hard;
   - a hook that anyone understands in one sentence;
   - a playful, physical or emotional element that makes it memorable;
   - real data, real hardware or real users behind it.
   Plain "AI assistant for X" projects show up among challenge winners, not among overall winners.
3. **Repeat winners dominate.**
   - Team Glados (3 people) won in 2017 and 2018 [W, D].
   - Frank Sandqvist won 2024 solo and came 2nd overall in 2025, also solo [D].
   - The 2022 winners had already won Junction Asia [D].
   - Craft (scope control, demo polish, a fun pitch) beats team size.
4. **You do not need to win your partner challenge to win overall.**
   - Frank's 2025 LoreDash was only a track runner-up but finished 2nd overall [D].
   - His 2024 overall winner was very likely entered in a challenge that someone else won [I].
   - Partners reward fit and depth. The main prize rewards wow plus substance.

---

## Part 1. Evidence: what won, year by year

### Summary table

| Year | Main-prize winner | Partner challenge | Team | Verification |
|---|---|---|---|---|
| 2017 (context) | Signvision (team Glados) | Big Data track | 3 | [W]; Junction blog title "A mix of machine learning and cool UX won Junction 2017" (cited on Wikipedia, not opened) |
| 2018 | **Oneiro** (team Glados) | Ensto EV-charger UX challenge, also won it | 3: Teemu Taskula, Andreas Urbanski, Ville Toiviainen | **[D]** GitHub, Ensto newsroom, Telia article |
| 2019 | **TassuPassu** | "Secure the Future" track winner; possibly the Ericsson "Security Awareness for Kids" challenge (2nd there, unconfirmed) | 4 [W] | **[D]** Junction blog "The winners of Junction 2019" (Wayback copy) |
| 2020 (hybrid) | **Saavi – Healthy Finance** | OP: "Real-time Personalized and Intelligent Financial Advisory", 1st place | 5 [W] | **[D]** Junction Medium winners post |
| 2021 (hybrid) | Nice-ify [W] | unknown | 1 [W] | **Unverified.** Only Wikipedia |
| 2022 | **Haru**, a diary app (team Gojingamrae / "Bitter Sweet") | Track unknown; also won the Google Cloud side challenge | 4 Korean developers, qualified via Junction Asia Busan | **[D]** Asia Economy; team's slide deck |
| 2023 | "Driving Change – In the Blink for Safety" [W] | unknown | 4 [W] | **Unverified.** Only Wikipedia; no description found |
| 2024 | **BREAKDANCE** (name [W]) by Frank Sandqvist | Probably KONE x Granlund inventory [I] | **1 (solo)** | **[D]** Junction blog confirms Frank won overall in 2024 (€10,000) and describes the app |
| 2025 | **WAVELET** [W] | Sensofusion "Radio City" | 4 | **Partly [D].** Top-5 finalist confirmed by Junction's YouTube; the win itself rests on Wikipedia, and is consistent with Frank's documented 2nd place |

### 2018: Oneiro (team Glados) [D]

- **What it was.** An app that lets owners of EV chargers rent them to EV drivers who need a charge. The team estimated €500–3,000 a year in income for a host.
  - Source: https://github.com/teamglados/oneiro
- **Tech.** "React Native, OpenCV, Python, Docker, AWS, Terraform, Raspberry Pi + Camera, Ensto's Chago". It used Telia Crowd Insights mobility data, a heatmap, and a demo video on Vimeo.
  - Source: the same README.
- **Prizes.** The repo lists "1st prize (main competition)" and "1st prize Ensto mobility challenge". Ensto's newsroom says the Ensto challenge "resulted the highly desired 20,000€ main prize by winning the whole hackathon".
  - Ensto URL (now 404, quoted from the search index): https://ensto.com/company/newsroom/company-news/junction-2018-hackathon-won-with-enstos-challenge/
- **Data use.** Telia's article says Oneiro used Crowd Insights data to show that chargers are not where people move. A Telia representative said the team "took their cue from platform economy".
  - Source: https://www.telia.fi/business/article/europes-largest-hackathon-at-dipoli-in-espoo
- **Why it won.** Not stated by organisers. My reading [I]:
  - it was **multi-modal**: a mobile app, a Raspberry Pi with a camera on a real partner charger, and real telco data;
  - the business story was clear;
  - the team was experienced and had won the year before.
- **Mechanism that year.** 2018 was the year Junction switched to participant peer review for the main prize.
  - Wikipedia cites the Junction blog post "Forget the judges! Participants to choose the winner at Junction".
  - A participant team (Zweitag) describes app-guided comparative voting after the Sunday deadline, among about 300 projects, choosing between "current team and previous team".
  - Source: https://www.zweitag.de/blog/junction-2018-helsinki-hackathon
- **Notable challenge winner.** MASGA won Vaisala's "Hack the Sauna" with five researchers and students. They condensed sauna sensor data into a single "mood" percentage with emoji, using a fuzzy-similarity algorithm on a Google Cloud Function.
  - Source: https://aalto.fi/en/news/winning-team-hack-the-sauna-experience-to-a-new-level-at-junction
- **Lesson from a team that lost** (Zweitag). They built a live parking-guidance demo with magazine cut-out cars on a paper street and a webcam on a tower of cans, and invited visitors to test edge cases. They "did not win our challenge or track" (source as above).
  - The tactile demo got attention, but the problem was generic smart-city parking [I].

### 2019: TassuPassu [D, details thin]

- **Result.** Junction's own post "The winners of Junction 2019" (17 Dec 2019) names:
  - **TassuPassu** as main prize winner and "Secure the Future" track winner;
  - **Crowds Against Humanity** as 1st runner-up (Intelligent Infrastructure track);
  - **Vault** as 2nd runner-up (Data Economics track).
  - Source: https://web.archive.org/web/20191219094110/https://blog.hackjunction.com/the-winners-of-junction-2019-de539036dc3f
- **Other track winners.** Reality Break (Game Jam), RE MOTION (Healthtech), WasteSwipe (Sustainability), Juno (Digital Retail), ARCity (Future Cities).
- **What TassuPassu was.** Not documented in what I could read.
  - The same post lists a "Tassu Passu" as 2nd runner-up in Ericsson's "Security Awareness for Kids" challenge, so it was probably a children's security-awareness product.
  - The name means "paw passport" in Finnish. [I, unverified]
- **Mechanism.** Track winners were chosen by peers, and then the overall winner. Exact steps unverified.
- **Side note.** Frank Sandqvist won a track in 2019 with a "Tinder-inspired application for Kesko receipts" (source: https://www.hackjunction.com/blog/frank-sandqvist-story).
  - The swipe interaction was memorable even then.

### 2020 Connected (hybrid): Saavi – Healthy Finance [D]

- **Result.** Junction's post names Saavi as main winner. It also won OP's "Real-time Personalized and Intelligent Financial Advisory" challenge.
  - Finalists: FunTime, Watermelon Wonderland VR, Eco Save, Social Meat, Vibe, Wunee, HiveMind, VRTherapy, Pingu.
  - Source: https://medium.com/hack-junction/the-winners-of-junction-2020-connected-2ed7333f429e
- **What it did.** Wikipedia describes a banking app that analyses spending and subscriptions with ML and has an AR interface. [W, unverified]
- **Observation [I].** Three of the ten finalists were VR or AR projects. That fits the pattern that **visual and immersive demos reach the final**.
- **Pingu** was a 2-person VR game. It went from a Helvar challenge win to the top 10, and the team pitched the final from a bus.
  - Source: https://elizavetalebedeva.com/tag/junction/

### 2021 (hybrid): unverified

- Wikipedia lists Nice-ify (solo, Bryce Cronin): a tool that replaces hateful voice-chat language with a "nice-ified" version. I found no primary source.
- A participant confirms the format: she won the Intelligent Lighting challenge and "pitched in the finals among the Top-10 of 200+ projects".
  - Source: https://elizavetalebedeva.com/tag/junction/

### 2022: Haru, by team Gojingamrae ("Bitter Sweet") [D]

- **Result.** Four Korean developers (Kim Junsung, Kim Sunghoon, Jang Donghoon, Park Chansu) won the €10,000 grand prize and the Google Cloud side challenge. They had qualified by winning Junction Asia Busan in August 2022. About 1,300 participants took part.
  - Source: https://view.asiae.co.kr/en/article/2022111311381508794
- **What it was.** A diary app.
  - GPT-3 condenses the day's entry into a short title, then Stable Diffusion 1.5 draws one picture for it. The picture is a "nudge" to keep the habit, framed around mental health.
  - It ran on Google Cloud, with a privacy architecture.
  - **The team launched it during the event: "118 diaries, 60 users in 5 hours".**
  - Source: https://speakerdeck.com/codertimo/haru-diary-app-with-stable-diffusion-junction-2022
- **Mechanism (official 2022 guidebook).**
  - Submission deadline Sunday 10:00.
  - Partner review at the tables 10:00–12:30.
  - Peer review 12:30–14:00. Each team member had to review 15 projects or the team lost prize eligibility.
  - Peer criteria: **"Novelty", "Tech-y-ness" ("real prototypes, not just fancy PowerPoint slides"), "On point", "WOW-factor: Did the project leave you breathless?"**
  - Track winners pitched for 3 minutes, then "everyone else will then vote for the final winner".
  - Source: https://guidebook2022.notion.site/Participant-Guidebook-a98e9f36c4594c1ca757a1e2c120b587 ("Final day" page)
- **Why it won [I].**
  - It used tech that was three months old (Stable Diffusion's public release was August 2022) in a way anyone could feel.
  - It had a personal, emotional frame (mental health).
  - It had real users, counted during the hackathon.
  - The team was experienced. A Junction Asia write-up says they changed topic mid-event (search snippet only: https://medium.com/@junctionasia_2023/we-are-the-winner-of-junction-fd91c3aa475b).

### 2023: unverified

- Wikipedia lists "Driving Change – In the Blink for Safety" (Markus Andersson, David Enberg, Alex Granlund, Johannes Peltola). I found nothing else about it.
- From the title, it was probably blink- or drowsiness-detection for driver safety. [I, unverified]
- The main prize was €20,000 (event listings).
- **Mechanism failure, documented by one participant.** "the Junction platform struggled with heavy traffic". Peers saw crashes and false vote confirmations, and organisers fell back to partners preselecting submissions.
  - The same author's team lost partly because they left the video until the last morning and forgot header images. They were in a field of about 230 submissions, about 40 in their category.
  - Source: https://marincomics.com/junction-2023.html

### 2024: Frank Sandqvist, solo [D]

- **Junction's own blog** (1 Apr 2026, "Grandmaster of Junction") says:
  - "2024 was a big year for Sandqvist in Junction: he was the overall best, winning 10,000€."
  - He built "an AI-driven inventory management app that gamified equipment reporting, all by himself".
  - "His presentation was supported by an engaging AI-generated rap video, which in his opinion may have boosted him to win."
  - Source: https://www.hackjunction.com/blog/frank-sandqvist-story
- **Project name.** BREAKDANCE, per Wikipedia [W].
- **Which challenge [I].** The 2024 challenge list includes "Modernizing a trillion-euro inventory by KONE x Granlund", which fits his description.
  - The 2024 challenge list: https://junctionhq.notion.site/Challenge-Intros-9ec5d50e8ad54edf9c27dc958bd921a9
  - **That challenge was won by someone else**: the Huhta twins. Their app photographs an equipment plate and puts the text into the building's 3D model. 26 teams entered that challenge, out of more than 250 teams overall.
  - Partner quotes on the winners: "The brothers' demo worked best and was developed furthest" (Granlund). "focused on the core problem rather than extraneous issues" (KONE).
  - Source: https://www.granlundgroup.com/news/junction-hackathon/
  - **If my inference is right, the partner chose the deepest and most practical tool, and the crowd and finals chose the most entertaining one.**
- **Mechanism (official 2024 guidebook).**
  - Each participant reviews "at least 15 other projects" in Junction's modified Gavel, with "a small penalty" for teams that don't review.
  - "Overall TOP 10 projects are determined based on the ranking on Gavel algorithm."
  - The top 10 pitch "for 3 minutes each, then hackers vote for the main prize winner". Mics are cut at 3:00.
  - Slides must be the uploaded pptx, with demos embedded. "You WILL NOT be showing the slides from your computer."
  - Teams could choose a video pitch instead of going on stage.
  - Prize pool for the top 5: €10k, €5k, €2.5k, €1.5k, €1k.
  - Source: https://junctionhq.notion.site/Reviewing-fff59a118137812eb17fdf07e797aed7 and https://junctionhq.notion.site/Participant-Guidebook-Junction-2024-10559a11813780389e0fc382f7ec6ea8
- **Frank's own tips** (same blog): "Identify what you're good at". "Make something that makes you truly excited". "Have the final product look clean and realistic in the presentation, present it in an interesting and fun way to catch people's attention!"
- **Frank's process.** He reads the track list on the train and asks how to apply the tech he already knows to a challenge (same blog).

### 2025: Wavelet, and a fully documented top 5

**The format.** Theme "Utopia & Dystopia". About 1,500 hackers and 291 projects. Grand Prize €10,000, pool €50k.
- The platform says the winner "will be chosen with a peer-review system", with Top 5 pitching at 14:40.
  - Source: https://hackjunction.app/hackathons/junction-2025
- The 2025 platform config had `hasGavelVoting: true` and `hasFinalistVoting: true` (page source, verified).
- Junction's partner infodeck describes the same format as top 5 by Gavel, then "The Grand Jury chooses the overall winning team".
  - Source: https://www.hackjunction.com/junction-infodeck.pdf
- **Exactly who decided the 2025 final (audience vote, jury, or both) is not clear.** The pitch videos show jury members asking questions after each pitch.

**The top 5 finalists.** All are confirmed by Junction's YouTube playlist "Junction 2025", where each video is labelled "Top 5 Finalist Pitch". The descriptions below come from the auto-transcripts.

| Finalist | Challenge partner | What it was | Notable |
|---|---|---|---|
| **Wavelet** (winner [W]) https://www.youtube.com/watch?v=Uh3yPQuee1g | Sensofusion, "Radio City" | Radio-wave simulator over a 3D model of Hong Kong. Written "in pure C++" with NVIDIA GPUs, OpenGL and OpenMP, solving Maxwell's equations; shows diffraction and interference | **Live demo on stage from a laptop GPU.** It was slow to start ("my GPU is slow"), and the audience applauded when it ran. 4 members: algorithms, low-level rendering, satellite texturing (which "we weren't able to quite get … to work"), video. They chose the challenge because it had "a huge set of hard problems". Closing line: "thanks for voting for us". |
| **LoreDash** (2nd overall, €7,500, also track runner-up) https://www.youtube.com/watch?v=43uQE6cZGXU | Supercell | Turns a random Wikipedia article into a playable Game Boy-style minigame. Gemini 2.5 Flash makes the plan, Gemini 2.5 Pro writes the code (Flash code crashed too often), ElevenLabs makes sound effects, and the Lyria live API makes dynamic music | Solo (Frank Sandqvist). **The venue sound failed**, so he held the mic to the speaker. He ran out of time before the live demo and pointed people to a QR code and a "dash cache" of pre-made games |
| **Walkthrough** https://www.youtube.com/watch?v=9KT34TKEBJ0 | Wolt | AR grocery companion on Snap Spectacles, with a Go backend on Google Cloud and image classification | They **built a physical mock grocery store upstairs** for people to try. They opened with a "future vision", then admitted it was a vision and showed what actually works. The jury asked what was built this weekend versus brought in |
| **λpump** https://www.youtube.com/watch?v=8yl6ji8T0lc | HSY & Valmet | Wastewater-pump optimiser combining mathematical optimisation with LLM explanations; operator UI to simulate prices and rainfall | Story-driven pitch built around a persona ("Jamie"). Real context: 15-minute electricity pricing, and a pumping station using as much energy as "500 households". The jury asked why only one person spoke |
| **Drone Stalker** https://www.youtube.com/watch?v=5x4mQtjzQB0 | Sensofusion | Real-time drone detection (YOLOv12) and trajectory prediction (LSTM), wrapped in a gamified web scenario with a sarcastic Gemini "Commander" voice | They re-hosted a 200 GB dataset during the event. Team write-up: https://codya.dev/project/2511-junction |

- **Frank's 2025 result** comes from the Junction blog: "track runner-up as well as overall second place … 7,500€". https://www.hackjunction.com/blog/frank-sandqvist-story
- **Jury questions in 2025** (from the transcripts):
  - "what each of you did in the project and how you guys made decisions";
  - "All of this demo built from scratch this weekend?";
  - "talk about the real world applications … think one step ahead";
  - "if you would have … next 48 hours, what direction".
  - Jury names in the infodeck include Inka Mero (Voima Ventures), Ryan MacArthur (Kontext.dev), Paige Bailey (Google DeepMind) and Laura Modiano (OpenAI).
- **Notable challenge winner.** ApprenticeCircle+ (Aalto "Aging with AI"; 3 MSc students). It was a voice-first platform pairing seniors and young adults. It "stood out among the almost 30" submissions, and the team refined the idea by talking it through with Aalto researchers.
  - Source: https://www.aalto.fi/en/news/aalto-students-and-researchers-shape-together-how-we-age-with-ai-at-junction-hackathon-2025
- **What partners asked for in 2025.**
  - Supercell: "Something unpredictable. Something shocking."
  - Bank of Finland: "new ways of thinking"; it was not focused on technical perfection.
  - Source: https://hackjunction.medium.com/48-hours-at-junction-2025-creativity-community-and-the-spirit-of-innovation-fce609acb6b6

---

## Part 2. Mechanics: how the winner is chosen

### How it evolved

| Era | Stage 1 | Stage 2 | Final decision | Source |
|---|---|---|---|---|
| 2017 | Gavel picks finalists per track | Expert panel reviews finalists, including their code | Experts | [W] |
| 2018–2019 | Partners pick challenge winners; peers pick track winners using comparative app voting | Track winners pitch | Participants | [D] Zweitag; [W] |
| 2022 | Partner review at tables 10:00–12:30; peer review 12:30–14:00 (15 each, mandatory); criteria Novelty / Tech-y-ness / On point / WOW | Track winners pitch 3 min | Audience vote | [D] 2022 guidebook |
| 2023 | Planned peer voting failed under load | Partners preselected | unclear | [D] marincomics |
| 2024 | Gavel (15+ reviews each, penalty for skipping) plus optional in-person table reviews | **Top 10** pitch 3 min, slides from the platform only | **Hacker vote** | [D] 2024 guidebook |
| 2025 | Gavel (`hasGavelVoting: true`) | **Top 5** pitch, with jury Q&A | Finalist voting flag on; the infodeck says grand jury. Unclear | [D] platform, infodeck, YouTube |
| **2026** | **Face-to-face peer review** (`physicalPeerReview: true`, Gavel off, `reviewAnyChallenge: false`) | **Top 5** pitch to a live audience | **Seven-person grand jury** (`hasFinalistVoting: false`) | [D] https://2026.hackjunction.com and the platform source |

### What Gavel and pairwise peer review reward [D design, I effects]

- Gavel (built at HackMIT in 2015) has reviewers compare each new project with the one they saw just before. It uses a Crowd-BT (Bradley–Terry) model and picks the next project to maximise expected information gain.
  - Sources: https://anishathalye.com/gavel-an-expo-judging-system/ and https://anishathalye.com/implementing-a-scalable-judging-system/
- Junction says it used a modified version from 2016 "as we don't believe outside 'experts' are the best people to decide what is a good hack".
  - Source: 2024 Reviewing page
- An independent simulation suggests that with few comparisons per project, Gavel's ranking is noisy.
  - Source: https://ben.enterprises/hackathon-judging. This is a synthetic simulation, not Junction data.
- **Effects [I].**
  - Each project is judged *relative to the last thing the voter saw*, in a minute or two.
  - The voter is a sleep-deprived hacker who has seen 10–20 tables and remembers a sentence and an image, not your architecture.
  - What wins that comparison is legibility (what is it?), visible life (it moves, it reacts to me), novelty (I haven't seen this today), and craft (it looks finished).
  - Twenty "AI assistant for X" dashboards blur together, and the one with a physical object, a game or a surprising output stands out.

### What the 2026 face-to-face review likely rewards [I]

- Gavel is off and review is physical, so stage 1 looks like an expo. Reviewers walk to your table and score or compare you there.
  - `reviewAnyChallenge: false` hints that reviewers are assigned projects, possibly within a track. That would mean **you are compared mostly against teams in your own track.** [I, unverified]
- Unknowns to ask about on site:
  - who reviews (all participants or one representative per team);
  - how many projects each reviewer sees;
  - whether reviewing is mandatory (in 2022 and 2024 it was, with penalties);
  - pitch length and Q&A;
  - whether the stage uses your own laptop or uploaded slides.
- **The table demo is now the most important artefact of the weekend.** The video and write-up matter mainly as backup and for partner judges.

### What the 2026 grand jury likely rewards [D quotes, I synthesis]

The jury's own stated criteria (https://2026.hackjunction.com):
- "start from a problem worth solving, not just a feature that's easy to build" (Kia Kanninen, Founders House)
- "explain exactly why an agent fails in their world" (Daksh Raghuvanshi, AfterQuery)
- "start from a real user problem and ship something people want to come back to" (Otto Söderlund, Supercell)
- "move fast, stay pragmatic, and have a knack for finding that one unique insight" (Hubertus van der Drift, Context.dev)
- "tackle the hardest challenges and build prototypes with a clear path to production and scale" (Arturs Polis, Verda)
- Timo Ahopelto (Lifeline Ventures) and Umar Noor (Google DeepMind) state no criteria.

What this adds up to [I]:
- The jury cares about a real problem, one sharp insight, real technical difficulty, a path to production, and something people would come back to.
- Expect the 2025 style of Q&A: who did what, what was built this weekend, the real-world application, and the next step.
- A project that only wins a popularity vote (rap video, gimmick) without substance may make the top 5 and then lose to the jury.
- A deep but illegible project may never reach the stage.
- **The winning profile in 2026 has to pass both filters.**

---

## Part 3. Patterns

### What separates main-prize winners and finalists from challenge winners

1. **A live, visibly working demo of something that looks hard.** [strong evidence]
   - Wavelet ran a GPU Maxwell solver live on stage.
   - Oneiro had a Raspberry Pi camera on a real charger.
   - Drone Stalker did real-time detection.
   - Haru was live, with users.
   - The 2022 peer rubric literally said "Tech-y-ness: … real prototypes, not just fancy PowerPoint slides".
2. **A one-sentence hook a non-expert gets instantly.** [strong]
   - "Random Wikipedia article → playable game."
   - "Your diary → one picture a day."
   - "Rent your EV charger to strangers."
   - "See radio waves bounce around Hong Kong."
   - Challenge winners can be more niche because a partner who knows the domain judges them. The Huhta twins' plate-OCR-to-BIM tool is an example.
3. **Play, emotion or spectacle on top of substance.** [strong for the peer stage, moderate for the jury]
   - Frank credits his 2024 win partly to an AI rap video.
   - LoreDash is a game generator. Drone Stalker wrapped deep tech in a game with a sarcastic AI commander. Haru is about mental health. Walkthrough built a mock shop.
   - Junction's pitch guide: "Start with a Compelling Story" and "It is easier to vote for solutions that are user-centered and demonstrate empathy".
   - Source: https://hackjunction.medium.com/how-to-pitch-your-idea-at-a-hackathon-a95cd3f62f60
4. **Physical or immersive interaction makes things memorable.** [moderate]
   - Examples: Oneiro (Pi plus charger), 2020 finalists (three VR or AR), Walkthrough (Spectacles plus a mock store), Zweitag (paper street).
   - 2026 has an Arduino Hardware track and a Hardware Lab with Arduino UNO Q boards, 3D printers and LeRobot arms (https://2026.hackjunction.com).
   - Caveat: the overall winners of 2022, 2024 and 2025 were software-only. Hardware helps you get noticed but does not guarantee the win.
5. **The newest tech, used for a human-scale purpose.** [moderate]
   - Stable Diffusion three months after release (2022). Gemini Lyria live music and Snap Spectacles (2025). YOLOv12 (2025).
   - In 2026 every team has frontier models and coding agents. "We used an LLM" is no longer novel. What is novel is **what the model is made to do and what it touches**: real data, hardware, physics, users.
6. **Real data, real users or real partner assets.** [moderate]
   - Telia mobility data (2018). 60 real users in 5 hours (2022). Partner datasets and city models (Sensofusion 2025). Real tariff structures (λpump).
   - These make the jury's "path to production" question answerable.
7. **Small, experienced teams with ruthless scope.** [moderate, small sample]
   - Winning team sizes were 3, 4, 5, 4, 1 and 4.
   - Winners are disproportionately repeat participants.
   - Wavelet dropped satellite texturing when it didn't work and still won.

### Where the evidence is thin

- There is no official statement of *why* any main-prize winner won. All "why" claims are inference.
- The 2021 and 2023 winners are unverified, and 2019's project content is unknown.
- Team backgrounds (students vs. professionals) are mostly unknown.
- The 2026 mechanism is new: physical peer review plus a jury. Past winners were chosen by hacker votes, so past evidence may over-reward spectacle.
- I found no first-hand account of reviewer behaviour at Junction (time per table, fatigue). Those claims are inferred from Gavel's design and general expo dynamics.

### How strong teams lose (documented cases first)

| Failure | Evidence |
|---|---|
| Video and visuals left to the last morning; no header images, so the project disappears in a gallery of about 230 | [D] https://marincomics.com/junction-2023.html |
| Platform overload during review; submissions and votes lost | [D] same |
| Venue audio fails; pitch overruns before the live demo is shown | [D] LoreDash pitch (still placed 2nd thanks to the QR code and pre-made cache) |
| Demo slow to start on stage | [D] Wavelet (survived by narrating calmly) |
| Pitching a "future vision" the build doesn't support invites the jury to ask "what was built this weekend?" | [D] Walkthrough Q&A |
| One person does all the talking, and the jury asks why | [D] λpump Q&A |
| Clever demo for a generic problem (parking) | [I] Zweitag 2018 |
| Partner wants depth and the core problem, not "extraneous issues"; AI added for its own sake loses | [D] Granlund 2024 |
| Not reviewing others gets the team penalised or disqualified (2022, 2024) | [D] guidebooks |
| Over-scoping, no sleep, broken integration | [I] general; Lebedeva advises defining scope early and sleeping the first night (https://elizavetalebedeva.com/tag/junction/) |
| Generic "chat with your data" or "AI copilot for X" | [I] 291 projects in an AI-themed 2025; none of the top 5 was a chat UI. The 2026 jury explicitly asks for "a problem worth solving, not just a feature that's easy to build" |

---

## Part 4. Playbook for Junction 2026

### Confirmed 2026 facts this plan is built on [D https://2026.hackjunction.com]

- **Dates and venue.** 13–15 Nov, Hype Areena, Espoo. Teams of **up to 4**. €100k total; main-prize amount "coming soon".
- **Friday.** Doors 16:00, opening 18:00, **hacking 19:30**, **preliminary submission 23:59**.
- **Saturday.** Submissions open 12:00.
- **Sunday.**
  - **Final submission 10:00.**
  - **Review time 10:30.**
  - Final Ceremony 14:00: keynotes, **top 5 pitches**, challenge winners 15:10, **Junction winner 15:50**.
- **Effective build time: about 38.5 hours.** It is not 48.
- **Submissions are open-sourced under the MIT licence**, with the team credited.
- **Tracks.** Hardware (Arduino), Healthcare, AI Infrastructure (Verda), FinTech, Agentic AI, Data. Cross-track tech challenges and credits (OpenAI Codex, NVIDIA, Modal, Featherless, Aiven, Cloudinary and others).

### 4.1 Idea-selection checklist (score each candidate on the spot)

Score each item 0, 1 or 2. **Kill any idea under 14/24, or with a 0 on any starred item.**

| # | Criterion | 0 | 1 | 2 |
|---|---|---|---|---|
| 1★ | **One-sentence hook.** A stranger repeats it back correctly after 10 seconds | Needs context | Needs one follow-up | Instantly clear |
| 2★ | **Demo moment in under 20 s.** Something visibly happens: it moves, reacts, generates or is physical | Dashboard or text only | A visual output | Surprising and interactive; a reviewer can touch or trigger it |
| 3★ | **Problem someone feels**, ideally confirmed by the partner rep tonight | Invented pain | Plausible | The partner said "we have this problem", or users exist in the room |
| 4 | **One unique insight.** Not the first idea every team in the track will have | Obvious ("AI assistant for X") | A twist | Non-obvious angle you can state in one line |
| 5 | **Visible technical depth** the jury will respect (physics, real-time, hardware, an agent with evaluations, real infrastructure) | Thin wrapper | Some depth | Hard core plus a clear explanation of why it is hard |
| 6 | **Real data, hardware or partner asset** used | Mock data | Public data | Partner data/API/hardware, or real users during the event |
| 7 | **Memorability.** Play, emotion, humour or spectacle | None | Some | People will mention it to friends at dinner |
| 8★ | **Feasible in about 20 hours of build** with your skills and AI agents; the risky part can be tested in 2 hours | Unknown unknowns | One risky dependency | The core path is de-risked by Saturday morning |
| 9 | **Path to production / "would come back to it".** A credible next step for a partner or user | None | Vague | Partner named who would pilot it, or an obvious repeat-use loop |
| 10 | **Fits the partner's judging criteria** (so you can also take the track prize) | Off-brief | Partially | Hits the brief and uses their tech |
| 11 | **Demo robustness.** Can run offline or on a local GPU, with a cached fallback | Needs fragile live APIs | Partial fallback | Fully runnable without venue Wi-Fi |
| 12 | **Team-strength match.** Plays to what you are already good at (Frank's rule) | New stack for everyone | Mixed | Core in your strongest skill |

Tie-breakers [I]:
- Prefer the idea where the **hard thing is also the visible thing**, as with Wavelet, where the physics *is* the visual.
- Avoid ideas where the hard thing is invisible plumbing.
- In a crowded AI track, prefer the idea that touches the physical world or real users.

### 4.2 Time plan (about 38.5 h: Fri 19:30 to Sun 10:00)

| When | Milestone | Notes |
|---|---|---|
| **Fri before 18:00** | Read every challenge (`02-challenges.md`). Pre-score 3–5 candidate directions on the checklist. Write each as a one-line hook. | No code before the start (rules). Preparing ideas is fine. |
| **Fri 18:00–21:30** | Opening, team formation, **talk to 2–3 partner reps** (questions in 4.4). Kill ideas that fail the starred items. | Partner reps are most available on Friday night. |
| **Fri 21:30–22:30** | **Lock the idea.** Write the one-sentence hook, the 20-second demo moment, and the pitch's last slide ("what this becomes"). | If you can't write the demo moment, it isn't locked. |
| **Fri 22:30–02:00** | **De-risk the riskiest component** (2 h spike). Repo set up, deploy target ready, roles split. | If the spike fails by 02:00, fall back to idea #2. Don't bargain. |
| Fri 23:59 | Preliminary submission (pick challenge, name, one-liner). | Required. |
| **Fri 02:00–Sat 08:00** | Shifts: at least one person sleeps 4–5 h. The others build a **walking skeleton** (input → core → visible output, end to end, ugly). | |
| **Sat 10:00** | **End-to-end skeleton works.** Show it to the partner rep: "is this the problem? what's missing?" | Second validation touchpoint. |
| Sat 12:00 | Submissions open: create the draft project page now. | Avoids the 2023-style platform rush. |
| **Sat 10:00–20:00** | Build the **demo moment** and the **one hard thing** to full quality. Get real data in. Start the design pass at 16:00 (name, logo, colours, one hero visual). | Use AI agents in parallel; one person owns integration. |
| **Sat 20:00** | **Feature freeze.** Only bugs, polish and demo-path hardening after this. | Most teams that miss the top 5 break their build after this point [I]. |
| Sat 20:00–24:00 | Harden the demo path: seed data, cached outputs, offline mode, a reset button. Write the README with demo credentials (`01-event-intel.md`, TERMS §8.6). | |
| **Sun 00:00–03:00** | **Record the backup video** (screen capture of the real demo plus voice-over, ≤2–3 min). Make banner images and fill in the punchline and description. | Fixes marincomics' 2023 failure. |
| Sun 03:00–06:00 | Sleep in shifts. | A tired presenter loses the jury Q&A. |
| **Sun 06:00–09:00** | **Rehearse.** The 60-second table demo ×10, rotating presenters. The 3-minute stage pitch ×5 with a timer. The 4 jury questions (4.3). | |
| **Sun 09:00** | **Submit FINAL** (one-hour buffer). Check the video plays logged out and the repo is public. | Draft projects aren't reviewed (2024 rule). |
| Sun 10:30–~14:00 | Face-to-face review. Two people at the table on a rota, the others reviewing if required. | Ask organisers Sunday morning how review works this year. |
| Sun 14:00 | If in the top 5: pitch, then Q&A. | |

### 4.3 Demo and pitch

**The table demo (stage 1, peer review).** Target 60–90 seconds. Assume the reviewer has seen 15 tables.
1. **0–10 s.** The hook sentence, while the demo is *already running* on screen. Never start from a login page.
2. **10–40 s.** Let *them* trigger the moment: press the button, hold the device, type their own input. Self-generated surprise is memorable [I].
3. **40–60 s.** One sentence on why it's hard, one sentence on who needs it (name the partner).
4. **Memory anchors.**
   - A distinctive name.
   - One hero visual on a second screen or a printed A4 at the table.
   - A physical object if you have one.
   - A QR code to try it, as LoreDash did.
5. Keep a "money shot" loop playing on a second screen for reviewers waiting their turn.

**The stage pitch (stage 2, jury).** Assume about 3 minutes plus Q&A. Confirm on site.

| Time | Content |
|---|---|
| 0:00–0:20 | **Show, don't introduce.** Open on the demo output or a 10-second clip of it working. Then the hook sentence. No team intro, no agenda. |
| 0:20–0:50 | The problem, with one concrete person or number (λpump's "Jamie"; "500 households"). Say what the partner told you. |
| 0:50–1:50 | **Live demo of the core moment** (or the embedded clip if the stage rules demand uploaded slides). Narrate *what* is happening, not *how*. |
| 1:50–2:30 | The insight and the hard part: one technical sentence the jury will remember ("pure C++ on the GPU, solving Maxwell's equations"). Real data or users ("60 users in 5 hours"). |
| 2:30–3:00 | Path forward: who pilots it, what the next 48 hours would be. Then a closing line that repeats the name and hook. |

**Prepare these Q&A answers.** All four were asked by the 2025 jury.
- Who built what, and how you made decisions. Every member should be able to answer.
- What was built this weekend. Be scrupulously honest.
- Real-world applications, one step ahead.
- What you would do with the next 48 hours.

**Backup plans.**
- Demo runs locally with a cached or pre-generated mode (LoreDash's "dash cache").
- Phone hotspot. Second laptop with the same build.
- The backup video is embedded in the slides and stored offline.
- A 15-second "it works" clip at the start of the deck.
- If audio matters, have captions on the video.
- If the live demo stalls, keep talking over it as Wavelet did ("give it a second"), then switch to the clip after 10 seconds.

### 4.4 Working the room

- **Partner reps on Friday night.** Ask:
  1. "What problem do you actually have that this challenge stands in for?"
  2. "What would make you use this on Monday?"
  3. "What data, API, hardware or access can we get tonight?"
  4. "What did teams get wrong on this challenge before?"
  5. "How will you judge, and what do you weigh most?"
  6. "Is anyone from your company on the grand jury?" Arturs Polis (Verda) is, and Verda is a main partner.
- **Partner reps on Saturday morning.** Show the skeleton and ask "what's missing, what's wrong, what would impress your boss?"
  - The 2025 Aalto winners credit researcher conversations with sharpening the idea.
  - A rep who has seen your progress remembers you at judging (Lebedeva).
- **Mentors.** Use them for unblocking only. Book the Hardware Lab or Arduino mentors early if you need hardware, and the Verda/NVIDIA/Modal folks for GPU credits.
- **Organisers on Sunday morning.** Ask:
  - how face-to-face review works (who, how many, how long per table);
  - pitch length and format (own laptop or uploaded slides);
  - whether the top 5 are drawn per track or overall.
- **Other teams.** Walk the floor on Saturday afternoon for 15 minutes. If three teams in your track have your idea, sharpen your twist now.

### 4.5 Things to avoid

1. A chat UI as the main demo. "AI copilot for X" with no unique insight.
2. Ideas whose hard part is invisible. If the jury can't see it, it didn't happen.
3. Building past Saturday 20:00 without a frozen, demoable version.
4. Depending on venue Wi-Fi, live third-party APIs or venue audio for the demo.
5. Leaving the video, images and description until Sunday morning.
6. Overselling a "vision" the build doesn't support. The 2025 jury asked directly.
7. One-person pitches when there are four of you, with no one else able to answer Q&A.
8. Skipping mandatory peer reviewing, which was penalised in past years.
9. Picking a challenge only for the prize size. Pick one where you have a real data or hardware edge and can find a non-obvious angle.
10. Pre-written code (against the rules) or anything you can't cleanly MIT-licence.

---

## Sources (primary first)

- Junction 2026 site (schedule, judging, jury quotes, tracks): https://2026.hackjunction.com
- Junction 2025 platform page: https://hackjunction.app/hackathons/junction-2025
- Junction infodeck (2025 data, format): https://www.hackjunction.com/junction-infodeck.pdf
- Junction blog, Frank Sandqvist story: https://www.hackjunction.com/blog/frank-sandqvist-story
- Junction blog, 2025 recap: https://hackjunction.medium.com/48-hours-at-junction-2025-creativity-community-and-the-spirit-of-innovation-fce609acb6b6
- Junction pitch guide: https://hackjunction.medium.com/how-to-pitch-your-idea-at-a-hackathon-a95cd3f62f60
- Junction 2025 top-5 pitch videos: Wavelet https://www.youtube.com/watch?v=Uh3yPQuee1g · LoreDash https://www.youtube.com/watch?v=43uQE6cZGXU · Walkthrough https://www.youtube.com/watch?v=9KT34TKEBJ0 · λpump https://www.youtube.com/watch?v=8yl6ji8T0lc · Drone Stalker https://www.youtube.com/watch?v=5x4mQtjzQB0
- 2024 guidebook: https://junctionhq.notion.site/Participant-Guidebook-Junction-2024-10559a11813780389e0fc382f7ec6ea8 · Reviewing: https://junctionhq.notion.site/Reviewing-fff59a118137812eb17fdf07e797aed7
- 2022 guidebook: https://guidebook2022.notion.site/Participant-Guidebook-a98e9f36c4594c1ca757a1e2c120b587
- Junction 2019 winners (Wayback): https://web.archive.org/web/20191219094110/https://blog.hackjunction.com/the-winners-of-junction-2019-de539036dc3f
- Junction 2020 winners: https://medium.com/hack-junction/the-winners-of-junction-2020-connected-2ed7333f429e
- Oneiro repo: https://github.com/teamglados/oneiro · Telia: https://www.telia.fi/business/article/europes-largest-hackathon-at-dipoli-in-espoo
- Haru 2022: https://view.asiae.co.kr/en/article/2022111311381508794 · https://speakerdeck.com/codertimo/haru-diary-app-with-stable-diffusion-junction-2022
- Granlund/KONE 2024: https://www.granlundgroup.com/news/junction-hackathon/
- Aalto 2025: https://www.aalto.fi/en/news/aalto-students-and-researchers-shape-together-how-we-age-with-ai-at-junction-hackathon-2025
- Aalto 2018 sauna: https://aalto.fi/en/news/winning-team-hack-the-sauna-experience-to-a-new-level-at-junction
- Participant accounts: https://www.zweitag.de/blog/junction-2018-helsinki-hackathon · https://marincomics.com/junction-2023.html · https://elizavetalebedeva.com/tag/junction/ · https://codya.dev/project/2511-junction
- Gavel: https://anishathalye.com/gavel-an-expo-judging-system/ · https://anishathalye.com/implementing-a-scalable-judging-system/ · critique: https://ben.enterprises/hackathon-judging
- Wikipedia (leads only): https://en.wikipedia.org/wiki/Junction_(hackathon)
