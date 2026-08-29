const assert = require("node:assert/strict");
const test = require("node:test");
const { winToWslPath, controlPlaneMode } = require("../src/control-plane-launch.cjs");

test("winToWslPath converts drive paths to /mnt/<drive>/...", () => {
  assert.equal(winToWslPath("C:\\Users\\a\\server.js"), "/mnt/c/Users/a/server.js");
  assert.equal(winToWslPath("D:/x/y.js"), "/mnt/d/x/y.js");
  assert.equal(winToWslPath("/already/wsl.js"), "/already/wsl.js"); // unchanged
});

test("controlPlaneMode: native off-win32, wsl only on explicit opt-in", () => {
  // On the CI (linux) this is always native regardless of env.
  if (process.platform !== "win32") {
    assert.equal(controlPlaneMode({ ORG_WORKBENCH_CONTROL_PLANE: "wsl" }), "native");
    assert.equal(controlPlaneMode({}), "native");
    return;
  }
  assert.equal(controlPlaneMode({}), "native");
  assert.equal(controlPlaneMode({ ORG_WORKBENCH_CONTROL_PLANE: "wsl" }), "wsl");
  assert.equal(controlPlaneMode({ ORG_WORKBENCH_CONTROL_PLANE: "native" }), "native");
});
