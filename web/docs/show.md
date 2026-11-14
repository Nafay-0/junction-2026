# The show: the week, presenter mode, table mode

Pages (all behind the operations passcode, the same as `/ops`):

- `/present/table`: the wall at the peer-review table. QR code; each visitor who joins gets their own kitchen's
  week, signed on their own phone. Up to three visitors side by side; back to the QR code 25 s after a week ends.
- `/present`: presenter mode for the three-minute pitch, run from the keyboard or a clicker.
- `/k/<visitor kitchen>/week`: a visitor's own kitchen plays its week from their phone or laptop.

## The week (`src/server/show/week.ts`)

Six of the partner's scenarios, each as real REST calls through the gate with the kitchen's signed mandate
(in-process, through the same route handlers and `authenticate`, so suspensions, the door log and every rule apply):

| Day | What happens | Real or set |
|---|---|---|
| Monday | Standing order, "same as last time", placed by the agent alone | real |
| Tuesday | 800 L where the kitchen orders 80 L: the mistake check stops it before any price; corrected, placed alone | real check; the answer is scripted and labelled |
| Wednesday | The usual milk is out of stock: good, better, best alternatives, all lactose-free, the best placed alone | stock-out **simulated** with `setStock`; labelled on screen and in the ledger |
| Thursday | 620 L for the earliest day: passed cut-offs dropped, over 500 €, stopped at the gate, signed on the phone | real; waits 40 s, then the agent withdraws the order |
| Friday | A standing order that crept from 20 to 40 L: the core's standing-order check queries it; renewed at 20 L | real check; scripted answer, labelled |
| Saturday | An almond drink (nuts) sent straight to the gate as a swap: refused, "No forbidden allergens" | real refusal; the attempt is a deliberate test, said so |

The kitchen's past (six weeks of orders, one standing order a person agreed) is made up, like every visitor
kitchen's, installed when the week starts and replaced by the kitchen's own past when it ends. Waiting orders are
withdrawn at the end. About 13 partner calls and no model calls per week.

## Presenter keys

→ / Space / Page Down: next beat. ← / Page Up: previous. Enter: run the beat. W: (re)start the week. 1 to 6:
attacks. S / R: suspend / resume the agent. A: outside agent. L: crash-test board. F: this act live or its
recording. C: keep the week just played as the week's recording. X: stop the week. P (Shift+P: also call the model
once): preflight. K: pick the kitchen. N: hide the strip. T: restart the timer. ?: keys.

Before going on: scan the QR code with the approver's phone (a fresh kitchen: orders the agent placed alone today
count together against its limit), press K to pick it, press P and fix what it names.

## Fallbacks

`src/server/show/recordings/*.json` were captured from a real run on a production build by
`pnpm exec tsx scripts/show/record.ts --url <server>` (the week's sign-off there was a virtual passkey). On the day,
play the week once in presenter mode with the real phone and press C: that run becomes the fallback
(`.data/show/recordings/`, newest wins). Attacks and the outside agent keep their last live run automatically.
Every recording plays through the same screens with "Recording of a real run" on it.

## Caps (env, defaults)

`DOCK_SHOW_WEEKS_PER_DAY` 250, `DOCK_SHOW_CONCURRENT_WEEKS` 4, `DOCK_SHOW_SIGNOFF_SECONDS` 40,
`DOCK_SHOW_OUTSIDE_RUNS_PER_DAY` 25, `DOCK_SHOW_MODEL_USD_PER_DAY` 2 (and 0.05 per run),
`DOCK_SHOW_AGENT_MODEL` (default: the cheapest model with a key).

## Hooks the show needed, and how it worked around them

- **Per-kitchen simulated stock.** `ValioCatalog.setStock` is process-wide and `clearStockOverrides()` clears all.
  The show holds one catalogue lock for every step that prices anything, sets the stock-out, runs the step, and
  clears it before releasing the lock, so concurrent weeks never see each other's simulation. Wednesday always
  uses the last delivery day so Dock's two-minute live cache never mixes a simulated answer with a real one.
  A non-show caller pricing that product in those seconds (or within two minutes from the cache for that day)
  would see it out of stock, marked "(simulated)".
- **A ledger entry type for simulations.** Recorded as `control` (as the suspension registry does).
- **Creating a kitchen without a phone.** The house kitchen uses `SandboxService.joinWithoutPasskey()`; nobody can
  sign its orders, which the screen says.
- **CSS modules.** This repo's Turbopack rule for `*.css` emits module classes globally with an empty class map
  (the wall's module is affected too), so the show uses a global stylesheet with a `show-` prefix.
