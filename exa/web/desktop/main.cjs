// Beryl as a desktop app: the same interface as the web version, in a window of its own, with a
// real browser inside it.
//
// The interface is not bundled here: it is loaded from Beryl's server (the address is below), so
// web and desktop are one codebase and one sign-in. What only the desktop app has is the live
// browser. It is a view in this window: the user clicks and types into it directly (so signing in
// is just signing in), and the agent's steps are carried out in it by the engine in this process
// (dist/engine.cjs, built from src/lib/browser), through the bridge in relay.cjs. The view is an
// ordinary embedded browser. It is not started in automation mode and nothing about it is
// disguised: it tells sites it is Beryl.
//
// Nothing here opens a browser outside the app: a link pressed in the interface opens in the
// app's own browser view.
const { app, BrowserWindow, ipcMain, nativeImage, session, shell, webContents } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { startRelay } = require("./relay.cjs");
const { createEngine } = require("./dist/engine.cjs");

app.setName("Beryl");

// A profile of its own, when asked for: BERYL_PROFILE=<folder> keeps this copy's settings and
// sign-ins there, so a second copy can run beside the first (development, testing a new build).
if (process.env.BERYL_PROFILE) app.setPath("userData", path.resolve(process.env.BERYL_PROFILE));

// One copy at a time per profile. Two would share the same settings and website sign-ins and
// overwrite each other's, so a second one brings the first to the front and leaves.
const onlyCopy = app.requestSingleInstanceLock();
if (!onlyCopy) app.quit();
app.on("second-instance", () => {
  const [open] = BrowserWindow.getAllWindows();
  if (!open) return;
  if (open.isMinimized()) open.restore();
  open.show();
  open.focus();
});

/* ───────────── Where the server is ───────────── */

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}
const asAddress = (value) => {
  // Nothing given is nothing: without this, an unset variable would read as the address "undefined".
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};
/**
 * In order: BERYL_URL (development), the address the user saved on the "cannot reach the server"
 * page, the address this build shipped with (config.json), and a server on this computer.
 */
function serverUrl() {
  return asAddress(process.env.BERYL_URL) || asAddress(readJson(settingsFile()).serverUrl) || asAddress(readJson(path.join(__dirname, "config.json")).serverUrl) || "http://localhost:3000";
}

/* ───────────── The browser view ───────────── */

/** Sign-ins are kept per account: each account has its own store on this computer. */
const PARTITION = /^persist:beryl-[A-Za-z0-9_-]{1,64}$/;
const configured = new Set();

/** What the browser view calls itself to sites: Beryl, on the Chrome it is built from. */
function browserName() {
  const platform = (session.defaultSession.getUserAgent().match(/\(([^)]+)\)/) || [])[1] || "Macintosh; Intel Mac OS X 10_15_7";
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Beryl/${app.getVersion()} Chrome/${process.versions.chrome} Safari/537.36`;
}

function configure(partition) {
  if (configured.has(partition)) return;
  configured.add(partition);
  const store = session.fromPartition(partition);
  store.setUserAgent(browserName());
  // A page in the browser view gets nothing it would have to ask a person for (location, camera,
  // microphone, notifications): there is no prompt here to ask with, so the answer is no.
  const HARMLESS = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock"]);
  store.setPermissionRequestHandler((_contents, permission, answer) => answer(HARMLESS.has(permission)));
  store.setPermissionCheckHandler((_contents, permission) => HARMLESS.has(permission));
}

/* ───────────── The engine and the window ───────────── */

const engine = createEngine();
/** Bridges by browser view, so a view is only ever bridged once. */
const relays = new Map();
let win = null;
let origin = new URL(serverUrl()).origin;

engine.subscribe((event) => {
  if (win && !win.isDestroyed()) win.webContents.send("beryl:browser:event", event);
});

/** Only the interface, loaded from the server in the app's own window, may use the engine. */
function fromInterface(event) {
  try {
    return Boolean(win) && event.sender === win.webContents && new URL(event.senderFrame.url).origin === origin;
  } catch {
    return false;
  }
}

function createWindow() {
  origin = new URL(serverUrl()).origin;
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 720,
    minHeight: 560,
    title: "Beryl",
    backgroundColor: "#0c1210",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      additionalArguments: [`--beryl-origin=${origin}`],
    },
  });
  // So the server can tell the desktop app from a browser tab. The interface itself asks the bridge.
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} BerylDesktop/${app.getVersion()}`);

  // The window shows the interface and nothing else. A link pressed in it opens in the app's own
  // browser view, with the user in control; mail and phone links go to the apps that handle them.
  const visit = (url) => {
    if (/^https?:/i.test(url)) void engine.control({ action: "visit", url });
    else if (/^(mailto|tel|sms):/i.test(url)) void shell.openExternal(url);
  };
  win.webContents.on("will-navigate", (event, url) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      event.preventDefault();
      return;
    }
    if (target.origin === origin || target.protocol === "file:") return;
    event.preventDefault();
    visit(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    visit(url);
    return { action: "deny" };
  });

  // The browser view: no access to this app's internals, whatever a page asks for, and only in
  // an account's own store.
  win.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    if (!PARTITION.test(params.partition || "")) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    // The agent keeps working while the user looks at something else.
    webPreferences.backgroundThrottling = false;
    configure(params.partition);
  });
  win.webContents.on("did-attach-webview", (_event, guest) => {
    // A link that wants a new tab opens in the same view. A real pop-up (some sign-ins open one)
    // opens as a small window of the app, with the same sign-ins and nothing of the agent attached.
    guest.setWindowOpenHandler(({ url, disposition }) => {
      if (disposition === "new-window") {
        return { action: "allow", overrideBrowserWindowOptions: { width: 560, height: 720, parent: win, autoHideMenuBar: true, title: "Beryl", webPreferences: { session: guest.session } } };
      }
      if (/^https?:/i.test(url)) void guest.loadURL(url);
      return { action: "deny" };
    });
    guest.once("destroyed", () => {
      relays.get(guest.id)?.close();
      relays.delete(guest.id);
    });
  });

  // The server cannot be reached: say so, and let the user point the app somewhere else.
  win.webContents.on("did-fail-load", (_event, code, _text, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || url.startsWith("file:")) return;
    void win.loadFile(path.join(__dirname, "offline.html"));
  });

  win.on("closed", () => {
    win = null;
    void engine.close();
  });
  void win.loadURL(serverUrl());
  return win;
}

