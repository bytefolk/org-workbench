// Preload bridge: whitelisted, enumerated methods only — no generic channel.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("owb", {
  status: () => ipcRenderer.invoke("owb:status"),
  openWorkspace: () => ipcRenderer.invoke("owb:workspace:open"),
  workspace: () => ipcRenderer.invoke("owb:workspace:get"),
  orgTree: () => ipcRenderer.invoke("owb:org:tree"),
  orgApply: (manifest) => ipcRenderer.invoke("owb:org:apply", manifest),
  orgBackups: () => ipcRenderer.invoke("owb:org:backups"),
  orgRestore: (backupId) => ipcRenderer.invoke("owb:org:restore", backupId),
  reports: () => ipcRenderer.invoke("owb:reports:get"),
  position: (positionId) => ipcRenderer.invoke("owb:position:get", positionId),
  createTurn: (request) => ipcRenderer.invoke("owb:turn:create", request),
  turnHistory: (positionId) => ipcRenderer.invoke("owb:turn:history", positionId),
  sseStatus: () => ipcRenderer.invoke("owb:sse-status:get"),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("owb:event", listener);
    return () => ipcRenderer.removeListener("owb:event", listener);
  },
  onSseStatus: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("owb:sse-status", listener);
    return () => ipcRenderer.removeListener("owb:sse-status", listener);
  },
});
