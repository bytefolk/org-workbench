# Issue #14 实机验证证据 — 组织树拖拽移动 + 姓名/头像

验证方式：Electron `--remote-debugging-port=9333`，经 CDP `Runtime.evaluate` 注入真实
`DataTransfer` DragEvent 序列（dragstart → dragover → drop → dragend）驱动 React DnD，
全程走控制面真实链路（POST /org/apply → qoder-engine org apply → SSE owb:event → 树刷新）。

工作区：`workspaces/qoder-team`（由 `scripts/sync-qoder-org.mjs` 从 ~/.qoder/agents 生成）。

## 断言结果

| 步骤 | 断言 | 结果 |
| --- | --- | --- |
| BEFORE | 树节点数 = 9（enterprise 根 + 8 岗位） | pass |
| BEFORE | 含中文姓名标签节点 = 8（displayNames 全量送达） | pass |
| BEFORE | 含头像（首字/首字母）节点 = 8，颜色取自 position card metadata.color | pass |
| MOVE | 拖拽 `tester` → `architect` 后，tester 的父节点 = `architect` | pass |
| MOVE | 横幅提示「已将 tester 调整到 architect」，/reports 记录 moved {id, from, to} | pass |
| RESTORE | 拖拽 `tester` → enterprise 根后，父节点 = `__enterprise__`（reportTo null） | pass |

截图 `drag-moved.png`：移动完成态，tester 嵌套于 architect 之下，彩色头像 + 中文姓名可见，
右上角「引擎可用」，Agent Host 为 `Qoder · Idle`。

## 复现命令

```bash
node scripts/sync-qoder-org.mjs            # 生成 workspaces/qoder-team
ORG_WORKBENCH_DEFAULT_WORKSPACE=$(pwd)/workspaces/qoder-team \
  npx electron apps/desktop/src/main.js --remote-debugging-port=9333
# 另开终端：CDP 驱动脚本（会话级临时文件，不入库）注入 DragEvent 并截图
```

## 标签可读性（同 PR 附带修复）

姓名为主行（13px/600），position id 为次行（11px muted），两行各自 ellipsis，
288px 侧栏下姓名不再被 id 挤占截断；ui 测试 `org-tree.test.tsx` 覆盖 name/id 双行结构。
