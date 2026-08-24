# Changelog

本仓库采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。
版本号在首个正式 release 前以里程碑（D0/D1/D2…）标注。

## [Unreleased] — D1 组织树只读

PR #3（feat(d1): 组织树只读），合并提交 e27a45a。

### Added

- **`packages/ui` 组件包**：OrgTree / OrgTreeNode / PositionCard / BudgetBar 四组件，消费 design-system 语义 token；OrgTree 支持键盘树导航（↑↓ 移动、←→ 折叠展开）。
- **React/Vite 渲染层**：桌面壳 renderer 重写为 AppShell 四区布局（Sidebar 288px / 主区 / 岗位卡片 / 预算条），SSE `org.updated` 驱动自动刷新。
- **冻结契约类型**：`packages/shared/src/org-tree.ts` 提供 org-tree.v1 类型与运行时守卫。
- **workspace-state**：服务端工作区状态管理，`/org/tree` 返回冻结形状快照。
- 测试：ui 14 用例（vitest）+ server 侧 workspace/apply 断言扩展。

### Changed

- 桌面壳 IPC 白名单新增渲染层所需通道（preload）。
- README：状态更新为 "D0 骨架 + D1 组织树只读"，补充 design-system 开发期 `file:` 链接说明（同级克隆 + `npm run build:package`）。

### Removed

- 旧原生 renderer（app.js / index.html / style.css）。

### Known Issues（D0 验收遗留，见 issue #1 评论 5387072310）

- DEF-1：`main.js` loadFile 指向 `../../dist/renderer`，与 vite outDir（`apps/desktop/dist/renderer`）不一致，构建产物开箱加载失败。
- DEF-2：App.tsx 以 `statusRes.body` 取 health，与 IPC 实际返回形状（`{running, port, health}`）不符，顶栏恒显"引擎离线"。
- DEF-3：SSE 状态横幅停留在"连接中"，sse-status IPC 未被广播。

### Verification

- `npm run check` 全绿（ui 14/14、server 8/8）。
- macOS 桌面壳实测：组织树渲染、岗位卡片、SSE 刷新、关窗进程退出全部通过（issue #4 验收，证据见 issue #1/#2 评论）。

## [D0] — 骨架

提交 0db36fe（feat(d0): org-workbench skeleton）。

### Added

- 壳-服务分离：Electron main 拉起 `apps/server`（Node，仅 127.0.0.1，每启动随机 boot-token）；控制面可脱离壳独立运行。
- 引擎消费：spawn 钉版 `digital-employee` CLI（ADR-0002）；`/health` 报告引擎可用性与下一步。
- `org apply`：staging 暂存 → 引擎校验 → rename 原子发布；失败留档 `rejected/`，裁撤归档 `archive/`，全程不硬删除（ADR-0003）。
- API 契约 v0 冻结：`docs/api-contract-v0.md`（8 端点全量；新增走增量，破坏性变更升 v1）。
