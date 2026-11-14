# Beryl: how it works and how to work on it

What Beryl is, for someone meeting it for the first time, is in [README.md](README.md). This file is the detail behind it: what each part does and why, every command and test, and where the code is.

**Owner:** Asadullah (`Asadullah378`). **Status (Sun 15 Nov):** one platform in three forms. The **web app** (also installable on a phone) signs people in, searches and reads the live web with Exa and answers with live widgets. The **desktop app** (Mac and Windows) is the same interface in a window of its own with a real browser inside it, where the agent also acts on websites. Both have **voice** (speak instead of typing, or start a **live call** and talk with the agent while its tools run), **jobs** that run on a schedule and email their result, and **notifications**. Accounts, conversations and usage are in Postgres; one admin account creates the others. It is live at https://beryl.zeroanomaly.tech on Google Cloud (see `DEPLOYMENT.md`). It passed its end-to-end tests and real agent runs on 14 November. Voice has been tested with a recorded voice played into the microphone, not yet with a person at a real microphone or on a phone.

Beryl is a general web agent for Exa's challenge "The Internet Butler". You hand it a task; it searches the live web with Exa, answers with live widgets instead of plain text (a map, fare cards, price charts, a gallery, a research report), and takes the task as far as it can go. Beryl is a gemstone (emerald and aquamarine are beryl) whose crystals are six-sided, which is the logo. The name and the logo's shapes are set in `web/src/lib/brand.ts`. The browser's storage keys still begin with `hovi.`, the first working title, so nothing people saved is lost; that prefix is not a name anyone sees.

AimoPilot (working title Dock), the Valio Aimo project, is a separate project in this repo, owned by Nafay. It lives at the repo root (`/web`, `/infra` and the folders beside them). Everything for Beryl lives in `exa/`.

## What was built, in four steps

1. **Agent with live widgets (built).** Exa is read-only: search, read, structured data. Widgets, sub-agents, parallel tools, a visible plan, clarifying questions, modes and an effort dial in place of a model picker, usage and cost tracking by kind.
2. **Live web actions (built, in the desktop app).** The agent acts in a real browser inside the app that the user watches, hands the page over for sign-ins and human checks, asks for approval before anything that commits the user, and never pays.
3. **Phone and voice (built).** The web version can be installed on a phone (it has a web app manifest and icons). Voice input and live calls work on both web and desktop.
4. **Jobs and notifications (built).** A job runs on a schedule, looks things up and emails the result; notices say when a chat is done or needs you, in the app and by email. More autonomy (Exa Monitors that keep watching) is still to do.

## Web and desktop: who does what

| | Web (a browser tab, the installed web app, a phone) | Desktop app |
|---|---|---|
| Sign in | Email and password | The same account, the same screen |
| Search, read, widgets, research | Yes | Yes |
| Voice input and live calls | Yes | Yes, and in a call the agent can also work in the live browser |
| Act on websites in a live browser | No. The agent has no browser tools here and says that doing it needs the desktop app | Yes |
| Conversations | Saved to the account | Saved to the account |
| A conversation started in the other one | Read-only | Read-only |

There is one codebase and one server. The desktop app does not contain the interface: it loads it from the server, exactly as a browser tab does, so both are always the same version and share the sign-in screen, the accounts and the database. What only the desktop app has is the live browser and the small engine that drives it, which run on the user's own computer.

A conversation belongs to where it was started, because one from the desktop app relies on a browser the web does not have. Opened from the other kind of client it can be read, not continued: the message box is replaced by a note, and the server refuses a save or a new message there.

## Run it

Postgres must be running (Postgres.app, Docker or a hosted one). Create an empty database and put its address in `DATABASE_URL`.

```bash
cd exa
cp .env.example .env.local   # the keys, DATABASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD
createdb beryl               # once, for a local Postgres
cd web
pnpm install
pnpm dev                     # the web app on http://localhost:3000 (tables are created at start)
pnpm desktop                 # the desktop app, on the same server
```

Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `exa/.env.local`. The admin adds every other account under `/admin`.

- `pnpm desktop` builds the app's browser engine, starts the server if nothing answers on port 3000 (`BERYL_PORT` picks another port) and opens the app. `BERYL_URL=https://beryl.example.com pnpm desktop` opens it on a server that runs somewhere else.
- `pnpm desktop:pack` packages it as a real application in `web/desktop/release/` (`Beryl.app` on a Mac). Give it the server's address with `BERYL_SERVER_URL` when packaging; anyone can change it later on the app's own "cannot reach the server" page. The package is not signed: on another Mac it opens with right-click, Open, the first time.
- `pnpm db:generate` writes a migration after `src/lib/db/schema.ts` changes; `pnpm db:migrate` applies migrations by hand (the server also does it when it starts).
- `pnpm smoke` checks that Claude (through AWS), Gemini and Gemini's decision model answer with your keys. `pnpm smoke options` sends one small request per model and job (agent, sub-agent, extraction) with the exact thinking settings the app uses.
- `pnpm test:guard` checks the live browser's safety rules as a table (no browser needed).
- `pnpm test:auth 3000` checks accounts over HTTP with the server running: sign-in, the admin's powers, each account seeing only its own conversations, the read-only rule, blocking and deleting.
- `pnpm test:desktop 3000` starts the real desktop app in a throwaway profile, signs in, and checks from inside it: the browser view, the agent's clicks, keys and scrolling, the safety rules, approvals, the user's own typing, hiding and closing. `BERYL_TEST_CHAT="<request>"` then types a real request into the app; `BERYL_TEST_SHOTS=<folder>` saves pictures of the window.
- `pnpm test:voice 3000` checks voice in the real desktop app without anyone speaking: the app's microphone is fed a recording (`scripts/fixtures/weather-question.wav`) and its speaker is muted. It checks that the words appear in the message box as they are heard, and that a live call hears the question, runs the weather tool, shows its card, answers aloud and is written into the conversation. `BERYL_TEST_PHONE=1` runs it at a phone's width.
- `pnpm icons` redraws the desktop and installed-app icons from the logo.
- `/dev/widgets` shows every widget with sample data. `/dev/sandbox.html` is a pretend cafe and shop for testing the browser without touching a real site.
- `pnpm typecheck`, `pnpm lint` and `pnpm build` all pass.

