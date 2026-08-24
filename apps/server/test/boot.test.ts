import assert from "node:assert/strict";
import test from "node:test";
import { api, startTestServer } from "./helpers.js";
import { hostHealth } from "../src/routes/health.js";

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
