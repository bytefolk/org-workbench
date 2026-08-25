# org-workbench 控制面 API 契约 v0（冻结）

状态：**v0 冻结**（D0，2026-08-23）｜ 维护：客户端开发负责人 ｜ 仲裁：产品 P9 提请、技术侧执行
契约单一来源声明：组织语义以 digital-employee #157 R3（DEC-DE-157-002）为准；执行语义以引擎 #165 为准。本契约与上游冲突时，以 digital-employee 契约为准，客户端跟随。

## 0. 冻结规则

1. v0 冻结后，新增端点走 v0 增量：只增不改，不改既有端点语义、不改既有错误码含义、不改既有响应字段含义。
2. 破坏性变更升 v1，并双轨过渡（v0/v1 并行至少一个里程碑）。
3. `/org/apply` 的变更清单形状与引擎错误码以 #157 契约为准，契约变更时客户端跟随，不自造语义。
4. 本文件与实现逐端点一致，由 `apps/server/test/contract.test.ts` 持续核对。
5. D3 `/turns` 为 v0 加法修订，代码切片已按 org-workbench #5 与 digital-employee #158 的边界实现；其外部 Issue 决策评论在发布前仍须完成登记，不以本地实现替代产品批准。

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

## 2. 端点定义（v0 路径冻结、后续能力只做加法）

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
  "hosts": {
    "qoder": { "configured": false, "ready": false, "nextStep": "设置 QODER_PERSONAL_ACCESS_TOKEN 后重启工作台" },
    "claude-code": { "configured": false, "ready": false, "nextStep": "设置 ANTHROPIC_API_KEY 后重启工作台" }
  },
  "workspace": { "open": false }
}
```

约束：`engine.available` 为对钉版 `digital-employee CLI` 的 `--version` 探针结果；不可用时必须给出可执行的 `nextStep`（"失败也有路"）。`hosts.<engine>.configured` 只表示对应凭据环境变量存在且非空，`ready` 是“CLI 可达且凭据已配置”的本地执行前置状态，不代表凭据已被远端接受；响应只含布尔值与非敏感 `nextStep`，绝不返回凭据值。客户端必须以 Host 状态控制 Qoder/Claude Code 选择和发送，不得以 `engine.available` 代替 Host ready。

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
    { "op": "delete", "id": "community-operator" },
    { "op": "reorder", "parentId": "repo-owner", "order": ["release-engineer", "community-operator", "issue-researcher"] }
  ]
}
```

语义：add=招聘（**必须携带预算声明**，REQ-006，缺预算 → 400 `manifest_invalid`）；move=改汇报线（`reportTo:null` 表示直挂 `positions/` 根）；delete=裁撤；reorder=同级兄弟顺序调整（#32 加法，`parentId:null` 表示 `positions/` 根，`order` 必须恰好等于该父级当前全部子岗位集合）。组织/预算合法性由 digital-employee（`org apply`）裁决；客户端只做请求形状和目录操作可执行性预检。

reorder 语义补充（#32）：兄弟顺序是 org-workbench 自治语义，不属于引擎组织契约。顺序持久化在控制面自有的 `.digital-employee/org-layout.v1.json` 覆盖层（原子 tmp+rename，0600），引擎与 qoder sync 永不触碰该文件。纯 reorder 清单不调用引擎、不改 `.digital-employee/org.json`；集合校验失败 → 422 `org_reorder_set_mismatch`。reorder 可与结构操作混排，结构部分仍走引擎原子应用，成功后再落覆盖层。每次成功的 reorder/move 调整保存单步 undo 条目；add/delete 会清空该条目（结构恢复走 2.6 裁撤恢复区）。

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

### 2.6 `GET /org/backups` / `POST /org/restore` — 裁撤恢复区

`GET /org/backups` 返回树外 `.digital-employee/backup` 中、可由 `org-audit.v1` 裁撤记录追溯的岗位包：

```json
{ "schemaVersion": "org-backups.v1", "backups": [
  { "backupId": "community-operator-1756000000000-abcdef", "positionId": "community-operator", "dismissedAt": "...", "reportTo": "repo-owner", "name": "Community Operator" }
] }
```

