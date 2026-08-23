import assert from "node:assert/strict";
import test from "node:test";
import { api, connectSse, copyExampleWorkspace, startTestServer } from "./helpers.js";

test("events: SSE delivers org.updated; reconnect resumes by version stamp", async () => {
  const server = await startTestServer();
  const dir = await copyExampleWorkspace();
  const first = connectSse(server.baseUrl, server.token);
  try {
    await api(server.baseUrl, "/workspace/open", {
      method: "POST",
      token: server.token,
      body: { path: dir },
    });
    const seen = await first.waitForEvent("org.updated");
    assert.ok(seen.id, "every event must carry a version stamp (SSE id)");
    const parsed = JSON.parse(seen.data) as { seq: number; type: string };
    assert.equal(parsed.type, "org.updated");
    assert.equal(String(parsed.seq), seen.id);
    const firstSeq = parsed.seq;

    // A fresh connection without Last-Event-ID must NOT replay history.
    const fresh = connectSse(server.baseUrl, server.token);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(fresh.events.filter((frame) => frame.event === "org.updated").length, 0);
    fresh.close();

    // Reconnect with the last stamp: replay starts strictly after it, so we
    // trigger one more event and expect exactly the newer one.
    first.close();
    await api(server.baseUrl, "/org/apply", {
      method: "POST",
      token: server.token,
      body: {
        schemaVersion: "change-manifest.v1",
        changes: [{ op: "move", id: "issue-researcher", reportTo: "release-engineer" }],
      },
    });
    const resumed = connectSse(server.baseUrl, server.token, String(firstSeq));
    const replayed = await resumed.waitForEvent("org.updated");
    const replayedParsed = JSON.parse(replayed.data) as { seq: number };
    assert.ok(replayedParsed.seq > firstSeq, "resume must replay only newer events");
    resumed.close();
  } finally {
    first.close();
    await server.close();
  }
});
