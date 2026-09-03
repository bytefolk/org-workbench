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

test("credentials may be checked for presence but never used to sign", () => {
  const source = workflow();

  // Nothing here signs. The credentials are read to decide whether a release may
  // be published, which is a different act from consuming them.
  for (const pattern of [/notarytool/, /stapler/, /codesign/, /signtool/, /SIGNPATH/, /CSC_LINK/, /CSC_KEY_PASSWORD/]) {
    assert.doesNotMatch(source, pattern, `signing belongs to #135/#136, not here: ${pattern}`);
  }

  // Every secret reference must sit in the signing-status step. A secret reaching
  // a build leg would mean this lane had started signing without saying so.
  const signingStep = (() => {
    const start = source.indexOf("- name: Determine signing status");
    assert.notEqual(start, -1, "the signing-status step must exist");
    const rest = source.slice(start);
    const end = rest.indexOf("      - name: ", 1);
    return end === -1 ? rest : rest.slice(0, end);
  })();

  const all = [...source.matchAll(/\$\{\{\s*secrets\.([A-Za-z_]+)/g)].map((m) => m[0]);
  const inStep = [...signingStep.matchAll(/\$\{\{\s*secrets\.([A-Za-z_]+)/g)].map((m) => m[0]);
  assert.deepEqual(
    all.length,
    inStep.length,
    `every secret reference must sit in the signing-status step; found ${all.length} overall and ${inStep.length} there`,
  );

  // Publishing itself needs only the built-in token, which is what makes this
  // slice deliverable without any credential being configured.
  assert.match(source, /GH_TOKEN: \$\{\{ github\.token \}\}/);
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

test("an unsigned build cannot reach a published release", () => {
  const source = workflow();

  // This is the whole boundary. electron-updater reads GitHub's /releases/latest,
  // which excludes drafts, so keeping an unsigned build in draft is also what
  // stops a client discovering it. And discovery is the only thing standing in
  // the way: NsisUpdater skips signature verification entirely when the installed
  // app carries no publisherName, which an unsigned build does not.
  assert.match(source, /Refusing to publish a non-draft release without signing credentials/);
  assert.match(source, /if: steps\.signing\.outputs\.signed != 'true'/);

  // Draft is unconditional at creation, not a flag that might be cleared. #187
  // moved publication into its own final step, so the release exists as a draft
  // before anything decides whether it may leave that state.
  const createStep = source.slice(source.indexOf("- name: Create the release as a draft"));
  assert.match(createStep.slice(0, createStep.indexOf("- name: Read back")), /^\s+--draft \\$/m);
  assert.match(
    createStep,
    /if \[ "\$\{\{ needs\.preflight\.outputs\.signed \}\}" = "true" \]/,
    "leaving draft must be conditional on signing",
  );

  // And the step that actually publishes runs only on that decision.
  assert.match(source, /- name: Publish the release\n\s+if: steps\.create\.outputs\.publish == 'true'/);
  // No other step may clear the draft.
  assert.equal([...source.matchAll(/--draft=false/g)].length, 1);
});

test("signing status is derived from credentials, not from a constant", () => {
  const source = workflow();
  // A hand-maintained flag drifts: someone adds signing and forgets to flip it,
  // or flips it without adding signing. Deriving it means the gate opens itself.
  assert.match(source, /secrets\.MACOS_CERTIFICATE/);
  assert.match(source, /secrets\.WINDOWS_SIGNING_TOKEN/);
  assert.match(source, /echo "signed=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(source, /echo "signed=false" >> "\$GITHUB_OUTPUT"/);
  assert.doesNotMatch(source, /signed: *(true|false)\b/, "signed status must not be hard-coded");
});

test("the unsigned limitation is stated in the run and in the release notes", () => {
  const source = workflow();
  // Named consequences, not a bare "unsigned": what a person actually hits, and
  // why a client is not offered the update.
  assert.match(source, /::warning::No signing credentials configured/);
  assert.match(source, /Gatekeeper blocks first launch/);
  assert.match(source, /SmartScreen prompt/);
  assert.match(source, /electron-updater skips signature checks entirely/);
  assert.match(source, /--notes "Unsigned build, install-only on both platforms\./);
  // The notes must state the refusal, not just the word "unsigned". Someone
  // downloading from the release page needs to know the app will not update
  // itself and why, or they will read silence as "it works".
  assert.match(source, /In-app update is refused/);
  assert.match(source, /skips signature verification entirely/);
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

// #187 / RELEASING.md Phase 4. Each of these was verified by hand for v0.1.0
// and gated by nothing; a hand proof does not run on the next release.
test("#187 a lightweight tag is refused before anything is built", () => {
  const source = workflow();
  const step = source.slice(source.indexOf("- name: Refuse a lightweight tag"));
  assert.match(step, /git cat-file -t "refs\/tags\/\$\{GITHUB_REF_NAME\}"/);
  assert.match(step, /!= "tag"/);
  assert.match(step, /must be annotated/);
  // Refusals belong in preflight: nothing may be built from a tag that cannot
  // be the release tag.
  const preflight = source.slice(source.indexOf("  preflight:"), source.indexOf("  build:"));
  assert.match(preflight, /- name: Refuse a lightweight tag/);
});

test("#187 a tag that is not reachable from main is refused before anything is built", () => {
  const source = workflow();
  const step = source.slice(source.indexOf("- name: Refuse a tag that is not reachable from main"));
  assert.match(step, /git merge-base --is-ancestor/);
  assert.match(step, /refs\/remotes\/origin\/main/);
  assert.match(step, /\^\{commit\}/);
  const preflight = source.slice(source.indexOf("  preflight:"), source.indexOf("  build:"));
  assert.match(preflight, /- name: Refuse a tag that is not reachable from main/);
  // Both checks need history the default shallow checkout does not fetch.
  assert.match(preflight, /fetch-depth: 0/);
});

test("#187 the asset inventory is read back, and publication is the last step", () => {
  const source = workflow();
  const readback = source.slice(
    source.indexOf("- name: Read back the asset inventory"),
    source.indexOf("- name: Publish the release"),
  );
  assert.ok(readback.length > 0, "the readback must sit before the publish step");
  // Read from the API, not from what the job believes it uploaded.
  assert.match(readback, /gh api "repos\/\$\{\{ github\.repository \}\}\/releases/);
  assert.match(readback, /reports no assets/);
  assert.match(readback, /does not match what was uploaded/);
  assert.match(readback, /select\(\.size == 0 or \.state != "uploaded" or \.digest == null\)/);

  // Publication last, in the literal ordering of the file.
  const steps = [...source.matchAll(/^      - name: (.+)$/gm)].map((match) => match[1]);
  assert.equal(steps[steps.length - 1], "Publish the release");
  assert.ok(
    steps.indexOf("Read back the asset inventory") > steps.indexOf("Create the release as a draft"),
  );
});
