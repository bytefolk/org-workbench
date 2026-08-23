// D0 renderer — talks exclusively through the whitelisted window.owb bridge.
// No direct network access (CSP connect-src 'self'), no secrets, no remote code.

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function kv(container, key, value) {
  const row = el("div", "kv");
  row.appendChild(el("span", "k", key));
  row.appendChild(document.createTextNode(String(value)));
  container.appendChild(row);
}

async function renderStatus() {
  const box = $("status-body");
  box.textContent = "";
  const status = await window.owb.status();
  if (!status.running) {
    box.appendChild(el("span", "pill err", "控制面未运行"));
    box.appendChild(el("p", "", status.error ? `原因：${status.error}` : ""));
    const steps = el("div");
    steps.appendChild(el("strong", "", "可执行的下一步："));
    const list = el("ul");
    for (const step of status.nextSteps ?? []) list.appendChild(el("li", "", step));
    box.appendChild(steps);
    box.appendChild(list);
    return;
  }
  box.appendChild(el("span", "pill ok", "运行中"));
  kv(box, "端口", `127.0.0.1:${status.port}`);
  const health = status.health;
  if (!health) {
    kv(box, "健康检查", `失败：${status.error ?? "未知错误"}`);
    return;
  }
  kv(box, "API 契约", health.api);
  kv(box, "服务版本", health.server?.version ?? "?");
  if (health.engine?.available) {
    kv(box, "引擎（钉版 CLI）", `可用 · ${health.engine.version ?? ""}`);
  } else {
    box.appendChild(el("span", "pill warn", "引擎不可用"));
    if (health.engine?.nextStep) kv(box, "下一步", health.engine.nextStep);
  }
}

async function renderWorkspace() {
  const box = $("workspace-body");
  box.textContent = "";
  const res = await window.owb.workspace();
  const info = res?.body;
  if (!info || info.open !== true) {
    box.textContent = "尚未打开工作区";
    return;
  }
  box.appendChild(el("span", "pill ok", "已打开"));
  kv(box, "路径", info.path);
  kv(box, "业务", info.business ?? "?");
  kv(box, "版本戳", `seq=${info.version?.seq ?? "?"} · ${info.updatedAt ?? info.version?.updatedAt ?? ""}`);
}

async function renderTree() {
  const box = $("tree-body");
  box.textContent = "";
  const res = await window.owb.orgTree();
  const snapshot = res?.body;
  if (!snapshot || res.status !== 200) {
    box.textContent = "打开工作区后显示";
    return;
  }
  const byParent = new Map();
  for (const position of snapshot.positions ?? []) {
    const key = position.reportTo ?? "";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(position);
  }
  const renderLevel = (parentId) => {
    const ul = el("ul", "tree");
    for (const position of byParent.get(parentId) ?? []) {
      const li = el("li");
      const node = el("div", "node");
      const title = el("span", "title", position.name);
      const meta = el(
        "div",
        "meta",
        `${position.id} · ${position.mode}${position.budget ? " · 预算已声明" : " · 预算缺失"}`,
      );
      node.appendChild(title);
      node.appendChild(meta);
      li.appendChild(node);
      const children = renderLevel(position.id);
      if (children.childElementCount > 0) li.appendChild(children);
      ul.appendChild(li);
    }
    return ul;
  };
  box.appendChild(renderLevel(""));
  kv(box, "快照版本", `seq=${snapshot.version?.seq ?? "?"}`);
}

function pushEvent(event) {
  const list = $("events-body");
  const item = el(
    "li",
    "",
    `#${event.seq ?? "?"} ${event.type ?? "event"} · ${event.at ?? ""} ${JSON.stringify(event.payload ?? {})}`,
  );
  list.prepend(item);
  while (list.childElementCount > 50) list.lastChild.remove();
}

async function refreshAll() {
  await Promise.allSettled([renderStatus(), renderWorkspace(), renderTree()]);
}

$("refresh-status").addEventListener("click", refreshAll);
$("open-workspace").addEventListener("click", async () => {
  await window.owb.openWorkspace();
  await refreshAll();
});

window.owb.onEvent((event) => {
  pushEvent(event);
  if (event.type === "org.updated") {
    void Promise.allSettled([renderWorkspace(), renderTree()]);
  }
});

void refreshAll();
