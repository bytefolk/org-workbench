#!/usr/bin/env node
/**
 * qoder-engine: implements the pinned digital-employee CLI surface
 * (`--version`, `org apply <ws> --json`, `turn run <ws> --position <id> --stdin`)
 * on top of the qoder CLI, so org-workbench is directly runnable with Qoder as
 * the agent host. Contract mirroring: engine.v1 / workspace-org semantics are
 * frozen elsewhere; this adapter only translates, never invents.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveQoderExecutable } from "../src/qoder-binary.js";

const VERSION = "0.1.0";
const POSITION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const QODER_PERMISSION_MODES = new Set([
  "default",
  "accept_edits",
  "bypass_permissions",
  "dont_ask",
  "auto",
]);
const QODER_CHILD_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SHELL",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "QODER_PERSONAL_ACCESS_TOKEN",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];

function qoderChildEnvironment(source) {
  const environment = {};
  for (const key of QODER_CHILD_ENV_KEYS) {
    if (source[key] !== undefined) environment[key] = source[key];
  }
  return environment;
}

function sha256(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function now() {
  return new Date().toISOString();
}

async function isRegularFile(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function scanPositions(workspaceDir) {
  const root = path.join(workspaceDir, "positions");
  const positions = [];
  const scan = async (dir, id, reportTo) => {
    if (!POSITION_ID_PATTERN.test(id)) throw new Error(`invalid position id: ${id}`);
    positions.push({ id, dir, reportTo });
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = path.join(dir, entry.name);
      if (!(await isRegularFile(path.join(child, "employee.json")))) continue;
      await scan(child, entry.name, id);
    }
  };
  for (const entry of (await fs.readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const dir = path.join(root, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink() || !(await isRegularFile(path.join(dir, "employee.json")))) {
      throw new Error(`invalid top-level position entry: ${entry.name}`);
    }
    await scan(dir, entry.name, null);
  }
  return positions;
}

async function orgApply(workspaceDir) {
  const declared = await readJson(path.join(workspaceDir, "organization.v1alpha1.json"));
  const runtime = path.join(workspaceDir, ".digital-employee");
  const previousFile = path.join(runtime, "org.json");
  const bootstrapped = !(await isRegularFile(previousFile));
  const previous = bootstrapped ? null : await readJson(previousFile);
  const previousById = new Map((previous?.roles ?? []).map((role) => [role.id, role]));

  const roles = [];
  for (const position of await scanPositions(workspaceDir)) {
    const employee = await readJson(path.join(position.dir, "employee.json"));
    const employeeBytes = await fs.readFile(path.join(position.dir, "employee.json"), "utf8");
    const budget = await readJson(path.join(position.dir, "budget.json"));
    for (const scope of ["perTask", "perDay"]) {
      if (!Number.isInteger(budget?.[scope]?.tokens) || budget[scope].tokens <= 0) {
        throw new Error(`workspace_org_budget_missing: position ${position.id} budget.${scope}.tokens must be a positive integer`);
      }
    }
    const declaredRole = (declared.roles ?? []).find((role) => role.id === position.id);
    roles.push({
      id: position.id,
      name: declaredRole?.name ?? employee.name ?? position.id,
      description: declaredRole?.description ?? employee.description ?? "",
      reportTo: position.reportTo,
      package: {
        name: employee.name ?? position.id,
        version: employee.version ?? "0.1.0",
        digest: sha256(employeeBytes),
        localReference: position.dir,
      },
      mode: declaredRole?.mode ?? employee?.policy?.mode ?? "approval_required",
      memoryScope: declaredRole?.memoryScope ?? "/",
      toolAllow: declaredRole?.toolAllow ?? [],
      toolDeny: declaredRole?.toolDeny ?? [],
      budget,
      metadata: declaredRole?.metadata ?? {},
    });
  }
  if (!roles.some((role) => role.id === declared.owner)) {
    throw new Error(`workspace_org_owner_missing: owner ${declared.owner} not present in positions/`);
  }

  const hired = [];
  const moved = [];
  const dismissed = [];
  const budgetUpdated = [];
  for (const role of roles) {
    const before = previousById.get(role.id);
    if (!before) hired.push(role);
    else {
      if (before.reportTo !== role.reportTo) moved.push({ id: role.id, from: before.reportTo, to: role.reportTo });
      if (JSON.stringify(before.budget) !== JSON.stringify(role.budget)) budgetUpdated.push(role.id);
    }
  }
  for (const [id, before] of previousById) {
    if (!roles.some((role) => role.id === id)) dismissed.push(before);
  }

  const model = {
    $schema: declared.$schema,
    schemaVersion: declared.schemaVersion,
    business: declared.business,
    description: declared.description,
    owner: declared.owner,
    updatedAt: now(),
    positionCount: roles.length,
    roles,
  };
  const orgText = `${JSON.stringify(model, null, 2)}\n`;
  await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
  await fs.writeFile(previousFile, orgText, { mode: 0o600 });
  const auditLine = `${JSON.stringify({
    schemaVersion: "org-audit.v1",
    at: model.updatedAt,
    actor: "qoder-engine org apply",
    workspace: workspaceDir,
    bootstrapped,
    changes: { hired, moved, dismissed, budgetUpdated },
    positionCount: roles.length,
  })}\n`;
  await fs.appendFile(path.join(runtime, "org-audit.jsonl"), auditLine, { mode: 0o600 });
  const permissionsFile = path.join(runtime, "permissions.json");
  if (!(await isRegularFile(permissionsFile))) {
    await fs.writeFile(permissionsFile, `${JSON.stringify({ schemaVersion: "org-permissions.v1", positions: {} }, null, 2)}\n`, { mode: 0o600 });
  }

  console.log(JSON.stringify({
    status: "applied",
    business: declared.business,
    owner: declared.owner,
    bootstrapped,
    positions: roles.length,
    changes: {
      hired: hired.map((role) => role.id),
      moved,
      dismissed: dismissed.map((role) => role.id),
      budgetUpdated,
    },
    organization: sha256(orgText),
    audit: sha256(auditLine),
    permissions: sha256(await fs.readFile(permissionsFile, "utf8")),
  }));
}

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function turnRun(workspaceDir, positionId) {
  const runId = randomUUID();
  let stdinText = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    stdinText += chunk;
  });
  process.stdin.on("end", () => {
    let input = "";
    try {
      input = String(JSON.parse(stdinText || "{}")?.input ?? "");
    } catch {
      input = "";
    }
    emit({ type: "run.started", runId, timestamp: now() });

    let terminalEmitted = false;
    const fail = (code, message, retryable) => {
      if (terminalEmitted) return;
      terminalEmitted = true;
      emit({
        type: "run.failed",
        runId,
        timestamp: now(),
        error: { code, message: message.slice(0, 2000), retryable, terminalReason: "engine_internal_error" },
      });
      process.exit(0);
    };
    const complete = (output, usage) => {
      if (terminalEmitted) return;
      terminalEmitted = true;
      if (usage) {
        emit({ type: "usage", runId, timestamp: now(), ...usage });
      }
      emit({ type: "run.completed", runId, timestamp: now(), output, terminalReason: "goal_met" });
      process.exit(0);
    };

    const qoderBin = resolveQoderExecutable(process.env);
    if (qoderBin === null) {
      fail("turn_engine_unavailable", "cannot resolve an executable Qoder CLI; install qoder/qodercli or set ORG_WORKBENCH_QODER_BIN", true);
      return;
    }
    const requestedPermissionMode = process.env.ORG_WORKBENCH_QODER_PERMISSION_MODE;
    const permissionMode = requestedPermissionMode === undefined
      ? "dont_ask"
      : QODER_PERMISSION_MODES.has(requestedPermissionMode)
        ? requestedPermissionMode
        : null;
    if (permissionMode === null) {
      fail("qoder.permission_mode_invalid", "unsupported Qoder permission mode", false);
      return;
    }
    const args = [
      "-p", "-o", "stream-json", "--no-session-persistence",
      "-w", workspaceDir,
      "--agent", positionId,
      "--permission-mode", permissionMode,
      input || `Execute your position duties for this turn.`,
    ];
    let child;
    try {
      // Adapter controls, Electron runtime switches, boot authority, Context
      // tokens, and arbitrary server configuration stop here. Qoder and any
      // MCP descendants receive only their explicit runtime/credential contract.
      const qoderEnvironment = qoderChildEnvironment(process.env);
      child = spawn(qoderBin, args, {
        env: qoderEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      fail("turn_engine_unavailable", "cannot spawn the resolved Qoder CLI; install qoder/qodercli or check ORG_WORKBENCH_QODER_BIN", true);
      return;
    }

    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    });
    let stderrTail = "";
    child.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + String(chunk)).slice(-2000);
    });

    function handleLine(line) {
      if (terminalEmitted || line.trim().length === 0) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event?.type === "assistant" && Array.isArray(event?.message?.content)) {
        for (const block of event.message.content) {
          if (block?.type === "text" && typeof block.text === "string" && block.text.length > 0) {
            emit({ type: "model.delta", runId, timestamp: now(), text: block.text });
          }
        }
      }
      if (event?.type === "result") {
        const usage = event?.usage && typeof event.usage === "object"
          ? {
              ...(Number.isInteger(event.usage.input_tokens) ? { inputTokens: event.usage.input_tokens } : {}),
              ...(Number.isInteger(event.usage.output_tokens) ? { outputTokens: event.usage.output_tokens } : {}),
            }
          : null;
        if (event.is_error === true || (typeof event.subtype === "string" && event.subtype !== "success")) {
          fail("qoder.result_error", typeof event.result === "string" ? event.result : stderrTail || "qoder reported an error result", false);
        } else {
          complete(typeof event.result === "string" ? event.result : "", usage && Object.keys(usage).length > 0 ? usage : null);
        }
      }
    }

    child.on("error", () => fail(
      "turn_engine_unavailable",
      "cannot spawn the resolved Qoder CLI; install qoder/qodercli or check ORG_WORKBENCH_QODER_BIN",
      true,
    ));
    child.on("close", (code) => {
      if (terminalEmitted) return;
      if (code === 0) {
        complete("");
      } else {
        fail("qoder.exit_nonzero", stderrTail.trim() || `qoder exited with code ${code}`, true);
      }
    });
  });
}

const argv = process.argv.slice(2);
if (argv.includes("--version") || argv.includes("-v")) {
  console.log(`qoder-engine ${VERSION}`);
} else if (argv[0] === "org" && argv[1] === "apply" && typeof argv[2] === "string") {
  orgApply(argv[2]).catch((error) => {
    console.log(JSON.stringify({ status: "failed", code: "qoder.org_apply_failed", message: String(error?.message ?? error).slice(0, 2000) }));
    process.exit(0);
  });
} else if (argv[0] === "turn" && argv[1] === "run" && typeof argv[2] === "string") {
  const positionIndex = argv.indexOf("--position");
  const positionId = positionIndex >= 0 ? argv[positionIndex + 1] : undefined;
  if (!positionId) {
    console.error("qoder-engine: turn run requires --position <id>");
    process.exit(1);
  }
  turnRun(argv[2], positionId);
} else {
  console.error(`qoder-engine ${VERSION} — digital-employee CLI surface over the qoder CLI\nusage: qoder-engine [--version] | org apply <workspace> --json | turn run <workspace> --position <id> --stdin`);
  process.exit(argv.length === 0 || argv.includes("--help") || argv.includes("-h") ? 0 : 1);
}
