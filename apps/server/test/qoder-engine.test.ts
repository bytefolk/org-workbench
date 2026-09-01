import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/** The adapter is a standalone script implementing the pinned digital-employee
 * CLI surface; tests drive it exactly like driver-cli spawns an engine. */
const ADAPTER = fileURLToPath(new URL("../../bin/qoder-engine.mjs", import.meta.url));

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runAdapter(
  args: string[],
  options: { stdin?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ADAPTER, ...args], {
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    child.stdin.end();
  });
}

const BUDGET = {
  perTask: { tokens: 20000, iterations: 8 },
  perDay: { tokens: 200000, iterations: 64 },
};

async function writePosition(dir: string, name: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "employee.json"),
    `${JSON.stringify({ name, version: "0.1.0", description: `${name} duties`, policy: { mode: "approval_required" } }, null, 2)}\n`,
  );
  await fs.writeFile(path.join(dir, "budget.json"), `${JSON.stringify(BUDGET, null, 2)}\n`);
}

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "owb-qoder-engine-"));
  await fs.writeFile(
    path.join(dir, "organization.v1alpha1.json"),
    `${JSON.stringify({
      schemaVersion: "organization.v1alpha1",
      business: "qoder-engine fixture",
      description: "adapter test workspace",
      owner: "repo-owner",
      roles: [
        { id: "repo-owner", name: "代码库负责人", description: "Owns the repo." },
        { id: "docs-writer", name: "文档负责人", description: "Keeps docs current." },
      ],
    }, null, 2)}\n`,
  );
  await writePosition(path.join(dir, "positions", "repo-owner"), "repo-owner");
  await writePosition(path.join(dir, "positions", "repo-owner", "docs-writer"), "docs-writer");
  return dir;
}

