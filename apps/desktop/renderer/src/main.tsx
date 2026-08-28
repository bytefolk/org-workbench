import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "antd/dist/reset.css";
import "@fullstack-ai-infra/ui/styles.css";
import "@org-workbench/ui/styles.css";
import "./antd-skin.css";
import "./app.css";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("renderer root element missing");

// The antd ConfigProvider (ADR-0002 theme tokens) lives inside <App /> so the
// test harness renders the exact same configuration as production.
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
