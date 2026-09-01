const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  LOGIN_PATH_COMMAND,
  LOGIN_PATH_MARKER,
  LOGIN_PATH_MAX_BUFFER_BYTES,
  LOGIN_PATH_TIMEOUT_MS,
  recoverMacGuiPath,
} = require("../src/macos-login-path.cjs");

const FALLBACK_PATH = "/usr/bin:/bin";

function recovery(overrides = {}) {
  return recoverMacGuiPath({
    platform: "darwin",
    env: {
      HOME: "/Users/operator",
      LOGNAME: "operator",
      PATH: FALLBACK_PATH,
      SHELL: "/bin/sh",
      USER: "operator",
      OWB_LOGIN_ONLY_SECRET: "must-not-cross",
    },
    isExecutableShell: () => true,
    ...overrides,
  });
}

test("macOS GUI PATH recovery invokes a login shell with fixed argv and a minimal environment", async () => {
  let invocation = null;
  const value = await recovery({
    execFileImpl: (file, args, options, callback) => {
      invocation = { file, args, options };
      callback(null, `${LOGIN_PATH_MARKER}/Users/operator/.local/bin:/usr/bin:/bin\n`, "");
      return { kill() {} };
    },
  });

  assert.equal(value, "/Users/operator/.local/bin:/usr/bin:/bin");
  assert.equal(invocation.file, "/bin/sh");
  assert.deepEqual(invocation.args, ["-l", "-c", LOGIN_PATH_COMMAND]);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.timeout, LOGIN_PATH_TIMEOUT_MS);
  assert.equal(invocation.options.killSignal, "SIGKILL");
  assert.equal(invocation.options.maxBuffer, LOGIN_PATH_MAX_BUFFER_BYTES);
  assert.deepEqual(invocation.options.env, {
    HOME: "/Users/operator",
    LOGNAME: "operator",
    PATH: FALLBACK_PATH,
    SHELL: "/bin/sh",
    USER: "operator",
  });
});

test("non-macOS processes keep their original PATH without invoking a shell", async () => {
  let invoked = false;
  const value = await recovery({
    platform: "linux",
    execFileImpl: () => {
      invoked = true;
      throw new Error("must not run");
    },
  });
  assert.equal(value, FALLBACK_PATH);
  assert.equal(invoked, false);
});

for (const [name, stdout] of [
  ["missing marker", "/Users/operator/.local/bin:/usr/bin:/bin\n"],
  ["duplicate marker", `${LOGIN_PATH_MARKER}/usr/bin:/bin\n${LOGIN_PATH_MARKER}/opt/homebrew/bin:/usr/bin:/bin\n`],
  ["profile noise", `welcome\n${LOGIN_PATH_MARKER}/usr/bin:/bin\n`],
  ["relative entry", `${LOGIN_PATH_MARKER}/usr/bin:relative/bin:/bin\n`],
  ["empty entry", `${LOGIN_PATH_MARKER}/usr/bin::/bin\n`],
  ["multiline payload", `${LOGIN_PATH_MARKER}/usr/bin\n/opt/homebrew/bin\n`],
  ["oversized payload", `${LOGIN_PATH_MARKER}/${"x".repeat(LOGIN_PATH_MAX_BUFFER_BYTES)}\n`],
]) {
  test(`invalid login-shell output falls back: ${name}`, async () => {
    const value = await recovery({
      execFileImpl: (_file, _args, _options, callback) => {
        callback(null, stdout, "");
        return { kill() {} };
      },
    });
    assert.equal(value, FALLBACK_PATH);
  });
}

test("spawn errors and timeouts preserve the original PATH", async () => {
  for (const error of [
    Object.assign(new Error("spawn failed"), { code: "ENOENT" }),
    Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" }),
  ]) {
    const value = await recovery({
      execFileImpl: (_file, _args, _options, callback) => {
        callback(error, `${LOGIN_PATH_MARKER}/opt/homebrew/bin:/usr/bin:/bin\n`, "");
        return { kill() {} };
      },
    });
    assert.equal(value, FALLBACK_PATH);
  }
});

test("an untrusted shell path fails closed before process creation", async () => {
  let invoked = false;
  const value = await recovery({
    env: { PATH: FALLBACK_PATH, SHELL: "relative-shell" },
    isExecutableShell: () => false,
    execFileImpl: () => {
      invoked = true;
      throw new Error("must not run");
    },
  });
  assert.equal(value, FALLBACK_PATH);
  assert.equal(invoked, false);
});

test("hard timeout kills a login-shell fixture that traps SIGTERM", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "owb-login-timeout-"));
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  const shell = path.join(home, "trap-term-shell");
  const pidFile = path.join(home, "shell.pid");
  fs.writeFileSync(shell, `#!/bin/sh
trap '' TERM
printf '%s\\n' "$$" > "$HOME/shell.pid"
while :; do :; done
`, { mode: 0o700 });

  const startedAt = Date.now();
  const value = await recoverMacGuiPath({
    platform: "darwin",
    env: {
      HOME: home,
      LOGNAME: "operator",
      PATH: FALLBACK_PATH,
      SHELL: shell,
      USER: "operator",
    },
  });
  const elapsedMs = Date.now() - startedAt;
  const pid = Number.parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);

  assert.equal(value, FALLBACK_PATH);
  assert.ok(elapsedMs >= LOGIN_PATH_TIMEOUT_MS, `timeout returned too early: ${elapsedMs}ms`);
  assert.ok(elapsedMs < LOGIN_PATH_TIMEOUT_MS + 3000, `timeout was not bounded: ${elapsedMs}ms`);
  assert.throws(
    () => process.kill(pid, 0),
    (error) => error?.code === "ESRCH",
    `login-shell pid ${pid} survived the hard timeout`,
  );
});
