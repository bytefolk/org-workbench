# org-workbench

**文件树即组织架构。** 加目录 = 招聘（必配预算），移动目录 = 改汇报线，删除 = 裁撤（留痕归档）。

org-workbench 是 [digital-employee](https://github.com/bytefolk/digital-employee) 工作区的组织工作台：Electron 桌面壳 + 本地控制面服务，围绕组织树提供只读视图、目录提案、引擎校验与上报中心。macOS 首版聚焦组织树完整闭环；web/移动端未来同仓复用同一控制面与契约。

## 当前状态：D2 组织操作 + D3 本地对话 + D4 本地上报（开发预览）

- 壳-服务分离：Electron main 拉起 `apps/server`（Node，仅 127.0.0.1，每启动随机 boot-token）；控制面可脱离壳独立运行。
- 引擎消费：服务端 spawn 钉版 `digital-employee` CLI，桌面壳默认使用仓内 `qoder-engine` adapter（ADR-0002）；`/health` 分开报告引擎可用性与 Qoder/Claude Code 的非敏感本地预检状态。bundled Qoder 只检查本地 1.1.x CLI 前置，不把它冒充远端账号/权限已通过。
- `org apply`：客户端直接物化 `positions/` 提案树，再运行 `digital-employee org apply <workspace> --json`；成功后重载引擎应用态，失败保留提案供修正。裁撤目录移至树外 `.digital-employee/backup/`，应用态由引擎原子维护（ADR-0005）。
- D2 工作台：拖拽岗位生成可审计 move 提案；招聘弹窗要求明确的 per-task/per-day token 预算；裁撤必须二次确认并移入 `.digital-employee/backup/`；恢复区支持显式、幂等的一键恢复与冲突提示。所有变更仍走枚举 IPC → 本地控制面 → `org apply`，renderer 不写工作区文件。
- D4 上报中心：只读聚合引擎 `.digital-employee/org-audit.jsonl` 与工作台本地 `turn-record.v1`，展示组织审计、脱敏回合证据、失败/不确定升级链和已记录预算用量；不推断不存在的委派、长期记忆或指标，原始输入/输出默认不进入报告响应。
- API 契约 v0 已冻结并以加法扩展：见 [`docs/api-contract-v0.md`](docs/api-contract-v0.md)（D0 端点 + D3 `/turns`；破坏性变更升 v1）。
- D1/D2 组织树：`packages/ui` 四组件（OrgTree/OrgTreeNode/PositionCard/BudgetBar，消费 design-system 语义 token）+ React/Vite 渲染层（AppShell 四区、键盘树导航、拖拽提案、SSE 驱动刷新）。
- D3 本地对话闭环：Bearer 保护的 `POST /turns` 与 `GET /turns?positionId=...`，只允许 Qoder/Claude Code；工作台可从组织树或 `@岗位` 选择器加载本地历史、发送并 readback，展示密封信封 digest 与可信终态。退出码 1 不自动重试；bundled Qoder 已完成一次 macOS 本地 E4（发送 → `completed` 落盘 → 历史 readback），Claude live、委派链与长期 Context 仍明确标为未完成。
- 显式 Workbench session：每个岗位可新建、选择和轮换 `workbench-session.v1`；轮换产生新的稳定 sessionId 和空白本地回合目录，旧 session 保持只读可查询。它只是本地控制面边界，不是 Host resume、授权或长期记忆。
- Context 导出接缝：显式 session 的可信 `completed` 回合在终态记录落盘后异步导出为两条 `context-occurrence.v1`；导出状态可跨重启恢复，失败不改变回合结果、也不重跑 Host。当前钉定 provider 为 [`context@f63f57f`](https://github.com/bytefolk/context/commit/f63f57f7b4cb7071309561f0383683017ae79eb2)，只走公共 CLI/stdio adapter，不直连 vault SQLite。
- 里程碑：D0 骨架 → D1 组织树只读 → D2 拖拽/预算/裁撤恢复闭环 → D3 @岗位对话 → D4 本地上报中心。Qoder 的 bundled adapter 已有单机 E4 证据；委派链、长期 Context 与 Claude live E4 仍不在“已验证”范围。
- #110 Lane A 已提供 macOS arm64 与 Windows x64 的**未签名、解包 staging**基础和 clean-staging smoke 编排；它只用于原生验证，不是可安装或已发布客户端。当前仓库仍无 tag、GitHub Release、签名安装包或应用内更新。

## 快速开始

```bash
# 前置：design-system 仓须与本仓同级克隆（开发期 file: 链接，见下方说明）
git clone https://github.com/bytefolk/design-system.git ../design-system

npm install          # 根目录（npm workspaces；Electron 二进制仅在 macOS/桌面环境下载）
npm run check        # 全量门禁：tsc -b + ui 类型检查 + vitest + server node --test + renderer 构建
```

`npm run test:renderer` 通过仓库内 wrapper 仅为 Vitest 进程及其 workers 禁用 Node 的实验性全局 Web Storage，确保 Node 24/26 都使用 jsdom 自己的 `localStorage`。该设置不进入 Electron，也不改变产品主题持久化。

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

# D3：普通 digital-employee Qoder Host 仍需要 service token；请求体不接受 token/key
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

桌面壳默认的 bundled `qoder-engine` 与 `/health` 共用同一个无 shell 的本机 Qoder 解析器：非空 `ORG_WORKBENCH_QODER_BIN` 优先且无效时 fail closed；否则按 PATH 的 `qodercli` / `qoder`，再按 macOS 已支持的用户安装位置解析到可执行普通文件。当前支持窗口为 1.1.x；`/health` 只运行有超时和输出上限的 `--version`，不会读取登录态或凭据存储，也不代表远端 entitlement 可用。turn adapter 直接 spawn 同一个绝对路径并原样继承父进程 PATH。Finder/LaunchServices 启动的桌面进程会用固定 argv、有界输出和不可忽略的硬超时从登录 shell **只恢复 PATH**；输出不满足单行 marker 与绝对路径规则时保留原 PATH，其他 shell 环境和凭据一律不导入。Electron 的 `ELECTRON_RUN_AS_NODE=1` 只跨到桌面默认 bundled adapter；普通 CLI override 的 health/hire/org 使用非凭据运行时 allowlist，turn 只携所选 Host 的明确授权。bundled adapter 接收 Qoder binary 与 permission mode，并在单一校验点拒绝不受支持的 mode；真实 Qoder/MCP 后代只接收 Qoder 所需运行时、代理/证书和凭据 allowlist，不接收 Electron flag、Workbench adapter 配置、boot/internal/Context authority 或任意 secret。是否真正可执行仍以一次真实回合的可信终态为准。普通 `digital-employee` 的 Qoder model port 不走这个例外，仍由 `QODER_PERSONAL_ACCESS_TOKEN` 门禁。

### 无产品签名的 unpacked staging（#110 Lane A）

这些命令只生成并验证原生平台的解包目录；输出位于已忽略的 `release/staging/`。Lane A canonical smoke 会把应用复制到源码树外、名称含空格的临时目录，启动控制面与静态 renderer marker，再关闭应用并检查已绑定、可归因的 Workbench/控制面进程与原生隔离组归零，最后删除临时目录。它不调用 health、Host 或业务回合，也不声称能约束主动脱离该边界的恶意进程。

```bash
# 必须在 macOS arm64 原生主机运行
npm run package:staging:macos
npm run verify:package:macos
npm run smoke:package:macos

# 独立的 #111 行为资格验证；不属于 Lane A static smoke 结论
npm run smoke:package:macos:behavior

# 必须在 Windows x64 原生主机运行
npm run package:staging:windows
npm run verify:package:windows
npm run smoke:package:windows
```

`smoke:package:macos:behavior` 保留 #111 已合入的另一条边界：它使用本地确定性 Qoder/MCP fixture，验证 Finder 登录 PATH 恢复、renderer/preload、health、一次 fixture 回合及历史 readback。该模式有独立环境控制、报告 schema 和命令；它不读取外部凭据，不证明真实账号 entitlement，也不能被写成 Lane A static smoke 或发布能力。Windows 没有对应 behavior claim。

唯一打包配置是 `apps/desktop/electron-builder.config.cjs`；原 YAML 骨架已移除，避免两份配置漂移。脚本固定使用 `electron-builder@26.15.3`、原生架构参数、`--dir` 和 `--publish never`；macOS 明确不选择产品身份（主 executable 保留上游 linker ad-hoc 状态），Windows 明确 `signExecutable: false`，因此不会消费 CSC 环境去签 staging。`package:macos:unsigned` 与 `package:macos` 保持为兼容入口，并委托 canonical staging 命令。它们不生成 DMG、ZIP、NSIS 或其他安装器，不提供产品/分发签名或公证，不发布 GitHub Release，不实现自动更新，也不证明 Intel Mac 或跨平台运行结果。旧候选 E3 不自动适用于当前集成提交；以 [`docs/evidence/issue-110/lane-a/README.md`](docs/evidence/issue-110/lane-a/README.md) 记录的 exact SHA authority chain 为准。Windows x64 仍需 `windows-latest` 原生运行，不能由本机 macOS 推断。源码开发入口 `npm run dev:desktop` 保持不变。

**design-system 依赖说明**：`@fullstack-ai-infra/ui` 目前以开发期 `file:` 链接指向同级 `design-system` 克隆（骨架定稿方案 A：开发期 file: 链接，CI/正式包只认钉版）。链接要求该克隆已 `npm run build:package`（产出 dist，含 `--ui-sidebar-wide` 等 tokens）；设计系统发布 npm 后改钉版依赖。

**引擎指针**：独立服务开发期以 `ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI` 指向钉版入口，例如
`node <repo>/digital-employee/dist/apps/cli/bin.js`；桌面壳未覆盖该变量时使用仓内 `apps/server/bin/qoder-engine.mjs`。控制面会按实际 CLI 能力返回成功或 `engine_capability_missing`（503），不会把 main 预览冒充已发布能力。

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