const FAKE_QODER_OK = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.env.FAKE_QODER_ARGS_FILE) fs.writeFileSync(process.env.FAKE_QODER_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
if (process.env.FAKE_QODER_ENV_FILE) fs.writeFileSync(process.env.FAKE_QODER_ENV_FILE, JSON.stringify({ PATH: process.env.PATH }));
const write = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
write({ type: "system", subtype: "init" });
write({ type: "assistant", message: { content: [{ type: "thinking", thinking: "internal" }, { type: "text", text: "正在核对" }], usage: { input_tokens: 10, output_tokens: 5 } } });
write({ type: "assistant", message: { content: [{ type: "text", text: "，门禁通过" }] } });
write({ type: "result", subtype: "success", is_error: false, result: "release gate passed", usage: { input_tokens: 100, output_tokens: 40 } });
`;

const FAKE_QODER_ERROR_RESULT = `#!/usr/bin/env node
const write = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
write({ type: "result", subtype: "error_max_turns", is_error: true, result: "qoder hit its turn cap" });
`;

const FAKE_QODER_SHELL_OK = `#!/bin/sh
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"restricted PATH reached"}]}}'
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"release gate passed"}'
`;

async function writeFakeQoder(dir: string, script: string): Promise<string> {
  const file = path.join(dir, "fake-qoder.cjs");
  await fs.writeFile(file, script);
  await fs.chmod(file, 0o755);
  return file;
}

test("qoder-engine: --version satisfies the driver probe surface", async () => {
  const result = await runAdapter(["--version"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout.trim(), /^qoder-engine \d+\.\d+\.\d+$/);
});

test("qoder-engine org apply: bootstrap writes 0600 applied state and reports EngineOrgApplySuccess", async () => {
  const dir = await makeWorkspace();
  const result = await runAdapter(["org", "apply", dir, "--json"]);
  assert.equal(result.code, 0);
  const applied = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(applied.status, "applied");
  assert.equal(applied.bootstrapped, true);
  assert.equal(applied.positions, 2);
  assert.equal(applied.owner, "repo-owner");
  assert.deepEqual([...(applied.changes as { hired: string[] }).hired].sort(), ["docs-writer", "repo-owner"]);
  assert.match(String(applied.organization), /^sha256:[0-9a-f]{64}$/);

  const runtime = path.join(dir, ".digital-employee");
  assert.equal((await fs.stat(path.join(runtime, "org.json"))).mode & 0o777, 0o600);
  const model = JSON.parse(await fs.readFile(path.join(runtime, "org.json"), "utf8")) as { roles: Array<{ id: string; reportTo: string | null; name: string }> };
  const docs = model.roles.find((role) => role.id === "docs-writer");
  assert.equal(docs?.reportTo, "repo-owner");
  assert.equal(docs?.name, "文档负责人", "declared role names win over raw ids");
  const audits = (await fs.readFile(path.join(runtime, "org-audit.jsonl"), "utf8")).trim().split("\n");
  assert.equal(audits.length, 1);
  // The reports route projects org-audit.v1 hired/dismissed as full role
  // objects; the audit line must carry them (contract mirror).
  const audit = JSON.parse(audits[0]!) as {
    changes: { hired: Array<{ id: string; name: string; package: { digest: string }; budget: { perTask: { tokens: number } } }>; dismissed: unknown[] };
  };
  const hiredIds = audit.changes.hired.map((role) => role.id).sort();
  assert.deepEqual(hiredIds, ["docs-writer", "repo-owner"]);
  for (const role of audit.changes.hired) {
    assert.match(role.package.digest, /^sha256:[0-9a-f]{64}$/);
    assert.ok(role.budget.perTask.tokens > 0);
  }
  assert.equal((await fs.stat(path.join(runtime, "permissions.json"))).mode & 0o777, 0o600);
});

test("qoder-engine org apply: a moved position is diffed against the previous applied state", async () => {
  const dir = await makeWorkspace();
  await runAdapter(["org", "apply", dir, "--json"]);
  await fs.rename(path.join(dir, "positions", "repo-owner", "docs-writer"), path.join(dir, "positions", "docs-writer"));
  const result = await runAdapter(["org", "apply", dir, "--json"]);
  const applied = JSON.parse(result.stdout) as { bootstrapped: boolean; changes: { hired: string[]; moved: Array<{ id: string; from: string | null; to: string | null }>; dismissed: string[] } };
  assert.equal(applied.bootstrapped, false);
  assert.deepEqual(applied.changes.hired, []);
  assert.deepEqual(applied.changes.dismissed, []);
  assert.deepEqual(applied.changes.moved, [{ id: "docs-writer", from: "repo-owner", to: null }]);
});

test("qoder-engine org apply: a stray top-level directory fails with the actionable scan error", async () => {
  const dir = await makeWorkspace();
  await fs.mkdir(path.join(dir, "positions", "client-lead"), { recursive: true });
  const result = await runAdapter(["org", "apply", dir, "--json"]);
  assert.equal(result.code, 0, "engine failures print status=failed and exit 0");
  const failed = JSON.parse(result.stdout) as { status: string; code: string; message: string };
  assert.equal(failed.status, "failed");
  assert.equal(failed.code, "qoder.org_apply_failed");
  assert.match(failed.message, /invalid top-level position entry: client-lead/);
});

test("qoder-engine turn run: maps qoder stream-json into engine.v1 events and passes --agent <position>", async () => {
  const dir = await makeWorkspace();
  const fakeDir = await fs.mkdtemp(path.join(os.tmpdir(), "owb-fake-qoder-"));
  const fakeBin = await writeFakeQoder(fakeDir, FAKE_QODER_OK);
  const argsFile = path.join(fakeDir, "args.json");
  const envFile = path.join(fakeDir, "env.json");
  const inheritedPath = `${fakeDir}${path.delimiter}${process.env.PATH ?? ""}`;
  const result = await runAdapter(["turn", "run", dir, "--position", "docs-writer", "--stdin"], {
    stdin: JSON.stringify({ input: "检查发布门禁" }),
    env: {
      ORG_WORKBENCH_QODER_BIN: fakeBin,
      FAKE_QODER_ARGS_FILE: argsFile,
      FAKE_QODER_ENV_FILE: envFile,
      PATH: inheritedPath,
    },
  });
  assert.equal(result.code, 0);
  const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(events[0]?.type, "run.started");
  const runId = events[0]?.runId;
  assert.ok(events.every((event) => event.runId === runId), "one runId per turn");
  assert.deepEqual(
    events.filter((event) => event.type === "model.delta").map((event) => event.text),
    ["正在核对", "，门禁通过"],
  );
  const usage = events.find((event) => event.type === "usage");
  assert.deepEqual({ input: usage?.inputTokens, output: usage?.outputTokens }, { input: 100, output: 40 });
  const completed = events.at(-1);
  assert.equal(completed?.type, "run.completed");
  assert.equal(completed?.output, "release gate passed");
  assert.equal(completed?.terminalReason, "goal_met");

  const qoderArgs = JSON.parse(await fs.readFile(argsFile, "utf8")) as string[];
  assert.ok(qoderArgs.includes("-w") && qoderArgs[qoderArgs.indexOf("-w") + 1] === dir);
  assert.ok(qoderArgs.includes("--agent") && qoderArgs[qoderArgs.indexOf("--agent") + 1] === "docs-writer");
  assert.equal(qoderArgs.at(-1), "检查发布门禁", "envelope input becomes the qoder prompt");
  const qoderEnv = JSON.parse(await fs.readFile(envFile, "utf8")) as { PATH?: string };
  assert.equal(qoderEnv.PATH, inheritedPath, "qoder-engine must not replace or truncate the inherited user PATH");
});

test("qoder-engine turn run uses the same PATH resolver without an explicit binary override", async () => {
  const dir = await makeWorkspace();
  const fakeDir = await fs.mkdtemp(path.join(os.tmpdir(), "owb-qoder-path-"));
  const fakeBin = path.join(fakeDir, "qodercli");
  await fs.writeFile(fakeBin, FAKE_QODER_SHELL_OK, { mode: 0o755 });
  const result = await runAdapter(["turn", "run", dir, "--position", "repo-owner", "--stdin"], {
    stdin: JSON.stringify({ input: "restricted PATH smoke" }),
    env: {
      ORG_WORKBENCH_QODER_BIN: "",
      PATH: `${fakeDir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
      HOME: path.join(fakeDir, "empty-home"),
    },
  });
  assert.equal(result.code, 0);
  const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(events.at(-1)?.type, "run.completed");
  assert.equal(events.at(-1)?.output, "release gate passed");
});

