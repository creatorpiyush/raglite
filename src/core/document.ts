import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createServer, type ServeOptions, type ServerHandle } from "../api/index.js";
import { RecursiveChunker } from "../chunking/index.js";
import { type DocumentOptions, type ResolvedConfig, resolveConfig } from "../config.js";
import {
  DEFAULT_STORE_DIRNAME,
  INDEX_FORMAT_VERSION,
  LEGACY_FORMAT_1_VERSIONS,
  PACKAGE_VERSION,
} from "../constants.js";
import { createEmbedder, type Embedder } from "../embeddings/index.js";
import { FileNotIndexedError, LoaderError, RagLiteError } from "../errors.js";
import {
  type AnswerResult,
  generateAnswer,
  type PromptOptions,
  streamAnswer,
} from "../llm/index.js";
import { getLoader, isUrl } from "../loaders/index.js";
import { type RankedList, reciprocalRankFusion } from "../retrieval/fusion.js";
import {
  type KeywordHit,
  KeywordIndex,
  keywordFileMatches,
  readKeywordFile,
  writeKeywordFile,
} from "../retrieval/keyword-index.js";
import { type RetrievalPlan, resolveRetrievalPlan } from "../retrieval/plan.js";
import { Retriever } from "../retrieval/retriever.js";
import { hasUnspacedText } from "../text/scripts.js";
import type {
  ChunkMetadata,
  EmbeddingProviderConfig,
  HybridOptions,
  IndexMetadata,
  LLMProviderConfig,
  RetrievalMode,
  SearchResult,
  StoredChunk,
} from "../types.js";
import { hashFile, hashString, namespaceFromPath } from "../utils/hash.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { createVectorStore, type VectorStore } from "../vectordb/index.js";

export interface IndexOptions {
  /** Defaults to the constructor option, then to the existing index's value, then to 500. */
  chunkSize?: number;
  /** Defaults to the constructor option, then to the existing index's value, then to 50. */
  overlap?: number;
  /** Defaults to the constructor option, then to the existing index's provider and model, then to local. */
  embeddings?: EmbeddingProviderConfig;
  rebuild?: boolean;
}

export interface SearchOptions {
  topK?: number;
  /** Minimum cosine similarity. In hybrid mode it filters the vector results before fusion. */
  scoreThreshold?: number;
  /** Overrides the `retrieval.mode` default (which is "vector"). */
  mode?: RetrievalMode;
  hybrid?: HybridOptions;
}

/** @internal Candidate lists of one document, before fusion. */
export interface RetrievalCandidates {
  vector: SearchResult[];
  /** null when the document has no keyword index (a warning has been logged). */
  keyword: KeywordHit[] | null;
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
  private readonly store: VectorStore;
  /** Sidecar file holding the BM25 keyword index; see retrieval/keyword-index.ts. */
  private readonly keywordPath: string;
  /** Chunking the caller set in the constructor; unset values follow the existing index. */
  private readonly chunking: { chunkSize?: number; overlap?: number };
  /** Embeddings the caller set in the constructor; if unset, an existing index keeps its own. */
  private readonly explicitEmbeddings?: EmbeddingProviderConfig;

  private embedder: Embedder | null = null;
  private ready = false;
  private keywordIndex: KeywordIndex | null = null;
  private keywordUnavailableWarned = false;

  constructor(filePath: string, options: DocumentOptions = {}) {
    this.filePath = isUrl(filePath) ? filePath : resolve(filePath);
    this.config = resolveConfig(options);
    this.logger = createLogger(this.config.logLevel);
    this.namespace = namespaceFromPath(this.filePath);

    if (typeof this.config.vectorStore === "object" && "provider" in this.config.vectorStore) {
      this.store = createVectorStore(this.config.vectorStore, this.namespace);
    } else {
      this.store = this.config.vectorStore;
    }
    this.keywordPath = join(keywordBaseDir(this.config), this.namespace, "keyword.json");
    this.chunking = { chunkSize: options.chunkSize, overlap: options.overlap };
    this.explicitEmbeddings = options.embeddings;
  }

