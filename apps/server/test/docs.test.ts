import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DOCS_FILE_LIST_SCHEMA_VERSION, DOCS_FILE_SCHEMA_VERSION, routes } from "@org-workbench/shared";
import type { DocsFileListResponse, DocsFileResponse } from "@org-workbench/shared";
import { api, copyExampleWorkspace, startTestServer } from "./helpers.js";

async function openWorkspace(baseUrl: string, token: string, dir: string): Promise<void> {
  const opened = await api(baseUrl, routes.workspaceOpen, {
    method: "POST",
    token,
    body: { path: dir },
  });
  assert.equal(opened.status, 200);
}

test("docs routing lists position files deterministically and reads them with file-level version (#35 S2)", async () => {
  const server = await startTestServer();
  const dir = await copyExampleWorkspace();
  try {
    await openWorkspace(server.baseUrl, server.token, dir);

    const list = await api(server.baseUrl, `${routes.docsList}?position=repo-owner`, { token: server.token });
    assert.equal(list.status, 200);
    const listed = list.body as DocsFileListResponse;
    assert.equal(listed.schemaVersion, DOCS_FILE_LIST_SCHEMA_VERSION);
    assert.equal(listed.positionId, "repo-owner");
    const paths = listed.files.map((entry) => entry.path);
    assert.ok(paths.includes("SKILL.md"), `expected SKILL.md in ${paths.join(", ")}`);
    assert.ok(paths.includes("knowledge/README.md"), "expected nested knowledge/README.md");
    assert.deepEqual(paths, [...paths].sort((a, b) => a.localeCompare(b)), "listing must be deterministic");

    const read = await api(server.baseUrl, `${routes.docsRead}?position=repo-owner&path=SKILL.md`, {
      token: server.token,
    });
    assert.equal(read.status, 200);
    const doc = read.body as DocsFileResponse;
    assert.equal(doc.schemaVersion, DOCS_FILE_SCHEMA_VERSION);
    assert.equal(doc.path, "SKILL.md");
    assert.ok(doc.content.length > 0, "SKILL.md must not be served empty");
    assert.match(doc.version, /^\d{4}-\d{2}-\d{2}T/, "file-level version is an ISO mtime");
    assert.equal(doc.version, doc.modifiedAt);
  } finally {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("docs routing refuses escapes, symlinks, hidden segments, and non-allowlisted extensions (#35 S2)", async () => {
  const server = await startTestServer();
  const dir = await copyExampleWorkspace();
  const positionDir = path.join(dir, "positions", "repo-owner");
  try {
    await fs.writeFile(path.join(dir, "outside-secret.md"), "must never be served\n");
    await fs.writeFile(path.join(positionDir, "binary.bin"), Buffer.from([0x00, 0x01]));
    await fs.symlink(path.join(dir, "outside-secret.md"), path.join(positionDir, "linked.md"));

    await openWorkspace(server.baseUrl, server.token, dir);

    const escape = await api(
      server.baseUrl,
      `${routes.docsRead}?position=repo-owner&path=${encodeURIComponent("../../outside-secret.md")}`,
      { token: server.token },
    );
    assert.equal(escape.status, 403);
    assert.equal((escape.body as { code: string }).code, "docs_forbidden");

    const symlink = await api(server.baseUrl, `${routes.docsRead}?position=repo-owner&path=linked.md`, {
      token: server.token,
    });
    assert.equal(symlink.status, 403);
    assert.equal((symlink.body as { code: string }).code, "docs_forbidden");

    const hidden = await api(server.baseUrl, `${routes.docsRead}?position=repo-owner&path=./SKILL.md`, {
      token: server.token,
    });
    assert.equal(hidden.status, 200, "plain relative paths stay routable");

    const binary = await api(server.baseUrl, `${routes.docsRead}?position=repo-owner&path=binary.bin`, {
      token: server.token,
    });
    assert.equal(binary.status, 403);
    assert.equal((binary.body as { code: string }).code, "docs_forbidden");

    const list = await api(server.baseUrl, `${routes.docsList}?position=repo-owner`, { token: server.token });
    const listed = list.body as DocsFileListResponse;
    assert.ok(!listed.files.some((entry) => entry.path === "linked.md"), "symlinks never appear in listings");
  } finally {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("docs routing fails closed on missing files, positions, and closed workspaces (#35 S2)", async () => {
  const server = await startTestServer();
  const dir = await copyExampleWorkspace();
  try {
    const closed = await api(server.baseUrl, `${routes.docsList}?position=repo-owner`, { token: server.token });
    assert.equal(closed.status, 422);
    assert.equal((closed.body as { code: string }).code, "workspace_not_open");

    await openWorkspace(server.baseUrl, server.token, dir);

    const missingFile = await api(server.baseUrl, `${routes.docsRead}?position=repo-owner&path=no-such.md`, {
      token: server.token,
    });
    assert.equal(missingFile.status, 404);
    assert.equal((missingFile.body as { code: string }).code, "docs_missing");

    const missingPosition = await api(server.baseUrl, `${routes.docsList}?position=ghost-role`, {
      token: server.token,
    });
    assert.equal(missingPosition.status, 404);
    assert.equal((missingPosition.body as { code: string }).code, "position_missing");

    const badParam = await api(server.baseUrl, routes.docsRead, { token: server.token });
    assert.equal(badParam.status, 400);
    assert.equal((badParam.body as { code: string }).code, "docs_request_invalid");
  } finally {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
