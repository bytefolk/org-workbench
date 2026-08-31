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
- org-workbench #12 R2 显式 session：`workbench-session.v1`、create/list/get/rotate/session-turn API，server-owned principal/workspace mapping、每岗位单 active、多 session 只读历史和 zero-history-copy successor。
- Desktop 枚举式 session IPC 与岗位会话选择器：显式新建/轮换、旧 session 只读切换、session-scoped turn/readback；不暴露 boot token、绝对路径或 mem/context 能力。
- Session 持久化安全门禁：0700/0600、单文件原子 rotate、并发双 rotate 幂等、running-turn conflict、重启恢复、symlink/路径/损坏/错 workspace/无界状态 fail closed。
- org-workbench #15 R1 Context exporter：可信 session `completed` 回合落盘后异步生成两条 scoped `context-occurrence.v1`，持久 `pending|done|failed` 与跨重启幂等恢复；固定消费 `context@f63f57f` 公共 CLI/stdio adapter，失败不重跑 Host。
- Context exporter E3：真实临时 SQLite vault 通过 provider grant → ingest/distill → recall/readback 验证两条 raw occurrence，另覆盖 partial replay、wrong scope、revoked token、adapter outage、symlink/corrupt state 与 failed/indeterminate 不导出。
- #32 组织树真实拖拽：body 投放生成 move 提案，上/下四分位插入线生成同级排序（`change-manifest.v1` 新增 `reorder` op，跨级插入以 move+reorder 单清单原子提交）；投放到自身/下属 dropEffect=none 拒绝并轻提示；⌘↑/⌘↓ 同级排序、⌘←/⌘→ 调级，企业负责人拦截提示。
- #32 排序持久化：`org-layout.v1` 覆盖层（`.digital-employee/org-layout.v1.json`，0600 原子写，零迁移、引擎不触），reorder-only 清单不调引擎；快照同级顺序覆盖层优先、字母序兜底，open/reload 时自动修剪与补齐。
- #32 单步撤销：`POST /org/undo` 回放 inverseMoves 并还原覆盖层（404 `not_found` 表示无可撤销）；renderer「撤销」按钮与树聚焦时 ⌘/Ctrl+Z。
- #32 创建入口：组织树行 hover「+」与空态按钮打开招聘弹窗并预置汇报对象。
- #73 Control Plane v2：组织树连接线（guide-rail，选中即递推点亮祖先链路）、岗位状态灯（仅映射真实在途回合）、42×6px 微型预算条；对话面板改证据时间线（`.owb-tc` 控制台卡：状态圆点/状态行/证据印章 chip/内嵌审批卡），群聊仍保留气泡布局。
- #73 无边框窗口自定义标题栏：`owb:window:minimize` / `owb:window:toggle-maximize` / `owb:window:close` 三个枚举式 IPC；每个 handler 均校验 `event.senderFrame` 是 mainWindow 自身主 frame 且仍在展示打包渲染层（`window-ipc.cjs` 纯函数 + 6 条负向单测），并对 mainWindow 加 `will-navigate`/`setWindowOpenHandler` 拦截，拒绝导航到打包文件之外的任何地址与新窗口。
- `apps/desktop/test/contrast.test.cjs`：对 `--ui-foreground-subtle` 在亮/暗两套主题的全部 5 个背景阶做真实 WCAG 对比度计算断言（≥4.5:1），而非仅检查 token 字符串存在。
- #94 主题切换入口：自定义标题栏新增亮/暗切换按钮（`aria-pressed` + 目标态 `title`/`aria-label`），`theme-mode.ts` 提供唯一的 `data-theme` 写入路径与 `localStorage` 持久化，`main.tsx` 在 `createRoot()` 前种子化。未显式选择过时跟随系统 `prefers-color-scheme`（含运行时变化），首次点击即固化为显式选择并停止跟随。`antd-skin.css` 的暗色调色板与 antd `darkAlgorithm`/`ANTD_SEED.dark` 自 #73 起已完备，此前只是无人可达。

