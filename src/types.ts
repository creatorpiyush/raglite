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

/** Per-retriever scores of a hybrid or keyword search result. */
export interface SearchScores {
  /** Cosine similarity, when the chunk was in the vector results. */
  vector?: number;
  /** BM25 score, when the chunk was in the keyword results. */
  keyword?: number;
  /** Raw Reciprocal Rank Fusion score; `score` is this normalised to [0, 1]. */
  fused?: number;
}

export interface SearchResult {
  id: string;
  text: string;
  metadata: ChunkMetadata;
  /** Cosine similarity in vector mode; normalised fused rank score in keyword and hybrid modes. */
  score: number;
  distance: number;
  /** Set in keyword and hybrid modes. */
  scores?: SearchScores;
}

/**
 * - `vector`: embedding similarity only (the default).
 * - `keyword`: BM25 over chunk texts only; good for exact terms such as error codes or SKUs.
 * - `hybrid`: both, merged with Reciprocal Rank Fusion.
 */
export type RetrievalMode = "vector" | "keyword" | "hybrid";

export interface HybridOptions {
  /** RRF constant; larger values flatten the difference between ranks (default 60). */
  rrfK?: number;
  /** Results taken from each retriever before fusion (default max(50, topK * 4)). */
  candidates?: number;
  /** Relative weight of each retriever in hybrid mode (default 1 each). */
  weights?: { vector?: number; keyword?: number };
}

export interface RetrievalOptions {
  mode?: RetrievalMode;
  hybrid?: HybridOptions;
}

export interface IndexMetadata {
  /** Package version that built the index (informational). */
  version: string;
  /** Index layout version; see INDEX_FORMAT_VERSION. Absent on indexes built before 1.2.2. */
  formatVersion?: number;
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

export type VectorStoreProviderName = "memory" | "qdrant" | "pinecone" | "lancedb";

export interface VectorStoreProviderConfig {
  provider: VectorStoreProviderName;
  storeDir?: string;
  url?: string;
  apiKey?: string;
  indexName?: string;
}
