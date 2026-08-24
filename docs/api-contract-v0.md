# org-workbench 控制面 API 契约 v0（冻结）

状态：**v0 冻结**（D0，2026-08-23）｜ 维护：客户端开发负责人 ｜ 仲裁：产品 P9 提请、技术侧执行
契约单一来源声明：组织语义以 digital-employee #157 R3（DEC-DE-157-002）为准；执行语义以引擎 #165 为准。本契约与上游冲突时，以 digital-employee 契约为准，客户端跟随。

## 0. 冻结规则

1. v0 冻结后，新增端点走 v0 增量：只增不改，不改既有端点语义、不改既有错误码含义、不改既有响应字段含义。
2. 破坏性变更升 v1，并双轨过渡（v0/v1 并行至少一个里程碑）。
3. `/org/apply` 的变更清单形状与引擎错误码以 #157 契约为准，契约变更时客户端跟随，不自造语义。
4. 本文件与实现逐端点一致，由 `apps/server/test/contract.test.ts` 持续核对。

## 1. 通用约定

- 绑定面：仅 `127.0.0.1`。v1 不暴露 LAN；远程访问不在 v0 范围。
- 鉴权：`Authorization: Bearer <boot-token>`。token 为每次启动生成的 32 字节随机十六进制串；仅 `/health` 免 token（供壳探活）。
- 内容类型：请求/响应均为 UTF-8 JSON；请求体上限 1 MiB。
- 版本头：所有响应携带 `X-OrgWorkbench-API: v0`。
- 事件：走 SSE（`/events`），事件体带版本戳（seq），断线重连按版本戳补拉。
- 错误体（全端点统一）：

```json
{ "code": "<stable-code>", "message": "human-readable", "retryable": false }
```

- 状态码政策：400 形状级拒绝（请求体/清单形状不合法）；401 鉴权；404 路由/岗位缺失；405 方法不允许；422 语义级拒绝（工作区不合法、未开工作区、org apply 被拒）；503 引擎不可用/能力缺失；500 内部错误。
- 凭据边界：模型密钥等凭据只经 env 注入引擎子进程，不进 argv、日志、renderer、IPC。

## 2. 端点定义（8 个，全量冻结）

### 2.1 `GET /health` — 存活探针（唯一免鉴权端点）

响应 200：

```json
{
  "status": "ok",
  "api": "v0",
  "server": { "version": "0.0.0", "pid": 12345 },
  "engine": {
    "command": "digital-employee",
    "available": false,
    "nextStep": "pinned digital-employee CLI not found (command: ...). Install it or set ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI..."
  },
  "workspace": { "open": false }
}
```

约束：`engine.available` 为对钉版 `digital-employee CLI` 的 `--version` 探针结果；不可用时必须给出可执行的 `nextStep`（"失败也有路"）。

### 2.2 `GET /workspace` — 当前工作区信息

响应 200：未打开时 `{ "open": false }`；已打开时：

```json
{
  "open": true,
  "path": "/abs/path/to/workspace",
  "business": "oss-maintainer-demo",
  "owner": "repo-owner",
  "version": { "seq": 3, "updatedAt": "2026-08-23T08:00:00.000Z" }
}
```

### 2.3 `POST /workspace/open` — 打开/切换工作区

请求：`{ "path": "/abs/dir" }`。
目录必须含合法骨架：`workspace.json`（workspace.v1alpha1）＋ `organization.v1alpha1.json`（workspace-org.v1）＋ `positions/` 目录，否则 422 `workspace_invalid`。
成功响应 200（同 2.2 已打开形状）；成功后广播一次 `org.updated`。

### 2.4 `GET /org/tree` — 组织树快照

响应 200：

```json
{
  "schemaVersion": "org-tree.v1",
  "business": "oss-maintainer-demo",
  "owner": "repo-owner",
  "updatedAt": "...",
  "positionCount": 4,
  "depth": 2,
  "tree": [
    {
      "id": "repo-owner",
      "reportTo": null,
      "budget": { "perTask": { "tokens": 40000 }, "perDay": { "iterations": 96 } },
      "children": []
    }
  ]
}
```

约束：响应镜像 digital-employee org-tree.v1 冻结形状；`updatedAt` 来自引擎应用态，控制面 seq 不进入树快照。预算单位仅令牌/迭代次数，无货币。未开工作区时 422 `workspace_not_open`。

### 2.5 `POST /org/apply` — 提交变更清单

请求：变更清单（change-manifest.v1）：

```json
{
  "schemaVersion": "change-manifest.v1",
  "changes": [
    { "op": "add", "position": {
        "id": "docs-writer", "name": "Docs Writer", "description": "...",
        "reportTo": "repo-owner", "mode": "read_only", "memoryScope": "/",
        "toolAllow": ["Read"], "toolDeny": [],
        "budget": { "perTask": { "tokens": 20000 }, "perDay": { "iterations": 64 } },
        "metadata": {} } },
    { "op": "move", "id": "issue-researcher", "reportTo": "docs-writer" },
    { "op": "delete", "id": "community-operator" }
  ]
}
```

语义：add=招聘（**必须携带预算声明**，REQ-006，缺预算 → 400 `manifest_invalid`）；move=改汇报线（`reportTo:null` 表示直挂 `positions/` 根）；delete=裁撤。组织/预算合法性由 digital-employee（`org apply`）裁决；客户端只做请求形状和目录操作可执行性预检。

执行序列（目录提案＋引擎应用态）：

