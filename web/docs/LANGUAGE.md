# Languages on the customer side

The store (`/k/**`), the order lane, the assistant panel's fixed texts, the menu planner, the phone pages (join,
approver home, sign-off), the call screen and the photo door speak **Finnish, Swedish and English**. English is the
default; the buyer's choice is kept in the `aimopilot-lang` cookie (one year) and can be changed from the store's
header and from every phone page. The operations portal and the wall stay in English for now.

## How it works

- `src/app/_i18n/lang.ts`: `Lang`, `defineText()`, the cookie name. Pure.
- `src/app/_i18n/provider.tsx`: `LangProvider` (wraps the store and each phone page), `useLang()`, `useText(TEXT)`,
  `useFormat()` (dates, weekdays, units, rule titles, roles in the current language), `LangSwitch`.
- `src/app/_i18n/server.ts`: `chosenLang()` / `requestLang()` for server components and `generateMetadata`.
- Each component keeps its texts in a sibling `*.text.ts` made with `defineText({ en, fi, sv })`. English defines the
  keys; Finnish and Swedish must match them exactly (a missing key is a type error). Sentences with numbers or names
  are functions, so each language can order the words its own way and inflect them.
- Numbers keep the Finnish conventions in all three languages: `1 280,50 €`, `2,5 kg`, `14.05`, `ti 17.11.`. Only the
  words change (`ma`/`mån`/`Mon`, `kpl`/`st`/`pcs`).
- Server-written sentences (reasons, mistake-check messages, option pros and cons, ledger lines) arrive in English.
  Where a message comes with a code (a rule id, a concern code, a product problem code), the screen translates the
  code at the edge; free text from the server is shown as it came. The list of what is still English is at the end.

## Voice

- Finnish is written the way a Finnish food-service wholesaler writes to professional kitchens: plain, correct, the
  trade's own words, the informal singular in instructions ("Lisää koriin", "Tarkista toimituspäivä"), as the
  partner's own site does ("Tilaa helposti", "Tarkista tuotteiden saatavuus"). Not a word-for-word rendering of the
  English: rebuild the sentence.
