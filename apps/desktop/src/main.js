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
const http = require("node:http");
const path = require("node:path");

const SERVER_ENTRY = path.join(__dirname, "..", "..", "server", "dist", "src", "index.js");
const READY_TIMEOUT_MS = 15000;
const READY_PREFIX = "org-workbench-server ready ";

let controlPlane = null; // { child, port, token }
let controlPlaneError = null;
let mainWindow = null;
let eventStreamRequest = null;

function startControlPlane() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
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

ipcMain.handle("owb:position:get", async (_event, positionId) => {
  if (typeof positionId !== "string" || positionId.length === 0) {
    return { status: 400, body: { code: "manifest_invalid", message: "positionId required" } };
  }
  return apiRequest(`/positions/${encodeURIComponent(positionId)}`);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    title: "org-workbench",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  void mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    controlPlane = await startControlPlane();
    startEventStream();
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
