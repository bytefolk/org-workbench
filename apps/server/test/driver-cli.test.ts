import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DigitalEmployeeCliDriver } from "../src/engine/driver-cli.js";

test("CLI driver: invokes org apply with the workspace and returns the applied payload", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "owb-driver-"));
  const fakeCli = path.join(dir, "fake-cli.mjs");
  await fs.writeFile(
    fakeCli,
    `const expected = ${JSON.stringify(dir)};
const actual = process.argv.slice(2);
if (JSON.stringify(actual) !== JSON.stringify(["org", "apply", expected, "--json"])) {
  process.stdout.write(JSON.stringify({status:"failed",code:"bad_argv"}) + "\\n");
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({
    status:"applied", business:"test", owner:"owner", bootstrapped:false,
    positions:1, changes:{hired:[],moved:[],dismissed:[],budgetUpdated:[]},
    organization:".digital-employee/org.json",
    audit:".digital-employee/org-audit.jsonl",
    permissions:".digital-employee/permissions.json"
  }) + "\\n");
}
`,
    "utf8",
  );

  const result = await new DigitalEmployeeCliDriver(`${process.execPath} ${fakeCli}`).apply(dir);
  assert.equal(result.status, "applied");
  assert.equal((result as { result?: { business?: string } }).result?.business, "test");
});

test("CLI driver: exit zero without status=applied fails closed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "owb-driver-"));
  const fakeCli = path.join(dir, "fake-cli.mjs");
  await fs.writeFile(
    fakeCli,
    `process.stdout.write(JSON.stringify({status:"unknown"}) + "\\n");\n`,
    "utf8",
  );

  const result = await new DigitalEmployeeCliDriver(`${process.execPath} ${fakeCli}`).apply(dir);
  assert.equal(result.status, "failed");
});
