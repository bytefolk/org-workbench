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

test("signing secrets are scoped to their platform steps and never reach build legs", () => {
  const source = workflow();

  // macOS secrets must only appear in the preflight detection step, the keychain
  // import step, and the notarization step — all gated on macOS signing being enabled.
  // A secret reaching a plain build step would sign without the operator having
  // opted in, or leak into a log.
  const macosSecretNames = ["MACOS_CERTIFICATE", "MACOS_CERTIFICATE_PASSWORD", "MACOS_TEAM_ID", "MACOS_APPLE_ID", "MACOS_APP_SPECIFIC_PASSWORD"];
  for (const name of macosSecretNames) {
    const refs = [...source.matchAll(new RegExp(`secrets\\.${name}`, "g"))];
    assert.ok(refs.length > 0, `${name} must be referenced somewhere`);
    for (const match of refs) {
      const surroundingStep = source.slice(Math.max(0, match.index - 500), match.index);
      const stepName = surroundingStep.match(/- name: (.+)$/m)?.[1] ?? "";
      const allowedSteps = ["Determine signing status", "Import macOS signing certificate", "Notarize macOS app", "Build signed macOS installer"];
      assert.ok(
        allowedSteps.some((s) => stepName.includes(s)),
        `${name} found in unexpected step "${stepName}"; allowed: ${allowedSteps.join(", ")}`,
      );
    }
  }

  // The ephemeral keychain must be deleted even when a prior step fails, or the
  // certificate persists on the shared runner for the next job (#135 AC-002).
  assert.match(source, /if: always\(\).*delete-keychain/s, "keychain cleanup must run unconditionally");
  assert.match(source, /security delete-keychain/, "keychain cleanup must invoke security delete-keychain");

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

  // Draft is the default, not the exception. A tag push previously published
  // outright, which would have put an unsigned build behind /releases/latest.
  assert.match(source, /draft="--draft"/);
  const publishStep = source.slice(source.indexOf("- name: Publish"));
  assert.match(
    publishStep,
    /if \[ "\$\{\{ needs\.preflight\.outputs\.signed \}\}" = "true" \]/,
    "clearing the draft flag must be conditional on signing",
  );
});

test("signing status is derived from credentials, not from a constant", () => {
  const source = workflow();
  // A hand-maintained flag drifts: someone adds signing and forgets to flip it,
  // or flips it without adding signing. Deriving it means the gate opens itself.
  assert.match(source, /secrets\.MACOS_CERTIFICATE/);
  assert.match(source, /secrets\.WINDOWS_SIGNING_TOKEN/);
  assert.match(source, /echo "signed=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(source, /echo "signed=false" >> "\$GITHUB_OUTPUT"/);
  // Each platform's signing status is tracked separately so one platform's
  // missing credentials don't block the other (#135).
  assert.match(source, /echo "macos-signed=/);
  assert.match(source, /echo "windows-signed=/);
  assert.doesNotMatch(source, /signed: *(true|false)\b/, "signed status must not be hard-coded");
});

test("the unsigned limitation is stated in the run and in the release notes", () => {
  const source = workflow();
  // Named consequences, not a bare "unsigned": what a person actually hits, and
  // why a client is not offered the update.
  assert.match(source, /::warning::Signing credentials missing for/);
  assert.match(source, /Gatekeeper blocks first launch/);
  assert.match(source, /SmartScreen/);
  // Release notes are now built per-platform from the signing status outputs,
  // so the notes must reflect each platform's actual state rather than a static string.
  assert.match(source, /macos_status=/);
  assert.match(source, /windows_status=/);
  assert.match(source, /signed and notarized with Developer ID/);
  assert.match(source, /unsigned.*Gatekeeper/);
  // Both platforms mention where the gap is tracked rather than leaving it implicit.
  assert.match(source, /#135/);
  assert.match(source, /#136/);
  // An unsigned warning step must exist for the macOS leg.
  assert.match(source, /Warn about unsigned macOS build/);
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

test("macOS notarization retries and the Gatekeeper step is gated on signing", () => {
  const source = workflow();

  // Notarization can fail transiently (Apple's service, network). A single attempt
  // would make the release flaky; a bounded retry absorbs transient failures while
  // still failing the run when notarization is genuinely broken (#135 AC-003).
  assert.match(source, /MAX_ATTEMPTS=3/);
  assert.match(source, /xcrun notarytool submit/);
  assert.match(source, /--wait/);
  assert.match(source, /xcrun stapler staple/);

  // Gatekeeper assessment must only run when signing actually happened. Running
  // spctl against an unsigned app would always fail and block the build, which
  // is the opposite of useful — the unsigned path has its own warning step.
  const gatekeeperStep = source.slice(
    source.indexOf("Gatekeeper assessment"),
    source.indexOf("Warn about unsigned macOS build"),
  );
  assert.match(gatekeeperStep, /needs\.preflight\.outputs\.macos-signed == 'true'/);
  assert.match(gatekeeperStep, /spctl --assess/);
});

test("electron-builder config signs only when explicitly opted in", () => {
  const config = require("../../apps/desktop/electron-builder.config.cjs");
  // The staging lane must remain deterministic and unsigned. Signing is opt-in
  // via MACOS_SIGNING_ENABLED, which only the signed build step sets (#135).
  // When the env var is absent, identity must be null (explicit unsigned guard).
  delete process.env.MACOS_SIGNING_ENABLED;
  delete require.cache[require.resolve("../../apps/desktop/electron-builder.config.cjs")];
  const unsignedConfig = require("../../apps/desktop/electron-builder.config.cjs");
  assert.equal(unsignedConfig.mac.identity, null, "staging config must guard against unsigned signing");

  // When opted in, identity must be undefined so electron-builder auto-detects
  // the Developer ID from the keychain.
  process.env.MACOS_SIGNING_ENABLED = "true";
  delete require.cache[require.resolve("../../apps/desktop/electron-builder.config.cjs")];
  const signedConfig = require("../../apps/desktop/electron-builder.config.cjs");
  assert.equal(signedConfig.mac.identity, undefined, "signed config must let electron-builder find the identity");
  delete process.env.MACOS_SIGNING_ENABLED;
});
