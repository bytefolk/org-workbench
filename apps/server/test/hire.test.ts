import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { HireResult, OrganizationFile } from "@org-workbench/shared";
import { computeEnvelopeDigest } from "../src/turns/envelope.js";
import { FakeDriver, api, connectSse, copyExampleWorkspace, startTestServer } from "./helpers.js";

const VALID_HIRE = {
  positionId: "docs-writer",
  name: "Docs Writer",
  description: "Keeps documentation current.",
  reportTo: "repo-owner",
  mode: "read_only",
  budget: {
    perTask: { tokens: 20000, iterations: 8 },
    perDay: { tokens: 200000, iterations: 64 },
  },
} as const;

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function readApplied(dir: string): Promise<OrganizationFile> {
  return readJson(path.join(dir, ".digital-employee", "org.json"));
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for SSE condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function seedAppliedState(dir: string): Promise<void> {
  const runtime = path.join(dir, ".digital-employee");
  const model = await readJson<OrganizationFile>(path.join(dir, "organization.v1alpha1.json"));
  await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(runtime, "org.json"), `${JSON.stringify(model, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(
    path.join(runtime, "org-audit.jsonl"),
    `${JSON.stringify({
      schemaVersion: "org-audit.v1",
      at: model.updatedAt,
      actor: "fixture",
      workspace: dir,
      bootstrapped: true,
      changes: { hired: [], moved: [], dismissed: [], budgetUpdated: [] },
      positionCount: model.roles.length,
    })}\n`,
    { mode: 0o600 },
  );
  await fs.writeFile(
    path.join(runtime, "permissions.json"),
    `${JSON.stringify({ schemaVersion: "org-permissions.v1", positions: {} }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

/** Deterministic engine double: hires whatever skeleton the control plane staged. */
async function emulateEngineHire(dir: string): Promise<void> {
  const model = await readApplied(dir);
  const staged = path.join(dir, "positions", "repo-owner", "docs-writer");
  if ((await exists(staged)) && !model.roles.some((role) => role.id === "docs-writer")) {
    const employee = await readJson<{ description?: string; policy?: { mode?: string } }>(path.join(staged, "employee.json"));
    const budget = await readJson<OrganizationFile["roles"][number]["budget"]>(path.join(staged, "budget.json"));
    model.roles.push({
      id: "docs-writer",
      name: "Docs Writer",
      description: employee.description ?? "",
      reportTo: "repo-owner",
      package: { name: "docs-writer", version: "0.1.0", digest: "sha256:fixture", localReference: staged },
      mode: employee.policy?.mode === "read_only" ? "read_only" : "approval_required",
      memoryScope: "/",
      toolAllow: [],
      toolDeny: [],
      budget,
      metadata: {},
    });
  }
  model.updatedAt = new Date(Date.now() + 1000).toISOString();
  const runtime = path.join(dir, ".digital-employee");
  await fs.writeFile(path.join(runtime, "org.json"), `${JSON.stringify(model, null, 2)}\n`, { mode: 0o600 });
  await fs.appendFile(
    path.join(runtime, "org-audit.jsonl"),
    `${JSON.stringify({
      schemaVersion: "org-audit.v1",
      at: model.updatedAt,
      actor: "digital-employee org apply",
      workspace: dir,
      bootstrapped: false,
      changes: { hired: ["docs-writer"], moved: [], dismissed: [], budgetUpdated: [] },
      positionCount: model.roles.length,
    })}\n`,
    { mode: 0o600 },
  );
}

test("POST /hire: seals a hire-request.v1alpha1 envelope, validates before any effect, and lands the position", async () => {
  const driver = new FakeDriver({ status: "applied" }, emulateEngineHire);
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  const sse = connectSse(server.baseUrl, server.token);
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const res = await api(server.baseUrl, "/hire", { method: "POST", token: server.token, body: VALID_HIRE });
    assert.equal(res.status, 200);
    const body = res.body as Extract<HireResult, { status: "hired" }>;
    assert.equal(body.positionId, "docs-writer");
    assert.ok((await readApplied(dir)).roles.some((role) => role.id === "docs-writer"));
    assert.equal(driver.hireCalls.length, 1, "static validation runs exactly once");
    assert.deepEqual(driver.calls, [dir], "engine adjudicates through the org apply seam");

    // Envelope sealing: exact vocabulary, digest computed before staging.
    const envelope = driver.hireEnvelopes[0]!;
    assert.deepEqual(Object.keys(envelope).sort(), [
      "budget", "envelopeDigest", "packageRef", "requestedBy", "schemaVersion", "targetParentId", "workspaceRef",
    ]);
    assert.equal(envelope.schemaVersion, "hire-request.v1alpha1");
    assert.equal(envelope.requestedBy, "operator");
    assert.equal(envelope.targetParentId, "repo-owner");
    assert.equal(envelope.workspaceRef, dir);
    const packageRef = envelope.packageRef as { name: string; version: string; digest: string };
    assert.equal(packageRef.name, "docs-writer");
    assert.equal(packageRef.version, "v1alpha1");
    const employeeBytes = await fs.readFile(path.join(dir, "positions", "repo-owner", "docs-writer", "employee.json"), "utf8");
    assert.equal(packageRef.digest, `sha256:${crypto.createHash("sha256").update(employeeBytes, "utf8").digest("hex")}`, "digest references the exact staged bytes");
    const { envelopeDigest, ...rest } = envelope;
    assert.equal(envelopeDigest, computeEnvelopeDigest(rest), "canonical digest matches the sealed body");

    // S2 phase vocabulary + the hire-linked org.updated broadcast.
    await waitFor(() =>
      sse.events.some((frame) => frame.event === "org.updated" && frame.data.includes("hire")),
    );
    const phases = sse.events
      .filter((frame) => frame.event === "hire.progress")
      .map((frame) => (JSON.parse(frame.data) as { payload: { phase: string } }).payload.phase);
    assert.deepEqual(phases, ["validate", "stage", "apply"]);
  } finally {
    sse.close();
    await server.close();
  }
});

test("POST /hire: reportTo=null hires under the company owner", async () => {
  const driver = new FakeDriver({ status: "applied" }, emulateEngineHire);
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const res = await api(server.baseUrl, "/hire", {
      method: "POST", token: server.token,
      body: { ...VALID_HIRE, reportTo: null },
    });
    assert.equal(res.status, 200);
    assert.equal((driver.hireEnvelopes[0]!).targetParentId, "repo-owner", "null reportTo resolves to the owner");
  } finally {
    await server.close();
  }
});

test("POST /hire: network policy defaults to deny and can be requested as host_policy (#87)", async () => {
  const driver = new FakeDriver({ status: "applied" }, emulateEngineHire);
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const res = await api(server.baseUrl, "/hire", { method: "POST", token: server.token, body: VALID_HIRE });
    assert.equal(res.status, 200);
    const employee = await readJson<{ policy: { network: string } }>(
      path.join(dir, "positions", "repo-owner", "docs-writer", "employee.json"),
    );
    assert.equal(employee.policy.network, "deny", "omitting network preserves today's behavior");
  } finally {
    await server.close();
  }
});

test("POST /hire: an explicit host_policy network request lands in employee.json (#87)", async () => {
  const driver = new FakeDriver({ status: "applied" }, emulateEngineHire);
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const res = await api(server.baseUrl, "/hire", {
      method: "POST", token: server.token,
      body: { ...VALID_HIRE, network: "host_policy" },
    });
    assert.equal(res.status, 200);
    const employee = await readJson<{ policy: { network: string } }>(
      path.join(dir, "positions", "repo-owner", "docs-writer", "employee.json"),
    );
    assert.equal(employee.policy.network, "host_policy");
  } finally {
    await server.close();
  }
});