test("qoder-engine turn run: an error result becomes run.failed with retryable=false", async () => {
  const dir = await makeWorkspace();
  const fakeDir = await fs.mkdtemp(path.join(os.tmpdir(), "owb-fake-qoder-"));
  const fakeBin = await writeFakeQoder(fakeDir, FAKE_QODER_ERROR_RESULT);
  const result = await runAdapter(["turn", "run", dir, "--position", "repo-owner", "--stdin"], {
    stdin: JSON.stringify({ input: "hi" }),
    env: { ORG_WORKBENCH_QODER_BIN: fakeBin },
  });
  assert.equal(result.code, 0);
  const failed = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>).find((event) => event.type === "run.failed");
  assert.equal((failed?.error as { code: string }).code, "qoder.result_error");
  assert.equal((failed?.error as { message: string }).message, "qoder hit its turn cap");
  assert.equal((failed?.error as { retryable: boolean }).retryable, false);
});

test("qoder-engine turn run: a missing qoder binary is turn_engine_unavailable and retryable", async () => {
  const dir = await makeWorkspace();
  const result = await runAdapter(["turn", "run", dir, "--position", "repo-owner", "--stdin"], {
    stdin: JSON.stringify({ input: "hi" }),
    env: { ORG_WORKBENCH_QODER_BIN: path.join(dir, "does-not-exist") },
  });
  assert.equal(result.code, 0);
  const failed = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>).find((event) => event.type === "run.failed");
  assert.equal((failed?.error as { code: string }).code, "turn_engine_unavailable");
  assert.equal((failed?.error as { retryable: boolean }).retryable, true);
});

test("qoder-engine turn run: an unspawnable resolved binary never discloses its absolute path", async () => {
  const dir = await makeWorkspace();
  const fakeDir = await fs.mkdtemp(path.join(os.tmpdir(), "owb-unspawnable-qoder-"));
  const fakeBin = path.join(fakeDir, "private-qoder-location");
  await fs.writeFile(fakeBin, "#!/definitely/missing/qoder-interpreter\n", { mode: 0o755 });
  const result = await runAdapter(["turn", "run", dir, "--position", "repo-owner", "--stdin"], {
    stdin: JSON.stringify({ input: "hi" }),
    env: { ORG_WORKBENCH_QODER_BIN: fakeBin },
  });
  assert.equal(result.code, 0);
  const failed = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>).find((event) => event.type === "run.failed");
  assert.equal((failed?.error as { code: string }).code, "turn_engine_unavailable");
  assert.equal((failed?.error as { retryable: boolean }).retryable, true);
  assert.doesNotMatch(result.stdout, new RegExp(fakeBin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
