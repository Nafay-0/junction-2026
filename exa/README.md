# Baton: the Exa "Internet Butler" project

**Owner:** Asadullah (`Asadullah378`). **Status (Sat 14 Nov, 09:45):** steps 1 and 2 are built and run locally. The live browser works end to end on a test site and on real shops and booking pages, in three forms: a hidden Chrome of the app's own (the web version), a window of the user's own Chrome where they are already signed in (run by the user on 14 Nov: it worked, but it takes a one-time setting in Chrome), and, new, **a desktop app with a real browser inside its own window** (`pnpm desktop`), where the user signs in by simply signing in. The desktop app passes its end-to-end test and a real agent task; nobody has yet signed in to Google inside it. Not deployed yet.

Baton is a general web agent for Exa's challenge "The Internet Butler". You hand it a task; it searches the live web with Exa, answers with live widgets instead of plain text (a map, fare cards, price charts, a gallery, a research report), and ends with buttons that take the task as far as it can go. The name is set in `web/src/lib/brand.ts`, with the logo's shapes: a baton is what a relay runner passes on (you pass a task, it is handed back for the step that is yours) and what a conductor holds. It was called Hovi until 14 Nov; storage keys and `HOVI_*` variables keep that prefix so nothing saved is lost.

Dock, the Valio Aimo project, is a separate project in this repo, owned by Nafay. It lives in `/web` and `/infra` at the repo root. Everything for Baton lives in `exa/`.

## The plan, in three steps

1. **Agent with live widgets (built).** Exa is read-only: search, read, structured data. Widgets, sub-agents, parallel tools, a visible plan, clarifying questions, model switching, usage and cost tracking.
2. **Live web actions (built).** The agent acts in a real browser the user watches live, hands the page over for sign-ins and human checks, asks for approval before anything that commits the user, and never pays.
3. **Phone app and voice (after that).** Installable web app, voice input, more autonomy (Exa Monitors that keep watching).

## Run it

```bash
cd exa
cp .env.example .env.local   # fill in the five keys
cd web
pnpm install
pnpm dev                     # http://localhost:3000
pnpm desktop                 # the same app as a desktop window with a real browser inside
```

`pnpm desktop` starts the server itself if nothing answers on port 3000. If it is already running on another port, say which: `BATON_PORT=3100 pnpm desktop`.

- `pnpm smoke` checks that Claude (through AWS) and Gemini answer with your keys. `pnpm smoke options` sends one small request per model and job (agent, sub-agent, extraction) with the exact thinking settings the app uses, so a setting a model rejects shows up there and not in front of a user.
- `pnpm test:guard` checks the live browser's safety rules as a table (no browser needed). `pnpm test:browser 3000` runs them end to end against a pretend shop (`/dev/sandbox.html`) with the dev server running: card numbers, passwords and pay buttons must be refused, commitments must ask first.
- `pnpm test:own 3000` checks the own-Chrome mode against a stand-in Chrome the test starts itself (its own window, live pictures, the other tabs untouched). It never touches the real Chrome.
- `pnpm test:desktop 3000` starts the real desktop app in a throwaway profile and checks, from inside it, the browser view, the agent's clicks, keys and scrolling, the safety rules, the user's own typing, hiding and closing. `BATON_TEST_CHAT="<request>"` adds a real task for the agent; `BATON_TEST_SHOTS=<folder>` saves pictures of the window.
- `/dev/browser` shows the live browser panel driven by a script, with a button for every state.
- `/dev/widgets` shows every widget with sample data. `?only=flights,hotels` narrows it, `?loading=1` shows loading states, `?still=1` turns animation off.
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

## The live browser (step 2)