## What it does today

| Task | Widget | Where the data comes from | Typical time |
|---|---|---|---|
| Places, restaurants, "near me" | Map with cards, hours, directions | Exa's place records (search limited to `exa.ai`) | 1 s |
| Weather | Forecast strip | Exa's weather pages | 1 to 2 s |
| Stock prices | Live chart, refreshes every 30 s | Exa's market pages (`/contents`) | under 1 s |
| Prediction markets | Odds and 30-day chart, refreshes every 20 s | Polymarket's public API, plus Exa news to explain the move | 2 s |
| Flights | Fare cards with booking links | Jinko through Exa Connect (Exa Agent) | 20 to 30 s |
| Hotels | Cards with photos and live rates | Jinko through Exa Connect (Exa Agent) | 30 to 60 s |
| Products | Cards that appear one by one, compare view | Exa search, then a fast model lines them up | 10 s |
| "Find me ones that…" (recipes, job ads, listings, reviews, studies) | Sift: a grid of pages against wishes | Exa search for about 40 pages, each checked against every wish by Gemini's decision model | 2 to 3 s |
| Images | Gallery with lightbox | Exa search with image links | 3 s |
| Research | Parallel sub-agents, then a sourced report | Exa search and contents, 3 to 4 sub-agents | 30 s |
| Anything else | Text with source pills | Exa search and contents | 5 to 10 s |

The model can also show a comparison table, key facts, a plan, clarifying questions (answered with taps) and action buttons (book, call, directions, calendar, email).

**Custom widget.** When none of the fixed widgets fits, the agent composes its own with the `showWidget` tool, block by block: charts (pie, donut, bar, stacked bar, horizontal bar, line, area, scatter, radar), stat tiles, tables, lists and timelines, progress bars, images, callouts and buttons. A button can open a link, copy text, or send a follow-up to the agent, so the widget can continue the task. For something no block can express (a calculator, a custom diagram) there is an `html` block: a self-contained fragment that runs in a sandboxed frame with no network access and the app's colours passed in. Blocks appear as the model writes them. The block shapes are in `web/src/lib/widgets/types.ts` ("Custom widget"), the tool in `web/src/lib/agent/tools/compose.ts`.

Every widget shows its sources. Every answer shows the mode it ran in and the time. An account the admin lets see usage also gets the number of Exa calls and the cost, split by kind, and the bar above the conversation adds them up; the bar also carries the conversation's name.

## The website and the downloads

**Landing page.** Someone who is not signed in sees the landing page at `/` on the web (`web/src/components/landing/`). It shows the product by being it: the example cards under "Ask for anything" (stocks, weather, markets, flights, products, and "Limitless possibilities"), Sift, Research and the job card are the app's real widgets running on sample data, loaded as they come near the screen and kept from reaching the server. The desktop app at work, a call and the Jobs page are real screenshots in frames. Sections: Watch it work (the demo film, first under the hero: the file named by `BERYL_DEMO_VIDEO`, shown behind a poster and fetched only when play is pressed), Ask for anything, It does it for you (desktop only), Talk to it, Jobs, Sift, Research, the rest, Use it anywhere, Get the desktop app (pick Mac or Windows: its downloads and first-launch steps), and Powered by (Exa, Gemini, Claude, with what each does here). Each feature carries a line saying what powers it. Signed in, `/` is the app. The desktop app never shows it: a signed-out window there goes straight to sign-in (the app's window names itself in its User-Agent). `/about` shows the page to anyone. The pictures on it are real screenshots of the app (`web/public/landing/`), in both themes. Set `BERYL_DEMO_VIDEO` to a YouTube link or a video file to fill the demo section.

**Desktop downloads.** `pnpm desktop:release` builds what the site offers, from a Mac, in under two minutes:

| File | For | Size |
|---|---|---|
| `Beryl-mac-apple-silicon.dmg` | Mac, M1 or newer, macOS 13 or later | 118 MB |
| `Beryl-mac-intel.dmg` | Mac, Intel, macOS 13 or later | 125 MB |
| `Beryl-windows.zip` | Windows 10 and 11, 64-bit | 154 MB |

They land in `web/desktop/release/downloads/` with a `manifest.json` (version, size, SHA-256). The site's buttons link to `/download/<id>`, which sends the file from that folder, or redirects to `BERYL_DOWNLOADS_URL` when the files are hosted in a bucket. The list of downloads and the first-launch steps live in `web/src/lib/downloads.ts`.

- **The server address** is baked in when packaging: `BERYL_SERVER_URL=https://your.domain pnpm desktop:release`. Without it the app looks for a server on the same computer, and anyone can change the address on the app's "cannot reach the server" page.
- **Not signed yet.** The Mac builds are not notarised and the Windows build is not signed, so each system asks the user to confirm once. The landing page shows the steps. An Apple Developer ID and a Windows certificate would remove them.
- **Not run on Windows yet.** The Windows build is made on a Mac and its contents are checked, but nobody has started it on a Windows machine. The Intel Mac build has not been run either.
- `pnpm desktop:pack` still builds only for the computer you are on, into `web/desktop/release/build/`.