test("POST /hire: omitting mcp leaves mcpTools empty and writes no mcp entrypoint (#89)", async () => {
  const driver = new FakeDriver({ status: "applied" }, emulateEngineHire);
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const res = await api(server.baseUrl, "/hire", { method: "POST", token: server.token, body: VALID_HIRE });
    assert.equal(res.status, 200);
    const staged = path.join(dir, "positions", "repo-owner", "docs-writer");
    const employee = await readJson<{ policy: { mcpTools: unknown[] }; entrypoints: Record<string, unknown> }>(
      path.join(staged, "employee.json"),
    );
    assert.deepEqual(employee.policy.mcpTools, [], "omitting mcp preserves today's behavior");
    assert.equal(employee.entrypoints.mcp, undefined, "no mcp entrypoint without a grant");
    assert.equal(await exists(path.join(staged, "mcp.json")), false);
  } finally {
    await server.close();
  }
});

test("POST /hire: a granted mcp tool lands with a valid employee-mcp.v1alpha1 entrypoint (#89)", async () => {
  const driver = new FakeDriver({ status: "applied" }, emulateEngineHire);
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const res = await api(server.baseUrl, "/hire", {
      method: "POST", token: server.token,
      body: {
        ...VALID_HIRE,
        mcp: {
          tools: [{ name: "repo.read", requestedMode: "read" }],
          servers: [
            { name: "local-fs", transport: { type: "stdio", command: "mcp-fs", args: ["--root", "."], environment: ["FS_ROOT"] } },
            { name: "remote-api", transport: { type: "http", url: "https://mcp.example.com/v1", headers: [{ name: "Authorization", valueFromEnv: "MCP_TOKEN" }] } },
          ],
        },
      },
    });
    assert.equal(res.status, 200);
    const staged = path.join(dir, "positions", "repo-owner", "docs-writer");
    const employee = await readJson<{
      policy: { mcpTools: Array<{ name: string; requestedMode: string }> };
      entrypoints: Record<string, string>;
    }>(path.join(staged, "employee.json"));
    assert.deepEqual(employee.policy.mcpTools, [{ name: "repo.read", requestedMode: "read" }]);
    // Upstream mcp_tools_require_mcp_entrypoint: a non-empty mcpTools list is
    // only valid when the manifest also points at an mcp entrypoint file.
    assert.equal(employee.entrypoints.mcp, "./mcp.json");
    const mcp = await readJson<{ schemaVersion: string; servers: Array<{ name: string; transport: Record<string, unknown> }> }>(
      path.join(staged, "mcp.json"),
    );
    assert.equal(mcp.schemaVersion, "employee-mcp.v1alpha1");
    assert.deepEqual(mcp.servers.map((server) => server.name), ["local-fs", "remote-api"]);
    assert.deepEqual(mcp.servers[0]!.transport, {
      type: "stdio", command: "mcp-fs", args: ["--root", "."], environment: ["FS_ROOT"],
    });
    assert.deepEqual(mcp.servers[1]!.transport, {
      type: "http",
      url: "https://mcp.example.com/v1",
      headers: [{ name: "Authorization", valueFromEnv: "MCP_TOKEN" }],
    });
    // The staged package carries variable NAMES only — never a secret value.
    assert.equal(JSON.stringify(mcp).includes("MCP_TOKEN"), true);
  } finally {
    await server.close();
  }
});

