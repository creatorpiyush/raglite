import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createServer, type ServeOptions, type ServerHandle } from "../api/index.js";
import { type DocumentOptions, type ResolvedConfig, resolveConfig } from "../config.js";
import { ConfigError, RagLiteError } from "../errors.js";
import {
  type AnswerResult,
  generateAnswer,
  type PromptOptions,
  streamAnswer,
} from "../llm/index.js";
import { DirectoryLoader, isSupportedFile, isUrl } from "../loaders/index.js";
import type { LLMProviderConfig, SearchResult } from "../types.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { Document, type IndexOptions, type SearchOptions } from "./document.js";

export interface CollectionBuildResult {
  totalDocuments: number;
  totalChunks: number;
  cachedDocuments: number;
  newDocuments: number;
  errors: { source: string; error: string }[];
}

export interface CollectionAskOptions extends SearchOptions, PromptOptions {
  llm?: LLMProviderConfig;
}

/**
 * Manages semantic indexing, multi-document retrieval, and question-answering across
 * multiple files, directories, glob patterns, and URLs.
 */
export class DocumentCollection {
  private readonly sources: string[] = [];
  private readonly options: DocumentOptions;
  private readonly config: ResolvedConfig;
  private readonly logger: Logger;
  private readonly documents: Map<string, Document> = new Map();
  private ready = false;

  constructor(sources: string | string[] = [], options: DocumentOptions = {}) {
    this.options = options;
    this.config = resolveConfig(options);
    this.logger = createLogger(this.config.logLevel);

    const rawSources = Array.isArray(sources) ? sources : [sources];
    for (const src of rawSources) {
      if (src && src.trim().length > 0) {
        this.sources.push(src.trim());
      }
    }
  }

  /**
   * Add a file path, directory path, glob pattern, or web URL to the collection.
   */
  addSource(source: string): void {
    if (source && source.trim().length > 0) {
      this.sources.push(source.trim());
      this.ready = false;
    }
  }

