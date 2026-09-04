import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const vitest = path.resolve(here, "..", "node_modules", "vitest", "vitest.mjs");
const inheritedOptions = (process.env.NODE_OPTIONS ?? "").trim();
const nodeOptions = `${inheritedOptions} --no-experimental-webstorage`.trim();
const result = spawnSync(
  process.execPath,
  [vitest, "run", "--config", "apps/desktop/vitest.config.ts", ...process.argv.slice(2)],
  {
    cwd: path.resolve(here, ".."),
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
if (result.signal) {
  process.stderr.write(`renderer tests terminated by ${result.signal}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