test("POST /hire: a read_only employee cannot be granted a write-mode mcp tool (#89)", async () => {
  const driver = new FakeDriver({ status: "applied" }, emulateEngineHire);
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const res = await api(server.baseUrl, "/hire", {
      method: "POST", token: server.token,
      body: {
        ...VALID_HIRE,
        mode: "read_only",
        mcp: {
          tools: [{ name: "repo.write", requestedMode: "write" }],
          servers: [{ name: "local-fs", transport: { type: "stdio", command: "mcp-fs" } }],
        },
      },
    });
    // Rejected at the request gate rather than silently downgraded, and long
    // before upstream's read_only_employee_cannot_request_write_mcp_tools.
    assert.equal(res.status, 400);
    assert.equal((res.body as { code: string }).code, "hire_request_invalid");
    assert.equal(await exists(path.join(dir, "positions", "repo-owner", "docs-writer")), false);
    assert.equal(driver.calls.length, 0);
  } finally {
    await server.close();
  }
});

test("POST /hire: static validation failure is fail-closed before any filesystem effect", async () => {
  const driver = new FakeDriver({ status: "applied" }, emulateEngineHire);
  driver.hireOutcome = { status: "failed", code: "hire_request_budget_malformed", message: "budget malformed" };
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const before = await fs.readdir(path.join(dir, "positions", "repo-owner"));
    const res = await api(server.baseUrl, "/hire", { method: "POST", token: server.token, body: VALID_HIRE });
    assert.equal(res.status, 422);
    assert.equal((res.body as { code: string }).code, "hire_request_budget_malformed");
    assert.deepEqual(driver.calls, [], "engine is never called after a failed static gate");
    assert.deepEqual(await fs.readdir(path.join(dir, "positions", "repo-owner")), before, "no staged skeleton survives");
  } finally {
    await server.close();
  }
});

