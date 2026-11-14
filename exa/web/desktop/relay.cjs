// The bridge between the agent and the browser view inside the desktop app.
//
// The agent's side (Playwright, in the app's server) speaks the Chrome DevTools Protocol over a
// WebSocket, as it would to any Chrome. This relay answers the few browser-level questions itself
// and passes everything else to the view through Electron's own in-process debugger. No remote
// debugging port is opened and Chrome is not started in automation mode: the view stays an
// ordinary embedded browser. The socket listens on this computer only, behind a random path.
//
// Input needs care, because the view is a browser inside a page (the app's interface):
//  - Mouse: Chromium would aim the agent's clicks at the window, where the interface's own layer
//    lies over the view while the agent drives. They are given straight to the view instead.
//  - Keys: Chromium delivers them to whatever has the keyboard in the window, which could be the
//    chat box. The view is given the keyboard first, and gets it back taken afterwards.
//  - While the agent drives, the user's own keys do not reach the page (their clicks are stopped
//    by the interface). When the user takes over, everything they do goes to the page directly.
const crypto = require("node:crypto");
const { WebSocketServer } = require("ws");

const KEY_COMMANDS = new Set(["Input.dispatchKeyEvent", "Input.insertText", "Input.imeSetComposition"]);
const MODIFIERS = [
  [1, "alt"],
  [2, "control"],
  [4, "meta"],
  [8, "shift"],
];
const BUTTONS = [
  [1, "leftButtonDown"],
  [2, "rightButtonDown"],
  [4, "middleButtonDown"],
];

/**
 * @param {import("electron").WebContents} guest  the browser view's contents
 * @param {{ log?: (...args: unknown[]) => void }} [options]
 * @returns {Promise<{ endpoint: string, close: () => void }>}
 */
