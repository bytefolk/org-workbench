# Issue #19 实机取证（stub engine.v1）

以 `/tmp` 内 stub CLI（`digital-employee turn run` 形态，输出严格 engine.v1 事件序列：
run.started → model.delta ×2 → usage → run.completed，exit 0）经
`ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI` 注入 loopback 控制面，CDP（`--remote-debugging-port`）
驱动真实 UI 完成回合，取证如下。stub 与驱动脚本仅存 /tmp，不入仓库。

## stream-mid.png（流式过程，发送后 ~3.7s）

- 运行中气泡（`.owb-turn__response.is-running`）可见，runId 标签 `live-stub-run-455`；
- 增量文本已渲染第一段 delta：「流式取证进行中：正在核对冻结契约 turn.* 词表…」；
- 终态气泡尚未出现（历史权威态未刷新），证明渲染来自 SSE 流而非历史重载。

CDP 断言（轮询时间线，节选）：

```
t=216ms   running=true  output=""（turn.started 已绑定 pending POST）
t=1028ms  output="流式取证进行中：正在核对冻结契约 turn.* 词表…"（delta 1）
t=2444ms  output+="\n渲染层经 owb:event 订阅增量文本并逐段追加。"（delta 2）
```

## stream-final.png（终态收口，发送后 ~6.0s）

- 运行中气泡清零（`liveRemaining=0`），live 缓冲被终态事件移除；
- 权威历史记录渲染：「已完成」+ stub 回执输出 + `ENVELOPE sha256:8ce4c…f05f0d6d`；
- 输入框复位，hint 恢复「将通过 Qoder 创建一个新回合」。

## 线上事件核对（SSE wire capture）

同一回合在 `/events` 线上捕获到完整词表序列：
`turn.started` ×1、`turn.model.delta` ×2、`turn.usage` ×1、`turn.completed` ×1，
与 renderer 侧 `window.owb.onEvent` 探针记录一致（无重复、无乱序）。