test("POST /hire: engine adjudication failure rolls the staged skeleton back", async () => {
  const driver = new FakeDriver({
    status: "failed",
    code: "workspace_org_budget_not_allocated",
    message: "budget not allocated",
    retryable: false,
  });
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const res = await api(server.baseUrl, "/hire", { method: "POST", token: server.token, body: VALID_HIRE });
    assert.equal(res.status, 422);
    assert.equal((res.body as { code: string }).code, "workspace_org_budget_not_allocated");
    assert.equal(await exists(path.join(dir, "positions", "repo-owner", "docs-writer")), false, "no half-hired position survives");
    assert.equal((await readApplied(dir)).roles.some((role) => role.id === "docs-writer"), false);
  } finally {
    await server.close();
  }
});

test("POST /hire: duplicate position id is rejected with a stable 409 before the static gate", async () => {
  const driver = new FakeDriver({ status: "applied" });
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const res = await api(server.baseUrl, "/hire", {
      method: "POST", token: server.token,
      body: { ...VALID_HIRE, positionId: "repo-owner" },
    });
    assert.equal(res.status, 409);
    assert.equal((res.body as { code: string }).code, "hire_position_exists");
    assert.equal(driver.hireCalls.length, 0);
    assert.equal(driver.calls.length, 0);
  } finally {
    await server.close();
  }
});

