# Issue #25 Slice A 实机取证（host E3：在途回合中断）

以 `/tmp` 内 stub CLI（`digital-employee turn run` 形态，输出严格 engine.v1 事件序列：
run.started → model.delta → usage → model.delta，随后保持在途不退出，
收到 SIGTERM 以 exit 143 结束——模拟可被中断的真实引擎）经
`ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI` 注入 loopback 控制面，CDP（`--remote-debugging-port=9334`）
驱动真实 UI 发起回合并执行操作员中断，取证如下。stub 与 CDP 驱动脚本仅存 /tmp，不入仓库。

启动环境：

```
QODER_PERSONAL_ACCESS_TOKEN=evidence-dummy-token \
ORG_WORKBENCH_DEFAULT_WORKSPACE=/tmp/owb-e3-ws2 \
ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI="node /tmp/owb-e3-stub.mjs" \
npx electron apps/desktop/src/main.js --remote-debugging-port=9334
```

其中 `QODER_PERSONAL_ACCESS_TOKEN` 使用占位值仅用于通过 qoder host 就绪门禁
（stub 不发起任何真实模型调用），不影响中断链路取证的有效性。
`/tmp/owb-e3-ws2` 为全新工作区（自 oss-maintainer 模板复制组织/岗位/manifest，
不含任何历史回合），保证「中断前 DOM 终态卡片数 = 0」的断言成立。

## statusline.png（在途回合：紧凑状态行 + 中断入口）

- 紧凑状态行 `.owb-turn__statusline` 可见：`Qoder · 0:01 · 320 tokens`
  （engineLabel 徽标 · 秒级 elapsed · 来自 `turn.usage` 的 totalTokens）；
- 发送按钮被中断按钮替换（danger 方形图标，`aria-label="中断回合"`，提示「中断回合（⌘.）」）；
- composer hint 显示「回合运行中：点击中断或按 ⌘. 终止该岗位的在途回合」。

## cancelled.png（中断收口：indeterminate + 诊断码 turn_cancelled）

CDP 点击中断按钮后：

- POST `/turns/cancel`（body 恰为 `{positionId}`）返回 200 `{cancelled:true, positionId}`；
- 控制面 SIGTERM 终止 stub 子进程，driver 以 `indeterminate` 收口，
  复用冻结词表 `turn.indeterminate` SSE（未新增 SSE 类型、未新增错误码）；
- 终态卡片 `.owb-turn__response.is-indeterminate` 渲染诊断码
  `turn_cancelled: the engine process ended without a trusted terminal; no automatic retry was attempted`，
  envelope 指纹 `sha256:9db53…e50d2dcd`，并提供「创建新回合重试」入口；
- composer 复位，hint 恢复「将通过 Qoder 创建一个新回合」。

CDP 断言（轮询时间线，节选）：

```
pre-existing indeterminate cards: 0       （全新工作区，历史无污染）
statusline: Qoder·0:01·320 tokens         （usage 事件已渲染进状态行）
indeterminate cards while running: 0      （中断前回合确实在途）
cancel clicked                            （aria-label="中断回合" 按钮命中）
terminal: turn_cancelled                  （indeterminate 卡片出现）
composer hint restored: 将通过 Qoder 创建一个新回合
```

## 线上事件核对（SSE wire capture）

同一回合在 `/events` 线上捕获到：`turn.started` ×1、`turn.model.delta` ×2、
`turn.usage` ×1、`turn.indeterminate` ×1（payload.code=turn_cancelled），
与 renderer 渲染状态一致（无重复、无乱序）。