### Changed

- `DigitalEmployeeCliDriver` 调用翻转为 `digital-employee org apply <workspace> --json`；成功后控制面从 `.digital-employee/org.json` 重载应用态，`org.updated.updatedAt` 与引擎时间戳对齐。
- oss-maintainer 示例改为目录表达汇报线的嵌套布局，并为每个岗位增加 `budget.json`。
- 桌面壳 IPC 白名单新增渲染层所需通道（preload）。
- 桌面壳新增枚举式 `createTurn` / `turnHistory` IPC；没有通用 HTTP/IPC 请求入口，boot token 继续只留在 main process。
- README：状态更新为 "D0 骨架 + D1 组织树只读"，补充 design-system 开发期 `file:` 链接说明（同级克隆 + `npm run build:package`）。
- #73 token 层：暖纸画布/圆角 6·10·14·18/动效三档 120·160·240ms 统一（含 design-system 原生 duration/ease 一并收敛）；新增 Space Grotesk 展示字体 + JetBrains Mono；PositionCard 从 antd Card 改造为自定义 `owb-panel`。
- BrowserWindow `minWidth` 980→640：原值使 `@media (max-width:680px)` 断点（侧栏隐藏、单栏堆叠）在真实窗口不可达，只能靠 DevTools 视口模拟验证，现在拖窗边缘就能触发。

### Removed

- 旧 staging/rejected/applied 发布机制、客户端 `apply-log.ndjson` 写入和 `archive/` 裁撤路径。
- 旧原生 renderer（app.js / index.html / style.css）。

### Fixed

- D4 rejects symlinked/oversized org-audit sources before bounded reads, projects audit entries through an exact allowlist, and no longer reuses the latest per-task ratio as a per-day percentage when no day bucket exists.
- D3 turn control plane now preserves split UTF-8 output, accepts the upstream 1,048,576-character model boundary, reaps timed-out engine processes without late SSE, and safely preserves allowlisted spawn error codes.
- Active turns are no longer recovered as interrupted; trusted terminal SSE is emitted only after the final turn record is durably persisted, and position IDs mirror the engine organization contract.
- Persisted turn recovery now rejects unsafe or filename-mismatched turn IDs before path construction, and D2/shared/server/Desktop consume one position-ID validator (`7x` valid; repeated or trailing hyphens invalid).
- 桌面壳从 Vite 的实际输出目录加载 renderer，干净构建不再依赖被忽略的旧产物。
- renderer 按 IPC 的真实响应结构读取引擎健康状态，不再把可用引擎恒显为离线。
- renderer 可读取当前 SSE 连接状态，避免窗口加载晚于连接事件时一直显示“事件流重连中”。
- Electron 从 33 升级到 43.4.1，清除当前依赖审计中的高危漏洞；新增 Linux/macOS 双平台源码门禁。
- oss-maintainer 示例工作区：去除机器专属的 `localReference`，改用可移植占位路径；真实绝对绑定由引擎 apply 时重算。
- #73（`a47a803`，先于 PR #77 review，非本轮修复）：`antd-skin.css` 头注释里 `--ui-duration-*/--ui-ease` 中的 `*/` 提前闭合整块 light token（CSSOM 解析丢弃，仅 CDP 计算值能看出，静态检查看不出），改写措辞避开 `*/` 组合。
- PR #77 review：`--ui-foreground-subtle` 对卡面对比度只有 3.49:1/3.81:1（9-11px 文本不适用 large-text 的 3:1 门槛），调整为 `#66685f`/`#92958b`，全部背景阶 ≥4.62:1。
- PR #77 review：预算仪表 `>100%` 时宽度被夹到 100%、且 `aria-valuenow` 可超出固定的 `aria-valuemax=100`（非法 meter）——改为不夹宽度（轨道 `overflow:hidden` 移除，允许圆角端帽出界）、`aria-valuemax` 随读数动态取 `max(100, 当前值)`，保证 `valuenow <= valuemax` 恒成立。
- #86: `buildPositionSkeletonFiles` now JSON-quotes the generated SKILL.md frontmatter's `name` field (matching `description`'s existing escaping), so a purely numeric or YAML-reserved-word position ID (e.g. `1234`) no longer parses as a non-string YAML scalar and fails `org apply` with `employee_skill_name_mismatch`.
- #92: the `POST /hire` description bound now mirrors the real upstream constraint — at most 1024 **characters** (UTF-16 code units) on the trimmed value, matching digital-employee's `validateSkillFrontmatter` SKILL.md frontmatter check, which is stricter than `employee.json`'s own 2000-character bound. It previously allowed 2048 **bytes**, so a 1025-2048 character ASCII description passed every org-workbench gate, was staged to disk, and only failed at `org apply` with an opaque `employee_skill_description_required` (same defect class as #86, which fixed the sibling `name` field). The desktop IPC gate, which had no length check at all, now mirrors the same bound, and `docs/api-contract-v0.md` §2.14 documents it for the first time.
- #94: the Agent Host `Select` was narrower than its own longest option (`Claude Code · 本地登录 · Configured`), so the trigger ellipsised the selected host mid-CJK — and because `popupMatchSelectWidth` was unset, `@rc-component/select` pinned the popup to the trigger's `width` rather than its `min-width`, leaving no interaction that revealed the full text. `GroupsPanel` was the worse of the two: a *fixed* `150px` track that never widened at any window size. Both call sites now share one `EngineSelect`: the popup sizes to its content and keeps the readiness suffix, the trigger renders a compact `icon + host name` label (readiness is already stated in prose below the control and in the group engine chip), and both grid tracks get a `220px` floor. Host selection decides which engine runs the turn and which credential path `claude-local` vs `claude-code` uses, so choosing it from truncated labels was an operator-error path, not a cosmetic one.

