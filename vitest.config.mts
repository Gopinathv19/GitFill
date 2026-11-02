import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // tsconfig keeps JSX for Next.js ("preserve"); tests compile it themselves.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
