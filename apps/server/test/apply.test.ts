import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { OrgApplyFailure, OrgApplySuccess, OrganizationFile } from "@org-workbench/shared";
import { FakeDriver, api, copyExampleWorkspace, startTestServer } from "./helpers.js";

const HIRE_CHANGE = {
  op: "add",
  position: {
    id: "docs-writer",
    name: "Docs Writer",
    description: "Keeps documentation current.",
    reportTo: "repo-owner",
    mode: "read_only",
    memoryScope: "/",
    toolAllow: ["Read", "Grep"],
    toolDeny: [],
    budget: {
      perTask: { tokens: 20000, iterations: 8 },
      perDay: { tokens: 200000, iterations: 64 },
    },
  },
} as const;

const ADD_DOCS_WRITER = {
  schemaVersion: "change-manifest.v1",
  changes: [HIRE_CHANGE],
};

const STATE_FILES = ["org.json", "org-audit.jsonl", "permissions.json"] as const;

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

/** Deterministic test double for the external engine: consumes the proposal
 * tree and writes only the applied model/audit artifacts the server reloads. */
async function emulateEngineApply(dir: string): Promise<void> {
  const model = await readApplied(dir);
  const root = path.join(dir, "positions", "repo-owner");
  const docsPath = path.join(root, "docs-writer");
  const docs = model.roles.find((role) => role.id === "docs-writer");
  const hired: OrganizationFile["roles"] = [];
  const moved: Array<{ id: string; from: string | null; to: string | null }> = [];
  const dismissed: OrganizationFile["roles"] = [];
  if ((await exists(docsPath)) && !docs) {
    const role: OrganizationFile["roles"][number] = {
      id: HIRE_CHANGE.position.id,
      name: HIRE_CHANGE.position.name,
      description: HIRE_CHANGE.position.description,
      reportTo: HIRE_CHANGE.position.reportTo,
      package: {
        name: HIRE_CHANGE.position.id,
        version: "0.1.0",
        digest: "sha256:fixture",
        localReference: docsPath,
      },
      mode: HIRE_CHANGE.position.mode,
      memoryScope: HIRE_CHANGE.position.memoryScope,
      toolAllow: [...HIRE_CHANGE.position.toolAllow],
      toolDeny: [...HIRE_CHANGE.position.toolDeny],
      budget: structuredClone(HIRE_CHANGE.position.budget),
      metadata: {},
    };
    model.roles.push(role);
    hired.push(role);
  }
  const issue = model.roles.find((role) => role.id === "issue-researcher");
  if (issue) {
    const candidates: Array<{ file: string; reportTo: string | null }> = [
      { file: path.join(docsPath, "issue-researcher"), reportTo: "docs-writer" },
      { file: path.join(dir, "positions", "issue-researcher"), reportTo: null },
      { file: path.join(root, "issue-researcher"), reportTo: "repo-owner" },
    ];
    for (const candidate of candidates) {
      if (!(await exists(candidate.file))) continue;
      if (issue.reportTo !== candidate.reportTo) {
        moved.push({ id: issue.id, from: issue.reportTo, to: candidate.reportTo });
      }
      issue.reportTo = candidate.reportTo;
      issue.package.localReference = candidate.file;
      break;
    }
  }
  if (!(await exists(path.join(root, "community-operator")))) {
    const index = model.roles.findIndex((role) => role.id === "community-operator");
    if (index >= 0) dismissed.push(...model.roles.splice(index, 1));
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
      changes: { hired, moved, dismissed, budgetUpdated: [] },
      positionCount: model.roles.length,
    })}\n`,
    { mode: 0o600 },
  );
}

async function appliedBytes(dir: string): Promise<Map<string, Buffer>> {
  return new Map(
    await Promise.all(STATE_FILES.map(async (file) => [file, await fs.readFile(path.join(dir, ".digital-employee", file))] as const)),
  );
}

async function assertAppliedBytes(dir: string, expected: Map<string, Buffer>): Promise<void> {
  for (const file of STATE_FILES) {
    assert.deepEqual(await fs.readFile(path.join(dir, ".digital-employee", file)), expected.get(file), file);
  }
}

test("org apply: rejection keeps the proposal tree and applied state is byte-identical", async () => {
  const driver = new FakeDriver({
    status: "failed",
    code: "workspace_org_budget_missing",
    message: "position budget missing",
    retryable: false,
  });
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const before = await appliedBytes(dir);
    const res = await api(server.baseUrl, "/org/apply", {
      method: "POST", token: server.token, body: ADD_DOCS_WRITER,
    });
    assert.equal(res.status, 422);
    const body = res.body as OrgApplyFailure;
    assert.equal(body.code, "workspace_org_budget_missing");
    assert.deepEqual(driver.calls, [dir], "engine receives workspace, not staging");
    await assertAppliedBytes(dir, before);
    const proposal = path.join(dir, "positions", "repo-owner", "docs-writer");
    assert.ok((await fs.stat(path.join(proposal, "employee.json"))).isFile());
    assert.equal((await fs.stat(path.join(proposal, "budget.json"))).mode & 0o777, 0o600);
    await assert.rejects(fs.stat(path.join(dir, ".digital-employee", "staging")));
    await assert.rejects(fs.stat(path.join(dir, ".digital-employee", "apply-log.ndjson")));
    assert.equal("rejectedStaging" in (body as unknown as Record<string, unknown>), false);
  } finally {
    await server.close();
  }
});

test("org apply: hire/move/dismiss materialize the proposal, reload applied org, and retain backup", async () => {
  const driver = new FakeDriver({ status: "applied" }, emulateEngineApply);
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const hire = await api(server.baseUrl, "/org/apply", {
      method: "POST", token: server.token, body: ADD_DOCS_WRITER,
    });
    assert.equal(hire.status, 200);
    const hired = hire.body as OrgApplySuccess;
    assert.equal(hired.changesApplied, 1);
    assert.ok((await readApplied(dir)).roles.some((role) => role.id === "docs-writer"));
    assert.equal((await api(server.baseUrl, "/org/tree", { token: server.token }).then((res) => res.body) as { updatedAt: string }).updatedAt, hired.version.updatedAt);

    const move = await api(server.baseUrl, "/org/apply", {
      method: "POST", token: server.token,
      body: { schemaVersion: "change-manifest.v1", changes: [{ op: "move", id: "issue-researcher", reportTo: "docs-writer" }] },
    });
    assert.equal(move.status, 200);
    assert.equal((await readApplied(dir)).roles.find((role) => role.id === "issue-researcher")?.reportTo, "docs-writer");
    assert.ok(await exists(path.join(dir, "positions", "repo-owner", "docs-writer", "issue-researcher")));

    const disband = await api(server.baseUrl, "/org/apply", {
      method: "POST", token: server.token,
      body: { schemaVersion: "change-manifest.v1", changes: [{ op: "delete", id: "community-operator" }] },
    });
    assert.equal(disband.status, 200);
    assert.equal((await readApplied(dir)).roles.some((role) => role.id === "community-operator"), false);
    const backups = await fs.readdir(path.join(dir, ".digital-employee", "backup"));
    assert.ok(backups.some((entry) => entry.startsWith("community-operator-")));
    assert.deepEqual(driver.calls, [dir, dir, dir]);
    await assert.rejects(fs.stat(path.join(dir, ".digital-employee", "apply-log.ndjson")));

    const reports = await api(server.baseUrl, "/reports", { token: server.token });
    const audits = (reports.body as { streams: { audits: Array<{ schemaVersion: string }> } }).streams.audits;
    assert.equal(audits[0]?.schemaVersion, "org-audit.v1");
    assert.equal(audits.length, 4);
  } finally {
    await server.close();
  }
});

test("org apply: reportTo=null moves a position to the positions root", async () => {
  const driver = new FakeDriver({ status: "applied" }, emulateEngineApply);
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const res = await api(server.baseUrl, "/org/apply", {
      method: "POST", token: server.token,
      body: { schemaVersion: "change-manifest.v1", changes: [{ op: "move", id: "issue-researcher", reportTo: null }] },
    });
    assert.equal(res.status, 200);
    assert.ok(await exists(path.join(dir, "positions", "issue-researcher")));
  } finally {
    await server.close();
  }
});

test("org apply: shape/conflict failures do not mutate proposal tree or call engine", async () => {
  const driver = new FakeDriver({ status: "applied" });
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const noBudget = {
      schemaVersion: "change-manifest.v1",
      changes: [{ op: "add", position: {
        id: "no-budget", name: "No Budget", description: "x", reportTo: "repo-owner",
        mode: "read_only", memoryScope: "/", toolAllow: [], toolDeny: [],
      } }],
    };
    assert.equal((await api(server.baseUrl, "/org/apply", { method: "POST", token: server.token, body: noBudget })).status, 400);
    const duplicate = {
      schemaVersion: "change-manifest.v1",
      changes: [{ ...HIRE_CHANGE, position: { ...HIRE_CHANGE.position, id: "repo-owner" } }],
    };
    const duplicateRes = await api(server.baseUrl, "/org/apply", { method: "POST", token: server.token, body: duplicate });
    assert.equal((duplicateRes.body as { code: string }).code, "org_apply_position_exists");
    const ownerRes = await api(server.baseUrl, "/org/apply", {
      method: "POST", token: server.token,
      body: { schemaVersion: "change-manifest.v1", changes: [{ op: "delete", id: "repo-owner" }] },
    });
    assert.equal((ownerRes.body as { code: string }).code, "org_apply_owner_delete");
    assert.equal(driver.calls.length, 0);
    await assert.rejects(fs.stat(path.join(dir, "positions", "repo-owner", "docs-writer")));
  } finally {
    await server.close();
  }
});

test("org apply: position ids use the digital-employee authority pattern", async () => {
  const driver = new FakeDriver({
    status: "failed",
    code: "fixture_rejected_after_manifest_validation",
    message: "fixture stops after the D2 boundary",
    retryable: false,
  });
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    await api(server.baseUrl, "/workspace/open", {
      method: "POST", token: server.token, body: { path: dir },
    });
    const valid = {
      schemaVersion: "change-manifest.v1",
      changes: [{ ...HIRE_CHANGE, position: { ...HIRE_CHANGE.position, id: "7x" } }],
    };
    const accepted = await api(server.baseUrl, "/org/apply", {
      method: "POST", token: server.token, body: valid,
    });
    assert.equal(accepted.status, 422);
    assert.equal((accepted.body as { code: string }).code, "fixture_rejected_after_manifest_validation");
    assert.deepEqual(driver.calls, [dir]);

    for (const id of ["a--b", "a-"]) {
      const rejected = await api(server.baseUrl, "/org/apply", {
        method: "POST",
        token: server.token,
        body: {
          schemaVersion: "change-manifest.v1",
          changes: [{ ...HIRE_CHANGE, position: { ...HIRE_CHANGE.position, id } }],
        },
      });
      assert.equal(rejected.status, 400);
      assert.equal((rejected.body as { code: string }).code, "manifest_invalid");
    }
    assert.deepEqual(driver.calls, [dir]);
  } finally {
    await server.close();
  }
});

test("org apply: maxDepth=8 rejects before mutating the proposal", async () => {
  const driver = new FakeDriver({ status: "applied" });
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await seedAppliedState(dir);
    const packageSource = path.join(dir, "positions", "repo-owner", "release-engineer");
    let parent = path.join(dir, "positions", "repo-owner", "issue-researcher");
    for (let depth = 3; depth <= 8; depth += 1) {
      const child = path.join(parent, `level-${depth}`);
      await fs.cp(packageSource, child, { recursive: true });
      parent = child;
    }
    await api(server.baseUrl, "/workspace/open", {
      method: "POST", token: server.token, body: { path: dir },
    });
    const community = path.join(dir, "positions", "repo-owner", "community-operator");
    const res = await api(server.baseUrl, "/org/apply", {
      method: "POST", token: server.token,
      body: {
        schemaVersion: "change-manifest.v1",
        changes: [{ op: "move", id: "community-operator", reportTo: "level-8" }],
      },
    });
    assert.equal(res.status, 422);
    assert.equal((res.body as { code: string }).code, "org_apply_max_depth");
    assert.ok(await exists(community), "preflight rejection leaves the source directory in place");
    assert.equal(driver.calls.length, 0);
  } finally {
    await server.close();
  }
});
