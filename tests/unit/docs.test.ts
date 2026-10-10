import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_EMBEDDING_MODELS } from "../../src/embeddings/models.js";
import { DEFAULT_LLM_MODELS } from "../../src/llm/models.js";

// Changing a default model must update the docs site in the same release.
const page = readFileSync(
  new URL("../../docs/src/content/docs/providers.mdx", import.meta.url),
  "utf8",
);
const [, llmSection = "", embeddingSection = ""] = page.split(/^## (?:LLMs|Embeddings)$/m);

function row(section: string, provider: string): string {
  return section.split("\n").find((line) => line.includes(`| \`${provider}\` |`)) ?? "";
}

describe("docs/providers.mdx", () => {
  it.each(Object.entries(DEFAULT_LLM_MODELS))("lists the %s LLM default", (provider, model) => {
    expect(row(llmSection, provider)).toContain(`\`${model}\``);
  });

  it.each(Object.entries(DEFAULT_EMBEDDING_MODELS))(
    "lists the %s embedding default",
    (provider, model) => {
      expect(row(embeddingSection, provider)).toContain(`\`${model}\``);
    },
  );
});
