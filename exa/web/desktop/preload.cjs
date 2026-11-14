// What the interface may ask of the desktop app. This is the whole surface: the live browser's
// engine (run a step, take over, hand back, forget sign-ins) for the interface loaded from
// Beryl's server, and three small things for the "cannot reach the server" page. A page from
// anywhere else gets nothing.
const { contextBridge, ipcRenderer } = require("electron");

const argument = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || "").slice(name.length + 3);

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("berylShell", {
    server: () => ipcRenderer.invoke("beryl:shell:server"),
    setServer: (address) => ipcRenderer.invoke("beryl:shell:set-server", address),
    retry: () => ipcRenderer.invoke("beryl:shell:retry"),
  });
} else if (location.origin === argument("beryl-origin")) {
  const listeners = new Set();
  ipcRenderer.on("beryl:browser:event", (_event, message) => {
    for (const listener of listeners) listener(message);
  });
  contextBridge.exposeInMainWorld("berylDesktop", {
    version: process.versions.electron,
    platform: process.platform,
    browser: {
      /** Take one of the agent's steps in the live browser. */
      run: (call) => ipcRenderer.invoke("beryl:browser:run", call),
      /** The user pressed Stop. */
      stop: () => ipcRenderer.invoke("beryl:browser:stop"),
      /** The agent hands the page to the user. */
      handover: (input, toolCallId) => ipcRenderer.invoke("beryl:browser:handover", input, toolCallId),
      /** Take over, hand back, go back, approve a step, close. */
      control: (request) => ipcRenderer.invoke("beryl:browser:control", request),
      state: () => ipcRenderer.invoke("beryl:browser:state"),
      /** The browser view with this id is on screen. */
      attach: (webContentsId) => ipcRenderer.invoke("beryl:browser:attach", webContentsId),
      /** Wipe every sign-in, cookie and saved form entry of one account's store. */
      forget: (partition) => ipcRenderer.invoke("beryl:browser:forget", partition),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
}
