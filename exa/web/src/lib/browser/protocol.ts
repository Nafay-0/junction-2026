/**
 * The live browser: what the desktop app and its interface say to each other.
 *
 * The live browser exists only in the desktop app: it is a real browser view inside the app's
 * window, on the user's computer. The agent itself runs on the server; when it wants a step taken
 * in the browser, the interface passes the step to the app, the app takes it (after the safety
 * rules in guard.ts have had their say) and the result goes back to the agent.
 *
 * Shared by the app and the interface: types and constants only, no imports. The bridge between
 * the two is described in lib/browser/desktop.ts.
 *
 * Coordinates everywhere are CSS pixels inside the page's viewport (`state.viewport`), with the
 * origin at the top left.
 */

/** The width a page is laid out at when the view is narrower than this, so sites keep their desktop layout. */
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
   * "idle": no browser has been opened yet. "starting": a browser was asked for and its view is
   * being put on screen. "ready": there is a page. "closed": it was closed. "error": it could not start.
   */
  status: "idle" | "starting" | "ready" | "closed" | "error";
  /** Who is driving. While "user", the agent does nothing and the user's clicks and keys reach the page. */
  control: "agent" | "user";
  /** Set when the agent asked the user to step in. Absent when the user took over on their own. */
  handover?: Handover;
  /** Set while a step is waiting for the user's yes or no: which step, and what it will do. */
  approval?: { label: string; toolCallId: string; summary: string };
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
  /** How long the app waits before doing it, in milliseconds: the time the pointer has to arrive. */
  leadMs: number;
};

export type BrowserEvent = { type: "state"; state: BrowserState } | { type: "action"; action: AgentAction };

/** What the user asks of the browser from the interface. */
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
  /** Open a link the user pressed in the chat. The user takes over, and the browser opens if there is none. */
  | { action: "visit"; url: string }
  | { action: "tab"; tabId: string }
  /** The size the browser view is drawn at, so the page is laid out to fit it. */
  | { action: "fit"; width: number; height: number }
  /** The user's yes or no to the step that is waiting for it. */
  | { action: "approval"; toolCallId: string; approved: boolean }
  /** Close the browser. Sign-ins are kept. */
  | { action: "close" };

/** What the agent's "it is your turn" request resolves to. */
export type HandoverAnswer = { status: "done" | "skipped"; note?: string };

/** The agent's browser tools. They are carried out in the desktop app, not on the server. */
export const BROWSER_TOOL_NAMES = ["browserOpen", "browserAct", "browserRead", "browserLook", "browserClose"] as const;
export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];

/** One step the agent asked for, as the interface passes it to the app. */
export type BrowserCall = { tool: BrowserToolName; toolCallId: string; input: unknown };

/** One browser step as the conversation shows it. What the agent's browser tools return. */
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
  /** True when the user said no to the step. */
  denied?: boolean;
  /** What the model reads back: the page as it now stands. Not shown to the user. */
  page: string;
  /** browserLook: a picture of the page (base64 JPEG) for the model. Not kept when the conversation is saved. */
  picture?: string;
  sources: [];
};
