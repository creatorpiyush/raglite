import {
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_SCORE_THRESHOLD,
  DEFAULT_STORE_DIRNAME,
  DEFAULT_TOP_K,
} from "./constants.js";
import type {
  EmbeddingProviderConfig,
  LLMProviderConfig,
  VectorStoreProviderConfig,
} from "./types.js";
import type { LogLevel } from "./utils/logger.js";
import type { VectorStore } from "./vectordb/base.js";

export interface DocumentOptions {
  chunkSize?: number;
  overlap?: number;
  topK?: number;
  scoreThreshold?: number;
  storeDir?: string;
  embeddings?: EmbeddingProviderConfig;
  llm?: LLMProviderConfig;
  logLevel?: LogLevel;
  vectorStore?: VectorStoreProviderConfig | VectorStore;
}

export interface ResolvedConfig {
  chunkSize: number;
  overlap: number;
  topK: number;
  scoreThreshold: number;
  storeDir: string;
  embeddings: EmbeddingProviderConfig;
  llm?: LLMProviderConfig;
  logLevel: LogLevel;
  vectorStore: VectorStoreProviderConfig | VectorStore;
}

export function resolveConfig(options: DocumentOptions = {}): ResolvedConfig {
  const storeDir = options.storeDir ?? DEFAULT_STORE_DIRNAME;
  const vectorStore = options.vectorStore ?? {
    provider: "memory",
    storeDir,
  };

  return {
    chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
    overlap: options.overlap ?? DEFAULT_CHUNK_OVERLAP,
    topK: options.topK ?? DEFAULT_TOP_K,
    scoreThreshold: options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD,
    storeDir,
    embeddings: options.embeddings ?? { provider: "local" },
    llm: options.llm,
    logLevel: options.logLevel ?? "info",
    vectorStore,
  };
}
