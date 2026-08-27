// org-workbench Electron shell (main process).
//
// Security baseline (frozen, docs/api-contract-v0.md §安全基线):
//   - contextIsolation: true, nodeIntegration: false, sandbox: true
//   - preload exposes a whitelisted, enumerated IPC bridge only
//   - the boot token never enters the renderer: IPC -> main -> HTTP proxy
//   - strict CSP in renderer/index.html; no third-party CDN; no remote code
//
// Shell-service split (ADR-0001): main spawns apps/server as a child process
// with ELECTRON_RUN_AS_NODE; the same server also runs standalone.

const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { rendererEntryPath } = require("./runtime-paths.cjs");
const { validateRestoreRequest } = require("./org-ipc.cjs");
const { validateDocsListRequest, validateDocsReadRequest } = require("./docs-ipc.cjs");
const { validateHireRequest } = require("./hire-ipc.cjs");
const { turnHistoryPath, validateCancelRequest, validateCreateTurnRequest } = require("./turn-ipc.cjs");
const {
  sessionListPath,
  sessionPath,
  validateSessionCreateRequest,
  validateSessionId,
  validateSessionTurnRequest,
} = require("./session-ipc.cjs");
const {
  groupPath,
  validateConversationRef,
  validateGroupAddMemberRequest,
  validateGroupCreateRequest,
  validateGroupTurnRequest,
} = require("./group-ipc.cjs");

const SERVER_ENTRY = path.join(__dirname, "..", "..", "server", "dist", "src", "index.js");
const READY_TIMEOUT_MS = 15000;
const READY_PREFIX = "org-workbench-server ready ";

let controlPlane = null; // { child, port, token }
let controlPlaneError = null;
let mainWindow = null;
let eventStreamRequest = null;
let currentSseStatus = "connecting";

