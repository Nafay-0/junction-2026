"use client";

import * as React from "react";
import { MotionConfig } from "motion/react";
import { useTheme } from "next-themes";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { mockBrowser, useBrowser, useBrowserId } from "@/lib/browser/client";
import { IDLE_STATE, VIEWPORT, type AgentAction, type Box, type BrowserState, type ControlRequest, type HandoverKind, type UserInput } from "@/lib/browser/protocol";
import { useClientValue, useHydrated } from "@/lib/use-client";
import { BrowserCard } from "@/components/browser/browser-card";
import { BrowserWorkspace, useBrowserLayout } from "@/components/browser/workspace";

/**
 * The live browser interface, driven by a stand-in for the server so every state can be seen
 * without a real browser. /dev/browser plays a fake booking page drawn on a canvas;
 * ?live=1 attaches to the real endpoints instead (?live=<id> with a browser of its own);
 * ?still=1 turns animation off (for screenshots).
 */
export default function BrowserDev() {
  const hydrated = useHydrated();
  const query = useClientValue(() => window.location.search, "");
  const params = new URLSearchParams(query);
  // ?live=1 uses this visitor's own browser; ?live=some-id-of-8-or-more-characters uses a separate one.
  const liveParam = params.get("live") ?? "";
  const live = liveParam !== "";
  const still = params.get("still") === "1";
  const realId = useBrowserId();
  const id = !live ? "dev-mock" : /^[A-Za-z0-9_-]{8,64}$/.test(liveParam) ? liveParam : realId;

  const driver = React.useRef<Driver | null>(null);
  const [log, setLog] = React.useState<string[]>([]);
  const note = React.useCallback((line: string) => setLog((lines) => [line, ...lines].slice(0, 8)), []);

  React.useEffect(() => {
    if (!hydrated || live) return;
    const made = createDriver(id, note);
    driver.current = made;
    return () => {
      made.stop();
      driver.current = null;
    };
  }, [hydrated, live, id, note]);

  if (!hydrated) return null;

  return (
    <MotionConfig reducedMotion={still ? "always" : "user"}>
      <div className={cn("flex h-dvh bg-background", still && "still")}>
        <BrowserWorkspace browserId={id} onHandoverDone={(answer, toolCallId) => note(`Hand-over answered: ${answer.status}${toolCallId ? ` (${toolCallId})` : ""}`)}>
          <FakeChat browserId={id} live={live} log={log} onApprove={() => driver.current?.play("approve")} onDecline={() => driver.current?.play("decline")} />
        </BrowserWorkspace>
        {live ? null : <MockPanel onPlay={(name) => driver.current?.play(name)} />}
      </div>
    </MotionConfig>
  );
}

/* ───────────────────────── A stand-in chat ───────────────────────── */

