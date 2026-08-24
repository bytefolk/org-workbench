# Changelog

本仓库采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。
版本号在首个正式 release 前以里程碑（D0/D1/D2…）标注。

## [Unreleased] — D2 组织操作 + D3 对话控制面 + D4 本地上报

含 PR #3（feat(d1): 组织树只读）与 PR #7（fix(examples)）。

### Added

- **D2 目录提案编排**：招聘直接生成嵌套岗位包与 0600 原子写 `budget.json`，调岗整目录 rename，裁撤移至树外 `.digital-employee/backup/<id>-<stamp>/`；支持移至根和 `maxDepth=8` 防御上限。
- **引擎 org-audit 报告流**：`GET /reports` 改读 `.digital-employee/org-audit.jsonl`（org-audit.v1）。
- **真实引擎契约测试**：覆盖 workspace 参数、严格 status/payload 解析、拒绝时应用态字节零变更与提案保留。

- **`packages/ui` 组件包**：OrgTree / OrgTreeNode / PositionCard / BudgetBar 四组件，消费 design-system 语义 token；OrgTree 支持键盘树导航（↑↓ 移动、←→ 折叠展开）。
- **React/Vite 渲染层**：桌面壳 renderer 重写为 AppShell 四区布局（Sidebar 288px / 主区 / 岗位卡片 / 预算条），SSE `org.updated` 驱动自动刷新。
- **冻结契约类型**：`packages/shared/src/org-tree.ts` 提供 org-tree.v1 类型与运行时守卫。
- **workspace-state**：服务端工作区状态管理，`/org/tree` 返回冻结形状快照。
- 测试：ui 14 用例（vitest）+ server 侧 workspace/apply 断言扩展。
- D3 `POST /turns` / `GET /turns?positionId=...` 控制面，只允许 Qoder 与 Claude Code；密封 `turn-envelope.v1`、严格 `engine.v1` NDJSON、turn SSE 与退出码 1 不自动重试。
- 工作区本地 `turn-record.v1` / `turn-history.v1`：0600 原子文件、0700 目录、崩溃遗留 running 回合恢复为 indeterminate，拒绝符号链接与无界历史。
- D3 `@岗位` 对话面板：组织树与岗位选择器联动，本地历史加载、回合发送与服务端 readback、Host idle 禁用、API 失败保留输入、信封 digest 展示；委派链与长期 Context 继续诚实标记为 Planned。
- `/health` 增加 Qoder/Claude Code 各自的 `configured` / `ready` / `nextStep` 本地预检，仅返回布尔值和非敏感操作提示；renderer 不读取凭据，也不从 CLI 可达性推断 Host ready。
- D2 工作台交互：组织树拖拽只生成 move 清单；招聘弹窗强制声明 token 预算；裁撤二次确认；`.digital-employee/backup` 恢复区支持显式幂等恢复和冲突保护。
- D4 上报中心：从真实 org-audit 和本地 turn record 派生脱敏证据、失败/不确定升级链及已记录预算用量；空状态与损坏数据均 fail closed，不显示原始输入/输出。
- 枚举式 `orgBackups` / `orgRestore` / `reports` IPC 与恢复 ID 边界验证；renderer 仍无通用请求或文件写能力。

### Changed

- `DigitalEmployeeCliDriver` 调用翻转为 `digital-employee org apply <workspace> --json`；成功后控制面从 `.digital-employee/org.json` 重载应用态，`org.updated.updatedAt` 与引擎时间戳对齐。
- oss-maintainer 示例改为目录表达汇报线的嵌套布局，并为每个岗位增加 `budget.json`。
- 桌面壳 IPC 白名单新增渲染层所需通道（preload）。
- 桌面壳新增枚举式 `createTurn` / `turnHistory` IPC；没有通用 HTTP/IPC 请求入口，boot token 继续只留在 main process。
- README：状态更新为 "D0 骨架 + D1 组织树只读"，补充 design-system 开发期 `file:` 链接说明（同级克隆 + `npm run build:package`）。

### Removed

- 旧 staging/rejected/applied 发布机制、客户端 `apply-log.ndjson` 写入和 `archive/` 裁撤路径。
- 旧原生 renderer（app.js / index.html / style.css）。

### Fixed

- D3 turn control plane now preserves split UTF-8 output, accepts the upstream 1,048,576-character model boundary, reaps timed-out engine processes without late SSE, and safely preserves allowlisted spawn error codes.
- Active turns are no longer recovered as interrupted; trusted terminal SSE is emitted only after the final turn record is durably persisted, and position IDs mirror the engine organization contract.
- Persisted turn recovery now rejects unsafe or filename-mismatched turn IDs before path construction, and D2/shared/server/Desktop consume one position-ID validator (`7x` valid; repeated or trailing hyphens invalid).
- 桌面壳从 Vite 的实际输出目录加载 renderer，干净构建不再依赖被忽略的旧产物。
- renderer 按 IPC 的真实响应结构读取引擎健康状态，不再把可用引擎恒显为离线。
- renderer 可读取当前 SSE 连接状态，避免窗口加载晚于连接事件时一直显示“事件流重连中”。
- Electron 从 33 升级到 43.4.1，清除当前依赖审计中的高危漏洞；新增 Linux/macOS 双平台源码门禁。
- oss-maintainer 示例工作区：去除机器专属的 `localReference`，改用可移植占位路径；真实绝对绑定由引擎 apply 时重算。

### Verification

- 本地 `npm run check` 全绿（ui 15/15、server 43/43、renderer 13/13、desktop-main 4/4，依赖审计 0 漏洞）；Ubuntu/macOS required checks 以 PR CI 为准。
- 真实本地引擎 E2E：digital-employee `7a92690` 成功招聘后 `/org/tree` 重载 5 岗位；非法预算拒绝码透传，`org.json`/`org-audit.jsonl`/`permissions.json` 前后 SHA-256 一致，提案和 0600 `budget.json` 保留。
- macOS 桌面壳实测：组织树渲染、岗位卡片、SSE 刷新、关窗进程退出全部通过（issue #4 验收，证据见 issue #1/#2 评论）。
- D3 后端以 fixture CLI 和 HTTP 集成测试验证；renderer 以 IPC fixture 验证“打开工作区 → 选岗位 → 加载本地历史 → 发送 → readback”、idle 禁用和 API failure。Qoder/Claude Code live Host 未在本机执行；委派与 mem recall 不在本切片范围。

## [D0] — 骨架

提交 0db36fe（feat(d0): org-workbench skeleton）。

### Added

- 壳-服务分离：Electron main 拉起 `apps/server`（Node，仅 127.0.0.1，每启动随机 boot-token）；控制面可脱离壳独立运行。
- 引擎消费：spawn 钉版 `digital-employee` CLI（ADR-0002）；`/health` 报告引擎可用性与下一步。
- `org apply`：staging 暂存 → 引擎校验 → rename 原子发布；失败留档 `rejected/`，裁撤归档 `archive/`，全程不硬删除（ADR-0003）。
- API 契约 v0 冻结：`docs/api-contract-v0.md`（8 端点全量；新增走增量，破坏性变更升 v1）。