- Swedish is Finland Swedish trade language, "du" form, the same plainness ("Lägg i varukorgen", "Kontrollera
  leveransdagen").
- Sentence case, no exclamation marks, no all caps. Clock times: `klo 14.00` (fi), `kl. 14.00` (sv), `14.00` (en).

## Vocabulary

| English | Suomi | Svenska |
|---|---|---|
| wholesaler | tukku (toimitustukku) | grossist |
| the store, webshop | verkkokauppa | webbutik |
| kitchen | keittiö | kök |
| order (noun) / to order | tilaus / tilata | beställning / beställa |
| place the order | lähetä tilaus | skicka beställningen |
| basket | ostoskori | varukorg |
| add to basket | lisää koriin | lägg i varukorgen |
| delivery / delivery day | toimitus / toimituspäivä | leverans / leveransdag |
| order cut-off | tilausten viimeinen jättöaika; "tilaa viimeistään ke klo 14.00" | sista beställningstid; "beställ senast ons kl. 14.00" |
| in stock / out of stock | varastossa / loppu varastosta | i lager / slut i lager |
| availability | saatavuus | tillgänglighet |
| delivery reliability | toimitusvarmuus | leveranssäkerhet |
| price, fixed price, quote | hinta, kiinteä hinta, tarjous | pris, fast pris, offert |
| excl. VAT | alv 0 % | exkl. moms |
| substitute (product) | korvaava tuote | ersättande produkt |
| sales unit, case, pack, pieces | myyntierä, laatikko (ltk), pakkaus, kpl | försäljningsenhet, kartong, förpackning, st |
| chilled / frozen / ambient | kylmä / pakaste / huoneenlämpö | kyld / fryst / rumstemperatur |
| lactose-free, gluten-free, organic, vegan | laktoositon, gluteeniton, luomu, vegaaninen | laktosfri, glutenfri, ekologisk, vegansk |
| the agent (purchasing agent) | agentti (ostoagentti) | agenten (inköpsagent) |
| mandate | valtakirja | fullmakt |
| sign-off; approve; decline; approver | hyväksyntä; hyväksy; hylkää; hyväksyjä | godkännande; godkänn; avslå; godkännare |
| the gate | portti | grinden |
| rule | sääntö | regel |
| spending limit; weekly budget | ostoraja; viikkobudjetti | beloppsgräns; veckobudget |
| mistake check | virhetarkistus | felkontroll |
| request | pyyntö (tilauspyyntö) | förfrågan |
| good, better, best | hyvä, parempi, paras | bra, bättre, bäst |
| what the agent remembers | agentin muisti; "agentti muistaa" | agentens minne; "agenten minns" |
| order history | tilaushistoria | beställningshistorik |
| the ledger (the signed record of every step) | tapahtumaloki | händelseloggen |
| stopped at the gate | pysäytetty portilla | stoppad vid grinden |
| passkey | pääsyavain | nyckel (inloggningsnyckel) |
| menu planner; covers | menusuunnittelu; annosta | menyplanering; portioner |
| illustration (on a product tile) | kuvitus | illustration |
| no data | ei tietoa | uppgift saknas |
| show details | näytä tiedot | visa detaljer |

## For a native speaker to review first

Confidence: Finnish good but not native; Swedish adequate. Review in this order, because these are the words a buyer
sees most and where a literal choice is most likely to sound off:

1. The order lane's station names and stage titles (`k/[kitchen]/ui.text.ts`, `stages.text.ts`), especially
   *portti* for the gate and *valtakirja* for the mandate (both deliberate metaphors that need a native ear).
2. The gate's rule titles (`_i18n/format.ts`, `RULE_TITLE_FI`, `RULE_TITLE_SV`).
3. The sign-off screen on the phone (`approve/[approvalId]/approval-screen.text.ts`): what the approver reads before
   using the passkey.
4. The navigation and header (`k/[kitchen]/portal.text.ts`), the demo note (`_ui/brand.ts`).
5. Swedish throughout: *grinden*, *fullmakt*, *godkännare*, *inloggningsnyckel*.

## Server texts still in English

Written by `src/core` and `src/server` and shown on the customer side as they arrive. To translate them later,
the server would send a code plus parameters (as rule ids and concern codes already do) and the screen would pick
the words.

- **Order lane**: mistake-check `message` and correction labels (each now has a translated heading from its concern
  code above the English sentence); clarifying `questions[].text` and option labels; `fromMemory` notes; option
  `pros`, `cons`, `givesUp`, `preselected.reason`, `notes`, `signOffNotes`, `excluded[].reason`; the gate's
  `decision.reasons` and `refusal.message` (the rule titles are translated from the rule id); the reader's
  `incomplete.message`; `kitchen.agentName` ("Kaari's buyer agent") and `kitchen.examples`.
- **Account pages**: order reasons on Home, ledger summaries in the timeline, standing-order `drift.warning`, memory
  `usual.text`, learned habits and stated-rule text, the memory book's `kindLabel`, pending questions, proposals and
  connector steps, chain and signature check messages.
- **Shop**: the 349 category labels (department names are translated), the knowledge map's product kind and uses
  ("skimmed milk, for drinking, coffee and tea whitening"), alternatives' reasons and conditions, live-check
  `message`, assistant answers and citation labels.
- **Phone pages and call**: "why you are asked" reasons that do not match a known pattern (amounts, dates, licences
  are rewritten by `approve/[approvalId]/server-words.ts`), recall reason and publisher, read-back reason,
  AimoPilot's lines in the call transcript, the photo reader's notes, mic permission texts (`_channels/audio.ts`)
  and passkey errors from `_client/api.ts` (wrapped by `_ui/passkey.text.ts` where the code is known).
- **Menu planner**: doubts and blockers, line working, pack texts, fixes, check reasons, notes and assumptions,
  model-written dish names, portions and methods.
- **Everywhere**: `error.message` from the API, kitchen and approver names.