app.whenReady().then(() => {
  // Another copy is already open with this profile: it has been brought forward, and this one is on its way out.
  if (!onlyCopy) return;
  const icon = path.join(__dirname, "icon.png");
  if (process.platform === "darwin" && app.dock && fs.existsSync(icon)) app.dock.setIcon(nativeImage.createFromPath(icon));

  /* The agent's steps, and what the user asks of the browser. */
  ipcMain.handle("beryl:browser:run", (event, call) => (fromInterface(event) ? engine.run(call) : null));
  ipcMain.handle("beryl:browser:stop", (event) => (fromInterface(event) ? engine.stop() : undefined));
  ipcMain.handle("beryl:browser:handover", (event, input, toolCallId) => (fromInterface(event) && typeof toolCallId === "string" ? engine.handover(input, toolCallId) : undefined));
  ipcMain.handle("beryl:browser:control", (event, request) => (fromInterface(event) ? engine.control(request) : null));
  ipcMain.handle("beryl:browser:state", (event) => (fromInterface(event) ? engine.state() : null));

  // The interface has put its browser view on screen: build the bridge to it and tell the engine.
  ipcMain.handle("beryl:browser:attach", async (event, id) => {
    if (!fromInterface(event)) return;
    const guest = typeof id === "number" ? webContents.fromId(id) : null;
    if (!guest || guest.isDestroyed() || guest.hostWebContents !== event.sender) throw new Error("That is not this window's browser view.");
    let relay = relays.get(guest.id);
    if (!relay) {
      relay = await startRelay(guest);
      relays.set(guest.id, relay);
    }
    engine.offerView(relay.endpoint);
  });

  // "Forget sign-ins": close the browser and wipe everything this account's store holds.
  ipcMain.handle("beryl:browser:forget", async (event, partition) => {
    if (!fromInterface(event) || !PARTITION.test(partition || "")) return;
    await engine.close();
    const store = session.fromPartition(partition);
    await store.clearStorageData();
    await store.clearCache();
  });

  /* The "cannot reach the server" page. */
  const fromShell = (event) => Boolean(win) && event.sender === win.webContents && event.senderFrame.url.startsWith("file:");
  ipcMain.handle("beryl:shell:server", (event) => (fromShell(event) ? serverUrl() : null));
  ipcMain.handle("beryl:shell:retry", (event) => {
    if (fromShell(event)) void win.loadURL(serverUrl());
  });
  ipcMain.handle("beryl:shell:set-server", (event, value) => {
    if (!fromShell(event)) return false;
    const address = asAddress(value);
    if (!address) return false;
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify({ ...readJson(settingsFile()), serverUrl: address }, null, 2));
    // The window was made for the old address: its bridge only answers to that one. Start afresh.
    const old = win;
    createWindow();
    old.destroy();
    return true;
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());

module.exports = { engine, serverUrl };
