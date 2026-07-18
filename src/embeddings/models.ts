import type { EmbeddingProviderName } from "../types.js";

export const DEFAULT_EMBEDDING_MODELS: Record<EmbeddingProviderName, string> = {
  openai: "text-embedding-3-small",
  google: "text-embedding-004",
  mistral: "mistral-embed",
  cohere: "embed-english-v3.0",
  voyage: "voyage-3",
  ollama: "nomic-embed-text",
  local: "Xenova/all-MiniLM-L6-v2",
};
