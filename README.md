# org-workbench

**文件树即组织架构。** 加目录 = 招聘（必配预算），移动目录 = 改汇报线，删除 = 裁撤（留痕归档）。

org-workbench 是 [digital-employee](https://github.com/fullstack-ai-infra/digital-employee) 工作区的组织工作台：Electron 桌面壳 + 本地控制面服务，围绕组织树提供只读视图、结构变更（经引擎校验的 staging + 原子发布）与上报中心。macOS 首版聚焦组织树完整闭环；web/移动端未来同仓复用同一控制面与契约。

## 当前状态：D0 骨架

- 壳-服务分离：Electron main 拉起 `apps/server`（Node，仅 127.0.0.1，每启动随机 boot-token）；控制面可脱离壳独立运行。
- 引擎消费：spawn 钉版 `digital-employee` CLI（ADR-0002）；`/health` 报告引擎可用性与下一步。
- `org apply`：staging 暂存 → 引擎校验 → rename 原子发布；失败留档 `rejected/`，裁撤归档 `archive/`，全程不硬删除（ADR-0003）。
- API 契约 v0 已冻结：见 [`docs/api-contract-v0.md`](docs/api-contract-v0.md)（8 端点全量；新增走增量，破坏性变更升 v1）。
- 里程碑：D0 骨架 → D1 组织树只读 → D2 拖拽/预算闭环 → D3 @岗位对话 → D4 上报中心。

## 快速开始

```bash
npm install          # 根目录（npm workspaces）
npm run build        # tsc -b（strict）
npm run check        # 构建 + 全量测试（node --test）
```

**壳-服务分离实证（控制面独立运行）**：

```bash
npm run dev:server
# stdout 打印：org-workbench-server ready {"port":N,"api":"v0","token":"..."}
curl -s http://127.0.0.1:N/health                                   # 免 token 探活
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:N/workspace
curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -d '{"path":"examples/oss-maintainer"}' http://127.0.0.1:N/workspace/open
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:N/org/tree
```

**桌面壳**（需 `npm install` 安装 Electron 后）：`npm run dev:desktop`。

**引擎指针**：开发期以 `ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI` 指向钉版入口，例如
`node <repo>/digital-employee/dist/apps/cli/bin.js`；引擎 `org apply`（#157 切片 V2）落地前，`/org/apply` 如实返回 `engine_capability_missing`（503）。

## 仓库结构

```
apps/desktop/        Electron 壳：main + preload 白名单桥 + renderer（D0 零依赖渲染）
apps/server/         本地控制面服务（零第三方运行时依赖，纯 node: 内建）
packages/shared/     契约类型镜像：org-tree.v1 / change-manifest.v1 / 错误码 / SSE 事件
packages/ui/         组织树组件族（D1 起消费 design-system；React）
docs/                API 契约 v0（冻结）+ ADR
examples/            oss-maintainer 示例工作区（1 owner + 3 岗位，含预算声明）
```

## 安全基线（随契约冻结）

- 控制面仅绑 127.0.0.1 + 每启动随机 token；除 `/health` 外无 token 一律 401。
- renderer：contextIsolation 开、nodeIntegration 关、sandbox 开；preload 白名单枚举 6 个方法，无通用通道；CSP 全 `'self'`，无第三方 CDN、无远程代码。
- 凭据边界：密钥只经 env 注入引擎子进程；boot-token 只经父子进程 stdout 管道，不进文件/日志。

## 契约镜像纪律

`packages/shared` 逐字段镜像 digital-employee 契约（单一来源），客户端不自造语义；冲突时以 digital-employee 契约为准（产品提请、技术执行）。变更清单与错误码透传规则见契约文档第 2.5/3 节。

## 开发纪律

clean-room（ADR-0004）：代码全原创，竞品仅借形态不搬代码。PR 带追溯表：验收项 ↔ 实现 ↔ 测试证据。里程碑推进以验收清单为准，不以功能罗列为准。

## 许可

Apache-2.0（见 [LICENSE](LICENSE)）。