  /**
   * Build (or reuse) the semantic index for this document.
   */
  async build(options: IndexOptions = {}): Promise<IndexBuildResult> {
    if (!isUrl(this.filePath) && !existsSync(this.filePath)) {
      throw new LoaderError(`File does not exist: ${this.filePath}`);
    }

    await this.store.load();
    const existing = await this.store.readIndexMetadata();
    // Likewise an unconfigured embedding provider keeps the existing index's
    // provider and model rather than switching it to the local default.
    const embeddingsConfig =
      options.embeddings ??
      this.explicitEmbeddings ??
      (existing ? queryEmbeddingsConfig(existing, this.config.embeddings) : this.config.embeddings);
    // Chunking nobody asked for keeps the existing index's values, so a
    // plain build() (for example from `raglite search`) does not re-embed an
    // index that was built with a custom chunk size.
    const chunkSize =
      options.chunkSize ?? this.chunking.chunkSize ?? existing?.chunkSize ?? this.config.chunkSize;
    const overlap =
      options.overlap ?? this.chunking.overlap ?? existing?.overlap ?? this.config.overlap;
    // Web pages change without their URL changing, so fingerprint the
    // fetched content rather than the URL.
    let text: string | null = null;
    if (isUrl(this.filePath)) {
      text = await getLoader(this.filePath).load();
    }
    const sourceHash = text !== null ? hashString(text) : await hashFile(this.filePath);

    let reusable =
      !options.rebuild &&
      existing !== null &&
      cacheKeyMatches(existing, { sourceHash, chunkSize, overlap, embeddingsConfig });
    if (reusable && existing && indexFormatVersion(existing) !== INDEX_FORMAT_VERSION) {
      // Format 2 only changed how unspaced scripts are chunked, so a format-1
      // index of a source without such text is still exact: upgrade it in
      // place instead of paying to re-embed it.
      text ??= await getLoader(this.filePath).load();
      reusable = indexFormatVersion(existing) === 1 && !hasUnspacedText(text);
      if (reusable) {
        await this.store.saveIndexMetadata({ ...existing, formatVersion: INDEX_FORMAT_VERSION });
      }
    }

    if (reusable && existing) {
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
    this.keywordIndex = null;
    await this.store.reset();
    await this.store.load();

    text ??= await getLoader(this.filePath).load();
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

    const source = isUrl(this.filePath) ? this.filePath : basename(this.filePath);
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
      formatVersion: INDEX_FORMAT_VERSION,
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
    await this.saveKeywordIndex(KeywordIndex.build(stored), metadata);

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
   * Search the indexed document. `mode` picks vector (default), keyword or
   * hybrid retrieval.
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const plan = this.retrievalPlan(options);
    if (plan.mode === "vector") {
      await this.ensureReady();
      return this.vectorSearch(query, plan.topK, plan.scoreThreshold);
    }
    const { vector, keyword } = await this.retrieveCandidates(query, plan);
    if (keyword === null) return vector.slice(0, plan.topK);
    return reciprocalRankFusion(fusionLists(plan, { vector, keyword }), plan.rrfK, plan.topK);
  }

  /** @internal Resolves search options against this document's defaults. */
  retrievalPlan(options: SearchOptions): RetrievalPlan {
    return resolveRetrievalPlan(
      this.config.retrieval,
      options,
      options.topK ?? this.config.topK,
      options.scoreThreshold ?? this.config.scoreThreshold,
    );
  }

  /**
   * @internal The vector and keyword candidate lists for a keyword or hybrid
   * search, before fusion. DocumentCollection fuses these across documents.
   * Without a keyword index the vector list is returned for every mode, so
   * the caller can fall back to vector search.
   */
  async retrieveCandidates(query: string, plan: RetrievalPlan): Promise<RetrievalCandidates> {
    await this.ensureReady();
    const keyword = await this.keywordSearch(query, plan.candidates);
    const needVector = keyword === null || (plan.mode === "hybrid" && plan.weights.vector > 0);
    const vector = needVector
      ? await this.vectorSearch(
          query,
          keyword === null ? plan.topK : plan.candidates,
          plan.scoreThreshold,
        )
      : [];
    return { vector, keyword };
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
    const context = await this.search(question, searchOptionsOf(options));
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
    const context = await this.search(question, searchOptionsOf(options));
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
  get vectorStore(): VectorStore {
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

  private async vectorSearch(
    query: string,
    topK: number,
    scoreThreshold: number,
  ): Promise<SearchResult[]> {
    const retriever = new Retriever(this.embedder!, this.store);
    return retriever.retrieve(query, { topK, scoreThreshold });
  }

  /** BM25 (or the store's native) keyword search; null when no keyword index exists. */
  private async keywordSearch(query: string, topK: number): Promise<KeywordHit[] | null> {
    if (this.store.keywordSearch) {
      const hits = await this.store.keywordSearch(query, topK);
      return hits.map(({ id, text, metadata, score }) => ({ id, text, metadata, score }));
    }
    const index = await this.loadKeywordIndex();
    return index ? index.search(query, topK) : null;
  }

  private async loadKeywordIndex(): Promise<KeywordIndex | null> {
    if (this.keywordIndex) return this.keywordIndex;
    const metadata = await this.store.readIndexMetadata();
    if (!metadata) return null;

    const file = await readKeywordFile(this.keywordPath);
    if (file && keywordFileMatches(file, metadata)) {
      this.keywordIndex = KeywordIndex.fromFile(file);
      return this.keywordIndex;
    }

    // Indexes built before 1.3, or a sidecar left behind on another machine:
    // rebuild from the stored chunk texts, which needs no embedding calls.
    if (this.store.listChunks) {
      const chunks = await this.store.listChunks();
      if (chunks.length === metadata.chunkCount) {
        this.logger.info(`Building keyword index from ${chunks.length} stored chunk(s).`);
        const index = KeywordIndex.build(chunks);
        await this.saveKeywordIndex(index, metadata);
        return index;
      }
    }

    if (!this.keywordUnavailableWarned) {
      this.keywordUnavailableWarned = true;
      this.logger.warn(
        `No keyword index for "${this.filePath}" (expected ${this.keywordPath}); ` +
          "using vector search. Run build({ rebuild: true }) to enable keyword and hybrid search.",
      );
    }
    return null;
  }

  private async saveKeywordIndex(index: KeywordIndex, metadata: IndexMetadata): Promise<void> {
    this.keywordIndex = index;
    try {
      await writeKeywordFile(this.keywordPath, index.toFile(metadata));
    } catch (err) {
      // The vector index is already saved; keyword search still works in this
      // process and will be rebuilt or reported the next time it is needed.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not save keyword index to ${this.keywordPath}: ${message}`);
    }
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
    this.embedder ??= await createEmbedder(queryEmbeddingsConfig(existing, this.config.embeddings));
    this.ready = true;
  }
}

/**
 * Queries must be embedded with the same provider and model as the index,
 * which may differ from the constructor default when `build({ embeddings })`
 * overrode it. Credentials from the configured provider are reused when it
 * matches; otherwise the provider falls back to its environment variables.
 */
function queryEmbeddingsConfig(
  existing: IndexMetadata,
  configured: EmbeddingProviderConfig,
): EmbeddingProviderConfig {
  const config: EmbeddingProviderConfig = {
    provider: existing.embeddingProvider,
    model: existing.embeddingModel,
  };
  if (configured.provider === existing.embeddingProvider) {
    if (configured.apiKey !== undefined) config.apiKey = configured.apiKey;
    if (configured.baseURL !== undefined) config.baseURL = configured.baseURL;
  }
  return config;
}

interface CacheCompareInputs {
  sourceHash: string;
  chunkSize: number;
  overlap: number;
  embeddingsConfig: EmbeddingProviderConfig;
}

/** Indexes written before `formatVersion` existed are identified by package version. */
export function indexFormatVersion(metadata: IndexMetadata): number | null {
  if (typeof metadata.formatVersion === "number") return metadata.formatVersion;
  return LEGACY_FORMAT_1_VERSIONS.has(metadata.version) ? 1 : null;
}

/** Everything in the cache key except the index format, which build() checks separately. */
function cacheKeyMatches(existing: IndexMetadata, inputs: CacheCompareInputs): boolean {
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

/** The candidate lists to fuse for a keyword or hybrid plan. */
export function fusionLists(
  plan: RetrievalPlan,
  candidates: { vector: SearchResult[]; keyword: KeywordHit[] },
): RankedList[] {
  if (plan.mode === "keyword") {
    return [{ name: "keyword", weight: 1, hits: candidates.keyword }];
  }
  return [
    { name: "vector", weight: plan.weights.vector, hits: candidates.vector },
    { name: "keyword", weight: plan.weights.keyword, hits: candidates.keyword },
  ];
}

/** The retrieval-related subset of ask() options. */
export function searchOptionsOf(options: SearchOptions): SearchOptions {
  const out: SearchOptions = {};
  if (options.topK !== undefined) out.topK = options.topK;
  if (options.scoreThreshold !== undefined) out.scoreThreshold = options.scoreThreshold;
  if (options.mode !== undefined) out.mode = options.mode;
  if (options.hybrid !== undefined) out.hybrid = options.hybrid;
  return out;
}

/**
 * Where the keyword sidecar lives: next to the vector index for local stores
 * (mirroring createVectorStore's defaults), otherwise under `storeDir`.
 */
function keywordBaseDir(config: ResolvedConfig): string {
  const vs = config.vectorStore;
  if (typeof vs === "object" && "provider" in vs) {
    if (vs.storeDir) return vs.storeDir;
    return vs.provider === "memory" || vs.provider === "lancedb"
      ? DEFAULT_STORE_DIRNAME
      : config.storeDir;
  }
  return config.storeDir;
}
