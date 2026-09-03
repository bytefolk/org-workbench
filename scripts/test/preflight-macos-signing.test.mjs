import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const preflightScript = path.join(projectRoot, "scripts", "preflight-macos-signing.mjs");

const ALL_SECRETS = {
  MACOS_CERTIFICATE: "base64-cert-data",
  MACOS_CERTIFICATE_PASSWORD: "cert-password",
  MACOS_TEAM_ID: "ABC123DEF4",
  MACOS_APPLE_ID: "dev@example.com",
  MACOS_APP_SPECIFIC_PASSWORD: "app-specific-pw",
};

function runPreflight(env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [preflightScript], {
      encoding: "utf8",
      env: { ...env },
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      exitCode: error.status,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

test("preflight exits 0 when all required secrets are present", () => {
  const result = runPreflight(ALL_SECRETS);
  assert.equal(result.exitCode, 0, `expected exit 0, got ${result.exitCode}: ${result.stderr}`);
  assert.match(result.stdout, /all 5 required secrets are present/);
});

test("preflight exits 1 when no secrets are configured", () => {
  const result = runPreflight({});
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /macOS signing preflight failed/);
  for (const name of Object.keys(ALL_SECRETS)) {
    assert.match(result.stderr, new RegExp(name), `stderr must name missing secret ${name}`);
  }
});

test("preflight exits 1 and names exactly the missing secrets", () => {
  const partial = {
    MACOS_CERTIFICATE: ALL_SECRETS.MACOS_CERTIFICATE,
    MACOS_CERTIFICATE_PASSWORD: ALL_SECRETS.MACOS_CERTIFICATE_PASSWORD,
  };
  const result = runPreflight(partial);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /MACOS_TEAM_ID/);
  assert.match(result.stderr, /MACOS_APPLE_ID/);
  assert.match(result.stderr, /MACOS_APP_SPECIFIC_PASSWORD/);
  // Present secrets must not be listed as missing.
  assert.doesNotMatch(result.stderr, /missing:\n.*MACOS_CERTIFICATE\b(?!_PASSWORD)/);
  assert.doesNotMatch(result.stderr, /missing:\n.*MACOS_CERTIFICATE_PASSWORD/);
});

test("preflight treats whitespace-only values as missing", () => {
  const result = runPreflight({
    ...ALL_SECRETS,
    MACOS_TEAM_ID: "   ",
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /MACOS_TEAM_ID/);
});

test("preflight never echoes secret values to stdout or stderr", () => {
  const result = runPreflight({});
  for (const value of Object.values(ALL_SECRETS)) {
    assert.ok(!result.stdout.includes(value), `stdout must not contain secret value ${value}`);
    assert.ok(!result.stderr.includes(value), `stderr must not contain secret value ${value}`);
  }
});

test("preflight references the tracking issue", () => {
  const result = runPreflight({});
  assert.match(result.stderr, /#135|issues\/135/);
});