`POST /org/restore` 仅接受 `{ "backupId": "..." }`。控制面将备份恢复到原汇报位置形成目录提案，再调用同一个 `digital-employee org apply <workspace> --json` 边界；renderer 不直接移动文件。成功响应中的 `restored:false` 表示重复请求发现该岗位已经应用，因而幂等返回。目标岗位/原上级冲突返回 409 `restore_conflict`；无效或损坏备份返回 `restore_invalid` 并 fail closed。恢复必须由用户显式触发，不自动恢复。

### 2.7 `POST /org/undo` — 单步撤销最近一次拖拽调整（#32 加法）

请求体忽略（传 `{}` 即可）。撤销最近一次成功的 reorder/move 调整：若有逆向 move，则经同一 `digital-employee org apply` 边界回放，再恢复调整前的布局覆盖层；随后消费（删除）undo 条目。add/delete 不入 undo（结构恢复走 2.6 裁撤恢复区），故被 add/delete 清空条目后本端点无可撤销内容。

成功响应 200：

```json
{ "status": "undone", "version": { "seq": 6, "updatedAt": "..." } }
```

无可撤销条目 → 404 `not_found`；引擎拒绝逆向回放 → 422（失败体同 2.5），undo 条目保留可重试。成功后广播 `org.updated`（payload.changes 为 `[{ "op": "undo" }]`）。

### 2.8 `GET /positions/:id` — 岗位卡片（只读）

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

