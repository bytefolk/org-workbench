import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    globals: true,
    environment: "jsdom",
    setupFiles: [fileURLToPath(new URL("./test/setup.ts", import.meta.url))],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
