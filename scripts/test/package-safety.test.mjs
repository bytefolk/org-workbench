import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanPackageOutput } from "../clean-package-output.mjs";
import {
  WINDOWS_SIGNATURE_TARGET_ENV,
  classifyMacSignature,
  validateResourceCandidate,
  windowsSignatureInspection,
} from "../verify-packaged-app.mjs";

function makeResourceFixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "owb-package-safety-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const sourceRoot = path.join(root, "source");
  const outputRoot = path.join(sourceRoot, "release", "staging");
  const candidate = path.join(outputRoot, "candidate");
  const resources = path.join(candidate, "resources", "app");
  const expected = path.join(sourceRoot, "expected.js");
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(expected, "expected runtime\n");
  fs.writeFileSync(path.join(resources, "runtime.js"), "expected runtime\n");
  const manifest = new Map([
    ["runtime.js", { kind: "byte-exact", source: expected }],
  ]);
  const validate = (overrides = {}) => validateResourceCandidate({
    sourceRoot,
    outputRoot,
    candidate,
    resources,
    manifest,
    ...overrides,
  });
  return { root, sourceRoot, outputRoot, candidate, resources, expected, manifest, validate };
}

test("resource verifier rejects missing, extra, forbidden, and byte-tampered files", (t) => {
  const fixture = makeResourceFixture(t);
  assert.deepEqual(fixture.validate().packagedFiles, ["runtime.js"]);

  fs.rmSync(path.join(fixture.resources, "runtime.js"));
  assert.throws(() => fixture.validate(), /explicit runtime allowlist/);
  fs.writeFileSync(path.join(fixture.resources, "runtime.js"), "expected runtime\n");

  fs.writeFileSync(path.join(fixture.resources, "extra.txt"), "benign-looking\n");
  assert.throws(() => fixture.validate(), /explicit runtime allowlist/);
  fs.rmSync(path.join(fixture.resources, "extra.txt"));

  for (const forbidden of [".env", "runtime.js.map", "runtime.test.js", "private.key"]) {
    fs.writeFileSync(path.join(fixture.resources, forbidden), "must reject\n");
    assert.throws(() => fixture.validate(), /forbidden packaged runtime path/);
    fs.rmSync(path.join(fixture.resources, forbidden));
  }

  fs.writeFileSync(path.join(fixture.resources, "runtime.js"), "expected runtimf\n");
  assert.throws(() => fixture.validate(), /runtime bytes differ/);
});

test("production verifier rejects a package missing the stable-read runtime module", (t) => {
  const fixture = makeResourceFixture(t);
  const stableReadRelative = "apps/server/dist/src/stable-read.js";
  const packagedStableRead = path.join(fixture.resources, stableReadRelative);
  fs.mkdirSync(path.dirname(packagedStableRead), { recursive: true });
  fs.writeFileSync(packagedStableRead, "expected runtime\n");
  fixture.manifest.set(stableReadRelative, {
    kind: "byte-exact",
    source: fixture.expected,
  });

  assert.deepEqual(
    fixture.validate().packagedFiles,
    [stableReadRelative, "runtime.js"].sort(),
  );
  fs.rmSync(packagedStableRead);
  assert.throws(
    () => fixture.validate(),
    /packaged resources differ from the explicit runtime allowlist/,
  );
});

test("resource verifier rejects linked roots, linked parents, and file symlinks", (t) => {
  if (process.platform === "win32") {
    t.skip("creating test symlinks/junctions requires Windows developer-mode or elevation; native tree verification still rejects them");
    return;
  }
  const fixture = makeResourceFixture(t);
  const external = path.join(fixture.root, "external");
  fs.mkdirSync(external);

  const fileLink = path.join(fixture.resources, "linked.js");
  fs.symlinkSync(fixture.expected, fileLink);
  assert.throws(() => fixture.validate(), /must not contain symlinks/);
  fs.rmSync(fileLink);

  const originalResources = `${fixture.resources}-original`;
  fs.renameSync(fixture.resources, originalResources);
  fs.symlinkSync(originalResources, fixture.resources, "dir");
  assert.throws(() => fixture.validate(), /symlink or junction/);
  fs.rmSync(fixture.resources);
  fs.renameSync(originalResources, fixture.resources);

  const externalCandidate = path.join(external, "candidate");
  const externalResources = path.join(externalCandidate, "resources", "app");
  fs.mkdirSync(externalResources, { recursive: true });
  fs.writeFileSync(path.join(externalResources, "runtime.js"), "expected runtime\n");
  const linkedParent = path.join(fixture.outputRoot, "linked-parent");
  fs.symlinkSync(external, linkedParent, "dir");
  assert.throws(() => fixture.validate({
    candidate: path.join(linkedParent, "candidate"),
    resources: path.join(linkedParent, "candidate", "resources", "app"),
  }), /symlink or junction/);
});

