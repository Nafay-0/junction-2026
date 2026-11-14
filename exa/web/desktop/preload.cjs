// The little the interface may ask of the desktop app. It runs in the interface's page, isolated
// from it: the page gets these three functions and nothing else.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("batonDesktop", {
  /** The browser view with this id is on screen: returns where the agent can reach it. */
  attach: (webContentsId) => ipcRenderer.invoke("baton:attach", webContentsId),
  /** Wipe every sign-in, cookie and saved form entry of the browser view. */
  forget: () => ipcRenderer.invoke("baton:forget"),
  version: "0.1",
});
