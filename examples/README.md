# examples/oss-maintainer

示例工作区：开源维护者组织（1 owner + 3 岗位），与 #163 展示同源形状。

生成方式（保证与引擎契约同源）：

1. 用支持目录组织契约的 digital-employee CLI 物化骨架：`digital-employee workspace init examples/oss-maintainer --template oss-maintainer`；
2. `positions/repo-owner/` 下嵌套三个下属岗位，父子目录即汇报线；
3. 每个岗位目录携带 `budget.json`：repo-owner 为 perTask 40,000 tokens / 12 iterations、perDay 400,000 / 96；其余岗位为 perTask 20,000 / 8、perDay 200,000 / 64。

本目录已用 digital-employee `7a92690` 的 `org apply <workspace> --json` 做镜像核对：首次 apply 识别 4 个岗位、无虚假 move，并生成 0600 的应用态三文件。

用途：`POST /workspace/open` 指向本目录可复现 org-tree.v1；`POST /org/apply` 可验证目录提案闭环。
