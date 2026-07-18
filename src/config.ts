import {
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_SCORE_THRESHOLD,
  DEFAULT_STORE_DIRNAME,
  DEFAULT_TOP_K,
} from "./constants.js";
import type { EmbeddingProviderConfig, LLMProviderConfig } from "./types.js";
import type { LogLevel } from "./utils/logger.js";

export interface DocumentOptions {
  chunkSize?: number;
  overlap?: number;
  topK?: number;
  scoreThreshold?: number;
  storeDir?: string;
  embeddings?: EmbeddingProviderConfig;
  llm?: LLMProviderConfig;
  logLevel?: LogLevel;
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
}

export function resolveConfig(options: DocumentOptions = {}): ResolvedConfig {
  return {
    chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
    overlap: options.overlap ?? DEFAULT_CHUNK_OVERLAP,
    topK: options.topK ?? DEFAULT_TOP_K,
    scoreThreshold: options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD,
    storeDir: options.storeDir ?? DEFAULT_STORE_DIRNAME,
    embeddings: options.embeddings ?? { provider: "local" },
    llm: options.llm,
    logLevel: options.logLevel ?? "info",
  };
}
