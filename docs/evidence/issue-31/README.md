# Issue #31 / PR #50 复拍取证（六处方修复后运行时核验）

取证时点：head `6aceb6d`（评审修复提交，HEAD == fork/feat/issue-31-texture）。
方法论同 `docs/evidence/issue-32`：`/tmp` stub CLI（仅应答 `--version`，其余 exit 2）
经 `ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI` 注入，全新工作区 `/tmp/owb-50fix-ws`
（自 `examples/oss-maintainer` 复制），CDP `--remote-debugging-port=9335` 驱动真实 UI。
stub 与驱动脚本仅存 `/tmp`，不入仓库。renderer 于 head 重新构建（vite，8.74s），
回归用例 `apps/desktop/test/skin-bundle.test.cjs` 本地 pass。

```
QODER_PERSONAL_ACCESS_TOKEN=evidence-dummy-token \
ORG_WORKBENCH_DEFAULT_WORKSPACE=/tmp/owb-50fix-ws \
ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI="node /tmp/owb-50-stub.mjs" \
npx electron apps/desktop/src/main.js --remote-debugging-port=9335
```

## 根因回归核验（REQUEST CHANGES 唯一根因）

| 指标 | 修复前（CEO @ 2b411bf） | 修复后（C2 @ 6aceb6d） |
|---|---|---|
| live CSSOM 规则数 | 360 | 925 |
| warm `:root` 块（`--ui-canvas` 定义规则序号） | warmIdx=-1（查无） | warmIdx=783（存活） |
| bundle token grep | — | `f8f7f5 / edeae5 / 5e6ad2 / e8e6e2 / faf9f8` 全在（index-XxqRaHv6.css） |
| `:root` computed token | 回落 ds seed（#f5f5f5/#1677ff） | 9/9 全活，见 `token-audit.json` |

## 六处方 computed 审计（逐项）

| 处方 | 期望 | 实测 | 判定 |
|---|---|---|---|
| 1 画布两阶 | canvas `#f8f7f5` / nav `#edeae5` | `.ui-app-shell` rgb(248,247,245)；`.ui-app-shell__rail` rgb(237,234,229)；`.ui-app-shell__sidebar` rgb(243,241,237)（--ui-canvas-subtle 阶） | 生效 |
| 2 单一强调 | 自定义层 `#5e6ad2` | `--ui-primary: #5e6ad2`；`.ant-btn-primary` bg rgb(94,106,210)，字色 #fff | 生效 |
| 3 warm hairline | `#e8e6e2` 全层 | rail `border-right` rgb(232,230,226)；`--ui-border: #e8e6e2` | 生效 |
| 4 动效三档 | .12/.15/.2s ease-out | 见下「动效双态取证」 | 生效 |
| 5 负字距 | ≥16px 标题 -0.01em | `@岗位对话` h2 20px → letter-spacing -0.2px | 生效 |
| 6 36px 控件 | 默认 36 | antd var 链 `.css-var-r0` `height:36px`（controlHeight 36 生效）；头部「撤销/创建员工」显式 `size="small"` 28px（App.tsx:727，设计意图，处方6 紧凑档） | 生效 |

## 动效双态取证（处方4 关键补充）

取证环境 macOS 命中 `prefers-reduced-motion: reduce`，design-system
`tokens.css:250-264` 的 a11y 媒体查询以 `transition-duration: 0.01ms !important`
全局降级——这是正确行为，不是失效。CDP `Emulation.setEmulatedMedia` 双态验证
（合成 `.owb-turn__retry` 元素，`motion-emulation-audit.json`）：

| 环境 | computed transition-duration | timing |
|---|---|---|
| reduce（实机现状） | 1e-05s（=0.01ms 降级） | — |
| no-preference（CDP 仿真） | **0.12s, 0.12s, 0.12s** | cubic-bezier(0.215,0.61,0.355,1) ×3 |
| 撤销仿真恢复 | 1e-05s | — |

token 三档 `--owb-duration-fast/mid/slow` = `.12s/.15s/.2s` 与 `--owb-ease-out` 全部
在 `:root` computed 存活；自定义控件规则（app.css:17-23）经 `CSS.getMatchedStylesForNode`
确认命中（`cascade-audit.json`）。

## 登记 finding（非本 PR 阻塞项）

- **F1 `.owb-session-controls button` 34px 遗留覆盖**：「新建会话」按钮实测 34px，
  来源 app.css:536 `height:34px` 自定义覆盖（#14 会话生命周期引入，非本 PR 改动），
  与处方6 三档（36/28/40）不齐。建议后续切片归一到 36px 或改 small 档，不在本 PR 扩面。

## 截图

- `01-cold-start.png` 冷启动
- `02-settled.png` 主界面（暖壳层 / rail 阶 / lavender 主按钮 / 白卡面 / 负字距标题）
- `03-final.png` 终审态

—— C2（并行取证线），复拍于 6aceb6d
