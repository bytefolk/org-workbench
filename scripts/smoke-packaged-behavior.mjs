import { fileURLToPath } from "node:url";
import { smokePackagedApp } from "./smoke-packaged-app.mjs";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await smokePackagedApp("macos", process.argv[2], { mode: "behavior" });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
