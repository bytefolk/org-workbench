/**
 * Sync the local qoder CLI agent roster (~/.qoder/agents/*.md) into an
 * org-workbench workspace: writes workspace.json + organization.v1alpha1.json
 * (workspace-org.v1 declaration) + one employee-package per position under
 * positions/. The engine adapter (bin/qoder-engine.mjs) then derives the
 * applied model from this layout on `org apply`. Idempotent: re-running
 * overwrites the generated files. Position ids follow qoder agent names
 * verbatim (turns spawn `qoder --agent <position-id>`), so they are the
 * contract between org-workbench and the qoder CLI — the client mirrors,
 * never invents.
 *
 * Usage: node scripts/sync-qoder-org.mjs [agentsDir] [workspaceDir]
 *   agentsDir     default: ~/.qoder/agents
 *   workspaceDir  default: <repo>/workspaces/qoder-team
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORG_SCHEMA = "https://raw.githubusercontent.com/fullstack-ai-infra/digital-employee/main/configs/workspace-org.schema.json";
const WS_SCHEMA = "https://raw.githubusercontent.com/fullstack-ai-infra/digital-employee/main/configs/workspace.schema.json";
const PKG_SCHEMA = "https://raw.githubusercontent.com/fullstack-ai-infra/digital-employee/main/configs/employee-package.schema.json";

const OWNER_ID = "client-lead";
const BUSINESS = "qoder-team";
const DEFAULT_BUDGET = {
  perTask: { tokens: 20000, iterations: 8 },
  perDay: { tokens: 200000, iterations: 64 },
};
const OWNER_BUDGET = {
  perTask: { tokens: 40000, iterations: 12 },
  perDay: { tokens: 400000, iterations: 96 },
};

/** Human titles for known agents; anything else falls back to the first
 * clause of the qoder description ("你是<身份>，负责…" → <身份>). */
const TITLES = {
  [OWNER_ID]: "客户端负责人",
  architect: "架构师",
  "open-source-dev": "开源协作工程师",
  "ops-dws": "DWS 运营",
  "personal-voice": "语气写作助手",
  "platform-internal": "平台内部开发",
  "project-progress-manager": "项目进度经理",
  tester: "测试工程师",
};

/** qoder agent color names → CSS colors usable as avatar backgrounds. */
const COLOR_HEX = {
  blue: "#2f6feb",
  cyan: "#0e9bab",
  orange: "#c96a12",
  pink: "#c93a7d",
  purple: "#7a44c9",
  green: "#2f8a3c",
  red: "#c9403a",
  yellow: "#a8842a",
};

function fail(message) {
  console.error(`sync-qoder-org: ${message}`);
  process.exit(1);
}

function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value.startsWith("'") || value.startsWith('"')) {
      const quote = value[0];
      if (value.endsWith(quote) && value.length >= 2) {
        value = quote === "'" ? value.slice(1, -1).replace(/''/g, "'") : JSON.parse(value);
      }
    }
    meta[kv[1]] = value;
  }
  return { meta, body: text.slice(match[0].length) };
}

function titleFor(id, description) {
  if (TITLES[id]) return TITLES[id];
  const clause = (description ?? "").split(/[。，,;；]/)[0].replace(/^你是/, "").trim();
  return clause.length > 0 && clause.length <= 20 ? clause : id;
}

