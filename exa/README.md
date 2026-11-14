# Beryl: the Exa "Internet Butler" project

**Owner:** Asadullah (`Asadullah378`). **Status (Sat 14 Nov, 12:16):** one platform in two forms, both running locally. The **web app** (also installable on a phone) signs people in, searches and reads the live web with Exa and answers with live widgets. The **desktop app** is the same interface in a window of its own with a real browser inside it, where the agent also acts on websites. Both now have **voice**: speak instead of typing (your words appear in the message box as you say them), or start a **live call** and talk with the agent while its tools run in the background. Accounts, conversations and usage are in Postgres; one admin account creates the others. Everything passes its end-to-end tests and real agent tasks, and the desktop app is packaged as `Beryl.app`. Not deployed yet; voice has been tested in the desktop app with a recorded question, not yet with a person at a real microphone or on a phone.

Beryl is a general web agent for Exa's challenge "The Internet Butler". You hand it a task; it searches the live web with Exa, answers with live widgets instead of plain text (a map, fare cards, price charts, a gallery, a research report), and takes the task as far as it can go. Beryl is a gemstone (emerald and aquamarine are beryl) whose crystals are six-sided, which is the logo. The name and the logo's shapes are set in `web/src/lib/brand.ts`. It was called Hovi, then Baton, until 14 Nov; the browser's storage keys keep the `hovi.` prefix so nothing saved is lost.

Dock, the Valio Aimo project, is a separate project in this repo, owned by Nafay. It lives in `/web` and `/infra` at the repo root. Everything for Beryl lives in `exa/`.

## The plan, in three steps

1. **Agent with live widgets (built).** Exa is read-only: search, read, structured data. Widgets, sub-agents, parallel tools, a visible plan, clarifying questions, model switching, usage and cost tracking.
2. **Live web actions (built, in the desktop app).** The agent acts in a real browser inside the app that the user watches, hands the page over for sign-ins and human checks, asks for approval before anything that commits the user, and never pays.
3. **Phone and voice (built).** The web version can be installed on a phone (it has a web app manifest and icons). Voice input and live calls work on both web and desktop. More autonomy (Exa Monitors that keep watching) is still to do.

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
cp .env.example .env.local   # the five keys, DATABASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD
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
- `pnpm smoke` checks that Claude (through AWS) and Gemini answer with your keys. `pnpm smoke options` sends one small request per model and job (agent, sub-agent, extraction) with the exact thinking settings the app uses.
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
| Images | Gallery with lightbox | Exa search with image links | 3 s |
| Research | Parallel sub-agents, then a sourced report | Exa search and contents, 3 to 4 sub-agents | 30 s |
| Anything else | Text with source pills | Exa search and contents | 5 to 10 s |

The model can also show a comparison table, key facts, a plan, clarifying questions (answered with taps) and action buttons (book, call, directions, calendar, email).

**Custom widget.** When none of the fixed widgets fits, the agent composes its own with the `showWidget` tool, block by block: charts (pie, donut, bar, stacked bar, horizontal bar, line, area, scatter, radar), stat tiles, tables, lists and timelines, progress bars, images, callouts and buttons. A button can open a link, copy text, or send a follow-up to the agent, so the widget can continue the task. For something no block can express (a calculator, a custom diagram) there is an `html` block: a self-contained fragment that runs in a sandboxed frame with no network access and the app's colours passed in. Blocks appear as the model writes them. The block shapes are in `web/src/lib/widgets/types.ts` ("Custom widget"), the tool in `web/src/lib/agent/tools/compose.ts`.

Every widget shows its sources. Every answer shows the model, the time, the number of Exa calls and the cost; the top bar adds them up for the conversation.

## Voice

Voice runs on Gemini's Live API, whatever model is picked for typed conversations. It works on the web, on a phone and in the desktop app, in any language, and it is built so that most tasks can be done by talking.

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

**Accounts.** Sign-in is email and password, the same on web and desktop. There are two kinds of account. A user chats and runs tasks, and their conversations and browser sign-ins are theirs alone. The admin has all of that plus `/admin`: an overview (accounts, who was active, conversations, requests, tokens, cost split into model, sub-agents and Exa, day by day, by model and by web or desktop) and the accounts page (add an account, block and unblock, set a new password, delete). There is exactly one admin, named in `ADMIN_EMAIL` and `ADMIN_PASSWORD`; it is created when the server starts and nobody can be made admin through the interface. There is no public sign-up. Passwords are hashed with scrypt; a session is a random token in an httpOnly cookie, stored hashed, checked against the database on every request, so signing out, blocking or deleting takes effect at once.

**Saved conversations.** Every conversation is saved to the account in Postgres as it happens, marked with where it was started (web or desktop), and listed in a sidebar on the left (a drawer on phones) that can be closed. Conversations can be reopened, renamed and deleted from either kind of client, and continued only where they were started. Preferences (theme, model, the sidebar, the place) stay in the browser.

