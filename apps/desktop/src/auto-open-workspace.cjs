const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  controlPlaneMode,
  serverPathForWorkspace,
} = require("./control-plane-launch.cjs");
const { readLastWorkspacePath } = require("./last-workspace.cjs");

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

function defaultWorkspaceDir(env) {
  if (env.ORG_WORKBENCH_DEFAULT_WORKSPACE) {
    return env.ORG_WORKBENCH_DEFAULT_WORKSPACE;
  }
  const source = path.resolve(__dirname, "..", "..", "..", "examples", "oss-maintainer");
  const runtime = path.join(os.homedir(), ".org-workbench", "demo-workspace");
  if (fs.existsSync(path.join(source, "workspace.json"))) {
    if (!fs.existsSync(path.join(runtime, "workspace.json"))) {
      copyExampleWorkspace(source, runtime);
    }
    return runtime;
  }
  return source;
}

async function openDefaultWorkspace({ apiRequest, env, userDataPath }) {
  let fallbackNoticePath = null;

  if (env.ORG_WORKBENCH_DEFAULT_WORKSPACE) {
    const dir = env.ORG_WORKBENCH_DEFAULT_WORKSPACE;
    if (!fs.existsSync(path.join(dir, "workspace.json"))) {
      process.stderr.write(`auto-open skipped: workspace.json not found at ${dir}\n`);
      return { fallbackNoticePath: null };
    }
    try {
      const res = await apiRequest("/workspace/open", {
        method: "POST",
        body: { path: serverPathForWorkspace(dir, env) },
      });
      if (res.status !== 200) {
        process.stderr.write(
          `auto-open workspace failed [mode=${controlPlaneMode(env)}, dir=${dir}]: `
          + `server responded ${res.status} — ${JSON.stringify(res.body)}\n`,
        );
      }
    } catch (err) {
      process.stderr.write(
        `auto-open workspace failed [mode=${controlPlaneMode(env)}, dir=${dir}]: `
        + `${err.message ?? err}\n`,
      );
    }
    return { fallbackNoticePath: null };
  }

  const lastPath = readLastWorkspacePath(userDataPath);
  if (lastPath !== null) {
    if (fs.existsSync(path.join(lastPath, "workspace.json"))) {
      try {
        const res = await apiRequest("/workspace/open", {
          method: "POST",
          body: { path: serverPathForWorkspace(lastPath, env) },
        });
        if (res.status === 200) return { fallbackNoticePath: null };
        process.stderr.write(
          `auto-open workspace failed [mode=${controlPlaneMode(env)}, dir=${lastPath}]: `
          + `server responded ${res.status} — ${JSON.stringify(res.body)}\n`,
        );
      } catch (err) {
        process.stderr.write(
          `auto-open workspace failed [mode=${controlPlaneMode(env)}, dir=${lastPath}]: `
          + `${err.message ?? err}\n`,
        );
      }
    }
    fallbackNoticePath = lastPath;
  }

  const dir = defaultWorkspaceDir(env);
  if (!fs.existsSync(path.join(dir, "workspace.json"))) {
    process.stderr.write(`auto-open skipped: workspace.json not found at ${dir}\n`);
    return { fallbackNoticePath };
  }
  try {
    const res = await apiRequest("/workspace/open", {
      method: "POST",
      body: { path: serverPathForWorkspace(dir, env) },
    });
    if (res.status !== 200) {
      process.stderr.write(
        `auto-open workspace failed [mode=${controlPlaneMode(env)}, dir=${dir}]: `
        + `server responded ${res.status} — ${JSON.stringify(res.body)}\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `auto-open workspace failed [mode=${controlPlaneMode(env)}, dir=${dir}]: `
      + `${err.message ?? err}\n`,
    );
  }
  return { fallbackNoticePath };
}

module.exports = {
  copyExampleWorkspace,
  defaultWorkspaceDir,
  openDefaultWorkspace,
};
