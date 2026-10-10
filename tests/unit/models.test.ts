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

// Model IDs the providers have shut down; a default must never be one of these.
const RETIRED = [
  "claude-3-5-sonnet-20241022",
  "gemini-2.0-flash",
  "text-embedding-004",
  "command-r-plus",
  "llama-3.3-70b-versatile",
  "grok-2-latest",
];

describe("default models", () => {
  it("uses no retired model IDs", () => {
    const defaults = [
      ...Object.values(DEFAULT_LLM_MODELS),
      ...Object.values(DEFAULT_EMBEDDING_MODELS),
    ];
    for (const id of RETIRED) expect(defaults).not.toContain(id);
  });
});
