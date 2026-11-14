# Browser suite and live-condition tests

Everything here runs against production builds started by the tests themselves, with a hermetic environment
(`e2e/support/start-server.mjs`: seed catalogue, partner off, Aiven off, no value from `.env.local`, operations
passcode `e2e-ops`). No provider key is set: the request reader and the store's agent are the scripted provider
(`DOCK_SCRIPTED_MODELS=1`, `DOCK_SCRIPTED_RECORDINGS=e2e/fixtures/recordings.json`, `DOCK_INTERPRET_MODEL` and
`DOCK_AGENT_MODEL` = `scripted:e2e`; src/server/agent/scripted.ts streams tool calls for the agent), every other model
(photo reader, assistant, memory writer) has none and says so. Voice is on with test-only scripted tokens
(`DOCK_VOICE_SCRIPTED=1`, refused when `DOCK_PUBLIC_URL` or `VERCEL` is set): the server reserves the line and mints a
token locally, and the browser's Gemini Live socket is answered by the test (`page.routeWebSocket`). Zero model spend. Nothing touches the public deployment. Defects found are written as `test.fail` tests in the specs (each with steps, cause and file) and in the test-infra report on branch `claude/test-infra`.

## Commands (from `web/`)

| Command | What | Time on a laptop |
|---|---|---|
| `pnpm test:predeploy` | typecheck, unit tests, build, `pnpm demo`, QA harness core run, browser demo paths on Chromium phone + WebKit phone | 8-10 min |
| `pnpm test:full` | lint, typecheck, unit, build, `demo`, `demo:mcp`, `demo:all --seed`, `crash:reproduce`, QA harness, every browser project, model/partner failure scenarios, a short load step | 40-50 min |
| `pnpm e2e:quick` | headline sign-off and order lane on Chromium phone + WebKit phone (needs a build) | 1-2 min |
| `pnpm e2e:demo` | the demo paths on all six engine/size projects | 6-10 min |
| `pnpm e2e:room` | room conditions and the crowd behind one address | 5 min |
| `pnpm e2e:a11y` / `pnpm e2e:visual` / `pnpm e2e:visual:update` | accessibility audit; screenshot comparison; rewrite baselines | 2 min each |
| `pnpm test:deps` | model and partner failures (no secrets, no network) | 10 min |
| `pnpm test:deps:aiven` | PostgreSQL, Valkey, Kafka, OpenSearch outages. **Not against the shared Aiven services** (it starved the live site): local containers only, see `tests-live/deps/README.md` | 15 min |
| `pnpm test:load` / `pnpm test:soak` | throughput steps; 10-minute soak with memory and ledger check (`tests-live/load/README.md`) | 6 / 11 min |
| `pnpm e2e:summary` | a few lines from the last run's `test-results/results.json` | - |

Useful variables: `E2E_PORT` (default 4601; the limits-on server is `E2E_PORT+1`), `E2E_WORKERS`, `E2E_REUSE=1`
(reuse servers already running on those ports), `E2E_BASE_URL=https://host` (a server you run; no local servers),
`E2E_MODEL=1` (model on, keys copied from `.env.local`, capped at $0.50 and 60 calls), `E2E_EXPECT_FIXED=1` (run
the known-defect tests as ordinary tests, to confirm a fix), `E2E_CROWD_MAX=20,35` (bigger crowds), `E2E_SOFT_PASSKEY=1`
(software passkey on Chromium too). A failed test keeps its trace: `pnpm exec playwright show-trace test-results/<test>/trace.zip`.
Run two suites at once only with different `E2E_PORT` and `--output` (each run clears `test-results/`).

The store tests drive the conversation thread (main b9f934e; `e2e/support/thread.ts`: the log, its turns, the cards by
their kind label, the composer). Kaari and Laakso have one thread each for the whole server: a test that talks to one
takes a cross-process lock and starts it over (`stageThread`); everything else uses the visitor's own kitchen. A new
request needs a recording in `e2e/fixtures/recordings.json` (matched on the words after `"""`); the scripted agent
sends any words with a digit or more than four words to the `order` tool. Visual baselines are not committed
yet: take them with `pnpm e2e:visual:update` once the interface settles (CI writes missing Linux ones and uploads
them as an artifact). Known-defect tests are written as `test.fail(...)`: the suite stays green while the defect is there and turns red
("expected to fail, but passed") when it is fixed, so whoever fixes it flips the test.

