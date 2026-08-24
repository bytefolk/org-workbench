import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    globals: true,
    environment: "jsdom",
    setupFiles: [fileURLToPath(new URL("./renderer/test/setup.ts", import.meta.url))],
    include: ["renderer/test/**/*.test.ts", "renderer/test/**/*.test.tsx"],
  },
});
