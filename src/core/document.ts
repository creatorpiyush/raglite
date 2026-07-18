import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createServer, type ServeOptions, type ServerHandle } from "../api/index.js";
import { RecursiveChunker } from "../chunking/index.js";
import { type DocumentOptions, type ResolvedConfig, resolveConfig } from "../config.js";
import { PACKAGE_VERSION } from "../constants.js";
import { createEmbedder, type Embedder } from "../embeddings/index.js";
import { FileNotIndexedError, LoaderError, RagLiteError } from "../errors.js";
import {
  type AnswerResult,
  generateAnswer,
  type PromptOptions,
  streamAnswer,
} from "../llm/index.js";
import { getLoader } from "../loaders/index.js";
import { Retriever } from "../retrieval/index.js";
import type {
  ChunkMetadata,
  EmbeddingProviderConfig,
  IndexMetadata,
  LLMProviderConfig,
  SearchResult,
  StoredChunk,
} from "../types.js";
import { hashFile, namespaceFromPath } from "../utils/hash.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { MemoryVectorStore } from "../vectordb/index.js";

export interface IndexOptions {
  chunkSize?: number;
  overlap?: number;
  embeddings?: EmbeddingProviderConfig;
  rebuild?: boolean;
}

export interface SearchOptions {
  topK?: number;
  scoreThreshold?: number;
}

export interface AskOptions extends SearchOptions, PromptOptions {
  llm?: LLMProviderConfig;
}

export interface IndexBuildResult {
  chunkCount: number;
  cached: boolean;
  embeddingProvider: string;
  embeddingModel: string;
  dimensions: number | null;
}

/**
 * Main entry point.
 *
 * ```ts
 * const doc = new Document("./policy.pdf", {
 *   embeddings: { provider: "openai", apiKey: process.env.OPENAI_API_KEY },
 *   llm:        { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY },
 * });
 *
 * await doc.build();
 * const answer = await doc.ask("What is the refund policy?");
 * ```
 */
export class Document {
  readonly filePath: string;
  private readonly namespace: string;
  private readonly config: ResolvedConfig;
  private readonly logger: Logger;
  private readonly store: MemoryVectorStore;

  private embedder: Embedder | null = null;
  private ready = false;

  constructor(filePath: string, options: DocumentOptions = {}) {
    this.filePath = resolve(filePath);
    this.config = resolveConfig(options);
    this.logger = createLogger(this.config.logLevel);
    this.namespace = namespaceFromPath(this.filePath);
    this.store = new MemoryVectorStore(this.config.storeDir, this.namespace);
  }

  /**
   * Build (or reuse) the semantic index for this document.
   */
  async build(options: IndexOptions = {}): Promise<IndexBuildResult> {
    if (!existsSync(this.filePath)) {
      throw new LoaderError(`File does not exist: ${this.filePath}`);
    }

    const chunkSize = options.chunkSize ?? this.config.chunkSize;
    const overlap = options.overlap ?? this.config.overlap;
    const embeddingsConfig = options.embeddings ?? this.config.embeddings;

    await this.store.load();
    const existing = await this.store.readIndexMetadata();
    const sourceHash = await hashFile(this.filePath);

    if (
      !options.rebuild &&
      existing &&
      cacheStillValid(existing, {
        sourceHash,
        chunkSize,
        overlap,
        embeddingsConfig,
      })
    ) {
      this.logger.info(`Reusing cached index (${existing.chunkCount} chunks).`);
      this.ready = true;
      this.embedder ??= await createEmbedder(embeddingsConfig);
      return {
        chunkCount: existing.chunkCount,
        cached: true,
        embeddingProvider: existing.embeddingProvider,
        embeddingModel: existing.embeddingModel,
        dimensions: existing.embeddingDimensions,
      };
    }

    this.logger.info("Building new index...");
    await this.store.reset();
    await this.store.load();

    const loader = getLoader(this.filePath);
    const text = await loader.load();
    if (!text) {
      throw new LoaderError(`Loader returned empty text for ${this.filePath}`);
    }

    const chunker = new RecursiveChunker(chunkSize, overlap);
    const chunks = chunker.split(text);
    if (chunks.length === 0) {
      throw new RagLiteError(`No chunks produced from ${this.filePath}`);
    }
    this.logger.info(`Produced ${chunks.length} chunk(s). Embedding...`);

    const embedder = await createEmbedder(embeddingsConfig);
    const vectors = await embedder.embedDocuments(chunks);
    if (vectors.length !== chunks.length) {
      throw new RagLiteError(
        `Embedder returned ${vectors.length} vectors for ${chunks.length} chunks`,
      );
    }

    const source = basename(this.filePath);
    const stored: StoredChunk[] = chunks.map((text, index) => {
      const metadata: ChunkMetadata = {
        source,
        chunk: index + 1,
        totalChunks: chunks.length,
      };
      return {
        id: `${this.namespace}_${(index + 1).toString().padStart(6, "0")}`,
        text,
        embedding: vectors[index]!,
        metadata,
      };
    });

    await this.store.add(stored);

    const metadata: IndexMetadata = {
      version: PACKAGE_VERSION,
      source: this.filePath,
      sourceHash,
      chunkSize,
      overlap,
      embeddingProvider: embedder.provider,
      embeddingModel: embedder.model,
      embeddingDimensions: embedder.dimensions ?? vectors[0]?.length ?? 0,
      chunkCount: chunks.length,
      createdAt: new Date().toISOString(),
    };
    await this.store.saveIndexMetadata(metadata);

    this.embedder = embedder;
    this.ready = true;
    this.logger.info(`Index ready (${chunks.length} chunks).`);

    return {
      chunkCount: chunks.length,
      cached: false,
      embeddingProvider: embedder.provider,
      embeddingModel: embedder.model,
      dimensions: embedder.dimensions,
    };
  }

