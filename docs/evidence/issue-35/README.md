# Issue #35 实机取证（S3 ModuleRail 连线 + S4 创建+引用面）

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

---

# S4：创建+引用面（DS-35-001 rev-1 §5/§6：最小创建 + doc-ref 落 shared + 解析器三态）

同 S3 口径：`/tmp/owb-35s4-stub.mjs` 仅应答 `--version` 健康探针，
`ORG_WORKBENCH_DEFAULT_WORKSPACE=/tmp/owb-35s4-ws` 全新工作区（取证前 `rm -rf`
后自 examples/oss-maintainer 复制），CDP 端口 9337。

```
ORG_WORKBENCH_DEFAULT_WORKSPACE=/tmp/owb-35s4-ws \
ORG_WORKBENCH_DIGITAL_EMPLOYEE_CLI=/tmp/owb-35s4-stub.mjs \
npx electron apps/desktop/src/main.js --remote-debugging-port=9337
```

## 04-create-modal.png（创建入口：仅命名，首版无编辑器）

- 文档模块出现「新建文档」入口，弹出创建弹窗：仅文件名输入 + 提示「首版无编辑器」，
  与冻结口径一致（创建 = 命名 + 落盘，内容为空串）。

## 05-created-list.png（AC-001：创建成功 + 重列）

- 创建 `runbook.md` 经 `/docs/create` 落盘，成功 toast 后 `reloadToken` 触发
  `/docs/list` 重列，新文件即刻可见；不依赖任何新通道，S2 列举桥原样复用。

## 06-copy-ref.png（doc-ref 冻结形状复制）

- 每文件「复制引用」动作写入剪贴板的冻结 JSON 实测：
  `{"uri":"owb-doc://repo-owner/handbook.md","version":"2026-08-27T05:14:52.050Z"}`，
  即 doc-ref.v1alpha1 `{uri, version}`（anchor 缺省不出面）。

## 07-conflict.png（409 docs_exists：创建永不覆写）

- 对已存在的 `handbook.md` 再次创建，服务端返回 409 `docs_exists`，
  弹窗内原文呈现 `document already exists`，原文件不被覆写。

## 08-resolve-ok.png（AC-002：解析三态之成功态）

- 解析引用面粘贴 `{"uri":"owb-doc://repo-owner/SKILL.md"}`，解析成功后呈现
  「解析成功：repo-owner/SKILL.md」+ 「大小 499 字节 · 更新于 2026-08-27T05:14:52.031Z」；
- 缺失态/无效态同面取证：粘贴 `https://elsewhere/SKILL.md` 后服务端
  `doc_ref_invalid` 消息（含 `'owb-doc://<positionId>/<path>'` 格式提示）原文上屏。

## 落盘事实（创建即契约：asset-record.v1 对齐 #36）

- `positions/repo-owner/runbook.md` 权限 0600；
- drive 目录链 `.digital-employee/workbench/drive/assets/<assetId>` 全部 0700；
- `assets/aadf7233-40c4-465e-83ed-c9cb32d9f46b/record.json` 键集严格等于
  asset-record.v1 exactKeys（assetId、createdAt、docRef、kind、schemaVersion、
  sourceRef、title），`docRef` 为冻结 doc-ref.v1alpha1；
- `asset-index.json`（asset-index.v1alpha1）追加同条记录，#36 硬门禁所依赖的
  drive 布局就此成型。

CDP 断言时间线（S4 段，全文见 timeline.txt）：

```
org tree repo-owner selected
docs module active; S2 list shows 29 files
create modal open (naming-only; hint 首版无编辑器)
created runbook.md via /docs/create; re-listed via /docs/list; toast=true
copied doc-ref (frozen shape): {"uri":"owb-doc://repo-owner/handbook.md","version":"2026-08-27T05:14:52.050Z"}
409 docs_exists surfaced in-modal (document already exists); creation never overwrites
resolve ok face: {"ok":true,"size":"499","modifiedAt":"2026-08-27T05:14:52.031Z"}
resolve invalid face: doc_ref_invalid server message surfaced verbatim
```
