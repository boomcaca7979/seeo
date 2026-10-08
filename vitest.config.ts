import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", ".next"],
    // 站内有若干「遍历整个 src 目录逐文件读取」的契约测试（ui-refresh / email 收口 /
    // leads 与 cases 的访问控制守卫）。仓库文件数增长后，单次遍历在满并发下会超过
    // vitest 默认的 5s。这里放宽上限（不改任何断言）：真实超时仍会在 20s 暴露。
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});
