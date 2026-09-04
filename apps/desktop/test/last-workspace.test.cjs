const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  lastWorkspaceFilePath,
  readLastWorkspacePath,
  writeLastWorkspacePath,
  LAST_WORKSPACE_FILE,
} = require("../src/last-workspace.cjs");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "owb-last-ws-test-"));
}

function cleanTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test("lastWorkspaceFilePath joins userData path with the fixed file name", () => {
  const result = lastWorkspaceFilePath("/tmp/fake-userdata");
  assert.equal(result, path.join("/tmp/fake-userdata", LAST_WORKSPACE_FILE));
});

test("readLastWorkspacePath returns null when no file exists", () => {
  const dir = makeTempDir();
  try {
    assert.equal(readLastWorkspacePath(dir), null);
  } finally {
    cleanTempDir(dir);
  }
});

test("readLastWorkspacePath returns null for malformed JSON", () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, LAST_WORKSPACE_FILE), "not json");
    assert.equal(readLastWorkspacePath(dir), null);
  } finally {
    cleanTempDir(dir);
  }
});

test("readLastWorkspacePath returns null when path field is missing or empty", () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, LAST_WORKSPACE_FILE), JSON.stringify({}));
    assert.equal(readLastWorkspacePath(dir), null);

    fs.writeFileSync(path.join(dir, LAST_WORKSPACE_FILE), JSON.stringify({ path: "" }));
    assert.equal(readLastWorkspacePath(dir), null);

    fs.writeFileSync(path.join(dir, LAST_WORKSPACE_FILE), JSON.stringify({ path: 123 }));
    assert.equal(readLastWorkspacePath(dir), null);
  } finally {
    cleanTempDir(dir);
  }
});

test("writeLastWorkspacePath persists and readLastWorkspacePath recovers the path", () => {
  const dir = makeTempDir();
  try {
    writeLastWorkspacePath(dir, "/home/user/my-workspace");
    assert.equal(readLastWorkspacePath(dir), "/home/user/my-workspace");
  } finally {
    cleanTempDir(dir);
  }
});

test("writeLastWorkspacePath creates the userData directory if missing", () => {
  const dir = path.join(makeTempDir(), "nested", "userdata");
  try {
    assert.equal(fs.existsSync(dir), false);
    writeLastWorkspacePath(dir, "/some/workspace");
    assert.equal(readLastWorkspacePath(dir), "/some/workspace");
  } finally {
    cleanTempDir(path.dirname(path.dirname(dir)));
  }
});

test("writeLastWorkspacePath writes atomically via rename (no partial reads)", () => {
  const dir = makeTempDir();
  try {
    writeLastWorkspacePath(dir, "/workspace/a");
    const filePath = path.join(dir, LAST_WORKSPACE_FILE);
    const tmpPath = filePath + ".tmp";
    assert.equal(fs.existsSync(tmpPath), false, "tmp file should not remain after write");
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(content.path, "/workspace/a");
  } finally {
    cleanTempDir(dir);
  }
});

test("writeLastWorkspacePath sets 0600 permissions on the persisted file", () => {
  if (process.platform === "win32") return;
  const dir = makeTempDir();
  try {
    writeLastWorkspacePath(dir, "/workspace/secret");
    const filePath = path.join(dir, LAST_WORKSPACE_FILE);
    const stat = fs.statSync(filePath);
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600, `expected 0600 but got ${mode.toString(8)}`);
  } finally {
    cleanTempDir(dir);
  }
});

test("writeLastWorkspacePath overwrites a previous value", () => {
  const dir = makeTempDir();
  try {
    writeLastWorkspacePath(dir, "/workspace/first");
    writeLastWorkspacePath(dir, "/workspace/second");
    assert.equal(readLastWorkspacePath(dir), "/workspace/second");
  } finally {
    cleanTempDir(dir);
  }
});

test("persisted record contains only the path (no secrets)", () => {
  const dir = makeTempDir();
  try {
    writeLastWorkspacePath(dir, "/workspace/real");
    const filePath = path.join(dir, LAST_WORKSPACE_FILE);
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const keys = Object.keys(content);
    assert.deepEqual(keys, ["path"], "persisted record must contain only the path field");
    assert.equal(typeof content.path, "string");
  } finally {
    cleanTempDir(dir);
  }
});