## Projects

| Project | Engine, size | Specs |
|---|---|---|
| `chromium-phone` | Chromium, Pixel 7 (412x915) | `e2e/demo/*` |
| `webkit-phone` | WebKit, iPhone 15 (393x852) | `e2e/demo/*` |
| `firefox-phone` | Firefox, 390x844, touch | `e2e/demo/*` |
| `chromium-desktop`, `webkit-desktop`, `firefox-desktop` | 1440x900 | `e2e/demo/*` |
| `room` | Chromium phone | `e2e/room/*`: network, lifecycle, crowd (uses the limits-on server) |
| `a11y` | Chromium, 390x844 / 1440x900 / 1920x1080 | `e2e/a11y/*`: axe, focus, motion, keyboard, legibility |
| `visual` | Chromium, phone / laptop / wall | `e2e/visual/*`; baselines in `e2e/visual/__screenshots__/<platform>/` |
| `legacy` | Chromium phone | `e2e/*.spec.ts` kept by other branches (portal, accounts, call); restart and show need `E2E_BASE_URL` |

## A fixed clock

The seed catalogue's delivery days and order cut-offs follow the server's clock, so a run on a Sunday (or after an
order cut-off) can see other answers than a run on a Tuesday morning. To run on a fixed moment:

    E2E_NOW=2026-11-17T10:30:00+02:00 pnpm e2e:quick

`playwright.config.ts` computes one offset from the real clock for the run (`E2E_NOW_OFFSET_MS`); the servers
(`support/start-server.mjs`) start with `support/fixed-clock.cjs` preloaded (`NODE_OPTIONS=--require …`), which moves
`Date.now()` and `new Date()` by that offset and lets the clock run; the tests that compare a time with the server's
(`support/thread.ts` `minutesUntil`) use the same offset. The test runner's own clock stays real (its file locks need
it), and so does the browser's. Without `E2E_NOW` nothing changes. In CI, set `E2E_NOW` in the job's environment for
the e2e step to make the result independent of the weekday.

## What runs where

Passkeys: Chromium uses the browser's own WebAuthn stack with a DevTools virtual authenticator. WebKit and Firefox
have no such hook in Playwright, so they get `e2e/support/soft-passkey.js`: a software ES256 authenticator that
replaces `navigator.credentials` before page scripts run. The server verifies its registrations and signatures
exactly as a phone's (origin, RP id hash, challenge, counter, signature), so the whole sign-off path runs on all
three engines. What it cannot show is the operating system's own sheet (Face ID, fingerprint, "no passkeys"
prompt, iCloud Keychain sync): that is the manual check below.

