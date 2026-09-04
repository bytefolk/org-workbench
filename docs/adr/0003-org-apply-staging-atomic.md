# ADR-0003: org apply 采用 staging 暂存 + 原子发布

状态：已被 ADR-0005 取代（保留历史）｜ 日期：2026-08-23

> OQ-2 与 digital-employee #171 将组织模型翻转为目录提案模式；现行决策见 ADR-0005。

## 决策

`POST /org/apply` 采用两段式：先在 `<workspace>/.digital-employee/staging/` 物化完整的工作区副本并施加变更清单，交引擎校验；校验通过后以 rename 原子发布（organization 文件覆盖 + 岗位目录同步）；校验失败则工作区原状不动。

## 备选与否决理由

"直接改目录 + 失败回滚"：多步目录操作中途失败时回滚路径复杂、证据缺失，且把半成品状态暴露给 watcher/前端。staging 方案把"未决状态"完全隔离在暂存目录，发布动作压缩为一组 rename。

## 留痕与不删除纪律

- 每次尝试追加 `.digital-employee/apply-log.ndjson`（供 /reports 审计流消费）。
- 被拒的 staging 移入 `.digital-employee/rejected/`，供审计与复现。
- 成功发布的 staging 残片移入 `.digital-employee/applied/`。
- 裁撤的岗位目录移入 `.digital-employee/archive/<id>-<stamp>/`：裁撤留痕，永不硬删除（对齐 #157 审计要求与文件安全纪律）。

## 边界

客户端不重写预算闸门与组织法校验——校验唯一入口是钉版 `digital-employee org apply`；staging 阶段只做形状级冲突检测（重名/缺位/环/裁撤 owner），对应稳定码 `org_apply_*`。

## 后果

- 需要额外磁盘空间存放暂存副本（组织文件+岗位包，量级小，可接受）。
- rename 原子性依赖同卷；跨卷工作区在打开校验时已固定，风险受控。
