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

---

# Issue #25 Slice B 实机取证（控制面 E3：审批卡片裁决往返）

以 `/tmp/owb-approval-e3/stub.mjs`（`digital-employee turn run` 形态，输出严格
engine.v1 #187 事件序列）经 `ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI` 注入独立启动的
loopback 控制面（`node apps/server/dist/src/index.js --port 0`），curl 驱动全链路。
stub 会重算入站信封的 canonical-JSON sha256 摘要，与自身信封指纹不符即 exit 1——
即裁决必须真的被封进下一回合信封才能驱动续跑。stub 与驱动脚本仅存 /tmp，不入仓库。

stub 行为：无 `pendingApproval` → `run.started → approval.requested(appr-e3, exec,
"rm -rf build", target scripts/clean.sh, reason, expiresAt) → run.failed
engine.approval_required(retryable)`；带 `pendingApproval` → 回显裁决并
`run.completed {result:"resumed", verdictDecision, verdictScope}`。

## turn 1：无裁决 → 审批门（#187 Option 1 终态-续跑）

```
status: failed | error: engine.approval_required | retryable: true
events: run.started -> approval.requested -> run.failed
approval: "appr-e3" {"kind":"exec","description":"rm -rf build","target":"scripts/clean.sh"}
envelopeDigest: sha256:445e8c7fbe5bf8a3b845b176a188de5a368dd6a50886c474b8395936b74e3707
```

请求 run 以 retryable `run.failed(engine.approval_required)` 结算；无 in-run 通道。

## turn 2：续跑回合携带 granted 裁决

POST /turns 携带 `pendingApproval {approvalId:"appr-e3", decision:"granted",
decidedBy:"operator", scope:"once"}`：

```
status: completed | output: {"result":"resumed","verdictDecision":"granted","verdictScope":"once"}
events: run.started -> model.delta -> run.completed
envelopeDigest: sha256:3db8db237e304fc3b5974f65d9fc2e38e8e96dc2a34df3457ecc3da9b013bbe7
```

stub 端信封摘要自检通过（裁决确实封入信封），引擎侧回显裁决。两回合摘要不同，
证明 pendingApproval 参与 canonical 摘要（与上游 #193 computeEnvelopeDigest
逐字节交叉验证：含裁决向量 sha256:bb59fc99…8187，无裁决冻结向量 sha256:86df4dc7…c8c7 不变）。

## 边界违规：decidedBy ≠ operator → spawn 前 fail closed

```
400
{"code":"turn_request_invalid","message":"pendingApproval.decidedBy must be operator","retryable":false}
```

未新增错误码 / SSE 类型；违规不触达引擎（测试矩阵 12 例均断言零 spawn）。

## 历史回读（写后即读不回退）

```
turns: 51b7e2d9:failed:engine.approval_required | c66f88aa:completed:-
```

含 approval.* 事件的回合记录持久化后 GET /turns 原样读回
（store 读校验已镜像 approval 三事件边界；回归测试
`turn records containing approval events persist and read back intact`）。

## 线上事件核对（SSE wire capture）

```
SSE turn.approval.requested -> approval.requested
SSE turn.failed -> run.failed engine.approval_required
SSE turn.completed -> run.completed
```

renderer 侧审批卡片（kind 文案、批准/拒绝、裁决转续跑回合）由
`apps/desktop/renderer/test/approval.test.tsx`（4 例）与
`apps/desktop/test/approval-ipc.test.cjs`（3 例）覆盖。
