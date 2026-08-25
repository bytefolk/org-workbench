import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { api, startTestServer } from "./helpers.js";
import { hostHealth, probeClaudeLocalBinary, supportedClaudeVersion } from "../src/routes/health.js";

test("health Host readiness is credential-presence only and never returns credential values", () => {
  const secret = "qoder-secret-must-not-leak";
  const health = hostHealth(true, { QODER_PERSONAL_ACCESS_TOKEN: secret });
  assert.deepEqual(health.qoder, { configured: true, ready: true });
  assert.equal(health["claude-code"].configured, false);
  assert.equal(health["claude-code"].ready, false);
  assert.doesNotMatch(JSON.stringify(health), new RegExp(secret));

  const cliUnavailable = hostHealth(false, {
    QODER_PERSONAL_ACCESS_TOKEN: secret,
    ANTHROPIC_API_KEY: "claude-secret-must-not-leak",
  });
  assert.equal(cliUnavailable.qoder.configured, true);
  assert.equal(cliUnavailable.qoder.ready, false, "CLI reachability alone is not Host readiness");
  assert.equal(cliUnavailable["claude-code"].ready, false);
  assert.doesNotMatch(JSON.stringify(cliUnavailable), /secret-must-not-leak/);
});

test("claude-local Host health is binary+version preflight, never a credential check", () => {
  const supported = { installed: true, version: "2.1.223", supported: true };
  const ready = hostHealth(true, {}, supported);
  assert.deepEqual(ready["claude-local"], { configured: true, ready: true });

  const noCli = hostHealth(false, {}, supported);
  assert.equal(noCli["claude-local"].configured, true);
  assert.equal(noCli["claude-local"].ready, false);
  assert.match(noCli["claude-local"].nextStep ?? "", /digital-employee CLI/);

  const outOfWindow = hostHealth(true, {}, { installed: true, version: "2.2.0", supported: false });
  assert.equal(outOfWindow["claude-local"].configured, false);
  assert.equal(outOfWindow["claude-local"].ready, false);
  assert.match(outOfWindow["claude-local"].nextStep ?? "", /2\.2\.0/);
  assert.match(outOfWindow["claude-local"].nextStep ?? "", /2\.1\.214/);

  const missing = hostHealth(true, {}, { installed: false, version: null, supported: false });
  assert.equal(missing["claude-local"].configured, false);
  assert.match(missing["claude-local"].nextStep ?? "", /PATH/);
  assert.doesNotMatch(missing["claude-local"].nextStep ?? "", /ANTHROPIC_API_KEY/);

  assert.equal(supportedClaudeVersion("2.1.214"), true);
  assert.equal(supportedClaudeVersion("2.1.223 (Claude Code)"), true);
  assert.equal(supportedClaudeVersion("2.1.213"), false);
  assert.equal(supportedClaudeVersion("2.2.0"), false);
  assert.equal(supportedClaudeVersion(null), false);
  assert.equal(supportedClaudeVersion("no-version-here"), false);
});

test("claude-local probe reads the announced version from the resolved binary", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "owb-claude-probe-"));
  const bin = path.join(dir, "claude-fixture");
  await fs.writeFile(bin, "#!/usr/bin/env node\nconsole.log('2.1.223 (Claude Code)');\n", { mode: 0o755 });

  const found = probeClaudeLocalBinary({ DIGITAL_EMPLOYEE_CLAUDE_COMMAND: bin });
  assert.equal(found.installed, true);
  assert.equal(found.version, "2.1.223");
  assert.equal(found.supported, true);

  const gone = probeClaudeLocalBinary({ DIGITAL_EMPLOYEE_CLAUDE_COMMAND: path.join(dir, "no-such-binary") });
  assert.deepEqual(gone, { installed: false, version: null, supported: false });
});

test("boot: loopback bind, boot-token auth, /health exemption, version header", async () => {
  const server = await startTestServer();
  try {
    assert.equal(server.boundAddress, "127.0.0.1", "control plane must bind loopback only");

    const health = await api(server.baseUrl, "/health");
    assert.equal(health.status, 200);
    assert.equal(health.header("x-orgworkbench-api"), "v0");
    const healthBody = health.body as {
      status: string;
      api: string;
      engine: { command: string; available: boolean };
      hosts: {
        qoder: { configured: boolean; ready: boolean };
        "claude-code": { configured: boolean; ready: boolean };
        "claude-local": { configured: boolean; ready: boolean };
      };
      workspace: { open: boolean };
    };
    assert.equal(healthBody.status, "ok");
    assert.equal(healthBody.api, "v0");
    assert.equal(typeof healthBody.engine.available, "boolean");
    assert.equal(typeof healthBody.hosts.qoder.configured, "boolean");
    assert.equal(typeof healthBody.hosts.qoder.ready, "boolean");
    assert.equal(typeof healthBody.hosts["claude-code"].configured, "boolean");
    assert.equal(typeof healthBody.hosts["claude-code"].ready, "boolean");
    assert.equal(typeof healthBody.hosts["claude-local"].configured, "boolean");
    assert.equal(typeof healthBody.hosts["claude-local"].ready, "boolean");
    assert.equal(healthBody.workspace.open, false);

    const noToken = await api(server.baseUrl, "/workspace");
    assert.equal(noToken.status, 401);
    assert.equal((noToken.body as { code: string }).code, "unauthorized");

    const badToken = await api(server.baseUrl, "/workspace", { token: "wrong-token" });
    assert.equal(badToken.status, 401);

    const withToken = await api(server.baseUrl, "/workspace", { token: server.token });
    assert.equal(withToken.status, 200);
    assert.equal((withToken.body as { open: boolean }).open, false);
  } finally {
    await server.close();
  }
});