function startRelay(guest, options = {}) {
  const verbose = process.env.BATON_RELAY_LOG === "2";
  const log = options.log ?? (process.env.BATON_RELAY_LOG ? (...args) => console.error("[relay]", ...args) : () => {});
  const token = crypto.randomBytes(18).toString("hex");
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0, path: `/${token}` });
  const PAGE = "baton-page";
  /** A second channel to "the browser" itself, which the agent opens to ask for more page sessions. */
  const BROWSER = "baton-browser";
  /** Extra sessions the agent opens on the same page: they all talk to the one view. */
  const aliases = new Set([PAGE]);
  let aliasCount = 0;
  let client = null;
  let targetInfo = null;
  /** How much smaller the page is drawn than it is laid out (a narrow view shows a desktop layout, zoomed out). */
  let scale = 1;
  /** Who is driving, as the app's server says. */
  let control = "agent";
  /** Key presses of the agent on their way to the page. */
  let agentKeys = 0;
  let giveBack = null;

  const attach = () => {
    if (guest.isDestroyed()) throw new Error("The browser view has been closed.");
    if (!guest.debugger.isAttached()) guest.debugger.attach("1.3");
  };
  const send = (message) => {
    if (client && client.readyState === 1) client.send(JSON.stringify(message));
  };

  const onMessage = (_event, method, params, sessionId) => send({ method, params, sessionId: sessionId || PAGE });
  guest.debugger.on("message", onMessage);

  // While the agent drives, the keyboard is not the user's way into the page.
  const onKey = (event) => {
    if (control === "agent" && agentKeys === 0) event.preventDefault();
  };
  guest.on("before-input-event", onKey);

  const inInterface = (script) => {
    const host = guest.hostWebContents;
    if (!host || host.isDestroyed()) return Promise.resolve(undefined);
    return host.executeJavaScript(script, false).catch(() => undefined);
  };
  /** Give the view the keyboard, remembering who had it. */
  const takeKeyboard = () =>
    inInterface(`(() => {
      const view = document.querySelector("webview");
      if (!view || document.activeElement === view) return;
      window.__batonKeyboardWas = document.activeElement;
      view.focus();
    })()`);
  /** The agent has stopped typing: whoever had the keyboard gets it back (unless the user has taken the page over). */
  const returnKeyboard = () => {
    clearTimeout(giveBack);
    giveBack = setTimeout(() => {
      if (control !== "agent" || agentKeys > 0) return;
      void inInterface(`(() => {
        const view = document.querySelector("webview");
        const was = window.__batonKeyboardWas;
        window.__batonKeyboardWas = null;
        if (!view || document.activeElement !== view) return;
        if (was && was !== document.body && was.isConnected) was.focus();
        else view.blur();
      })()`);
    }, 500);
  };

  /** The agent's pointer, given to the view itself. Positions arrive in page units; the view counts in drawn ones. */
  async function mouse(params) {
    const modifiers = [...MODIFIERS.filter(([bit]) => (params.modifiers ?? 0) & bit), ...BUTTONS.filter(([bit]) => (params.buttons ?? 0) & bit)].map(([, name]) => name);
    const x = Math.round((params.x ?? 0) * scale);
    const y = Math.round((params.y ?? 0) * scale);
    const button = ["left", "middle", "right"].includes(params.button) ? params.button : "left";
    switch (params.type) {
      case "mouseMoved":
        guest.sendInputEvent({ type: "mouseMove", x, y, modifiers });
        return {};
      case "mousePressed":
        guest.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: params.clickCount ?? 1, modifiers });
        break;
      case "mouseReleased":
        guest.sendInputEvent({ type: "mouseUp", x, y, button, clickCount: params.clickCount ?? 1, modifiers });
        break;
      case "mouseWheel":
        // The protocol counts a scroll down as positive, the view counts it as negative.
        guest.sendInputEvent({ type: "mouseWheel", x, y, deltaX: -Math.round((params.deltaX ?? 0) * scale), deltaY: -Math.round((params.deltaY ?? 0) * scale), canScroll: true, modifiers });
        break;
      default:
        return {};
    }
    // Let the page take the press in before the agent goes on to look at what it did.
    await Promise.race([guest.debugger.sendCommand("Runtime.evaluate", { expression: "new Promise((done) => requestAnimationFrame(() => done(1)))", awaitPromise: true }).catch(() => {}), new Promise((done) => setTimeout(done, 150))]);
    return {};
  }

  async function browserLevel(method, params) {
    switch (method) {
      case "Browser.getVersion":
        return { protocolVersion: "1.3", product: `Chrome/${process.versions.chrome}`, revision: "", userAgent: guest.getUserAgent(), jsVersion: process.versions.v8 };
      case "Target.setAutoAttach": {
        attach();
        const info = await guest.debugger.sendCommand("Target.getTargetInfo");
        // The view is a "webview" target to Chromium; to the agent it is simply the page.
        targetInfo = { ...info.targetInfo, type: "page", attached: true };
        send({ method: "Target.attachedToTarget", params: { sessionId: PAGE, targetInfo, waitingForDebugger: false } });
        return {};
      }
      case "Target.getTargetInfo":
        return { targetInfo: targetInfo ?? { targetId: "baton-browser", type: "browser", title: "", url: "", attached: true, canAccessOpener: false } };
      case "Target.attachToBrowserTarget":
        return { sessionId: BROWSER };
      case "Target.attachToTarget": {
        const sessionId = `baton-alias-${++aliasCount}`;
        aliases.add(sessionId);
        return { sessionId };
      }
      case "Target.detachFromTarget":
        if (params?.sessionId && params.sessionId !== PAGE) aliases.delete(params.sessionId);
        return {};
      default:
        log("browser-level call answered with nothing:", method);
        return {};
    }
  }

  async function handle(method, params, sessionId) {
    // Notes from the app's server to this bridge, not for the page.
    if (method.startsWith("Baton.")) {
      if (method === "Baton.setControl") control = params?.control === "user" ? "user" : "agent";
      return {};
    }
    if (!sessionId || sessionId === BROWSER) return browserLevel(method, params);
    attach();
    if (method === "Target.detachFromTarget" && aliases.has(sessionId)) return {};
    const onPage = aliases.has(sessionId);
    if (onPage && method === "Input.dispatchMouseEvent") return mouse(params ?? {});
    if (onPage && KEY_COMMANDS.has(method)) {
      await takeKeyboard();
      agentKeys += 1;
      try {
        return await guest.debugger.sendCommand(method, params ?? {});
      } finally {
        agentKeys -= 1;
        returnKeyboard();
      }
    }
    const result = await guest.debugger.sendCommand(method, params ?? {}, onPage ? undefined : sessionId);
    if (onPage && method === "Emulation.setDeviceMetricsOverride") scale = params?.scale > 0 ? params.scale : 1;
    if (onPage && method === "Emulation.clearDeviceMetricsOverride") scale = 1;
    return result;
  }

  server.on("connection", (socket) => {
    client = socket;
    socket.on("message", async (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      const { id, method, params, sessionId } = message;
      if (verbose && /^(Input|Emulation|Baton)\./.test(method)) log(method, JSON.stringify(params ?? {}).slice(0, 160));
      try {
        const result = await handle(method, params, sessionId);
        send({ id, sessionId, result: result ?? {} });
      } catch (err) {
        log("failed:", method, sessionId ?? "", String(err?.message ?? err));
        send({ id, sessionId, error: { code: -32000, message: String(err?.message ?? err) || "The browser view did not answer." } });
      }
    });
    socket.on("close", () => {
      if (client !== socket) return;
      client = null;
      // The agent has let go of the page: it is the user's again until the agent comes back.
      control = "agent";
      scale = 1;
    });
  });

  const close = () => {
    clearTimeout(giveBack);
    try {
      guest.debugger.off("message", onMessage);
      guest.off("before-input-event", onKey);
      if (!guest.isDestroyed() && guest.debugger.isAttached()) guest.debugger.detach();
    } catch {
      /* already gone */
    }
    server.close();
  };
  guest.once("destroyed", close);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => resolve({ endpoint: `ws://127.0.0.1:${server.address().port}/${token}`, close }));
  });
}

module.exports = { startRelay };
