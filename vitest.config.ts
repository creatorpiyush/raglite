import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/index.ts",
        "src/cli.ts",
        "src/embeddings/local.ts",
        "src/embeddings/remote.ts",
        "src/loaders/pdf.ts",
        "src/loaders/docx.ts",
        "src/llm/factory.ts",
      ],
    },
  },
});