## Tasks keep running

A task belongs to the server once it has started, not to the page that started it. Reloading, closing the window or opening another conversation only stops someone watching.

- **Leaving and coming back.** The task carries on, and the server saves the conversation itself: when the task starts, after each step and when it ends. Opening the conversation again, after a reload, a closed window or from the list, shows what has happened so far and then follows it live. The server keeps everything a task has streamed until the task ends; the interface puts the conversation back as it was when the task began and replays the stream on top through its ordinary request path, so what is rebuilt is exactly what would have been shown had nobody left (`web/src/lib/runs.ts`, `/api/chat/[id]/run`, `/api/chat/[id]/stream`).
- **Switching conversations.** A conversation that is left while it is working stays alive out of sight, so nothing has to be rebuilt when it is opened again, and in the desktop app its steps in the live browser go on. It is let go once its work is done. The list marks every conversation with a task running.
- **Side by side.** Several people use the server at once, and one person can have several tasks running: each is its own entry with its own meter and stream. An account may have six at a time, and one per conversation. There is one live browser per desktop app, so a second task that wants it while another is using it is told so and says so.
- **Stop.** The Stop button is the one thing that ends a task early (it tells the server), besides the usage limit, which counts what all of an account's running tasks have spent. A stopped or broken-off task still has what it used recorded. Deleting a conversation ends the task in it.
- **Where it holds.** The list of running tasks is in the memory of one server process. That is right for a server that stays up (`next start`, a container, a VM); on a host where each request may land on a different short-lived instance it would need to sit on Redis, as the AI SDK's guide to resumable streams does.
- **Waiting on the user.** A task in the live browser stops in two places: a step that commits the user waits for their yes, and a sign-in, a code or a payment page is handed to them. While it waits the conversation stays alive like one that is working, so "Done" in the browser reaches it even with another conversation open, and the list marks it "Waiting for you". The browser is part of the app, so a page does not outlive a reload or a closed app, but the task does: opened again within a day, the conversation asks the app for the step that was waiting, the app (which no longer has it) does not take it blind, and the agent is told the page is gone. It opens the page again, looks at what is already done, and works back to the same point, where it asks for the approval or hands the page over again. Nothing is approved or sent on the way. The conversation that was on screen picks up by itself; others are marked in the list and pick up when opened.
- `pnpm test:background 3000` checks all of this in the real desktop app with real questions: a reload mid-task, a second task beside the first, opening the first again, Stop, and a browser task finishing out of sight. `pnpm test:waiting 3000` checks the waiting cases: quitting and reloading at an approval, "Done" pressed with another conversation open, quitting during the user's turn, and a waiting task left out of sight.

## Addresses

