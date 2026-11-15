import { type Callout, ev, has, type Shot } from "./parts";
import { chapter, cue, partAt } from "./timeline";

/**
 * The edit: per chapter, its shots (each lasts until the next starts) and its callouts, placed on the narrator's
 * words with cue(part, phrase). A clip that has not arrived yet falls back to a placeholder, so the film always renders.
 */
const K = "aimopilot.zeroanomaly.tech";
const ph = (at: number, what: string, label?: string): Shot => ({ clip: "placeholder", at, what, label });
/** The clip if it has arrived, otherwise a placeholder saying what it will show. */
const clip = (name: string, shot: Omit<Shot, "clip">, what: string): Shot => (has(name) ? { clip: name, ...shot } : { clip: "placeholder", at: shot.at, what, label: shot.label });
const start = (id: string) => chapter(id).start;

export type ChapterEdit = { shots: Shot[]; callouts: Callout[] };

export const EDL: Record<string, () => ChapterEdit> = {
  c00: () => ({
    shots: [ph(start("c00"), "The landing page: the hero, then a slow scroll past “How it looks on your webshop”", "The landing page")],
    callouts: [],
  }),

  c01: () => {
    const w = "c01-01-three-ways";
    const u = "c01-02-signup";
    const iv = "c01-03-interview";
    return {
      shots: [
        clip(w, { at: start("c01"), label: "The door: three ways in", url: `${K}/k`, sync: has(w) ? [[ev(w, "/k"), cue("c01-1", "There are", -0.2)], [ev(w, "way 1"), cue("c01-1", "First", -0.1)], [ev(w, "way 2"), cue("c01-2", "Second", -0.1)], [ev(w, "way 3"), cue("c01-3", "Third", -0.1)]] : undefined, zoom: has(w) ? [{ at: cue("c01-2", "Hotel Lumo", -0.3), s: 1.1, x: 0.5, y: 0.6 }, { at: partAt("c01-2", 0, true), s: 1, x: 0.5, y: 0.6 }] : undefined }, "/k: the three ways in"),
        clip(u, { at: cue("c01-3", "The restaurant's", -0.3), label: "Opening an account", url: `${K}/k/signup`, sync: has(u) ? [[ev(u, "sign-up: the restaurant"), cue("c01-3", "The restaurant's", -0.1)], [ev(u, "business email"), cue("c01-3", "a business email", -0.1)], [ev(u, "welcome"), cue("c01-3", "a short interview", 0)]] : undefined }, "The sign-up form"),
        clip(iv, { at: cue("c01-3", "The agent asks", -0.3), label: "Opening an account · the interview", url: `${K}/k/signup` }, "The interview: one question answered, one “None / decide later”"),
        ph(partAt("c01-4", 3), "“These are your rules”; the Your rules page; a fresh kitchen's opening", "Your rules"),
      ],
      callouts: [
        { at: cue("c01-2", "They're shared"), text: "Test kitchens: shared, reset every hour", pos: "br" },
        { at: cue("c01-4", "On every question"), text: "“None” or “Decide later” on every question", pos: "br", dur: 150 },
      ],
    };
  },

  c02: () => {
    const r = "c02-01-request";
    const b = "c02-02-behind";
    const g = "c02-03-gate";
    const ph2 = "c02-04-phone";
    const sg = "c02-05-signed";
    return {
      shots: [
        clip(r, { at: start("c02"), label: "Hotel Lumo kitchen · Agent", url: `${K}/k`, sync: has(r) ? [[ev(r, "typing"), cue("c02-1", "I need", -0.4)], [ev(r, "request sent"), partAt("c02-1", 0.3, true)], [ev(r, "reply"), partAt("c02-2", 0.2)]] : undefined }, "Valio's request typed in Hotel Lumo"),
        clip(b, { at: cue("c02-2", "It read", -0.6), label: "Hotel Lumo kitchen · the agent's steps", url: `${K}/k`, sync: has(b) ? [[ev(b, "the steps"), cue("c02-2", "It read", -0.2)], [ev(b, "all the steps"), cue("c02-2", "Then it asked", -0.3)], [ev(b, "the ranked"), cue("c02-3", "ranks the", -0.5)]] : undefined, zoom: [{ at: cue("c02-2", "It read", 0.4), s: 1.14, x: 0.3, y: 0.75 }, { at: cue("c02-3", "And there's"), s: 1.14, x: 0.3, y: 0.12 }, { at: cue("c02-3", "ranks the", -0.2), s: 1.1, x: 0.4, y: 0.45 }, { at: partAt("c02-3", 0, true), s: 1, x: 0.4, y: 0.45 }] }, "The steps under the reply, open; the ranked stand-ins"),
        clip(g, { at: partAt("c02-4", -0.3), label: "Hotel Lumo kitchen · the gate", url: `${K}/k`, sync: has(g) ? [[ev(g, "typing"), cue("c02-4", "We pick", -0.3)], [ev(g, "the gate"), cue("c02-4", "This order is")]] : undefined, zoom: [{ at: cue("c02-4", "This order is", 0.6), s: 1.12, x: 0.5, y: 0.62 }] }, "The quote, then the gate stops the order over the 500 € limit: the sign-off slab"),
        clip(ph2, { at: cue("c02-5", "Tap Send", -0.5), label: "Hotel Lumo kitchen · the approver's phone", url: `${K}/k`, sync: has(ph2) ? [[ev(ph2, "Send to my phone"), cue("c02-5", "Tap Send", 0.1)], [ev(ph2, "the sign-off screen"), cue("c02-5", "the approver sees", -0.2)], [ev(ph2, "approved with"), cue("c02-5", "approves exactly", -0.1)], [ev(ph2, "signed on the phone"), partAt("c02-6", 0.6)]] : undefined, zoom: [{ at: cue("c02-5", "On the phone", -0.2), s: 1.14, x: 0.86, y: 0.5 }, { at: partAt("c02-6", 0.2), s: 1.1, x: 0.3, y: 0.3 }] }, "A phone-sized window: the approval page and the passkey prompt"),
        clip(sg, { at: cue("c02-6", "A receipt", -0.5), label: "Hotel Lumo kitchen · signed", url: `${K}/k`, sync: has(sg) ? [[ev(sg, "the signed order"), cue("c02-6", "A receipt", -0.2)], [ev(sg, "See this order"), cue("c02-6", "And one link", 0)]] : undefined }, "The signed order appears; “See this order as the wholesaler sees it”"),
        ...(has(sg) ? [{ clip: sg, at: cue("c02-6", "And one link", 1.2), label: "Operations · the order as the wholesaler sees it", url: `${K}/ops`, sync: [[ev(sg, "See this order"), cue("c02-6", "And one link", 0)]] as [number, number][] }] : []),
      ],
      callouts: [
        { at: cue("c02-2", "looked at", -0.2), text: "Memory: always lactose-free", pos: "tr" },
        { at: cue("c02-2", "Then it asked", 0), text: "Live price and stock: only the few candidates", pos: "tr", dur: 165 },
        { at: cue("c02-4", "The gate is plain"), text: "Plain code, not the model, decides", pos: "br", dur: 150 },
        { at: cue("c02-5", "One passkey"), text: "One passkey approves exactly this order", pos: "bl", dur: 150 },
      ],
    };
  },

  c03: () => {
    const t = "c03-01-talk-round";
    return {
      shots: [
        clip(t, { at: start("c03"), label: "Hotel Lumo kitchen · Agent", url: `${K}/k`, sync: has(t) ? [[ev(t, "typing"), cue("c03-1", "Let's try", -0.2)], [ev(t, "refused"), cue("c03-1", "Refused", -0.2)]] : undefined, zoom: [{ at: cue("c03-1", "Refused", 0.3), s: 1.12, x: 0.35, y: 0.55 }] }, "“Ignore the limit…”: refused with the reason"),
        ph(partAt("c03-2", -0.2), "The mistake check and its one-tap correction", "Mistake check"),
        ph(partAt("c03-3", -0.2), "A refused product in Kahvila Sointu; the offer to draft a rule change; the rule-change sign-off", "Kahvila Sointu · Agent"),
        { clip: "film", at: partAt("c03-4", -0.2), full: true, sync: [[36.6, partAt("c03-4", 0)]], until: 49.6 },
      ],
      callouts: [
        { at: cue("c03-1", "Nothing is placed"), text: "A yes passed on is not a sign-off", pos: "tr", dur: 110 },
        { at: cue("c03-4", "Every figure", 0), text: "Every figure checked against the tools' results", pos: "bc", dur: 170 },
      ],
    };
  },

  c04: () => ({
    shots: [
      ph(start("c04"), "The menu planner: three dishes, then “You have / I'll order / Can't get”", "Menu planner"),
      ph(partAt("c04-2", -0.2), "The watch's opening note; a backup offer", "The watch"),
      ph(partAt("c04-3", -0.2), "An offer card from the selling agent", "Selling agent"),
      ph(partAt("c04-4", -0.2), "Your rules, with the memory", "Your rules"),
      ph(partAt("c04-5", -0.2), "The Orders tab; the “Try everything” guide", "Orders"),
      ph(partAt("c04-6", -0.2), "The Catalogue with the agent panel opening over it (Ctrl K)", "Catalogue · Ctrl K"),
    ],
    callouts: [{ at: cue("c04-3", "at most two"), text: "At most two offers a week; never an order", pos: "tr", dur: 120 }],
  }),

  c05: () => ({
    shots: [ph(start("c05"), "The voice bar: Listening, Hearing you, Working, Speaking; spoken turns with the microphone mark; the read-back; the order", "Hands-free voice")],
    callouts: [{ at: cue("c05-2", "The voice model"), text: "Same engine as typing: same rules, same gate", pos: "tr", dur: 150 }],
  }),

  c06: () => ({
    shots: [
      ph(start("c06"), "/ops: Live", "Operations · Today"),
      ph(cue("c06-2", "Orders lists"), "Orders: open a timeline", "Operations · Orders"),
      ph(partAt("c06-3", -0.2), "Agents: the scorecard, Conversations, Selling agent, Kitchen watch", "Operations · Agents"),
      ph(partAt("c06-4", -0.2), "Safeguards; Audit, verified", "Operations · Trust"),
      ph(cue("c06-4", "Trace replays", -0.2), "Trace: step through a request", "Operations · Trace"),
      ph(cue("c06-4", "The time machine", -0.2), "Time machine: scrub back; Recall radar", "Operations · Time machine"),
      ph(partAt("c06-5", -0.2), "Customers, Accounts, Mail; Control: suspend and resume an agent", "Operations · Control"),
    ],
    callouts: [{ at: cue("c06-1", "Anyone can look"), text: "View without a passcode; acting needs staff access", pos: "tr", dur: 120 }],
  }),

  c07: () => ({
    shots: [
      ph(start("c07"), "/try and /docs: the MCP tools and the OpenAPI document", "The open door"),
      ph(partAt("c07-2", -0.2), "Platform: “Send in an Aiven agent”, one run with its steps arriving", "Platform · Aiven agent"),
    ],
    callouts: [{ at: cue("c07-2", "No tool"), text: "No tool lets an agent approve", pos: "tr", dur: 90 }],
  }),

  c08: () => ({
    shots: [
      { clip: "film", at: start("c08"), full: true, from: 83.0, until: 89.0, sync: [[83.3, cue("c08-1", "On a", -0.2)], [85.6, cue("c08-1", "Textbook", 0.6)], [86.9, cue("c08-1", "AimoPilot reaches", -0.5)]] },
      { clip: "film", at: partAt("c08-2", -0.3), full: true, from: 75.8, until: 82.8, sync: [[76.4, cue("c08-2", "Embeddings", -0.2)], [78.4, cue("c08-2", "recall candidates")], [79.4, cue("c08-2", "The kitchen's rules", -0.2)], [81.2, cue("c08-2", "A decision model", -0.2)], [82.2, cue("c08-2", "code checks", -0.1)]] },
      ph(cue("c08-2", "Claude does", -0.4), "Hosted Platform tabs: The platform, Observe, The stream, Ask the platform", "Platform"),
      { clip: "film", at: partAt("c08-3", -0.2), full: true, sync: [[89.4, partAt("c08-3", 0)]], until: 108.5 },
    ],
    callouts: [{ at: cue("c08-2", "Claude does", -0.2), text: "Claude: the agents' reasoning · Gemini: embeddings, the decision model, live voice", pos: "bc", dur: 240 }],
  }),

  c09: () => ({
    shots: [ph(start("c09"), "The Agents page's crash-test section; the Safeguards page", "How it was tested")],
    callouts: [{ at: cue("c09-1", "Plus a crash"), text: "13 scenarios, three runs each; the worst run sets the licence", pos: "tr", dur: 150 }],
  }),

  c10: () => ({
    shots: [ph(start("c10"), "Landing: “How it looks on your webshop” at its end state", "The landing page")],
    callouts: [],
  }),
};