function FakeChat({ browserId, live, log, onApprove, onDecline }: { browserId: string; live: boolean; log: string[]; onApprove: () => void; onDecline: () => void }) {
  const { state, connected } = useBrowser(browserId);
  const layout = useBrowserLayout();
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 text-[0.8rem] text-muted-foreground">
        <span className="font-medium text-foreground">Live browser: development page</span>
        <span className="flex gap-2">
          <button className="rounded-full border border-border px-3 py-1 hover:bg-muted" onClick={() => (layout.mode === "closed" ? layout.open() : layout.close())}>
            {layout.mode === "closed" ? "Open pane" : "Close pane"}
          </button>
          <button className="rounded-full border border-border px-3 py-1 hover:bg-muted" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
            Toggle theme
          </button>
        </span>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-4 pt-2 pb-40">
          <p className="text-[0.85rem] leading-relaxed text-muted-foreground">
            {live
              ? "Attached to the real endpoints with this visitor's browser id. Ask the agent to open a page, or use the address bar after taking over."
              : "Everything here is a mock: the page is drawn on a canvas, and the buttons in the panel play what the server would send."}
          </p>
          <BrowserCard browserId={browserId} />
          {state.approval ? (
            <div className="flex animate-rise flex-wrap items-center gap-3 rounded-2xl border border-brass/50 bg-card px-4 py-3 shadow-card">
              <div className="min-w-[12rem] flex-1">
                <p className="text-[0.9rem] font-medium">Approve this step?</p>
                <p className="text-[0.82rem] text-muted-foreground">{state.approval.label}</p>
              </div>
              <button onClick={onDecline} className="h-9 rounded-full border border-border bg-card px-4 text-[0.85rem] font-medium hover:bg-muted">
                Decline
              </button>
              <button onClick={onApprove} className="h-9 rounded-full bg-primary px-4 text-[0.85rem] font-medium text-primary-foreground hover:opacity-90">
                Approve
              </button>
            </div>
          ) : null}
          <dl className="nums grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-surface px-4 py-3 text-[0.78rem] hairline">
            {(
              [
                ["status", state.status],
                ["control", state.control],
                ["busy", String(state.busy)],
                ["activity", state.activity || "none"],
                ["layout", layout.mode],
                ["connected", String(connected)],
              ] as const
            ).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-subtle">{k}</dt>
                <dd className="truncate">{v}</dd>
              </React.Fragment>
            ))}
          </dl>
          {log.length > 0 ? (
            <ul className="flex flex-col gap-1 text-[0.78rem] text-muted-foreground">
              {log.map((line, i) => (
                <li key={`${i}-${line}`} className="truncate">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </>
  );
}

/* ───────────────────────── The panel that plays the server's part ───────────────────────── */

const GROUPS: Array<[string, Array<[label: string, play: string]>]> = [
  [
    "Life",
    [
      ["Play all", "all"],
      ["Start", "start"],
      ["Idle", "idle"],
      ["Closed", "closed"],
      ["Error", "error"],
      ["Lost connection", "offline"],
    ],
  ],
  [
    "Steps",
    [
      ["Navigate", "navigate"],
      ["Read", "read"],
      ["Click", "click"],
      ["Type", "type"],
      ["Select", "select"],
      ["Press", "press"],
      ["Scroll down", "scroll-down"],
      ["Scroll up", "scroll-up"],
      ["Hover", "hover"],
      ["Wait", "wait"],
    ],
  ],
  [
    "Needs the user",
    [
      ["Approval", "approval"],
      ["Blocked", "blocked"],
      ["Sign in", "handover-login"],
      ["Check", "handover-captcha"],
      ["Code", "handover-verification"],
      ["Pay", "handover-payment"],
      ["Payment page", "payment-page"],
      ["User takes over", "take"],
      ["Agent resumes", "release"],
      ["Several tabs", "tabs"],
    ],
  ],
];

function MockPanel({ onPlay }: { onPlay: (name: string) => void }) {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="fixed right-3 bottom-3 z-[48] w-[min(21rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-border bg-card/95 shadow-float backdrop-blur-xl">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-3.5 py-2 text-[0.78rem] font-medium">
        Mock server
        {open ? <ChevronDown className="size-4 text-subtle" /> : <ChevronUp className="size-4 text-subtle" />}
      </button>
      {open ? (
        <div className="flex max-h-[46dvh] flex-col gap-2.5 overflow-y-auto px-3 pb-3">
          {GROUPS.map(([title, items]) => (
            <div key={title}>
              <p className="mb-1 text-[0.65rem] font-medium tracking-wider text-subtle uppercase">{title}</p>
              <div className="flex flex-wrap gap-1">
                {items.map(([label, play]) => (
                  <button
                    key={play}
                    onClick={() => onPlay(play)}
                    className={cn(
                      "rounded-full border border-border px-2.5 py-1 text-[0.74rem] transition-colors hover:bg-muted",
                      play === "all" && "border-transparent bg-primary text-primary-foreground hover:bg-primary hover:opacity-90",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────── The mock: a fake page and a fake server ───────────────────────── */

type Scene = "booking" | "times" | "login" | "captcha" | "payment";
type FieldName = "date" | "time" | "guests" | "name" | "email" | "user" | "password" | "card";

type Driver = { play: (name: string) => void; stop: () => void };

const W = VIEWPORT.width;
const H = VIEWPORT.height;
const PAGE_HEIGHT = 1500;

/** Where things are on the fake page, in page coordinates (before scrolling). */
const AT = {
  navSignIn: { x: 1136, y: 16, width: 104, height: 34 },
  date: { x: 150, y: 262, width: 280, height: 46 },
  time: { x: 450, y: 262, width: 280, height: 46 },
  guests: { x: 150, y: 352, width: 280, height: 46 },
  name: { x: 450, y: 352, width: 280, height: 46 },
  email: { x: 150, y: 442, width: 580, height: 46 },
  find: { x: 150, y: 526, width: 200, height: 50 },
  slot: { x: 330, y: 300, width: 130, height: 48 },
  confirm: { x: 150, y: 420, width: 280, height: 52 },
  user: { x: 440, y: 300, width: 400, height: 46 },
  password: { x: 440, y: 386, width: 400, height: 46 },
  signIn: { x: 440, y: 470, width: 400, height: 50 },
  robot: { x: 490, y: 350, width: 300, height: 76 },
  card: { x: 360, y: 290, width: 560, height: 46 },
  pay: { x: 360, y: 470, width: 560, height: 54 },
} satisfies Record<string, Box>;

const FIELD_BOX: Record<FieldName, Box> = { date: AT.date, time: AT.time, guests: AT.guests, name: AT.name, email: AT.email, user: AT.user, password: AT.password, card: AT.card };
const SCENE_FIELDS: Record<Scene, FieldName[]> = { booking: ["date", "time", "guests", "name", "email"], times: [], login: ["user", "password"], captcha: [], payment: ["card"] };

function createDriver(id: string, note: (line: string) => void): Driver {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const page = {
    scene: "booking" as Scene,
    scrollY: 0,
    fields: { date: "", time: "", guests: "2 guests", name: "", email: "", user: "", password: "", card: "" } as Record<FieldName, string>,
    focus: null as FieldName | null,
    pressed: false,
    robot: false,
    /** Where the mock last "received" the user's pointer, to check that positions map correctly. */
    pointer: null as { x: number; y: number; down: boolean } | null,
  };
  let state: BrowserState = { ...IDLE_STATE };
  let actionId = 0;
  let run = 0;
  let received = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const mock = mockBrowser(id, {
    onInput: (events) => {
      received += events.length;
      handleInput(events);
    },
    onControl: (request, current) => handleControl(request, current),
  });

  // Like the real stream, say where things stand as soon as someone is listening.
  mock.emit({ type: "state", state });

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        timers.delete(t);
        resolve();
      }, ms);
      timers.add(t);
    });

  const setState = (patch: Partial<BrowserState>) => {
    state = { ...state, ...patch };
    mock.emit({ type: "state", state });
  };
  const frame = () => {
    draw(ctx, page);
    mock.emit({ type: "frame", data: canvas.toDataURL("image/jpeg", 0.82).split(",")[1] ?? "", width: W, height: H });
  };
  const onScreen = (box: Box): Box => ({ ...box, y: box.y - (page.scene === "booking" ? page.scrollY : 0) });
  const centre = (box: Box) => ({ x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) });
  const act = async (action: Omit<AgentAction, "id" | "leadMs"> & { leadMs?: number }) => {
    const full: AgentAction = { leadMs: 520, ...action, id: ++actionId };
    setState({ busy: true, activity: full.label });
    mock.emit({ type: "action", action: full });
    await sleep(full.leadMs);
  };
  const settle = async (ms = 700) => {
    await sleep(ms);
    setState({ busy: false, activity: "" });
  };
  const ready = (scene: Scene, url: string, title: string, patch: Partial<BrowserState> = {}) => {
    page.scene = scene;
    page.scrollY = 0;
    page.focus = null;
    page.pressed = false;
    setState({ status: "ready", url, title, loading: false, canGoBack: scene !== "booking", canGoForward: false, tabs: [{ id: "t1", title, url, active: true }], ...patch });
    frame();
  };
  const booking = (patch: Partial<BrowserState> = {}) => ready("booking", "https://www.ravintolasavu.fi/en/reserve", "Reserve a table: Ravintola Savu", { control: "agent", handover: undefined, approval: undefined, paymentPage: false, ...patch });
  const ensure = async () => {
    if (state.status !== "ready" || state.control !== "agent" || page.scene !== "booking") {
      booking();
      await sleep(250);
    }
  };

  const typeInto = async (name: FieldName, text: string, label: string) => {
    const box = onScreen(FIELD_BOX[name]);
    await act({ kind: "type", label, box, point: centre(box), text });
    page.focus = name;
    for (let i = 1; i <= text.length; i += 2) {
      page.fields[name] = text.slice(0, i + 1);
      frame();
      await sleep(45);
    }
    page.fields[name] = text;
    frame();
    await settle();
  };
  const scrollTo = async (target: number, direction: "up" | "down") => {
    await act({ kind: "scroll", label: direction === "down" ? "Scrolling down" : "Scrolling back up", direction, leadMs: 200 });
    const from = page.scrollY;
    for (let i = 1; i <= 12; i++) {
      page.scrollY = Math.round(from + ((target - from) * i) / 12);
      frame();
      await sleep(28);
    }
    await settle(500);
  };
  const handover = (kind: HandoverKind, scene: Scene, url: string, title: string, reason: string) => {
    ready(scene, url, title, { control: "user", busy: false, activity: "", approval: undefined, paymentPage: kind === "payment", handover: { kind, reason, site: new URL(url).hostname.replace(/^www\./, ""), toolCallId: `call_${kind}` } });
  };

  const steps: Record<string, () => Promise<void> | void> = {
    start: async () => {
      state = { ...IDLE_STATE };
      setState({ status: "starting" });
      await sleep(900);
      booking();
    },
    idle: () => setState({ ...IDLE_STATE }),
    closed: () => setState({ ...IDLE_STATE, status: "closed" }),
    error: () => setState({ ...IDLE_STATE, status: "error", error: "Chrome could not be started on this machine. Check that it is installed, then ask again." }),
    offline: async () => {
      mock.setConnected(false);
      await sleep(3500);
      mock.setConnected(true);
    },
    navigate: async () => {
      if (state.status !== "ready") booking();
      await act({ kind: "navigate", label: "Opening ravintolasavu.fi", leadMs: 250 });
      setState({ loading: true });
      await sleep(1100);
      booking({ busy: true, activity: "Opening ravintolasavu.fi" });
      await settle(400);
    },
    read: async () => {
      await ensure();
      await act({ kind: "read", label: "Reading the page", leadMs: 150 });
      await settle(1300);
    },
    click: async () => {
      await ensure();
      const box = onScreen(AT.find);
      await act({ kind: "click", label: "Clicking 'Find a table'", box, point: centre(box) });
      page.pressed = true;
      frame();
      await sleep(260);
      ready("times", "https://www.ravintolasavu.fi/en/reserve/times", "Choose a time: Ravintola Savu", { busy: true, activity: "Clicking 'Find a table'" });
      await settle(600);
    },
    type: async () => {
      await ensure();
      await typeInto("name", "Asad Ullah", "Typing the name for the booking");
    },
    select: async () => {
      await ensure();
      const box = onScreen(AT.guests);
      await act({ kind: "select", label: "Choosing the party size", box, point: centre(box), text: "4 guests" });
      page.fields.guests = "4 guests";
      frame();
      await settle(900);
    },
    press: async () => {
      await ensure();
      const box = onScreen(AT.email);
      await act({ kind: "press", label: "Pressing Enter", box, text: "Enter", leadMs: 200 });
      await settle(800);
    },
    "scroll-down": async () => {
      await ensure();
      await scrollTo(520, "down");
    },
    "scroll-up": async () => {
      await ensure();
      await scrollTo(0, "up");
    },
    hover: async () => {
      await ensure();
      const box = onScreen(AT.navSignIn);
      await act({ kind: "hover", label: "Pointing at 'Sign in'", box, point: centre(box) });
      await settle(700);
    },
    wait: async () => {
      await ensure();
      await act({ kind: "wait", label: "Waiting for the times to load", leadMs: 100 });
      await settle(1500);
    },
    approval: async () => {
      ready("times", "https://www.ravintolasavu.fi/en/reserve/times", "Choose a time: Ravintola Savu", { control: "agent", handover: undefined, paymentPage: false });
      await sleep(250);
      const box = AT.confirm;
      await act({ kind: "approval", label: "Waiting for your approval", box, point: centre(box) });
      setState({ busy: false, activity: "", approval: { label: "Confirm a table for 4 at Ravintola Savu, Saturday 15 November at 19:00" } });
    },
    approve: async () => {
      setState({ approval: undefined });
      const box = AT.confirm;
      await act({ kind: "click", label: "Clicking 'Confirm reservation'", box, point: centre(box) });
      page.pressed = true;
      frame();
      await settle(700);
      page.pressed = false;
      frame();
    },
    decline: () => setState({ approval: undefined, busy: false, activity: "" }),
    blocked: async () => {
      ready("payment", "https://pay.ravintolasavu.fi/checkout", "Payment: Ravintola Savu", { control: "agent", handover: undefined, approval: undefined, paymentPage: true });
      await sleep(250);
      await act({ kind: "blocked", label: "Stopped: card details are yours to enter", box: AT.card, point: centre(AT.card), leadMs: 450 });
      await settle(1800);
    },
    "handover-login": () => handover("login", "login", "https://www.ravintolasavu.fi/en/sign-in", "Sign in: Ravintola Savu", "Sign in to your Ravintola Savu account so the booking is saved under your name."),
    "handover-captcha": () => handover("captcha", "captcha", "https://www.ravintolasavu.fi/en/check", "One moment: Ravintola Savu", "The site is checking that a person is here before it shows the times."),
    "handover-verification": () => handover("verification", "login", "https://www.ravintolasavu.fi/en/verify", "Confirm it is you: Ravintola Savu", "Enter the six-digit code the restaurant sent to your phone."),
    "handover-payment": () => handover("payment", "payment", "https://pay.ravintolasavu.fi/checkout", "Payment: Ravintola Savu", "The table needs a 20 euro deposit. Everything else is filled in."),
    "payment-page": () => ready("payment", "https://pay.ravintolasavu.fi/checkout", "Payment: Ravintola Savu", { control: "agent", handover: undefined, approval: undefined, paymentPage: true, busy: false, activity: "" }),
    take: () => {
      if (state.status !== "ready") booking();
      setState({ control: "user", handover: undefined, busy: false, activity: "" });
    },
    release: () => setState({ control: "agent", handover: undefined }),
    tabs: () => {
      if (state.status !== "ready") booking();
      setState({
        tabs: [
          { id: "t1", title: state.title, url: state.url, active: true },
          { id: "t2", title: "Ravintola Savu: menu", url: "https://www.ravintolasavu.fi/en/menu", active: false },
          { id: "t3", title: "Directions to Tervasaari", url: "https://www.openstreetmap.org/#map=17/60.1741/24.9687", active: false },
        ],
      });
    },
    all: async () => {
      await steps.start();
      await sleep(500);
      await steps.read();
      await steps.select();
      await typeInto("date", "Sat 15 Nov", "Choosing the date");
      await typeInto("time", "19:00", "Choosing the time");
      await steps.type();
      await typeInto("email", "asad@example.com", "Typing the email for the confirmation");
      await steps["scroll-down"]();
      await steps["scroll-up"]();
      await steps.click();
      await sleep(400);
      await steps.approval();
    },
  };

  function handleControl(request: ControlRequest, current: BrowserState): BrowserState {
    note(`Control: ${request.action}${"url" in request ? ` ${request.url}` : ""}`);
    switch (request.action) {
      case "take":
        if (current.status !== "ready") booking();
        setState({ control: "user", busy: false, activity: "" });
        break;
      case "release":
        setState({ control: "agent", handover: undefined });
        break;
      case "navigate":
        ready("booking", request.url, request.url.replace(/^https?:\/\//, ""), { control: "user" });
        break;
      case "back":
        booking({ control: state.control });
        break;
      case "reload":
        frame();
        break;
      case "tab":
        setState({ tabs: state.tabs.map((tab) => ({ ...tab, active: tab.id === request.tabId })) });
        break;
      case "close":
        setState({ ...IDLE_STATE, status: "closed" });
        break;
      case "forget":
        setState({ ...IDLE_STATE });
        break;
      default:
        break;
    }
    return state;
  }

  /** The fake page reacts to the user: fields take focus and text, the wheel scrolls. */
  function handleInput(events: UserInput[]) {
    if (state.control !== "user") return;
    const fieldAt = (x: number, y: number) =>
      SCENE_FIELDS[page.scene].find((name) => {
        const b = onScreen(FIELD_BOX[name]);
        return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
      }) ?? null;
    for (const event of events) {
      if (event.type === "mouse") {
        page.pointer = { x: event.x, y: event.y, down: event.action === "down" || (event.action === "move" && Boolean(page.pointer?.down)) };
        if (event.action === "down") {
          page.focus = fieldAt(event.x, event.y);
          const r = AT.robot;
          if (page.scene === "captcha" && event.x >= r.x && event.x <= r.x + r.width && event.y >= r.y && event.y <= r.y + r.height) page.robot = true;
        }
      } else if (event.type === "wheel") {
        if (page.scene === "booking") page.scrollY = Math.min(Math.max(page.scrollY + event.deltaY, 0), PAGE_HEIGHT - H);
      } else if (event.type === "key") {
        if (event.action !== "down" || !page.focus) continue;
        if (event.key === "Backspace") page.fields[page.focus] = page.fields[page.focus].slice(0, -1);
        else if (event.key.length === 1) page.fields[page.focus] += event.key;
      } else if (page.focus) {
        page.fields[page.focus] += event.text;
      }
    }
    note(`Input received: ${received} events`);
    frame();
  }

  return {
    play: (name) => {
      const step = steps[name];
      if (!step) return;
      const mine = ++run;
      void Promise.resolve(step()).catch(() => {
        if (mine === run) note(`Step failed: ${name}`);
      });
    },
    stop: () => {
      timers.forEach(clearTimeout);
      timers.clear();
      mock.stop();
    },
  };
}

/* The fake page. A web page, not app interface: its colours are its own. */

function draw(
  ctx: CanvasRenderingContext2D,
  page: { scene: Scene; scrollY: number; fields: Record<FieldName, string>; focus: FieldName | null; pressed: boolean; robot: boolean; pointer: { x: number; y: number; down: boolean } | null },
) {
  const ink = "#1d2a26";
  const soft = "#6b7a75";
  const line = "#dcd8cc";
  const green = "#1f6f55";
  ctx.fillStyle = "#f7f4ec";
  ctx.fillRect(0, 0, W, H);

  const rounded = (b: Box, fill: string, stroke?: string, radius = 10) => {
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.width, b.height, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };
  const text = (value: string, x: number, y: number, font: string, colour = ink) => {
    ctx.font = font;
    ctx.fillStyle = colour;
    ctx.textBaseline = "middle";
    ctx.fillText(value, x, y);
  };
  const field = (name: FieldName, label: string, placeholder: string, offset = 0) => {
    const b = { ...FIELD_BOX[name], y: FIELD_BOX[name].y - offset };
    text(label, b.x, b.y - 16, "500 14px Helvetica, Arial, sans-serif", soft);
    rounded(b, "#ffffff", page.focus === name ? green : line);
    const raw = page.fields[name];
    const value = name === "password" ? "•".repeat(raw.length) : raw;
    text(value || placeholder, b.x + 16, b.y + b.height / 2, "16px Helvetica, Arial, sans-serif", value ? ink : "#a9b1ad");
    if (page.focus === name) {
      ctx.font = "16px Helvetica, Arial, sans-serif";
      const caret = b.x + 17 + ctx.measureText(value).width;
      ctx.fillStyle = green;
      ctx.fillRect(caret, b.y + 12, 1.5, b.height - 24);
    }
  };
  const button = (b: Box, label: string, pressed = false) => {
    rounded(b, pressed ? "#16513e" : green, undefined, 12);
    ctx.font = "600 17px Helvetica, Arial, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, b.x + (b.width - ctx.measureText(label).width) / 2, b.y + b.height / 2 + 1);
  };
  const header = () => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, 66);
    ctx.fillStyle = line;
    ctx.fillRect(0, 66, W, 1);
    text("Ravintola Savu", 120, 34, "600 24px Georgia, serif");
    ["Menu", "Reserve", "Contact"].forEach((item, i) => text(item, 820 + i * 100, 34, "15px Helvetica, Arial, sans-serif", i === 1 ? green : soft));
    rounded(AT.navSignIn, "#ffffff", line, 17);
    text("Sign in", AT.navSignIn.x + 26, 34, "500 14px Helvetica, Arial, sans-serif");
  };

  if (page.scene === "booking") {
    const o = page.scrollY;
    text("Reserve a table", 120, 142 - o, "400 44px Georgia, serif");
    text("Smoked fish, open fire and a view of the harbour. Tables are held for 15 minutes.", 122, 190 - o, "16px Helvetica, Arial, sans-serif", soft);
    rounded({ x: 120, y: 216 - o, width: 640, height: 392 }, "#ffffff", line, 18);
    field("date", "Date", "Choose a date", o);
    field("time", "Time", "Choose a time", o);
    field("guests", "Guests", "2 guests", o);
    field("name", "Name", "Your name", o);
    field("email", "Email", "you@example.com", o);
    button({ ...AT.find, y: AT.find.y - o }, "Find a table", page.pressed);
    rounded({ x: 820, y: 216 - o, width: 340, height: 392 }, "#e9efe9", undefined, 18);
    text("Open today", 850, 262 - o, "600 20px Georgia, serif");
    text("17:00 to 23:00", 850, 292 - o, "16px Helvetica, Arial, sans-serif", soft);
    text("Tervasaarenkannas 3, Helsinki", 850, 330 - o, "15px Helvetica, Arial, sans-serif", soft);
    text("+358 9 7425 5574", 850, 356 - o, "15px Helvetica, Arial, sans-serif", soft);
    text("What guests say", 120, 700 - o, "400 32px Georgia, serif");
    ["The smoked salmon soup alone is worth the walk across the bridge.", "Warm, unhurried service. We stayed three hours.", "Book ahead on weekends: it fills by six.", "Ask for the table by the window in winter."].forEach((quote, i) => {
      rounded({ x: 120, y: 750 + i * 150 - o, width: 1040, height: 120 }, "#ffffff", line, 16);
      text(`“${quote}”`, 150, 800 + i * 150 - o, "italic 20px Georgia, serif");
      text(["Liisa, Helsinki", "Marco, Milan", "Aino, Espoo", "Jonas, Stockholm"][i] ?? "", 150, 836 + i * 150 - o, "14px Helvetica, Arial, sans-serif", soft);
    });
    header();
  } else if (page.scene === "times") {
    header();
    text("Choose a time", 120, 142, "400 44px Georgia, serif");
    text("Saturday 15 November, 4 guests", 122, 190, "16px Helvetica, Arial, sans-serif", soft);
    ["18:00", "19:00", "19:30", "20:30", "21:00"].forEach((slot, i) => {
      const b = { x: 150 + i * 150, y: AT.slot.y, width: 130, height: 48 };
      const chosen = i === 1;
      rounded(b, chosen ? "#e3efe9" : "#ffffff", chosen ? green : line, 12);
      text(slot, b.x + 42, b.y + 25, "600 17px Helvetica, Arial, sans-serif", chosen ? green : ink);
    });
    text("Held for you for 10 minutes. No payment needed for parties under six.", 150, 386, "15px Helvetica, Arial, sans-serif", soft);
    button(AT.confirm, "Confirm reservation", page.pressed);
  } else if (page.scene === "login") {
    header();
    rounded({ x: 390, y: 180, width: 500, height: 390 }, "#ffffff", line, 18);
    text("Sign in", 440, 232, "400 34px Georgia, serif");
    field("user", "Email", "you@example.com");
    field("password", "Password", "Your password");
    button(AT.signIn, "Sign in");
  } else if (page.scene === "captcha") {
    rounded({ x: 390, y: 220, width: 500, height: 300 }, "#ffffff", line, 18);
    text("One moment", 440, 276, "400 34px Georgia, serif");
    text("We are checking that a person is here.", 440, 318, "16px Helvetica, Arial, sans-serif", soft);
    rounded(AT.robot, "#fafafa", line, 8);
    rounded({ x: AT.robot.x + 18, y: AT.robot.y + 23, width: 30, height: 30 }, page.robot ? green : "#ffffff", page.robot ? green : "#9aa3a0", 5);
    if (page.robot) text("✓", AT.robot.x + 25, AT.robot.y + 39, "600 20px Helvetica, Arial, sans-serif", "#ffffff");
    text("I am a person", AT.robot.x + 66, AT.robot.y + 39, "17px Helvetica, Arial, sans-serif");
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, 66);
    ctx.fillStyle = line;
    ctx.fillRect(0, 66, W, 1);
    text("Secure payment", 120, 34, "600 22px Georgia, serif");
    rounded({ x: 310, y: 150, width: 660, height: 420 }, "#ffffff", line, 18);
    text("Deposit for your table", 360, 204, "400 30px Georgia, serif");
    text("20,00 €   Ravintola Savu, Saturday 15 November", 360, 242, "16px Helvetica, Arial, sans-serif", soft);
    field("card", "Card number", "1234 1234 1234 1234");
    rounded({ x: 360, y: 380, width: 270, height: 46 }, "#ffffff", line);
    text("MM / YY", 376, 403, "16px Helvetica, Arial, sans-serif", "#a9b1ad");
    rounded({ x: 650, y: 380, width: 270, height: 46 }, "#ffffff", line);
    text("CVC", 666, 403, "16px Helvetica, Arial, sans-serif", "#a9b1ad");
    button(AT.pay, "Pay 20,00 €");
  }

  // Where the mock received the user's pointer: it should sit exactly under the real one.
  if (page.pointer) {
    ctx.beginPath();
    ctx.arc(page.pointer.x, page.pointer.y, page.pointer.down ? 9 : 6, 0, Math.PI * 2);
    ctx.strokeStyle = "#b8860b";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
