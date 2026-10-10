import type { EmbeddingProviderName } from "../types.js";

export const DEFAULT_EMBEDDING_MODELS: Record<EmbeddingProviderName, string> = {
  openai: "text-embedding-3-small",
  google: "gemini-embedding-2",
  mistral: "mistral-embed",
  cohere: "embed-english-v3.0",
  voyage: "voyage-3",
  ollama: "nomic-embed-text",
  local: "Xenova/all-MiniLM-L6-v2",
};

/** Models the provider has shut down. An index built with one must be re-embedded. */
export const RETIRED_EMBEDDING_MODELS: Partial<Record<EmbeddingProviderName, readonly string[]>> = {
  google: ["text-embedding-004", "embedding-001"],
};

export function isRetiredEmbeddingModel(provider: EmbeddingProviderName, model: string): boolean {
  return RETIRED_EMBEDDING_MODELS[provider]?.includes(model) ?? false;
}
