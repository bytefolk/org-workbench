# org-workbench

**文件树即组织架构。** 加目录 = 招聘（必配预算），移动目录 = 改汇报线，删除 = 裁撤（留痕归档）。

org-workbench 是 [digital-employee](https://github.com/bytefolk/digital-employee) 工作区的组织工作台：Electron 桌面壳 + 本地控制面服务，围绕组织树提供只读视图、目录提案、引擎校验与上报中心。macOS 首版聚焦组织树完整闭环；web/移动端未来同仓复用同一控制面与契约。

## 当前状态：D2 组织操作 + D3 本地对话 + D4 本地上报（开发预览）

- 壳-服务分离：Electron main 拉起 `apps/server`（Node，仅 127.0.0.1，每启动随机 boot-token）；控制面可脱离壳独立运行。
- 引擎消费：spawn 钉版 `digital-employee` CLI（ADR-0002）；`/health` 分开报告 CLI 可用性与 Qoder/Claude Code 的非敏感本地预检状态，不把 CLI 可达冒充 Host 已配置。
- `org apply`：客户端直接物化 `positions/` 提案树，再运行 `digital-employee org apply <workspace> --json`；成功后重载引擎应用态，失败保留提案供修正。裁撤目录移至树外 `.digital-employee/backup/`，应用态由引擎原子维护（ADR-0005）。
- D2 工作台：拖拽岗位生成可审计 move 提案；招聘弹窗要求明确的 per-task/per-day token 预算；裁撤必须二次确认并移入 `.digital-employee/backup/`；恢复区支持显式、幂等的一键恢复与冲突提示。所有变更仍走枚举 IPC → 本地控制面 → `org apply`，renderer 不写工作区文件。
- D4 上报中心：只读聚合引擎 `.digital-employee/org-audit.jsonl` 与工作台本地 `turn-record.v1`，展示组织审计、脱敏回合证据、失败/不确定升级链和已记录预算用量；不推断不存在的委派、长期记忆或指标，原始输入/输出默认不进入报告响应。
- API 契约 v0 已冻结并以加法扩展：见 [`docs/api-contract-v0.md`](docs/api-contract-v0.md)（D0 端点 + D3 `/turns`；破坏性变更升 v1）。
- D1/D2 组织树：`packages/ui` 四组件（OrgTree/OrgTreeNode/PositionCard/BudgetBar，消费 design-system 语义 token）+ React/Vite 渲染层（AppShell 四区、键盘树导航、拖拽提案、SSE 驱动刷新）。
- D3 本地对话闭环：Bearer 保护的 `POST /turns` 与 `GET /turns?positionId=...`，只允许 Qoder/Claude Code；工作台可从组织树或 `@岗位` 选择器加载本地历史、发送并 readback，展示密封信封 digest 与可信终态。退出码 1 不自动重试；委派链、长期 Context 与 live Host 验证仍明确标为未完成。
- 显式 Workbench session：每个岗位可新建、选择和轮换 `workbench-session.v1`；轮换产生新的稳定 sessionId 和空白本地回合目录，旧 session 保持只读可查询。它只是本地控制面边界，不是 Host resume、授权或长期记忆。
- Context 导出接缝：显式 session 的可信 `completed` 回合在终态记录落盘后异步导出为两条 `context-occurrence.v1`；导出状态可跨重启恢复，失败不改变回合结果、也不重跑 Host。当前钉定 provider 为 [`context@f63f57f`](https://github.com/bytefolk/context/commit/f63f57f7b4cb7071309561f0383683017ae79eb2)，只走公共 CLI/stdio adapter，不直连 vault SQLite。
- 里程碑：D0 骨架 → D1 组织树只读 → D2 拖拽/预算/裁撤恢复闭环 → D3 @岗位对话 → D4 本地上报中心。委派链、长期 Context 与 Qoder/Claude Code live E4 仍不在“已验证”范围。
- 当前仓库尚无 tag、Release 或签名安装包；快速开始面向源码开发者，不代表已发布客户端。

## 快速开始

```bash
# 前置：design-system 仓须与本仓同级克隆（开发期 file: 链接，见下方说明）
git clone https://github.com/bytefolk/design-system.git ../design-system

npm install          # 根目录（npm workspaces；Electron 二进制仅在 macOS/桌面环境下载）
npm run check        # 全量门禁：tsc -b + ui 类型检查 + vitest + server node --test + renderer 构建
```

**壳-服务分离实证（控制面独立运行）**：

```bash
npm run dev:server
# stdout 打印：org-workbench-server ready {"port":N,"api":"v0","token":"..."}
curl -s http://127.0.0.1:N/health                                   # 免 token 探活
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:N/workspace
curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -d '{"path":"examples/oss-maintainer"}' http://127.0.0.1:N/workspace/open
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:N/org/tree
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:N/org/backups
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:N/reports

# D3：启动服务/桌面壳前按 Host 设置一个凭据；请求体不接受 token/key
# export QODER_PERSONAL_ACCESS_TOKEN='<redacted>'
# export ANTHROPIC_API_KEY='<redacted>'
curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -d '{"positionId":"repo-owner","input":"Summarize the open issues.","engine":"qoder"}' \
     http://127.0.0.1:N/turns
curl -s -H "Authorization: Bearer <token>" \
     'http://127.0.0.1:N/turns?positionId=repo-owner'

# 显式 session：先创建，再在 session 内执行；轮换不会复制历史
curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -d '{"positionId":"repo-owner"}' http://127.0.0.1:N/sessions
curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -d '{"input":"Start from a clean session.","engine":"qoder"}' \
     http://127.0.0.1:N/sessions/<sessionId>/turns
curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -d '{}' http://127.0.0.1:N/sessions/<sessionId>/rotate

# 可选 Context provider：operator 需先在 Workbench 之外建立精确 scope grant。
# Workbench server 只持有 runtime token；不接受 renderer/HTTP/turn-record 传 token。
export ORG_WORKBENCH_CONTEXT_CLI='node ../context/packages/cli/dist/index.js'
export CONTEXT_VAULT='<server-local-vault-path>'
export CONTEXT_RUNTIME_TOKEN='<redacted-runtime-token>'
```

**桌面壳**（需 `npm install` 安装 Electron 后）：`npm run dev:desktop`（自动构建 renderer 再启动）。打开工作区后，可在左侧组织树拖拽调岗、从“招聘岗位”声明预算并新增岗位、在岗位详情确认裁撤、从恢复区显式恢复；选择岗位后先新建/选择本地会话，再发送回合；“轮换当前会话”显式创建空白 successor，旧会话可切回只读查看。切换顶部“上报中心”查看本地证据。恢复和会话轮换都不会自动发生。

**design-system 依赖说明**：`@fullstack-ai-infra/ui` 目前以开发期 `file:` 链接指向同级 `design-system` 克隆（骨架定稿方案 A：开发期 file: 链接，CI/正式包只认钉版）。链接要求该克隆已 `npm run build:package`（产出 dist，含 `--ui-sidebar-wide` 等 tokens）；设计系统发布 npm 后改钉版依赖。

**引擎指针**：开发期以 `ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI` 指向钉版入口，例如
`node <repo>/digital-employee/dist/apps/cli/bin.js`。`digital-employee` 当前 main 已提供 `org apply`，但尚未进入公开 v0.4.0 制品；控制面会按实际 CLI 能力返回成功或 `engine_capability_missing`（503），不会把 main 预览冒充已发布能力。

## 仓库结构

```
apps/desktop/        Electron 壳：main + preload 白名单桥 + renderer（D0 零依赖渲染）
apps/server/         本地控制面服务（零第三方运行时依赖，纯 node: 内建）
packages/shared/     契约类型镜像：org-tree.v1 / reports.v1 / turn-envelope.v1 / turn-record.v1 / 错误码 / SSE 事件
packages/ui/         组织树组件族（D1 起消费 design-system；React）
docs/                API 契约 v0（冻结）+ ADR
examples/            oss-maintainer 示例工作区（1 owner + 3 岗位，含预算声明）
```

## 安全基线（随契约冻结）

- 控制面仅绑 127.0.0.1 + 每启动随机 token；除 `/health` 外无 token 一律 401。
- renderer：contextIsolation 开、nodeIntegration 关、sandbox 开；preload 仅暴露枚举式工作区/组织/岗位/回合方法与事件订阅，无通用请求通道；CSP 全 `'self'`，无第三方 CDN、无远程代码。
- 凭据边界：密钥只经 env 注入引擎子进程；boot-token 只经父子进程 stdout 管道，不进文件/日志。
- Context authority：导出子进程环境仅允许 `CONTEXT_VAULT` 与 `CONTEXT_RUNTIME_TOKEN` 及最小系统变量；operator token、Host 凭据和 boot-token 不透传。renderer/preload/IPC 无 Context token 或通用 adapter 能力。

## 契约镜像纪律

`packages/shared` 逐字段镜像 digital-employee 契约（单一来源），客户端不自造语义；冲突时以 digital-employee 契约为准（产品提请、技术执行）。变更清单与错误码透传规则见契约文档第 2.5/3 节。

## 开发纪律

clean-room（ADR-0004）：代码全原创，竞品仅借形态不搬代码。PR 带追溯表：验收项 ↔ 实现 ↔ 测试证据。里程碑推进以验收清单为准，不以功能罗列为准。

## 许可

Apache-2.0（见 [LICENSE](LICENSE)）。
