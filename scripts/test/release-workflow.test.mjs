import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function workflow() {
  return fs
    .readFileSync(path.join(projectRoot, ".github/workflows/release.yml"), "utf8")
    .replaceAll("\r\n", "\n");
}

test("write access is granted to exactly one job, and only to contents", () => {
  const source = workflow();
  // Default read, so a new job cannot inherit write by being added.
  assert.match(source, /^permissions:\n  contents: read$/m);

  const grants = [...source.matchAll(/^\s+permissions:\n\s+([a-z-]+): write$/gm)];
  assert.equal(grants.length, 1, "exactly one job may hold a write grant");
  assert.equal(grants[0][1], "contents");

  // The build legs run third-party-installed code; they must not be able to
  // publish, and the publish job must not be able to do anything else.
  assert.doesNotMatch(source, /packages: write|id-token: write|actions: write/);
});

test("no signing credential is referenced, because this lane does not sign", () => {
  const source = workflow();
  for (const pattern of [/CSC_LINK/, /CSC_KEY_PASSWORD/, /WIN_CSC/, /APPLE_ID/, /APPLE_APP_SPECIFIC_PASSWORD/, /notarytool/, /SIGNPATH/]) {
    assert.doesNotMatch(source, pattern, `signing belongs to #135/#136, not here: ${pattern}`);
  }
  // github.token is the only credential this workflow may use.
  const secrets = [...source.matchAll(/\$\{\{\s*secrets\.([A-Za-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(secrets, [], "the built-in token is sufficient to publish; no repository secret is needed");
});

test("a tag is refused unless it matches the packaged version", () => {
  const source = workflow();
  assert.match(source, /does not match the packaged version/);
  assert.match(source, /exit 1/);
});

test("an already-published release is refused rather than replaced", () => {
  const source = workflow();
  assert.match(source, /already published; bump the version instead/);
  // A draft may be replaced; a published release may not. Both branches must
  // exist, or the check collapses into one behaviour.
  assert.match(source, /true\)\s+echo "::warning::draft release/);
  assert.match(source, /false\)\s+echo "::error::release/);
});

test("update metadata is namespaced per leg and restored before publishing", () => {
  const source = workflow();
  // Without namespacing, both legs upload `latest.yml` and one silently wins.
  assert.match(source, /for file in latest\*\.yml/);
  assert.match(source, /--\$\{\{ matrix\.label \}\}\.yml/);
  // electron-updater looks for the original names, so the suffix has to come off.
  assert.match(source, /for file in latest\*--\*\.yml/);
  assert.ok(
    source.includes("sed -E 's/--[^.]+\\.yml$/.yml/'"),
    "the restore step must strip exactly the leg suffix, leaving the name electron-updater expects",
  );
});

test("the unsigned limitation is stated in the run and in the release notes", () => {
  const source = workflow();
  assert.match(source, /::warning::This release is unsigned/);
  assert.match(source, /--notes "Unsigned build\./);
  // Both mention where the gap is tracked rather than leaving it implicit.
  assert.match(source, /#135/);
  assert.match(source, /#136/);
});

test("the update feed is declared on the dist commands only, and agrees with package metadata", () => {
  const config = require("../../apps/desktop/electron-builder.config.cjs");
  // A provider in the shared config would make electron-builder write
  // app-update.yml into the staging resources, where the manifest asserts its
  // contents byte-exact against source. Staging must stay feed-free.
  assert.equal("publish" in config, false, "the shared config must not declare a feed");

  const { repository, scripts } = require("../../package.json");
  assert.ok(repository?.url, "package metadata must name the repository");
  const owner = /github\.com\/([^/]+)\/([^/.]+)/.exec(repository.url);
  assert.ok(owner, `unrecognised repository url: ${repository.url}`);

  for (const command of ["package:dist:macos", "package:dist:windows"]) {
    const value = scripts[command];
    assert.match(value, /-c\.publish\.provider=github/, `${command} must declare the feed`);
    assert.match(
      value,
      new RegExp(`-c\\.publish\\.owner=${owner[1]}\\b`),
      `${command} feed owner must agree with package metadata`,
    );
    assert.match(
      value,
      new RegExp(`-c\\.publish\\.repo=${owner[2]}\\b`),
      `${command} feed repo must agree with package metadata`,
    );
    // Declaring a feed is not authority to use it.
    assert.match(value, /--publish never/, `${command} must still refuse publish authority`);
  }

  for (const command of ["package:staging:macos", "package:staging:windows"]) {
    assert.doesNotMatch(scripts[command], /-c\.publish\./, `${command} must not declare a feed`);
  }
});

test("every build leg validates its asset set before anything is uploaded", () => {
  const source = workflow();
  const scripts = require("../../package.json").scripts;
  for (const command of ["verify:dist:macos", "verify:dist:windows"]) {
    assert.ok(scripts[command], `${command} must exist for the workflow to call it`);
    assert.match(source, new RegExp(command.replaceAll(":", "\\:")));
  }
  // The verify step has to precede the upload, or a bad asset set still ships.
  assert.ok(
    source.indexOf("Verify installer asset set") < source.indexOf("Upload release artifacts"),
    "asset-set validation must run before upload",
  );
});
