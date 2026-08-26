# Issue #32 实机取证（同级排序 overlay + 单步撤销）

以 `/tmp` 内 stub CLI（仅应答 `--version` 健康探针；reorder-only manifest 依 D-32-2
永不到达引擎，任何真实引擎调用以 exit 2 大声失败）经
`ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI` 注入 loopback 控制面，CDP（`--remote-debugging-port=9335`）
驱动真实 UI：点击 `release-engineer` 行后按 ⌘↑（与插入线投放同一条 reorder op 路径），
再点「撤销」按钮，取证如下。stub 与 CDP 驱动脚本仅存 /tmp，不入仓库。

启动环境：

```
QODER_PERSONAL_ACCESS_TOKEN=evidence-dummy-token \
ORG_WORKBENCH_DEFAULT_WORKSPACE=/tmp/owb-32-ws \
ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI="node /tmp/owb-32-stub.mjs" \
npx electron apps/desktop/src/main.js --remote-debugging-port=9335
```

`/tmp/owb-32-ws` 为全新工作区（自 examples/oss-maintainer 复制，不含任何 overlay/undo
历史），保证「初始序 = 字母序」断言成立。`QODER_PERSONAL_ACCESS_TOKEN` 占位值仅用于
host 就绪门禁，stub 不发起任何真实模型调用。

## reorder-applied.png（⌘↑ 后：同级排序生效 + overlay 落盘）

- 树行序由字母序 `community-operator, issue-researcher, release-engineer` 变为
  `community-operator, release-engineer, issue-researcher`；
- 反馈条渲染「已调整 release-engineer 的同级顺序」；
- 磁盘断言：`.digital-employee/org-layout.v1.json` 存在，
  `order["repo-owner"] = ["community-operator","release-engineer","issue-researcher"]`，
  文件模式 `600`（writeLayoutAtomic 原子写）；
- `.digital-employee/org-undo.v1.json` 存在（reorder 也保存单步撤销条目）；
- 引擎零调用（stub 对任何非 `--version` 调用 exit 2，进程日志无调用记录）。

## undone.png（撤销：顺序恢复 + 条目消费 + 二次撤销被拒）

- 点「撤销」后树行序恢复 `community-operator, issue-researcher, release-engineer`，
  overlay `order["repo-owner"]` 同步恢复；
- `org-undo.v1.json` 被消费删除（单步纪律）；
- 反馈条渲染「已撤销最近一次组织调整」；
- 再次点「撤销」：`POST /org/undo` 404 `not_found`，渲染器提示「没有可撤销的组织调整」。

CDP 断言时间线（节选）：

```
initial row order: __enterprise__,repo-owner,community-operator,issue-researcher,release-engineer
row order after ⌘↑: __enterprise__,repo-owner,community-operator,release-engineer,issue-researcher
overlay order[repo-owner]: ["community-operator","release-engineer","issue-researcher"]
overlay mode: 600
undo entry exists after reorder: true
renderer feedback: 已调整 release-engineer 的同级顺序
row order after undo: __enterprise__,repo-owner,community-operator,issue-researcher,release-engineer
undo entry consumed: true
undo feedback: 已撤销最近一次组织调整
second undo note: 没有可撤销的组织调整
```

## hire-entry.png（行 hover「+」创建入口，AC-004）

> 历史取证说明：本截图中的「招聘岗位并声明预算」弹窗已于 #33 随 orgApply 直写
> bypass 一并移除；创建入口现为「创建员工」Drawer（hire-request.v1alpha1 契约面），
> 见 `docs/evidence/issue-33/README.md`。以下记录保留为 #32 时点取证。

第二个 CDP 驱动（同一实例）点击 `community-operator` 行的「+」
（`aria-label="在 Community Operator 下招聘下属"`）：

- 招聘弹窗打开，标题「招聘岗位并声明预算」；
- 「汇报对象」预置为 `Community Operator · community-operator`（受控弹窗
  `defaultManager` 接线生效）；
- 点「取消」关闭弹窗：不提交任何 manifest，overlay/undo 文件零变更；
- 空态按钮（`onHireEntry(null)`）与无回调隐藏由 `org-tree.test.tsx` 覆盖。

CDP 断言时间线（节选）：

```
hire entry clicked: 在 Community Operator 下招聘下属
dialog title: 招聘岗位并声明预算
reportTo preset: community-operator
dialog cancelled cleanly
```
