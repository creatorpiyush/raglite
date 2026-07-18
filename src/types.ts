export type LLMProviderName =
  | "openai"
  | "anthropic"
  | "google"
  | "mistral"
  | "cohere"
  | "groq"
  | "xai"
  | "ollama";

export type EmbeddingProviderName =
  | "openai"
  | "google"
  | "mistral"
  | "cohere"
  | "voyage"
  | "ollama"
  | "local";

export interface LLMProviderConfig {
  provider: LLMProviderName;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderName;
  model?: string;
  apiKey?: string;
  baseURL?: string;
}

export interface ChunkMetadata {
  source: string;
  chunk: number;
  totalChunks: number;
  [key: string]: unknown;
}

export interface StoredChunk {
  id: string;
  text: string;
  embedding: number[];
  metadata: ChunkMetadata;
}

export interface SearchResult {
  id: string;
  text: string;
  metadata: ChunkMetadata;
  score: number;
  distance: number;
}

export interface IndexMetadata {
  version: string;
  source: string;
  sourceHash: string;
  chunkSize: number;
  overlap: number;
  embeddingProvider: EmbeddingProviderName;
  embeddingModel: string;
  embeddingDimensions: number;
  chunkCount: number;
  createdAt: string;
}
