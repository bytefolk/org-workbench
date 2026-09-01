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

test("hire and org commands isolate operator env while the bundled adapter gets the exact Electron flag", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "owb-driver-env-"));
  const fakeCli = path.join(dir, "fake-cli.mjs");
  const log = path.join(dir, "engine-env.jsonl");
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(
    fakeCli,
    `import fs from "node:fs";
const argv = process.argv.slice(2);
const log = argv.shift();
fs.appendFileSync(log, JSON.stringify({
  command: argv.slice(0, 2).join(" "),
  runAsNode: process.env.ELECTRON_RUN_AS_NODE,
  marker: process.env.ORG_WORKBENCH_INTERNAL_BUNDLED_ELECTRON_ENGINE,
  boot: process.env.ORG_WORKBENCH_BOOT_TOKEN,
  operatorSetting: process.env.OWB_OPERATOR_SETTING,
  provider: process.env.QODER_PERSONAL_ACCESS_TOKEN,
  contextToken: process.env.CONTEXT_RUNTIME_TOKEN,
  arbitrary: process.env.ARBITRARY_SECRET,
  home: process.env.HOME,
}) + "\\n");
if (argv[0] === "hire" && argv[1] === "validate") {
  process.stdout.write(JSON.stringify({status:"valid"}) + "\\n");
} else if (argv[0] === "org" && argv[1] === "apply") {
  process.stdout.write(JSON.stringify({
    status:"applied", business:"test", owner:"owner", bootstrapped:false,
    positions:1, changes:{hired:[],moved:[],dismissed:[],budgetUpdated:[]},
    organization:".digital-employee/org.json",
    audit:".digital-employee/org-audit.jsonl",
    permissions:".digital-employee/permissions.json"
  }) + "\\n");
} else {
  process.exit(9);
}
`,
    "utf8",
  );
  const saved = {
    runAsNode: process.env.ELECTRON_RUN_AS_NODE,
    marker: process.env.ORG_WORKBENCH_INTERNAL_BUNDLED_ELECTRON_ENGINE,
    boot: process.env.ORG_WORKBENCH_BOOT_TOKEN,
    operatorSetting: process.env.OWB_OPERATOR_SETTING,
    provider: process.env.QODER_PERSONAL_ACCESS_TOKEN,
    contextToken: process.env.CONTEXT_RUNTIME_TOKEN,
    arbitrary: process.env.ARBITRARY_SECRET,
  };
  try {
    process.env.ELECTRON_RUN_AS_NODE = "1";
    process.env.ORG_WORKBENCH_INTERNAL_BUNDLED_ELECTRON_ENGINE = "1";
    process.env.ORG_WORKBENCH_BOOT_TOKEN = "server-only-secret";
    process.env.OWB_OPERATOR_SETTING = "must-not-cross";
    process.env.QODER_PERSONAL_ACCESS_TOKEN = "provider-secret";
    process.env.CONTEXT_RUNTIME_TOKEN = "context-secret";
    process.env.ARBITRARY_SECRET = "arbitrary-secret";
    const command = `${process.execPath} ${fakeCli} ${log}`;
    for (const bundled of [false, true]) {
      const driver = new DigitalEmployeeCliDriver(command, 30_000, bundled);
      assert.equal((await driver.hireValidate(path.join(dir, "hire.json"))).status, "valid");
      assert.equal((await driver.apply(dir)).status, "applied");
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      const environmentKey = {
        runAsNode: "ELECTRON_RUN_AS_NODE",
        marker: "ORG_WORKBENCH_INTERNAL_BUNDLED_ELECTRON_ENGINE",
        boot: "ORG_WORKBENCH_BOOT_TOKEN",
        operatorSetting: "OWB_OPERATOR_SETTING",
        provider: "QODER_PERSONAL_ACCESS_TOKEN",
        contextToken: "CONTEXT_RUNTIME_TOKEN",
        arbitrary: "ARBITRARY_SECRET",
      }[key]!;
      if (value === undefined) delete process.env[environmentKey];
      else process.env[environmentKey] = value;
    }
  }

  const records = (await fs.readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(records.map((record) => record.command), [
    "hire validate",
    "org apply",
    "hire validate",
    "org apply",
  ]);
  for (const [index, record] of records.entries()) {
    assert.equal(record.runAsNode, index < 2 ? undefined : "1");
    assert.equal("marker" in record, false);
    assert.equal("boot" in record, false);
    assert.equal("operatorSetting" in record, false);
    assert.equal("provider" in record, false);
    assert.equal("contextToken" in record, false);
    assert.equal("arbitrary" in record, false);
    assert.equal(record.home, process.env.HOME);
  }
});
