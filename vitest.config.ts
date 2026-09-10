import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // 対象は純粋ロジックの単体テストのみ。DOM/ネットワークが要る箇所は対象外。
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