### Verification

- 本地 `npm run check` 全绿（ui 15/15、server 46/46、renderer 13/13、desktop-main 4/4，依赖审计 0 漏洞）；Ubuntu/macOS required checks 以 PR CI 为准。
- 真实本地引擎 E2E：digital-employee `7a92690` 成功招聘后 `/org/tree` 重载 5 岗位；非法预算拒绝码透传，`org.json`/`org-audit.jsonl`/`permissions.json` 前后 SHA-256 一致，提案和 0600 `budget.json` 保留。
- macOS 桌面壳实测：组织树渲染、岗位卡片、SSE 刷新、关窗进程退出全部通过（issue #4 验收，证据见 issue #1/#2 评论）。
- D3 后端以 fixture CLI 和 HTTP 集成测试验证；renderer 以 IPC fixture 验证“打开工作区 → 选岗位 → 加载本地历史 → 发送 → readback”、idle 禁用和 API failure。Qoder/Claude Code live Host 未在本机执行；委派与 mem recall 不在本切片范围。
- Session E3 以真实临时 workspace 覆盖 create → turn → rotate → restart → old/read-only + successor/zero-turn，另覆盖双 rotate、running conflict、错误请求不触发 Host 和持久化攻击面。Memory recall/write 与 live Host E4 明确未实现/未验证。
- PR #77：`tsc -b`、`typecheck:ui`、`typecheck:renderer` 全绿；`test:ui` 31/31、`test:renderer` 97/97、`test:desktop-main` 27/27（含新增 `window-ipc.test.cjs` 6 例负向安全测试、`contrast.test.cjs` 1 例真实 WCAG 计算）；`npm audit --audit-level=high` 0 漏洞。`apps/server/*` 未改动，其测试套件本地重跑两次分别为 17 / 20 个失败（非确定性、失败数不稳定，`git diff apps/server/` 为空），系既有 test 隔离问题，非本 PR 引入，CI（干净环境）按 reviewer 记录为全绿；未在本 PR 内处理（越出 AC-005 边界）。窗口边缘拖拽缩放：CDP 视口模拟 940/680/1680 三档均验证通过，真实 WM 交互（WSLg）未验证，已在 macOS 实机验证通过（见 PR review）。
- Fix for #92: `tsc -b` and `typecheck:renderer` clean. The new regression test derives the boundary instead of restating a constant — it binary-searches the description length the live request gate actually accepts, then asserts the resulting SKILL.md frontmatter and `employee.json` both satisfy the upstream bounds; reverting the fix makes it fail with `accepted description of 2048 chars yields 2048 in SKILL.md frontmatter, over the upstream 1024 bound`, confirming it catches the original defect. `hire.test.ts` + `apply.test.ts` 17/18 pass (the 1 failure is the pre-existing `hire/move/dismiss` isolation flake). `test:desktop-main` 34/34. Full `apps/server` suite: 124/142 pass, 17 fail, 1 skipped — a `git stash` A/B against unmodified `main` produced 37 failures on the baseline run, so the flake's failure *count* is itself non-deterministic (as this file already records); the meaningful check is that the failing-test-name set under this change is a strict **subset** of the baseline set, with zero failures unique to the change. `test:renderer` 125/136 with the same 11 pre-existing duplicate-React failures; no renderer source is touched by this diff. `test:ui` / `security:check` not rerun locally — untouched trees, CI is the gate of record.
- Fix for #94: `npm run build` / `test:scripts` 4/4 / `typecheck:ui` / `test:ui` 31/31 / `typecheck:renderer` / `test:renderer` 155/155 / `test:desktop-main` 35/35 / `npm audit --audit-level=high` 0 漏洞，全部本地绿。新增 19 条 renderer 用例（`theme-mode` 9、`theme-toggle` 5、`agent-host-select` 4、`groups-panel` +1）与 1 条 `agent-host-width.test.cjs`。宽度门禁做过反向验证：把两条 grid track 改回 `150px` 并重新构建，断言以 `Agent Host track floor is 150px, below the 200px the compact label needs` 失败，确认它真的能捕获原缺陷。`apps/server` 未改动，其套件本地 124/142 pass、17 fail、1 skipped——与 `git stash` 后干净 `main` 的失败用例名集合**完全相同**（0 条为本次变更独有），系本文件上文已记录的既有 test 隔离 flake。桌面壳双主题的真实观感（WSLg 实机）本轮**未**由我执行，仅有 jsdom 层的属性/可访问性断言与既有 `contrast.test.cjs` 覆盖；实机确认留给 review。
- Fix for #86: `tsc -b` clean; new `buildPositionSkeletonFiles` regression test (numeric position ID stays quoted in SKILL.md) passes. `node --test apps/server/dist/test/*.test.js` locally: 112/130 pass, 17 fail, 1 skipped — the 17 failures reproduce identically against unmodified `main` (verified via a `git stash`/rebuild A/B check isolating this change), matching the pre-existing, already-documented test-isolation flake noted in the PR #77 verification entry above (not introduced by this change; CI clean-environment runs are the gate of record). Renderer/desktop suites are untouched by this diff and were not rerun locally.

## [D0] — 骨架

提交 0db36fe（feat(d0): org-workbench skeleton）。

### Added

- 壳-服务分离：Electron main 拉起 `apps/server`（Node，仅 127.0.0.1，每启动随机 boot-token）；控制面可脱离壳独立运行。
- 引擎消费：spawn 钉版 `digital-employee` CLI（ADR-0002）；`/health` 报告引擎可用性与下一步。
- `org apply`：staging 暂存 → 引擎校验 → rename 原子发布；失败留档 `rejected/`，裁撤归档 `archive/`，全程不硬删除（ADR-0003）。
- API 契约 v0 冻结：`docs/api-contract-v0.md`（8 端点全量；新增走增量，破坏性变更升 v1）。
