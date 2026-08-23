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

async function readOrganization(dir: string): Promise<OrganizationFile> {
  return JSON.parse(
    await fs.readFile(path.join(dir, "organization.v1alpha1.json"), "utf8"),
  ) as OrganizationFile;
}

test("org apply: engine rejection passes stable code through, staging preserved, org untouched", async () => {
  const driver = new FakeDriver({
    status: "failed",
    code: "workspace_org_budget_missing",
    message: "position budget missing",
    retryable: false,
  });
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const before = await readOrganization(dir);

    const res = await api(server.baseUrl, "/org/apply", {
      method: "POST",
      token: server.token,
      body: ADD_DOCS_WRITER,
    });
    assert.equal(res.status, 422);
    const body = res.body as OrgApplyFailure;
    assert.equal(body.status, "failed");
    assert.equal(body.code, "workspace_org_budget_missing", "engine stable code must pass through");
    assert.equal(driver.calls.length, 1);

    const after = await readOrganization(dir);
    assert.equal(after.updatedAt, before.updatedAt, "organization must not change on rejection");
    assert.equal(after.roles.length, 4);

    const rejectedStat = await fs.stat(body.rejectedStaging);
    assert.ok(rejectedStat.isDirectory(), "rejected staging must be preserved for audit");
    const stagedOrg = JSON.parse(
      await fs.readFile(path.join(body.rejectedStaging, "organization.v1alpha1.json"), "utf8"),
    ) as OrganizationFile;
    assert.equal(stagedOrg.roles.length, 5, "staged copy carried the attempted hire");

    const log = await fs.readFile(path.join(dir, ".digital-employee", "apply-log.ndjson"), "utf8");
    assert.ok(log.includes("org.rejected"));
  } finally {
    await server.close();
  }
});

test("org apply: success publishes atomically, archives disbandments, bumps version", async () => {
  const driver = new FakeDriver({ status: "applied" });
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });
    const before = await readOrganization(dir);

    const hire = await api(server.baseUrl, "/org/apply", {
      method: "POST",
      token: server.token,
      body: ADD_DOCS_WRITER,
    });
    assert.equal(hire.status, 200);
    const hired = hire.body as OrgApplySuccess;
    assert.equal(hired.status, "applied");
    assert.equal(hired.changesApplied, 1);

    let after = await readOrganization(dir);
    assert.equal(after.roles.length, 5);
    assert.ok(after.roles.some((role) => role.id === "docs-writer"));
    const hiredPosition = await fs.stat(path.join(dir, "positions", "docs-writer", "employee.json"));
    assert.ok(hiredPosition.isFile(), "hired position package must land in the live workspace");
    assert.notEqual(after.updatedAt, before.updatedAt);
    const tree = await api(server.baseUrl, "/org/tree", { token: server.token });
    const snapshot = tree.body as { updatedAt: string; positionCount: number };
    assert.equal(snapshot.updatedAt, hired.version.updatedAt, "org-tree.v1 updatedAt aligns the applied state");

    const move = await api(server.baseUrl, "/org/apply", {
      method: "POST",
      token: server.token,
      body: {
        schemaVersion: "change-manifest.v1",
        changes: [{ op: "move", id: "issue-researcher", reportTo: "docs-writer" }],
      },
    });
    assert.equal(move.status, 200);
    after = await readOrganization(dir);
    const moved = after.roles.find((role) => role.id === "issue-researcher");
    assert.equal(moved?.reportTo, "docs-writer");

    const disband = await api(server.baseUrl, "/org/apply", {
      method: "POST",
      token: server.token,
      body: { schemaVersion: "change-manifest.v1", changes: [{ op: "delete", id: "community-operator" }] },
    });
    assert.equal(disband.status, 200);
    after = await readOrganization(dir);
    assert.equal(after.roles.length, 4);
    await assert.rejects(fs.stat(path.join(dir, "positions", "community-operator")));
    const archive = await fs.readdir(path.join(dir, ".digital-employee", "archive"));
    assert.ok(
      archive.some((entry) => entry.startsWith("community-operator-")),
      "disbandment must archive the position dir, never hard-delete",
    );

    const log = await fs.readFile(path.join(dir, ".digital-employee", "apply-log.ndjson"), "utf8");
    assert.equal(log.trim().split("\n").length, 3);
    assert.ok(!log.includes("localReference"), "audit log must not print state-bearing paths");
  } finally {
    await server.close();
  }
});

test("org apply: manifest shape failures and staging conflicts stay client-side stable codes", async () => {
  const driver = new FakeDriver({ status: "applied" });
  const server = await startTestServer(driver);
  const dir = await copyExampleWorkspace();
  try {
    await api(server.baseUrl, "/workspace/open", { method: "POST", token: server.token, body: { path: dir } });

    const noBudget = {
      schemaVersion: "change-manifest.v1",
      changes: [
        {
          op: "add",
          position: {
            id: "no-budget",
            name: "No Budget",
            description: "x",
            reportTo: "repo-owner",
            mode: "read_only",
            memoryScope: "/",
            toolAllow: [],
            toolDeny: [],
          },
        },
      ],
    };
    const res1 = await api(server.baseUrl, "/org/apply", { method: "POST", token: server.token, body: noBudget });
    assert.equal(res1.status, 400);
    assert.equal((res1.body as { code: string }).code, "manifest_invalid");

    const duplicate = {
      schemaVersion: "change-manifest.v1",
      changes: [{ ...HIRE_CHANGE, position: { ...HIRE_CHANGE.position, id: "repo-owner" } }],
    };
    const res2 = await api(server.baseUrl, "/org/apply", { method: "POST", token: server.token, body: duplicate });
    assert.equal(res2.status, 422);
    assert.equal((res2.body as { code: string }).code, "org_apply_position_exists");

    const ownerDelete = { schemaVersion: "change-manifest.v1", changes: [{ op: "delete", id: "repo-owner" }] };
    const res3 = await api(server.baseUrl, "/org/apply", { method: "POST", token: server.token, body: ownerDelete });
    assert.equal(res3.status, 422);
    assert.equal((res3.body as { code: string }).code, "org_apply_owner_delete");

    assert.equal(driver.calls.length, 0, "shape/conflict rejections must never reach the engine");

    const capabilityMissing = new FakeDriver({
      status: "engine_capability_missing",
      message: "org apply not available yet",
    });
    const server2 = await startTestServer(capabilityMissing);
    try {
      await api(server2.baseUrl, "/workspace/open", { method: "POST", token: server2.token, body: { path: dir } });
      const res4 = await api(server2.baseUrl, "/org/apply", { method: "POST", token: server2.token, body: ADD_DOCS_WRITER });
      assert.equal(res4.status, 503);
      assert.equal((res4.body as { code: string }).code, "engine_capability_missing");
    } finally {
      await server2.close();
    }
  } finally {
    await server.close();
  }
});
