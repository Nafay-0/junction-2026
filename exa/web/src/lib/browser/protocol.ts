/**
 * The live browser: what the server and the interface say to each other.
 *
 * The agent drives a real Chrome on the server. The interface shows it live, animates what the
 * agent does, and lets the user take over (to sign in, solve a check, or pay themselves).
 * Shared by the server and the browser: types and constants only, no imports.
 *
 * Endpoints (all take the browser's id as `?id=`; the id is a random value kept in this browser's
 * storage, one live browser per visitor):
 *
 *   GET  /api/browser/stream   Server-sent events. Each message is one `BrowserEvent` as JSON.
 *                              The current state (and the latest frame, if any) arrive at once.
 *                              Stays open while there is no browser yet: events start when one opens.
 *   POST /api/browser/input    `{ events: UserInput[] }`. Honoured only while the user is in control.
 *   POST /api/browser/control  `ControlRequest`. Answers with the new `BrowserState`.
 *
 * Coordinates everywhere are CSS pixels inside the page's viewport (`state.viewport`), with the
 * origin at the top left. Frames are JPEG images of exactly that viewport.
 */

/** The size the page is rendered at. The interface scales the picture to fit. */
export const VIEWPORT = { width: 1280, height: 800 } as const;

/** Why the agent has stopped and handed the page to the user. */
export type HandoverKind = "login" | "captcha" | "verification" | "payment" | "other";

export type Handover = {
  kind: HandoverKind;
  /** One plain sentence for the user: "Sign in to your TableOnline account". */
  reason: string;
  /** The site it concerns, for example "tableonline.fi". */
  site?: string;
  /** The agent's request that is waiting for the user. Answer it when the user says they are done. */
  toolCallId?: string;
};

export type BrowserTab = { id: string; title: string; url: string; active: boolean };

export type BrowserState = {
  /**
   * "idle": no browser has been opened yet. "starting": Chrome is launching.
   * "ready": there is a page to show. "closed": the browser was closed. "error": it could not start.
   */
  status: "idle" | "starting" | "ready" | "closed" | "error";
  /** Who is driving. While "user", the agent does nothing and the user's input reaches the page. */
  control: "agent" | "user";
  /** Set when the agent asked the user to step in. Absent when the user took over on their own. */
  handover?: Handover;
  /** Set while a step is waiting for the user's approval in the chat. */
  approval?: { label: string };
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  viewport: { width: number; height: number };
  tabs: BrowserTab[];
  /** True while the agent is in the middle of a step. */
  busy: boolean;
  /** What the agent is doing right now, in a few plain words: "Clicking 'Reserve a table'". Empty when idle. */
  activity: string;
  /** The page takes payment. The agent never acts here; the user may pay themselves. */
  paymentPage: boolean;
  /**
   * Which browser the agent works in. "assisted": a Chrome of its own on the computer running the
   * app, hidden, with sign-ins of its own. "own": a window of the Chrome the user already uses,
   * signed in to their accounts, so there is nothing to sign in to.
   */
  kind: "assisted" | "own";
  /**
   * Whether the user's own Chrome can be used. "ready": Chrome allows an app to attach.
   * "setup": the user has to turn that on in Chrome first (chrome://inspect/#remote-debugging).
   * "unavailable": the app is not running on a computer with the user's Chrome.
   */
  own: "ready" | "setup" | "unavailable";
  /** Set with status "error". */
  error?: string;
};

export const IDLE_STATE: BrowserState = {
  status: "idle",
  control: "agent",
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  viewport: { ...VIEWPORT },
  tabs: [],
  busy: false,
  activity: "",
  paymentPage: false,
  kind: "assisted",
  own: "unavailable",
};

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Something the agent is about to do, sent just before it happens so the interface can show it:
 * move the agent's pointer to `point`, ring `box`, show `label`.
 */
export type AgentAction = {
  /** Increases by one with every action in a browser's life. */
  id: number;
  kind:
    | "navigate" // opening an address or going back
    | "click"
    | "type" // entering `text` into a field
    | "select" // choosing `text` in a list
    | "press" // a key, named in `text`
    | "scroll"
    | "hover"
    | "read" // looking over the page; no target
    | "wait"
    | "approval" // pointing at what will be pressed once the user approves
    | "blocked"; // refused by a safety rule; `label` says why
  /** A short caption in plain words: "Clicking 'Reserve a table'". */
  label: string;
  /** The spot the pointer should travel to, when the action has a target. */
  point?: { x: number; y: number };
  /** The target element's outline. */
  box?: Box;
  /** "type": the text being entered. "select": the option. "press": the key. Never a password or payment detail. */
  text?: string;
  /** "scroll": which way. */
  direction?: "up" | "down";
  /** How long the server waits before doing it, in milliseconds: the time the pointer has to arrive. */
  leadMs: number;
};

export type BrowserEvent =
  | { type: "state"; state: BrowserState }
  /** One picture of the page. `data` is a base64 JPEG of the whole viewport. */
  | { type: "frame"; data: string; width: number; height: number }
  | { type: "action"; action: AgentAction };

/** What the user does in the live view while they are in control. */
export type UserInput =
  | { type: "mouse"; action: "move" | "down" | "up"; x: number; y: number; button?: "left" | "middle" | "right"; clickCount?: number }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  /** `key` is `KeyboardEvent.key`: "a", "A", "Enter", "Backspace", "ArrowLeft", "Shift", "Meta". */
  | { type: "key"; action: "down" | "up"; key: string }
  /** Pasted or composed text, inserted at the caret. */
  | { type: "text"; text: string };

export type ControlRequest =
  /** The user takes over. The agent pauses until "release". */
  | { action: "take" }
  /** The user hands the page back to the agent. */
  | { action: "release" }
  | { action: "back" }
  | { action: "forward" }
  | { action: "reload" }
  /** Go to an address the user typed. Opens the browser if there is none. Only while the user is in control. */
  | { action: "navigate"; url: string }
  | { action: "tab"; tabId: string }
  /**
   * Work in the user's own Chrome, or go back to the assisted browser. `reopen` carries the page
   * that is open over to the other browser (used when a sign-in is why the user is switching).
   */
  | { action: "kind"; kind: "assisted" | "own"; reopen?: boolean }
  /** Close the browser. Sign-ins are kept. */
  | { action: "close" }
  /** Close the browser and wipe every sign-in, cookie and saved form entry. */
  | { action: "forget" };

/** What the agent's "it is your turn" request resolves to. */
export type HandoverAnswer = { status: "done" | "skipped"; note?: string };

/** One browser step as the conversation shows it. Returned by the agent's browser tools. */
export type BrowserStepData = {
  kind: "browser";
  /** What was done, in plain words: "Opened tableonline.fi", "Clicked 'Reserve'". */
  label: string;
  action: AgentAction["kind"] | "open" | "close";
  url: string;
  title: string;
  /** False when the step did not happen. */
  ok: boolean;
  /** Why not, when a safety rule stopped it or the page did not respond. */
  problem?: string;
  /** True when a safety rule refused the step (payment, password), as opposed to an ordinary failure. */
  blocked?: boolean;
  /** What the model reads back: the page as it now stands. Not shown to the user. */
  page: string;
  sources: [];
};
