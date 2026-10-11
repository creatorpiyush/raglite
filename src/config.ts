import {
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_SCORE_THRESHOLD,
  DEFAULT_STORE_DIRNAME,
  DEFAULT_TOP_K,
} from "./constants.js";
import { type FilterScalar, validateCustomMetadata } from "./retrieval/filter.js";
import type { RerankConfig, Reranker } from "./retrieval/rerank.js";
import type {
  EmbeddingProviderConfig,
  LLMProviderConfig,
  RetrievalOptions,
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
  /** Default retrieval mode and hybrid options for search(), ask() and askStream(). */
  retrieval?: RetrievalOptions;
  /**
   * Your own fields (for example `{ tenant: "acme" }`), added to every search
   * result's metadata and usable in `filter`. Values are strings, numbers or
   * booleans. Changing them needs no rebuild.
   */
  metadata?: Record<string, FilterScalar>;
  /** Default reranker for search(), ask() and askStream(); off unless set. */
  rerank?: RerankConfig | Reranker;
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
  retrieval: RetrievalOptions;
  metadata: Record<string, FilterScalar>;
  rerank?: RerankConfig | Reranker;
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
    retrieval: options.retrieval ?? {},
    metadata: options.metadata === undefined ? {} : validateCustomMetadata(options.metadata),
    ...(options.rerank ? { rerank: options.rerank } : {}),
  };
}
