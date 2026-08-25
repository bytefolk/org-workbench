import { readFileSync } from "node:fs";

const forbidden = [
  "CONTEXT_OPERATOR_TOKEN",
  "CONTEXT_OPERATOR_TOKEN_SHA256",
  "ORG_WORKBENCH_BOOT_TOKEN",
  "QODER_PERSONAL_ACCESS_TOKEN",
  "ANTHROPIC_API_KEY",
];
if (
  process.env.CONTEXT_RUNTIME_TOKEN !== "fixture-runtime-secret" ||
  process.env.CONTEXT_VAULT !== "fixture-vault" ||
  forbidden.some((key) => process.env[key] !== undefined) ||
  process.argv.some((value) => value.includes("fixture-runtime-secret"))
) {
  process.stderr.write("unsafe environment\n");
  process.exit(2);
}

const request = JSON.parse(readFileSync(0, "utf8"));
const command = process.argv.at(-1);
if (command === "ingest") {
  process.stdout.write(JSON.stringify({
    inserted: true,
    occurrenceId: request.occurrenceId,
    status: "pending",
  }));
} else if (command === "distill") {
  process.stdout.write(JSON.stringify({
    occurrenceId: request.occurrenceId,
    status: "done",
    artifacts: 1,
  }));
} else {
  process.exit(3);
}