test("POST /hire: boundary matrix fails closed at the request gate (400 hire_request_invalid)", async () => {
  const driver = new FakeDriver({ status: "applied" });
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const cases: Array<[string, Record<string, unknown>]> = [
      ["unknown field", { ...VALID_HIRE, memoryScope: "/" }],
      ["missing budget", (() => { const { budget: _budget, ...rest } = VALID_HIRE; return rest; })()],
      ["empty name", { ...VALID_HIRE, name: "   " }],
      ["oversized name", { ...VALID_HIRE, name: "名".repeat(64) }],
      ["invalid mode", { ...VALID_HIRE, mode: "autonomous" }],
      ["zero perTask tokens", { ...VALID_HIRE, budget: { perTask: { tokens: 0 }, perDay: { tokens: 200000 } } }],
      ["unknown budget scope key", { ...VALID_HIRE, budget: { perTask: { tokens: 1, cost: 2 }, perDay: { tokens: 2 } } }],
      ["budget cap exceeded", { ...VALID_HIRE, budget: { perTask: { tokens: 2_000_000_000 }, perDay: { tokens: 2 } } }],
      ["bad deadline", { ...VALID_HIRE, deadline: "not-a-date" }],
      ["invalid position id", { ...VALID_HIRE, positionId: "a--b" }],
      ["reportTo not found", { ...VALID_HIRE, reportTo: "ghost-position" }],
      ["invalid network", { ...VALID_HIRE, network: "allow" }],
      // #89 MCP grant boundaries, mirroring employee-mcp.v1alpha1 upstream.
      ["mcp tools without servers", { ...VALID_HIRE, mcp: { tools: [{ name: "a", requestedMode: "read" }], servers: [] } }],
      ["mcp servers without tools", { ...VALID_HIRE, mcp: { tools: [], servers: [{ name: "s", transport: { type: "stdio", command: "x" } }] } }],
      ["mcp unknown field", { ...VALID_HIRE, mcp: { tools: [{ name: "a", requestedMode: "read" }], servers: [{ name: "s", transport: { type: "stdio", command: "x" } }], catalog: "x" } }],
      ["mcp invalid tool name", { ...VALID_HIRE, mcp: { tools: [{ name: "Bad Name", requestedMode: "read" }], servers: [{ name: "s", transport: { type: "stdio", command: "x" } }] } }],
      ["mcp duplicate tool name", { ...VALID_HIRE, mcp: { tools: [{ name: "a", requestedMode: "read" }, { name: "a", requestedMode: "read" }], servers: [{ name: "s", transport: { type: "stdio", command: "x" } }] } }],
      ["mcp invalid requestedMode", { ...VALID_HIRE, mcp: { tools: [{ name: "a", requestedMode: "admin" }], servers: [{ name: "s", transport: { type: "stdio", command: "x" } }] } }],
      ["mcp unknown transport", { ...VALID_HIRE, mcp: { tools: [{ name: "a", requestedMode: "read" }], servers: [{ name: "s", transport: { type: "grpc", command: "x" } }] } }],
      ["mcp stdio without command", { ...VALID_HIRE, mcp: { tools: [{ name: "a", requestedMode: "read" }], servers: [{ name: "s", transport: { type: "stdio", command: "  " } }] } }],
      ["mcp lowercase env name", { ...VALID_HIRE, mcp: { tools: [{ name: "a", requestedMode: "read" }], servers: [{ name: "s", transport: { type: "stdio", command: "x", environment: ["token"] } }] } }],
      ["mcp plaintext http url", { ...VALID_HIRE, mcp: { tools: [{ name: "a", requestedMode: "read" }], servers: [{ name: "s", transport: { type: "http", url: "http://mcp.example.com" } }] } }],
      ["mcp url with credentials", { ...VALID_HIRE, mcp: { tools: [{ name: "a", requestedMode: "read" }], servers: [{ name: "s", transport: { type: "http", url: "https://user:pass@mcp.example.com" } }] } }],
      ["mcp header value inlined instead of env name", { ...VALID_HIRE, mcp: { tools: [{ name: "a", requestedMode: "read" }], servers: [{ name: "s", transport: { type: "http", url: "https://mcp.example.com", headers: [{ name: "Authorization", valueFromEnv: "Bearer sk-live-123" }] } }] } }],
      ["mcp duplicate server name", { ...VALID_HIRE, mcp: { tools: [{ name: "a", requestedMode: "read" }], servers: [{ name: "s", transport: { type: "stdio", command: "x" } }, { name: "s", transport: { type: "stdio", command: "y" } }] } }],
    ];
    for (const [label, body] of cases) {
      const res = await api(server.baseUrl, "/hire", { method: "POST", token: server.token, body });
      assert.equal(res.status, 400, label);
      assert.equal((res.body as { code: string }).code, "hire_request_invalid", label);
    }
    assert.equal(driver.hireCalls.length, 0, "gate failures never reach the CLI");
    assert.equal(driver.calls.length, 0);
    assert.equal(await exists(path.join(dir, "positions", "repo-owner", "docs-writer")), false);
  } finally {
    await server.close();
  }
});

test("POST /hire: engine unavailability surfaces 503 retryable without partial state", async () => {
  const driver = new FakeDriver({ status: "applied" });
  driver.hireOutcome = { status: "engine_unavailable", message: "cannot spawn digital-employee" };
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const res = await api(server.baseUrl, "/hire", { method: "POST", token: server.token, body: VALID_HIRE });
    assert.equal(res.status, 503);
    const body = res.body as { code: string; retryable: boolean };
    assert.equal(body.code, "engine_unavailable");
    assert.equal(body.retryable, true);
    assert.equal(await exists(path.join(dir, "positions", "repo-owner", "docs-writer")), false);
  } finally {
    await server.close();
  }
});