When the task is to do something on a site (reserve a table, fill a basket, take a booking through the provider's form, fill in an application, change something in an account), the agent opens a real Chrome on the server and works in it while the user watches.

**What the user sees.** The browser opens beside the chat by itself: browser on the left, chat on the right, with a divider to drag. It can fill the window (the chat is then one tap away) or be closed; on a phone it is a full-screen sheet. The agent's pointer glides to what it is about to press, the target gets a ring and a caption ("Clicking 'Reserve a table'"), typed text appears as it is typed. The chat shows the same steps as a trail.

**What stays with the user.** Three things, enforced in code (`web/src/lib/browser/guard.ts`), not left to the model:
- **Payment: never.** The agent cannot type into card, bank or security-code fields, cannot press a button that pays, and cannot submit a form that holds card fields. It does nothing at all on payment providers' pages. It takes the task to the payment page and hands it over; the user may pay there themselves.
- **Passwords, one-time codes and human checks: the user's.** The agent cannot type into them. It hands the page over with a "your turn" card; the user types straight into the live browser, then hands it back. A human check is only handed over when it is in the way: the whole page is the check, or the form the task needs carries it. Many sites keep one in a newsletter form at the foot of every page; the agent is told where a check is (the whole page, a form on screen, a form elsewhere) and leaves those alone. `/dev/sandbox.html#newsletter` has a pretend one.
- **Commitment: with approval.** Anything that submits, sends, books, orders, posts, deletes, signs up or accepts terms stops for a yes. The card says exactly what will happen, the button is ringed in the live browser, and nothing runs until the user approves. Approvals are signed by the server, so one cannot be forged by editing the conversation.
Reading, navigating, searching, filling in a form, adding to a basket and refusing cookies need no approval.

**What the agent can read.** It reads the page as text (Chrome's accessibility tree, cut down to what is in view), never as a picture. Values of password, card and code fields are removed before the text reaches the model, including ones the user typed while in control. What the user types during a hand-over goes to Chrome and nowhere else: it is not logged or stored.

**Sign-ins.** Kept in a browser profile per visitor (`~/.hovi/browser-profiles/` on the computer running the app, outside the project) so the user signs in once. "Forget sign-ins" in the browser's menu wipes it.

**The desktop app: a real browser inside Baton.** The web version has to keep its browser on a server and show pictures of it, and a browser started that way is an automation browser, which Google will not let anyone sign in to. `pnpm desktop` opens Baton as a desktop app (Electron, `web/desktop/`) in which the live browser is not pictures but the browser itself: a view inside the app's window, the way the browser pane works in Claude's own desktop app. The user clicks and types straight into it, so signing in to Google or anything else is just signing in, once; the sign-ins are kept by the app until "Forget sign-ins". The agent works in the same view through a small bridge inside the app (`web/desktop/relay.cjs`) that speaks the Chrome DevTools Protocol to the app's server on this computer only, behind a random address. No remote-debugging port is opened and the view is not started in automation mode, so it is an ordinary embedded browser, and nothing about it is disguised: it tells sites it is Baton on Chrome. Everything else is the same code as the web version: the same pane, the same pointer and captions drawn over the page, the same rules in `guard.ts`.
- While the agent drives, the user's clicks and keys do not reach the page (a click says "Baton is driving, press Take over"). After Take over, or when the agent hands the page over, everything the user does goes to the page directly and nowhere else.
- The app is a page with a browser inside it, so input needs care, and the bridge takes it: the agent's clicks are given to the view itself (Chromium would aim them at the window, where the interface's own layer lies on top), and its key presses are only sent once the view holds the keyboard, which is handed back to the chat box afterwards, so the agent's typing can never land in the chat.
- A narrow view (the split layout) is laid out at desktop width and drawn smaller, so sites do not switch to their phone layout; full screen shows the page at its real size.
- Hiding the pane does not close the browser: the view is parked out of sight, the agent carries on, and a globe button in the top bar brings it back. The agent also keeps working while the app is behind other windows.
- A link that wants a new tab opens in the same view. A real pop-up window (some sign-ins open one) opens as a small window of its own, with the same sign-ins and nothing of the agent attached. Pages are refused location, camera, microphone and notifications.
- The agent still does nothing on identity providers' sign-in pages, types no passwords or codes, and never pays.

**Working in the user's own Chrome.** Google refuses a sign-in typed into a browser that software is driving, and Chrome reports that to every site. We do not hide it. Instead the user can choose "Use my own Chrome" (the live browser's menu, or the button on a sign-in hand-over): the agent then works in a window of its own inside the Chrome the user already uses, where they are signed in to Google and everything else, so there is no sign-in step at all. It uses Chrome's own remote-debugging permission (Chrome 144 and later): the user turns it on once at `chrome://inspect/#remote-debugging` and presses Allow when the app connects, and Chrome shows that it is being controlled. The app works only in its own window; the user's other tabs are never read, touched or closed, and closing "the browser" closes that window only. The live view shows the window as before, and the same rules hold. A hand-over in progress moves with the page when the user switches. The agent still does nothing on the sign-in pages of identity providers (Google, Microsoft, Apple, bank identification), not even picking an account. This needs the app and the user's Chrome on the same computer; on a hosted server set `HOVI_OWN_CHROME=0`. An earlier attempt, signing in through a separate plain Chrome window, was removed: the Google session did not survive the switch and it was clumsy.

