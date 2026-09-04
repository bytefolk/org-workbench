# Issue #53 实机取证（协作可视化面：群头头像组 / 成员侧栏 / 组织树发起群聊入口）

以 `/tmp` 内 stub CLI（仅应答 `--version` 健康探针，任何其他调用以 exit 2
大声失败）经 `ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI` 注入 loopback 控制面，CDP
（`--remote-debugging-port=9336`）驱动真实 UI，对 DS-34-001 rev-1 §1.3/§7 的
三个可视化入口逐一取证：组织树 hover 显式入口 → 建群草稿预填 → 群头头像组 +
成员侧栏。stub 与 CDP 驱动脚本仅存 /tmp，不入仓库。

启动环境：

```
QODER_PERSONAL_ACCESS_TOKEN=evidence-dummy-token \
ORG_WORKBENCH_DEFAULT_WORKSPACE=/tmp/owb-53-ws \
ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI="node /tmp/owb-53-stub.mjs" \
npx electron apps/desktop/src/main.js --remote-debugging-port=9336
```

`/tmp/owb-53-ws` 为全新工作区（每次取证前 `rm -rf` 后自 examples/oss-maintainer
复制，不含任何群历史），保证「树中无群」的前置断言成立。
`QODER_PERSONAL_ACCESS_TOKEN` 占位值仅用于 host 就绪门禁，stub 不发起任何真实
模型调用。群头/侧栏全部消费既有 `/groups*` 契约（#52 已合入），不立新通道。

## org-tree-group-entry.png（入口①：组织树显式发起群聊）

- 物理 hover（`Input.dispatchMouseEvent`）release-engineer 行后，行尾浮现
  `UsersRound` 群聊按钮（`:hover`/`:focus-visible` 时 opacity 1，断言
  `getComputedStyle(button).opacity === "1"` 为 true）；
- aria-label 使用展示名「与 Release Engineer 发起群聊」，非 position id；
- 入口为显式动作：点击仅切到群聊模块并预填草稿成员，不直接建群、不广播。

## group-draft-prefilled.png（入口②：建群草稿预填成员）

- 点击树入口后 `details.owb-groups__create` 以受控 `open` 打开；
- 草稿成员清单中 Release Engineer 复选框已勾选（checked count: 1），其余
  岗位未勾选——预填即「建议」，操作者仍需显式确认第二名成员；
- 「创建群聊」按钮在成员 < 2 时保持 disabled（继承 #52 闸门）。

## group-header-roster.png（入口③：群头头像组 + 成员侧栏）

- 群头右侧头像组：两枚 22px 圆形头像（metadata.color 优先，缺省
  `hsl(hueForId(id), 65%, 42%)`，与组织树同色相），叠放 -6px，aria-label
  「群成员 2 人」；
- 成员侧栏（`aside[aria-label="群成员"]`）列出 Release Engineer / Repo Owner，
  行内运行点仅在该成员有在途群回合时脉冲（本次无在途回合，不亮）；侧栏底部
  「拉人」select 只列非成员岗位；
- 组合器 @ 提及行内联渲染 `@Release Engineer` / `@Repo Owner` 两枚 chip，
  断言全部 chip 的包围盒落在 picker 行内（`mention chips in-flow inside
  picker row: true`）；hint 保留显式路由守卫文案「选择至少一名成员：群回合只按
  @mention 显式路由，不广播」。

## 同 PR 欠账清理（#52 潜伏布局债）

- 取证发现 #52 群组合器的 @mention chip 被 `.owb-turn-composer button`
  全局规则（`position: absolute; right/bottom 8px`，本意是 textarea surface 内的
  发送按钮）拽出文档流，表现为窗口右下角漂浮的紫色圆片、picker 行只剩标签；
- 修复：该规则收敛为 `.owb-turn-composer__surface button`（发送/中断按钮均在
  surface 内，TurnPanel/GroupsPanel 行为不变），mention chip 回归 picker 行内；
- 驱动脚本新增包围盒断言（见上），防止回归。

CDP 断言时间线（全文见 timeline.txt）：

```
cdp connected
org tree rows: 5
org-tree group entry present+revealed on hover: true
create panel open, prefilled checked count: 1
group created: avatar stack 2 avatars; roster: Release Engineer, Repo Owner
avatar stack aria-label: 群成员 2 人
composer hint: 选择至少一名成员：群回合只按 @mention 显式路由，不广播
mention chips in-flow inside picker row: true
```
