# examples/oss-maintainer

示例工作区：开源维护者组织（1 owner + 3 岗位），与 #163 展示同源形状。

生成方式（保证与引擎契约同源，不手写）：

1. 用 digital-employee 钉版 CLI 物化骨架：`digital-employee workspace init examples/oss-maintainer --template oss-maintainer`（origin/main @ #166）；
2. 注入 #157 R3 批准的预算声明（DEC-DE-157-002；V1 设计数值）：`organization.v1alpha1.json` 各岗位补 `budget`（repo-owner：perTask 40,000 tokens / 12 iterations、perDay 400,000 tokens / 96 iterations；其余三岗位：perTask 20,000 / 8、perDay 200,000 / 64）。

待 digital-employee V1（#157 切片 V1：schema 预算扩展 + 模板补预算）合入后，本目录用钉版 CLI 重新生成一次以完成镜像核对，不手改。

用途：`POST /workspace/open` 指向本目录即可复现 D0 验收第 4 条（org-tree.v1 快照）。