**Tidying up.** The agent closes the browser when the task there is finished and nothing is left for the user on the page, or when asked; the pane closes with it and the conversation list returns. It leaves the browser open when the page is waiting for the user. A new, unrelated task starts with the old tabs closed.

**When the text is not enough.** `browserLook` gives the model a picture of the page (a canvas, a seat map, a control that does nothing for no visible reason). Fields that hold secrets are painted over, and no picture is taken of payment or sign-in pages. A page's own message boxes are answered for it (a notice is acknowledged, a question gets "no" while the agent drives) and reported to the model.

**Assumptions and limits, stated plainly.**
- The browser runs on the machine that runs the app (a real Chrome through Playwright). That rules out serverless hosting; a public demo needs a small server or a tunnel to a laptop. `BrowserSession` is the one place a hosted browser would plug in.
- The built-in browser is a hidden Chrome that sends the same browser name a visible Chrome would. Nothing else is disguised: Chrome reports that it is being driven and we leave that alone, so sites can tell. The agent does not solve CAPTCHAs: it detects the common ones and hands them to the user. Some sites refuse a driven browser altogether; the agent then says so and gives the link.
- In the user's own Chrome the agent has a signed-in browser in front of it. It is told to treat what it sees as private and do only what the task needs, and every rule above applies, but the trust involved is larger: Chrome's permission covers the whole browser, even though the app confines itself to its own window. Chrome's window may sit behind others, where Chrome stops sending pictures by itself, so the live view there is refreshed by taking pictures (a few a second while something happens, slower when idle).
- The safety rules are patterns (field names, button texts in seven languages, known payment hosts). They err towards asking, and they can miss an unusual page. The approval step is the second line: a commitment the patterns miss is still one the model is told to mark.
- One browser per visitor, at most four at once on a server; idle ones close after twenty minutes.
- Anyone who knows a visitor's browser id (a random value in their browser's storage) could watch that browser. Fine for a demo, not for production: that needs accounts.

Code: `web/src/lib/browser/` (`protocol.ts` the contract, `session.ts` the browser, `guard.ts` the rules, `snapshot.ts` what the model reads, `client.ts` the interface's side), `web/src/components/browser/` (the panel), `web/src/lib/agent/tools/browser.ts` (the agent's four tools), and the approval policy in `web/src/app/api/chat/route.ts`.

**Edit, retry, copy.** Hovering a message you sent shows copy and edit; editing turns it into a text box, and resending replaces that message and everything below it. Under each answer are copy (the answer as markdown, plus the research report if there is one) and try again, which answers the same request afresh and also drops everything below. Both wait until the agent has finished or been stopped.

**Report export.** A finished research report has its own copy and download buttons in the card's header. Copy puts markdown and a formatted version on the clipboard, so it pastes with headings, tables and links into a document or an email. Download offers markdown, a self-contained web page, or the print dialog for a PDF; each holds only that report and its numbered sources (`web/src/lib/export.ts`).

**Saved conversations.** Every conversation is saved as it happens and listed in a sidebar on the left (a drawer on phones) that can be closed. Conversations can be reopened, renamed and deleted, and the one that was open comes back after a refresh. They are stored in the browser's IndexedDB (`web/src/lib/conversations.ts`): there is no account and no server database, so they do not follow the user to another device.

