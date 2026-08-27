# Issue #35 S3 实机取证（ModuleRail 连线：docs 入口激活 → 岗位文档列表 → DocViewer 浏览）

以 `/tmp` 内 stub CLI（仅应答 `--version` 健康探针，任何其他调用以 exit 2
大声失败）经 `ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI` 注入 loopback 控制面，CDP
（`--remote-debugging-port=9337`）驱动真实 UI，对 DS-35-001 rev-1 §5 S3 的
连线链路逐一取证：rail「文档」入口激活 → 文档模块面（岗位选择器 + S2
DocsPanel）→ 点击文件经 S2 `/docs/read` 白名单桥进入 S1 DocViewer。stub 与
CDP 驱动脚本仅存 /tmp，不入仓库。

启动环境：

```
QODER_PERSONAL_ACCESS_TOKEN=evidence-dummy-token \
ORG_WORKBENCH_DEFAULT_WORKSPACE=/tmp/owb-35s3-ws \
ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI="node /tmp/owb-35s3-stub.mjs" \
npx electron apps/desktop/src/main.js --remote-debugging-port=9337
```

`/tmp/owb-35s3-ws` 为全新工作区（每次取证前 `rm -rf` 后自 examples/oss-maintainer
复制），并在 `positions/repo-owner/handbook.md` 预置带 frontmatter 的样例文档。
`QODER_PERSONAL_ACCESS_TOKEN` 占位值仅用于 host 就绪门禁，stub 不发起任何真实
模型调用。文档模块全部消费 S2 既有 `/docs/list`、`/docs/read` 白名单桥，不立新通道。

## 01-rail-before.png（连线前基线）

- 组织树已选中 repo-owner（`aria-selected="true"`），内容区仍为组织模块；
- rail「文档」项此时 `aria-current=null`，断言基线为占位态。

## 02-docs-module-list.png（AC-1/AC-2：入口激活 + 列表呈现）

- 物理点击 rail「文档」后该项 `aria-current="page"`，内容区切换为
  `section[aria-label="文档模块"]`；
- 岗位选择器跟随组织树选择落位「Repo Owner」（组织树选择同步进文档模块）；
- 经 `/docs/list` 呈现 29 个文件条目（含样例 `handbook.md`），列表项为
  `aria-pressed` 按钮，S2 路由面零改动复用。

## 03-doc-viewer.png（AC-2：DocViewer 浏览 + 文件级版本）

- 点击 `handbook.md` 后经 `/docs/read` 进入 S1 DocViewer：标题行 `handbook.md`
  + 右侧文件级版本 tag「版本 2026-08-27T04:13:18.048Z」；
- frontmatter 描述元信息「仓库负责人岗位手册（S3 取证样例文档）」渲染于 meta 行；
  frontmatter `name` 不显示属 S1 既定语义（显式 title 优先于 frontmatter name，
  见 doc-viewer 测试「prefers an explicit title over the frontmatter name」）；
- 正文「岗位手册 / 职责」markdown 正常渲染。

## 回归与禁区

- rail 五项目标态：组织/群聊/上报/记忆保持原行为，仅「文档」active；记忆仍为占位；
- S4 创建+引用面无任何入口（全文无「新建文档」），frozen scope 未破。

CDP 断言时间线（全文见 timeline.txt）：

```
rail docs entry before click: aria-current=null
org tree repo-owner selected (aria-selected=true)
docs module active: aria-current=page + region[aria-label=文档模块] present
docs list rendered via /docs/list: 29 files incl handbook.md
DocViewer facts: {"hasFrontmatterName":false,"hasFrontmatterDescription":true,"hasVersion":true,"hasBody":true}
rail regression: ["组织","群聊","上报","记忆","文档(active)"]
S4 surface absent (no 新建文档 entry): true
```
