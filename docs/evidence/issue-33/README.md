# Issue #33 实机取证（创建员工 hire-request.v1alpha1 实体接线 + 四态状态机）

以 `/tmp` 内 stub CLI（应答 `--version` 健康探针、`hire validate <file> --json`
闸门一、`org apply <dir> --json` 闸门二；任何其他调用以 exit 2 大声失败并记
`UNEXPECTED` 日志）经 `ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI` 注入 loopback 控制面，
CDP（`--remote-debugging-port=9336`）驱动真实 UI：点「创建员工」打开 Drawer（S1），
填写 docs-runner / 发布文档专员 / 职责描述 / 双预算后点「开始创建」，取证 S2 执行态
与 S4 成功态。stub 与 CDP 驱动脚本仅存 /tmp，不入仓库。

启动环境：

```
QODER_PERSONAL_ACCESS_TOKEN=evidence-dummy-token \
ORG_WORKBENCH_DEFAULT_WORKSPACE=/tmp/owb-33-ws \
ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI="node /tmp/owb-33-stub.mjs" \
OWB33_APPLY_DELAY_MS=3000 \
npx electron apps/desktop/src/main.js --remote-debugging-port=9336
```

`/tmp/owb-33-ws` 为全新工作区（每次取证前 `rm -rf` 后自 examples/oss-maintainer
复制，不含任何 hire 历史），保证「树中无 docs-runner」的前置断言成立。
`QODER_PERSONAL_ACCESS_TOKEN` 占位值仅用于 host 就绪门禁，stub 不发起任何真实模型
调用。`OWB33_APPLY_DELAY_MS=3000` 让闸门二（org apply）延迟 3 秒返回，使 S2 执行态
（含「执行中不可取消」诚实边界）可被截图捕获；该变量仅 stub 读取。

## hire-executing.png（S2 系统执行：hireRun 驱动 + 诚实边界）

- Drawer 标题「创建员工」，Steps 呈四态机进度：`提交 ✓ → 系统执行 ② → 就绪 ③`；
- `[aria-live]` 活区文案「正在校验 hire-request.v1alpha1 契约…」（闸门一阶段拷贝，
  无假百分比、无静默失败）；
- 按钮「执行中不可取消」处于 disabled——hire 执行不提供中途取消（与 turn 的 cancel
  语义不同，契约面未定义 hire cancel）；
- 背景组织树仍为 hire 前四岗位（repo-owner + 三子），遮罩下不可操作。

## hire-succeeded.png（S4 结果：成功反馈 + 树/详情/磁盘全链路落盘）

- 顶部 toast 与信息条渲染「发布文档专员 已加入团队（hire-request.v1alpha1 契约面）」；
- 组织树新增 `docs-runner` 行并处于选中态（reload 后由 org.json 驱动，非本地乐观
  更新）；
- 岗位卡：`docs-runner` + 「需批准」mode 标签、职责描述「维护公开文档与发布说明」、
  预算声明 单任务 20,000 tokens / 单日 200,000 tokens、权限摘要「无允许工具」、
  Context Scope `/`；TURN CONTROL 已可对话 `@docs-runner`；
- 磁盘断言：staged 骨架 `.digital-employee/packages/docs-runner/employee.json` 存在
  （`name` 携带岗位 id、`policy.mode=approval_required`、无 `id` 字段，与
  employee-package.v1alpha1 骨架一致）；`budget.json` 文件模式 `600`；
  applied `org.json` 含 `docs-runner` 且 `reportTo=repo-owner`；`org-audit.jsonl`
  记录 hire 条目；
- stub 日志：恰好一次 `hire validate`（exit 0 + `{"status":"valid"}`）与一次
  `org apply`，无 `UNEXPECTED` 调用——renderer 未绕过控制面直写引擎。

## bypass 移除核对（同 PR 欠账清理）

- 招聘岗位 `orgApply` 直写路径已删除；renderer 单测
  `App.test.tsx` 断言 hire 流程中 `orgApply` 零调用；
- `docs/api-contract-v0.md` §2.5 变更清单仅余 move/delete/reorder，携带 `add`
  返回 400 `manifest_invalid`；§2.14 新增 `POST /hire` 端点定义。

CDP 断言时间线（全文见 timeline.txt）：

```
entry button present: true
drawer open (S1 draft)
form filled: docs-runner / 发布文档专员 / 20000 / 200000
S2 running copy captured: 正在校验 hire-request.v1alpha1 契约…
S4 success feedback rendered
tree shows docs-runner after reload: true
staged skeleton employee.json exists: true
budget.json mode: 600
applied org.json contains docs-runner: true (reportTo=repo-owner)
audit entries: 2, hire entry recorded: true
stub saw hire validate: true, org apply: true, unexpected calls: false
```

CI 重触发说明：head 43a9697 的 pull_request 事件丢失（close/reopen 均未重触发），本提交为真实改动的重推。
