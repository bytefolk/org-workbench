# ADR-0005: positions/ 是组织提案面，引擎独占应用态

状态：已决（Issue #5 / OQ-2）｜ 日期：2026-08-24

## 决策

`POST /org/apply` 先完整预检 change-manifest.v1，再直接物化工作区 `positions/`：嵌套目录表达汇报线，`budget.json` 表达岗位预算。随后调用钉版 `digital-employee org apply <workspace> --json`。

引擎独占 `.digital-employee/org.json`、`org-audit.jsonl` 与 `permissions.json` 的写入；控制面成功后只重载 `org.json`。引擎拒绝时不回滚目录提案，三个应用态文件必须保持字节不变，用户可在原提案上修正后重试。

## 文件安全

- 招聘预算用同目录临时文件 + rename 原子写，权限 0600。
- 调岗对岗位目录做 rename；`reportTo=null` 表示直挂 `positions/` 根。
- 目录嵌套业务上不限深度，客户端设置 `maxDepth=8` 防御上限。
- 裁撤把完整岗位目录移到树外 `.digital-employee/backup/<id>-<stamp>/`，不硬删除。
- 旧 `staging/`、`rejected/`、`applied/`、`archive/` 与客户端 `apply-log.ndjson` 停写；历史文件保留但不读。

## 审计与版本

`.digital-employee/org-audit.jsonl`（org-audit.v1）是唯一组织变更账本，也是 `/reports` 审计流来源。`org.updated` 和 org-tree.v1 的 `updatedAt` 均取成功后重载的引擎应用态时间戳；控制面 `seq` 只作为会话内刷新键。

## 边界

客户端只验证请求形状与目录操作可执行性（重名、缺位、环、owner 裁撤、深度）；预算完整性、岗位包合法性与组织法仍由 digital-employee fail-closed 校验，稳定 `workspace_org_*` 码原样透传。
