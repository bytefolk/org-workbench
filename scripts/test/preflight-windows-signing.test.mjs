import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const preflightScript = path.resolve(__dirname, "..", "preflight-windows-signing.mjs");

function runPreflight(env = {}) {
  const result = spawnSync("node", [preflightScript], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("preflight-windows-signing", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.WINDOWS_SIGNING_ENABLED;
    delete process.env.WINDOWS_PUBLISHER_NAME;
    delete process.env.WINDOWS_SIGNING_SCRIPT;
    delete process.env.WIN_CSC_LINK;
    delete process.env.CSC_KEY_PASSWORD;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should pass when signing is not enabled", () => {
    const result = runPreflight({});
    assert.equal(result.status, 0);
  });

  it("should fail when signing is enabled but publisher name is missing", () => {
    const result = runPreflight({ WINDOWS_SIGNING_ENABLED: "true" });
    assert.equal(result.status, 1);
  });

  it("should pass with cloud signing configuration", () => {
    const result = runPreflight({
      WINDOWS_SIGNING_ENABLED: "true",
      WINDOWS_PUBLISHER_NAME: "Test Publisher",
      WINDOWS_SIGNING_SCRIPT: preflightScript,
    });
    assert.equal(result.status, 0);
  });

  it("should fail when signing script does not exist", () => {
    const result = runPreflight({
      WINDOWS_SIGNING_ENABLED: "true",
      WINDOWS_PUBLISHER_NAME: "Test Publisher",
      WINDOWS_SIGNING_SCRIPT: "/nonexistent/script.sh",
    });
    assert.equal(result.status, 1);
  });
});
