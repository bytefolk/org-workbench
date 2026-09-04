# #36 S1 资产层底座 · 实机证据（DS-36-001 rev-1 §5）

本目录为 #36 S1 的实机证据包。全部断言由真实 Electron 进程（`--remote-
debugging-port=9337`）经 `window.owb` 白名单桥驱动完成，非 mock；
驱动脚本仅存在于 /tmp（owb-36-cdp.mjs / owb-36-cdp2.mjs），不入库。

## 仪式

```
# 夹具工作区（复制自 examples/oss-maintainer）
cp -R examples/oss-maintainer /tmp/owb-36-ws

# 引擎桩 + 默认工作区 + 实机启动
ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI=/tmp/owb-36-stub.mjs \
ORG_WORKBENCH_DEFAULT_WORKSPACE=/tmp/owb-36-ws \
npx electron apps/desktop/src/main.js --remote-debugging-port=9337
```

## Phase 1（见 timeline.txt 上半段 + 01/02 截图 + fs-facts.json）

- `owb.assetsCreate`：decision（sourceRef.positionId）与 conversation-excerpt
  （sourceRef.sessionId + conversationRef）均 201，返回即 `asset-record.v1`
  原文（非 doc 六键：无 docRef）；
- doc 资产仍唯一经 #35 `createPositionDoc` 落（201），其记录为七键并携带
  冻结的 `doc-ref.v1alpha1` uri `owb-doc://repo-owner/notes/asset-layer.md`；
- 创建面拒绝 `kind: "doc"` 与额外键（400 `asset_request_invalid`）；
- `owb.assetsList` 返回 `assets-list.v1`，三资产（两非 doc + 一 doc）
  按 `createdAt asc → assetId asc` 确定性排序；
- `owb.assetsRead` 逐条回读与创建返回 deep-equal；缺位 uuid 404
  `asset_not_found`，`../escape` 形 400 在桥前拒绝；
- 现场删除 `asset-index.json` 后 `assetsList` 与首列 deep-equal，索引由
  落盘记录重建且二次列出稳定（AC-001 重建确定性，热态）；
- fs 事实（fs-facts.json）：assets 根目录与每个资产目录 0700，每个
  `record.json` 0600；索引保持 `asset-index.v1alpha1`、三条账目。

## Phase 2（冷重启，见 timeline.txt 下半段 + 03 截图）

- 重启前擦除 `asset-index.json`；冷启动后 `assetsList` 与「纯由磁盘落盘
  记录推导的期望序列」deep-equal（AC-001 重启后重建确定性）；
- 三资产 `assetsRead` 逐条回读一致；索引自动重建（0600、三条账目）。

## 覆盖对照（P9 口径 issuecomment-5435105010）

- AC-001 沉淀可列：Phase 1 列举/回读/排序 + 热态重建；Phase 2 冷重启重建。
- AC-002 复用可证：全程消费 #35 冻结件（parseAssetRecord / writeAssetRecord /
  appendAssetIndex / doc-ref.v1alpha1），无第二套存储、零新增依赖
  （逐行复用见 PR 复用追溯表）。
- AC-003 冻结面零碰：既有路由/事件/桥接方法签名未改，仅加法式新增三路由
  与三桥接方法；错误码仅加 2 个（存储错误沿用 #35 的 `docs_storage_failed`）。