test("resource verifier rejects FIFO and other non-regular nodes", (t) => {
  if (process.platform === "win32") {
    t.skip("Windows has no mkfifo fixture; native walker rejects every non-file/non-directory Dirent kind");
    return;
  }
  const fixture = makeResourceFixture(t);
  const fifo = path.join(fixture.resources, "runtime.pipe");
  const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  assert.throws(() => fixture.validate(), /non-regular filesystem node/);
});

test("package cleaner deletes stale output but refuses a symlink escape", (t) => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "owb-clean-safety-"));
  const stale = path.join(root, "release", "staging", "stale.txt");
  fs.mkdirSync(path.dirname(stale), { recursive: true });
  fs.writeFileSync(stale, "stale\n");
  cleanPackageOutput(root);
  assert.equal(fs.existsSync(stale), false);
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));

  if (process.platform === "win32") {
    t.diagnostic("symlink escape fixture skipped: Windows symlink creation may require elevation");
    return;
  }
  const guardedRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "owb-clean-guard-"));
  const outside = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "owb-clean-outside-"));
  const sentinel = path.join(outside, "staging", "sentinel.txt");
  fs.mkdirSync(path.dirname(sentinel), { recursive: true });
  fs.writeFileSync(sentinel, "preserve\n");
  fs.symlinkSync(outside, path.join(guardedRoot, "release"), "dir");
  t.after(() => fs.rmSync(guardedRoot, { force: true, recursive: true }));
  t.after(() => fs.rmSync(outside, { force: true, recursive: true }));

  assert.throws(() => cleanPackageOutput(guardedRoot), /symbolic link or junction/);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve\n");
});

test("windows signature inspection keeps the target path out of the PowerShell script text", () => {
  const executable = "D:\\a\\org-workbench\\release\\staging\\win-unpacked\\Org Workbench.exe";
  const { command, args, env } = windowsSignatureInspection(executable, { PATH: "C:\\Windows" });

  assert.equal(command, "powershell.exe");
  assert.equal(env[WINDOWS_SIGNATURE_TARGET_ENV], executable);
  assert.equal(env.PATH, "C:\\Windows");

  // A path carried in argv would either be appended to the `-Command` script text
  // or need shell quoting; both broke on the space in "Org Workbench.exe".
  for (const argument of args) {
    assert.ok(!argument.includes(executable), `argv leaked the target path: ${argument}`);
    assert.ok(!argument.includes("param("), "`-Command` cannot bind a param() block");
  }
  assert.ok(args.at(-1).includes(`$env:${WINDOWS_SIGNATURE_TARGET_ENV}`));
});

test("mac signature classifier accepts only the observed unsealed linker ad-hoc state", () => {
  const verification = {
    status: 1,
    signal: null,
    error: undefined,
    stderr: "/staged/Org Workbench.app: code has no resources but signature indicates they must be present\n",
  };
  const details = {
    status: 0,
    signal: null,
    error: undefined,
    stdout: "",
    stderr: [
      "CodeDirectory v=20400 flags=0x20002(adhoc,linker-signed)",
      "Signature=adhoc",
      "TeamIdentifier=not set",
      "Sealed Resources=none",
    ].join("\n"),
  };
  assert.equal(
    classifyMacSignature({ verification, details, codeResourcesExists: false }),
    "unsealed-linker-adhoc",
  );
  assert.throws(() => classifyMacSignature({
    verification,
    details: { ...details, stderr: `${details.stderr}\nAuthority=Unexpected` },
    codeResourcesExists: false,
  }), /signing authority/);
  assert.throws(() => classifyMacSignature({
    verification: { ...verification, stderr: "malformed bundle" },
    details,
    codeResourcesExists: false,
  }), /expected unsealed linker-signature/);
  assert.throws(() => classifyMacSignature({
    verification: { ...verification, error: new Error("tool missing"), status: null },
    details,
    codeResourcesExists: false,
  }), /could not be executed/);
});