| Demo path | Chromium | WebKit | Firefox | Spec |
|---|---|---|---|---|
| Scan the join code, passkey, land as approver | yes | yes (soft passkey) | yes (soft passkey) | `demo/approval` |
| Order over the limit reaches the phone by itself, sign, signed order on the wall | yes | yes | yes | `demo/approval` |
| Decline with a reason; a dismissed passkey prompt | yes | yes | yes | `demo/approval` |
| Store thread: understood, mistake check, options, fixed price and how long it holds, gate, sign-off on the phone, signed order; reload and back mid-way | yes | yes | yes | `demo/store` |
| Catalogue, product page with live price, basket to the gate | yes | yes | yes | `demo/catalogue` |
| The dock: a question answered from records; an order request goes through the same thread | yes | yes | yes | `demo/assistant` |
| Mistake check on Kaari; one-tap repeat; repeat with a change (in the dock) | yes | yes | yes | `demo/store` |
| Presenter enrols as a demo kitchen's approver with the operations passcode | yes | yes | yes | `demo/presenter` |
| Operations portal: trace replay, safeguards, suspend, refused on next call, resume | yes | yes | yes | `demo/ops` |
| Recall drill: publish, hold, refused with `recall_hold`, end | yes | yes | yes | `demo/recall` |
| Call screen: microphone granted (fake device), connects with the server's scripted token | yes | **no**: Playwright's WebKit has no fake media device | yes | `demo/call` |
| Call screen: microphone refused or missing; call endpoint fails or unreachable | yes | yes (getUserMedia stubbed to refuse) | yes | `demo/call` |
| Speaking in the thread: no answer, a drop that stays down, the time limit, offline; typing on in the same composer | yes | yes (silent WebAudio stream) | yes | `demo/call` |
| The full voice door on Chromium phone (read-back, provider refuses, in the thread, a judge's phone) | yes | no | no | `call.spec.ts` (legacy) |
| Photo door with a fixture image (no reader: honest message; recorded reading: lines to the thread) | yes | yes | yes | `demo/photo` |
| Slow lossy network, page frozen (phone locked), hidden tab, stream blip, two tabs, clock skew, reload/back at each stage | yes | **no**: network emulation and page freezing are DevTools-only | **no** | `room/conditions` |
| Ten visitors behind one address with the public limits on | yes | no (one engine is enough for a server limit) | no | `room/crowd` |

Not exercised by any automated test: the real Face ID / fingerprint sheet and passkey sync; a real microphone and
the voice model's session (Gemini Live); the camera button; a real photo read by a model; real conference Wi-Fi
(captive portal, client isolation, proxies that buffer server-sent events); Safari's own background-tab throttling
and iOS "Low Data Mode"; the QR code scanned by a real camera.

## Five-minute manual check on a real iPhone and a real Android phone

Do this on the deployed site, before each presentation, with one iPhone (Safari) and one Android phone (Chrome),
both on the venue Wi-Fi, not on mobile data. Reset the demo first if the runbook says so.

1. **Scan** the QR code on the wall with the camera app. Expect: `/join` opens in Safari/Chrome (not in an in-app
   browser), the page names a kitchen and a person. If it opens inside the camera's preview, tap through to the browser.
2. **Passkey**: tap "Create my passkey and start". Expect: the system sheet (Face ID / fingerprint / screen lock),
   then "Waiting for requests" within 3 s. If the sheet says "no screen lock", that phone cannot take part: use another.
3. **Request**: tap "Demo: ask my agent for 1,000 L of milk". Expect: the sign-off page opens **by itself** within
   3 s, with the total, "Over this agent's 500 € per-order limit", the swap explained, and minutes left (about 29).
   If it does not open by itself within 10 s, the venue network is blocking the live stream (the waiting screen falls back to
   polling since main 718aa8b, so give it a few seconds more): reload the page and tap the request under "Waiting for you"; tell the presenter.
4. **Lock and come back**: before signing, lock the phone for 10 s, unlock. Expect: still the same request, minutes
   left still sensible, Approve still there.
5. **Sign**: tap Approve. Expect: the system sheet again, then "Order placed", "with a passkey". On the wall within
   3 s: "Signed order" with the person's name.
6. **Decline path** (second phone): request again, Add reason, "Too expensive", Decline. Expect "Declined" with the reason.
7. **Store on the phone**: tap "Open my kitchen's shop", tell the agent "1,000 litres of lactose-free milk by
   Monday" in the conversation, follow its cards to a fixed price (watch the countdown move) and place the order.
   Expect the phone's sign-off page to open; approve.
8. **Look** while doing it: nothing cut off at the right edge, text readable without zooming, buttons reachable by
   thumb above the browser's own toolbar, the language buttons (FI SV EN) switch the page, no "undefined" or raw
   codes anywhere, the demo note visible.
9. **Call screen** (if voice is shown): open `/call`, allow the microphone. Expect the permission prompt from the
   browser, then the call starts; say "100 litres of milk for Thursday". Refuse the microphone on the second phone:
   expect a plain message saying how to allow it.

Write down for each phone: model, OS version, browser, pass/fail per step, and the time from tap to sign-off page.
