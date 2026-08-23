import assert from "node:assert/strict";
import test from "node:test";
import { api, startTestServer } from "./helpers.js";

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
      workspace: { open: boolean };
    };
    assert.equal(healthBody.status, "ok");
    assert.equal(healthBody.api, "v0");
    assert.equal(typeof healthBody.engine.available, "boolean");
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
