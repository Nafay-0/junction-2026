// Baton as a desktop app: the same interface in a window of its own, with a real browser inside it.
//
// The web version has to keep its browser on a server and show pictures of it. Here the browser is
// a view in this window: the user clicks and types into it directly (so signing in is just
// signing in), and the agent works in the same view through the bridge in relay.cjs. The view is
// an ordinary embedded browser. It is not started in automation mode and nothing about it is
// disguised: it tells sites it is Baton.
//
// Started by run.mjs, which makes sure the interface's server is up and passes its address.
const { app, BrowserWindow, ipcMain, session, shell, webContents } = require("electron");
const path = require("node:path");
const { startRelay } = require("./relay.cjs");

const APP_URL = process.env.BATON_URL || "http://localhost:3000";
const PARTITION = "persist:baton";
app.setName("Baton");

/** Bridges by browser view, so a view is only ever bridged once. */
const relays = new Map();

/** What the browser view calls itself to sites: Baton, on the Chrome it is built from. */
function browserName() {
  const chrome = process.versions.chrome;
  const platform = (session.defaultSession.getUserAgent().match(/\(([^)]+)\)/) || [])[1] || "Macintosh; Intel Mac OS X 10_15_7";
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Baton/0.1 Chrome/${chrome} Safari/537.36`;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 720,
    minHeight: 560,
    title: "Baton",
    backgroundColor: "#0c1210",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  // The window shows the interface and nothing else: links in it open in the user's own browser.
  const home = new URL(APP_URL).origin;
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== home) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  // The browser view: no access to this app's internals, whatever a page asks for.
  win.webContents.on("will-attach-webview", (_event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    // The agent keeps working while the user looks at something else.
    webPreferences.backgroundThrottling = false;
    params.partition = PARTITION;
  });
  win.webContents.on("did-attach-webview", (_event, guest) => {
    // A link that wants a new tab opens in the same view. A real pop-up (a sign-in window) opens
    // as a small window of its own, with nothing of the agent attached to it at all.
    guest.setWindowOpenHandler(({ url, disposition }) => {
      if (disposition === "new-window") {
        return { action: "allow", overrideBrowserWindowOptions: { width: 560, height: 720, parent: win, autoHideMenuBar: true, title: "Baton", webPreferences: { partition: PARTITION } } };
      }
      if (/^https?:/i.test(url)) void guest.loadURL(url);
      return { action: "deny" };
    });
    guest.once("destroyed", () => {
      relays.get(guest.id)?.close();
      relays.delete(guest.id);
    });
  });

  void win.loadURL(APP_URL);
  return win;
}

app.whenReady().then(() => {
  const store = session.fromPartition(PARTITION);
  store.setUserAgent(browserName());
  // A page in the browser view gets nothing it would have to ask a person for (location, camera,
  // microphone, notifications): there is no prompt here to ask with, so the answer is no.
  const HARMLESS = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock"]);
  store.setPermissionRequestHandler((_contents, permission, answer) => answer(HARMLESS.has(permission)));
  store.setPermissionCheckHandler((_contents, permission) => HARMLESS.has(permission));

  // The interface has put its browser view on screen: start the bridge to it and say where it is.
  ipcMain.handle("baton:attach", async (event, id) => {
    const guest = typeof id === "number" ? webContents.fromId(id) : null;
    if (!guest || guest.isDestroyed() || guest.hostWebContents !== event.sender) throw new Error("That is not this window's browser view.");
    let relay = relays.get(guest.id);
    if (!relay) {
      relay = await startRelay(guest);
      relays.set(guest.id, relay);
    }
    return relay.endpoint;
  });

  // "Forget sign-ins": wipe everything the browser view has stored.
  ipcMain.handle("baton:forget", async () => {
    const store = session.fromPartition(PARTITION);
    await store.clearStorageData();
    await store.clearCache();
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