**Exact location.** When a task depends on where the user is ("near me", "the closest"), the agent shows a card asking to share their location. Accepting triggers the browser's own permission prompt; the position is saved in the browser, named through a reverse lookup (`/api/geo/reverse`, coordinates rounded to about 100 m), sent with later messages, and used by Exa's "near me" search. The map then shows the user's position, each place's distance and directions from where they are. If the browser blocks it or the user says no, the agent carries on with the approximate place or one the user types, and does not ask again. The location button in the message box turns it on and off at any time. Places also show whether they are open right now, worked out in the place's own time zone.

## How it is built

- **Stack:** Next.js 16, React 19, Tailwind 4, shadcn/ui, Vercel AI SDK 7, Postgres through Drizzle. One server for web and desktop; the desktop shell is Electron.
- **Voice:** Gemini's Live API straight from the browser, with short-lived tokens from the server (`@google/genai` on the server only). `gemini-3.8-live` for calls, `gemini-3.5-transcribe-live` for voice input.
- **Models:** Claude (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.2) through Claude Platform on AWS (`@ai-sdk/anthropic-aws`) and Gemini (4 Carbon, 4 Hydrogen) through Google AI Studio, switchable per message. Sub-agents and extraction run on the fast model of the same family (Haiku 5.5 or Gemini 4 Hydrogen). The thinking settings differ by family and by model (Gemini 4 rejects the "minimal" level; only Haiku lets Claude's thinking be switched off), so they are decided per model and job in one file, `web/src/lib/agent/options.ts`. Prices are in `web/src/lib/agent/models.ts`; Gemini 4 Carbon's list price doubles on 1 Dec 2026.
- **Why the AI SDK and not Pydantic AI or a hand-written loop:** see `research_notes/Agent runtime choice/`. Short version: one codebase, and each tool's output type is the widget's input type.
- **Code map** (all under `web/src`):
  - `lib/widgets/types.ts`: the contract between tools and widgets.
  - `lib/exa/client.ts`: the Exa client (search, contents, agent runs), with cost tracking and a 5-minute cache.
  - `lib/agent/tools/`: the 24 tools. `lib/agent/instructions.ts`: the system prompt.
  - `app/api/chat/route.ts`: the agent loop, usage metadata, context trimming, prompt caching.
  - `lib/client-kind.ts`: web or desktop, and the header that tells the server which is asking.
  - `lib/agent/tools/index.ts`: which tools each kind gets (`createTools`); `lib/agent/instructions.ts`: what each kind is told it can do.
  - `lib/browser/`: the live browser's engine, which runs in the desktop app (`session.ts` the browser, `guard.ts` the rules, `snapshot.ts` what the model reads, `engine.ts` the door the interface knocks on, `protocol.ts` and `tool-inputs.ts` the shapes shared with the server and the interface, `client.ts` and `desktop.ts` the interface's side). `components/browser/`: the pane.
  - `desktop/` (beside `src`): the desktop app. `main.cjs` is the window and the wiring, `relay.cjs` the bridge between the engine and the browser view, `preload.cjs` everything the interface may ask of the app, `offline.html` the page shown when the server cannot be reached, `build.mjs`, `run.mjs` and `pack.mjs` build, start and package it.
  - `lib/db/`: the schema (`schema.ts`), the connection, migrations at start, conversations, usage and the admin's figures. `drizzle/`: the SQL migrations. `lib/auth/`: passwords, sessions, the cookie, `requireUser()` and `requireAdmin()`. `proxy.ts`: sends signed-out visitors to `/login`.
  - `app/login`, `app/admin`, `components/account/`, `components/admin/`: the sign-in screen, the account menu and the admin's pages.
  - `components/butler/`: the chat interface. `components/widgets/`: the widgets. `WIDGETS.md` at the app root is the guide for building one.

## Research

- `reports/Exa Internet Butler playbook.md`: Exa's API as of 13 Nov 2026, costs and how to stand out. Read it before touching the Exa calls; Exa changed a lot in 2026.
- `research_notes/`: the notes behind it, and the runtime comparison.

## Open questions

- **Two projects, one team of two.** Can one team submit two projects (Dock and this), and is each eligible for the main prize? Someone has to be at each table during peer review. Ask the organisers.
- **Deployment.** Not done. The server no longer runs a browser, so it can go on any host that runs Next.js, with a hosted Postgres; set `DATABASE_URL`, the admin's two variables and the model keys there, then package the desktop app with `BERYL_SERVER_URL` pointing at it. On a serverless host run `pnpm db:migrate` at deploy. The sign-in limiter is in memory, per server instance.
- **Google sign-in inside the desktop app.** Built so that it should work (an ordinary embedded browser, not an automation one), but only a person signing in can show that Google accepts it. If Google objects to the engine being connected while the user types, the next step is to disconnect the bridge for as long as the user is in control.
- **Voice with a real person.** Tested end to end with a recording fed to the microphone. Not yet tried with a person talking over loudspeakers (echo), on a phone, or in a browser tab other than the desktop app's.
- **The packaged app is not signed or notarised**, and has only been built for this Mac.
- **Accounts.** A user cannot change their own password and there is no "forgot password": the admin sets a new one.
- **Hotels are slow** (up to a minute through Jinko). A faster source would improve the trip demo.
- **Not yet checked on a phone.** The layout is responsive, but nobody has used it on one.