function startControlPlane() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        // Directly runnable: default the pinned engine to the bundled qoder
        // adapter unless the operator pins a real digital-employee CLI.
        ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI:
          process.env.ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI ??
          `node ${path.join(__dirname, "..", "..", "server", "bin", "qoder-engine.mjs")}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buffer = "";
    const timer = setTimeout(() => {
      reject(new Error("control plane did not become ready within 15s"));
    }, READY_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const line = buffer
        .split("\n")
        .find((entry) => entry.startsWith(READY_PREFIX));
      if (line) {
        try {
          const info = JSON.parse(line.slice(READY_PREFIX.length));
          clearTimeout(timer);
          resolve({ child, port: info.port, token: info.token });
        } catch {
          // Malformed ready line; keep waiting until timeout surfaces the issue.
        }
      }
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`control plane exited early (code ${code})`));
    });
  });
}

function apiRequest(pathname, { method = "GET", withAuth = true, body = null } = {}) {
  return new Promise((resolve, reject) => {
    if (!controlPlane) {
      reject(new Error("control plane is not running"));
      return;
    }
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: controlPlane.port,
        path: pathname,
        method,
        headers: {
          ...(withAuth ? { authorization: `Bearer ${controlPlane.token}` } : {}),
          ...(payload !== null
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += String(chunk);
        });
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = raw.length > 0 ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function copyExampleWorkspace(source, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".digital-employee") continue;
    const from = path.join(source, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyExampleWorkspace(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function defaultWorkspaceDir() {
  if (process.env.ORG_WORKBENCH_DEFAULT_WORKSPACE) {
    return process.env.ORG_WORKBENCH_DEFAULT_WORKSPACE;
  }
  const source = path.resolve(__dirname, "..", "..", "..", "examples", "oss-maintainer");
  // The example is a source-controlled fixture; the server writes runtime
  // state into the opened workspace, so auto-open uses a copy outside the repo.
  const runtime = path.join(os.homedir(), ".org-workbench", "demo-workspace");
  if (fs.existsSync(path.join(source, "workspace.json"))) {
    if (!fs.existsSync(path.join(runtime, "workspace.json"))) {
      copyExampleWorkspace(source, runtime);
    }
    return runtime;
  }
  return source;
}

async function openDefaultWorkspace() {
  const dir = defaultWorkspaceDir();
  if (!fs.existsSync(path.join(dir, "workspace.json"))) return;
  try {
    await apiRequest("/workspace/open", { method: "POST", body: { path: dir } });
  } catch {
    // Auto-open is best-effort; the empty state with the open button remains the fallback.
  }
}

function startEventStream() {
  if (!controlPlane || eventStreamRequest) return;
  broadcastSseStatus("connecting");
  const req = http.request(
    {
      host: "127.0.0.1",
      port: controlPlane.port,
      path: "/events",
      method: "GET",
      headers: {
        authorization: `Bearer ${controlPlane.token}`,
        accept: "text/event-stream",
      },
    },
    (res) => {
      broadcastSseStatus("connected");
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += String(chunk);
        let sep = buffer.indexOf("\n\n");
        while (sep >= 0) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          sep = buffer.indexOf("\n\n");
          const dataLine = raw
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (dataLine && mainWindow && !mainWindow.isDestroyed()) {
            try {
              mainWindow.webContents.send("owb:event", JSON.parse(dataLine.slice(6)));
            } catch {
              // Non-JSON frame; ignore.
            }
          }
        }
      });
      res.on("end", () => {
        eventStreamRequest = null;
        broadcastSseStatus("connecting");
        setTimeout(startEventStream, 2000);
      });
    },
  );
  req.on("error", () => {
    eventStreamRequest = null;
    broadcastSseStatus("connecting");
    setTimeout(startEventStream, 2000);
  });
  req.end();
  eventStreamRequest = req;
}

function broadcastSseStatus(state) {
  currentSseStatus = state;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("owb:sse-status", state);
  }
}

// Whitelisted IPC bridge — enumerated, typed, no generic channel.
ipcMain.handle("owb:status", async () => {
  if (!controlPlane) {
    return {
      running: false,
      error: controlPlaneError ? String(controlPlaneError.message ?? controlPlaneError) : null,
      nextSteps: [
        "确认已安装 Node >= 22 并已构建（npm run build）",
        "手动启动控制面排障：npm run dev:server，然后重新打开应用",
        "若引擎不可用，设置 ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI 指向钉版 digital-employee CLI",
      ],
    };
  }
  try {
    const health = await apiRequest("/health", { withAuth: false });
    return { running: true, port: controlPlane.port, health: health.body };
  } catch (err) {
    return { running: true, port: controlPlane.port, health: null, error: String(err.message ?? err) };
  }
});

ipcMain.handle("owb:workspace:open", async () => {
  const options = {
    title: "打开 org-workbench 工作区",
    properties: ["openDirectory"],
  };
  const picked = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true };
  const dir = picked.filePaths[0];
  const res = await apiRequest("/workspace/open", { method: "POST", body: { path: dir } });
  return res;
});

ipcMain.handle("owb:workspace:get", async () => apiRequest("/workspace"));

ipcMain.handle("owb:org:tree", async () => apiRequest("/org/tree"));

ipcMain.handle("owb:org:apply", async (_event, manifest) =>
  apiRequest("/org/apply", { method: "POST", body: manifest }));

ipcMain.handle("owb:org:backups", async () => apiRequest("/org/backups"));

ipcMain.handle("owb:org:restore", async (_event, backupId) => {
  const validated = validateRestoreRequest(backupId);
  if (!validated.ok) return validated.response;
  return apiRequest("/org/restore", { method: "POST", body: validated.request });
});

ipcMain.handle("owb:org:undo", async () => apiRequest("/org/undo", { method: "POST", body: {} }));

ipcMain.handle("owb:hire:create", async (_event, request) => {
  const validated = validateHireRequest(request);
  if (!validated.ok) return validated.response;
  return apiRequest("/hire", { method: "POST", body: validated.request });
});

ipcMain.handle("owb:reports:get", async () => apiRequest("/reports"));

ipcMain.handle("owb:position:get", async (_event, positionId) => {
  if (typeof positionId !== "string" || positionId.length === 0) {
    return { status: 400, body: { code: "manifest_invalid", message: "positionId required" } };
  }
  return apiRequest(`/positions/${encodeURIComponent(positionId)}`);
});

// Read-only document file routing (#35 S2): whitelisted, enumerated, no generic channel.
ipcMain.handle("owb:position:docs:list", async (_event, positionId) => {
  const validated = validateDocsListRequest(positionId);
  if (!validated.ok) return validated.response;
  return apiRequest(validated.pathname);
});

ipcMain.handle("owb:position:docs:read", async (_event, positionId, filePath) => {
  const validated = validateDocsReadRequest(positionId, filePath);
  if (!validated.ok) return validated.response;
  return apiRequest(validated.pathname);
});

ipcMain.handle("owb:turn:create", async (_event, request) => {
  const validated = validateCreateTurnRequest(request);
  if (!validated.ok) return validated.response;
  return apiRequest("/turns", { method: "POST", body: validated.request });
});

ipcMain.handle("owb:turn:history", async (_event, positionId) => {
  const pathname = turnHistoryPath(positionId);
  if (pathname === null) {
    return { status: 400, body: { code: "turn_position_invalid", message: "positionId is invalid", retryable: false } };
  }
  return apiRequest(pathname);
});

ipcMain.handle("owb:turn:cancel", async (_event, request) => {
  const validated = validateCancelRequest(request);
  if (!validated.ok) return validated.response;
  return apiRequest("/turns/cancel", { method: "POST", body: validated.request });
});

ipcMain.handle("owb:session:create", async (_event, request) => {
  const validated = validateSessionCreateRequest(request);
  if (!validated.ok) return validated.response;
  return apiRequest("/sessions", { method: "POST", body: validated.request });
});

ipcMain.handle("owb:session:list", async (_event, positionId) => {
  const pathname = sessionListPath(positionId);
  if (pathname === null) {
    return { status: 400, body: { code: "session_request_invalid", message: "positionId is invalid", retryable: false } };
  }
  return apiRequest(pathname);
});

ipcMain.handle("owb:session:get", async (_event, sessionId) => {
  const pathname = sessionPath(sessionId);
  if (pathname === null) {
    return { status: 400, body: { code: "session_request_invalid", message: "sessionId is invalid", retryable: false } };
  }
  return apiRequest(pathname);
});

ipcMain.handle("owb:session:rotate", async (_event, sessionId) => {
  const pathname = sessionPath(sessionId, "/rotate");
  if (pathname === null) {
    return { status: 400, body: { code: "session_request_invalid", message: "sessionId is invalid", retryable: false } };
  }
  return apiRequest(pathname, { method: "POST", body: {} });
});

ipcMain.handle("owb:session:turn:create", async (_event, request) => {
  const validated = validateSessionTurnRequest(request);
  if (!validated.ok) return validated.response;
  return apiRequest(`/sessions/${validated.sessionId}/turns`, { method: "POST", body: validated.request });
});

ipcMain.handle("owb:session:turn:history", async (_event, sessionId) => {
  if (!validateSessionId(sessionId)) {
    return { status: 400, body: { code: "session_request_invalid", message: "sessionId is invalid", retryable: false } };
  }
  return apiRequest(`/sessions/${sessionId}/turns`);
});

// Additive #52: S2 group-chat surface (DS-34-001 rev-1 §1.2).
ipcMain.handle("owb:group:create", async (_event, request) => {
  const validated = validateGroupCreateRequest(request);
  if (!validated.ok) return validated.response;
  return apiRequest("/groups", { method: "POST", body: validated.request });
});

ipcMain.handle("owb:group:list", async () => apiRequest("/groups"));

ipcMain.handle("owb:group:get", async (_event, conversationRef) => {
  const pathname = groupPath(conversationRef);
  if (pathname === null) {
    return { status: 400, body: { code: "group_request_invalid", message: "conversationRef is invalid", retryable: false } };
  }
  return apiRequest(pathname);
});

ipcMain.handle("owb:group:member:add", async (_event, request) => {
  const validated = validateGroupAddMemberRequest(request);
  if (!validated.ok) return validated.response;
  return apiRequest(groupPath(validated.conversationRef, "/members"), { method: "POST", body: validated.request });
});

ipcMain.handle("owb:group:turn:create", async (_event, request) => {
  const validated = validateGroupTurnRequest(request);
  if (!validated.ok) return validated.response;
  return apiRequest(groupPath(validated.conversationRef, "/turns"), { method: "POST", body: validated.request });
});

ipcMain.handle("owb:group:timeline", async (_event, conversationRef) => {
  if (!validateConversationRef(conversationRef)) {
    return { status: 400, body: { code: "group_request_invalid", message: "conversationRef is invalid", retryable: false } };
  }
  return apiRequest(`/groups/${encodeURIComponent(conversationRef)}/turns`);
});

ipcMain.handle("owb:sse-status:get", async () => currentSseStatus);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 980,
    minHeight: 680,
    title: "org-workbench",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  void mainWindow.loadFile(rendererEntryPath(__dirname));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    controlPlane = await startControlPlane();
    startEventStream();
    await openDefaultWorkspace();
  } catch (err) {
    controlPlaneError = err;
  }
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("quit", () => {
  if (eventStreamRequest) eventStreamRequest.destroy();
  if (controlPlane) controlPlane.child.kill();
});
