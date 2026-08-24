import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DigitalEmployeeCliDriver } from "../src/engine/driver-cli.js";
import { api, copyExampleWorkspace, startTestServer } from "./helpers.js";

const ENVELOPE = {
  schemaVersion: "turn-envelope.v1" as const,
  workspaceRef: "/workspace",
  positionId: "repo-owner",
  turnId: "turn-1",
  input: "hello",
  envelopeDigest: `sha256:${"a".repeat(64)}`,
};

async function fixtureCli(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "owb-turn-driver-"));
  const file = path.join(dir, "fixture.mjs");
  await fs.writeFile(file, source, { mode: 0o600 });
  return `${process.execPath} ${file}`;
}

test("turn driver uses stdin, exact turn argv, and the selected engine environment", async () => {
  const command = await fixtureCli(`
    let input = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) input += chunk;
    if (process.argv.slice(2).join("|") !== "turn|run|/workspace|--position|repo-owner|--stdin") process.exit(9);
    if (process.env.DIGITAL_EMPLOYEE_ENGINE_MODEL !== "qoder") process.exit(8);
    if (JSON.parse(input).envelopeDigest !== ${JSON.stringify(ENVELOPE.envelopeDigest)}) process.exit(7);
    const base = { runId: "run-1", timestamp: "2026-08-24T00:00:00.000Z" };
    console.log(JSON.stringify({ ...base, type: "run.started" }));
    console.log(JSON.stringify({ ...base, type: "run.completed", output: "ok", terminalReason: "goal_met" }));
  `);
  const driver = new DigitalEmployeeCliDriver(command);
  const result = await driver.turnRun({
    workspace: "/workspace",
    positionId: "repo-owner",
    engine: "qoder",
    envelope: ENVELOPE,
  });
  assert.equal(result.status, "trusted");
  assert.equal(result.events.length, 2);
});

test("turn driver rejects malformed or multi-terminal engine.v1 streams", async () => {
  const command = await fixtureCli(`
    process.stdin.resume();
    const base = { runId: "run-1", timestamp: "2026-08-24T00:00:00.000Z" };
    console.log(JSON.stringify({ ...base, type: "run.started", extra: true }));
    console.log(JSON.stringify({ ...base, type: "run.completed", output: "one", terminalReason: "goal_met" }));
    console.log(JSON.stringify({ ...base, type: "run.completed", output: "two", terminalReason: "goal_met" }));
  `);
  const driver = new DigitalEmployeeCliDriver(command);
  const result = await driver.turnRun({
    workspace: "/workspace",
    positionId: "repo-owner",
    engine: "claude-code",
    envelope: ENVELOPE,
  });
  assert.equal(result.status, "indeterminate");
  assert.equal(result.code, "turn_protocol_invalid");
});

test("turn driver classifies exit 1 as indeterminate without retrying", async () => {
  const counterDir = await fs.mkdtemp(path.join(os.tmpdir(), "owb-turn-counter-"));
  const counter = path.join(counterDir, "count");
  const command = await fixtureCli(`
    import fs from "node:fs";
    const counter = ${JSON.stringify(counter)};
    let count = 0;
    try { count = Number(fs.readFileSync(counter, "utf8")); } catch {}
    fs.writeFileSync(counter, String(count + 1));
    console.error("engine.model_unavailable: no credential");
    process.exit(1);
  `);
  const driver = new DigitalEmployeeCliDriver(command);
  const result = await driver.turnRun({
    workspace: "/workspace",
    positionId: "repo-owner",
    engine: "qoder",
    envelope: ENVELOPE,
  });
  assert.equal(result.status, "indeterminate");
  assert.equal(result.code, "turn_process_exit_1");
  assert.equal(await fs.readFile(counter, "utf8"), "1");
  assert.ok(result.diagnostic.length <= 8 * 1024);
});

test("an exit-1 child cannot publish its apparent terminal as trusted SSE", async () => {
  const command = await fixtureCli(`
    process.stdin.resume();
    const base = { runId: "run-1", timestamp: "2026-08-24T00:00:00.000Z" };
    console.log(JSON.stringify({ ...base, type: "run.started" }));
    console.log(JSON.stringify({ ...base, type: "run.completed", output: "not trusted", terminalReason: "goal_met" }));
    process.exitCode = 1;
  `);
  const driver = new DigitalEmployeeCliDriver(command);
  const published: string[] = [];
  const result = await driver.turnRun({
    workspace: "/workspace",
    positionId: "repo-owner",
    engine: "qoder",
    envelope: ENVELOPE,
    onEvent: (event) => published.push(event.type),
  });
  assert.equal(result.status, "indeterminate");
  assert.deepEqual(published, ["run.started"]);
});

test("HTTP control plane completes and reads back a turn through the real spawn driver seam", async () => {
  const command = await fixtureCli(`
    let input = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) input += chunk;
    const envelope = JSON.parse(input);
    if (process.argv[2] !== "turn" || process.argv[3] !== "run") process.exit(9);
    if (process.argv[5] !== "--position" || process.argv[6] !== "repo-owner" || process.argv[7] !== "--stdin") process.exit(8);
    if (!/^sha256:[a-f0-9]{64}$/.test(envelope.envelopeDigest)) process.exit(7);
    const base = { runId: "e3-run", timestamp: "2026-08-24T00:00:00.000Z" };
    console.log(JSON.stringify({ ...base, type: "run.started" }));
    console.log(JSON.stringify({ ...base, type: "run.completed", output: "e3-ok", terminalReason: "goal_met" }));
  `);
  const server = await startTestServer(undefined, new DigitalEmployeeCliDriver(command));
  const workspace = await copyExampleWorkspace();
  try {
    const opened = await api(server.baseUrl, "/workspace/open", {
      method: "POST",
      token: server.token,
      body: { path: workspace },
    });
    assert.equal(opened.status, 200);
    const posted = await api(server.baseUrl, "/turns", {
      method: "POST",
      token: server.token,
      body: { positionId: "repo-owner", input: "hello", engine: "qoder" },
    });
    assert.equal(posted.status, 200);
    assert.equal((posted.body as { status: string; output: string }).status, "completed");
    assert.equal((posted.body as { output: string }).output, "e3-ok");
    const history = await api(server.baseUrl, "/turns?positionId=repo-owner", {
      token: server.token,
    });
    assert.equal((history.body as { turns: unknown[] }).turns.length, 1);
  } finally {
    await server.close();
  }
});
