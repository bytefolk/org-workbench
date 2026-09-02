const assert = require("node:assert/strict");
const test = require("node:test");
const {
  UPDATE_STATES,
  createUpdaterService,
  updateChannelAvailability,
} = require("../src/updater.cjs");

/** A stand-in for electron-updater: records what was asked of it, emits on demand. */
function fakeUpdater() {
  const listeners = new Map();
  const calls = [];
  return {
    calls,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on(event, handler) { listeners.set(event, handler); return this; },
    emit(event, payload) { listeners.get(event)?.(payload); },
    async checkForUpdates() { calls.push("checkForUpdates"); return { updateInfo: { version: "0.0.1" } }; },
    async downloadUpdate() { calls.push("downloadUpdate"); },
    quitAndInstall() { calls.push("quitAndInstall"); },
  };
}

test("Windows has an update channel; macOS and Linux say why they do not", () => {
  assert.deepEqual(updateChannelAvailability("win32"), { available: true });

  const mac = updateChannelAvailability("darwin");
  assert.equal(mac.available, false);
  // The reason has to be actionable, not a bare flag: it names the requirement
  // and where the work is tracked.
  assert.match(mac.reason, /Developer ID/);
  assert.match(mac.reason, /#135/);

  const linux = updateChannelAvailability("linux");
  assert.equal(linux.available, false);
  assert.ok(linux.reason.length > 0);

  const unknown = updateChannelAvailability("aix");
  assert.equal(unknown.available, false);
  assert.ok(unknown.reason.length > 0);
});

test("an unavailable platform never touches an updater", async () => {
  // Passing null proves the service does not construct or call one: on macOS
  // today there is no signed build for electron-updater to reason about.
  const states = [];
  const service = createUpdaterService({
    updater: null,
    platform: "darwin",
    onState: (event) => states.push(event.state),
  });

  assert.equal(service.state, "unavailable");
  const checked = await service.check();
  assert.equal(checked.state, "unavailable");
  assert.match(checked.reason, /Developer ID/);
  const installed = await service.install();
  assert.equal(installed.state, "unavailable");
  assert.deepEqual(states, ["unavailable"]);
});

test("an available platform refuses to start without an updater", () => {
  assert.throws(
    () => createUpdaterService({ updater: null, platform: "win32" }),
    /requires an updater instance/,
  );
});

test("nothing downloads or installs without being asked", () => {
  const updater = fakeUpdater();
  createUpdaterService({ updater, platform: "win32" });
  // An update that installs itself mid-turn is a data-loss risk, so both
  // automatic paths are turned off at construction.
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
});

test("the full check to install sequence reports every state in order", async () => {
  const updater = fakeUpdater();
  const states = [];
  const service = createUpdaterService({
    updater,
    platform: "win32",
    onState: (event) => states.push(event),
  });

  await service.check();
  updater.emit("update-available", { version: "0.0.1" });
  assert.equal(service.state, "available");

  await service.download({ confirmedByUser: true });
  updater.emit("download-progress", { percent: 41.7 });
  assert.equal(service.state, "downloading");
  assert.equal(states.at(-1).percent, 42);

  updater.emit("update-downloaded", { version: "0.0.1" });
  assert.equal(service.state, "downloaded");

  const installed = await service.install({ confirmedByUser: true });
  assert.equal(installed.installing, true);
  assert.deepEqual(updater.calls, ["checkForUpdates", "downloadUpdate", "quitAndInstall"]);
  assert.deepEqual(states.map((event) => event.state), [
    "checking", "available", "downloading", "downloaded",
  ]);
});

test("already current is a distinct state from an error", async () => {
  const updater = fakeUpdater();
  const service = createUpdaterService({ updater, platform: "win32" });
  await service.check();
  updater.emit("update-not-available");
  assert.equal(service.state, "current");
});

test("a failed check surfaces the reason instead of hanging in checking", async () => {
  const updater = fakeUpdater();
  updater.checkForUpdates = async () => { throw new Error("ENOTFOUND api.github.com"); };
  const service = createUpdaterService({ updater, platform: "win32" });

  const result = await service.check();
  assert.equal(result.state, "error");
  assert.match(result.reason, /ENOTFOUND/);
  assert.equal(service.state, "error");
});

test("an updater error event is reported even when no call is in flight", async () => {
  const updater = fakeUpdater();
  const states = [];
  const service = createUpdaterService({ updater, platform: "win32", onState: (e) => states.push(e) });
  updater.emit("error", new Error("signature mismatch"));
  assert.equal(service.state, "error");
  assert.match(states.at(-1).reason, /signature mismatch/);
});

test("download and install refuse out of order rather than acting", async () => {
  const updater = fakeUpdater();
  const service = createUpdaterService({ updater, platform: "win32" });

  const early = await service.download({ confirmedByUser: true });
  assert.match(early.reason, /no update is available/);
  const premature = await service.install({ confirmedByUser: true });
  assert.match(premature.reason, /no downloaded update is ready/);
  assert.deepEqual(updater.calls, []);
});

test("every state the service publishes is a declared one", async () => {
  const updater = fakeUpdater();
  const states = [];
  const service = createUpdaterService({ updater, platform: "win32", onState: (e) => states.push(e.state) });
  await service.check();
  for (const event of ["update-available", "download-progress", "update-downloaded", "update-not-available"]) {
    updater.emit(event, { percent: 1, version: "0.0.1" });
  }
  updater.emit("error", new Error("x"));
  for (const state of states) assert.ok(UPDATE_STATES.includes(state), `undeclared state: ${state}`);
});

test("neither download nor install proceeds without explicit confirmation", async () => {
  // #110 R3, verbatim: an unsigned platform "must not silently download, apply,
  // or restart into that update". The refusal lives here rather than in a UI,
  // because #134's UI does not exist yet and a later one must not be able to
  // skip the prompt by forgetting to ask.
  const updater = fakeUpdater();
  const service = createUpdaterService({ updater, platform: "win32" });
  assert.equal(service.availability.requiresConfirmation, true);

  await service.check();
  updater.emit("update-available", { version: "0.0.1" });

  for (const call of [
    () => service.download(),
    () => service.download({}),
    () => service.download({ confirmedByUser: false }),
    // A truthy value that is not exactly true must not pass either.
    () => service.download({ confirmedByUser: "yes" }),
    () => service.download({ confirmedByUser: 1 }),
  ]) {
    const result = await call();
    assert.match(result.reason, /requires explicit confirmation/);
  }
  assert.deepEqual(updater.calls, ["checkForUpdates"], "nothing was downloaded");

  await service.download({ confirmedByUser: true });
  updater.emit("update-downloaded", { version: "0.0.1" });

  for (const call of [
    () => service.install(),
    () => service.install({ confirmedByUser: false }),
    () => service.install({ confirmedByUser: "yes" }),
  ]) {
    const result = await call();
    assert.match(result.reason, /requires explicit confirmation/);
  }
  assert.deepEqual(
    updater.calls,
    ["checkForUpdates", "downloadUpdate"],
    "quitAndInstall must not have run without confirmation",
  );

  const installed = await service.install({ confirmedByUser: true });
  assert.equal(installed.installing, true);
  assert.deepEqual(updater.calls, ["checkForUpdates", "downloadUpdate", "quitAndInstall"]);
});

test("checking needs no confirmation, because checking changes nothing", async () => {
  // The decision permits check-and-notify outright. Requiring a prompt to look
  // would make the feature useless without protecting anything.
  const updater = fakeUpdater();
  const service = createUpdaterService({ updater, platform: "win32" });
  const result = await service.check();
  assert.notEqual(result.state, "unavailable");
  assert.deepEqual(updater.calls, ["checkForUpdates"]);
});