  /**
   * Build (or reuse) semantic indexes for all documents in the collection.
   */
  async build(options: IndexOptions = {}): Promise<CollectionBuildResult> {
    const fileList: string[] = [];
    const errors: { source: string; error: string }[] = [];

    for (const src of this.sources) {
      if (isUrl(src)) {
        fileList.push(src);
        continue;
      }

      const resolved = resolve(src);
      if (!existsSync(resolved)) {
        const msg = `Source path does not exist: ${src}`;
        this.logger.warn(msg);
        errors.push({ source: src, error: msg });
        continue;
      }

      const stat = statSync(resolved);
      if (stat.isDirectory()) {
        const dirLoader = new DirectoryLoader(resolved);
        try {
          const res = await dirLoader.loadFiles();
          for (const item of res.loaded) {
            fileList.push(item.filePath);
          }
          for (const err of res.errors) {
            errors.push({ source: err.filePath, error: err.error });
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Error scanning directory "${src}": ${errMsg}`);
          errors.push({ source: src, error: errMsg });
        }
      } else if (stat.isFile()) {
        if (isSupportedFile(resolved)) {
          fileList.push(resolved);
        } else {
          const msg = `Unsupported file type: ${src}`;
          this.logger.warn(msg);
          errors.push({ source: src, error: msg });
        }
      }
    }

    // A VectorStore instance has a single namespace, so every document would
    // share it and each build() would reset the previous document's index.
    const vectorStore = this.options.vectorStore;
    if (vectorStore && !("provider" in vectorStore) && new Set(fileList).size > 1) {
      throw new ConfigError(
        "A VectorStore instance cannot be shared by multiple documents in a DocumentCollection. " +
          'Pass a vector store provider config (e.g. { provider: "qdrant", ... }) instead.',
      );
    }

    let totalChunks = 0;
    let cachedDocs = 0;
    let newDocs = 0;

    for (const filePath of fileList) {
      try {
        let doc = this.documents.get(filePath);
        if (!doc) {
          doc = new Document(filePath, this.options);
          this.documents.set(filePath, doc);
        }
        const res = await doc.build(options);
        totalChunks += res.chunkCount;
        if (res.cached) {
          cachedDocs++;
        } else {
          newDocs++;
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to index document "${filePath}": ${errMsg}`);
        errors.push({ source: filePath, error: errMsg });
      }
    }

    this.ready = true;
    this.logger.info(
      `Collection index ready (${this.documents.size} documents, ${totalChunks} total chunks, ${errors.length} error(s)).`,
    );

    return {
      totalDocuments: this.documents.size,
      totalChunks,
      cachedDocuments: cachedDocs,
      newDocuments: newDocs,
      errors,
    };
  }

  /**
   * Semantic search across all documents in the collection.
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    await this.ensureReady();
    if (this.documents.size === 0) {
      return [];
    }

    const topK = options.topK ?? this.config.topK;
    const scoreThreshold = options.scoreThreshold ?? this.config.scoreThreshold;

    const settled = await Promise.allSettled(
      Array.from(this.documents.values()).map((doc) =>
        doc.search(query, { topK: topK * 2, scoreThreshold }),
      ),
    );

    const allHits: SearchResult[] = [];
    const failures: unknown[] = [];
    const docs = Array.from(this.documents.values());
    settled.forEach((res, i) => {
      if (res.status === "fulfilled") {
        allHits.push(...res.value);
        return;
      }
      failures.push(res.reason);
      const errMsg = res.reason instanceof Error ? res.reason.message : String(res.reason);
      this.logger.warn(`Search failed for document "${docs[i]!.filePath}": ${errMsg}`);
    });

    // One broken document should not hide results from the others, but if
    // every document failed the caller needs the error, not an empty list.
    if (failures.length === settled.length) {
      throw failures[0];
    }

    allHits.sort((a, b) => b.score - a.score);

    return allHits.slice(0, topK);
  }

  /**
   * Ask a question across the entire collection.
   */
  async ask(question: string, options: CollectionAskOptions = {}): Promise<AnswerResult> {
    const llmConfig = options.llm ?? this.config.llm;
    if (!llmConfig) {
      throw new RagLiteError(
        "No LLM provider configured. Pass one to `ask({ llm: ... })` or `new DocumentCollection(path, { llm: ... })`.",
      );
    }

    const context = await this.search(question, {
      topK: options.topK ?? this.config.topK,
      scoreThreshold: options.scoreThreshold ?? this.config.scoreThreshold,
    });
    if (context.length === 0) {
      throw new RagLiteError(
        "No relevant context found in document collection to answer question.",
      );
    }

    return generateAnswer({
      llm: llmConfig,
      question,
      context,
      includeCitations: options.includeCitations,
      systemHint: options.systemHint,
    });
  }

  /**
   * Stream LLM response over retrieved collection context.
   */
  async *askStream(
    question: string,
    options: CollectionAskOptions = {},
  ): AsyncGenerator<string, void, void> {
    const llmConfig = options.llm ?? this.config.llm;
    if (!llmConfig) {
      throw new RagLiteError(
        "No LLM provider configured. Pass one to `askStream({ llm: ... })` or `new DocumentCollection(path, { llm: ... })`.",
      );
    }

    const context = await this.search(question, {
      topK: options.topK ?? this.config.topK,
      scoreThreshold: options.scoreThreshold ?? this.config.scoreThreshold,
    });
    if (context.length === 0) {
      throw new RagLiteError(
        "No relevant context found in document collection to answer question.",
      );
    }

    yield* streamAnswer({
      llm: llmConfig,
      question,
      context,
      includeCitations: options.includeCitations,
      systemHint: options.systemHint,
    });
  }

  /**
   * Serve a REST API server over the document collection.
   */
  async serve(options: ServeOptions = {}): Promise<ServerHandle> {
    await this.ensureReady();
    return createServer(this, options);
  }

  /**
   * Access underlying Document instances.
   */
  getDocuments(): Document[] {
    return Array.from(this.documents.values());
  }

  /** Number of total chunks across all documents in the collection. */
  get chunkCount(): number {
    let total = 0;
    for (const doc of this.documents.values()) {
      total += doc.chunkCount;
    }
    return total;
  }

  /** Underlying resolved configuration (readonly view). */
  get resolvedConfig(): Readonly<ResolvedConfig> {
    return this.config;
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      await this.build();
    }
  }
}
