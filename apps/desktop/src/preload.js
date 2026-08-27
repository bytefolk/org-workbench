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
  orgUndo: () => ipcRenderer.invoke("owb:org:undo"),
  hire: (request) => ipcRenderer.invoke("owb:hire:create", request),
  reports: () => ipcRenderer.invoke("owb:reports:get"),
  position: (positionId) => ipcRenderer.invoke("owb:position:get", positionId),
  positionDocs: (positionId) => ipcRenderer.invoke("owb:position:docs:list", positionId),
  positionDocFile: (positionId, filePath) => ipcRenderer.invoke("owb:position:docs:read", positionId, filePath),
  createPositionDoc: (request) => ipcRenderer.invoke("owb:position:docs:create", request),
  resolveDocRef: (ref) => ipcRenderer.invoke("owb:docs:resolve", { ref }),
  assetsList: () => ipcRenderer.invoke("owb:assets:list"),
  assetsRead: (assetId) => ipcRenderer.invoke("owb:assets:read", assetId),
  assetsCreate: (request) => ipcRenderer.invoke("owb:assets:create", request),
  createTurn: (request) => ipcRenderer.invoke("owb:turn:create", request),
  cancelTurn: (positionId) => ipcRenderer.invoke("owb:turn:cancel", { positionId }),
  turnHistory: (positionId) => ipcRenderer.invoke("owb:turn:history", positionId),
  createSession: (request) => ipcRenderer.invoke("owb:session:create", request),
  sessions: (positionId) => ipcRenderer.invoke("owb:session:list", positionId),
  session: (sessionId) => ipcRenderer.invoke("owb:session:get", sessionId),
  rotateSession: (sessionId) => ipcRenderer.invoke("owb:session:rotate", sessionId),
  createSessionTurn: (request) => ipcRenderer.invoke("owb:session:turn:create", request),
  sessionTurnHistory: (sessionId) => ipcRenderer.invoke("owb:session:turn:history", sessionId),
  createGroup: (request) => ipcRenderer.invoke("owb:group:create", request),
  groups: () => ipcRenderer.invoke("owb:group:list"),
  group: (conversationRef) => ipcRenderer.invoke("owb:group:get", conversationRef),
  addGroupMember: (request) => ipcRenderer.invoke("owb:group:member:add", request),
  createGroupTurn: (request) => ipcRenderer.invoke("owb:group:turn:create", request),
  groupTimeline: (conversationRef) => ipcRenderer.invoke("owb:group:timeline", conversationRef),
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
