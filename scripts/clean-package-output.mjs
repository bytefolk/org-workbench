import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.resolve(projectRoot, "release");
if (path.dirname(outputDir) !== projectRoot || path.basename(outputDir) !== "release") {
  throw new Error(`refusing to clean unexpected package output: ${outputDir}`);
}
await fs.rm(outputDir, { force: true, recursive: true });