**Exact location.** When a task depends on where the user is ("near me", "the closest"), the agent shows a card asking to share their location. Accepting triggers the browser's own permission prompt; the position is saved in the browser, named through a reverse lookup (`/api/geo/reverse`, coordinates rounded to about 100 m), sent with later messages, and used by Exa's "near me" search. The map then shows the user's position, each place's distance and directions from where they are. If the browser blocks it or the user says no, the agent carries on with the approximate place or one the user types, and does not ask again. The location button in the message box turns it on and off at any time. Places also show whether they are open right now, worked out in the place's own time zone.

## How it is built

- **Stack:** Next.js 16, React 19, Tailwind 4, shadcn/ui, Vercel AI SDK 7. One app, one deployment.
- **Models:** Claude (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.2) through Claude Platform on AWS (`@ai-sdk/anthropic-aws`) and Gemini (4 Carbon, 4 Hydrogen) through Google AI Studio, switchable per message. Sub-agents and extraction run on the fast model of the same family (Haiku 5.5 or Gemini 4 Hydrogen). The thinking settings differ by family and by model (Gemini 4 rejects the "minimal" level; only Haiku lets Claude's thinking be switched off), so they are decided per model and job in one file, `web/src/lib/agent/options.ts`. Prices are in `web/src/lib/agent/models.ts`; Gemini 4 Carbon's list price doubles on 1 Dec 2026.
- **Why the AI SDK and not Pydantic AI or a hand-written loop:** see `research_notes/Agent runtime choice/`. Short version: one codebase, and each tool's output type is the widget's input type.
- **Code map** (all under `web/src`):
  - `lib/widgets/types.ts`: the contract between tools and widgets.
  - `lib/exa/client.ts`: the Exa client (search, contents, agent runs), with cost tracking and a 5-minute cache.
  - `lib/agent/tools/`: the 24 tools. `lib/agent/instructions.ts`: the system prompt.
  - `app/api/chat/route.ts`: the agent loop, usage metadata, context trimming, prompt caching.
  - `lib/browser/`: the live browser (`session.ts` drives it in any of its three forms, `guard.ts` holds the rules, `snapshot.ts` turns a page into text). `components/browser/`: the pane; `desktop-view.tsx` is the real view in the desktop app, `browser-view.tsx` the streamed one.
  - `desktop/` (beside `src`): the desktop app. `main.cjs` is the window, `relay.cjs` the bridge between the agent and the browser view, `preload.cjs` what the interface may ask of the app, `run.mjs` the launcher.
  - `components/butler/`: the chat interface. `components/widgets/`: the widgets. `WIDGETS.md` at the app root is the guide for building one.

## Research

- `reports/Exa Internet Butler playbook.md`: Exa's API as of 13 Nov 2026, costs and how to stand out. Read it before touching the Exa calls; Exa changed a lot in 2026.
- `research_notes/`: the notes behind it, and the runtime comparison.

## Open questions

- **Two projects, one team of two.** Can one team submit two projects (Dock and this), and is each eligible for the main prize? Someone has to be at each table during peer review. Ask the organisers.
- **Deployment.** Not done. The app needs a public address for the submission's demo link and for phones at the table. With the live browser it must be a server that can run Chrome (or a tunnel to the laptop), not a serverless host.
- **Google sign-in inside the desktop app.** Built so that it should work (an ordinary embedded browser, not an automation one, as in Claude's desktop app), but only a person signing in can show that Google accepts it. If Google objects to the agent being connected while the user types, the next step is to disconnect the agent's bridge for as long as the user is in control. Human checks are detected and handed to the user in every form of the browser.
- **The desktop app is run from the source** (`pnpm desktop`). It is not packaged as an installer, and it still needs the server on the same computer.
- **Hotels are slow** (up to a minute through Jinko). A faster source would improve the trip demo.
- **Not yet checked on a phone.** The layout is responsive, but nobody has used it on one.