1. 完整预检清单（重名/缺位/环/owner/`maxDepth=8`）→ 2. 直接物化 `positions/` 提案树（add 写岗位骨架和 0600 `budget.json`；move rename；delete 移入 `.digital-employee/backup/`）→ 3. spawn 钉版 `digital-employee org apply <workspace> --json` → 4. 成功：重载 `.digital-employee/org.json` 并广播 `org.updated`；失败：稳定码透传、提案树保留，不自动回滚。

应用态纪律：`.digital-employee/org.json`、`org-audit.jsonl`、`permissions.json` 只由引擎写。拒绝时三者字节级零变更。旧 staging 与 `apply-log.ndjson` 停写。

成功响应 200：

```json
{ "status": "applied", "version": { "seq": 4, "updatedAt": "..." }, "changesApplied": 3 }
```

失败响应 422（引擎拒绝/留档冲突）或 503（引擎不可用）：

```json
{
  "status": "failed",
  "code": "workspace_org_budget_missing",
  "message": "...",
  "retryable": false
}
```

错误码透传纪律：引擎稳定错误码（如 `workspace_org_budget_missing` / `workspace_org_budget_not_allocated` / `workspace_org_budget_invalid`）原样透传，客户端不重命名、不吞并。

### 2.6 `GET /positions/:id` — 岗位卡片（只读）

响应 200：

```json
{
  "schemaVersion": "position-card.v1",
  "position": {
    "id": "repo-owner", "name": "Repo Owner", "description": "...",
    "reportTo": null, "mode": "read_only",
    "contextScope": "/",
    "permissions": { "toolAllow": ["Read", "Grep", "Glob"], "toolDeny": [] },
    "budget": { "perTask": { "...": "..." }, "perDay": { "...": "..." } },
    "metadata": {}
  }
}
```

未找到 → 404 `position_missing`。

### 2.7 `GET /reports` — 上报中心数据（只读，分页）

响应 200：

```json
{
  "schemaVersion": "reports.v1",
  "streams": {
    "escalations": [],
    "audits": [ {
      "schemaVersion": "org-audit.v1",
      "at": "...",
      "actor": "digital-employee org apply",
      "bootstrapped": false,
      "changes": { "hired": [], "moved": [], "dismissed": [], "budgetUpdated": [] },
      "positionCount": 4
    } ],
    "evidence": []
  },
  "page": { "cursor": null, "hasMore": false }
}
```

D2 阶段：`audits` 读取引擎 `.digital-employee/org-audit.jsonl`（org-audit.v1，最新在前，最多 200 条）；`escalations` 与 `evidence` 仍为空数组占位。

### 2.8 `GET /events` — SSE 事件流

响应 200，`Content-Type: text/event-stream`。帧格式：

```
id: 4
event: org.updated
data: {"seq":4,"type":"org.updated","at":"...","payload":{...}}
```

事件词汇（v0 冻结）：`org.updated` / `turn.started` / `turn.completed` / `escalation.created` / `evidence.created`。D0 实现 `org.updated`（工作区打开与 org apply 发布时触发），其余在 D3/D4 接引擎后点亮，事件体形状已冻结。

重连补拉：客户端带 `Last-Event-ID: <seq>` 重连，服务端从环形缓冲（≥256 条）回放该版本戳之后的事件；新连接不回放历史。心跳：每 15 秒注释帧 `: ping`。

## 3. 稳定错误码登记表

控制面自产码（本契约定义）：`unauthorized`、`body_invalid`、`workspace_invalid`、`workspace_not_open`、`manifest_invalid`、`organization_invalid`、`engine_unavailable`（retryable=true）、`engine_capability_missing`、`engine_failed`、`position_missing`、`not_found`、`method_not_allowed`、`internal`；提案预检码：`org_apply_position_exists`、`org_apply_position_missing`、`org_apply_cycle`、`org_apply_owner_delete`、`org_apply_max_depth`、`org_apply_destination_exists`。
引擎透传码：以 digital-employee 稳定码为准（`workspace_org_*` 等），原样透传，不在本表重定义。

## 4. 安全基线（随契约冻结）

1. renderer：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；preload 白名单逐方法枚举（D0 为 6 个方法），无通用通道。
2. 网络面：仅 127.0.0.1＋每启动随机 token；严格 CSP（`default-src 'self'`），无第三方 CDN，无远程代码加载。
3. 最小权限：壳只触达工作区目录与本地回环；组织文件权限对齐 #157 纪律（0600）。
4. 凭据边界：密钥只经 env 注入引擎子进程；boot-token 只经父子进程 stdout 管道，不进文件/日志。
5. 更新与分发：v1 不做静默自动更新；macOS 公证列 D4 后。

## 5. 与上游契约的映射

| 本契约对象 | 单一来源 |
|---|---|
| `organization` / 岗位字段 / 汇报线 | digital-employee workspace-org.v1（apps/cli/workspace/templates.ts RenderedOrganization） |
| 岗位预算声明 | #157 R3（DEC-DE-157-002）＋ V1 预算设计（perTask/perDay，令牌/迭代次数） |
| 变更清单 add/move/delete 语义 | #157 REQ-005（目录驱动 apply）；校验闸门在引擎 |
| 引擎稳定错误码 | digital-employee fail-closed 码惯例（`workspace_*`） |
| `turn.*` / `escalation.created` / `evidence.created` | 引擎 S1 回合契约（#165）＋ #157 REQ-007 升级接缝（D3/D4 点亮） |
