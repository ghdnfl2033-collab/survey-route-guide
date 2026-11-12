import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// 점검 코드에서도 화면 코드처럼 "@/..." 경로를 쓸 수 있게 한다
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
