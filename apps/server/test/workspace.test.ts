import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { OrgTreeSnapshot } from "@org-workbench/shared";
import { api, copyExampleWorkspace, startTestServer } from "./helpers.js";

test("workspace: open example, org-tree.v1 snapshot, invalid skeleton rejected", async () => {
  const server = await startTestServer();
  const dir = await copyExampleWorkspace();
  try {
    const open = await api(server.baseUrl, "/workspace/open", {
      method: "POST",
      token: server.token,
      body: { path: dir },
    });
    assert.equal(open.status, 200);
    assert.equal((open.body as { open: boolean }).open, true);

    const tree = await api(server.baseUrl, "/org/tree", { token: server.token });
    assert.equal(tree.status, 200);
    const snapshot = tree.body as OrgTreeSnapshot;
    assert.equal(snapshot.schemaVersion, "org-tree.v1");
    assert.equal(snapshot.owner, "repo-owner");
    assert.equal(snapshot.business, "oss-maintainer");
    assert.equal(snapshot.positionCount, 4, "oss-maintainer is 1 owner + 3 positions");
    assert.equal(snapshot.depth, 2);
    assert.equal(typeof snapshot.updatedAt, "string");
    assert.equal(snapshot.tree.length, 1);
    const root = snapshot.tree[0];
    assert.ok(root, "root node present");
    assert.equal(root.id, "repo-owner");
    assert.equal(root.reportTo, null);
    assert.ok(root.budget, "root budget declared");
    assert.equal(root.children.length, 3);
    for (const child of root.children) {
      assert.ok(child.budget, `position ${child.id} must carry a budget declaration`);
    }

    const position = await api(server.baseUrl, "/positions/repo-owner", { token: server.token });
    assert.equal(position.status, 200);
    const card = position.body as {
      position: {
        budget: unknown;
        contextScope: string;
        contextSources: Array<{
          kind: string;
          name: string;
          locator: string;
          binding: string;
          state: string;
          itemCount?: number;
        }>;
      };
    };
    assert.ok(card.position.budget);
    assert.equal(typeof card.position.contextScope, "string");
    assert.deepEqual(
      card.position.contextSources.map((source) => source.kind),
      ["workspace_docs", "mem_drive", "context_provider"],
    );
    assert.equal(card.position.contextSources[0]?.name, "岗位知识库");
    assert.equal(card.position.contextSources[0]?.binding, "bound");
    assert.equal(card.position.contextSources[0]?.state, "ready");
    assert.ok((card.position.contextSources[0]?.itemCount ?? 0) > 0);
    assert.equal(card.position.contextSources[1]?.name, "统一网盘");
    assert.equal(card.position.contextSources[1]?.binding, "available");
    assert.ok(["ready", "not_configured"].includes(card.position.contextSources[1]?.state ?? ""));
    assert.equal(card.position.contextSources[2]?.locator, "context://position/repo-owner");

    const missing = await api(server.baseUrl, "/positions/does-not-exist", { token: server.token });
    assert.equal(missing.status, 404);
    assert.equal((missing.body as { code: string }).code, "position_missing");

    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "owb-invalid-"));
    const invalid = await api(server.baseUrl, "/workspace/open", {
      method: "POST",
      token: server.token,
      body: { path: emptyDir },
    });
    assert.equal(invalid.status, 422);
    assert.equal((invalid.body as { code: string }).code, "workspace_invalid");
  } finally {
    await server.close();
  }
});
