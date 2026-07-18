import { describe, expect, it } from "vitest";
import { DEFAULT_EMBEDDING_MODELS } from "../../src/embeddings/models.js";
import { DEFAULT_LLM_MODELS } from "../../src/llm/models.js";

describe("DEFAULT_LLM_MODELS", () => {
  it("has an entry for every declared LLM provider", () => {
    const providers = [
      "openai",
      "anthropic",
      "google",
      "mistral",
      "cohere",
      "groq",
      "xai",
      "ollama",
    ] as const;
    for (const p of providers) {
      expect(DEFAULT_LLM_MODELS[p]).toBeTruthy();
    }
  });
});

describe("DEFAULT_EMBEDDING_MODELS", () => {
  it("has an entry for every declared embedding provider", () => {
    const providers = [
      "openai",
      "google",
      "mistral",
      "cohere",
      "voyage",
      "ollama",
      "local",
    ] as const;
    for (const p of providers) {
      expect(DEFAULT_EMBEDDING_MODELS[p]).toBeTruthy();
    }
  });
});
