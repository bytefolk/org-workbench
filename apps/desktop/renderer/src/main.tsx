import React from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "antd/dist/reset.css";
import "@fullstack-ai-infra/ui/styles.css";
import "@org-workbench/ui/styles.css";
import "./antd-skin.css";
import "./app.css";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("renderer root element missing");

// ADR-0002: Ant Design is the shared design language; token values are antd
// official palette values, consumed via ConfigProvider — no ad-hoc theming.
createRoot(root).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#1677FF",
          colorSuccess: "#52C41A",
          colorWarning: "#FAAD14",
          colorError: "#FF4D4F",
          colorInfo: "#1677FF",
          borderRadius: 6,
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