- **A chat has its own address**, `/chat/<id>`; the front door (`/`) is a new chat. Opening a chat, starting a new one and sending the first message of a new chat all change the address without loading a page (the browser's own history calls, in `web/src/components/butler/butler.tsx`), so chats that are working out of sight stay alive. Back and Forward move between chats, a reload stays on the chat, and a notification's email links straight to it. An older link of the form `/?chat=<id>` is sent on.
- **Signing in leads back.** A signed-out visitor to a chat, a job's run or the admin area is sent to the sign-in page with the address they asked for, and lands there once signed in (`web/src/proxy.ts`, `web/src/app/login/page.tsx`; only addresses on this site are accepted). The guard also tells each page which address was asked for, so a page that finds the session has ended can do the same.
- **An address that is nobody's page** gets Beryl's own "This page isn't here" page (`web/src/app/not-found.tsx`), signed in or not, instead of a request to sign in.
- **The account menu is the same list everywhere**: Usage and Accounts for the admin (two pages, `/admin` and `/admin/accounts`), then Jobs, Notifications and Sign out for everyone, with the page you are on marked. It sits in the chat's top bar as a badge, at the foot of the conversation list as a row, and in the bar of the Jobs and admin pages. Under 420 pixels the top bar's "New chat" button steps out to keep room for the chat's name (the logo starts a new chat too).

## Jobs: things it does on a schedule

A job is something Beryl does by itself at set times, with the result emailed to you and kept on the Jobs page. You make one by asking in a chat: "Every weekday at 8, email me the top AI news", "Check this price every 6 hours until Friday", "Tomorrow at 9, send me the weather for the hike".

- **What a job can do.** Everything a chat on the web can: search, read pages, prices, flights, weather, markets, research. It never acts in a browser, signs in, books or buys. A run starts from nothing but the instructions the agent wrote when the job was made, so those carry everything it needs.
- **When it runs.** Once at a moment, by the clock (a cron line in the user's time zone: "0 8 * * 1-5" is weekdays at 08:00), or at a fixed gap (every 6 hours), with an optional end: until a date, or after so many runs. At most every 5 minutes, and at most 25 jobs per account. The card in the chat and the Jobs page show the next run times, so what the schedule means is never a guess.
- **What a run leaves behind.** The result as the agent wrote it, which is what the email carries (with its sources), and the run as a chat would show it: the steps, the cards, the sources. Both are on the Jobs page under the job, for every run.
- **The Jobs page** (`/jobs`, from the account menu): every job with its schedule, what it is for and the instructions the agent wrote. There you can edit the name, the purpose and the instructions, pause and resume, delete, and try it with **Run now**. The schedule is changed by asking in a chat, where the agent works out the times and says what they mean.
- **In a chat** the agent can list your jobs, change anything about one (the schedule included), pause, resume and delete, on your word.
- **Cost and the limit.** A run's cost goes on the account's usage record as a job, so the admin sees it in the totals, by mode and by model, and as its own figure ("Scheduled jobs ran 12 times and cost $0.41 of this"). The usage limit holds: at the limit "Run now" is refused, a job whose time comes is skipped with a notice (once a day, not on every turn), and a run that reaches the limit stops at its next step.
- **How it runs.** A clock inside the server looks every 20 seconds for jobs whose time has come (`web/src/lib/jobs/scheduler.ts`, started from `src/instrumentation.ts`), takes each one by moving it on to its next run, and runs up to three at once (`web/src/lib/jobs/run.ts`). A job that came due while the server was down runs once when it is back. This needs the one always-on server the running chats already need.
- **Where the code is.** `web/src/lib/jobs/` (types, schedule, run, scheduler), `web/src/lib/db/jobs.ts`, `web/src/lib/agent/tools/jobs.ts` (the agent's four tools), `web/src/app/api/jobs/`, `web/src/app/jobs/` and `web/src/components/jobs/` (the page), `web/src/components/widgets/job-card.tsx` (the card in a chat).
- `pnpm test:jobs 3000` checks all of it against the running server with a throwaway account: a job made in a chat, Run now, the email, the notice, the usage record, edits from the page and by the agent, a job that runs by itself a minute later, and the usage limit.

## Notifications

Beryl tells you when something needs you or is ready. In the app a notice always shows (the bell, and a note that pops up). An email follows only when it is worth one.

- **What you are told about.** A chat you asked to hear about has finished ("This is taking a while. Notify me when it's done" appears above the message box after 30 seconds of work). The live browser in the desktop app is waiting for you: an approval, a sign-in, a code. A question the agent has for you in a chat you asked to hear about. A job has run, or could not.
- **When an email is sent.** Never when the account has switched email off, or switched that kind off. For chats and the browser, only when you are away: a window of yours that is visible and in front says so every 25 seconds, and while one has said so in the last 70 seconds you are "here" and get no email. For the browser the server also waits a minute first, and sends nothing if you have dealt with it meanwhile. A job's result is always emailed (unless switched off): the email is what the job is for.
- **Settings** (account menu, Notifications): email on or off, each kind on or off, and whether to hold emails while Beryl is open. Emails go to the account's own address.
- **Sending** goes through Resend (`web/src/lib/email/resend.ts`), from `notifications@beryl.zeroanomaly.tech`. Every email is one layout (`layout.ts`); what the agent wrote is turned into HTML that email programs show properly, with raw HTML from the web dropped (`markdown.ts`). Without `RESEND_API_KEY` nothing is sent and everything else works.
- **Where the code is.** `web/src/lib/notifications/` (`notify.ts` is the one place that decides about an email; `chat.ts` knows when a chat is really finished), `web/src/lib/presence.ts`, `web/src/lib/db/notifications.ts`, `web/src/app/api/notifications/`, `web/src/components/notifications/`.
- `pnpm test:notify 3000` checks the rules against the running server with two throwaway accounts: the settings, presence, a finished chat (emailed when away, not when here, nothing after Stop), the browser waiting (one notice, an email a minute later only if still waiting and away), reading and clearing, and that another account sees none of it.

## Modes and effort

The user does not pick a model. They pick a **mode**, from the quickest to the most capable, and turn an **effort** dial. Both sit in one control in the message box, with an icon per mode (lightning for the quickest, a brain for the ones that think longest).

| Mode | For | Model behind it (server only) |
|---|---|---|
| Ultra fast | The quickest answers, everyday tasks | Gemini 4 Hydrogen |
| Fast | Quick, with more care over the details | Claude Sonnet 5.5 |
| Smart | Thinks things through; the default | Claude Opus 5.5 |
| Expert | The deepest reasoning, hard questions | Gemini 4 Carbon |

- **Effort** has four steps: Quick (the default), Balanced, Thorough, Max. On the server a step becomes the model's own thinking setting (`effort` for Claude: low, medium, high, xhigh; `thinkingLevel` for Gemini, where Carbon stops at high). `pnpm smoke options` sends every model behind a mode every step of the dial; all are accepted (14 November).
- **Nothing in the interface names a model or a thinking setting.** The interface imports `lib/agent/modes.ts` (names, blurbs, the dial) and `lib/agent/stats.ts` (what an answer used), never `lib/agent/models.ts`, where the one table that ties a mode to a model lives. The request carries `mode` and `effort`; the server picks the model; what comes back with an answer names the mode. Conversations saved before modes existed carried model names in their figures: the server exchanges them for the mode on the way out (`lib/db/conversations.ts`). Errors about a missing key say "this mode is not set up", and the detail goes to the server's log.
- **Voice and sift are not modes.** Live calls, voice input and the decision model run on their own models whatever is picked. The mode and effort still decide how far the tools go when a call runs them.
- **Which modes an account has is the admin's choice** (see Accounts). The server checks it on every request: a mode the account does not have becomes the best one it has (`pickMode`).

## Research depth

How far research goes follows the mode and the effort dial together (`web/src/lib/agent/depth.ts`). The same table decides the size of the deep research team, how much each sub-agent searches and reads, how long the report is, and how widely the main agent searches on its own.

| Mode | Quick | Balanced | Thorough | Max |
|---|---|---|---|---|
| Ultra fast | Standard | Standard | Deep | Deep |
| Fast | Standard | Deep | Deep | Deeper |
| Smart | Standard | Deep | Deeper | Exhaustive |
| Expert | Deep | Deeper | Deeper | Exhaustive |

What each level did in a real run (research and report; the main agent's own steps come on top; measured 14 November):

| Level | Team | Exa searches | Pages checked | Sources kept | Report | Time | Cost |
|---|---|---|---|---|---|---|---|
| Standard | 3 | 9 | not counted | 24 | 394 words | 25 s | $0.12 |
| Deep | 6 | 36 | 234 | 101 | 786 words | 58 s | $0.42 |
| Deeper | 6, then 3 more | 92 | 681 | 239 | 1,337 words | 130 s | $1.05 |
| Exhaustive | 12, then 4 more | about 137 | 988 | 480 | 1,745 words | 149 s | about $1.50 |

- **Standard** is what it was before: two to four sub-agents, a 200 to 350 word report, 30 to 60 seconds.
- **From Deep up**, each search carries two or three wordings, and the decision model checks every page a search returns against the sub-agent's angle before the sub-agent sees it, so the hundreds of pages are filtered, not just counted. Sub-agents read their key pages in full.
- **Deeper and Exhaustive** run a second round: the main model reads the first round's findings and sends a few more sub-agents to close gaps and settle contradictions (in the Exhaustive test it caught two researchers reporting different figures for the same tax and sent one to settle it).
- **Limits.** Every level has a time budget; when it runs low the sub-agents are told to write up, and one that is cut short has its findings written from its notes. Exa requests go through a gate (8 searches in flight, 8 starts a second) so a team of twelve stays inside Exa's limit. About two thirds of the cost is Exa.
- **The main agent** also asks for more results per search and reads more pages at higher levels, and is told to call deep research once and build on its report.

## Sift: find the ones that fit

Most requests to a butler are "find me one that…": a dinner that is quick, vegetarian and one pan; a junior job that is hybrid and fine with English; a study that is a randomized trial in older adults. An agent that reads pages one at a time gets through four or five. Sift reads about forty, and checks every one against every wish.

- **How it works.** The agent turns the request into wishes, one condition each ("the recipe takes 30 minutes or less"). Exa returns up to 100 pages with their text in one search (`sift` asks for about 40, or about 100 when asked to be thorough), including the passages further down each page that bear on the wishes. One request to Gemini's decision model (`gemini-decision-1`) then answers, for every page and every wish, yes, no or "the page does not say", with how sure it is. A decision model writes nothing: it returns probabilities, so a thousand questions take about as long as one and cost almost nothing ($0.10 per million input tokens, no output).
- **What it shows.** A grid: one row per page, one column per wish, best fit first, in three bands (meets every wish, misses one, the rest). A solid mark is a sure answer, a dashed one is "probably", a question mark is "the page does not say". Tapping a wish keeps only the pages that meet it. On a phone each page is a card and the marks are labelled chips. Pages that turn out not to be one such thing (a list, a shop front, an empty page) are left out and counted.
- **What it costs and how long it takes** (measured 14 November): 40 pages against 4 or 5 wishes is about 200 judgements in 0.7 to 1.3 seconds for under half a cent, plus about 3 cents for the Exa search. A thorough sift (100 pages, 600 judgements) took 2.8 seconds, 1.4 cents for the judging and 14 cents on Exa. A whole answer, typed, takes 8 to 14 seconds; in a call the grid is on screen about 3 seconds after the user stops speaking.
- **Where it is honest about its limits.** The judge only sees what Exa returned for each page, so a fact the page does not state comes back as "does not say", not as no, and the agent is told to say so. It fits where one page carries the facts: recipes, job ads, listings, reviews, courses, events, studies. It is the wrong tool for restaurants (opening hours and prices are rarely in the page text; `findPlaces` has them), flights, hotels and shop prices, and the agent is told that too.
- **Where the code is.** `web/src/lib/decisions/client.ts` (the Decisions API), `web/src/lib/agent/tools/sift.ts` (search, judge, rank), `web/src/components/widgets/sift.tsx` (the grid). `pnpm smoke decisions` checks that the decision model answers with your key.

## Voice

Voice runs on Gemini's Live API, whatever mode is picked for typed conversations. It works on the web, on a phone and in the desktop app, in any language, and it is built so that most tasks can be done by talking.

**Voice input.** A microphone button in the message box. Tap it and speak: the words appear in the box as they are spoken (the first ones in about a second and a half), and nothing is sent until the user presses Send, so they can read and correct what was heard. It uses `gemini-3.5-transcribe-live`, which sends its best guess while the user is still speaking and the finished sentence when they pause. Escape or a second tap stops it.

**Live call.** "Talk" in the message box, or "Talk to Beryl" on the first screen, starts a call: the call's own view takes the place of the conversation and the message box. The user talks, the agent talks back (`gemini-3.8-live`, speech in and speech out), and it calls the same tools as in a typed conversation while they talk. In testing the agent starts to answer about a second after the user stops speaking.
- **The view.** The Beryl stone shows who has the floor: it breathes while it listens, a ring widens with the user's voice, its facets light in turn while it works, and it swells with its own voice. Under it are the user's words and the agent's, which appear word by word as they are heard, not before. Whatever the tools find is laid out below as it arrives (the same cards, maps and charts as in a conversation), and the stone moves up out of the way. Mute, End and Type (to say something by keyboard) are large buttons at the bottom, where a thumb is.
- **The same conversation.** A call is another way of holding the conversation, not a separate thing. What the user said, what the agent said and every tool call with its result are written into the conversation's messages as they happen. The "Conversation" tab shows the call as a normal conversation while it is still going, with a bar to mute, end or go back; afterwards the conversation can be continued by typing, and a call started in an existing conversation carries on from what was said before.
- **Show, do not read.** In a call the screen carries the answer and the voice comments on it. Anything with more than one item in it (places, options, prices, steps, requirements) is put on screen as a widget and the agent says one or two sentences about it, naming at most its pick; it never reads a list aloud. After a plain web search it first puts what it found on screen (key facts, a comparison, or a list, table or chart) and only then speaks: the reminder to do so rides along with the search result, which is the last thing the model reads before deciding what to do next. It answers once per round of tools, however many ran together.
- **Nothing overlaps.** While there is nothing to look at, the stone has the stage. Once there is, the stone and a two-line caption (the newest words always in view) move into a strip of their own at the top and the results scroll in their own space underneath, so the two never share a place on the screen at any width. Wide widgets adapt: a comparison becomes stacked cards in a narrow column.
- **Interrupting.** Speaking over the agent stops its voice at once (so does a tap on the stone), and the conversation keeps only the words it had actually said. A tool that is running keeps running unless the agent's model cancels it.
- **Tools in a call.** The agent's "let me check" is spoken while the tool starts. Tools that search and read run on this app's server (`/api/voice/tool`), the user's location is read by their browser, and in the desktop app the live browser's steps run in the app under the same rules as ever: payment and passwords are refused, a sign-in is handed over and comes back when the user presses Done, and a step that commits the user waits for them to press Approve on screen. Saying yes aloud is not enough.
- **How it connects.** Sound goes straight between the browser and Gemini, not through this server. The server makes a short-lived token for each session (`/api/voice/token`) that is locked to the model, to what the agent is told and to the tools it may call, so the API key never reaches the browser and the interface cannot change the agent. A dropped connection picks the same session up again; Gemini ends a connection after about ten minutes and the call carries on over a new one.
- **Limits.** Voice needs `GOOGLE_API_KEY`, a microphone and a secure page (HTTPS, or localhost). On loudspeakers it relies on the browser's echo cancellation so the agent does not hear itself. In a call the agent does not ask its tap-to-answer questions or draw a plan card: it asks aloud. Usage is counted from what the browser reports when a session ends.

Code: `web/src/lib/voice/` (`audio.ts` the microphone and speaker, `live-socket.ts` the line to the Live API, `dictation.ts` voice input, `live-call.ts` the call, `server.ts` what the agent is told and which tools it gets, `models.ts` models and prices), `web/src/components/voice/` (the call's view and the stone), `web/src/app/api/voice/` (token, tool, usage).

## The live browser (step 2, desktop app only)

When the task is to do something on a site (reserve a table, fill a basket, take a booking through the provider's form, fill in an application, change something in an account), the agent opens a page in the browser inside the desktop app and works in it while the user watches. Nothing ever opens a browser outside the app: a link pressed in the chat opens in the app's own browser too, with the user in control.

**How it is put together.** The agent runs on the server; the browser is on the user's computer. So the agent's browser tools have no code on the server: when the agent asks for a step, the interface hands it to the app, the app's engine takes the step in the browser view and the page as it then stands goes back to the agent with the next request. The engine is `web/src/lib/browser/` (`session.ts`, `guard.ts`, `snapshot.ts`, `engine.ts`) bundled into `web/desktop/dist/engine.cjs`; it drives the view through a small bridge inside the app (`web/desktop/relay.cjs`) that speaks the Chrome DevTools Protocol on this computer only. No remote-debugging port is opened and the view is not started in automation mode, so it is an ordinary embedded browser (`navigator.webdriver` is false), and nothing about it is disguised: it tells sites it is Beryl on Chrome.

**What the user sees.** The browser opens beside the chat by itself: browser on the left, chat on the right, with a divider to drag. It can fill the window (the chat is then one tap away) or be hidden; hiding it does not close it, the agent carries on, and a globe button in the top bar brings it back. The agent's pointer glides to what it is about to press, the target gets a ring and a caption ("Clicking 'Reserve a table'"), typed text appears as it is typed. The chat shows the same steps as a trail.

**What stays with the user.** Three things, enforced in code (`web/src/lib/browser/guard.ts`) inside the app, where the page is, not left to the model:
- **Payment: never.** The agent cannot type into card, bank or security-code fields, cannot press a button that pays, and cannot submit a form that holds card fields. It does nothing at all on payment providers' pages. It takes the task to the payment page and hands it over; the user may pay there themselves.
- **Passwords, one-time codes and human checks: the user's.** The agent cannot type into them. It hands the page over with a "your turn" card; the user clicks and types straight into the page, inside the app, then hands it back. A human check is only handed over when it is in the way: the whole page is the check, or the form the task needs carries it. Many sites keep one in a newsletter form at the foot of every page; the agent is told where a check is and leaves those alone.
- **Commitment: with approval.** Anything that submits, sends, books, orders, posts, deletes, signs up or accepts terms stops for a yes. The step waits inside the app: the card in the chat says exactly what will happen, the button is ringed in the browser, and nothing runs until the user presses Approve. Decline, Stop, or closing the browser all mean no.
Reading, navigating, searching, filling in a form, adding to a basket and refusing cookies need no approval.

**Who is driving.** While the agent drives, the user's clicks and keys do not reach the page (a click says "Beryl is driving, press Take over"). After Take over, or when the agent hands the page over, everything the user does goes to the page directly and nowhere else. The app is a page with a browser inside it, so the bridge takes care of input: the agent's clicks are given to the view itself, and its key presses are only sent once the view holds the keyboard, which goes back to the chat box afterwards, so the agent's typing can never land in the chat.

**What the agent can read.** It reads the page as text (the accessibility tree, cut down to what is in view), never as a picture unless it asks for one. Values of password, card and code fields are removed before the text reaches the model, including ones the user typed while in control. What the user types during a hand-over goes to the page and nowhere else: it is not logged or stored. `browserLook` gives the model a picture when the text is not enough (a canvas, a seat map); fields that hold secrets are painted over, payment and sign-in pages are never pictured, and the picture is not kept in the saved conversation.

**Sign-ins.** Kept by the desktop app on the user's computer, in a store per account, so two accounts on one computer do not share them. They stay until "Forget sign-ins" in the browser's menu. They are never sent to the server.

**Layout and windows.** A narrow view (the split layout) is laid out at desktop width and drawn smaller, so sites do not switch to their phone layout; full screen shows the page at its real size. A link that wants a new tab opens in the same view. A real pop-up window (some sign-ins open one) opens as a small window of the app, with the same sign-ins and nothing of the agent attached. Pages are refused location, camera, microphone and notifications. The agent keeps working while the app is behind other windows.

**Tidying up.** The agent closes the browser when the task there is finished and nothing is left for the user on the page, or when asked; the pane closes with it. A new, unrelated task starts with a fresh tab. Each step is shown once: taking over, handing back, hiding and reopening never replay the last one.

**Assumptions and limits, stated plainly.**
- The safety rules are patterns (field names, button texts in seven languages, known payment hosts). They err towards asking, and they can miss an unusual page. The approval step is the second line: a miss there asks one time too many rather than one too few.
- The rules run in the desktop app on the user's computer. They protect the user from the model, not from someone who rebuilds the app.
- Sites can see that the browser is Beryl and may refuse it; human checks are handed to the user, never solved.
- One browser per app window.

**Edit, retry, copy.** Hovering a message you sent shows copy and edit; editing turns it into a text box, and resending replaces that message and everything below it. Under each answer are copy (the answer as markdown, plus the research report if there is one) and try again, which answers the same request afresh and also drops everything below. Both wait until the agent has finished or been stopped.

**Report export.** A finished research report has its own copy and download buttons in the card's header. Copy puts markdown and a formatted version on the clipboard, so it pastes with headings, tables and links into a document or an email. Download offers markdown, a self-contained web page, or the print dialog for a PDF; each holds only that report and its numbered sources (`web/src/lib/export.ts`).

**Accounts.** Sign-in is email and password, the same on web and desktop. There are two kinds of account. A user chats and runs tasks, and their conversations and browser sign-ins are theirs alone. The admin has all of that plus `/admin`: an overview (accounts, who was active, conversations, requests, tokens, cost split into LLMs, Exa, voice and decisions, day by day, by mode, by model and by web or desktop) and the accounts page (add an account, block and unblock, set a new password, delete). There is exactly one admin, named in `ADMIN_EMAIL` and `ADMIN_PASSWORD`; it is created when the server starts and nobody can be made admin through the interface. There is no public sign-up. Passwords are hashed with scrypt; a session is a random token in an httpOnly cookie, stored hashed, checked against the database on every request, so signing out, blocking or deleting takes effect at once.

**What an account may do, and see.** On the accounts page the admin sets three things per account, and they take effect on the account's next request:
- **Modes.** One or more of the four. A new account starts with only the quickest, Ultra fast. The mode picker offers only the account's modes.
- **Sees usage and cost.** Off for a new account. When it is off, the account sees the mode and the time under each answer and nothing else, and the server does not send the figures at all. When it is on, each answer shows its Exa calls and cost, and the bar above the conversation shows the conversation's total; both open a breakdown by kind: LLMs (the answering model and its helpers), Exa, Voice, Decisions (the checks sift makes). No model is named.
- **Usage limit.** An amount in US dollars, or none. It is compared with everything the account has used since it was made. Once that reaches the limit, new requests are refused (chat, calls and the tools of a call answer 402), a task that is running stops at its next step with its figures recorded, the message box gives way to a note, and a dialog says why and offers to email the administrator. Raising or removing the limit lets the account carry on ("Check again" in the dialog, or the next page load). The admin has every mode, sees usage and has no limit.

**What the admin sees.** Nothing is hidden on the admin's side. The Usage page (`/admin`) splits spending into the same four kinds, day by day, and lists it by mode and by model. From the accounts page, pressing an account's cost opens that account's usage by kind, by mode and by model.

**Saved conversations.** Every conversation is saved to the account in Postgres as it happens, marked with where it was started (web or desktop), and listed in a sidebar on the left (a drawer on phones) that can be closed. Conversations can be reopened, renamed and deleted from either kind of client, and continued only where they were started. Preferences (theme, mode and effort, the sidebar, the place) stay in the browser.

**Exact location.** When a task depends on where the user is ("near me", "the closest"), the agent shows a card asking to share their location. Accepting triggers the browser's own permission prompt; the position is saved in the browser, named through a reverse lookup (`/api/geo/reverse`, coordinates rounded to about 100 m), sent with later messages, and used by Exa's "near me" search. The map then shows the user's position, each place's distance and directions from where they are. If the browser blocks it or the user says no, the agent carries on with the approximate place or one the user types, and does not ask again. The location button in the message box turns it on and off at any time. Places also show whether they are open right now, worked out in the place's own time zone.

## How it is built

- **Stack:** Next.js 16, React 19, Tailwind 4, shadcn/ui, Vercel AI SDK 7, Postgres through Drizzle. One server for web and desktop; the desktop shell is Electron.
- **Sift:** Gemini's Decisions API (`gemini-decision-1`) called over HTTP from the server, with the same key as the other Gemini models.
- **Voice:** Gemini's Live API straight from the browser, with short-lived tokens from the server (`@google/genai` on the server only). `gemini-3.8-live` for calls, `gemini-3.5-transcribe-live` for voice input.
- **Models:** Claude (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.2) through Claude Platform on AWS (`@ai-sdk/anthropic-aws`) and Gemini (4 Carbon, 4 Hydrogen) through Google AI Studio. Four of them stand behind the four modes (`MODE_MODEL` in `lib/agent/models.ts`); the user switches mode, per message if they like, never model. Sub-agents and extraction run on the fast model of the same family (Haiku 5.5 or Gemini 4 Hydrogen). The thinking settings differ by family and by model (Gemini 4 rejects the "minimal" level; only Haiku lets Claude's thinking be switched off), so they are decided per model and job in one file, `web/src/lib/agent/options.ts`. Prices are in `web/src/lib/agent/models.ts`; Gemini 4 Carbon's list price doubles on 1 Dec 2026.
- **Why the AI SDK and not Pydantic AI or a hand-written loop:** in short, one codebase, and each tool's output type is the widget's input type.
- **Code map** (all under `web/src`):
  - `lib/widgets/types.ts`: the contract between tools and widgets.
  - `lib/exa/client.ts`: the Exa client (search, contents, agent runs), with cost tracking and a 5-minute cache.
  - `lib/decisions/client.ts`: the client for Gemini's Decisions API (many closed questions about one input, answered with probabilities).
  - `lib/agent/modes.ts`: the modes and the effort dial, as the interface knows them. `lib/agent/models.ts`: the models and which one stands behind each mode (server side). `lib/agent/options.ts`: what each model is sent at each step of the dial. `lib/agent/depth.ts`: how far research goes at each mode and effort. `lib/agent/stats.ts`: what an answer used, by kind.
  - `lib/db/cap.ts`, `lib/usage-cap.ts`, `lib/usage-cap-client.ts`, `app/api/usage`: the usage limit, on the server and as the interface learns of it.
  - `lib/agent/tools/`: the agent's tools. `lib/agent/instructions.ts`: the system prompt.
  - `app/api/chat/route.ts`: the agent loop, usage metadata, context trimming, prompt caching.
  - `lib/client-kind.ts`: web or desktop, and the header that tells the server which is asking.
  - `lib/agent/tools/index.ts`: which tools each kind gets (`createTools`); `lib/agent/instructions.ts`: what each kind is told it can do.
  - `lib/browser/`: the live browser's engine, which runs in the desktop app (`session.ts` the browser, `guard.ts` the rules, `snapshot.ts` what the model reads, `engine.ts` the door the interface knocks on, `protocol.ts` and `tool-inputs.ts` the shapes shared with the server and the interface, `client.ts` and `desktop.ts` the interface's side). `components/browser/`: the pane.
  - `desktop/` (beside `src`): the desktop app. `main.cjs` is the window and the wiring, `relay.cjs` the bridge between the engine and the browser view, `preload.cjs` everything the interface may ask of the app, `offline.html` the page shown when the server cannot be reached, `build.mjs`, `run.mjs` and `pack.mjs` build, start and package it.
  - `lib/db/`: the schema (`schema.ts`), the connection, migrations at start, conversations, usage and the admin's figures. `drizzle/`: the SQL migrations. `lib/auth/`: passwords, sessions, the cookie, `requireUser()` and `requireAdmin()`. `proxy.ts`: sends signed-out visitors to `/login`.
  - `app/login`, `app/admin`, `components/account/`, `components/admin/`: the sign-in screen, the account menu and the admin's pages.
  - `components/butler/`: the chat interface (`mode-picker.tsx` the mode and effort control, `usage.tsx` what an answer and a conversation used, `cap.tsx` the usage limit's dialog and note, `top-bar.tsx` the bar with the conversation's name). `components/widgets/`: the widgets. `WIDGETS.md` at the app root is the guide for building one.

## Research

The research done before the build (a playbook on Exa's API as of 13 Nov 2026, the notes behind it, and a comparison of agent runtimes) is not in the repository. It is kept on the authors' machines, in `exa/reports/` and `exa/research_notes/`, which git ignores.

## Open questions

- **Two projects, one team of two.** Can one team submit two projects (Dock and this), and is each eligible for the main prize? Someone has to be at each table during peer review. Ask the organisers.
- **Deployment.** Live on Google Cloud since 14 November: one always-on Cloud Run instance, Cloud SQL, a bucket for the installers, and a load balancer for `beryl.zeroanomaly.tech`. What exists, how to deploy and what is not done are in `DEPLOYMENT.md`. The container is `web/Dockerfile`; `/api/health` says whether the server and its database are up.
- **Google sign-in inside the desktop app.** Built so that it should work (an ordinary embedded browser, not an automation one), but only a person signing in can show that Google accepts it. If Google objects to the engine being connected while the user types, the next step is to disconnect the bridge for as long as the user is in control.
- **Voice with a real person.** Tested end to end with a recording fed to the microphone. Not yet tried with a person talking over loudspeakers (echo), on a phone, or in a browser tab other than the desktop app's.
- **The installers are not signed or notarised.** They are built on a Mac for Apple silicon, Intel Macs and Windows; only the Apple silicon one has been run.
- **Accounts.** A user cannot change their own password and there is no "forgot password": the admin sets a new one.
- **Hotels are slow** (up to a minute through Jinko). A faster source would improve the trip demo.
- **Not yet checked on a phone.** The layout is responsive, but nobody has used it on one.
