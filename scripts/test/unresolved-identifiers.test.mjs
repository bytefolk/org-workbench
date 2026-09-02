import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The packaging harness is only executed end to end by the native staging jobs, so a
 * plain typo in a branch they reach first surfaces as a red matrix leg rather than a
 * failing unit test -- `harnessLeasePath(report)` for `reportPath` cost two.
 *
 * The repository has no linter, but it already depends on tsc. Running it over these
 * files in checkJs mode reports plenty of inference noise about untyped object
 * literals, which is not worth gating on; unresolved identifiers are a different
 * matter and are always a real defect. Gate on exactly those.
 */
const UNRESOLVED_IDENTIFIER_CODES = ["TS2304", "TS2552"];

const CHECKED = [
  "scripts/*.mjs",
  "apps/desktop/src/*.cjs",
  "apps/desktop/packaging/*.cjs",
];

function runChecker(files) {
  return spawnSync(
    process.execPath,
    [
      require.resolve("typescript/bin/tsc"),
      "--noEmit",
      "--allowJs",
      "--checkJs",
      "--module", "esnext",
      "--moduleResolution", "bundler",
      "--target", "es2022",
      "--skipLibCheck",
      ...files,
    ],
    { cwd: projectRoot, encoding: "utf8" },
  );
}

function unresolved(stdout) {
  return stdout
    .split("\n")
    .filter((line) => UNRESOLVED_IDENTIFIER_CODES.some((code) => line.includes(`error ${code}:`)));
}

test("packaging sources reference no undefined identifiers", () => {
  const checked = CHECKED.flatMap((pattern) => {
    const dir = path.join(projectRoot, path.dirname(pattern));
    const suffix = path.extname(pattern);
    return fs.readdirSync(dir)
      .filter((entry) => entry.endsWith(suffix))
      .map((entry) => path.join(path.dirname(pattern), entry));
  });
  assert.ok(checked.length > 0, "found no packaging sources to check");

  const found = unresolved(runChecker(checked).stdout ?? "");
  assert.deepEqual(found, [], `unresolved identifiers:\n${found.join("\n")}`);
});

test("the identifier check actually fails on an undefined name", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owb-identifier-guard-"));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  const probe = path.join(dir, "probe.mjs");
  fs.writeFileSync(probe, "export const value = definitelyNotDefined;\n");

  const found = unresolved(runChecker([probe]).stdout ?? "");
  assert.equal(found.length, 1, `guard did not report the planted identifier:\n${found.join("\n")}`);
});
