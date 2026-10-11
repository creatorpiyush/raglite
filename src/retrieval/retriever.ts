import type { Embedder } from "../embeddings/index.js";
import type { SearchResult } from "../types.js";
import type { VectorStore } from "../vectordb/index.js";
import type { MetadataFilter } from "./filter.js";

export interface RetrieveOptions {
  topK: number;
  scoreThreshold?: number;
  /** Per-chunk metadata conditions, passed to the store. */
  filter?: MetadataFilter;
}

export class Retriever {
  constructor(
    private readonly embedder: Embedder,
    private readonly store: VectorStore,
  ) {}

  async retrieve(query: string, options: RetrieveOptions): Promise<SearchResult[]> {
    const embedding = await this.embedder.embedQuery(query);
    const hits = options.filter
      ? await this.store.search(embedding, options.topK, options.filter)
      : await this.store.search(embedding, options.topK);
    const threshold = options.scoreThreshold ?? 0;
    return hits.filter((h) => h.score >= threshold);
  }
}
