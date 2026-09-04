# 证据包：#63 conversationRef 清偿（turn-envelope.v1alpha2 契约级回链）

日期：2026-08-27 ｜ 分支：feat/issue-63-convref-clearing ｜ 基线：main@7aeed8b

## 方法

纯测试与工件证据（契约/服务端变更，无 UI 面）：

1. `envelopes.json`：同一构造器两种调用的产物原文——
   - 无 `conversationRef` → `turn-envelope.v1`，键集 `schemaVersion,workspaceRef,positionId,turnId,input,envelopeDigest`，与清偿前逐字同形（AC-1）；
   - 携带 `conversationRef: conv-evidence-001` → `turn-envelope.v1alpha2`，字段进摘要（digest 随字段变化）。
2. `server-test-run.txt`：`node --test apps/server/dist/test/convref.test.js` 4/4 全过，覆盖：
   - AC-1：v1 键集冻结 + 「字段⇔版本」严格成对 + 非法回链（空串/超长）抛错；
   - AC-3：会话回合信封回链 == sessionId（端到端，驱动捕获信封）；
   - AC-2：群 spawn 信封回链 == groupRef + 记录双写（端到端）；
   - AC-5：存量仅带 groupRef 的记录经群时间线兜底可读。
3. `renderer-test-run.txt`：turn-stream 18/18 全过（含 #63 三例：回链独立归组需有 spawn seed、groupRef 灰度兜底权威、个人会话路径不被回链劫持）。

## 读路径核验

- `isTurnRecord` exactKeys 可选键集补入 `conversationRef`（1..256 边界，镜像上游 de#205 schema），缺此补丁时带字段记录 500 `turn_storage_failed`——回归已固化进服务端用例。
- `validateEngineEvent` 门闸统一剥离/回贴回链，冻结分支键集零改动；非法回链事件拒绝不新增错误类别（AC-4）。

## 灰度与回退

- 灰度：群路径与会话路径携带；无会话上下文的个人回合保持 v1 逐字节；事件无回链时 renderer 走旧 spawn turnId 映射。
- 回退：构造器回退为 v1 无字段即恢复本地映射语义；记录侧 `groupRef` 双写在清偿期内全程保留，时间线读取 `conversationRef || groupRef`，回退零数据动作。

## 门禁

`npm run check` 全绿（worktree）：tsc -b + typecheck:ui + test:ui + server node --test 全量 + typecheck:renderer + renderer 10 文件全过 + desktop-main 13/13 + security:check 0 漏洞。