### 2.9 `GET /reports` — 上报中心数据（只读，分页）

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
    "evidence": [ {
      "schemaVersion": "turn-evidence.v1", "positionId": "repo-owner",
      "turnId": "...", "conversationId": "...", "engine": "qoder",
      "status": "completed", "createdAt": "...", "updatedAt": "...",
      "envelopeDigest": "sha256:...",
      "usage": { "inputTokens": 100, "outputTokens": 50, "totalTokens": 150 }
    } ]
  },
  "budgets": [ {
    "positionId": "repo-owner", "declared": { "perTask": { "tokens": 40000 }, "perDay": { "iterations": 96 } },
    "recorded": { "inputTokens": 100, "outputTokens": 50, "totalTokens": 150 },
    "latestTurn": { "inputTokens": 100, "outputTokens": 50, "totalTokens": 150 }, "state": "within"
  } ],
  "page": { "cursor": null, "hasMore": false }
}
```

D4 首版：`audits` 以 no-follow、有界读取引擎 `.digital-employee/org-audit.jsonl`（最新在前，最多 200 条），并逐字段投影 allowlist，源文件额外字段不进入响应；`evidence` 从已持久化 `turn-record.v1` 只摘录标识、状态、digest、稳定错误码和精确 usage，不返回 input/output/message；`escalations` 仅映射真实 failed/indeterminate 回合和当前应用态可验证的汇报链；`budgets` 比较最近回合的 token usage 与声明的 per-task token 上限，不预测未来用量。当前没有 per-day 时间桶事实，客户端单日 lane 明确显示用量不可用，不复用 per-task 比例。任何损坏审计/回合数据使整个端点以 500 `reports_data_invalid` fail closed。

### 2.10 `GET /events` — SSE 事件流

响应 200，`Content-Type: text/event-stream`。帧格式：

```
id: 4
event: org.updated
data: {"seq":4,"type":"org.updated","at":"...","payload":{...}}
```

事件词汇（v0 冻结 + D3 加法）：`org.updated` / `turn.started` / `turn.model.delta` / `turn.usage` / `turn.completed` / `turn.failed` / `turn.indeterminate` / `escalation.created` / `evidence.created`。D3 的前五类引擎事件以已严格校验的 `engine.v1` 原始事件作为 `payload`；进程级不确定结果使用控制面 `turn.indeterminate`，不会伪造 engine 终态，也不会自动重试。

### 2.11 `POST /turns` / `GET /turns` — D3 本地回合控制面

`POST /turns` 请求（只允许下列三个字段）：

```json
{ "positionId": "repo-owner", "input": "Summarize the open issues.", "engine": "qoder" }
```

- `engine` 只允许 `qoder` / `claude-code`；不接受凭据字段，凭据只从控制面进程环境的对应变量传给子进程。
- 控制面构造 `turn-envelope.v1`，其 `envelopeDigest` 与 digital-employee canonical JSON + SHA-256 算法逐字节一致。
- 唯一调用形态：`digital-employee turn run <workspace> --position <id> --stdin`；信封从 stdin 输入，凭据和用户输入均不进 argv。
- stdout 必须是严格、同 runId、以 `run.started` 开始且恰有一个末尾终态的 `engine.v1` NDJSON；UTF-8 按流解码，模型文本边界镜像上游 1,048,576 字符；未知字段、超界行、多个终态或终态后事件均产生 `indeterminate`。
- 退出码 1 记录为 `indeterminate`，绝不自动重试；仅安全透传 `engine.*` / `workspace_org_*` 稳定 spawn 码，其余保持 `turn_process_exit_1`。用户显式重试必须创建新的 turnId/attempt。
- `turn.completed` / `turn.failed` / `turn.indeterminate` 只在最终 turn record 原子持久化成功后广播；超时后冻结事件并清理子进程，不接受迟到终态。
- 响应 200 为单个 `turn-record.v1`，包含 `turnId`、`positionId`、`engine`、`status`、`envelopeDigest`、有界事件与可信终态输出/错误。

`GET /turns?positionId=<id>` 响应 200：

```json
{
  "schemaVersion": "turn-history.v1",
  "conversationId": "uuid",
  "positionId": "repo-owner",
  "turns": []
}
```

本地状态位于 `<workspace>/.digital-employee/workbench/conversations/<positionId>/`：元数据和每回合独立 JSON 均为 0600 原子写，目录为 0700；启动后读到不属于当前进程活跃集合的遗留 `running` 回合时恢复为 `indeterminate/turn_interrupted`。岗位 ID 规则逐字镜像引擎组织契约并由 D2、turn server 与 Desktop IPC 共用同一 validator。内部路径拒绝符号链接；持久化记录的 turn ID 在路径构造前必须满足上游有界 ID 约束、本地文件名安全约束且与所在文件名一致，否则整段历史 fail closed。历史记录数、总大小、输入、输出、事件与诊断全部有界。凭据与原始 stderr 不持久化。

本切片只建立 workbench 本地会话/回合连续性与未来 recall 接缝，不声称已经接入 mem recall，也不依赖 Host 原生 resume。

Electron renderer 只通过枚举式 `createTurn({positionId,input,engine})` 与 `turnHistory(positionId)` IPC 消费这两个端点；main process 持有 boot token 并代理请求，renderer 不获得 token 或通用 HTTP/IPC 能力。服务端 `turn-record.v1` / `turn-history.v1` 是持久化单一来源，renderer 只做显式展示适配，不建立第二套会话或回合存储语义。

重连补拉：客户端带 `Last-Event-ID: <seq>` 重连，服务端从环形缓冲（≥256 条）回放该版本戳之后的事件；新连接不回放历史。心跳：每 15 秒注释帧 `: ping`。

#### 2.10.1 `POST /turns/cancel` — 中断在途回合（#25 加法修订）

```json
{ "positionId": "repo-owner" }
```

- 请求只允许 `positionId` 一个字段；该岗位没有正在运行的回合时返回 404 `not_found`（不新增错误码）。
- 命中时控制面终止引擎子进程（SIGTERM，250ms 后 SIGKILL），回合经既有路径落为 `indeterminate`，诊断码 `turn_cancelled`（与 `turn_timeout` 同类的本地诊断码，不属于 `errorCodes` 稳定码表），并复用冻结的 `turn.indeterminate` SSE 词汇广播；不新增 SSE 事件类型。
- 响应 200：`{ "cancelled": true, "positionId": "<id>" }`。
- 同一 `POST /turns` 请求语义不变：被中断的回合仍以完整 `turn-record.v1`（status `indeterminate`）作为该请求的 200 响应返回。

### 2.12 `/sessions` — 显式 Workbench session（#12 R2 加法）

```text
POST /sessions                         {"positionId":"repo-owner"}
GET  /sessions?positionId=repo-owner
GET  /sessions/:sessionId
POST /sessions/:sessionId/rotate       {}
POST /sessions/:sessionId/turns        {"input":"...","engine":"qoder|claude-code"}
GET  /sessions/:sessionId/turns
```

`POST /sessions` 返回 201 `workbench-session.v1`。`workspaceInstanceId` 和 `sessionId` 是服务端生成的 opaque UUID；`principal` 固定派生为 `position.<positionId>`，客户端不能传入或覆盖。每岗位至多一个 active session；已有 active 时必须显式 rotate。

rotate 以一个 0600 position state 原子替换同时封存 source、创建 successor 和切换 activeSessionId。并发双 rotate 至多创建一个 successor：首次 201，幂等重放 200 同一 successor。运行中回合返回 409 `session_conflict`；重启遗留 running 先按既有规则恢复为 indeterminate，再允许轮换。source 的 turns 不复制到 successor，旧 session 的 GET/history 保持可读，POST turn 被拒。

持久化位于 `<workspace>/.digital-employee/workbench/sessions/`：workspace identity、每岗位有界 session state 与每 session 独立 conversation/turn 目录均拒绝 symlink/路径穿越/错 workspace/错 position/损坏或无界记录，目录 0700、文件 0600、临时文件 fsync 后 rename 并同步目录。session API/IPC 不返回绝对路径、boot token、模型凭据、mem/context service ID 或 admin capability。

这些端点不改变 legacy `/turns` 兼容行为。Workbench session 不是浏览器登录会话、Host-native resume、mem session 或授权凭据；本切片不实现 memory write/recall、Context 蒸馏或委派。

## 3. 稳定错误码登记表

控制面自产码（本契约定义）：`unauthorized`、`body_invalid`、`workspace_invalid`、`workspace_not_open`、`manifest_invalid`、`organization_invalid`、`engine_unavailable`（retryable=true）、`engine_capability_missing`、`engine_failed`、`position_missing`、`restore_invalid`、`restore_conflict`、`reports_data_invalid`、`turn_request_invalid`、`turn_engine_unsupported`、`turn_position_invalid`、`turn_storage_failed`、`session_request_invalid`、`session_missing`、`session_conflict`、`session_storage_failed`、`not_found`、`method_not_allowed`、`internal`；turn-record 内的稳定结果码包括 `turn_process_exit_1`、`turn_process_failed`、`turn_engine_unavailable`、`turn_timeout`、`turn_protocol_invalid`、`turn_driver_failure`、`turn_interrupted`；提案预检码：`org_apply_position_exists`、`org_apply_position_missing`、`org_apply_cycle`、`org_apply_owner_delete`、`org_apply_max_depth`、`org_apply_destination_exists`、`org_reorder_set_mismatch`（#32 加法）。
引擎透传码：以 digital-employee 稳定码为准（`workspace_org_*` 等），原样透传，不在本表重定义。

## 4. 安全基线（随契约冻结）

1. renderer：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；preload 白名单逐方法枚举（D0 为 6 个方法），无通用通道。
2. 网络面：仅 127.0.0.1＋每启动随机 token；严格 CSP（`default-src 'self'`），无第三方 CDN，无远程代码加载。
3. 最小权限：壳只触达工作区目录与本地回环；组织文件权限对齐 #157 纪律（0600）。
4. 凭据边界：密钥只经 env 注入引擎子进程；boot-token 只经父子进程 stdout 管道，不进文件/日志。
5. 本地回合：只持久化对话输入、严格校验后的 engine 事件与稳定结果；不持久化凭据或原始 stderr。状态路径拒绝符号链接，文件 0600、目录 0700、原子替换。
6. 本地 session：workspace/position/principal 映射由 server 拥有；sessionId 不是授权；renderer 只拿到枚举式 session 方法和公开 DTO。
7. 更新与分发：v1 不做静默自动更新；macOS 公证列 D4 后。

## 5. 与上游契约的映射

| 本契约对象 | 单一来源 |
|---|---|
| `organization` / 岗位字段 / 汇报线 | digital-employee workspace-org.v1（apps/cli/workspace/templates.ts RenderedOrganization） |
| 岗位预算声明 | #157 R3（DEC-DE-157-002）＋ V1 预算设计（perTask/perDay，令牌/迭代次数） |
| 变更清单 add/move/delete 语义 | #157 REQ-005（目录驱动 apply）；校验闸门在引擎 |
| 引擎稳定错误码 | digital-employee fail-closed 码惯例（`workspace_*`） |
| `turn.*` / `escalation.created` / `evidence.created` | 引擎 S1 回合契约（#165）＋ #157 REQ-007 升级接缝（D3/D4 点亮） |
| `workbench-session.v1` / 显式 rotate | org-workbench #12 R2；仅本地边界，下游由 digital-employee #161 消费 |
