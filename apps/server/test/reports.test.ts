import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { ReportsResponse, TurnRecord } from "@org-workbench/shared";
import { api, copyExampleWorkspace, startTestServer } from "./helpers.js";

async function open(server: Awaited<ReturnType<typeof startTestServer>>, dir: string): Promise<void> {
  const response = await api(server.baseUrl, "/workspace/open", {
    method: "POST", token: server.token, body: { path: dir },
  });
  assert.equal(response.status, 200);
}

async function writeTurn(dir: string, record: TurnRecord): Promise<void> {
  const conversation = path.join(dir, ".digital-employee", "workbench", "conversations", record.positionId);
  const turns = path.join(conversation, "turns");
  await fs.mkdir(turns, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(conversation, "conversation.json"), `${JSON.stringify({
    schemaVersion: "conversation.v1",
    conversationId: record.conversationId,
    positionId: record.positionId,
    createdAt: record.createdAt,
  })}\n`, { mode: 0o600 });
  await fs.writeFile(path.join(turns, `${record.turnId}.json`), `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

function turn(overrides: Partial<TurnRecord>): TurnRecord {
  return {
    schemaVersion: "turn-record.v1",
    conversationId: "conversation-report",
    turnId: "turn-report",
    positionId: "community-operator",
    engine: "qoder",
    status: "completed",
    input: "sensitive raw input",
    envelopeDigest: `sha256:${"a".repeat(64)}`,
    createdAt: "2026-08-24T06:00:00.000Z",
    updatedAt: "2026-08-24T06:01:00.000Z",
    events: [
      { type: "run.started", runId: "run-report", timestamp: "2026-08-24T06:00:00.000Z" },
      { type: "usage", runId: "run-report", timestamp: "2026-08-24T06:00:30.000Z", inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      { type: "run.completed", runId: "run-report", timestamp: "2026-08-24T06:01:00.000Z", output: "sensitive raw output", terminalReason: "goal_met" },
    ],
    runId: "run-report",
    output: "sensitive raw output",
    ...overrides,
  };
}

function audit(workspace: string): Record<string, unknown> {
  return {
    schemaVersion: "org-audit.v1",
    at: "2026-08-24T06:00:00.000Z",
    actor: "digital-employee org apply",
    workspace,
    bootstrapped: false,
    changes: { hired: [], moved: [], dismissed: [], budgetUpdated: [] },
    positionCount: 4,
  };
}

test("reports: empty workspace returns truthful empty streams and declared budgets", async () => {
  const server = await startTestServer();
  const dir = await copyExampleWorkspace();
  try {
    await open(server, dir);
    const response = await api(server.baseUrl, "/reports", { token: server.token });
    assert.equal(response.status, 200);
    const body = response.body as ReportsResponse;
    assert.deepEqual(body.streams, { escalations: [], audits: [], evidence: [] });
    assert.ok(body.budgets.length > 0);
    assert.ok(body.budgets.every((budget) => budget.state === "unobserved"));
  } finally {
    await server.close();
  }
});

test("reports: covers success, failure, indeterminate and budget refusal without exposing raw content", async () => {
  const server = await startTestServer();
  const dir = await copyExampleWorkspace();
  try {
    const failed = turn({
      status: "failed",
      error: { code: "position_budget_exceeded", message: "secret provider detail", retryable: false },
      events: [
        { type: "run.started", runId: "run-report", timestamp: "2026-08-24T06:00:00.000Z" },
        { type: "usage", runId: "run-report", timestamp: "2026-08-24T06:00:30.000Z", totalTokens: 30000 },
        { type: "run.failed", runId: "run-report", timestamp: "2026-08-24T06:01:00.000Z", error: { code: "position_budget_exceeded", message: "secret provider detail", retryable: false, terminalReason: "position_budget_exceeded" } },
      ],
      output: undefined,
    });
    const completed = turn({ turnId: "turn-completed", createdAt: "2026-08-24T05:00:00.000Z", updatedAt: "2026-08-24T05:01:00.000Z" });
    const indeterminate = turn({
      turnId: "turn-indeterminate",
      status: "indeterminate",
      createdAt: "2026-08-24T05:30:00.000Z",
      updatedAt: "2026-08-24T05:31:00.000Z",
      events: [{ type: "run.started", runId: "run-indeterminate", timestamp: "2026-08-24T05:30:00.000Z" }],
      runId: "run-indeterminate",
      output: undefined,
      error: { code: "turn_process_exit_1", message: "private diagnostic", retryable: false },
    });
    await writeTurn(dir, completed);
    await writeTurn(dir, indeterminate);
    await writeTurn(dir, failed);
    await open(server, dir);

    const response = await api(server.baseUrl, "/reports", { token: server.token });
    assert.equal(response.status, 200);
    const body = response.body as ReportsResponse;
    assert.equal(body.streams.evidence.length, 3);
    const budgetEvidence = body.streams.evidence.find((item) => item.errorCode === "position_budget_exceeded");
    assert.deepEqual(budgetEvidence?.usage, { inputTokens: 0, outputTokens: 0, totalTokens: 30000 });
    assert.deepEqual(new Set(body.streams.evidence.map((item) => item.status)), new Set(["completed", "failed", "indeterminate"]));
    for (const evidence of body.streams.evidence) {
      assert.equal("input" in (evidence as unknown as Record<string, unknown>), false);
      assert.equal("output" in (evidence as unknown as Record<string, unknown>), false);
      assert.equal("message" in (evidence as unknown as Record<string, unknown>), false);
    }
    assert.equal(body.streams.escalations.length, 2);
    assert.ok(body.streams.escalations.every((item) =>
      item.reportingChain.join("/") === "community-operator/repo-owner"));
    assert.equal(body.streams.escalations.find((item) => item.code === "position_budget_exceeded")?.budgetRelated, true);
    assert.equal(body.streams.escalations.find((item) => item.code === "turn_process_exit_1")?.budgetRelated, false);
    assert.equal(body.budgets.find((item) => item.positionId === "community-operator")?.state, "exceeded");
  } finally {
    await server.close();
  }
});

test("reports: corrupt audit or turn data fails closed with a stable public-safe error", async () => {
  const server = await startTestServer();
  const dir = await copyExampleWorkspace();
  try {
    const runtime = path.join(dir, ".digital-employee");
    await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(runtime, "org-audit.jsonl"), "{not-json}\n", { mode: 0o600 });
    await open(server, dir);
    const response = await api(server.baseUrl, "/reports", { token: server.token });
    assert.equal(response.status, 500);
    assert.equal((response.body as { code: string }).code, "reports_data_invalid");
    assert.equal(JSON.stringify(response.body).includes(dir), false);
  } finally {
    await server.close();
  }
});

test("reports: malformed persisted turn events fail closed instead of becoming inferred metrics", async () => {
  const server = await startTestServer();
  const dir = await copyExampleWorkspace();
  try {
    const malformed = turn({ turnId: "turn-malformed" });
    await writeTurn(dir, malformed);
    const file = path.join(dir, ".digital-employee", "workbench", "conversations", malformed.positionId, "turns", `${malformed.turnId}.json`);
    await fs.writeFile(file, `${JSON.stringify({ ...malformed, events: [null] })}\n`, { mode: 0o600 });
    await open(server, dir);
    const response = await api(server.baseUrl, "/reports", { token: server.token });
    assert.equal(response.status, 500);
    assert.equal((response.body as { code: string }).code, "reports_data_invalid");
    assert.equal(JSON.stringify(response.body).includes("sensitive raw input"), false);
  } finally {
    await server.close();
  }
});

test("reports: reversed persisted event timestamps fail closed instead of creating false chronology", async () => {
  const server = await startTestServer();
  const dir = await copyExampleWorkspace();
  try {
    const reversed = turn({
      turnId: "turn-reversed-time",
      events: [
        { type: "run.started", runId: "run-report", timestamp: "2026-08-24T06:00:00.000Z" },
        {
          type: "run.completed",
          runId: "run-report",
          timestamp: "2026-08-24T05:59:59.999Z",
          output: "sensitive raw output",
          terminalReason: "goal_met",
        },
      ],
    });
    await writeTurn(dir, reversed);
    await open(server, dir);
    const response = await api(server.baseUrl, "/reports", { token: server.token });
    assert.equal(response.status, 500);
    assert.equal((response.body as { code: string }).code, "reports_data_invalid");
    assert.equal(JSON.stringify(response.body).includes("sensitive raw output"), false);
  } finally {
    await server.close();
  }
});

test("reports: nanosecond-reversed persisted events fail closed without truncation", async () => {
  const server = await startTestServer();
  const dir = await copyExampleWorkspace();
  try {
    const reversed = turn({
      turnId: "turn-reversed-nanoseconds",
      events: [
        {
          type: "run.started",
          runId: "run-report",
          timestamp: "2026-08-24T06:00:00.000000002Z",
        },
        {
          type: "run.completed",
          runId: "run-report",
          timestamp: "2026-08-24T06:00:00.000000001Z",
          output: "sensitive raw output",
          terminalReason: "goal_met",
        },
      ],
    });
    await writeTurn(dir, reversed);
    await open(server, dir);
    const response = await api(server.baseUrl, "/reports", { token: server.token });
    assert.equal(response.status, 500);
    assert.equal((response.body as { code: string }).code, "reports_data_invalid");
    assert.equal(JSON.stringify(response.body).includes("sensitive raw output"), false);
  } finally {
    await server.close();
  }
});

test("reports: symlinked local report roots are rejected without reading outside the workspace", async () => {
  const server = await startTestServer();
  const dir = await copyExampleWorkspace();
  const outside = await fs.mkdtemp(path.join(dir, "..", "owb-report-outside-"));
  try {
    const workbench = path.join(dir, ".digital-employee", "workbench");
    await fs.mkdir(workbench, { recursive: true, mode: 0o700 });
    await fs.symlink(outside, path.join(workbench, "conversations"));
    await open(server, dir);
    const response = await api(server.baseUrl, "/reports", { token: server.token });
    assert.equal(response.status, 500);
    assert.equal((response.body as { code: string }).code, "reports_data_invalid");
  } finally {
    await server.close();
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("reports: rejects a valid workspace-external org audit symlink before reading it", async () => {
  const server = await startTestServer();
  const dir = await copyExampleWorkspace();
  const outside = path.join(path.dirname(dir), `owb-external-audit-${path.basename(dir)}.jsonl`);
  try {
    const runtime = path.join(dir, ".digital-employee");
    await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
    await fs.writeFile(outside, `${JSON.stringify({ ...audit(dir), message: "RAW_EXTERNAL_SENTINEL" })}\n`, { mode: 0o600 });
    await fs.symlink(outside, path.join(runtime, "org-audit.jsonl"));
    await open(server, dir);

    const response = await api(server.baseUrl, "/reports", { token: server.token });
    assert.equal(response.status, 500);
    assert.equal((response.body as { code: string }).code, "reports_data_invalid");
    assert.equal(JSON.stringify(response.body).includes("RAW_EXTERNAL_SENTINEL"), false);
  } finally {
    await server.close();
    await fs.rm(outside, { force: true });
  }
});

test("reports: projects ordinary org audits onto an exact allowlist and drops raw fields", async () => {
  const server = await startTestServer();
  const dir = await copyExampleWorkspace();
  try {
    const runtime = path.join(dir, ".digital-employee");
    await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(runtime, "org-audit.jsonl"), `${JSON.stringify({
      ...audit(dir),
      message: "RAW_AUDIT_SENTINEL",
      changes: { hired: [], moved: [], dismissed: [], budgetUpdated: [], message: "RAW_NESTED_SENTINEL" },
    })}\n`, { mode: 0o600 });
    await open(server, dir);

    const response = await api(server.baseUrl, "/reports", { token: server.token });
    assert.equal(response.status, 200);
    const serialized = JSON.stringify(response.body);
    assert.equal(serialized.includes("RAW_AUDIT_SENTINEL"), false);
    assert.equal(serialized.includes("RAW_NESTED_SENTINEL"), false);
    const entry = (response.body as ReportsResponse).streams.audits[0] as unknown as Record<string, unknown>;
    assert.deepEqual(Object.keys(entry).sort(), ["actor", "bootstrapped", "changes", "positionCount", "schemaVersion", "workspace", "at"].sort());
    assert.deepEqual(Object.keys(entry.changes as Record<string, unknown>).sort(), ["budgetUpdated", "dismissed", "hired", "moved"].sort());
  } finally {
    await server.close();
  }
});

test("reports: rejects an oversized org audit source", async () => {
  const server = await startTestServer();
  const dir = await copyExampleWorkspace();
  try {
    const runtime = path.join(dir, ".digital-employee");
    await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
    const file = path.join(runtime, "org-audit.jsonl");
    await fs.writeFile(file, "{}\n", { mode: 0o600 });
    await fs.truncate(file, 16 * 1024 * 1024 + 1);
    await open(server, dir);

    const response = await api(server.baseUrl, "/reports", { token: server.token });
    assert.equal(response.status, 500);
    assert.equal((response.body as { code: string }).code, "reports_data_invalid");
  } finally {
    await server.close();
  }
});