  /**
   * Semantic search over the indexed document.
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    await this.ensureReady();
    const topK = options.topK ?? this.config.topK;
    const scoreThreshold = options.scoreThreshold ?? this.config.scoreThreshold;
    const retriever = new Retriever(this.embedder!, this.store);
    return retriever.retrieve(query, { topK, scoreThreshold });
  }

  /**
   * RAG question answering. `options.llm` overrides the constructor default.
   */
  async ask(question: string, options: AskOptions = {}): Promise<AnswerResult> {
    const llmConfig = options.llm ?? this.config.llm;
    if (!llmConfig) {
      throw new RagLiteError(
        "No LLM provider configured. Pass one to `ask({ llm: ... })` or `new Document(path, { llm: ... })`.",
      );
    }
    const context = await this.search(question, {
      topK: options.topK ?? this.config.topK,
      scoreThreshold: options.scoreThreshold ?? this.config.scoreThreshold,
    });
    return generateAnswer({
      llm: llmConfig,
      question,
      context,
      includeCitations: options.includeCitations,
      systemHint: options.systemHint,
    });
  }

  /**
   * Streaming RAG answer. Yields text deltas as they arrive.
   */
  async *askStream(question: string, options: AskOptions = {}): AsyncGenerator<string, void, void> {
    const llmConfig = options.llm ?? this.config.llm;
    if (!llmConfig) {
      throw new RagLiteError(
        "No LLM provider configured. Pass one to `askStream({ llm: ... })` or `new Document(path, { llm: ... })`.",
      );
    }
    const context = await this.search(question, {
      topK: options.topK ?? this.config.topK,
      scoreThreshold: options.scoreThreshold ?? this.config.scoreThreshold,
    });
    yield* streamAnswer({
      llm: llmConfig,
      question,
      context,
      includeCitations: options.includeCitations,
      systemHint: options.systemHint,
    });
  }

  /** Number of chunks currently indexed. */
  get chunkCount(): number {
    return this.store.count();
  }

  /** Filesystem namespace under which this document's index is stored. */
  get storeNamespace(): string {
    return this.namespace;
  }

  /** Underlying resolved configuration (readonly view). */
  get resolvedConfig(): Readonly<ResolvedConfig> {
    return this.config;
  }

  /** Underlying vector store (advanced use). */
  get vectorStore(): MemoryVectorStore {
    return this.store;
  }

  /**
   * Launch a REST API server (Hono + Node) exposing this document.
   */
  async serve(options: ServeOptions = {}): Promise<ServerHandle> {
    await this.ensureReady();
    const merged: ServeOptions = { ...options };
    if (!merged.llm && this.config.llm) merged.llm = this.config.llm;
    const handle = await createServer(this, merged);
    this.logger.info(`RagLite server listening on ${handle.url}`);
    return handle;
  }

  private async ensureReady(): Promise<void> {
    if (this.ready && this.embedder) return;

    await this.store.load();
    const existing = await this.store.readIndexMetadata();
    if (!existing) {
      throw new FileNotIndexedError(
        `No RagLite index found for "${this.filePath}". Call build() first.`,
      );
    }
    this.embedder ??= await createEmbedder({
      provider: this.config.embeddings.provider,
      ...(this.config.embeddings.model !== undefined
        ? { model: this.config.embeddings.model }
        : { model: existing.embeddingModel }),
      ...(this.config.embeddings.apiKey !== undefined
        ? { apiKey: this.config.embeddings.apiKey }
        : {}),
      ...(this.config.embeddings.baseURL !== undefined
        ? { baseURL: this.config.embeddings.baseURL }
        : {}),
    });
    this.ready = true;
  }
}

interface CacheCompareInputs {
  sourceHash: string;
  chunkSize: number;
  overlap: number;
  embeddingsConfig: EmbeddingProviderConfig;
}

function cacheStillValid(existing: IndexMetadata, inputs: CacheCompareInputs): boolean {
  if (existing.version !== PACKAGE_VERSION) return false;
  if (existing.sourceHash !== inputs.sourceHash) return false;
  if (existing.chunkSize !== inputs.chunkSize) return false;
  if (existing.overlap !== inputs.overlap) return false;
  if (existing.embeddingProvider !== inputs.embeddingsConfig.provider) return false;

  const requestedModel = inputs.embeddingsConfig.model;
  if (requestedModel !== undefined && requestedModel !== existing.embeddingModel) {
    return false;
  }
  return true;
}