function employeePackage(id, title, description) {
  return {
    $schema: PKG_SCHEMA,
    schemaVersion: "employee-package.v1alpha1",
    name: id,
    version: "0.1.0",
    description,
    license: "Apache-2.0",
    authors: ["qoder-agents-sync"],
    host: { protocol: "agent-host.v1", requiredCapabilities: [] },
    entrypoints: { skill: "./SKILL.md" },
    policy: {
      mode: "approval_required",
      network: "deny",
      filesystem: { read: ["./knowledge/**"], write: [] },
      mcpTools: [],
    },
    assets: ["./SKILL.md"],
  };
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const agentsDir = path.resolve(process.argv[2] ?? path.join(os.homedir(), ".qoder", "agents"));
  const workspaceDir = path.resolve(process.argv[3] ?? path.join(repoRoot, "workspaces", BUSINESS));

  const agentFiles = fs
    .readdirSync(agentsDir)
    .filter((name) => name.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b, "en"));
  if (agentFiles.length === 0) fail(`no agent definitions in ${agentsDir}`);

  const agents = agentFiles.map((file) => {
    const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, file), "utf8"));
    const id = meta.name ?? path.basename(file, ".md");
    if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(`agent id not a valid position id: ${id} (${file})`);
    return {
      id,
      title: titleFor(id, meta.description),
      description: meta.description ?? `${id} (qoder agent)`,
      color: COLOR_HEX[meta.color],
      body: body.trim(),
    };
  });
  if (agents.some((agent) => agent.id === OWNER_ID)) fail(`agent name collides with owner id: ${OWNER_ID}`);

  const roles = [
    {
      id: OWNER_ID,
      name: TITLES[OWNER_ID],
      description: "Org owner: the human client lead; owns org decisions and approval gates.",
      reportTo: null,
      package: { name: OWNER_ID, version: "0.1.0", digest: "", localReference: `./positions/${OWNER_ID}` },
      mode: "approval_required",
      memoryScope: "/",
      toolAllow: [],
      toolDeny: [],
      budget: OWNER_BUDGET,
      metadata: { color: COLOR_HEX.blue },
    },
    ...agents.map((agent) => ({
      id: agent.id,
      name: agent.title,
      description: agent.description,
      reportTo: OWNER_ID,
      package: { name: agent.id, version: "0.1.0", digest: "", localReference: `./positions/${OWNER_ID}/${agent.id}` },
      mode: "approval_required",
      memoryScope: "/",
      toolAllow: [],
      toolDeny: [],
      budget: DEFAULT_BUDGET,
      metadata: agent.color ? { color: agent.color } : {},
    })),
  ];

  fs.rmSync(path.join(workspaceDir, "positions"), { recursive: true, force: true });
  fs.mkdirSync(workspaceDir, { recursive: true });

  const writePosition = (dir, role, body) => {
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, "employee.json"), employeePackage(role.id, role.name, role.description));
    writeJson(path.join(dir, "budget.json"), role.budget);
    const skill = [
      "---",
      `name: ${role.id}`,
      `description: ${role.description}`,
      "---",
      "",
      body || `# ${role.name}`,
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "SKILL.md"), skill);
  };

  const ownerRole = roles[0];
  writePosition(
    path.join(workspaceDir, "positions", OWNER_ID),
    ownerRole,
    `# ${ownerRole.name}\n\n你是本组织的负责人（人类客户 lead），拥有组织决策与审批权。所有岗位向你汇报，敏感操作需经你批准。`,
  );
  for (const agent of agents) {
    const role = roles.find((entry) => entry.id === agent.id);
    writePosition(path.join(workspaceDir, "positions", OWNER_ID, agent.id), role, agent.body);
  }

  writeJson(path.join(workspaceDir, "workspace.json"), {
    $schema: WS_SCHEMA,
    schemaVersion: "workspace.v1alpha1",
    name: BUSINESS,
    description: `Team of qoder CLI agents (${agents.length}) reporting to the client lead; synced from ${agentsDir}.`,
    template: "qoder-agents-sync",
    createdAt: new Date().toISOString(),
    organization: "./organization.v1alpha1.json",
    positions: "./positions",
    context: "./context",
  });
  fs.mkdirSync(path.join(workspaceDir, "context"), { recursive: true });

  writeJson(path.join(workspaceDir, "organization.v1alpha1.json"), {
    $schema: ORG_SCHEMA,
    schemaVersion: "workspace-org.v1",
    business: BUSINESS,
    description: `Team of qoder CLI agents (${agents.length}) reporting to the client lead; synced from ${agentsDir}.`,
    owner: OWNER_ID,
    roles,
    updatedAt: new Date().toISOString(),
  });

  console.log(`synced ${agents.length} qoder agents (+owner) → ${workspaceDir}`);
}

main();
