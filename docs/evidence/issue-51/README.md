# Issue #51 证据包 — S1 个人对话基线回归（AC-001 / AC-004 个人侧）

日期：2026-08-26 ｜ 执行：C2（session 7eca0021）｜ 分支：feat/issue-51-personal-dialog（基于 main 955b4f5，含 S2 1f5b9a6 + S3 955b4f5）

## 方法

- 全新 workspace：`/tmp/owb-51-ws4`（拷贝自 `examples/oss-maintainer`）
- 引擎桩：`digital-employee turn run <ws> --position <id> --stdin`，逐事件时间戳；校验封缄 envelopeDigest（canonical JSON sha256）；默认输入 → 3 段 `model.delta`（600ms 间隔）→ `run.completed`；输入含「审批」→ `approval.requested` + `run.failed(engine.approval_required)`；携带 `pendingApproval` → 校验裁决后 `run.completed(result=resumed)`
- 桌面端以 `ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI` 指向桩、`--remote-debugging-port=9335` 启动，CDP 驱动（`Runtime.evaluate` 原生 setter + 冒泡事件 / `Page.captureScreenshot`）
- 两阶段：phase 1 建会话→流式→审批→批准续跑；杀掉应用后用**同一 workspace** 重启，phase 2 验证召回（AC-004）

## 截图与判读

| 文件 | 内容 | 断言 |
| --- | --- | --- |
| 01-session-created | 岗位 repo-owner 选中，「当前 · 会话 1 · ffed832d」建立 | 会话落盘 |
| 02-streaming-mid | 回合卡「运行中 · live-run-s1」，仅含「第一段流式文本。」，第三段尚未到达 | AC-001：SSE 流式增量渲染（非一次性落地） |
| 03-turn-completed | 同回合转「已完成」，渲染 `renderOutput(output)` JSON（`"result": "done"`）+ ENVELOPE sha256:39a5…ffd4 | 完成态渲染 + 封缄摘要可见 |
| 04-approval-card | 失败回合 `engine.approval_required: awaiting operator verdict` + 审批卡（等待审批 · 命令执行 rm -rf build / scripts/clean.sh / 过期时间 / 批准并继续 / 拒绝） | 审批卡从 approval.requested 事件投影 |
| 05-approval-resumed | 批准后续跑回合「已完成」，`"result": "resumed"`，`verdictDecision: "granted"`，ENVELOPE sha256:65da…9525 | 裁决随新回合发出并受信托完成 |
| 06-session-recalled | **杀掉应用重启**后同一会话自动选中，三个回合完整召回（输入 / done / resumed / 已完成 / 审批动作文本均在） | AC-004：本地历史召回 |

时间线细节见 `timeline-phase1.txt` / `timeline-phase2.txt`（含各 waitFor 实际等待毫秒数）。

## 磁盘核验（服务端持久化，独立于渲染）

`ws4/.digital-employee/workbench/sessions/conversations/ffed832d-…/turns/`：

| turnId 前缀 | status | output/error |
| --- | --- | --- |
| 759ba915 | completed | `{"result":"done"}` |
| 0a76fd07 | failed | `engine.approval_required`（retryable） |
| b956deea | completed | `{"result":"resumed","verdictDecision":"granted"}` |

渲染层直读校验：`window.owb.sessionTurnHistory(ffed832d)` 在重启后返回 200 + 3 回合全量记录。

## 附记：一次驱动伪象（非产品缺陷）

phase 2 首轮失败是驱动把「本地会话」下拉重设为**当前同值**：`App.selectSession` 无条件 `setTurns([])`，而同值不触发 state 变化、加载 effect 不再 firing，历史被清空。真实浏览器对同值选项不派发 change 事件，用户不可达此路径。驱动已改为仅在实际切值时派发 change；复跑即全绿。记录于此备查（若未来要支持编程式同值重选，可在 selectSession 内对同值早退）。

## 已知边界

- 桩引擎仅模拟 qoder 宿主单岗位路径；群聊面（S2/S3）证据由其各自 PR 携带
- 召回证据覆盖单会话场景；多会话切换的回归由单测覆盖（turn-stream 15/15）
