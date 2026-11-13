# Modal, CRACI, Context.dev and Exa

> **Name: the team must choose.** Replace `{{NAME}}` ("Dock" in the code, "AimoPilot" in the draft submission).

Four partners, four different sizes of use. Two of them (Modal and CRACI) are thin; say so if asked.

## Modal

**What it does in the product.** Modal ran the one big batch job of the weekend: building the map of product
alternatives. A language model read all 17,546 product records and described each in a kitchen's terms (what kind
of product it is, its form, whether it whips, melts or splits when boiled, and its typical uses). The 1,233 model
calls ran in parallel on Modal: up to 35 containers with 12 threads each.

**Where to see it.** `web/scripts/knowledge/modal_exec.py` and `web/scripts/knowledge-build.ts`
(`pnpm knowledge:build --executor modal`). The result is live: `/ui-api/knowledge/status` on the demo answers
`available: true, products: 17546`. The product page's "If this is not there: alternatives by use" uses it.

**What is true.** Full run: $1.10 of model calls, 131 seconds wall time, Modal compute "a few cents"
(`web/docs/knowledge-map.md`).

**What is not.** This is one offline job, run once. Nothing in the live product runs on Modal. It is a thin use.

## CRACI

**What it does.** Our CI runs on CRACI runners: on every push to `main` and to agent branches, it lints, type-checks,
runs the tests, builds the app and runs the scripted attack demo, which fails the build if any misbehaviour attempt
is not refused (`.github/workflows/ci.yml`, `runs-on: craci`).

**Where to see it.** The repository's Actions tab. On Saturday 01:30, `gh run list` showed recent `main` runs
succeeding in about 2 minutes 20 seconds.

**What is true.** The workflow file says SBOM generation is automatic on CRACI; we did not check the SBOM output.

**What is not.** This is CI hosting, not a product feature. CRACI offered credits; we found no CRACI challenge brief in
`research/05-official-briefs.md`. Thin.

## Context.dev

**What it does.** Context.dev reads the web for the **recall radar**. It reads the Finnish Food Authority's recall
listing (a CSS parser, 1 credit), reads each notice into structured facts against our schema (5 credits), and
watches the listing with a page monitor every 30 minutes. Plain code then matches the facts to the assortment and
holds a product that a recent notice names by EAN, or by producer, exact name and pack. A held product is refused at
quote, order and sign-off with the rule `recall_hold`, and the notice is the reason.

**Where to see it.** `/ops/radar` (passcode). Press the drill: it publishes a test notice marked HARJOITUS / DRILL on
Dock's own page, in the authority's layout, and it goes through the same path. Then try to order the product.

**What is true.** Readers are tested on recorded Context.dev responses from real authority pages
(`web/src/server/radar/radar.test.ts`, fixtures in `web/src/server/radar/fixtures/`). The drill is tested end to end,
refused at quote, order and sign-off.

**What is not yet.** Without a public address for the drill page, the radar reads the drill directly rather than
through Context.dev, and the screen says so. We have no recorded run where a real notice matched a product in the
assortment. Fit with the Context.dev challenge ("turn live web data into decisions"): real, but the radar is a side
feature of the product.

## Exa

**What it does.** Exa finds recall notices that are not on the authority's list: producers' and shops' own notices,
by meaning and date, in Finnish and Swedish, plus pages that corroborate an authority notice. Context.dev then reads
each find into facts.

**Where to see it.** `/ops/radar`, source "Found on the open web by Exa" (`web/src/server/radar/sources.ts`).

**What is true.** Spend is capped at $3 per process start.

**What is not.** We have no recorded evaluation of what Exa found. The Exa challenge ("The Internet Butler") asks for
a personal agent that takes a tedious real-life task off someone's hands; the radar is a back-office monitor, so the
fit is thin.
